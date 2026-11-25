'use strict';
/**
 * Refonte unifiée (26 nov. 2026) : plans A, B et C d'OG pour un transfert, préparés pendant l'attente (avant tout refus).
 * Destination demandée exclue des alternatives ; disponibilité confirmée distinguée de la déclarée ; besoins inconnus signalés ;
 * rien n'est réservé ni modifié ; seule l'origine consulte ; aucun plan pour un transfert déjà accepté.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');

let pool; let serveur; let base; const tokens = {}; const ids = {};
const appel = async (q, chemin) => { const r = await fetch(`${base}/api${chemin}`, { headers: { Authorization: `Bearer ${tokens[q]}` } }); return { statut: r.status, corps: await r.json().catch(() => null) }; };

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  for (const q of ['tremblay', 'bouchard']) tokens[q] = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${q}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
  [ids.mb, ids.sl] = (await pool.query("SELECT id FROM etablissements WHERE code IN ('MB', 'SL') ORDER BY code")).rows.map((x) => x.id);
  ids.type = (await pool.query("SELECT id FROM types_unite WHERE code = 'MED' ORDER BY id LIMIT 1")).rows[0].id;
  // Une place confirmée ailleurs (hors SL) pour que le plan B soit une disponibilité confirmée
  await pool.query(`UPDATE lits SET disponibilite_confirmee_le = now() WHERE id = (SELECT l.id FROM lits l JOIN etablissements e ON e.id = l.etablissement_id
    WHERE l.etat = 'libre' AND l.type_id = $1 AND e.code NOT IN ('MB', 'SL') AND e.partage = 'complet' ORDER BY l.id LIMIT 1)`, [ids.type]);
  ids.t = (await pool.query(`INSERT INTO transferts (numero, patient_ref, origine_id, destination_id, type_id, statut, date_demande)
    VALUES ('TR-ALT1', 'P-99301', $1, $2, $3, 'demande', now() - interval '3 hours') RETURNING id`, [ids.mb, ids.sl, ids.type])).rows[0].id;
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('plans préparés pendant l’attente : A = destination demandée, B et C = autres, explicables ; rien n’est modifié', async () => {
  const avant = (await pool.query("SELECT (SELECT md5(string_agg(t::text, '' ORDER BY id)) FROM transferts t) AS t, (SELECT md5(string_agg(l::text, '' ORDER BY id)) FROM lits l) AS l")).rows[0];
  const r = await appel('tremblay', `/transferts/${ids.t}/plans`);
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  assert.strictEqual(r.corps.plan_a.etablissement_id, ids.sl); assert.match(r.corps.plan_a.situation, /^sans réponse depuis 1\d\d min \(délai configuré : \d+ min\)$/);
  assert.ok(r.corps.alternatives.length >= 1 && r.corps.alternatives.length <= 2);
  assert.ok(r.corps.alternatives.every((a) => a.etablissement_id !== ids.sl && a.etablissement_id !== ids.mb), 'ni la destination demandée, ni l’origine');
  assert.deepStrictEqual(r.corps.alternatives.map((a) => a.plan), r.corps.alternatives.length === 2 ? ['B', 'C'] : ['B']);
  const b = r.corps.alternatives[0];
  assert.strictEqual(b.confirme, true, 'le plan B est une disponibilité confirmée quand il en existe'); assert.ok(b.confirme_le);
  for (const a of r.corps.alternatives) { assert.ok(a.disponibilite && a.trajet); assert.ok(a.a_verifier.some((x) => /acceptation/.test(x))); }
  assert.match(r.corps.incertitude, /Besoins non renseignés/);
  assert.match(r.corps.regle, /rien n’est réservé/);
  const apres = (await pool.query("SELECT (SELECT md5(string_agg(t::text, '' ORDER BY id)) FROM transferts t) AS t, (SELECT md5(string_agg(l::text, '' ORDER BY id)) FROM lits l) AS l")).rows[0];
  assert.deepStrictEqual(apres, avant, 'aucune réservation, aucune modification');
});

test('OG : la fiche « transfert sans réponse » du plan de coordination porte le plan B', async () => {
  const p = (await appel('tremblay', `/coordination/plan?etablissement_id=${ids.mb}`)).corps;
  const f = p.fiches.find((x) => x.type === 'transfert_sans_reponse');
  assert.ok(f.actions.some((a) => a.startsWith('Plan B pour TR-ALT1 : ')), f.actions.join(' | '));
});

test('droits et états : le receveur ne voit pas les alternatives ; transfert accepté → aucun plan', async () => {
  assert.strictEqual((await appel('bouchard', `/transferts/${ids.t}/plans`)).statut, 404);
  await pool.query("UPDATE transferts SET statut = 'validee', date_validation = now() WHERE id = $1", [ids.t]);
  const r = await appel('tremblay', `/transferts/${ids.t}/plans`);
  assert.deepStrictEqual(r.corps.alternatives, []);
});
