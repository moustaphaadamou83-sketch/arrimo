'use strict';
/** Connecteur DSN (Epic), lot 1 (22 nov. 2026) : ADT complet en HL7 v2, correspondance des codes de lits, suivi des messages. Données fictives. */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');
const { hacherCle } = require('../src/connecteurs');

let pool; let serveur; let base; let jeton; const CLE = 'arr_test_dsn_0123456789abcdef'; const ids = {};
const h = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
const msg = (n, evt, segments) => `MSH|^~\\&|EPIC|DSN|ARRIMO|ARRIMO|${h}||ADT^${evt}|DSN-${n}|P|2.5\rEVN|${evt}|${h}\r${segments}\r`;
const pid = (ref) => `PID|1||${ref}^^^DSN||NOM^PRENOM||19400101|F`;
const pv1 = (lit, avant = '') => `PV1|1|I|MED^^${lit}|||${avant ? `MED^^${avant}` : ''}`;
async function hl7(texte) { const r = await fetch(`${base}/api/connecteurs/hl7v2`, { method: 'POST', headers: { 'Content-Type': 'application/hl7-v2', 'X-Connecteur-Key': CLE }, body: texte }); return { s: r.status, t: await r.text() }; }
async function api(m, c, b) { const r = await fetch(`${base}/api${c}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}` }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, d: await r.json().catch(() => null) }; }
const etat = async (code) => (await pool.query('SELECT etat, patient_ref, motif_indispo FROM lits WHERE etablissement_id = $1 AND code = $2', [ids.e, code])).rows[0];

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  ids.e = (await pool.query("SELECT etablissement_id AS id FROM lits WHERE etat = 'libre' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1")).rows[0].id;
  const libres = (await pool.query("SELECT code FROM lits WHERE etablissement_id = $1 AND etat = 'libre' ORDER BY code LIMIT 4", [ids.e])).rows.map((x) => x.code);
  [ids.l1, ids.l2, ids.l3, ids.l4] = libres;
  ids.c = (await pool.query("INSERT INTO connecteurs (nom, cle_hash, etablissement_id, portees) VALUES ('DSN test', $1, $2, '{hl7v2}') RETURNING id", [hacherCle(CLE), ids.e])).rows[0].id;
  const u = (await pool.query("INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ('admin.dsn@demo.arrimo', 'admin dsn', $1, 'admin_etab') RETURNING id", [hacher(MOT_DE_PASSE_DEMO)])).rows[0].id;
  await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, ids.e]);
  jeton = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin.dsn@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('A11 annulation d’admission : le lit passe au nettoyage ; nom et date de naissance jamais conservés', async () => {
  assert.match((await hl7(msg(1, 'A01', `${pid('P-90001')}\r${pv1(ids.l1)}`))).t, /MSA\|AA/);
  assert.strictEqual((await etat(ids.l1)).etat, 'occupe');
  assert.match((await hl7(msg(2, 'A11', `${pid('P-90001')}\r${pv1(ids.l1)}`))).t, /MSA\|AA/);
  assert.strictEqual((await etat(ids.l1)).etat, 'nettoyage');
  assert.ok(!(await pool.query("SELECT 1 FROM journal WHERE detail ILIKE '%PRENOM%' OR detail ILIKE '%19400101%'")).rowCount);
});

test('A02 puis A12 annulation de transfert : retour au lit d’origine', async () => {
  await hl7(msg(3, 'A01', `${pid('P-90002')}\r${pv1(ids.l2)}`));
  await hl7(msg(4, 'A02', `${pid('P-90002')}\r${pv1(ids.l3, ids.l2)}`));
  assert.deepStrictEqual([(await etat(ids.l2)).etat, (await etat(ids.l3)).etat], ['nettoyage', 'occupe']);
  assert.match((await hl7(msg(5, 'A12', `${pid('P-90002')}\r${pv1(ids.l2, ids.l3)}`))).t, /MSA\|AA/);
  assert.deepStrictEqual([(await etat(ids.l2)).etat, (await etat(ids.l2)).patient_ref, (await etat(ids.l3)).etat], ['occupe', 'P-90002', 'nettoyage']);
});

test('A03 puis A13 annulation de congé : le patient retrouve son lit ; lit donné à un autre → refus AE', async () => {
  await hl7(msg(6, 'A03', `${pid('P-90002')}\r${pv1(ids.l2)}`));
  assert.strictEqual((await etat(ids.l2)).etat, 'nettoyage');
  assert.match((await hl7(msg(7, 'A13', `${pid('P-90002')}\r${pv1(ids.l2)}`))).t, /MSA\|AA/);
  assert.deepStrictEqual([(await etat(ids.l2)).etat, (await etat(ids.l2)).patient_ref], ['occupe', 'P-90002']);
  await hl7(msg(8, 'A01', `${pid('P-90003')}\r${pv1(ids.l4)}`));
  const r = await hl7(msg(9, 'A13', `${pid('P-90009')}\r${pv1(ids.l4)}`)); assert.match(r.t, /MSA\|AE/);
});

test('A20 statut de lit : seulement par une transition permise ; sinon écart journalisé', async () => {
  assert.match((await hl7(msg(10, 'A20', `NPU|MED^^${ids.l1}|U`))).t, /MSA\|AA/);
  assert.strictEqual((await etat(ids.l1)).etat, 'libre', 'nettoyage → libre');
  await hl7(msg(11, 'A20', `NPU|MED^^${ids.l1}|K`));
  assert.deepStrictEqual([(await etat(ids.l1)).etat, (await etat(ids.l1)).motif_indispo], ['indispo', 'infection']);
  await hl7(msg(12, 'A20', `NPU|MED^^${ids.l4}|U`));
  assert.strictEqual((await etat(ids.l4)).etat, 'occupe', 'un lit occupé n’est jamais libéré par un statut');
  const m = (await pool.query("SELECT statut, detail FROM messages_connecteur WHERE identifiant = 'DSN-12'")).rows[0];
  assert.strictEqual(m.statut, 'ignore'); assert.match(m.detail, /Écart/);
});

test('A17, A08, A06, A21, A22 : reçus et journalisés, aucun changement d’état ; A17 à confirmer dans Arrimo', async () => {
  const avant = await etat(ids.l2);
  for (const [n, evt] of [[13, 'A08'], [14, 'A06'], [15, 'A21'], [16, 'A22']]) assert.match((await hl7(msg(n, evt, `${pid('P-90002')}\r${pv1(ids.l2)}`))).t, /MSA\|AA/);
  assert.match((await hl7(msg(17, 'A17', `${pid('P-90002')}\r${pv1(ids.l2)}\r${pid('P-90003')}\r${pv1(ids.l4)}`))).t, /MSA\|AA/);
  assert.deepStrictEqual(await etat(ids.l2), avant);
  assert.match((await pool.query("SELECT detail FROM messages_connecteur WHERE identifiant = 'DSN-17'")).rows[0].detail, /à confirmer/);
  assert.match((await hl7(msg(18, 'A28', pid('P-1')))).t, /MSA\|AE/, 'message non pris en charge');
});

test('correspondance des codes (DSN → Arrimo), contrôlée ; suivi des messages par l’administrateur', async () => {
  const env = process.env.ARRIMO_ENV; process.env.ARRIMO_ENV = 'demo';   // démonstration : administration sans double authentification
  try {
  const rf = await api('PUT', `/admin/connecteurs/${ids.c}/correspondances`, { texte: 'genre;code DSN;code Arrimo\nlit;EPIC-999;INEXISTANT' }); const faux = rf.d;
  assert.strictEqual(faux.enregistre, false); assert.strictEqual(faux.erreurs[0].raison, 'code_arrimo_inconnu');
  const libre = (await pool.query("SELECT code FROM lits WHERE etablissement_id = $1 AND etat = 'libre' AND code <> ALL($2) ORDER BY code LIMIT 1", [ids.e, [ids.l1, ids.l2, ids.l3, ids.l4]])).rows[0].code;
  assert.deepStrictEqual((await api('PUT', `/admin/connecteurs/${ids.c}/correspondances`, { texte: `lit;EPIC-4N-12;${libre}` })).d, { enregistre: true, lignes: 1 });
  assert.match((await hl7(msg(19, 'A01', `${pid('P-90010')}\r${pv1('EPIC-4N-12')}`))).t, /MSA\|AA/);
  assert.deepStrictEqual([(await etat(libre)).etat, (await etat(libre)).patient_ref], ['occupe', 'P-90010']);
  const rejets = (await api('GET', `/admin/connecteurs/${ids.c}/messages?statut=rejete`)).d;
  assert.ok(rejets.length >= 1 && rejets.every((x) => x.statut === 'rejete'));
  assert.ok((await api('GET', `/admin/connecteurs/${ids.c}/messages`)).d.length >= 15);
  } finally { if (env === undefined) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = env; }
});
