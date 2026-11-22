'use strict';
/** Scénario F du cahier ultime : deux sessions ouvertes en même temps ; un changement fait ailleurs apparaît sans recharger la page. */
const test = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');

let pool; let serveur; let base; let nav; const ids = {}; const envAvant = process.env.ARRIMO_ENV;
async function compte(cle, role, { etab, org } = {}) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [`${cle}@demo.arrimo`, `Nom ${cle}`, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (etab) await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etab]);
  if (org) await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, org]);
  return u;
}
async function session(email) {
  const pg = await (await nav.newContext({ viewport: { width: 1366, height: 900 }, locale: 'fr-CA' })).newPage(); pg.erreurs = [];
  pg.on('pageerror', (e) => pg.erreurs.push(e.message));
  await pg.addInitScript(() => { try { localStorage.setItem('arrimo-langue', 'fr'); localStorage.setItem('arrimo-premiers-pas', '1'); } catch { /* */ } });
  await pg.goto(base); await pg.fill('#c-email', email); await pg.fill('#c-mdp', MOT_DE_PASSE_DEMO); await pg.press('#c-mdp', 'Enter');
  await pg.waitForSelector('body[data-pret="1"]', { timeout: 30000 });
  if (await pg.locator('#b-premiers-pas-ok').isVisible().catch(() => false)) await pg.click('#b-premiers-pas-ok');
  await pg.evaluate(() => document.querySelector('#onglets button[data-v="flux"]').click());
  await pg.waitForSelector('#v-flux:not([hidden]) table', { timeout: 20000 });
  return pg;
}

test.before(async () => {
  process.env.ARRIMO_ENV = 'demo'; require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const h = (await pool.query("SELECT id, config_id, latitude, longitude FROM etablissements WHERE code = 'MB'")).rows[0];
  ids.c = (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, module_actif, type_etablissement, modules) VALUES ('CH-R', 'CHSLD temps réel', 'Ville', $1, $2, $3, true, 'chsld', '{"transport_planifie": true}') RETURNING id`,
    [h.latitude + 0.01, h.longitude, h.config_id])).rows[0].id;
  ids.org = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('AMB-R', 'Ambulances R', 'ambulancier', '{ambulance}', $1) RETURNING id", [h.config_id])).rows[0].id;
  ids.unite = (await pool.query("INSERT INTO unites_secours (organisation_id, numero, plaque) VALUES ($1, 'DM-301', 'R 301') RETURNING id", [ids.org])).rows[0].id;
  ids.dt = (await pool.query(`INSERT INTO demandes_transport (numero, organisation_id, origine_id, destination_id, resident_ref, statut, heure_souhaitee, plage_debut, plage_fin, unite_id, motif_transport, type_vehicule)
    VALUES ('DT-009001', $1, $2, $3, 'P-90001', 'en_route', now() + interval '1 hour', now() + interval '1 hour', now() + interval '2 hours', $4, 'transfert_stable', 'ambulance') RETURNING id`, [ids.org, h.id, ids.c, ids.unite])).rows[0].id;
  await compte('rt.a', 'coordonnateur', { etab: ids.c }); await compte('rt.b', 'coordonnateur', { etab: ids.c }); ids.para = await compte('rt.para', 'paramedic', { org: ids.org });
  nav = await chromium.launch();
});
test.after(async () => { await nav?.close(); serveur?.close(); await pool?.end(); if (envAvant === undefined) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = envAvant; });

test('scénario F : deux sessions sur Arrimo Flux ; la préalerte de l’équipage puis l’accusé de réception apparaissent chez l’autre sans recharger', async () => {
  const a = await session('rt.a@demo.arrimo'); const b = await session('rt.b@demo.arrimo');
  assert.match(await a.textContent('#v-flux'), /DT-009001/);
  assert.ok(!/à acquitter/.test(await a.textContent('#v-flux')));
  // L'équipage envoie la préalerte d'arrivée (autre session, par l'API)
  const jeton = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'rt.para@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
  const v = (await pool.query('SELECT version FROM demandes_transport WHERE id = $1', [ids.dt])).rows[0].version;
  const r = await fetch(`${base}/api/secours/transports/${ids.dt}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}` }, body: JSON.stringify({ action: 'prealerter', version: v, eta_min: 25 }) });
  assert.strictEqual(r.status, 200);
  // Les deux sessions voient la préalerte sans rechargement
  for (const pg of [a, b]) await pg.waitForFunction(() => /à acquitter/.test(document.querySelector('#v-flux').textContent), null, { timeout: 60000 });
  // La session A accuse réception ; la session B le voit sans rechargement, sans doublon de ligne
  await a.click('[data-flux-accuser]');
  await b.waitForFunction(() => /reçue/.test(document.querySelector('#v-flux').textContent) && !document.querySelector('[data-flux-accuser]'), null, { timeout: 60000 });
  assert.strictEqual(await b.locator('#v-flux tbody tr', { hasText: 'DT-009001' }).count(), 1, 'une seule ligne pour le transport');
  assert.deepStrictEqual([...a.erreurs, ...b.erreurs], []);
});
