/**
 * Test de charge : 50 utilisateurs simultanés sur la démo Hôpital X / Hôpital Y.
 *   CHARGE_DATABASE_URL=postgres:///arrimo_dev_test node scripts/charge.js      (la base est effacée et recréée)
 *   CHARGE_UTILISATEURS=50  CHARGE_SECONDES=60
 * Le serveur tourne dans un processus séparé (comme en production). Chaque utilisateur virtuel ouvre sa session et
 * rafraîchit ses écrans (1 à 3 s entre deux écrans, beaucoup plus souvent qu'un vrai utilisateur). Pendant le test,
 * tous essaient en même temps de réserver les mêmes lits : un seul doit gagner par lit.
 * Critères : aucune erreur 5xx ni réseau ; verrou des lits respecté ; temps mesurés. Écrit docs/charge.md.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { creerPool } = require('../src/db');
const { viderBase } = require('../db/vider');
const { demoReseau } = require('../db/demo-reseau');

const URL_BASE = process.env.CHARGE_DATABASE_URL || process.env.TEST_DATABASE_URL;
const N = Number(process.env.CHARGE_UTILISATEURS || 50);
const DUREE = Number(process.env.CHARGE_SECONDES || 60) * 1000;
const PORT = Number(process.env.CHARGE_PORT || 3031);
const MDP = process.env.DEMO_MOT_DE_PASSE || 'Demo-Arrimo-2026';
const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });
const centile = (v, p) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0; };

(async () => {
  if (!URL_BASE) throw new Error('CHARGE_DATABASE_URL requis');
  const pool = creerPool(URL_BASE);
  await viderBase(pool);
  const { ids } = await demoReseau(pool, { silencieux: true, comptesRoles: true });
  const serveur = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: URL_BASE, PORT: String(PORT), HOST: '127.0.0.1', NODE_ENV: 'production', ARRIMO_DEMO: '1' },
  });
  let journalServeur = '';
  serveur.stdout.on('data', (d) => { journalServeur += d; });
  serveur.stderr.on('data', (d) => { journalServeur += d; });
  const base = `http://127.0.0.1:${PORT}/api`;
  for (let i = 0; i < 50; i += 1) { try { if ((await fetch(`${base}/sante`)).ok) break; } catch { /* démarrage */ } await pause(200); }

  const mesures = new Map();   // écran → temps
  const statuts = new Map();   // code → nombre
  let erreurs = 0;
  async function appel(jeton, methode, chemin, corps, nom) {
    const t0 = process.hrtime.bigint();
    try {
      const r = await fetch(`${base}${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
      const data = await r.json().catch(() => null);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      if (!mesures.has(nom)) mesures.set(nom, []);
      mesures.get(nom).push(ms);
      statuts.set(r.status, (statuts.get(r.status) || 0) + 1);
      if (r.status >= 500) erreurs += 1;
      return { statut: r.status, data };
    } catch (e) {
      erreurs += 1;
      statuts.set('réseau', (statuts.get('réseau') || 0) + 1);
      return { statut: 0, data: null };
    }
  }

  // Sessions : coordination X et Y, urgence, entretien, réseau (une session par utilisateur virtuel)
  const comptes = ['hopital.x', 'hopital.y', 'entretien.x', 'entretien.y', 'reseau'];
  const vus = [];
  for (let i = 0; i < N; i += 1) {
    const email = `${comptes[i % comptes.length]}@demo.arrimo`;
    const r = await appel(null, 'POST', '/connexion', { email, mot_de_passe: MDP }, 'Connexion');
    if (!r.data?.token) throw new Error(`connexion ${email} : ${r.statut}`);
    vus.push({ email, jeton: r.data.token, etab: email.includes('.y') ? ids.HY : ids.HX });
  }

  // Lits libres disputés : tous les utilisateurs de coordination de chaque hôpital essaient de réserver les mêmes lits au même moment
  const disputesDe = {};
  for (const e of [ids.HX, ids.HY]) {
    disputesDe[e] = (await pool.query(`SELECT id, version, code FROM lits WHERE etablissement_id = $1 AND etat = 'libre' ORDER BY code LIMIT 5`, [e])).rows;
  }
  const disputes = [...disputesDe[ids.HX], ...disputesDe[ids.HY]];
  const depart = new Promise((r) => { setTimeout(r, Math.min(10000, DUREE / 3)); });
  const reservations = [];

  const fin = Date.now() + DUREE;
  await Promise.all(vus.map(async (u, i) => {
    const entretien = u.email.startsWith('entretien');
    const ecrans = entretien ? [['Nettoyage', `/nettoyage?etablissement_id=${u.etab}`]] : [
      ['Copilote · briefing', `/copilote/briefing?etablissement_id=${u.etab}`], ['Copilote · réseau', `/copilote/reseau?etablissement_id=${u.etab}`],
      ['Réseau', `/reseau?depuis=${u.etab}`], ['Lits', `/lits?etablissement_id=${u.etab}`], ['Admissions', `/admissions?etablissement_id=${u.etab}`],
      ['Transferts', `/transferts?etablissement_id=${u.etab}`], ['Nettoyage', `/nettoyage?etablissement_id=${u.etab}`], ['NSA', `/nsa?etablissement_id=${u.etab}`],
      ['Indicateurs', `/indicateurs?etablissement_id=${u.etab}`], ['Journal', `/journal?etablissement_id=${u.etab}`], ['Notifications', `/notifications?etablissement_id=${u.etab}`],
    ];
    let reserve = false;
    while (Date.now() < fin) {
      const [nom, chemin] = ecrans[Math.floor(Math.random() * ecrans.length)];
      await appel(u.jeton, 'GET', chemin, null, nom);
      if (!entretien && !reserve && disputesDe[u.etab].length) {
        reserve = true;
        await depart;
        const lit = disputesDe[u.etab][i % disputesDe[u.etab].length];
        const r = await appel(u.jeton, 'POST', `/lits/${lit.id}/action`, { action: 'reserver', version: lit.version, patient_ref: `P-${String(10000 + i).padStart(5, '0')}` }, 'Réserver (disputé)');
        reservations.push({ lit: lit.id, statut: r.statut });
      }
      await pause(1000 + Math.random() * 2000);
    }
  }));

  // Vérifications : un seul gagnant par lit disputé, état et version cohérents, refus journalisés
  const verrou = [];
  for (const lit of disputes) {
    const essais = reservations.filter((r) => r.lit === lit.id);
    const gagnants = essais.filter((r) => r.statut === 200).length;
    const refus = essais.filter((r) => r.statut === 409).length;
    const l = (await pool.query('SELECT etat, version FROM lits WHERE id = $1', [lit.id])).rows[0];
    const changements = (await pool.query(`SELECT count(*)::int AS n FROM journal WHERE lit_id = $1 AND action = 'Changement d’état' AND nouvel_etat = 'reserve'`, [lit.id])).rows[0].n;
    const refusJournal = (await pool.query(`SELECT count(*)::int AS n FROM journal WHERE lit_id = $1 AND refuse`, [lit.id])).rows[0].n;
    verrou.push({ code: lit.code, essais: essais.length, gagnants, refus, etat: l.etat, version: l.version - lit.version, changements, refusJournal,
      ok: gagnants === 1 && refus === essais.length - 1 && l.etat === 'reserve' && l.version === lit.version + 1 && changements === 1 && refusJournal === refus });
  }
  serveur.kill();
  await pool.end();

  const lignes = [...mesures.entries()].map(([nom, v]) => ({ nom, n: v.length, p50: centile(v, 50), p95: centile(v, 95), max: Math.max(...v) }))
    .sort((a, b) => b.p95 - a.p95);
  const total = [...mesures.values()].reduce((a, v) => a + v.length, 0);
  const tout = [].concat(...mesures.values());
  const verrouOk = verrou.every((v) => v.ok);
  const f = (v) => `${v.toFixed(1)} ms`;
  const md = [
    '# Arrimo · Test de charge',
    '',
    `Mesuré le ${new Date().toISOString().slice(0, 10)} : ${N} utilisateurs simultanés pendant ${DUREE / 1000} s sur la démo Hôpital X / Hôpital Y,`,
    'serveur dans un processus séparé, base PostgreSQL locale. Chaque utilisateur change d’écran toutes les 1 à 3 secondes',
    '(un vrai utilisateur rafraîchit toutes les 30 secondes). Au même instant, tous les utilisateurs de coordination essaient de réserver les mêmes lits libres.',
    '',
    '## Résultat',
    '',
    `- Requêtes : ${total} (${(total / (DUREE / 1000)).toFixed(1)} par seconde) · médiane ${f(centile(tout, 50))} · 95e centile ${f(centile(tout, 95))}`,
    `- Erreurs serveur (5xx) ou réseau : **${erreurs}**`,
    `- Codes HTTP : ${[...statuts.entries()].map(([k, v]) => `${k} × ${v}`).join(' · ')}`,
    `- Verrou des lits : **${verrouOk ? 'respecté' : 'NON respecté'}** (un seul gagnant par lit disputé, les autres refusés et journalisés)`,
    '',
    '| Écran (API) | Appels | Médiane | 95e centile | Maximum |',
    '|---|---|---|---|---|',
    ...lignes.map((l) => `| ${l.nom} | ${l.n} | ${f(l.p50)} | ${f(l.p95)} | ${f(l.max)} |`),
    '',
    '## Lits disputés',
    '',
    '| Lit | Essais simultanés | Réussis | Refusés (409) | État final | Versions + | Refus au journal |',
    '|---|---|---|---|---|---|---|',
    ...verrou.map((v) => `| ${v.code} | ${v.essais} | ${v.gagnants} | ${v.refus} | ${v.etat} | ${v.version} | ${v.refusJournal} |`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'charge.md'), md);
  console.log(md);
  if (erreurs || !verrouOk) {
    console.error(journalServeur.slice(-3000));
    process.exitCode = 1;
  }
})().catch((e) => { console.error(e); process.exit(1); });
