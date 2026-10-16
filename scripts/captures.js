/**
 * Captures de comparaison (avant/après) : Copilote, Indicateurs, Lits, Admissions, Nettoyage,
 * en français et en anglais, sur ordinateur et sur téléphone.
 *   TEST_DATABASE_URL=postgres:///arrimo_dev_test node scripts/captures.js <étiquette>
 * Résultat : captures/<étiquette>/<langue>-<largeur>-<écran>.png. La base de test est remise à la démo X / Y.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { demoDeux } = require('../db/demo-deux');

const MDP = process.env.DEMO_MOT_DE_PASSE || 'Demo-Arrimo-2026';
const LARGEURS = [{ nom: 'ordinateur', width: 1366, height: 860 }, { nom: 'telephone', width: 390, height: 844, mobile: true }];
const ECRANS = ['copilote', 'indicateurs', 'lits', 'admissions'];

(async () => {
  const etiquette = process.argv[2] || 'captures';
  const dossier = path.join(__dirname, '..', 'captures', etiquette);
  fs.mkdirSync(dossier, { recursive: true });
  process.env.ARRIMO_DEMO = '1';
  const pool = creerPool(process.env.TEST_DATABASE_URL);
  await viderBase(pool);
  await demoDeux(pool, { silencieux: true });
  await pool.query('UPDATE utilisateurs SET premiers_pas_vus = true');
  const serveur = creerApp(pool).listen(0);
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const nav = await chromium.launch();
  const ouvrir = async (L, langue, email) => {
    const ctx = await nav.newContext({ viewport: { width: L.width, height: L.height }, isMobile: !!L.mobile, hasTouch: !!L.mobile, bypassCSP: true });
    const page = await ctx.newPage();
    await page.addInitScript((l) => { try { localStorage.setItem('arrimo-langue', l); } catch { /* */ } }, langue);
    await page.goto(base);
    await page.fill('#c-email', email); await page.fill('#c-mdp', MDP);
    await page.click('#f-connexion button[type=submit]');
    await page.waitForSelector('body[data-pret="1"]');
    return page;
  };
  for (const langue of ['fr', 'en']) {
    for (const L of LARGEURS) {
      const p = await ouvrir(L, langue, 'coordo.x@demo.arrimo');
      for (const e of ECRANS) {
        await p.click(`#onglets [data-v="${e}"]`);
        await p.waitForFunction((v) => document.querySelector(`#v-${v}`).children.length > 0 && !document.querySelector(`#v-${v}`).hidden, e);
        await p.waitForTimeout(250);
        await p.screenshot({ path: path.join(dossier, `${langue}-${L.nom}-${e}.png`), fullPage: L.nom === 'ordinateur' });
      }
      await p.context().close();
    }
    const e = await ouvrir(LARGEURS[1], langue, 'entretien.x@demo.arrimo');
    await e.waitForSelector('#v-nettoyage .net-item');
    await e.screenshot({ path: path.join(dossier, `${langue}-telephone-nettoyage.png`) });
    await e.context().close();
  }
  await nav.close();
  serveur.close();
  await pool.end();
  console.log(`Captures dans ${dossier}`);
})().catch((e) => { console.error(e); process.exit(1); });
