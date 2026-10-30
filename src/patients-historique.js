'use strict';
/**
 * Historique administratif des patients fictifs (cahier « historique longitudinal », phase A ; démonstration et recette).
 * - Patient → passages (urgence, consultation, admission) → mouvements (lits, civières), demandes d'admission, transferts.
 * - Aucune donnée clinique ni texte libre : seulement des dates, des types, des résultats administratifs et des références.
 * - L'historique ne s'ouvre qu'après vérification explicite de l'identité ; chaque consultation est journalisée (référence seule).
 * - Arrimo ne montre que ce qu'il détient : aucune promesse de conservation au-delà des règles applicables.
 */
const { transaction, ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const { journaliser } = require('./regles');
const { exigerFictifs } = require('./patients');

const TYPES = ['urgence', 'consultation', 'admission'];
const RESULTATS_CLOTURE = ['sorti', 'hospitalise', 'transfere', 'annule'];

function lireDate(v, defaut) {
  if (v == null || v === '') return defaut;
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || d > new Date(Date.now() + 60000) || d.getUTCFullYear() < 1900) throw new ErreurHttp(400, 'date_invalide');
  return d;
}

async function patientDe(db, utilisateur, patientId, verrou = false) {
  const p = (await db.query(`SELECT * FROM patients WHERE id = $1${verrou ? ' FOR UPDATE' : ''}`, [patientId])).rows[0];
  if (!p) throw new ErreurHttp(404, 'patient_introuvable');
  exigerEtablissement(utilisateur, p.etablissement_id);
  return p;
}

/**
 * Ouvre un passage. Un passage encore ouvert du même patient est clos à l'heure d'arrivée du nouveau (résultat « sorti »
 * s'il était encore en cours) : un patient n'a jamais deux passages ouverts.
 */
async function ouvrirPassage(c, utilisateur, patient, type, arrivee) {
  if (!TYPES.includes(type)) throw new ErreurHttp(400, 'passage_type_invalide');
  const ouverts = (await c.query('SELECT id, arrivee_le FROM patient_passages WHERE patient_id = $1 AND sortie_le IS NULL FOR UPDATE', [patient.id])).rows;
  if (ouverts.some((o) => new Date(o.arrivee_le) > arrivee)) throw new ErreurHttp(409, 'passage_chevauchement');
  await c.query(`UPDATE patient_passages SET sortie_le = $2, resultat = CASE WHEN resultat = 'en_cours' THEN 'sorti' ELSE resultat END,
      cloture_par = $3, cloture_le = now() WHERE patient_id = $1 AND sortie_le IS NULL`, [patient.id, arrivee, utilisateur.id]);
  const { rows } = await c.query(
    `INSERT INTO patient_passages (patient_id, etablissement_id, reference, type, arrivee_le, cree_par)
     VALUES ($1, $2, 'V-' || lpad(nextval('passage_seq')::text, 6, '0'), $3, $4, $5) RETURNING *`,
    [patient.id, patient.etablissement_id, type, arrivee, utilisateur.id]);
  await journaliser(c, { etablissementId: patient.etablissement_id, utilisateurId: utilisateur.id, action: 'Passage ouvert', detail: `${patient.reference} · ${rows[0].reference} · ${type}` });
  return rows[0];
}

/** Nouveau passage d'un patient existant (consultation ou admission ; l'urgence passe par l'arrivée sur civière). */
async function creerPassage(pool, utilisateur, patientId, b) {
  exigerFictifs();
  const type = String(b.type || '');
  if (!['consultation', 'admission'].includes(type)) throw new ErreurHttp(400, 'passage_type_invalide');
  return transaction(pool, async (c) => {
    const p = await patientDe(c, utilisateur, patientId, true);
    return ouvrirPassage(c, utilisateur, p, type, lireDate(b.arrivee_le, new Date()));
  });
}

/** Clôture d'un passage : résultat administratif et heure de sortie, tracés. */
async function cloturerPassage(pool, utilisateur, passageId, b) {
  exigerFictifs();
  const resultat = String(b.resultat || '');
  if (!RESULTATS_CLOTURE.includes(resultat)) throw new ErreurHttp(400, 'passage_resultat_invalide');
  return transaction(pool, async (c) => {
    const v = (await c.query('SELECT * FROM patient_passages WHERE id = $1 FOR UPDATE', [passageId])).rows[0];
    if (!v) throw new ErreurHttp(404, 'passage_introuvable');
    exigerEtablissement(utilisateur, v.etablissement_id);
    if (v.sortie_le) throw new ErreurHttp(409, 'passage_deja_clos');
    const sortie = lireDate(b.sortie_le, new Date());
    if (sortie < new Date(v.arrivee_le)) throw new ErreurHttp(400, 'date_invalide');
    const { rows } = await c.query(`UPDATE patient_passages SET sortie_le = $2, resultat = $3, cloture_par = $4, cloture_le = now() WHERE id = $1 RETURNING *`,
      [v.id, sortie, resultat, utilisateur.id]);
    const p = (await c.query('SELECT reference FROM patients WHERE id = $1', [v.patient_id])).rows[0];
    await journaliser(c, { etablissementId: v.etablissement_id, utilisateurId: utilisateur.id, action: 'Passage clos', detail: `${p.reference} · ${v.reference} · ${resultat}` });
    return rows[0];
  });
}

/** Suit le parcours d'une demande d'admission : le passage ouvert reçoit le même résultat administratif (transfert = sortie). */
async function suivreParcours(c, patientId, etat) {
  const resultat = { hospitalise: 'hospitalise', transfere: 'transfere' }[etat];
  if (!resultat) return;
  await c.query(`UPDATE patient_passages SET resultat = $2, sortie_le = CASE WHEN $2 = 'transfere' THEN greatest(now(), arrivee_le) ELSE sortie_le END,
      cloture_le = CASE WHEN $2 = 'transfere' THEN now() ELSE cloture_le END
    WHERE patient_id = $1 AND sortie_le IS NULL`, [patientId, resultat]);
}

/**
 * Historique : passages et, pour chacun, les événements du journal, demandes d'admission et transferts survenus pendant le passage.
 * Les éléments hors passage (avant la création des passages) sont regroupés à part : rien n'est perdu ni inventé.
 */
async function historique(pool, utilisateur, patientId, { identiteVerifiee } = {}) {
  exigerFictifs();
  if (!identiteVerifiee) throw new ErreurHttp(428, 'patient_identite_a_verifier');
  const p = await patientDe(pool, utilisateur, patientId);
  const [passages, demandes, transferts, journal] = await Promise.all([
    pool.query(`SELECT v.id, v.reference, v.type, v.arrivee_le, v.sortie_le, v.resultat, e.nom AS etablissement, uc.nom AS cree_par, ul.nom AS cloture_par
      FROM patient_passages v JOIN etablissements e ON e.id = v.etablissement_id
      LEFT JOIN utilisateurs uc ON uc.id = v.cree_par LEFT JOIN utilisateurs ul ON ul.id = v.cloture_par
      WHERE v.patient_id = $1 ORDER BY v.arrivee_le DESC, v.id DESC`, [p.id]),
    pool.query(`SELECT d.id, d.statut, d.priorite, d.cree_le, t.nom AS type_unite FROM demandes_admission d LEFT JOIN types_unite t ON t.id = d.type_id
      WHERE d.etablissement_id = $1 AND (d.patient_id = $2 OR d.patient_ref = $3) ORDER BY d.cree_le DESC, d.id DESC LIMIT 100`, [p.etablissement_id, p.id, p.reference]),
    pool.query(`SELECT t.numero, t.statut, t.date_demande, t.date_reception, o.nom AS origine, d.nom AS destination
      FROM transferts t JOIN etablissements o ON o.id = t.origine_id JOIN etablissements d ON d.id = t.destination_id
      WHERE t.patient_ref = $1 AND (t.origine_id = $2 OR t.destination_id = $2) ORDER BY t.date_demande DESC LIMIT 100`, [p.reference, p.etablissement_id]),
    pool.query(`SELECT j.date, j.action, j.nouvel_etat, COALESCE(l.code, cv.code) AS emplacement, (j.civiere_id IS NOT NULL) AS civiere, u.nom AS unite
      FROM journal j LEFT JOIN lits l ON l.id = j.lit_id LEFT JOIN civieres cv ON cv.id = j.civiere_id LEFT JOIN unites u ON u.id = COALESCE(l.unite_id, cv.unite_id)
      WHERE j.etablissement_id = $1 AND j.detail ~ ('(^|[^A-Z0-9])' || $2 || '([^A-Z0-9]|$)')
        AND j.action NOT IN ('Historique patient consulté', 'Passage ouvert', 'Passage clos')
      ORDER BY j.date DESC, j.id DESC LIMIT 200`, [p.etablissement_id, p.reference]),
  ]);
  const dans = (date, v) => { const d = new Date(date); return d >= new Date(v.arrivee_le) && (!v.sortie_le || d <= new Date(v.sortie_le)); };
  const lien = (date) => passages.rows.find((v) => dans(date, v))?.id ?? null;
  await journaliser(pool, { etablissementId: p.etablissement_id, utilisateurId: utilisateur.id, action: 'Historique patient consulté', detail: p.reference });
  return {
    patient: { id: p.id, reference: p.reference, reference_locale: p.reference_locale, prenom: p.prenom, nom: p.nom,
      date_naissance: String(p.date_naissance instanceof Date ? p.date_naissance.toISOString() : p.date_naissance).slice(0, 10), parcours: p.parcours, cree_le: p.cree_le },
    passages: passages.rows,
    demandes: demandes.rows.map((d) => ({ ...d, passage_id: lien(d.cree_le) })),
    transferts: transferts.rows.map((t) => ({ ...t, passage_id: lien(t.date_demande) })),
    mouvements: journal.rows.map((m) => ({ ...m, passage_id: lien(m.date) })),
    conservation: 'arrimo_seulement',
  };
}

module.exports = { creerPassage, cloturerPassage, ouvrirPassage, suivreParcours, historique, TYPES };
