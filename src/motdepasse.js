/**
 * Mot de passe oublié : lien à usage unique valable 30 minutes, envoyé par courriel.
 * La réponse est la même que le compte existe ou non (rien ne permet de deviner les adresses).
 * En attendant un courriel professionnel Arrimo, la réinitialisation se fait par un administrateur.
 */
const crypto = require('crypto');
const { transaction, ErreurHttp } = require('./db');
const { hacherAsync, verifierRobustesse } = require('./auth');
const { tr } = require('./langue');
const courriel = require('./courriel');

const DUREE_MIN = 30;
const empreinte = (jeton) => crypto.createHash('sha256').update(String(jeton)).digest('hex');

/** Crée un jeton et envoie le lien, si le compte existe et est actif. Ne révèle jamais si l'adresse existe. */
/** Langue du destinataire : celle qu'il a choisie, sinon celle de son établissement, sinon celle de la demande (anglais partout, 19 nov. 2026). */
async function langueDe(pool, utilisateurId, repli = 'fr') {
  const r = (await pool.query(`SELECT u.langue_interface, (SELECT e.langue FROM utilisateur_etablissements ue JOIN etablissements e ON e.id = ue.etablissement_id
    WHERE ue.utilisateur_id = u.id ORDER BY e.id LIMIT 1) AS langue_etab FROM utilisateurs u WHERE u.id = $1`, [utilisateurId])).rows[0];
  return r?.langue_interface || r?.langue_etab || (repli === 'en' ? 'en' : 'fr');
}
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
      const lien = `${require('./environnement').urlPublique()}/#reinit=${jeton}`;
      // Envoi sans attendre : la réponse prend le même temps que l'adresse existe ou non
      const L = await langueDe(pool, u.id, langue);
      courriel.envoyer({ a: u.email, sujet: tr(L, 'courriel_sujet'), texte: tr(L, 'courriel_texte', { nom: u.nom, lien, min: DUREE_MIN }) })
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
    await c.query('UPDATE utilisateurs SET mot_de_passe_hash = $2, mdp_temporaire = false, invitation_en_attente = false WHERE id = $1', [j.utilisateur_id, await hacherAsync(nouveau)]);
    await c.query('DELETE FROM sessions WHERE utilisateur_id = $1', [j.utilisateur_id]);
    await c.query(`INSERT INTO journal_admin (utilisateur_id, action, cible, detail) VALUES ($1, 'Mot de passe réinitialisé', $2, 'par lien envoyé par courriel')`,
      [j.utilisateur_id, j.email]);
    return { ok: true };
  });
}

/** Invitation hospitalière individuelle, limitée à l'établissement déjà relié par SH. */
async function inviter(pool, email, nom, par = 'console SH') {
  if (!courriel.actif()) throw new ErreurHttp(503, 'courriel_non_configure');
  const adresse = String(email || '').trim().toLowerCase();
  const u = (await pool.query('SELECT id,email,nom,invitation_en_attente FROM utilisateurs WHERE email=$1 AND actif', [adresse])).rows[0];
  if (!u || !u.invitation_en_attente) throw new ErreurHttp(409, 'jeton_invalide');
  const jeton = crypto.randomBytes(32).toString('hex');
  await pool.query("UPDATE jetons_mdp SET utilise_le=now() WHERE utilisateur_id=$1 AND utilise_le IS NULL", [u.id]);
  await pool.query("INSERT INTO jetons_mdp (jeton_hash,utilisateur_id,type,expire_le) VALUES ($1,$2,'invitation',now()+interval '24 hours')", [empreinte(jeton), u.id]);
  const lien = `${require('./environnement').urlPublique()}/#reinit=${jeton}`;
  try {
    const L = await langueDe(pool, u.id);
    await courriel.envoyer({ a: adresse, sujet: tr(L, 'invitation_sujet'), texte: tr(L, 'invitation_texte', { nom: u.nom || nom, par: String(par).slice(0, 120), lien }) });
  } catch (e) {
    await pool.query('UPDATE jetons_mdp SET utilise_le=now() WHERE jeton_hash=$1', [empreinte(jeton)]);
    throw new ErreurHttp(502, 'courriel_non_configure');
  }
  return { ok: true };
}

module.exports = { demander, reinitialiser, inviter, DUREE_MIN };
