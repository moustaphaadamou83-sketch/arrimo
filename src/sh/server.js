/** Démarrage de la console SH (sh.<domaine>). Variables : SH_DATABASE_URL (ou DATABASE_URL), PORT (3012), HOST, SH_ENV_* (voir cibles.js). */
const fs = require('fs');
const path = require('path');
const { creerPool } = require('../db');
const { creerAppSh } = require('./app');
const { cibles } = require('./cibles');
const { migrerSh } = require('./migrations');
const { verifierEnvironnements } = require('./supervision');

const url = process.env.SH_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('SH_DATABASE_URL manquant.'); process.exit(1); }
const pool = creerPool(url);
const port = Number(process.env.PORT || 3012);
const hote = process.env.HOST || '127.0.0.1';

pool.query(fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'sh-schema.sql'), 'utf8'))
  .then(() => migrerSh(pool, process.env))
  .then(() => creerAppSh(pool).listen(port, hote, () => {
    console.log(`Console SH sur ${hote}:${port} · environnements reliés : ${cibles().map((c) => c.code).join(', ') || 'aucun'}`);
    // Supervision des environnements reliés (SH_SUPERVISION_MINUTES, 5 par défaut ; 0 la désactive)
    const minutes = Number(process.env.SH_SUPERVISION_MINUTES ?? 5);
    if (minutes > 0) {
      const releve = () => verifierEnvironnements(pool, cibles()).catch((e) => console.error('Supervision :', e.message));
      setTimeout(releve, 10000).unref();
      setInterval(releve, minutes * 60000).unref();
    }
  }))
  .catch((e) => { console.error('Console SH :', e.message); process.exit(1); });
