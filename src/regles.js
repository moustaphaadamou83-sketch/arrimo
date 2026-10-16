/**
 * Règles du lit et de la civière. C'est le seul endroit qui change l'état d'un lit ou d'une civière.
 * - Un lit ne peut être pris qu'une fois : verrou de ligne + numéro de version.
 * - Cycle : libre → réservé → occupé → nettoyage → libre (indisponible depuis/vers libre).
 * - Chaque changement est journalisé ; les refus aussi, dans une transaction séparée.
 */
const { ErreurHttp } = require('./db');

const ETATS = { libre: 'Libre', reserve: 'Réservé', occupe: 'Occupé', nettoyage: 'Nettoyage', indispo: 'Indisponible' };
const TRANSITIONS = {
  libre: ['reserve', 'indispo'],
  reserve: ['occupe', 'libre'],
  occupe: ['nettoyage'],
  nettoyage: ['libre'],
  indispo: ['libre'],
};
const ACTIONS_LIT = {
  reserver: 'reserve',
  admettre: 'occupe',
  annuler: 'libre',
  liberer: 'nettoyage',
  nettoyage_ok: 'libre',
  hors_service: 'indispo',
  remettre: 'libre',
};
const DETAIL_ACTION = {
  annuler: 'Réservation annulée',
  liberer: 'Départ du patient',
  nettoyage_ok: 'Nettoyage confirmé',
  remettre: 'Remis en service',
};

async function journaliser(client, v) {
  await client.query(
    `INSERT INTO journal (lit_id, etablissement_id, utilisateur_id, action, ancien_etat, nouvel_etat, detail, refuse, transfert_id, civiere_id)
     VALUES ($1, COALESCE($2, (SELECT etablissement_id FROM lits WHERE id = $1), (SELECT etablissement_id FROM civieres WHERE id = $10)),
             $3, $4, $5, $6, $7, $8, $9, $10)`,
    [v.litId || null, v.etablissementId || null, v.utilisateurId || null, v.action,
      v.ancien || null, v.nouveau || null, v.detail || null, !!v.refuse, v.transfertId || null, v.civiereId || null]);
}

/** Écrit un refus hors de la transaction en cours, pour qu'il survive à l'annulation. */
async function journaliserRefus(pool, v) {
  try {
    await journaliser(pool, { ...v, action: 'Action refusée', refuse: true });
  } catch (err) {
    console.error('Journal des refus indisponible :', err.message);
  }
}

/**
 * Change l'état d'un lit dans la transaction `client`.
 * opts : versionAttendue, patientRef, detail, transfertId, depuisTransfert
 */
async function changerEtat(client, pool, utilisateurId, litId, nouveau, opts = {}) {
  if (!ETATS[nouveau]) throw new ErreurHttp(400, 'etat_inconnu');
  let lit;
  await client.query('SAVEPOINT verrou_lit');
  try {
    const r = await client.query(
      `SELECT l.*, e.module_actif, e.nom AS etab_nom, c.reference_regex, c.reference_exemple
         FROM lits l
         JOIN etablissements e ON e.id = l.etablissement_id
         JOIN config_pays c ON c.id = e.config_id
        WHERE l.id = $1
          FOR NO KEY UPDATE OF l NOWAIT`, [litId]);
    lit = r.rows[0];
    await client.query('RELEASE SAVEPOINT verrou_lit');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT verrou_lit').catch(() => {});
    if (err.code === '55P03') {
      const e = new ErreurHttp(409, 'lit_verrouille');
      e.apresAnnulation = (p) => journaliserRefus(p, { litId, utilisateurId, detail: 'Lit en cours de modification par un autre utilisateur' });
      throw e;
    }
    throw err;
  }
  if (!lit) throw new ErreurHttp(404, 'lit_introuvable');
  if (!lit.module_actif) {
    throw new ErreurHttp(403, 'module_inactif', { etab: lit.etab_nom });
  }

  // Le refus est journalisé par transaction() une fois la transaction annulée et sa connexion rendue
  const refuser = async (statut, detail, code, vars) => {
    const e = new ErreurHttp(statut, code, vars);
    e.apresAnnulation = (p) => journaliserRefus(p, { litId, utilisateurId, detail, transfertId: opts.transfertId });
    throw e;
  };

  if (opts.versionAttendue != null && Number(opts.versionAttendue) !== lit.version) {
    await refuser(409, `Version ${opts.versionAttendue} attendue, version ${lit.version} trouvée : lit déjà modifié`,
      'lit_deja_modifie', { code: lit.code });
  }
  if (!TRANSITIONS[lit.etat].includes(nouveau)) {
    await refuser(409, `Transition interdite : ${ETATS[lit.etat]} → ${ETATS[nouveau]}`,
      'transition_interdite', { code: lit.code, de_etat: lit.etat, vers_etat: nouveau });
  }
  if (lit.etat === 'reserve' && nouveau === 'libre' && lit.transfert_id && !opts.depuisTransfert) {
    const t = await client.query(`SELECT numero, statut FROM transferts WHERE id = $1`, [lit.transfert_id]);
    if (t.rows[0] && !['recu', 'refuse'].includes(t.rows[0].statut)) {
      throw new ErreurHttp(409, 'lit_transfert_en_cours', { numero: t.rows[0].numero });
    }
  }
  const MOTIFS = ['personnel', 'equipement', 'travaux', 'infection', 'autre'];
  if (nouveau === 'indispo' && !MOTIFS.includes(opts.motif)) {
    throw new ErreurHttp(400, 'motif_requis');
  }
  let patientRef = null;
  if (nouveau === 'reserve') {
    patientRef = String(opts.patientRef || '').trim();
    if (!new RegExp(lit.reference_regex).test(patientRef)) {
      throw new ErreurHttp(400, 'reference_invalide', { exemple: lit.reference_exemple });
    }
  }

  const { rows } = await client.query(
    `UPDATE lits SET
        etat = $2::text,
        version = version + 1,
        etat_depuis = now(),
        blocage_niveau = NULL,
        blocage_motif = NULL,
        blocage_code = NULL,
        blocage_vars = NULL,
        patient_ref = CASE WHEN $2::text = 'reserve' THEN $3::text
                           WHEN $2::text IN ('libre', 'nettoyage', 'indispo') THEN NULL
                           ELSE patient_ref END,
        sortie_prevue = CASE WHEN $2::text IN ('libre', 'nettoyage', 'indispo') THEN NULL
                             WHEN $2::text = 'occupe' THEN COALESCE(sortie_prevue, $4::timestamptz)
                             ELSE sortie_prevue END,
        transfert_id = CASE WHEN $2::text IN ('libre', 'indispo') THEN NULL ELSE transfert_id END,
        motif_indispo = CASE WHEN $2::text = 'indispo' THEN $5::text ELSE NULL END,
        nsa_depuis = CASE WHEN $2::text = 'occupe' THEN nsa_depuis ELSE NULL END,
        nsa_orientation = CASE WHEN $2::text = 'occupe' THEN nsa_orientation ELSE NULL END,
        conge_statut = CASE WHEN $2::text = 'occupe' THEN conge_statut ELSE NULL END,
        nettoyage_debut = NULL
      WHERE id = $1
      RETURNING *`, [litId, nouveau, patientRef, opts.sortiePrevue || null, nouveau === 'indispo' ? opts.motif : null]);
  // Disponibilité à côté : les hôpitaux proches qui en ont besoin sont avisés (même transaction)
  if (nouveau === 'libre') await require('./alertes').litLibere(client, litId);

  await journaliser(client, {
    litId, utilisateurId, action: 'Changement d’état', ancien: lit.etat, nouveau,
    detail: opts.detail || (nouveau === 'reserve' ? `Référence ${patientRef}` : nouveau === 'indispo' ? `Motif : ${opts.motif}` : null),
    transfertId: opts.transfertId || lit.transfert_id,
  });
  return rows[0];
}

/* ------------------------------------------------------------------ civières de l'urgence
 * Même principe que les lits : verrou de ligne sans attente, numéro de version, transitions permises, journal, refus journalisés.
 * Cycle : libre → occupée → nettoyage → libre (indisponible depuis/vers libre).
 */
const ETATS_CIVIERE = { libre: 'Libre', occupee: 'Occupée', nettoyage: 'Nettoyage', indispo: 'Indisponible' };
const TRANSITIONS_CIVIERE = {
  libre: ['occupee', 'indispo'],
  occupee: ['nettoyage'],
  nettoyage: ['libre'],
  indispo: ['libre'],
};
const ACTIONS_CIVIERE = { placer: 'occupee', liberer: 'nettoyage', nettoyage_ok: 'libre', hors_service: 'indispo', remettre: 'libre' };
const DETAIL_CIVIERE = { liberer: 'Patient parti de la civière', nettoyage_ok: 'Civière nettoyée', remettre: 'Civière remise en service' };

/**
 * Change l'état d'une civière dans la transaction `client`.
 * opts : versionAttendue, patientRef, arrivee (date d'arrivée sur civière), motif, detail, transfertId
 */
async function changerEtatCiviere(client, pool, utilisateurId, civiereId, nouveau, opts = {}) {
  if (!ETATS_CIVIERE[nouveau]) throw new ErreurHttp(400, 'etat_inconnu');
  let cv;
  await client.query('SAVEPOINT verrou_civiere');
  try {
    const r = await client.query(
      `SELECT cv.*, e.module_actif, e.nom AS etab_nom, c.reference_regex, c.reference_exemple
         FROM civieres cv
         JOIN etablissements e ON e.id = cv.etablissement_id
         JOIN config_pays c ON c.id = e.config_id
        WHERE cv.id = $1
          FOR NO KEY UPDATE OF cv NOWAIT`, [civiereId]);
    cv = r.rows[0];
    await client.query('RELEASE SAVEPOINT verrou_civiere');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT verrou_civiere').catch(() => {});
    if (err.code === '55P03') {
      const e = new ErreurHttp(409, 'civiere_verrouillee');
      e.apresAnnulation = (p) => journaliserRefus(p, { civiereId, utilisateurId, detail: 'Civière en cours de modification par un autre utilisateur' });
      throw e;
    }
    throw err;
  }
  if (!cv) throw new ErreurHttp(404, 'civiere_introuvable');
  if (!cv.module_actif) throw new ErreurHttp(403, 'module_inactif', { etab: cv.etab_nom });
  const refuser = (statut, detail, code, vars) => {
    const e = new ErreurHttp(statut, code, vars);
    e.apresAnnulation = (p) => journaliserRefus(p, { civiereId, utilisateurId, detail });
    throw e;
  };
  if (opts.versionAttendue != null && Number(opts.versionAttendue) !== cv.version) {
    refuser(409, `Version ${opts.versionAttendue} attendue, version ${cv.version} trouvée : civière déjà modifiée`, 'civiere_deja_modifiee', { code: cv.code });
  }
  if (!TRANSITIONS_CIVIERE[cv.etat].includes(nouveau)) {
    refuser(409, `Transition interdite : ${ETATS_CIVIERE[cv.etat]} → ${ETATS_CIVIERE[nouveau]}`,
      'transition_interdite', { code: cv.code, de_etat: cv.etat, vers_etat: nouveau });
  }
  // Un patient qui attend encore un lit ne quitte pas sa civière sans que sa demande soit réglée
  if (cv.etat === 'occupee' && !opts.depuisDemande) {
    const d = await client.query(`SELECT id FROM demandes_admission WHERE civiere_id = $1 AND statut IN ('attente', 'assignee')`, [cv.id]);
    if (d.rows[0]) throw new ErreurHttp(409, 'civiere_demande_active', { code: cv.code });
  }
  const MOTIFS = ['personnel', 'equipement', 'travaux', 'infection', 'autre'];
  if (nouveau === 'indispo' && !MOTIFS.includes(opts.motif)) throw new ErreurHttp(400, 'motif_requis');
  let patientRef = null;
  if (nouveau === 'occupee') {
    patientRef = String(opts.patientRef || '').trim();
    if (!new RegExp(cv.reference_regex).test(patientRef)) {
      throw new ErreurHttp(400, 'reference_invalide', { exemple: cv.reference_exemple });
    }
    const deja = await client.query(`SELECT code FROM civieres WHERE etablissement_id = $1 AND patient_ref = $2 AND etat = 'occupee'`,
      [cv.etablissement_id, patientRef]);
    if (deja.rows[0]) throw new ErreurHttp(409, 'patient_deja_sur_civiere', { ref: patientRef, code: deja.rows[0].code });
  }
  const arrivee = opts.arrivee ? new Date(opts.arrivee) : new Date();
  if (Number.isNaN(arrivee.getTime()) || arrivee > new Date(Date.now() + 60000)) throw new ErreurHttp(400, 'date_invalide');
  const { rows } = await client.query(
    `UPDATE civieres SET etat = $2::text, version = version + 1, etat_depuis = now(),
            patient_ref = CASE WHEN $2::text = 'occupee' THEN $3::text ELSE NULL END,
            arrivee_le = CASE WHEN $2::text = 'occupee' THEN $4::timestamptz ELSE NULL END,
            motif_indispo = CASE WHEN $2::text = 'indispo' THEN $5::text ELSE NULL END
      WHERE id = $1 RETURNING *`,
    [cv.id, nouveau, patientRef, arrivee, nouveau === 'indispo' ? opts.motif : null]);
  if (nouveau === 'libre') await require('./alertes').civiereLiberee(client, cv.id);
  await journaliser(client, {
    civiereId: cv.id, etablissementId: cv.etablissement_id, utilisateurId, action: 'Civière', ancien: cv.etat, nouveau,
    detail: opts.detail || (nouveau === 'occupee' ? `Référence ${patientRef}` : nouveau === 'indispo' ? `Motif : ${opts.motif}` : null),
    transfertId: opts.transfertId,
  });
  return rows[0];
}

module.exports = {
  ETATS, TRANSITIONS, ACTIONS_LIT, DETAIL_ACTION, changerEtat, journaliser, journaliserRefus,
  ETATS_CIVIERE, TRANSITIONS_CIVIERE, ACTIONS_CIVIERE, DETAIL_CIVIERE, changerEtatCiviere,
};
