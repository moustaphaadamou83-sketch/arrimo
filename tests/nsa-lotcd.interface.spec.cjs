/**
 * Parcours NSA vers l'hébergement, lots C et D (17 nov. 2026) : demande, refus motivé, place suivante, confirmation avec l'usager,
 * départ organisé, lit à libérer, indicateurs — dans Chromium, captures dans docs/captures-nsa-lotcd-20261117/.
 * Base séparée obligatoire (jamais la démo) :
 *   INTERFACE_DATABASE_URL=postgres://…/arrimo_nsa_lotcd_ui node --test tests/nsa-lotcd.interface.spec.cjs
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
const DOSSIER = path.join(__dirname, '..', 'docs', 'captures-nsa-lotcd-20261117');
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
  await page.evaluate((v) => window.ArrimoEspaces?.reveler(v), vue).catch(() => {});
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

async function preparer() {
  await viderBase(pool);
  await demoReseau(pool, { silencieux: true, comptesRoles: true, avecTransfertsActifs: false });
  const hx = (await pool.query(`SELECT e.id, e.latitude, e.longitude, e.ville, e.config_id FROM etablissements e JOIN utilisateur_etablissements ue ON ue.etablissement_id = e.id
    JOIN utilisateurs u ON u.id = ue.utilisateur_id WHERE u.email = 'hopital.x@demo.arrimo'`)).rows[0];
  const cfg = await TE.configChsld(pool, hx.config_id);
  const ty = (await pool.query('SELECT id FROM types_unite WHERE config_id = $1 ORDER BY ordre LIMIT 1', [cfg])).rows[0].id;
  const ids = {};
  for (const [code, nom, typeLocal, dLat, circuit, login] of [['RPA-PARC', 'Résidence du Parc', 'rpa', 0.02, 'direct', 'coordination.parc@rpa.example.invalid'],
    ['CH-CARRE', 'CHSLD du Carré', null, 0.05, 'mecanisme_acces', 'coordination.carre@chsld.example.invalid']]) {
    const e = (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, profil_config_id, type_etablissement, type_local_code, actif, module_actif)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'chsld', $8, true, true) RETURNING id`, [code, nom, hx.ville, Number(hx.latitude) + dLat, hx.longitude, cfg, hx.config_id, typeLocal])).rows[0].id;
    const un = (await pool.query('INSERT INTO unites (etablissement_id, type_id, nom) VALUES ($1, $2, $3) RETURNING id', [e, ty, 'Hébergement'])).rows[0].id;
    for (let i = 1; i <= 2; i += 1) {
      const ch = (await pool.query('INSERT INTO chambres (unite_id, numero) VALUES ($1, $2) RETURNING id', [un, String(100 + i)])).rows[0].id;
      await pool.query(`INSERT INTO lits (chambre_id, unite_id, type_id, etablissement_id, code, etat) VALUES ($1, $2, $3, $4, $5, 'libre')`, [ch, un, ty, e, `${code}-${100 + i}`]);
    }
    await pool.query('INSERT INTO ressource_profils (etablissement_id, circuit, statut_ressource) VALUES ($1, $2, $3)', [e, circuit, typeLocal ? 'prive' : 'public']);
    const u = (await pool.query(`INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, 'coordonnateur') RETURNING id`, [login, `Coordination · ${nom}`, hacher(MDP)])).rows[0].id;
    await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, e]);
    ids[code] = e;
  }
  const l = (await pool.query(`SELECT id, code, patient_ref FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' AND nsa_depuis IS NULL ORDER BY id LIMIT 1`, [hx.id])).rows[0];
  await pool.query(`UPDATE lits SET nsa_depuis = now() - interval '19 days', nsa_orientation = 'rpa' WHERE id = $1`, [l.id]);
  return { hx, ids, lit: l };
}
async function demander(x, lit, nomMilieu, L, capture1) {
  await onglet(x, 'nsa');
  await x.fill('#n-recherche', lit.code.toLowerCase());
  await x.locator(`#v-nsa button[data-vers-chsld="${lit.id}"]`).click();
  await x.waitForSelector('#modale:not([hidden]) #oc-chsld');
  const val = await x.locator('#oc-chsld option', { hasText: nomMilieu }).getAttribute('value');
  await x.selectOption('#oc-chsld', val);
  await x.locator('#modale details summary').click();
  await x.fill('#oc-prenom', 'Fictive'); await x.fill('#oc-nom', 'Usagère'); await x.fill('#oc-dn', '1938-05-04');
  if (capture1) await capture(x, L, capture1);
  await x.click('#modale .actions .btn.pri');
  await x.waitForSelector('#modale', { state: 'hidden' });
}
const item = (p, num) => p.locator('#v-c-demandes .item', { hasText: num });

for (const L of LARGEURS) {
  test(`NSA lots C et D dans le navigateur · ${L.nom}`, { timeout: 300000 }, async () => {
    const { lit } = await preparer();
    const x = await ouvrir(L, 'hopital.x@demo.arrimo');
    // 1. Demande à une RPA : documents de l'admission directe (contrat ou bail)
    await onglet(x, 'nsa');
    await x.fill('#n-recherche', lit.code.toLowerCase());
    await x.locator(`#v-nsa button[data-vers-chsld="${lit.id}"]`).click();
    await x.waitForSelector('#modale:not([hidden]) #oc-chsld');
    await x.selectOption('#oc-chsld', await x.locator('#oc-chsld option', { hasText: 'Résidence du Parc' }).getAttribute('value'));
    assert.match(await x.textContent('#oc-docs'), /Contrat d’hébergement ou bail/);
    assert.doesNotMatch(await x.textContent('#oc-docs'), /mécanisme d’accès/);
    await x.click('#modale .actions .btn:not(.pri)');
    await demander(x, lit, 'Résidence du Parc', L, '01-demande-rpa-documents');
    const num1 = await x.locator('[data-sortie]').first().getAttribute('data-sortie');
    // 2. La RPA refuse avec un motif choisi dans la liste
    const r = await ouvrir(L, 'coordination.parc@rpa.example.invalid');
    await onglet(r, 'c-demandes');
    await item(r, num1).locator('[data-dh="refuser"]').click();
    await r.waitForSelector('#modale:not([hidden]) #dh-motif');
    assert.strictEqual(await r.locator('#modale textarea, #modale input[type=text]').count(), 0, 'aucun texte libre');
    await r.selectOption('#dh-motif', 'besoin_non_couvert');
    await capture(r, L, '02-refus-motif');
    await r.click('#modale .actions .btn.pri');
    await r.waitForSelector('#modale', { state: 'hidden' });
    assert.deepStrictEqual(r.erreurs, []); await r.context().close();
    // 3. L'hôpital voit le motif et propose la place suivante
    await onglet(x, 'nsa');
    const s1 = x.locator(`[data-sortie="${num1}"]`);
    await s1.getByText('Refusée · Besoin non couvert').waitFor();
    await s1.locator('[data-suivante]').click();
    await x.waitForSelector('#modale:not([hidden]) .place-nsa, #modale:not([hidden]) p');
    await capture(x, L, '03-refus-place-suivante');
    await x.click('#modale .actions .btn.pri');
    // 4. Demande au CHSLD (mécanisme d'accès) ; il vérifie, propose et accepte
    await demander(x, lit, 'CHSLD du Carré', L, null);
    const num2 = await x.locator('[data-sortie]').first().getAttribute('data-sortie');
    const c = await ouvrir(L, 'coordination.carre@chsld.example.invalid');
    await onglet(c, 'c-demandes');
    await item(c, num2).locator('[data-dh="verifier"]').click();
    await item(c, num2).locator('[data-dh="proposer_place"]').waitFor();
    await item(c, num2).locator('[data-dh="proposer_place"]').click(); await c.waitForSelector('#dh-lit');
    await c.click('#modale .actions .btn.pri'); await c.waitForSelector('#modale', { state: 'hidden' });
    await item(c, num2).locator('[data-dh="accepter"]').click();
    await item(c, num2).getByText('En attente du départ confirmé par l’hôpital').waitFor();
    // 5. L'hôpital confirme la place avec l'usager ou la famille et organise le départ
    await onglet(x, 'nsa');
    const s2 = x.locator(`[data-sortie="${num2}"]`);
    assert.strictEqual(await s2.locator('[data-depart-chsld]').count(), 0, 'pas de départ avant la confirmation de la place');
    await s2.locator('[data-confirmer-place]').click();
    await x.waitForSelector('#modale:not([hidden]) #cp-depart');
    await x.click('#modale .actions .btn.pri');
    await x.locator('.toast', { hasText: 'Cochez la confirmation' }).first().waitFor({ timeout: 8000 });
    await x.check('#cp-accord'); await x.selectOption('#cp-transport', 'transport_adapte'); await x.check('#cp-famille');
    await capture(x, L, '04-confirmer-place-depart');
    await x.click('#modale .actions .btn.pri');
    await x.waitForSelector('#modale', { state: 'hidden' });
    await s2.getByText(/Départ prévu .* Transport adapté · famille avisée/).waitFor();
    await s2.locator('[data-depart-chsld]').waitFor();
    const lt = (await pool.query('SELECT conge_statut FROM lits WHERE id = $1', [lit.id])).rows[0];
    assert.strictEqual(lt.conge_statut, 'prevu', 'lit « à libérer »');
    await capture(x, L, '05-depart-organise');
    // La ressource voit la place confirmée et l'heure prévue
    await onglet(c, 'c-demandes');
    await item(c, num2).getByText(/Place confirmée par l’hôpital · départ prévu/).waitFor();
    await capture(c, L, '06-ressource-place-confirmee');
    assert.deepStrictEqual(c.erreurs, []); await c.context().close();
    // 6. Départ confirmé, puis indicateurs du parcours
    await s2.locator('[data-depart-chsld]').click();
    await s2.getByText(/Parti le/).waitFor();
    await x.locator('#nsa-indicateurs summary').click();
    const ind = (await x.textContent('#nsa-indicateurs')).replace(/\s+/g, ' ');
    assert.match(ind, /Par ressource/); assert.match(ind, /Résidence du Parc/); assert.match(ind, /Besoin non couvert : 1/);
    assert.ok(!ind.includes(lit.patient_ref), 'aucune référence de patient dans les indicateurs');
    await x.locator('#nsa-indicateurs').scrollIntoViewIfNeeded();
    await sansDebordement(x, L, 'indicateurs');
    await capture(x, L, '07-indicateurs');
    assert.deepStrictEqual(x.erreurs, []);
    await x.context().close();
  });
}
