/**
 * Efface toutes les données du module puis recrée une démonstration.
 *   node db/reset.js          réseau de 6 établissements
 *   node db/reset.js deux     démonstration Hôpital X / Hôpital Y
 *   --silencieux              n'affiche pas les accès (timer de nuit : le mot de passe ne va pas dans les journaux)
 * Refusé en production, sauf sur un serveur de démonstration (ARRIMO_DEMO=1).
 */
const { creerPool } = require('../src/db');
const { seed } = require('./seed');
const { demoDeux } = require('./demo-deux');
const { viderBase } = require('./vider');

if (process.env.NODE_ENV === 'production' && process.env.ARRIMO_DEMO !== '1') {
  console.error('Interdit en production. Sur un serveur de démonstration, définissez ARRIMO_DEMO=1.');
  process.exit(1);
}
const pool = creerPool(process.env.DATABASE_URL);
(async () => {
  await viderBase(pool);
  const silencieux = process.argv.includes('--silencieux');
  if (process.argv[2] === 'deux') await demoDeux(pool, { silencieux });
  else await seed(pool, { silencieux });
  if (silencieux) console.log('Démo remise à zéro.');
  await pool.end();
})().catch((e) => { console.error(e); pool.end(); process.exit(1); });
