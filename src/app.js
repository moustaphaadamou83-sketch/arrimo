const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { transaction, ErreurHttp } = require('./db');
const { connexion, connexion2fa, exigerSession, exigerEtablissement, formesJeton } = require('./auth');
const admin = require('./admin');
const { version } = require('../package.json');
const env = require('./environnement');
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

function creerApp(pool, options = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');   // derrière Nginx : l'adresse du client vient de X-Forwarded-For
  app.use('/api', limiteur());
  // Import CSV : jusqu'à 1 Mo (même limite que Nginx) ; ailleurs 50 Ko
  app.use(['/api/admin/import', '/api/sh/import'], express.json({ limit: '1mb' }));
  app.use('/api/support', express.json({ limit: '15mb' }));
  // HL7 v2 brut (moteur d'interface de l'hôpital) : corps texte, sur HTTPS seulement (aucun port MLLP)
  app.use('/api/connecteurs/hl7v2', express.text({ type: ['application/hl7-v2', 'x-application/hl7-v2+er7', 'text/plain'], limit: '100kb' }));
  // Arrimo Connect : le corps brut est gardé pour vérifier la signature HMAC des systèmes partenaires
  app.use(express.json({ limit: '50kb', verify: (req, res, buf) => { if (req.originalUrl.startsWith('/api/connect/')) req.rawBody = buf.toString('utf8'); } }));
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      // Géolocalisation : écran Ambulance seulement (position facultative, partagée par l'équipe)
      'Permissions-Policy': `camera=(), geolocation=(${['/secours', '/intervenant'].includes(req.path) ? 'self' : ''}), payment=(), microphone=(self)`,
      // Réponses de l'API jamais conservées par le navigateur ni par un intermédiaire
      ...(req.path.startsWith('/api/') ? { 'Cache-Control': 'no-store' } : {}),
      // Police hébergée ici (aucun appel à un service tiers)
      // Tuiles de la carte nationale : OpenStreetMap (images seulement)
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; "
        + "font-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'",
    });
    next();
  });
  app.use(express.static(path.join(__dirname, '..', 'public')));
  // Pages légales, accessibles sans connexion (français et anglais)
  app.get('/proches', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'proches.html')));
  // Écrans de secours (ambulance, CCS) : même connexion que le personnel, page séparée adaptée aux tablettes embarquées
  app.get('/secours', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'secours.html')));
  app.get('/direction', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'direction.html')));
  app.get('/intervenant', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'intervenant.html')));
  // Remise à usage unique d'un accès de connexion (contact technique du client) : la page ne fait que lire le lien
  app.get('/remise', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'remise.html')));
  // FHIR R4 en lecture pour le système d'un hôpital relié (portée « fhir », données de l'établissement seulement)
  require('./fhir').brancher(app, pool);
  // Intégration : comment Arrimo s'arrime aux systèmes des clients (page publique, aucune donnée)
  app.get('/integration', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'integration.html')));
  // Scénario guidé de la démonstration (aucune donnée, aucun mot de passe)
  app.get('/demo-guide', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'demo-guide.html')));
  app.get(['/confidentialite', '/conditions', '/privacy', '/terms'], (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'legal.html')));
  // Urgences en direct, page publique (20 nov. 2026) : DÉMONSTRATION SEULEMENT (décision 4 de Moustafa : accord des urgences et avis juridique d'abord)
  app.get('/bourse-invite', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'bourse-invite.html')));
  app.get(['/urgences', '/emergencies'], (req, res) => (require('./urgences-direct').publicActif()
    ? res.sendFile(path.join(__dirname, '..', 'public', 'urgences-direct.html')) : res.status(404).send('Not found')));

  const api = express.Router();
  // La remise à zéro de démo remplace le schéma de démonstration. Drainer les requêtes
  // déjà engagées et refuser temporairement les nouvelles évite les lectures entre DROP/CREATE.
  let maintenanceDemo = false; let requetesApiActives = 0; const attentesDrain = [];
  // Attente bornée : une requête bloquée ne fige jamais la remise à zéro ni l'application, restée en maintenance
  const attendreDrain = () => requetesApiActives === 0 ? Promise.resolve() : new Promise((resolve) => {
    const minuteur = setTimeout(resolve, 20000);
    attentesDrain.push(() => { clearTimeout(minuteur); resolve(); });
  });
  api.use((req, res, next) => {
    const reset = req.method === 'POST' && req.path === '/admin/demo/reinitialiser';
    if (reset) {
      req.avecMaintenanceDemo = async (operation) => {
        if (maintenanceDemo) throw new ErreurHttp(409, 'reinitialisation_deja_en_cours');
        maintenanceDemo = true;
        try { await attendreDrain(); return await operation(); }
        finally { maintenanceDemo = false; }
      };
      return next();
    }
    if (maintenanceDemo) return res.status(503).json({ code: 'maintenance_demo', erreur: 'La démonstration est brièvement en maintenance. Réessayez.' });
    requetesApiActives += 1;
    let liberee = false;
    const liberer = () => {
      if (liberee) return; liberee = true; requetesApiActives -= 1;
      if (requetesApiActives === 0) while (attentesDrain.length) attentesDrain.shift()();
    };
    res.once('finish', liberer); res.once('close', liberer);
    return next();
  });
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

  // API ouverte en lecture, versionnée, sans compte : cache 60 s, limite de débit, licence et attribution (démonstration seulement)
  api.get('/public/v1/urgences', route(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=60').set('Access-Control-Allow-Origin', '*');
    return require('./urgences-direct').apiPublique(pool, req.ip);
  }));

  // Bourse des places, accès invité (20 nov. 2026) : jeton nominatif dans l'en-tête X-Invitation, limité à la bourse et à l'envoi d'une demande
  api.get('/invite/bourse', route((req) => require('./bourse').placesInvite(pool, req.get('x-invitation'), req.query)));
  api.post('/invite/bourse/demandes', route((req) => require('./bourse').demandeInvite(pool, req.get('x-invitation'), req.body)));

  /* ---------- informations publiques : serveur de démonstration, champs des pages légales ---------- */
  const CHAMPS_LEGAUX = ['entite', 'adresse', 'responsable', 'contact', 'duree_comptes', 'duree_journaux', 'duree_references', 'hebergeur', 'entente'];
  api.get('/public', route(async (req) => ({
    demo: env.estDemo(),
    og_vocal:true,
    og_vocal_fictif:env.vocalFictifAutorise(),
    environnement: env.environnement(),
    mot_de_passe_oublie: courriel.actif(),
    legal: Object.fromEntries(CHAMPS_LEGAUX.map((k) => [k, process.env[`ARRIMO_LEGAL_${k.toUpperCase()}`] || null]).filter(([, v]) => v)),
    // Lien propre d'un hôpital (hopital-x.<hôte>) : la connexion affiche son nom et ouvre son établissement
    lien: await require('./sh-api').etablissementDuLien(pool, req.hostname, env.hote()),
  })));

  /* ---------- surveillance : état du service et de la base (sans données) ---------- */
  api.get('/sante', async (req, res) => {
    try {
      const t0 = Date.now();
      // Base joignable ET schéma présent : une base vidée par erreur doit être signalée (incident du 9 nov. 2026)
      const { rows } = await pool.query(`SELECT to_regclass('etablissements') IS NOT NULL AND to_regclass('utilisateurs') IS NOT NULL AND to_regclass('journal') IS NOT NULL AS ok`);
      if (!rows[0].ok) return res.status(503).json({ etat: 'degrade', version, base: 'schema_incomplet' });
      res.json({ etat: 'ok', version, base: 'ok', latence_ms: Date.now() - t0, heure: new Date().toISOString() });
    } catch {
      res.status(503).json({ etat: 'degrade', version, base: 'injoignable' });
    }
  });

  /* ---------- console SH (clé de service de cet environnement) ---------- */
  require('./sh-api').brancherSh(api, pool, route);

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
  // Arrimo Connect (secours) : systèmes de répartition et ambulanciers, requêtes signées, mêmes règles que l'écran
  require('./connect').brancher(api, pool, route);
  // Récupération unique d'un secret de connexion (sans session : le jeton du lien suffit, une seule fois)
  api.post('/remise', route((req) => require('./remises').recuperer(pool, req.body?.jeton)));
  // HL7 v2 (ADT A01, A02, A03, A04, A16) : traduit vers les mêmes événements ; accusé HL7 (AA ou AE), jamais le contenu du message
  api.post('/connecteurs/hl7v2', async (req, res) => {
    let controle = '';
    // Identifiant de contrôle (MSH-10) lu d'abord : l'accusé le reprend même en cas de refus
    try { controle = require('./hl7v2').analyser(typeof req.body === 'string' ? req.body : '').champ('MSH', 10, 1).slice(0, 120); } catch { /* message illisible : accusé sans identifiant */ }
    try {
      const con = await cx.identifier(pool, req.get('x-connecteur-key'));
      if (!con.etablissement_id || !(con.portees || []).includes('hl7v2')) throw new ErreurHttp(403, 'connecteur_portee_refusee');
      const t = require('./hl7v2').traduire(typeof req.body === 'string' ? req.body : '');
      controle = t.controle;
      const r = await cx.recevoirEvenement(pool, con, t.ev);
      res.status(200).type('application/hl7-v2').send(require('./hl7v2').accuse(controle, 'AA', r.statut));
    } catch (e) {
      res.status(e.statut && e.statut < 500 ? e.statut : 500).type('application/hl7-v2').send(require('./hl7v2').accuse(controle, 'AE', e.code || 'erreur'));
    }
  });
  api.post('/connecteurs/evenements', route(async (req) => {
    const con = await cx.identifier(pool, req.get('x-connecteur-key'));
    // Portée « adt » (événements JSON) : un connecteur d'établissement créé pour HL7 v2 ou FHIR seulement ne l'a pas
    if (con.etablissement_id && !(con.portees || ['adt']).includes('adt')) throw new ErreurHttp(403, 'connecteur_portee_refusee');
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
  // Portail des proches : sessions séparées (préfixe « P. »), branché avant la session du personnel
  require('./portail-proches').brancherPublic(api, pool, route);
  api.use(exigerSession(pool));
  api.use((req, res, next) => { req.utilisateur.langue = req.langue; next(); });

  // Le rôle entretien n'a accès qu'à l'écran Nettoyage
  api.use((req, res, next) => {
    if (req.utilisateur.role !== 'entretien') return next();
    // La météo de l'en-tête et le nom de l'assistant (lecture seule, propres à l'établissement) s'affichent aussi pour l'entretien.
    const ok = (req.method === 'GET' && ['/moi', '/nettoyage', '/meteo', '/og/configuration', '/chsld/taches', '/chsld/places'].includes(req.path)) || req.path.startsWith('/moi/')
      || (req.method === 'POST' && /^\/chsld\/taches\/\d+\/statut$/.test(req.path))
      || (req.method === 'POST' && (req.path === '/deconnexion' || /^\/nettoyage\/\d+\/(debut|terminer)$/.test(req.path)
        || (/^\/(lits|civieres)\/\d+\/action$/.test(req.path) && req.body && req.body.action === 'nettoyage_ok')));
    return ok ? next() : next(new ErreurHttp(403, 'role_entretien'));
  });

  // Rôles de secours (paramédic, superviseur, répartiteur) : écrans de secours seulement, jamais les lits, patients ni résidents
  api.use((req, res, next) => {
    if (!require('./prealertes').ROLES_SECOURS.includes(req.utilisateur.role)) return next();
    const ok = (req.method === 'GET' && req.path === '/moi') || req.path.startsWith('/moi/') || req.path.startsWith('/secours/')
      || (req.method === 'POST' && req.path === '/deconnexion');
    return ok ? next() : next(new ErreurHttp(403, 'role_secours'));
  });

  // Intervenant d'un prestataire (21 nov. 2026) : ses visites seulement
  api.use((req, res, next) => {
    if (req.utilisateur.role !== 'intervenant') return next();
    const ok = (req.method === 'GET' && ['/moi', '/visites', '/visites/rapport', '/visites/rapport.csv'].includes(req.path)) || req.path.startsWith('/moi/')
      || (req.method === 'POST' && (req.path === '/deconnexion' || /^\/visites\/\d+\/pointer$/.test(req.path)));
    return ok ? next() : next(new ErreurHttp(403, 'role_intervenant'));
  });
  // Direction régionale (lot 0, 19 nov. 2026) : lecture de sa région seulement, jamais les lits, patients ni résidents
  api.use((req, res, next) => {
    if (req.utilisateur.role !== 'direction_regionale') return next();
    const ok = (req.method === 'GET' && (['/moi', '/demandes', '/demandes/synthese', '/direction/region', '/regions', '/meteo', '/donnees', '/donnees.csv'].includes(req.path) || /^\/transferts-suivi\/(centrale|\d+)$/.test(req.path))) || req.path.startsWith('/moi/') || req.path.startsWith('/crise/')
      || (req.method === 'POST' && req.path === '/deconnexion');
    return ok ? next() : next(new ErreurHttp(403, 'role_direction_regionale'));
  });
  // Chrono (19 nov. 2026) : mêmes routes pour l'urgence (/chrono) et pour l'ambulance et le CCS (/secours/chrono)
  const chrono = require('./chrono');
  for (const pre of ['/chrono', '/secours/chrono']) {
    api.get(`${pre}`, route((req) => chrono.tableau(pool, req.utilisateur, req.query)));
    api.get(`${pre}/rapport`, route((req) => chrono.rapport(pool, req.utilisateur, req.query)));
    api.get(`${pre}/rapport.csv`, async (req, res, next) => {
      try {
        const r = await chrono.rapport(pool, req.utilisateur, req.query);
        res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="chrono-${r.mois}.csv"`).send(chrono.csv(r, req.langue));
      } catch (e) { next(e); }
    });
    api.get(`${pre}/ecarts`, route((req) => chrono.ecarts(pool, req.utilisateur, req.query)));
    api.get(`${pre}/passages/:id`, route((req) => chrono.fiche(pool, req.utilisateur, req.params.id, req.query)));
    api.post(`${pre}/passages/:id/etape`, route((req) => chrono.marquerEtape(pool, req.utilisateur, req.params.id, req.body)));
    api.post(`${pre}/passages/:id/depart`, route((req) => chrono.depart(pool, req.utilisateur, req.params.id, req.body)));
    api.post(`${pre}/passages/:id/corriger`, route((req) => chrono.corriger(pool, req.utilisateur, req.params.id, req.body)));
  }
  // Urgences en direct (20 nov. 2026) : fermetures planifiées de l'urgence (hôpital) ; lecture des fermetures de la région (secours)
  const ud = require('./urgences-direct');
  api.get('/urgences-direct', route((req) => ud.vueHopital(pool, req.utilisateur, req.query.etablissement_id)));
  api.post('/urgences-direct/fermetures', route((req) => ud.planifier(pool, req.utilisateur, req.body)));
  api.post('/urgences-direct/fermetures/:id/action', route((req) => ud.changer(pool, req.utilisateur, req.params.id, req.body)));
  api.get('/secours/urgences-direct', route((req) => ud.vueSecours(pool, req.utilisateur)));
  // Visites confirmées (21 nov. 2026) : résidence (planifier, horaire, soins donnés à la place, rapport) ; intervenant (/visites/mes-visites)
  const visites = require('./visites');
  api.get('/visites', route((req) => visites.horaire(pool, req.utilisateur, req.query)));
  api.post('/visites', route((req) => visites.planifier(pool, req.utilisateur, req.body)));
  api.get('/visites/prestataires', route((req) => visites.prestataires(pool, req.utilisateur, req.query.etablissement_id)));
  api.get('/visites/rapport', route((req) => visites.rapport(pool, req.utilisateur, req.query)));
  api.get('/visites/rapport.csv', async (req, res, next) => {
    try { const r = await visites.rapport(pool, req.utilisateur, req.query); res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="visites-${r.mois}.csv"`).send(visites.csv(r, req.langue)); }
    catch (e) { next(e); }
  });
  api.post('/visites/:id/residence', route((req) => visites.agirResidence(pool, req.utilisateur, req.params.id, req.body)));
  api.post('/visites/:id/pointer', route((req) => visites.pointer(pool, req.utilisateur, req.params.id, req.body)));
  // Éviter les transferts inutiles (21 nov. 2026) : liste et alternatives de l'établissement ; décisions comptées
  const eviter = require('./eviter-transferts');
  api.get('/eviter', route((req) => eviter.lire(pool, req.utilisateur, req.query.etablissement_id)));
  api.put('/eviter', route((req) => eviter.regler(pool, req.utilisateur, req.body)));
  api.post('/eviter/decisions', route((req) => eviter.decider(pool, req.utilisateur, req.body)));
  // Mode crise (20 nov. 2026) : évacuation d'un établissement d'hébergement
  const crise = require('./crise');
  api.get('/crise/evacuations', route((req) => crise.liste(pool, req.utilisateur, req.query)));
  api.post('/crise/evacuations', route((req) => crise.declencher(pool, req.utilisateur, req.body)));
  api.get('/crise/evacuations/:id', route((req) => crise.vue(pool, req.utilisateur, req.params.id)));
  api.post('/crise/evacuations/:id/residents/:rid', route((req) => crise.agir(pool, req.utilisateur, req.params.id, req.params.rid, req.body)));
  api.post('/crise/evacuations/:id/lever', route((req) => crise.lever(pool, req.utilisateur, req.params.id)));
  // Données (20 nov. 2026) : tableaux régionaux, listes d'attente, petits nombres masqués, CSV sans référence
  const donnees = require('./donnees');
  api.get('/donnees', route((req) => donnees.tableau(pool, req.utilisateur, req.query)));
  api.get('/donnees.csv', async (req, res, next) => {
    try { res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="arrimo-donnees.csv"').send(donnees.csv(await donnees.tableau(pool, req.utilisateur, req.query), req.langue)); }
    catch (e) { next(e); }
  });
  // Bourse des places (20 nov. 2026)
  const bourse = require('./bourse');
  api.get('/bourse', route((req) => bourse.places(pool, req.utilisateur, req.query)));
  api.get('/bourse/groupe', route((req) => bourse.groupe(pool, req.utilisateur, req.query)));
  api.get('/bourse/fiche/:lit', route((req) => bourse.fiche(pool, req.utilisateur, req.params.lit)));
  api.post('/bourse/demandes/:id/proposer-groupe', route((req) => bourse.proposerDansGroupe(pool, req.utilisateur, req.params.id, req.body)));
  api.get('/bourse/invitations', route((req) => bourse.invitations(pool, req.utilisateur, req.query.etablissement_id)));
  api.post('/bourse/invitations', route((req) => bourse.inviter(pool, req.utilisateur, req.body)));
  api.post('/bourse/invitations/:id/revoquer', route((req) => bourse.revoquer(pool, req.utilisateur, req.params.id)));
  // Transferts (20 nov. 2026) : fiche unique, centrale régionale, rapatriement proposé ; transporteur et CCS par /secours/*
  const ts = require('./transferts-suivi');
  api.get('/transferts-suivi/centrale', route((req) => ts.centrale(pool, req.utilisateur)));
  api.get('/transferts-suivi/:id', route((req) => ts.fiche(pool, req.utilisateur, req.params.id)));
  api.get('/secours/transferts-centrale', route((req) => ts.centrale(pool, req.utilisateur)));
  api.get('/secours/transferts/:id', route((req) => ts.fiche(pool, req.utilisateur, req.params.id)));
  api.post('/transferts/:id/stable-retour', route((req) => ts.stablePourRetour(pool, req.utilisateur, req.params.id)));
  api.post('/rapatriements/:id/decision', route((req) => ts.deciderRapatriement(pool, req.utilisateur, req.params.id, req.body)));
  // Demandes, lecture commune des 5 circuits (moteur commun, lot 0) ; régions
  api.get('/demandes', route((req) => require('./demandes').liste(pool, req.utilisateur, req.query)));
  api.get('/demandes/synthese', route((req) => require('./demandes').synthese(pool, req.utilisateur, req.query)));
  api.get('/direction/region', route((req) => require('./directions').region(pool, req.utilisateur)));
  api.get('/regions', route((req) => require('./directions').regions(pool, req.query.pays)));

  // Mot de passe temporaire : le changer est la seule action permise
  api.use((req, res, next) => {
    if (!req.utilisateur.mdp_temporaire) return next();
    const ok = (req.method === 'GET' && req.path === '/moi') || (req.method === 'PUT' && req.path === '/moi/mot-de-passe')
      || (req.method === 'POST' && req.path === '/deconnexion');
    return ok ? next() : next(new ErreurHttp(403, 'mdp_temporaire_dabord'));
  });

  // Gestionnaire réseau : périmètre de tout le réseau, donc double authentification obligatoire avant toute action
  // (comme l'administration). Exceptions : serveur de démonstration (compte réseau public) et ARRIMO_2FA_ADMIN=0 (tests).
  api.use((req, res, next) => {
    const u = req.utilisateur;
    if (!u.gestionnaire || u.totp_actif || !env.exige2faAdmin()) return next();
    const ok = (req.method === 'GET' && req.path === '/moi') || req.path.startsWith('/moi/2fa/') || (req.method === 'PUT' && req.path === '/moi/mot-de-passe')
      || (req.method === 'POST' && req.path === '/deconnexion');
    return ok ? next() : next(new ErreurHttp(403, 'admin_exige_2fa'));
  });

  const simulation = require('./simulation-connecteurs');
  require('./support-client').brancher(api,pool,route,{env:options.supportEnv||process.env});
  api.put('/connecteurs/simulation/:id/configuration', route((req) => simulation.configurer(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.post('/connecteurs/simulation/correspondances', route(async (req) => simulation.correspondance(pool, req.utilisateur, await cx.identifier(pool, req.get('x-connecteur-key')), req.body)));
  api.post('/connecteurs/simulation/evenements', route(async (req, res) => {
    const r = await simulation.recevoir(pool, req.utilisateur, await cx.identifier(pool, req.get('x-connecteur-key')), req.body);
    res.status(r.http_status); return r;
  }));
  api.get('/connecteurs/simulation/journal', route(async (req) => simulation.journal(pool, req.utilisateur, await cx.identifier(pool, req.get('x-connecteur-key')))));
  api.get('/connecteurs/simulation/supervision', route((req) => simulation.supervision(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));

  api.post('/deconnexion', route(async (req) => {
    await pool.query('DELETE FROM sessions WHERE token = ANY($1::text[])', [formesJeton(req.utilisateur.token)]);
  }));
  // Fermer toutes mes autres sessions (appareil perdu, poste partagé)
  api.post('/moi/sessions/fermer', route(async (req) => {
    const r = await pool.query('DELETE FROM sessions WHERE utilisateur_id = $1 AND NOT (token = ANY($2::text[]))', [req.utilisateur.id, formesJeton(req.utilisateur.token)]);
    await admin.journalAdmin(pool, req.utilisateur, 'Autres sessions fermées', req.utilisateur.email, String(r.rowCount));
    return { fermees: r.rowCount };
  }));

  api.get('/moi', route(async (req) => {
    const u = req.utilisateur;
    const { rows } = await pool.query(
      `SELECT e.id, e.code, e.nom, e.ville, e.partage, e.module_actif, e.config_id, e.rayon_alerte_km, e.modules, e.vocation, e.latitude, e.longitude, e.type_etablissement, e.type_local_code, e.type_libelle, e.type_libelle_en,
              ARRAY(SELECT DISTINCT l.type_id FROM lits l WHERE l.etablissement_id = e.id) AS types_presents
         FROM etablissements e
        WHERE e.actif AND ($1 OR e.id = ANY($2::int[]))
        ORDER BY e.nom`, [u.gestionnaire, u.etabs]);
    const configs = await pool.query(
      `SELECT c.*, COALESCE(json_agg(t.* ORDER BY t.ordre) FILTER (WHERE t.id IS NOT NULL), '[]') AS types
         FROM config_pays c LEFT JOIN types_unite t ON t.config_id = c.id
        WHERE c.id = ANY($1::int[]) GROUP BY c.id`, [[...new Set(rows.map((e) => e.config_id))]]);
    return { utilisateur: { id: u.id, nom: u.nom, email: u.email, role: u.role, admin: u.admin, gestionnaire: u.gestionnaire,
      totp_actif: u.totp_actif, mdp_temporaire: u.mdp_temporaire, premiers_pas_vus: u.premiers_pas_vus, apparence: u.apparence || 'automatique',
      langue_interface: u.langue_interface || null, preferences_og: u.preferences_og || {} },
    organisations: (await pool.query(`SELECT o.id, o.code, o.nom, o.type, (SELECT fuseau FROM config_pays WHERE id = o.config_id) AS fuseau FROM utilisateur_organisations uo JOIN organisations_secours o ON o.id = uo.organisation_id
      WHERE uo.utilisateur_id = $1 AND o.actif ORDER BY o.nom`, [u.id])).rows,
    etablissements: rows, configs: configs.rows, demo: env.estDemo(), environnement: env.environnement(),
    patients_fictifs: ['demo', 'recette'].includes(env.environnement()) || process.env.ARRIMO_PATIENTS_FICTIFS === '1' };
  }));

  /* ---------- capacité, recherche, assistant ---------- */
  api.get('/reseau', route((req) => s.capaciteReseau(pool, req.utilisateur, entier(req.query.depuis, 'depuis'))));
  api.get('/recherche', route((req) => s.recommander(pool, req.utilisateur,
    entier(req.query.depuis, 'depuis'), entier(req.query.type_id, 'type_id'), {
      isolement: req.query.isolement === '1', pression_negative: req.query.pression_negative === '1',
      ventilation: req.query.ventilation === '1', telemetrie: req.query.telemetrie === '1',
      groupe_age: req.query.groupe_age || undefined,
    })));
  api.get('/itineraire', route((req) => s.itineraireReseau(pool, req.utilisateur,
    entier(req.query.depuis, 'depuis'), entier(req.query.vers, 'vers'))));
  api.post('/assistant', route((req) => copilote.question(pool, req.utilisateur,
    entier(req.body.etablissement_id, 'etablissement_id'), String(req.body.question || '').slice(0, 500))));

  /* ---------- lits ---------- */
  api.get('/lits', route((req) => s.litsEtablissement(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));

  // Hiérarchie visible uniquement par les membres de l'établissement demandé.
  // Cette vue ne contient ni référence patient ni journal clinique.
  api.get('/structure', route(async (req) => {
    const etab = entier(req.query.etablissement_id, 'etablissement_id');
    exigerEtablissement(req.utilisateur, etab);
    const [departements, services, unites, etages, chambres, lits, civieres] = await Promise.all([
      pool.query('SELECT id,code,nom,actif,attributs FROM departements WHERE etablissement_id=$1 ORDER BY nom',[etab]),
      pool.query('SELECT id,code,nom,departement_id,actif,attributs FROM services WHERE etablissement_id=$1 ORDER BY nom',[etab]),
      pool.query(`SELECT u.id,u.nom,u.type_id,t.code type_code,t.nom type_nom,u.service_id,u.departement_id,u.actif,u.attributs
        FROM unites u JOIN types_unite t ON t.id=u.type_id WHERE u.etablissement_id=$1 ORDER BY u.nom`,[etab]),
      pool.query(`SELECT g.id,g.unite_id,g.code,g.nom,g.aile,g.actif,g.attributs FROM etages g JOIN unites u ON u.id=g.unite_id
        WHERE u.etablissement_id=$1 ORDER BY u.nom,g.code`,[etab]),
      pool.query(`SELECT ch.id,ch.unite_id,ch.etage_id,ch.numero,ch.type_chambre,ch.capacite_declaree,ch.accessible,ch.attributs,ch.restrictions,ch.statut_operationnel,ch.actif,
        (SELECT count(*)::int FROM lits l WHERE l.chambre_id=ch.id AND l.actif) lits_calcules
        FROM chambres ch JOIN unites u ON u.id=ch.unite_id WHERE u.etablissement_id=$1 ORDER BY u.nom,ch.numero`,[etab]),
      pool.query(`SELECT id,chambre_id,unite_id,code,etat,categorie,isolement,pression_negative,ventilation,telemetrie,attributs,actif,disponibilite_confirmee_le
        FROM lits WHERE etablissement_id=$1 ORDER BY code`,[etab]),
      pool.query('SELECT id,code,categorie,etat,unite_id,attributs,actif FROM civieres WHERE etablissement_id=$1 ORDER BY code',[etab]),
    ]);
    return { etablissement_id:etab, departements:departements.rows, services:services.rows, unites:unites.rows,
      etages:etages.rows, chambres:chambres.rows, lits:lits.rows, civieres:civieres.rows };
  }));

  api.post('/lits/:id/action', route(async (req) => {
    const id = entier(req.params.id, 'id');
    await s.litVisible(pool, req.utilisateur, id);
    const action = String(req.body.action || '');
    const vers = ACTIONS_LIT[action];
    if (!vers) throw new ErreurHttp(400, 'action_inconnue');
    // Admettre, réserver et annuler passent par les mêmes opérations que la file d'admission : lit, demande et civière restent cohérents
    if (action === 'admettre') return transaction(pool, (c) => t.admettreDepuisLit(c, pool, req.utilisateur, id, req.body.version));
    if (action === 'annuler') return transaction(pool, (c) => t.annulerDepuisLit(c, pool, req.utilisateur, id, req.body.version));
    if (action === 'reserver') return transaction(pool, (c) => t.reserverDepuisLit(c, pool, req.utilisateur, id, req.body.version, req.body.patient_ref));
    return transaction(pool, (c) => changerEtat(c, pool, req.utilisateur.id, id, vers, {
      versionAttendue: req.body.version, patientRef: req.body.patient_ref,
      detail: DETAIL_ACTION[action] || (action === 'reserver' ? 'Réservation locale' : null),
      sortiePrevue: req.body.sortie_prevue || null, motif: req.body.motif,
    }));
  }));
  api.post('/lits/:id/confirmer-disponibilite', route((req) => s.confirmerDisponibilite(pool, req.utilisateur, entier(req.params.id, 'id'))));

  /* ---------- NSA, congé, nettoyage ---------- */
  api.post('/lits/:id/nsa', route(async (req) => {
    const id = entier(req.params.id, 'id'); const v = await s.litVisible(pool, req.utilisateur, id);
    await s.exigerModule(pool, v.etablissement_id, 'nsa');
    return t.designerNsa(pool, req.utilisateur, id, req.body);
  }));
  api.put('/lits/:id/nsa', route(async (req) => {
    const id = entier(req.params.id, 'id'); await s.litVisible(pool, req.utilisateur, id);
    return t.modifierNsa(pool, req.utilisateur, id, req.body);
  }));
  api.delete('/lits/:id/nsa', route(async (req) => {
    const id = entier(req.params.id, 'id'); await s.litVisible(pool, req.utilisateur, id);
    return t.retirerNsa(pool, req.utilisateur, id);
  }));
  api.put('/lits/:id/conge', route(async (req) => {
    const id = entier(req.params.id, 'id'); await s.litVisible(pool, req.utilisateur, id);
    return t.majConge(pool, req.utilisateur, id, req.body.statut ?? null, req.body.sortie_prevue);
  }));
  require('./nettoyage-securise').brancher(api, pool, route, entier);
  require('./evaluations-fictives').brancher(api, pool, route, entier);
  require('./evenements').brancher(api, pool, route, entier);
  api.get('/nettoyage', route((req) => t.fileNettoyage(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.post('/nettoyage/:id/debut', route(async (req) => {
    const id = entier(req.params.id, 'id'); await s.litVisible(pool, req.utilisateur, id);
    return t.debuterNettoyage(pool, req.utilisateur, id);
  }));
  api.get('/nsa/lits/:id', route(async (req) => {
    const d = await t.detailNsa(pool, req.utilisateur, entier(req.params.id, 'id'));
    await s.exigerModule(pool, d.etablissement_id, 'nsa');
    return d;
  }));
  // Besoins NSA en catégories (lot A, 17 nov. 2026) : équipe et coordination seulement, jamais dans le journal ni les notifications
  const nb = require('./nsa-besoins');
  api.get('/nsa/lits/:id/besoins', route((req) => nb.lire(pool, req.utilisateur, entier(req.params.id, 'id'))));
  api.put('/nsa/lits/:id/besoins', route((req) => nb.modifier(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  // Lot B (17 nov. 2026) : places compatibles classées et expliquées ; profil et places à venir des ressources ; poids par établissement
  const np = require('./nsa-places');
  api.get('/nsa/lits/:id/places', route((req) => np.placesCompatibles(pool, req.utilisateur, entier(req.params.id, 'id'), { langue: req.langue })));
  api.get('/nsa/poids', route((req) => np.lirePoids(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.put('/nsa/poids', route((req) => np.majPoids(pool, req.utilisateur, entier(req.body.etablissement_id, 'etablissement_id'), req.body)));
  api.get('/hebergement/profil', route((req) => np.lireProfil(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.put('/hebergement/profil', route((req) => np.majProfil(pool, req.utilisateur, entier(req.body.etablissement_id, 'etablissement_id'), req.body)));
  api.get('/hebergement/places-a-venir', route((req) => np.listePlacesAVenir(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.post('/hebergement/places-a-venir', route((req) => np.creerPlaceAVenir(pool, req.utilisateur, req.body)));
  api.put('/hebergement/places-a-venir/:id', route((req) => np.majPlaceAVenir(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  // Sortie d'un patient NSA vers un CHSLD (16 nov. 2026) : demande d'hébergement transmise, départ confirmé par l'hôpital
  const nc = require('./nsa-chsld');
  api.get('/nsa/chsld', route((req) => nc.destinations(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.get('/nsa/orientations-chsld', route((req) => nc.liste(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.post('/nsa/lits/:id/orienter-chsld', route((req) => nc.orienter(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  const ni = require('./nsa-indicateurs');
  api.get('/nsa/indicateurs', route((req) => ni.indicateurs(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'), { semaines: req.query.semaines })));
  api.get('/nsa/indicateurs.csv', async (req, res, next) => {
    try {
      const ind = await ni.indicateurs(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'), { semaines: req.query.semaines });
      res.set('Content-Type', 'text/csv; charset=utf-8').send(`\ufeff${ni.csv(ind, req.langue)}`);
    } catch (e) { next(e); }
  });
  api.post('/nsa/orientations-chsld/:id/confirmer-place', route((req) => nc.confirmerPlace(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.post('/nsa/orientations-chsld/:id/depart', route((req) => nc.confirmerDepart(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.get('/nsa', route(async (req) => {
    const etab = entier(req.query.etablissement_id, 'etablissement_id');
    await s.exigerModule(pool, etab, 'nsa');
    return t.listeNsa(pool, req.utilisateur, etab);
  }));

  /* ---------- tableau de bord national par proximité ---------- */
  const nat = require('./national');
  api.get('/national', route((req) => nat.national(pool, req.utilisateur, entier(req.query.depuis, 'depuis'), {
    type_id: req.query.type_id, max_minutes: req.query.max_minutes, avec_lit: req.query.avec_lit === '1', page: req.query.page, taille: req.query.taille,
    besoins: { isolement: req.query.isolement === '1', pression_negative: req.query.pression_negative === '1',
      ventilation: req.query.ventilation === '1', telemetrie: req.query.telemetrie === '1' },
  })));
  api.get('/national/carte', route((req) => nat.carte(pool, req.utilisateur, entier(req.query.depuis, 'depuis'))));

  /* ---------- civières de l'urgence ---------- */
  api.get('/civieres', route(async (req) => {
    const etab = entier(req.query.etablissement_id, 'etablissement_id');
    await s.exigerModule(pool, etab, 'urgence');
    return civ.listeCivieres(pool, req.utilisateur, etab);
  }));
  api.post('/civieres/:id/action', route((req) => civ.actionCiviere(pool, req.utilisateur, entier(req.params.id, 'id'), String(req.body.action || ''), req.body)));
  api.post('/civieres/:id/deplacer', route((req) => civ.deplacer(pool, req.utilisateur, entier(req.params.id, 'id'),
    entier(req.body.vers_id, 'vers_id'), req.body.version)));

  /* ---------- file d'admission ---------- */
  const ogConfiguration = require('./og-configuration');
  api.get('/og/configuration', route((req) => ogConfiguration.configuration(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.put('/og/configuration', route((req) => ogConfiguration.configurer(pool, req.utilisateur, entier(req.body.etablissement_id, 'etablissement_id'), req.body)));
  api.post('/og/documents/lire', route((req) => require('./og-documents').lireDocument(pool, req.utilisateur, entier(req.body.etablissement_id, 'etablissement_id'), req.body)));
  const ogActions = require('./og-actions');
  api.post('/og/actions', route((req) => ogActions.preparer(pool, req.utilisateur, entier(req.body.etablissement_id, 'etablissement_id'), req.body)));
  api.post('/og/actions/:id/confirmer', route((req) => ogActions.confirmer(pool, req.utilisateur, entier(req.body.etablissement_id, 'etablissement_id'), String(req.params.id), req.body)));
  api.post('/og/actions/:id/annuler', route((req) => ogActions.annuler(pool, req.utilisateur, entier(req.body.etablissement_id, 'etablissement_id'), String(req.params.id))));
  const priorites = require('./priorites');
  api.get('/admissions/referentiel', route((req) => priorites.referentiel(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.put('/admissions/referentiel', route((req) => priorites.configurer(pool, req.utilisateur, entier(req.body.etablissement_id, 'etablissement_id'), req.body)));
  api.get('/admissions/habilitations', route((req) => priorites.habilitations(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.put('/admissions/habilitations/:utilisateurId', route((req) => priorites.habiliter(pool, req.utilisateur,
    entier(req.body.etablissement_id, 'etablissement_id'), entier(req.params.utilisateurId, 'utilisateurId'), req.body)));
  api.post('/admissions/:id/priorite', route((req) => priorites.valider(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.get('/admissions', route((req) => t.fileAdmission(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  /* ---------- CHSLD : résidents, places, demandes d'hébergement, coordinations, tâches, proches ---------- */
  const ch = require('./chsld');
  const E = (req) => entier(req.query.etablissement_id, 'etablissement_id');
  api.get('/chsld/accueil', route((req) => ch.accueil(pool, req.utilisateur, E(req))));
  api.get('/chsld/places', route((req) => ch.places(pool, req.utilisateur, E(req))));
  api.get('/chsld/indicateurs', route((req) => ch.indicateurs(pool, req.utilisateur, E(req), req.query.jours)));
  api.get('/chsld/residents', route((req) => ch.listeResidents(pool, req.utilisateur, E(req), { q: req.query.q, statut: req.query.statut })));
  api.post('/chsld/residents', route((req) => ch.creerResident(pool, req.utilisateur, req.body)));
  api.get('/chsld/residents/:id', route((req) => ch.ficheResident(pool, req.utilisateur, entier(req.params.id, 'id'))));
  api.put('/chsld/residents/:id', route((req) => ch.modifierResident(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.post('/chsld/residents/:id/contacts', route((req) => ch.ajouterContact(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.put('/chsld/contacts/:id', route((req) => ch.modifierContact(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.post('/chsld/contacts/:id/verifier-representant', route((req) => ch.verifierRepresentant(pool, req.utilisateur, entier(req.params.id, 'id'))));
  const ACTIONS_RESIDENT = { 'reserver-place': ch.reserverPlace, arrivee: ch.confirmerArrivee, 'changer-chambre': ch.changerChambre, sortie: ch.sortie, absence: ch.absence,
    hospitalisation: ch.preparerHospitalisation, 'transfert-chsld': ch.preparerTransfertChsld, communications: ch.creerCommunication, 'liberer-place': ch.libererPlace };
  require('./portail-proches').brancherPersonnel(api, pool, route, entier);
  api.post('/chsld/residents/:id/:action', route((req) => {
    const f = ACTIONS_RESIDENT[req.params.action]; if (!f) throw new ErreurHttp(404, 'action_inconnue');
    return f(pool, req.utilisateur, entier(req.params.id, 'id'), req.body);
  }));
  api.get('/chsld/demandes', route((req) => ch.listeDemandes(pool, req.utilisateur, E(req), { toutes: req.query.toutes === '1' })));
  api.post('/chsld/demandes', route((req) => ch.creerDemande(pool, req.utilisateur, req.body)));
  api.post('/chsld/demandes/:id/action', route((req) => ch.actionDemande(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.get('/chsld/demandes/:id/milieux', route((req) => ch.milieuxTransfert(pool, req.utilisateur, entier(req.params.id, 'id'))));
  api.post('/chsld/demandes/:id/transferer', route((req) => ch.transfererDemande(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.get('/chsld/reseau', route((req) => ch.reseau(pool, req.utilisateur, E(req))));
  // Hôpitaux destinataires : ceux qui ont activé la Liaison CHSLD (indépendant du module réseau inter-CHSLD)
  api.get('/chsld/hopitaux', route((req) => ch.listeHopitauxLiaison(pool, req.utilisateur, E(req))));
  // Module hospitalier Liaison CHSLD : arrivées, accueil, hospitalisations et retours, historique
  api.get('/liaison-chsld', route((req) => require('./liaison-chsld').vue(pool, req.utilisateur, E(req))));
  // Emplacements réellement libres et compatibles pour « Orienter / admettre le patient »
  api.get('/liaison-chsld/:id/emplacements', route((req) => require('./liaison-chsld').emplacements(pool, req.utilisateur, E(req), entier(req.params.id, 'id'), req.query)));
  api.get('/chsld/taches', route((req) => ch.listeTaches(pool, req.utilisateur, E(req), { toutes: req.query.toutes === '1' })));
  api.post('/chsld/taches', route((req) => ch.creerTache(pool, req.utilisateur, req.body)));
  api.post('/chsld/taches/:id/statut', route((req) => ch.statutTache(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.post('/chsld/communications/:id/statut', route((req) => ch.statutCommunication(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  // Coordinations entre établissements (hôpitaux et CHSLD) : chacun ne voit et n'agit que de son côté
  /* ---------- Liaison Établissements : demandes de transport (établissement ↔ ambulance), cahier 3 ---------- */
  const tr = require('./transports');
  api.get('/transports/organisations', route((req) => tr.organisations(pool, req.utilisateur, req.query.etablissement_id)));
  api.post('/transports-planifies', route((req) => tr.planifier(pool, req.utilisateur, req.body)));   // Transport non urgent (20 nov. 2026)
  api.get('/transports', route((req) => tr.liste(pool, req.utilisateur, req.query)));
  api.get('/transports/:id', route((req) => tr.fiche(pool, req.utilisateur, entier(req.params.id, 'id'), req.query)));
  api.post('/coordinations/:id/transport', route((req) => tr.demander(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.post('/transports/:id/action', route((req) => tr.agir(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.get('/secours/transports', route((req) => tr.liste(pool, req.utilisateur, {})));
  api.get('/secours/transports/:id', route((req) => tr.fiche(pool, req.utilisateur, entier(req.params.id, 'id'), {})));
  api.post('/secours/transports/:id/action', route((req) => tr.agir(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  /* ---------- Préhospitalier : préalertes (Liaison Secours), unités, positions ---------- */
  const pa = require('./prealertes');
  api.get('/secours/prealertes', route((req) => pa.liste(pool, req.utilisateur, req.query)));
  api.post('/secours/prealertes', route(async (req) => {
    const r = await pa.creer(pool, req.utilisateur, req.body);
    // Heure d'arrivée calculée depuis la dernière position de l'unité (prise par le téléphone juste avant l'envoi)
    const pos = (await pool.query("SELECT latitude, longitude FROM positions_unites WHERE unite_id = $1 AND enregistree_le > now() - interval '10 minutes' ORDER BY enregistree_le DESC LIMIT 1", [r.unite_id])).rows[0];
    if (pos && !r.rejoue) r.eta = await pa.recalculerEta(pool, r.unite_id, pos).catch(() => null);
    return r;
  }));
  api.get('/secours/prealertes/:id', route((req) => pa.fiche(pool, req.utilisateur, entier(req.params.id, 'id'), req.query)));
  api.post('/secours/prealertes/:id/action', route((req) => pa.agir(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.get('/secours/unites', route((req) => pa.unites(pool, req.utilisateur)));
  // Scénario D : correspondance de dossier par un système hospitalier simulé (démonstration seulement)
  api.post('/secours/prealertes/:id/correspondance', route((req) => require('./correspondance-simulee').rechercher(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.post('/secours/prealertes/:id/correspondance/confirmer', route((req) => require('./correspondance-simulee').confirmer(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.get('/secours/services', route((req) => pa.servicesHopital(pool, req.utilisateur, req.query.etablissement_id)));
  api.get('/secours/urgence', route((req) => pa.statutUrgence(pool, req.utilisateur, req.query.etablissement_id)));
  api.post('/secours/urgence', route((req) => pa.declarerUrgence(pool, req.utilisateur, req.body)));
  api.get('/secours/destinations', route((req) => pa.destinations(pool, req.utilisateur, req.query)));
  api.post('/secours/og', route((req) => require('./og-secours').repondreSecours(pool, req.utilisateur, req.body.question, req.langue)));
  api.post('/secours/unites/:id/position', route((req) => pa.position(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  // État des véhicules (13 nov. 2026) : l'équipage le change, le CCS le consulte ; aucune attribution dans Arrimo
  const vh = require('./vehicules');
  api.get('/secours/vehicules', route((req) => vh.liste(pool, req.utilisateur)));
  api.get('/secours/hebergements', route((req) => vh.hebergements(pool, req.utilisateur)));
  const rs = require('./reservations');
  api.post('/secours/prealertes/:id/reponse', route((req) => rs.repondre(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.post('/secours/prealertes/:id/installer', route((req) => rs.installer(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.get('/secours/prealertes/:id/alternative', route((req) => rs.alternative(pool, req.utilisateur, entier(req.params.id, 'id'))));
  api.get('/secours/listes', route(() => ({ motifs: rs.MOTIFS, tranches: rs.TRANCHES, sexes: rs.SEXES, signes: rs.SIGNES, delai_s: rs.delai(), profil: require('./environnement').estDemo() })));
  api.get('/secours/urgences-classees', route((req) => vh.urgencesClassees(pool, req.utilisateur, req.query)));
  api.post('/secours/unites/:id/etat', route((req) => vh.definir(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  // Missions proposées par le CCS, acceptées ou refusées par l'équipage (16 nov. 2026)
  const mc = require('./missions-ccs');
  api.get('/secours/missions', route((req) => mc.liste(pool, req.utilisateur)));
  api.post('/secours/missions', route((req) => mc.proposer(pool, req.utilisateur, req.body)));
  api.post('/secours/missions/:id/action', route((req) => mc.agir(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  // Établissements d'hébergement : urgences proches (capacités globales seulement)
  api.get('/urgences-proches', route((req) => vh.urgencesProches(pool, req.utilisateur, req.query.etablissement_id)));
  api.get('/coordinations', route((req) => ch.listeCoordinations(pool, req.utilisateur, E(req), { toutes: req.query.toutes === '1' })));
  api.post('/coordinations/:id/action', route((req) => ch.actionCoordination(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.get('/liaison-chsld/hopitaux', route(async (req) => { await require('./liaison-chsld').etabHopital(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id')); return (await ch.hopitauxLiaison(pool)).map((h) => ({ id: h.id, nom: h.nom })); }));
  api.post('/coordinations/:id/transfert-hopital', route((req) => ch.preparerTransfertHopital(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.post('/coordinations/:id/retour', route((req) => ch.preparerRetour(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.get('/admissions/alternatives', route((req) => t.alternativesAdmission(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
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
  api.get('/meteo', route((req) => require('./meteo').meteo(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
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
  // Fonctions OG contrôlées côté serveur selon la licence SH et les réglages de l'établissement.
  const avecFonctionOg = (fonction, champ, fn) => route(async (req) => {
    const etab = entier(champ === 'query' ? req.query.etablissement_id : req.body.etablissement_id, 'etablissement_id');
    exigerEtablissement(req.utilisateur, etab);
    await ogConfiguration.exigerFonction(pool, etab, fonction);
    return fn(req, etab);
  });
  api.post('/copilote/question', avecFonctionOg('texte', 'body', (req, etab) => copilote.question(pool, req.utilisateur,
    etab, String(req.body.question || '').slice(0, 500), undefined, req.body.patient_id_context)));

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
      await t.synchroniserConge(c, id, req.utilisateur.id);
      return rows[0];
    });
  }));

  /* ---------- patients fictifs et arrivées à l'urgence (démonstration et recette seulement) ---------- */
  const pat = require('./patients');
  api.get('/patients', route((req) => pat.listePatients(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'), req.query.q)));
  const ogPatients = require('./og-recherche-patients');
  api.get('/copilote/patients/recherche', avecFonctionOg('patients', 'query', (req, etab) => ogPatients.rechercher(pool, req.utilisateur, etab, req.query.q)));
  api.get('/copilote/patients/:id', avecFonctionOg('patients', 'query', (req, etab) => ogPatients.consulter(pool, req.utilisateur, etab, entier(req.params.id, 'id'))));
  const ogBrouillonsPatients = require('./og-brouillons-patients');
  api.post('/copilote/patients/brouillons', avecFonctionOg('patients', 'body', (req, etab) => ogBrouillonsPatients.creerBrouillon(pool, req.utilisateur, etab, req.body)));
  api.post('/copilote/patients/brouillons/:id/confirmer', avecFonctionOg('patients', 'body', (req, etab) => ogBrouillonsPatients.confirmerBrouillon(pool, req.utilisateur,
    etab, req.params.id, req.body.accepter_doublons === true)));
  api.delete('/copilote/patients/brouillons/:id', route((req) => ogBrouillonsPatients.annulerBrouillon(req.utilisateur,
    entier(req.body.etablissement_id, 'etablissement_id'), req.params.id)));
  api.post('/patients', route((req) => pat.creerPatient(pool, req.utilisateur, entier(req.body.etablissement_id, 'etablissement_id'), req.body)));
  api.put('/patients/:id', route((req) => pat.modifierPatient(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  const hist = require('./patients-historique');
  api.get('/patients/:id/historique', route((req) => hist.historique(pool, req.utilisateur, entier(req.params.id, 'id'), { identiteVerifiee: req.query.identite_verifiee === '1' })));
  api.post('/patients/:id/passages', route((req) => hist.creerPassage(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.post('/passages/:id/cloture', route((req) => hist.cloturerPassage(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.post('/urgence/arrivees', route((req) => pat.enregistrerArrivee(pool, req.utilisateur, req.body)));
  api.get('/specialites', route(async () => (await pool.query('SELECT * FROM specialites_catalogue ORDER BY ordre')).rows));

  /* ---------- congés par lit, blocages explicables, fraîcheur ---------- */
  const vig = require('./vigilance');
  api.get('/conges', route((req) => vig.conges(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'), {
    horizon: req.query.horizon, jour: req.query.jour, unite: req.query.unite, statut: req.query.statut })));
  api.get('/vigilance', route((req) => vig.blocages(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));

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
  api.get('/transferts/:id/alternatives', route((req) => s.alternativesTransfert(pool, req.utilisateur, entier(req.params.id, 'id'))));
  api.put('/transferts/:id/responsable', route((req) => s.definirServiceResponsable(pool, req.utilisateur, entier(req.params.id, 'id'), req.body.service_responsable)));
  api.post('/transferts/:id/relancer', route((req) => s.relancerTransfert(pool, req.utilisateur, entier(req.params.id, 'id'))));
  api.post('/transferts/:id/:etape', route((req) => s.avancerTransfert(pool, req.utilisateur,
    entier(req.params.id, 'id'), req.params.etape, req.body)));

  /* ---------- journal, notifications ---------- */
  api.get('/journal', route((req) => s.lireJournal(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'), req.query)));
  // Arrimo Continuité : parcours complet CHSLD → ambulance → hôpital → retour, lecture seule (16 nov. 2026)
  api.get('/continuite', route((req) => require('./continuite').liste(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'), { tous: req.query.tous === '1' })));
  // Recherche unique par référence, prénom ou nom, dans l'établissement choisi (16 nov. 2026)
  api.get('/recherche-personnes', route((req) => require('./recherche').rechercher(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'), req.query.q)));
  api.get('/notifications', route((req) => s.lireNotifications(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.post('/notifications/lues', route(async (req) => {
    const etab = entier(req.body.etablissement_id, 'etablissement_id');
    exigerEtablissement(req.utilisateur, etab);
    await pool.query('UPDATE notifications SET lu = true WHERE etablissement_id = $1 AND NOT lu', [etab]);
  }));

  /* ---------- mon compte et administration ---------- */
  const { exigerGestionnaire, journalAdmin } = admin.brancher(api, pool, route, entier, { maintenanceDemo: (req, fn) => req.avecMaintenanceDemo(fn) });
  // Administration du préhospitalier : organisations de secours, unités, comptes, systèmes reliés (gestionnaire réseau)
  require('./admin-secours').brancher(api, pool, route, entier);
  api.put('/admin/etablissements/:id', route(async (req) => {
    exigerGestionnaire(req);
    const r = await majEtablissement('id', entier(req.params.id, 'id'), req.body);
    await journalAdmin(pool, req.utilisateur, 'Établissement modifié', r.nom, `partage ${r.partage} · module ${r.module_actif ? 'activé' : 'désactivé'}`, r.id);
    return r;
  }));

  // Mise à jour en direct (SSE) : hors du routeur API pour ne pas retenir la remise à zéro de la démo
  // Session absente ou expirée (démo remise à zéro…) : 204 sans contenu, l'écran cesse d'écouter sans erreur affichée
  const sessionFlux = exigerSession(pool);
  app.get('/api/flux', (req, res) => sessionFlux(req, res, (err) => (err ? res.status(204).end() : require('./flux').brancher(req, res))));
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
