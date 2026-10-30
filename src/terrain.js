/**
 * Fonctions qui répondent aux problèmes du terrain :
 * file d'admission, NSA, congés, nettoyage priorisé, niveaux d'alerte, indicateurs.
 */
const { transaction, ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const { changerEtat, journaliser } = require('./regles');
const s = require('./services');
const { tr, traducteurTypes, duree } = require('./langue');
const cv = require('./civieres');

const ORIENTATIONS = ['chsld', 'ri', 'readaptation', 'domicile', 'palliatif', 'autre'];
const CONGES = ['prevu', 'confirme', 'attente_transport', 'reporte'];
const sqlAge = (alias, g) => s.sqlAge(alias, g);
/** Groupe d'âge à partir de la date de naissance (fiche fictive) : moins de 28 jours néonatal, moins de 18 ans pédiatrique. */
function groupeAgeDepuisNaissance(naissance, maintenant = new Date()) {
  const n = new Date(naissance);
  const jours = (maintenant - n) / 86400000;
  if (jours < 28) return 'neonatal';
  const age = maintenant.getFullYear() - n.getFullYear() - ((maintenant.getMonth() < n.getMonth() || (maintenant.getMonth() === n.getMonth() && maintenant.getDate() < n.getDate())) ? 1 : 0);
  return age < 18 ? 'pediatrique' : 'adulte';
}

/** Modifie un attribut d'un lit occupé sans changer son état, sous verrou, avec journal. */
async function modifierLitOccupe(pool, utilisateur, litId, champs, action, detail, apres, client = null) {
  const executer = async (c) => {
    const r = await c.query(
      `SELECT l.*, e.module_actif FROM lits l JOIN etablissements e ON e.id = l.etablissement_id
        WHERE l.id = $1 FOR NO KEY UPDATE OF l`, [litId]);
    const lit = r.rows[0];
    if (!lit) throw new ErreurHttp(404, 'lit_introuvable');
    if (!lit.module_actif) throw new ErreurHttp(403, 'module_inactif_etab');
    if (lit.etat !== 'occupe') throw new ErreurHttp(409, 'lit_non_occupe', { code: lit.code });
    const cles = Object.keys(champs);
    const sets = cles.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const u = await c.query(`UPDATE lits SET ${sets} WHERE id = $1 RETURNING *`, [litId, ...cles.map((k) => champs[k])]);
    await journaliser(c, { litId, utilisateurId: utilisateur.id, action, detail });
    if (apres) await apres(c);
    return u.rows[0];
  };
  return client ? executer(client) : transaction(pool, executer);
}

async function designerNsa(pool, utilisateur, litId, orientation) {
  if (!ORIENTATIONS.includes(orientation)) throw new ErreurHttp(400, 'orientation_inconnue');
  return modifierLitOccupe(pool, utilisateur, litId,
    { nsa_depuis: new Date(), nsa_orientation: orientation }, 'Désignation NSA', `Orientation : ${orientation}`);
}
async function retirerNsa(pool, utilisateur, litId) {
  return modifierLitOccupe(pool, utilisateur, litId, { nsa_depuis: null, nsa_orientation: null }, 'Fin du statut NSA', null);
}
async function changerNsaOrientation(pool, utilisateur, litId, orientation) {
  if (!ORIENTATIONS.includes(orientation)) throw new ErreurHttp(400, 'orientation_inconnue');
  return modifierLitOccupe(pool, utilisateur, litId, { nsa_orientation: orientation }, 'Orientation NSA modifiée', orientation);
}
/**
 * Historique des congés : la ligne ouverte du lit suit son congé actuel (prévu, confirmé, reporté) ;
 * sans congé, elle est fermée comme « annulé ». Appelée dans la transaction qui modifie le lit.
 */
async function synchroniserConge(c, litId, utilisateurId, source = 'manuel') {
  const l = (await c.query('SELECT etablissement_id, patient_ref, sortie_prevue, conge_statut, etat FROM lits WHERE id = $1', [litId])).rows[0];
  const ouvert = (await c.query(`SELECT id FROM conges WHERE lit_id = $1 AND statut IN ('prevu', 'confirme', 'attente_transport', 'reporte') FOR UPDATE`, [litId])).rows[0];
  if (!l || l.etat !== 'occupe' || (!l.sortie_prevue && !l.conge_statut)) {
    if (ouvert) await c.query(`UPDATE conges SET statut = 'annule', maj_le = now(), maj_par = $2 WHERE id = $1`, [ouvert.id, utilisateurId || null]);
    return;
  }
  const statut = l.conge_statut || 'prevu';
  if (ouvert) {
    await c.query(`UPDATE conges SET statut = $2, sortie_prevue = $3, maj_le = now(), maj_par = $4, source = $5 WHERE id = $1`,
      [ouvert.id, statut, l.sortie_prevue, utilisateurId || null, source]);
  } else {
    await c.query(`INSERT INTO conges (lit_id, etablissement_id, patient_ref, sortie_prevue, statut, maj_par, source) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [litId, l.etablissement_id, l.patient_ref, l.sortie_prevue, statut, utilisateurId || null, source]);
  }
}

async function majConge(pool, utilisateur, litId, statut, date, client = null) {
  if (statut !== null && !CONGES.includes(statut)) throw new ErreurHttp(400, 'conge_statut_inconnu');
  const champs = { conge_statut: statut };
  if (date !== undefined) {
    const d = date ? new Date(date) : null;
    if (d && Number.isNaN(d.getTime())) throw new ErreurHttp(400, 'date_invalide');
    champs.sortie_prevue = d;
  }
  return modifierLitOccupe(pool, utilisateur, litId, champs, 'Congé mis à jour',
    `${statut || 'aucun'}${champs.sortie_prevue ? ` · ${champs.sortie_prevue.toISOString()}` : ''}`,
    (c) => synchroniserConge(c, litId, utilisateur.id), client);
}

/* ------------------------------------------------------------------ nettoyage */
async function debuterNettoyage(pool, utilisateur, litId) {
  return transaction(pool, async (c) => {
    const { rows } = await c.query(
      `UPDATE lits SET nettoyage_debut = now() WHERE id = $1 AND etat = 'nettoyage' AND nettoyage_debut IS NULL RETURNING *`, [litId]);
    if (!rows[0]) throw new ErreurHttp(409, 'nettoyage_impossible');
    await journaliser(c, { litId, utilisateurId: utilisateur.id, action: 'Nettoyage commencé' });
    return rows[0];
  });
}

/** Lits à nettoyer, du plus urgent au moins urgent : une unité avec des patients en attente passe en premier. */
async function fileNettoyage(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const { rows } = await pool.query(
    `SELECT l.id, l.code, l.version, l.etat_depuis, l.nettoyage_debut, l.isolement, u.nom AS unite, ch.numero AS chambre,
            t.nom AS type_nom, c.nettoyage_cible_min,
            (SELECT count(*)::int FROM demandes_admission d
              WHERE d.etablissement_id = l.etablissement_id AND d.type_id = l.type_id AND d.statut = 'attente') AS en_attente,
            (SELECT count(*)::int FROM lits l2
              WHERE l2.etablissement_id = l.etablissement_id AND l2.type_id = l.type_id AND l2.etat = 'libre') AS libres_unite,
            EXTRACT(EPOCH FROM (now() - l.etat_depuis)) / 60 AS age_min
       FROM lits l
       JOIN unites u ON u.id = l.unite_id JOIN chambres ch ON ch.id = l.chambre_id
       JOIN types_unite t ON t.id = l.type_id
       JOIN etablissements e ON e.id = l.etablissement_id JOIN config_pays c ON c.id = e.config_id
      WHERE l.etablissement_id = $1 AND l.etat = 'nettoyage'`, [etabId]);
  const L = utilisateur.langue;
  const nomType = await traducteurTypes(pool, L);
  for (const r of rows) {
    r.genre = 'lit';
    const manque = Math.max(0, r.en_attente - r.libres_unite);
    r.priorite_score = manque * 100 + Number(r.age_min);
    r.priorite = manque > 0 ? 'haute' : Number(r.age_min) > r.nettoyage_cible_min ? 'moyenne' : 'normale';
    r.raison = manque > 0 ? tr(L, 'net_attente', { n: r.en_attente, type: nomType(r.type_nom).toLowerCase() })
      : Number(r.age_min) > r.nettoyage_cible_min ? tr(L, 'net_long', { duree: duree(L, r.nettoyage_cible_min) }) : tr(L, 'net_ordre');
  }
  // Civières de l'urgence à nettoyer : une civière régulière passe en premier si des patients attendent en corridor
  const civ = await pool.query(
    `SELECT cv.id, cv.code, cv.categorie, cv.version, cv.etat_depuis, c.nettoyage_civiere_cible_min,
            EXTRACT(EPOCH FROM (now() - cv.etat_depuis)) / 60 AS age_min,
            (SELECT count(*)::int FROM civieres x WHERE x.etablissement_id = cv.etablissement_id AND x.etat = 'occupee' AND x.categorie = 'debordement') AS en_corridor
       FROM civieres cv JOIN etablissements e ON e.id = cv.etablissement_id JOIN config_pays c ON c.id = e.config_id
      WHERE cv.etablissement_id = $1 AND cv.etat = 'nettoyage'`, [etabId]);
  for (const r of civ.rows) {
    r.genre = 'civiere';
    const manque = r.categorie === 'reguliere' ? r.en_corridor : 0;
    const age = Number(r.age_min);
    r.priorite_score = manque * 100 + age;
    r.priorite = manque > 0 ? 'haute' : age > r.nettoyage_civiere_cible_min ? 'moyenne' : 'normale';
    r.raison = manque > 0 ? tr(L, 'net_civiere_corridor', { n: manque })
      : age > r.nettoyage_civiere_cible_min ? tr(L, 'net_long', { duree: duree(L, r.nettoyage_civiere_cible_min) }) : tr(L, 'net_ordre');
  }
  return [...rows, ...civ.rows].sort((a, b) => b.priorite_score - a.priorite_score);
}

/* ------------------------------------------------------------------ file d'admission */
/** État du parcours du patient fictif lié à une demande (s'il a une fiche). */
async function parcoursPatient(c, d, etat) {
  if (d.patient_id) await c.query('UPDATE patients SET parcours = $2, modifie_le = now() WHERE id = $1', [d.patient_id, etat]);
}

function besoinsDemande(d) {
  return { isolement: d.besoin_isolement, pression_negative: d.besoin_pression_negative,
    ventilation: d.besoin_ventilation, telemetrie: d.besoin_telemetrie };
}

async function creerDemande(pool, utilisateur, b, client = null) {
  const db = client || pool;
  const etabId = Number(b.etablissement_id);
  exigerEtablissement(utilisateur, etabId);
  const etab = await s.etablissement(db, etabId);
  s.exigerActif(etab);
  // Patient sur civière à l'urgence : la demande est liée à sa civière (la référence vient de la civière)
  const civiereId = b.civiere_id ? Number(b.civiere_id) : null;
  if (b.civiere_id && !Number.isInteger(civiereId)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'civiere_id' });
  const civiere = civiereId ? await cv.civierePourDemande(db, etabId, civiereId, String(b.patient_ref || '').trim() || null) : null;
  const ref = civiere ? civiere.patient_ref : String(b.patient_ref || '').trim();
  if (!new RegExp(etab.config.reference_regex).test(ref)) {
    throw new ErreurHttp(400, 'reference_invalide', { exemple: etab.config.reference_exemple });
  }
  const type = await db.query('SELECT id FROM types_unite WHERE id = $1 AND config_id = $2', [b.type_id, etab.config_id]);
  if (!type.rows[0]) throw new ErreurHttp(400, 'type_unite_inconnu');
  const be = s.lireBesoins(b.besoins || b);
  // Groupe d'âge : celui de la fiche du patient fictif s'il en a une, sinon celui indiqué, sinon celui du type d'unité
  const patient = (await db.query('SELECT id, date_naissance FROM patients WHERE etablissement_id = $1 AND reference = $2', [etabId, ref])).rows[0];
  const groupeAge = patient ? groupeAgeDepuisNaissance(patient.date_naissance) : await s.groupeAgeEffectif(db, type.rows[0].id, b.groupe_age);
  const active = await db.query(`SELECT id FROM demandes_admission WHERE etablissement_id = $1 AND patient_ref = $2 AND statut IN ('attente', 'assignee')`, [etabId, ref]);
  if (active.rows[0]) throw new ErreurHttp(409, 'patient_deja_demande', { ref, numero: active.rows[0].id });
  try {
    const { rows } = await db.query(
      `INSERT INTO demandes_admission (etablissement_id, provenance, type_id, patient_ref, priorite,
         besoin_isolement, besoin_pression_negative, besoin_ventilation, besoin_telemetrie, cree_par, civiere_id, groupe_age, patient_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [etabId, civiere ? 'urgence' : ['urgence', 'bloc', 'externe', 'autre'].includes(b.provenance) ? b.provenance : 'urgence', type.rows[0].id, ref,
        ['p1', 'p2', 'p3'].includes(b.priorite) ? b.priorite : 'p2',
        be.isolement, be.pression_negative, be.ventilation, be.telemetrie, utilisateur.id, civiereId, groupeAge, patient?.id || null]);
    if (patient) await db.query(`UPDATE patients SET parcours = 'attente_lit', modifie_le = now() WHERE id = $1`, [patient.id]);
    return rows[0];
  } catch (e) {
    if (e.code === '23505' && civiere) throw new ErreurHttp(409, 'civiere_deja_demande', { code: civiere.code });
    if (e.code === '23505') throw new ErreurHttp(409, 'patient_deja_demande', { ref });
    throw e;
  }
}

/** File d'admission avec, pour chaque demande, le meilleur lit libre de l'établissement qui respecte les besoins. */
async function fileAdmission(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const { rows } = await pool.query(
    `SELECT d.*, t.nom AS type_nom, l.code AS lit_code, c.attente_admission_max_min,
            EXTRACT(EPOCH FROM (now() - d.cree_le)) / 60 AS attente_min,
            cv.code AS civiere_code, cv.categorie AS civiere_categorie,
            EXTRACT(EPOCH FROM (now() - cv.arrivee_le)) / 3600 AS heures_civiere,
            CASE WHEN p.id IS NOT NULL THEN p.prenom || ' ' || left(p.nom, 1) || '.' END AS patient_nom_court,
            validateur.nom AS priorite_validateur_nom
       FROM demandes_admission d
       LEFT JOIN patients p ON p.etablissement_id = d.etablissement_id AND p.reference = d.patient_ref
       LEFT JOIN utilisateurs validateur ON validateur.id = d.priorite_validee_par
       JOIN types_unite t ON t.id = d.type_id
       JOIN etablissements e ON e.id = d.etablissement_id JOIN config_pays c ON c.id = e.config_id
       LEFT JOIN lits l ON l.id = d.lit_id
       LEFT JOIN civieres cv ON cv.id = d.civiere_id AND cv.etat = 'occupee'
      WHERE d.etablissement_id = $1 AND d.statut IN ('attente', 'assignee')
      ORDER BY d.priorite, d.cree_le`, [etabId]);
  for (const d of rows) {
    d.attente_min = Math.round(Number(d.attente_min));
    d.depasse = d.attente_min > d.attente_admission_max_min;
    d.heures_civiere = d.heures_civiere == null ? null : Math.floor(Number(d.heures_civiere));
    if (d.statut === 'attente') {
      const l = await pool.query(
        `SELECT l.id, l.code, l.version FROM lits l WHERE l.etablissement_id = $1 AND l.type_id = $2 AND l.etat = 'libre'${s.sqlBesoins(besoinsDemande(d))}${sqlAge('l', d.groupe_age)}
          ORDER BY l.isolement, l.pression_negative, l.ventilation, l.telemetrie, l.code LIMIT 1`, [etabId, d.type_id]);
      d.lit_suggere = l.rows[0] || null;
    }
  }
  const priorites = require('./priorites');
  const { referentiel } = await priorites.referentiel(pool, utilisateur, etabId);
  return priorites.organiserFile(rows, referentiel, utilisateur.langue);
}

async function lireDemande(c, utilisateur, id) {
  const r = await c.query('SELECT * FROM demandes_admission WHERE id = $1 FOR UPDATE', [id]);
  const d = r.rows[0];
  if (!d) throw new ErreurHttp(404, 'demande_introuvable');
  exigerEtablissement(utilisateur, d.etablissement_id);
  return d;
}

async function assignerLit(pool, utilisateur, demandeId, litId, version, client = null) {
  const executer = async (c) => {
    const d = await lireDemande(c, utilisateur, demandeId);
    if (d.statut !== 'attente') throw new ErreurHttp(409, 'demande_plus_en_attente');
    const ok = await c.query(`SELECT l.id FROM lits l WHERE l.id = $1 AND l.etablissement_id = $2 AND l.type_id = $3${s.sqlBesoins(besoinsDemande(d))}${sqlAge('l', d.groupe_age)}`,
      [litId, d.etablissement_id, d.type_id]);
    if (!ok.rows[0]) throw new ErreurHttp(400, 'lit_inadapte');
    const lit = await changerEtat(c, pool, utilisateur.id, litId, 'reserve',
      { versionAttendue: version, patientRef: d.patient_ref, detail: `Assigné à la demande d’admission n° ${d.id} (${d.provenance})` });
    const u = await c.query(`UPDATE demandes_admission SET statut = 'assignee', lit_id = $2, assignee_le = now() WHERE id = $1 RETURNING *`, [d.id, litId]);
    await parcoursPatient(c, d, 'lit_assigne');
    return { ...u.rows[0], lit_code: lit.code };
  };
  return client ? executer(client) : transaction(pool, executer);
}

/**
 * Admission dans un lit : une seule opération métier, quel que soit l'écran (Admissions ou Lits).
 * La demande passe à « admise », le lit à « occupé » et la civière du patient au nettoyage, dans la même transaction.
 * Un lit déjà occupé par le même patient (ancienne désynchronisation) est seulement rattaché : jamais « occupé → occupé ».
 */
async function finaliserAdmission(c, pool, utilisateur, d, version) {
  const avant = (await c.query('SELECT id, code, etat, patient_ref FROM lits WHERE id = $1', [d.lit_id])).rows[0];
  let lit;
  if (avant && avant.etat === 'occupe' && avant.patient_ref === d.patient_ref) {
    lit = avant;
    await journaliser(c, { litId: d.lit_id, utilisateurId: utilisateur.id, action: 'Admission synchronisée',
      detail: `Demande d’admission n° ${d.id} : lit déjà occupé par ${d.patient_ref}` });
  } else {
    lit = await changerEtat(c, pool, utilisateur.id, d.lit_id, 'occupe',
      { versionAttendue: version, detail: `Admission depuis ${d.provenance} (demande n° ${d.id})` });
  }
  // Le patient quitte sa civière : elle part au nettoyage
  await cv.libererPourDemande(c, pool, utilisateur.id, d, `Patient admis au lit ${lit.code}`);
  const u = await c.query(`UPDATE demandes_admission SET statut = 'admise', terminee_le = now() WHERE id = $1 RETURNING *`, [d.id]);
  await parcoursPatient(c, d, 'hospitalise');
  return { ...u.rows[0], lit_code: lit.code };
}

async function admettreDemande(pool, utilisateur, demandeId, client = null) {
  const executer = async (c) => {
    const d = await lireDemande(c, utilisateur, demandeId);
    // Idempotente : un second clic (ou un autre écran) ne refait rien
    if (d.statut === 'admise') return { ...d, deja_admise: true };
    if (d.statut === 'attente') throw new ErreurHttp(409, 'assigner_dabord');
    if (d.statut !== 'assignee') throw new ErreurHttp(409, 'demande_terminee');
    return finaliserAdmission(c, pool, utilisateur, d);
  };
  return client ? executer(client) : transaction(pool, executer);
}

/**
 * « Admettre » depuis la fiche Lit : même opération que depuis Admissions.
 * - lit assigné à une demande d'admission : la demande est finalisée (lit occupé, civière au nettoyage) ;
 * - lit réservé pour un transfert en cours : l'admission se fait par la réception du transfert ;
 * - réservation locale sans demande : le lit devient occupé.
 */
async function admettreDepuisLit(c, pool, utilisateur, litId, version) {
  const d = (await c.query(`SELECT * FROM demandes_admission WHERE lit_id = $1 AND statut = 'assignee' FOR UPDATE`, [litId])).rows[0];
  if (d) {
    exigerEtablissement(utilisateur, d.etablissement_id);
    const r = await finaliserAdmission(c, pool, utilisateur, d, version);
    return { ...(await c.query('SELECT * FROM lits WHERE id = $1', [litId])).rows[0], demande: r };
  }
  const lit = (await c.query('SELECT code, etat, patient_ref, transfert_id FROM lits WHERE id = $1', [litId])).rows[0];
  if (lit && lit.etat === 'occupe') throw new ErreurHttp(409, 'lit_deja_occupe', { code: lit.code });
  if (lit && lit.transfert_id) {
    const t = (await c.query('SELECT numero, statut FROM transferts WHERE id = $1', [lit.transfert_id])).rows[0];
    if (t && !['recu', 'refuse'].includes(t.statut)) throw new ErreurHttp(409, 'admission_par_transfert', { code: lit.code, numero: t.numero });
  }
  return changerEtat(c, pool, utilisateur.id, litId, 'occupe', { versionAttendue: version, detail: 'Admission locale' });
}

/**
 * Admission reçue d'une intégration (connecteur ADT) : la demande active du patient (assignée à ce lit, ou en attente)
 * est finalisée dans la même transaction, pour que la file d'admission reste exacte.
 */
async function synchroniserDemandeAdmise(c, pool, litId, ref, detail) {
  const lit = (await c.query('SELECT code, etablissement_id FROM lits WHERE id = $1', [litId])).rows[0];
  const d = (await c.query(`SELECT * FROM demandes_admission WHERE etablissement_id = $1 AND patient_ref = $2 AND statut IN ('attente', 'assignee')
    ORDER BY (lit_id = $3) DESC NULLS LAST, id LIMIT 1 FOR UPDATE`, [lit.etablissement_id, ref, litId])).rows[0];
  if (!d) return null;
  await cv.libererPourDemande(c, pool, null, d, detail || `Patient admis au lit ${lit.code}`);
  await c.query(`UPDATE demandes_admission SET statut = 'admise', lit_id = $2, terminee_le = now() WHERE id = $1`, [d.id, litId]);
  await parcoursPatient(c, d, 'hospitalise');
  return d.id;
}

/** Réservation annulée depuis la fiche Lit : la demande d'admission liée revient dans la file, sans perdre son ancienneté. */
async function annulerDepuisLit(c, pool, utilisateur, litId, version) {
  const d = (await c.query(`SELECT * FROM demandes_admission WHERE lit_id = $1 AND statut = 'assignee' FOR UPDATE`, [litId])).rows[0];
  const lit = await changerEtat(c, pool, utilisateur.id, litId, 'libre', {
    versionAttendue: version, detail: d ? `Réservation annulée : demande d’admission n° ${d.id} remise en attente` : 'Réservation annulée' });
  if (d) {
    await c.query(`UPDATE demandes_admission SET statut = 'attente', lit_id = NULL, assignee_le = NULL WHERE id = $1`, [d.id]);
    await parcoursPatient(c, d, 'attente_lit');
  }
  return lit;
}

/**
 * Réservation depuis la fiche Lit : si le patient a déjà une demande d'admission en attente, elle est assignée à ce lit
 * (mêmes contrôles que depuis Admissions) pour que la file et le lit restent cohérents.
 */
async function reserverDepuisLit(c, pool, utilisateur, litId, version, patientRef) {
  const ref = String(patientRef || '').trim();
  const lit = (await c.query('SELECT etablissement_id FROM lits WHERE id = $1', [litId])).rows[0];
  const d = lit && ref ? (await c.query(
    `SELECT * FROM demandes_admission WHERE etablissement_id = $1 AND patient_ref = $2 AND statut IN ('attente', 'assignee') ORDER BY id LIMIT 1 FOR UPDATE`,
    [lit.etablissement_id, ref])).rows[0] : null;
  if (!d) return changerEtat(c, pool, utilisateur.id, litId, 'reserve', { versionAttendue: version, patientRef: ref, detail: 'Réservation locale' });
  if (d.statut === 'assignee') throw new ErreurHttp(409, 'patient_deja_assigne', { ref, numero: d.id });
  const ok = await c.query(`SELECT l.id FROM lits l WHERE l.id = $1 AND l.type_id = $2${s.sqlBesoins(besoinsDemande(d))}${sqlAge('l', d.groupe_age)}`,
    [litId, d.type_id]);
  if (!ok.rows[0]) throw new ErreurHttp(409, 'lit_inadapte_demande', { ref });
  const r = await changerEtat(c, pool, utilisateur.id, litId, 'reserve',
    { versionAttendue: version, patientRef: ref, detail: `Assigné à la demande d’admission n° ${d.id} (${d.provenance})` });
  await c.query(`UPDATE demandes_admission SET statut = 'assignee', lit_id = $2, assignee_le = now() WHERE id = $1`, [d.id, litId]);
  await parcoursPatient(c, d, 'lit_assigne');
  return r;
}

async function annulerDemande(pool, utilisateur, demandeId) {
  return transaction(pool, async (c) => {
    const d = await lireDemande(c, utilisateur, demandeId);
    if (!['attente', 'assignee'].includes(d.statut)) throw new ErreurHttp(409, 'demande_terminee');
    if (d.statut === 'assignee') {
      await changerEtat(c, pool, utilisateur.id, d.lit_id, 'libre', { detail: `Demande d’admission n° ${d.id} annulée` });
    }
    const u = await c.query(`UPDATE demandes_admission SET statut = 'annulee', terminee_le = now() WHERE id = $1 RETURNING *`, [d.id]);
    await parcoursPatient(c, d, 'urgence');
    return u.rows[0];
  });
}

/** Pas de lit adapté ici : la demande devient un transfert vers un autre établissement, dans la même transaction. */
async function transfererDemande(pool, utilisateur, demandeId, b, client = null) {
  const executer = async (c) => {
    const d = await lireDemande(c, utilisateur, demandeId);
    if (d.statut !== 'attente') throw new ErreurHttp(409, 'demande_plus_en_attente');
    const tr = await s.creerTransfert(pool, utilisateur, {
      origine_id: d.etablissement_id, destination_id: b.destination_id, type_id: d.type_id,
      lit_id: b.lit_id, version: b.version, patient_ref: d.patient_ref, urgent: b.urgent === true,
      besoins: besoinsDemande(d), demande_admission_id: d.id, groupe_age: d.groupe_age,
    }, c);
    await c.query(`UPDATE demandes_admission SET statut = 'transferee', transfert_id = $2, terminee_le = now() WHERE id = $1`, [d.id, tr.id]);
    await parcoursPatient(c, d, 'transfere');
    return tr;
  };
  return client ? executer(client) : transaction(pool, executer);
}

/* ------------------------------------------------------------------ niveaux d'alerte */
async function niveauAlerte(db, etabId, langue = 'fr') {
  const { rows } = await db.query(
    `SELECT c.seuil_jaune, c.seuil_orange, c.seuil_rouge, c.attente_admission_max_min, c.protocoles, c.protocoles_en,
            c.seuil_civieres_jaune, c.seuil_civieres_orange, c.seuil_civieres_rouge,
            count(l.*) FILTER (WHERE l.etat <> 'indispo')::int AS dotes,
            count(l.*) FILTER (WHERE l.etat = 'libre')::int AS libres,
            count(l.*) FILTER (WHERE l.etat = 'indispo' AND l.motif_indispo = 'personnel')::int AS fermes_personnel,
            (SELECT count(*)::int FROM demandes_admission d WHERE d.etablissement_id = e.id AND d.statut = 'attente') AS en_attente,
            (SELECT count(*)::int FROM demandes_admission d WHERE d.etablissement_id = e.id AND d.statut = 'attente'
               AND d.cree_le < now() - make_interval(mins => c.attente_admission_max_min)) AS attente_longue
       FROM etablissements e JOIN config_pays c ON c.id = e.config_id
       LEFT JOIN lits l ON l.etablissement_id = e.id
      WHERE e.id = $1 GROUP BY e.id, c.id`, [etabId]);
  const r = rows[0];
  if (!r) return null;
  // La pression réelle compte les patients qui attendent un lit, pas seulement les lits occupés
  const pression = r.dotes ? Math.round(((r.dotes - r.libres + r.en_attente) / r.dotes) * 100) : 0;
  let niveauLits = 'vert';
  if (pression >= r.seuil_rouge || r.attente_longue >= 3) niveauLits = 'rouge';
  else if (pression >= r.seuil_orange || r.attente_longue >= 1) niveauLits = 'orange';
  else if (pression >= r.seuil_jaune) niveauLits = 'jaune';
  // L'urgence compte aussi : une urgence débordée (civières) relève le niveau de l'établissement
  const urgence = (await cv.statsUrgence(db, [etabId])).get(etabId) || null;
  if (urgence) urgence.niveau = cv.niveauCivieres(urgence, r);
  const niveau = cv.pireNiveau(niveauLits, urgence?.niveau || 'vert');
  return { niveau, niveau_lits: niveauLits, pression, dotes: r.dotes, libres: r.libres, en_attente: r.en_attente,
    attente_longue: r.attente_longue, fermes_personnel: r.fermes_personnel, urgence,
    protocole: (langue === 'en' && r.protocoles_en?.[niveau]) || r.protocoles[niveau] };
}

/* ------------------------------------------------------------------ NSA */
async function listeNsa(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const lits = await pool.query(
    `SELECT l.id, l.code, l.patient_ref, l.nsa_depuis, l.nsa_orientation, u.nom AS unite,
            EXTRACT(EPOCH FROM (now() - l.nsa_depuis)) / 86400 AS jours
       FROM lits l JOIN unites u ON u.id = l.unite_id
      WHERE l.etablissement_id = $1 AND l.nsa_depuis IS NOT NULL ORDER BY l.nsa_depuis`, [etabId]);
  const tot = await pool.query(
    `SELECT count(*) FILTER (WHERE l.etat = 'occupe')::int AS occupes, c.cible_nsa_pct
       FROM lits l JOIN etablissements e ON e.id = l.etablissement_id JOIN config_pays c ON c.id = e.config_id
      WHERE l.etablissement_id = $1 GROUP BY c.cible_nsa_pct`, [etabId]);
  const occupes = tot.rows[0]?.occupes || 0;
  const n = lits.rows.length;
  const parOrientation = {};
  for (const l of lits.rows) {
    l.jours = Math.floor(Number(l.jours));
    parOrientation[l.nsa_orientation] = (parOrientation[l.nsa_orientation] || 0) + 1;
  }
  return {
    lits: lits.rows, total: n, occupes, taux: occupes ? Math.round((n / occupes) * 1000) / 10 : 0,
    cible: tot.rows[0]?.cible_nsa_pct ?? 8, par_orientation: parOrientation,
    jours_lits: lits.rows.reduce((a, l) => a + l.jours, 0),
  };
}

/** Détail d'un lit ALC/NSA : informations du lit et événements du journal du séjour en cours (depuis l'occupation et le début NSA, 20 au plus). */
async function detailNsa(pool, utilisateur, litId) {
  const l = (await pool.query(
    `SELECT l.id, l.code, l.patient_ref, l.nsa_depuis, l.nsa_orientation, l.etablissement_id, l.etat, u.nom AS unite,
            floor(EXTRACT(EPOCH FROM (now() - l.nsa_depuis)) / 86400)::int AS jours
       FROM lits l JOIN unites u ON u.id = l.unite_id WHERE l.id = $1 AND l.nsa_depuis IS NOT NULL`, [litId])).rows[0];
  if (!l) throw new ErreurHttp(404, 'lit_introuvable');
  exigerEtablissement(utilisateur, l.etablissement_id);
  const evenements = (await pool.query(
    `SELECT j.date, j.action, j.ancien_etat, j.nouvel_etat, j.detail, j.refuse, u.nom AS utilisateur
       FROM journal j LEFT JOIN utilisateurs u ON u.id = j.utilisateur_id
      WHERE j.lit_id = $1 AND j.date >= GREATEST($2::timestamptz,
            COALESCE((SELECT max(o.date) FROM journal o WHERE o.lit_id = $1 AND o.nouvel_etat = 'occupe'), $2::timestamptz))
      ORDER BY j.date DESC, j.id DESC LIMIT 20`, [l.id, l.nsa_depuis])).rows;
  return { ...l, evenements };
}

/* ------------------------------------------------------------------ indicateurs */
/** Mesures de fluidité sur une fenêtre de temps : de `debut` jours avant maintenant à `fin` jours avant maintenant. */
async function mesuresPeriode(pool, etabId, debut, fin) {
  const fenetre = (col) => `${col} > now() - make_interval(days => $2) AND ${col} <= now() - make_interval(days => $3)`;
  const tr = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE origine_id = $1)::int AS sortants,
            count(*) FILTER (WHERE destination_id = $1)::int AS entrants,
            count(*) FILTER (WHERE statut = 'refuse')::int AS refuses,
            count(*) FILTER (WHERE statut = 'demande')::int AS attentes,
            count(*) FILTER (WHERE x.demande_admission_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM transferts ancien WHERE ancien.demande_admission_id = x.demande_admission_id
                AND ancien.statut = 'refuse' AND ancien.id < x.id))::int AS reorientations,
            round(avg(EXTRACT(EPOCH FROM (date_validation - date_demande)) / 60) FILTER (WHERE date_validation IS NOT NULL))::int AS delai_validation_min,
            round(avg(EXTRACT(EPOCH FROM (date_reception - date_demande)) / 60) FILTER (WHERE date_reception IS NOT NULL))::int AS delai_total_min,
            COALESCE(jsonb_object_agg(motif_refus_code, n) FILTER (WHERE motif_refus_code IS NOT NULL), '{}') AS refus_par_motif
       FROM (SELECT t.*, count(*) OVER (PARTITION BY motif_refus_code) AS n FROM transferts t
              WHERE (origine_id = $1 OR destination_id = $1) AND ${fenetre('date_demande')}) x`, [etabId, debut, fin]);
  const adm = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE statut = 'attente')::int AS en_attente,
            round(avg(EXTRACT(EPOCH FROM (assignee_le - cree_le)) / 60) FILTER (WHERE assignee_le IS NOT NULL))::int AS delai_assignation_min,
            count(*) FILTER (WHERE statut = 'transferee')::int AS transferees
       FROM demandes_admission WHERE etablissement_id = $1 AND ${fenetre('cree_le')}`, [etabId, debut, fin]);
  const net = await pool.query(
    `WITH ev AS (
       SELECT lit_id, date, nouvel_etat, ancien_etat,
              lag(date) OVER (PARTITION BY lit_id ORDER BY date, id) AS date_prec,
              lag(nouvel_etat) OVER (PARTITION BY lit_id ORDER BY date, id) AS etat_prec
         FROM journal WHERE etablissement_id = $1 AND action = 'Changement d’état'
          AND date > now() - make_interval(days => $2) - interval '1 day' AND date <= now() - make_interval(days => $3))
     SELECT round(avg(EXTRACT(EPOCH FROM (date - date_prec)) / 60))::int AS duree_moy_min, count(*)::int AS nettoyages
       FROM ev WHERE ancien_etat = 'nettoyage' AND nouvel_etat = 'libre' AND etat_prec = 'nettoyage'
        AND date > now() - make_interval(days => $2)`, [etabId, debut, fin]);
  const confirmations = await pool.query(
    `SELECT count(*)::int AS confirmations FROM journal WHERE etablissement_id = $1 AND action = 'Disponibilité confirmée'
       AND date > now() - make_interval(days => $2) AND date <= now() - make_interval(days => $3)`, [etabId, debut, fin]);
  const t = tr.rows[0];
  return {
    transferts: { ...t, confirmations: confirmations.rows[0].confirmations,
      taux_refus: t.total ? Math.round((t.refuses / t.total) * 1000) / 10 : 0 },
    admissions: adm.rows[0],
    nettoyage: net.rows[0],
    civieres: await cv.dureePeriode(pool, etabId, debut, fin),
  };
}

/**
 * Indicateurs de l'établissement : capacité maintenant, fluidité sur la période et sur la période précédente
 * (même durée, juste avant), pour afficher la tendance ; cibles issues de la configuration du pays.
 */
async function indicateurs(pool, utilisateur, etabId, jours = 30) {
  exigerEtablissement(utilisateur, etabId);
  const j = Math.min(Math.max(Number(jours) || 30, 1), 365);
  const [actuelle, precedente] = [await mesuresPeriode(pool, etabId, j, 0), await mesuresPeriode(pool, etabId, 2 * j, j)];
  const cap = await pool.query(
    `SELECT count(*) FILTER (WHERE etat <> 'indispo')::int AS dotes,
            count(*) FILTER (WHERE etat = 'libre')::int AS libres,
            count(*) FILTER (WHERE etat = 'libre' AND disponibilite_confirmee_le >= now() - make_interval(mins => cfg.confirmation_lit_validite_min))::int AS libres_confirmes,
            count(*) FILTER (WHERE etat = 'libre' AND disponibilite_confirmee_le IS NULL)::int AS libres_non_confirmes,
            count(*) FILTER (WHERE etat = 'libre' AND disponibilite_confirmee_le < now() - make_interval(mins => cfg.confirmation_lit_validite_min))::int AS libres_perimes,
            count(*) FILTER (WHERE etat = 'occupe')::int AS occupes,
            count(*) FILTER (WHERE etat = 'reserve')::int AS reserves,
            count(*) FILTER (WHERE etat = 'nettoyage')::int AS nettoyage,
            count(*) FILTER (WHERE etat = 'indispo')::int AS indispo,
            COALESCE(jsonb_object_agg(motif_indispo, n) FILTER (WHERE motif_indispo IS NOT NULL), '{}') AS indispo_par_motif
       FROM (SELECT l.*, count(*) OVER (PARTITION BY motif_indispo) AS n FROM lits l WHERE etablissement_id = $1) x
       CROSS JOIN etablissements e JOIN config_pays cfg ON cfg.id = e.config_id WHERE e.id = $1`, [etabId]);
  const cfg = (await pool.query(
    `SELECT c.seuil_jaune, c.seuil_orange, c.seuil_rouge, c.attente_admission_max_min, c.nettoyage_cible_min, c.cible_nsa_pct,
            c.seuil_civieres_jaune, c.seuil_civieres_orange, c.seuil_civieres_rouge
       FROM etablissements e JOIN config_pays c ON c.id = e.config_id WHERE e.id = $1`, [etabId])).rows[0];
  const nsa = await listeNsa(pool, utilisateur, etabId);
  const alerte = await niveauAlerte(pool, etabId, utilisateur.langue);
  const urgence = alerte.urgence ? { ...alerte.urgence, periode: actuelle.civieres } : null;
  const c = cap.rows[0];
  // Lecture seule, pour les graphiques : disponibilité actuelle par unité et transferts par jour sur la période.
  const parUnite = (await pool.query(
    `SELECT u.nom AS unite, count(*) FILTER (WHERE l.etat <> 'indispo')::int AS dotes,
            count(*) FILTER (WHERE l.etat = 'libre')::int AS libres, count(*) FILTER (WHERE l.etat = 'occupe')::int AS occupes
       FROM lits l JOIN unites u ON u.id = l.unite_id WHERE l.etablissement_id = $1 AND l.actif
      GROUP BY u.nom ORDER BY u.nom`, [etabId])).rows;
  const parJour = (await pool.query(
    `SELECT to_char(d, 'YYYY-MM-DD') AS jour, count(t.id)::int AS total, count(t.id) FILTER (WHERE t.statut = 'refuse')::int AS refuses
       FROM generate_series(date_trunc('day', now()) - make_interval(days => $2 - 1), date_trunc('day', now()), interval '1 day') d
       LEFT JOIN transferts t ON (t.origine_id = $1 OR t.destination_id = $1) AND date_trunc('day', t.date_demande) = d
      GROUP BY d ORDER BY d`, [etabId, j])).rows;
  return {
    periode_jours: j,
    par_unite: parUnite,
    transferts_par_jour: parJour,
    capacite: { ...c,
      occupation_patients: c.dotes ? Math.round(c.occupes / c.dotes * 1000) / 10 : 0,
      non_disponibilite: c.dotes ? Math.round((c.occupes + c.reserves + c.nettoyage) / c.dotes * 1000) / 10 : 0,
      occupation: c.dotes ? Math.round(((c.dotes - c.libres) / c.dotes) * 1000) / 10 : 0 },
    transferts: actuelle.transferts,
    admissions: actuelle.admissions,
    nettoyage: actuelle.nettoyage,
    nsa: { total: nsa.total, taux: nsa.taux, cible: nsa.cible, jours_lits: nsa.jours_lits, par_orientation: nsa.par_orientation },
    urgence,
    alerte,
    // Période précédente, de même durée : pour la tendance (↑ ↓)
    precedent: {
      delai_assignation_min: precedente.admissions.delai_assignation_min,
      delai_validation_min: precedente.transferts.delai_validation_min,
      delai_total_min: precedente.transferts.delai_total_min,
      taux_refus: precedente.transferts.total ? precedente.transferts.taux_refus : null,
      nettoyage_min: precedente.nettoyage.duree_moy_min,
      civiere_h: precedente.civieres.duree_moy_h,
    },
    cibles: cfg,
  };
}

function indicateursCsv(ind) {
  const lignes = [['Indicateur', 'Valeur']];
  const plat = (o, prefixe = '') => Object.entries(o).forEach(([k, v]) => {
    if (v && typeof v === 'object') plat(v, `${prefixe}${k}.`);
    else lignes.push([`${prefixe}${k}`, v ?? '']);
  });
  plat(ind);
  // Une cellule qui commence par = + - @ (hors nombre) serait évaluée comme une formule par le tableur : préfixée d'une apostrophe.
  const cellule = (x) => { const v = String(x); return /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v; };
  return lignes.map((l) => l.map((x) => `"${cellule(x).replace(/"/g, '""')}"`).join(';')).join('\n');
}

module.exports = {
  designerNsa, retirerNsa, changerNsaOrientation, majConge, debuterNettoyage, fileNettoyage,
  creerDemande, fileAdmission, assignerLit, admettreDemande, annulerDemande, transfererDemande,
  admettreDepuisLit, annulerDepuisLit, reserverDepuisLit, synchroniserConge, synchroniserDemandeAdmise,
  niveauAlerte, listeNsa, detailNsa, indicateurs, indicateursCsv, besoinsDemande, ORIENTATIONS, groupeAgeDepuisNaissance,
};
