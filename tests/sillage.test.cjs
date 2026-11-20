'use strict';
/** Sillage transversal, Vigilance des parcours et OG (22 nov. 2026) : parcours lié, droits par objet, étapes sautées, aucune répétition. */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');
const horloge = require('../src/horloge');

let pool; let serveur; let base; const tokens = {}; const ids = {};
async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${tokens[qui]}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  const t = await r.text(); let c; try { c = JSON.parse(t); } catch { c = t; } return { statut: r.status, corps: c };
}
async function compte(cle, role, { etab, org } = {}) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [`${cle}@demo.arrimo`, cle, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (etab) await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etab]);
  if (org) await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, org]);
  tokens[cle] = (await appel(null, 'POST', '/connexion', { email: `${cle}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO })).corps.token; assert.ok(tokens[cle], cle);
}
test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const [a, b, c] = (await pool.query("SELECT id, config_id FROM etablissements WHERE type_etablissement = 'hopital' ORDER BY id LIMIT 3")).rows;
  Object.assign(ids, { a: a.id, b: b.id, c: c.id });
  ids.org = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('AMB-S', 'Ambulances S', 'ambulancier', '{ambulance}', $1) RETURNING id", [a.config_id])).rows[0].id;
  ids.autreOrg = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('AMB-Z', 'Ambulances Z', 'ambulancier', '{ambulance}', $1) RETURNING id", [a.config_id])).rows[0].id;
  const u = (await pool.query("INSERT INTO unites_secours (organisation_id, numero) VALUES ($1, 'S1') RETURNING id", [ids.org])).rows[0].id;
  ids.pa = (await pool.query(`INSERT INTO prealertes (numero, organisation_id, unite_id, destination_id, statut, priorite, categorie, cree_le) VALUES ('PA-090001', $1, $2, $3, 'arrivee', 'urgente', 'medicale', now() - interval '2 hours') RETURNING id`, [ids.org, u, ids.a])).rows[0].id;
  ids.ch = (await pool.query(`INSERT INTO passages_chrono (numero, etablissement_id, unite_id, organisation_id, prealerte_id, statut, source) VALUES ('CH-090001', $1, $2, $3, $4, 'a_la_porte', 'position') RETURNING id`, [ids.a, u, ids.org, ids.pa])).rows[0].id;
  // H11 il y a 40 min, H13 marquée mais H12 jamais : étape sautée ; civière non libérée au-delà de la cible
  await horloge.marquer(pool, { objet: 'passage_chrono', objetId: ids.ch, etape: 'H11', heure: new Date(Date.now() - 40 * 60000), source: 'systeme' });
  await horloge.marquer(pool, { objet: 'passage_chrono', objetId: ids.ch, etape: 'H13', heure: new Date(Date.now() - 25 * 60000), source: 'clic' });
  await compte('coord.a', 'coordonnateur', { etab: ids.a }); await compte('coord.c', 'coordonnateur', { etab: ids.c });
  await compte('para.s', 'paramedic', { org: ids.org }); await compte('para.z', 'paramedic', { org: ids.autreOrg });
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('parcours lié : passage Chrono et sa préalerte, même identifiant, heures de l’Horloge, étape sautée signalée', async () => {
  const r = await appel('coord.a', 'GET', `/sillage?objet=passage_chrono&id=${ids.ch}`);
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  assert.deepStrictEqual(r.corps.objets.map((o) => o.numero).sort(), ['CH-090001', 'PA-090001']);
  assert.strictEqual(r.corps.parcours, 'PA-090001', 'le parcours porte le numéro de son premier objet');
  assert.deepStrictEqual(r.corps.evenements.map((e) => e.etape), ['H11', 'H13']);
  assert.deepStrictEqual(r.corps.incompletes, [{ objet: 'passage_chrono', numero: 'CH-090001', etape: 'H12' }]);
  const r2 = await appel('coord.a', 'GET', `/sillage?objet=prealerte&id=${ids.pa}`);
  assert.strictEqual(r2.corps.parcours, r.corps.parcours, 'même parcours depuis l’autre module');
});

test('droits : un autre établissement, une autre organisation ou un intrus ne voient rien (404) ; l’ambulance voit par /secours', async () => {
  assert.strictEqual((await appel('coord.c', 'GET', `/sillage?objet=passage_chrono&id=${ids.ch}`)).statut, 404);
  assert.strictEqual((await appel('para.z', 'GET', `/secours/sillage?objet=prealerte&id=${ids.pa}`)).statut, 404);
  assert.strictEqual((await appel('para.s', 'GET', `/sillage?objet=prealerte&id=${ids.pa}`)).statut, 403, 'rôle de secours : seulement /secours/*');
  const s = await appel('para.s', 'GET', `/secours/sillage?objet=prealerte&id=${ids.pa}`);
  assert.strictEqual(s.statut, 200); assert.ok(s.corps.objets.some((o) => o.numero === 'CH-090001'));
  assert.strictEqual((await appel('coord.a', 'GET', '/sillage?objet=lits&id=1')).statut, 400);
});

test('Vigilance des parcours : civière au-delà de la cible et étape sautée, une ligne par fait ; disparaît quand c’est fait', async () => {
  let a = (await appel('coord.a', 'GET', `/sillage/attention?etablissement_id=${ids.a}`)).corps;
  const codes = a.items.map((i) => i.code).sort();
  assert.ok(codes.includes('civiere_au_dela_cible') && codes.includes('transition_incomplete'), JSON.stringify(codes));
  assert.strictEqual(new Set(a.items.map((i) => i.cle)).size, a.items.length, 'aucune répétition');
  assert.strictEqual((await appel('coord.c', 'GET', `/sillage/attention?etablissement_id=${ids.a}`)).statut, 403);
  await horloge.marquer(pool, { objet: 'passage_chrono', objetId: ids.ch, etape: 'H12', heure: new Date(Date.now() - 30 * 60000), source: 'clic' });
  await horloge.marquer(pool, { objet: 'passage_chrono', objetId: ids.ch, etape: 'H14', source: 'clic' });
  a = (await appel('coord.a', 'GET', `/sillage/attention?etablissement_id=${ids.a}`)).corps;
  assert.ok(!a.items.some((i) => i.objet === 'passage_chrono'), 'faits réglés : plus de ligne');
});

test('OG : explique un parcours par son numéro (FR/EN), liste ce qui est en attente, ne décide rien', async () => {
  const fr = (await appel('coord.a', 'POST', '/copilote/question', { etablissement_id: ids.a, question: 'Explique le parcours CH-090001', langue: 'fr' })).corps;
  assert.match(fr.reponse, /Parcours PA-090001/); assert.match(fr.reponse, /l’équipe décide/); assert.deepStrictEqual(fr.sillage, { objet: 'passage_chrono', id: ids.ch });
  const en = (await appel('coord.a', 'POST', '/copilote/question', { etablissement_id: ids.a, question: 'Explain path CH-090001', langue: 'en' })).corps;
  assert.match(en.reponse, /Path PA-090001/);
  const intrus = (await appel('coord.c', 'POST', '/copilote/question', { etablissement_id: ids.c, question: 'Explique le parcours CH-090001', langue: 'fr' })).corps;
  assert.ok(!/CH-090001 ·/.test(intrus.reponse || ''), 'OG ne révèle pas un parcours hors périmètre');
  const att = (await appel('coord.a', 'POST', '/copilote/question', { etablissement_id: ids.a, question: 'Qu’est-ce qui est en attente ?', langue: 'fr' })).corps;
  assert.match(att.reponse, /À regarder maintenant|Rien en attente/);
});

test('composant commun FR/EN : mêmes clés dans les deux langues', () => {
  const fs = require('node:fs'); const vm = require('node:vm');
  const c = { window: {}, document: { addEventListener() {} }, localStorage: { getItem: () => null }, location: { pathname: '/' } }; vm.createContext(c);
  vm.runInContext(fs.readFileSync(require.resolve('../public/sillage.js'), 'utf8'), c);
  const { fr, en } = c.window.ArrimoSillage.TXT;
  const cles = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? cles(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  assert.deepStrictEqual(cles(fr), cles(en));
  for (const o of require('../src/horloge').OBJETS) assert.ok(fr.o[o] && en.o[o], o);
  for (const e of require('../src/horloge').ETAPES) assert.ok(fr.e[e] && en.e[e], e);
});
