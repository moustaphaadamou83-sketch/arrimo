'use strict';
/** Chantier B (26 nov. 2026) : prévisions étendues 4/6/12/24/48 h sur demande ; le défaut reste 4/12/24 ; marges croissantes. */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');

test('prévisions : horizons étendus sur demande, défaut inchangé', async () => {
  require('./routeur-fictif.cjs').activer();
  const pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  const serveur = await demarrerServeur(creerApp(pool)); const base = `http://127.0.0.1:${serveur.address().port}`;
  try {
    const mb = (await pool.query("SELECT id FROM etablissements WHERE code = 'MB'")).rows[0].id;
    const jeton = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'tremblay@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
    const get = async (q) => (await fetch(`${base}/api/copilote/previsions?etablissement_id=${mb}${q}`, { headers: { Authorization: `Bearer ${jeton}` } })).json();
    assert.deepStrictEqual((await get('')).horizons, [4, 12, 24]);
    const e = await get('&horizons=etendus');
    assert.deepStrictEqual(e.horizons, [4, 6, 12, 24, 48]);
    for (const u of e.unites) assert.ok(u.horizons[48].arrivees >= u.horizons[6].arrivees, u.type_nom);
  } finally { serveur.close(); await pool.end(); }
});
