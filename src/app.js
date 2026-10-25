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

function creerApp(pool) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');   // derrière Nginx : l'adresse du client vient de X-Forwarded-For
  app.use('/api', limiteur());
  // Import CSV : jusqu'à 1 Mo (même limite que Nginx) ; ailleurs 50 Ko
  app.use(['/api/admin/import', '/api/sh/import'], express.json({ limit: '1mb' }));
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
  // La remise à zéro de démo remplace le schéma de démonstration. Drainer les requêtes
  // déjà engagées et refuser temporairement les nouvelles évite les lectures entre DROP/CREATE.
  let maintenanceDemo = false; let requetesApiActives = 0; const attentesDrain = [];
  const attendreDrain = () => requetesApiActives === 0 ? Promise.resolve() : new Promise((resolve) => attentesDrain.push(resolve));
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

  /* ---------- informations publiques : serveur de démonstration, champs des pages légales ---------- */
  const CHAMPS_LEGAUX = ['entite', 'adresse', 'responsable', 'contact', 'duree_comptes', 'duree_journaux', 'duree_references', 'hebergeur', 'entente'];
  api.get('/public', route(async (req) => ({
    demo: env.estDemo(),
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
      await pool.query('SELECT 1');
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

  // Gestionnaire réseau : périmètre de tout le réseau, donc double authentification obligatoire avant toute action
  // (comme l'administration). Exceptions : serveur de démonstration (compte réseau public) et ARRIMO_2FA_ADMIN=0 (tests).
  api.use((req, res, next) => {
    const u = req.utilisateur;
    if (!u.gestionnaire || u.totp_actif || env.estDemo() || process.env.ARRIMO_2FA_ADMIN === '0') return next();
    const ok = (req.method === 'GET' && req.path === '/moi') || req.path.startsWith('/moi/2fa/') || (req.method === 'PUT' && req.path === '/moi/mot-de-passe')
      || (req.method === 'POST' && req.path === '/deconnexion');
    return ok ? next() : next(new ErreurHttp(403, 'admin_exige_2fa'));
  });

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
      `SELECT e.id, e.code, e.nom, e.ville, e.partage, e.module_actif, e.config_id, e.rayon_alerte_km, e.modules, e.vocation,
              ARRAY(SELECT DISTINCT l.type_id FROM lits l WHERE l.etablissement_id = e.id) AS types_presents
         FROM etablissements e
        WHERE e.actif AND ($1 OR e.id = ANY($2::int[]))
        ORDER BY e.nom`, [u.gestionnaire, u.etabs]);
    const configs = await pool.query(
      `SELECT c.*, COALESCE(json_agg(t.* ORDER BY t.ordre) FILTER (WHERE t.id IS NOT NULL), '[]') AS types
         FROM config_pays c LEFT JOIN types_unite t ON t.config_id = c.id
        WHERE c.id = ANY($1::int[]) GROUP BY c.id`, [[...new Set(rows.map((e) => e.config_id))]]);
    return { utilisateur: { id: u.id, nom: u.nom, email: u.email, role: u.role, admin: u.admin, gestionnaire: u.gestionnaire,
      totp_actif: u.totp_actif, mdp_temporaire: u.mdp_temporaire, premiers_pas_vus: u.premiers_pas_vus },
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
  const priorites = require('./priorites');
  api.get('/admissions/referentiel', route((req) => priorites.referentiel(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.put('/admissions/referentiel', route((req) => priorites.configurer(pool, req.utilisateur, entier(req.body.etablissement_id, 'etablissement_id'), req.body)));
  api.get('/admissions/habilitations', route((req) => priorites.habilitations(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.put('/admissions/habilitations/:utilisateurId', route((req) => priorites.habiliter(pool, req.utilisateur,
    entier(req.body.etablissement_id, 'etablissement_id'), entier(req.params.utilisateurId, 'utilisateurId'), req.body)));
  api.post('/admissions/:id/priorite', route((req) => priorites.valider(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
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
      await t.synchroniserConge(c, id, req.utilisateur.id);
      return rows[0];
    });
  }));

  /* ---------- patients fictifs et arrivées à l'urgence (démonstration et recette seulement) ---------- */
  const pat = require('./patients');
  api.get('/patients', route((req) => pat.listePatients(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'), req.query.q)));
  api.post('/patients', route((req) => pat.creerPatient(pool, req.utilisateur, entier(req.body.etablissement_id, 'etablissement_id'), req.body)));
  api.put('/patients/:id', route((req) => pat.modifierPatient(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
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
  api.get('/notifications', route((req) => s.lireNotifications(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.post('/notifications/lues', route(async (req) => {
    const etab = entier(req.body.etablissement_id, 'etablissement_id');
    exigerEtablissement(req.utilisateur, etab);
    await pool.query('UPDATE notifications SET lu = true WHERE etablissement_id = $1 AND NOT lu', [etab]);
  }));

  /* ---------- mon compte et administration ---------- */
  const { exigerGestionnaire, journalAdmin } = admin.brancher(api, pool, route, entier, { maintenanceDemo: (req, fn) => req.avecMaintenanceDemo(fn) });
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
