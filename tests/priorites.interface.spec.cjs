/** Recette navigateur réelle sur base locale NEUVE, jamais sur A/B/C public.
 * PRIORITES_UI_DATABASE_URL=postgresql://.../arrimo_vnext_ui_test_<suffixe> node tests/priorites.interface.spec.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cible = process.env.PRIORITES_UI_DATABASE_URL;
test('priorités : validation humaine depuis Admissions, ordinateur/tablette/mobile', { skip: !cible && 'PRIORITES_UI_DATABASE_URL absent : navigateur non testé' }, async (t) => {
  const url = new URL(cible);
  assert.ok(['localhost', '127.0.0.1', ''].includes(url.hostname));
  assert.match(url.pathname, /^\/arrimo_vnext_ui_test_[a-z0-9_]+$/);
  const { creerPool } = require('../src/db');
  const pool = creerPool(cible); t.after(() => pool.end());
  assert.equal((await pool.query('SELECT tablename FROM pg_tables WHERE schemaname=current_schema()')).rows.length, 0, 'base neuve obligatoire, aucun reset');
  const avant = { env: process.env.ARRIMO_ENV, mdp: process.env.DEMO_MOT_DE_PASSE };
  process.env.ARRIMO_ENV = 'demo'; process.env.DEMO_MOT_DE_PASSE = 'VNext-Fictif-2026-UI';
  t.after(() => {
    for (const [cle, valeur] of [['ARRIMO_ENV', avant.env], ['DEMO_MOT_DE_PASSE', avant.mdp]]) {
      if (valeur === undefined) delete process.env[cle]; else process.env[cle] = valeur;
    }
  });
  const restaurer = require('./routeur-fictif.cjs').activer(); t.after(restaurer);
  await require('../db/seed').seed(pool, { silencieux: true });
  await pool.query('UPDATE utilisateurs SET premiers_pas_vus=true');
  const etab = (await pool.query("SELECT id,config_id FROM etablissements WHERE code='MB'")).rows[0];
  const type = (await pool.query("SELECT id FROM types_unite WHERE config_id=$1 AND code='MED'", [etab.config_id])).rows[0].id;
  const pro = (await pool.query("SELECT id FROM utilisateurs WHERE email='tremblay@demo.arrimo'")).rows[0];
  const gestionnaire = (await pool.query("SELECT id FROM utilisateurs WHERE email='reseau@demo.arrimo'")).rows[0];
  const u = { ...pro, role: 'coordonnateur', etabs: [etab.id] };
  const admin = { ...gestionnaire, role: 'gestionnaire', gestionnaire: true, admin: true, totp_actif: true, etabs: [] };
  const p = require('../src/priorites');
  for (const id of [admin.id, u.id]) await p.habiliter(pool, admin, etab.id, id, { active: true, version: 0, confirmation: true, motif: 'Habilitation fictive pour recette UI' });
  await p.configurer(pool, admin, etab.id, { revision: 0, confirmation: true, motif: 'Référentiel fictif pour recette UI',
    categories: [{ code: 'rapide_demo', libelle: 'Rapide — fictif', rang: 1 }, { code: 'planifiable_demo', libelle: 'Planifiable — fictif', rang: 2 }] });
  const serveur = require('../src/app').creerApp(pool).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { serveur.once('listening', resolve); serveur.once('error', reject); });
  t.after(() => new Promise((resolve) => serveur.close(resolve)));
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const navigateur = await require('playwright').chromium.launch({ headless: true }); t.after(() => navigateur.close());
  const dossier = path.join(__dirname, '..', 'preuves', 'priorites-vnext'); fs.mkdirSync(dossier, { recursive: true });
  for (const [index, [nom, width, height]] of [["ordinateur",1366,900],["tablette",820,1180],["mobile",390,844]].entries()) {
    await t.test(nom, async () => {
      const ref = `P-${90201 + index}`;
      const d = await require('../src/terrain').creerDemande(pool, u, { etablissement_id: etab.id, type_id: type, patient_ref: ref });
      const contexte = await navigateur.newContext({ viewport: { width, height } });
      try {
        const page = await contexte.newPage(); const erreurs = []; page.on('pageerror', (e) => erreurs.push(e.message));
        await page.goto(base); await page.fill('#c-email', 'tremblay@demo.arrimo'); await page.fill('#c-mdp', process.env.DEMO_MOT_DE_PASSE);
        await page.click('#f-connexion button[type=submit]'); await page.waitForSelector('body[data-pret="1"]');
        await page.click('[data-v="admissions"]');
        const carte = page.locator('#v-admissions .fiche').filter({ hasText: ref });
        await carte.getByRole('button', { name: 'Valider la priorité' }).click();
        assert.equal((await pool.query('SELECT priorite_validee_par FROM demandes_admission WHERE id=$1', [d.id])).rows[0].priorite_validee_par, null);
        await page.selectOption('#p-categorie', 'planifiable_demo'); await page.fill('#p-motif', 'Choix humain fictif dans navigateur'); await page.check('#p-confirmation');
        await page.click('#modale .actions .pri'); await page.waitForSelector('#modale', { state: 'hidden' });
        await page.waitForFunction((reference) => [...document.querySelectorAll('#v-admissions .fiche')].some((e) => e.textContent.includes(reference) && e.textContent.includes('Planifiable — fictif')), ref);
        const db = (await pool.query('SELECT priorite_code,priorite_validee_par,priorite_version FROM demandes_admission WHERE id=$1', [d.id])).rows[0];
        assert.deepEqual(db, { priorite_code: 'planifiable_demo', priorite_validee_par: u.id, priorite_version: 1 });
        assert.deepEqual(erreurs, []); await page.screenshot({ path: path.join(dossier, `${nom}-admissions-priorites.png`), fullPage: true });
      } finally { await contexte.close(); }
    });
  }
});
