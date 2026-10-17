/** Démarrage de la console SH (sh.<domaine>). Variables : SH_DATABASE_URL (ou DATABASE_URL), PORT (3012), HOST, SH_ENV_* (voir cibles.js). */
const fs = require('fs');
const path = require('path');
const { creerPool } = require('../db');
const { creerAppSh } = require('./app');
const { cibles } = require('./cibles');

const url = process.env.SH_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('SH_DATABASE_URL manquant.'); process.exit(1); }
const pool = creerPool(url);
const port = Number(process.env.PORT || 3012);
const hote = process.env.HOST || '127.0.0.1';

pool.query(fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'sh-schema.sql'), 'utf8'))
  .then(() => creerAppSh(pool).listen(port, hote, () => {
    console.log(`Console SH sur ${hote}:${port} · environnements reliés : ${cibles().map((c) => c.code).join(', ') || 'aucun'}`);
  }))
  .catch((e) => { console.error('Console SH :', e.message); process.exit(1); });
