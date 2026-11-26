'use strict';
// Captures réelles de la refonte visuelle (cahier correctif du 26 nov. 2026) sur une copie locale (jamais un environnement en ligne).
// Usage : BASE=http://127.0.0.1:3099 MDP_CAPTURE=… OUT=dossier [THEMES=glacier,horizon,crepuscule] [LARGEUR=1440] node scripts/captures-refonte.cjs [filtre]
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:3099';
const MDP = process.env.MDP_CAPTURE; const OUT = process.env.OUT || 'captures/refonte';
const THEMES = (process.env.THEMES || 'glacier').split(',');
const LARGEUR = Number(process.env.LARGEUR) || 1440; const HAUTEUR = Number(process.env.HAUTEUR) || 900;
const filtre = process.argv[2] || '';
fs.mkdirSync(OUT, { recursive: true });

async function jeton(email, essai = 0) {
  try { return await jeton1(email); } catch (e) { if (essai >= 4) throw e; await new Promise((ok) => setTimeout(ok, 3000)); return jeton(email, essai + 1); }
}
async function jeton1(email) {
  const r = await fetch(`${BASE}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, mot_de_passe: MDP }) });
  const j = await r.json(); if (!j.token) throw new Error(`connexion refusée pour ${email} : ${JSON.stringify(j).slice(0, 120)}`); return j.token;
}
// [nom, courriel, chemin, vue (data-v) ou null, sélecteur attendu, appareil]
const ECRANS = [
  ['02-accueil-hopital', 'hopital.a@demo.arrimo', '/', 'copilote', '#onglets', 'pc'],
  ['03-accueil-chsld', 'coordination.erables@chsld.example.invalid', '/', null, '#onglets', 'pc'],
  ['04-accueil-rpa', 'coordination.tilleuls@rpa.example.invalid', '/', null, '#onglets', 'pc'],
  ['05-accueil-ccs', 'ccs.demo@demo.arrimo', '/secours', null, 'main', 'pc'],
  ['06-accueil-entreprise-ambulanciere', 'superviseur.demo@demo.arrimo', '/secours', null, 'main', 'pc'],
  ['07-interface-ambulancier', 'ambulance.demo@demo.arrimo', '/secours', null, 'main', 'telephone'],
  ['08-interface-tablette', 'ambulance.demo@demo.arrimo', '/secours', null, 'main', 'tablette'],
  ['09-chrono', 'hopital.x@demo.arrimo', '/', 'chrono', '#v-chrono', 'pc'],
  ['10-transferts-mouvements', 'hopital.a@demo.arrimo', '/', 'flux', '#v-flux .ds-mvts', 'pc'],
  ['10b-transferts-liste', 'hopital.a@demo.arrimo', '/', 'transferts', '#v-transferts', 'pc'],
  ['11-performance', 'hopital.c@demo.arrimo', '/', 'indicateurs', '#v-indicateurs', 'pc'],
  ['13-navigation-horizontale', 'hopital.a@demo.arrimo', '/', 'copilote', '#onglets', 'pc', 'horizontale'],
  ['16-reseau-gestionnaire', 'reseau@demo.arrimo', '/', null, '#onglets', 'pc'],
];
const APPAREILS = { pc: { viewport: { width: LARGEUR, height: HAUTEUR } }, tablette: { viewport: { width: 1024, height: 768 }, hasTouch: true }, telephone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } };

(async () => {
  const nav = await chromium.launch();
  const erreurs = [];
  for (const theme of THEMES) for (const [nom, email, chemin, vue, attendu, app, dispo] of ECRANS) {
    if (filtre && !nom.includes(filtre)) continue;
    const ctx = await nav.newContext({ ...APPAREILS[app], deviceScaleFactor: 1, locale: 'fr-CA', colorScheme: theme === 'crepuscule' ? 'dark' : 'light' });
    const tok = await jeton(email);
    // Préférences du compte (copie locale seulement) : l'application applique celles du serveur au chargement
    const put = (chemin, corps) => fetch(`${BASE}/api${chemin}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify(corps) }).catch(() => null);
    await put('/moi/apparence', { apparence: theme === 'crepuscule' ? 'sombre' : 'clair' });
    await put('/moi/ambiance', { ambiance: theme === 'horizon' ? 'horizon' : 'glacier' });
    await ctx.addInitScript(([t, th, d]) => { try {
      localStorage.setItem('arrimo-token', t); localStorage.setItem('arrimo-langue', 'fr'); localStorage.setItem('arrimo-premiers-pas', '1');
      localStorage.setItem('arrimo-apparence', th === 'crepuscule' ? 'sombre' : 'clair'); localStorage.setItem('arrimo-ambiance', th === 'horizon' ? 'horizon' : 'glacier');
      if (d) localStorage.setItem('arrimo-disposition', d);
    } catch { /* */ } }, [tok, theme, dispo || null]);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erreurs.push(`${nom}/${theme} : ${e.message}`));
    try {
      await p.goto(`${BASE}${chemin}`); await p.waitForSelector(vue ? '#onglets' : attendu, { timeout: 30000 });
      if (vue) await p.evaluate((v) => { window.ArrimoEspaces?.reveler?.(v); document.querySelector(`#onglets button[data-v="${v}"]`)?.click(); }, vue);
      if (vue) await p.waitForSelector(attendu, { timeout: 30000 });
      await p.waitForTimeout(2500);
      await p.screenshot({ path: `${OUT}/${nom}-${theme}.png`, fullPage: app !== 'pc' });
      if (app === 'pc') await p.screenshot({ path: `${OUT}/${nom}-${theme}-complet.png`, fullPage: true });
      // Débordement horizontal : aucun élément ne doit dépasser la largeur de la fenêtre
      const deborde = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (deborde > 1) erreurs.push(`${nom}/${theme} : débordement horizontal de ${deborde} px`);
    } catch (e) { erreurs.push(`${nom}/${theme} : ${e.message.split('\n')[0]}`); }
    await ctx.close();
  }
  await nav.close();
  fs.writeFileSync(`${OUT}/rapport.json`, JSON.stringify({ base: BASE, themes: THEMES, largeur: LARGEUR, erreurs }, null, 2));
  console.log(erreurs.length ? erreurs.join('\n') : 'aucune erreur');
})().catch((e) => { console.error(e); process.exit(1); });
