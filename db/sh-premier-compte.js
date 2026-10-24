/**
 * Premier compte SH : invitation individuelle, à usage unique; le mot de passe est choisi par son destinataire.
 *   node db/sh-premier-compte.js <courriel> "<nom>"
 * Refusé s'il existe déjà un compte : les suivants se créent dans l'écran Équipe SH.
 */
const fs = require('fs');
const path = require('path');
const { creerPool, transaction } = require('../src/db');
const { migrerSh } = require('../src/sh/migrations');
const invitations = require('../src/sh/invitations');

async function premierCompteSh(pool, email, nom) {
  const courriel = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(courriel)) throw new Error('Courriel invalide.');
  if (!String(nom || '').trim()) throw new Error('Nom requis.');
  await pool.query(fs.readFileSync(path.join(__dirname, 'sh-schema.sql'), 'utf8'));
  await migrerSh(pool, process.env);
  if ((await pool.query('SELECT count(*)::int AS n FROM sh_utilisateurs')).rows[0].n ||
      (await pool.query('SELECT count(*)::int AS n FROM sh_invitations WHERE utilise_le IS NULL AND revoquee_le IS NULL AND expire_le > now()')).rows[0].n) {
    throw new Error('Un compte ou une invitation existe déjà : utilisez Équipe SH.');
  }
  return invitations.creer(pool, { email: courriel, nom: String(nom).trim(), role: 'administration' }, process.env);
}

if (require.main === module) {
  const pool = creerPool(process.env.SH_DATABASE_URL || process.env.DATABASE_URL);
  premierCompteSh(pool, process.argv[2], process.argv[3])
    .then((invite) => {
      console.log(`Invitation administrateur envoyée à ${invite.email}; elle expire dans 24 heures.`);
      console.log('Le destinataire choisit son mot de passe et active la double authentification.');
      return pool.end();
    })
    .catch((e) => { console.error(e.message); pool.end(); process.exit(1); });
}
module.exports = { premierCompteSh };
