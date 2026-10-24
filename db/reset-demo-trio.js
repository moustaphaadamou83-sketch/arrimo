/** Réinitialise uniquement une base locale explicitement nommée pour la démo A/B/C. */
const { creerPool } = require('../src/db');
const { viderBase } = require('./vider');
const { preparerDemoTrio, urlDemoLocale } = require('./demo-trio');

async function main() {
  const { environnement } = require('../src/environnement');
  const url = process.env.DATABASE_URL || '';
  if (environnement() !== 'demo' || !urlDemoLocale(url)) {
    throw new Error('Refusé : ARRIMO_ENV=demo et DATABASE_URL locale arrimo_demo_trio* requis.');
  }
  const pool = creerPool(url);
  try {
    await viderBase(pool);
    await preparerDemoTrio(pool);
  } finally { await pool.end(); }
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
