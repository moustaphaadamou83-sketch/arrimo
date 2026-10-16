/**
 * Mot de passe oublié : lien à usage unique valable 30 minutes, envoyé par courriel.
 * La réponse est la même que le compte existe ou non (rien ne permet de deviner les adresses).
 * En attendant un courriel professionnel Arrimo, la réinitialisation se fait par un administrateur.
 */
const crypto = require('crypto');
const { transaction, ErreurHttp } = require('./db');
const { hacher, verifierRobustesse } = require('./auth');
const { tr } = require('./langue');
const courriel = require('./courriel');

const DUREE_MIN = 30;
const empreinte = (jeton) => crypto.createHash('sha256').update(String(jeton)).digest('hex');

/** Crée un jeton et envoie le lien, si le compte existe et est actif. Ne révèle jamais si l'adresse existe. */
async function demander(pool, email, langue) {
  if (!courriel.actif()) throw new ErreurHttp(503, 'courriel_non_configure');
  const adresse = String(email || '').trim().toLowerCase();
  const u = (await pool.query('SELECT id, nom, email FROM utilisateurs WHERE email = $1 AND actif', [adresse])).rows[0];
  if (u) {
    // Au plus 3 liens par heure et par compte, en silence
    const recents = (await pool.query(`SELECT count(*)::int AS n FROM jetons_mdp WHERE utilisateur_id = $1 AND cree_le > now() - interval '1 hour'`, [u.id])).rows[0].n;
    if (recents < 3) {
      const jeton = crypto.randomBytes(32).toString('hex');
      await pool.query(`INSERT INTO jetons_mdp (jeton_hash, utilisateur_id, expire_le) VALUES ($1, $2, now() + make_interval(mins => $3))`,
        [empreinte(jeton), u.id, DUREE_MIN]);
      const lien = `${(process.env.ARRIMO_URL || '').replace(/\/$/, '')}/?reinit=${jeton}`;
      // Envoi sans attendre : la réponse prend le même temps que l'adresse existe ou non
      courriel.envoyer({ a: u.email, sujet: tr(langue, 'courriel_sujet'), texte: tr(langue, 'courriel_texte', { nom: u.nom, lien, min: DUREE_MIN }) })
        .catch((e) => console.error('Courriel de réinitialisation :', e.message));
    }
  }
  return { ok: true };
}

/** Change le mot de passe avec un jeton valide ; le jeton ne sert qu'une fois et toutes les sessions sont fermées. */
async function reinitialiser(pool, jeton, nouveau) {
  verifierRobustesse(nouveau);
  return transaction(pool, async (c) => {
    const j = (await c.query(
      `SELECT j.utilisateur_id, u.email FROM jetons_mdp j JOIN utilisateurs u ON u.id = j.utilisateur_id AND u.actif
        WHERE j.jeton_hash = $1 AND j.utilise_le IS NULL AND j.expire_le > now() FOR UPDATE OF j`, [empreinte(jeton)])).rows[0];
    if (!j) throw new ErreurHttp(400, 'jeton_invalide');
    await c.query('UPDATE jetons_mdp SET utilise_le = now() WHERE utilisateur_id = $1 AND utilise_le IS NULL', [j.utilisateur_id]);
    await c.query('UPDATE utilisateurs SET mot_de_passe_hash = $2, mdp_temporaire = false WHERE id = $1', [j.utilisateur_id, hacher(nouveau)]);
    await c.query('DELETE FROM sessions WHERE utilisateur_id = $1', [j.utilisateur_id]);
    await c.query(`INSERT INTO journal_admin (utilisateur_id, action, cible, detail) VALUES ($1, 'Mot de passe réinitialisé', $2, 'par lien envoyé par courriel')`,
      [j.utilisateur_id, j.email]);
    return { ok: true };
  });
}

module.exports = { demander, reinitialiser, DUREE_MIN };
