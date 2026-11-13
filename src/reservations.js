'use strict';
/**
 * Parcours final du préhospitalier (décisions de Moustafa, 13 nov. 2026) :
 * - Confirmation rapide de l'hôpital qui ne bloque JAMAIS un transport : « Accepté, on vous attend » ou « Réorienter » (motif court).
 *   Délai 60 s par défaut (ARRIMO_SECOURS_DELAI_REPONSE_S) ; sans réponse, la demande est considérée comme acceptée.
 *   Priorité immédiate : aucune attente, l'hôpital est seulement averti.
 * - Une fois acceptée (ou sans réponse, ou priorité immédiate), une civière libre est RÉSERVÉE : elle ne peut être donnée à
 *   aucun autre patient (refus dans src/regles.js) et n'est plus comptée comme libre. À l'arrivée, le patient y est installé
 *   (même moteur de règles), puis l'admission en lit suit la gestion des lits existante.
 * - Profil minimal (tranche d'âge, sexe, signes principaux) en listes fermées, démonstration seulement (décision du 6 nov. 2026) ;
 *   jamais de nom, jamais dans le journal ni les notifications.
 * Tout est horodaté et journalisé (délai de réponse, motif).
 */
const { transaction, ErreurHttp } = require('./db');
const { journaliser, changerEtatCiviere } = require('./regles');
const { estDemo } = require('./environnement');

const MOTIFS = ['delestage', 'scanner_indisponible', 'service_ferme', 'autre'];
const TRANCHES = ['0-17', '18-39', '40-64', '65-79', '80+'];
const SEXES = ['F', 'M', 'X'];
const SIGNES = ['douleur_thoracique', 'difficulte_respiratoire', 'deficit_neurologique', 'alteration_conscience', 'chute', 'traumatisme', 'saignement', 'fievre', 'douleur_abdominale', 'autre'];
const delai = () => { const n = Number(process.env.ARRIMO_SECOURS_DELAI_REPONSE_S ?? 60); return Number.isInteger(n) && n >= 0 && n <= 600 ? n : 60; };
const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const evenement = (c, paId, type, utilisateurId, detail = {}) => c.query('INSERT INTO prealerte_evenements (prealerte_id, type, detail, utilisateur_id) VALUES ($1, $2, $3, $4)',
  [paId, type, JSON.stringify(detail), utilisateurId || null]);

/** Profil minimal : validé en listes fermées ; refusé hors démonstration. */
function lireProfil(b) {
  if (b == null) return null;
  const p = { tranche_age: b.tranche_age || null, sexe: b.sexe || null, signes: Array.isArray(b.signes) ? [...new Set(b.signes.map(String))] : [] };
  if (!p.tranche_age && !p.sexe && !p.signes.length) return null;
  if (!estDemo()) throw new ErreurHttp(403, 'profil_reserve_demo');
  if ((p.tranche_age && !TRANCHES.includes(p.tranche_age)) || (p.sexe && !SEXES.includes(p.sexe)) || p.signes.some((s) => !SIGNES.includes(s)) || p.signes.length > 4) {
    throw new ErreurHttp(400, 'prealerte_invalide');
  }
  return p;
}

/** Réserve la première civière régulière libre et non réservée de l'hôpital ; sinon « sans civière » (le transport continue). */
async function reserver(c, pa, utilisateurId) {
  const deja = (await c.query('SELECT * FROM reservations_civieres WHERE prealerte_id = $1', [pa.id])).rows[0];
  if (deja && deja.statut === 'reservee') return deja;
  const cv = (await c.query(`SELECT cv.id, cv.code FROM civieres cv WHERE cv.etablissement_id = $1 AND cv.actif AND cv.etat = 'libre'
      AND NOT EXISTS (SELECT 1 FROM reservations_civieres r WHERE r.civiere_id = cv.id AND r.statut = 'reservee')
    ORDER BY (cv.categorie = 'debordement'), cv.code LIMIT 1 FOR UPDATE SKIP LOCKED`, [pa.destination_id])).rows[0];
  const r = (await c.query(`INSERT INTO reservations_civieres (prealerte_id, etablissement_id, civiere_id, statut) VALUES ($1, $2, $3, $4)
    ON CONFLICT (prealerte_id) DO UPDATE SET civiere_id = EXCLUDED.civiere_id, statut = EXCLUDED.statut, reservee_le = now(), liberee_le = NULL, version = reservations_civieres.version + 1
    RETURNING *`, [pa.id, pa.destination_id, cv ? cv.id : null, cv ? 'reservee' : 'sans_civiere'])).rows[0];
  await evenement(c, pa.id, cv ? 'civiere_reservee' : 'sans_civiere', utilisateurId, cv ? { civiere: cv.code } : {});
  await journaliser(c, { etablissementId: pa.destination_id, utilisateurId: utilisateurId || null, civiereId: cv ? cv.id : undefined,
    action: cv ? 'Civière réservée' : 'Aucune civière libre à réserver', detail: `${pa.numero}${cv ? ` · ${cv.code}` : ''}` });
  return r;
}

/** Libère la réservation (préalerte annulée, remplacée ou remise sans installation). */
async function liberer(c, paId, utilisateurId, raison) {
  const r = (await c.query(`UPDATE reservations_civieres SET statut = 'liberee', liberee_le = now(), version = version + 1
    WHERE prealerte_id = $1 AND statut IN ('reservee', 'sans_civiere') RETURNING *`, [paId])).rows[0];
  if (r) await evenement(c, paId, 'civiere_liberee', utilisateurId, { raison });
  return r;
}

/** Ouvre la confirmation à l'envoi d'une préalerte (ambulance ou CCS) ; priorité immédiate : averti et civière réservée sans attente. */
async function ouvrir(c, pa, u, profilBrut) {
  const profil = lireProfil(profilBrut);
  if (profil) await c.query('INSERT INTO prealerte_profils (prealerte_id, tranche_age, sexe, signes) VALUES ($1, $2, $3, $4)', [pa.id, profil.tranche_age, profil.sexe, profil.signes]);
  const immediate = pa.priorite === 'immediate';
  const d = immediate ? 0 : delai();
  await c.query(`INSERT INTO prealerte_confirmations (prealerte_id, statut, delai_s, echeance) VALUES ($1, $2, $3::int, now() + make_interval(secs => $3::int))`,
    [pa.id, immediate ? 'avertie' : 'en_attente', d]);
  if (immediate) await reserver(c, pa, null);
  require('./flux').signaler();
}

/** Réponse de l'hôpital en un clic. « Réorienter » n'arrête rien : l'équipage et les protocoles décident. */
async function repondre(pool, u, paId, b) {
  const pa0 = (await pool.query('SELECT * FROM prealertes WHERE id = $1', [entier(paId)])).rows[0];
  if (!pa0) throw new ErreurHttp(404, 'prealerte_introuvable');
  const pa = require('./prealertes');
  const cote = await pa.exigerVisibilite(pool, u, pa0, b.etablissement_id);
  if (cote !== 'hopital') throw new ErreurHttp(403, 'role_insuffisant');
  const reponse = String(b.reponse || '');
  if (!['accepter', 'reorienter'].includes(reponse)) throw new ErreurHttp(400, 'action_inconnue');
  if (reponse === 'reorienter' && !MOTIFS.includes(b.motif)) throw new ErreurHttp(400, 'motif_requis_reorientation');
  const r = await transaction(pool, async (c) => {
    const cf = (await c.query('SELECT * FROM prealerte_confirmations WHERE prealerte_id = $1 FOR UPDATE', [pa0.id])).rows[0];
    if (!cf || !['en_attente', 'sans_reponse', 'avertie'].includes(cf.statut)) throw new ErreurHttp(409, 'confirmation_close');
    if (reponse === 'accepter' && cf.statut !== 'en_attente') throw new ErreurHttp(409, 'confirmation_close');
    const n = (await c.query(`UPDATE prealerte_confirmations SET statut = $2, motif = $3, repondu_le = now(), repondu_par = $4,
        delai_reponse_s = GREATEST(0, round(EXTRACT(EPOCH FROM (now() - cree_le))))::int WHERE prealerte_id = $1 RETURNING *`,
    [pa0.id, reponse === 'accepter' ? 'acceptee' : 'reorientee', reponse === 'reorienter' ? b.motif : null, u.id])).rows[0];
    if (reponse === 'accepter') await reserver(c, pa0, u.id); else await liberer(c, pa0.id, u.id, 'reorientee');
    await evenement(c, pa0.id, reponse === 'accepter' ? 'acceptee_hopital' : 'reorientee_hopital', u.id, { delai_reponse_s: n.delai_reponse_s, ...(n.motif ? { motif: n.motif } : {}) });
    await journaliser(c, { etablissementId: pa0.destination_id, utilisateurId: u.id, action: reponse === 'accepter' ? 'Préalerte acceptée' : 'Préalerte réorientée',
      detail: `${pa0.numero} · ${n.delai_reponse_s} s${n.motif ? ` · ${n.motif}` : ''}` });
    return n;
  });
  require('./flux').signaler();
  return r;
}

/** Échéances : sans réponse dans le délai, la demande est considérée comme acceptée et la civière réservée. */
async function echeances(pool) {
  const dues = (await pool.query(`SELECT prealerte_id FROM prealerte_confirmations WHERE statut = 'en_attente' AND echeance <= now() LIMIT 50`)).rows;
  for (const { prealerte_id: id } of dues) {
    await transaction(pool, async (c) => {
      const cf = (await c.query("SELECT * FROM prealerte_confirmations WHERE prealerte_id = $1 AND statut = 'en_attente' FOR UPDATE SKIP LOCKED", [id])).rows[0];
      if (!cf) return;
      const p = (await c.query('SELECT * FROM prealertes WHERE id = $1', [id])).rows[0];
      await c.query("UPDATE prealerte_confirmations SET statut = 'sans_reponse', delai_reponse_s = delai_s WHERE prealerte_id = $1", [id]);
      await evenement(c, id, 'sans_reponse_poursuite', null, { delai_s: cf.delai_s });
      await journaliser(c, { etablissementId: p.destination_id, utilisateurId: null, action: 'Préalerte sans réponse : transport poursuivi', detail: `${p.numero} · ${cf.delai_s} s` });
      if (require('./prealertes').OUVERTES.includes(p.statut)) await reserver(c, p, null);
    }).catch((e) => console.error('Confirmation rapide :', e.code || e.message));
  }
  if (dues.length) require('./flux').signaler();
  return dues.length;
}

/** À l'arrivée confirmée : le patient est installé sur la civière réservée (référence patient du format du pays). */
async function installer(pool, u, paId, b) {
  const pa0 = (await pool.query('SELECT * FROM prealertes WHERE id = $1', [entier(paId)])).rows[0];
  if (!pa0) throw new ErreurHttp(404, 'prealerte_introuvable');
  const cote = await require('./prealertes').exigerVisibilite(pool, u, pa0, b.etablissement_id);
  if (cote !== 'hopital') throw new ErreurHttp(403, 'role_insuffisant');
  if (!['arrivee', 'cloturee'].includes(pa0.statut)) throw new ErreurHttp(409, 'prealerte_statut_incompatible');
  const r = await transaction(pool, async (c) => {
    const res = (await c.query("SELECT * FROM reservations_civieres WHERE prealerte_id = $1 AND statut = 'reservee' FOR UPDATE", [pa0.id])).rows[0];
    if (!res) throw new ErreurHttp(409, 'prealerte_statut_incompatible');
    const cv = await changerEtatCiviere(c, pool, u.id, res.civiere_id, 'occupee', { patientRef: b.patient_ref, reservationPrealerte: pa0.id, detail: `Arrivée ambulance ${pa0.numero}` });
    await c.query("UPDATE reservations_civieres SET statut = 'installee', installee_le = now(), version = version + 1 WHERE prealerte_id = $1", [pa0.id]);
    await evenement(c, pa0.id, 'patient_installe', u.id, { civiere: cv.code });
    return { civiere_id: cv.id, civiere: cv.code, patient_ref: cv.patient_ref };
  });
  require('./flux').signaler();
  return r;
}

/** Vue pour les écrans : confirmation, compte à rebours, civière réservée ; profil seulement pour l'hôpital. */
async function vue(db, ids, { hopital = false } = {}) {
  if (!ids.length) return new Map();
  const rows = (await db.query(`SELECT p.id, cf.statut, cf.delai_s, cf.echeance, cf.motif, cf.repondu_le, cf.delai_reponse_s,
      r.statut AS reservation, cv.code AS civiere, cv.id AS civiere_id, cv.etat AS civiere_etat, cv.categorie AS civiere_categorie,
      pp.tranche_age, pp.sexe, pp.signes
    FROM prealertes p LEFT JOIN prealerte_confirmations cf ON cf.prealerte_id = p.id LEFT JOIN reservations_civieres r ON r.prealerte_id = p.id
    LEFT JOIN civieres cv ON cv.id = r.civiere_id LEFT JOIN prealerte_profils pp ON pp.prealerte_id = p.id WHERE p.id = ANY($1)`, [ids])).rows;
  return new Map(rows.map((x) => [x.id, {
    confirmation: x.statut ? { statut: x.statut, delai_s: x.delai_s, echeance: x.echeance, motif: x.motif, repondu_le: x.repondu_le, delai_reponse_s: x.delai_reponse_s } : null,
    reservation: x.reservation ? { statut: x.reservation, civiere: x.civiere, civiere_id: x.civiere_id, civiere_etat: x.civiere_etat } : null,
    ...(hopital && (x.tranche_age || x.sexe || (x.signes || []).length) ? { profil: { tranche_age: x.tranche_age, sexe: x.sexe, signes: x.signes } } : {}),
  }]));
}

/** Autre urgence proposée par OG après une réorientation : depuis la dernière position de l'unité, sans l'hôpital qui réoriente. */
async function alternative(pool, u, paId) {
  const pa0 = (await pool.query('SELECT * FROM prealertes WHERE id = $1', [entier(paId)])).rows[0];
  if (!pa0) throw new ErreurHttp(404, 'prealerte_introuvable');
  const cote = await require('./prealertes').exigerVisibilite(pool, u, pa0);
  if (!['ambulance', 'ccs'].includes(cote)) throw new ErreurHttp(403, 'role_insuffisant');
  const r = await require('./vehicules').urgencesClassees(pool, u, { unite_id: pa0.unite_id });
  const autres = (r.urgences || []).filter((h) => h.id !== pa0.destination_id);
  const og = autres.find((h) => h.rang < 2) || null;
  return { ...r, urgences: autres, og: og ? { id: og.id, nom: og.nom, temps_min: og.temps_min, distance_km: og.distance_km, civieres_libres: og.urgence?.civieres_libres ?? null, services_ouverts: og.services_ouverts } : null };
}

module.exports = { ouvrir, repondre, echeances, installer, liberer, reserver, vue, alternative, MOTIFS, TRANCHES, SEXES, SIGNES, delai };
