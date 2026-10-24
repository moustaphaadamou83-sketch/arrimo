/**
 * Patients fictifs et arrivées à l'urgence.
 * - Fiche d'identification minimale (prénom, nom, date de naissance, groupe d'âge calculé, référence interne générée),
 *   disponible seulement en démonstration et en recette : données fictives uniquement, jamais de vrai patient.
 * - Rapprochement prudent : un patient semblable (même nom et même date de naissance, ou même référence locale) est signalé ;
 *   aucune fusion automatique. La création d'un second dossier demande une confirmation explicite.
 * - Les noms ne sortent jamais de l'établissement : vues réseau, OG, notifications et journal n'utilisent que la référence.
 */
const { transaction, ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const { changerEtatCiviere, journaliser } = require('./regles');
const { environnement } = require('./environnement');
const { groupeAgeDepuisNaissance } = require('./terrain');

function exigerFictifs() {
  if (!['demo', 'recette'].includes(environnement()) && process.env.ARRIMO_PATIENTS_FICTIFS !== '1') {
    throw new ErreurHttp(403, 'patients_reserve_demo');
  }
}

const texte = (v, max = 80) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, max);

function lireIdentite(b) {
  const prenom = texte(b.prenom); const nom = texte(b.nom);
  const dn = String(b.date_naissance || '').slice(0, 10);
  const d = new Date(`${dn}T12:00:00Z`);
  if (!prenom || !nom || !/^\d{4}-\d{2}-\d{2}$/.test(dn) || Number.isNaN(d.getTime()) || d > new Date() || d.getUTCFullYear() < 1900) {
    throw new ErreurHttp(400, 'patient_identite_requise');
  }
  return { prenom, nom, date_naissance: dn, reference_locale: texte(b.reference_locale, 40) || null };
}

/** Patients semblables dans l'établissement (rapprochement d'identité, sans fusion). */
async function semblables(db, etabId, id) {
  const { rows } = await db.query(
    `SELECT id, reference, prenom, nom, date_naissance, parcours FROM patients
      WHERE etablissement_id = $1 AND ((lower(nom) = lower($2) AND date_naissance = $3)
         OR (lower(nom) = lower($2) AND lower(prenom) = lower($4))
         OR ($5::text IS NOT NULL AND reference_locale = $5))
      ORDER BY id LIMIT 5`, [etabId, id.nom, id.date_naissance, id.prenom, id.reference_locale]);
  return rows;
}

async function creerPatient(db, utilisateur, etabId, b, { arrivee = null, parcours = 'enregistre' } = {}) {
  exigerFictifs();
  exigerEtablissement(utilisateur, etabId);
  const id = lireIdentite(b);
  const doublons = await semblables(db, etabId, id);
  if (doublons.length && !b.confirmer_doublon) {
    throw new ErreurHttp(409, 'patient_doublon_possible', { ref: doublons.map((x) => x.reference).join(', ') });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO patients (etablissement_id, reference, prenom, nom, date_naissance, reference_locale, arrivee_le, parcours, cree_par)
       VALUES ($1, 'P-' || lpad(nextval('patient_seq')::text, 5, '0'), $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [etabId, id.prenom, id.nom, id.date_naissance, id.reference_locale, arrivee, parcours, utilisateur.id]);
    await journaliser(db, { etablissementId: etabId, utilisateurId: utilisateur.id, action: 'Patient fictif enregistré', detail: rows[0].reference });
    return presenter(rows[0]);
  } catch (e) {
    if (e.code === '23505') throw new ErreurHttp(409, 'patient_doublon_possible', { ref: id.reference_locale || '' });
    throw e;
  }
}

function presenter(p) {
  return { ...p, groupe_age: groupeAgeDepuisNaissance(p.date_naissance), nom_court: `${p.prenom} ${p.nom.slice(0, 1)}.` };
}

async function listePatients(pool, utilisateur, etabId, q) {
  exigerFictifs();
  exigerEtablissement(utilisateur, etabId);
  const filtre = texte(q, 40).toLowerCase();
  const { rows } = await pool.query(
    `SELECT p.*, cv.code AS civiere_code, l.code AS lit_code
       FROM patients p
       LEFT JOIN civieres cv ON cv.etablissement_id = p.etablissement_id AND cv.patient_ref = p.reference AND cv.etat = 'occupee'
       LEFT JOIN lits l ON l.etablissement_id = p.etablissement_id AND l.patient_ref = p.reference AND l.etat IN ('reserve', 'occupe')
      WHERE p.etablissement_id = $1 AND ($2 = '' OR lower(p.nom) LIKE $2 || '%' OR lower(p.prenom) LIKE $2 || '%' OR lower(p.reference) = $2)
      ORDER BY p.modifie_le DESC LIMIT 100`, [etabId, filtre]);
  return rows.map(presenter);
}

/**
 * Arrivée à l'urgence, mode manuel : patient existant ou nouveau, civière, heure d'arrivée ; demande de lit facultative.
 * Tout se fait dans une transaction : pas de patient sans civière ni de civière prise deux fois.
 */
async function enregistrerArrivee(pool, utilisateur, b) {
  exigerFictifs();
  const etabId = Number(b.etablissement_id);
  exigerEtablissement(utilisateur, etabId);
  const civiereId = Number(b.civiere_id);
  if (!Number.isInteger(civiereId)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'civiere_id' });
  const arrivee = b.arrivee_le ? new Date(b.arrivee_le) : new Date();
  if (Number.isNaN(arrivee.getTime()) || arrivee > new Date(Date.now() + 60000)) throw new ErreurHttp(400, 'date_invalide');
  const res = await transaction(pool, async (c) => {
    let patient;
    if (b.patient_id) {
      patient = (await c.query('SELECT * FROM patients WHERE id = $1 AND etablissement_id = $2 FOR UPDATE', [b.patient_id, etabId])).rows[0];
      if (!patient) throw new ErreurHttp(404, 'patient_introuvable');
    } else {
      patient = await creerPatient(c, utilisateur, etabId, b, { arrivee, parcours: 'urgence' });
    }
    const cv = (await c.query('SELECT id, etablissement_id, version FROM civieres WHERE id = $1', [civiereId])).rows[0];
    if (!cv || cv.etablissement_id !== etabId) throw new ErreurHttp(404, 'civiere_introuvable');
    const civiere = await changerEtatCiviere(c, pool, utilisateur.id, civiereId, 'occupee', {
      versionAttendue: b.version ?? cv.version, patientRef: patient.reference, arrivee, detail: `Arrivée à l’urgence : ${patient.reference}`,
    });
    await c.query(`UPDATE patients SET parcours = 'urgence', arrivee_le = $2, modifie_le = now() WHERE id = $1`, [patient.id, arrivee]);
    return { patient: presenter({ ...patient, parcours: 'urgence', arrivee_le: arrivee }), civiere };
  });
  // Demande de lit, si l'hospitalisation est décidée : même opération que depuis la fiche civière
  if (b.demande && b.demande.type_id) {
    res.demande = await require('./terrain').creerDemande(pool, utilisateur, {
      etablissement_id: etabId, civiere_id: civiereId, type_id: b.demande.type_id, priorite: b.demande.priorite, provenance: 'urgence', besoins: b.demande.besoins || {},
    });
  }
  return res;
}

/** Correction d'identité d'un patient fictif (personnel habilité), tracée au journal sans le nom. */
async function modifierPatient(pool, utilisateur, patientId, b) {
  exigerFictifs();
  return transaction(pool, async (c) => {
    const p = (await c.query('SELECT * FROM patients WHERE id = $1 FOR UPDATE', [patientId])).rows[0];
    if (!p) throw new ErreurHttp(404, 'patient_introuvable');
    exigerEtablissement(utilisateur, p.etablissement_id);
    const id = lireIdentite({ ...p, date_naissance: String(p.date_naissance instanceof Date ? p.date_naissance.toISOString() : p.date_naissance), ...b });
    const u = await c.query(`UPDATE patients SET prenom = $2, nom = $3, date_naissance = $4, reference_locale = $5, modifie_le = now() WHERE id = $1 RETURNING *`,
      [p.id, id.prenom, id.nom, id.date_naissance, id.reference_locale]);
    await journaliser(c, { etablissementId: p.etablissement_id, utilisateurId: utilisateur.id, action: 'Identité du patient corrigée', detail: p.reference });
    return presenter(u.rows[0]);
  });
}

module.exports = { creerPatient, listePatients, enregistrerArrivee, modifierPatient, semblables, exigerFictifs };
