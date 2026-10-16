const crypto = require('crypto');
const { ErreurHttp } = require('./db');
const { verifierCode } = require('./totp');

const DUREE_SESSION_H = Number(process.env.SESSION_HEURES || 12);

function hacher(motDePasse) {
  const sel = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(motDePasse, sel, 64).toString('hex');
  return `${sel}:${hash}`;
}

function verifier(motDePasse, stocke) {
  const [sel, hash] = String(stocke).split(':');
  if (!sel || !hash) return false;
  const calcule = crypto.scryptSync(motDePasse, sel, 64);
  const attendu = Buffer.from(hash, 'hex');
  return attendu.length === calcule.length && crypto.timingSafeEqual(attendu, calcule);
}

// Limite les tentatives de connexion : 8 échecs en 15 min bloquent l'adresse courriel 15 min
const tentatives = new Map();
function limiter(email) {
  const t = tentatives.get(email);
  if (t && t.bloqueJusqua > Date.now()) {
    throw new ErreurHttp(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
  }
}
function noterEchec(email) {
  const t = tentatives.get(email) || { n: 0, bloqueJusqua: 0 };
  t.n += 1;
  if (t.n >= 8) { t.bloqueJusqua = Date.now() + 15 * 60000; t.n = 0; }
  tentatives.set(email, t);
}

async function ouvrirSession(pool, utilisateurId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO sessions (token, utilisateur_id, expire_le) VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [token, utilisateurId, DUREE_SESSION_H]);
  await pool.query('UPDATE utilisateurs SET derniere_connexion = now() WHERE id = $1', [utilisateurId]);
  await pool.query('DELETE FROM sessions WHERE expire_le < now()');
  await pool.query('DELETE FROM connexions_2fa WHERE expire_le < now()');
  return token;
}

/** Étape 1 : mot de passe. Retourne une session, ou une étape de double authentification. */
async function connexion(pool, email, motDePasse) {
  email = String(email || '').trim().toLowerCase();
  limiter(email);
  const { rows } = await pool.query('SELECT * FROM utilisateurs WHERE email = $1 AND actif', [email]);
  const u = rows[0];
  if (!u || !verifier(String(motDePasse || ''), u.mot_de_passe_hash)) {
    noterEchec(email);
    throw new ErreurHttp(401, 'Adresse courriel ou mot de passe incorrect.');
  }
  tentatives.delete(email);
  if (u.totp_actif) {
    const jeton = crypto.randomBytes(24).toString('hex');
    await pool.query(`INSERT INTO connexions_2fa (jeton, utilisateur_id, expire_le) VALUES ($1, $2, now() + interval '5 minutes')`, [jeton, u.id]);
    return { etape: '2fa', jeton };
  }
  return { token: await ouvrirSession(pool, u.id), mdp_temporaire: u.mdp_temporaire };
}

/** Étape 2 : code de l'application d'authentification. 5 essais au plus, valable 5 minutes. */
async function connexion2fa(pool, jeton, code) {
  const r = await pool.query(
    `UPDATE connexions_2fa SET essais = essais + 1 WHERE jeton = $1 AND expire_le > now() RETURNING utilisateur_id, essais`, [String(jeton || '')]);
  if (!r.rows[0]) throw new ErreurHttp(401, 'Étape expirée. Reprenez la connexion.');
  if (r.rows[0].essais > 5) {
    await pool.query('DELETE FROM connexions_2fa WHERE jeton = $1', [jeton]);
    throw new ErreurHttp(429, 'Trop d’essais. Reprenez la connexion.');
  }
  const u = (await pool.query('SELECT * FROM utilisateurs WHERE id = $1 AND actif', [r.rows[0].utilisateur_id])).rows[0];
  const pas = u && verifierCode(u.totp_secret, code, u.totp_dernier_pas);
  if (!pas) throw new ErreurHttp(401, 'Code incorrect. Vérifiez l’heure de votre téléphone et réessayez.');
  await pool.query('UPDATE utilisateurs SET totp_dernier_pas = $2 WHERE id = $1', [u.id, pas]);
  await pool.query('DELETE FROM connexions_2fa WHERE jeton = $1', [jeton]);
  return { token: await ouvrirSession(pool, u.id), mdp_temporaire: u.mdp_temporaire };
}

function verifierRobustesse(mdp) {
  const m = String(mdp || '');
  if (m.length < 12 || !/[A-Za-zÀ-ÿ]/.test(m) || !/\d/.test(m)) {
    throw new ErreurHttp(400, 'Le mot de passe doit contenir au moins 12 caractères, dont des lettres et des chiffres.');
  }
}

/** Changement de mot de passe par l'utilisateur : ferme ses autres sessions. */
async function changerMotDePasse(pool, utilisateur, actuel, nouveau) {
  const u = (await pool.query('SELECT mot_de_passe_hash FROM utilisateurs WHERE id = $1', [utilisateur.id])).rows[0];
  if (!verifier(String(actuel || ''), u.mot_de_passe_hash)) throw new ErreurHttp(401, 'Mot de passe actuel incorrect.');
  verifierRobustesse(nouveau);
  if (actuel === nouveau) throw new ErreurHttp(400, 'Choisissez un mot de passe différent de l’actuel.');
  await pool.query('UPDATE utilisateurs SET mot_de_passe_hash = $2, mdp_temporaire = false WHERE id = $1', [utilisateur.id, hacher(nouveau)]);
  await pool.query('DELETE FROM sessions WHERE utilisateur_id = $1 AND token <> $2', [utilisateur.id, utilisateur.token]);
}

/** Mot de passe temporaire lisible, à changer à la première connexion. */
function motDePasseTemporaire() {
  const lettres = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  let m = '';
  for (let i = 0; i < 10; i += 1) m += lettres[crypto.randomInt(lettres.length)];
  return `${m.slice(0, 5)}-${m.slice(5)}-${crypto.randomInt(1000, 9999)}`;
}

/** Middleware : charge l'utilisateur et la liste de ses établissements. */
function exigerSession(pool) {
  return async (req, res, next) => {
    try {
      const entete = req.get('authorization') || '';
      const token = entete.startsWith('Bearer ') ? entete.slice(7) : null;
      if (!token) throw new ErreurHttp(401, 'Connexion requise.');
      const { rows } = await pool.query(
        `SELECT u.id, u.nom, u.email, u.role, u.totp_actif, u.mdp_temporaire,
                COALESCE(array_agg(ue.etablissement_id) FILTER (WHERE ue.etablissement_id IS NOT NULL), '{}') AS etabs
           FROM sessions s JOIN utilisateurs u ON u.id = s.utilisateur_id AND u.actif
           LEFT JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id
          WHERE s.token = $1 AND s.expire_le > now()
          GROUP BY u.id`, [token]);
      if (!rows[0]) throw new ErreurHttp(401, 'Session expirée. Reconnectez-vous.');
      req.utilisateur = { ...rows[0], token, gestionnaire: rows[0].role === 'gestionnaire',
        admin: ['gestionnaire', 'admin_etab'].includes(rows[0].role) };
      next();
    } catch (err) { next(err); }
  };
}

function peutAgirPour(utilisateur, etablissementId) {
  return utilisateur.gestionnaire || utilisateur.etabs.includes(Number(etablissementId));
}

function exigerEtablissement(utilisateur, etablissementId) {
  if (!peutAgirPour(utilisateur, etablissementId)) {
    throw new ErreurHttp(403, "Vous n'avez pas accès à cet établissement.");
  }
}

module.exports = { hacher, verifier, connexion, connexion2fa, changerMotDePasse, verifierRobustesse, motDePasseTemporaire,
  exigerSession, peutAgirPour, exigerEtablissement };
