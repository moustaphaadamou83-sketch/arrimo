// Crée les clés de notification du portail, écrites dans le fichier indiqué (droits conservés) ; rien n'est affiché.
const crypto = require('node:crypto'); const fs = require('node:fs');
const fichier = process.argv[2]; const sujet = process.argv[3];
if (!fichier || !/^mailto:|^https:/.test(sujet || '')) { console.error('Usage : generer-vapid.cjs <fichier .env> <mailto:adresse>'); process.exit(1); }
if (/^ARRIMO_VAPID_PRIVEE=/m.test(fs.readFileSync(fichier, 'utf8'))) { console.log('Clés déjà présentes : conservées.'); process.exit(0); }
const j = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')]).toString('base64url');
fs.appendFileSync(fichier, `ARRIMO_VAPID_PUBLIQUE=${pub}\nARRIMO_VAPID_PRIVEE=${j.d}\nARRIMO_VAPID_SUJET=${sujet}\n`);
console.log('Clés créées.');
