'use strict';
/** Chrono universel (27 nov. 2026) : durées en cours, lecture seule, niveaux, rôles, isolation. Données fictives. */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');

let pool; let serveur; let base; const tok = {}; const ids = {}; const envAvant = process.env.ARRIMO_ENV;
async function appel(qui, c) { const r = await fetch(`${base}/api${c}`, { headers: { Authorization: `Bearer ${tok[qui]}` } }); return { s: r.status, d: await r.json() }; }
async function compte(cle, role, etab) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [`${cle}@demo.arrimo`, `Nom ${cle}`, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etab]);
  tok[cle] = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${cle}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
}

test.before(async () => {
  process.env.ARRIMO_ENV = 'demo'; require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  ids.h = (await pool.query("SELECT l.etablissement_id AS id FROM lits l JOIN etablissements e ON e.id = l.etablissement_id WHERE e.type_etablissement = 'hopital' GROUP BY 1 HAVING count(*) >= 2 ORDER BY 1 LIMIT 1")).rows[0].id;
  ids.autre = (await pool.query("SELECT id FROM etablissements WHERE type_etablissement = 'hopital' AND id <> $1 ORDER BY id LIMIT 1", [ids.h])).rows[0].id;
  // Une civière occupée depuis 30 h (orange), un lit en attente de nettoyage depuis 70 min (rouge), un lit en nettoyage commencé il y a 10 min (vert)
  const civ = (await pool.query("SELECT id FROM civieres WHERE etablissement_id = $1 ORDER BY id LIMIT 1", [ids.h])).rows[0];
  if (civ) { ids.civ = civ.id; await pool.query("UPDATE civieres SET etat = 'occupee', patient_ref = 'P-77001', arrivee_le = now() - interval '30 hours', etat_depuis = now() - interval '30 hours' WHERE id = $1", [civ.id]); }
  const [l1, l2] = (await pool.query("SELECT id FROM lits WHERE etablissement_id = $1 ORDER BY (etat = 'libre') DESC, id LIMIT 2", [ids.h])).rows;
  ids.l1 = l1.id; ids.l2 = l2.id;
  await pool.query("UPDATE lits SET etat = 'nettoyage', patient_ref = NULL, nsa_depuis = NULL, etat_depuis = now() - interval '70 minutes', nettoyage_debut = NULL WHERE id = $1", [l1.id]);
  await pool.query("UPDATE lits SET etat = 'nettoyage', patient_ref = NULL, nsa_depuis = NULL, etat_depuis = now() - interval '40 minutes', nettoyage_debut = now() - interval '10 minutes' WHERE id = $1", [l2.id]);
  await compte('coord', 'coordonnateur', ids.h); await compte('ent', 'entretien', ids.h); await compte('autre', 'coordonnateur', ids.autre);
});
test.after(async () => { serveur?.close(); await pool?.end(); if (envAvant === undefined) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = envAvant; });

test('Durées en cours tirées des horodatages, niveaux vert/orange/rouge, référence patient seulement', async () => {
  const r = await appel('coord', `/chrono/universel?etablissement_id=${ids.h}`);
  assert.strictEqual(r.s, 200, JSON.stringify(r.d));
  if (ids.civ) { const c = r.d.patients.find((x) => x.objet === 'civiere' && x.id === ids.civ); assert.strictEqual(c.niveau, 'orange'); assert.strictEqual(c.reference, 'P-77001'); assert.ok(!('nom' in c) && !('prenom' in c)); }
  const a = r.d.capacites.find((x) => x.id === ids.l1); assert.strictEqual(a.phase, 'attente_nettoyage'); assert.strictEqual(a.niveau, 'rouge');
  const b = r.d.capacites.find((x) => x.id === ids.l2); assert.strictEqual(b.phase, 'nettoyage_en_cours'); assert.strictEqual(b.niveau, 'vert'); assert.strictEqual(b.attente_avant_nettoyage_min, 30);
  assert.ok(r.d.qualite && 'gps_obsoletes' in r.d.qualite);
});

test('Inconnu jamais transformé en zéro ; entretien limité aux capacités ; isolation entre établissements', async () => {
  const { niveau } = require('../src/chrono-universel');
  assert.strictEqual(niveau('nettoyage_attente', null, Date.now()), 'gris');
  const ent = (await appel('ent', `/chrono/universel?etablissement_id=${ids.h}`)).d;
  assert.strictEqual(ent.patients.length, 0); assert.strictEqual(ent.ambulances.length, 0); assert.strictEqual(ent.qualite, null); assert.ok(ent.capacites.length >= 2);
  assert.strictEqual((await appel('autre', `/chrono/universel?etablissement_id=${ids.h}`)).s, 403);
});

test('Chrono : module principal du menu, huit sous-menus, un seul moteur (lecture seule)', () => {
  const fs = require('node:fs'); const path = require('node:path'); const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(lire('public/espaces.js'), /\['chrono', 'timer', 'Chrono', 'Chrono', \['chrono'\]\]/);
  assert.ok(!/\['urgence', 'secours', 'chrono'/.test(lire('public/espaces.js')), 'sorti d’Urgences');
  assert.match(lire('public/chrono.js'), /const SOUS = \['generale', 'patients', 'ambulances', 'capacites', 'previsions', 'qualite', 'alertes', 'historique'\]/);
  assert.ok(!/INSERT|UPDATE|DELETE/.test(lire('src/chrono-universel.js').replace(/\/\*[\s\S]*?\*\//g, '')), 'lecture seule');
});

test('Rapports Excel : tableaux affichés, en-tête et confidentialité, formules neutralisées, export journalisé ; entretien exclu', async () => {
  const post = (qui, b) => fetch(`${base}/api/rapports/excel`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok[qui]}` }, body: JSON.stringify(b) });
  const lignes = [['Indicateur', 'Valeur'], ['Durée de nettoyage', '01:36:00'], ['=HYPERLINK("x")', '-5']];
  const r = await post('coord', { etablissement_id: ids.h, titre: 'Indicateurs · Hôpital', lignes });
  assert.strictEqual(r.status, 200); assert.match(r.headers.get('content-type'), /spreadsheetml/); assert.match(r.headers.get('content-disposition'), /arrimo-indicateurs-hopital\.xlsx/);
  const x = require('../src/sh/xlsx').lireXlsx(Buffer.from(await r.arrayBuffer()));
  const l = x.lignes || x.rows || x; const plat = JSON.stringify(l);
  assert.match(plat, /Confidentiel/); assert.match(plat, /01:36:00/); assert.match(plat, /'=HYPERLINK/, 'formule neutralisée'); assert.match(plat, /"-5"/, 'nombre négatif conservé');
  assert.ok((await pool.query("SELECT 1 FROM journal WHERE action = 'Export Excel' AND etablissement_id = $1", [ids.h])).rowCount, 'export journalisé');
  assert.strictEqual((await post('ent', { etablissement_id: ids.h, titre: 'x', lignes })).status, 403);
  assert.strictEqual((await post('autre', { etablissement_id: ids.h, titre: 'x', lignes })).status, 403);
  assert.strictEqual((await post('coord', { etablissement_id: ids.h, titre: 'x', lignes: 'pas un tableau' })).status, 400);
});

test('OG temporel : durée d’une ressource nommée et escalades actives, faits Chrono, écran à ouvrir', async () => {
  const og = async (question) => (await (await fetch(`${base}/api/copilote/question`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok.coord}` }, body: JSON.stringify({ etablissement_id: ids.h, question }) })).json());
  const code = (await pool.query('SELECT code FROM lits WHERE id = $1', [ids.l1])).rows[0].code;
  const r = await og(`Depuis combien de temps le lit ${code} attend-il ?`);
  assert.match(r.reponse, new RegExp(`${code}.*attente nettoyage depuis 0?1:1\\d:\\d\\d`), r.reponse); assert.strictEqual(r.ouvrir, 'chrono');
  const e = await og('Quelles escalades sont encore actives ?');
  assert.match(e.reponse, /^Fait : (aucune alerte|\d+ alerte)/, e.reponse);
});
