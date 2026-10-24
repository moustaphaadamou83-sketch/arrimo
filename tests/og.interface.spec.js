const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
process.env.DEMO_MOT_DE_PASSE = 'Og-Fixture-2026';
process.env.ARRIMO_DEMO = '1';
delete process.env.COPILOTE_IA_CLE;
delete process.env.SMTP_URL;
const { chromium } = require('playwright');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { demoReseau } = require('../db/demo-reseau');
const routeurTest = require('./routeur-fictif.cjs');
const sortie = path.join(__dirname, '../preuves/og');
let pool; let serveur; let precedent; let navigateur; let url; let avant; let restaurerRouteur;
const largeurs = [{ nom: 'ordinateur', width: 1366, height: 900 }, { nom: 'tablette', width: 820, height: 1180 }, { nom: 'mobile', width: 390, height: 844 }];
async function connexion(adresse, email, L) {
  const contexte = await navigateur.newContext({ viewport: { width: L.width, height: L.height } });
  const page = await contexte.newPage();
  if (L.langue) await page.addInitScript(l => localStorage.setItem('arrimo-langue', l), L.langue);
  page.erreurs = [];
  page.on('pageerror', e => page.erreurs.push(e.message));
  await page.goto(adresse);
  await page.fill('#c-email', email);
  await page.fill('#c-mdp', process.env.DEMO_MOT_DE_PASSE);
  await page.click('#f-connexion button[type=submit]');
  await page.waitForSelector('body[data-pret="1"]');
  await page.waitForFunction(() => !enCours);
  if (await page.locator('#b-premiers-pas-ok').isVisible()) await page.click('#b-premiers-pas-ok');
  return { page, contexte };
}
async function verifierContrasteOg(page) {
  const echecs = await page.locator('#og-panel').evaluate(panel => {
    const rgb = v => (v.match(/[\d.]+/g) || []).map(Number);
    const luminance = c => c.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
    const erreurs = []; const walk = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      const el = node.parentElement; const txt = node.textContent.trim();
      if (!txt || !el.getBoundingClientRect().width) continue;
      const style = getComputedStyle(el); let parent = el; let fond;
      while (parent) { const c = rgb(getComputedStyle(parent).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] === 1)) { fond = c; break; } parent = parent.parentElement; }
      if (!fond) continue;
      const couleurs = [luminance(rgb(style.color)), luminance(fond)].sort((a, b) => b - a);
      const ratio = (couleurs[0] + .05) / (couleurs[1] + .05);
      const grand = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (grand ? 3 : 4.5) - .01) erreurs.push({ texte: txt.slice(0, 35), contraste: ratio });
    }
    return erreurs;
  });
  assert.deepEqual(echecs, [], 'contraste du texte du panneau OG');
}
async function ouvrirOg(page) {
  await page.click('#og-open');
  await page.waitForSelector('#og-panel[open]');
  assert.equal(await page.locator('#og-title').innerText(), 'OG');
}
test.before(async () => {
  restaurerRouteur = routeurTest.activer();
  const db = new URL(process.env.TEST_DATABASE_URL);
  assert.equal(db.hostname, '127.0.0.1');
  assert.match(db.pathname, /^\/arrimo_(?:final|og)_[a-f0-9]{14}$/);
  pool = creerPool(db.href);
  // demoReseau refuse une base déjà peuplée ; aucune réinitialisation ici.
  await demoReseau(pool, { silencieux: true, comptesRoles: true });
  serveur = creerApp(pool).listen(0, '127.0.0.1');
  await new Promise(resolve => serveur.once('listening', resolve));
  url = `http://127.0.0.1:${serveur.address().port}`;
  const reference = process.env.ARRIMO_REFERENCE_AVANT;
  assert.ok(reference, 'Copie de référence requise pour les captures avant/après');
  precedent = require(path.join(reference, 'src/app')).creerApp(pool).listen(0, '127.0.0.1');
  await new Promise(resolve => precedent.once('listening', resolve));
  avant = `http://127.0.0.1:${precedent.address().port}`;
  navigateur = await chromium.launch();
  fs.mkdirSync(sortie, { recursive: true });
});
test.after(async () => { await navigateur?.close(); serveur?.close(); precedent?.close(); await pool?.end(); restaurerRouteur?.(); });
for (const L of largeurs) test(`OG : avant/après, chat, clavier et pages principales · ${L.nom}`, { timeout: 120000 }, async () => {
  const ancien = await connexion(avant, 'hopital.x@demo.arrimo', L);
  await ancien.page.screenshot({ path: path.join(sortie, `${L.nom}-avant.png`), fullPage: true });
  await ancien.page.screenshot({ path: path.join(sortie, `${L.nom}-avant-accueil.png`) });
  await ancien.contexte.close();
  const { page, contexte } = await connexion(url, 'hopital.x@demo.arrimo', L);
  try {
    await page.screenshot({ path: path.join(sortie, `${L.nom}-apres.png`), fullPage: true });
    await page.screenshot({ path: path.join(sortie, `${L.nom}-accueil.png`) });
    const repartition = await page.locator('.capacite-barre').getAttribute('aria-label');
    assert.ok(repartition.includes('Occupé') && repartition.includes('Libre'));
    const pages = ['copilote', 'reseau', 'national', 'lits', 'urgence', 'admissions', 'transferts', 'nettoyage', 'nsa', 'indicateurs', 'journal', 'params'];
    for (const vue of pages) {
      await page.locator(`#onglets button[data-v="${vue}"]`).click();
      await page.waitForFunction(() => !enCours);
      assert.ok(await page.locator('#og-open').isVisible(), `${vue} : accès OG`);
      await ouvrirOg(page);
      const limites = await page.locator('#og-panel').evaluate(el => {
        const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
      });
      assert.ok(limites, `${vue} : panneau dans l'écran`);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement.id === 'og-open');
    }
    await page.click('#b-menu'); await page.click('#b-compte');
    await page.waitForFunction(() => !enCours);
    await ouvrirOg(page);
    await page.screenshot({ path: path.join(sortie, `${L.nom}-og-accueil.png`) });
    await page.locator('#og-actions button').filter({ hasText: 'Mes priorités' }).click();
    await page.waitForSelector('#og-messages .og-source');
    assert.ok((await page.locator('#og-messages').innerText()).includes('Règles locales'));
    await verifierContrasteOg(page);
    await page.screenshot({ path: path.join(sortie, `${L.nom}-og-priorites.png`) });
    await page.fill('#og-question', 'Quel traitement dois-je prescrire ?');
    await page.click('#og-envoyer');
    await page.waitForFunction(() => document.querySelector('#og-messages').textContent.includes('aucun traitement ni diagnostic'));
    await page.screenshot({ path: path.join(sortie, `${L.nom}-og.png`) });
    await page.keyboard.press('Escape');
    await page.locator('#onglets button[data-v="copilote"]').click();
    await page.waitForFunction(() => !enCours);
    assert.deepEqual(page.erreurs, []);
  } finally { await contexte.close(); }
});
test('OG : entretien limité au nettoyage, sans appel aux API du copilote', async () => {
  const { page, contexte } = await connexion(url, 'entretien.x@demo.arrimo', largeurs[2]);
  const appels = [];
  page.on('request', r => { if (r.url().includes('/api/')) appels.push(new URL(r.url()).pathname); });
  try {
    await ouvrirOg(page);
    await page.fill('#og-question', 'Priorités de nettoyage'); await page.click('#og-envoyer');
    await page.waitForSelector('#og-messages .og-source');
    assert.ok(appels.includes('/api/nettoyage'));
    assert.ok(appels.every(p => p === '/api/nettoyage'), 'aucun endpoint hors rôle');
    await page.fill('#og-question', 'Combien de patients en attente ?'); await page.click('#og-envoyer');
    await page.waitForFunction(() => document.querySelector('#og-messages').textContent.includes('limitée à votre file'));
    assert.ok(appels.every(p => p === '/api/nettoyage'));
    assert.equal(await page.locator('#og-actions button').count(), 2);
    await page.screenshot({ path: path.join(sortie, 'mobile-og-entretien.png') });
  } finally { await contexte.close(); }
});
test('OG : aucune réponse périmée après changement d’établissement ou déconnexion', async () => {
  const { page, contexte } = await connexion(url, 'reseau@demo.arrimo', largeurs[0]);
  try {
    await page.route('**/api/copilote/question', async route => {
      const r = await route.fetch(); await new Promise(resolve => setTimeout(resolve, 600)); await route.fulfill({ response: r });
    });
    await ouvrirOg(page);
    await page.fill('#og-question', 'Contexte précédent 4242'); await page.click('#og-envoyer');
    await page.click('#og-close');
    const options = await page.locator('#ctx option').evaluateAll(nodes => nodes.map(n => n.value));
    const courant = await page.locator('#ctx').inputValue();
    await page.selectOption('#ctx', options.find(x => x !== courant));
    await page.waitForFunction(() => !enCours);
    await ouvrirOg(page);
    await page.waitForTimeout(800);
    assert.equal(await page.locator('#og-messages .og-message').count(), 1);
    assert.ok(!(await page.locator('#og-messages').innerText()).includes('4242'));
    await page.evaluate(() => deconnecter(false));
    assert.ok(!(await page.locator('#og-panel').evaluate(el => el.open)));
    assert.equal(await page.locator('#og-messages').innerText(), '');
    assert.ok(!(await page.locator('#og-open').isVisible()));
  } finally { await contexte.close(); }
});

test('OG : panneau et chat en anglais, focus clavier contenu dans le dialogue', async () => {
  const { page, contexte } = await connexion(url, 'hopital.y@demo.arrimo', { ...largeurs[1], langue: 'en' });
  try {
    await ouvrirOg(page);
    assert.match(await page.locator('#og-messages').innerText(), /Hello/);
    assert.match(await page.locator('.og-confidentialite').innerText(), /Only data authorized/);
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => !!document.activeElement.closest('#og-panel')));
    }
    await page.locator('#og-actions button').filter({ hasText: 'My priorities' }).click();
    await page.waitForSelector('#og-messages .og-source');
    assert.match(await page.locator('#og-messages .og-source').last().innerText(), /Local rules/);
    await verifierContrasteOg(page);
    await page.screenshot({ path: path.join(sortie, 'tablette-og-anglais.png') });
    let appelsCliniques = 0;
    page.on('request', r => { if (r.url().includes('/api/copilote/question')) appelsCliniques++; });
    await page.fill('#og-question', 'What diagnosis should I make?'); await page.click('#og-envoyer');
    await page.waitForFunction(() => document.querySelector('#og-messages').textContent.includes('treatment or diagnoses'));
    assert.equal(appelsCliniques, 0, 'la question clinique ne déclenche pas un appel au copilote');
  } finally { await contexte.close(); }
});
