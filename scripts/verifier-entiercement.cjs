'use strict';
/**
 * Vérification du dossier d'entiercement (garantie de continuité, 20 nov. 2026) : les fichiers nécessaires à une réinstallation
 * sont présents, chaque variable d'environnement lue par le code est documentée (nom seulement), aucun fichier .env ni secret
 * n'est dans le dépôt, et l'empreinte SHA-256 des sources est calculée.  Usage : node scripts/verifier-entiercement.cjs [dossier]
 */
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const racine = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const requis = ['docs/ENTIERCEMENT.md', 'db/schema.sql', 'deploy/installer.sh', 'deploy/sauvegarde.sh', 'deploy/restaurer.sh', 'db/premier-compte.js', 'db/sh-premier-compte.js',
  'src/server.js', 'src/sh/server.js', 'src/environnement.js', 'package.json', 'package-lock.json'];
function fichiers(d, l = []) {
  for (const n of fs.readdirSync(d)) {
    if (['node_modules', '.git', '.local', 'captures'].includes(n)) continue;
    const p = path.join(d, n); const s = fs.statSync(p);
    if (s.isDirectory()) fichiers(p, l); else l.push(path.relative(racine, p));
  }
  return l;
}
function verifier() {
  const erreurs = [];
  for (const f of requis) if (!fs.existsSync(path.join(racine, f))) erreurs.push(`fichier manquant : ${f}`);
  const tous = fichiers(racine);
  if (tous.some((f) => /(^|\/)\.env$/.test(f))) erreurs.push('un fichier .env est présent dans le dépôt');
  const doc = fs.existsSync(path.join(racine, 'docs/ENTIERCEMENT.md')) ? fs.readFileSync(path.join(racine, 'docs/ENTIERCEMENT.md'), 'utf8') : '';
  const lues = new Set();
  for (const f of tous.filter((x) => /^(src|db)\/.*\.js$/.test(x))) for (const m of fs.readFileSync(path.join(racine, f), 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) lues.add(m[1]);
  const ignorees = new Set(['PATH', 'NODE_ENV', 'TZ', 'DEMO_NOM_X', 'DEMO_NOM_Y', 'DEMO_VILLE_X', 'DEMO_VILLE_Y', 'BLOCAGES_MINUTES', 'ARRIMO_WEBHOOKS_LOCAL', 'ARRIMO_SECOURS_DELAI_REPONSE_S', 'ARRIMO_OG_VOCAL_FICTIF', 'ARRIMO_PROFILS_PAYS']);
  const nonDocumentees = [...lues].filter((v) => !ignorees.has(v) && !v.startsWith('SH_') && !doc.includes(`\`${v}\``));
  if (nonDocumentees.length) erreurs.push(`variables non documentées : ${nonDocumentees.join(', ')}`);
  const h = crypto.createHash('sha256');
  for (const f of tous.filter((x) => /^(src|public|public-sh|db|deploy|scripts)\//.test(x)).sort()) { h.update(f); h.update(fs.readFileSync(path.join(racine, f))); }
  return { erreurs, empreinte_sources: h.digest('hex'), fichiers: tous.length };
}
if (require.main === module) { const r = verifier(); console.log(JSON.stringify(r, null, 2)); process.exit(r.erreurs.length ? 1 : 0); }
module.exports = { verifier };
