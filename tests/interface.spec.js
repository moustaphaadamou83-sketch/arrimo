const { demarrerServeur } = require('./serveur-test.cjs');
const { allerOnglet } = require('./aide-navigation.cjs');
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
const { demoReseau } = require('../db/demo-reseau');
const totp = require('../src/totp');
const routeurTest = require('./routeur-fictif.cjs');

const URL_TEST = process.env.INTERFACE_DATABASE_URL || process.env.TEST_DATABASE_URL;
const MDP = process.env.DEMO_MOT_DE_PASSE || 'Demo-Arrimo-2026';
// Météo de l'en-tête : fournisseur externe coupé pour des captures reproductibles (testée à part, tests/meteo.test.cjs).
process.env.ARRIMO_METEO = '0';
const LARGEURS_COMPLETES = [
  { nom: 'ordinateur', width: 1366, height: 800 },
  { nom: 'tablette', width: 820, height: 1180, tactile: true },
  { nom: 'telephone', width: 390, height: 844, tactile: true, mobile: true },
];
const LARGEURS = process.env.ARRIMO_UI_RAPIDE === '1' ? [LARGEURS_COMPLETES[0]] : LARGEURS_COMPLETES;
const DOSSIER = path.join(__dirname, '..', 'captures');

let pool; let serveur; let base; let navigateur; let restaurerRouteur;

test.before(async () => {
  assert.ok(URL_TEST, 'TEST_DATABASE_URL requis');
  restaurerRouteur = routeurTest.activer();
  process.env.ARRIMO_DEMO = '1';   // serveur de démonstration : bandeau et remise à zéro
  pool = creerPool(URL_TEST);
  serveur = await demarrerServeur(creerApp(pool));
  base = `http://127.0.0.1:${serveur.address().port}`;
  navigateur = await chromium.launch();
});
test.after(async () => { await navigateur?.close(); serveur?.close(); await pool?.end(); restaurerRouteur?.(); });

/** Ouvre une session dans un contexte de navigateur séparé (un utilisateur = une fenêtre). */
async function ouvrir(L, email, langue) {
  const ctx = await navigateur.newContext({ viewport: { width: L.width, height: L.height }, hasTouch: !!L.tactile, isMobile: !!L.mobile, acceptDownloads: true, bypassCSP: true });
  const page = await ctx.newPage();
  page.erreurs = [];
  page.on('console', (m) => { if (m.type() === 'error') page.erreurs.push(m.text()); });
  page.on('pageerror', (e) => page.erreurs.push(String(e)));
  if (langue) await page.addInitScript((l) => { try { localStorage.setItem('arrimo-langue', l); } catch { /* */ } }, langue);
  await page.addInitScript(() => { window.ARRIMO_VEILLE_MS = 1000; });   // notifications en direct : vérifiées chaque seconde pendant le test
  await page.goto(base);
  await page.fill('#c-email', email);
  await page.fill('#c-mdp', MDP);
  await page.click('#f-connexion button[type=submit]');
  await page.waitForSelector('body[data-pret="1"]');
  await fermerPremiersPas(page);
  return page;
}
async function fermerPremiersPas(page) {
  const b = page.locator('#b-premiers-pas-ok');
  if (await b.isVisible().catch(() => false)) await b.click();
}

/** L'aide du rôle connecté : un bloc pour chaque onglet visible, l'écran actuel ouvert. */
async function verifierAide(page, L, nom, role) {
  await menu(page, '#b-aide');
  await page.waitForSelector('#panneau-aide:not([hidden]) .aide-role');
  assert.strictEqual(await page.getAttribute('#panneau-aide .aide-role', 'data-role'), role);
  const onglets = await page.$$eval('#onglets button', (bs) => bs.filter((b) => !b.hidden).map((b) => b.dataset.v));
  const aides = await page.$$eval('#panneau-aide [data-aide]', (ds) => ds.map((d) => d.dataset.aide));
  for (const o of [...onglets, 'compte']) assert.ok(aides.includes(o), `${nom} : aide de l'écran ${o}`);
  assert.ok(await page.isVisible('#panneau-aide details[open] ol li'), `${nom} : l'écran actuel est expliqué`);
  await verifier(page, L, nom);
  await page.click('#b-fermer-aide');
}

/** Ouvre le menu du compte (aide, mon compte, langue, déconnexion) puis choisit un élément. */
async function menu(page, element) {
  await page.click('#b-menu');
  await page.waitForSelector('#menu-compte:not([hidden])');
  await page.click(element);
}

async function onglet(page, vue) {
  if (process.env.SH_RECETTE_FILTRE) page.on('pageerror', (e) => console.log('ERREUR PAGE', vue, String(e).slice(0, 300)));
  // Journal et Support client ne sont plus dans la barre principale : on y va par Paramètres, comme un utilisateur.
  if (await page.locator(`#onglets button[data-v="${vue}"].hors-menu`).count()) {
    await allerOnglet(page, 'params');
    await page.waitForSelector('#v-params [data-param-nav]');
    await page.click(`#v-params [data-param-nav="${vue}"]`);
  } else await allerOnglet(page, vue);
  // 60 s : sur un serveur partagé chargé, certaines vues dépassent ponctuellement 30 s (aucune erreur, rendu seulement plus lent).
  await page.waitForFunction((v) => !document.querySelector(`#v-${v}`).hidden && document.querySelector(`#v-${v}`).children.length > 0, vue, { timeout: 60000 }).catch(async (e) => {
    if (process.env.SH_RECETTE_FILTRE) console.log('DIAGNOSTIC', vue, JSON.stringify(await page.evaluate((v) => ({ cache: document.querySelector(`#v-${v}`).hidden, enfants: document.querySelector(`#v-${v}`).children.length,
      visibles: [...document.querySelectorAll('[id^="v-"]')].filter((x) => !x.hidden).map((x) => x.id), toasts: document.querySelector('#toasts')?.innerText, modale: !document.querySelector('#modale')?.hidden, og: document.querySelector('#og-panel')?.open }), vue)));
    throw e;
  });
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
      // Les tuiles Leaflet hors du cadre sont intentionnellement masquées par le conteneur de carte.
      if (el.matches('.leaflet-tile') && el.closest('.leaflet-container')) return;
      if (r.right > vw + 1 || r.left < -1) debordent.push(`${el.tagName.toLowerCase()}.${el.className} (${Math.round(r.left)}→${Math.round(r.right)})`);
    });
    const boutons = [...document.querySelectorAll('button, .btn, select, input:not([type=checkbox]):not([type=radio])')]
      .filter((b) => b.offsetParent !== null && !b.closest('[hidden]'))
      .map((b) => ({ h: b.getBoundingClientRect().height, t: (b.textContent || b.id || b.name || '').trim().slice(0, 30) }));
    // Textes visibles : aucun « (s) » ; contraste d'au moins 4,5:1 (3:1 pour les grands textes), norme WCAG AA
    const rgb = (c) => { const m = c.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const fondDe = (el) => {
      const couches = [];
      for (let e = el; e; e = e.parentElement) {
        const st = getComputedStyle(e);
        if (st.backgroundImage !== 'none' && !couches.length) return null;      // dégradé ou image : non mesurable
        const c = rgb(st.backgroundColor);
        if (c && c[3] > 0) { couches.push(c); if (c[3] >= 1) break; }
      }
      let fond = [255, 255, 255];
      for (const c of couches.reverse()) fond = fond.map((v, i) => c[i] * c[3] + v * (1 - c[3]));
      return fond;
    };
    const textes = []; const contrastes = [];
    const marche = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = marche.nextNode(); n; n = marche.nextNode()) {
      const el = n.parentElement; const txt = n.textContent.trim();
      if (!txt || !el || el.closest('script, style, [hidden], option')) continue;
      const r0 = el.getBoundingClientRect(); const st = getComputedStyle(el);
      if (!r0.width || st.visibility === 'hidden' || st.display === 'none') continue;
      textes.push(txt);
      if (el.closest('.toast, :disabled, [aria-disabled="true"]')) continue;
      let opaque = true; for (let e = el; e; e = e.parentElement) if (+getComputedStyle(e).opacity < 1) { opaque = false; break; }
      if (!opaque) continue;
      const fond = fondDe(el); const coul = rgb(st.color);
      if (!fond || !coul) continue;
      const c = coul[3] < 1 ? coul.map((v, i) => (i < 3 ? v * coul[3] + fond[i] * (1 - coul[3]) : 1)) : coul;
      const [a, b] = [lum(c), lum(fond)].sort((x, y) => y - x);
      const ratio = (a + 0.05) / (b + 0.05);
      const taille = parseFloat(st.fontSize); const gras = +st.fontWeight >= 700;
      const min = taille >= 24 || (taille >= 18.66 && gras) ? 3 : 4.5;
      if (ratio < min - 0.01) contrastes.push(`« ${txt.slice(0, 40)} » ${ratio.toFixed(2)}:1 (${st.color} sur rgb(${fond.map(Math.round).join(',')}))`);
    }
    const pluriels = textes.filter((x) => /\(s\)|\(e\)|\(es\)/.test(x));
    const m = document.querySelector('#modale:not([hidden]) .boite');
    const boite = m ? m.getBoundingClientRect() : null;
    return { page: document.documentElement.scrollWidth, vw, debordent: debordent.slice(0, 5), boutons, pluriels, contrastes: [...new Set(contrastes)].slice(0, 8),
      boite: boite && { haut: boite.top, bas: boite.bottom, gauche: boite.left, droite: boite.right, vh: window.innerHeight } };
  });
  assert.ok(mesures.page <= mesures.vw, `${L.nom}/${nom} : la page déborde horizontalement (${mesures.page} > ${mesures.vw}) ${mesures.debordent.join(', ')}`);
  assert.deepStrictEqual(mesures.debordent, [], `${L.nom}/${nom} : éléments hors de l'écran`);
  assert.deepStrictEqual(mesures.pluriels, [], `${L.nom}/${nom} : « (s) » dans l'interface`);
  assert.deepStrictEqual(mesures.contrastes, [], `${L.nom}/${nom} : contraste insuffisant (WCAG AA)`);
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
    await demoReseau(pool, { silencieux: true, comptesRoles: true });

    // 0. Écran de connexion
    const accueil = await (await navigateur.newContext({ viewport: { width: L.width, height: L.height }, isMobile: !!L.mobile, hasTouch: !!L.tactile })).newPage();
    accueil.erreurs = [];
    await accueil.goto(base);
    await accueil.waitForSelector('#ecran-connexion:not([hidden])');
    await accueil.waitForSelector('#bandeau-demo:not([hidden])');
    await verifier(accueil, L, '00-connexion');
    // Pages légales depuis l'écran de connexion, sans être connecté
    await accueil.click('#f-connexion .liens-legaux a[href="/confidentialite"]');
    await accueil.waitForSelector('#corps section h2');
    assert.match(await accueil.textContent('#avertissement'), /avocat/);
    assert.ok(await accueil.isVisible('#bandeau-demo'));
    await verifier(accueil, L, '00b-confidentialite');
    await accueil.click('#lien-autre');
    await accueil.waitForURL('**/conditions');
    await accueil.waitForSelector('#corps section h2');
    await verifier(accueil, L, '00c-conditions');
    await accueil.context().close();

    // Premiers pas : montrés à la première connexion seulement
    const pp = await navigateur.newContext({ viewport: { width: L.width, height: L.height }, isMobile: !!L.mobile, hasTouch: !!L.tactile });
    const p1 = await pp.newPage(); p1.erreurs = [];
    await p1.goto(base);
    await p1.fill('#c-email', 'hopital.x@demo.arrimo'); await p1.fill('#c-mdp', MDP);
    await p1.click('#f-connexion button[type=submit]');
    await p1.waitForSelector('#b-premiers-pas-ok');
    await verifier(p1, L, '00-premiers-pas');
    await p1.click('#b-premiers-pas-ok');
    await menu(p1, '#b-deconnexion');
    await p1.fill('#c-email', 'hopital.x@demo.arrimo'); await p1.fill('#c-mdp', MDP);
    await p1.click('#f-connexion button[type=submit]');
    await p1.waitForSelector('body[data-pret="1"]');
    assert.ok(!(await p1.isVisible('#b-premiers-pas-ok')), 'premiers pas montrés une seule fois');
    await pp.close();

    // 1. Le problème : Copilote de l'Hôpital X
    const x = await ouvrir(L, 'hopital.x@demo.arrimo');
    await verifierAide(x, L, '01b-aide-coordination', 'coordonnateur');
    await x.waitForSelector('#v-copilote .niveau');
    assert.match(await x.textContent('#v-copilote .niveau'), /Rouge|Orange/);
    await verifier(x, L, '01-copilote-x');

    // 2. Le Copilote propose, l'humain décide : assigner le lit de maternité
    // Les 5 plus importantes d'abord ; les autres sur demande
    assert.ok(await x.locator('#v-copilote .reco').count() <= 5);
    await x.click('#b-recos-plus');
    await x.waitForFunction(() => document.querySelectorAll('#v-copilote .reco').length > 5);
    await x.locator('#v-copilote details.groupe summary').first().click();
    await verifier(x, L, '01e-copilote-regroupements');
    const reco = x.locator('.reco', { hasText: 'maternité' }).first();
    await reco.locator('button').click();
    await x.waitForSelector('#modale:not([hidden])');
    await x.click('#modale .actions .pri');
    await toast(x, 'Lit assigné');
    await x.click('#v-copilote [data-ex="0"]');
    await x.waitForSelector('#v-copilote .reponse');
    await x.click('#v-copilote [data-ex="3"]');
    await x.waitForFunction(() => /NSA/.test(document.querySelector('#v-copilote .reponse')?.textContent || ''));
    await verifier(x, L, '02-copilote-questions');

    // 1 bis. Disponibilité à côté : un lit de médecine se libère à 5 km ; X est avisé en direct, sans recharger la page
    const { transaction } = require('../src/db');
    const { changerEtat } = require('../src/regles');
    const litHA = (await pool.query(`SELECT l.id FROM lits l JOIN etablissements e ON e.id = l.etablissement_id JOIN types_unite t ON t.id = l.type_id
      WHERE e.code = 'HA' AND t.code = 'MED' AND l.etat = 'occupe' AND l.nsa_depuis IS NULL LIMIT 1`)).rows[0];
    await transaction(pool, (c) => changerEtat(c, pool, null, litHA.id, 'nettoyage', {}));
    await transaction(pool, (c) => changerEtat(c, pool, null, litHA.id, 'libre', {}));
    await x.waitForSelector('#bandeau-dispo:not([hidden]) #b-dispo-ici', { timeout: 10000 });
  assert.match(await x.textContent('#bandeau-dispo'), /\d+ lits? de médecine signalés? libres? à proximité : Hôpital du Bois-Joli\./);
    await verifier(x, L, '01c-disponibilite-a-cote');
    await x.click('#b-dispo-ici');
    await x.waitForSelector('#modale:not([hidden]) #m-npat');
    await verifier(x, L, '01d-disponibilite-transferer');
    await x.keyboard.press('Escape');
    await x.waitForSelector('#modale', { state: 'hidden' });   // sur téléphone, le clic suivant ne doit pas tomber sur la fenêtre qui se ferme

    // 2 bis. L'urgence de X : civières, corridor, séjours de plus de 24 h
    await onglet(x, 'urgence');
    assert.match(await x.textContent('#v-urgence .tuiles'), /\d{3}\s%/);
    await verifier(x, L, '02b-urgence-x');
    await x.locator('#v-urgence [data-a="demander"]').first().click();
    await x.waitForSelector('#modale:not([hidden]) #m-type');
    await verifier(x, L, '02c-urgence-demander-lit');
    await x.click('#modale .btn.pri');
    await toast(x, 'Demande ajoutée');

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

    const y = await ouvrir(L, 'hopital.y@demo.arrimo');
    await onglet(y, 'transferts');
    await verifier(y, L, '05-transferts-y');
    await y.locator('#v-transferts [data-etape="accepter"]').first().click();
    await toast(y, 'validé');
    // Le receveur ne crée aucun dossier : il confirme la chambre ; le demandeur est avisé
    await y.locator('#v-transferts [data-etape="chambre_prete"]').first().click();
    await toast(y, 'Chambre prête');
    // Le patient déjà en route vers Y : heure d'arrivée prévue et compte à rebours
    await y.waitForSelector('#v-transferts [data-eta] .decompte');
    assert.match(await y.textContent('#v-transferts [data-eta]'), /Arrivée prévue vers .* · (dans|arrivée|prévue)/);
    await verifier(y, L, '05b-transferts-y-arrivee');
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
    await verifierAide(e, L, '07b-aide-entretien', 'entretien');
    const premier = e.locator('#v-nettoyage .net-item').first();
    const debut = premier.locator('[data-debut]');
    if (await debut.count()) { await debut.click(); await toast(e, 'commencé'); }
    await e.locator('#v-nettoyage .net-item').first().locator('[data-fini]').click();
    await toast(e, 'est prêt');
    // Les civières passent en premier quand des patients attendent en corridor ; puis le premier lit
    await e.locator('#v-nettoyage [data-fini][data-genre="lit"]').first().click();
    await toast(e, 'est prêt');
    await verifier(e, L, '08-nettoyage-termine');

    await onglet(x, 'nsa');
    assert.match(await x.textContent('#v-nsa'), /cible : 8\s%/);
    await verifier(x, L, '09-nsa');
    // ALC : recherche et filtre par orientation, sans rechargement
    const lignesNsa = await x.locator('#v-nsa [data-nsa-ligne]').count();
    assert.ok(lignesNsa > 0);
    await x.fill('#n-recherche', 'zzz-introuvable');
    assert.strictEqual(await x.locator('#v-nsa [data-nsa-ligne]:not([hidden])').count(), 0);
    assert.match(await x.textContent('#n-compte'), new RegExp(`0 sur ${lignesNsa}`));
    await x.fill('#n-recherche', '');
    assert.strictEqual(await x.locator('#v-nsa [data-nsa-ligne]:not([hidden])').count(), lignesNsa);
    // Détails d'un lit ALC : informations et événements liés
    await x.locator('#v-nsa [data-nsa-detail]').first().click();
    await x.waitForSelector('#modale:not([hidden]) .detail-nsa');
    await verifier(x, L, '09b-nsa-detail');
    await x.keyboard.press('Escape');
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
    // Catégories : une seule section affichée, puis toutes
    // Graphiques réels : disponibilité par unité et transferts par jour
    assert.ok(await x.locator('#v-indicateurs .g-ligne').count() > 0, 'disponibilité par unité');
    assert.ok(await x.locator('#v-indicateurs .graphique').count() === 2);
    await x.click('[data-icat="ensemble"]'); await x.waitForSelector('[data-icat="ensemble"][aria-pressed="true"]');
    assert.strictEqual(await x.locator('#v-indicateurs .titre-section').count(), 1);
    assert.strictEqual(await x.locator('#v-indicateurs .graphique').count(), 0);
    await x.click('[data-icat="tout"]'); await x.waitForSelector('[data-icat="tout"][aria-pressed="true"]');
    assert.ok(await x.locator('#v-indicateurs .titre-section').count() >= 2);
    await onglet(x, 'reseau');
    await verifier(x, L, '13-reseau');
    // Tableau national : du plus proche au plus loin, filtre « lit libre », « Transférer ici »
    await onglet(x, 'national');
    await verifier(x, L, '13b-national');
    await x.selectOption('#n-type', { label: 'Médecine' });
    await x.waitForSelector('#n-libre:not([disabled])');
    await x.check('#n-libre');
    await x.waitForSelector('#v-national [data-ici]');
    await x.locator('#v-national [data-ici]').first().click();
    await x.waitForSelector('#modale:not([hidden]) #m-npat');
    await verifier(x, L, '13c-national-transferer');
    await x.keyboard.press('Escape');
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
    await verifierAide(r, L, '17b-aide-administration', 'gestionnaire');

    // 7. Démo : jamais de double authentification ; administration directe, puis création d'un compte
    await menu(r, '#b-compte');
    await r.waitForSelector('#sans-2fa-demo');
    assert.strictEqual(await r.locator('#b-2fa-prep').count(), 0);
    await verifier(r, L, '18-demo-sans-2fa');
    await onglet(r, 'admin');
    await r.waitForSelector('#b-creer-compte');
    await verifier(r, L, '19-administration');
    await r.fill('#n-nom', 'Compte de démonstration');
    await r.fill('#n-email', `essai.${L.nom}@demo.arrimo`);
    await r.click('#b-creer-compte');
    await r.waitForSelector('#modale:not([hidden])');
    await verifier(r, L, '20-mot-de-passe-temporaire');
    await r.click('#modale .btn.pri');
    // Comptes : recherche par courriel et explication des rôles
    await r.waitForSelector('#a-recherche');
    await r.fill('#a-recherche', `essai.${L.nom}@`);
    assert.strictEqual(await r.locator('#admin-corps [data-acl-ligne]:not([hidden])').count(), 1);
    await r.fill('#a-recherche', '');
    assert.ok(await r.locator('.roles-aide dt').count() === 4);
    assert.strictEqual(await r.locator('.matrice-acces tbody tr').count(), 7, 'accès effectifs par rôle');
    await r.selectOption('#a-statut', 'desactives');
    assert.strictEqual(await r.locator('#admin-corps [data-acl-ligne][data-acl-actif="1"]:not([hidden])').count(), 0);
    await r.selectOption('#a-statut', '');
    // Import CSV : un fichier d'unités pour l'Hôpital X, vérifié puis importé
    await r.click('[data-ao="import"]');
    await r.waitForSelector('[data-imp-fichier="unites"]', { state: 'attached' });
    await verifier(r, L, '20b-import');
    await r.setInputFiles('[data-imp-fichier="unites"]', { name: 'unites.csv', mimeType: 'text/csv', buffer: Buffer.from(`unite;type_unite\nGériatrie ${L.nom};MED\n`) });
    await r.waitForSelector('[data-imp-verifier="unites"]:not([disabled])');
    await r.click('[data-imp-verifier="unites"]');
    await r.waitForSelector('[data-imp-importer="unites"]:not([disabled])');
    await verifier(r, L, '20c-import-verifie');
    await r.click('[data-imp-importer="unites"]');
    await toast(r, 'Import terminé');
    await r.click('[data-ao="journal"]');
    await r.waitForSelector('#admin-corps table');
    await verifier(r, L, '21-journal-administration');
    await menu(r, '#b-compte');
    await r.waitForSelector('#f-mdp');
    await verifier(r, L, '22-mon-compte');

    // Démo toujours prête : remise à zéro par le gestionnaire réseau (double authentification active)
    await onglet(r, 'admin');
    await r.click('[data-ao="demo"]');
    await r.waitForSelector('#b-demo-zero');
    await verifier(r, L, '23-demo-remise-a-zero');
    await r.click('#b-demo-zero');
    await r.waitForSelector('#modale:not([hidden])');
    await r.click('#modale .btn.pri');
    await r.waitForSelector('#ecran-connexion:not([hidden])');
    assert.match(await r.textContent('#c-erreur'), /remise à zéro/);
    const recree = (await pool.query(`SELECT count(*)::int AS n FROM utilisateurs WHERE email LIKE 'essai.%'`)).rows[0].n;
    assert.strictEqual(recree, 0, 'le compte créé pendant la démo a disparu');

    for (const p of [x, y, e, r]) await p.context().close();
  });
}

/* ------------------------------------------------------------------ version anglaise */
// Texte français repéré : lettres accentuées ou mots courants du français
const FRANCAIS = /[àâçéèêëîïôûùüÿœ]|\b(le|la|les|des|du|une|et|pour|dans|sur|avec|depuis|aucun|aucune|lits?|chambre|attente|libres?|occupés?|réservés?|vous|votre|nettoyer|établissements?|demande|refusé|journal|semaine|jours)\b/i;

/** Textes visibles (et attributs lus par l'utilisateur), hors données saisies (classe « donnee ») et noms propres connus. */
async function textesVisibles(page, noms) {
  const morceaux = await page.evaluate(() => {
    const vus = [];
    const visible = (el) => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const marche = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = marche.nextNode(); n; n = marche.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !visible(el) || el.closest('.donnee, script, style, svg')) continue;
      vus.push(n.textContent.trim());
    }
    document.querySelectorAll('[placeholder], [title], [aria-label]').forEach((el) => {
      if (!visible(el) || el.closest('.donnee')) return;
      ['placeholder', 'title', 'aria-label'].forEach((a) => { if (el.getAttribute(a)) vus.push(el.getAttribute(a)); });
    });
    return vus;
  });
  return morceaux.map((m) => noms.reduce((x, nom) => x.split(nom).join(' '), m)).filter((m) => m.trim());
}
async function sansFrancais(page, noms, ecran) {
  const restes = (await textesVisibles(page, noms)).filter((m) => FRANCAIS.test(m));
  assert.deepStrictEqual([...new Set(restes)], [], `anglais/${ecran} : texte français restant`);
  assert.deepStrictEqual(page.erreurs, [], `anglais/${ecran} : erreurs dans la console`);
}

test('interface en anglais : aucun texte français restant (noms propres exceptés)', { timeout: 240000 }, async () => {
  for (const c of navigateur.contexts()) await c.close();
  await viderBase(pool);
  await demoReseau(pool, { silencieux: true, comptesRoles: true });
  // Noms propres et données saisies par les établissements : établissements, villes, unités, personnes, connecteurs, configuration
  const noms = (await pool.query(`SELECT nom FROM etablissements UNION SELECT ville FROM etablissements UNION SELECT nom FROM unites
    UNION SELECT nom FROM utilisateurs UNION SELECT nom FROM connecteurs UNION SELECT nom FROM config_pays UNION SELECT transport_libelle FROM config_pays`))
    .rows.map((r) => r.nom).filter(Boolean).sort((a, b) => b.length - a.length);
  const L = LARGEURS[0];
  const ecran = async (page, nom) => { await sansFrancais(page, noms, nom); await verifier(page, { ...L, nom: 'anglais' }, nom); };

  // Écran de connexion : choix de la langue, puis erreur traduite à partir du code du serveur
  const accueil = await (await navigateur.newContext({ viewport: { width: L.width, height: L.height } })).newPage();
  accueil.erreurs = [];
  await accueil.goto(base);
  await accueil.selectOption('#langue-connexion', 'en');
  assert.strictEqual(await accueil.getAttribute('html', 'lang'), 'en-CA');
  await accueil.fill('#c-email', 'hopital.x@demo.arrimo');
  await accueil.fill('#c-mdp', 'mauvais-mot-de-passe');
  await accueil.click('#f-connexion button[type=submit]');
  await accueil.waitForSelector('#c-erreur:not([hidden])');
  assert.strictEqual(await accueil.textContent('#c-erreur'), 'Incorrect email address or password.');
  accueil.erreurs = accueil.erreurs.filter((e) => !/401/.test(e));   // la ressource refusée est normale ici
  await ecran(accueil, '00-connexion');
  // Pages légales en anglais (le choix de langue est partagé)
  for (const [chemin, titre] of [['/privacy', 'Privacy policy'], ['/terms', 'Terms of use'], ['/confidentialite', 'Privacy policy']]) {
    await accueil.goto(`${base}${chemin}`);
    await accueil.waitForSelector('#corps section h2');
    assert.strictEqual(await accueil.textContent('#titre'), titre);
    await sansFrancais(accueil, [...noms, 'Commission d’accès à l’information du Québec', 'Commission d’accès à l’information'], `00${chemin}`);
    await verifier(accueil, { ...L, nom: 'anglais' }, `00${chemin.replace('/', '-')}`);
  }
  await accueil.goto(base);
  // Le choix est mémorisé : rechargé, l'écran reste en anglais
  await accueil.reload();
  assert.strictEqual(await accueil.textContent('#f-connexion button[type=submit]'), 'Sign in');
  await accueil.context().close();

  const x = await ouvrir(L, 'hopital.x@demo.arrimo', 'en');
  await x.waitForSelector('#v-copilote .niveau');
  await ecran(x, '01-copilot');
  for (let i = 0; i < 6; i += 1) {
    await x.click(`#v-copilote [data-ex="${i}"]`);
    await x.waitForSelector('#v-copilote .reponse');
    await ecran(x, `02-question-${i}`);
  }
  for (const vue of ['reseau', 'national', 'lits', 'urgence', 'admissions', 'transferts', 'nettoyage', 'nsa', 'indicateurs', 'journal', 'params']) {
    await onglet(x, vue);
    await ecran(x, `03-${vue}`);
  }
  await onglet(x, 'reseau');
  await x.click('#b-chercher');
  await x.waitForSelector('#v-reseau [data-choix]');
  await x.locator('#v-reseau [data-choix]').first().click();
  await x.waitForSelector('#b-valider');
  await ecran(x, '04-reseau-recherche');
  await onglet(x, 'lits');
  for (const action of ['reserver', 'conge', 'nsa', 'hors_service']) {
    await x.locator(`#v-lits [data-action="${action}"]`).first().click();
    await x.waitForSelector('#modale:not([hidden])');
    await ecran(x, `05-modale-${action}`);
    await x.keyboard.press('Escape');
  }
  await onglet(x, 'urgence');
  for (const action of ['demander', 'liberer']) {
    await x.locator(`#v-urgence [data-a="${action}"]`).first().click();
    await x.waitForSelector('#modale:not([hidden])');
    await ecran(x, `05-er-${action}`);
    await x.keyboard.press('Escape');
  }
  await onglet(x, 'lits');
  // Erreur du serveur traduite : référence patient invalide
  await x.locator('#v-lits [data-action="reserver"]').first().click();
  await x.fill('#m-pat', 'Dupont');
  await x.click('#modale .btn.pri');
  await toast(x, 'Invalid patient reference. Expected format: P-00000.');
  x.erreurs = x.erreurs.filter((m) => !/400/.test(m));   // refus attendu
  await x.keyboard.press('Escape');
  await onglet(x, 'admissions');
  await x.locator('#v-admissions [data-a="ailleurs"]').first().click();
  await x.waitForSelector('#modale:not([hidden])');
  await ecran(x, '06-find-elsewhere');
  await x.click('#modale .btn.pri');
  await toast(x, 'sent to');
  await x.click('#b-notif');
  await x.waitForSelector('#panneau-notif:not([hidden])');
  await ecran(x, '07-notifications');
  await x.click('#b-fermer-notif');
  await menu(x, '#b-compte');
  await x.waitForSelector('#f-mdp');
  await ecran(x, '08-my-account');

  const y = await ouvrir(L, 'hopital.y@demo.arrimo', 'en');
  await onglet(y, 'transferts');
  await ecran(y, '09-transfers-y');
  await y.click('#b-notif');
  await y.waitForSelector('#panneau-notif:not([hidden])');
  await ecran(y, '10-notifications-y');

  const e = await ouvrir(L, 'entretien.x@demo.arrimo', 'en');
  await e.waitForSelector('#v-nettoyage .net-item');
  await ecran(e, '11-cleaning');

  const r = await ouvrir(L, 'reseau@demo.arrimo', 'en');
  await r.waitForSelector('#v-copilote .niveau');
  await ecran(r, '12-copilot-network');
  await onglet(r, 'admin');
  await r.waitForSelector('#b-creer-compte');
  await ecran(r, '13-admin-demo');
  for (const sous of ['utilisateurs', 'structure', 'import', 'config', 'connecteurs', 'journal']) {
    await r.click(`[data-ao="${sous}"]`);
    await r.waitForFunction((s) => document.querySelector(`[data-ao="${s}"]`)?.getAttribute('aria-pressed') === 'true' && document.querySelector('#admin-corps').children.length > 0, sous);
    await ecran(r, `15-admin-${sous}`);
  }
  await r.click('[data-ao="utilisateurs"]');
  await r.waitForSelector('#b-creer-compte');
  await r.fill('#n-nom', 'Test account');
  await r.fill('#n-email', 'test.en@demo.arrimo');
  await r.click('#b-creer-compte');
  await r.waitForSelector('#modale:not([hidden])');
  await ecran(r, '16-temporary-password');

  for (const p of [x, y, e, r]) await p.context().close();
});

/* ------------------------------------------------------------------ environnements (C1) */
test('bandeau de l’environnement : démonstration, recette (ambre), rien en production', { timeout: 120000 }, async () => {
  const L = LARGEURS[0];
  const avant = { env: process.env.ARRIMO_ENV, demo: process.env.ARRIMO_DEMO };
  try {
    for (const [env, attendu] of [['recette', /^Recette · données de test/], ['production', null], ['demo', /^Démonstration · données fictives$/]]) {
      process.env.ARRIMO_ENV = env;
      const page = await (await navigateur.newContext({ viewport: { width: L.width, height: L.height } })).newPage();
      page.erreurs = [];
      for (const chemin of ['/', '/confidentialite']) {
        await page.goto(`${base}${chemin}`);
        await page.waitForLoadState('networkidle');
        const visible = await page.isVisible('#bandeau-demo');
        if (!attendu) { assert.ok(!visible, `${env}${chemin} : aucun bandeau`); continue; }
        assert.ok(visible, `${env}${chemin} : bandeau visible`);
        assert.match((await page.textContent('#bandeau-demo')).trim(), attendu);
        assert.strictEqual(await page.evaluate(() => document.getElementById('bandeau-demo').classList.contains('recette')), env === 'recette');
        await verifier(page, { ...L, nom: 'environnements' }, `${env}${chemin.replace('/', '-')}`);
      }
      await page.context().close();
    }
  } finally {
    if (avant.env === undefined) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = avant.env;
    if (avant.demo === undefined) delete process.env.ARRIMO_DEMO; else process.env.ARRIMO_DEMO = avant.demo;
  }
});

/* ------------------------------------------------------------------ anglais sur tablette et téléphone */
for (const L of LARGEURS.slice(1)) {
  test(`interface en anglais · ${L.nom} (${L.width} px) : chaque écran, sans texte français ni débordement`, { timeout: 240000 }, async () => {
    for (const c of navigateur.contexts()) await c.close();
    await viderBase(pool);
    await demoReseau(pool, { silencieux: true, comptesRoles: true });
    const noms = (await pool.query(`SELECT nom FROM etablissements UNION SELECT ville FROM etablissements UNION SELECT nom FROM unites
      UNION SELECT nom FROM utilisateurs UNION SELECT nom FROM connecteurs UNION SELECT nom FROM config_pays UNION SELECT transport_libelle FROM config_pays`))
      .rows.map((r) => r.nom).filter(Boolean).sort((a, b) => b.length - a.length);
    const ecran = async (page, nom) => { await sansFrancais(page, noms, `${L.nom}/${nom}`); await verifier(page, { ...L, nom: `anglais-${L.nom}` }, nom); };
    const x = await ouvrir(L, 'hopital.x@demo.arrimo', 'en');
    await x.waitForSelector('#v-copilote .niveau');
    await ecran(x, '01-copilot');
    for (const vue of ['reseau', 'national', 'lits', 'urgence', 'admissions', 'transferts', 'nettoyage', 'nsa', 'indicateurs', 'journal', 'params']) {
      await onglet(x, vue);
      await ecran(x, `03-${vue}`);
    }
    await menu(x, '#b-compte');
    await x.waitForSelector('#v-compte:not([hidden]) h2');
    await ecran(x, '04-account');
    const e = await ouvrir(L, 'entretien.x@demo.arrimo', 'en');
    await e.waitForSelector('#v-nettoyage:not([hidden])');
    await ecran(e, '05-cleaning');
    const r = await ouvrir(L, 'reseau@demo.arrimo', 'en');
    await onglet(r, 'national');
    await ecran(r, '06-national');
    await onglet(r, 'admin');
    await ecran(r, '07-admin');
    for (const p of [x, e, r]) await p.context().close();
  });
}

/* ------------------------------------------------------------------ environnement neuf (C1, C3) */
test('environnement neuf : premier compte, mot de passe choisi, premier établissement créé', { timeout: 120000 }, async () => {
  const { premierCompte } = require('../db/premier-compte');
  const L = LARGEURS[0];
  const avant = { env: process.env.ARRIMO_ENV, deuxfa: process.env.ARRIMO_2FA_ADMIN };
  process.env.ARRIMO_ENV = 'recette';
  process.env.ARRIMO_2FA_ADMIN = '0';
  try {
    for (const c of navigateur.contexts()) await c.close();
    await viderBase(pool);
    const temporaire = await premierCompte(pool, 'premier@recette.exemple', 'Gestionnaire de recette');
    const page = await (await navigateur.newContext({ viewport: { width: L.width, height: L.height } })).newPage();
    page.erreurs = [];
    await page.goto(base);
    await page.fill('#c-email', 'premier@recette.exemple'); await page.fill('#c-mdp', temporaire);
    await page.click('#f-connexion button[type=submit]');
    await page.waitForSelector('#f-mdp-temp:not([hidden])');
    await page.fill('#t-actuel', temporaire); await page.fill('#t-nouveau', 'Recette-Arrimo-2026'); await page.fill('#t-confirme', 'Recette-Arrimo-2026');
    await page.click('#f-mdp-temp button[type=submit]');
    // Double authentification d'abord (obligatoire pour l'administration), puis la création du premier établissement
    await fermerPremiersPas(page);
    await page.waitForSelector('#b-2fa-prep');
    await page.click('#b-2fa-prep');
    await page.waitForSelector('#a-code');
    const secret = (await page.textContent('#zone-2fa .num')).trim();
    await page.fill('#a-code', totp.codePourPas(secret, totp.pasActuel()));
    await page.click('#b-2fa-ok');
    await toast(page, 'activée');
    await allerOnglet(page, 'admin');
    await page.waitForSelector('#ne-code');
    assert.deepStrictEqual(await page.$$eval('#onglets button', (bs) => bs.filter((b) => !b.hidden).map((b) => b.dataset.v)), ['admin']);
    assert.match(await page.textContent('#bandeau-demo'), /Recette/);
    await fermerPremiersPas(page);
    await verifier(page, { ...L, nom: 'environnements' }, 'recette-premier-etablissement');
    await page.fill('#ne-code', 'HOP-A'); await page.fill('#ne-nom', 'Hôpital de recette A'); await page.fill('#ne-ville', 'Ville A');
    await page.fill('#ne-lat', '45,5'); await page.fill('#ne-lon', '-72,1');
    await page.click('#b-ne-creer');
    await toast(page, 'est créé');
    // L'établissement existe : l'application s'ouvre normalement (inactif jusqu'à la fin de l'implantation)
    await page.waitForFunction(() => [...document.querySelectorAll('#onglets button')].filter((b) => !b.hidden).length > 5);
    assert.strictEqual(await page.inputValue('#ctx'), String((await pool.query(`SELECT id FROM etablissements WHERE code = 'HOP-A'`)).rows[0].id));
    page.erreurs = page.erreurs.filter((m) => !/40[13]/.test(m));
    await page.context().close();
  } finally {
    if (avant.env === undefined) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = avant.env;
    if (avant.deuxfa === undefined) delete process.env.ARRIMO_2FA_ADMIN; else process.env.ARRIMO_2FA_ADMIN = avant.deuxfa;
  }
});

/* ------------------------------------------------------------------ console SH (C2, C4) */
test('console SH : première connexion, hôpital, implantation, formation, go-live, activation, rapport · 3 largeurs', { timeout: 400000 }, async () => {
  const { Pool } = require('pg');
  const { creerAppSh } = require('../src/sh/app');
  const { premierCompteSh } = require('../db/sh-premier-compte');
  const { viderBaseSh } = require('../db/sh-vider');
  const { configurationBase } = require('../db/configuration-base');
  const courierSh = require('../src/courriel');
  const avant = { cle: process.env.SH_API_KEY, env: process.env.ARRIMO_ENV, demo: process.env.ARRIMO_DEMO };
  process.env.SH_API_KEY = 'cle-interface-sh-0123456789';
  process.env.SH_PUBLIC_URL = 'https://sh.test.invalid';
  process.env.SH_MFA_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');
  process.env.SH_INITIAL_ADMIN_EMAIL = 'sh@exemple.ca';
  let lienInvitation = '';
  courierSh.definirTransport(async (m) => { lienInvitation = m.texte.match(/https:\/\/sh\.test\.invalid\/#invitation=([a-f0-9]{64})/)?.[1] || ''; });
  delete process.env.ARRIMO_DEMO;
  // Recette vide (configuration de base) et production de test sur un schéma séparé ; la console a ses tables dans la base de test
  await viderBase(pool);
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await configurationBase(pool);
  const poolProd = new Pool({ connectionString: URL_TEST, options: '-c search_path=prod_ui' });
  const serveurProd = await demarrerServeur(creerApp(poolProd));
  const env = (e) => { process.env.ARRIMO_ENV = e; };   // les deux instances partagent ce processus de test
  const serveurSh = await demarrerServeur(creerAppSh(pool, { env: {
    SH_PUBLIC_URL: process.env.SH_PUBLIC_URL, SH_MFA_ENCRYPTION_KEY: process.env.SH_MFA_ENCRYPTION_KEY,
    SH_ENV_RECETTE_URL: base, SH_ENV_RECETTE_CLE: process.env.SH_API_KEY, SH_ENV_RECETTE_PUBLIC: 'https://recette.arrimo.exemple',
    SH_ENV_PRODUCTION_URL: `http://127.0.0.1:${serveurProd.address().port}`, SH_ENV_PRODUCTION_CLE: process.env.SH_API_KEY, SH_ENV_PRODUCTION_PUBLIC: 'https://arrimo.exemple',
  } }));
  const baseSh = `http://127.0.0.1:${serveurSh.address().port}`;
  try {
    for (const [i, L] of LARGEURS.entries()) {
      for (const c of navigateur.contexts()) await c.close();
      env('recette');
      await viderBaseSh(pool);
      await pool.query('DROP SCHEMA IF EXISTS prod_ui CASCADE; CREATE SCHEMA prod_ui');
      await poolProd.query(schema);
      await configurationBase(poolProd);
      await premierCompteSh(pool, 'sh@exemple.ca', 'Moustafa Adamou');
      assert.match(lienInvitation, /^[a-f0-9]{64}$/);
      // Politique de sécurité appliquée (pas de bypassCSP) : un script en ligne serait bloqué et signalé
      const page = await (await navigateur.newContext({ locale: 'fr-CA', viewport: { width: L.width, height: L.height }, hasTouch: !!L.tactile, isMobile: !!L.mobile, acceptDownloads: true })).newPage();
      page.erreurs = [];
      page.on('console', (m) => { if (m.type() === 'error') page.erreurs.push(m.text()); });
      page.on('pageerror', (e) => page.erreurs.push(String(e)));
      // waitForFunction évalue une chaîne : interdit par la politique de sécurité de la console ; on attend un sélecteur
      const attendre = () => page.waitForSelector('body[data-pret="1"]', { state: 'attached' });
      // Attend un nouvel affichage complet après l'action (compteur d'affichages de la page)
      const rendus = () => page.evaluate(() => Number(document.body.dataset.rendus || 0));
      const rendu = async (fn) => {
        const avantRendu = await rendus();
        await fn();
        for (let t = 0; t < 300 && (await rendus()) <= avantRendu; t += 1) await page.waitForTimeout(100);
        await attendre();
      };
      const viderToasts = () => page.evaluate(() => { document.querySelector('#toasts').innerHTML = ''; });
      await page.goto(`${baseSh}/#invitation=${lienInvitation}`);
      await page.waitForSelector('#f-invitation:not([hidden])');
      await verifier(page, L, 'sh-01-connexion');
      await page.fill('#i-nouveau', 'Console-SH-2026'); await page.fill('#i-confirme', 'Console-SH-2026');
      await page.click('#f-invitation button[type=submit]');
      await page.waitForSelector('#f-connexion:not([hidden])');
      await page.fill('#c-email', 'sh@exemple.ca'); await page.fill('#c-mdp', 'Console-SH-2026');
      await page.click('#f-connexion button[type=submit]');
      await page.waitForSelector('#f-2fa-act:not([hidden])');
      await page.click('#b-2fa-prep');
      await page.waitForSelector('#a-code');
      if (i === 0) await verifier(page, L, 'sh-02-double-authentification');
      const secret = (await page.textContent('#zone-2fa .secret')).trim();
      await page.fill('#a-code', totp.codePourPas(secret, totp.pasActuel()));
      await page.click('#b-2fa-ok');
      await page.waitForSelector('#ecran-app:not([hidden])');
      await attendre();
      await viderToasts();
      await verifier(page, L, 'sh-03-hopitaux-vide');

      // Écrans ERP Lot 3/4 : les vues affichent les données persistées et leurs états vides.
      for (const [vue, capture] of [['accueil','sh-12-accueil'],['crm','sh-13-crm'],['contrats','sh-14-devis-contrats'],['projets','sh-15-projets'],['taches','sh-16-taches'],['support','sh-17-support']]) {
        await page.click(`#onglets [data-v="${vue}"]`);
        await page.getByRole('heading', { level: 2, name: vue==='taches'?'Tâches':vue==='crm'?'CRM':vue==='accueil'?'Accueil':vue==='contrats'?'Devis et contrats':vue==='projets'?'Projets':'Support', exact: true }).waitFor({ state: 'visible' });
        if (i === 0) await verifier(page, L, capture);
      }
      await page.click('#onglets [data-v="hopitaux"]');
      await page.waitForSelector('#b-nouveau');

      // Nouvel hôpital (fiche), puis création de son établissement dans la recette (ouvert pour les tests et la formation)
      await page.click('#b-nouveau');
      await page.fill('#h-nom', 'Hôpital de recette A'); await page.fill('#h-code', 'HOP-A'); await page.fill('#h-ville', 'Sherbrooke');
      await page.fill('#h-lat', '45,4'); await page.fill('#h-lon', '-71,89'); await page.fill('#h-sd', 'hopital-a');
      await page.fill('#h-cnom', 'Responsable A'); await page.fill('#h-ccourriel', 'responsable@hopital-a.exemple');
      if (i === 0) await verifier(page, L, 'sh-04-nouvel-hopital');
      await rendu(() => page.click('#modale .btn.pri'));
      await page.waitForSelector('#b-relier');
      await rendu(() => page.click('#b-relier'));
      await toast(page, 'Établissement créé');
      assert.strictEqual((await pool.query(`SELECT module_actif FROM etablissements WHERE code = 'HOP-A'`)).rows[0].module_actif, true, 'recette : ouvert');

      // Import par la console : unités, chambres, lits
      const fichiers = {
        unites: 'unite;type_unite\nMédecine 3;MED\nChirurgie 2;CHIR\n',
        chambres: 'unite;chambre\nMédecine 3;301\nMédecine 3;302\nChirurgie 2;201\n',
        lits: 'unite;chambre;lit;isolement;pression_negative;ventilation;telemetrie\nMédecine 3;301;MED-301A;non;non;non;oui\nMédecine 3;301;MED-301B;non;non;non;non\nMédecine 3;302;MED-302A;oui;non;non;non\nChirurgie 2;201;CHIR-201A;non;non;non;non\n',
      };
      for (const [type, contenu] of Object.entries(fichiers)) {
        await rendu(() => page.setInputFiles(`[data-imp-fichier="${type}"]`, { name: `${type}.csv`, mimeType: 'text/csv', buffer: Buffer.from(contenu) }));
        // Clic envoyé directement au bouton : sur téléphone, la page vient de se redessiner et défile encore
        await rendu(() => page.locator(`[data-imp-verifier="${type}"]`).dispatchEvent('click'));
        await rendu(() => page.locator(`[data-imp-importer="${type}"]`).dispatchEvent('click'));
        await toast(page, 'Import fait').catch(async (e) => { throw new Error(`${L.nom} · import ${type} : ${await page.textContent('#toasts')} · ${e.message}`); });
      }
      // Éditeur manuel SH : création et mise à jour passent par le même import validé, en recette seulement.
      await page.selectOption('#sh-structure-type', 'departements');
      await page.fill('#sh-structure-departement', 'Département SH manuel');
      await page.fill('#sh-structure-code', 'SH-MANUEL');
      await page.fill('#sh-structure-attributs_json', '{"batiment":"A"}');
      page.once('dialog', d => d.accept());
      await page.locator('#sh-structure-form button[type="submit"]').click(); // résultat affiché sur place, sans nouveau rendu : vérifié ci-dessous
      await page.locator('#sh-structure-resultat').filter({ hasText: 'Enregistré' }).waitFor({ state: 'visible', timeout: 10000 }).catch(async () => { throw new Error(`éditeur SH création: ${await page.locator('#sh-structure-resultat').textContent()}`); });
      assert.deepStrictEqual((await pool.query(`SELECT d.attributs,d.actif FROM departements d JOIN etablissements e ON e.id=d.etablissement_id WHERE e.code='HOP-A' AND d.code='SH-MANUEL'`)).rows[0], { attributs: { batiment: 'A' }, actif: true });
      await page.selectOption('#sh-structure-type', 'departements');
      await page.selectOption('#sh-structure-existant', { label: 'SH-MANUEL' });
      await page.fill('#sh-structure-departement', 'Département SH actualisé');
      await page.fill('#sh-structure-attributs_json', '{"batiment":"B"}');
      page.once('dialog', d => d.accept());
      await page.locator('#sh-structure-form button[type="submit"]').click(); // résultat affiché sur place, sans nouveau rendu : vérifié ci-dessous
      await page.locator('#sh-structure-resultat').filter({ hasText: 'Enregistré' }).waitFor({ state: 'visible', timeout: 10000 }).catch(async () => { throw new Error(`éditeur SH modification: ${await page.locator('#sh-structure-resultat').textContent()}`); });
      assert.deepStrictEqual((await pool.query(`SELECT d.nom,d.attributs FROM departements d JOIN etablissements e ON e.id=d.etablissement_id WHERE e.code='HOP-A' AND d.code='SH-MANUEL'`)).rows[0], { nom: 'Département SH actualisé', attributs: { batiment: 'B' } });
      await viderToasts();
      await verifier(page, L, 'sh-05-fiche-implantation');

      // Formation : patients fictifs dans la recette, puis le parcours rôle par rôle
      await page.click('#b-generer');
      await page.waitForSelector('#modale:not([hidden])');
      await rendu(() => page.click('#modale .btn.pri'));
      await toast(page, 'Données de formation');
      const occupes = (await pool.query(`SELECT count(*)::int AS n FROM lits l JOIN etablissements e ON e.id = l.etablissement_id WHERE e.code = 'HOP-A' AND l.patient_ref LIKE 'P-9%'`)).rows[0].n;
      assert.ok(occupes >= 2, 'patients fictifs dans la recette');
      await viderToasts();
      const roles = await page.$$eval('.roles-formation details', (ds) => ds.length);
      assert.strictEqual(roles, 4);
      for (let r = 0; r < roles; r += 1) {
        for (;;) {
          const d = page.locator('.roles-formation details').nth(r);
          if (!(await d.evaluate((x) => x.open))) await d.locator('summary').click();
          const c = d.locator('[data-formation]:not(:checked)').first();
          if (!(await c.count())) break;
          await rendu(() => c.check());
        }
      }
      const entretien = page.locator('.roles-formation details').nth(2);
      if (!(await entretien.evaluate((x) => x.open))) await entretien.locator('summary').click();
      await entretien.locator('[data-k="personnes"]').fill('6');
      await rendu(() => page.locator('.roles-formation details').nth(2).locator('[data-fo-enregistrer]').click());
      await toast(page, 'Séance enregistrée');
      await viderToasts();
      await page.locator('#formation').scrollIntoViewIfNeeded();
      await verifier(page, L, 'sh-06-formation');

      // Liste de vérification : le reste des étapes avant le go-live
      for (let rang = 1; rang <= 5; rang += 1) {
        for (;;) {
          const ouvert = await page.$eval(`#etape-${rang}`, (d) => d.open);
          if (!ouvert) await page.click(`#etape-${rang} summary`);
          const c = page.locator(`#etape-${rang} [data-verif]:not(:checked):not([disabled])`).first();
          if (!(await c.count())) break;
          await rendu(() => c.check());
        }
      }
      assert.strictEqual(await page.locator('#etape-5 [data-verif]:checked').count(), 3, 'Formation cochée par le parcours');

      // Go-live : la structure passe en production, pas les patients de formation
      env('production');
      await page.waitForSelector('#b-golive:not([disabled])');
      await page.click('#b-golive');
      await page.waitForSelector('#modale:not([hidden])');
      if (i === 0) await verifier(page, L, 'sh-07-golive-confirmer');
      await rendu(() => page.click('#modale .btn.pri'));
      await toast(page, 'Go-live fait').catch(async (e) => { throw new Error(`Go-live: ${await page.locator('#toasts').allTextContents().catch(()=>[])} · ${e.message}`); });
      const prod = (await poolProd.query(`SELECT e.module_actif, count(l.*)::int AS lits, count(l.*) FILTER (WHERE l.patient_ref IS NOT NULL)::int AS occupes
        FROM etablissements e LEFT JOIN lits l ON l.etablissement_id = e.id WHERE e.code = 'HOP-A' GROUP BY e.id`)).rows[0];
      assert.deepStrictEqual(prod, { module_actif: false, lits: 4, occupes: 0 }, 'production : structure seulement, inactive');
      await page.waitForSelector('#b-activer:not([disabled])');
      await page.click('#b-activer');
      await page.waitForSelector('#modale:not([hidden])');
      await rendu(() => page.click('#modale .btn.pri'));
      await toast(page, 'Module activé');
      assert.strictEqual((await poolProd.query(`SELECT module_actif FROM etablissements WHERE code = 'HOP-A'`)).rows[0].module_actif, true);
      await viderToasts();
      await verifier(page, L, 'sh-08-production-active');

      // Rapport de go-live (PDF)
      const [telechargement] = await Promise.all([page.waitForEvent('download'), page.click('#b-rapport')]);
      assert.strictEqual(telechargement.suggestedFilename(), 'arrimo-rapport-golive-HOP-A.pdf');
      const fichier = path.join(DOSSIER, 'sh', 'rapport-golive.pdf');
      fs.mkdirSync(path.dirname(fichier), { recursive: true });
      await telechargement.saveAs(fichier);
      assert.strictEqual(fs.readFileSync(fichier).subarray(0, 5).toString(), '%PDF-');
      await toast(page, 'Rapport téléchargé');

      await rendu(() => page.click('#b-retour-liste'));
      assert.match(await page.textContent('#contenu'), /Actif/);
      assert.match(await page.textContent('#contenu'), /hopital-a\.arrimo\.exemple/);
      await viderToasts();
      await verifier(page, L, 'sh-09-hopitaux');
      await rendu(() => page.click('#onglets [data-v="journal"]'));
      assert.match(await page.textContent('#contenu'), /Go-live/);
      await verifier(page, L, 'sh-10-journal');
      await rendu(() => page.click('#onglets [data-v="equipe"]'));
      await verifier(page, L, 'sh-11-equipe');
      await rendu(() => page.selectOption('#sh-langue','en'));
      assert.strictEqual(await page.getAttribute('html','lang'),'en-CA');
      await rendu(() => page.click('#onglets [data-v="accueil"]'));
      assert.strictEqual((await page.locator('#contenu h2').textContent()).trim(),'Home');
      assert.strictEqual((await pool.query('SELECT langue FROM sh_utilisateurs WHERE email=$1',['sh@exemple.ca'])).rows[0].langue,'en');
      await rendu(() => page.selectOption('#sh-langue','fr'));
      await pool.query(`UPDATE etablissements SET actif = false, sous_domaine = NULL, code = 'HOP-A-' || id WHERE code = 'HOP-A'`);
      await page.context().close();
    }
  } finally {
    courierSh.definirTransport(null);
    serveurSh.close(); serveurProd.close();
    await poolProd.end();
    await pool.query('DROP SCHEMA IF EXISTS prod_ui CASCADE');
    for (const [k, v] of [['SH_API_KEY', avant.cle], ['ARRIMO_ENV', avant.env], ['ARRIMO_DEMO', avant.demo]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    delete process.env.SH_PUBLIC_URL; delete process.env.SH_MFA_ENCRYPTION_KEY; delete process.env.SH_INITIAL_ADMIN_EMAIL;
  }
});

for (const L of LARGEURS) {
  test(`apparence sombre, automatique et soleil : préférence par compte, contrastes AA · ${L.nom}`, { timeout: 240000 }, async () => {
    for (const c of navigateur.contexts()) await c.close();
    await viderBase(pool);
    await demoReseau(pool, { silencieux: true, comptesRoles: true });
    const x = await ouvrir(L, 'hopital.x@demo.arrimo');
    await x.click('#b-menu'); await x.waitForSelector('#menu-compte:not([hidden])');
    const reponse = x.waitForResponse((r) => r.url().includes('/api/moi/apparence') && r.request().method() === 'PUT');
    await x.selectOption('#apparence-barre', 'sombre');
    assert.strictEqual((await reponse).status(), 200);
    await x.waitForFunction(() => document.documentElement.dataset.theme === 'sombre');
    assert.strictEqual((await pool.query("SELECT apparence FROM utilisateurs WHERE email='hopital.x@demo.arrimo'")).rows[0].apparence, 'sombre');
    assert.strictEqual((await pool.query("SELECT count(*)::int n FROM utilisateurs WHERE apparence<>'automatique'")).rows[0].n, 1, 'les autres comptes ne changent pas');
    await x.keyboard.press('Escape');
    const vues = await x.evaluate(() => [...document.querySelectorAll('#onglets button[data-v]')].filter((b) => !b.hidden && b.offsetParent !== null).map((b) => b.dataset.v));
    assert.ok(vues.length >= 8, `onglets visibles : ${vues}`);
    for (const v of vues) { await onglet(x, v); await verifier(x, L, `sombre-${v}`); }
    await x.context().close();

    // Nouvelle session sur un autre appareil : la préférence vient du serveur, pas du cache local
    const y = await ouvrir(L, 'hopital.x@demo.arrimo');
    assert.strictEqual(await y.evaluate(() => document.documentElement.dataset.theme), 'sombre');
    await y.context().close();

    // Automatique : suit le système (navigateur réglé en sombre) ; soleil : jour ou nuit à la position de l'établissement
    await pool.query("UPDATE utilisateurs SET apparence='automatique' WHERE email='hopital.x@demo.arrimo'");
    const ctx = await navigateur.newContext({ viewport: { width: L.width, height: L.height }, colorScheme: 'dark', isMobile: !!L.mobile, hasTouch: !!L.tactile });
    const a = await ctx.newPage(); a.erreurs = [];
    await a.goto(base); await a.fill('#c-email', 'hopital.x@demo.arrimo'); await a.fill('#c-mdp', MDP);
    await a.click('#f-connexion button[type=submit]'); await a.waitForSelector('body[data-pret="1"]'); await fermerPremiersPas(a);
    assert.strictEqual(await a.evaluate(() => document.documentElement.dataset.theme), 'sombre');
    const etab = (await pool.query(`SELECT e.latitude, e.longitude FROM etablissements e JOIN utilisateur_etablissements ue ON ue.etablissement_id = e.id
      JOIN utilisateurs u ON u.id = ue.utilisateur_id WHERE u.email = 'hopital.x@demo.arrimo' ORDER BY e.nom LIMIT 1`)).rows[0];
    const attendu = require('../public/apparence.js').resoudre('soleil', { lieu: etab, maintenant: new Date() });
    await a.click('#b-menu'); await a.waitForSelector('#menu-compte:not([hidden])');
    await a.selectOption('#apparence-barre', 'soleil');
    await a.waitForFunction(() => document.documentElement.dataset.apparence === 'soleil');
    assert.strictEqual(await a.evaluate(() => document.documentElement.dataset.theme), attendu, 'soleil à la position de l’établissement');
    await ctx.close();
  });
}

for (const L of LARGEURS.filter((l) => l.nom !== 'tablette')) {
  test(`centre de paramètres : navigation, thème persistant, OG personnalisé et appliqué, Journal, Support, mot de passe · ${L.nom}`, { timeout: 240000 }, async () => {
    for (const c of navigateur.contexts()) await c.close();
    await viderBase(pool);
    await demoReseau(pool, { silencieux: true, comptesRoles: true });
    // En démo, le coordonnateur personnalise OG (décision du 30 oct.) ; hors démo, le refus reste couvert par les tests API.
    const avantEnv = process.env.ARRIMO_ENV; process.env.ARRIMO_ENV = 'demo';
    try {
    const email = 'hopital.x@demo.arrimo';
    const apparence = async () => (await pool.query('SELECT apparence FROM utilisateurs WHERE email=$1', [email])).rows[0].apparence;
    const x = await ouvrir(L, email);
    // Barre principale : Journal et Support client n'y figurent plus ; ils restent accessibles par Paramètres.
    assert.strictEqual(await x.locator('#onglets button[data-v="journal"]').isVisible(), false);
    assert.strictEqual(await x.locator('#onglets button[data-v="support"]').isVisible(), false);
    await onglet(x, 'params');
    const entrees = await x.$$eval('#v-params [data-param-nav]', (bs) => bs.map((b) => b.dataset.paramNav));
    for (const e of ['compte', 'params:apparence', 'params:etablissement', 'params:og', 'params:notifications', 'journal', 'support']) assert.ok(entrees.includes(e), `menu : ${e} (${entrees})`);
    await verifier(x, L, 'params-etablissement');
    // Établissement : administratif (localisation, fuseau) et opérationnel (structure réelle)
    assert.ok(await x.locator('#v-params .compteurs dt').count() === 6, 'structure et capacités');
    assert.match(await x.textContent('#v-params'), /Fuseau horaire/);
    // Bascule de l'en-tête : immédiate et enregistrée, indépendante de l'heure.
    // On attend la réponse du serveur : en mode automatique sur un système clair, la page est déjà « clair » avant l'enregistrement.
    const theme = async () => { const r = x.waitForResponse((q) => q.url().includes('/api/moi/apparence') && q.request().method() === 'PUT'); await x.click('#b-theme'); assert.strictEqual((await r).status(), 200); };
    await theme(); await x.waitForFunction(() => document.documentElement.dataset.theme === 'clair');
    assert.strictEqual(await apparence(), 'clair');
    await theme(); await x.waitForFunction(() => document.documentElement.dataset.theme === 'sombre');
    assert.strictEqual(await apparence(), 'sombre');
    await x.click('#v-params [data-param-nav="params:apparence"]'); await x.waitForSelector('input[name="p-apparence"][value="sombre"]:checked');
    await verifier(x, L, 'params-apparence-sombre');
    // Heure et date de l'établissement toujours affichées (la météo dépend du fournisseur, coupé dans ce test).
    // Téléphone : météo, heure et date sont en tête du menu tiroir (l'en-tête reste sur une ligne).
    const tiroir = await x.locator('#b-nav').isVisible();
    if (tiroir) { await x.click('#b-nav'); await x.waitForFunction(() => document.body.classList.contains('nav-ouverte')); }
    await x.waitForSelector('#infos-lieu:not([hidden]) .il-heure');
    assert.match(await x.textContent('#infos-lieu .il-heure'), /\d{1,2}\D+\d{2}/);
    if (tiroir) { await x.keyboard.press('Escape'); await x.waitForFunction(() => !document.body.classList.contains('nav-ouverte')); }
    // Disposition du menu : barre verticale à gauche sur ordinateur, retenue après rechargement, puis retour en haut.
    if (L.nom === 'ordinateur') {
      await x.check('input[name="p-disposition"][value="verticale"]');
      await x.waitForFunction(() => document.body.classList.contains('nav-verticale') && document.querySelector('#onglets #infos-lieu'));
      await verifier(x, L, 'params-menu-vertical');
      await x.reload(); await x.waitForSelector('body[data-pret="1"]');
      assert.ok(await x.evaluate(() => document.body.classList.contains('nav-verticale')), 'disposition retenue');
      await x.click('#b-disposition'); await x.waitForFunction(() => !document.body.classList.contains('nav-verticale'));
      await onglet(x, 'params'); await x.click('#v-params [data-param-nav="params:apparence"]');
    }
    // OG : nom, avatar et voix enregistrés pour l'établissement, appliqués au panneau et à la voix.
    await x.click('#v-params [data-param-nav="params:og"]'); await x.waitForSelector('#og-nom:not([disabled])');
    await x.fill('#og-nom', 'Charles'); await x.selectOption('#og-modele', 'humain'); await x.selectOption('#og-voix', 'masculine');
    assert.match(await x.textContent('#og-etat'), /non enregistrées/);
    // Quitter avec des modifications non enregistrées : une confirmation est demandée ; refuser garde la saisie.
    x.once('dialog', (d) => d.dismiss());
    await x.click('#v-params [data-param-nav="params:apparence"]');
    assert.strictEqual(await x.inputValue('#og-nom'), 'Charles');
    await x.click('#og-enregistrer'); await toast(x, /Configuration (OG|Charles) enregistrée/);   // le nom choisi s'affiche partout, y compris dans les messages
    // Nom appliqué sans rechargement à toute l'interface de l'établissement : menu, bouton de l'assistant, paramètres.
    await x.waitForFunction(() => document.querySelector('#og-open [data-og-nom]')?.textContent === 'Charles'
      && document.querySelector('#onglets button[data-v="copilote"]').textContent.includes('Charles') && document.querySelector('#og-open').getAttribute('aria-label').includes('Charles'));
    const cfg = (await pool.query(`SELECT o.reglages FROM og_configurations o JOIN utilisateur_etablissements ue ON ue.etablissement_id=o.etablissement_id JOIN utilisateurs u ON u.id=ue.utilisateur_id WHERE u.email=$1`, [email])).rows[0].reglages;
    assert.deepStrictEqual([cfg.personnalisation.nom, cfg.personnalisation.avatar.modele, cfg.personnalisation.voix], ['Charles', 'humain', 'masculine']);
    await verifier(x, L, 'params-og');
    // Voix d'OG : autorisation et langue réglées ici (plus dans le panneau OG), enregistrées pour l'utilisateur.
    await x.waitForSelector('#params-og-voix #pv-consentement');
    await x.check('#pv-consentement'); await toast(x, 'Préférences vocales enregistrées');
    assert.strictEqual(await x.evaluate(() => window.ArrimoOgVoixPrefs.lire().consentement), true);
    await x.click('#og-open'); await x.waitForFunction(() => document.querySelector('#og-title')?.textContent === 'Charles');
    // Le nom peut précéder la configuration OG (nom de l'assistant par hôpital) : l'avatar suit dès sa lecture.
    assert.ok(await x.waitForSelector('.og-entete .og-avatar svg', { timeout: 10000 }).then(() => true, () => false), 'avatar appliqué');
    assert.strictEqual(await x.evaluate(() => window.ArrimoOgVoix), 'masculine', 'voix transmise au moteur vocal');
    await x.keyboard.press('Escape');
    await x.reload(); await x.waitForSelector('body[data-pret="1"]');
    assert.strictEqual(await x.evaluate(() => document.documentElement.dataset.theme), 'sombre', 'thème retrouvé après rechargement');
    await x.click('#og-open'); await x.waitForFunction(() => document.querySelector('#og-title')?.textContent === 'Charles');
    await x.keyboard.press('Escape');
    // Journal et Support client, depuis Paramètres, avec le menu secondaire.
    await onglet(x, 'journal'); await x.waitForSelector('#v-journal > .params-nav');
    await verifier(x, L, 'params-journal');
    await onglet(x, 'support'); await x.waitForSelector('#v-support > .params-nav');
    // Mot de passe : actuel exigé, nouveau valable à la reconnexion, ancien refusé.
    await x.click('#v-support [data-param-nav="compte"]'); await x.waitForSelector('#f-mdp');
    const nouveau = 'Arrimo-Nouveau-2026!x';
    await x.fill('#m-actuel', MDP); await x.fill('#m-nouveau', nouveau); await x.fill('#m-confirme', nouveau);
    await x.click('#f-mdp button[type=submit]'); await x.waitForTimeout(800);
    const essai = async (mdp) => (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, mot_de_passe: mdp }) })).status;
    assert.strictEqual(await essai(nouveau), 200, 'nouveau mot de passe');
    assert.strictEqual(await essai(MDP), 401, 'ancien mot de passe refusé');
    // Profil et déconnexion depuis Mon compte : la session est invalidée côté serveur.
    assert.match(await x.textContent('#v-compte'), new RegExp(email.replace('.', '\\.')));
    const jeton = await x.evaluate(() => { try { return localStorage.getItem('arrimo-token') || sessionStorage.getItem('arrimo-token'); } catch { return null; } });
    await x.click('#b-compte-deconnexion');
    await x.waitForSelector('#f-connexion:not([hidden])');
    if (jeton) {
      let statut = 0;
      for (let k = 0; k < 20 && statut !== 401; k += 1) { statut = (await fetch(`${base}/api/moi`, { headers: { Authorization: `Bearer ${jeton}` } })).status; if (statut !== 401) await x.waitForTimeout(100); }
      assert.strictEqual(statut, 401, 'session fermée côté serveur');
    }
    // Reconnexion avec le nouveau mot de passe : le thème choisi est retrouvé.
    await x.fill('#c-email', email); await x.fill('#c-mdp', nouveau);
    await x.click('#f-connexion button[type=submit]'); await x.waitForSelector('body[data-pret="1"]');
    assert.strictEqual(await x.evaluate(() => document.documentElement.dataset.theme), 'sombre', 'thème retrouvé après reconnexion');
    await x.context().close();
    } finally { if (avantEnv === undefined) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = avantEnv; }
  });
}

for (const L of LARGEURS.filter((l) => l.nom !== 'tablette')) {
  test(`patients fictifs : recherche, vérification d'identité, historique des passages, nouveau passage et clôture · ${L.nom}`, { timeout: 180000 }, async () => {
    for (const c of navigateur.contexts()) await c.close();
    await viderBase(pool);
    await demoReseau(pool, { silencieux: true });
    const avantEnv = process.env.ARRIMO_ENV; process.env.ARRIMO_ENV = 'demo';
    try {
      const email = 'hopital.x@demo.arrimo';
      const x = await ouvrir(L, email);
      const jeton = await x.evaluate(() => localStorage.getItem('arrimo-token'));
      const api = async (m, chemin, corps) => (await fetch(`${base}/api${chemin}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}` }, body: corps && JSON.stringify(corps) })).json();
      const etab = (await api('GET', '/moi')).etablissements[0].id;
      // Hôpital X est saturé : une civière de corridor est ajoutée, comme dans les scénarios A/B/C.
      const cv = (await api('GET', `/civieres?etablissement_id=${etab}`)).civieres.find((c) => c.etat === 'libre')
        || (await pool.query(`INSERT INTO civieres (etablissement_id, code, categorie) VALUES ($1, 'COR-UI', 'debordement') RETURNING id, version`, [etab])).rows[0];
      const arr = await api('POST', '/urgence/arrivees', { etablissement_id: etab, civiere_id: cv.id, version: cv.version, prenom: 'Noé', nom: 'Essai-Historique', date_naissance: '1972-04-18' });
      assert.ok(arr.passage, JSON.stringify(arr));
      await x.reload(); await x.waitForSelector('body[data-pret="1"]');
      await onglet(x, 'patients');
      await x.fill('#p-recherche', 'Essai-Hist'); await x.click('#f-patients button[type=submit]');
      await x.waitForSelector(`#v-patients [data-historique="${arr.patient.id}"]`);
      await verifier(x, L, 'patients-liste');
      // Vérification d'identité obligatoire avant l'historique
      await x.click(`#v-patients [data-historique="${arr.patient.id}"]`);
      await x.waitForSelector('#modale:not([hidden]) .detail-nsa');
      assert.match(await x.textContent('#modale'), /Essai-Historique/);
      await x.click('#modale .btn.pri');
      await x.waitForSelector('.historique-patient [data-passage]');
      assert.strictEqual(await x.locator('.historique-patient [data-passage]').count(), 1);
      await verifier(x, L, 'patients-historique');
      // Nouveau passage (consultation) : le passage d'urgence est clos, le nouveau est en cours
      await x.selectOption('#np-type', 'consultation'); await x.click('#f-passage button[type=submit]');
      await toast(x, 'Passage ouvert');
      await x.waitForFunction(() => document.querySelectorAll('.historique-patient [data-passage]').length === 2);
      // Clôture du passage en cours
      await x.locator('.historique-patient [data-clore]').first().click();
      await toast(x, 'Passage clos');
      await x.waitForFunction(() => !document.querySelector('.historique-patient [data-clore]'));
      const passages = (await pool.query('SELECT type, resultat FROM patient_passages WHERE patient_id = $1 ORDER BY arrivee_le', [arr.patient.id])).rows;
      assert.deepStrictEqual(passages.map((p) => p.type), ['urgence', 'consultation']);
      assert.ok(passages.every((p) => p.resultat === 'sorti'));
      await x.context().close();
    } finally { if (avantEnv === undefined) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = avantEnv; }
  });
}
