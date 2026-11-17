/**
 * Parcours NSA vers l'hébergement, lot B (17 nov. 2026) : places compatibles, envoi humain, poids du classement, profil et places à venir
 * d'une ressource — dans Chromium, captures dans docs/captures-nsa-lotb-20261117/.
 * Base séparée obligatoire (jamais la démo) :
 *   INTERFACE_DATABASE_URL=postgres://…/arrimo_nsa_lotb_ui node --test tests/nsa-lotb.interface.spec.cjs
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
const { hacher } = require('../src/auth');
const TE = require('../src/types-etablissement');
const routeurTest = require('./routeur-fictif.cjs');

const URL_TEST = process.env.INTERFACE_DATABASE_URL || process.env.TEST_DATABASE_URL;
const MDP = process.env.DEMO_MOT_DE_PASSE || 'Demo-Arrimo-2026';
process.env.ARRIMO_METEO = '0';
const DOSSIER = path.join(__dirname, '..', 'docs', 'captures-nsa-lotb-20261117');
const LARGEURS = [{ nom: 'ordinateur', width: 1366, height: 860 }, { nom: 'telephone', width: 390, height: 844, tactile: true, mobile: true }];
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
  page.on('console', (m) => { if (m.type() === 'error' && !/40[134]/.test(m.text())) page.erreurs.push(m.text()); });
  if (langue) await page.addInitScript((l) => { try { localStorage.setItem('arrimo-langue', l); } catch { /* */ } }, langue);
  await page.goto(base);
  await page.fill('#c-email', email); await page.fill('#c-mdp', MDP);
  await page.click('#f-connexion button[type=submit]');
  await page.waitForSelector('body[data-pret="1"]');
  const pp = page.locator('#b-premiers-pas-ok'); if (await pp.isVisible().catch(() => false)) await pp.click();
  return page;
}
async function onglet(page, vue) {
  await allerOnglet(page, vue);
  await page.waitForFunction((v) => !document.querySelector(`#v-${v}`).hidden && document.querySelector(`#v-${v}`).children.length > 0, vue, { timeout: 60000 });
  await page.waitForTimeout(250);
}
const capture = (page, L, nom) => page.screenshot({ path: path.join(DOSSIER, `${L.nom}-${nom}.png`) });
const jourPlus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function sansDebordement(page, L, nom) {
  const large = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(large <= 1, `${L.nom} ${nom} : débordement horizontal de ${large} px`);
}

/** Ressources fictives (RI) près de l'Hôpital X, configurées comme un CHSLD ; un compte de coordination pour la première. */
async function preparer() {
  await viderBase(pool);
  await demoReseau(pool, { silencieux: true, comptesRoles: true, avecTransfertsActifs: false });
  const hx = (await pool.query(`SELECT e.id, e.latitude, e.longitude, e.ville, e.config_id FROM etablissements e JOIN utilisateur_etablissements ue ON ue.etablissement_id = e.id
    JOIN utilisateurs u ON u.id = ue.utilisateur_id WHERE u.email = 'hopital.x@demo.arrimo'`)).rows[0];
  const cfg = await TE.configChsld(pool, hx.config_id);
  const ty = (await pool.query('SELECT id FROM types_unite WHERE config_id = $1 ORDER BY ordre LIMIT 1', [cfg])).rows[0].id;
  const ids = {};
  for (const [code, nom, dLat, libres, capacites] of [['RI-PINS', 'RI des Pins', 0.02, 2, ['fauteuil', 'unite_securisee']], ['RI-FLEUVE', 'RI du Fleuve', 0.15, 0, ['fauteuil', 'unite_securisee', 'oxygene']],
    ['RI-CEDRES', 'RI des Cèdres', 0.3, 1, ['fauteuil', 'unite_securisee']], ['RI-SOLEIL', 'RI du Soleil', 0.05, 1, []]]) {
    const e = (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, profil_config_id, type_etablissement, type_local_code, actif, module_actif)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'chsld', 'ri', true, true) RETURNING id`, [code, nom, hx.ville, Number(hx.latitude) + dLat, hx.longitude, cfg, hx.config_id])).rows[0].id;
    const un = (await pool.query('INSERT INTO unites (etablissement_id, type_id, nom) VALUES ($1, $2, $3) RETURNING id', [e, ty, 'Hébergement'])).rows[0].id;
    for (let i = 1; i <= 3; i += 1) {
      const ch = (await pool.query('INSERT INTO chambres (unite_id, numero) VALUES ($1, $2) RETURNING id', [un, String(100 + i)])).rows[0].id;
      await pool.query(`INSERT INTO lits (chambre_id, unite_id, type_id, etablissement_id, code, etat) VALUES ($1, $2, $3, $4, $5, $6)`, [ch, un, ty, e, `${code}-${100 + i}`, i <= libres ? 'libre' : 'indispo']);
    }
    await pool.query('INSERT INTO ressource_profils (etablissement_id, capacites) VALUES ($1, $2)', [e, capacites]);
    ids[code] = e;
  }
  await pool.query(`INSERT INTO places_a_venir (etablissement_id, date_prevue, certitude) VALUES ($1, $2, 'confirmee')`, [ids['RI-FLEUVE'], jourPlus(4)]);
  const u = (await pool.query(`INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ('coordination.pins@ri.example.invalid', 'Coordination · RI des Pins', $1, 'coordonnateur') RETURNING id`, [hacher(MDP)])).rows[0].id;
  await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, ids['RI-PINS']]);
  // Patient NSA fictif à l'Hôpital X, orienté RI : fauteuil et unité sécurisée ; famille dans la même ville ; 1er choix : RI du Fleuve
  const l = (await pool.query(`SELECT id, code FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' AND nsa_depuis IS NULL ORDER BY id LIMIT 1`, [hx.id])).rows[0];
  await pool.query(`UPDATE lits SET nsa_depuis = now() - interval '23 days', nsa_orientation = 'ri' WHERE id = $1`, [l.id]);
  const ep = (await pool.query(`SELECT id FROM nsa_episodes WHERE lit_id = $1 AND statut = 'actif'`, [l.id])).rows[0].id;
  await pool.query(`INSERT INTO nsa_besoins (episode_id, codes, municipalite_famille, preferences) VALUES ($1, '{fauteuil,unite_securisee}', $2, $3)`, [ep, hx.ville, [ids['RI-FLEUVE']]]);
  return { hx, ids, lit: l };
}

for (const L of LARGEURS) {
  test(`NSA lot B dans le navigateur · ${L.nom}`, { timeout: 240000 }, async () => {
    const { ids, lit } = await preparer();
    // 1. Hôpital : places compatibles, les 3 meilleures expliquées, milieux écartés
    const x = await ouvrir(L, 'hopital.x@demo.arrimo');
    await onglet(x, 'nsa');
    await x.fill('#n-recherche', lit.code.toLowerCase());
    await x.locator(`#v-nsa button[data-nsa-places="${lit.id}"]`).click();
    await x.waitForSelector('#modale:not([hidden]) .place-nsa');
    const texte = (await x.textContent('#modale')).replace(/\s+/g, ' ');
    assert.match(texte, /Orientation choisie par l’équipe : Ressource intermédiaire/);
    const noms = await x.$$eval('#modale .place-nsa.meilleure b', (bs) => bs.map((b) => b.textContent.replace(/^\d+\.\s*/, '')));
    assert.deepStrictEqual(noms, ['RI du Fleuve', 'RI des Pins', 'RI des Cèdres'], 'préférence de la famille, puis proximité et place libre');
    assert.match(texte, /1er choix de la famille/); assert.match(texte, /place libre aujourd’hui/); assert.match(texte, /\/100/);
    assert.match(texte, /Milieux écartés \(1\)/);
    assert.strictEqual(await x.locator('#modale .place-nsa button:has-text("Fermer")').count(), 0, 'le bouton Fermer reste en bas de la fenêtre');
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(texte), 'dates lisibles, jamais au format technique');
    await x.click('#modale details summary');
    assert.match((await x.textContent('#modale')).replace(/\s+/g, ' '), /RI du Soleil.*capacité non déclarée : Fauteuil roulant, Errance : unité sécurisée/);
    await sansDebordement(x, L, 'places');
    await capture(x, L, '01-places-compatibles');
    // 2. « Transmettre une demande » : la fenêtre habituelle s'ouvre, milieu présélectionné ; l'humain décide (ici, annule)
    await x.locator(`#modale [data-transmettre="${ids['RI-PINS']}"]`).click();
    await x.waitForSelector('#modale:not([hidden]) #oc-chsld');
    assert.strictEqual(Number(await x.inputValue('#oc-chsld')), ids['RI-PINS']);
    await capture(x, L, '02-transmettre-preselection');
    await x.click('#modale .actions .btn:not(.pri)');
    assert.deepStrictEqual(x.erreurs, []);
    await x.context().close();

    // 3. Ressource : profil d'hébergement et places à venir (aucune donnée de patient)
    const r = await ouvrir(L, 'coordination.pins@ri.example.invalid');
    await onglet(r, 'c-chambres');
    await r.waitForSelector('#ch-hebergement #hb-enregistrer');
    assert.ok(await r.isChecked('#ch-hebergement [data-hb-cap][value="unite_securisee"]'));
    await r.check('#ch-hebergement [data-hb-cap][value="leve_personne"]');
    await r.fill('#hb-delai', '2');
    await r.click('#hb-enregistrer');
    await r.locator('.toast', { hasText: 'Profil d’hébergement enregistré' }).first().waitFor({ timeout: 8000 });
    await r.waitForSelector('#pav-ajouter');
    await r.fill('#pav-date', jourPlus(6));
    await r.selectOption('#pav-cert', 'confirmee');
    await r.click('#pav-ajouter');
    await r.locator('.toast', { hasText: 'Place à venir ajoutée' }).first().waitFor({ timeout: 8000 });
    await r.waitForSelector('#ch-hebergement [data-pav]');
    const p = (await pool.query('SELECT capacites, delai_admission_jours FROM ressource_profils WHERE etablissement_id = $1', [ids['RI-PINS']])).rows[0];
    assert.deepStrictEqual([p.capacites.sort(), p.delai_admission_jours], [['fauteuil', 'leve_personne', 'unite_securisee'], 2]);
    await r.locator('#ch-hebergement').scrollIntoViewIfNeeded();
    await sansDebordement(r, L, 'ressource');
    await capture(r, L, '03-ressource-profil-places');
    assert.ok(!/P-\d{5}/.test(await r.textContent('#ch-hebergement')), 'aucune référence de patient côté ressource');
    assert.deepStrictEqual(r.erreurs, []);
    await r.context().close();

    // 4. Poids du classement : l'administration règle, le total doit faire 100 (compte réseau)
    if (L.nom === 'ordinateur') {
      const g = await ouvrir(L, 'reseau@demo.arrimo');
      await onglet(g, 'params');
      await g.waitForSelector('#params-nsa-poids #np-enregistrer');
      await g.fill('#np-preference', '40');
      assert.ok(await g.isDisabled('#np-enregistrer'), 'total différent de 100 : enregistrement impossible');
      assert.match(await g.textContent('#np-total'), /110 \/ 100/);
      await g.fill('#np-proximite', '15');
      assert.ok(!(await g.isDisabled('#np-enregistrer')));
      await g.locator('#params-nsa-poids').scrollIntoViewIfNeeded();
      await capture(g, L, '04-poids-classement');
      await g.click('#np-enregistrer');
      await g.locator('.toast', { hasText: 'Poids du classement enregistrés' }).first().waitFor({ timeout: 8000 });
      assert.deepStrictEqual(g.erreurs, []);
      await g.context().close();
      // 5. En anglais, la fenêtre des places est traduite
      const en = await ouvrir(L, 'hopital.x@demo.arrimo', 'en');
      await onglet(en, 'nsa');
      await en.fill('#n-recherche', lit.code.toLowerCase());
      await en.locator(`#v-nsa button[data-nsa-places="${lit.id}"]`).click();
      await en.waitForSelector('#modale:not([hidden]) .place-nsa');
      const t = await en.textContent('#modale');
      assert.match(t, /Compatible places/); assert.match(t, /Family’s 1st choice|place free today/);
      assert.ok(!/Orientation choisie|place libre aujourd’hui|Milieux écartés/.test(t), 'aucun texte français');
      await capture(en, L, '05-places-anglais');
      await en.context().close();
    }
  });
}
