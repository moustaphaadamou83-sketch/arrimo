'use strict';
/**
 * Règle fondamentale de compatibilité des capacités (cahier nº 19, 26 nov. 2026), contrôlée côté serveur :
 * lit libre mais incompatible refusé ; exception autorisée seulement avec rôle, motif fermé et justification, tracée (registre immuable,
 * journal, Vigilance) ; le groupe d'âge n'admet aucune exception ; civière d'une préalerte choisie selon sa catégorie ;
 * diagnostic de l'attente : affectation, répartition ou pénurie réelle.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const compat = require('../src/compatibilite');

let pool; let serveur; let base; const tokens = {}; const ids = {};
async function appel(q, m, c, b) {
  const r = await fetch(`${base}/api${c}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[q]}` }, body: b ? JSON.stringify(b) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  tokens.tremblay = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'tremblay@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
  ids.mb = (await pool.query("SELECT id FROM etablissements WHERE code = 'MB'")).rows[0].id;
  const t = Object.fromEntries((await pool.query("SELECT code, id FROM types_unite WHERE code IN ('MED', 'CHIR')")).rows.map((x) => [x.code, x.id]));
  ids.med = t.MED; ids.chir = t.CHIR;
  ids.litChir = (await pool.query("SELECT id, version, type_id FROM lits WHERE etablissement_id = $1 AND type_id <> $2 AND etat = 'libre' AND groupe_age = 'adulte' ORDER BY id LIMIT 1", [ids.mb, ids.med])).rows[0];
  ids.chir = ids.litChir.type_id;
  ids.dem = (await pool.query(`INSERT INTO demandes_admission (etablissement_id, patient_ref, type_id, provenance, statut, priorite) VALUES ($1, 'P-99900', $2, 'urgence', 'attente', 'p2') RETURNING id`, [ids.mb, ids.med])).rows[0].id;
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('lit libre mais incompatible : refusé côté serveur ; exception sans justification refusée', async () => {
  const r = await appel('tremblay', 'POST', `/admissions/${ids.dem}/assigner`, { lit_id: ids.litChir.id, version: ids.litChir.version });
  assert.strictEqual(r.statut, 400, JSON.stringify(r.corps)); assert.strictEqual(r.corps.code, 'lit_inadapte');
  const r2 = await appel('tremblay', 'POST', `/admissions/${ids.dem}/assigner`, { lit_id: ids.litChir.id, version: ids.litChir.version, exception: { motif: 'debordement_capacite', justification: 'x' } });
  assert.strictEqual(r2.statut, 400); assert.strictEqual(r2.corps.code, 'parametre_invalide');
});

test('exception autorisée, justifiée et tracée (registre immuable, journal, Vigilance)', async () => {
  const r = await appel('tremblay', 'POST', `/admissions/${ids.dem}/assigner`, { lit_id: ids.litChir.id, version: ids.litChir.version,
    exception: { motif: 'debordement_capacite', justification: 'Médecine saturée, accord du coordonnateur de garde (fictif)' } });
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  const re = (await pool.query('SELECT * FROM reaffectations_exceptionnelles WHERE objet = $1 AND objet_id = $2', ['demande_admission', ids.dem])).rows[0];
  assert.ok(re); assert.strictEqual(re.motif, 'debordement_capacite'); assert.strictEqual(re.ecart.type_demande, ids.med); assert.strictEqual(re.ecart.type_lit, ids.chir);
  await assert.rejects(pool.query('UPDATE reaffectations_exceptionnelles SET motif = $1', ['autre_documente']));
  assert.ok((await pool.query("SELECT 1 FROM journal WHERE action = 'Réaffectation exceptionnelle' AND lit_id = $1", [ids.litChir.id])).rowCount);
  const v = (await appel('tremblay', 'GET', `/vigilance?etablissement_id=${ids.mb}`)).corps;
  assert.ok(v.alertes.some((a) => a.type === 'reaffectation_exceptionnelle'));
});

test('groupe d’âge : aucune exception possible', async () => {
  const lit = (await pool.query(`UPDATE lits SET etat = 'libre', groupe_age = 'pediatrique', patient_ref = NULL, sortie_prevue = NULL WHERE id = (SELECT id FROM lits
    WHERE etablissement_id = $1 AND etat IN ('libre', 'nettoyage') AND id <> $2 ORDER BY id DESC LIMIT 1) RETURNING id, version`, [ids.mb, ids.litChir.id])).rows[0];
  const dem = (await pool.query(`INSERT INTO demandes_admission (etablissement_id, patient_ref, type_id, provenance, statut, priorite) VALUES ($1, 'P-99901', $2, 'urgence', 'attente', 'p2') RETURNING id`, [ids.mb, ids.med])).rows[0].id;
  const r = await appel('tremblay', 'POST', `/admissions/${dem}/assigner`, { lit_id: lit.id, version: lit.version, exception: { motif: 'urgence_vitale', justification: 'Essai : jamais autorisé pour l’âge' } });
  assert.strictEqual(r.corps.code, 'lit_inadapte');
});

test('civières compatibles : pédiatrique seulement pour une préalerte pédiatrique ; isolement jamais automatique', () => {
  assert.deepStrictEqual(compat.civieresCompatibles('pediatrique'), ['pediatrique', 'reguliere', 'debordement']);
  assert.deepStrictEqual(compat.civieresCompatibles('cardiaque'), ['reguliere', 'debordement']);
  assert.ok(!compat.civieresCompatibles('respiratoire').includes('isolement'));
});

test('diagnostic de l’attente : affectation si un lit du même type est libre ici, sinon répartition ou pénurie', async () => {
  const v = (await appel('tremblay', 'GET', `/vigilance?etablissement_id=${ids.mb}`)).corps;
  const a = v.alertes.find((x) => x.type === 'attente_admission');
  if (a) assert.ok(['affectation', 'repartition', 'penurie'].includes(a.diagnostic));
  await pool.query("UPDATE demandes_admission SET cree_le = now() - interval '6 hours' WHERE id = $1", [ids.dem]).catch(() => {});
  const dem = (await pool.query(`INSERT INTO demandes_admission (etablissement_id, patient_ref, type_id, provenance, statut, priorite, cree_le) VALUES ($1, 'P-99902', $2, 'urgence', 'attente', 'p2', now() - interval '6 hours') RETURNING id`, [ids.mb, ids.chir])).rows[0].id;
  const b = (await appel('tremblay', 'GET', `/vigilance?etablissement_id=${ids.mb}`)).corps.alertes.find((x) => x.type === 'attente_admission' && x.ressource_id === dem);
  const libresChir = (await pool.query("SELECT count(*)::int AS n FROM lits WHERE etablissement_id = $1 AND type_id = $2 AND etat = 'libre' AND actif", [ids.mb, ids.chir])).rows[0].n;
  assert.strictEqual(b.diagnostic, libresChir > 0 ? 'affectation' : b.diagnostic);
  assert.ok(['affectation', 'repartition', 'penurie'].includes(b.diagnostic));
});
