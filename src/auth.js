const crypto = require('crypto');
const { ErreurHttp } = require('./db');
const { verifierCode } = require('./totp');

const DUREE_SESSION_H = Number(process.env.SESSION_HEURES || 12);

/** Seule l'empreinte des jetons est stockée : une copie de la base ne permet pas d'ouvrir une session. */
const empreinteJeton = (jeton) => `h:${crypto.createHash('sha256').update(String(jeton)).digest('hex')}`;
/** Valeurs à chercher : l'empreinte, et le jeton brut des sessions ouvertes avant ce changement (12 h au plus). */
const formesJeton = (jeton) => [empreinteJeton(jeton), String(jeton)];
// Empreinte factice : une adresse inconnue coûte le même calcul qu'un mauvais mot de passe (pas d'énumération par le temps).
const HASH_FACTICE = `${'0'.repeat(32)}:${'0'.repeat(128)}`;

/** Secret MFA chiffré si ARRIMO_MFA_ENCRYPTION_KEY est définie (32 octets base64) ; lu en clair sinon (compatibilité). */
function chiffrerSecretMfa(secret) {
  if (!secret || !process.env.ARRIMO_MFA_ENCRYPTION_KEY) return secret;
  return require('./sh/security').chiffrerSecret(secret, { SH_MFA_ENCRYPTION_KEY: process.env.ARRIMO_MFA_ENCRYPTION_KEY });
}
function lireSecretMfa(valeur) {
  if (!valeur || !String(valeur).startsWith('enc:v1:')) return valeur;
  return require('./sh/security').dechiffrerSecret(valeur, { SH_MFA_ENCRYPTION_KEY: process.env.ARRIMO_MFA_ENCRYPTION_KEY });
}

function hacher(motDePasse) {
  const sel = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(motDePasse, sel, 64).toString('hex');
  return `${sel}:${hash}`;
}

// Versions asynchrones : le calcul scrypt (~50 ms) se fait dans le pool de threads de libuv au lieu de bloquer
// la boucle d'événements ; sans cela, 500 connexions simultanées figent toutes les requêtes du serveur.
const scryptAsync = (mdp, sel) => new Promise((ok, ko) => crypto.scrypt(mdp, sel, 64, (e, k) => (e ? ko(e) : ok(k))));
async function hacherAsync(motDePasse) {
  const sel = crypto.randomBytes(16).toString('hex');
  return `${sel}:${(await scryptAsync(motDePasse, sel)).toString('hex')}`;
}
async function verifierAsync(motDePasse, stocke) {
  const [sel, hash] = String(stocke).split(':');
  if (!sel || !hash) return false;
  const calcule = await scryptAsync(motDePasse, sel);
  const attendu = Buffer.from(hash, 'hex');
  return attendu.length === calcule.length && crypto.timingSafeEqual(attendu, calcule);
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
    throw new ErreurHttp(429, 'trop_tentatives');
  }
  if (t && t.expireLe <= Date.now()) tentatives.delete(email);
}
function noterEchec(email) {
  const t = tentatives.get(email) || { n: 0, bloqueJusqua: 0, expireLe: Date.now() + 15 * 60000 };
  t.n += 1;
  if (t.n >= 8) { t.bloqueJusqua = Date.now() + 15 * 60000; t.n = 0; }
  tentatives.set(email, t);
}

async function ouvrirSession(pool, utilisateurId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO sessions (token, utilisateur_id, expire_le) VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [empreinteJeton(token), utilisateurId, DUREE_SESSION_H]);
  await pool.query('UPDATE utilisateurs SET derniere_connexion = now() WHERE id = $1', [utilisateurId]);
  await pool.query('DELETE FROM sessions WHERE expire_le < now()');
  await pool.query('DELETE FROM connexions_2fa WHERE expire_le < now()');
  return token;
}

/** Étape 1 : mot de passe. Retourne une session, ou une étape de double authentification. */
async function connexion(pool, email, motDePasse) {
  email = String(email || '').trim().toLowerCase();
  limiter(email);
  const { rows } = await pool.query('SELECT * FROM utilisateurs WHERE email = $1 AND actif AND NOT invitation_en_attente', [email]);
  const u = rows[0];
  const motDePasseOk = await verifierAsync(String(motDePasse || ''), u ? u.mot_de_passe_hash : HASH_FACTICE);
  if (!u || !motDePasseOk) {
    noterEchec(email);
    throw new ErreurHttp(401, 'identifiants_incorrects');
  }
  tentatives.delete(email);
  if (u.totp_actif) {
    const jeton = crypto.randomBytes(24).toString('hex');
    await pool.query(`INSERT INTO connexions_2fa (jeton, utilisateur_id, expire_le) VALUES ($1, $2, now() + interval '5 minutes')`, [empreinteJeton(jeton), u.id]);
    return { etape: '2fa', jeton };
  }
  return { token: await ouvrirSession(pool, u.id), mdp_temporaire: u.mdp_temporaire };
}

/** Étape 2 : code de l'application d'authentification. 5 essais au plus, valable 5 minutes. */
async function connexion2fa(pool, jeton, code) {
  const r = await pool.query(
    `UPDATE connexions_2fa SET essais = essais + 1 WHERE jeton = $1 AND expire_le > now() RETURNING utilisateur_id, essais`, [empreinteJeton(jeton || '')]);
  if (!r.rows[0]) throw new ErreurHttp(401, 'etape_expiree');
  if (r.rows[0].essais > 5) {
    await pool.query('DELETE FROM connexions_2fa WHERE jeton = $1', [empreinteJeton(jeton)]);
    throw new ErreurHttp(429, 'trop_essais');
  }
  const u = (await pool.query('SELECT * FROM utilisateurs WHERE id = $1 AND actif', [r.rows[0].utilisateur_id])).rows[0];
  const pas = u && verifierCode(lireSecretMfa(u.totp_secret), code, u.totp_dernier_pas);
  if (!pas) throw new ErreurHttp(401, 'code_incorrect_heure');
  await pool.query('UPDATE utilisateurs SET totp_dernier_pas = $2 WHERE id = $1', [u.id, pas]);
  await pool.query('DELETE FROM connexions_2fa WHERE jeton = $1', [empreinteJeton(jeton)]);
  return { token: await ouvrirSession(pool, u.id), mdp_temporaire: u.mdp_temporaire };
}

function verifierRobustesse(mdp) {
  const m = String(mdp || '');
  if (m.length < 12 || !/[A-Za-zÀ-ÿ]/.test(m) || !/\d/.test(m)) {
    throw new ErreurHttp(400, 'mdp_faible');
  }
}

/** Changement de mot de passe par l'utilisateur : ferme ses autres sessions. */
async function changerMotDePasse(pool, utilisateur, actuel, nouveau) {
  const u = (await pool.query('SELECT mot_de_passe_hash FROM utilisateurs WHERE id = $1', [utilisateur.id])).rows[0];
  if (!(await verifierAsync(String(actuel || ''), u.mot_de_passe_hash))) throw new ErreurHttp(401, 'mdp_actuel_incorrect');
  verifierRobustesse(nouveau);
  if (actuel === nouveau) throw new ErreurHttp(400, 'mdp_identique');
  await pool.query('UPDATE utilisateurs SET mot_de_passe_hash = $2, mdp_temporaire = false WHERE id = $1', [utilisateur.id, await hacherAsync(nouveau)]);
  await pool.query('DELETE FROM sessions WHERE utilisateur_id = $1 AND NOT (token = ANY($2::text[]))', [utilisateur.id, formesJeton(utilisateur.token)]);
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
      if (!token) throw new ErreurHttp(401, 'connexion_requise');
      const { rows } = await pool.query(
        `SELECT u.id, u.nom, u.email, u.role, u.totp_actif, u.mdp_temporaire, u.premiers_pas_vus, u.apparence, u.langue_interface, u.preferences_og,
                COALESCE(array_agg(ue.etablissement_id) FILTER (WHERE ue.etablissement_id IS NOT NULL), '{}') AS etabs
           FROM sessions s JOIN utilisateurs u ON u.id = s.utilisateur_id AND u.actif
           LEFT JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id
          WHERE s.token = ANY($1::text[]) AND s.expire_le > now()
          GROUP BY u.id`, [formesJeton(token)]);
      if (!rows[0]) throw new ErreurHttp(401, 'session_expiree');
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
    throw new ErreurHttp(403, 'etab_interdit');
  }
}

module.exports = { hacherAsync, verifierAsync, empreinteJeton, formesJeton, chiffrerSecretMfa, lireSecretMfa, hacher, verifier, connexion, connexion2fa, changerMotDePasse, verifierRobustesse, motDePasseTemporaire,
  exigerSession, peutAgirPour, exigerEtablissement };
