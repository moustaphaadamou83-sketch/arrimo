'use strict';
/** Refonte unifiée, pilier 4 (26 nov. 2026) : pilotage NSA — taux avec dénominateur, médiane d'attente, parcours par étapes, coordination vs pénurie. */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');

test('pilotage NSA : parcours, placement accepté sans départ compté comme problème de coordination', async () => {
  require('./routeur-fictif.cjs').activer();
  const pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  const serveur = await demarrerServeur(creerApp(pool)); const base = `http://127.0.0.1:${serveur.address().port}`;
  try {
    const sl = (await pool.query("SELECT id FROM etablissements WHERE code = 'SL'")).rows[0].id;
    await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"nsa": true}' WHERE id = $1`, [sl]);
    const lits = (await pool.query("SELECT id FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' ORDER BY id LIMIT 2", [sl])).rows.map((x) => x.id);
    await pool.query('DELETE FROM nsa_episodes WHERE etablissement_id = $1', [sl]).catch(() => {});
    for (const [i, l] of lits.entries()) {
      await pool.query(`INSERT INTO nsa_episodes (etablissement_id, lit_id, patient_ref, debut_le, statut) VALUES ($1, $2, $3, now() - make_interval(days => $4), 'actif')`, [sl, l, `P-9970${i}`, 10 + i * 10]);
    }
    const ch = (await pool.query("SELECT id FROM etablissements WHERE code <> 'SL' ORDER BY id LIMIT 1")).rows[0].id;
    await pool.query(`INSERT INTO demandes_hebergement (etablissement_id, numero, provenance, reference_externe, statut, hopital_id, hopital_lit_id, cree_le, modifie_le)
      VALUES ($1, 'DH-NSA1', 'hopital', 'P-99700', 'acceptee', $2, $3, now() - interval '5 days', now() - interval '3 days')`, [ch, sl, lits[0]]);
    const jeton = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bouchard@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
    const r = await (await fetch(`${base}/api/nsa/indicateurs?etablissement_id=${sl}`, { headers: { Authorization: `Bearer ${jeton}` } })).json();
    const p = r.pilotage;
    assert.ok(p, JSON.stringify(r).slice(0, 300));
    assert.strictEqual(p.denominateur, 'lits occupés de l’établissement'); assert.ok(p.taux_nsa_pct > 0);
    assert.ok(p.attente_mediane_jours >= 10 && p.attente_mediane_jours <= 21);
    assert.strictEqual(p.parcours.acceptee_depart_a_organiser, 1); assert.strictEqual(p.parcours.sans_demande, 1);
    assert.ok(p.diagnostic.coordination >= 1); assert.strictEqual(p.diagnostic.indicatif, true);
  } finally { serveur.close(); await pool.end(); }
});
