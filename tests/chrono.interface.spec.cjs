'use strict';
/**
 * Chrono dans le navigateur (Chromium) : à la porte depuis 25 min → rouge avec les minutes et le mot écrits ; « Début triage » au clic ;
 * même écran en anglais ; ordinateur et téléphone sans débordement ni erreur dans la console ; écran Chrono de l'ambulance.
 *   TEST_DATABASE_URL=… node --test tests/chrono.interface.spec.cjs
 */
const test = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');
const horloge = require('../src/horloge');

process.env.ARRIMO_METEO = '0';
let pool; let serveur; let base; let nav; const ids = {};
test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const e = (await pool.query("SELECT id, config_id FROM etablissements WHERE code = 'MB'")).rows[0]; ids.mb = e.id;
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"liaison_secours": true, "chrono": true}' WHERE id = $1`, [ids.mb]);
  const org = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('AMB-UI', 'Ambulances fictives UI', 'ambulancier', '{ambulance}', $1) RETURNING id", [e.config_id])).rows[0].id;
  const u = (await pool.query("INSERT INTO unites_secours (organisation_id, numero) VALUES ($1, '77-01') RETURNING id", [org])).rows[0].id;
  const usr = (await pool.query("INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ('para.ui@demo.arrimo', 'Paramédic UI', $1, 'paramedic') RETURNING id", [hacher(MOT_DE_PASSE_DEMO)])).rows[0].id;
  await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [usr, org]);
  const p = (await pool.query("INSERT INTO passages_chrono (numero, etablissement_id, unite_id, organisation_id, statut, source) VALUES ('CH-900001', $1, $2, $3, 'a_la_porte', 'position') RETURNING id", [ids.mb, u, org])).rows[0].id;
  const c = await pool.connect();
  try { await horloge.marquer(c, { objet: 'passage_chrono', objetId: p, etape: 'H11', heure: new Date(Date.now() - 25 * 60000), source: 'position' }); } finally { c.release(); }
  nav = await chromium.launch();
});
test.after(async () => { await nav?.close(); serveur?.close(); await pool?.end(); });

async function ouvrir(L, langue, email = 'tremblay@demo.arrimo') {
  const ctx = await nav.newContext({ viewport: { width: L.width, height: L.height }, isMobile: !!L.mobile, hasTouch: !!L.mobile });
  const pg = await ctx.newPage(); pg.erreurs = [];
  pg.on('console', (m) => { if (m.type() === 'error') pg.erreurs.push(m.text()); }); pg.on('pageerror', (e) => pg.erreurs.push(String(e)));
  await pg.addInitScript((l) => { try { localStorage.setItem('arrimo-langue', l); } catch { /* */ } }, langue);
  await pg.goto(base); await pg.fill('#c-email', email); await pg.fill('#c-mdp', MOT_DE_PASSE_DEMO); await pg.press('#c-mdp', 'Enter');
  return pg;
}
const debord = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const L of [{ nom: 'ordinateur', width: 1366, height: 800 }, { nom: 'telephone', width: 390, height: 844, mobile: true }]) {
  test(`urgence · ${L.nom} : rouge à 20 min, minutes et mot écrits, « Début triage » au clic, FR puis EN`, { timeout: 120000 }, async () => {
    for (const langue of ['fr', 'en']) {
      const pg = await ouvrir(L, langue);
      await pg.waitForSelector('body[data-pret="1"]');
      if (await pg.locator('#b-premiers-pas-ok').isVisible().catch(() => false)) await pg.click('#b-premiers-pas-ok');
      if (await pg.locator('#b-nav').isVisible().catch(() => false)) await pg.click('#b-nav');
      await pg.evaluate((v) => window.ArrimoEspaces?.reveler(v), 'chrono').then(() => pg.click('#onglets button[data-v="chrono"]'));
      await pg.waitForSelector('#v-chrono .ch-porte');
      const carte = pg.locator('#v-chrono .ch-porte').first();
      assert.match(await carte.getAttribute('class'), /niveau-rouge/);
      assert.match(await carte.locator('.ch-minutes').innerText(), langue === 'fr' ? /2[5-9] min · au-delà de la cible/ : /2[5-9] min · beyond target/);
      assert.ok(await debord(pg) <= 0, `${L.nom} ${langue} : débordement horizontal`);
      if (langue === 'en') assert.doesNotMatch(await pg.locator('#v-chrono').innerText(), /Début triage|Civière libérée|À la porte|Rapport mensuel/);
      await pg.screenshot({ path: `captures/chrono-${L.nom}-${langue}.png`, fullPage: true }).catch(() => {});
      if (langue === 'fr' && L.nom === 'ordinateur') {
        await pg.click('#v-chrono [data-ch-etape="H12"]');
        await pg.waitForSelector('#v-chrono [data-ch-etape="H13"]');
      }
      assert.deepStrictEqual(pg.erreurs, []);
      await pg.context().close();
    }
  });
}

test('ambulance · téléphone : onglet Chrono, mêmes heures que l’urgence', { timeout: 60000 }, async () => {
  const L = { width: 390, height: 844, mobile: true };
  const ctx = await nav.newContext({ viewport: L, isMobile: true, hasTouch: true }); const pg = await ctx.newPage(); const erreurs = [];
  pg.on('pageerror', (e) => erreurs.push(String(e)));
  const r = await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'para.ui@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO }) })).json();
  await pg.addInitScript((tk) => { try { localStorage.setItem('arrimo-token', tk); localStorage.setItem('arrimo-secours-onglet', 'chrono'); } catch { /* */ } }, r.token);
  await pg.goto(`${base}/secours.html`);
  await pg.waitForSelector('.ch-porte');
  const texte = await pg.locator('.ch-porte').first().innerText();
  assert.match(texte, /77-01/); assert.match(texte, /H12 · Début triage : \d/, 'H12 marquée par l’urgence, visible côté ambulance');
  assert.ok(await debord(pg) <= 0); assert.deepStrictEqual(erreurs, []);
  await ctx.close();
});
