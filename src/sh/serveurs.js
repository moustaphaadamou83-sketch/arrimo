'use strict';
/**
 * Serveurs ajoutés depuis SH (registre) : plusieurs serveurs par pays (région, client ou établissement), chacun isolé.
 * - Ajout, nouveau code d'appairage, rotation de clé, désactivation : administration seule, avec un code de double
 *   authentification redemandé à chaque action (même en session ouverte) ; tout est journalisé.
 * - La clé de service n'est jamais affichée ni rendue par une lecture : SH la garde chiffrée (AES-256-GCM) et la remet une
 *   seule fois au serveur qui présente le code d'appairage (empreinte seule en base, 15 minutes, 5 essais au plus).
 * - Un serveur appairé n'est « relié » qu'après une vérification réussie avec sa clé ; une adresse ou une clé déjà
 *   utilisée par un autre environnement est refusée (une production compromise n'ouvre jamais une autre).
 */
const crypto = require('node:crypto');
const totp = require('../totp');
const { empreinte, chiffrerSecret, dechiffrerSecret } = require('./security');
const { CODE_SERVEUR } = require('./serveurs-migrations');
const cibles = require('./cibles');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DUREE_APPAIRAGE_MIN = 15;
const ESSAIS_MAX = 5;
const TYPES = ['production', 'pilote', 'recette'];
const re = new RegExp(CODE_SERVEUR);

const codeAppairage = () => Array.from(crypto.randomBytes(12), (b) => ALPHABET[b % ALPHABET.length]).join('').replace(/(.{4})(?=.)/g, '$1-');
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const adresse = (v, champ, ErreurSh) => {
  let u = null; try { u = new URL(String(v || '').trim()); } catch { /* refusée plus bas */ }
  // HTTPS obligatoire ; HTTP toléré seulement vers la machine elle-même (même règle que la configuration de base)
  const locale = u && u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.port;
  if (!u || (u.protocol !== 'https:' && !locale) || u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) throw new ErreurSh(400, `${champ} : adresse HTTPS complète requise (ex. https://arrimo.exemple.ca).`);
  return `${u.protocol}//${u.host}`;
};

/** Charge le registre en mémoire pour cibles() (clés déchiffrées seulement en mémoire). */
async function charger(pool, env = process.env) {
  const rows = (await pool.query(`SELECT code, nom, url, public, statut, cle_chiffree, pays_code, region, type FROM sh_serveurs ORDER BY code`).catch(() => ({ rows: [] }))).rows;
  cibles.definirRegistre(rows.map((r) => {
    let cle = '';
    try { cle = dechiffrerSecret(r.cle_chiffree, env) || ''; } catch { cle = ''; }
    return { code: r.code, nom: r.nom, url: r.url, public: r.public, statut: r.statut, cle, pays_code: r.pays_code, region: r.region, type: r.type };
  }));
}

function brancher(api, pool, route, journal, { env = process.env, ErreurSh, appeler }) {
  const presenter = (r) => ({ code: r.code, type: r.type, pays_code: r.pays_code, region: r.region, nom: r.nom, url: r.url, public: r.public, statut: r.statut,
    cree_le: r.cree_le, appaire_le: r.appaire_le, relie_le: r.relie_le, desactive_le: r.desactive_le,
    appairage_en_attente: !!(r.appairage_empreinte && r.appairage_expire > new Date()), appairage_expire: r.appairage_expire });

  /** Double authentification redemandée pour chaque action sensible. */
  async function exiger2fa(req) {
    const u = (await pool.query('SELECT id, totp_secret, totp_actif, totp_dernier_pas FROM sh_utilisateurs WHERE id = $1', [req.u.id])).rows[0];
    if (!u || !u.totp_actif || !u.totp_secret) throw new ErreurSh(403, 'Activez d’abord la double authentification.');
    const pas = totp.verifierCode(dechiffrerSecret(u.totp_secret, env), String(req.body.code_2fa || ''), u.totp_dernier_pas);
    if (!pas) throw new ErreurSh(403, 'Code de double authentification incorrect.');
    await pool.query('UPDATE sh_utilisateurs SET totp_dernier_pas = $2 WHERE id = $1', [u.id, pas]);
  }
  const lire = async (code, db = pool) => {
    const r = (await db.query('SELECT * FROM sh_serveurs WHERE code = $1', [String(code || '')])).rows[0];
    if (!r) throw new ErreurSh(404, 'Serveur introuvable.');
    return r;
  };
  const nouvelAppairage = () => { const c = codeAppairage(); return { code: c, empreinte: empreinte(normCode(c)), expire: new Date(Date.now() + DUREE_APPAIRAGE_MIN * 60000) }; };
  /** Une adresse ou une clé ne sert jamais à deux environnements (fichier de configuration ou registre). */
  const exigerUnique = (code, url) => {
    if (cibles.cibles(env).some((c) => c.code !== code && c.url === url)) throw new ErreurSh(409, 'Cette adresse est déjà celle d’un autre serveur.');
  };

  api.get('/serveurs', route(async () => (await pool.query('SELECT * FROM sh_serveurs ORDER BY pays_code, code')).rows.map(presenter)));

  api.post('/serveurs', route(async (req) => {
    await exiger2fa(req);
    const b = req.body || {};
    const type = String(b.type || '');
    if (!TYPES.includes(type)) throw new ErreurSh(400, 'Type de serveur invalide (production, pilote ou recette).');
    const pays = String(b.pays_code || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(pays) || !Object.hasOwn(require('./donnees-internationales.json').pays, pays)) throw new ErreurSh(400, 'Pays invalide.');
    const suffixe = String(b.suffixe || '').trim().toLowerCase();
    if (suffixe && !/^[a-z0-9]{2,24}$/.test(suffixe)) throw new ErreurSh(400, 'Identifiant du serveur : 2 à 24 lettres minuscules ou chiffres (ex. estrie, chuexemple).');
    const code = `${type}_${pays.toLowerCase()}${suffixe ? `_${suffixe}` : ''}`;
    if (!re.test(code)) throw new ErreurSh(400, 'Code de serveur invalide.');
    if (Object.hasOwn(cibles.nomsEnvironnements(env), code)) throw new ErreurSh(409, 'Un serveur porte déjà ce code.');
    const nom = String(b.nom || '').trim();
    if (nom.length < 2 || nom.length > 60) throw new ErreurSh(400, 'Nom du serveur : 2 à 60 caractères.');
    const region = b.region ? String(b.region).trim().slice(0, 80) : null;
    const url = adresse(b.url, 'Adresse de l’API', ErreurSh); const pub = adresse(b.public || b.url, 'Adresse publique', ErreurSh);
    exigerUnique(code, url);
    const cle = crypto.randomBytes(32).toString('hex');
    const a = nouvelAppairage();
    const r = (await pool.query(`INSERT INTO sh_serveurs (code, type, pays_code, region, nom, url, public, cle_chiffree, cle_empreinte, appairage_empreinte, appairage_expire, cree_par)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [code, type, pays, region, nom, url, pub, chiffrerSecret(cle, env), empreinte(cle), a.empreinte, a.expire, req.u.id])
      .catch((e) => { if (e.code === '23505') throw new ErreurSh(409, 'Ce serveur (code ou adresse) existe déjà.'); throw e; })).rows[0];
    await journal(pool, req.u, 'Serveur ajouté', code, `${nom} · ${pays}${region ? ` · ${region}` : ''} · ${url}`);
    await charger(pool, env);
    // Le code d'appairage n'est montré qu'ici, une seule fois ; la clé ne l'est jamais
    return { serveur: presenter(r), code_appairage: a.code, expire_le: a.expire };
  }));

  api.post('/serveurs/:code/appairage', route(async (req) => {
    await exiger2fa(req);
    const r = await lire(req.params.code);
    if (r.statut === 'desactive') throw new ErreurSh(409, 'Serveur désactivé : réactivez-le d’abord.');
    const a = nouvelAppairage(); const cle = crypto.randomBytes(32).toString('hex');
    // Nouveau code = nouvelle clé : l'ancienne cesse de servir dès que le serveur s'appaire de nouveau
    await pool.query(`UPDATE sh_serveurs SET appairage_empreinte = $2, appairage_expire = $3, appairage_essais = 0, cle_chiffree = $4, cle_empreinte = $5, statut = 'en_attente' WHERE code = $1`,
      [r.code, a.empreinte, a.expire, chiffrerSecret(cle, env), empreinte(cle)]);
    await journal(pool, req.u, 'Serveur : nouveau code d’appairage et nouvelle clé', r.code, null);
    await charger(pool, env);
    return { code_appairage: a.code, expire_le: a.expire };
  }));

  api.post('/serveurs/:code/verifier', route(async (req) => {
    const r = await lire(req.params.code);
    if (!['appaire', 'relie'].includes(r.statut)) throw new ErreurSh(409, 'Le serveur doit d’abord être appairé (code saisi sur le serveur).');
    const c = cibles.cibles(env).find((x) => x.code === r.code);
    if (!c) throw new ErreurSh(409, 'Serveur non chargé.');
    const etabs = await appeler(c, 'GET', '/sh/etablissements');
    // Le pays des établissements déjà présents doit être celui du serveur
    const autres = etabs.filter((e) => e.configuration_code && require('../profils-pays').paysDuProfil({ code: e.configuration_code, pays_code: e.pays_code }) !== r.pays_code);
    if (autres.length) throw new ErreurSh(409, `Ce serveur contient des établissements d’un autre pays (${autres.slice(0, 3).map((e) => e.code).join(', ')}) : vérifiez l’adresse.`);
    await pool.query(`UPDATE sh_serveurs SET statut = 'relie', relie_le = COALESCE(relie_le, now()) WHERE code = $1`, [r.code]);
    await journal(pool, req.u, 'Serveur relié (vérification réussie)', r.code, `${etabs.length} établissement(s)`);
    await charger(pool, env);
    return { statut: 'relie', etablissements: etabs.length };
  }));

  for (const [chemin, statut, action] of [['desactiver', 'desactive', 'Serveur désactivé'], ['reactiver', 'appaire', 'Serveur réactivé']]) {
    api.post(`/serveurs/:code/${chemin}`, route(async (req) => {
      await exiger2fa(req);
      const r = await lire(req.params.code);
      if (statut === 'desactive') await pool.query(`UPDATE sh_serveurs SET statut = 'desactive', desactive_le = now(), appairage_empreinte = NULL WHERE code = $1`, [r.code]);
      else {
        if (r.statut !== 'desactive') throw new ErreurSh(409, 'Ce serveur est déjà actif.');
        await pool.query(`UPDATE sh_serveurs SET statut = CASE WHEN appaire_le IS NULL THEN 'en_attente' ELSE 'appaire' END, desactive_le = NULL WHERE code = $1`, [r.code]);
      }
      await journal(pool, req.u, action, r.code, null);
      await charger(pool, env);
      return presenter(await lire(r.code));
    }));
  }

}

/* Appairage : appelé par le serveur lui-même (script arrimo-appairer), sans session ; code à usage unique. */
function brancherPublic(api, poolService, env = process.env) {
  const essaisIp = new Map();
  api.post('/serveurs/appairage', async (req, res) => {
    const ip = req.ip || 'inconnue'; const t = essaisIp.get(ip) || { n: 0, depuis: Date.now() };
    if (Date.now() - t.depuis > 15 * 60000) { t.n = 0; t.depuis = Date.now(); }
    t.n += 1; essaisIp.set(ip, t);
    if (t.n > 10) return res.status(429).json({ erreur: 'Trop de tentatives. Réessayez dans 15 minutes.' });
    try {
      const code = normCode(req.body && req.body.code_appairage);
      if (code.length !== 12) return res.status(400).json({ erreur: 'Code d’appairage invalide.' });
      const r = (await poolService.query(`UPDATE sh_serveurs SET appairage_empreinte = NULL, appairage_essais = appairage_essais + 1, statut = 'appaire', appaire_le = now()
        WHERE appairage_empreinte = $1 AND appairage_expire > now() AND appairage_essais < $2 AND statut <> 'desactive' RETURNING code, cle_chiffree`, [empreinte(code), ESSAIS_MAX])).rows[0];
      if (!r) return res.status(404).json({ erreur: 'Code d’appairage inconnu, expiré ou déjà utilisé.' });
      await poolService.query(`INSERT INTO sh_journal (utilisateur_id, action, cible, detail) VALUES (NULL, 'Serveur appairé', $1, $2)`, [r.code, `adresse ${String(ip).slice(0, 60)}`]);
      await charger(poolService, env);
      res.json({ environnement: r.code, cle: dechiffrerSecret(r.cle_chiffree, env) });
    } catch (e) { console.error('Appairage :', e.code || e.name); res.status(500).json({ erreur: 'indisponible' }); }
  });
}

module.exports = { charger, brancher, brancherPublic, codeAppairage, normCode };
