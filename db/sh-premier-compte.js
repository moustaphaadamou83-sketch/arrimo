/**
 * Premier compte de la console SH : mot de passe temporaire affiché une seule fois. À la première connexion,
 * le membre choisit son mot de passe puis active la double authentification (obligatoire).
 *   node db/sh-premier-compte.js <courriel> "<nom>"
 * Refusé s'il existe déjà un compte : les suivants se créent dans l'écran Équipe SH.
 */
const fs = require('fs');
const path = require('path');
const { creerPool, transaction } = require('../src/db');
const { hacher, motDePasseTemporaire } = require('../src/auth');

async function premierCompteSh(pool, email, nom) {
  const courriel = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(courriel)) throw new Error('Courriel invalide.');
  if (!String(nom || '').trim()) throw new Error('Nom requis.');
  await pool.query(fs.readFileSync(path.join(__dirname, 'sh-schema.sql'), 'utf8'));
  return transaction(pool, async (c) => {
    if ((await c.query('SELECT count(*)::int AS n FROM sh_utilisateurs')).rows[0].n) throw new Error('Il existe déjà des comptes : utilisez l’écran Équipe SH.');
    const temporaire = motDePasseTemporaire();
    const id = (await c.query('INSERT INTO sh_utilisateurs (email, nom, mot_de_passe_hash) VALUES ($1, $2, $3) RETURNING id', [courriel, String(nom).trim(), hacher(temporaire)])).rows[0].id;
    await c.query(`INSERT INTO sh_journal (utilisateur_id, action, cible, detail) VALUES ($1, 'Compte SH créé', $2, 'premier compte')`, [id, courriel]);
    return temporaire;
  });
}

if (require.main === module) {
  const pool = creerPool(process.env.SH_DATABASE_URL || process.env.DATABASE_URL);
  premierCompteSh(pool, process.argv[2], process.argv[3])
    .then((mdp) => {
      console.log(`Premier compte de la console SH : ${process.argv[2]}.`);
      console.log(`Mot de passe temporaire, affiché une seule fois : ${mdp}`);
      console.log('À changer à la première connexion ; la double authentification est ensuite obligatoire.');
      return pool.end();
    })
    .catch((e) => { console.error(e.message); pool.end(); process.exit(1); });
}
module.exports = { premierCompteSh };
