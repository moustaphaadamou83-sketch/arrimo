/** Vérification réelle d'une migration sur une copie DÉJÀ restaurée.
 * N'effectue aucune restauration, ne crée pas de base, n'efface rien.
 * PRIORITES_RESTORE_DATABASE_URL doit désigner une base locale arrimo_vnext_restore_*.
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { creerPool, transaction } = require('../src/db');
const refuser = (code) => { const e = new Error(code); e.code = code; throw e; };
const tables = ['etablissements', 'utilisateurs', 'utilisateur_etablissements', 'lits', 'civieres', 'demandes_admission', 'transferts', 'journal', 'journal_admin', 'patients', 'conges', 'notifications'];
const identifiant = (s) => `"${s.replaceAll('"', '""')}"`;

async function verifier() {
  const cible = process.env.ARRIMO_RESTORE_DATABASE_URL || process.env.PRIORITES_RESTORE_DATABASE_URL;
  if (!cible) refuser('PRIORITES_RESTORE_DATABASE_URL_REQUIS');
  const url = new URL(cible);
  if (!['localhost', '127.0.0.1', ''].includes(url.hostname) || !/^\/arrimo_vnext_restore_[a-z0-9_]+$/.test(url.pathname)) refuser('COPIE_LOCALE_DEDIEE_REQUISE');
  const host = url.searchParams.get('host');
  if (host && !['localhost', '127.0.0.1'].includes(host) && !/^\/(var\/run\/postgresql|tmp|root)(\/|$)/.test(host)) refuser('HOTE_LOCAL_REQUIS');
  const pool = creerPool(cible);
  try {
    if ((await pool.query('SELECT current_database() AS nom')).rows[0].nom !== url.pathname.slice(1)) refuser('BASE_INATTENDUE');
    const stabilisation = process.argv.includes('--stabilisation');
    if (stabilisation) tables.push('missions_ccs', 'passages_chrono', 'organisations_secours');
    const colonnes = {};
    for (const table of tables) {
      colonnes[table] = (await pool.query('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position', [table])).rows.map((r) => r.column_name);
      if (!colonnes[table].length) refuser('COPIE_INCOMPLETE');
    }
    for (const table of ['admission_referentiels','admission_habilitations','connecteurs_simulation_config','connecteurs_correspondances','connecteurs_simulation_flux','connecteurs_simulation_evenements']) {
      const cols = (await pool.query('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position', [table])).rows.map((r) => r.column_name);
      if (cols.length) { tables.push(table); colonnes[table] = cols; }
    }
    const empreintes = async (c) => {
      const resultat = {};
      for (const table of tables) {
        // Comparaison de contenu et multiplicité, sans sortir les données de PostgreSQL.
        // MD5 sert seulement de témoin de non-modification, pas d'authentification.
        const r = await c.query(`SELECT count(*)::text AS total,
          md5(COALESCE(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), '')) AS empreinte
          FROM (SELECT ${colonnes[table].map(identifiant).join(',')} FROM ${identifiant(table)}) t`);
        resultat[table] = r.rows[0];
      }
      return resultat;
    };
    const migrations = stabilisation ? [
      '20261123-interventions-ccs-demo.sql',
      '20261123-chrono-motifs-retard.sql',
      '20261123-chrono-alertes.sql',
      '20261123-secours-perimetres-vehicules.sql',
    ] : ['20261025-priorites.sql', '20261025-simulation.sql'];
    // La vérification porte déjà une transaction.
    const sql = migrations.map((f) => fs.readFileSync(require.resolve(`../db/migrations/${f}`), 'utf8')
      .replace(/^\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '')).join('\n');
    const repetitions = [];
    for (let numero = 1; numero <= 2; numero += 1) {
      repetitions.push(await transaction(pool, async (c) => {
        await c.query("SET LOCAL lock_timeout = '5s'"); await c.query("SET LOCAL statement_timeout = '120s'");
        // Bloquer les écritures pendant la preuve ; uniquement sur la copie dédiée.
        for (const table of tables) await c.query(`LOCK TABLE ${identifiant(table)} IN SHARE MODE`);
        const avant = await empreintes(c);
        await c.query(sql);
        const apres = await empreintes(c);
        if (JSON.stringify(avant) !== JSON.stringify(apres)) refuser('CONTENU_EXISTANT_MODIFIE');
        return { repetition: numero, donnees_preservees: true, lignes: Object.fromEntries(tables.map((t) => [t, apres[t].total])) };
      }));
    }
    if (stabilisation) {
      const { rows: [schema] } = await pool.query(`SELECT
        to_regclass('interventions_ccs_demo') IS NOT NULL AS interventions,
        to_regclass('passages_chrono_motifs') IS NOT NULL AS motifs,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
          AND table_name = 'missions_ccs' AND column_name = 'intervention_demo_id') AS lien,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
          AND table_name = 'passages_chrono' AND column_name = 'alerte_notifiee_le') AS alerte,
        to_regclass('utilisateur_unites_secours') IS NOT NULL AS vehicules`);
      if (Object.values(schema).some((presente) => !presente)) refuser('SCHEMA_STABILISATION_INCOMPLET');
      console.log(JSON.stringify({ statut: 'migration_verifiee_sur_copie', migrations, migration_sha256: crypto.createHash('sha256').update(sql).digest('hex'),
        repetitions, schema, restauration_effectuee_par_ce_script: false, publication_effectuee: false }, null, 2));
      return;
    }
    const proprietaires = (await pool.query("SELECT relname,pg_get_userbyid(relowner) AS proprietaire FROM pg_class WHERE oid IN ('admission_referentiels'::regclass,'admission_habilitations'::regclass,'connecteurs_simulation_config'::regclass,'connecteurs_correspondances'::regclass,'connecteurs_simulation_flux'::regclass,'connecteurs_simulation_evenements'::regclass)")).rows;
    console.log(JSON.stringify({ statut: 'migration_verifiee_sur_copie', migration_sha256: crypto.createHash('sha256').update(sql).digest('hex'), repetitions, proprietaires,
      restauration_effectuee_par_ce_script: false, publication_effectuee: false }, null, 2));
  } finally { await pool.end(); }
}
verifier().catch((e) => { console.error('Validation de migration non effectuée ou échouée :', e.code || 'CONFIGURATION_INVALIDE'); process.exitCode = 1; });
