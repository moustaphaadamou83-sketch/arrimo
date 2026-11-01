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
    assert.deepStrictEqual(Object.keys(v).sort(), ['a_accueillir', 'arrivees', 'compteurs', 'historique', 'hospitalisations']);
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
  assert.strictEqual((await api('era', 'GET', `/chsld/residents/${p.dupont}`)).resident.statut, 'present');
  vb = await api('b', 'GET', `/liaison-chsld?etablissement_id=${L.B}`);
  fiche = vb.historique.find((x) => x.id === co.id);
  assert.ok(fiche && fiche.etape === 'cloturee' && fiche.retour.etape === 'retour_recu', 'parcours clôturé dans l’historique');
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
  co = await api('a', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.A, action: 'orienter', orientation: 'urgence', patient_ref: 'P-72001', version: co.version });
  assert.strictEqual(co.orientation, 'urgence'); assert.strictEqual(co.demande_admission_id, null);
  await refuse('a', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: L.A, action: 'orienter', orientation: 'admission', patient_ref: 'P-72001', version: co.version }, 409, 'orientation_deja_faite');
  let ret = await api('a', 'POST', `/coordinations/${co.id}/retour`, { retour_prevu_le: new Date(Date.now() + 3600000).toISOString() });
  ret = await api('era', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: 'accepter', version: ret.version });
  ret = await api('a', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: L.A, action: 'confirmer_depart', version: ret.version });
  await api('era', 'POST', `/coordinations/${ret.id}/action`, { etablissement_id: ids.era, action: 'confirmer_arrivee', version: ret.version });
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
