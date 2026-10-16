/**
 * Règles du lit. C'est le seul endroit qui change l'état d'un lit.
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
    `INSERT INTO journal (lit_id, etablissement_id, utilisateur_id, action, ancien_etat, nouvel_etat, detail, refuse, transfert_id)
     VALUES ($1, COALESCE($2, (SELECT etablissement_id FROM lits WHERE id = $1)), $3, $4, $5, $6, $7, $8, $9)`,
    [v.litId || null, v.etablissementId || null, v.utilisateurId || null, v.action,
      v.ancien || null, v.nouveau || null, v.detail || null, !!v.refuse, v.transfertId || null]);
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
  if (!ETATS[nouveau]) throw new ErreurHttp(400, 'État inconnu.');
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
      await journaliserRefus(pool, { litId, utilisateurId, detail: 'Lit en cours de modification par un autre utilisateur' });
      throw new ErreurHttp(409, 'Ce lit est en cours de modification par quelqu’un d’autre. Réessayez.');
    }
    throw err;
  }
  if (!lit) throw new ErreurHttp(404, 'Lit introuvable.');
  if (!lit.module_actif) {
    throw new ErreurHttp(403, `Le module n'est pas activé pour ${lit.etab_nom}. L'activation se fait depuis SH.`);
  }

  const refuser = async (statut, detail, message) => {
    await journaliserRefus(pool, { litId, utilisateurId, detail, transfertId: opts.transfertId });
    throw new ErreurHttp(statut, message);
  };

  if (opts.versionAttendue != null && Number(opts.versionAttendue) !== lit.version) {
    await refuser(409, `Version ${opts.versionAttendue} attendue, version ${lit.version} trouvée : lit déjà modifié`,
      `Le lit ${lit.code} vient d’être modifié par quelqu’un d’autre. Rafraîchissez et choisissez un autre lit.`);
  }
  if (!TRANSITIONS[lit.etat].includes(nouveau)) {
    await refuser(409, `Transition interdite : ${ETATS[lit.etat]} → ${ETATS[nouveau]}`,
      `Transition interdite pour ${lit.code} : ${ETATS[lit.etat]} → ${ETATS[nouveau]}.`);
  }
  if (lit.etat === 'reserve' && nouveau === 'libre' && lit.transfert_id && !opts.depuisTransfert) {
    const t = await client.query(`SELECT numero, statut FROM transferts WHERE id = $1`, [lit.transfert_id]);
    if (t.rows[0] && !['recu', 'refuse'].includes(t.rows[0].statut)) {
      throw new ErreurHttp(409, `Ce lit est lié au transfert ${t.rows[0].numero} en cours. Refusez le transfert pour le libérer.`);
    }
  }
  const MOTIFS = ['personnel', 'equipement', 'travaux', 'infection', 'autre'];
  if (nouveau === 'indispo' && !MOTIFS.includes(opts.motif)) {
    throw new ErreurHttp(400, 'Indiquez le motif : personnel, équipement, travaux, infection ou autre.');
  }
  let patientRef = null;
  if (nouveau === 'reserve') {
    patientRef = String(opts.patientRef || '').trim();
    if (!new RegExp(lit.reference_regex).test(patientRef)) {
      throw new ErreurHttp(400, `Référence patient invalide. Format attendu : ${lit.reference_exemple}. N'inscrivez aucune information médicale.`);
    }
  }

  const { rows } = await client.query(
    `UPDATE lits SET
        etat = $2::text,
        version = version + 1,
        etat_depuis = now(),
        blocage_niveau = NULL,
        blocage_motif = NULL,
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

  await journaliser(client, {
    litId, utilisateurId, action: 'Changement d’état', ancien: lit.etat, nouveau,
    detail: opts.detail || (nouveau === 'reserve' ? `Référence ${patientRef}` : nouveau === 'indispo' ? `Motif : ${opts.motif}` : null),
    transfertId: opts.transfertId || lit.transfert_id,
  });
  return rows[0];
}

module.exports = { ETATS, TRANSITIONS, ACTIONS_LIT, DETAIL_ACTION, changerEtat, journaliser, journaliserRefus };
