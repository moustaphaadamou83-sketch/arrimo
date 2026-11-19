'use strict';
/** Page publique « Urgences en direct » dans Chromium (démonstration) : téléphone, FR puis EN, 911 visible, « non à jour », aucune erreur. */
const test = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed } = require('../db/seed');

let pool; let serveur; let base; let nav; const avant = process.env.ARRIMO_ENV;
test.before(async () => {
  require('./routeur-fictif.cjs').activer(); process.env.ARRIMO_ENV = 'demo';
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"urgences_direct": true}', urgence_statut_declare = 'ouvert', urgence_statut_le = now() WHERE code = 'MB'`);
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"urgences_direct": true}', urgence_statut_declare = 'fermee_temporairement', urgence_statut_le = now(), reouverture_prevue_le = now() + interval '3 hours' WHERE code = 'SL'`);
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"urgences_direct": true}', urgence_statut_declare = 'ouvert', urgence_statut_le = now() - interval '5 hours' WHERE code = 'LM'`);
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  nav = await chromium.launch();
});
test.after(async () => { process.env.ARRIMO_ENV = avant; await nav?.close(); serveur?.close(); await pool?.end(); });

test('téléphone : FR puis EN, 911, fermée avec réouverture et urgence ouverte la plus proche, « non à jour », sans débordement', { timeout: 60000 }, async () => {
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-CA' }); const pg = await ctx.newPage(); const erreurs = [];
  pg.on('pageerror', (e) => erreurs.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  await pg.goto(`${base}/urgences`); await pg.waitForSelector('.ud-carte');
  assert.match(await pg.textContent('#ud-vital'), /appelez le 911/);
  const texte = await pg.textContent('#ud-liste');
  assert.match(texte, /Fermée temporairement/); assert.match(texte, /Réouverture prévue/); assert.match(texte, /Urgence ouverte la plus proche/); assert.match(texte, /Non à jour/);
  assert.match(await pg.textContent('#ud-licence'), /CC-BY 4\.0/);
  assert.ok((await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
  await pg.screenshot({ path: 'captures/urgences-direct-telephone-fr.png', fullPage: true }).catch(() => {});
  await pg.click('[data-ud-langue="en"]');
  assert.match(await pg.textContent('#ud-vital'), /call 911/);
  const en = await pg.textContent('main');
  assert.match(en, /Temporarily closed/); assert.match(en, /Not up to date/);
  assert.doesNotMatch(en.replace(/Hôpital[^\n]*|Saint-Laurent|Mont-Bellevue|Lac-Mégantic|Sherbrooke|Québec/g, ''), /Fermée|Réouverture|Mis à jour|Démonstration|Autres options/);
  await pg.screenshot({ path: 'captures/urgences-direct-telephone-en.png', fullPage: true }).catch(() => {});
  assert.deepStrictEqual(erreurs, []);
  await ctx.close();
});
