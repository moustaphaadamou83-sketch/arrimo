/**
 * Mesure des temps de réponse de l'API sur la démo Hôpital X / Hôpital Y et plans d'exécution des requêtes clés.
 *   MESURE_DATABASE_URL=postgres:///arrimo_dev_test node scripts/mesures.js     (la base est effacée et recréée)
 * Écrit docs/mesures.md. Objectif : < 300 ms par écran.
 */
const fs = require('fs');
const path = require('path');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { demoReseau } = require('../db/demo-reseau');
const { SQL_CAPACITE } = require('../src/services');

const URL_BASE = process.env.MESURE_DATABASE_URL || process.env.TEST_DATABASE_URL;
const MDP = process.env.DEMO_MOT_DE_PASSE || 'Demo-Arrimo-2026';
const REPETITIONS = Number(process.env.MESURE_REPETITIONS || 30);
const centile = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

(async () => {
  if (!URL_BASE) throw new Error('MESURE_DATABASE_URL requis');
  const pool = creerPool(URL_BASE);
  await viderBase(pool);
  const { ids } = await demoReseau(pool, { silencieux: true });
  process.env.API_LIMITE_SESSION = '100000';
  const srv = creerApp(pool).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const jeton = async (email) => (await (await fetch(`${base}/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, mot_de_passe: MDP }) })).json()).token;
  const x = await jeton('hopital.x@demo.arrimo');
  const r = await jeton('reseau@demo.arrimo');
  const hx = ids.HX;
  const si = (await pool.query(`SELECT id FROM types_unite WHERE code = 'SI'`)).rows[0].id;
  const routes = [
    ['Copilote · briefing', x, `/copilote/briefing?etablissement_id=${hx}`],
    ['Copilote · réseau', x, `/copilote/reseau?etablissement_id=${hx}`],
    ['Copilote · question', x, '/copilote/question', { etablissement_id: hx, question: 'Que faire en priorité ?' }],
    ['Réseau · capacité', x, `/reseau?depuis=${hx}`],
    ['Réseau · recherche', x, `/recherche?depuis=${hx}&type_id=${si}&ventilation=1`],
    ['Lits', x, `/lits?etablissement_id=${hx}`],
    ['Admissions', x, `/admissions?etablissement_id=${hx}`],
    ['Transferts', x, `/transferts?etablissement_id=${hx}`],
    ['Nettoyage', x, `/nettoyage?etablissement_id=${hx}`],
    ['NSA', x, `/nsa?etablissement_id=${hx}`],
    ['Indicateurs (30 j)', x, `/indicateurs?etablissement_id=${hx}`],
    ['Journal', x, `/journal?etablissement_id=${hx}`],
    ['Notifications', x, `/notifications?etablissement_id=${hx}`],
    ['Moi', x, '/moi'],
    ['Copilote réseau (gestionnaire)', r, `/copilote/reseau?etablissement_id=${hx}`],
  ];
  const lignes = [];
  for (const [nom, tok, chemin, corps] of routes) {
    const temps = [];
    for (let i = 0; i < REPETITIONS + 3; i += 1) {
      const t0 = process.hrtime.bigint();
      const rep = await fetch(`${base}${chemin}`, { method: corps ? 'POST' : 'GET', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: corps ? JSON.stringify(corps) : undefined });
      await rep.arrayBuffer();
      if (!rep.ok) throw new Error(`${nom} : ${rep.status}`);
      if (i >= 3) temps.push(Number(process.hrtime.bigint() - t0) / 1e6);   // 3 premiers appels : mise en route
    }
    lignes.push({ nom, p50: centile(temps, 50), p95: centile(temps, 95), max: Math.max(...temps) });
  }

  // Plans d'exécution des requêtes clés (le journal grossit avec le temps : on y ajoute 20 000 lignes d'historique)
  await pool.query(`INSERT INTO journal (lit_id, etablissement_id, action, detail, date)
                    SELECT l.id, l.etablissement_id, 'Création', 'historique de mesure', now() - make_interval(days => 40 + g % 300)
                      FROM generate_series(1, 20000) g JOIN LATERAL (SELECT id, etablissement_id FROM lits ORDER BY id OFFSET g % 100 LIMIT 1) l ON true`);
  await pool.query('ANALYZE');
  const plans = [
    ['Capacité du réseau (SQL_CAPACITE)', SQL_CAPACITE, [hx, (await pool.query('SELECT config_id FROM etablissements WHERE id = $1', [hx])).rows[0].config_id]],
    ['Journal de l’établissement (première page)', `(SELECT id, date FROM journal WHERE etablissement_id = $1 ORDER BY date DESC, id DESC LIMIT 300)
      UNION (SELECT j.id, j.date FROM journal j JOIN transferts t ON t.id = j.transfert_id WHERE t.origine_id = $1 OR t.destination_id = $1 ORDER BY j.date DESC, j.id DESC LIMIT 300)
      ORDER BY date DESC, id DESC LIMIT 300`, [hx]],
    ['Indicateurs : durées de nettoyage (journal, 30 j)', `SELECT count(*) FROM journal WHERE etablissement_id = $1 AND action = 'Changement d’état' AND date > now() - interval '30 days'`, [hx]],
    ['File d’admission : lit libre adapté', `SELECT l.id FROM lits l WHERE l.etablissement_id = $1 AND l.type_id = $2 AND l.etat = 'libre' AND l.ventilation ORDER BY l.code LIMIT 1`, [hx, si]],
    ['Transferts de l’établissement (en cours)', `SELECT t.id FROM transferts t WHERE (t.origine_id = $1 OR t.destination_id = $1) AND t.statut NOT IN ('recu', 'refuse')`, [hx]],
  ];
  const explications = [];
  for (const [nom, sql, params] of plans) {
    const p = await pool.query(`EXPLAIN (ANALYZE, BUFFERS OFF, FORMAT TEXT) ${sql}`, params);
    const texte = p.rows.map((l) => l['QUERY PLAN']).join('\n');
    explications.push({ nom, texte, ms: Number((texte.match(/Execution Time: ([\d.]+)/) || [])[1]) });
  }
  srv.close();
  await pool.end();

  const f = (v) => `${v.toFixed(1)} ms`;
  const md = [
    '# Arrimo · Mesures de performance',
    '',
    `Mesuré le ${new Date().toISOString().slice(0, 10)} sur la démo Hôpital X / Hôpital Y (${REPETITIONS} appels par écran, serveur et base sur la même machine).`,
    'Objectif : moins de 300 ms par écran.',
    '',
    '| Écran (API) | Médiane | 95e centile | Maximum | Objectif |',
    '|---|---|---|---|---|',
    ...lignes.map((l) => `| ${l.nom} | ${f(l.p50)} | ${f(l.p95)} | ${f(l.max)} | ${l.p95 < 300 ? 'atteint' : '**dépassé**'} |`),
    '',
    '## Plans d’exécution (EXPLAIN ANALYZE, journal grossi de 20 000 lignes)',
    '',
    ...explications.flatMap((e) => [`### ${e.nom} · ${e.ms} ms`, '', '```', e.texte, '```', '']),
  ].join('\n');
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'mesures.md'), md);
  console.log(lignes.map((l) => `${l.nom.padEnd(34)} p50 ${f(l.p50).padStart(9)}  p95 ${f(l.p95).padStart(9)}`).join('\n'));
  console.log(explications.map((e) => `${e.nom} : ${e.ms} ms`).join('\n'));
  if (lignes.some((l) => l.p95 >= 300)) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
