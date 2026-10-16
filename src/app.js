const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { transaction, ErreurHttp } = require('./db');
const { connexion, connexion2fa, exigerSession, exigerEtablissement } = require('./auth');
const admin = require('./admin');
const { version } = require('../package.json');
const { changerEtat, ACTIONS_LIT, DETAIL_ACTION, journaliser } = require('./regles');
const s = require('./services');
const t = require('./terrain');
const copilote = require('./copilote');
const civ = require('./civieres');
const cx = require('./connecteurs');
const { langueDe, traducteurTypes, traduireTypes } = require('./langue');
const { limiteur } = require('./limites');
const motdepasse = require('./motdepasse');
const courriel = require('./courriel');

const entier = (v, nom) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErreurHttp(400, 'parametre_invalide', { nom });
  return n;
};

function creerApp(pool) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');   // derrière Nginx : l'adresse du client vient de X-Forwarded-For
  app.use('/api', limiteur());
  app.use(express.json({ limit: '50kb' }));
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      // Police hébergée ici (aucun appel à un service tiers)
      // Tuiles de la carte nationale : OpenStreetMap (images seulement)
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; "
        + "font-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    });
    next();
  });
  app.use(express.static(path.join(__dirname, '..', 'public')));
  // Pages légales, accessibles sans connexion (français et anglais)
  app.get(['/confidentialite', '/conditions', '/privacy', '/terms'], (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'legal.html')));

  const api = express.Router();
  // Langue des textes produits par le serveur : paramètre « langue » (adresse ou corps) ou en-tête X-Langue (français par défaut)
  api.use((req, res, next) => { req.langue = langueDe(req.query.langue || req.body?.langue || req.get('x-langue')); next(); });
  const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res))
    .then(async (r) => {
      // Noms des types d'unité dans la langue demandée
      if (req.langue !== 'fr' && r && typeof r === 'object') traduireTypes(r, await traducteurTypes(pool, req.langue));
      res.json(r ?? { ok: true });
    }).catch(next);

  /* ---------- connexion ---------- */
  api.post('/connexion', route((req) => connexion(pool, req.body.email, req.body.mot_de_passe)));
  api.post('/connexion/2fa', route((req) => connexion2fa(pool, req.body.jeton, req.body.code)));
  api.post('/mot-de-passe/oubli', route((req) => motdepasse.demander(pool, req.body.email, req.langue)));
  api.post('/mot-de-passe/reinitialiser', route((req) => motdepasse.reinitialiser(pool, req.body.jeton, req.body.nouveau)));

  /* ---------- informations publiques : serveur de démonstration, champs des pages légales ---------- */
  const CHAMPS_LEGAUX = ['entite', 'adresse', 'responsable', 'contact', 'duree_comptes', 'duree_journaux', 'duree_references', 'hebergeur', 'entente'];
  api.get('/public', (req, res) => res.json({
    demo: process.env.ARRIMO_DEMO === '1',
    mot_de_passe_oublie: courriel.actif(),
    legal: Object.fromEntries(CHAMPS_LEGAUX.map((k) => [k, process.env[`ARRIMO_LEGAL_${k.toUpperCase()}`] || null]).filter(([, v]) => v)),
  }));

  /* ---------- surveillance : état du service et de la base (sans données) ---------- */
  api.get('/sante', async (req, res) => {
    try {
      const t0 = Date.now();
      await pool.query('SELECT 1');
      res.json({ etat: 'ok', version, base: 'ok', latence_ms: Date.now() - t0, heure: new Date().toISOString() });
    } catch {
      res.status(503).json({ etat: 'degrade', version, base: 'injoignable' });
    }
  });

  /* ---------- activation depuis SH (clé de service) ---------- */
  api.put('/sh/etablissements/:code', route(async (req) => {
    const cle = process.env.SH_API_KEY;
    const fournie = String(req.get('x-sh-key') || '');
    if (!cle) throw new ErreurHttp(503, 'sh_non_configure');
    const ok = fournie.length === cle.length && crypto.timingSafeEqual(Buffer.from(fournie), Buffer.from(cle));
    if (!ok) throw new ErreurHttp(401, 'cle_sh_invalide');
    return majEtablissement('code', req.params.code, req.body);
  }));

  async function majEtablissement(champ, valeur, b) {
    const sets = []; const vals = [valeur];
    if (b.module_actif !== undefined) { vals.push(!!b.module_actif); sets.push(`module_actif = $${vals.length}`); }
    if (b.partage !== undefined) {
      if (!['complet', 'agrege', 'aucun'].includes(b.partage)) throw new ErreurHttp(400, 'partage_invalide');
      vals.push(b.partage); sets.push(`partage = $${vals.length}`);
    }
    if (!sets.length) throw new ErreurHttp(400, 'rien_a_modifier');
    const { rows } = await pool.query(
      `UPDATE etablissements SET ${sets.join(', ')} WHERE ${champ} = $1 RETURNING id, code, nom, partage, module_actif`, vals);
    if (!rows[0]) throw new ErreurHttp(404, 'etab_introuvable');
    return rows[0];
  }

  /* ---------- connecteurs : systèmes de l'hôpital et du réseau (clé dédiée) ---------- */
  api.post('/connecteurs/evenements', route(async (req) => {
    const con = await cx.identifier(pool, req.get('x-connecteur-key'));
    const evs = Array.isArray(req.body) ? req.body.slice(0, 200) : [req.body];
    const res = [];
    for (const ev of evs) {
      try { res.push({ identifiant: ev.identifiant, ...(await cx.recevoirEvenement(pool, con, ev)) }); }
      catch (e) { res.push({ identifiant: ev.identifiant, statut: 'rejete', detail: e.message }); }
    }
    return Array.isArray(req.body) ? res : res[0];
  }));
  api.get('/connecteurs/capacite', route(async (req) => {
    await cx.identifier(pool, req.get('x-connecteur-key'));
    return cx.capaciteNationale(pool);
  }));

  /* ---------- tout le reste exige une session ---------- */
  api.use(exigerSession(pool));
  api.use((req, res, next) => { req.utilisateur.langue = req.langue; next(); });

  // Le rôle entretien n'a accès qu'à l'écran Nettoyage
  api.use((req, res, next) => {
    if (req.utilisateur.role !== 'entretien') return next();
    const ok = (req.method === 'GET' && ['/moi', '/nettoyage'].includes(req.path)) || req.path.startsWith('/moi/')
      || (req.method === 'POST' && (req.path === '/deconnexion' || /^\/nettoyage\/\d+\/debut$/.test(req.path)
        || (/^\/(lits|civieres)\/\d+\/action$/.test(req.path) && req.body && req.body.action === 'nettoyage_ok')));
    return ok ? next() : next(new ErreurHttp(403, 'role_entretien'));
  });

  // Mot de passe temporaire : le changer est la seule action permise
  api.use((req, res, next) => {
    if (!req.utilisateur.mdp_temporaire) return next();
    const ok = (req.method === 'GET' && req.path === '/moi') || (req.method === 'PUT' && req.path === '/moi/mot-de-passe')
      || (req.method === 'POST' && req.path === '/deconnexion');
    return ok ? next() : next(new ErreurHttp(403, 'mdp_temporaire_dabord'));
  });

  api.post('/deconnexion', route(async (req) => {
    await pool.query('DELETE FROM sessions WHERE token = $1', [req.utilisateur.token]);
  }));

  api.get('/moi', route(async (req) => {
    const u = req.utilisateur;
    const { rows } = await pool.query(
      `SELECT e.id, e.code, e.nom, e.ville, e.partage, e.module_actif, e.config_id, e.rayon_alerte_km
         FROM etablissements e
        WHERE e.actif AND ($1 OR e.id = ANY($2::int[]))
        ORDER BY e.nom`, [u.gestionnaire, u.etabs]);
    const configs = await pool.query(
      `SELECT c.*, COALESCE(json_agg(t.* ORDER BY t.ordre) FILTER (WHERE t.id IS NOT NULL), '[]') AS types
         FROM config_pays c LEFT JOIN types_unite t ON t.config_id = c.id
        WHERE c.id = ANY($1::int[]) GROUP BY c.id`, [[...new Set(rows.map((e) => e.config_id))]]);
    return { utilisateur: { id: u.id, nom: u.nom, email: u.email, role: u.role, admin: u.admin, gestionnaire: u.gestionnaire,
      totp_actif: u.totp_actif, mdp_temporaire: u.mdp_temporaire, premiers_pas_vus: u.premiers_pas_vus },
    etablissements: rows, configs: configs.rows, demo: process.env.ARRIMO_DEMO === '1' };
  }));

  /* ---------- capacité, recherche, assistant ---------- */
  api.get('/reseau', route((req) => s.capaciteReseau(pool, req.utilisateur, entier(req.query.depuis, 'depuis'))));
  api.get('/recherche', route((req) => s.recommander(pool, req.utilisateur,
    entier(req.query.depuis, 'depuis'), entier(req.query.type_id, 'type_id'), {
      isolement: req.query.isolement === '1', pression_negative: req.query.pression_negative === '1',
      ventilation: req.query.ventilation === '1', telemetrie: req.query.telemetrie === '1',
    })));
  api.post('/assistant', route((req) => copilote.question(pool, req.utilisateur,
    entier(req.body.etablissement_id, 'etablissement_id'), String(req.body.question || '').slice(0, 500))));

  /* ---------- lits ---------- */
  api.get('/lits', route((req) => s.litsEtablissement(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));

  api.post('/lits/:id/action', route(async (req) => {
    const id = entier(req.params.id, 'id');
    await s.litVisible(pool, req.utilisateur, id);
    const action = String(req.body.action || '');
    const vers = ACTIONS_LIT[action];
    if (!vers) throw new ErreurHttp(400, 'action_inconnue');
    return transaction(pool, (c) => changerEtat(c, pool, req.utilisateur.id, id, vers, {
      versionAttendue: req.body.version, patientRef: req.body.patient_ref,
      detail: DETAIL_ACTION[action] || (action === 'reserver' ? 'Réservation locale' : null),
      sortiePrevue: req.body.sortie_prevue || null, motif: req.body.motif,
    }));
  }));

  /* ---------- NSA, congé, nettoyage ---------- */
  api.post('/lits/:id/nsa', route(async (req) => {
    const id = entier(req.params.id, 'id'); await s.litVisible(pool, req.utilisateur, id);
    return t.designerNsa(pool, req.utilisateur, id, req.body.orientation);
  }));
  api.put('/lits/:id/nsa', route(async (req) => {
    const id = entier(req.params.id, 'id'); await s.litVisible(pool, req.utilisateur, id);
    return t.changerNsaOrientation(pool, req.utilisateur, id, req.body.orientation);
  }));
  api.delete('/lits/:id/nsa', route(async (req) => {
    const id = entier(req.params.id, 'id'); await s.litVisible(pool, req.utilisateur, id);
    return t.retirerNsa(pool, req.utilisateur, id);
  }));
  api.put('/lits/:id/conge', route(async (req) => {
    const id = entier(req.params.id, 'id'); await s.litVisible(pool, req.utilisateur, id);
    return t.majConge(pool, req.utilisateur, id, req.body.statut ?? null, req.body.sortie_prevue);
  }));
  api.get('/nettoyage', route((req) => t.fileNettoyage(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.post('/nettoyage/:id/debut', route(async (req) => {
    const id = entier(req.params.id, 'id'); await s.litVisible(pool, req.utilisateur, id);
    return t.debuterNettoyage(pool, req.utilisateur, id);
  }));
  api.get('/nsa', route((req) => t.listeNsa(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));

  /* ---------- tableau de bord national par proximité ---------- */
  const nat = require('./national');
  api.get('/national', route((req) => nat.national(pool, req.utilisateur, entier(req.query.depuis, 'depuis'), {
    type_id: req.query.type_id, max_minutes: req.query.max_minutes, avec_lit: req.query.avec_lit === '1', page: req.query.page, taille: req.query.taille,
    besoins: { isolement: req.query.isolement === '1', pression_negative: req.query.pression_negative === '1',
      ventilation: req.query.ventilation === '1', telemetrie: req.query.telemetrie === '1' },
  })));
  api.get('/national/carte', route((req) => nat.carte(pool, req.utilisateur, entier(req.query.depuis, 'depuis'))));

  /* ---------- civières de l'urgence ---------- */
  api.get('/civieres', route((req) => civ.listeCivieres(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.post('/civieres/:id/action', route((req) => civ.actionCiviere(pool, req.utilisateur, entier(req.params.id, 'id'), String(req.body.action || ''), req.body)));
  api.post('/civieres/:id/deplacer', route((req) => civ.deplacer(pool, req.utilisateur, entier(req.params.id, 'id'),
    entier(req.body.vers_id, 'vers_id'), req.body.version)));

  /* ---------- file d'admission ---------- */
  api.get('/admissions', route((req) => t.fileAdmission(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.post('/admissions', route((req) => t.creerDemande(pool, req.utilisateur, req.body)));
  api.post('/admissions/:id/:etape', route(async (req) => {
    const id = entier(req.params.id, 'id');
    switch (req.params.etape) {
      case 'assigner': return t.assignerLit(pool, req.utilisateur, id, entier(req.body.lit_id, 'lit_id'), req.body.version);
      case 'admettre': return t.admettreDemande(pool, req.utilisateur, id);
      case 'annuler': return t.annulerDemande(pool, req.utilisateur, id);
      case 'transferer': return t.transfererDemande(pool, req.utilisateur, id, req.body);
      default: throw new ErreurHttp(400, 'action_inconnue');
    }
  }));

  /* ---------- indicateurs ---------- */
  api.get('/indicateurs', route((req) => t.indicateurs(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'), req.query.jours)));
  api.get('/indicateurs.csv', async (req, res, next) => {
    try {
      const ind = await t.indicateurs(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'), req.query.jours);
      res.set('Content-Type', 'text/csv; charset=utf-8').send(`\ufeff${t.indicateursCsv(ind)}`);
    } catch (e) { next(e); }
  });

  /* ---------- Copilote ---------- */
  api.get('/copilote/briefing', route((req) => copilote.briefing(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.get('/copilote/previsions', route((req) => require('./previsions').previsions(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.get('/copilote/reseau', route((req) => copilote.briefingReseau(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.post('/copilote/question', route((req) => copilote.question(pool, req.utilisateur,
    entier(req.body.etablissement_id, 'etablissement_id'), String(req.body.question || '').slice(0, 500))));

  api.put('/lits/:id/sortie-prevue', route(async (req) => {
    const id = entier(req.params.id, 'id');
    await s.litVisible(pool, req.utilisateur, id);
    const date = req.body.sortie_prevue ? new Date(req.body.sortie_prevue) : null;
    if (date && Number.isNaN(date.getTime())) throw new ErreurHttp(400, 'date_invalide');
    return transaction(pool, async (c) => {
      const { rows } = await c.query(
        `UPDATE lits SET sortie_prevue = $2 WHERE id = $1 AND etat = 'occupe' RETURNING id, code, sortie_prevue`, [id, date]);
      if (!rows[0]) throw new ErreurHttp(409, 'conge_lit_occupe');
      await journaliser(c, { litId: id, utilisateurId: req.utilisateur.id, action: 'Congé prévu modifié',
        detail: date ? date.toISOString() : 'retiré' });
      return rows[0];
    });
  }));

  api.get('/blocages', route(async (req) => {
    const etab = entier(req.query.etablissement_id, 'etablissement_id');
    exigerEtablissement(req.utilisateur, etab);
    const { rows } = await pool.query(
      `SELECT id, code, etat, version, blocage_niveau, blocage_motif, blocage_code, blocage_vars FROM lits
        WHERE etablissement_id = $1 AND blocage_niveau IS NOT NULL
        ORDER BY CASE blocage_niveau WHEN 'eleve' THEN 0 WHEN 'modere' THEN 1 ELSE 2 END, code`, [etab]);
    for (const r of rows) r.blocage_motif = s.motifBlocage(req.langue, r);
    return rows;
  }));

  /* ---------- transferts ---------- */
  api.get('/transferts', route((req) => s.listeTransferts(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'), req.query)));
  api.post('/transferts', route((req) => s.creerTransfert(pool, req.utilisateur, req.body)));
  api.post('/transferts/:id/:etape', route((req) => s.avancerTransfert(pool, req.utilisateur,
    entier(req.params.id, 'id'), req.params.etape, req.body)));

  /* ---------- journal, notifications ---------- */
  api.get('/journal', route((req) => s.lireJournal(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'), req.query)));
  api.get('/notifications', route((req) => s.lireNotifications(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.post('/notifications/lues', route(async (req) => {
    const etab = entier(req.body.etablissement_id, 'etablissement_id');
    exigerEtablissement(req.utilisateur, etab);
    await pool.query('UPDATE notifications SET lu = true WHERE etablissement_id = $1 AND NOT lu', [etab]);
  }));

  /* ---------- mon compte et administration ---------- */
  const { exigerGestionnaire, journalAdmin } = admin.brancher(api, pool, route, entier);
  api.put('/admin/etablissements/:id', route(async (req) => {
    exigerGestionnaire(req);
    const r = await majEtablissement('id', entier(req.params.id, 'id'), req.body);
    await journalAdmin(pool, req.utilisateur, 'Établissement modifié', r.nom, `partage ${r.partage} · module ${r.module_actif ? 'activé' : 'désactivé'}`, r.id);
    return r;
  }));

  app.use('/api', api);

  // Erreurs : message clair pour l'utilisateur, détail technique seulement dans les journaux du serveur
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const repondre = (e) => res.status(e.statut).json({ erreur: e.message, code: e.code, ...(Object.keys(e.vars).length ? { vars: e.vars } : {}) });
    if (err instanceof ErreurHttp) return repondre(err);
    if (err.type === 'entity.parse.failed') return repondre(new ErreurHttp(400, 'requete_mal_formee'));
    if (err.type === 'entity.too.large') return repondre(new ErreurHttp(413, 'requete_trop_grosse'));
    console.error(err);
    return repondre(new ErreurHttp(500, 'erreur_interne'));
  });
  return app;
}

module.exports = { creerApp };
