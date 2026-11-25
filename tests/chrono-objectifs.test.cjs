'use strict';
/**
 * Refonte unifiée, Chrono (26 nov. 2026) : objectifs internes Arrimo 15/30 et 5/10, configurables, à côté des cibles MSSS.
 * Pendant le passage : temps écoulé et dépassement ; après la remise : mesure, respect, excellence ; rapport : parts respectées et
 * heures-véhicules au-delà de l'objectif de libération ; les cibles MSSS restent inchangées.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');

let pool; let serveur; let base; const tokens = {}; const ids = {};
async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[qui]}` }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
const il_y_a = (min) => new Date(Date.now() - min * 60000).toISOString();

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const e = (await pool.query("SELECT id, latitude, longitude, config_id FROM etablissements WHERE code = 'MB'")).rows[0];
  ids.mb = e.id; ids.pos = { latitude: e.latitude, longitude: e.longitude }; ids.config = e.config_id;
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"liaison_secours": true, "chrono": true}' WHERE id = $1`, [ids.mb]);
  const org = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('AMB-OB', 'AMB-OB', 'ambulancier', ARRAY['ambulance'], $1) RETURNING id", [ids.config])).rows[0].id;
  ids.u = (await pool.query("INSERT INTO unites_secours (organisation_id, numero) VALUES ($1, '60-01') RETURNING id", [org])).rows[0].id;
  const u = (await pool.query("INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ('para.ob@demo.arrimo', 'p', $1, 'paramedic') RETURNING id", [hacher(MOT_DE_PASSE_DEMO)])).rows[0].id;
  await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, org]);
  for (const [q, email] of [['para', 'para.ob@demo.arrimo'], ['tremblay', 'tremblay@demo.arrimo']]) {
    tokens[q] = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
  }
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('objectifs Arrimo : écoulé puis mesuré ; respect et excellence ; cibles MSSS inchangées ; rapport', async () => {
  for (const m of [20, 19]) await appel('para', 'POST', `/secours/unites/${ids.u}/position`, { ...ids.pos, precision_m: 10, horodatage: il_y_a(m) });
  const p = (await pool.query('SELECT id FROM passages_chrono WHERE unite_id = $1 ORDER BY id DESC LIMIT 1', [ids.u])).rows[0];
  let f = (await appel('tremblay', 'GET', `/chrono?etablissement_id=${ids.mb}`)).corps.a_la_porte.find((x) => x.id === p.id);
  assert.deepStrictEqual({ cible: f.arrimo.remise.cible_min, exc: f.arrimo.remise.excellence_min, lib: f.arrimo.liberation.cible_min, maj: f.arrimo.escalade_majeure_min }, { cible: 15, exc: 5, lib: 30, maj: 45 });
  assert.ok(f.arrimo.remise.ecoule_min >= 19); assert.strictEqual(f.arrimo.remise.depasse, true); assert.strictEqual(f.arrimo.remise.respecte, null, 'pas de verdict avant la remise');
  assert.strictEqual(f.cibles.porte, 20, 'cible MSSS inchangée');
  for (const e of ['H12', 'H13', 'H14']) assert.strictEqual((await appel('tremblay', 'POST', `/chrono/passages/${p.id}/etape`, { etablissement_id: ids.mb, etape: e })).statut, 200, e);
  f = (await appel('tremblay', 'GET', `/chrono/passages/${p.id}?etablissement_id=${ids.mb}`)).corps;
  const remise = f.arrimo?.remise || f.passage?.arrimo?.remise;
  assert.ok(remise.mesure_min >= 19); assert.strictEqual(remise.respecte, false); assert.strictEqual(remise.excellence, false);
  const r = (await appel('tremblay', 'GET', `/chrono/rapport?etablissement_id=${ids.mb}`)).corps;
  assert.strictEqual(r.objectifs_arrimo.remise.n, 1); assert.strictEqual(r.objectifs_arrimo.remise.respecte_pct, 0); assert.strictEqual(r.objectifs_arrimo.indicatif, true);
  await pool.query('UPDATE config_pays SET objectif_remise_min = 30 WHERE id = $1', [ids.config]);
  try {
    assert.strictEqual((await appel('tremblay', 'GET', `/chrono/rapport?etablissement_id=${ids.mb}`)).corps.objectifs_arrimo.remise.respecte_pct, 100, 'objectif configurable');
  } finally { await pool.query('UPDATE config_pays SET objectif_remise_min = 15 WHERE id = $1', [ids.config]); }
});
