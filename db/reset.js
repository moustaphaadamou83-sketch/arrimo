/**
 * Efface toutes les données du module puis recrée une démonstration.
 *   node db/reset.js          réseau de 6 établissements
 *   node db/reset.js deux     démonstration Hôpital X / Hôpital Y
 * Refusé en production, sauf sur un serveur de démonstration (ARRIMO_DEMO=1).
 */
const { creerPool } = require('../src/db');
const { seed } = require('./seed');
const { demoDeux } = require('./demo-deux');

if (process.env.NODE_ENV === 'production' && process.env.ARRIMO_DEMO !== '1') {
  console.error('Interdit en production. Sur un serveur de démonstration, définissez ARRIMO_DEMO=1.');
  process.exit(1);
}
const pool = creerPool(process.env.DATABASE_URL);
(async () => {
  await pool.query(`DROP TABLE IF EXISTS journal_admin, connexions_2fa, messages_connecteur, connecteurs, demandes_admission, notifications, journal, lits, transferts,
                    chambres, unites, sessions, utilisateur_etablissements, utilisateurs, etablissements, types_unite, config_pays CASCADE;
                    DROP SEQUENCE IF EXISTS transfert_seq; DROP FUNCTION IF EXISTS journal_immuable CASCADE;`);
  if (process.argv[2] === 'deux') await demoDeux(pool);
  else await seed(pool);
  await pool.end();
})().catch((e) => { console.error(e); pool.end(); process.exit(1); });
