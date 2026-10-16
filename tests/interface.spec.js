/**
 * Test de l'interface dans un vrai navigateur (Chromium, Playwright).
 * Suit GUIDE-DEMO.md avec les comptes X, Y, entretien et réseau, en largeur ordinateur, tablette et téléphone.
 * À chaque écran : capture dans captures/<largeur>/, aucun débordement horizontal, modales à l'écran,
 * boutons d'au moins 40 px sur téléphone, aucune erreur dans la console.
 *
 *   TEST_DATABASE_URL=postgres:///arrimo_dev_test npm run test:interface
 * La base de test est effacée et recréée (démo Hôpital X / Hôpital Y) pour chaque largeur.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { demoDeux } = require('../db/demo-deux');
const totp = require('../src/totp');

const URL_TEST = process.env.INTERFACE_DATABASE_URL || process.env.TEST_DATABASE_URL;
const MDP = process.env.DEMO_MOT_DE_PASSE || 'Demo-Arrimo-2026';
const LARGEURS = [
  { nom: 'ordinateur', width: 1366, height: 800 },
  { nom: 'tablette', width: 820, height: 1180, tactile: true },
  { nom: 'telephone', width: 390, height: 844, tactile: true, mobile: true },
];
const DOSSIER = path.join(__dirname, '..', 'captures');

let pool; let serveur; let base; let navigateur;

test.before(async () => {
  assert.ok(URL_TEST, 'TEST_DATABASE_URL requis');
  pool = creerPool(URL_TEST);
  serveur = creerApp(pool).listen(0);
  base = `http://127.0.0.1:${serveur.address().port}`;
  navigateur = await chromium.launch();
});
test.after(async () => { await navigateur?.close(); serveur?.close(); await pool?.end(); });

/** Ouvre une session dans un contexte de navigateur séparé (un utilisateur = une fenêtre). */
async function ouvrir(L, email, langue) {
  const ctx = await navigateur.newContext({ viewport: { width: L.width, height: L.height }, hasTouch: !!L.tactile, isMobile: !!L.mobile, acceptDownloads: true, bypassCSP: true });
  const page = await ctx.newPage();
  page.erreurs = [];
  page.on('console', (m) => { if (m.type() === 'error') page.erreurs.push(m.text()); });
  page.on('pageerror', (e) => page.erreurs.push(String(e)));
  if (langue) await page.addInitScript((l) => { try { localStorage.setItem('arrimo-langue', l); } catch { /* */ } }, langue);
  await page.goto(base);
  await page.fill('#c-email', email);
  await page.fill('#c-mdp', MDP);
  await page.click('#f-connexion button[type=submit]');
  await page.waitForSelector('#ecran-app:not([hidden])');
  await fermerPremiersPas(page);
  return page;
}
async function fermerPremiersPas(page) {
  const b = page.locator('#b-premiers-pas-ok');
  if (await b.isVisible().catch(() => false)) await b.click();
}

async function onglet(page, vue) {
  await page.click(`#onglets button[data-v="${vue}"]`);
  await page.waitForFunction((v) => !document.querySelector(`#v-${v}`).hidden && document.querySelector(`#v-${v}`).children.length > 0, vue);
  await page.waitForTimeout(150);
}
async function toast(page, texte) {
  await page.locator('.toast', { hasText: texte }).first().waitFor({ timeout: 8000 });
}

/** Contrôles communs à chaque écran, puis capture. */
async function verifier(page, L, nom) {
  const mesures = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const debordent = [];
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // Les éléments dans une zone à défilement horizontal voulu (kanban, tableaux, onglets) sont exclus
      if (el.closest('.kanban, .tableau, .onglets')) return;
      if (r.right > vw + 1 || r.left < -1) debordent.push(`${el.tagName.toLowerCase()}.${el.className} (${Math.round(r.left)}→${Math.round(r.right)})`);
    });
    const boutons = [...document.querySelectorAll('button, .btn, select, input:not([type=checkbox]):not([type=radio])')]
      .filter((b) => b.offsetParent !== null && !b.closest('[hidden]'))
      .map((b) => ({ h: b.getBoundingClientRect().height, t: (b.textContent || b.id || b.name || '').trim().slice(0, 30) }));
    const m = document.querySelector('#modale:not([hidden]) .boite');
    const boite = m ? m.getBoundingClientRect() : null;
    return { page: document.documentElement.scrollWidth, vw, debordent: debordent.slice(0, 5), boutons,
      boite: boite && { haut: boite.top, bas: boite.bottom, gauche: boite.left, droite: boite.right, vh: window.innerHeight } };
  });
  assert.ok(mesures.page <= mesures.vw, `${L.nom}/${nom} : la page déborde horizontalement (${mesures.page} > ${mesures.vw}) ${mesures.debordent.join(', ')}`);
  assert.deepStrictEqual(mesures.debordent, [], `${L.nom}/${nom} : éléments hors de l'écran`);
  if (mesures.boite) {
    const b = mesures.boite;
    assert.ok(b.haut >= 0 && b.bas <= b.vh && b.gauche >= 0 && b.droite <= mesures.vw, `${L.nom}/${nom} : la modale dépasse de l'écran ${JSON.stringify(b)}`);
  }
  if (L.mobile) {
    const petits = mesures.boutons.filter((b) => b.h < 40);
    assert.deepStrictEqual(petits, [], `${L.nom}/${nom} : boutons de moins de 40 px`);
  }
  assert.deepStrictEqual(page.erreurs, [], `${L.nom}/${nom} : erreurs dans la console`);
  const dossier = path.join(DOSSIER, L.nom);
  fs.mkdirSync(dossier, { recursive: true });
  await page.screenshot({ path: path.join(dossier, `${nom}.png`) });                          // ce que l'on voit à l'écran
  await page.screenshot({ path: path.join(dossier, `${nom}-page.png`), fullPage: true });    // la page entière
}

for (const L of LARGEURS) {
  test(`guide de démonstration complet · ${L.nom} (${L.width} px)`, { timeout: 240000 }, async () => {
    for (const c of navigateur.contexts()) await c.close();   // fenêtres d'un essai précédent
    await viderBase(pool);
    await demoDeux(pool, { silencieux: true });

    // 0. Écran de connexion
    const accueil = await (await navigateur.newContext({ viewport: { width: L.width, height: L.height }, isMobile: !!L.mobile, hasTouch: !!L.tactile })).newPage();
    accueil.erreurs = [];
    await accueil.goto(base);
    await accueil.waitForSelector('#ecran-connexion:not([hidden])');
    await verifier(accueil, L, '00-connexion');
    await accueil.context().close();

    // 1. Le problème : Copilote de l'Hôpital X
    const x = await ouvrir(L, 'coordo.x@demo.arrimo');
    await x.waitForSelector('#v-copilote .niveau');
    assert.match(await x.textContent('#v-copilote .niveau'), /Rouge|Orange/);
    await verifier(x, L, '01-copilote-x');

    // 2. Le Copilote propose, l'humain décide : assigner le lit de maternité
    const reco = x.locator('.reco', { hasText: 'maternité' }).first();
    await reco.locator('button').click();
    await toast(x, 'Lit assigné');
    await x.click('#v-copilote [data-ex="0"]');
    await x.waitForSelector('#v-copilote .reponse');
    await x.click('#v-copilote [data-ex="3"]');
    await x.waitForFunction(() => /NSA/.test(document.querySelector('#v-copilote .reponse')?.textContent || ''));
    await verifier(x, L, '02-copilote-questions');

    // 3. Transfert X → Y : patient P1 qui a besoin d'isolement
    await onglet(x, 'admissions');
    await verifier(x, L, '03-admissions-x');
    const carte = x.locator('#v-admissions .fiche', { hasText: 'isolement' }).first();
    await carte.locator('[data-a="ailleurs"]').click();
    await x.waitForSelector('#modale:not([hidden])');
    assert.match(await x.textContent('#modale'), /Hôpital Y/);
    await verifier(x, L, '04-chercher-ailleurs');
    await x.click('#modale .btn.pri');
    await toast(x, 'envoyée');

    const y = await ouvrir(L, 'coordo.y@demo.arrimo');
    await onglet(y, 'transferts');
    await verifier(y, L, '05-transferts-y');
    await y.locator('#v-transferts [data-etape="accepter"]').first().click();
    await toast(y, 'validé');
    await onglet(x, 'transferts');
    await x.waitForSelector('#v-transferts [data-etape="transport"]');
    await verifier(x, L, '06-transferts-x');

    // 4. Les lits qui ne tournent pas : nettoyage par l'entretien (tablette), NSA, lits fermés
    const e = await ouvrir(L, 'entretien.x@demo.arrimo');
    await e.waitForSelector('#v-nettoyage .net-item');
    if (L.tactile) {
      // Utilisable d'une main : grandes cibles, actions à portée du pouce (à droite)
      const tailles = await e.$$eval('#v-nettoyage .net-item .btn', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { h: r.height, w: r.width, droite: r.right }; }));
      assert.ok(tailles.every((t) => t.h >= 48 && t.w >= 120), `Nettoyage : boutons trop petits pour le tactile ${JSON.stringify(tailles)}`);
    }
    await verifier(e, L, '07-nettoyage-entretien');
    const premier = e.locator('#v-nettoyage .net-item').first();
    const debut = premier.locator('[data-debut]');
    if (await debut.count()) { await debut.click(); await toast(e, 'commencé'); }
    await e.locator('#v-nettoyage .net-item').first().locator('[data-fini]').click();
    await toast(e, 'est prêt');
    await verifier(e, L, '08-nettoyage-termine');

    await onglet(x, 'nsa');
    assert.match(await x.textContent('#v-nsa'), /cible 8 %/);
    await verifier(x, L, '09-nsa');
    await onglet(x, 'lits');
    assert.match(await x.textContent('#v-lits'), /Manque de personnel/);
    await verifier(x, L, '10-lits');
    await x.locator('#v-lits [data-action="reserver"]').first().click();
    await x.waitForSelector('#modale:not([hidden]) #m-pat');
    await verifier(x, L, '11-modale-reserver');
    await x.keyboard.press('Escape');

    // 5. La preuve : indicateurs et export
    await onglet(x, 'indicateurs');
    const [telechargement] = await Promise.all([x.waitForEvent('download'), x.click('#b-csv')]);
    assert.match(telechargement.suggestedFilename(), /\.csv$/);
    await verifier(x, L, '12-indicateurs');
    await onglet(x, 'reseau');
    await verifier(x, L, '13-reseau');
    await onglet(x, 'journal');
    await verifier(x, L, '14-journal');
    await onglet(x, 'params');
    await verifier(x, L, '15-parametres');
    await x.click('#b-notif');
    await x.waitForSelector('#panneau-notif:not([hidden])');
    await verifier(x, L, '16-notifications');
    await x.click('#b-fermer-notif');

    // 6. Le réseau
    const r = await ouvrir(L, 'reseau@demo.arrimo');
    await r.waitForSelector('#v-copilote .niveau');
    await verifier(r, L, '17-copilote-reseau');

    // 7. La sécurité : double authentification exigée, puis création d'un compte
    await onglet(r, 'admin');
    assert.match(await r.textContent('#v-admin'), /double authentification/i);
    await r.click('#b-vers-compte');
    await r.click('#b-2fa-prep');
    await r.waitForSelector('#a-code');
    await verifier(r, L, '18-activation-2fa');
    const secret = (await r.textContent('#zone-2fa .mono')).trim();
    await r.fill('#a-code', totp.codePourPas(secret, totp.pasActuel()));
    await r.click('#b-2fa-ok');
    await toast(r, 'activée');
    await onglet(r, 'admin');
    await r.waitForSelector('#b-creer-compte');
    await verifier(r, L, '19-administration');
    await r.fill('#n-nom', 'Compte de démonstration');
    await r.fill('#n-email', `essai.${L.nom}@demo.arrimo`);
    await r.click('#b-creer-compte');
    await r.waitForSelector('#modale:not([hidden])');
    await verifier(r, L, '20-mot-de-passe-temporaire');
    await r.click('#modale .btn.pri');
    await r.click('[data-ao="journal"]');
    await r.waitForSelector('#admin-corps table');
    await verifier(r, L, '21-journal-administration');
    await r.click('#b-compte');
    await r.waitForSelector('#f-mdp');
    await verifier(r, L, '22-mon-compte');

    for (const p of [x, y, e, r]) await p.context().close();
  });
}
