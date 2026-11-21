'use strict';
/* Audit DSN — parcours d'interface (Chromium) sur le serveur isolé 3099 ; captures et erreurs JS comme preuves. */
const fs = require('fs'); const { chromium } = require('/root/arrimo-sh-erp/node_modules/playwright');
const MDP = fs.readFileSync('/root/arrimo-sh-erp/.local/acces-demo-trio.txt', 'utf8').match(/Mot de passe[^:]*:\s*(\S+)/)[1];
const O = 'http://127.0.0.1:3099'; const OUT = process.argv[2]; const res = [];
(async () => {
  const nav = await chromium.launch();
  const ouvrir = async (email, vp = { width: 1366, height: 900 }) => { const pg = await (await nav.newContext({ viewport: vp, locale: 'fr-CA' })).newPage(); pg.err = [];
    pg.on('pageerror', (e) => pg.err.push(e.message)); pg.on('response', (r) => { if (r.status() >= 500) pg.err.push(`${r.status()} ${r.url()}`); });
    await pg.goto(O); await pg.fill('#c-email', email); await pg.fill('#c-mdp', MDP); await pg.press('#c-mdp', 'Enter'); await pg.waitForSelector('body[data-pret="1"]', { timeout: 30000 }); return pg; };
  const cas = async (id, titre, attendu, f) => { let statut; let obtenu; try { [statut, obtenu] = await f(); } catch (e) { statut = 'BLOQUÉ'; obtenu = e.message.split('\n')[0]; } res.push({ id, module: 'Interface', titre, attendu, obtenu, statut, preuve: `${id}.png` }); console.log(statut.padEnd(9), id, titre, '·', obtenu); };
  const hb = await ouvrir('hopital.b@demo.arrimo');
  await cas('UI-01', 'Hôpital B : onglet « Dossier santé » dans la barre, liste des patients', 'Onglet visible ; patients listés ; aucune erreur', async () => {
    await hb.click('#onglets button[data-v="dsn"]'); await hb.waitForTimeout(4500); const f = hb.frameLocator('#v-dsn iframe'); const n = await f.locator('[data-ouvrir]').count();
    await hb.screenshot({ path: `${OUT}/UI-01.png` }); return [n > 0 && !hb.err.length ? 'RÉUSSI' : 'ÉCHEC', `${n} patients ; erreurs : ${hb.err.join(' | ') || 'aucune'}`]; });
  await cas('UI-02', 'Ouvrir un dossier : alerte d’allergie, sections, sous-onglets', 'Dossier affiché avec l’alerte d’allergie', async () => {
    const f = hb.frameLocator('#v-dsn iframe'); await f.locator('[data-ouvrir]').first().click(); await hb.waitForTimeout(3000);
    const alerte = await f.locator('.allergie').count(); const sous = await f.locator('.entete-patient').count(); await hb.screenshot({ path: `${OUT}/UI-02.png`, fullPage: true });
    return [alerte && sous ? 'RÉUSSI' : 'ÉCHEC', `alerte allergie : ${alerte} ; en-tête patient : ${sous}`]; });
  await cas('UI-03', 'Ajouter une allergie depuis l’interface (formulaire)', 'Allergie ajoutée et affichée', async () => {
    const f = hb.frameLocator('#v-dsn iframe'); const avant = await f.locator('text=Latex (audit)').count();
    await f.locator('button', { hasText: '+ Allergie' }).first().click(); await hb.waitForTimeout(800);
    await f.locator('#ds-modale [name="substance"]').fill('Latex (audit)'); await f.locator('#ds-modale [name="gravite"]').selectOption('moderee').catch(() => {});
    await f.locator('#ds-modale button.pri, #ds-modale button[value="ok"]').first().click(); await hb.waitForTimeout(2500);
    const apres = await f.locator('text=Latex (audit)').count(); await hb.screenshot({ path: `${OUT}/UI-03.png`, fullPage: true });
    return [apres > avant ? 'RÉUSSI' : 'ÉCHEC', `occurrences avant ${avant}, après ${apres}`]; });
  await cas('UI-04', 'Interface DSN en anglais', 'Libellés anglais (Patients/Record/Received transitions), statuts traduits', async () => {
    await hb.goto(`${O}/dsn`); await hb.waitForTimeout(3000); await hb.click('[data-ds-langue="en"]'); await hb.waitForTimeout(2000);
    const t = await hb.locator('#ds-nav').innerText(); const corps = await hb.locator('#ds-main').innerText(); await hb.screenshot({ path: `${OUT}/UI-04.png` });
    const fr = /Hospitalisé|Rechercher|Ouvrir\b/.test(corps); await hb.click('[data-ds-langue="fr"]');
    return [/Record/.test(t) && !fr ? 'RÉUSSI' : 'ÉCHEC', `onglets : ${t.replace(/\s+/g, ' ')} ; texte français restant : ${fr ? 'oui' : 'non'}`]; });
  await cas('UI-07', 'Admission depuis le DSN : choix d’un lit libre réel, puis le lit apparaît occupé dans l’onglet Lits', 'Lit proposé dans la liste ; après enregistrement, lit occupé dans Lits', async () => {
    const pg = await ouvrir('hopital.b@demo.arrimo'); await pg.goto(`${O}/dsn`); await pg.waitForTimeout(2500);
    // nouveau patient fictif, puis séjour
    await pg.click('#ds-nouveau'); await pg.waitForTimeout(600); await pg.fill('#ds-modale [name="prenom"]', 'Interface'); await pg.fill('#ds-modale [name="nom"]', 'Démo-Admission'); await pg.fill('#ds-modale [name="date_naissance"]', '1951-01-01');
    await pg.locator('#ds-modale button.pri').first().click(); await pg.waitForTimeout(2500);
    await pg.click('[data-sous="hospitalisations"]'); await pg.waitForTimeout(1500);
    await pg.locator('[data-ajout="sejour"]').first().click(); await pg.waitForTimeout(1200);
    const options = await pg.locator('#ds-lits option').evaluateAll((o) => o.map((x) => x.value)); if (!options.length) return ['ÉCHEC', 'aucun lit libre proposé'];
    await pg.fill('#ds-modale [name="service"]', 'Médecine'); await pg.fill('#ds-modale [name="lit"]', options[0]); await pg.screenshot({ path: `${OUT}/UI-07a.png` });
    await pg.locator('#ds-modale button.pri').first().click(); await pg.waitForTimeout(2500); await pg.screenshot({ path: `${OUT}/UI-07b.png`, fullPage: true });
    await pg.goto(O); await pg.waitForSelector('body[data-pret="1"]'); await pg.click('#onglets button[data-v="lits"]'); await pg.waitForTimeout(3000);
    // Colonne « Occupé » de l'écran Lits : la carte du lit choisi doit y figurer avec la référence du patient
    const occ = await pg.evaluate((code) => { const col = [...document.querySelectorAll('#v-lits section, #v-lits .colonne, #v-lits [data-colonne], #v-lits div')].find((x) => /^\s*Occupé/.test(x.innerText || '') && x.innerText.length < 20000);
      const t = col ? col.innerText : ''; const k = t.indexOf(code); return k >= 0 ? t.slice(k, k + 90) : null; }, options[0]);
    const { Pool } = require('/root/arrimo-sh-erp/node_modules/pg'); const db = new Pool({ connectionString: 'postgresql://root@localhost/audit_dsn?host=/var/run/postgresql' });
    const base = (await db.query("SELECT l.etat, l.patient_ref, x.statut, x.donnees->>'lit' lit FROM lits l JOIN patients p ON p.reference = l.patient_ref AND p.etablissement_id = l.etablissement_id JOIN dsn_elements x ON x.patient_id = p.id AND x.genre = 'sejour' AND x.remplace_par IS NULL WHERE l.code = $1 AND p.nom = 'Démo-Admission'", [options[0]])).rows[0]; await db.end();
    await pg.screenshot({ path: `${OUT}/UI-07c.png`, fullPage: true });
    return [occ && base?.etat === 'occupe' && base?.statut === 'en_cours' ? 'RÉUSSI' : 'ÉCHEC', `lits proposés : ${options.length} ; colonne « Occupé » : ${occ ? occ.replace(/\s+/g, ' ') : 'absent'} ; base : lit ${base?.etat}, ${base?.patient_ref}, séjour ${base?.statut} sur ${base?.lit} ; erreurs : ${pg.err.join(' | ') || 'aucune'}`]; });
  const era = await ouvrir('coordination.erables@chsld.example.invalid');
  await cas('UI-05', 'CHSLD des Érables : transitions reçues et acceptation à l’écran', 'Paquet visible ; « Accepter » change le statut', async () => {
    await era.goto(`${O}/dsn`); await era.waitForTimeout(2500); await era.click('#ds-nav [data-vue="recues"]'); await era.waitForTimeout(2500); await era.screenshot({ path: `${OUT}/UI-05a.png`, fullPage: true });
    const b = era.locator('[data-trx-decision="accepter"]').first(); if (!(await b.count())) return ['BLOQUÉ', 'aucune transition à accepter']; await b.click(); await era.waitForTimeout(1500);
    if (await era.locator('#ds-modale[open]').count()) { await era.locator('#ds-modale button.pri').first().click(); await era.waitForTimeout(2000); }
    const t = await era.locator('#ds-main').innerText(); await era.screenshot({ path: `${OUT}/UI-05.png`, fullPage: true });
    return [/Accepté|Confirmer la réception/.test(t) && !era.err.length ? 'RÉUSSI' : 'ÉCHEC', `après acceptation : ${/Confirmer la réception/.test(t) ? 'bouton « Confirmer la réception » proposé' : t.slice(0, 120)} ; erreurs : ${era.err.join(' | ') || 'aucune'}`]; });
  const tab = await ouvrir('hopital.b@demo.arrimo', { width: 820, height: 1180 });
  await cas('UI-06', 'Tablette (820 px) : DSN sans débordement horizontal', 'Aucun débordement', async () => {
    await tab.goto(`${O}/dsn`); await tab.waitForTimeout(3000); await tab.locator('[data-ouvrir]').first().click(); await tab.waitForTimeout(2500);
    const d = await tab.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); await tab.screenshot({ path: `${OUT}/UI-06.png` });
    return [d <= 1 ? 'RÉUSSI' : 'ÉCHEC', `débordement ${d} px`]; });
  fs.writeFileSync(`${OUT}/resultats-ui.json`, JSON.stringify(res, null, 1)); await nav.close();
})();
