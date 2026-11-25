'use strict';
/** Chantier B (26 nov. 2026) : contrôle des rattachements des lits (spécialité, service, département). */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');

test('rattachements : lits incomplets listés avec ce qui manque ; lecture seule ; droits', async () => {
  require('./routeur-fictif.cjs').activer();
  const pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  const serveur = await demarrerServeur(creerApp(pool)); const base = `http://127.0.0.1:${serveur.address().port}`;
  try {
    const mb = (await pool.query("SELECT id FROM etablissements WHERE code = 'MB'")).rows[0].id;
    await pool.query('UPDATE unites SET service_id = NULL WHERE id = (SELECT unite_id FROM lits WHERE etablissement_id = $1 ORDER BY id LIMIT 1)', [mb]);
    const jt = async (q) => (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${q}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
    const r = await (await fetch(`${base}/api/capacites/rattachements?etablissement_id=${mb}`, { headers: { Authorization: `Bearer ${await jt('tremblay')}` } })).json();
    assert.ok(r.lits.total > 0); assert.ok(r.lits.incomplets.some((l) => l.manque.includes('service')));
    assert.strictEqual(r.lits.complets + r.lits.incomplets.length, r.lits.total);
    assert.deepStrictEqual(r.non_modelises, ['salles', 'equipements_autonomes']);
    assert.strictEqual((await fetch(`${base}/api/capacites/rattachements?etablissement_id=${mb}`, { headers: { Authorization: `Bearer ${await jt('bouchard')}` } })).status, 403);
  } finally { serveur.close(); await pool.end(); }
});
