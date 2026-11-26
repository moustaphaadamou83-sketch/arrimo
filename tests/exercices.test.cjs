'use strict';
/**
 * Exercice de formation isolé avec injection d'événements (complémentaire nº 3, §9) : aucun objet réel modifié,
 * délais de réponse mesurés, événements et réponses immuables, droits par rôle et par établissement, refusé hors démo et recette.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed } = require('../db/seed');
const { hacher } = require('../src/auth');

let pool; let serveur; let base; const tokens = {}; const ids = {};
async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[qui]}` }, body: corps ? JSON.stringify(corps) : undefined });
  const t = await r.text(); let c = null; try { c = JSON.parse(t); } catch { c = t; }
  return { statut: r.status, corps: c };
}
async function compte(nom, role, etab) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $1, $2, $3) RETURNING id', [`${nom}@demo.arrimo`, await hacher('Exercice-2026!'), role])).rows[0].id;
  await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etab]);
  const r = await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${nom}@demo.arrimo`, mot_de_passe: 'Exercice-2026!' }) });
  tokens[nom] = (await r.json()).token; return u;
}
const empreinte = async () => (await pool.query(`SELECT (SELECT string_agg(id || ':' || etat || ':' || version, ',' ORDER BY id) FROM lits) AS lits,
  (SELECT string_agg(id || ':' || etat, ',' ORDER BY id) FROM civieres) AS civieres, (SELECT count(*) FROM transferts) AS transferts,
  (SELECT count(*) FROM journal) AS journal`)).rows[0];

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  ids.mb = (await pool.query("SELECT id FROM etablissements WHERE code = 'MB'")).rows[0].id;
  ids.sl = (await pool.query("SELECT id FROM etablissements WHERE code = 'SL'")).rows[0].id;
  await compte('form.ex', 'coordonnateur', ids.mb); await compte('ent.ex', 'entretien', ids.mb); await compte('autre.ex', 'coordonnateur', ids.sl);
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('exercice : injection et réponses mesurées, aucune donnée réelle modifiée, droits et immuabilité', async () => {
  const avant = await empreinte();
  assert.strictEqual((await appel('ent.ex', 'POST', '/formation/exercices', { etablissement_id: ids.mb })).statut, 403, 'seul un formateur ouvre');
  const x = await appel('form.ex', 'POST', '/formation/exercices', { etablissement_id: ids.mb, titre: 'Afflux du soir' });
  assert.strictEqual(x.statut, 200); ids.x = x.corps.id;
  assert.strictEqual((await appel('form.ex', 'POST', '/formation/exercices', { etablissement_id: ids.mb })).corps.code, 'exercice_deja_en_cours');
  assert.strictEqual((await appel('form.ex', 'POST', `/formation/exercices/${ids.x}/injecter`, { type: 'incendie' })).statut, 400, 'liste fermée');
  const e1 = (await appel('form.ex', 'POST', `/formation/exercices/${ids.x}/injecter`, { type: 'afflux_ambulances' })).corps;
  const e2 = (await appel('form.ex', 'POST', `/formation/exercices/${ids.x}/injecter`, { type: 'lit_bloque' })).corps;
  assert.strictEqual((await appel('ent.ex', 'POST', `/formation/exercices/${ids.x}/injecter`, { type: 'lit_bloque' })).statut, 403, 'un participant n’injecte pas');
  assert.strictEqual((await appel('autre.ex', 'GET', `/formation/exercices?etablissement_id=${ids.mb}`)).statut, 403, 'autre établissement');
  assert.strictEqual((await appel('autre.ex', 'POST', `/formation/exercices/${ids.x}/evenements/${e1.id}/repondre`, { action: 'escalader' })).statut, 403);
  await pool.query("UPDATE exercice_evenements SET injecte_le = injecte_le - interval '4 minutes' WHERE id = $1", [e1.id]).catch((err) => { ids.immuable = err.message; });
  assert.ok(ids.immuable, 'événements immuables');
  assert.strictEqual((await appel('ent.ex', 'POST', `/formation/exercices/${ids.x}/evenements/${e1.id}/repondre`, { action: 'escalader' })).statut, 200);
  assert.strictEqual((await appel('ent.ex', 'POST', `/formation/exercices/${ids.x}/evenements/${e1.id}/repondre`, { action: 'detruire' })).statut, 400);
  const etat = (await appel('ent.ex', 'GET', `/formation/exercices?etablissement_id=${ids.mb}`)).corps;
  assert.strictEqual(etat.en_cours.evenements.length, 2); assert.strictEqual(etat.formateur, false);
  assert.ok(etat.en_cours.evenements.find((e) => e.id === e1.id).premiere_reponse_min >= 0);
  assert.strictEqual(etat.en_cours.evenements.find((e) => e.id === e2.id).premiere_reponse_min, null);
  const fin = (await appel('form.ex', 'POST', `/formation/exercices/${ids.x}/terminer`)).corps;
  assert.deepStrictEqual([fin.synthese.evenements, fin.synthese.avec_reponse, fin.synthese.sans_reponse], [2, 1, 1]);
  assert.strictEqual((await appel('ent.ex', 'POST', `/formation/exercices/${ids.x}/evenements/${e2.id}/repondre`, { action: 'escalader' })).corps.code, 'exercice_termine');
  assert.deepStrictEqual(await empreinte(), avant, 'lits, civières, transferts et journal réels inchangés');
});

test('exercice : refusé en production et en pilote', async () => {
  const avant = process.env.ARRIMO_ENV;
  try {
    for (const env of ['production', 'pilote']) {
      process.env.ARRIMO_ENV = env;
      assert.strictEqual((await appel('form.ex', 'GET', `/formation/exercices?etablissement_id=${ids.mb}`)).statut, 403, env);
      assert.strictEqual((await appel('form.ex', 'POST', '/formation/exercices', { etablissement_id: ids.mb })).statut, 403, env);
    }
  } finally { if (avant == null) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = avant; }
});
