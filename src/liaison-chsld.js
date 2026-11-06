'use strict';
/**
 * Module hospitalier « Liaison CHSLD » : un seul module, commun à tous les hôpitaux, activable depuis SH.
 * Il ne crée aucun moteur parallèle : il lit et fait avancer les coordinations CHSLD ↔ hôpital (src/chsld.js),
 * avec les mêmes verrous, versions, journaux et notifications. Les transferts interhospitaliers restent à part.
 * Règles :
 * - Une demande transmise n'est pas une arrivée : chaque étape est confirmée par une personne (horodatage = preuve).
 * - Aucune orientation clinique automatique, aucune priorité clinique : l'orientation est une décision humaine.
 * - L'hôpital ne voit que la référence du résident (R-00000), jamais son nom.
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const TE = require('./types-etablissement');
const ch = require('./chsld');

const GERER = ['coordonnateur', 'admin_etab', 'gestionnaire'];
const OUVERTS = ['preparee', 'envoyee', 'acceptee', 'en_cours'];

/** Hôpital accessible, module Liaison CHSLD actif ; sinon refus (le module n'existe pas pour cet utilisateur). */
async function etabHopital(db, u, etabId) {
  exigerEtablissement(u, etabId);
  const e = (await db.query('SELECT id, nom, type_etablissement, module_actif, modules FROM etablissements WHERE id = $1', [etabId])).rows[0];
  if (!e) throw new ErreurHttp(404, 'etab_introuvable');
  if ((e.type_etablissement || 'hopital') !== 'hopital') throw new ErreurHttp(409, 'etab_non_hopital');
  if (!TE.moduleActif(e, 'liaison_chsld')) throw new ErreurHttp(403, 'module_desactive', { module: 'liaison_chsld' });
  if (![...GERER, 'equipe_soins'].includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  return e;
}

/** Dernière étape réellement confirmée et son horodatage (ce qu'OG cite ; jamais une localisation supposée). */
function derniereConfirmation(c) {
  const e = (c.etapes || []).at(-1);
  return e ? { statut: e.statut, date: e.date } : { statut: c.statut, date: c.modifie_le };
}
/** Actions proposées à l'hôpital selon l'étape et le rôle (le serveur revérifie chacune). */
function actionsHopital(c, u, retour) {
  if (!GERER.includes(u.role) && u.role !== 'equipe_soins') return [];
  const gerer = GERER.includes(u.role);
  if (c.type === 'retour') return c.statut === 'acceptee' ? ['confirmer_depart', ...(gerer ? ['annuler'] : [])] : c.statut === 'envoyee' ? ['incident', ...(gerer ? ['annuler'] : [])] : c.statut === 'en_cours' && !c.transport_le ? ['transport'] : [];
  if (c.type === 'transfert_hopital') {
    if (c.cloturee_le) return [];
    if (c.entrante) return c.statut === 'envoyee' || c.statut === 'acceptee' ? (gerer ? [...(c.statut === 'envoyee' ? ['accepter'] : []), 'refuser'] : []) : c.statut === 'en_cours' ? ['confirmer_arrivee'] : [];
    return !gerer ? [] : c.statut === 'envoyee' ? ['annuler'] : c.statut === 'acceptee' ? ['confirmer_depart', 'annuler'] : [];
  }
  if (c.cloturee_le) return [];
  const a = [];
  if (c.statut === 'envoyee') { if (!c.recue_hopital_le) a.push('accuser_reception'); if (gerer) a.push('accepter', 'refuser'); a.push('incident'); }
  if (c.statut === 'acceptee') { if (gerer) a.push('refuser'); a.push('incident'); }
  if (c.statut === 'en_cours') a.push('confirmer_reception', 'incident');
  if (c.statut === 'recue') {
    // De la civière vers un lit : la même action reste proposée tant qu'aucune demande d'admission n'existe
    if (gerer && (!c.orientation || (c.orientation === 'urgence' && !c.admission))) a.push('orienter');
    if (gerer && !(retour && OUVERTS.includes(retour.statut)) && !c.transfert_ouvert) a.push('retour', 'transferer');
    a.push('incident');
  }
  return a;
}

/** Les cinq onglets du module, pour l'hôpital courant : arrivées, à accueillir, hospitalisations, retours en cours, historique. */
async function vue(pool, u, etabId) {
  await etabHopital(pool, u, etabId);
  const toutes = await ch.listeCoordinations(pool, u, etabId, { toutes: true });
  const hosp = toutes.filter((c) => c.type === 'hospitalisation' && c.entrante);
  const retours = toutes.filter((c) => c.type === 'retour' && !c.entrante);
  const transferts = toutes.filter((c) => c.type === 'transfert_hopital');
  for (const h of hosp) h.transfert_ouvert = transferts.some((x) => x.liee_id === h.id && OUVERTS.includes(x.statut));
  const retourDe = (h) => retours.filter((r) => r.liee_id === h.id).sort((x, y) => new Date(y.cree_le) - new Date(x.cree_le))[0] || null;
  const retourActif = (r) => !!r && (OUVERTS.includes(r.statut) || r.a_reintegrer);
  const fiche = (c, r = null) => ({ ...c, derniere: derniereConfirmation(c), actions: actionsHopital(c, u, r),
    retour: r ? { id: r.id, numero: r.numero, statut: r.statut, etape: r.etape, retour_prevu_le: r.retour_prevu_le, version: r.version, chronologie: r.chronologie, actions: actionsHopital(r, u) } : null });
  const arrivees = hosp.filter((c) => ['envoyee', 'acceptee'].includes(c.statut)).map((c) => fiche(c));
  const ouverte = (c) => c.statut === 'recue' && !c.cloturee_le;
  const aAccueillir = hosp.filter((c) => c.statut === 'en_cours' || (ouverte(c) && !c.orientation && !retourActif(retourDe(c)))).map((c) => fiche(c, retourDe(c)));
  const enCours = hosp.filter((c) => ouverte(c) && c.orientation && !retourActif(retourDe(c))).map((c) => fiche(c, retourDe(c)));
  const retoursEnCours = hosp.filter((c) => ouverte(c) && retourActif(retourDe(c))).map((c) => fiche(c, retourDe(c)));
  const historique = hosp.concat(transferts).filter((c) => ['refusee', 'annulee', 'expiree'].includes(c.statut) || c.cloturee_le).map((c) => fiche(c, retourDe(c)));
  const transfertsEnCours = transferts.filter((c) => OUVERTS.includes(c.statut)).map((c) => fiche(c));
  return { transferts: transfertsEnCours, arrivees, a_accueillir: aAccueillir, hospitalisations: enCours, retours_en_cours: retoursEnCours, historique,
    compteurs: { arrivees: arrivees.length, a_accueillir: aAccueillir.length, hospitalisations: enCours.length, retours: retoursEnCours.length } };
}
/** Lits libres et compatibles (service, besoins, groupe d'âge) et civières libres : relus par le serveur à l'attribution. */
async function emplacements(pool, u, etabId, coId, q = {}) {
  const e = await etabHopital(pool, u, etabId);
  if (!GERER.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const co = (await pool.query('SELECT id, type, statut, destination_id, service_souhaite_id FROM coordinations WHERE id = $1', [coId])).rows[0];
  if (!co || co.destination_id !== e.id || co.type !== 'hospitalisation') throw new ErreurHttp(404, 'coordination_introuvable');
  if (co.statut !== 'recue') throw new ErreurHttp(409, 'coordination_statut_incompatible');
  const s = require('./services');
  const etab = await s.etablissement(pool, e.id);
  const services = (await pool.query('SELECT id, nom, nom_en FROM types_unite WHERE config_id = $1 ORDER BY ordre', [etab.config_id])).rows;
  const typeId = services.some((t) => t.id === Number(q.type_id)) ? Number(q.type_id) : co.service_souhaite_id || services[0]?.id;
  const un = (k) => q[k] === '1' || q[k] === 'true';
  const besoins = s.lireBesoins({ isolement: un('isolement'), pression_negative: un('pression_negative'), ventilation: un('ventilation'), telemetrie: un('telemetrie') });
  const groupe = await s.groupeAgeEffectif(pool, typeId, undefined);
  const prescrites = await require('./evaluations-fictives').precautionsTransmises(pool, coId);
  const lus = (await pool.query(`SELECT l.id, l.code, l.version, ch.numero AS chambre, ch.precautions, un.nom AS unite FROM lits l JOIN chambres ch ON ch.id = l.chambre_id JOIN unites un ON un.id = l.unite_id
    WHERE l.etablissement_id = $1 AND l.type_id = $2 AND l.actif AND l.etat = 'libre'${s.sqlBesoins(besoins)}${s.sqlAge('l', groupe)} ORDER BY un.nom, l.code LIMIT 200`, [e.id, typeId])).rows;
  const { RESTREINTES } = require('./nettoyage-securise');
  const statutLit = (l) => {
    if (l.precautions.some((p) => RESTREINTES.includes(p))) return { compatibilite: 'indisponible', justification: 'acces_restreint' };
    const manque = prescrites.filter((p) => !l.precautions.includes(p));
    if (l.precautions.length || manque.length) return { compatibilite: 'a_verifier', justification: manque.length ? 'precautions_a_confirmer' : 'chambre_sous_precautions' };
    return { compatibilite: 'compatible', justification: null };
  };
  const classes = lus.map((l) => ({ ...l, ...statutLit(l) }));
  const lits = classes.filter((l) => l.compatibilite !== 'indisponible');
  const indisponibles = classes.filter((l) => l.compatibilite === 'indisponible');
  const urgence = (etab.modules || {}).urgence !== false;
  const civieres = urgence ? (await pool.query(`SELECT id, code, version, categorie FROM civieres WHERE etablissement_id = $1 AND actif AND etat = 'libre' ORDER BY categorie DESC, code LIMIT 100`, [e.id])).rows : [];
  return { services, type_id: typeId, service_souhaite_id: co.service_souhaite_id, lits, indisponibles, civieres, urgence_active: urgence, reference_exemple: etab.config.reference_exemple };
}

module.exports = { vue, emplacements, etabHopital, derniereConfirmation, OUVERTS };
