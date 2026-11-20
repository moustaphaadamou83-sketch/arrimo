'use strict';
/** Module 🎓 Formation, lot 1 (22 nov. 2026) : parcours par rôle et modules, capsules visibles, test noté et chronométré par le serveur, FR/EN. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'); const path = require('node:path');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');
const CAT = require('../src/formation-catalogue');

let pool; let serveur; let base; const tok = {}; const ids = {};
async function appel(qui, m, c, b, langue = 'fr') {
  const r = await fetch(`${base}/api${c}`, { method: m, headers: { 'Content-Type': 'application/json', 'X-Langue': langue, ...(qui ? { Authorization: `Bearer ${tok[qui]}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { s: r.status, d };
}
async function compte(cle, role, { etab, org } = {}) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [`${cle}@demo.arrimo`, cle, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (etab) await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etab]);
  if (org) await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, org]);
  tok[cle] = (await appel(null, 'POST', '/connexion', { email: `${cle}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO })).d.token; assert.ok(tok[cle], cle);
}
test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const [a, b] = (await pool.query("SELECT id, config_id FROM etablissements WHERE type_etablissement = 'hopital' ORDER BY id LIMIT 2")).rows;
  ids.a = a.id; ids.b = b.id;
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"formation": true, "liaison_secours": true, "chrono": true}' WHERE id = $1`, [ids.a]);
  ids.org = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id, formation) VALUES ('AMB-F', 'Ambulances F', 'ambulancier', '{ambulance}', $1, true) RETURNING id", [a.config_id])).rows[0].id;
  await compte('soins.a', 'equipe_soins', { etab: ids.a }); await compte('coord.a', 'coordonnateur', { etab: ids.a }); await compte('coord.b', 'coordonnateur', { etab: ids.b });
  await compte('para', 'paramedic', { org: ids.org });
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('catalogue : chaque parcours référence des capsules existantes ; capsule prête complète en FR et en EN, avec ses captures', () => {
  for (const p of CAT.PARCOURS) for (const c of p.capsules) assert.ok(CAT.capsule(c), `${p.code} → ${c}`);
  for (const c of CAT.CAPSULES) {
    assert.ok(c.titre.fr && c.titre.en, c.code);
    if (!c.pret) continue;
    assert.ok(c.objectif.fr && c.objectif.en && c.compte, c.code);
    assert.strictEqual(c.quiz.length, 3, c.code);
    for (const q of c.quiz) { assert.ok(q.q.fr && q.q.en); assert.strictEqual(q.choix.fr.length, q.choix.en.length); assert.ok(q.bonne < q.choix.fr.length); }
    for (const [i, s] of c.scenes.entries()) {
      assert.ok(s.st.fr && s.st.en, `${c.code} scène ${i + 1}`);
      for (const L of ['fr', 'en']) assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'formation', 'captures', c.code, `${i + 1}-${L}.jpg`)), `capture ${c.code}/${i + 1}-${L}`);
    }
  }
  assert.strictEqual(CAT.capsule('S2').scenes.length, 10, 'gabarit Triage : 10 scènes'); assert.strictEqual(CAT.capsule('S2').chrono_test_s, 60);
});

test('parcours par rôle et modules : soins → Triage / AIC ; coordination → Gestion des lits ; ambulancier ; module non activé → inactif', async () => {
  const s = (await appel('soins.a', 'GET', '/formation/moi')).d;
  assert.ok(s.actif); assert.deepStrictEqual(s.parcours.map((p) => p.code), ['triage']);
  assert.ok(s.parcours[0].capsules.some((c) => c.code === 'S2' && c.etat === 'a_faire'), 'Liaison Secours actif : capsule visible');
  const c = (await appel('coord.a', 'GET', '/formation/moi')).d; assert.deepStrictEqual(c.parcours.map((p) => p.code), ['lits']);
  assert.ok(c.eligibles.some((e) => e.code === 'triage') && !c.eligibles.some((e) => e.code === 'ambulancier'));
  assert.deepStrictEqual((await appel('coord.b', 'GET', '/formation/moi')).d, { actif: false }, 'formation non activée');
  const p = (await appel('para', 'GET', '/formation/moi')).d; assert.deepStrictEqual(p.parcours.map((x) => x.code), ['ambulancier']);
  assert.strictEqual((await appel('para', 'GET', '/lits?etablissement_id=1')).s, 403, 'rôle de secours toujours limité ailleurs');
  const en = (await appel('soins.a', 'GET', '/formation/moi', null, 'en')).d; assert.strictEqual(en.parcours[0].nom, 'Triage nurse');
});

test('choix des parcours : seulement ceux du rôle', async () => {
  assert.strictEqual((await appel('coord.a', 'PUT', '/formation/parcours', { parcours: ['ambulancier'] })).s, 400);
  assert.strictEqual((await appel('coord.a', 'PUT', '/formation/parcours', { parcours: [] })).s, 400);
  assert.deepStrictEqual((await appel('coord.a', 'PUT', '/formation/parcours', { parcours: ['lits', 'triage'] })).d, { parcours: ['lits', 'triage'] });
  assert.deepStrictEqual((await appel('coord.a', 'GET', '/formation/moi')).d.parcours.map((p) => p.code), ['lits', 'triage']);
});

test('capsule : contenu sans les réponses ; capsule hors parcours ou en préparation → 404 ; test noté par le serveur', async () => {
  const c = (await appel('soins.a', 'GET', '/formation/capsules/C1')).d;
  assert.strictEqual(c.scenes.length, 4); assert.ok(c.scenes[0].image.endsWith('/C1/1-fr.jpg')); assert.ok(!JSON.stringify(c.quiz).includes('bonne'));
  assert.strictEqual((await appel('soins.a', 'GET', '/formation/capsules/V2')).s, 404, 'hors de ses parcours');
  assert.strictEqual((await appel('soins.a', 'GET', '/formation/capsules/S1')).s, 404, 'en préparation');
  assert.strictEqual((await appel('soins.a', 'POST', '/formation/capsules/C1/quiz', { reponses: [0, 0, 1] })).s, 409, 'pas de test sans début enregistré');
  await appel('soins.a', 'POST', '/formation/capsules/C1/vue');
  await appel('soins.a', 'POST', '/formation/capsules/C1/quiz/debut');
  const rate = (await appel('soins.a', 'POST', '/formation/capsules/C1/quiz', { reponses: [1, 1, 0] })).d; assert.strictEqual(rate.reussi, false);
  await appel('soins.a', 'POST', '/formation/capsules/C1/quiz/debut');
  const bon = CAT.capsule('C1').quiz.map((q) => q.bonne);
  const r = (await appel('soins.a', 'POST', '/formation/capsules/C1/quiz', { reponses: bon })).d; assert.deepStrictEqual([r.reussi, r.score], [true, 100]);
  const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'formation', 'captures', 'manifeste.json'), 'utf8'));
  await appel('soins.a', 'POST', '/formation/capsules/C1/exercice/debut');
  for (const e of CAT.capsule('C1').exercice) { const z = man.C1[e.scene].fr; await appel('soins.a', 'POST', '/formation/capsules/C1/exercice/clic', { x: z.x + z.w / 2, y: z.y + z.h / 2 }); }
  const m = (await appel('soins.a', 'GET', '/formation/moi')).d;
  assert.strictEqual(m.parcours[0].capsules.find((x) => x.code === 'C1').etat, 'reussi'); assert.ok(m.progression > 0);
  const essais = (await pool.query("SELECT count(*)::int n FROM formation_essais WHERE capsule = 'C1' AND genre = 'quiz'")).rows[0].n; assert.strictEqual(essais, 2);
});

test('test chronométré (60 s) : au-delà du temps, échec même avec les bonnes réponses ; temps mesuré par le serveur', async () => {
  await appel('soins.a', 'POST', '/formation/capsules/S2/quiz/debut');
  await pool.query("UPDATE formation_progression SET quiz_debut_le = now() - interval '70 seconds' WHERE capsule = 'S2'");
  const r = (await appel('soins.a', 'POST', '/formation/capsules/S2/quiz', { reponses: CAT.capsule('S2').quiz.map((q) => q.bonne) })).d;
  assert.deepStrictEqual([r.reussi, r.hors_temps, r.score], [false, true, 100]);
});

test('interface : textes de « Ma formation » complets en FR et en EN', () => {
  const vm = require('node:vm'); const ctx = { window: { addEventListener() {} }, document: { getElementById: () => ({ textContent: '' }), addEventListener() {}, querySelectorAll: () => [], documentElement: {} }, localStorage: { getItem: () => null, setItem() {} }, location: { replace() {}, hash: '' }, fetch: () => new Promise(() => {}), setTimeout, clearTimeout, setInterval, clearInterval };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'formation', 'formation.js'), 'utf8'), ctx);
  const cles = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? cles(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  const { fr, en } = ctx.window.ArrimoFormation?.TXT || {};
  assert.ok(fr && en, 'textes exposés'); assert.deepStrictEqual(cles(fr), cles(en));
  assert.ok(!/\(s\)/.test(JSON.stringify(fr)), 'aucun « (s) »');
});

test('exercice guidé : état tenu par le serveur, clic faux → bulle, clic juste → étape suivante ; capsule réussie seulement avec exercice ET test', async () => {
  const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'formation', 'captures', 'manifeste.json'), 'utf8'));
  const c = CAT.capsule('H2');
  assert.strictEqual((await appel('soins.a', 'POST', '/formation/capsules/H2/exercice/clic', { x: 1, y: 1 })).s, 409, 'pas de clic sans début');
  await appel('soins.a', 'POST', '/formation/capsules/H2/quiz/debut');
  const q = (await appel('soins.a', 'POST', '/formation/capsules/H2/quiz', { reponses: c.quiz.map((x) => x.bonne) })).d;
  assert.deepStrictEqual([q.reussi, q.capsule_reussie, q.exercice_a_faire], [true, false, true], 'test seul : capsule pas encore réussie');
  assert.strictEqual((await appel('soins.a', 'POST', '/formation/capsules/H2/exercice/debut')).d.etapes, c.exercice.length);
  const z = man.H2[c.exercice[0].scene].fr;
  const faux = (await appel('soins.a', 'POST', '/formation/capsules/H2/exercice/clic', { x: 99, y: 99 })).d;
  assert.deepStrictEqual([faux.juste, faux.indice], [false, z]);
  const bon = (await appel('soins.a', 'POST', '/formation/capsules/H2/exercice/clic', { x: z.x + z.w / 2, y: z.y + z.h / 2 })).d;
  assert.deepStrictEqual([bon.juste, bon.termine, bon.score, bon.reussi, bon.capsule_reussie], [true, true, 75, true, true]);
  const m = (await appel('soins.a', 'GET', '/formation/moi')).d;
  assert.strictEqual(m.parcours[0].capsules.find((x) => x.code === 'H2').etat, 'reussi');
  assert.strictEqual((await appel('soins.a', 'POST', '/formation/capsules/H2/exercice/clic', { x: -5, y: 2 })).s, 409, 'exercice terminé');
});

async function reussirCapsule(qui, code) {
  const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'formation', 'captures', 'manifeste.json'), 'utf8'));
  const c = CAT.capsule(code);
  await appel(qui, 'POST', `/formation/capsules/${code}/quiz/debut`);
  await appel(qui, 'POST', `/formation/capsules/${code}/quiz`, { reponses: c.quiz.map((q) => q.bonne) });
  await appel(qui, 'POST', `/formation/capsules/${code}/exercice/debut`);
  for (const e of c.exercice) { const z = man[code][e.scene].fr; await appel(qui, 'POST', `/formation/capsules/${code}/exercice/clic`, { x: z.x + z.w / 2, y: z.y + z.h / 2 }); }
}

test('attestation PDF FR/EN seulement après le parcours, satisfaction, suivi du formateur (CSV), superutilisateurs', async () => {
  await compte('admin.a', 'admin_etab', { etab: ids.a });
  assert.strictEqual((await appel('soins.a', 'GET', '/formation/parcours/triage/attestation.pdf')).s, 409, 'parcours non terminé');
  const m = (await appel('soins.a', 'GET', '/formation/moi')).d;
  for (const c of m.parcours[0].capsules.filter((x) => x.etat !== 'preparation' && x.etat !== 'reussi')) await reussirCapsule('soins.a', c.code);
  const fini = (await appel('soins.a', 'GET', '/formation/moi')).d.parcours[0]; assert.strictEqual(fini.reussies, fini.total);
  for (const L of ['fr', 'en']) {
    const r = await fetch(`${base}/api/formation/parcours/triage/attestation.pdf`, { headers: { Authorization: `Bearer ${tok['soins.a']}`, 'X-Langue': L } });
    assert.strictEqual(r.status, 200); assert.match(r.headers.get('content-type'), /pdf/); assert.strictEqual((await r.arrayBuffer()).byteLength > 1000, true);
  }
  assert.strictEqual((await pool.query("SELECT count(*)::int n FROM formation_attestations WHERE parcours = 'triage'")).rows[0].n, 1, 'une seule attestation par parcours');
  assert.strictEqual((await appel('soins.a', 'POST', '/formation/parcours/triage/satisfaction', { note: 7 })).s, 400);
  assert.strictEqual((await appel('soins.a', 'POST', '/formation/parcours/triage/satisfaction', { note: 5, commentaire: 'Clair et court' })).s, 200);
  // Suivi : administrateur oui, coordonnateur non (tant qu'il n'est pas superutilisateur)
  assert.strictEqual((await appel('coord.a', 'GET', `/formation/suivi?etablissement_id=${ids.a}`)).s, 403);
  const s = (await appel('admin.a', 'GET', `/formation/suivi?etablissement_id=${ids.a}`)).d;
  const ligne = s.personnes.find((x) => x.nom === 'soins.a'); assert.strictEqual(ligne.reussies, ligne.total); assert.strictEqual(s.satisfaction.n, 1);
  const r = await fetch(`${base}/api/formation/suivi.csv?etablissement_id=${ids.a}`, { headers: { Authorization: `Bearer ${tok['admin.a']}` } });
  assert.match(await r.text(), /Nom;Rôle;Parcours;Capsules;Vues;Pratiquées;Réussies/);
  const coord = s.personnes.find((x) => x.nom === 'coord.a');
  assert.strictEqual((await appel('coord.a', 'PUT', '/formation/superutilisateurs', { etablissement_id: ids.a, utilisateur_id: coord.id, actif: true })).s, 403, 'seul l’administrateur désigne');
  assert.strictEqual((await appel('admin.a', 'PUT', '/formation/superutilisateurs', { etablissement_id: ids.a, utilisateur_id: coord.id, actif: true })).s, 200);
  assert.strictEqual((await appel('coord.a', 'GET', `/formation/suivi?etablissement_id=${ids.a}`)).s, 200, 'le superutilisateur suit son établissement');
  assert.deepStrictEqual((await appel('soins.a', 'GET', '/formation/superutilisateurs')).d.map((x) => x.nom), ['coord.a']);
});

test('aide en contexte : capsule de chaque écran ; OG « comment faire… » renvoie vers la capsule', async () => {
  const a = (await appel('soins.a', 'GET', '/formation/aide')).d;
  assert.strictEqual(a.chrono.code, 'C1'); assert.ok(a.lits && a.secours);
  assert.deepStrictEqual((await appel('coord.b', 'GET', '/formation/aide')).d, {}, 'formation non activée : rien');
  const og = (await appel('soins.a', 'POST', '/copilote/question', { etablissement_id: ids.a, question: 'Comment corriger une heure dans le Chrono ?', langue: 'fr' })).d;
  assert.match(og.reponse, /Corriger une heure/); assert.strictEqual(og.lien, '/formation#capsule/C2');
});
