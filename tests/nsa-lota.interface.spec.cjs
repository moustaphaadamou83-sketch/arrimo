/**
 * Parcours NSA vers l'hébergement, lot A (17 nov. 2026) : vérification dans Chromium, captures dans docs/captures-nsa-lota-20261117/.
 * Base séparée obligatoire (jamais la démo) :
 *   INTERFACE_DATABASE_URL=postgres://…/arrimo_nsa_lota_ui node --test tests/nsa-lota.interface.spec.cjs
 * Données fictives seulement (démo réseau reconstruite dans la base de test).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { demarrerServeur } = require('./serveur-test.cjs');
const { allerOnglet } = require('./aide-navigation.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { demoReseau } = require('../db/demo-reseau');
const { viderBase } = require('../db/vider');
const routeurTest = require('./routeur-fictif.cjs');

const URL_TEST = process.env.INTERFACE_DATABASE_URL || process.env.TEST_DATABASE_URL;
const MDP = process.env.DEMO_MOT_DE_PASSE || 'Demo-Arrimo-2026';
process.env.ARRIMO_METEO = '0';
const DOSSIER = path.join(__dirname, '..', 'docs', 'captures-nsa-lota-20261117');
const LARGEURS = [{ nom: 'ordinateur', width: 1366, height: 800 }, { nom: 'telephone', width: 390, height: 844, tactile: true, mobile: true }];

let pool; let serveur; let base; let navigateur; let restaurerRouteur;
test.before(async () => {
  assert.ok(URL_TEST, 'INTERFACE_DATABASE_URL requis');
  assert.ok(!/arrimo_demo|\/arrimo(\?|$)|arrimo_recette/.test(URL_TEST), 'jamais sur une base de démonstration ou de recette');
  restaurerRouteur = routeurTest.activer();
  process.env.ARRIMO_DEMO = '1';
  pool = creerPool(URL_TEST);
  serveur = await demarrerServeur(creerApp(pool));
  base = `http://127.0.0.1:${serveur.address().port}`;
  navigateur = await chromium.launch();
  fs.mkdirSync(DOSSIER, { recursive: true });
});
test.after(async () => { await navigateur?.close(); serveur?.close(); await pool?.end(); restaurerRouteur?.(); });

async function ouvrir(L, email, langue) {
  const ctx = await navigateur.newContext({ viewport: { width: L.width, height: L.height }, hasTouch: !!L.tactile, isMobile: !!L.mobile });
  const page = await ctx.newPage();
  page.erreurs = [];
  page.on('pageerror', (e) => page.erreurs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/401|403/.test(m.text())) page.erreurs.push(m.text()); });
  if (langue) await page.addInitScript((l) => { try { localStorage.setItem('arrimo-langue', l); } catch { /* */ } }, langue);
  await page.goto(base);
  await page.fill('#c-email', email);
  await page.fill('#c-mdp', MDP);
  await page.click('#f-connexion button[type=submit]');
  await page.waitForSelector('body[data-pret="1"]');
  const pp = page.locator('#b-premiers-pas-ok');
  if (await pp.isVisible().catch(() => false)) await pp.click();
  return page;
}
async function onglet(page, vue) {
  await page.evaluate((v) => window.ArrimoEspaces?.reveler(v), vue).catch(() => {});
  await allerOnglet(page, vue);
  await page.waitForFunction((v) => !document.querySelector(`#v-${v}`).hidden && document.querySelector(`#v-${v}`).children.length > 0, vue, { timeout: 60000 });
  await page.waitForTimeout(200);
}
const capture = (page, L, nom) => page.screenshot({ path: path.join(DOSSIER, `${L.nom}-${nom}.png`), fullPage: false });
const jour = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
/** Pas de défilement horizontal de la page : la mise en page tient dans la largeur. */
async function sansDebordement(page, L, nom) {
  const large = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(large <= 1, `${L.nom} ${nom} : débordement horizontal de ${large} px`);
}

for (const L of LARGEURS) {
  test(`NSA lot A dans le navigateur · ${L.nom}`, { timeout: 240000 }, async () => {
    await viderBase(pool);
    await demoReseau(pool, { silencieux: true, comptesRoles: true, avecTransfertsActifs: false });
    // Milieu d'hébergement fictif pour les préférences (type CHSLD, nom court RI)
    const cfg = (await pool.query('SELECT config_id FROM etablissements ORDER BY id LIMIT 1')).rows[0].config_id;
    await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, type_etablissement, type_local_code, actif)
      VALUES ('UI-RI', 'Ressource fictive des Pins', 'Laval', 45.57, -73.7, $1, 'chsld', 'ri', true) ON CONFLICT (code) DO NOTHING`, [cfg]);

    const x = await ouvrir(L, 'hopital.x@demo.arrimo');
    // 1. Désigner NSA depuis la carte du lit : orientation élargie, date de début saisie, place transitoire
    await onglet(x, 'lits');
    const bouton = x.locator('#v-lits button[data-action="nsa"]').first();
    await bouton.scrollIntoViewIfNeeded();
    const litId = Number(await bouton.getAttribute('data-lit'));
    const code = await bouton.getAttribute('data-code');
    await bouton.click();
    await x.waitForSelector('#modale:not([hidden]) #m-nsa-debut');
    await x.selectOption('#m-orient', 'rpa');
    await x.fill('#m-nsa-debut', jour(12));
    await x.check('#m-nsa-transitoire');
    await capture(x, L, '01-designer-nsa');
    await x.click('#modale .actions .btn.pri');
    await x.locator('.toast', { hasText: code }).first().waitFor({ timeout: 8000 });
    const ep = (await pool.query(`SELECT transitoire, debut_le::date::text AS debut FROM nsa_episodes WHERE lit_id = $1 AND statut = 'actif'`, [litId])).rows[0];
    assert.strictEqual(ep.transitoire, true);
    assert.strictEqual(ep.debut, jour(12));

    // 2. Liste NSA : compteur depuis la date déclarée, badge « transitoire acceptée »
    await onglet(x, 'nsa');
    await x.fill('#n-recherche', code.toLowerCase());
    const ligne = x.locator(`#v-nsa tr:has(button[data-nsa-besoins="${litId}"])`);
    await ligne.waitFor();
    assert.match(await ligne.textContent(), /1[12] jours/);
    assert.match(await ligne.textContent(), /transitoire acceptée/);
    await sansDebordement(x, L, 'liste');
    await capture(x, L, '02-liste-nsa');

    // 3. Besoins en catégories : vides, puis remplis
    await ligne.locator(`button[data-nsa-besoins="${litId}"]`).click();
    await x.waitForSelector('#modale:not([hidden]) #nb-muni');
    assert.strictEqual(await x.inputValue('#nb-sexe'), 'indifferent');
    await capture(x, L, '03-besoins-vides');
    await x.check('#modale [data-nb-code][value="unite_securisee"]');
    await x.check('#modale [data-nb-code][value="oxygene"]');
    await x.check('#modale [data-nb-code][value="fauteuil"]');
    await x.selectOption('#nb-sexe', 'F');
    await x.selectOption('#nb-langue', 'fr');
    await x.fill('#nb-muni', 'Laval');
    const ri = (await pool.query(`SELECT id FROM etablissements WHERE code = 'UI-RI'`)).rows[0].id;
    await x.selectOption('#nb-pref-0', String(ri));
    await x.click('#modale .actions .btn.pri');
    await x.locator('.toast', { hasText: code }).first().waitFor({ timeout: 8000 });
    await ligne.locator(`button[data-nsa-besoins="${litId}"]`).click();
    await x.waitForSelector('#modale:not([hidden]) #nb-muni');
    assert.strictEqual(await x.inputValue('#nb-muni'), 'Laval');
    assert.ok(await x.isChecked('#modale [data-nb-code][value="oxygene"]'));
    await capture(x, L, '04-besoins-remplis');
    await x.click('#modale .actions .btn:not(.pri)');

    // 4. Changer l'orientation dans la liste, puis le détail : historique, déclarant, correction de la date
    await x.selectOption(`#v-nsa select[data-orient="${litId}"]`, 'chsld_prive_conventionne');
    await x.locator('.toast', { hasText: /Orientation/ }).first().waitFor({ timeout: 8000 });
    await x.fill('#n-recherche', code.toLowerCase());
    await x.locator(`#v-nsa button[data-nsa-detail="${litId}"]`).click();
    await x.waitForSelector('#modale:not([hidden]) .detail-nsa');
    const detail = await x.textContent('#modale');
    assert.match(detail, /Historique des orientations/);
    assert.match(detail, /CHSLD privé conventionné/);
    assert.match(detail, /Résidence privée pour aînés/);
    assert.strictEqual(await x.locator('#modale .historique-nsa li:visible').count(), 2, 'les deux orientations sont visibles');
    const hauteur = await x.evaluate(() => { const u = document.querySelector('#modale .historique-nsa'); return u.scrollHeight - u.clientHeight; });
    assert.ok(hauteur <= 1, 'historique jamais comprimé dans la fenêtre');
    assert.ok(!/Laval|Oxygène|sécurisée/.test(detail), 'les besoins ne figurent pas dans le détail');
    await x.click('#modale details.corriger-nsa summary');
    await capture(x, L, '05-detail-historique');
    await x.fill('#dn-debut', jour(15));
    await x.click('#dn-enregistrer');
    await x.locator('.toast', { hasText: 'Statut NSA mis à jour' }).first().waitFor({ timeout: 8000 });
    assert.strictEqual((await pool.query(`SELECT debut_le::date::text AS d FROM nsa_episodes WHERE lit_id = $1 AND statut = 'actif'`, [litId])).rows[0].d, jour(15));

    // 5. Loi 25 : rien des besoins dans le journal de l'établissement
    const j = (await pool.query(`SELECT string_agg(action || ' ' || coalesce(detail, ''), ' | ') AS t FROM journal WHERE lit_id = $1`, [litId])).rows[0].t;
    assert.match(j, /Besoins NSA mis à jour/);
    assert.ok(!/Laval|oxyg|securis|fauteuil/i.test(j), j);
    assert.deepStrictEqual(x.erreurs, []);
    await x.context().close();

    // 6. L'entretien ne voit pas le bouton Besoins (et l'API le refuse, voir tests/api.test.js)
    const e = await ouvrir(L, 'entretien.x@demo.arrimo');
    if (await e.locator('#onglets button[data-v="nsa"]').count() && await e.locator('#onglets button[data-v="nsa"]').isVisible().catch(() => false)) {
      await onglet(e, 'nsa');
      assert.strictEqual(await e.locator('#v-nsa [data-nsa-besoins]').count(), 0);
    }
    await e.context().close();

    // 7. Interface en anglais : fenêtre des besoins traduite
    if (L.nom === 'ordinateur') {
      const en = await ouvrir(L, 'hopital.x@demo.arrimo', 'en');
      await onglet(en, 'nsa');
      await en.fill('#n-recherche', code.toLowerCase());
      await en.locator(`#v-nsa button[data-nsa-besoins="${litId}"]`).click();
      await en.waitForSelector('#modale:not([hidden]) #nb-muni');
      const texte = await en.textContent('#modale');
      assert.match(texte, /Placement needs/); assert.match(texte, /Secure unit|secure unit/);
      assert.ok(!/Besoins|Municipalité|Oxygène/.test(texte), 'aucun texte français dans la fenêtre anglaise');
      await capture(en, L, '06-besoins-anglais');
      assert.deepStrictEqual(en.erreurs, []);
      await en.context().close();
    }
    await pool.query(`DELETE FROM nsa_besoins WHERE episode_id IN (SELECT id FROM nsa_episodes WHERE lit_id = $1)`, [litId]);
  });
}
