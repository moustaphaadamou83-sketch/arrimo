/**
 * Audit XSS stockée : des charges actives sont écrites dans chaque champ texte qu'un administrateur d'établissement
 * ou un utilisateur peut saisir (structure, comptes, transferts, NSA, connecteurs, établissement), puis tous les
 * écrans sont parcourus dans Chromium par un coordonnateur d'un autre hôpital et par le gestionnaire réseau.
 * Aucune charge ne doit s'exécuter. Base dédiée arrimo_audit_* (effacée).
 *
 *   AUDIT_DATABASE_URL=postgres:///arrimo_audit_xss node --test tests/audit-xss.spec.cjs
 */
const test = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { demoReseau } = require('../db/demo-reseau');
const routeurTest = require('./routeur-fictif.cjs');

const URL_AUDIT = process.env.AUDIT_DATABASE_URL;
const MDP = process.env.DEMO_MOT_DE_PASSE || 'Demo-Arrimo-2026';
// Une charge par contexte : texte, attribut entre guillemets doubles ou simples, URL.
const charge = (n) => `X${n}"'><img src=x onerror="window.__xss=(window.__xss||[]).concat('${n}')"><svg onload="window.__xss=(window.__xss||[]).concat('s${n}')">`;
let pool; let serveur; let base; let navigateur; let restaurer;

test.before(async () => {
  assert.ok(URL_AUDIT && /\/arrimo_audit_[a-z0-9_]+(\?|$)/.test(URL_AUDIT), 'AUDIT_DATABASE_URL vers une base arrimo_audit_* requis');
  restaurer = routeurTest.activer();
  process.env.ARRIMO_ENV = 'recette'; process.env.ARRIMO_2FA_ADMIN = '0';
  pool = creerPool(URL_AUDIT);
  await viderBase(pool);
  await demoReseau(pool, { silencieux: true, comptesRoles: true });
  const x = (await pool.query(`SELECT e.id FROM etablissements e JOIN utilisateur_etablissements ue ON ue.etablissement_id=e.id
    JOIN utilisateurs u ON u.id=ue.utilisateur_id WHERE u.email='hopital.x@demo.arrimo'`)).rows[0].id;
  // Champs saisissables (charges écrites comme le ferait un administrateur ou un utilisateur malveillant)
  let n = 0; const c = () => charge(n += 1);
  await pool.query('UPDATE etablissements SET nom=$2, ville=$3 WHERE id=$1', [x, c(), c()]);
  await pool.query('UPDATE unites SET nom=$2 WHERE id=(SELECT id FROM unites WHERE etablissement_id=$1 ORDER BY id LIMIT 1)', [x, c()]);
  await pool.query(`UPDATE chambres SET numero=$2, type_chambre=$3 WHERE id=(SELECT ch.id FROM chambres ch JOIN unites u ON u.id=ch.unite_id WHERE u.etablissement_id=$1 ORDER BY ch.id LIMIT 1)`, [x, c(), c()]);
  await pool.query('UPDATE lits SET categorie=$2, attributs=$3::jsonb WHERE id=(SELECT id FROM lits WHERE etablissement_id=$1 ORDER BY id LIMIT 1)', [x, c(), JSON.stringify({ note: c() })]);
  await pool.query(`UPDATE utilisateurs SET nom=$1 WHERE email='hopital.x@demo.arrimo'`, [c()]);
  await pool.query(`INSERT INTO departements(etablissement_id,code,nom) VALUES($1,'XSS',$2)`, [x, c()]);
  await pool.query(`INSERT INTO services(etablissement_id,code,nom) VALUES($1,'XSS',$2)`, [x, c()]);
  await pool.query(`UPDATE transferts SET motif_refus=$1, service_responsable=$2 WHERE id IN (SELECT id FROM transferts ORDER BY id LIMIT 3)`, [c(), c()]).catch(() => {});
  await pool.query(`UPDATE notifications SET message=$1 WHERE id IN (SELECT id FROM notifications ORDER BY id LIMIT 5)`, [c()]).catch(() => {});
  await pool.query(`UPDATE lits SET nsa_orientation=$2 WHERE id=(SELECT id FROM lits WHERE etablissement_id=$1 AND etat='occupe' ORDER BY id LIMIT 1)`, [x, c()]).catch(() => {});
  await pool.query(`INSERT INTO connecteurs(nom, etablissement_id, cle_hash) VALUES($1,$2,'x')`, [c(), x]).catch(() => {});
  serveur = creerApp(pool).listen(0, '127.0.0.1'); base = `http://127.0.0.1:${serveur.address().port}`;
  navigateur = await chromium.launch();
});
test.after(async () => { await navigateur?.close(); serveur?.close(); await pool?.end(); restaurer?.(); delete process.env.ARRIMO_2FA_ADMIN; });

async function parcourir(email) {
  const ctx = await navigateur.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const executees = [];
  page.on('dialog', (d) => { executees.push(`dialog:${d.message()}`); d.dismiss(); });
  await page.goto(base);
  await page.fill('#c-email', email); await page.fill('#c-mdp', MDP);
  await page.click('#f-connexion button[type=submit]');
  await page.waitForSelector('body[data-pret="1"]', { state: 'attached', timeout: 20000 });
  const b = page.locator('#b-premiers-pas-ok'); if (await b.isVisible().catch(() => false)) await b.click();
  const vues = await page.$$eval('#onglets button', (bs) => bs.filter((x) => !x.hidden).map((x) => x.dataset.v));
  for (const v of vues) {
    await page.click(`#onglets button[data-v="${v}"]`);
    await page.waitForTimeout(700);
    // Ouvre tout ce qui se déplie (détails, sections repliées) pour rendre un maximum de contenu
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    await page.waitForTimeout(200);
  }
  const xss = await page.evaluate(() => window.__xss || []);
  const brut = await page.evaluate(() => document.querySelectorAll('[onerror*="__xss"], [onload*="__xss"]').length > 0);
  await ctx.close();
  return { vues, xss, executees, balisesActives: brut };
}

test('XSS stockée : aucune charge ne s’exécute, pour un autre hôpital ni pour le gestionnaire réseau', { timeout: 300000 }, async () => {
  for (const email of ['hopital.y@demo.arrimo', 'reseau@demo.arrimo', 'hopital.x@demo.arrimo']) {
    const r = await parcourir(email);
    assert.ok(r.vues.length >= 5, `${email} : écrans parcourus ${r.vues}`);
    assert.deepStrictEqual(r.xss, [], `${email} : charges exécutées ${r.xss}`);
    assert.deepStrictEqual(r.executees, [], `${email} : boîtes de dialogue ouvertes`);
    assert.strictEqual(r.balisesActives, false, `${email} : balise active insérée telle quelle dans le DOM`);
  }
});
