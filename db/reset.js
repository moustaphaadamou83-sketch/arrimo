/**
 * Efface toutes les données du module puis recrée une démonstration.
 *   node db/reset.js          réseau de 6 établissements
 *   node db/reset.js demo     démonstration : réseau de 20 hôpitaux (Hôpital X, Hôpital Y et 18 autres)
 *   --silencieux              n'affiche pas les accès (timer de nuit : le mot de passe ne va pas dans les journaux)
 * Permis seulement sur un serveur de démonstration (ARRIMO_ENV=demo) ou en développement ; refusé en recette et en production.
 */
const { creerPool } = require('../src/db');
const { seed } = require('./seed');
const { demoReseau } = require('./demo-reseau');
const { viderBase } = require('./vider');

const { environnement } = require('../src/environnement');
if (!['demo', 'developpement'].includes(environnement())) {
  console.error(`Interdit en ${environnement()} : la remise à zéro et les données de démonstration sont réservées à la démo (ARRIMO_ENV=demo).`);
  process.exit(1);
}
const pool = creerPool(process.env.DATABASE_URL);
(async () => {
  await viderBase(pool);
  const silencieux = process.argv.includes('--silencieux');
  if (['demo', 'deux'].includes(process.argv[2])) await demoReseau(pool, { silencieux });
  else await seed(pool, { silencieux });
  if (silencieux) console.log('Démo remise à zéro.');
  await pool.end();
})().catch((e) => { console.error(e); pool.end(); process.exit(1); });
