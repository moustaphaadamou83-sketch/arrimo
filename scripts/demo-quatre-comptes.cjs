'use strict';
// Démonstration de bout en bout (cahier « Interconnexion permanente », 28 nov. 2026) sur une copie locale de la démo :
// CCS, ambulance, hôpital et CHSLD connectés en même temps ; chaque étape doit apparaître chez les autres SANS actualisation manuelle.
// Usage : BASE=http://127.0.0.1:3142 MDP_CAPTURE=… OUT=dossier UNITE=1 HOPITAL=1 CHSLD=22 node scripts/demo-quatre-comptes.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:3142'; const MDP = process.env.MDP_CAPTURE; const OUT = process.env.OUT || 'captures/quatre-comptes';
const UNITE = Number(process.env.UNITE || 1); const HOP = Number(process.env.HOPITAL || 1); const CHSLD = Number(process.env.CHSLD || 22);
fs.mkdirSync(OUT, { recursive: true });
const jeton = async (email) => (await (await fetch(`${BASE}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, mot_de_passe: MDP }) })).json()).token;
const api = async (tok, m, c, b) => { const r = await fetch(`${BASE}/api${c}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; };
(async () => {
  const nav = await chromium.launch(); const journal = []; const erreurs = [];
  const etape = (x) => { journal.push({ le: new Date().toISOString(), etape: x }); console.log(x); };
  const ouvrir = async (nom, email, chemin, vue, viewport = { width: 1366, height: 900 }) => {
    const tok = await jeton(email); const ctx = await nav.newContext({ viewport, locale: 'fr-CA' });
    await ctx.addInitScript(([t]) => { localStorage.setItem('arrimo-token', t); localStorage.setItem('arrimo-langue', 'fr'); localStorage.setItem('arrimo-premiers-pas', '1'); }, [tok]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => erreurs.push(`${nom} : ${e.message}`));
    await p.goto(`${BASE}${chemin}`); await p.waitForTimeout(2500);
    if (vue) await p.evaluate((v) => { window.ArrimoEspaces?.reveler?.(v); document.querySelector(`#onglets button[data-v="${v}"]`)?.click(); }, vue);
    await p.waitForTimeout(1500);
    return { p, tok };
  };
  const ccs = await ouvrir('ccs', 'ccs.demo@demo.arrimo', '/secours');
  const amb = await ouvrir('ambulance', 'ambulance.demo@demo.arrimo', '/secours', null, { width: 1024, height: 768 });
  const hop = await ouvrir('hopital', 'hopital.a@demo.arrimo', '/', 'secours');
  const ch = await ouvrir('chsld', 'coordination.erables@chsld.example.invalid', '/', 'c-urgences');
  await amb.p.evaluate((u) => { const s = document.querySelector('#unite, select[name="unite"]'); if (s) { s.value = String(u); s.dispatchEvent(new Event('change', { bubbles: true })); } }, UNITE);
  const attendre = async (qui, page, texte, ms = 40000) => {
    const t0 = Date.now();
    try { await page.waitForFunction((x) => document.body.innerText.includes(x), texte, { timeout: ms }); etape(`${qui} voit « ${texte} » après ${Math.round((Date.now() - t0) / 1000)} s, sans actualisation`); return true; }
    catch { erreurs.push(`${qui} ne voit pas « ${texte} » en ${ms / 1000} s`); return false; }
  };
  // 1. Le CCS affecte une mission au véhicule (intervention au CHSLD, destination Hôpital A)
  const m = await api(ccs.tok, 'POST', '/secours/missions', { unite_id: UNITE, lieu: 'CHSLD 1 — des Érables (fictif)', priorite: 'urgente', categorie: 'medicale', instructions: 'Entrée principale, ascenseur B', destination_id: HOP, origine_id: CHSLD });
  if (m.s !== 200) { erreurs.push(`affectation refusée : ${JSON.stringify(m.j)}`); } else etape(`CCS : mission ${m.j.numero} affectée à l’unité ${UNITE}`);
  const num = m.j?.numero;
  await attendre('Ambulance', amb.p, num); await attendre('Ambulance', amb.p, 'Entrée principale, ascenseur B');
  await attendre('CHSLD', ch.p, num); await attendre('Hôpital', hop.p, num);
  const recue = (await api(ccs.tok, 'GET', '/secours/flotte')).j.vehicules.find((v) => v.id === UNITE)?.mission?.transmission;
  etape(`CCS : transmission envoyée ${recue?.envoyee_le} · reçue ${recue?.recue_le} · consultée ${recue?.consultee_le}`);
  await amb.p.screenshot({ path: `${OUT}/1-ambulance-mission-recue.png`, fullPage: true });
  // 2. L'équipage accepte (une seule action principale) → le CCS voit « En route » sans actualisation
  await amb.p.click('[data-mi-action="accepter"]').catch((e) => erreurs.push(`accepter : ${e.message.split('\n')[0]}`));
  await ccs.p.evaluate(() => document.querySelector('#onglets-s button[data-onglet="flotte"]')?.click());
  await attendre('CCS', ccs.p, 'En route vers le patient');
  // 3. Le CHSLD confirme la préparation du résident ; l'hôpital confirme l'accueil
  await ch.p.click(`[data-cf-rapide="resident_pret"]`).catch((e) => erreurs.push(`CHSLD : ${e.message.split('\n')[0]}`));
  await attendre('Ambulance', amb.p, 'Résident prêt');
  await hop.p.click(`[data-cf-rapide="accueil_pret"]`).catch((e) => erreurs.push(`Hôpital : ${e.message.split('\n')[0]}`));
  await attendre('Ambulance', amb.p, 'Accueil prêt');
  // 4. Retard signalé par l'équipage → visible au CCS (fiche) ; même horodatage source pour les compteurs
  await amb.p.click('[data-signal="retard"]').catch((e) => erreurs.push(`retard : ${e.message.split('\n')[0]}`));
  let fil = []; for (let i = 0; i < 10 && !fil.some((x) => x.genre === 'retard'); i += 1) { await amb.p.waitForTimeout(1000); fil = (await api(ccs.tok, 'GET', `/secours/flotte/${UNITE}/messages`)).j; }
  if (!fil.some((x) => x.genre === 'retard')) erreurs.push('le CCS ne voit pas le retard'); else etape('CCS : retard reçu dans la fiche du véhicule');
  const depuisCcs = await ccs.p.evaluate((u) => document.querySelector(`[data-fiche-v="${u}"] [data-depuis]`)?.dataset.depuis, UNITE);
  const depuisCh = await ch.p.evaluate(() => document.querySelector('.comm-flotte [data-depuis]')?.dataset.depuis);
  if (depuisCcs && depuisCh && new Date(depuisCcs).getTime() !== new Date(depuisCh).getTime()) erreurs.push(`compteurs non synchronisés : ${depuisCcs} ≠ ${depuisCh}`); else etape(`Chrono : même horodatage source CCS et CHSLD (${depuisCcs})`);
  for (const [n, x] of [['ccs', ccs], ['ambulance', amb], ['hopital', hop], ['chsld', ch]]) await x.p.screenshot({ path: `${OUT}/2-${n}.png`, fullPage: true });
  // 5. Sur place puis fin de mission → remise en disponibilité visible au CCS ; la mission rejoint l'historique
  for (const a of ['sur_place', 'terminer']) { const r = await api(amb.tok, 'POST', `/secours/missions/${m.j.id}/action`, { action: a }); if (r.s !== 200) erreurs.push(`${a} : ${JSON.stringify(r.j)}`); }
  await attendre('CCS', ccs.p, 'Disponible');
  const h = (await api(ccs.tok, 'GET', `/secours/flotte/historique?q=${num}`)).j;
  if (!h.lignes.some((x) => x.numero === num)) erreurs.push('mission absente de l’historique'); else etape(`Historique : ${num} terminée, consultable`);
  await nav.close();
  fs.writeFileSync(`${OUT}/rapport.json`, JSON.stringify({ base: BASE, mission: num, journal, erreurs }, null, 2));
  console.log(erreurs.length ? `ERREURS\n${erreurs.join('\n')}` : 'aucune erreur');
})().catch((e) => { console.error(e); process.exit(1); });
