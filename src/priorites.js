/** Priorités saisies par des professionnels explicitement habilités. Aucune décision clinique d'OG. */
const { transaction, ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const { journaliser } = require('./regles');

function categoriesValides(categories) {
  if (!Array.isArray(categories) || categories.length < 2 || categories.length > 12) throw new ErreurHttp(400, 'priorites_referentiel_invalide');
  const codes = new Set(); const rangs = new Set();
  return categories.map((p) => {
    if (!p || typeof p.code !== 'string' || !/^[a-z][a-z0-9_]{0,29}$/.test(p.code)
      || typeof p.libelle !== 'string' || !p.libelle.trim() || p.libelle.length > 80
      || !Number.isInteger(p.rang) || p.rang < 1 || p.rang > 100 || codes.has(p.code) || rangs.has(p.rang)) {
      throw new ErreurHttp(400, 'priorites_referentiel_invalide');
    }
    codes.add(p.code); rangs.add(p.rang);
    return { code: p.code, libelle: p.libelle.trim(), rang: p.rang };
  }).sort((a, b) => a.rang - b.rang);
}
function texteMotif(v) {
  if (typeof v !== 'string' || !v.trim() || v.length > 500) throw new ErreurHttp(400, 'priorites_motif_requis');
  return v.trim();
}
function versionAttendue(v) {
  if (!Number.isSafeInteger(v) || v < 0) throw new ErreurHttp(400, 'priorites_version_requise');
  return v;
}
async function exigerHabilitation(c, u, etab) {
  exigerEtablissement(u, etab);
  if (!['coordonnateur', 'admin_etab', 'gestionnaire'].includes(u.role)) throw new ErreurHttp(403, 'priorites_non_habilite');
  // Le verrou protège aussi contre une révocation simultanée. L'accès établissement
  // et l'état du compte sont relus : une habilitation seule n'accorde aucun accès.
  const h = await c.query(`SELECT h.utilisateur_id FROM admission_habilitations h JOIN utilisateurs u ON u.id = h.utilisateur_id
    WHERE h.etablissement_id = $1 AND h.utilisateur_id = $2 AND h.active AND u.actif
      AND u.role IN ('coordonnateur', 'admin_etab', 'gestionnaire')
      AND (u.role = 'gestionnaire' OR EXISTS (SELECT 1 FROM utilisateur_etablissements ue WHERE ue.utilisateur_id = u.id AND ue.etablissement_id = $1))
    FOR SHARE OF h, u`, [etab, u.id]);
  if (!h.rows[0]) throw new ErreurHttp(403, 'priorites_non_habilite');
}
async function lireReferentiel(c, etab) {
  return (await c.query('SELECT * FROM admission_referentiels WHERE etablissement_id = $1', [etab])).rows[0] || null;
}
async function referentiel(pool, u, etab) {
  exigerEtablissement(u, etab);
  const r = await lireReferentiel(pool, etab);
  const h = await pool.query(`SELECT 1 FROM admission_habilitations WHERE etablissement_id = $1 AND utilisateur_id = $2 AND active`, [etab, u.id]);
  return { referentiel: r, peut_valider: !!h.rows[0] && ['coordonnateur', 'admin_etab', 'gestionnaire'].includes(u.role) };
}
async function configurer(pool, u, etab, b) {
  exigerAdministration(u, etab);
  const categories = categoriesValides(b.categories); const motif = texteMotif(b.motif);
  const revision = versionAttendue(b.revision);
  if (b.confirmation !== true) throw new ErreurHttp(400, 'priorites_confirmation_requise');
  return transaction(pool, async (c) => {
    await exigerHabilitation(c, u, etab);
    // Même verrou pour les validations et les changements de référentiel, y compris sa première création.
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`arrimo-priorites:${etab}`]);
    const avant = await lireReferentiel(c, etab);
    if ((avant?.revision || 0) !== revision) throw new ErreurHttp(409, 'priorites_conflit');
    const r = await c.query(`INSERT INTO admission_referentiels (etablissement_id, revision, categories, approuve_par, motif)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (etablissement_id) DO UPDATE SET revision = EXCLUDED.revision,
      categories = EXCLUDED.categories, approuve_par = EXCLUDED.approuve_par, approuve_le = now(), motif = EXCLUDED.motif RETURNING *`,
    [etab, revision + 1, JSON.stringify(categories), u.id, motif]);
    await journaliser(c, { etablissementId: etab, utilisateurId: u.id, action: 'Référentiel de priorités approuvé',
      detail: JSON.stringify({ revision: revision + 1, categories, motif, precedente: avant?.revision || null }) });
    return r.rows[0];
  });
}
function exigerAdministration(u, etab) {
  exigerEtablissement(u, etab);
  if (!u.admin || !['gestionnaire', 'admin_etab'].includes(u.role)) throw new ErreurHttp(403, 'reserve_admin');
  if (process.env.ARRIMO_2FA_ADMIN !== '0' && !u.totp_actif) throw new ErreurHttp(403, 'admin_exige_2fa');
}
async function habiliter(pool, u, etab, utilisateurId, b) {
  exigerAdministration(u, etab);
  const version = versionAttendue(b.version);
  const motif = texteMotif(b.motif);
  if (b.confirmation !== true || typeof b.active !== 'boolean') throw new ErreurHttp(400, 'priorites_confirmation_requise');
  return transaction(pool, async (c) => {
    const cible = await c.query(`SELECT u.id FROM utilisateurs u WHERE u.id = $1
      AND (u.actif OR NOT $4) AND (u.role <> 'gestionnaire' OR $3)
      AND u.role IN ('coordonnateur', 'admin_etab', 'gestionnaire')
      AND (u.role = 'gestionnaire' OR EXISTS (SELECT 1 FROM utilisateur_etablissements ue WHERE ue.utilisateur_id = u.id AND ue.etablissement_id = $2))
      FOR SHARE OF u`, [utilisateurId, etab, !!u.gestionnaire, b.active]);
    if (!cible.rows[0]) throw new ErreurHttp(403, 'priorites_non_habilite');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`arrimo-habilitation:${etab}:${utilisateurId}`]);
    const avant = (await c.query('SELECT version FROM admission_habilitations WHERE etablissement_id=$1 AND utilisateur_id=$2', [etab, utilisateurId])).rows[0];
    if ((avant?.version || 0) !== version) throw new ErreurHttp(409, 'priorites_conflit');
    await c.query(`INSERT INTO admission_habilitations (etablissement_id, utilisateur_id, active, accordee_par)
      VALUES ($1,$2,$3,$4) ON CONFLICT (etablissement_id, utilisateur_id) DO UPDATE
      SET active = EXCLUDED.active, accordee_par = EXCLUDED.accordee_par, modifie_le = now(), version = admission_habilitations.version + 1`, [etab, utilisateurId, b.active, u.id]);
    await journaliser(c, { etablissementId: etab, utilisateurId: u.id, action: 'Habilitation de priorité modifiée',
      detail: JSON.stringify({ utilisateur_id: utilisateurId, active: b.active, motif, version: version + 1 }) });
    return { utilisateur_id: utilisateurId, active: b.active, version: version + 1 };
  });
}
async function habilitations(pool, u, etab) {
  exigerAdministration(u, etab);
  return (await pool.query('SELECT utilisateur_id, active, version, modifie_le FROM admission_habilitations WHERE etablissement_id=$1', [etab])).rows;
}
async function valider(pool, u, demandeId, b, client = null) {
  const version = versionAttendue(b.version); const motif = texteMotif(b.motif);
  if (b.confirmation !== true) throw new ErreurHttp(400, 'priorites_confirmation_requise');
  const executer = async (c) => {
    const d = (await c.query('SELECT * FROM demandes_admission WHERE id = $1 FOR UPDATE', [demandeId])).rows[0];
    if (!d) throw new ErreurHttp(404, 'demande_introuvable');
    await exigerHabilitation(c, u, d.etablissement_id);
    if (!['attente', 'assignee'].includes(d.statut)) throw new ErreurHttp(409, 'demande_plus_en_attente');
    if (d.priorite_version !== version) throw new ErreurHttp(409, 'priorites_conflit');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`arrimo-priorites:${d.etablissement_id}`]);
    const r = await lireReferentiel(c, d.etablissement_id);
    if (!r || b.revision !== r.revision) throw new ErreurHttp(409, 'priorites_conflit');
    const p = r.categories.find((x) => x.code === b.code);
    if (!p) throw new ErreurHttp(400, 'priorites_code_inconnu');
    const maj = await c.query(`UPDATE demandes_admission SET priorite_code = $2, priorite_libelle = $3, priorite_rang = $4,
      priorite_revision = $5, priorite_validee_par = $6, priorite_validee_le = now(), priorite_motif = $7,
      priorite_version = priorite_version + 1 WHERE id = $1 RETURNING *`, [d.id, p.code, p.libelle, p.rang, r.revision, u.id, motif]);
    await journaliser(c, { etablissementId: d.etablissement_id, utilisateurId: u.id, action: 'Priorité de demande validée',
      detail: JSON.stringify({ demande_id: d.id, avant: { code: d.priorite_code, revision: d.priorite_revision, version },
        apres: { ...p, revision: r.revision, version: version + 1 }, motif }) });
    return maj.rows[0];
  };
  return client ? executer(client) : transaction(pool, executer);
}
/** Le délai départage seulement des demandes de même rang ; il ne détermine jamais la gravité. */
function presenterPriorite(d, r) {
  const categorie = r?.categories.find((p) => p.code === d.priorite_code && p.rang === d.priorite_rang);
  const validee = !!(d.priorite_validee_par && d.priorite_validee_le && r && d.priorite_revision === r.revision && categorie);
  const explication = validee
    ? `${d.priorite_libelle} : rang ${d.priorite_rang}, référentiel v${d.priorite_revision}, validé par ${d.priorite_validateur_nom || `compte ${d.priorite_validee_par}`} le ${new Date(d.priorite_validee_le).toISOString()}. À rang égal, ancienneté de la demande.`
    : d.priorite_validee_le ? 'Référentiel modifié : validation professionnelle à renouveler ; aucun rang clinique appliqué.'
      : 'Priorité clinique non validée : aucun rang clinique appliqué. La valeur historique ne vaut pas validation.';
  return { ...d, priorite_validee: validee, priorite_a_revalider: !!d.priorite_validee_le && !validee,
    priorite_affichage: validee ? d.priorite_libelle : 'À valider', priorite_explication: explication };
}
function organiserFile(demandes, r) {
  const file = demandes.map((d) => presenterPriorite(d, r));
  return file.sort((a, b) => Number(b.priorite_validee) - Number(a.priorite_validee)
    || (a.priorite_validee && b.priorite_validee ? a.priorite_rang - b.priorite_rang : 0)
    || new Date(a.cree_le) - new Date(b.cree_le) || a.id - b.id);
}
module.exports = { categoriesValides, organiserFile, presenterPriorite, exigerHabilitation, referentiel, configurer, habiliter, habilitations, valider };
