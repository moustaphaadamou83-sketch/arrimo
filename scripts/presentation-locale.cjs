// Bac à sable dédié : ne lit aucun .env, ne réinitialise aucune base existante.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const local = path.join(__dirname, '..', '.local');
const config = path.join(local, 'presentation.json');
const prefix = 'postgresql://arrimo_audit@127.0.0.1:55439/';
process.env.ARRIMO_ENV = 'demo';
process.env.ARRIMO_DEMO = '1';
process.env.NODE_ENV = 'development';
process.env.ARRIMO_URL = 'http://127.0.0.1:3014';
for (const cle of ['COPILOTE_IA_CLE', 'COPILOTE_IA_URL', 'SMTP_URL', 'SH_DATABASE_URL', 'SH_API_KEY']) delete process.env[cle];
process.env.DEMO_MOT_DE_PASSE = 'Arrimo2026!demo';
let pool; let serveur;
(async () => {
  fs.mkdirSync(local, { recursive: true, mode: 0o700 });
  let base;
  if (fs.existsSync(config)) {
    base = JSON.parse(fs.readFileSync(config, 'utf8')).base;
    if (!/^arrimo_presentation_[a-f0-9]{14}$/.test(base)) throw new Error('Configuration locale invalide');
  } else {
    base = 'arrimo_presentation_' + crypto.randomBytes(7).toString('hex');
    const admin = new Pool({ connectionString: prefix + 'postgres' });
    try { await admin.query('CREATE DATABASE ' + base); } finally { await admin.end(); }
    pool = new Pool({ connectionString: prefix + base });
    await require('../db/demo-reseau').demoReseau(pool, { silencieux: true, comptesRoles: true });
    fs.writeFileSync(config, JSON.stringify({ base }, null, 2), { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(path.join(local, 'acces-presentation.txt'),
      'Présentation locale uniquement : http://127.0.0.1:3014\nComptes : hopital.x@demo.arrimo, hopital.y@demo.arrimo, reseau@demo.arrimo, entretien.x@demo.arrimo, entretien.y@demo.arrimo\nMot de passe : ' + process.env.DEMO_MOT_DE_PASSE + '\n',
      { flag: 'wx', mode: 0o600 });
  }
  pool ||= new Pool({ connectionString: prefix + base });
  await pool.query('SELECT 1');
  serveur = require('../src/app').creerApp(pool).listen(3014, '127.0.0.1', () => {
    console.log('Présentation locale : http://127.0.0.1:3014 — accès dans .local/acces-presentation.txt');
  });
  serveur.on('error', async (e) => { console.error('Serveur local indisponible :', e.code); await pool.end(); process.exitCode = 1; });
})().catch(async (e) => { console.error('Présentation locale :', e.code || e.message); await pool?.end(); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (serveur) serveur.close(() => pool.end().then(() => process.exit(0)));
  else pool?.end().then(() => process.exit(0));
});
