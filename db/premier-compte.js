/**
 * Premier compte d'un environnement sans données de démonstration (recette, production) : un gestionnaire réseau
 * avec un mot de passe temporaire, affiché une seule fois. À la première connexion, il choisit son mot de passe ;
 * la double authentification est ensuite exigée pour l'administration. Crée aussi la configuration de base (Québec, types d'unité).
 *   node db/premier-compte.js <courriel> "<nom>"
 * Refusé s'il existe déjà un compte : les comptes suivants se créent dans l'administration (ou par import, partie C).
 */
const fs = require('fs');
const path = require('path');
const { creerPool, transaction } = require('../src/db');
const { hacher, motDePasseTemporaire } = require('../src/auth');
const { configurationBase } = require('./configuration-base');

async function premierCompte(pool, email, nom) {
  const courriel = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(courriel)) throw new Error('Courriel invalide.');
  if (!String(nom || '').trim()) throw new Error('Nom requis.');
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  return transaction(pool, async (c) => {
    if ((await c.query('SELECT count(*)::int AS n FROM utilisateurs')).rows[0].n) throw new Error('Il existe déjà des comptes : utilisez l’administration.');
    await configurationBase(c);   // pays et types d'unité, si absents
    const temporaire = motDePasseTemporaire();
    await c.query(`INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role, mdp_temporaire) VALUES ($1, $2, $3, 'gestionnaire', true)`,
      [courriel, String(nom).trim(), hacher(temporaire)]);
    await c.query(`INSERT INTO journal_admin (action, cible, detail) VALUES ('Compte créé', $1, 'premier compte (gestionnaire réseau)')`, [courriel]);
    return temporaire;
  });
}

if (require.main === module) {
  const pool = creerPool(process.env.DATABASE_URL);
  premierCompte(pool, process.argv[2], process.argv[3])
    .then((mdp) => {
      console.log(`Premier compte créé : ${process.argv[2]} (gestionnaire réseau).`);
      console.log(`Mot de passe temporaire, affiché une seule fois : ${mdp}`);
      console.log('Transmettez-le par un moyen sûr ; il devra être changé à la première connexion.');
      return pool.end();
    })
    .catch((e) => { console.error(e.message); pool.end(); process.exit(1); });
}
module.exports = { premierCompte };
