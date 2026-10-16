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
  process.env.ARRIMO_DEMO = '1';   // serveur de démonstration : bandeau et remise à zéro
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
    await demoDeux(pool, { silencieux: true });

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
    await p1.fill('#c-email', 'urgence.x@demo.arrimo'); await p1.fill('#c-mdp', MDP);
    await p1.click('#f-connexion button[type=submit]');
    await p1.waitForSelector('#b-premiers-pas-ok');
    await verifier(p1, L, '00-premiers-pas');
    await p1.click('#b-premiers-pas-ok');
    await menu(p1, '#b-deconnexion');
    await p1.fill('#c-email', 'urgence.x@demo.arrimo'); await p1.fill('#c-mdp', MDP);
    await p1.click('#f-connexion button[type=submit]');
    await p1.waitForSelector('body[data-pret="1"]');
    assert.ok(!(await p1.isVisible('#b-premiers-pas-ok')), 'premiers pas montrés une seule fois');
    await pp.close();

    // 1. Le problème : Copilote de l'Hôpital X
    const x = await ouvrir(L, 'coordo.x@demo.arrimo');
    await verifierAide(x, L, '01b-aide-coordination', 'coordonnateur');
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

    const y = await ouvrir(L, 'coordo.y@demo.arrimo');
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
    await verifierAide(r, L, '17b-aide-administration', 'gestionnaire');

    // 7. La sécurité : double authentification exigée, puis création d'un compte
    await onglet(r, 'admin');
    assert.match(await r.textContent('#v-admin'), /double authentification/i);
    await r.click('#b-vers-compte');
    await r.click('#b-2fa-prep');
    await r.waitForSelector('#a-code');
    await verifier(r, L, '18-activation-2fa');
    const secret = (await r.textContent('#zone-2fa .num')).trim();
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
  await demoDeux(pool, { silencieux: true });
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
  await accueil.fill('#c-email', 'coordo.x@demo.arrimo');
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

  const x = await ouvrir(L, 'coordo.x@demo.arrimo', 'en');
  await x.waitForSelector('#v-copilote .niveau');
  await ecran(x, '01-copilot');
  for (let i = 0; i < 6; i += 1) {
    await x.click(`#v-copilote [data-ex="${i}"]`);
    await x.waitForSelector('#v-copilote .reponse');
    await ecran(x, `02-question-${i}`);
  }
  for (const vue of ['reseau', 'lits', 'urgence', 'admissions', 'transferts', 'nettoyage', 'nsa', 'indicateurs', 'journal', 'params']) {
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

  const y = await ouvrir(L, 'coordo.y@demo.arrimo', 'en');
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
  await ecran(r, '13-admin-2fa');
  await r.click('#b-vers-compte');
  await r.click('#b-2fa-prep');
  await r.waitForSelector('#a-code');
  await ecran(r, '14-2fa');
  const secret = (await r.textContent('#zone-2fa .num')).trim();
  await r.fill('#a-code', totp.codePourPas(secret, totp.pasActuel()));
  await r.click('#b-2fa-ok');
  await toast(r, 'enabled');
  await onglet(r, 'admin');
  for (const sous of ['utilisateurs', 'structure', 'config', 'connecteurs', 'journal']) {
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
