'use strict';
/**
 * Audit de l'anglais à l'écran (19 nov. 2026) : chaque compte, interface en anglais, chaque onglet visible ;
 * relève les lignes affichées qui contiennent encore du français (mots-outils ou accents), hors noms propres des données fictives.
 * Usage : node scripts/audit-anglais-ecrans.cjs <url> <fichier-acces> <sortie.json> <courriel>...
 */
const fs = require('fs');
const { chromium } = require('playwright');
const [BASE, ACCES, SORTIE, ...COMPTES] = process.argv.slice(2);
const MDP = fs.readFileSync(ACCES, 'utf8').match(/Mot de passe[^:]*:\s*(\S+)/)[1];
const FRANCAIS = /\b(le|la|les|des|du|une|aucun|aucune|pour|avec|sans|dans|est|sont|au|aux|sur|en cours|à|où|été|cette|votre|vos|nouveau|nouvelle)\b|[éèêàâçôîûù]/i;
// Noms propres des données fictives (établissements, personnes, lieux) : jamais comptés
const DONNEES = /(Hôpital|CHSLD|Érables|Saint-Laurent|Jean Dupont|Marie|Dupont|Montréal|Québec|Lucienne|Roger|Mont-|Sainte?-|Lévis|Sherbrooke|Trois-Rivières|Gatineau|Rimouski|é{0}[A-Z]{2,}-\d)/;
(async () => {
  const nav = await chromium.launch(); const rapport = {};
  for (const email of COMPTES) {
    const ctx = await nav.newContext({ viewport: { width: 1366, height: 900 } }); const pg = await ctx.newPage();
    await pg.addInitScript(() => { try { localStorage.setItem('arrimo-langue', 'en'); } catch { /* */ } });
    await pg.goto(BASE); await pg.fill('#c-email', email); await pg.fill('#c-mdp', MDP); await pg.press('#c-mdp', 'Enter');
    try { await pg.waitForSelector('body[data-pret="1"]', { timeout: 20000 }); } catch { rapport[email] = { erreur: 'connexion' }; continue; }
    if (await pg.locator('#b-premiers-pas-ok').isVisible().catch(() => false)) await pg.click('#b-premiers-pas-ok');
    const onglets = await pg.$$eval('#onglets button[data-v]', (bs) => bs.filter((b) => !b.hidden && b.offsetParent !== null || !b.hidden).map((b) => b.dataset.v));
    rapport[email] = {};
    for (const v of [...new Set(onglets)]) {
      try {
        if (await pg.locator('#b-nav').isVisible().catch(() => false)) await pg.click('#b-nav');
        const b = pg.locator(`#onglets button[data-v="${v}"]`).first(); if (!(await b.isVisible().catch(() => false))) continue;
        await b.click(); await pg.waitForTimeout(1200);
        const texte = await pg.evaluate(() => { const m = document.querySelector('main') || document.body; return m.innerText; });
        const lignes = [...new Set(texte.split('\n').map((x) => x.trim()).filter((x) => x.length > 2 && FRANCAIS.test(x) && !DONNEES.test(x)))];
        if (lignes.length) rapport[email][v] = lignes.slice(0, 60);
      } catch (e) { rapport[email][v] = [`(onglet non audité : ${String(e.message).slice(0, 80)})`]; }
    }
    await ctx.close();
  }
  fs.writeFileSync(SORTIE, JSON.stringify(rapport, null, 2));
  for (const [c, r] of Object.entries(rapport)) console.log(c, Object.entries(r).map(([v, l]) => `${v}:${Array.isArray(l) ? l.length : l}`).join(' '));
  await nav.close();
})();
