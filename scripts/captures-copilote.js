/**
 * Captures du Copilote de l'Hôpital X (français et anglais sur ordinateur, français sur téléphone), pour comparer avant/après.
 *   TEST_DATABASE_URL=postgres:///arrimo_dev_test node scripts/captures-copilote.js <étiquette>
 * Résultat : captures/copilote-<étiquette>/<langue>-<largeur>.png (écran) et -page.png (page entière).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { demoReseau } = require('../db/demo-reseau');

const MDP = process.env.DEMO_MOT_DE_PASSE || 'Demo-Arrimo-2026';

(async () => {
  const dossier = path.join(__dirname, '..', 'captures', `copilote-${process.argv[2] || 'captures'}`);
  fs.mkdirSync(dossier, { recursive: true });
  process.env.ARRIMO_DEMO = '1';
  const pool = creerPool(process.env.TEST_DATABASE_URL);
  await viderBase(pool);
  await demoReseau(pool, { silencieux: true });
  await pool.query('UPDATE utilisateurs SET premiers_pas_vus = true');
  const serveur = creerApp(pool).listen(0);
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const nav = await chromium.launch();
  for (const [langue, L] of [['fr', { nom: 'ordinateur', width: 1366, height: 900 }], ['en', { nom: 'ordinateur', width: 1366, height: 900 }],
    ['fr', { nom: 'telephone', width: 390, height: 844, mobile: true }]]) {
    const ctx = await nav.newContext({ viewport: { width: L.width, height: L.height }, isMobile: !!L.mobile, hasTouch: !!L.mobile, bypassCSP: true });
    const p = await ctx.newPage();
    await p.addInitScript((l) => { try { localStorage.setItem('arrimo-langue', l); } catch { /* */ } }, langue);
    await p.goto(base);
    await p.fill('#c-email', 'hopital.x@demo.arrimo'); await p.fill('#c-mdp', MDP);
    await p.click('#f-connexion button[type=submit]');
    await p.waitForSelector('#v-copilote .recos');
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(dossier, `${langue}-${L.nom}.png`) });
    await p.screenshot({ path: path.join(dossier, `${langue}-${L.nom}-page.png`), fullPage: true });
    // Après l'ajustement : listes dépliées pour montrer le détail d'un regroupement
    const deplier = p.locator('#v-copilote details.groupe summary').first();
    if (await deplier.count()) {
      await deplier.click();
      await p.waitForTimeout(200);
      await p.locator('#v-copilote details.groupe').first().scrollIntoViewIfNeeded();
      await p.screenshot({ path: path.join(dossier, `${langue}-${L.nom}-groupe.png`) });
    }
    await ctx.close();
  }
  await nav.close(); serveur.close(); await pool.end();
  console.log(`Captures dans ${dossier}`);
})().catch((e) => { console.error(e); process.exit(1); });
