/**
 * Captures des écrans ajoutés par B10 à B14, avant mise en ligne :
 * Transferts (chambre prête, heure d'arrivée), National (liste et carte), bandeau « disponibilité à côté », Copilote (prévisions).
 *   TEST_DATABASE_URL=postgres:///arrimo_dev_test node scripts/captures-b10-b14.js
 * Résultat : captures/b10-b14/<langue>-<largeur>-<écran>.png. La base de test est remise à la démo (réseau de 20 hôpitaux).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { creerPool, transaction } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { demoReseau } = require('../db/demo-reseau');
const { changerEtat } = require('../src/regles');

const MDP = process.env.DEMO_MOT_DE_PASSE || 'Demo-Arrimo-2026';
const LARGEURS = [{ nom: 'ordinateur', width: 1366, height: 900 }, { nom: 'telephone', width: 390, height: 844, mobile: true }];

(async () => {
  const dossier = path.join(__dirname, '..', 'captures', 'b10-b14');
  fs.mkdirSync(dossier, { recursive: true });
  process.env.ARRIMO_DEMO = '1';
  const pool = creerPool(process.env.TEST_DATABASE_URL);
  const serveur = creerApp(pool).listen(0);
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const nav = await chromium.launch();
  const ouvrir = async (L, langue, email) => {
    const ctx = await nav.newContext({ viewport: { width: L.width, height: L.height }, isMobile: !!L.mobile, hasTouch: !!L.mobile, bypassCSP: true });
    const page = await ctx.newPage();
    await page.addInitScript((l) => { try { localStorage.setItem('arrimo-langue', l); } catch { /* */ } window.ARRIMO_VEILLE_MS = 1000; }, langue);
    await page.goto(base);
    await page.fill('#c-email', email); await page.fill('#c-mdp', MDP);
    await page.click('#f-connexion button[type=submit]');
    await page.waitForSelector('body[data-pret="1"]');
    return page;
  };
  const onglet = async (p, v) => {
    await p.click(`#onglets [data-v="${v}"]`);
    await p.waitForFunction((x) => document.querySelector(`#v-${x}`).children.length > 0 && !document.querySelector(`#v-${x}`).hidden, v);
    await p.waitForTimeout(300);
  };
  const capture = (p, nom, plein = false) => p.screenshot({ path: path.join(dossier, `${nom}.png`), fullPage: plein });

  for (const langue of ['fr', 'en']) {
    for (const L of LARGEURS) {
      if (langue === 'en' && L.mobile) continue;   // anglais : ordinateur seulement
      const pre = `${langue}-${L.nom}`;
      await viderBase(pool);
      await demoReseau(pool, { silencieux: true });
      await pool.query('UPDATE utilisateurs SET premiers_pas_vus = true');

      // 1. Copilote de l'Hôpital X : vue d'ensemble et prévisions
      const x = await ouvrir(L, langue, 'hopital.x@demo.arrimo');
      await x.waitForSelector('#v-copilote .ensemble');
      await capture(x, `${pre}-1-copilote-previsions`, true);

      // 2. Disponibilité à côté : un lit de médecine se libère à 5 km ; bandeau en direct chez X
      const lit = (await pool.query(`SELECT l.id FROM lits l JOIN etablissements e ON e.id = l.etablissement_id JOIN types_unite t ON t.id = l.type_id
        WHERE e.code = 'HA' AND t.code = 'MED' AND l.etat = 'occupe' AND l.nsa_depuis IS NULL LIMIT 1`)).rows[0];
      await transaction(pool, (c) => changerEtat(c, pool, null, lit.id, 'nettoyage', {}));
      await transaction(pool, (c) => changerEtat(c, pool, null, lit.id, 'libre', {}));
      await x.waitForSelector('#bandeau-dispo:not([hidden])', { timeout: 15000 });
      await x.evaluate(() => window.scrollTo(0, 0));
      await capture(x, `${pre}-2-disponibilite-a-cote`);

      // 3. National : liste filtrée (médecine, avec lit libre), puis carte
      await x.click('#b-dispo-fermer');
      await onglet(x, 'national');
      await x.selectOption('#n-type', { index: 2 });
      await x.waitForSelector('#n-libre:not([disabled])');
      await x.check('#n-libre');
      await x.waitForSelector('#v-national [data-ici]');
      await capture(x, `${pre}-3-national-liste`, !L.mobile);
      await x.click('[data-nv="carte"]');
      await x.waitForSelector('.leaflet-interactive');
      await x.waitForTimeout(2500);
      await capture(x, `${pre}-4-national-carte`);
      await x.context().close();

      // 4. Transferts de l'Hôpital Y : accepter, « Chambre prête », heure d'arrivée et compte à rebours
      const y = await ouvrir(L, langue, 'hopital.y@demo.arrimo');
      await onglet(y, 'transferts');
      await y.locator('#v-transferts [data-etape="accepter"]').first().click();
      await y.waitForSelector('#v-transferts [data-etape="chambre_prete"]');
      await y.waitForTimeout(400);
      await capture(y, `${pre}-5-transferts-chambre-a-preparer`, !L.mobile);
      await y.locator('#v-transferts [data-etape="chambre_prete"]').first().click();
      await y.locator('.toast').first().waitFor();
      await y.waitForTimeout(600);
      await capture(y, `${pre}-6-transferts-chambre-prete`, !L.mobile);
      await y.context().close();
    }
  }
  await nav.close();
  serveur.close();
  await pool.end();
  console.log(`Captures dans ${dossier}`);
})().catch((e) => { console.error(e); process.exit(1); });
