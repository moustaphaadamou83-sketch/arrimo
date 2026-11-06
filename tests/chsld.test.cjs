'use strict';
/**
 * Produit CHSLD de bout en bout, données synthétiques seulement :
 * console SH (type d'établissement, catalogue de modules, provisionnement des deux CHSLD fictifs, activation),
 * environnement pilote isolé contenant les hôpitaux A, B et C, comptes invités et connexions réelles,
 * parcours CHSLD (résidents, contacts, autorisations, places, demandes, hospitalisation, retour, transfert inter-CHSLD,
 * tâches, communications), OG, sécurité (permissions, isolation, double attribution) et non-régression hospitalière.
 */
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Pool } = require('pg');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { creerAppSh } = require('../src/sh/app');
const { viderBaseSh } = require('../db/sh-vider');
const { premierCompteSh } = require('../db/sh-premier-compte');
const invitations = require('../src/sh/invitations');
const totp = require('../src/totp');
const courriel = require('../src/courriel');
const { demarrerServeur } = require('./serveur-test.cjs');
const { CHSLD } = require('../db/provisionner-chsld');

const URL_TEST = process.env.TEST_DATABASE_URL;
const CLE_MFA = Buffer.alloc(32, 7).toString('base64');
const MDP = 'Chsld-Fictif-2026';
let pool, poolPilote, serveurSh, serveurPilote, baseSh, basePilote, dossierDocs, jetonSh;
const courriels = [];
const sessions = {};
const RESULTATS = { sh: {}, provisionnement: [], parcours: [] };

async function appelSh(methode, chemin, corps, jeton = jetonSh) {
  const r = await fetch(`${baseSh}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
async function sh(methode, chemin, corps) { const r = await appelSh(methode, chemin, corps); assert.ok(r.statut === 200, `SH ${methode} ${chemin} → ${r.statut} ${JSON.stringify(r.corps)}`); return r.corps; }
async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${basePilote}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(sessions[qui] ? { Authorization: `Bearer ${sessions[qui]}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
async function api(qui, methode, chemin, corps) { const r = await appel(qui, methode, chemin, corps); assert.ok(r.statut === 200, `${qui} ${methode} ${chemin} → ${r.statut} ${JSON.stringify(r.corps)}`); return r.corps; }
const refuse = async (qui, methode, chemin, corps, statut, code) => { const r = await appel(qui, methode, chemin, corps); assert.strictEqual(r.statut, statut, `${qui} ${methode} ${chemin} → ${r.statut} ${JSON.stringify(r.corps)}`); if (code) assert.strictEqual(r.corps.code, code); return r.corps; };
async function ouvrirSessionSh(email) {
  let r = await appelSh('POST', '/connexion', { email, mot_de_passe: MDP }, null);
  const { secret } = (await appelSh('POST', '/moi/2fa/preparer', null, r.corps.token)).corps;
  await appelSh('POST', '/moi/2fa/activer', { code: totp.codePourPas(secret, totp.pasActuel()) }, r.corps.token);
  r = await appelSh('POST', '/connexion', { email, mot_de_passe: MDP }, null);
  r = await appelSh('POST', '/connexion/2fa', { jeton: r.corps.jeton, code: totp.codePourPas(secret, totp.pasActuel() + 1) }, null);
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  return r.corps.token;
}

test.before(async () => {
  assert.ok(URL_TEST, 'TEST_DATABASE_URL requis');
  assert.match(new URL(URL_TEST).pathname, /^\/arrimo_sh_lot1_test_[a-z0-9_]+$/);
  process.env.SH_API_KEY = 'cle-chsld-sh-0123456789abcdef'; process.env.SH_MFA_ENCRYPTION_KEY = CLE_MFA;
  process.env.ARRIMO_URL = 'https://arrimo.test.invalid'; process.env.SH_PUBLIC_URL = 'https://sh.test.invalid';
  process.env.SH_INITIAL_ADMIN_EMAIL = 'admin.chsld@sh.exemple'; process.env.ARRIMO_ENV = 'pilote'; process.env.ARRIMO_PATIENTS_FICTIFS = '1';
  process.env.API_LIMITE_SESSION = '100000'; process.env.API_LIMITE_ANONYME = '100000'; // batteries de 600 cas et d'attaques : limites de débit relevées pour ce test seulement
  delete process.env.ARRIMO_DEMO;
  courriel.definirTransport(async (m) => { courriels.push(m); });
  pool = creerPool(URL_TEST);
  // Environnement pilote isolé : schéma séparé contenant les hôpitaux A, B et C (Démo ABC fictive), sans toucher à la démo publique.
  await pool.query('CREATE SCHEMA IF NOT EXISTS pilote_chsld');
  poolPilote = new Pool({ connectionString: URL_TEST, options: '-c search_path=pilote_chsld' });
  process.env.DEMO_MOT_DE_PASSE = MDP;
  await require('../db/demo-trio').preparerDemoTrio(poolPilote, { silencieux: true, fichierAcces: path.join(os.tmpdir(), `acces-chsld-${process.pid}.txt`) });
  serveurPilote = await demarrerServeur(creerApp(poolPilote)); basePilote = `http://127.0.0.1:${serveurPilote.address().port}`;
  dossierDocs = fs.mkdtempSync(path.join(os.tmpdir(), 'arrimo-chsld-docs-'));
  await viderBaseSh(pool);
  await premierCompteSh(pool, 'admin.chsld@sh.exemple', 'Administration fictive');
  await invitations.consommer(pool, { jeton: courriels.at(-1).texte.match(/#invitation=([a-f0-9]{64})/)[1], nouveau: MDP }, process.env);
  serveurSh = await demarrerServeur(creerAppSh(pool, { env: { SH_PUBLIC_URL: 'https://sh.test.invalid', SH_MFA_ENCRYPTION_KEY: CLE_MFA, SH_DOCUMENTS_DIR: dossierDocs,
    SH_ENV_PILOTE_URL: basePilote, SH_ENV_PILOTE_CLE: process.env.SH_API_KEY, SH_ENV_PILOTE_PUBLIC: 'https://pilote.example.invalid', SH_EMETTEUR_NOM: 'SH fictive inc.' } }));
  baseSh = `http://127.0.0.1:${serveurSh.address().port}`;
  jetonSh = await ouvrirSessionSh('admin.chsld@sh.exemple');
});
test.after(async () => {
  serveurSh?.close(); serveurPilote?.close(); await poolPilote?.end().catch(() => {});
  await pool?.query('DROP SCHEMA IF EXISTS pilote_chsld CASCADE').catch(() => {}); await pool?.end();
  fs.mkdirSync(path.resolve('.local'), { recursive: true });
  fs.writeFileSync(path.resolve('.local/chsld-rapport-tests.json'), `${JSON.stringify(RESULTATS, null, 2)}\n`);
});

test('SH : le type d’établissement vient en premier et commande les modules proposés', async () => {
  const hop = await sh('GET', '/catalogue-modules?type=hopital');
  const chs = await sh('GET', '/catalogue-modules?type=chsld');
  assert.deepStrictEqual(hop.types.map((t) => [t.code, t.statut]), [['hopital', 'operationnel'], ['chsld', 'operationnel'], ['maison_aines', 'a_venir'], ['rpa', 'a_venir'], ['ressource_intermediaire', 'a_venir']]);
  const codes = (r, cat) => r.modules.filter((m) => m.categorie === cat).map((m) => m.code);
  assert.ok(codes(chs, 'commun').includes('og') && codes(hop, 'commun').includes('og'), 'socle commun pour les deux types');
  assert.deepStrictEqual(codes(chs, 'hopital'), [], 'aucun module hospitalier proposé à un CHSLD');
  assert.ok(['residents', 'chambres', 'demandes_hebergement', 'entretien_chsld', 'taches', 'proches', 'hospitalisations', 'reseau_chsld'].every((c) => codes(chs, 'chsld').includes(c)));
  assert.ok(codes(hop, 'hopital').includes('civieres') && !codes(hop, 'chsld').length, 'urgence et civières (code historique « civieres ») pour l’hôpital');
  assert.deepStrictEqual(chs.modules.filter((m) => m.categorie === 'optionnel').map((m) => [m.code, m.statut]), [['portail_proches', 'disponible'], ['messagerie_securisee', 'disponible'], ['appels_video', 'etude']]);
  RESULTATS.sh.catalogue = { hopital: hop.modules.map((m) => `${m.categorie}:${m.code}:${m.statut}`), chsld: chs.modules.map((m) => `${m.categorie}:${m.code}:${m.statut}`) };
  // Types futurs : prévus mais refusés ; modules non implémentés : jamais souscrits
  for (const type of ['maison_aines', 'rpa', 'ressource_intermediaire']) {
    const r = await appelSh('POST', '/hopitaux', { type_etablissement: type, nom: `Essai ${type}`, code_etab: `ES-${type.slice(0, 3).toUpperCase()}`, environnement: 'pilote', pays_code: 'CA', latitude: 45, longitude: -71 });
    assert.strictEqual(r.statut, 409, type); assert.match(r.corps.erreur, /pas encore opérationnel/);
  }
  const r = await appelSh('POST', '/hopitaux', { type_etablissement: 'chsld', modules: { appels_video: true }, nom: 'Essai vidéo', code_etab: 'ES-VIDEO', environnement: 'pilote', pays_code: 'CA', latitude: 45, longitude: -71 });
  assert.strictEqual(r.statut, 409); assert.match(r.corps.erreur, /pas encore disponible/);
  RESULTATS.sh.refus = ['maison_aines', 'rpa', 'ressource_intermediaire', 'module appels_video (à l’étude)'];
});

let crees, ids;
test('reprise en Démo ABC : jamais l’éditeur de structure SH (refusé hors recette), lecture seule de l’environnement ; refus si déjà activé', async () => {
  // Reproduit l'erreur du 1er nov. : GET /hopitaux/:id/structure refusé en demo_abc (garde Go Live de l'éditeur)
  const { provisionner, csvChsld } = require('../db/provisionner-chsld');
  const MESSAGE = 'La structure est modifiable dans SH uniquement avant le Go Live en recette. Après activation, Arrimo est la référence opérationnelle.';
  const appels = [];
  const faux = (statut) => async (methode, chemin, corps) => {
    appels.push(`${methode} ${chemin}`);
    if (/^\/hopitaux\/\d+\/structure$/.test(chemin)) throw new Error(MESSAGE);
    if (methode === 'GET' && /^\/hopitaux\/\d+$/.test(chemin)) return { id: Number(chemin.split('/')[2]), type_etablissement: 'chsld', relie: true, statut, golive_le: null, environnement: 'demo_abc', formation: [], etapes: [] };
    if (methode === 'POST' && chemin === '/hopitaux') return { id: 99 };
    if (chemin.endsWith('/import/verifier')) return { nb_erreurs: 0, empreinte: 'e', resume: { creer: corps.type === 'utilisateurs' ? 4 : 0, maj: 0, inchange: 1 } };
    return {};
  };
  const era = csvChsld(CHSLD[0]), lignes = (t) => era[t].trim().split('\n').slice(1).map((l) => l.split(';'));
  const structure = { unites: lignes('unites').map((x) => ({ unite: x[0] })), chambres: lignes('chambres').map((x) => ({ unite: x[0], chambre: x[1] })), lits: lignes('lits').map((x) => ({ lit: x[2] })) };
  const r = await provisionner(faux('implantation'), { environnement: 'demo_abc', existants: { 'CHSLD-ERA': 43 }, lireStructure: async () => structure });
  assert.ok(!appels.some((a) => /\/structure$/.test(a)), 'l’éditeur de structure SH n’est jamais appelé');
  assert.deepStrictEqual(r[0].reprise, { avant: { unites: 3, chambres: 50, lits: 60, cible_lits: 60 }, ajouts: { departements: 0, services: 0, unites: 0, chambres: 0, lits: 0, utilisateurs: 4 } });
  assert.ok(appels.includes('POST /hopitaux'), 'le CHSLD 2 est créé');
  // Élément hors cible : arrêt, rien n'est supprimé
  await assert.rejects(provisionner(faux('implantation'), { environnement: 'demo_abc', existants: { 'CHSLD-ERA': 43 }, lireStructure: async () => ({ ...structure, lits: [...structure.lits, { lit: 'ERA-999' }] }) }), /hors configuration cible.*ERA-999/);
  // Fiche déjà activée : reprise refusée (procédure de correction à décider)
  await assert.rejects(provisionner(faux('actif'), { environnement: 'demo_abc', existants: { 'CHSLD-ERA': 43 }, lireStructure: async () => structure }), /déjà activée/);
});

test('SH : création, provisionnement et activation des deux CHSLD fictifs, sans configuration manuelle', { timeout: 300000 }, async () => {
  // Installation interrompue (cas réel du 1er nov.) : fiche CHSLD 1 créée, reliée, structure importée, comptes absents.
  const { csvChsld } = require('../db/provisionner-chsld');
  const era = CHSLD[0], csvEra = csvChsld(era);
  const partiel = await sh('POST', '/hopitaux', { type_etablissement: 'chsld', modules: { portail_proches: true, messagerie_securisee: true }, nom: era.nom, code_etab: era.code, environnement: 'pilote', pays_code: 'CA',
    ville: era.ville, latitude: era.latitude, longitude: era.longitude, utilisateurs_prevus: 4, utilisateurs_autorises: 8, contact_nom: `Direction fictive · ${era.nom}` });
  await sh('POST', `/hopitaux/${partiel.id}/relier`, {});
  for (const type of ['departements', 'services', 'unites', 'chambres', 'lits']) {
    const v = await sh('POST', `/hopitaux/${partiel.id}/import/verifier`, { type, contenu: csvEra[type] });
    await sh('POST', `/hopitaux/${partiel.id}/import/importer`, { type, contenu: csvEra[type], empreinte: v.empreinte });
  }
  // Bouton SH « Créer les CHSLD de démonstration » (administration) : reprise du CHSLD 1, création du CHSLD 2, puis scénarios
  await sh('POST', '/demo-chsld', { environnement: 'pilote' });
  assert.strictEqual((await appelSh('POST', '/demo-chsld', { environnement: 'pilote' })).statut, 409, 'une seule création à la fois');
  let demo; for (let i = 0; i < 150; i += 1) { demo = await sh('GET', '/demo-chsld?environnement=pilote'); if (demo.statut !== 'en_cours') break; await new Promise((r) => setTimeout(r, 2000)); }
  assert.strictEqual(demo.statut, 'termine', JSON.stringify(demo));
  assert.deepStrictEqual(demo.etablissements.map((e) => e.nom), ['CHSLD 1 — des Érables', 'CHSLD 2 — du Saint-Laurent']);
  // Reprise : même fiche, aucun doublon, structure existante conservée (60 lits), seuls les comptes ajoutés
  assert.strictEqual(demo.etablissements[0].id, partiel.id);
  assert.deepStrictEqual(demo.etablissements[0].reprise, { avant: { unites: 3, chambres: 50, lits: 60, cible_lits: 60 },
    ajouts: { departements: 0, services: 0, unites: 0, chambres: 0, lits: 0, utilisateurs: 4 } });
  assert.strictEqual(demo.etablissements[1].reprise, null);
  assert.strictEqual((await poolPilote.query("SELECT count(*)::int n FROM etablissements WHERE code LIKE 'CHSLD-%'")).rows[0].n, 2, 'aucun doublon');
  assert.strictEqual((await appelSh('POST', '/demo-chsld', { environnement: 'pilote' })).statut, 409, 'pas de doublon');
  assert.strictEqual((await appelSh('POST', '/demo-chsld', { environnement: 'production' })).statut, 409, 'jamais hors environnement fictif');
  const { ROLES, courrielDe } = require('../db/provisionner-chsld');
  crees = CHSLD.map((c) => ({ ...c, hopital_id: demo.etablissements.find((e) => e.code === c.code).id, comptes: Object.fromEntries(ROLES.map(([, cle, role]) => [cle, { courriel: courrielDe(c, cle), role }])) }));
  for (const c of crees) {
    const fiche = await sh('GET', `/hopitaux/${c.hopital_id}`);
    assert.strictEqual(fiche.type_etablissement, 'chsld');
    assert.ok(fiche.modules.every((m) => ['commun', 'chsld', 'optionnel'].includes(m.categorie)), 'licences limitées au type');
    // Modules inclus souscrits ; OG reste sans décision SH (licence par défaut de l'environnement, fonctions décidées à part)
    assert.ok(fiche.modules.filter((m) => m.statut === 'inclus' && m.code !== 'og').every((m) => m.licence === 'souscrit'));
    assert.strictEqual(fiche.modules.find((m) => m.code === 'og').licence, 'non_selectionne');
    assert.ok(fiche.modules.filter((m) => ['a_venir', 'etude'].includes(m.statut)).every((m) => m.licence === 'non_selectionne'));
    const e = (await poolPilote.query('SELECT e.*, c.code AS config, p.code AS profil FROM etablissements e JOIN config_pays c ON c.id = e.config_id LEFT JOIN config_pays p ON p.id = e.profil_config_id WHERE e.code = $1', [c.code])).rows[0];
    assert.ok(e.module_actif && e.type_etablissement === 'chsld' && e.config === 'QC-CHSLD' && e.profil === 'QC');
    const n = (await poolPilote.query('SELECT count(*)::int n, count(DISTINCT chambre_id)::int ch FROM lits WHERE etablissement_id = $1', [e.id])).rows[0];
    const attendu = c.code === 'CHSLD-ERA' ? 60 : 90;
    assert.strictEqual(n.n, attendu, `${c.code} : ${attendu} lits`);
    const unites = (await poolPilote.query('SELECT count(*)::int n FROM unites WHERE etablissement_id = $1', [e.id])).rows[0].n;
    assert.strictEqual(unites, 3);
    const comptes = (await poolPilote.query('SELECT u.role FROM utilisateurs u JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id WHERE ue.etablissement_id = $1 ORDER BY u.role', [e.id])).rows.map((x) => x.role);
    assert.deepStrictEqual(comptes, ['admin_etab', 'coordonnateur', 'entretien', 'equipe_soins']);
    RESULTATS.provisionnement.push({ code: c.code, nom: c.nom, type: e.type_etablissement, configuration: e.config, profil_pays: e.profil, lits: n.n, chambres: n.ch, unites, comptes, actif: e.module_actif,
      modules_souscrits: fiche.modules.filter((m) => m.licence === 'souscrit').map((m) => m.code) });
  }
  // Les hôpitaux A, B et C restent intacts : type hôpital, configuration QC
  const hop = (await poolPilote.query(`SELECT code, type_etablissement, (SELECT code FROM config_pays WHERE id = config_id) cfg FROM etablissements WHERE code IN ('HX','HY','HC') ORDER BY code`)).rows;
  assert.ok(hop.length === 3 && hop.every((h) => h.type_etablissement === 'hopital' && h.cfg === 'QC'));
});

test('personnel : connexions réelles avec le mot de passe de démonstration, comptes distincts, interface adaptée au type', async () => {
  for (const c of crees) for (const [cle, x] of Object.entries(c.comptes)) {
    sessions[`${c.code === 'CHSLD-ERA' ? 'era' : 'stl'}_${cle}`] = (await api(null, 'POST', '/connexion', { email: x.courriel, mot_de_passe: MDP })).token;
    const m = await api(`${c.code === 'CHSLD-ERA' ? 'era' : 'stl'}_${cle}`, 'GET', '/moi');
    assert.strictEqual(m.utilisateur.role, x.role); assert.strictEqual(m.utilisateur.mdp_temporaire, false); assert.deepStrictEqual(m.etablissements.map((e) => e.code), [c.code]);
  }
  sessions.era = sessions.era_coordination; sessions.stl = sessions.stl_coordination;
  sessions.b = (await api(null, 'POST', '/connexion', { email: 'hopital.b@demo.arrimo', mot_de_passe: MDP })).token;
  sessions.a = (await api(null, 'POST', '/connexion', { email: 'hopital.a@demo.arrimo', mot_de_passe: MDP })).token;
  const moi = await api('era', 'GET', '/moi');
  assert.strictEqual(moi.etablissements.length, 1); assert.strictEqual(moi.etablissements[0].type_etablissement, 'chsld');
  assert.strictEqual((await api('b', 'GET', '/moi')).etablissements.find((e) => e.code === 'HY').type_etablissement, 'hopital');
});

let p;
test('parcours CHSLD réels : peuplement par le personnel, places, contacts, demandes, hospitalisation, transfert', { timeout: 300000 }, async () => {
  const hopitalB = (await poolPilote.query("SELECT id FROM etablissements WHERE code = 'HY'")).rows[0].id;
  // Scénarios déjà saisis par l'environnement à la demande de SH : on retrouve leurs identifiants
  const id = async (sql, v) => (await poolPilote.query(sql, v)).rows[0].id;
  ids = { era: await id("SELECT id FROM etablissements WHERE code='CHSLD-ERA'"), stl: await id("SELECT id FROM etablissements WHERE code='CHSLD-STL'") };
  p = { ids, dupont: await id("SELECT id FROM residents WHERE nom='Dupont' AND prenom='Jean'"), martin: await id("SELECT id FROM residents WHERE nom='Martin' AND prenom='Gilles'"),
    hospitalisation: await id("SELECT id FROM coordinations WHERE type='hospitalisation'"), retour: await id("SELECT id FROM coordinations WHERE type='retour'"), transfert: await id("SELECT id FROM coordinations WHERE type='transfert_chsld'") };
  assert.ok(hopitalB);
  const accueilEra = await api('era', 'GET', `/chsld/accueil?etablissement_id=${ids.era}`);
  assert.strictEqual(accueilEra.places.dotees + accueilEra.places.bloquees, 60);
  assert.strictEqual(accueilEra.places.occupees, 49, 'Érables : 50 admis, 1 fin d’hébergement'); assert.strictEqual(accueilEra.places.reservees, 1); assert.strictEqual(accueilEra.places.preparation, 1); assert.strictEqual(accueilEra.places.bloquees, 1);
  const accueilStl = await api('stl', 'GET', `/chsld/accueil?etablissement_id=${ids.stl}`);
  assert.strictEqual(accueilStl.places.conservees, 1, 'place conservée pendant l’hospitalisation'); assert.strictEqual(accueilStl.residents.hospitalise, 1);
  RESULTATS.parcours.push({ accueil_erables: accueilEra.places, accueil_saint_laurent: accueilStl.places });
  // Jean Dupont : deux contacts, autorisations distinctes ; communication refusée au fils non autorisé
  const f = await api('era', 'GET', `/chsld/residents/${p.dupont}`);
  assert.strictEqual(f.contacts.length, 2); const fille = f.contacts.find((k) => k.relation === 'fille'), fils = f.contacts.find((k) => k.relation === 'fils');
  assert.ok(fille.principal && fille.autorisations.includes('mouvements') && !fils.autorisations.length);
  await api('era', 'POST', `/chsld/residents/${p.dupont}/communications`, { contact_id: fille.id, type: 'rappel_demande', categorie: 'administratif', sujet: 'Rappeler pour la visite de samedi' });
  await refuse('era', 'POST', `/chsld/residents/${p.dupont}/communications`, { contact_id: fils.id, type: 'message', categorie: 'administratif', sujet: 'x' }, 403, 'proche_non_autorise');
  // Révocation : la fille perd ses autorisations
  const ajout = await api('era', 'POST', `/chsld/residents/${p.dupont}/contacts`, { prenom: 'Anne', nom: 'Roy', relation: 'ami', telephone: '555-0199', autorisations: ['rendez_vous'] });
  await api('era', 'PUT', `/chsld/contacts/${ajout.id}`, { actif: false, version: ajout.version });
  await refuse('era', 'POST', `/chsld/residents/${p.dupont}/communications`, { contact_id: ajout.id, type: 'appel', categorie: 'rendez_vous', sujet: 'x' }, 404, 'contact_introuvable');
  // Doublon détecté, création distincte seulement sur confirmation
  await refuse('era', 'POST', '/chsld/residents', { etablissement_id: ids.era, prenom: 'Jean', nom: 'Dupont', date_naissance: '1938-04-02' }, 409, 'resident_doublon_possible');
  // Accueil prévu → arrivée ; changement de chambre → ancienne place en préparation ; nettoyage → place libre
  const prevu = (await api('era', 'GET', `/chsld/residents?etablissement_id=${ids.era}&statut=preadmission`))[0];
  await api('era', 'POST', `/chsld/residents/${prevu.id}/arrivee`, { version: prevu.version });
  const libre = (await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).find((x) => x.etat === 'libre');
  const fd = (await api('era', 'GET', `/chsld/residents/${p.dupont}`)).resident;
  await api('era', 'POST', `/chsld/residents/${p.dupont}/changer-chambre`, { lit_id: libre.id, version: libre.version, version_resident: fd.version });
  const nettoyage = await api('era_entretien', 'GET', `/nettoyage?etablissement_id=${ids.era}`);
  assert.ok(nettoyage.length >= 2);
  const ln = nettoyage[0]; await api('era_entretien', 'POST', `/lits/${ln.id}/action`, { action: 'nettoyage_ok', version: ln.version });
  const tachesEntretien = await api('era_entretien', 'GET', `/chsld/taches?etablissement_id=${ids.era}`);
  assert.ok(tachesEntretien.length && tachesEntretien.every((x) => ['entretien', 'preparation_chambre'].includes(x.type)), 'l’entretien ne voit que ses tâches');
  await api('era_entretien', 'POST', `/chsld/taches/${tachesEntretien[0].id}/statut`, { statut: 'faite', version: tachesEntretien[0].version });
  await refuse('era_entretien', 'GET', `/chsld/residents?etablissement_id=${ids.era}`, null, 403);
  // Demande d'hébergement : documents, vérification, place proposée (réservée), acceptée, admission
  const dem = (await api('era', 'GET', `/chsld/demandes?etablissement_id=${ids.era}`))[0];
  assert.strictEqual(dem.statut, 'documents_manquants');
  await refuse('era', 'POST', `/chsld/demandes/${dem.id}/action`, { action: 'verifier', version: dem.version }, 409, 'documents_manquants');
  let d = dem; for (const code of ['carte_assurance_maladie', 'mandat_representant', 'consentement_hebergement']) d = await api('era', 'POST', `/chsld/demandes/${d.id}/action`, { action: 'document', code, recu: true, version: d.version });
  d = await api('era', 'POST', `/chsld/demandes/${d.id}/action`, { action: 'verifier', version: d.version });
  const pl = (await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).find((x) => x.etat === 'libre');
  d = await api('era', 'POST', `/chsld/demandes/${d.id}/action`, { action: 'proposer_place', lit_id: pl.id, version_lit: pl.version, version: d.version });
  d = await api('era', 'POST', `/chsld/demandes/${d.id}/action`, { action: 'accepter', version: d.version });
  const res = (await api('era', 'GET', `/chsld/residents/${d.resident_id}`)).resident;
  await api('era', 'POST', `/chsld/residents/${res.id}/arrivee`, { version: res.version });
  assert.strictEqual((await api('era', 'GET', `/chsld/demandes?etablissement_id=${ids.era}&toutes=1`)).find((x) => x.id === d.id).statut, 'admise');
  RESULTATS.parcours.push('demande d’hébergement : documents → vérification → place proposée → acceptée → admise');
});

test('CHSLD ↔ hôpital : hospitalisation, réception, retour préparé par l’hôpital, accueil confirmé, historique complet', async () => {
  const coB = await api('b', 'GET', `/coordinations?etablissement_id=${(await poolPilote.query("SELECT id FROM etablissements WHERE code='HY'")).rows[0].id}`);
  const hosp = coB.find((c) => c.id === p.hospitalisation);
  assert.ok(hosp && hosp.statut === 'recue');
  assert.ok(!JSON.stringify(coB).includes('Martin'), 'l’hôpital ne voit que la référence du résident');
  // Le CHSLD voit l'hôpital confirmé ; la place reste conservée
  const f = await api('stl', 'GET', `/chsld/residents/${p.martin}`);
  assert.ok(f.localisation && f.localisation.confirmee && /Mont-Clair/.test(f.localisation.hopital));
  assert.strictEqual(f.lit.etat, 'occupe');
  // Retour : accepté par le CHSLD (tâche de préparation), départ confirmé par l'hôpital, arrivée confirmée par le CHSLD
  let co = (await api('stl', 'GET', `/coordinations?etablissement_id=${ids.stl}`)).find((c) => c.id === p.retour);
  await refuse('b', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: hosp.destination_id, action: 'accepter', version: co.version }, 409, 'action_coordination_interdite');
  co = await api('stl', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.stl, action: 'accepter', version: co.version });
  assert.ok((await api('stl', 'GET', `/chsld/taches?etablissement_id=${ids.stl}`)).some((x) => x.type === 'preparation_chambre' && /retour/.test(x.titre)));
  co = await api('b', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: hosp.destination_id, action: 'confirmer_depart', version: co.version });
  co = await api('stl', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.stl, action: 'confirmer_arrivee', version: co.version });
  co = await reintegrerRetour('stl', ids.stl, co.id);
  const apres = await api('stl', 'GET', `/chsld/residents/${p.martin}`);
  assert.strictEqual(apres.resident.statut, 'present');
  const types = apres.mouvements.map((m) => m.type).reverse();
  for (const x of ['admission', 'depart_hopital', 'hospitalisation_confirmee', 'retour_prevu', 'retour']) assert.ok(types.includes(x), `historique : ${x} (${types})`);
  RESULTATS.parcours.push(`CHSLD ↔ Hôpital B : ${types.filter((x) => x !== 'modification').join(' → ')}`);
});

test('inter-CHSLD : demande, acceptation avec place réservée, départ, arrivée ; jamais de double attribution', async () => {
  let co = (await api('era', 'GET', `/coordinations?etablissement_id=${ids.era}`)).find((c) => c.id === p.transfert);
  assert.strictEqual(co.statut, 'envoyee'); assert.ok(!JSON.stringify(co).match(/-Stl1/), 'le CHSLD d’accueil ne voit que la référence avant l’arrivée');
  const libres = (await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).filter((x) => x.etat === 'libre');
  // Concurrence : la même place proposée à deux opérations simultanées n'est attribuée qu'une fois
  const autre = (await api('era', 'GET', `/chsld/residents?etablissement_id=${ids.era}`)).find((r) => r.statut === 'present');
  const [a1, a2] = await Promise.all([
    appel('era', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.era, action: 'accepter', lit_id: libres[0].id, version_lit: libres[0].version, version: co.version }),
    appel('era', 'POST', `/chsld/residents/${autre.id}/changer-chambre`, { lit_id: libres[0].id, version: libres[0].version, version_resident: autre.version })]);
  assert.strictEqual([a1, a2].filter((x) => x.statut === 200).length, 1, `une seule attribution : ${a1.statut} ${a2.statut}`);
  co = (await api('era', 'GET', `/coordinations?etablissement_id=${ids.era}`)).find((c) => c.id === p.transfert);
  if (co.statut === 'envoyee') { const l2 = (await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).find((x) => x.etat === 'libre'); co = await api('era', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.era, action: 'accepter', lit_id: l2.id, version_lit: l2.version, version: co.version }); }
  co = await api('stl', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.stl, action: 'confirmer_depart', version: co.version });
  co = await api('era', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.era, action: 'confirmer_arrivee', version: co.version });
  assert.strictEqual(co.statut, 'recue');
  const arrive = (await api('era', 'GET', `/chsld/residents?etablissement_id=${ids.era}`)).find((r) => r.nom.endsWith('-Stl1'));
  assert.ok(arrive && arrive.statut === 'present' && arrive.contacts >= 1, 'dossier et contacts suivent le résident');
  const parti = (await poolPilote.query(`SELECT statut FROM residents WHERE etablissement_id = $1 AND nom LIKE '%-Stl1'`, [ids.stl])).rows[0];
  assert.strictEqual(parti.statut, 'transfere');
  const doubles = (await poolPilote.query(`SELECT lit_id, count(*) n FROM residents WHERE lit_id IS NOT NULL AND statut NOT IN ('sorti','transfere') GROUP BY lit_id HAVING count(*) > 1`)).rows;
  assert.deepStrictEqual(doubles, [], 'aucune place attribuée à deux résidents');
  RESULTATS.parcours.push('inter-CHSLD Saint-Laurent → Érables : envoyée → acceptée (place réservée) → départ → arrivée ; double attribution refusée');
});

test('sécurité : isolation entre établissements, permissions par rôle, identité jamais transmise hors de l’établissement', async () => {
  await refuse('stl', 'GET', `/chsld/residents/${p.dupont}`, null, 403);
  await refuse('stl', 'GET', `/chsld/residents?etablissement_id=${ids.era}`, null, 403);
  await refuse('b', 'GET', `/chsld/residents?etablissement_id=${ids.era}`, null, 403);
  await refuse('era_soins', 'POST', '/chsld/residents', { etablissement_id: ids.era, prenom: 'X', nom: 'Y', date_naissance: '1940-01-01' }, 403, 'role_insuffisant');
  await refuse('era_soins', 'POST', `/chsld/demandes`, { etablissement_id: ids.era, provenance: 'domicile', prenom: 'X', nom: 'Y', date_naissance: '1940-01-01' }, 403);
  await api('era_soins', 'GET', `/chsld/residents/${p.dupont}`);
  await refuse('a', 'GET', `/chsld/accueil?etablissement_id=${(await poolPilote.query("SELECT id FROM etablissements WHERE code='HX'")).rows[0].id}`, null, 409, 'etab_non_chsld');
  const fuites = (await poolPilote.query(`SELECT action, detail FROM journal WHERE etablissement_id = ANY($1) AND detail ~ '(Dupont|Martin|Bérubé)'`, [[ids.era, ids.stl]])).rows;
  assert.deepStrictEqual(fuites, [], 'aucun nom de résident dans le journal');
});

test('OG CHSLD : mêmes droits, données réelles, propositions à confirmer, refus des décisions humaines, FR et EN', async () => {
  const q = async (qui, e, question, langue = 'fr') => api(qui, 'POST', '/copilote/question', { etablissement_id: e, question, langue });
  let r = await q('era', ids.era, 'Combien de chambres sont disponibles aujourd’hui ?');
  const libres = (await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).filter((x) => x.etat === 'libre').length;
  assert.match(r.reponse, new RegExp(`^${libres} place`)); assert.strictEqual(r.langue, 'fr');
  r = await q('era', ids.era, 'How many beds are available?', 'fr'); assert.strictEqual(r.langue, 'en'); assert.match(r.reponse, /available place/);
  r = await q('stl', ids.stl, 'Quels résidents sont actuellement hospitalisés ?'); assert.match(r.reponse, /Aucun résident n’est hospitalisé/);
  r = await q('era', ids.era, 'Retrouve le résident Jean Dupont'); assert.match(r.reponse, /Jean Dupont \(R-\d{5}\)/);
  r = await q('era', ids.era, 'Qui sont ses deux contacts principaux ?'); assert.match(r.reponse, /Marie Dupont \(fille\), principal/);
  r = await q('era', ids.era, 'Qui est autorisé à recevoir des informations sur son dossier ?'); assert.match(r.reponse, /Marie Dupont/); assert.doesNotMatch(r.reponse, /Luc Dupont/);
  r = await q('era', ids.era, 'Prépare un message à sa fille pour demander un rappel'); assert.strictEqual(r.proposition_chsld.type, 'communication');
  r = await q('era', ids.era, 'Prépare un message à son fils pour demander un rappel'); assert.match(r.reponse, /n’est autorisé/); assert.ok(!r.proposition_chsld);
  r = await q('era', ids.era, 'Prépare une tâche d’entretien pour la chambre 101'); assert.strictEqual(r.proposition_chsld.type, 'tache');
  r = await q('era', ids.era, 'Montre-moi les chambres en nettoyage'); assert.match(r.reponse, /chambre|Aucune chambre/);
  r = await q('era', ids.era, 'Quelles demandes d’hébergement attendent une confirmation ?'); assert.ok(r.reponse);
  r = await q('era', ids.era, 'Ody, aide-moi à enregistrer un nouveau résident.'); assert.strictEqual(r.formulaire, 'nouveau_resident');
  r = await q('era', ids.era, 'Décide qui doit avoir la prochaine place selon la priorité clinique'); assert.match(r.reponse, /ne décide pas/);
  r = await q('stl', ids.stl, 'Retrouve le résident Jean Dupont'); assert.doesNotMatch(r.reponse, /Jean Dupont/, 'OG du Saint-Laurent ne voit pas les résidents des Érables');
  RESULTATS.og = 'places, hospitalisés, recherche, contacts, autorisations, proposition de rappel (refusée au fils), tâche, demandes, formulaire, refus de décision clinique, isolation, FR/EN';
});

test('non-régression hospitalière : les CHSLD n’entrent jamais dans les capacités ni les recherches des hôpitaux', async () => {
  const hy = (await poolPilote.query("SELECT id FROM etablissements WHERE code='HY'")).rows[0].id;
  const reseau = await api('b', 'GET', `/reseau?depuis=${hy}`);
  assert.ok(!JSON.stringify(reseau).includes('CHSLD'), 'réseau hospitalier sans CHSLD');
  const types = (await poolPilote.query("SELECT id FROM types_unite WHERE code='MED' AND config_id=(SELECT id FROM config_pays WHERE code='QC')")).rows[0].id;
  const rec = await api('b', 'GET', `/recherche?depuis=${hy}&type_id=${types}`);
  assert.ok(!rec.suggestions.some((s) => /CHSLD/.test(s.nom)));
  for (const route of ['/lits', '/admissions', '/civieres', '/transferts', '/nettoyage', '/copilote/briefing']) await api('b', 'GET', `${route}?etablissement_id=${hy}`);
});

/* ------------------------------------------------------------------ Module hospitalier Liaison CHSLD (1er nov. 2026) */
const etabCode = async (code) => (await poolPilote.query('SELECT id FROM etablissements WHERE code = $1', [code])).rows[0].id;
const notifs = async (qui, etab) => api(qui, 'GET', `/notifications?etablissement_id=${etab}`);
const ogQ = async (qui, etab, question) => api(qui, 'POST', '/copilote/question', { etablissement_id: etab, question, langue: 'fr' });
/** Résident présent sans demande ouverte vers un hôpital (une demande transmise ne change pas son statut). */
async function residentPresent(qui, etab, exclure = []) {
  const ouverts = (await poolPilote.query(`SELECT resident_id FROM coordinations WHERE statut IN ('preparee', 'envoyee', 'acceptee', 'en_cours')`)).rows.map((x) => x.resident_id);
  return (await api(qui, 'GET', `/chsld/residents?etablissement_id=${etab}`)).find((r) => r.statut === 'present' && !exclure.includes(r.id) && !ouverts.includes(r.id));
}
let L = {};
/** Fin d'un retour côté CHSLD : préparation terminée par l'entretien, chambre vérifiée, réintégration par le personnel autorisé. */
async function reintegrerRetour(qui, etab, retId) {
  let co = (await api(qui, 'GET', `/coordinations?etablissement_id=${etab}`)).find((c) => c.id === retId);
  const litCode = co.reintegration?.lit?.code;
  for (const x of (await api(`${qui}_entretien`, 'GET', `/chsld/taches?etablissement_id=${etab}`)).filter((y) => y.lit === litCode)) await api(`${qui}_entretien`, 'POST', `/chsld/taches/${x.id}/statut`, { statut: 'faite', version: x.version });
  if (!co.chambre_verifiee_le) co = await api(qui, 'POST', `/coordinations/${retId}/action`, { etablissement_id: etab, action: 'verifier_chambre', version: co.version });
  return api(qui, 'POST', `/coordinations/${retId}/action`, { etablissement_id: etab, action: 'reintegrer', identite_verifiee: true, conditions_accueil: true, version: co.version });
}
test('Liaison CHSLD : un seul module, au catalogue SH, actif par défaut pour A, B et C, visible dans la navigation', async () => {
  const hop = await sh('GET', '/catalogue-modules?type=hopital');
  const m = hop.modules.find((x) => x.code === 'liaison_chsld');
  assert.ok(m && m.categorie === 'hopital' && m.statut === 'disponible', JSON.stringify(m));
  assert.deepStrictEqual([...m.dependances].sort(), ['admissions_hopital', 'transferts']);
  assert.ok(!(await sh('GET', '/catalogue-modules?type=chsld')).modules.some((x) => x.code === 'liaison_chsld'), 'jamais proposé à un CHSLD');
  sessions.c = (await api(null, 'POST', '/connexion', { email: 'hopital.c@demo.arrimo', mot_de_passe: MDP })).token;
  L = { A: await etabCode('HX'), B: await etabCode('HY'), C: await etabCode('HC') };
  for (const [qui, code] of [['a', 'HX'], ['b', 'HY'], ['c', 'HC']]) {
    const e = (await api(qui, 'GET', '/moi')).etablissements.find((x) => x.code === code);
    assert.notStrictEqual((e.modules || {}).liaison_chsld, false, `${code} : module actif sans aucune modification des données`);
    const v = await api(qui, 'GET', `/liaison-chsld?etablissement_id=${e.id}`);
    assert.deepStrictEqual(Object.keys(v).sort(), ['a_accueillir', 'arrivees', 'compteurs', 'historique', 'hospitalisations', 'retours_en_cours', 'transferts']);
  }
  // Les CHSLD n'ont pas ce module ; l'interface porte un seul onglet commun
  await refuse('era', 'GET', `/liaison-chsld?etablissement_id=${ids.era}`, null, 409, 'etab_non_hopital');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.strictEqual((html.match(/data-module="liaison_chsld"/g) || []).length, 1);
  RESULTATS.liaison = { catalogue: m, parcours: [] };
});

test('Liaison CHSLD : défaut reproduit puis parcours complet Érables → Hôpital B (demande, réception, arrivée, admission, retour, OG)', async () => {
  // Défaut d'origine : la liste des hôpitaux du CHSLD dépendait du module « réseau inter-CHSLD » ; désactivé, aucune demande ne pouvait partir.
  const modulesEra = (await poolPilote.query('SELECT modules FROM etablissements WHERE id = $1', [ids.era])).rows[0].modules;
  await poolPilote.query(`UPDATE etablissements SET modules = modules || '{"reseau_chsld": false}'::jsonb WHERE id = $1`, [ids.era]);
  await refuse('era', 'GET', `/chsld/reseau?etablissement_id=${ids.era}`, null, 403, 'module_desactive');
  const hopitaux = await api('era', 'GET', `/chsld/hopitaux?etablissement_id=${ids.era}`);
  assert.ok([L.A, L.B, L.C].every((id) => hopitaux.some((h) => h.id === id)), 'A, B et C proposés sans dépendre du réseau inter-CHSLD');
  assert.ok(!hopitaux.some((h) => /CHSLD/.test(h.nom)));
  await poolPilote.query('UPDATE etablissements SET modules = $2 WHERE id = $1', [ids.era, modulesEra]);

  const dupont = (await api('era', 'GET', `/chsld/residents/${p.dupont}`)).resident;
  assert.strictEqual(dupont.statut, 'present');
  const transfertsAvant = await api('b', 'GET', `/transferts?etablissement_id=${L.B}`);
  // 1-3. Demande créée et transmise (identité vérifiée) ; renvoi après coupure réseau : même demande, aucun doublon
  const corps = { hopital_id: L.B, identite_verifiee: true, motif_admin: 'Évaluation à l’hôpital', version: dupont.version, cle: 'era-dupont-0001' };
  let co = await api('era', 'POST', `/chsld/residents/${p.dupont}/hospitalisation`, corps);
  const rejoue = await api('era', 'POST', `/chsld/residents/${p.dupont}/hospitalisation`, corps);
  assert.strictEqual(rejoue.id, co.id); assert.strictEqual(rejoue.rejoue, true);
  assert.strictEqual((await poolPilote.query("SELECT count(*)::int n FROM coordinations WHERE resident_id = $1 AND type = 'hospitalisation' AND statut = 'envoyee'", [p.dupont])).rows[0].n, 1);
  await refuse('era', 'POST', `/chsld/residents/${p.dupont}/hospitalisation`, { ...corps, cle: 'era-dupont-0002', version: (await api('era', 'GET', `/chsld/residents/${p.dupont}`)).resident.version }, 409, 'hospitalisation_deja_ouverte');
  // 4. Visible dans « Hôpital B → Liaison CHSLD → Arrivées », notification à l'hôpital, jamais chez A ni dans les transferts
  let vb = await api('b', 'GET', `/liaison-chsld?etablissement_id=${L.B}`);
  let fiche = vb.arrivees.find((x) => x.id === co.id);
  assert.ok(fiche, 'demande visible à l’Hôpital B');
  assert.strictEqual(fiche.etape, 'transmise'); assert.strictEqual(fiche.origine, 'CHSLD 1 — des Érables'); assert.match(fiche.resident_ref, /^R-\d{5}$/);
  assert.ok(!JSON.stringify(vb).includes('Dupont'), 'l’hôpital ne voit que la référence');
  assert.ok((await notifs('b', L.B)).some((n) => n.code === 'chsld_demande' && n.vars.numero === co.numero), 'notification Liaison CHSLD');
  assert.ok(!(await api('a', 'GET', `/liaison-chsld?etablissement_id=${L.A}`)).arrivees.some((x) => x.id === co.id), 'Hôpital A ne voit pas la demande');
  assert.deepStrictEqual((await api('b', 'GET', `/transferts?etablissement_id=${L.B}`)).map((x) => x.id), transfertsAvant.map((x) => x.id), 'transferts interhospitaliers non pollués');
  // Avant le départ confirmé, aucune arrivée ne peut être confirmée (pas de localisation sans preuve)
  await refuse('b', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.B, action: 'confirmer_reception', version: fiche.version }, 409, 'coordination_statut_incompatible');
  // 5. Réception, puis acceptation par l'hôpital
  co = await api('b', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.B, action: 'accuser_reception', version: fiche.version });
  assert.ok(co.recue_hopital_le);
  co = await api('b', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.B, action: 'accepter', version: co.version });
  assert.strictEqual(co.statut, 'acceptee');
  assert.ok((await notifs('era', ids.era)).some((n) => n.code === 'chsld_acceptee'));
  let r = await ogQ('era', ids.era, 'Où en est la demande de transfert de Jean Dupont vers l’Hôpital B ?');
  assert.match(r.reponse, new RegExp(`${co.numero}.*Mont-Clair.*acceptée par l’hôpital.*Dernière confirmation enregistrée le`, 's'));
  // Départ confirmé par le CHSLD : résident hospitalisé, place conservée
  co = await api('era', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.era, action: 'confirmer_depart', version: co.version });
  assert.strictEqual((await api('era', 'GET', `/chsld/residents/${p.dupont}`)).resident.statut, 'hospitalise');
  r = await ogQ('b', L.B, 'Quels résidents de CHSLD sont attendus aujourd’hui ?');
  assert.match(r.reponse, new RegExp(`${fiche.resident_ref}.*des Érables.*départ confirmé.*dernière confirmation`, 's'));
  r = await ogQ('b', L.B, 'Quels résidents sont arrivés et attendent un accueil ?');
  assert.match(r.reponse, /arrivée à confirmer/);
  r = await ogQ('b', L.B, 'OG, montre-moi les demandes provenant du CHSLD des Érables');
  assert.match(r.reponse, new RegExp(fiche.resident_ref));
  r = await ogQ('b', L.B, 'OG, où en est le transfert de Jean Dupont ?');
  assert.match(r.reponse, /seulement|que les références/); assert.doesNotMatch(r.reponse, /Mont-Clair.*Dupont/);
  // Arrivée physique confirmée par l'hôpital
  vb = await api('b', 'GET', `/liaison-chsld?etablissement_id=${L.B}`);
  fiche = vb.a_accueillir.find((x) => x.id === co.id); assert.strictEqual(fiche.etape, 'depart_confirme');
  assert.ok(fiche.actions.includes('confirmer_reception'));
  co = await api('b', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.B, action: 'confirmer_reception', version: fiche.version });
  assert.ok(co.arrivee_le && co.statut === 'recue');
  r = await ogQ('b', L.B, 'Quels résidents sont arrivés et attendent un accueil ?');
  assert.match(r.reponse, /Arrivés, accueil à préparer/);
  // 6. Préparer l'admission : contrôle de la référence de l'hôpital, demande d'admission ordinaire, aucune priorité clinique
  const cfgB = (await poolPilote.query('SELECT c.reference_exemple, (SELECT id FROM types_unite t WHERE t.config_id = c.id ORDER BY ordre LIMIT 1) AS type_id FROM etablissements e JOIN config_pays c ON c.id = e.config_id WHERE e.id = $1', [L.B])).rows[0];
  await refuse('b', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.B, action: 'orienter', orientation: 'admission', patient_ref: fiche.resident_ref, type_id: cfgB.type_id, version: co.version }, 400, 'reference_invalide');
  await refuse('b', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.B, action: 'orienter', orientation: 'automatique', patient_ref: 'P-71001', version: co.version }, 400, 'orientation_invalide');
  co = await api('b', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.B, action: 'orienter', orientation: 'admission', patient_ref: 'P-71001', type_id: cfgB.type_id, version: co.version });
  assert.strictEqual(co.orientation, 'admission'); assert.ok(co.demande_admission_id);
  const dem = (await poolPilote.query('SELECT patient_ref, provenance, priorite_code, statut FROM demandes_admission WHERE id = $1', [co.demande_admission_id])).rows[0];
  assert.deepStrictEqual(dem, { patient_ref: 'P-71001', provenance: 'externe', priorite_code: null, statut: 'attente' }, 'admission ordinaire, sans priorité clinique attribuée');
  assert.strictEqual((await poolPilote.query("SELECT count(*)::int n FROM residents WHERE nom = 'Dupont' AND prenom = 'Jean'")).rows[0].n, 1, 'identité non dupliquée');
  // 7. Suivi dans les deux établissements
  vb = await api('b', 'GET', `/liaison-chsld?etablissement_id=${L.B}`);
  fiche = vb.hospitalisations.find((x) => x.id === co.id); assert.strictEqual(fiche.etape, 'admission'); assert.strictEqual(fiche.patient_ref_hopital, 'P-71001');
  const coEra = (await api('era', 'GET', `/coordinations?etablissement_id=${ids.era}`)).find((x) => x.id === co.id);
  assert.strictEqual(coEra.orientation, 'admission'); assert.strictEqual(coEra.patient_ref_hopital, null, 'la référence hospitalière reste à l’hôpital');
  // 8. Retour : OG prépare (carte à confirmer), l'hôpital confirme, le CHSLD accepte, départ, réception
  r = await ogQ('b', L.B, `Prépare le retour de ${fiche.resident_ref} vers son CHSLD`);
  assert.strictEqual(r.proposition_chsld.type, 'retour'); assert.strictEqual(r.proposition_chsld.coordination_id, co.id);
  assert.strictEqual((await poolPilote.query("SELECT count(*)::int n FROM coordinations WHERE liee_id = $1", [co.id])).rows[0].n, 0, 'OG n’écrit rien avant confirmation');
  const demain = new Date(Date.now() + 86400000).toISOString();
  let ret = await api('b', 'POST', `/coordinations/${co.id}/retour`, { retour_prevu_le: demain, motif_admin: 'Retour au milieu de vie' });
  await refuse('b', 'POST', `/coordinations/${co.id}/retour`, { retour_prevu_le: demain }, 409, 'retour_deja_ouvert');
  assert.ok((await notifs('era', ids.era)).some((n) => n.code === 'chsld_retour_propose'));
  r = await ogQ('b', L.B, 'Quels retours vers les CHSLD sont en préparation ?');
  assert.match(r.reponse, new RegExp(`${fiche.resident_ref} → CHSLD 1 — des Érables · retour proposé`));
  ret = await api('era', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: 'accepter', version: ret.version });
  ret = await api('b', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: L.B, action: 'confirmer_depart', version: ret.version });
  ret = await api('era', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: 'confirmer_arrivee', version: ret.version });
  ret = await reintegrerRetour('era', ids.era, ret.id);
  assert.strictEqual((await api('era', 'GET', `/chsld/residents/${p.dupont}`)).resident.statut, 'present');
  vb = await api('b', 'GET', `/liaison-chsld?etablissement_id=${L.B}`);
  fiche = vb.historique.find((x) => x.id === co.id);
  assert.ok(fiche && fiche.etape === 'cloturee' && fiche.retour.etape === 'retour_reintegre', 'parcours clôturé dans l’historique');
  assert.deepStrictEqual(fiche.etapes.map((e) => e.statut), ['envoyee', 'recue_hopital', 'acceptee', 'en_cours', 'arrivee', 'orientation:admission', 'cloturee']);
  assert.ok((await notifs('b', L.B)).some((n) => n.code === 'chsld_retour_recu'));
  r = await ogQ('era', ids.era, 'Où en est la demande de transfert de Jean Dupont ?');
  assert.match(r.reponse, /parcours clos, retour reçu/);
  // 10. Aucun transfert interhospitalier créé par ce parcours
  assert.deepStrictEqual((await api('b', 'GET', `/transferts?etablissement_id=${L.B}`)).map((x) => x.id), transfertsAvant.map((x) => x.id));
  const fuites = (await poolPilote.query(`SELECT detail FROM journal WHERE etablissement_id = $1 AND detail ~ 'Dupont'`, [L.B])).rows;
  assert.deepStrictEqual(fuites, [], 'aucun nom dans le journal de l’hôpital');
  RESULTATS.liaison.parcours.push(`Érables → B : ${fiche.etapes.map((e) => e.statut).join(' → ')}`);
});

test('Liaison CHSLD : Érables → A et Saint-Laurent → C, accueil à l’urgence, refus, annulation, envois simultanés, mauvais hôpital, permissions', async () => {
  // Érables → Hôpital A : orientation vers l'urgence décidée par le personnel, puis retour
  const r1 = await residentPresent('era', ids.era, [p.dupont]);
  let co = await api('era', 'POST', `/chsld/residents/${r1.id}/hospitalisation`, { hopital_id: L.A, identite_verifiee: true, version: r1.version });
  co = await api('era', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.era, action: 'confirmer_depart', version: co.version }); // acceptation facultative
  co = await api('a', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.A, action: 'confirmer_reception', version: co.version });
  await refuse('a', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.A, action: 'orienter', orientation: 'urgence', patient_ref: 'P-72001', version: co.version }, 400, 'civiere_requise');
  const emA = await api('a', 'GET', `/liaison-chsld/${co.id}/emplacements?etablissement_id=${L.A}`);
  const civA = emA.civieres[0];
  if (civA) { co = await api('a', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.A, action: 'orienter', orientation: 'urgence', patient_ref: 'P-72001', civiere_id: civA.id, version_civiere: civA.version, version: co.version }); assert.strictEqual(co.orientation, 'urgence'); assert.strictEqual(co.demande_admission_id, null); }
  else { assert.deepStrictEqual(emA.civieres, [], 'aucune civière libre à l’Hôpital A : aucune n’est proposée'); co = await api('a', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.A, action: 'orienter', orientation: 'admission', patient_ref: 'P-72001', type_id: emA.type_id, version: co.version }); assert.strictEqual(co.orientation, 'admission'); }
  await refuse('a', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.A, action: 'orienter', orientation: 'urgence', patient_ref: 'P-72001', civiere_id: civA?.id || 1, version: co.version }, 409, 'orientation_deja_faite');
  let ret = await api('a', 'POST', `/coordinations/${co.id}/retour`, { retour_prevu_le: new Date(Date.now() + 3600000).toISOString() });
  ret = await api('era', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: 'accepter', version: ret.version });
  ret = await api('a', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: L.A, action: 'confirmer_depart', version: ret.version });
  await api('era', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: 'confirmer_arrivee', version: ret.version });
  await reintegrerRetour('era', ids.era, ret.id);
  assert.ok((await api('a', 'GET', `/liaison-chsld?etablissement_id=${L.A}`)).historique.some((x) => x.id === co.id && x.etape === 'cloturee'));
  RESULTATS.liaison.parcours.push('Érables → A : transmise → départ → arrivée → urgence → retour → clôturée');
  // Saint-Laurent → Hôpital C : refus par l'hôpital ; le résident reste présent, sa place jamais libérée
  const r2 = await residentPresent('stl', ids.stl);
  co = await api('stl', 'POST', `/chsld/residents/${r2.id}/hospitalisation`, { hopital_id: L.C, identite_verifiee: true, version: r2.version });
  assert.ok((await api('c', 'GET', `/liaison-chsld?etablissement_id=${L.C}`)).arrivees.some((x) => x.id === co.id && x.origine === 'CHSLD 2 — du Saint-Laurent'));
  await refuse('stl', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.C, action: 'refuser', version: co.version }, 403);
  co = await api('c', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.C, action: 'refuser', motif: 'Plateau non disponible', version: co.version });
  assert.strictEqual(co.statut, 'refusee');
  assert.strictEqual((await api('stl', 'GET', `/chsld/residents/${r2.id}`)).resident.statut, 'present');
  assert.ok((await notifs('stl', ids.stl)).some((n) => n.code === 'chsld_refusee'));
  assert.ok((await api('c', 'GET', `/liaison-chsld?etablissement_id=${L.C}`)).historique.some((x) => x.id === co.id && x.etape === 'refusee'));
  // Saint-Laurent → C, nouvelle demande, puis réception jusqu'à l'admission et retour
  const r2b = (await api('stl', 'GET', `/chsld/residents/${r2.id}`)).resident;
  co = await api('stl', 'POST', `/chsld/residents/${r2.id}/hospitalisation`, { hopital_id: L.C, identite_verifiee: true, version: r2b.version });
  co = await api('c', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.C, action: 'accepter', version: co.version });
  co = await api('stl', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.stl, action: 'confirmer_depart', version: co.version });
  co = await api('c', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.C, action: 'confirmer_reception', version: co.version });
  const typeC = (await poolPilote.query('SELECT t.id FROM types_unite t JOIN etablissements e ON e.config_id = t.config_id WHERE e.id = $1 ORDER BY t.ordre LIMIT 1', [L.C])).rows[0].id;
  co = await api('c', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.C, action: 'orienter', orientation: 'admission', patient_ref: 'P-73001', type_id: typeC, version: co.version });
  ret = await api('c', 'POST', `/coordinations/${co.id}/retour`, { retour_prevu_le: new Date(Date.now() + 7200000).toISOString() });
  ret = await api('stl', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.stl, action: 'accepter', version: ret.version });
  ret = await api('c', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: L.C, action: 'confirmer_depart', version: ret.version });
  await api('stl', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.stl, action: 'confirmer_arrivee', version: ret.version });
  await reintegrerRetour('stl', ids.stl, ret.id);
  assert.strictEqual((await api('stl', 'GET', `/chsld/residents/${r2.id}`)).resident.statut, 'present');
  RESULTATS.liaison.parcours.push('Saint-Laurent → C : refusée ; puis transmise → acceptée → départ → arrivée → admission → retour → clôturée');
  // Annulation par le CHSLD avant le départ ; notification à l'hôpital
  const r3 = await residentPresent('era', ids.era, [p.dupont, r1.id]);
  co = await api('era', 'POST', `/chsld/residents/${r3.id}/hospitalisation`, { hopital_id: L.B, identite_verifiee: true, version: r3.version });
  co = await api('era', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.era, action: 'annuler', version: co.version });
  assert.ok((await notifs('b', L.B)).some((n) => n.code === 'chsld_annulee' && n.vars.numero === co.numero));
  // Deux envois simultanés pour le même résident : une seule demande
  const r4 = await residentPresent('era', ids.era, [p.dupont, r1.id, r3.id]);
  const envois = await Promise.all(['simul-0001', 'simul-0002'].map((cle) => appel('era', 'POST', `/chsld/residents/${r4.id}/hospitalisation`, { hopital_id: L.B, identite_verifiee: true, cle })));
  assert.deepStrictEqual(envois.map((x) => x.statut).sort(), [200, 409], JSON.stringify(envois.map((x) => x.corps)));
  assert.strictEqual(envois.find((x) => x.statut === 409).corps.code, 'hospitalisation_deja_ouverte');
  const ouverte = envois.find((x) => x.statut === 200).corps;
  // Même identifiant d'envoi pour un autre résident : refus
  await refuse('era', 'POST', `/chsld/residents/${r3.id}/hospitalisation`, { hopital_id: L.B, identite_verifiee: true, cle: ouverte.cle_idempotence }, 409, 'cle_idempotence_conflit');
  // Mauvais hôpital : un CHSLD n'est pas un hôpital ; un autre hôpital n'agit jamais sur la demande de B
  await refuse('era', 'POST', `/chsld/residents/${r3.id}/hospitalisation`, { hopital_id: ids.stl, identite_verifiee: true }, 404, 'hopital_introuvable');
  await refuse('a', 'POST', `/coordinations/${ouverte.id}/action`, { etablissement_id: L.A, action: 'accepter', version: ouverte.version }, 403, 'etab_interdit');
  const moiB = (await api('b', 'GET', '/moi')).etablissements.map((e) => e.id);
  if (!moiB.includes(L.A)) await refuse('b', 'GET', `/liaison-chsld?etablissement_id=${L.A}`, null, 403);
  await refuse('era', 'GET', `/liaison-chsld?etablissement_id=${L.B}`, null, 403);
  // Permissions : l'entretien ne transmet rien ; identité à vérifier
  await refuse('era_entretien', 'POST', `/chsld/residents/${r3.id}/hospitalisation`, { hopital_id: L.B, identite_verifiee: true }, 403);
  await refuse('era', 'POST', `/chsld/residents/${r3.id}/hospitalisation`, { hopital_id: L.B }, 400, 'identite_a_verifier');
  await api('era', 'POST', `/coordinations/${ouverte.id}/action`, { etablissement_id: ids.era, action: 'annuler', version: ouverte.version });
  const doubles = (await poolPilote.query(`SELECT resident_id FROM coordinations WHERE type = 'hospitalisation' AND statut IN ('preparee','envoyee','acceptee','en_cours') GROUP BY resident_id HAVING count(*) > 1`)).rows;
  assert.deepStrictEqual(doubles, [], 'aucune double demande ouverte');
  RESULTATS.liaison.securite = 'refus, annulation, envois simultanés (1 seul), renvoi idempotent, mauvais hôpital, isolation A/B, rôles';
});

test('Liaison CHSLD : désactivation et réactivation depuis SH sans perte ; futur hôpital créé dans SH avec le module', { timeout: 120000 }, async () => {
  // Désactivation pour l'Hôpital C par l'API de configuration utilisée par SH : accès masqué, demandes refusées, historique conservé
  const shEnv = async (methode, chemin, corps) => {
    const r = await fetch(`${basePilote}/api/sh${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', 'X-SH-Key': process.env.SH_API_KEY }, body: corps ? JSON.stringify(corps) : undefined });
    const j = await r.json(); assert.strictEqual(r.status, 200, `${chemin} ${JSON.stringify(j)}`); return j;
  };
  const avant = (await poolPilote.query('SELECT count(*)::int n FROM coordinations WHERE destination_id = $1 OR origine_id = $1', [L.C])).rows[0].n;
  let cfg = await shEnv('GET', '/etablissements/HC/configuration-operationnelle');
  assert.ok(cfg.modules_modifiables.includes('liaison_chsld'));
  const modulesAvant = { urgence: cfg.modules.urgence !== false, nsa: cfg.modules.nsa !== false, nettoyage: cfg.modules.nettoyage !== false, national: cfg.modules.national !== false };
  cfg = await shEnv('PUT', '/etablissements/HC/configuration-operationnelle', { modules: { ...modulesAvant, liaison_chsld: false }, vocation: cfg.vocation || 'general', version: cfg.version });
  assert.strictEqual(cfg.modules.liaison_chsld, false);
  await refuse('c', 'GET', `/liaison-chsld?etablissement_id=${L.C}`, null, 403, 'module_desactive');
  assert.strictEqual((await api('c', 'GET', '/moi')).etablissements.find((e) => e.id === L.C).modules.liaison_chsld, false, 'onglet masqué');
  assert.ok(!(await api('stl', 'GET', `/chsld/hopitaux?etablissement_id=${ids.stl}`)).some((h) => h.id === L.C));
  const r = await residentPresent('stl', ids.stl);
  await refuse('stl', 'POST', `/chsld/residents/${r.id}/hospitalisation`, { hopital_id: L.C, identite_verifiee: true, version: r.version }, 409, 'liaison_chsld_inactive');
  const og = await ogQ('c', L.C, 'Quels résidents de CHSLD sont attendus aujourd’hui ?');
  assert.match(og.reponse, /n’est pas activée/);
  assert.strictEqual((await poolPilote.query('SELECT count(*)::int n FROM coordinations WHERE destination_id = $1 OR origine_id = $1', [L.C])).rows[0].n, avant, 'aucune donnée détruite');
  // Une console plus ancienne qui ne connaît pas le drapeau ne le modifie pas
  const cur = await shEnv('GET', '/etablissements/HC/configuration-operationnelle');
  const inchange = await shEnv('PUT', '/etablissements/HC/configuration-operationnelle', { modules: modulesAvant, vocation: cur.vocation || 'general', version: cur.version });
  assert.strictEqual(inchange.modules.liaison_chsld, false);
  // Réactivation : l'historique réapparaît
  cfg = await shEnv('PUT', '/etablissements/HC/configuration-operationnelle', { modules: { ...modulesAvant, liaison_chsld: true }, vocation: inchange.vocation || 'general', version: inchange.version });
  assert.ok(!('liaison_chsld' in cfg.modules), 'activé = valeur par défaut');
  const vc = await api('c', 'GET', `/liaison-chsld?etablissement_id=${L.C}`);
  assert.ok(vc.historique.length >= 2, 'historique conservé après réactivation');
  // Futur hôpital fictif créé dans SH (environnement de validation), avec le module, sans configuration manuelle
  const d = await sh('POST', '/hopitaux', { type_etablissement: 'hopital', modules: { liaison_chsld: true }, nom: 'Hôpital D — Essai de validation', code_etab: 'HD-ESSAI', environnement: 'pilote', pays_code: 'CA',
    ville: 'Ville fictive', latitude: 46.1, longitude: -71.2, utilisateurs_prevus: 2, utilisateurs_autorises: 4, contact_nom: 'Direction fictive' });
  await sh('POST', `/hopitaux/${d.id}/relier`, {});
  const fiche = await sh('GET', `/hopitaux/${d.id}`);
  assert.ok(fiche.modules.some((m) => m.code === 'liaison_chsld'), 'proposé à la création d’un hôpital');
  const eD = (await poolPilote.query("SELECT id, type_etablissement, modules, module_actif FROM etablissements WHERE code = 'HD-ESSAI'")).rows[0];
  assert.ok(eD && eD.type_etablissement === 'hopital' && eD.modules.liaison_chsld !== false, 'module actif dans l’environnement');
  const cfgD = await sh('GET', `/hopitaux/${d.id}/configuration-operationnelle`);
  assert.ok(cfgD.modules_modifiables.includes('liaison_chsld'), 'activable depuis la console');
  // Tant qu'il n'est pas activé (go-live), il ne reçoit aucune demande
  assert.strictEqual((await api('era', 'GET', `/chsld/hopitaux?etablissement_id=${ids.era}`)).some((h) => h.id === eD.id), eD.module_actif);
  RESULTATS.liaison.sh = { desactivation: 'accès masqué, envois refusés, données conservées, réactivation avec historique', futur_hopital: { code: 'HD-ESSAI', module_actif: eD.module_actif } };
});

/* ------------------------------------------------------------------ Conservation de chambre, réintégration, nettoyage (1er nov. 2026) */
const placeDe = async (qui, etab, litId) => (await api(qui, 'GET', `/chsld/places?etablissement_id=${etab}`)).find((x) => x.id === litId);
async function hospitaliser(qui, etab, residentId, hopital, quiH, ref) {
  const r = (await api(qui, 'GET', `/chsld/residents/${residentId}`)).resident;
  let co = await api(qui, 'POST', `/chsld/residents/${residentId}/hospitalisation`, { hopital_id: hopital, identite_verifiee: true, version: r.version });
  co = await api(qui, 'POST', `/coordinations/${co.id}/action`, { etablissement_id: etab, action: 'confirmer_depart', version: co.version });
  co = await api(quiH, 'POST', `/coordinations/${co.id}/action`, { etablissement_id: hopital, action: 'confirmer_reception', version: co.version });
  if (ref) co = await api(quiH, 'POST', `/coordinations/${co.id}/action`, { etablissement_id: hopital, action: 'orienter', orientation: 'admission', patient_ref: ref, type_id: (await poolPilote.query('SELECT t.id FROM types_unite t JOIN etablissements e ON e.config_id = t.config_id WHERE e.id = $1 ORDER BY t.ordre LIMIT 1', [hopital])).rows[0].id, version: co.version });
  return co;
}
const coDe = async (qui, etab, id) => (await api(qui, 'GET', `/coordinations?etablissement_id=${etab}`)).find((c) => c.id === id);
let R = {};
test('réintégration : défaut ERA117A reproduit puis corrigé ; Jean Dupont Érables → B → Érables, place conservée et nettoyée, retour dans le même lit, double confirmation', async () => {
  const og = async (question, qui = 'era', etab = ids.era) => (await ogQ(qui, etab, question)).reponse;
  // Défaut : une référence seule (ERA117A) tombait sur la liste générique des fonctions
  const p117 = (await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).find((x) => x.code === 'ERA-117A');
  assert.ok(p117, 'le lit ERA-117A existe dans le jeu de données');
  const attendu117 = p117.resident_ref || 'ERA-117A';
  for (const q of ['ERA117A', 'ERA-117A', 'era 117a', 'Era-117a ?']) {
    const rep = await og(q);
    assert.ok(rep.includes(attendu117), `${q} → ${rep}`); assert.doesNotMatch(rep, /Je peux vous aider avec|Que peux-tu faire/);
  }
  assert.match(await og('ERA-999Z'), /Aucun résultat autorisé pour « ERA-999Z »/);
  // Départ : la place reste attribuée et conservée ; jamais disponible
  const avant = (await api('era', 'GET', `/chsld/residents/${p.dupont}`));
  const litDupont = avant.resident.lit_id; const refDupont = avant.resident.reference;
  const libresAvant = (await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).filter((x) => x.occupation === 'disponible').length;
  const hosp = await hospitaliser('era', ids.era, p.dupont, L.B, 'b', 'P-71101');
  let pl = await placeDe('era', ids.era, litDupont);
  assert.strictEqual(pl.occupation, 'conservee_hospitalisation'); assert.strictEqual(pl.resident_ref, refDupont);
  assert.strictEqual((await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).filter((x) => x.occupation === 'disponible').length, libresAvant, 'aucune place libérée');
  assert.ok(!(await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).some((x) => x.id === litDupont && x.etat === 'libre'));
  assert.match(await og('Où est Jean Dupont ?'), /Selon le dernier événement confirmé, Jean Dupont \(R-\d{5}\) a été reçu à Hôpital B — Mont-Clair le .* Son CHSLD de rattachement est CHSLD 1 — des Érables\. Place conservée/s);
  assert.match(await og('Sa place est-elle conservée ?'), /^Oui, sa place est conservée/);
  assert.match(await og('Quelles places sont conservées pour des résidents hospitalisés ?'), new RegExp(pl.code));
  // Nettoyage pendant l'hospitalisation : l'entretien change, jamais l'attribution (tâches antérieures de ce lit terminées d'abord)
  for (const x of (await api('era_entretien', 'GET', `/chsld/taches?etablissement_id=${ids.era}`)).filter((y) => y.lit_id === litDupont)) await api('era_entretien', 'POST', `/chsld/taches/${x.id}/statut`, { statut: 'faite', version: x.version });
  const tache = await api('era', 'POST', '/chsld/taches', { etablissement_id: ids.era, type: 'entretien', titre: 'Nettoyage de la place conservée', lit_id: litDupont, assigne_role: 'entretien' });
  assert.strictEqual((await placeDe('era', ids.era, litDupont)).entretien, 'a_nettoyer');
  assert.match(await og('Quelles chambres conservées doivent être nettoyées ?'), new RegExp(pl.code));
  let t = await api('era_entretien', 'POST', `/chsld/taches/${tache.id}/statut`, { statut: 'en_cours', version: tache.version });
  assert.strictEqual((await placeDe('era', ids.era, litDupont)).entretien, 'en_cours');
  await api('era_entretien', 'POST', `/chsld/taches/${t.id}/statut`, { statut: 'faite', version: t.version });
  pl = await placeDe('era', ids.era, litDupont);
  assert.strictEqual(pl.entretien, 'propre'); assert.strictEqual(pl.occupation, 'conservee_hospitalisation', 'propre et toujours conservée'); assert.ok(pl.entretien_par);
  assert.strictEqual((await api('era', 'GET', `/chsld/residents/${p.dupont}`)).resident.lit_id, litDupont);
  let rep = await og(`La chambre de ${refDupont} a-t-elle été nettoyée ?`);
  assert.match(rep, /propre, nettoyage confirmé le/); assert.ok(rep.includes(pl.entretien_par), rep);
  // Retour préparé par l'hôpital : chambre d'origine retrouvée, préparation à faire, puis « prête »
  let ret = await api('b', 'POST', `/coordinations/${hosp.id}/retour`, { retour_prevu_le: new Date(Date.now() + 3600000).toISOString() });
  let vue = await coDe('era', ids.era, ret.id);
  assert.strictEqual(vue.reintegration.lit.code, pl.code); assert.strictEqual(vue.reintegration.pret, true, 'chambre propre, attribuée, libre d’un autre résident');
  assert.match(await og('Sa chambre est-elle prête pour son retour ?'), /Chambre prête pour le retour/);
  const prop = await ogQ('era', ids.era, 'Prépare sa réinstallation dans sa chambre habituelle');
  assert.strictEqual(prop.proposition_chsld.type, 'coordination'); assert.strictEqual(prop.proposition_chsld.action, 'accepter');
  assert.strictEqual((await coDe('era', ids.era, ret.id)).statut, 'envoyee', 'OG n’accepte rien sans confirmation');
  ret = await api('era', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: ret.version ? 'accepter' : 'accepter', version: ret.version });
  vue = await coDe('era', ids.era, ret.id);
  assert.deepStrictEqual(vue.reintegration.raisons, ['preparation_en_cours'], 'tâche de préparation créée');
  assert.match(await og('Pourquoi sa réintégration est-elle bloquée ?'), /la préparation ou le nettoyage n’est pas terminé/);
  for (const x of (await api('era_entretien', 'GET', `/chsld/taches?etablissement_id=${ids.era}`)).filter((y) => y.lit_id === litDupont)) await api('era_entretien', 'POST', `/chsld/taches/${x.id}/statut`, { statut: 'faite', version: x.version });
  assert.strictEqual((await coDe('era', ids.era, ret.id)).reintegration.pret, true);
  assert.match(await og('Confirme son arrivée'), /Je ne confirme pas une arrivée physique/);
  ret = await api('b', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: L.B, action: 'confirmer_depart', version: ret.version });
  // Deux confirmations simultanées : une seule réintégration
  const [c1, c2] = await Promise.all([1, 2].map(() => appel('era', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: 'confirmer_arrivee', version: ret.version })));
  assert.ok([c1, c2].every((x) => x.statut === 200), JSON.stringify([c1.corps, c2.corps]));
  assert.strictEqual([c1, c2].filter((x) => x.corps.deja_confirme).length, 1, 'la seconde confirmation ne change rien');
  // Arrivée ≠ réintégration : la place reste conservée jusqu'à l'action explicite ; deux réintégrations simultanées n'en font qu'une
  assert.strictEqual((await api('era', 'GET', `/chsld/residents/${p.dupont}`)).resident.statut, 'retour_a_reintegrer');
  assert.strictEqual((await placeDe('era', ids.era, litDupont)).occupation, 'conservee_hospitalisation');
  let vr = await coDe('era', ids.era, ret.id);
  vr = await api('era', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: 'verifier_chambre', version: vr.version });
  const [ri1, ri2] = await Promise.all([1, 2].map(() => appel('era', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: 'reintegrer', identite_verifiee: true, conditions_accueil: true, version: vr.version })));
  assert.ok([ri1, ri2].every((x) => x.statut === 200), JSON.stringify([ri1.corps, ri2.corps]));
  assert.strictEqual([ri1, ri2].filter((x) => x.corps.deja_confirme).length, 1);
  const apres = await api('era', 'GET', `/chsld/residents/${p.dupont}`);
  assert.strictEqual(apres.mouvements.filter((m) => m.type === 'reintegration').length, 2, 'une réintégration par parcours');
  assert.strictEqual(apres.resident.statut, 'present'); assert.strictEqual(apres.resident.lit_id, litDupont, 'même lit'); assert.strictEqual(apres.resident.reference, refDupont, 'même dossier');
  assert.strictEqual((await placeDe('era', ids.era, litDupont)).occupation, 'occupee');
  assert.strictEqual(apres.mouvements.filter((m) => m.type === 'retour').length, 2, 'un retour par parcours (le parcours du matin et celui-ci), jamais deux pour la même confirmation');
  assert.strictEqual((await poolPilote.query(`SELECT count(*)::int n FROM residents WHERE lit_id = $1 AND statut NOT IN ('sorti','transfere')`, [litDupont])).rows[0].n, 1);
  rep = await og('Qui a confirmé sa réception ?');
  assert.match(rep, /Le retour de Jean Dupont .* a été confirmé le .* par /s);
  RESULTATS.reintegration = { era117a: attendu117, lit: pl.code, parcours: 'départ → reçu à B → nettoyage pendant la conservation → retour → prête → réintégré dans le même lit (double confirmation sans effet)' };
});

test('réintégration : chambre bloquée, place libérée puis réattribuée, retour annulé — aucune autre place attribuée sans validation', async () => {
  const og = async (question) => (await ogQ('era', ids.era, question)).reponse;
  // Chambre bloquée (incohérence simulée sur la place conservée) : réintégration refusée, résolution explicite par un responsable
  const x = await residentPresent('era', ids.era, [p.dupont]);
  const litX = (await api('era', 'GET', `/chsld/residents/${x.id}`)).resident.lit_id;
  const hx = await hospitaliser('era', ids.era, x.id, L.B, 'b');
  await poolPilote.query(`UPDATE lits SET etat = 'indispo', patient_ref = NULL, motif_indispo = 'travaux', version = version + 1 WHERE id = $1`, [litX]); // donnée de départ : place bloquée pendant l'absence
  let ret = await api('b', 'POST', `/coordinations/${hx.id}/retour`, { retour_prevu_le: new Date(Date.now() + 3600000).toISOString() });
  ret = await api('era', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: 'accepter', version: ret.version });
  assert.ok((await coDe('era', ids.era, ret.id)).reintegration.raisons.includes('place_bloquee'));
  ret = await api('b', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: L.B, action: 'confirmer_depart', version: ret.version });
  ret = await api('era', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: 'confirmer_arrivee', version: ret.version });
  await refuse('era', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: 'verifier_chambre', version: ret.version }, 409, 'reintegration_bloquee');
  await refuse('era', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: 'reintegrer', identite_verifiee: true, conditions_accueil: true, version: ret.version }, 409, 'chambre_a_verifier');
  assert.strictEqual((await api('era', 'GET', `/chsld/residents/${x.id}`)).resident.statut, 'retour_a_reintegrer', 'arrivé, jamais réintégré dans une place bloquée');
  assert.match(await og(`Pourquoi la réintégration de ${x.reference} est-elle bloquée ?`), /sa place est bloquée.*Aucune autre place n’est attribuée automatiquement/s);
  await refuse('era_soins', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: 'resoudre', lit_id: 1, version: ret.version }, 403);
  const libre = (await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).find((y) => y.occupation === 'disponible');
  ret = await api('era', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: 'resoudre', lit_id: libre.id, version_lit: libre.version, version: ret.version });
  ret = await reintegrerRetour('era', ids.era, ret.id);
  const rx = (await api('era', 'GET', `/chsld/residents/${x.id}`)).resident;
  assert.ok(rx.statut === 'present' && rx.lit_id === libre.id, 'nouvelle place validée explicitement');
  await poolPilote.query(`UPDATE lits SET etat = 'libre', motif_indispo = NULL, version = version + 1 WHERE id = $1`, [litX]);
  // Place libérée par un responsable puis réattribuée : le retour ne prend jamais la place d'un autre résident
  const y = await residentPresent('era', ids.era, [p.dupont, x.id]);
  const litY = (await api('era', 'GET', `/chsld/residents/${y.id}`)).resident.lit_id;
  const hy = await hospitaliser('era', ids.era, y.id, L.B, 'b');
  await refuse('era', 'POST', `/chsld/residents/${y.id}/liberer-place`, { motif: '' }, 400, 'motif_liberation_requis');
  const ry = (await api('era', 'GET', `/chsld/residents/${y.id}`)).resident;
  await api('era', 'POST', `/chsld/residents/${y.id}/liberer-place`, { version: ry.version, motif: 'Hospitalisation prolongée, décision de la direction' });
  const net = (await api('era_entretien', 'GET', `/nettoyage?etablissement_id=${ids.era}`)).find((l) => l.id === litY);
  await api('era_entretien', 'POST', `/lits/${litY}/action`, { action: 'nettoyage_ok', version: net.version });
  const z = await residentPresent('era', ids.era, [p.dupont, x.id, y.id]);
  const placeY = await placeDe('era', ids.era, litY);
  await api('era', 'POST', `/chsld/residents/${z.id}/changer-chambre`, { lit_id: litY, version: placeY.version, version_resident: z.version });
  let rety = await api('b', 'POST', `/coordinations/${hy.id}/retour`, { retour_prevu_le: new Date(Date.now() + 7200000).toISOString() });
  assert.deepStrictEqual((await coDe('era', ids.era, rety.id)).reintegration.raisons, ['aucune_place_attribuee']);
  assert.match(await og(`Pourquoi le retour de ${y.reference} est-il bloqué ?`), /aucune place n’est plus attribuée/);
  const libre2 = (await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).find((w) => w.occupation === 'disponible');
  rety = await api('era', 'POST', `/coordinations/${rety.id}/action`, { etablissement_id: ids.era, action: 'accepter', lit_id: libre2.id, version_lit: libre2.version, version: rety.version });
  // Retour annulé par l'hôpital : le résident reste hospitalisé, la place réservée reste la sienne
  rety = await api('b', 'POST', `/coordinations/${rety.id}/action`, { etablissement_id: L.B, action: 'annuler', version: rety.version });
  assert.strictEqual(rety.statut, 'annulee');
  assert.strictEqual((await api('era', 'GET', `/chsld/residents/${y.id}`)).resident.statut, 'hospitalise');
  assert.ok((await notifs('era', ids.era)).some((n) => n.code === 'chsld_retour_annule'));
  assert.strictEqual((await poolPilote.query(`SELECT count(*)::int n FROM residents WHERE lit_id = $1 AND statut NOT IN ('sorti','transfere')`, [litY])).rows[0].n, 1, 'la place réattribuée garde un seul résident');
  // Nouveau retour, mené à terme dans la place validée
  rety = await api('b', 'POST', `/coordinations/${hy.id}/retour`, { retour_prevu_le: new Date(Date.now() + 7200000).toISOString() });
  rety = await api('era', 'POST', `/coordinations/${rety.id}/action`, { etablissement_id: ids.era, action: 'accepter', version: rety.version });
  for (const tt of (await api('era_entretien', 'GET', `/chsld/taches?etablissement_id=${ids.era}`)).filter((w) => w.lit_id === libre2.id)) await api('era_entretien', 'POST', `/chsld/taches/${tt.id}/statut`, { statut: 'faite', version: tt.version });
  rety = await api('b', 'POST', `/coordinations/${rety.id}/action`, { etablissement_id: L.B, action: 'confirmer_depart', version: rety.version });
  await api('era', 'POST', `/coordinations/${rety.id}/action`, { etablissement_id: ids.era, action: 'confirmer_arrivee', version: rety.version });
  await reintegrerRetour('era', ids.era, rety.id);
  assert.strictEqual((await api('era', 'GET', `/chsld/residents/${y.id}`)).resident.lit_id, libre2.id);
  const doubles = (await poolPilote.query(`SELECT lit_id FROM residents WHERE lit_id IS NOT NULL AND statut NOT IN ('sorti','transfere') GROUP BY lit_id HAVING count(*) > 1`)).rows;
  assert.deepStrictEqual(doubles, [], 'aucune double attribution');
  RESULTATS.reintegration.exceptions = 'place bloquée (refus, résolution validée), place libérée puis réattribuée (refus, place choisie), retour annulé (place conservée), aucune double attribution';
});

test('parcours final : CHSLD A → Hôpital B → CHSLD A, formulaire, orientation réelle, retour en étapes, mêmes statuts des deux côtés, refus et concurrence', { timeout: 120000 }, async () => {
  const act = (qui, etab, id, corps) => api(qui, 'POST', `/coordinations/${id}/action`, { etablissement_id: etab, ...corps });
  const refAct = (qui, etab, id, corps, st, code) => refuse(qui, 'POST', `/coordinations/${id}/action`, { etablissement_id: etab, ...corps }, st, code);
  // Les deux interfaces reçoivent la même étape et la même chronologie
  const memes = async (id) => {
    const de = async (qui, etab) => (await api(qui, 'GET', `/coordinations?etablissement_id=${etab}`)).find((c) => c.id === id);
    const [a, b] = [await de('era', ids.era), await de('b', L.B)];
    assert.ok(a && b, `coordination ${id} visible des deux côtés`);
    assert.strictEqual(a.etape, b.etape); assert.deepStrictEqual(a.chronologie, b.chronologie);
    return a;
  };
  const prochain = async (exclus = []) => residentPresent('era', ids.era, [p.dupont, ...exclus]);
  // A. Formulaire de préparation : listes fermées, aucune saisie libre hors motif administratif
  const x = await prochain();
  const hopitaux = await api('era', 'GET', `/chsld/hopitaux?etablissement_id=${ids.era}`);
  const services = hopitaux.find((h) => h.id === L.B).services; assert.ok(services.length >= 2);
  const base = { hopital_id: L.B, identite_verifiee: true };
  await refuse('era', 'POST', `/chsld/residents/${x.id}/hospitalisation`, { ...base, urgence_declaree: 'absolue' }, 400, 'urgence_declaree_invalide');
  await refuse('era', 'POST', `/chsld/residents/${x.id}/hospitalisation`, { ...base, infos_operationnelles: { accessibilite: ['diagnostic'] } }, 400, 'infos_operationnelles_invalides');
  await refuse('era', 'POST', `/chsld/residents/${x.id}/hospitalisation`, { ...base, service_souhaite_id: 999999 }, 400, 'type_unite_inconnu');
  let co = await api('era', 'POST', `/chsld/residents/${x.id}/hospitalisation`, { ...base, version: x.version, motif_admin: 'Consultation planifiée', urgence_declaree: 'prioritaire', service_souhaite_id: services[0].id,
    infos_operationnelles: { accessibilite: ['fauteuil'], transport: 'ambulance', accompagnateur: true, langue: 'fr' } });
  // L'hôpital lit tout sans ressaisie ; aucune priorité clinique n'est déduite
  let f = (await api('b', 'GET', `/liaison-chsld?etablissement_id=${L.B}`)).arrivees.find((c) => c.id === co.id);
  assert.strictEqual(f.urgence_declaree, 'prioritaire'); assert.strictEqual(f.service_souhaite, services[0].nom); assert.deepStrictEqual(f.infos_operationnelles.accessibilite, ['fauteuil']);
  assert.ok(!JSON.stringify(f).includes(x.nom), 'aucun nom transmis');
  await memes(co.id);
  // Arrivée anticipée à l'hôpital : refusée sans le départ ; l'incident prévient le CHSLD
  await refAct('b', L.B, co.id, { action: 'confirmer_reception', version: co.version }, 409, 'coordination_statut_incompatible');
  co = await act('b', L.B, co.id, { action: 'incident', incident: 'arrivee_anticipee', version: co.version });
  assert.ok((await notifs('era', ids.era)).some((n) => n.code === 'chsld_arrivee_anticipee' && n.vars.numero === co.numero));
  co = await act('b', L.B, co.id, { action: 'accepter', version: co.version }); await memes(co.id);
  await refuse('b', 'GET', `/liaison-chsld/${co.id}/emplacements?etablissement_id=${L.B}`, null, 409, 'coordination_statut_incompatible');
  co = await act('era', ids.era, co.id, { action: 'confirmer_depart', version: co.version }); await memes(co.id);
  co = await act('b', L.B, co.id, { action: 'confirmer_reception', version: co.version }); await memes(co.id);
  // B. Emplacements : uniquement libres et compatibles
  const em = await api('b', 'GET', `/liaison-chsld/${co.id}/emplacements?etablissement_id=${L.B}&type_id=${services[0].id}`);
  assert.ok(em.lits.length >= 1 && em.civieres.length >= 2, `emplacements : ${em.lits.length} lits, ${em.civieres.length} civières`);
  const lignesLits = (await poolPilote.query('SELECT id, etat, type_id FROM lits WHERE id = ANY($1)', [em.lits.map((l) => l.id)])).rows;
  assert.ok(lignesLits.every((l) => l.etat === 'libre' && l.type_id === services[0].id));
  const isole = await api('b', 'GET', `/liaison-chsld/${co.id}/emplacements?etablissement_id=${L.B}&type_id=${services[0].id}&isolement=1`);
  if (isole.lits.length) assert.ok((await poolPilote.query('SELECT bool_and(isolement) ok FROM lits WHERE id = ANY($1)', [isole.lits.map((l) => l.id)])).rows[0].ok);
  // Vérification finale : lit périmé, occupé ou incompatible → aucun effet partiel (ni demande, ni orientation)
  const refX = 'P-74001';
  const nDemandes = async (ref) => (await poolPilote.query('SELECT count(*)::int n FROM demandes_admission WHERE patient_ref = $1', [ref])).rows[0].n;
  await refAct('b', L.B, co.id, { action: 'orienter', orientation: 'admission', patient_ref: refX, type_id: services[0].id, lit_id: em.lits[0].id, version_lit: em.lits[0].version + 5, version: co.version }, 409);
  const occupe = (await poolPilote.query(`SELECT id, version FROM lits WHERE etablissement_id = $1 AND type_id = $2 AND etat = 'occupe' LIMIT 1`, [L.B, services[0].id])).rows[0];
  if (occupe) await refAct('b', L.B, co.id, { action: 'orienter', orientation: 'admission', patient_ref: refX, type_id: services[0].id, lit_id: occupe.id, version_lit: occupe.version, version: co.version }, 409);
  const autreType = (await poolPilote.query(`SELECT id, version FROM lits WHERE etablissement_id = $1 AND type_id <> $2 AND etat = 'libre' LIMIT 1`, [L.B, services[0].id])).rows[0];
  if (autreType) await refAct('b', L.B, co.id, { action: 'orienter', orientation: 'admission', patient_ref: refX, type_id: services[0].id, lit_id: autreType.id, version_lit: autreType.version, version: co.version }, 400, 'lit_inadapte');
  assert.strictEqual(await nDemandes(refX), 0, 'panne en cours d’attribution : rien de partiel');
  assert.strictEqual((await coDe('b', L.B, co.id)).orientation, null);
  // Admission réelle dans un lit, statuts synchronisés
  const litX = em.lits[0];
  co = await act('b', L.B, co.id, { action: 'orienter', orientation: 'admission', patient_ref: refX, type_id: services[0].id, lit_id: litX.id, version_lit: litX.version, version: co.version });
  let vb = await coDe('b', L.B, co.id);
  assert.strictEqual(vb.admission.statut, 'admise'); assert.strictEqual(vb.admission.lit, litX.code);
  assert.deepStrictEqual((await poolPilote.query('SELECT etat, patient_ref FROM lits WHERE id = $1', [litX.id])).rows[0], { etat: 'occupe', patient_ref: refX });
  assert.strictEqual((await coDe('era', ids.era, co.id)).admission, null, 'le CHSLD ne voit ni le lit ni l’épisode hospitalier'); await memes(co.id);
  const j = (await poolPilote.query(`SELECT utilisateur_id, detail FROM journal WHERE etablissement_id = $1 AND detail LIKE $2`, [L.B, `${co.numero} · orienter%`])).rows[0];
  assert.ok(j && j.utilisateur_id && j.detail.includes(refX) && j.detail.includes(litX.code), `décision et auteur au journal : ${JSON.stringify(j)}`);
  // Doublons et concurrence : même référence refusée ; même lit, un seul gagnant
  const envoyerArrive = async (exclus) => { const r = await prochain(exclus); let c = await api('era', 'POST', `/chsld/residents/${r.id}/hospitalisation`, { ...base, version: r.version });
    c = await act('era', ids.era, c.id, { action: 'confirmer_depart', version: c.version }); c = await act('b', L.B, c.id, { action: 'confirmer_reception', version: c.version }); return { c, r }; };
  const y = await envoyerArrive([x.id]); const z = await envoyerArrive([x.id, y.r.id]);
  const lit2 = (await api('b', 'GET', `/liaison-chsld/${y.c.id}/emplacements?etablissement_id=${L.B}&type_id=${services[0].id}`)).lits[0];
  await refAct('b', L.B, y.c.id, { action: 'orienter', orientation: 'admission', patient_ref: refX, type_id: services[0].id, version: y.c.version }, 409, 'patient_deja_place');
  if (lit2) {
    const duel = await Promise.all([[y, 'P-74002'], [z, 'P-74003']].map(([w, ref]) => appel('b', 'POST', `/coordinations/${w.c.id}/action`, { etablissement_id: L.B, action: 'orienter', orientation: 'admission', patient_ref: ref, type_id: services[0].id, lit_id: lit2.id, version_lit: lit2.version, version: w.c.version })));
    assert.deepStrictEqual(duel.map((d) => d.statut).sort(), [200, 409], JSON.stringify(duel.map((d) => d.corps)));
    assert.strictEqual((await poolPilote.query(`SELECT count(*)::int n FROM demandes_admission WHERE lit_id = $1 AND statut = 'admise' AND patient_ref IN ('P-74002','P-74003')`, [lit2.id])).rows[0].n, 1);
  }
  // Urgence : civière choisie, puis correction vers un lit (la civière part au nettoyage)
  const perdant = async (w) => coDe('b', L.B, w.c.id);
  const zv = (await perdant(z)).orientation ? await perdant(y) : await perdant(z); const zId = zv.id;
  const emZ = await api('b', 'GET', `/liaison-chsld/${zId}/emplacements?etablissement_id=${L.B}`);
  const civ = emZ.civieres[0];
  let cz = await act('b', L.B, zId, { action: 'orienter', orientation: 'urgence', patient_ref: 'P-74004', civiere_id: civ.id, version_civiere: civ.version, version: zv.version });
  assert.deepStrictEqual((await poolPilote.query('SELECT etat, patient_ref FROM civieres WHERE id = $1', [civ.id])).rows[0], { etat: 'occupee', patient_ref: 'P-74004' });
  assert.ok(!(await api('b', 'GET', `/liaison-chsld/${zId}/emplacements?etablissement_id=${L.B}`)).civieres.some((v) => v.id === civ.id), 'civière occupée retirée de la liste');
  await refAct('b', L.B, zId, { action: 'orienter', orientation: 'urgence', patient_ref: 'P-74004', civiere_id: emZ.civieres[1].id, version: cz.version }, 409, 'orientation_deja_faite');
  const typeLibre = (await poolPilote.query(`SELECT l.type_id, l.id, l.version FROM lits l WHERE l.etablissement_id = $1 AND l.etat = 'libre' AND l.groupe_age IN ('adulte', 'tous') AND NOT (l.isolement OR l.pression_negative OR l.ventilation OR l.telemetrie) LIMIT 1`, [L.B])).rows[0];
  cz = await act('b', L.B, zId, { action: 'orienter', orientation: 'admission', type_id: typeLibre.type_id, lit_id: typeLibre.id, version_lit: typeLibre.version, version: cz.version });
  assert.strictEqual((await poolPilote.query('SELECT etat FROM civieres WHERE id = $1', [civ.id])).rows[0].etat, 'nettoyage');
  assert.strictEqual((await coDe('b', L.B, zId)).admission.statut, 'admise');
  // C. Retour : section dédiée, chronologie complète, arrivée puis réintégration
  let ret = await api('b', 'POST', `/coordinations/${co.id}/retour`, { retour_prevu_le: new Date(Date.now() + 3600000).toISOString() });
  let vue = await api('b', 'GET', `/liaison-chsld?etablissement_id=${L.B}`);
  const fr = vue.retours_en_cours.find((c) => c.id === co.id);
  assert.ok(fr && !vue.hospitalisations.some((c) => c.id === co.id), 'dans « Retours en cours »');
  assert.deepStrictEqual(fr.retour.chronologie.map((e) => e.code), ['demande', 'acceptation', 'preparation', 'chambre_verifiee', 'depart', 'transport', 'arrivee', 'reintegration', 'cloture']);
  await memes(ret.id); await memes(co.id);
  // Arrivée anticipée au CHSLD : refusée avant le départ de l'hôpital ; l'incident prévient l'hôpital
  await refAct('era', ids.era, ret.id, { action: 'confirmer_arrivee', version: ret.version }, 409, 'coordination_statut_incompatible');
  await refAct('era', ids.era, ret.id, { action: 'reintegrer', identite_verifiee: true, conditions_accueil: true, version: ret.version }, 409, 'coordination_statut_incompatible');
  ret = await act('era', ids.era, ret.id, { action: 'incident', incident: 'arrivee_anticipee', version: ret.version });
  assert.ok((await notifs('b', L.B)).some((n) => n.code === 'chsld_arrivee_anticipee' && n.vars.numero === ret.numero));
  ret = await act('era', ids.era, ret.id, { action: 'accepter', version: ret.version });
  // Chambre non prête : vérification refusée tant que la préparation n'est pas terminée
  await refAct('era', ids.era, ret.id, { action: 'verifier_chambre', version: ret.version }, 409, 'reintegration_bloquee');
  await refAct('era_soins', ids.era, ret.id, { action: 'verifier_chambre', version: ret.version }, 403, 'role_insuffisant');
  const litResident = (await api('era', 'GET', `/chsld/residents/${x.id}`)).resident.lit_id;
  // D. Entretien : confirme son intervention sans dossier ni tableau de bord ; propre ne libère jamais la place
  for (const chemin of [`/chsld/accueil?etablissement_id=${ids.era}`, `/chsld/residents?etablissement_id=${ids.era}`, `/chsld/residents/${x.id}`, `/coordinations?etablissement_id=${ids.era}`, `/chsld/indicateurs?etablissement_id=${ids.era}`, `/journal?etablissement_id=${ids.era}`]) await refuse('era_entretien', 'GET', chemin, null, 403, 'role_entretien');
  await refuse('era_entretien', 'POST', '/copilote/question', { etablissement_id: ids.era, question: 'Où est Jean Dupont ?' }, 403, 'role_entretien');
  await refuse('era_entretien', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: 'reintegrer', version: ret.version }, 403, 'role_entretien');
  const vuesEnt = await api('era_entretien', 'GET', `/chsld/taches?etablissement_id=${ids.era}`);
  const tacheRetour = vuesEnt.filter((t) => t.lit_id === litResident);
  assert.ok(tacheRetour.length >= 1, 'tâche de préparation reçue par l’entretien');
  assert.ok(vuesEnt.every((t) => !t.resident_ref && !/R-\d{5}/.test(t.titre)), 'aucune référence de résident pour l’entretien');
  assert.ok((await api('era_entretien', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).every((pl) => !pl.resident_ref && !pl.resident_nom && !pl.resident_id));
  for (const t0 of tacheRetour) { const t1 = await api('era_entretien', 'POST', `/chsld/taches/${t0.id}/statut`, { statut: 'en_cours', version: t0.version }); assert.strictEqual((await placeDe('era', ids.era, litResident)).entretien, 'en_cours'); await api('era_entretien', 'POST', `/chsld/taches/${t1.id}/statut`, { statut: 'faite', version: t1.version }); }
  let plc = await placeDe('era', ids.era, litResident);
  assert.strictEqual(plc.entretien, 'propre'); assert.strictEqual(plc.occupation, 'conservee_hospitalisation', 'propre et toujours conservée');
  assert.ok(!(await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).some((q) => q.id === litResident && q.occupation === 'disponible'));
  ret = await act('era', ids.era, ret.id, { action: 'verifier_chambre', version: ret.version }); await memes(ret.id);
  // Départ de l'hôpital : le lit de l'hôpital part au nettoyage ; transport ; arrivée ; la place reste conservée
  ret = await act('b', L.B, ret.id, { action: 'confirmer_depart', version: ret.version });
  assert.strictEqual((await poolPilote.query('SELECT etat FROM lits WHERE id = $1', [litX.id])).rows[0].etat, 'nettoyage', 'lit hospitalier libéré au départ confirmé');
  ret = await act('b', L.B, ret.id, { action: 'transport', version: ret.version });
  await refAct('b', L.B, ret.id, { action: 'transport', version: ret.version }, 409, 'coordination_statut_incompatible');
  await refAct('b', L.B, ret.id, { action: 'reintegrer', identite_verifiee: true, conditions_accueil: true, version: ret.version }, 409, 'action_coordination_interdite');
  ret = await act('era', ids.era, ret.id, { action: 'confirmer_arrivee', version: ret.version });
  assert.strictEqual((await memes(ret.id)).etape, 'retour_arrive'); assert.strictEqual((await memes(co.id)).etape, 'retour_arrive');
  assert.ok((await notifs('b', L.B)).some((n) => n.code === 'chsld_retour_arrive' && n.vars.numero === ret.numero));
  assert.strictEqual((await api('era', 'GET', `/chsld/residents/${x.id}`)).resident.statut, 'retour_a_reintegrer');
  assert.ok(!(await coDe('era', ids.era, co.id)).cloturee_le, 'pas de clôture avant la réintégration');
  // OG suit le même état : arrivé n'est pas réintégré ; il ne réintègre jamais à la place du personnel
  assert.match((await ogQ('era', ids.era, `Où est ${x.reference} ?`)).reponse, /est arrivé au CHSLD \(arrivée confirmée\) ; sa réintégration .* reste à confirmer/s);
  assert.match((await ogQ('era', ids.era, `Réintègre ${x.reference} dans sa chambre`)).reponse, /Je ne réintègre pas un résident à votre place/);
  assert.strictEqual((await api('era', 'GET', `/chsld/residents/${x.id}`)).resident.statut, 'retour_a_reintegrer', 'OG n’a rien écrit');
  assert.match((await ogQ('b', L.B, `Où en est ${x.reference} ?`)).reponse, /arrivé au CHSLD, réintégration à confirmer|retour/i);
  // Conditions de réintégration : chambre redevenue non prête, identité, conditions d'accueil, rôle
  const tard = await api('era', 'POST', '/chsld/taches', { etablissement_id: ids.era, type: 'entretien', titre: 'Nettoyage avant retour', lit_id: litResident, assigne_role: 'entretien' });
  await refAct('era', ids.era, ret.id, { action: 'reintegrer', identite_verifiee: true, conditions_accueil: true, version: ret.version }, 409, 'reintegration_bloquee');
  await api('era_entretien', 'POST', `/chsld/taches/${tard.id}/statut`, { statut: 'faite', version: tard.version });
  await refAct('era', ids.era, ret.id, { action: 'reintegrer', conditions_accueil: true, version: ret.version }, 400, 'identite_a_verifier');
  await refAct('era', ids.era, ret.id, { action: 'reintegrer', identite_verifiee: true, version: ret.version }, 400, 'conditions_accueil_a_confirmer');
  await refAct('era_soins', ids.era, ret.id, { action: 'reintegrer', identite_verifiee: true, conditions_accueil: true, version: ret.version }, 403, 'role_insuffisant');
  const ri = await act('era', ids.era, ret.id, { action: 'reintegrer', identite_verifiee: true, conditions_accueil: true, version: ret.version });
  assert.ok(ri.cloturee_le && ri.reintegree_le);
  const fin = await api('era', 'GET', `/chsld/residents/${x.id}`);
  assert.strictEqual(fin.resident.statut, 'present'); assert.strictEqual(fin.resident.lit_id, litResident, 'même lit'); assert.strictEqual(fin.resident.reference, x.reference, 'même dossier');
  assert.strictEqual((await placeDe('era', ids.era, litResident)).occupation, 'occupee');
  const chrono = await memes(ret.id);
  assert.ok(chrono.chronologie.every((e) => e.fait), JSON.stringify(chrono.chronologie)); assert.strictEqual(chrono.etape, 'retour_reintegre');
  assert.strictEqual((await memes(co.id)).etape, 'cloturee');
  assert.ok((await api('b', 'GET', `/liaison-chsld?etablissement_id=${L.B}`)).historique.some((c) => c.id === co.id));
  assert.ok((await poolPilote.query(`SELECT utilisateur_id FROM journal WHERE etablissement_id = $1 AND detail LIKE $2`, [ids.era, `${ret.numero} · reintegrer%`])).rows[0].utilisateur_id, 'réintégration et auteur au journal');
  assert.deepStrictEqual((await poolPilote.query(`SELECT detail FROM journal WHERE etablissement_id = ANY($1) AND detail LIKE '%' || $2 || '%'`, [[ids.era, L.B], x.nom])).rows, [], 'aucun nom au journal');
  // Refus du retour par le CHSLD et retour de la civière : l'emplacement n'est libéré qu'au départ confirmé
  const w = await envoyerArrive([x.id, y.r.id, z.r.id]);
  const emW = await api('b', 'GET', `/liaison-chsld/${w.c.id}/emplacements?etablissement_id=${L.B}`);
  const civW = emW.civieres[0];
  const cw = await act('b', L.B, w.c.id, { action: 'orienter', orientation: 'urgence', patient_ref: 'P-74005', civiere_id: civW.id, version_civiere: civW.version, version: w.c.version });
  let rw = await api('b', 'POST', `/coordinations/${cw.id}/retour`, { retour_prevu_le: new Date(Date.now() + 3600000).toISOString() });
  rw = await act('era', ids.era, rw.id, { action: 'refuser', version: rw.version });
  assert.strictEqual((await poolPilote.query('SELECT etat FROM civieres WHERE id = $1', [civW.id])).rows[0].etat, 'occupee', 'retour refusé : le patient reste sur sa civière');
  rw = await api('b', 'POST', `/coordinations/${cw.id}/retour`, { retour_prevu_le: new Date(Date.now() + 3600000).toISOString() });
  rw = await act('era', ids.era, rw.id, { action: 'accepter', version: rw.version });
  rw = await act('b', L.B, rw.id, { action: 'confirmer_depart', version: rw.version });
  assert.strictEqual((await poolPilote.query('SELECT etat FROM civieres WHERE id = $1', [civW.id])).rows[0].etat, 'nettoyage');
  rw = await act('era', ids.era, rw.id, { action: 'confirmer_arrivee', version: rw.version });
  await reintegrerRetour('era', ids.era, rw.id);
  // Remise en état des autres parcours de ce test
  for (const id of [y.c.id, z.c.id]) {
    const h = await coDe('b', L.B, id);
    let r2 = await api('b', 'POST', `/coordinations/${h.id}/retour`, { retour_prevu_le: new Date(Date.now() + 3600000).toISOString() });
    r2 = await act('era', ids.era, r2.id, { action: 'accepter', version: r2.version });
    r2 = await act('b', L.B, r2.id, { action: 'confirmer_depart', version: r2.version });
    r2 = await act('era', ids.era, r2.id, { action: 'confirmer_arrivee', version: r2.version });
    await reintegrerRetour('era', ids.era, r2.id);
  }
  const doubles = (await poolPilote.query(`SELECT lit_id FROM residents WHERE lit_id IS NOT NULL AND statut NOT IN ('sorti','transfere') GROUP BY lit_id HAVING count(*) > 1`)).rows;
  assert.deepStrictEqual(doubles, [], 'aucune double occupation');
  RESULTATS.parcours_final = 'A → B → A : formulaire, emplacements compatibles, admission réelle, civière, retour en neuf étapes, statuts identiques, refus et concurrence';
});

test('OG : 600 cas de questions sur données fictives réelles (références, chambres, admissions, hospitalisations, retours, liaison, proches, tâches, sécurité)', { timeout: 600000 }, async () => {
  const nz = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, ' ');
  // Situation de départ, construite par les API ordinaires
  const homonyme = await api('era', 'POST', '/chsld/residents', { etablissement_id: ids.era, prenom: 'Paul', nom: 'Dupont', date_naissance: '1941-05-06', confirmer_doublon: true });
  const hospDup = await hospitaliser('era', ids.era, p.dupont, L.B, 'b', 'P-71201');
  const litDup = (await api('era', 'GET', `/chsld/residents/${p.dupont}`)).resident.lit_id;
  const tache = await api('era', 'POST', '/chsld/taches', { etablissement_id: ids.era, type: 'entretien', titre: 'Nettoyage de la place conservée', lit_id: litDup, assigne_role: 'entretien' });
  await api('era_entretien', 'POST', `/chsld/taches/${tache.id}/statut`, { statut: 'faite', version: tache.version });
  const retDup = await api('b', 'POST', `/coordinations/${hospDup.id}/retour`, { retour_prevu_le: new Date(Date.now() + 2 * 3600000).toISOString() });
  const envoyer = async (h) => { const r = await residentPresent('era', ids.era, [p.dupont]); const co = await api('era', 'POST', `/chsld/residents/${r.id}/hospitalisation`, { hopital_id: h, identite_verifiee: true, version: r.version }); return { ...co, ref: r.reference, id_resident: r.id }; };
  const h2 = await envoyer(L.A);
  let h3 = await envoyer(L.C); h3 = { ...(await api('era', 'POST', `/coordinations/${h3.id}/action`, { etablissement_id: ids.era, action: 'confirmer_depart', version: h3.version })), ref: h3.ref };
  const h4 = await envoyer(L.B);
  const places = await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`);
  const residents = await api('era', 'GET', `/chsld/residents?etablissement_id=${ids.era}`);
  const ouverts = (await poolPilote.query(`SELECT resident_id FROM coordinations WHERE statut IN ('preparee','envoyee','acceptee','en_cours')`)).rows.map((x) => x.resident_id);
  const presents = residents.filter((r) => r.statut === 'present' && r.lit && !ouverts.includes(r.id) && r.id !== p.dupont)
    .map((r) => ({ ref: r.reference, lit: r.lit, chambre: r.chambre, prenom: r.prenom, nom: r.nom, nomUnique: residents.filter((x) => x.nom === r.nom).length === 1 }));
  const p117 = places.find((x) => x.code === 'ERA-117A');
  const demandes = await api('era', 'GET', `/chsld/demandes?etablissement_id=${ids.era}&toutes=1`);
  const d = { era: ids.era, stl: ids.stl, A: L.A, B: L.B, C: L.C,
    dupont: { ref: (await api('era', 'GET', `/chsld/residents/${p.dupont}`)).resident.reference, lit: places.find((x) => x.id === litDup).code },
    hospDup, h2, h3, h4, presents, attendu117: p117.resident_ref || 'ERA-117A',
    libres: places.filter((x) => x.occupation === 'disponible').length, occupees: places.filter((x) => x.occupation === 'occupee').length,
    bloquee: places.find((x) => x.occupation === 'bloquee'), preparation: places.find((x) => x.occupation === 'preparation'),
    preadmission: (await api('era', 'GET', `/chsld/residents?etablissement_id=${ids.era}&statut=preadmission`)).map((r) => ({ ref: r.reference }))[0],
    demande: demandes.find((x) => !['admise', 'refusee', 'annulee'].includes(x.statut)), demandeRef: demandes[0],
    nettoyeur: places.find((x) => x.id === litDup).entretien_par,
    refsStl: (await api('stl', 'GET', `/chsld/residents?etablissement_id=${ids.stl}&statut=tous`)).map((r) => r.reference) };
  assert.ok(homonyme.id && d.nettoyeur && presents.length >= 12, `situation incomplète : ${presents.length} résidents présents`);
  const { construire, DOMAINES } = require('./og-cas-chsld.cjs');
  const cas = construire(d);
  const resultats = [];
  for (const c of cas) {
    for (const q of c.contexte) await ogQ(c.qui, c.etab, q);
    const r = await appel(c.qui, 'POST', '/copilote/question', { etablissement_id: c.etab, question: c.question, langue: 'fr' });
    const rep = nz(r.corps?.reponse);
    const erreurs = [];
    if (r.statut !== (c.attendu.statut || 200)) erreurs.push(`HTTP ${r.statut} ${JSON.stringify(r.corps)}`);
    if (c.attendu.statut === 403 && JSON.stringify(r.corps || {}).includes('Dupont')) erreurs.push('donnée exposée malgré le refus');
    for (const x of c.attendu.contient || []) { const alts = Array.isArray(x) ? x : [x]; if (!alts.some((y) => rep.includes(nz(y)))) erreurs.push(`attendu : ${alts.join(' | ')}`); }
    for (const x of c.attendu.pas || []) if (rep.includes(nz(x))) erreurs.push(`interdit : ${x}`);
    if (c.attendu.proposition && r.corps?.proposition_chsld?.type !== c.attendu.proposition) erreurs.push(`proposition ${c.attendu.proposition} attendue`);
    if (c.attendu.sansProposition && (r.corps?.proposition_chsld || r.corps?.proposition)) erreurs.push('aucune proposition attendue');
    resultats.push({ id: c.id, domaine: c.domaine, qui: c.qui, question: c.question, contexte: c.contexte, reussi: !erreurs.length, erreurs, reponse: String(r.corps?.reponse || '').slice(0, 400) });
  }
  const parDomaine = Object.fromEntries(Object.keys(DOMAINES).map((k) => { const x = resultats.filter((y) => y.domaine === k); return [k, { cas: x.length, minimum: DOMAINES[k], reussis: x.filter((y) => y.reussi).length }]; }));
  const echecs = resultats.filter((x) => !x.reussi);
  fs.mkdirSync(path.resolve('.local'), { recursive: true });
  fs.writeFileSync(path.resolve('.local/og-600-rapport.json'), JSON.stringify({ date: new Date().toISOString(), total: resultats.length, reussis: resultats.length - echecs.length, par_domaine: parDomaine, echecs, cas: resultats }, null, 2));
  RESULTATS.og600 = { total: resultats.length, reussis: resultats.length - echecs.length, par_domaine: parDomaine };
  for (const [k, v] of Object.entries(parDomaine)) assert.ok(v.cas >= v.minimum, `${k} : ${v.cas} cas < ${v.minimum}`);
  assert.ok(resultats.length >= 600);
  assert.deepStrictEqual(echecs.map((x) => `${x.id} « ${x.question} » → ${x.erreurs.join(' ; ')} :: ${x.reponse.slice(0, 160)}`), [], `${echecs.length} échec(s) sur ${resultats.length}`);
  // Remise en état : Jean Dupont revient dans son lit ; demandes ouvertes annulées ; le départ vers C est reçu
  let ret = await api('era', 'POST', `/coordinations/${retDup.id}/action`, { etablissement_id: ids.era, action: 'accepter', version: retDup.version });
  for (const x of (await api('era_entretien', 'GET', `/chsld/taches?etablissement_id=${ids.era}`)).filter((y) => y.lit_id === litDup)) await api('era_entretien', 'POST', `/chsld/taches/${x.id}/statut`, { statut: 'faite', version: x.version });
  ret = await api('b', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: L.B, action: 'confirmer_depart', version: ret.version });
  await api('era', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: 'confirmer_arrivee', version: ret.version });
  await reintegrerRetour('era', ids.era, ret.id);
  for (const h of [h2, h4]) await api('era', 'POST', `/coordinations/${h.id}/action`, { etablissement_id: ids.era, action: 'annuler', version: h.version });
  await api('c', 'POST', `/coordinations/${h3.id}/action`, { etablissement_id: L.C, action: 'confirmer_reception', version: h3.version });
  assert.strictEqual((await api('era', 'GET', `/chsld/residents/${p.dupont}`)).resident.statut, 'present');
  const hom = (await api('era', 'GET', `/chsld/residents/${homonyme.id}`)).resident;
  await api('era', 'POST', `/chsld/residents/${homonyme.id}/sortie`, { version: hom.version, motif: 'autre' }); // accueil prévu annulé : l'homonyme fictif quitte la liste active
});

test('phase 2 — portail des proches : activé depuis SH, invitation, accès limité, messagerie, révocation, blocage', async () => {
  const era = crees.find((c) => c.code === 'CHSLD-ERA');
  const fd = await api('era', 'GET', `/chsld/residents/${p.dupont}`);
  const fille = fd.contacts.find((k) => k.relation === 'fille'), fils = fd.contacts.find((k) => k.relation === 'fils');
  // Compte de démonstration du proche (créé par SH) : même mot de passe de démonstration ; situation autorisée, message reçu
  sessions.marie = (await api(null, 'POST', '/proches/connexion', { courriel: 'marie.dupont@example.invalid', mot_de_passe: MDP })).token;
  const vue = await api('marie', 'GET', '/proches/moi');
  assert.strictEqual(vue.situation.statut, 'present'); assert.ok(vue.situation.mis_a_jour_le); assert.ok(vue.nouveaux_messages >= 1);
  // Désactivation puis réactivation depuis SH (configuration opérationnelle publiée vers l'environnement)
  const cfg0 = await sh('GET', `/hopitaux/${era.hopital_id}/configuration-operationnelle`);
  assert.ok(cfg0.modules_modifiables.includes('portail_proches'));
  await sh('PUT', `/hopitaux/${era.hopital_id}/configuration-operationnelle`, { version: cfg0.version, vocation: 'general', modules: Object.fromEntries(cfg0.modules_modifiables.map((k) => [k, k !== 'portail_proches'])) });
  await refuse('era', 'POST', `/chsld/contacts/${fille.id}/acces-portail`, {}, 403, 'module_desactive');
  await refuse('marie', 'GET', '/proches/moi', null, 401);
  const cfg = await sh('GET', `/hopitaux/${era.hopital_id}/configuration-operationnelle`);
  await sh('PUT', `/hopitaux/${era.hopital_id}/configuration-operationnelle`, { version: cfg.version, vocation: 'general', modules: Object.fromEntries(cfg.modules_modifiables.map((k) => [k, true])) });
  // Invitations : un contact sans courriel ni autorisation est refusé ; le lien n'est remis qu'une fois
  await refuse('era', 'POST', `/chsld/contacts/${fils.id}/acces-portail`, {}, 409, 'proche_courriel_requis');
  await refuse('era_soins', 'POST', `/chsld/contacts/${fille.id}/acces-portail`, {}, 403, 'role_insuffisant');
  const inv = await api('era', 'POST', `/chsld/contacts/${fille.id}/acces-portail`, {});
  const cle = inv.lien.match(/invitation=([a-f0-9]{64})/)[1];
  assert.strictEqual((await poolPilote.query('SELECT count(*)::int n FROM proches_acces WHERE invitation_hash = $1', [cle])).rows[0].n, 0, 'le jeton n’est jamais stocké en clair');
  await refuse(null, 'POST', '/proches/invitation', { jeton: cle, mot_de_passe: 'court' }, 400, 'mdp_faible');
  await api(null, 'POST', '/proches/invitation', { jeton: cle, mot_de_passe: 'Proche-Fictive-2026' });
  await refuse(null, 'POST', '/proches/invitation', { jeton: cle, mot_de_passe: 'Proche-Fictive-2026' }, 400, 'invitation_invalide');
  await refuse(null, 'POST', '/proches/connexion', { courriel: 'marie.dupont@example.invalid', mot_de_passe: 'Mauvais-mot-2026' }, 401, 'identifiants_incorrects');
  sessions.marie = (await api(null, 'POST', '/proches/connexion', { courriel: 'marie.dupont@example.invalid', mot_de_passe: 'Proche-Fictive-2026' })).token;
  assert.match(sessions.marie, /^P\./);
  // Ce que voit le proche : profil, prénom et initiale du résident, établissement, catégories autorisées ; jamais la chambre ni la référence
  const moi = await api('marie', 'GET', '/proches/moi');
  assert.deepStrictEqual(moi.resident, { prenom: 'Jean', initiale: 'D.' }); assert.strictEqual(moi.etablissement.nom, 'CHSLD 1 — des Érables');
  assert.doesNotMatch(JSON.stringify(moi), /ERA-\d|R-\d{5}|chambre|lit_id|hospital/i);
  // Sessions étanches : le jeton du proche n'ouvre pas l'API du personnel, et inversement
  await refuse('marie', 'GET', '/moi', null, 401); await refuse('era', 'GET', '/proches/moi', null, 401);
  // Messagerie : message et demande de rappel ; réponse de l'établissement ; catégorie retirée → refus immédiat
  await api('marie', 'POST', '/proches/messages', { categorie: 'rendez_vous', texte: 'Puis-je venir samedi à 14 h ?' });
  await api('marie', 'POST', '/proches/messages', { categorie: 'administratif', texte: 'Merci de me rappeler pour les documents.', rappel: true });
  const portail = await api('era', 'GET', `/chsld/residents/${p.dupont}/portail`);
  assert.strictEqual(portail.messages.filter((m) => m.sens === 'proche').length, 2);
  assert.ok((await api('era', 'GET', `/chsld/residents/${p.dupont}`)).communications.some((c) => c.type === 'rappel_demande' && c.sens === 'entrant'));
  await api('era', 'POST', `/chsld/residents/${p.dupont}/messages`, { contact_id: fille.id, categorie: 'rendez_vous', texte: 'Oui, samedi à 14 h convient.' });
  assert.ok((await api('marie', 'GET', '/proches/moi')).messages.some((m) => m.sens === 'etablissement' && /samedi/.test(m.texte)));
  const k = (await api('era', 'GET', `/chsld/residents/${p.dupont}`)).contacts.find((x) => x.id === fille.id);
  await api('era', 'PUT', `/chsld/contacts/${k.id}`, { ...k, autorisations: k.autorisations.filter((c) => c !== 'rendez_vous'), version: k.version });
  await refuse('marie', 'POST', '/proches/messages', { categorie: 'rendez_vous', texte: 'Et dimanche ?' }, 403, 'proche_non_autorise');
  assert.ok(!(await api('marie', 'GET', '/proches/moi')).messages.some((m) => m.categorie === 'rendez_vous'), 'les messages d’une catégorie retirée ne sont plus visibles');
  // Révocation : effet immédiat sur la session ouverte
  const acces = (await api('era', 'GET', `/chsld/residents/${p.dupont}/portail`)).acces.find((a) => !a.revoque_le);
  await api('era', 'POST', `/chsld/acces-portail/${acces.id}/revoquer`);
  await refuse('marie', 'GET', '/proches/moi', null, 401);
  // Blocage : 5 échecs bloquent 15 minutes, même avec le bon mot de passe ensuite
  const inv2 = await api('era', 'POST', `/chsld/contacts/${fille.id}/acces-portail`, { expire_le: new Date(Date.now() + 30 * 86400000).toISOString() });
  await api(null, 'POST', '/proches/invitation', { jeton: inv2.lien.match(/invitation=([a-f0-9]{64})/)[1], mot_de_passe: 'Proche-Fictive-2027' });
  for (let i = 0; i < 5; i += 1) await refuse(null, 'POST', '/proches/connexion', { courriel: 'marie.dupont@example.invalid', mot_de_passe: `Faux-${i}-2026xx` }, 401);
  await refuse(null, 'POST', '/proches/connexion', { courriel: 'marie.dupont@example.invalid', mot_de_passe: 'Proche-Fictive-2027' }, 401, 'identifiants_incorrects');
  await poolPilote.query('UPDATE proches_acces SET bloque_jusqu_au = now() - interval \'1 second\' WHERE revoque_le IS NULL AND courriel = $1', ['marie.dupont@example.invalid']);
  sessions.marie = (await api(null, 'POST', '/proches/connexion', { courriel: 'marie.dupont@example.invalid', mot_de_passe: 'Proche-Fictive-2027' })).token;
  assert.match((await api('marie', 'GET', '/proches/moi')).expire_le, /^\d{4}-/);
  const page = await fetch(`${basePilote}/proches`); assert.strictEqual(page.status, 200);
  // Journal : aucune donnée personnelle du proche ni texte de message
  const j = (await poolPilote.query(`SELECT string_agg(detail, ' ') t FROM journal WHERE action = 'Portail des proches'`)).rows[0].t;
  assert.doesNotMatch(j, /Marie|samedi|Dupont|example\.invalid/);
  RESULTATS.portail = 'module optionnel activé depuis SH ; invitation à usage unique (empreinte seulement) ; mot de passe robuste ; aucune chambre ni référence exposée ; sessions étanches ; catégories respectées et retrait immédiat ; messagerie et rappel ; révocation immédiate ; blocage après 5 échecs ; journal sans donnée personnelle';
});

test('audit de sécurité : attaques automatiques sur toutes les routes, isolation, injections, XSS, en-têtes, journal immuable', { timeout: 240000 }, async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'src', 'portail-proches.js'), 'utf8');
  const routes = [...new Set([...src.matchAll(/api\.(get|post|put|delete)\(\s*'([^']+)'/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`))];
  assert.ok(routes.length > 100, `${routes.length} routes trouvées`);
  const brut = async (jeton, methode, chemin, corps) => {
    const r = await fetch(`${basePilote}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: methode === 'GET' ? undefined : JSON.stringify(corps || {}) });
    return { statut: r.status, texte: await r.text(), entetes: r.headers };
  };
  const remplir = (c, id = 1) => `${c.replace(/:[a-zA-Z_]+/g, id)}${c.includes('?') ? '&' : '?'}etablissement_id=${ids.era}&depuis=${ids.era}`;
  // 1. Sans session : seule une liste fermée de routes répond sans authentification
  // Liste exacte : une route ajoutée sans authentification fait échouer ce test (un filtre par préfixe pourrait en masquer une)
  const PUBLIQUES = new Set(['GET /public', 'GET /sante', 'POST /mot-de-passe/oubli']);
  const ouvertes = [];
  for (const rt of routes) {
    const [m, c] = rt.split(' ');
    const r = await brut(null, m, remplir(c), {});
    if (r.statut < 400 && !PUBLIQUES.has(rt)) ouvertes.push(`${rt} → ${r.statut}`);
    assert.ok(r.statut < 500 && r.statut !== 429, `${rt} sans session → ${r.statut} ${r.texte.slice(0, 120)}`);
  }
  assert.deepStrictEqual(ouvertes, [], 'routes ouvertes sans session');
  assert.doesNotMatch((await brut(null, 'GET', '/public')).texte, /KEY|secret|mot_de_passe"|DATABASE|token/i, 'réglages publics sans secret');
  // 2. Rôle entretien : tout est refusé hors de sa liste fermée
  const ENTRETIEN = /^(GET \/(moi|nettoyage|meteo|og\/configuration|chsld\/taches|chsld\/places)|POST \/(deconnexion|nettoyage\/:|lits\/:|civieres\/:|chsld\/taches\/:)|(PUT|POST|GET|DELETE) \/moi\/)/;
  const fuites = [];
  for (const rt of routes.filter((x) => !ENTRETIEN.test(x) && !/ \/(deconnexion|moi\b)/.test(x) && !PUBLIQUES.has(x))) {
    const [m, c] = rt.split(' ');
    const r = await brut(sessions.era_entretien, m, remplir(c), {});
    if (r.statut < 400) fuites.push(`${rt} → ${r.statut}`);
  }
  assert.deepStrictEqual(fuites, [], 'routes accessibles au rôle entretien');
  // 3. Isolation : ressources réelles du CHSLD des Érables, attaquées depuis un autre CHSLD et depuis un hôpital
  const resident = await residentPresent('era', ids.era, [p.dupont]);
  const co = await api('era', 'POST', `/chsld/residents/${resident.id}/hospitalisation`, { hopital_id: L.B, identite_verifiee: true, version: resident.version });
  const tache = await api('era', 'POST', '/chsld/taches', { etablissement_id: ids.era, type: 'administratif', titre: 'Essai isolation' });
  const contact = (await api('era', 'GET', `/chsld/residents/${p.dupont}`)).contacts[0];
  const demande = (await api('era', 'GET', `/chsld/demandes?etablissement_id=${ids.era}&toutes=1`))[0];
  const attaques = [['GET', `/chsld/residents/${resident.id}`], ['PUT', `/chsld/residents/${resident.id}`, { prenom: 'Pirate' }], ['POST', `/chsld/residents/${resident.id}/sortie`, { motif: 'autre' }], ['POST', `/chsld/residents/${resident.id}/hospitalisation`, { hopital_id: L.A, identite_verifiee: true }],
    ['POST', `/chsld/residents/${resident.id}/liberer-place`, { motif: 'attaque de test' }], ['POST', `/chsld/residents/${p.dupont}/contacts`, { prenom: 'P', nom: 'P', relation: 'ami', telephone: '555' }], ['PUT', `/chsld/contacts/${contact.id}`, { actif: false }],
    ['POST', `/chsld/taches/${tache.id}/statut`, { statut: 'faite' }], ['POST', `/chsld/demandes/${demande.id}/action`, { action: 'annuler' }], ['GET', `/chsld/residents?etablissement_id=${ids.era}`], ['GET', `/chsld/places?etablissement_id=${ids.era}`], ['GET', `/chsld/accueil?etablissement_id=${ids.era}`],
    ['GET', `/chsld/taches?etablissement_id=${ids.era}`], ['GET', `/coordinations?etablissement_id=${ids.era}`], ['POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.era, action: 'annuler' }], ['POST', `/coordinations/${co.id}/action`, { etablissement_id: L.B, action: 'accepter' }],
    ['GET', `/liaison-chsld/${co.id}/emplacements?etablissement_id=${L.B}`], ['GET', `/liaison-chsld?etablissement_id=${L.B}`], ['GET', `/notifications?etablissement_id=${ids.era}`], ['GET', `/journal?etablissement_id=${ids.era}`]];
  for (const qui of ['stl', 'c']) for (const [m, c, corps] of attaques) {
    const r = await brut(sessions[qui], m, c, corps);
    assert.ok([403, 404, 409].includes(r.statut) && !r.texte.includes(resident.nom), `${qui} ${m} ${c} → ${r.statut} ${r.texte.slice(0, 140)}`);
  }
  assert.strictEqual((await api('era', 'GET', `/chsld/residents/${resident.id}`)).resident.prenom, resident.prenom, 'dossier inchangé');
  // 4. Gestionnaire réseau : capacités, jamais l'identité des résidents
  const reseau = (await poolPilote.query("SELECT id FROM utilisateurs WHERE role = 'gestionnaire' AND actif LIMIT 1")).rows[0];
  assert.ok(reseau, 'compte gestionnaire présent dans le jeu de test');
  {
    const jeton = require('node:crypto').randomBytes(32).toString('hex');
    await poolPilote.query(`INSERT INTO sessions (token, utilisateur_id, expire_le) VALUES ($1, $2, now() + interval '1 hour')`, [require('../src/auth').empreinteJeton(jeton), reseau.id]);
    for (const c of [`/chsld/residents?etablissement_id=${ids.era}`, `/chsld/residents/${p.dupont}`, `/chsld/places?etablissement_id=${ids.era}`, `/chsld/accueil?etablissement_id=${ids.era}`]) {
      const r = await brut(jeton, 'GET', c);
      assert.strictEqual(r.statut, 403, `gestionnaire ${c} → ${r.statut}`); assert.ok(!r.texte.includes('Dupont'));
    }
    assert.strictEqual((await brut(jeton, 'POST', '/copilote/question', { etablissement_id: ids.era, question: 'Où est Jean Dupont ?' })).texte.includes('R-'), false, 'OG n’ouvre pas les dossiers au gestionnaire');
  }
  // 5. Injections SQL : aucune erreur, aucune ligne de plus, aucune table touchée
  const avant = (await poolPilote.query('SELECT count(*)::int n FROM residents')).rows[0].n;
  for (const inj of ["' OR '1'='1", "'; DROP TABLE residents;--", '%\' OR 1=1--', '\\', "R-00001' UNION SELECT mot_de_passe_hash FROM utilisateurs--"]) {
    const r = await brut(sessions.era, 'GET', `/chsld/residents?etablissement_id=${ids.era}&q=${encodeURIComponent(inj)}`);
    assert.strictEqual(r.statut, 200, inj); assert.deepStrictEqual(JSON.parse(r.texte), [], `injection ${inj}`);
    const og = await brut(sessions.era, 'POST', '/copilote/question', { etablissement_id: ids.era, question: inj });
    assert.ok(og.statut < 500 && !/scrypt|\$2[aby]\$/.test(og.texte), `OG : ${inj}`);
    const ogB = await brut(sessions.b, 'POST', '/copilote/question', { etablissement_id: L.B, question: `Où en est ${inj} ?` });
    assert.ok(ogB.statut < 500, `OG hôpital : ${inj}`);
    const id = await brut(sessions.era, 'GET', `/chsld/residents/${encodeURIComponent(inj)}`);
    assert.ok([400, 404].includes(id.statut), `identifiant ${inj} → ${id.statut}`);
  }
  assert.strictEqual((await poolPilote.query('SELECT count(*)::int n FROM residents')).rows[0].n, avant);
  // 6. Affectation massive : aucun champ protégé ne se change par le corps de la requête
  const fiche = (await api('era', 'GET', `/chsld/residents/${p.dupont}`)).resident;
  await appel('era', 'PUT', `/chsld/residents/${p.dupont}`, { version: fiche.version, prenom: fiche.prenom, nom: fiche.nom, date_naissance: fiche.date_naissance, etablissement_id: ids.stl, statut: 'sorti', reference: 'R-99999', lit_id: null });
  const apres = (await api('era', 'GET', `/chsld/residents/${p.dupont}`)).resident;
  assert.deepStrictEqual([apres.etablissement_id, apres.statut, apres.reference, apres.lit_id], [fiche.etablissement_id, fiche.statut, fiche.reference, fiche.lit_id]);
  await refuse('era', 'POST', '/chsld/residents', { etablissement_id: ids.stl, prenom: 'P', nom: 'P', date_naissance: '1940-01-01' }, 403);
  // 7. Erreurs : aucun détail technique renvoyé
  const mal = await fetch(`${basePilote}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{mal' });
  assert.strictEqual(mal.status, 400);
  const gros = await fetch(`${basePilote}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'y'.repeat(60000) }) });
  assert.strictEqual(gros.status, 413);
  for (const r of [await mal.text(), await gros.text(), (await brut(sessions.era, 'GET', '/chsld/residents/abc')).texte, (await brut(sessions.era, 'GET', '/chsld/residents/99999999')).texte]) assert.doesNotMatch(r, /node_modules|at [\w.]+ \(|SELECT |pg_|ECONN|stack/);
  // 8. Secrets jamais renvoyés
  for (const c of ['/moi', `/admin/utilisateurs`, '/admin/comptes']) { const r = await brut(sessions.era_admin || sessions.era, 'GET', c); assert.doesNotMatch(r.texte, /mot_de_passe_hash|totp_secret|scrypt:/, c); }
  assert.strictEqual((await poolPilote.query('SELECT count(*)::int n FROM sessions WHERE token = $1', [sessions.era])).rows[0].n, 0, 'jeton de session jamais stocké en clair');
  // 9. Portail des proches : sessions étanches avec celles du personnel
  assert.ok(sessions.marie, 'session de proche présente');
  {
    for (const c of [`/chsld/residents?etablissement_id=${ids.era}`, '/moi', `/coordinations?etablissement_id=${ids.era}`]) assert.ok([401, 403].includes((await brut(sessions.marie, 'GET', c)).statut), `proche ${c}`);
    assert.ok([401, 403].includes((await brut(sessions.era, 'GET', '/proches/moi')).statut), 'le personnel n’entre pas dans le portail');
  }
  // 10. Journal immuable, y compris pour un accès direct à la base
  for (const t of ['journal', 'journal_admin']) for (const q of [`UPDATE ${t} SET detail = 'falsifié'`, `DELETE FROM ${t}`]) await assert.rejects(poolPilote.query(q), undefined, `${q} doit être refusé`);
  // 11. En-têtes
  const pg = await fetch(`${basePilote}/`); const csp = pg.headers.get('content-security-policy');
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), `CSP : ${csp}`); assert.match(csp, /frame-ancestors 'none'/); assert.ok(pg.headers.get('x-content-type-options') === 'nosniff' && pg.headers.get('x-frame-options') === 'DENY');
  assert.strictEqual((await brut(sessions.era, 'GET', '/moi')).entetes.get('cache-control'), 'no-store');
  assert.strictEqual(pg.headers.get('x-powered-by'), null);
  // 12. Garde-fous de production
  const { problemesProduction } = require('../src/environnement');
  assert.ok(problemesProduction({}).length === 1 && problemesProduction({ ARRIMO_PATIENTS_FICTIFS: '1', DEMO_MOT_DE_PASSE: 'x', SH_API_KEY: 'court' }).length === 4);
  assert.deepStrictEqual(problemesProduction({ ARRIMO_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), SH_API_KEY: 'c'.repeat(40) }), []);
  // Remise à zéro : aucune tâche de fond ne touche la base pendant le remplacement, et celle en cours est attendue d'abord
  {
    const { tacheDeFond, exclureTachesFond } = require('../src/demo'); const ordre = [];
    let finir; const enCours = tacheDeFond(() => new Promise((r) => { finir = () => { ordre.push('tache'); r(); }; }));
    await new Promise((r) => setImmediate(r));
    const remise = exclureTachesFond(async () => { ordre.push('remise'); let lancee = false; await tacheDeFond(() => { lancee = true; }); assert.strictEqual(lancee, false, 'tâche refusée pendant la remise'); });
    finir(); await enCours; await remise;
    assert.deepStrictEqual(ordre, ['tache', 'remise']);
    let apres = false; await tacheDeFond(() => { apres = true; }); assert.strictEqual(apres, true, 'tâches rétablies');
    const bloquee = tacheDeFond(() => new Promise(() => {})); let passee = false;
    await exclureTachesFond(async () => { passee = true; }, 20); assert.strictEqual(passee, true, 'tâche bloquée : délai borné'); void bloquee;
  }
  // Console SH : routes sans session, puis rôle limité sur toutes les routes qui lui sont interdites
  {
    const { autoriser, PERMISSIONS } = require('../src/sh/permissions');
    let srcSh = ''; for (const f of fs.readdirSync(path.join(__dirname, '..', 'src', 'sh')).filter((x) => x.endsWith('.js'))) srcSh += fs.readFileSync(path.join(__dirname, '..', 'src', 'sh', f), 'utf8');
    const routesSh = [...new Set([...srcSh.matchAll(/api\.(get|post|put|delete)\(\s*'([^']+)'/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`))];
    assert.ok(routesSh.length > 150, `${routesSh.length} routes SH`);
    const brutSh = async (jeton, m, c) => { const r = await fetch(`${baseSh}/api${c}`, { method: m, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: m === 'GET' ? undefined : '{}' }); return { statut: r.status, texte: await r.text() }; };
    const SH_PUBLIQUES = new Set(['GET /sante', 'POST /connexion', 'POST /connexion/2fa', 'POST /invitations/consommer', 'GET /connexion/configuration', 'POST /mot-de-passe/demander', 'POST /mot-de-passe/reinitialiser']);
    const chemin = (c) => c.replace(/:[a-zA-Z_]+/g, '1');
    const ouvertesSh = [];
    for (const rt of routesSh) { const [m, c] = rt.split(' '); const r = await brutSh(null, m, chemin(c)); assert.ok(r.statut < 500 && r.statut !== 429, `SH ${rt} → ${r.statut} ${r.texte.slice(0, 100)}`); if (r.statut < 400 && !SH_PUBLIQUES.has(rt)) ouvertesSh.push(`${rt} → ${r.statut}`); }
    assert.deepStrictEqual(ouvertesSh, [], 'routes SH ouvertes sans session');
    const jetonSupport = require('node:crypto').randomBytes(32).toString('hex');
    const us = (await pool.query(`INSERT INTO sh_utilisateurs (email, nom, role, mot_de_passe_hash, mdp_temporaire, totp_actif) VALUES ('audit.support@example.invalid', 'Audit support', 'support', 'fixture-sans-connexion', false, true) RETURNING id`)).rows[0];
    await pool.query(`INSERT INTO sh_sessions (token, token_hache, utilisateur_id, expire_le) VALUES ($1, true, $2, now() + interval '1 hour')`, [require('../src/sh/security').empreinte(jetonSupport), us.id]);
    const interdites = routesSh.filter((rt) => { const [m, c] = rt.split(' '); return !SH_PUBLIQUES.has(rt) && !autoriser({ role: 'support' }, { method: m, path: chemin(c), body: {} }); });
    assert.ok(interdites.length > 50, `${interdites.length} routes interdites au support`);
    const permissives = [];
    for (const rt of interdites) { const [m, c] = rt.split(' '); const r = await brutSh(jetonSupport, m, chemin(c)); if (r.statut !== 403) permissives.push(`${rt} → ${r.statut}`); }
    assert.deepStrictEqual(permissives, [], 'routes SH non refusées au rôle support');
    RESULTATS.audit_sh = { routes: routesSh.length, interdites_support: interdites.length, permissions: Object.keys(PERMISSIONS).length };
    fs.writeFileSync(path.resolve('.local/audit-sh-balayage.json'), JSON.stringify(RESULTATS.audit_sh));
  }
  // 13. XSS stockée : les textes saisis ne deviennent jamais du code, dans le CHSLD ni à l'hôpital
  const CHARGE = '<img src=x onerror="window.__xss=1"><svg/onload=window.__xss=2>';
  const victime = await api('era', 'POST', '/chsld/residents', { etablissement_id: ids.era, prenom: CHARGE, nom: 'Essai<script>window.__xss=3</script>', date_naissance: '1939-03-03', confirmer_doublon: true });
  const r2 = await residentPresent('era', ids.era, [p.dupont, resident.id]);
  const coX = await api('era', 'POST', `/chsld/residents/${r2.id}/hospitalisation`, { hopital_id: L.B, identite_verifiee: true, version: r2.version, motif_admin: CHARGE });
  await api('era', 'POST', '/chsld/taches', { etablissement_id: ids.era, type: 'administratif', titre: CHARGE });
  const { chromium } = require('playwright'); const nav = await chromium.launch();
  try {
    const ouvrir = async (qui, etab) => { const ctx = await nav.newContext({ bypassCSP: true }); const pg2 = await ctx.newPage(); // CSP désactivée : on prouve l'échappement lui-même
      await pg2.addInitScript(({ jeton, id }) => { localStorage.setItem('arrimo-token', jeton); localStorage.setItem('arrimo-ctx', String(id)); localStorage.setItem('arrimo-langue', 'fr'); }, { jeton: sessions[qui], id: etab });
      await pg2.goto(basePilote); await pg2.waitForSelector('body[data-pret="1"]'); if (await pg2.locator('#b-premiers-pas-ok').isVisible().catch(() => false)) await pg2.click('#b-premiers-pas-ok'); return pg2; };
    const propre = async (pg2, ou) => { await pg2.waitForTimeout(300); assert.strictEqual(await pg2.evaluate(() => window.__xss), undefined, `XSS exécutée : ${ou}`); assert.strictEqual(await pg2.locator('img[src="x"]').count(), 0, `balise injectée : ${ou}`); };
    const e = await ouvrir('era', ids.era);
    await e.click('#onglets button[data-v="c-residents"]'); await e.waitForSelector('#v-c-residents table'); await e.fill('#ch-q', 'Essai'); await e.waitForFunction(() => document.querySelectorAll('#v-c-residents tbody tr').length >= 1); await propre(e, 'liste des résidents');
    await e.click('#v-c-residents [data-res]'); await e.waitForSelector('[data-ch-action]'); await propre(e, 'fiche');
    await e.click('#onglets button[data-v="c-taches"]'); await e.waitForSelector('#v-c-taches'); await propre(e, 'tâches');
    await e.click('#onglets button[data-v="c-mouvements"]'); await e.waitForSelector(`#v-c-mouvements [data-co][data-id="${coX.id}"]`); await propre(e, 'mouvements');
    const b = await ouvrir('b', L.B);
    await b.click('#onglets button[data-v="liaison"]'); await b.waitForSelector(`#v-liaison [data-coordination="${coX.id}"]`); await propre(b, 'Liaison CHSLD');
    assert.ok((await b.locator(`#v-liaison [data-coordination="${coX.id}"]`).innerText()).includes('<img'), 'le texte reste affiché tel quel');
  } finally { await nav.close(); }
  // Remise en état
  for (const c of [co, coX]) await api('era', 'POST', `/coordinations/${c.id}/action`, { etablissement_id: ids.era, action: 'annuler', version: c.version });
  const v2 = (await api('era', 'GET', `/chsld/residents/${victime.id}`)).resident;
  await api('era', 'POST', `/chsld/residents/${victime.id}/sortie`, { version: v2.version, motif: 'autre' });
  RESULTATS.audit = { routes: routes.length };
});

test('transferts multiples : CHSLD → A → B → C → CHSLD, puis 2e et 3e hospitalisations ; historique jamais écrasé, refus, annulation, concurrence, isolation', { timeout: 180000 }, async () => {
  const H = { a: L.A, b: L.B, c: L.C };
  const act = (qui, etab, id, corps) => api(qui, 'POST', `/coordinations/${id}/action`, { etablissement_id: etab, ...corps });
  const refAct = (qui, etab, id, corps, st, code) => refuse(qui, 'POST', `/coordinations/${id}/action`, { etablissement_id: etab, ...corps }, st, code);
  const fiche = async (qui, etab, id) => (await api(qui, 'GET', `/coordinations?etablissement_id=${etab}`)).find((c) => c.id === id);
  const x = await residentPresent('era', ids.era, [p.dupont]);
  const litAvant = (await api('era', 'GET', `/chsld/residents/${x.id}`)).resident.lit_id;
  const versionRes = async () => (await api('era', 'GET', `/chsld/residents/${x.id}`)).resident.version;
  // Aller vers un hôpital, arrivée confirmée
  const aller = async (qui) => {
    let co = await api('era', 'POST', `/chsld/residents/${x.id}/hospitalisation`, { hopital_id: H[qui], identite_verifiee: true, version: await versionRes(), motif_admin: 'Parcours fictif' });
    co = await act(qui, H[qui], co.id, { action: 'accepter', version: co.version });
    co = await act('era', ids.era, co.id, { action: 'confirmer_depart', version: co.version });
    return act(qui, H[qui], co.id, { action: 'confirmer_reception', version: co.version });
  };
  // Lit libre et compatible, par l'écran d'orientation
  const admettre = async (qui, co, ref) => {
    const h = await api(qui, 'GET', `/liaison-chsld/${co.id}/emplacements?etablissement_id=${H[qui]}`);
    let e = h; for (const s of h.services) { e = await api(qui, 'GET', `/liaison-chsld/${co.id}/emplacements?etablissement_id=${H[qui]}&type_id=${s.id}`); if (e.lits.length) break; }
    const lit = e.lits[0]; assert.ok(lit, `lit libre à ${qui}`);
    return { co: await act(qui, H[qui], co.id, { action: 'orienter', orientation: 'admission', patient_ref: ref, type_id: e.type_id, lit_id: lit.id, version_lit: lit.version, version: co.version }), lit };
  };
  // Transfert jusqu'à l'arrivée confirmée ; rend la nouvelle hospitalisation
  const transferer = async (de, vers, h) => {
    let t = await api(de, 'POST', `/coordinations/${h.id}/transfert-hopital`, { hopital_id: H[vers], motif_admin: 'Service non offert (fictif)' });
    t = await act(vers, H[vers], t.id, { action: 'accepter', version: t.version });
    t = await act(de, H[de], t.id, { action: 'confirmer_depart', version: t.version });
    t = await act(vers, H[vers], t.id, { action: 'confirmer_arrivee', version: t.version });
    return { t, suite: (await api(vers, 'GET', `/coordinations?etablissement_id=${H[vers]}`)).find((c) => c.type === 'hospitalisation' && c.liee_id === t.id) };
  };
  // Retour complet jusqu'à la réintégration
  const retourner = async (qui, h) => {
    let r = await api(qui, 'POST', `/coordinations/${h.id}/retour`, { retour_prevu_le: new Date(Date.now() + 3600000).toISOString() });
    r = await act('era', ids.era, r.id, { action: 'accepter', version: r.version });
    for (const ta of (await api('era', 'GET', `/chsld/taches?etablissement_id=${ids.era}`)).filter((y) => y.lit_id === litAvant && ['a_faire', 'en_cours'].includes(y.statut))) await api('era', 'POST', `/chsld/taches/${ta.id}/statut`, { statut: 'faite', version: ta.version });
    r = await act('era', ids.era, r.id, { action: 'verifier_chambre', version: r.version });
    r = await act(qui, H[qui], r.id, { action: 'confirmer_depart', version: r.version });
    r = await act('era', ids.era, r.id, { action: 'confirmer_arrivee', version: r.version });
    return act('era', ids.era, r.id, { action: 'reintegrer', identite_verifiee: true, conditions_accueil: true, version: r.version });
  };
  const hA = await aller('a');
  const { co: orienteA, lit: litA } = await admettre('a', hA, 'P-71001');
  // Refus de garde
  await refuse('a', 'POST', `/coordinations/${hA.id}/transfert-hopital`, { hopital_id: H.a }, 404, 'hopital_introuvable');
  await refuse('a', 'POST', `/coordinations/${hA.id}/transfert-hopital`, { hopital_id: ids.stl }, 404, 'hopital_introuvable');
  await refuse('b', 'POST', `/coordinations/${hA.id}/transfert-hopital`, { hopital_id: H.c }, 403);
  await refuse('era', 'POST', `/coordinations/${hA.id}/transfert-hopital`, { hopital_id: H.b }, 403);
  // Deux demandes simultanées : une seule passe
  const deux = await Promise.all([appel('a', 'POST', `/coordinations/${hA.id}/transfert-hopital`, { hopital_id: H.b }), appel('a', 'POST', `/coordinations/${hA.id}/transfert-hopital`, { hopital_id: H.c })]);
  assert.deepStrictEqual(deux.map((y) => y.statut).sort(), [200, 409]);
  let t1 = deux.find((y) => y.statut === 200).corps; const versC = t1.destination_id === H.c;
  // Pendant un transfert ouvert : pas de retour ; le résident et le lit de A ne bougent pas
  await refuse('a', 'POST', `/coordinations/${hA.id}/retour`, { retour_prevu_le: new Date(Date.now() + 3600000).toISOString() }, 409, 'transfert_hopital_ouvert');
  assert.strictEqual((await poolPilote.query('SELECT etat FROM lits WHERE id = $1', [litA.id])).rows[0].etat, 'occupe');
  // Refus par l'hôpital sollicité : le résident reste à A
  t1 = await act(versC ? 'c' : 'b', t1.destination_id, t1.id, { action: 'refuser', version: t1.version, motif: 'Pas de lit (fictif)' });
  assert.strictEqual(t1.statut, 'refusee');
  assert.strictEqual((await poolPilote.query('SELECT etat FROM lits WHERE id = $1', [litA.id])).rows[0].etat, 'occupe');
  // Annulation par A
  let t2 = await api('a', 'POST', `/coordinations/${hA.id}/transfert-hopital`, { hopital_id: H.b });
  await refAct('b', H.b, t2.id, { action: 'annuler', version: t2.version }, 409, 'action_coordination_interdite');
  t2 = await act('a', H.a, t2.id, { action: 'annuler', version: t2.version }); assert.strictEqual(t2.statut, 'annulee');
  // Transfert accepté : départ avant acceptation refusé, arrivée anticipée refusée, isolation
  let t3 = await api('a', 'POST', `/coordinations/${hA.id}/transfert-hopital`, { hopital_id: H.b });
  assert.ok(new Set([t1.numero, t2.numero, t3.numero]).size === 3, 'chaque transfert a son identifiant');
  await refAct('a', H.a, t3.id, { action: 'confirmer_depart', version: t3.version }, 409, 'coordination_statut_incompatible');
  await refAct('c', H.c, t3.id, { action: 'accepter', version: t3.version }, 403);
  t3 = await act('b', H.b, t3.id, { action: 'accepter', version: t3.version });
  await refAct('b', H.b, t3.id, { action: 'confirmer_arrivee', version: t3.version }, 409, 'coordination_statut_incompatible');
  t3 = await act('a', H.a, t3.id, { action: 'confirmer_depart', version: t3.version });
  assert.strictEqual((await poolPilote.query('SELECT etat FROM lits WHERE id = $1', [litA.id])).rows[0].etat, 'nettoyage', 'le lit de A part au nettoyage au départ');
  const pendant = await api('era', 'GET', `/chsld/residents/${x.id}`);
  assert.strictEqual(pendant.resident.statut, 'hospitalise'); assert.strictEqual(pendant.resident.lit_id, litAvant, 'place conservée pendant le transfert');
  // Arrivée confirmée deux fois en même temps : une seule nouvelle hospitalisation
  const arrivees = await Promise.all([1, 2].map(() => appel('b', 'POST', `/coordinations/${t3.id}/action`, { etablissement_id: H.b, action: 'confirmer_arrivee', version: t3.version })));
  assert.ok(arrivees.every((y) => y.statut === 200), JSON.stringify(arrivees.map((y) => y.statut)));
  const suites = (await poolPilote.query(`SELECT * FROM coordinations WHERE type = 'hospitalisation' AND liee_id = $1`, [t3.id])).rows;
  assert.strictEqual(suites.length, 1);
  const hB = suites[0];
  assert.deepStrictEqual([hB.origine_id, hB.destination_id, hB.statut, hB.lit_id], [ids.era, H.b, 'recue', litAvant]);
  // L'ancienne hospitalisation n'est pas écrasée
  const ancienneA = await fiche('a', H.a, hA.id);
  assert.ok(ancienneA.cloturee_le); assert.strictEqual(ancienneA.numero, hA.numero); assert.strictEqual(ancienneA.orientation, orienteA.orientation);
  await refAct('a', H.a, hA.id, { action: 'orienter', orientation: 'urgence', version: ancienneA.version }, 409, 'coordination_close');
  assert.ok((await api('a', 'GET', `/liaison-chsld?etablissement_id=${H.a}`)).historique.some((c) => c.id === t3.id));
  assert.ok((await api('era', 'GET', `/coordinations?etablissement_id=${ids.era}`)).some((c) => c.id === hB.id), 'le CHSLD voit le nouvel hôpital');
  // Même référence hospitalière possible à B, le lit est choisi par B ; puis B → C → CHSLD
  const fB = await fiche('b', H.b, hB.id);
  assert.ok((await api('b', 'GET', `/liaison-chsld?etablissement_id=${H.b}`)).a_accueillir.some((c) => c.id === hB.id && c.actions.includes('orienter') && c.actions.includes('transferer')));
  const { t: t4, suite: hC } = await transferer('b', 'c', fB);
  assert.strictEqual(t4.statut, 'recue'); assert.ok(hC);
  const fin1 = await retourner('c', hC);
  assert.ok(fin1.reintegree_le);
  const r1 = (await api('era', 'GET', `/chsld/residents/${x.id}`)).resident;
  assert.deepStrictEqual([r1.statut, r1.lit_id, r1.reference], ['present', litAvant, x.reference], 'même lit, même dossier');
  // 2e et 3e hospitalisations du même résident
  const h2 = await aller('b'); assert.notStrictEqual(h2.numero, hA.numero);
  assert.ok((await retourner('b', h2)).reintegree_le);
  const h3 = await aller('c');
  assert.ok((await retourner('c', h3)).reintegree_le);
  const toutes = (await poolPilote.query(`SELECT id, numero, type FROM coordinations WHERE resident_id = $1 AND type = 'hospitalisation' AND id >= $2 ORDER BY id`, [x.id, hA.id])).rows;
  assert.strictEqual(toutes.length, 5, 'A, B, C puis deux nouvelles hospitalisations');
  assert.strictEqual(new Set(toutes.map((y) => y.numero)).size, 5);
  // Aucune occupation contradictoire et aucun nom transmis aux hôpitaux
  assert.strictEqual((await poolPilote.query(`SELECT count(*)::int n FROM lits WHERE etablissement_id = $1 AND id = $2 AND etat = 'occupe'`, [ids.era, litAvant])).rows[0].n, 1);
  const vueB = JSON.stringify(await api('b', 'GET', `/liaison-chsld?etablissement_id=${H.b}`));
  assert.ok(!vueB.includes(r1.nom), 'aucun nom à l’hôpital');
});

async function reintegrerApres(r, x) {
  const act = (qui, etab, id, corps) => api(qui, 'POST', `/coordinations/${id}/action`, { etablissement_id: etab, ...corps });
  r = await act('era', ids.era, r.id, { action: 'accepter', version: r.version });
  const lit = (await api('era', 'GET', `/chsld/residents/${x.id}`)).resident.lit_id;
  for (const ta of (await api('era', 'GET', `/chsld/taches?etablissement_id=${ids.era}`)).filter((y) => y.lit_id === lit)) await api('era', 'POST', `/chsld/taches/${ta.id}/statut`, { statut: 'faite', version: ta.version });
  r = await act('era', ids.era, r.id, { action: 'verifier_chambre', version: r.version });
  r = await act('b', L.B, r.id, { action: 'confirmer_depart', version: r.version });
  r = await act('era', ids.era, r.id, { action: 'confirmer_arrivee', version: r.version });
  return act('era', ids.era, r.id, { action: 'reintegrer', identite_verifiee: true, conditions_accueil: true, version: r.version });
}

test('nettoyage intelligent : précautions, protocole, habilitations, équipements, contrôle ; rien de changé sans précaution ; aucun patient visible', { timeout: 120000 }, async () => {
  const A = 'era_entretien'; const S = 'era'; const E = ids.era;
  const q = (sql, v) => poolPilote.query(sql, v).then((r) => r.rows);
  const nettoyageSur = async () => { // Un lit libre et sa chambre, sans résident, mis au nettoyage par le parcours normal
    const [l] = await q(`SELECT l.id, l.code, l.version, l.chambre_id FROM lits l WHERE l.etablissement_id = $1 AND l.etat = 'libre' AND l.actif AND NOT EXISTS (SELECT 1 FROM lits x WHERE x.chambre_id = l.chambre_id AND x.etat <> 'libre') ORDER BY l.id LIMIT 1`, [E]);
    await poolPilote.query(`UPDATE lits SET etat = 'nettoyage', version = version + 1, patient_ref = NULL WHERE id = $1`, [l.id]);
    return (await q('SELECT id, code, version, chambre_id FROM lits WHERE id = $1', [l.id]))[0];
  };
  const chambre = async (id) => (await api(S, 'GET', `/chambres/precautions?etablissement_id=${E}`)).find((c) => c.id === id);
  const poser = async (id, precautions, qui = S) => api(qui, 'PUT', `/chambres/${id}/precautions`, { precautions, version: (await chambre(id)).version });
  const dans = async (qui, id) => (await api(qui, 'GET', `/nettoyage?etablissement_id=${E}`)).find((x) => x.id === id);
  const agentId = (await api(A, 'GET', '/moi')).utilisateur.id;

  // 1. Chambre sans précaution : parcours habituel, aucune intervention
  let l = await nettoyageSur();
  let f = await dans(A, l.id);
  assert.deepStrictEqual([f.precautions, f.autorisee, f.protocole, f.intervention], [[], true, null, null]);
  await api(A, 'POST', `/nettoyage/${l.id}/debut`);
  await api(A, 'POST', `/lits/${l.id}/action`, { action: 'nettoyage_ok', version: (await dans(A, l.id)).version });
  assert.strictEqual((await q('SELECT count(*)::int n FROM nettoyage_interventions WHERE lit_id = $1', [l.id]))[0].n, 0);

  // 2. Droits : l'agent ne pose ni précautions ni protocoles ; valeurs fermées ; isolation
  l = await nettoyageSur();
  await refuse(A, 'PUT', `/chambres/${l.chambre_id}/precautions`, { precautions: ['contact'], version: 0 }, 403);
  await refuse(A, 'GET', `/chambres/precautions?etablissement_id=${E}`, null, 403);
  await refuse(S, 'PUT', `/chambres/${l.chambre_id}/precautions`, { precautions: ['grippe'], version: (await chambre(l.chambre_id)).version }, 400, 'precautions_invalides');
  await refuse('stl', 'PUT', `/chambres/${l.chambre_id}/precautions`, { precautions: ['contact'], version: 0 }, 403);
  await refuse(S, 'PUT', `/chambres/${l.chambre_id}/precautions`, { precautions: ['contact'], version: 99 }, 409);
  await refuse(A, 'GET', `/nettoyage/configuration?etablissement_id=${E}`, null, 403);
  await refuse(A, 'POST', '/nettoyage/protocoles', { etablissement_id: E }, 403);

  // 3. Précautions sans protocole validé : bloqué, superviseur averti, remise en service impossible
  await poser(l.chambre_id, ['contact']);
  f = await dans(A, l.id); assert.deepStrictEqual([f.autorisee, f.blocages], [false, ['protocole_absent']]);
  await refuse(A, 'POST', `/nettoyage/${l.id}/debut`, null, 409, 'nettoyage_bloque');
  assert.ok((await q(`SELECT 1 FROM notifications WHERE etablissement_id = $1 AND code = 'nettoyage_bloque'`, [E])).length, 'superviseur averti');
  await refuse(A, 'POST', `/lits/${l.id}/action`, { action: 'nettoyage_ok', version: l.version }, 409, 'controle_nettoyage_requis');

  // 4. Protocole : agent non formé, puis habilitation expirée, puis équipement indisponible
  const proto = await api(S, 'POST', '/nettoyage/protocoles', { etablissement_id: E, nom: 'Contact, terminal (fictif)', type_intervention: 'terminal', precautions: ['contact'], formations: ['precautions_contact'], epi: ['gants', 'blouse'], instructions: 'Consignes fictives', controle_requis: true });
  await refuse(S, 'POST', '/nettoyage/protocoles', { etablissement_id: E, nom: 'x', type_intervention: 'terminal', precautions: ['acces_interdit'] }, 400, 'protocole_invalide');
  f = await dans(A, l.id); assert.ok(f.blocages.includes('formation_manquante:precautions_contact') && f.blocages.includes('epi_indisponible:gants'));
  await refuse(A, 'POST', `/nettoyage/${l.id}/debut`, null, 409, 'nettoyage_bloque');
  await api(S, 'PUT', '/nettoyage/formations', { etablissement_id: E, utilisateur_id: agentId, formation: 'precautions_contact', expire_le: new Date(Date.now() - 86400000).toISOString() });
  f = await dans(A, l.id); assert.ok(f.blocages.includes('habilitation_expiree:precautions_contact'));
  await api(S, 'PUT', '/nettoyage/formations', { etablissement_id: E, utilisateur_id: agentId, formation: 'precautions_contact', expire_le: new Date(Date.now() + 86400000 * 30).toISOString() });
  f = await dans(A, l.id); assert.deepStrictEqual(f.blocages, ['epi_indisponible:gants', 'epi_indisponible:blouse']);
  await api(S, 'PUT', '/nettoyage/epi', { etablissement_id: E, epi: 'gants', disponible: true });
  await api(S, 'PUT', '/nettoyage/epi', { etablissement_id: E, epi: 'blouse', disponible: true });
  f = await dans(A, l.id); assert.deepStrictEqual([f.autorisee, f.blocages], [true, []]);

  // 5. Ce que voit l'agent : consignes, jamais de patient ni de diagnostic
  const brut = JSON.stringify(f);
  assert.ok(brut.includes('Consignes fictives') && !/patient_ref|resident|diagnostic|symptome|pathologie/i.test(brut));

  // 6. Terminer sans avoir commencé refusé ; intervention ; pas de remise en service par l'agent
  await refuse(A, 'POST', `/nettoyage/${l.id}/terminer`, null, 409, 'intervention_non_commencee');
  const deux = await Promise.all([appel(A, 'POST', `/nettoyage/${l.id}/debut`), appel(A, 'POST', `/nettoyage/${l.id}/debut`)]);
  assert.deepStrictEqual(deux.map((x) => x.statut).sort(), [200, 409], 'une seule intervention ouverte');
  await refuse(A, 'POST', `/nettoyage/${l.id}/valider`, null, 403, 'role_entretien');
  await refuse(S, 'POST', `/nettoyage/${l.id}/valider`, null, 409, 'controle_impossible');
  const ter = await api(A, 'POST', `/nettoyage/${l.id}/terminer`); assert.strictEqual(ter.statut, 'controle_requis');
  assert.strictEqual((await q('SELECT etat FROM lits WHERE id = $1', [l.id]))[0].etat, 'nettoyage', 'la fin de l’agent ne rend pas la chambre attribuable');
  await refuse(A, 'POST', `/lits/${l.id}/action`, { action: 'nettoyage_ok', version: (await q('SELECT version FROM lits WHERE id = $1', [l.id]))[0].version }, 409, 'controle_nettoyage_requis');
  await refuse(S, 'POST', `/lits/${l.id}/action`, { action: 'nettoyage_ok', version: (await q('SELECT version FROM lits WHERE id = $1', [l.id]))[0].version }, 409, 'controle_nettoyage_requis');
  assert.ok((await api(S, 'GET', `/nettoyage/controles?etablissement_id=${E}`)).some((x) => x.lit_id === l.id));

  // 7. Précautions modifiées pendant le contrôle : validation refusée, reprise obligatoire
  await poser(l.chambre_id, ['contact', 'gouttelettes']);
  assert.ok((await q(`SELECT 1 FROM notifications WHERE etablissement_id = $1 AND code = 'nettoyage_precautions_modifiees'`, [E])).length);
  await refuse(S, 'POST', `/nettoyage/${l.id}/valider`, null, 409, 'precautions_modifiees');
  await api(S, 'POST', `/nettoyage/${l.id}/reprendre`);
  f = await dans(A, l.id); assert.deepStrictEqual(f.blocages, ['protocole_absent'], 'le protocole ne couvre plus les précautions');
  await poser(l.chambre_id, ['contact']);

  // 8. Délai du protocole, puis validation : lit libre, précautions toujours en place, traçabilité
  await api(A, 'POST', `/nettoyage/${l.id}/debut`);
  await poolPilote.query('UPDATE nettoyage_protocoles SET delai_min = 30 WHERE id = $1', [proto.id]);
  await api(A, 'POST', `/nettoyage/${l.id}/terminer`);
  await refuse(S, 'POST', `/nettoyage/${l.id}/valider`, null, 409, 'delai_non_ecoule');
  await poolPilote.query(`UPDATE nettoyage_interventions SET fin_le = now() - interval '31 minutes' WHERE lit_id = $1 AND statut = 'controle_requis'`, [l.id]);
  const val = await api(S, 'POST', `/nettoyage/${l.id}/valider`);
  await poolPilote.query('UPDATE nettoyage_protocoles SET delai_min = 0 WHERE id = $1', [proto.id]);
  assert.strictEqual(val.statut, 'validee');
  assert.strictEqual((await q('SELECT etat FROM lits WHERE id = $1', [l.id]))[0].etat, 'libre');
  assert.deepStrictEqual((await chambre(l.chambre_id)).precautions, ['contact'], 'le nettoyage ne lève jamais les précautions');
  const trace = (await q(`SELECT i.agent_id, i.controle_par, i.debut_le, i.fin_le, i.controle_le FROM nettoyage_interventions i WHERE lit_id = $1 AND statut = 'validee'`, [l.id]))[0];
  assert.ok(trace.agent_id === agentId && trace.controle_par && trace.debut_le && trace.fin_le && trace.controle_le);
  const actions = (await q('SELECT action FROM journal WHERE lit_id = $1', [l.id])).map((x) => x.action);
  assert.ok(['Précautions de la chambre modifiées', 'Nettoyage commencé', 'Nettoyage terminé', 'Nettoyage validé'].every((a) => actions.includes(a)), actions.join(', '));
  assert.ok((await api(S, 'GET', `/chambres/${l.chambre_id}/precautions/historique`)).length >= 3);

  // 9. Accès interdit : ni intervention, ni attribution, ni validation
  await poser(l.chambre_id, ['acces_interdit']);
  const litv = (await q('SELECT version FROM lits WHERE id = $1', [l.id]))[0].version;
  const ex = await appel(S, 'POST', `/lits/${l.id}/action`, { action: 'reserver', version: litv, patient_ref: 'R-99999' });
  assert.strictEqual(ex.statut, 409); assert.strictEqual(ex.corps.code, 'chambre_acces_restreint');
  await poser(l.chambre_id, []);

  // 10. Place conservée : la tâche d'entretien passe par les mêmes contrôles et la place reste à son résident
  const [occ] = await q(`SELECT l.id, l.chambre_id, l.etat FROM lits l JOIN residents r ON r.lit_id = l.id WHERE r.etablissement_id = $1 AND r.statut = 'present' AND l.etat = 'occupe' ORDER BY l.id LIMIT 1`, [E]);
  for (const ta of (await api(S, 'GET', `/chsld/taches?etablissement_id=${E}`)).filter((y) => y.lit_id === occ.id)) await api(S, 'POST', `/chsld/taches/${ta.id}/statut`, { statut: 'faite', version: ta.version });
  await poser(occ.chambre_id, ['contact']);
  const tache = await api(S, 'POST', '/chsld/taches', { etablissement_id: E, type: 'entretien', titre: 'Entretien fictif', lit_id: occ.id, assigne_role: 'entretien' });
  const vueAgent = (await api(A, 'GET', `/chsld/taches?etablissement_id=${E}`)).find((x) => x.id === tache.id);
  assert.ok(vueAgent.consignes.precautions.includes('contact')); assert.strictEqual(vueAgent.resident_ref, null);
  await refuse(A, 'POST', `/chsld/taches/${tache.id}/statut`, { statut: 'faite', version: tache.version }, 409, 'intervention_non_commencee');
  const t1 = await api(A, 'POST', `/chsld/taches/${tache.id}/statut`, { statut: 'en_cours', version: tache.version });
  await api(A, 'POST', `/chsld/taches/${tache.id}/statut`, { statut: 'faite', version: t1.version });
  assert.strictEqual((await q('SELECT entretien_statut FROM lits WHERE id = $1', [occ.id]))[0].entretien_statut, 'en_cours', 'pas propre avant le contrôle');
  await api(S, 'POST', `/nettoyage/${occ.id}/valider`);
  const finie = (await q('SELECT etat, entretien_statut FROM lits WHERE id = $1', [occ.id]))[0];
  assert.deepStrictEqual([finie.etat, finie.entretien_statut], ['occupe', 'propre'], 'propre sans changer l’occupation');
  await poser(occ.chambre_id, []);
});

test('évaluations fictives : démo seulement, droits, transmission à l’hôpital, chambres compatibles, entretien et OG sans accès', { timeout: 120000 }, async () => {
  const avant = process.env.ARRIMO_ENV; const E = ids.era; const SECRET = 'Pathologie fictive XQZ'; const SYM = 'Symptome fictif XQZ';
  const q = (sql, v) => poolPilote.query(sql, v).then((r) => r.rows);
  const x = await residentPresent('era', E, [p.dupont]);
  const corps = { etablissement_id: E, reference: x.reference, pathologies: SECRET, symptomes: SYM, precautions: ['contact'], besoins: 'Accompagnement fictif' };
  // Refusé hors démonstration, à chaque point d'entrée
  for (const e of ['pilote', 'recette', 'validation', 'production']) {
    process.env.ARRIMO_ENV = e;
    await refuse('era', 'POST', '/evaluations-fictives', corps, 403, 'clinique_demo_seulement');
    await refuse('era', 'GET', `/evaluations-fictives?etablissement_id=${E}&reference=${x.reference}`, null, 403, 'clinique_demo_seulement');
  }
  process.env.ARRIMO_ENV = 'demo';
  let co; let ev; let ch;
  try {
    // Droits et validation
    await refuse('era', 'POST', '/evaluations-fictives', corps, 409, 'clinique_inactive');
    await refuse('era_entretien', 'PUT', '/evaluations-fictives/activation', { etablissement_id: E, actif: true }, 403);
    await api('era', 'PUT', '/evaluations-fictives/activation', { etablissement_id: E, actif: true });
    await refuse('era_entretien', 'POST', '/evaluations-fictives', corps, 403);
    await refuse('era_direction', 'POST', '/evaluations-fictives', corps, 403);
    await refuse('stl', 'POST', '/evaluations-fictives', corps, 403);
    await refuse('era', 'POST', '/evaluations-fictives', { etablissement_id: E, reference: 'R-99999', pathologies: 'x' }, 404, 'reference_introuvable');
    await refuse('era', 'POST', '/evaluations-fictives', { etablissement_id: E, reference: x.reference }, 400, 'evaluation_invalide');
    await refuse('era', 'POST', '/evaluations-fictives', { ...corps, precautions: ['grippe'] }, 400, 'evaluation_invalide');
    ev = await api('era', 'POST', '/evaluations-fictives', corps);
    assert.strictEqual(ev.statut, 'a_valider'); assert.ok(ev.pathologies !== ev.symptomes, 'diagnostics et symptômes distincts');
    const version = async () => (await api('era', 'GET', `/chsld/residents/${x.id}`)).resident.version;
    await refuse('era', 'POST', `/chsld/residents/${x.id}/hospitalisation`, { hopital_id: L.B, identite_verifiee: true, version: await version(), evaluation_id: ev.id }, 409, 'evaluation_non_transmissible');
    await api('era', 'POST', `/evaluations-fictives/${ev.id}/valider`);
    await refuse('era', 'POST', `/evaluations-fictives/${ev.id}/valider`, null, 409, 'evaluation_deja_validee');
    // Transmission : ni ressaisie, ni fuite dans les listes, les notifications ou le journal
    co = await api('era', 'POST', `/chsld/residents/${x.id}/hospitalisation`, { hopital_id: L.B, identite_verifiee: true, version: await version(), evaluation_id: ev.id });
    await refuse('a', 'GET', `/coordinations/${co.id}/evaluation?etablissement_id=${L.A}`, null, 404);
    const lue = await api('b', 'GET', `/coordinations/${co.id}/evaluation?etablissement_id=${L.B}`);
    assert.strictEqual(lue.pathologies, SECRET); assert.strictEqual(lue.symptomes, SYM);
    assert.ok((await q(`SELECT 1 FROM evaluations_fictives_acces WHERE evaluation_id = $1 AND action LIKE 'consultation_transmise%'`, [ev.id])).length, 'consultation tracée');
    assert.ok((await api('b', 'GET', `/coordinations?etablissement_id=${L.B}`)).find((c) => c.id === co.id).evaluation_transmise);
    const fuites = JSON.stringify([await api('b', 'GET', `/liaison-chsld?etablissement_id=${L.B}`), await q(`SELECT message, vars FROM notifications ORDER BY id DESC LIMIT 200`), await q(`SELECT action, detail FROM journal ORDER BY id DESC LIMIT 200`), await q(`SELECT action, cible, detail FROM journal_admin ORDER BY id DESC LIMIT 200`), await api('era_entretien', 'GET', `/chsld/taches?etablissement_id=${E}`), await api('era_entretien', 'GET', `/nettoyage?etablissement_id=${E}`)]);
    assert.ok(!fuites.includes('XQZ'), 'aucun texte clinique ailleurs');
    // OG n'y a pas accès et ne pose aucun diagnostic
    for (const [qui, etab] of [['era', E], ['b', L.B]]) for (const question of [`Quel est le diagnostic de ${x.reference} ?`, `Quelle chambre pour ${x.reference} selon sa pathologie ?`]) {
      const r = await api(qui, 'POST', '/copilote/question', { etablissement_id: etab, question, langue: 'fr' });
      assert.ok(!JSON.stringify(r).includes('XQZ'), question);
    }
    // Arrivée puis chambres : le tri informe, il ne choisit pas
    let c2 = await api('b', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.B, action: 'accepter', version: co.version });
    c2 = await api('era', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: E, action: 'confirmer_depart', version: c2.version });
    c2 = await api('b', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.B, action: 'confirmer_reception', version: c2.version });
    const servi = async () => { const h = await api('b', 'GET', `/liaison-chsld/${co.id}/emplacements?etablissement_id=${L.B}`); for (const s of h.services) { const e = await api('b', 'GET', `/liaison-chsld/${co.id}/emplacements?etablissement_id=${L.B}&type_id=${s.id}`); if (e.lits.length > 1) return e; } return h; };
    let em = await servi();
    assert.ok(em.lits.length > 1); assert.ok(em.lits.every((l) => l.compatibilite === 'a_verifier' && l.justification === 'precautions_a_confirmer'), 'prescrites mais chambre non confirmée : à vérifier');
    const [l1, l2] = em.lits;
    const chs = await api('b', 'GET', `/chambres/precautions?etablissement_id=${L.B}`);
    ch = chs.find((c) => c.numero === l1.chambre && c.unite === l1.unite);
    await api('b', 'PUT', `/chambres/${ch.id}/precautions`, { precautions: ['contact'], version: ch.version });
    em = await api('b', 'GET', `/liaison-chsld/${co.id}/emplacements?etablissement_id=${L.B}&type_id=${em.type_id}`);
    assert.strictEqual(em.lits.find((l) => l.id === l1.id).justification, 'chambre_sous_precautions');
    const v2 = (await api('b', 'GET', `/chambres/precautions?etablissement_id=${L.B}`)).find((c) => c.id === ch.id).version;
    await api('b', 'PUT', `/chambres/${ch.id}/precautions`, { precautions: ['acces_interdit'], version: v2 });
    em = await api('b', 'GET', `/liaison-chsld/${co.id}/emplacements?etablissement_id=${L.B}&type_id=${em.type_id}`);
    assert.ok(!em.lits.some((l) => l.id === l1.id)); assert.strictEqual(em.indisponibles.find((l) => l.id === l1.id).justification, 'acces_restreint');
    await refuse('b', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.B, action: 'orienter', orientation: 'admission', patient_ref: 'P-71301', type_id: em.type_id, lit_id: l1.id, version_lit: l1.version, version: c2.version }, 409, 'chambre_acces_restreint');
    assert.strictEqual((await q('SELECT orientation FROM coordinations WHERE id = $1', [co.id]))[0].orientation, null, 'aucune décision automatique');
    const v3 = (await api('b', 'GET', `/chambres/precautions?etablissement_id=${L.B}`)).find((c) => c.id === ch.id).version;
    await api('b', 'PUT', `/chambres/${ch.id}/precautions`, { precautions: [], version: v3 });
    // Hors démo : la transmission reste illisible et les précautions fictives ne servent plus au tri
    process.env.ARRIMO_ENV = 'pilote';
    await refuse('b', 'GET', `/coordinations/${co.id}/evaluation?etablissement_id=${L.B}`, null, 403, 'clinique_demo_seulement');
    assert.ok((await api('b', 'GET', `/liaison-chsld/${co.id}/emplacements?etablissement_id=${L.B}&type_id=${em.type_id}`)).lits.every((l) => l.compatibilite === 'compatible' || l.justification === 'chambre_sous_precautions'));
    await refuse('era', 'POST', `/chsld/residents/${x.id}/hospitalisation`, { hopital_id: L.A, identite_verifiee: true, version: 1, evaluation_id: ev.id }, 409);
    void l2;
  } finally {
    process.env.ARRIMO_ENV = avant;
    // Fin du parcours pour ne pas gêner les tests suivants
    if (co) { const f = (await q('SELECT version FROM coordinations WHERE id = $1', [co.id]))[0]; let r = await api('b', 'POST', `/coordinations/${co.id}/retour`, { retour_prevu_le: new Date(Date.now() + 3600000).toISOString() }); void f; await reintegrerApres(r, x); }
  }
});

test('registre, import vérifié, tableau de bord, visites, activités, OG : droits, erreurs, isolation', { timeout: 120000 }, async () => {
  const E = ids.era;
  // Saisie structurée
  await refuse('era', 'POST', '/evenements', { etablissement_id: E, type: 'x', contenu: 'a' }, 400, 'evenement_invalide');
  await refuse('stl', 'POST', '/evenements', { etablissement_id: E, type: 'information', contenu: 'a' }, 403);
  await refuse('era_entretien', 'GET', `/evenements?etablissement_id=${E}`, null, 403);
  const ev = await api('era', 'POST', '/evenements', { etablissement_id: E, type: 'communication', reference: 'R-00001', contenu: 'Appel fictif reçu' });
  await refuse('era', 'POST', `/evenements/${ev.id}/statut`, { statut: 'traite', version: 99 }, 409);
  const ev2 = await api('era', 'POST', `/evenements/${ev.id}/statut`, { statut: 'traite', version: ev.version });
  await refuse('era', 'POST', `/evenements/${ev.id}/statut`, { statut: 'annule', version: ev2.version }, 409, 'evenement_clos');
  const lu = (await api('era', 'GET', `/evenements?etablissement_id=${E}`)).find((x) => x.id === ev.id);
  assert.deepStrictEqual(lu.historique.map((h) => h.statut), ['ouvert', 'traite']); assert.ok(lu.auteur_nom);
  // Import : documents erronés refusés, rien sans vérification ni confirmation
  const combien = async () => (await api('era', 'GET', `/evenements?etablissement_id=${E}`)).length;
  const avant = await combien();
  await refuse('era', 'POST', '/evenements/import/verifier', { etablissement_id: E, contenu: '%PDF-1.7 fictif' }, 400, 'import_format');
  await refuse('era', 'POST', '/evenements/import/verifier', { etablissement_id: E, contenu: 'a;b\n1;2' }, 400, 'import_entete');
  await refuse('era', 'POST', '/evenements/import/verifier', { etablissement_id: E, contenu: '' }, 400, 'import_invalide');
  const mauvais = 'type;reference;contenu\ninformation;R-1;Bon\nmauvais;R-2;Non\n';
  const vm = await api('era', 'POST', '/evenements/import/verifier', { etablissement_id: E, contenu: mauvais });
  assert.deepStrictEqual(vm.erreurs, [{ ligne: 3, code: 'ligne_invalide' }]);
  await refuse('era', 'POST', '/evenements/import', { etablissement_id: E, contenu: mauvais, empreinte: vm.empreinte, confirme: true }, 409, 'import_erreurs');
  const bon = 'type;reference;contenu\ninformation;R-1;<script>alert(1)</script>\nabsence;;Sortie fictive\n';
  const vb = await api('era', 'POST', '/evenements/import/verifier', { etablissement_id: E, contenu: bon });
  await refuse('era', 'POST', '/evenements/import', { etablissement_id: E, contenu: bon, empreinte: vb.empreinte }, 400, 'import_a_confirmer');
  await refuse('era', 'POST', '/evenements/import', { etablissement_id: E, contenu: `${bon}information;;ajout\n`, empreinte: vb.empreinte, confirme: true }, 409, 'import_modifie');
  assert.strictEqual(await combien(), avant, 'rien d’écrit avant la confirmation');
  assert.strictEqual((await api('era', 'POST', '/evenements/import', { etablissement_id: E, contenu: bon, empreinte: vb.empreinte, confirme: true })).importes, 2);
  assert.strictEqual(await combien(), avant + 2);
  // Tableau de bord
  const a = await api('era', 'GET', `/chsld/accueil?etablissement_id=${E}`);
  assert.ok(Number.isInteger(a.entretien.a_nettoyer) && Number.isInteger(a.entretien.termines_jour) && Number.isInteger(a.familles.messages) && Number.isInteger(a.familles.visites) && Number.isInteger(a.places.libres));
  // Activités et droits
  await refuse('era_entretien', 'POST', '/chsld/activites', { etablissement_id: E, titre: 'x', debut_le: new Date().toISOString() }, 403);
  await refuse('stl', 'GET', `/chsld/visites?etablissement_id=${E}`, null, 403);
  const acti = await api('era', 'POST', '/chsld/activites', { etablissement_id: E, titre: 'Atelier fictif', debut_le: new Date(Date.now() + 86400000).toISOString() });
  assert.ok(acti.id);
  // OG : mêmes droits, aucune action sans confirmation
  for (const q of ['Quels résidents sont actuellement hospitalisés ?', 'Quels retours attendent une confirmation ?', 'Quelles chambres doivent être nettoyées ?']) {
    const r = await api('era', 'POST', '/copilote/question', { etablissement_id: E, question: q, langue: 'fr' });
    assert.ok(r.reponse && !/Je ne (sais|comprends)/i.test(r.reponse), `${q} → ${r.reponse}`);
  }
  const transfert = (await poolPilote.query(`SELECT numero, origine_id, destination_id FROM coordinations WHERE type = 'transfert_hopital' AND statut = 'recue' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.ok(transfert);
  const qui = transfert.destination_id === L.A ? 'a' : transfert.destination_id === L.B ? 'b' : null;
  if (qui) { const r = await api(qui, 'POST', '/copilote/question', { etablissement_id: transfert.destination_id, question: `Quel est le statut du transfert ${transfert.numero} ?`, langue: 'fr' }); assert.match(r.reponse, new RegExp(transfert.numero)); }
});

test('captures : formulaire SH (type puis modules), liste SH, écrans CHSLD réels', { timeout: 180000 }, async () => {
  const { chromium } = require('playwright'); const dossier = path.resolve('.local/captures-chsld'); fs.mkdirSync(dossier, { recursive: true });
  const navigateur = await chromium.launch(); const erreurs = [];
  try {
    // Console SH : session de l'administration (jeton déjà ouvert), formulaire de création
    const ctxSh = await navigateur.newContext({ viewport: { width: 1366, height: 1000 } }); const s = await ctxSh.newPage(); s.on('pageerror', (e) => erreurs.push(`SH ${e}`));
    await s.addInitScript((j) => sessionStorage.setItem('sh-token', j), jetonSh);
    await s.goto(baseSh); await s.waitForSelector('#b-nouveau');
    await s.screenshot({ path: `${dossier}/sh-liste-etablissements.png` });
    await s.click('#b-nouveau'); await s.waitForSelector('#h-modules [data-module]');
    await s.selectOption('#h-type', 'chsld'); await s.waitForSelector('#h-modules [data-module="residents"]');
    await s.screenshot({ path: `${dossier}/sh-formulaire-chsld.png`, fullPage: true });
    assert.strictEqual(await s.locator('#h-type option[value="rpa"]').isDisabled(), true, 'RPA non sélectionnable');
    assert.strictEqual(await s.locator('#h-modules [data-module="appels_video"]').isDisabled(), true, 'appels vidéo (à l’étude) non cochables');
    assert.strictEqual(await s.locator('#h-modules [data-module="portail_proches"]').isChecked(), false, 'portail des proches : optionnel, non coché d’office');
    assert.strictEqual(await s.locator('#h-modules [data-module="og"]').isDisabled(), true, 'module commun inclus');
    await s.selectOption('#h-type', 'hopital'); await s.waitForSelector('#h-modules [data-module="civieres"]');
    await s.screenshot({ path: `${dossier}/sh-formulaire-hopital.png`, fullPage: true });
    await ctxSh.close();
    // Arrimo CHSLD : accueil, fiche résident, chambres (ordinateur), accueil (téléphone)
    for (const [nom, vp] of [['ordinateur', { width: 1440, height: 1000 }], ['telephone', { width: 390, height: 844 }]]) {
      const ctx = await navigateur.newContext({ viewport: vp }); const pg = await ctx.newPage(); pg.on('pageerror', (e) => erreurs.push(`${nom} ${e}`));
      await pg.addInitScript(({ jeton, id }) => { localStorage.setItem('arrimo-token', jeton); localStorage.setItem('arrimo-ctx', String(id)); localStorage.setItem('arrimo-langue', 'fr'); }, { jeton: sessions.era, id: ids.era });
      await pg.goto(basePilote); await pg.waitForSelector('body[data-pret="1"]');
      if (await pg.locator('#b-premiers-pas-ok').isVisible().catch(() => false)) await pg.click('#b-premiers-pas-ok');
      await pg.waitForSelector('#v-c-accueil .ch-kpis');
      assert.strictEqual(await pg.locator('#onglets button[data-v="urgence"]').isHidden(), true, 'aucun onglet d’urgence en CHSLD');
      await pg.screenshot({ path: `${dossier}/chsld-accueil-${nom}.png`, fullPage: nom === 'ordinateur' });
      if (nom === 'ordinateur') {
        await pg.click('#onglets button[data-v="c-residents"]'); await pg.waitForSelector('#v-c-residents table');
        await pg.fill('#ch-q', 'Dupont'); await pg.waitForFunction(() => document.querySelectorAll('#v-c-residents tbody tr').length === 1);
        await pg.click('#v-c-residents [data-res]'); await pg.waitForSelector('#v-c-residents .ch-contact-item');
        await pg.screenshot({ path: `${dossier}/chsld-fiche-resident.png`, fullPage: true });
        await pg.click('#onglets button[data-v="c-chambres"]'); await pg.waitForSelector('#v-c-chambres .ch-place');
        await pg.screenshot({ path: `${dossier}/chsld-chambres.png` });
        await pg.click('#onglets button[data-v="c-mouvements"]'); await pg.waitForSelector('#v-c-mouvements .panneau-c');
        await pg.screenshot({ path: `${dossier}/chsld-transferts-hospitalisations.png`, fullPage: true });
      }
      await ctx.close();
    }
    // Module Liaison CHSLD dans les hôpitaux A, B et C : une demande transmise à B et à C pour l'illustration (données fictives)
    for (const h of [L.B, L.C]) {
      const r = await residentPresent('era', ids.era, [p.dupont]);
      await api('era', 'POST', `/chsld/residents/${r.id}/hospitalisation`, { hopital_id: h, identite_verifiee: true, version: r.version, motif_admin: 'Consultation prévue' });
    }
    for (const [qui, id, lettre] of [['a', L.A, 'A'], ['b', L.B, 'B'], ['c', L.C, 'C']]) {
      for (const [nom, vp] of [['ordinateur', { width: 1440, height: 1000 }], ...(lettre === 'B' ? [['telephone', { width: 390, height: 844 }]] : [])]) {
        const ctx = await navigateur.newContext({ viewport: vp }); const pg = await ctx.newPage(); pg.on('pageerror', (e) => erreurs.push(`liaison ${lettre} ${e}`));
        await pg.addInitScript(({ jeton, id: e }) => { localStorage.setItem('arrimo-token', jeton); localStorage.setItem('arrimo-ctx', String(e)); localStorage.setItem('arrimo-langue', 'fr'); }, { jeton: sessions[qui], id });
        await pg.goto(basePilote); await pg.waitForSelector('body[data-pret="1"]');
        if (await pg.locator('#b-premiers-pas-ok').isVisible().catch(() => false)) await pg.click('#b-premiers-pas-ok');
        if (nom === 'telephone' && await pg.locator('#b-nav').isVisible()) await pg.click('#b-nav');
        await pg.click('#onglets button[data-v="liaison"]'); await pg.waitForSelector('#v-liaison .li-onglets');
        if (lettre === 'A') { await pg.click('#v-liaison [data-li-onglet="historique"]'); await pg.waitForSelector('#v-liaison [data-li-onglet="historique"][aria-selected="true"]'); }
        else assert.ok(await pg.locator('#v-liaison .li-carte').count() >= 1, `demande visible dans l’Hôpital ${lettre}`);
        assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `pas de défilement horizontal (${lettre}, ${nom})`);
        await pg.screenshot({ path: `${dossier}/liaison-chsld-hopital-${lettre}-${nom}.png`, fullPage: true });
        if (lettre === 'B' && nom === 'ordinateur') {
          // Le panneau CHSLD ne figure plus dans les transferts interhospitaliers
          await pg.click('#onglets button[data-v="transferts"]'); await pg.waitForSelector('#v-transferts .kanban');
          assert.strictEqual(await pg.locator('#v-transferts .ch-hopital, #v-transferts .li-carte').count(), 0, 'transferts sans résidents de CHSLD');
        }
        await ctx.close();
      }
    }
    const ctxP = await navigateur.newContext({ viewport: { width: 390, height: 844 } }); const pp = await ctxP.newPage(); pp.on('pageerror', (e) => erreurs.push(`portail ${e}`));
    await pp.addInitScript((j) => sessionStorage.setItem('arrimo-proche', j), sessions.marie);
    await pp.goto(`${basePilote}/proches`); await pp.waitForSelector('#txt');
    await pp.screenshot({ path: `${dossier}/portail-proches-telephone.png`, fullPage: true });
    await ctxP.close();
  } finally { await navigateur.close(); }
  assert.deepStrictEqual(erreurs, []);
  RESULTATS.captures = fs.readdirSync(path.resolve('.local/captures-chsld'));
});

test('interface réelle : parcours CHSLD A → Hôpital B → CHSLD A dans le navigateur, sans appel direct pour les actions du personnel', { timeout: 240000 }, async () => {
  const { chromium } = require('playwright'); const dossier = path.resolve('.local/captures-chsld'); fs.mkdirSync(dossier, { recursive: true });
  const navigateur = await chromium.launch(); const erreurs = [];
  const ouvrir = async (qui, etab, vp = { width: 1440, height: 1000 }) => {
    const ctx = await navigateur.newContext({ viewport: vp }); const pg = await ctx.newPage(); pg.on('pageerror', (e) => erreurs.push(`${qui} ${e}`));
    await pg.addInitScript(({ jeton, id }) => { localStorage.setItem('arrimo-token', jeton); localStorage.setItem('arrimo-ctx', String(id)); localStorage.setItem('arrimo-langue', 'fr'); }, { jeton: sessions[qui], id: etab });
    await pg.goto(basePilote); await pg.waitForSelector('body[data-pret="1"]');
    if (await pg.locator('#b-premiers-pas-ok').isVisible().catch(() => false)) await pg.click('#b-premiers-pas-ok');
    return pg;
  };
  const confirmer = async (pg) => { await pg.click('#modale button.pri'); await pg.waitForFunction(() => !document.querySelector('#modale')?.open && document.querySelector('#modale')?.hidden !== false || !document.querySelector('#modale button.pri')); };
  const onglet = async (pg, v, sel) => { await pg.click(`#onglets button[data-v="${v}"]`); await pg.waitForSelector(sel); };
  try {
    const x = await residentPresent('era', ids.era, [p.dupont]);
    const era = await ouvrir('era', ids.era); const b = await ouvrir('b', L.B);
    // Départ : formulaire de préparation
    await onglet(era, 'c-residents', '#v-c-residents table');
    await era.fill('#ch-q', x.reference); await era.waitForFunction(() => document.querySelectorAll('#v-c-residents tbody tr').length === 1);
    await era.click('#v-c-residents [data-res]'); await era.click('[data-ch-action="hospitalisation"]');
    await era.waitForSelector('#co-urgence');
    await era.selectOption('#co-dest', String(L.B)); await era.fill('#co-motif', 'Consultation planifiée');
    await era.selectOption('#co-urgence', 'immediate'); await era.selectOption('#co-transport', 'ambulance'); await era.check('#co-accompagnateur'); await era.check('#co-id');
    await era.screenshot({ path: `${dossier}/parcours-1-formulaire-depart.png`, fullPage: true });
    await confirmer(era);
    const co0 = (await api('era', 'GET', `/coordinations?etablissement_id=${ids.era}`)).find((c) => c.resident_ref === x.reference && c.type === 'hospitalisation' && c.statut === 'envoyee');
    assert.ok(co0, 'demande créée par le formulaire'); assert.strictEqual(co0.urgence_declaree, 'immediate');
    // Hôpital : renseignements lus sans ressaisie, acceptation
    await onglet(b, 'liaison', `#v-liaison [data-coordination="${co0.id}"]`);
    assert.match(await b.locator(`#v-liaison [data-coordination="${co0.id}"]`).innerText(), /Immédiate[\s\S]*Ambulance/);
    await b.click(`[data-li="accepter"][data-id="${co0.id}"]`); await b.waitForSelector(`#v-liaison [data-coordination="${co0.id}"] .ch-chrono li.fait:nth-child(3)`);
    await onglet(era, 'c-mouvements', `[data-co="confirmer_depart"][data-id="${co0.id}"]`);
    await era.click(`[data-co="confirmer_depart"][data-id="${co0.id}"]`); await era.waitForSelector(`[data-co="confirmer_depart"][data-id="${co0.id}"]`, { state: 'detached' });
    // Arrivée, puis « Orienter / admettre le patient » : lit libre et compatible
    await b.click('[data-li-onglet="a_accueillir"]'); await b.waitForSelector(`[data-li="confirmer_reception"][data-id="${co0.id}"]`);
    await b.click(`[data-li="confirmer_reception"][data-id="${co0.id}"]`); await b.waitForSelector(`[data-li="orienter"][data-id="${co0.id}"]`);
    assert.match(await b.locator(`[data-li="orienter"][data-id="${co0.id}"]`).innerText(), /Orienter \/ admettre le patient/);
    await b.click(`[data-li="orienter"][data-id="${co0.id}"]`); await b.waitForSelector('#li-ref');
    await b.fill('#li-ref', 'P-75001');
    const emB = await api('b', 'GET', `/liaison-chsld/${co0.id}/emplacements?etablissement_id=${L.B}`);
    const avecLit = []; for (const sv of emB.services) { const e2 = await api('b', 'GET', `/liaison-chsld/${co0.id}/emplacements?etablissement_id=${L.B}&type_id=${sv.id}`); if (e2.lits.length) avecLit.push([sv, e2.lits[0]]); }
    assert.ok(avecLit.length, 'au moins un lit libre et compatible à l’Hôpital B');
    await b.selectOption('#li-type', String(avecLit[0][0].id)); await b.waitForSelector(`#li-lit option[value="${avecLit[0][1].id}"]`, { state: 'attached' });
    assert.strictEqual(await b.locator('#li-lit option').count() - 1, (await api('b', 'GET', `/liaison-chsld/${co0.id}/emplacements?etablissement_id=${L.B}&type_id=${avecLit[0][0].id}`)).lits.length, 'seuls les lits libres et compatibles');
    await b.selectOption('#li-lit', String(avecLit[0][1].id));
    await b.screenshot({ path: `${dossier}/parcours-2-orienter-admettre.png`, fullPage: true });
    await confirmer(b);
    await b.click('[data-li-onglet="hospitalisations"]'); await b.waitForSelector(`#v-liaison [data-coordination="${co0.id}"]`);
    assert.ok((await b.locator(`#v-liaison [data-coordination="${co0.id}"]`).innerText()).includes(avecLit[0][1].code), 'le lit attribué est affiché');
    // Retour préparé par l'hôpital : section « Retours en cours »
    await b.click(`[data-li="retour"][data-id="${co0.id}"]`); await b.waitForSelector('#li-date');
    await b.fill('#li-date', new Date(Date.now() + 3600000).toISOString().slice(0, 16)); await confirmer(b);
    await b.click('[data-li-onglet="retours_en_cours"]'); await b.waitForSelector(`#v-liaison [data-coordination="${co0.id}"] .ch-chrono`);
    const ret0 = (await api('b', 'GET', `/coordinations?etablissement_id=${L.B}`)).find((c) => c.liee_id === co0.id);
    // CHSLD : acceptation, préparation par l'entretien dans ses tâches, chambre vérifiée
    await onglet(era, 'c-mouvements', `[data-co="accepter"][data-id="${ret0.id}"]`);
    await era.click(`[data-co="accepter"][data-id="${ret0.id}"]`); await era.waitForSelector(`[data-co="verifier_chambre"][data-id="${ret0.id}"]`);
    const litCode = (await api('era', 'GET', `/coordinations?etablissement_id=${ids.era}`)).find((c) => c.id === ret0.id).reintegration.lit.code;
    const ent = await ouvrir('era_entretien', ids.era);
    await ent.click('#onglets button[data-v="c-taches"]'); await ent.waitForSelector('#v-c-taches');
    assert.strictEqual(await ent.locator('#onglets button[data-v="c-accueil"]').isHidden(), true, 'aucun tableau de bord général pour l’entretien');
    for (const tt of (await api('era_entretien', 'GET', `/chsld/taches?etablissement_id=${ids.era}`)).filter((y) => y.lit === litCode)) await api('era_entretien', 'POST', `/chsld/taches/${tt.id}/statut`, { statut: 'faite', version: tt.version });
    await ent.context().close();
    await onglet(era, 'c-residents', '#v-c-residents'); await onglet(era, 'c-mouvements', `[data-co="verifier_chambre"][data-id="${ret0.id}"]`);
    await era.click(`[data-co="verifier_chambre"][data-id="${ret0.id}"]`); await era.waitForSelector(`[data-co="verifier_chambre"][data-id="${ret0.id}"]`, { state: 'detached' });
    // Hôpital : départ et transport
    await onglet(b, 'transferts', '#v-transferts .kanban'); await onglet(b, 'liaison', `[data-li="confirmer_depart"][data-id="${ret0.id}"]`);
    await b.click(`[data-li="confirmer_depart"][data-id="${ret0.id}"]`); await b.waitForSelector(`[data-li="transport"][data-id="${ret0.id}"]`);
    await b.click(`[data-li="transport"][data-id="${ret0.id}"]`); await b.waitForSelector(`[data-li="transport"][data-id="${ret0.id}"]`, { state: 'detached' });
    // CHSLD : arrivée, puis action explicite « Réintégrer dans sa chambre »
    await onglet(era, 'c-residents', '#v-c-residents'); await onglet(era, 'c-mouvements', `[data-co="confirmer_arrivee"][data-id="${ret0.id}"]`);
    await era.click(`[data-co="confirmer_arrivee"][data-id="${ret0.id}"]`); await era.waitForSelector(`[data-co="reintegrer"][data-id="${ret0.id}"]`);
    assert.match(await era.locator(`[data-co="reintegrer"][data-id="${ret0.id}"]`).innerText(), /Réintégrer dans sa chambre/);
    await era.screenshot({ path: `${dossier}/parcours-3-retour-a-reintegrer.png`, fullPage: true });
    await b.screenshot({ path: `${dossier}/parcours-4-retours-en-cours-hopital.png`, fullPage: true });
    await era.click(`[data-co="reintegrer"][data-id="${ret0.id}"]`); await era.waitForSelector('#ri-id');
    await era.check('#ri-id'); await era.check('#ri-cond'); await confirmer(era);
    await era.waitForSelector(`[data-co="reintegrer"][data-id="${ret0.id}"]`, { state: 'detached' });
    const fin = await api('era', 'GET', `/chsld/residents/${x.id}`);
    assert.strictEqual(fin.resident.statut, 'present'); assert.strictEqual(fin.resident.lit_id, x.lit ? (await poolPilote.query('SELECT id FROM lits WHERE code = $1', [x.lit])).rows[0].id : fin.resident.lit_id, 'même lit');
    const fini = (await api('era', 'GET', `/coordinations?etablissement_id=${ids.era}`)).find((c) => c.id === ret0.id);
    assert.ok(fini.chronologie.every((e) => e.fait), JSON.stringify(fini.chronologie));
    await onglet(b, 'transferts', '#v-transferts .kanban'); await onglet(b, 'liaison', '#v-liaison .li-onglets');
    await b.click('[data-li-onglet="historique"]'); await b.waitForSelector(`#v-liaison [data-coordination="${co0.id}"]`);
    // Téléphone : modules lisibles sans défilement horizontal
    const tel = await ouvrir('b', L.B, { width: 390, height: 844 });
    if (await tel.locator('#b-nav').isVisible()) await tel.click('#b-nav');
    await tel.click('#onglets button[data-v="liaison"]'); await tel.waitForSelector('#v-liaison .li-onglets');
    assert.ok(await tel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'pas de défilement horizontal');
  } finally { await navigateur.close(); }
  assert.deepStrictEqual(erreurs, [], 'aucune erreur JavaScript dans les pages');
});

test('lien SH ↔ environnements : HTTPS obligatoire hors de la machine, clé jamais suivie sur une redirection', async () => {
  const { cibles, appeler } = require('../src/sh/cibles');
  const avec = (url) => cibles({ SH_ENV_PRODUCTION_URL: url, SH_ENV_PRODUCTION_CLE: 'cle-fictive' });
  for (const u of ['http://arrimo.example.invalid', 'http://127.0.0.1.example.invalid', 'http://localhost@example.invalid', 'ftp://example.invalid', 'pas-une-adresse']) {
    assert.throws(() => avec(u), (e) => e.code === 'cible_non_https', u);
  }
  for (const u of ['https://arrimo.example.invalid', 'http://127.0.0.1:3010', 'http://localhost:3010', 'http://[::1]:3010']) assert.strictEqual(avec(u).length, 1, u);
  // Productions par pays : déclarées par réglage, isolées, écriture contrôlée
  const { nomsEnvironnements } = require('../src/sh/cibles');
  const x = { SH_PRODUCTIONS: 'production_xx:Pays X', SH_ENV_PRODUCTION_XX_URL: 'https://x.example.invalid', SH_ENV_PRODUCTION_XX_CLE: 'cle-x', SH_ENV_DEMO_URL: 'http://127.0.0.1:3010', SH_ENV_DEMO_CLE: 'cle-d' };
  assert.deepStrictEqual(cibles(x).map((c) => [c.code, c.nom]), [['demo', 'Démonstration'], ['production_xx', 'Pays X']]);
  for (const v of ['production_xxx:N', 'autre:N', 'production_xx', 'production:N', 'production_XX:N', 'production_xx:N,production_xx:M']) {
    assert.throws(() => nomsEnvironnements({ SH_PRODUCTIONS: v }), (e) => e.code === 'productions_invalides', v);
  }
  assert.throws(() => cibles({ ...x, SH_ENV_PRODUCTION_XX_CLE: 'cle-d' }), (e) => e.code === 'production_non_isolee');
  assert.throws(() => cibles({ ...x, SH_ENV_PRODUCTION_XX_URL: 'http://127.0.0.1:3010', SH_ENV_PRODUCTION_XX_CLE: 'cle-x' }), (e) => e.code === 'production_non_isolee');
  assert.throws(() => cibles({ ...x, SH_ENV_PRODUCTION_XX_URL: 'http://x.example.invalid' }), (e) => e.code === 'cible_non_https');
  const http = require('node:http');
  const recues = [];
  const piege = http.createServer((req, res) => { recues.push(req.headers['x-sh-key']); res.end('{}'); });
  await new Promise((r) => piege.listen(0, '127.0.0.1', r));
  const relais = http.createServer((req, res) => { res.writeHead(307, { Location: `http://127.0.0.1:${piege.address().port}/api/vole` }); res.end(); });
  await new Promise((r) => relais.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(appeler({ nom: 'Essai', url: `http://127.0.0.1:${relais.address().port}`, cle: 'cle-fictive' }, 'GET', '/sante'), (e) => e.code === 'injoignable');
    assert.deepStrictEqual(recues, []);
  } finally { piege.close(); relais.close(); }
});

test('surveillance : une seule alerte par panne, une au rétablissement, adresse jamais dans les arguments', async () => {
  const http = require('node:http'); const { spawn } = require('node:child_process');
  const racine = path.join(__dirname, '..');
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'arrimo-surveillance-'));
  const messages = []; let sain = false;
  const alerte = http.createServer((req, res) => { let c = ''; req.on('data', (d) => { c += d; }); req.on('end', () => { messages.push(JSON.parse(c).text); res.end('ok'); }); });
  const sante = http.createServer((req, res) => { res.statusCode = sain ? 200 : 503; res.end(sain ? '{"etat":"ok"}' : '{"etat":"panne"}'); });
  await Promise.all([alerte, sante].map((x) => new Promise((r) => x.listen(0, '127.0.0.1', r))));
  const passer = (webhook) => new Promise((r) => {
    const p = spawn('bash', [path.join(racine, 'deploy/surveillance.sh')], { env: { PATH: process.env.PATH, ARRIMO_URL_SANTE: `http://127.0.0.1:${sante.address().port}/api/sante`, SURVEILLANCE_NOM: 'essai-surveillance', SURVEILLANCE_ETAT_DIR: dossier, ALERTE_WEBHOOK_URL: webhook } });
    p.on('close', r);
  });
  const url = `http://127.0.0.1:${alerte.address().port}/secret`;
  try {
    assert.strictEqual(await passer(url), 1); assert.strictEqual(await passer(url), 1); assert.strictEqual(await passer(url), 1);
    assert.deepStrictEqual(messages, ['Arrimo essai-surveillance : panne détectée']);
    sain = true;
    assert.strictEqual(await passer(url), 0); assert.strictEqual(await passer(url), 0);
    assert.deepStrictEqual(messages, ['Arrimo essai-surveillance : panne détectée', 'Arrimo essai-surveillance : rétabli']);
    sain = false; messages.length = 0;
    assert.strictEqual(await passer('http://alerte.example.invalid/x'), 1);   // en clair : rien n'est envoyé, la panne reste notée
    assert.deepStrictEqual(messages, []);
    assert.ok(fs.existsSync(path.join(dossier, 'essai-surveillance.echec')));
    const script = fs.readFileSync(path.join(racine, 'deploy/surveillance.sh'), 'utf8');
    assert.match(script, /curl -sS --max-time 10 -o \/dev\/null -K -/); assert.doesNotMatch(script, /curl[^\n]*"\$ALERTE_WEBHOOK_URL"/);
  } finally { alerte.close(); sante.close(); fs.rmSync(dossier, { recursive: true, force: true }); }
});

test('démos sans double authentification : administration directe, activation refusée ; exigée ailleurs', async () => {
  const qui = 'era_direction'; assert.ok(sessions[qui]);
  const avant = { env: process.env.ARRIMO_ENV, demo: process.env.ARRIMO_DEMO, deuxfa: process.env.ARRIMO_2FA_ADMIN };
  const remettre = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  const actif = async () => (await poolPilote.query("SELECT totp_actif, totp_secret FROM utilisateurs WHERE id = (SELECT id FROM utilisateurs WHERE email = $1)", [(await api(qui, 'GET', '/moi')).utilisateur.email])).rows[0];
  try {
    delete process.env.ARRIMO_2FA_ADMIN;
    process.env.ARRIMO_ENV = 'demo';
    assert.strictEqual((await api(qui, 'GET', '/moi')).demo, true);
    await api(qui, 'GET', '/admin/utilisateurs');
    await refuse(qui, 'POST', '/moi/2fa/preparer', {}, 403, 'double_auth_indisponible_demo');
    await refuse(qui, 'POST', '/moi/2fa/activer', { code: '000000' }, 403, 'double_auth_indisponible_demo');
    const d = await actif(); assert.strictEqual(d.totp_actif, false); assert.strictEqual(d.totp_secret, null);
    for (const e of ['recette', 'pilote']) {
      process.env.ARRIMO_ENV = e;
      await refuse(qui, 'GET', '/admin/utilisateurs', undefined, 403, 'admin_exige_2fa');
      assert.strictEqual((await appel(qui, 'POST', '/moi/2fa/preparer', {})).statut, 200);
    }
    await poolPilote.query("UPDATE utilisateurs SET totp_secret = NULL WHERE email = $1", [(await api(qui, 'GET', '/moi')).utilisateur.email]);
  } finally { remettre('ARRIMO_ENV', avant.env); remettre('ARRIMO_DEMO', avant.demo); remettre('ARRIMO_2FA_ADMIN', avant.deuxfa); }
});

test('démonstration : un seul compte par CHSLD (administrateur), six comptes désactivés sans perte ; thème CHSLD clair et sombre, trois largeurs', { timeout: 240000 }, async () => {
  const { simplifierComptesDemo } = require('../src/demo-chsld');
  const { ROLES, courrielDe } = require('../db/provisionner-chsld');
  const compte = async (sql, v) => (await poolPilote.query(sql, v)).rows[0].n;
  const avant = { residents: await compte('SELECT count(*)::int n FROM residents'), mouvements: await compte('SELECT count(*)::int n FROM resident_mouvements'), lits: await compte(`SELECT count(*)::int n FROM lits l JOIN etablissements e ON e.id = l.etablissement_id WHERE e.type_etablissement = 'chsld'`),
    journal: await compte('SELECT count(*)::int n FROM journal'), hop: (await poolPilote.query(`SELECT string_agg(u.email || u.role || u.mot_de_passe_hash || u.actif, ',' ORDER BY u.id) s FROM utilisateurs u WHERE u.email LIKE 'hopital.%'`)).rows[0].s };
  const envAvant = process.env.ARRIMO_ENV;
  try {
    process.env.ARRIMO_ENV = 'recette';
    await assert.rejects(simplifierComptesDemo(poolPilote), (e) => e.statut === 403 || e.status === 403 || /residents_reserve_demo/.test(String(e.code || e.message)), 'jamais hors démonstration publique');
    process.env.ARRIMO_ENV = 'demo';
    const r = await simplifierComptesDemo(poolPilote);
    assert.deepStrictEqual(r.actifs, CHSLD.map((c) => courrielDe(c, 'coordination')));
    assert.strictEqual(r.desactives.length, 6);
    assert.deepStrictEqual(await simplifierComptesDemo(poolPilote), r, 'idempotent');
  } finally { if (envAvant === undefined) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = envAvant; }
  for (const c of CHSLD) for (const [, cle] of ROLES) {
    const x = await appel(null, 'POST', '/connexion', { email: courrielDe(c, cle), mot_de_passe: MDP });
    if (cle === 'coordination') { assert.strictEqual(x.statut, 200, `${cle} ${c.code}`); sessions[`${c.code}_admin`] = x.corps.token; }
    else assert.strictEqual(x.statut, 401, `${cle} ${c.code} : connexion refusée`);
  }
  const moi = await api(`${CHSLD[0].code}_admin`, 'GET', '/moi');
  assert.strictEqual(moi.utilisateur.role, 'admin_etab'); assert.deepStrictEqual(moi.etablissements.map((e) => e.code), ['CHSLD-ERA']);
  // Accès aux modules de l'établissement, jamais à l'autre CHSLD ni aux hôpitaux
  for (const chemin of ['/chsld/accueil', '/chsld/residents', '/chsld/places', '/chsld/demandes', '/chsld/taches', '/chsld/indicateurs']) await api(`${CHSLD[0].code}_admin`, 'GET', `${chemin}?etablissement_id=${ids.era}`);
  assert.strictEqual((await appel(`${CHSLD[0].code}_admin`, 'GET', `/chsld/residents?etablissement_id=${ids.stl}`)).statut, 403);
  const hy = (await poolPilote.query(`SELECT id FROM etablissements WHERE code = 'HY'`)).rows[0].id;
  assert.strictEqual((await appel(`${CHSLD[0].code}_admin`, 'GET', `/copilote/briefing?etablissement_id=${hy}`)).statut, 403);
  // Données, journaux et autres comptes intacts ; changements journalisés
  assert.deepStrictEqual({ residents: await compte('SELECT count(*)::int n FROM residents'), mouvements: await compte('SELECT count(*)::int n FROM resident_mouvements'), lits: avant.lits }, { residents: avant.residents, mouvements: avant.mouvements, lits: avant.lits });
  assert.ok(await compte('SELECT count(*)::int n FROM journal') >= avant.journal);
  assert.strictEqual((await poolPilote.query(`SELECT string_agg(u.email || u.role || u.mot_de_passe_hash || u.actif, ',' ORDER BY u.id) s FROM utilisateurs u WHERE u.email LIKE 'hopital.%'`)).rows[0].s, avant.hop);
  assert.strictEqual(await compte(`SELECT count(*)::int n FROM journal_admin WHERE action = 'Compte de démonstration CHSLD désactivé'`), 6);
  assert.strictEqual(await compte(`SELECT count(*)::int n FROM utilisateurs WHERE email LIKE '%@chsld.example.invalid' AND NOT actif`), 6, 'désactivés, pas supprimés');
  // Thème CHSLD : clair et sombre, ordinateur, tablette, téléphone ; OG visible ; aucun débordement ; hôpital inchangé
  const { chromium } = require('playwright'); const dossier = path.resolve('.local/captures-chsld'); fs.mkdirSync(dossier, { recursive: true });
  const navigateur = await chromium.launch(); const erreurs = [];
  try {
    for (const [nom, vp] of [['ordinateur', { width: 1440, height: 1000 }], ['tablette', { width: 820, height: 1180 }], ['telephone', { width: 390, height: 844 }]]) {
      for (const theme of ['clair', 'sombre']) {
        const ctx = await navigateur.newContext({ viewport: vp, colorScheme: theme === 'sombre' ? 'dark' : 'light' }); const pg = await ctx.newPage(); pg.on('pageerror', (e) => erreurs.push(`${nom} ${theme} ${e}`));
        await pg.addInitScript(({ jeton, id }) => { localStorage.setItem('arrimo-token', jeton); localStorage.setItem('arrimo-ctx', String(id)); localStorage.setItem('arrimo-langue', 'fr'); }, { jeton: sessions[`${CHSLD[0].code}_admin`], id: ids.era });
        await pg.goto(basePilote); await pg.waitForSelector('body[data-pret="1"]');
        if (await pg.locator('#b-premiers-pas-ok').isVisible().catch(() => false)) await pg.click('#b-premiers-pas-ok');
        if (theme === 'sombre') await pg.evaluate(() => { document.documentElement.dataset.theme = 'sombre'; });
        await pg.waitForSelector('#v-c-accueil .ch-kpis');
        assert.strictEqual(await pg.evaluate(() => document.documentElement.dataset.typeEtab), 'chsld');
        assert.match(await pg.evaluate(() => getComputedStyle(document.querySelector('.entete-app')).backgroundImage), /linear-gradient/, 'barre CHSLD');
        assert.strictEqual(await pg.locator('#v-c-accueil .ch-kpi').count(), 12, '7 capacités et 5 résidents');
        assert.ok(await pg.locator('#v-c-accueil .ch-situation').isVisible() && await pg.locator('#v-c-accueil .ch-actions').isVisible());
        assert.ok(await pg.locator('#og-open').isVisible(), 'OG visible');
        assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${nom} ${theme} : aucun débordement horizontal`);
        await pg.screenshot({ path: `${dossier}/chsld-theme-accueil-${nom}-${theme}.png`, fullPage: true });
        if (nom === 'ordinateur' && theme === 'clair') {
          await pg.click('#v-c-accueil [data-ch-aller="c-chambres"]'); await pg.waitForSelector('#v-c-chambres .ch-place');
          await pg.click('#og-open'); await pg.waitForSelector('#og-panel[open]'); assert.ok(await pg.locator('#og-panel .og-actions button, #og-actions button').count() > 0, 'OG : raccourcis CHSLD');
          await pg.screenshot({ path: `${dossier}/chsld-theme-og.png` });
        }
        await ctx.close();
      }
    }
    // Hôpital B : identité graphique inchangée
    const ctxH = await navigateur.newContext({ viewport: { width: 1366, height: 900 } }); const ph = await ctxH.newPage(); ph.on('pageerror', (e) => erreurs.push(`hôpital ${e}`));
    await ph.addInitScript(({ jeton, id }) => { localStorage.setItem('arrimo-token', jeton); localStorage.setItem('arrimo-ctx', String(id)); localStorage.setItem('arrimo-langue', 'fr'); }, { jeton: sessions.b, id: hy });
    await ph.goto(basePilote); await ph.waitForSelector('body[data-pret="1"]');
    assert.notStrictEqual(await ph.evaluate(() => document.documentElement.dataset.typeEtab), 'chsld');
    assert.strictEqual(await ph.evaluate(() => getComputedStyle(document.querySelector('.entete-app')).backgroundColor), 'rgb(14, 94, 111)', 'charte hospitalière #0E5E6F');
    await ph.screenshot({ path: `${dossier}/hopital-b-inchange.png` });
    await ctxH.close();
  } finally { await navigateur.close(); }
  assert.deepStrictEqual(erreurs, []);
});
