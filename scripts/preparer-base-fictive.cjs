/** Prépare uniquement une base locale NEUVE arrimo_recette_source_*. Aucun reset. */
const fs = require('node:fs');
const { creerPool } = require('../src/db');
async function preparer() {
  const url = new URL(process.env.ARRIMO_FIXTURE_DATABASE_URL);
  if (!['localhost', '127.0.0.1', ''].includes(url.hostname) || !/^\/arrimo_recette_source_[a-z0-9_]+$/.test(url.pathname)) throw new Error('Base locale dédiée requise');
  const pool = creerPool(url.href);
  try {
    const nom = (await pool.query('SELECT current_database() AS nom')).rows[0].nom;
    if (nom !== url.pathname.slice(1) || (await pool.query('SELECT tablename FROM pg_tables WHERE schemaname=current_schema()')).rows.length) throw new Error('Base neuve obligatoire');
    const courant = fs.readFileSync(require.resolve('../db/schema.sql'), 'utf8');
    const schema = process.env.ARRIMO_FIXTURE_SCHEMA ? fs.readFileSync(process.env.ARRIMO_FIXTURE_SCHEMA, 'utf8') : courant;
    const restaurer = require('../tests/routeur-fictif.cjs').activer();
    try {
      const ancien = { query: (sql, args) => pool.query(sql === courant ? schema : sql, args), connect: () => pool.connect() };
      await require('../db/seed').seed(ancien, { silencieux: true });
    } finally { restaurer(); }
    console.log(JSON.stringify({ statut: 'base_fictive_preparee', base: nom, donnees_reelles: false, reinitialisation: false }));
  } finally { await pool.end(); }
}
preparer().catch((e) => { console.error('Préparation fictive refusée ou échouée :', e.code || 'CONFIGURATION_INVALIDE'); process.exitCode = 1; });
