'use strict';
/**
 * Console SH : écran d'activation des modules en cartes (cahier v2, C.10, 19 nov. 2026) et migration SH 49 (moteur commun, lot 0).
 * Cartes selon le type, filtre, confirmation de désactivation, dépendance, « Bientôt » refusé aussi par le serveur, journal avec
 * auteur et détail par module, FR/EN complets, ancienne route PUT /hopitaux/:id/modules inchangée.
 *   TEST_DATABASE_URL=postgresql://root@localhost/arrimo_sh_lot1_test_<x>?host=/var/run/postgresql node --test tests/sh-modules-cartes.test.cjs
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
const { viderBase } = require('../db/vider');
const { premierCompteSh } = require('../db/sh-premier-compte');
const invitations = require('../src/sh/invitations');
const totp = require('../src/totp');
const courriel = require('../src/courriel');
const { demarrerServeur } = require('./serveur-test.cjs');
const cartes = require('../public-sh/modules-cartes.js');
const TE = require('../src/types-etablissement');

const URL_TEST = process.env.TEST_DATABASE_URL;
const CLE_MFA = Buffer.alloc(32, 5).toString('base64');
const MDP = 'Cartes-Fictives-2026';
let pool, poolPilote, serveurSh, serveurPilote, baseSh, jeton;
const courriels = [];
async function appelSh(methode, chemin, corps, j = jeton) {
  const r = await fetch(`${baseSh}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(j ? { Authorization: `Bearer ${j}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
async function sh(methode, chemin, corps) { const r = await appelSh(methode, chemin, corps); assert.ok(r.statut === 200, `SH ${methode} ${chemin} → ${r.statut} ${JSON.stringify(r.corps)}`); return r.corps; }

test.before(async () => {
  assert.match(new URL(URL_TEST).pathname, /^\/arrimo_sh_lot1_test_[a-z0-9_]+$/);
  require('./routeur-fictif.cjs').activer();
  process.env.SH_API_KEY = 'cle-cartes-sh-0123456789abcdef'; process.env.SH_MFA_ENCRYPTION_KEY = CLE_MFA;
  process.env.ARRIMO_URL = 'https://arrimo.test.invalid'; process.env.SH_PUBLIC_URL = 'https://sh.test.invalid';
  process.env.SH_INITIAL_ADMIN_EMAIL = 'admin.cartes@sh.exemple'; process.env.ARRIMO_ENV = 'pilote';
  courriel.definirTransport(async (m) => { courriels.push(m); });
  pool = creerPool(URL_TEST);
  await pool.query('DROP SCHEMA IF EXISTS pilote_cartes CASCADE'); await pool.query('CREATE SCHEMA pilote_cartes');
  poolPilote = new Pool({ connectionString: URL_TEST, options: '-c search_path=pilote_cartes' });
  await viderBase(poolPilote); await require('../db/seed').seed(poolPilote, { silencieux: true });
  serveurPilote = await demarrerServeur(creerApp(poolPilote));
  await viderBaseSh(pool);
  await premierCompteSh(pool, 'admin.cartes@sh.exemple', 'Administration fictive');
  await invitations.consommer(pool, { jeton: courriels.at(-1).texte.match(/#invitation=([a-f0-9]{64})/)[1], nouveau: MDP }, process.env);
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'arrimo-cartes-'));
  serveurSh = await demarrerServeur(creerAppSh(pool, { env: { SH_PUBLIC_URL: 'https://sh.test.invalid', SH_MFA_ENCRYPTION_KEY: CLE_MFA, SH_DOCUMENTS_DIR: dossier,
    SH_ENV_PILOTE_URL: `http://127.0.0.1:${serveurPilote.address().port}`, SH_ENV_PILOTE_CLE: process.env.SH_API_KEY, SH_ENV_PILOTE_PUBLIC: 'https://pilote.example.invalid' } }));
  baseSh = `http://127.0.0.1:${serveurSh.address().port}`;
  let r = await appelSh('POST', '/connexion', { email: 'admin.cartes@sh.exemple', mot_de_passe: MDP }, null);
  const { secret } = (await appelSh('POST', '/moi/2fa/preparer', null, r.corps.token)).corps;
  await appelSh('POST', '/moi/2fa/activer', { code: totp.codePourPas(secret, totp.pasActuel()) }, r.corps.token);
  r = await appelSh('POST', '/connexion', { email: 'admin.cartes@sh.exemple', mot_de_passe: MDP }, null);
  r = await appelSh('POST', '/connexion/2fa', { jeton: r.corps.jeton, code: totp.codePourPas(secret, totp.pasActuel() + 1) }, null);
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps)); jeton = r.corps.token;
});
test.after(async () => { serveurSh?.close(); serveurPilote?.close(); await poolPilote?.end().catch(() => {}); await pool?.query('DROP SCHEMA IF EXISTS pilote_cartes CASCADE').catch(() => {}); await pool?.end(); });

test('migration SH 49 : modules du chantier au catalogue « à venir », nouveaux types locaux, rien de modifié', async () => {
  const cat = (await pool.query("SELECT code, statut FROM sh_modules_catalogue WHERE code = ANY($1)", [require('../src/sh/types-etablissement-migrations').MODULES_CHANTIER])).rows;
  assert.strictEqual(cat.length, 9);
  // Migration 50 : Chrono livré, carte « Disponible » ; les 8 autres restent « Bientôt »
  assert.deepStrictEqual(cat.filter((m) => m.statut !== 'a_venir').map((m) => [m.code, m.statut]), [['chrono', 'disponible']]);
  assert.ok((await pool.query('SELECT 1 FROM sh_migrations WHERE version = 50')).rowCount);
  const locaux = (await pool.query("SELECT code FROM sh_types_locaux WHERE code IN ('soins_palliatifs', 'hospitalisation_domicile', 'sante_mentale')")).rows;
  assert.strictEqual(locaux.length, 3);
  assert.ok((await pool.query('SELECT 1 FROM sh_migrations WHERE version = 49')).rowCount);
});

test('cartes : 17 au total, seules celles du type apparaissent, état et filtre', () => {
  assert.strictEqual(cartes.CARTES.length, 17);
  const catalogue = (type) => TE.catalogue(type).map((m) => ({ ...m, licence: 'non_selectionne' }));
  const hop = cartes.cartesDuType(catalogue('hopital')).map((c) => c.id);
  assert.ok(hop.includes('hopital') && hop.includes('chrono') && !hop.includes('hebergement') && !hop.includes('visites_confirmees'));
  const chs = cartes.cartesDuType(catalogue('chsld')).map((c) => c.id);
  assert.ok(chs.includes('hebergement') && chs.includes('visites_confirmees') && !chs.includes('chrono') && !chs.includes('hopital'));
  const amb = cartes.cartesDuType(catalogue('entreprise_ambulanciere')).map((c) => c.id);
  assert.ok(amb.includes('secours') && amb.includes('chrono') && !amb.includes('bourse_places'));
  const carte = (id) => cartes.cartesDuType(catalogue('hopital')).find((c) => c.id === id);
  assert.strictEqual(cartes.etatCarte(carte('mode_crise')), 'bientot');
  assert.strictEqual(cartes.etatCarte(carte('chrono')), 'desactive', 'Chrono livré : activable');
  // Tout code du catalogue (hors communs inclus) est rangé dans une carte
  const ranges = new Set(cartes.CARTES.flatMap((c) => c.codes));
  for (const m of TE.MODULES.filter((x) => x.categorie !== 'commun' || x.code === 'og')) assert.ok(ranges.has(m.code), `carte manquante : ${m.code}`);
});

test('anglais : chaque carte et chaque texte de l’écran existent en FR et en EN (échoue s’il en manque un)', () => {
  for (const c of cartes.CARTES) for (const l of ['fr', 'en']) assert.ok(c[l] && c[l][0] && c[l][1], `${c.id} ${l}`);
  assert.deepStrictEqual(Object.keys(cartes.T.fr).sort(), Object.keys(cartes.T.en).sort());
  for (const [k, v] of Object.entries(cartes.T.en)) assert.ok(v && v !== cartes.T.fr[k] || ['actives'].includes(k) || v === 'OG', k);
});

test('serveur : « Bientôt » refusé, activation et désactivation journalisées avec l’auteur et le détail ; dépendance exigée', async () => {
  const h = await sh('POST', '/hopitaux', { type_etablissement: 'hopital', nom: 'Hôpital fictif des cartes', code_etab: 'HC-CARTES', environnement: 'pilote', pays_code: 'CA', latitude: 45.4, longitude: -71.9 });
  let r = await appelSh('PUT', `/hopitaux/${h.id}/modules`, { modules: [{ code: 'mode_crise', licence: 'souscrit' }] });
  assert.strictEqual(r.statut, 409); assert.match(r.corps.erreur, /pas encore disponible/);
  r = await appelSh('PUT', `/hopitaux/${h.id}/modules`, { modules: [{ code: 'liaison_chsld', licence: 'souscrit' }] });
  assert.strictEqual(r.statut, 409, 'dépendance absente refusée');
  await sh('PUT', `/hopitaux/${h.id}/modules`, { modules: [{ code: 'liaison_secours', licence: 'souscrit' }] });
  await sh('PUT', `/hopitaux/${h.id}/modules`, { modules: [{ code: 'liaison_secours', licence: 'non_selectionne' }] });
  const j = (await pool.query("SELECT detail, utilisateur_id FROM sh_journal WHERE action = 'Catalogue de modules modifié' ORDER BY id")).rows;
  assert.ok(j.some((x) => /liaison_secours : non_selectionne → souscrit/.test(x.detail) && x.utilisateur_id), JSON.stringify(j));
  assert.ok(j.some((x) => /liaison_secours : souscrit → non_selectionne/.test(x.detail)));
  const fiche = await sh('GET', `/hopitaux/${h.id}`);
  assert.strictEqual(fiche.modules.find((m) => m.code === 'mode_crise').statut, 'a_venir');
  // Chrono exige Liaison Secours : refusé seul, accepté avec
  assert.strictEqual((await appelSh('PUT', `/hopitaux/${h.id}/modules`, { modules: [{ code: 'chrono', licence: 'souscrit' }] })).statut, 409);
  await sh('PUT', `/hopitaux/${h.id}/modules`, { modules: [{ code: 'liaison_secours', licence: 'souscrit' }, { code: 'chrono', licence: 'souscrit' }] });
});
