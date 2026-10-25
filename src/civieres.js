/**
 * Civières de l'urgence : liste, actions, changement de civière, statistiques par urgence.
 * Les changements d'état passent par regles.changerEtatCiviere (verrou, version, journal).
 *
 * Mesures (par urgence) :
 * - fonctionnelles : civières régulières en service (les civières de débordement n'en font pas partie) ;
 * - occupées : tous les patients sur civière, régulière ou de débordement ;
 * - taux d'occupation = occupées / fonctionnelles : dépasse 100 % dès que des patients sont en corridor ;
 * - patients sur civière depuis plus de 24 h et 48 h, durée moyenne sur civière (en cours, et sur une période à partir du journal).
 */
const { transaction, ErreurHttp } = require('./db');
const { exigerEtablissement, peutAgirPour } = require('./auth');
const { changerEtatCiviere, ACTIONS_CIVIERE, DETAIL_CIVIERE } = require('./regles');

const CATEGORIES = ['reguliere', 'debordement', 'isolement', 'pediatrique', 'fauteuil'];

/** Statistiques des civières, par établissement (Map id → stats). Un établissement sans civière n'apparaît pas. */
async function statsUrgence(db, etabIds) {
  const { rows } = await db.query(
    `SELECT etablissement_id,
            count(*)::int AS total,
            count(*) FILTER (WHERE categorie <> 'debordement' AND etat <> 'indispo')::int AS fonctionnelles,
            count(*) FILTER (WHERE categorie = 'debordement')::int AS debordement,
            count(*) FILTER (WHERE etat = 'occupee')::int AS occupees,
            count(*) FILTER (WHERE etat = 'occupee' AND categorie = 'debordement')::int AS en_corridor,
            count(*) FILTER (WHERE etat = 'libre' AND categorie <> 'debordement')::int AS libres,
            count(*) FILTER (WHERE etat = 'nettoyage')::int AS nettoyage,
            count(*) FILTER (WHERE etat = 'indispo')::int AS indispo,
            count(*) FILTER (WHERE etat = 'occupee' AND arrivee_le < now() - interval '24 hours')::int AS plus_24h,
            count(*) FILTER (WHERE etat = 'occupee' AND arrivee_le < now() - interval '48 hours')::int AS plus_48h,
            round((avg(EXTRACT(EPOCH FROM (now() - arrivee_le))) FILTER (WHERE etat = 'occupee') / 3600)::numeric, 1)::float AS duree_moy_h
       FROM civieres WHERE etablissement_id = ANY($1::int[]) GROUP BY etablissement_id`, [etabIds]);
  const res = new Map();
  for (const r of rows) {
    r.taux = r.fonctionnelles ? Math.round((r.occupees / r.fonctionnelles) * 100) : (r.occupees ? 999 : 0);
    res.set(r.etablissement_id, r);
  }
  return res;
}

/** Niveau d'alerte de l'urgence : taux d'occupation des civières et patients sur civière depuis plus de 48 h. */
function niveauCivieres(u, cfg) {
  if (!u || !u.total) return 'vert';
  if (u.taux >= cfg.seuil_civieres_rouge || u.plus_48h >= 3) return 'rouge';
  if (u.taux >= cfg.seuil_civieres_orange || u.plus_48h >= 1) return 'orange';
  if (u.taux >= cfg.seuil_civieres_jaune) return 'jaune';
  return 'vert';
}
const RANG = { vert: 0, jaune: 1, orange: 2, rouge: 3 };
const pireNiveau = (a, b) => (RANG[b] > RANG[a] ? b : a);

/** Durée moyenne sur civière des patients partis pendant la période (paires « occupée » → « nettoyage » du journal). */
async function dureePeriode(db, etabId, jours, fin = 0) {
  const { rows } = await db.query(
    `WITH ev AS (
       SELECT civiere_id, date, nouvel_etat, ancien_etat,
              lag(date) OVER (PARTITION BY civiere_id ORDER BY date, id) AS date_prec,
              lag(nouvel_etat) OVER (PARTITION BY civiere_id ORDER BY date, id) AS etat_prec
         FROM journal WHERE etablissement_id = $1 AND civiere_id IS NOT NULL AND NOT refuse
          AND date > now() - make_interval(days => $2) - interval '7 days' AND date <= now() - make_interval(days => $3))
     SELECT round((avg(EXTRACT(EPOCH FROM (date - date_prec))) / 3600)::numeric, 1)::float AS duree_moy_h, count(*)::int AS sejours,
            count(*) FILTER (WHERE date - date_prec > interval '24 hours')::int AS sejours_24h
       FROM ev WHERE ancien_etat = 'occupee' AND nouvel_etat = 'nettoyage' AND etat_prec = 'occupee'
        AND date > now() - make_interval(days => $2)`, [etabId, jours, fin]);
  return rows[0];
}

/** Civières de l'urgence, avec la demande de lit du patient s'il en a une. */
async function listeCivieres(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const { rows } = await pool.query(
    `SELECT cv.id, cv.code, cv.categorie, cv.etat, cv.patient_ref, cv.arrivee_le, cv.version, cv.etat_depuis, cv.motif_indispo,
            EXTRACT(EPOCH FROM (now() - cv.arrivee_le)) / 3600 AS heures,
            d.id AS demande_id, d.statut AS demande_statut, d.priorite AS demande_priorite, t.nom AS type_nom, l.code AS lit_code,
            d.priorite_code, d.priorite_libelle, d.priorite_rang, d.priorite_revision, d.priorite_validee_par, d.priorite_validee_le,
            validateur.nom AS priorite_validateur_nom,
            p.id AS patient_id, p.prenom AS patient_prenom, left(p.nom, 1) AS patient_initiale, p.date_naissance AS patient_naissance
       FROM civieres cv
       LEFT JOIN patients p ON p.etablissement_id = cv.etablissement_id AND p.reference = cv.patient_ref
       LEFT JOIN demandes_admission d ON d.civiere_id = cv.id AND d.statut IN ('attente', 'assignee')
       LEFT JOIN utilisateurs validateur ON validateur.id = d.priorite_validee_par
       LEFT JOIN types_unite t ON t.id = d.type_id
       LEFT JOIN lits l ON l.id = d.lit_id
      WHERE cv.etablissement_id = $1
      ORDER BY cv.categorie DESC, cv.code`, [etabId]);
  const { groupeAgeDepuisNaissance } = require('./terrain');
  const priorites = require('./priorites');
  const { referentiel } = await priorites.referentiel(pool, utilisateur, etabId);
  for (const r of rows) {
    r.heures = r.heures == null ? null : Math.floor(Number(r.heures) * 10) / 10;
    // Nom abrégé (prénom + initiale) du patient fictif, seulement dans l'établissement ; jamais dans les vues réseau
    if (r.patient_id) { r.patient_nom_court = `${r.patient_prenom} ${r.patient_initiale}.`; r.groupe_age = groupeAgeDepuisNaissance(r.patient_naissance); }
    delete r.patient_prenom; delete r.patient_initiale; delete r.patient_naissance;
    if (r.demande_id) {
      const priorite = priorites.presenterPriorite(r, referentiel);
      r.demande_priorite_affichage = priorite.priorite_affichage;
      r.demande_priorite_explication = priorite.priorite_explication;
    }
  }
  const stats = (await statsUrgence(pool, [etabId])).get(etabId) || null;
  return { civieres: rows, stats };
}

async function civiereVisible(pool, utilisateur, id) {
  const { rows } = await pool.query('SELECT id, etablissement_id FROM civieres WHERE id = $1', [id]);
  if (!rows[0] || !peutAgirPour(utilisateur, rows[0].etablissement_id)) throw new ErreurHttp(404, 'civiere_introuvable');
  return rows[0];
}

/** Action sur une civière : placer (référence, arrivée facultative), libérer, nettoyage terminé, hors service (motif), remettre. */
async function actionCiviere(pool, utilisateur, id, action, b = {}) {
  await civiereVisible(pool, utilisateur, id);
  const vers = ACTIONS_CIVIERE[action];
  if (!vers) throw new ErreurHttp(400, 'action_inconnue');
  return transaction(pool, (c) => changerEtatCiviere(c, pool, utilisateur.id, id, vers, {
    versionAttendue: b.version, patientRef: b.patient_ref, arrivee: b.arrivee_le, motif: b.motif,
    detail: DETAIL_CIVIERE[action] || (action === 'placer' ? `Patient placé : ${String(b.patient_ref || '').trim()}` : null),
  }));
}

/** Change le patient de civière (ex. du corridor vers une civière régulière qui se libère). Sa demande de lit le suit. */
async function deplacer(pool, utilisateur, id, versId, version) {
  const src = await civiereVisible(pool, utilisateur, id);
  const dst = await civiereVisible(pool, utilisateur, versId);
  if (src.etablissement_id !== dst.etablissement_id || src.id === dst.id) throw new ErreurHttp(400, 'civiere_cible_invalide');
  return transaction(pool, async (c) => {
    const s = (await c.query('SELECT * FROM civieres WHERE id = $1', [src.id])).rows[0];
    if (s.etat !== 'occupee') throw new ErreurHttp(409, 'civiere_non_occupee', { code: s.code });
    const d = (await c.query(`SELECT id FROM demandes_admission WHERE civiere_id = $1 AND statut IN ('attente', 'assignee') FOR UPDATE`, [s.id])).rows[0];
    // La civière d'origine passe en nettoyage d'abord : le patient n'est jamais sur deux civières
    await changerEtatCiviere(c, pool, utilisateur.id, s.id, 'nettoyage', { depuisDemande: true, detail: 'Patient déplacé vers une autre civière' });
    const cible = await changerEtatCiviere(c, pool, utilisateur.id, dst.id, 'occupee', {
      versionAttendue: version, patientRef: s.patient_ref, arrivee: s.arrivee_le, detail: `Patient déplacé depuis ${s.code}`,
    });
    if (d) await c.query('UPDATE demandes_admission SET civiere_id = $2 WHERE id = $1', [d.id, dst.id]);
    return cible;
  });
}

/** Le patient quitte sa civière (admission dans un lit, départ en transfert) : la civière passe en nettoyage, dans la même transaction. */
async function libererPourDemande(c, pool, utilisateurId, demande, detail, transfertId) {
  if (!demande.civiere_id) return null;
  const cv = (await c.query('SELECT etat, patient_ref FROM civieres WHERE id = $1', [demande.civiere_id])).rows[0];
  if (!cv || cv.etat !== 'occupee' || cv.patient_ref !== demande.patient_ref) return null;
  return changerEtatCiviere(c, pool, utilisateurId, demande.civiere_id, 'nettoyage', { depuisDemande: true, detail, transfertId });
}

/** Vérifie qu'une civière peut être liée à une nouvelle demande : occupée, dans l'établissement, sans autre demande active. */
async function civierePourDemande(db, etabId, civiereId, patientRef) {
  const cv = (await db.query(
    `SELECT cv.*, (SELECT count(*)::int FROM demandes_admission d WHERE d.civiere_id = cv.id AND d.statut IN ('attente', 'assignee')) AS demandes
       FROM civieres cv WHERE cv.id = $1 AND cv.etablissement_id = $2`, [civiereId, etabId])).rows[0];
  if (!cv || cv.etat !== 'occupee') throw new ErreurHttp(400, 'civiere_invalide');
  if (cv.demandes) throw new ErreurHttp(409, 'civiere_deja_demande', { code: cv.code });
  if (patientRef && patientRef !== cv.patient_ref) throw new ErreurHttp(400, 'civiere_patient_different', { code: cv.code, ref: cv.patient_ref });
  return cv;
}

module.exports = {
  CATEGORIES, statsUrgence, niveauCivieres, pireNiveau, dureePeriode, listeCivieres, actionCiviere, deplacer,
  libererPourDemande, civierePourDemande, civiereVisible,
};
