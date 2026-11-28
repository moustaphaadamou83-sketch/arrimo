'use strict';
/**
 * Entretien (cahier « Dashboard Entretien, automatisation, affectations, Chrono », 28 nov. 2026).
 * Cycle de remise en disponibilité d'un lit ou d'une civière, calculé à partir des MÊMES heures que Capacités et Chrono :
 *  - journal immuable des lits et civières (src/regles.js : seul endroit qui change un état) : occupation, libération, disponibilité ;
 *  - lits.nettoyage_debut / civieres.nettoyage_debut : début du nettoyage ;
 *  - nettoyage_interventions (nettoyage sous précautions) : fin du nettoyage, vérification.
 * Aucun compteur indépendant : chaque phase a un début et une fin enregistrés ; la phase en cours se mesure jusqu'à l'heure du serveur.
 * Une durée sans heure de référence est null (« inconnue »), jamais 0. Libéré ≠ disponible : un lit en nettoyage n'est jamais disponible.
 * Aucune référence patient pour le rôle entretien.
 */
const { ErreurHttp, transaction } = require('./db');
const { exigerEtablissement } = require('./auth');

const min = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)) : null);

/** Phase courante et durées d'une ressource, d'après ses heures de référence (toutes les phases, même closes). */
function phases(h, maintenant) {
  const now = maintenant.toISOString();
  const fin = h.disponible_le || null;
  const phase = fin ? 'disponible' : h.verification_debut ? 'verification' : h.nettoyage_debut ? 'nettoyage' : 'attente';
  return {
    phase,
    occupation_min: min(h.occupation_debut, h.liberation_le),
    attente_min: min(h.liberation_le, h.nettoyage_debut || fin || now),
    nettoyage_min: h.nettoyage_debut ? min(h.nettoyage_debut, h.nettoyage_fin || fin || now) : null,
    verification_min: h.verification_debut ? min(h.verification_debut, fin || now) : null,
    total_min: min(h.liberation_le, fin || now),
    disponible_min: fin ? min(fin, h.reoccupe_le || now) : null,
  };
}

/** Localisation physique : établissement → département → service → unité → étage → chambre → lit (ou civière de l'urgence). */
const LOC = `LEFT JOIN unites un ON un.id = x.unite_id LEFT JOIN services sv ON sv.id = un.service_id
  LEFT JOIN departements dp ON dp.id = COALESCE(un.departement_id, sv.departement_id)`;

async function ressources(pool, u, etabId, { jour = true } = {}) {
  exigerEtablissement(u, etabId);
  const maintenant = new Date((await pool.query('SELECT now() AS n')).rows[0].n);
  const entretien = u.role === 'entretien';
  // 1. À traiter : lits et civières à l'état « nettoyage » (libérés, jamais disponibles)
  const lits = (await pool.query(`SELECT 'lit' AS genre, x.id, x.code, x.version, x.etat, x.etat_depuis, x.nettoyage_debut, x.isolement,
      un.nom AS unite, sv.nom AS service, dp.nom AS departement, ch.numero AS chambre, et.nom AS etage,
      ni.statut AS intervention, ni.debut_le AS intervention_debut, ni.fin_le AS intervention_fin, np.nom AS protocole, ni.precautions,
      (SELECT j.date FROM journal j WHERE j.lit_id = x.id AND NOT j.refuse AND j.nouvel_etat = 'nettoyage' ORDER BY j.id DESC LIMIT 1) AS liberation_le,
      (SELECT j.date FROM journal j WHERE j.lit_id = x.id AND NOT j.refuse AND j.nouvel_etat = 'occupe' ORDER BY j.id DESC LIMIT 1) AS occupation_debut
    FROM lits x ${LOC} JOIN chambres ch ON ch.id = x.chambre_id LEFT JOIN etages et ON et.id = ch.etage_id
    LEFT JOIN nettoyage_interventions ni ON ni.lit_id = x.id AND ni.statut IN ('en_cours', 'controle_requis')
    LEFT JOIN nettoyage_protocoles np ON np.id = ni.protocole_id
    WHERE x.etablissement_id = $1 AND x.actif AND x.etat = 'nettoyage' ORDER BY x.etat_depuis`, [etabId])).rows;
  const civ = (await pool.query(`SELECT 'civiere' AS genre, x.id, x.code, x.version, x.etat, x.etat_depuis, x.nettoyage_debut, x.categorie,
      un.nom AS unite, sv.nom AS service, dp.nom AS departement,
      (SELECT j.date FROM journal j WHERE j.civiere_id = x.id AND NOT j.refuse AND j.nouvel_etat = 'nettoyage' ORDER BY j.id DESC LIMIT 1) AS liberation_le,
      (SELECT j.date FROM journal j WHERE j.civiere_id = x.id AND NOT j.refuse AND j.nouvel_etat = 'occupee' ORDER BY j.id DESC LIMIT 1) AS occupation_debut
    FROM civieres x ${LOC} WHERE x.etablissement_id = $1 AND x.actif AND x.etat = 'nettoyage' ORDER BY x.etat_depuis`, [etabId])).rows;
  const enCours = [...lits, ...civ].map((r) => {
    const h = { liberation_le: r.liberation_le || r.etat_depuis, occupation_debut: r.occupation_debut,
      nettoyage_debut: r.intervention_debut || r.nettoyage_debut, nettoyage_fin: r.intervention_fin,
      verification_debut: r.intervention === 'controle_requis' ? r.intervention_fin : null };
    if (h.occupation_debut && new Date(h.occupation_debut) > new Date(h.liberation_le)) h.occupation_debut = null;
    return { genre: r.genre, id: r.id, code: r.code, version: r.version, departement: r.departement || null, service: r.service || null, unite: r.unite || null,
      etage: r.etage || null, chambre: r.chambre || null, categorie: r.categorie, isolement: !!r.isolement, protocole: r.protocole || null, precautions: r.precautions || [],
      intervention: r.intervention || null, ...h, ...phases(h, maintenant) };
  });
  // 2. Terminées aujourd'hui : passage « nettoyage → libre » dans le journal (heure de disponibilité), avec les heures des phases
  let terminees = [];
  if (jour) {
    terminees = (await pool.query(`SELECT j.date AS disponible_le, COALESCE(l.code, c.code) AS code, CASE WHEN j.lit_id IS NULL THEN 'civiere' ELSE 'lit' END AS genre,
        COALESCE(j.lit_id, j.civiere_id) AS id, j.utilisateur_id, ux.nom AS par,
        (SELECT j2.date FROM journal j2 WHERE ((j.lit_id IS NOT NULL AND j2.lit_id = j.lit_id) OR (j.civiere_id IS NOT NULL AND j2.civiere_id = j.civiere_id))
          AND NOT j2.refuse AND j2.nouvel_etat = 'nettoyage' AND j2.id < j.id ORDER BY j2.id DESC LIMIT 1) AS liberation_le,
        (SELECT j2.date FROM journal j2 WHERE ((j.lit_id IS NOT NULL AND j2.lit_id = j.lit_id) OR (j.civiere_id IS NOT NULL AND j2.civiere_id = j.civiere_id))
          AND NOT j2.refuse AND j2.action IN ('Nettoyage commencé', 'Nettoyage de civière commencé') AND j2.id < j.id ORDER BY j2.id DESC LIMIT 1) AS nettoyage_debut,
        (SELECT j2.date FROM journal j2 WHERE ((j.lit_id IS NOT NULL AND j2.lit_id = j.lit_id) OR (j.civiere_id IS NOT NULL AND j2.civiere_id = j.civiere_id))
          AND NOT j2.refuse AND j2.nouvel_etat IN ('occupe', 'occupee') AND j2.id > j.id ORDER BY j2.id LIMIT 1) AS reoccupe_le,
        ni.fin_le AS nettoyage_fin, CASE WHEN ni.controle_le IS NOT NULL THEN ni.fin_le END AS verification_debut
      FROM journal j LEFT JOIN lits l ON l.id = j.lit_id LEFT JOIN civieres c ON c.id = j.civiere_id LEFT JOIN utilisateurs ux ON ux.id = j.utilisateur_id
      LEFT JOIN LATERAL (SELECT fin_le, controle_le FROM nettoyage_interventions n WHERE n.lit_id = j.lit_id AND n.statut = 'validee' AND n.controle_le <= j.date + interval '1 minute'
        ORDER BY n.id DESC LIMIT 1) ni ON true
      WHERE j.etablissement_id = $1 AND NOT j.refuse AND j.ancien_etat = 'nettoyage' AND j.nouvel_etat = 'libre' AND j.date >= date_trunc('day', now())
        ${entretien ? 'AND j.utilisateur_id = $2' : ''} ORDER BY j.id DESC LIMIT 50`, entretien ? [etabId, u.id] : [etabId])).rows
      .map((r) => { const h = { ...r }; if (h.nettoyage_debut && h.liberation_le && new Date(h.nettoyage_debut) < new Date(h.liberation_le)) h.nettoyage_debut = null;
        return { genre: r.genre, id: r.id, code: r.code, par: r.par, liberation_le: h.liberation_le, nettoyage_debut: h.nettoyage_debut, nettoyage_fin: h.nettoyage_fin,
          verification_debut: h.verification_debut, disponible_le: r.disponible_le, reoccupe_le: r.reoccupe_le, ...phases(h, maintenant) }; });
  }
  return { maintenant: maintenant.toISOString(), en_cours: enCours, terminees };
}

/** Accueil de l'agent : identité réelle du compte, indicateurs de son périmètre, interventions (même source que Nettoyage). */
async function accueil(pool, u, etabId) {
  exigerEtablissement(u, etabId);
  const [moi, e, r, taches, nonLues] = await Promise.all([
    pool.query('SELECT nom, email, role FROM utilisateurs WHERE id = $1', [u.id]),
    pool.query('SELECT nom, type_etablissement FROM etablissements WHERE id = $1', [etabId]),
    ressources(pool, u, etabId),
    require('./taches').miennes(pool, u, { etablissement_id: etabId }).catch(() => ({ taches: [] })),
    pool.query('SELECT count(*)::int n FROM connect_lectures cl RIGHT JOIN connect_messages m ON m.id = cl.message_id AND cl.utilisateur_id = $1 WHERE cl.message_id IS NULL AND m.destinataire_id = $1', [u.id]).catch(() => ({ rows: [{ n: 0 }] })),
  ]);
  const pref = (await pool.query('SELECT formation, expire_le FROM agent_formations WHERE etablissement_id = $1 AND utilisateur_id = $2 AND expire_le > now() ORDER BY formation', [etabId, u.id]).catch(() => ({ rows: [] }))).rows;
  const t = taches.taches || [];
  const kpis = {
    a_nettoyer: r.en_cours.filter((x) => x.phase === 'attente').length,
    en_cours: r.en_cours.filter((x) => x.phase === 'nettoyage').length,
    a_verifier: r.en_cours.filter((x) => x.phase === 'verification').length,
    prioritaires: t.filter((x) => x.prioritaire).length,
    terminees: r.terminees.length,
    messages_non_lus: nonLues.rows[0]?.n ?? 0,
  };
  return { identite: { nom: moi.rows[0]?.nom, role: moi.rows[0]?.role, etablissement: e.rows[0]?.nom, type: e.rows[0]?.type_etablissement, formations: pref },
    kpis, ...r, taches: t.filter((x) => x.source === 'tache').slice(0, 12) };
}

/** Début du nettoyage d'une civière (heure enregistrée, journalisée) : la civière reste « à nettoyer » (indisponible). */
async function debutCiviere(pool, u, civiereId) {
  return transaction(pool, async (c) => {
    const cv = (await c.query('SELECT id, etablissement_id, etat, nettoyage_debut FROM civieres WHERE id = $1 FOR NO KEY UPDATE', [civiereId])).rows[0];
    if (!cv) throw new ErreurHttp(404, 'civiere_introuvable');
    exigerEtablissement(u, cv.etablissement_id);
    if (cv.etat !== 'nettoyage' || cv.nettoyage_debut) throw new ErreurHttp(409, 'nettoyage_impossible');
    const r = (await c.query('UPDATE civieres SET nettoyage_debut = now() WHERE id = $1 RETURNING *', [civiereId])).rows[0];
    await require('./regles').journaliser(c, { civiereId, etablissementId: cv.etablissement_id, utilisateurId: u.id, action: 'Nettoyage de civière commencé' });
    require('./flux').signaler();
    return r;
  });
}

module.exports = { ressources, accueil, debutCiviere, phases };
