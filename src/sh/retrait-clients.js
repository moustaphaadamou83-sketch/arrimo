'use strict';
/**
 * Retirer un client créé par erreur (ex. : client de test saisi dans le mauvais environnement).
 * Le journal SH est immuable et renvoie à la fiche : on ne l'efface donc jamais. La fiche passe au statut « retire » :
 * elle disparaît des listes et de la recherche, reste consultable par l'administration et peut être rétablie.
 * Conditions : jamais relié à un environnement (aucun compte ni donnée chez le client), pas en production, aucun contrat signé,
 * aucun projet contenant du travail. Effets, dans une seule transaction : paiements annulés (jamais effacés), factures annulées,
 * projets vides supprimés, statut « retire » avec motif, auteur et date. Rétablir rend le statut d'avant (factures et paiements restent annulés).
 * Annuler un paiement saisi par erreur : le paiement reste visible, marqué annulé (motif, auteur, date) ; il ne compte plus dans le payé.
 */
const { transaction } = require('../db');

const erreur = (statut, message) => Object.assign(new Error(message), { statut });
const idPositif = (x) => Number.isSafeInteger(Number(x)) && Number(x) > 0 ? Number(x) : null;
const motifValide = (x) => { const m = String(x || '').trim(); if (m.length < 10 || m.length > 2000) throw erreur(400, 'Décrivez le motif (10 à 2000 caractères).'); return m; };

async function bilan(c, id, verrou = false) {
  const h = (await c.query(`SELECT id, nom, code_etab, environnement, statut, relie, organisation_id, retire_le, retire_motif, statut_avant_retrait FROM hopitaux WHERE id=$1${verrou ? ' FOR UPDATE' : ''}`, [id])).rows[0];
  if (!h) throw erreur(404, 'Client introuvable.');
  const factures = (await c.query(`SELECT f.id, f.numero, f.statut, f.total, f.devise,
      (SELECT coalesce(sum(p.montant),0) FROM sh_paiements p WHERE p.facture_id=f.id AND p.annule_le IS NULL)::numeric(14,2) paye,
      (SELECT count(*)::int FROM sh_paiements p WHERE p.facture_id=f.id AND p.annule_le IS NULL) paiements
    FROM sh_factures f WHERE (f.hopital_id=$1 OR ($2::bigint IS NOT NULL AND f.organisation_id=$2)) AND f.statut <> 'annulee' ORDER BY f.id${verrou ? ' FOR UPDATE OF f' : ''}`, [h.id, h.organisation_id])).rows;
  const projets = (await c.query(`SELECT p.id, p.nom, p.contrat_id,
      (SELECT count(*) FROM sh_taches t WHERE t.projet_id=p.id)+(SELECT count(*) FROM sh_jalons j WHERE j.projet_id=p.id)+(SELECT count(*) FROM sh_projet_finances x WHERE x.projet_id=p.id)
      +(SELECT count(*) FROM sh_projet_registre r WHERE r.projet_id=p.id)+(SELECT count(*) FROM sh_documents d WHERE d.projet_id=p.id)+(SELECT count(*) FROM sh_support_tickets k WHERE k.projet_id=p.id) contenu
    FROM sh_projets p WHERE p.hopital_id=$1 ORDER BY p.id${verrou ? ' FOR UPDATE OF p' : ''}`, [h.id])).rows;
  const contratsSignes = (await c.query(`SELECT count(*)::int n FROM sh_contrats k LEFT JOIN sh_opportunites o ON o.id=k.opportunite_id
    WHERE k.statut='signe' AND (k.hopital_id=$1 OR ($2::bigint IS NOT NULL AND o.organisation_id=$2))`, [h.id, h.organisation_id])).rows[0].n;
  const blocages = [];
  if (h.statut === 'retire') blocages.push('Ce client est déjà retiré.');
  if (/^production(_|$)/.test(h.environnement)) blocages.push('Client de production : la procédure de fin de contrat (conservation, restitution) s’applique, pas le retrait.');
  if (h.relie) blocages.push('Le client est relié à son environnement (comptes et données chez lui) : désactivez-le plutôt (statut « suspendu »).');
  if (contratsSignes) blocages.push(`${contratsSignes} contrat(s) signé(s) : résiliez-les d’abord.`);
  const pleins = projets.filter((p) => Number(p.contenu) > 0 || p.contrat_id);
  if (pleins.length) blocages.push(`Projet(s) avec du travail enregistré (${pleins.map((p) => p.nom).join(', ')}) : archivez-les d’abord.`);
  return { client: h, factures, projets_supprimes: projets.filter((p) => !pleins.includes(p)).map((p) => ({ id: p.id, nom: p.nom })), contrats_signes: contratsSignes, blocages, possible: !blocages.length };
}

function brancher(api, pool, route, journal) {
  api.get('/hopitaux/:id/retrait', route(async (req) => bilan(pool, idPositif(req.params.id))));
  api.post('/hopitaux/:id/retirer', route(async (req) => transaction(pool, async (c) => {
    const b = await bilan(c, idPositif(req.params.id), true);
    const h = b.client;
    if (req.body.confirmation !== `RETIRER ${h.code_etab}`) throw erreur(400, `Confirmation invalide : tapez RETIRER ${h.code_etab}.`);
    const motif = motifValide(req.body.motif);
    if (!b.possible) throw erreur(409, b.blocages.join(' '));
    let paiements = 0;
    for (const f of b.factures) {
      const r = await c.query('UPDATE sh_paiements SET annule_le=now(), annule_par=$2, annule_motif=$3 WHERE facture_id=$1 AND annule_le IS NULL', [f.id, req.u.id, `Client retiré (créé par erreur) : ${motif}`]);
      paiements += r.rowCount;
      await c.query("UPDATE sh_factures SET statut='annulee', annulee_motif=$2 WHERE id=$1", [f.id, `Client retiré (créé par erreur) : ${motif}`.slice(0, 500)]);
      await journal(c, req.u, 'Facture annulée (client retiré)', f.numero || `brouillon ${f.id}`, `${r.rowCount ? `${r.rowCount} paiement(s) annulé(s) ; ` : ''}motif : ${motif}`, h.id);
    }
    for (const p of b.projets_supprimes) {
      const affectations = (await c.query("DELETE FROM sh_affectations WHERE type='projet' AND projet_id=$1 RETURNING utilisateur_id", [p.id])).rows;
      for (const u of new Set(affectations.map((a) => a.utilisateur_id))) await c.query('DELETE FROM sh_sessions WHERE utilisateur_id=$1', [u]);
      await c.query("SELECT set_config('app.sh_suppression_projet',$1,true)", [String(p.id)]);
      await c.query('DELETE FROM sh_projet_membres WHERE projet_id=$1', [p.id]);
      await journal(c, req.u, 'Projet supprimé (client retiré)', p.nom, `motif : ${motif}`, h.id);
      await c.query('DELETE FROM sh_projets WHERE id=$1', [p.id]);
    }
    await c.query(`UPDATE hopitaux SET statut_avant_retrait=statut, statut='retire', retire_le=now(), retire_par=$2, retire_motif=$3 WHERE id=$1`, [h.id, req.u.id, motif]);
    await journal(c, req.u, 'Client retiré (créé par erreur)', `${h.code_etab} · ${h.nom}`,
      `${b.factures.length} facture(s) et ${paiements} paiement(s) annulés, ${b.projets_supprimes.length} projet(s) vide(s) supprimé(s) ; motif : ${motif}`, h.id);
    return { ok: true, factures_annulees: b.factures.length, paiements_annules: paiements, projets_supprimes: b.projets_supprimes.length };
  })));
  api.post('/hopitaux/:id/retablir', route(async (req) => transaction(pool, async (c) => {
    const h = (await c.query('SELECT id, code_etab, nom, statut, statut_avant_retrait FROM hopitaux WHERE id=$1 FOR UPDATE', [idPositif(req.params.id)])).rows[0];
    if (!h) throw erreur(404, 'Client introuvable.');
    if (h.statut !== 'retire') throw erreur(409, 'Ce client n’est pas retiré.');
    const motif = motifValide(req.body.motif);
    await c.query(`UPDATE hopitaux SET statut=COALESCE(statut_avant_retrait,'prospect'), statut_avant_retrait=NULL, retire_le=NULL, retire_par=NULL, retire_motif=NULL WHERE id=$1`, [h.id]);
    await journal(c, req.u, 'Client rétabli', `${h.code_etab} · ${h.nom}`, `motif : ${motif} ; factures et paiements annulés le restent`, h.id);
    return { ok: true };
  })));
  api.post('/facturation/paiements/:id/annuler', route(async (req) => transaction(pool, async (c) => {
    const p = (await c.query('SELECT p.*, f.numero, f.hopital_id FROM sh_paiements p JOIN sh_factures f ON f.id=p.facture_id WHERE p.id=$1 FOR UPDATE OF p', [idPositif(req.params.id)])).rows[0];
    if (!p) throw erreur(404, 'Paiement introuvable.');
    if (p.annule_le) throw erreur(409, 'Ce paiement est déjà annulé.');
    const motif = motifValide(req.body.motif);
    await c.query('UPDATE sh_paiements SET annule_le=now(), annule_par=$2, annule_motif=$3 WHERE id=$1', [p.id, req.u.id, motif]);
    await journal(c, req.u, 'Paiement annulé (saisi par erreur)', p.numero || `facture ${p.facture_id}`, `${p.montant} · motif : ${motif}`, p.hopital_id);
    return { ok: true };
  })));
}

module.exports = { brancher, bilan };
