/**
 * Console SH (siège) : application séparée, servie sur sh.<domaine>, avec sa propre base (arrimo_sh).
 * Accès réservé à l'équipe SH ; double authentification obligatoire dès la première connexion ; journal immuable.
 * Elle pilote les hôpitaux clients dans chaque environnement par son API (clé de service), sans jamais voir de donnée de patient.
 */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { transaction, ErreurHttp } = require('../db');
const { hacher, verifier, motDePasseTemporaire, verifierRobustesse } = require('../auth');
const totp = require('../totp');
const { limiteur } = require('../limites');
const { version } = require('../../package.json');
const { ETAPES, RANG_GOLIVE, ELEMENT_IMPORT, creerEtapes } = require('./etapes');
const { cibles, appeler, lienAcces, ErreurCible } = require('./cibles');

/** Erreur de la console : statut HTTP et message en français (console interne, en français seulement). */
class ErreurSh extends Error {
  constructor(statut, message) { super(message); this.statut = statut; }
}

const DUREE_SESSION_H = Number(process.env.SH_SESSION_HEURES || 8);
const STATUTS = ['prospect', 'implantation', 'actif', 'suspendu'];
const TYPES_IMPORT = Object.keys(ELEMENT_IMPORT);
const COURRIEL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_ETAB = /^[A-Z0-9-]{2,12}$/;
const SOUS_DOMAINE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const RESERVES = ['www', 'sh', 'recette', 'api', 'demo', 'admin', 'mail'];
const PUBLIC_SH = path.join(__dirname, '..', '..', 'public-sh');
const PUBLIC = path.join(__dirname, '..', '..', 'public');

const texte = (v, max = 200) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const entier = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new ErreurSh(400, 'Paramètre invalide.'); return n; };
const dateOuNull = (v) => {
  if (v == null || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(new Date(v).getTime())) throw new ErreurSh(400, 'Date invalide (AAAA-MM-JJ).');
  return String(v);
};

async function journal(db, u, action, cible, detail, hopitalId = null) {
  await db.query('INSERT INTO sh_journal (utilisateur_id, hopital_id, action, cible, detail) VALUES ($1, $2, $3, $4, $5)',
    [u ? u.id : null, hopitalId, action, cible, detail]);
}

function creerAppSh(pool, { env = process.env } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use('/api', limiteur());
  app.use('/api/hopitaux/:id/import', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '50kb' }));
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    });
    next();
  });
  // Interface de la console, et les fichiers partagés avec Arrimo (charte, icônes, police, mise en forme des nombres)
  app.use(express.static(PUBLIC_SH));
  for (const f of ['style.css', 'icones.svg', 'logo.svg', 'i18n/format.js', 'i18n/fr.js']) app.get(`/${f}`, (req, res) => res.sendFile(path.join(PUBLIC, f)));
  app.use('/polices', express.static(path.join(PUBLIC, 'polices')));

  const ciblesSh = () => cibles(env);
  const cible = (code) => {
    const c = ciblesSh().find((x) => x.code === code);
    if (!c) throw new ErreurSh(400, `L’environnement « ${code} » n’est pas relié à la console.`);
    return c;
  };

  const api = express.Router();
  const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((r) => res.json(r ?? { ok: true })).catch(next);

  api.get('/sante', async (req, res) => {
    try { await pool.query('SELECT 1'); res.json({ etat: 'ok', version, base: 'ok' }); } catch { res.status(503).json({ etat: 'degrade', base: 'injoignable' }); }
  });

  /* ---------------------------------------------------------------- connexion */
  const tentatives = new Map();
  async function ouvrirSession(u) {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(`INSERT INTO sh_sessions (token, utilisateur_id, expire_le) VALUES ($1, $2, now() + make_interval(hours => $3))`, [token, u.id, DUREE_SESSION_H]);
    await pool.query('UPDATE sh_utilisateurs SET derniere_connexion = now() WHERE id = $1', [u.id]);
    await pool.query('DELETE FROM sh_sessions WHERE expire_le < now()');
    await pool.query('DELETE FROM sh_connexions_2fa WHERE expire_le < now()');
    await journal(pool, u, 'Connexion', u.email, null);
    return { token };
  }
  api.post('/connexion', route(async (req) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const t = tentatives.get(email);
    if (t && t.bloque > Date.now()) throw new ErreurSh(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
    const u = (await pool.query('SELECT * FROM sh_utilisateurs WHERE email = $1 AND actif', [email])).rows[0];
    if (!u || !verifier(String(req.body.mot_de_passe || ''), u.mot_de_passe_hash)) {
      const n = (t ? t.n : 0) + 1;
      tentatives.set(email, n >= 5 ? { n: 0, bloque: Date.now() + 15 * 60000 } : { n, bloque: 0 });
      throw new ErreurSh(401, 'Adresse courriel ou mot de passe incorrect.');
    }
    tentatives.delete(email);
    if (u.totp_actif) {
      const jeton = crypto.randomBytes(24).toString('hex');
      await pool.query(`INSERT INTO sh_connexions_2fa (jeton, utilisateur_id, expire_le) VALUES ($1, $2, now() + interval '5 minutes')`, [jeton, u.id]);
      return { etape: '2fa', jeton };
    }
    return ouvrirSession(u);
  }));
  api.post('/connexion/2fa', route(async (req) => {
    const r = await pool.query(`UPDATE sh_connexions_2fa SET essais = essais + 1 WHERE jeton = $1 AND expire_le > now() RETURNING utilisateur_id, essais`, [String(req.body.jeton || '')]);
    if (!r.rows[0]) throw new ErreurSh(401, 'Étape expirée. Reprenez la connexion.');
    if (r.rows[0].essais > 5) { await pool.query('DELETE FROM sh_connexions_2fa WHERE jeton = $1', [req.body.jeton]); throw new ErreurSh(429, 'Trop d’essais. Reprenez la connexion.'); }
    const u = (await pool.query('SELECT * FROM sh_utilisateurs WHERE id = $1 AND actif', [r.rows[0].utilisateur_id])).rows[0];
    const pas = u && totp.verifierCode(u.totp_secret, req.body.code, u.totp_dernier_pas);
    if (!pas) throw new ErreurSh(401, 'Code incorrect. Vérifiez l’heure de votre téléphone et réessayez.');
    await pool.query('UPDATE sh_utilisateurs SET totp_dernier_pas = $2 WHERE id = $1', [u.id, pas]);
    await pool.query('DELETE FROM sh_connexions_2fa WHERE jeton = $1', [req.body.jeton]);
    return ouvrirSession(u);
  }));

  /* ---------------------------------------------------------------- session obligatoire pour la suite */
  api.use(async (req, res, next) => {
    try {
      const entete = req.get('authorization') || '';
      const token = entete.startsWith('Bearer ') ? entete.slice(7) : null;
      if (!token) throw new ErreurSh(401, 'Connexion requise.');
      const u = (await pool.query(`SELECT u.id, u.email, u.nom, u.mdp_temporaire, u.totp_actif FROM sh_sessions s
        JOIN sh_utilisateurs u ON u.id = s.utilisateur_id AND u.actif WHERE s.token = $1 AND s.expire_le > now()`, [token])).rows[0];
      if (!u) throw new ErreurSh(401, 'Session expirée. Reconnectez-vous.');
      req.u = { ...u, token };
      // Première connexion : choisir son mot de passe, puis activer la double authentification ; rien d'autre avant
      const p = `${req.method} ${req.path}`;
      if (u.mdp_temporaire && !['GET /moi', 'PUT /moi/mot-de-passe', 'POST /deconnexion'].includes(p)) throw new ErreurSh(403, 'Choisissez d’abord votre propre mot de passe.');
      if (!u.totp_actif && !['GET /moi', 'PUT /moi/mot-de-passe', 'POST /moi/2fa/preparer', 'POST /moi/2fa/activer', 'POST /deconnexion'].includes(p)) {
        throw new ErreurSh(403, 'Activez d’abord la double authentification.');
      }
      next();
    } catch (e) { next(e); }
  });

  api.post('/deconnexion', route(async (req) => { await pool.query('DELETE FROM sh_sessions WHERE token = $1', [req.u.token]); }));
  api.get('/moi', route(async (req) => ({
    utilisateur: { id: req.u.id, nom: req.u.nom, email: req.u.email, mdp_temporaire: req.u.mdp_temporaire, totp_actif: req.u.totp_actif },
    environnements: ciblesSh().map((c) => ({ code: c.code, nom: c.nom, public: c.public })),
    etapes: ETAPES.map((e, i) => ({ rang: i + 1, code: e.code, nom: e.nom })),
    types_import: TYPES_IMPORT,
  })));
  api.put('/moi/mot-de-passe', route(async (req) => {
    const u = (await pool.query('SELECT mot_de_passe_hash FROM sh_utilisateurs WHERE id = $1', [req.u.id])).rows[0];
    if (!verifier(String(req.body.actuel || ''), u.mot_de_passe_hash)) throw new ErreurSh(401, 'Mot de passe actuel incorrect.');
    verifierRobustesse(req.body.nouveau);
    if (req.body.actuel === req.body.nouveau) throw new ErreurSh(400, 'Choisissez un mot de passe différent de l’actuel.');
    await pool.query('UPDATE sh_utilisateurs SET mot_de_passe_hash = $2, mdp_temporaire = false WHERE id = $1', [req.u.id, hacher(req.body.nouveau)]);
    await pool.query('DELETE FROM sh_sessions WHERE utilisateur_id = $1 AND token <> $2', [req.u.id, req.u.token]);
    await journal(pool, req.u, 'Mot de passe changé', req.u.email, null);
  }));
  api.post('/moi/2fa/preparer', route(async (req) => {
    if (req.u.totp_actif) throw new ErreurSh(409, 'La double authentification est déjà active.');
    const secret = totp.nouveauSecret();
    await pool.query('UPDATE sh_utilisateurs SET totp_secret = $2, totp_dernier_pas = 0 WHERE id = $1', [req.u.id, secret]);
    const lien = totp.uri(secret, req.u.email, 'Arrimo SH');
    return { secret, qr_svg: await QRCode.toString(lien, { type: 'svg', margin: 1, width: 200 }) };
  }));
  api.post('/moi/2fa/activer', route(async (req) => {
    const u = (await pool.query('SELECT totp_secret, totp_actif FROM sh_utilisateurs WHERE id = $1', [req.u.id])).rows[0];
    if (u.totp_actif) throw new ErreurSh(409, 'La double authentification est déjà active.');
    if (!u.totp_secret) throw new ErreurSh(400, 'Commencez par afficher le code QR.');
    const pas = totp.verifierCode(u.totp_secret, req.body.code, 0);
    if (!pas) throw new ErreurSh(400, 'Code incorrect.');
    await pool.query('UPDATE sh_utilisateurs SET totp_actif = true, totp_dernier_pas = $2 WHERE id = $1', [req.u.id, pas]);
    await journal(pool, req.u, 'Double authentification activée', req.u.email, null);
  }));

  /* ---------------------------------------------------------------- environnements */
  /** Établissements de chaque environnement (par code), ou null s'il ne répond pas. */
  async function etablissementsDistants(codes) {
    const res = {};
    await Promise.all(ciblesSh().filter((c) => !codes || codes.includes(c.code)).map(async (c) => {
      try { res[c.code] = Object.fromEntries((await appeler(c, 'GET', '/sh/etablissements')).map((e) => [e.code, e])); } catch { res[c.code] = null; }
    }));
    return res;
  }
  api.get('/environnements', route(async () => {
    const dist = await etablissementsDistants();
    return ciblesSh().map((c) => ({ code: c.code, nom: c.nom, public: c.public, joignable: !!dist[c.code], etablissements: dist[c.code] ? Object.keys(dist[c.code]).length : null }));
  }));

  /* ---------------------------------------------------------------- hôpitaux */
  const SELECT_HOPITAL = `SELECT h.*,
      (SELECT count(*)::int FROM verifications v JOIN etapes e ON e.id = v.etape_id WHERE e.hopital_id = h.id) AS total,
      (SELECT count(*)::int FROM verifications v JOIN etapes e ON e.id = v.etape_id WHERE e.hopital_id = h.id AND v.faite) AS faites,
      (SELECT min(e.rang) FROM etapes e WHERE e.hopital_id = h.id AND EXISTS (SELECT 1 FROM verifications v WHERE v.etape_id = e.id AND NOT v.faite)) AS etape_en_cours
    FROM hopitaux h`;
  const presenter = (h, dist) => {
    const c = ciblesSh().find((x) => x.code === h.environnement);
    const d = dist && dist[h.environnement];
    return { ...h, lien: lienAcces(c, h.sous_domaine), environnement_relie: !!c,
      distant: d === undefined ? undefined : d === null ? { injoignable: true } : (d[h.code_etab] || null) };
  };
  async function hopital(id, db = pool) {
    const h = (await db.query(`${SELECT_HOPITAL} WHERE h.id = $1`, [id])).rows[0];
    if (!h) throw new ErreurSh(404, 'Hôpital introuvable.');
    return h;
  }

  api.get('/hopitaux', route(async (req) => {
    const vals = []; const conds = [];
    if (req.query.q) { vals.push(`%${String(req.query.q).trim().toLowerCase()}%`); conds.push(`(lower(h.nom) LIKE $${vals.length} OR lower(coalesce(h.ville, '')) LIKE $${vals.length} OR lower(h.code_etab) LIKE $${vals.length})`); }
    if (STATUTS.includes(req.query.statut)) { vals.push(req.query.statut); conds.push(`h.statut = $${vals.length}`); }
    if (['demo', 'recette', 'production'].includes(req.query.environnement)) { vals.push(req.query.environnement); conds.push(`h.environnement = $${vals.length}`); }
    const rows = (await pool.query(`${SELECT_HOPITAL} ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''} ORDER BY h.nom`, vals)).rows;
    const dist = await etablissementsDistants([...new Set(rows.map((h) => h.environnement))]);
    return rows.map((h) => presenter(h, dist));
  }));

  function champsHopital(b, existant = {}) {
    const v = {
      nom: texte(b.nom ?? existant.nom, 120),
      adresse: texte(b.adresse ?? existant.adresse),
      ville: texte(b.ville ?? existant.ville, 80),
      contact_nom: texte(b.contact_nom ?? existant.contact_nom, 120),
      contact_courriel: texte(b.contact_courriel ?? existant.contact_courriel, 120),
      contact_telephone: texte(b.contact_telephone ?? existant.contact_telephone, 40),
      environnement: String(b.environnement ?? existant.environnement ?? ''),
      code_etab: String(b.code_etab ?? existant.code_etab ?? '').trim().toUpperCase(),
      sous_domaine: b.sous_domaine !== undefined ? (texte(b.sous_domaine, 32) || '').toLowerCase() || null : existant.sous_domaine ?? null,
      latitude: b.latitude !== undefined ? b.latitude : existant.latitude,
      longitude: b.longitude !== undefined ? b.longitude : existant.longitude,
    };
    if (!v.nom) throw new ErreurSh(400, 'Le nom de l’hôpital est requis.');
    if (!['demo', 'recette', 'production'].includes(v.environnement)) throw new ErreurSh(400, 'Choisissez l’environnement : démonstration, recette ou production.');
    if (!CODE_ETAB.test(v.code_etab)) throw new ErreurSh(400, 'Code d’établissement invalide : 2 à 12 lettres majuscules, chiffres ou tirets (ex. HOP-A).');
    if (v.contact_courriel && !COURRIEL.test(v.contact_courriel)) throw new ErreurSh(400, 'Courriel du contact invalide.');
    if (v.sous_domaine && (!SOUS_DOMAINE.test(v.sous_domaine) || RESERVES.includes(v.sous_domaine))) throw new ErreurSh(400, 'Lien invalide : lettres minuscules, chiffres et tirets (ex. hopital-x).');
    for (const k of ['latitude', 'longitude']) {
      if (v[k] === '' || v[k] == null) { v[k] = null; continue; }
      const n = Number(String(v[k]).replace(',', '.'));
      if (!Number.isFinite(n) || Math.abs(n) > (k === 'latitude' ? 90 : 180)) throw new ErreurSh(400, 'Position invalide : latitude et longitude en degrés (ex. 45,4 et -71,89).');
      v[k] = n;
    }
    return v;
  }
  const unique = (e) => {
    if (e.code === '23505') throw new ErreurSh(409, String(e.constraint || '').includes('sous_domaine') ? 'Ce lien est déjà utilisé dans cet environnement.' : 'Ce code d’établissement existe déjà dans cet environnement.');
    throw e;
  };

  api.post('/hopitaux', route(async (req) => {
    const v = champsHopital(req.body);
    const id = await transaction(pool, async (c) => {
      const h = (await c.query(`INSERT INTO hopitaux (nom, adresse, ville, contact_nom, contact_courriel, contact_telephone, environnement, code_etab, sous_domaine, latitude, longitude)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [v.nom, v.adresse, v.ville, v.contact_nom, v.contact_courriel, v.contact_telephone, v.environnement, v.code_etab, v.sous_domaine, v.latitude, v.longitude]).catch(unique)).rows[0].id;
      await creerEtapes(c, h);
      await journal(c, req.u, 'Hôpital créé', `${v.code_etab} · ${v.nom}`, `environnement ${v.environnement}`, h);
      return h;
    });
    return hopital(id);
  }));

  api.get('/hopitaux/:id', route(async (req) => {
    const h = await hopital(entier(req.params.id));
    const etapes = (await pool.query(`SELECT e.*, COALESCE(json_agg(v.* ORDER BY v.rang) FILTER (WHERE v.id IS NOT NULL), '[]') AS verifications
      FROM etapes e LEFT JOIN verifications v ON v.etape_id = e.id WHERE e.hopital_id = $1 GROUP BY e.id ORDER BY e.rang`, [h.id])).rows
      .map((e) => ({ ...e, nom: ETAPES[e.rang - 1].nom }));
    const imports = (await pool.query('SELECT * FROM imports WHERE hopital_id = $1 ORDER BY quand DESC LIMIT 50', [h.id])).rows;
    const activations = (await pool.query('SELECT * FROM activations WHERE hopital_id = $1 ORDER BY quand DESC LIMIT 50', [h.id])).rows;
    const manquants = etapes.filter((e) => e.rang < RANG_GOLIVE).flatMap((e) => e.verifications.filter((x) => !x.faite).map((x) => `${e.nom} : ${x.libelle}`));
    return { ...presenter(h, await etablissementsDistants([h.environnement])), etapes, imports, activations, manquants, peut_activer: h.relie && !manquants.length };
  }));

  api.put('/hopitaux/:id', route(async (req) => {
    const avant = await hopital(entier(req.params.id));
    const v = champsHopital(req.body, avant);
    if (avant.relie && (v.environnement !== avant.environnement || v.code_etab !== avant.code_etab)) {
      throw new ErreurSh(409, 'L’hôpital est déjà relié à son établissement : l’environnement et le code ne peuvent plus changer.');
    }
    let statut = avant.statut;
    if (req.body.statut !== undefined && req.body.statut !== avant.statut) {
      if (!['prospect', 'implantation'].includes(req.body.statut) || !['prospect', 'implantation'].includes(avant.statut)) {
        throw new ErreurSh(409, 'Les statuts « actif » et « suspendu » suivent l’activation et la désactivation du module.');
      }
      statut = req.body.statut;
    }
    // Le lien propre est aussi réglé dans l'environnement, si l'établissement y existe
    if (avant.relie && v.sous_domaine !== avant.sous_domaine) {
      await appeler(cible(avant.environnement), 'PUT', `/sh/etablissements/${avant.code_etab}`, { sous_domaine: v.sous_domaine, par: req.u.email });
    }
    const changes = Object.keys(v).filter((k) => String(v[k] ?? '') !== String(avant[k] ?? '')).concat(statut !== avant.statut ? ['statut'] : []);
    await transaction(pool, async (c) => {
      await c.query(`UPDATE hopitaux SET nom = $2, adresse = $3, ville = $4, contact_nom = $5, contact_courriel = $6, contact_telephone = $7,
        environnement = $8, code_etab = $9, sous_domaine = $10, latitude = $11, longitude = $12, statut = $13 WHERE id = $1`,
      [avant.id, v.nom, v.adresse, v.ville, v.contact_nom, v.contact_courriel, v.contact_telephone, v.environnement, v.code_etab, v.sous_domaine, v.latitude, v.longitude, statut]).catch(unique);
      if (v.sous_domaine && avant.relie) await cocher(c, avant.id, 'lien_defini', req.u);
      if (changes.length) await journal(c, req.u, 'Fiche modifiée', `${v.code_etab} · ${v.nom}`, changes.join(', '), avant.id);
    });
    return hopital(avant.id);
  }));

  /** Coche un élément de la liste de vérification (automatique), et passe un prospect en implantation. */
  async function cocher(c, hopitalId, code, u, faite = true) {
    const r = (await c.query(`UPDATE verifications v SET faite = $3, par = CASE WHEN $3 THEN $4 ELSE NULL END, quand = CASE WHEN $3 THEN now() ELSE NULL END
      FROM etapes e WHERE e.id = v.etape_id AND e.hopital_id = $1 AND v.code = $2 AND v.faite <> $3 RETURNING v.etape_id`, [hopitalId, code, faite, u.email])).rows[0];
    if (r && faite) {
      await c.query(`UPDATE etapes SET date_reelle = current_date WHERE id = $1 AND date_reelle IS NULL
        AND NOT EXISTS (SELECT 1 FROM verifications WHERE etape_id = $1 AND NOT faite)`, [r.etape_id]);
      await c.query(`UPDATE hopitaux SET statut = 'implantation' WHERE id = $1 AND statut = 'prospect'`, [hopitalId]);
    }
    return r;
  }

  /** Relie l'hôpital à son établissement dans l'environnement : le crée s'il n'existe pas (inactif), règle son lien propre. */
  api.post('/hopitaux/:id/relier', route(async (req) => {
    const h = await hopital(entier(req.params.id));
    const c = cible(h.environnement);
    const existants = await appeler(c, 'GET', '/sh/etablissements');
    let cree = false;
    if (!existants.some((e) => e.code === h.code_etab)) {
      if (h.latitude == null || h.longitude == null) throw new ErreurSh(400, 'Indiquez la position de l’hôpital (latitude et longitude) avant de créer son établissement.');
      await appeler(c, 'POST', '/sh/etablissements', { code: h.code_etab, nom: h.nom, ville: h.ville, adresse: h.adresse, latitude: h.latitude, longitude: h.longitude, par: req.u.email });
      cree = true;
    }
    if (h.sous_domaine) await appeler(c, 'PUT', `/sh/etablissements/${h.code_etab}`, { sous_domaine: h.sous_domaine, par: req.u.email });
    await transaction(pool, async (db) => {
      await db.query('UPDATE hopitaux SET relie = true WHERE id = $1', [h.id]);
      await cocher(db, h.id, 'etablissement_cree', req.u);
      if (h.sous_domaine) await cocher(db, h.id, 'lien_defini', req.u);
      await journal(db, req.u, cree ? 'Établissement créé' : 'Établissement relié', `${h.code_etab} · ${h.nom}`, `environnement ${h.environnement}`, h.id);
    });
    return { cree };
  }));

  /* ---------------------------------------------------------------- projet d'implantation */
  api.put('/etapes/:id', route(async (req) => {
    const e = (await pool.query('SELECT e.*, h.nom AS hopital, h.code_etab FROM etapes e JOIN hopitaux h ON h.id = e.hopital_id WHERE e.id = $1', [entier(req.params.id)])).rows[0];
    if (!e) throw new ErreurSh(404, 'Étape introuvable.');
    const b = req.body;
    const v = {
      date_prevue: b.date_prevue !== undefined ? dateOuNull(b.date_prevue) : e.date_prevue,
      date_reelle: b.date_reelle !== undefined ? dateOuNull(b.date_reelle) : e.date_reelle,
      responsable: b.responsable !== undefined ? texte(b.responsable, 120) : e.responsable,
      notes: b.notes !== undefined ? texte(b.notes, 4000) : e.notes,
    };
    await pool.query('UPDATE etapes SET date_prevue = $2, date_reelle = $3, responsable = $4, notes = $5 WHERE id = $1', [e.id, v.date_prevue, v.date_reelle, v.responsable, v.notes]);
    await journal(pool, req.u, 'Étape modifiée', `${e.code_etab} · ${ETAPES[e.rang - 1].nom}`, Object.keys(b).filter((k) => k in v).join(', '), e.hopital_id);
  }));

  api.put('/verifications/:id', route(async (req) => {
    const x = (await pool.query(`SELECT v.*, e.hopital_id, e.rang AS etape_rang, h.code_etab FROM verifications v JOIN etapes e ON e.id = v.etape_id
      JOIN hopitaux h ON h.id = e.hopital_id WHERE v.id = $1`, [entier(req.params.id)])).rows[0];
    if (!x) throw new ErreurSh(404, 'Élément introuvable.');
    if (x.code === 'module_active') throw new ErreurSh(409, 'Cet élément suit l’activation du module : utilisez le bouton Activer.');
    const faite = !!req.body.faite;
    await transaction(pool, async (c) => {
      await cocher(c, x.hopital_id, x.code, req.u, faite);
      await journal(c, req.u, faite ? 'Élément coché' : 'Élément décoché', `${x.code_etab} · ${ETAPES[x.etape_rang - 1].nom}`, x.libelle, x.hopital_id);
    });
  }));

  /* ---------------------------------------------------------------- activation et désactivation du module */
  api.post('/hopitaux/:id/activation', route(async (req) => {
    const h = await hopital(entier(req.params.id));
    if (!h.relie) throw new ErreurSh(409, 'Reliez d’abord l’hôpital à son établissement.');
    const manque = (await pool.query(`SELECT count(*)::int AS n FROM verifications v JOIN etapes e ON e.id = v.etape_id
      WHERE e.hopital_id = $1 AND e.rang < $2 AND NOT v.faite`, [h.id, RANG_GOLIVE])).rows[0].n;
    if (manque) throw new ErreurSh(409, `Activation impossible : ${manque} élément${manque > 1 ? 's' : ''} à cocher avant le go-live.`);
    await appeler(cible(h.environnement), 'PUT', `/sh/etablissements/${h.code_etab}`, { module_actif: true, par: req.u.email });
    await transaction(pool, async (c) => {
      await c.query(`INSERT INTO activations (hopital_id, action, par) VALUES ($1, 'activation', $2)`, [h.id, req.u.email]);
      await c.query(`UPDATE hopitaux SET statut = 'actif' WHERE id = $1`, [h.id]);
      await cocher(c, h.id, 'module_active', req.u);
      await journal(c, req.u, 'Module activé', `${h.code_etab} · ${h.nom}`, `environnement ${h.environnement}`, h.id);
    });
  }));
  api.post('/hopitaux/:id/desactivation', route(async (req) => {
    const h = await hopital(entier(req.params.id));
    const motif = texte(req.body.motif, 300);
    if (!motif || motif.length < 3) throw new ErreurSh(400, 'Indiquez le motif de la désactivation.');
    if (!h.relie) throw new ErreurSh(409, 'L’hôpital n’est pas encore relié à son établissement.');
    await appeler(cible(h.environnement), 'PUT', `/sh/etablissements/${h.code_etab}`, { module_actif: false, motif, par: req.u.email });
    await transaction(pool, async (c) => {
      await c.query(`INSERT INTO activations (hopital_id, action, motif, par) VALUES ($1, 'desactivation', $2, $3)`, [h.id, motif, req.u.email]);
      await c.query(`UPDATE hopitaux SET statut = 'suspendu' WHERE id = $1`, [h.id]);
      await cocher(c, h.id, 'module_active', req.u, false);
      await journal(c, req.u, 'Module désactivé', `${h.code_etab} · ${h.nom}`, `motif : ${motif}`, h.id);
    });
  }));

  /* ---------------------------------------------------------------- import CSV (par l'API de l'environnement) */
  const typeImport = (t) => { if (!TYPES_IMPORT.includes(t)) throw new ErreurSh(400, 'Type de fichier inconnu.'); return t; };
  api.get('/hopitaux/:id/import/modeles/:type', async (req, res, next) => {
    try {
      const h = await hopital(entier(req.params.id));
      const type = typeImport(req.params.type);
      const csv = await appeler(cible(h.environnement), 'GET', `/sh/import/modeles/${type}`, null, { brut: true });
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="arrimo-${type}.csv"` }).send(csv);
    } catch (e) { next(e); }
  });
  api.post('/hopitaux/:id/import/verifier', route(async (req) => {
    const h = await hopital(entier(req.params.id));
    if (!h.relie) throw new ErreurSh(409, 'Reliez d’abord l’hôpital à son établissement.');
    return appeler(cible(h.environnement), 'POST', '/sh/import/verifier', { code: h.code_etab, type: typeImport(req.body.type), contenu: String(req.body.contenu || '') });
  }));
  api.post('/hopitaux/:id/import/importer', route(async (req) => {
    const h = await hopital(entier(req.params.id));
    if (!h.relie) throw new ErreurSh(409, 'Reliez d’abord l’hôpital à son établissement.');
    const type = typeImport(req.body.type);
    const r = await appeler(cible(h.environnement), 'POST', '/sh/import/importer',
      { code: h.code_etab, type, contenu: String(req.body.contenu || ''), empreinte: String(req.body.empreinte || ''), par: req.u.email });
    // Gardé : l'empreinte et les compteurs. Jamais le contenu ni les mots de passe (rendus une seule fois au navigateur).
    await transaction(pool, async (c) => {
      await c.query(`INSERT INTO imports (hopital_id, type, empreinte, lignes, creations, mises_a_jour, inchangees, auteur) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [h.id, type, String(req.body.empreinte).slice(0, 64), r.lignes, r.resume.creer, r.resume.maj, r.resume.inchange, req.u.email]);
      await cocher(c, h.id, ELEMENT_IMPORT[type], req.u);
      await journal(c, req.u, 'Import CSV', `${h.code_etab} · ${type}`,
        `créations : ${r.resume.creer} · mises à jour : ${r.resume.maj} · inchangées : ${r.resume.inchange} · empreinte ${String(req.body.empreinte).slice(0, 12)}`, h.id);
    });
    return r;
  }));

  /* ---------------------------------------------------------------- journal SH */
  api.get('/journal', route(async (req) => {
    const avant = req.query.avant ? entier(req.query.avant) : null;
    return (await pool.query(`SELECT j.id, j.date, j.action, j.cible, j.detail, u.nom AS utilisateur, h.nom AS hopital FROM sh_journal j
      LEFT JOIN sh_utilisateurs u ON u.id = j.utilisateur_id LEFT JOIN hopitaux h ON h.id = j.hopital_id
      ${avant ? 'WHERE j.id < $1' : ''} ORDER BY j.id DESC LIMIT 100`, avant ? [avant] : [])).rows;
  }));

  /* ---------------------------------------------------------------- équipe SH */
  api.get('/equipe', route(async () => (await pool.query(
    'SELECT id, email, nom, actif, totp_actif, mdp_temporaire, derniere_connexion, cree_le FROM sh_utilisateurs ORDER BY nom')).rows));
  api.post('/equipe', route(async (req) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const nom = texte(req.body.nom, 120);
    if (!COURRIEL.test(email)) throw new ErreurSh(400, 'Adresse courriel invalide.');
    if (!nom) throw new ErreurSh(400, 'Le nom est requis.');
    const temporaire = motDePasseTemporaire();
    await pool.query('INSERT INTO sh_utilisateurs (email, nom, mot_de_passe_hash) VALUES ($1, $2, $3)', [email, nom, hacher(temporaire)])
      .catch((e) => { if (e.code === '23505') throw new ErreurSh(409, 'Ce courriel a déjà un compte.'); throw e; });
    await journal(pool, req.u, 'Compte SH créé', email, null);
    return { email, mot_de_passe_temporaire: temporaire };
  }));
  const autreMembre = async (req) => {
    const m = (await pool.query('SELECT id, email FROM sh_utilisateurs WHERE id = $1', [entier(req.params.id)])).rows[0];
    if (!m) throw new ErreurSh(404, 'Compte introuvable.');
    if (m.id === req.u.id) throw new ErreurSh(409, 'Utilisez Mon compte pour votre propre compte.');
    return m;
  };
  api.put('/equipe/:id', route(async (req) => {
    const m = await autreMembre(req);
    const actif = !!req.body.actif;
    await pool.query('UPDATE sh_utilisateurs SET actif = $2 WHERE id = $1', [m.id, actif]);
    if (!actif) await pool.query('DELETE FROM sh_sessions WHERE utilisateur_id = $1', [m.id]);
    await journal(pool, req.u, actif ? 'Compte SH réactivé' : 'Compte SH désactivé', m.email, null);
  }));
  api.post('/equipe/:id/reinitialiser', route(async (req) => {
    const m = await autreMembre(req);
    const temporaire = motDePasseTemporaire();
    // La double authentification est toujours remise à zéro : le membre la réactive à sa prochaine connexion
    await pool.query(`UPDATE sh_utilisateurs SET mot_de_passe_hash = $2, mdp_temporaire = true, totp_actif = false, totp_secret = NULL WHERE id = $1`, [m.id, hacher(temporaire)]);
    await pool.query('DELETE FROM sh_sessions WHERE utilisateur_id = $1', [m.id]);
    await journal(pool, req.u, 'Mot de passe SH réinitialisé', m.email, 'avec double authentification');
    return { email: m.email, mot_de_passe_temporaire: temporaire };
  }));

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ erreur: 'Adresse inconnue.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ErreurSh || err instanceof ErreurCible || err instanceof ErreurHttp) return res.status(err.statut).json({ erreur: err.message, ...(err.code ? { code: err.code } : {}) });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erreur: 'Requête mal formée.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ erreur: 'Fichier trop gros (1 Mo au plus).' });
    console.error(err);
    return res.status(500).json({ erreur: 'Erreur interne. Réessayez.' });
  });
  return app;
}

module.exports = { creerAppSh, ErreurSh };
