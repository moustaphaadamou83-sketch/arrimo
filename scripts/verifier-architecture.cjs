'use strict';
// Vérification de l'architecture modulaire (27 nov. 2026) sur une copie locale de la démo (jamais un environnement en ligne).
// Usage : BASE=http://127.0.0.1:3142 MDP_CAPTURE=… OUT=dossier node scripts/verifier-architecture.cjs
// Pour chaque profil : modules et sous-menus visibles (navigation verticale et horizontale, FR et EN), intitulés retirés absents,
// écrans principaux ouverts sans erreur, captures.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:3142';
const MDP = process.env.MDP_CAPTURE; const OUT = process.env.OUT || 'captures/architecture';
fs.mkdirSync(OUT, { recursive: true });
const RETIRES = ['Liaison Secours', 'Liaison CHSLD', 'Avant l’appel', 'Congés et alertes', 'Emergency liaison', 'Before calling', 'Urgences proches', 'Réseau CHSLD'];
const PROFILS = [
  ['hopital', 'hopital.b@demo.arrimo', ['conges', 'vigilance', 'flux', 'secours', 'liaison', 'chrono'], ['c-departs', 'c-reseau', 'eviter', 'national']],
  ['chsld', 'coordination.erables@chsld.example.invalid', ['c-departs', 'c-alertes', 'flux', 'c-mouvements', 'c-urgences'], ['transferts', 'liaison', 'secours', 'vigilance', 'conges', 'eviter', 'urgence']],
  ['rpa', 'coordination.tilleuls@rpa.example.invalid', ['c-departs', 'c-alertes', 'flux'], ['transferts', 'liaison', 'secours', 'vigilance', 'conges', 'eviter']],
  ['gestionnaire', 'reseau@demo.arrimo', ['national'], []],
];
async function jeton(email) {
  const r = await fetch(`${BASE}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, mot_de_passe: MDP }) });
  const j = await r.json(); if (!j.token) throw new Error(`connexion refusée pour ${email}`); return j.token;
}
(async () => {
  const nav = await chromium.launch(); const erreurs = []; const rapport = {};
  for (const [nom, email, attendus, interdits] of PROFILS) for (const langue of ['fr', 'en']) for (const dispo of ['verticale', 'horizontale']) {
    const cle = `${nom}-${langue}-${dispo}`;
    const tok = await jeton(email).catch((e) => { erreurs.push(`${cle} : ${e.message}`); return null; }); if (!tok) continue;
    const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 }, locale: langue === 'en' ? 'en-CA' : 'fr-CA' });
    await ctx.addInitScript(([t, l, d]) => { localStorage.setItem('arrimo-token', t); localStorage.setItem('arrimo-langue', l); localStorage.setItem('arrimo-premiers-pas', '1'); localStorage.setItem('arrimo-disposition', d); }, [tok, langue, dispo]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => erreurs.push(`${cle} : ${e.message}`));
    try {
      await p.goto(`${BASE}/`); await p.waitForSelector('#onglets .espace-btn', { timeout: 30000 }); await p.waitForTimeout(1500);
      const etat = await p.evaluate(() => ({
        espaces: [...document.querySelectorAll('#onglets .espace-btn')].map((b) => b.querySelector('.esp-nom').textContent),
        ecrans: [...document.querySelectorAll('#onglets button[role="tab"][data-v]')].filter((b) => !b.hidden).map((b) => b.dataset.v),
        texte: document.getElementById('onglets').innerText }));
      rapport[cle] = etat;
      for (const v of attendus) if (!etat.ecrans.includes(v)) erreurs.push(`${cle} : écran attendu absent ${v}`);
      for (const v of interdits) if (etat.ecrans.includes(v)) erreurs.push(`${cle} : écran interdit présent ${v}`);
      for (const x of RETIRES) if (etat.texte.includes(x)) erreurs.push(`${cle} : intitulé retiré encore affiché « ${x} »`);
      if (langue === 'fr' && dispo === 'verticale') {
        await p.screenshot({ path: `${OUT}/${nom}-navigation.png` });
        for (const v of attendus) {
          await p.evaluate((x) => { window.ArrimoEspaces?.reveler?.(x); document.querySelector(`#onglets button[data-v="${x}"]`)?.click(); }, v);
          await p.waitForTimeout(2500);
          const ok = await p.evaluate((x) => { const s = document.getElementById(`v-${x}`); return !!s && !s.hidden && s.innerText.trim().length > 20; }, v);
          if (!ok) erreurs.push(`${cle} : écran ${v} vide`);
          const texte = await p.evaluate((x) => document.getElementById(`v-${x}`)?.innerText || '', v);
          for (const x of RETIRES) if (texte.includes(x)) erreurs.push(`${cle} : « ${x} » dans l’écran ${v}`);
          await p.screenshot({ path: `${OUT}/${nom}-${v}.png`, fullPage: true });
        }
      }
    } catch (e) { erreurs.push(`${cle} : ${e.message.split('\n')[0]}`); }
    await ctx.close();
  }
  await nav.close();
  fs.writeFileSync(`${OUT}/rapport.json`, JSON.stringify({ base: BASE, erreurs, rapport }, null, 2));
  console.log(erreurs.length ? erreurs.join('\n') : 'aucune erreur');
})().catch((e) => { console.error(e); process.exit(1); });
