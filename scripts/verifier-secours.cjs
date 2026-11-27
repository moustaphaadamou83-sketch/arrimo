'use strict';
// Vérification des interfaces CCS / gestionnaire ambulancier / embarqué (cahiers du 27 nov. 2026) sur une copie locale de la démo.
// Usage : BASE=http://127.0.0.1:3142 MDP_CAPTURE=… OUT=dossier node scripts/verifier-secours.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:3142'; const MDP = process.env.MDP_CAPTURE; const OUT = process.env.OUT || 'captures/secours';
fs.mkdirSync(OUT, { recursive: true });
const PROFILS = [
  ['ccs', 'ccs.demo@demo.arrimo', ['accueil', 'missions', 'flotte', 'bourse', 'chrono', 'alertes', 'pilotage', 'historique', 'administration'], { width: 1440, height: 900 }],
  ['gestionnaire', 'superviseur.demo@demo.arrimo', ['accueil', 'missions', 'flotte', 'equipes', 'chrono', 'alertes', 'pilotage', 'historique', 'administration'], { width: 1440, height: 900 }],
  ['embarque', 'ambulance.demo@demo.arrimo', ['accueil', 'mission', 'chrono', 'historique'], { width: 1024, height: 768 }],
];
(async () => {
  const nav = await chromium.launch(); const erreurs = []; const rapport = {};
  for (const [nom, email, attendus, viewport] of PROFILS) {
    const r = await fetch(`${BASE}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, mot_de_passe: MDP }) });
    const tok = (await r.json()).token; if (!tok) { erreurs.push(`${nom} : connexion refusée`); continue; }
    const ctx = await nav.newContext({ viewport, locale: 'fr-CA', hasTouch: nom === 'embarque' });
    await ctx.addInitScript((t) => { localStorage.setItem('arrimo-token', t); localStorage.setItem('arrimo-langue', 'fr'); }, tok);
    const p = await ctx.newPage(); p.on('pageerror', (e) => erreurs.push(`${nom} : ${e.message}`));
    await p.goto(`${BASE}/secours`); await p.waitForSelector('#onglets-s button', { state: 'attached', timeout: 30000 }); await p.waitForTimeout(2000);
    const onglets = await p.$$eval('#onglets-s button[data-onglet]', (bs) => bs.map((b) => b.dataset.onglet));
    rapport[nom] = { onglets };
    for (const o of attendus) if (!onglets.includes(o)) erreurs.push(`${nom} : onglet attendu absent ${o}`);
    for (const o of onglets) {
      await p.evaluate((x) => document.querySelector(`#onglets-s button[data-onglet="${x}"]`).click(), o); await p.waitForTimeout(1800);
      const texte = await p.$eval('#contenu', (c) => c.innerText);
      if (texte.trim().length < 15) erreurs.push(`${nom} : onglet ${o} vide`);
      // Aucun texte de durée ne dépasse son anneau
      const deborde = await p.$$eval('.anneau-grand, .cg-anneau', (as) => as.filter((a) => { const v = a.querySelector('.ag-val, .cg-valeur'); if (!v) return false; const ra = a.getBoundingClientRect(); const rv = v.getBoundingClientRect(); return rv.width > ra.width * 0.86 || rv.height > ra.height * 0.86; }).length);
      if (deborde) erreurs.push(`${nom}/${o} : ${deborde} durée(s) touchent l’anneau`);
      await p.screenshot({ path: `${OUT}/${nom}-${o}.png`, fullPage: true });
    }
    await ctx.close();
  }
  await nav.close();
  fs.writeFileSync(`${OUT}/rapport.json`, JSON.stringify({ erreurs, rapport }, null, 2));
  console.log(erreurs.length ? erreurs.join('\n') : 'aucune erreur'); console.log(JSON.stringify(rapport));
})().catch((e) => { console.error(e); process.exit(1); });
