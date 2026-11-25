'use strict';
/** Chantier B (26 nov. 2026) : blocages en cascade — ambulance → civières → patient en attente → lit NSA → placement ; liens fait / hypothèse. */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');

test('cascade : remonte jusqu’au placement accepté sans départ ; liens qualifiés ; rien n’est modifié', async () => {
  require('./routeur-fictif.cjs').activer();
  const pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  const serveur = await demarrerServeur(creerApp(pool)); const base = `http://127.0.0.1:${serveur.address().port}`;
  try {
    const mb = (await pool.query("SELECT id FROM etablissements WHERE code = 'MB'")).rows[0].id;
    const type = (await pool.query("SELECT id FROM types_unite WHERE code = 'SI'")).rows[0].id;   // SI saturé à MB dans les données de base
    await pool.query("UPDATE lits SET etat = 'occupe', patient_ref = 'P-' || id WHERE etablissement_id = $1 AND type_id = $2 AND etat = 'libre'", [mb, type]);
    const civ = (await pool.query("INSERT INTO civieres (etablissement_id, code) VALUES ($1, 'C-CAS1') RETURNING id, code", [mb])).rows[0];
    await pool.query("UPDATE civieres SET etat = 'occupee', patient_ref = 'P-99950', arrivee_le = now() - interval '2 hours' WHERE etablissement_id = $1 AND actif", [mb]);
    const d = (await pool.query(`INSERT INTO demandes_admission (etablissement_id, patient_ref, type_id, provenance, statut, priorite, civiere_id) VALUES ($1, 'P-99950', $2, 'urgence', 'attente', 'p2', $3) RETURNING id`, [mb, type, civ.id])).rows[0].id;
    const lit = (await pool.query("SELECT id FROM lits WHERE etablissement_id = $1 AND type_id = $2 ORDER BY id LIMIT 1", [mb, type])).rows[0].id;
    await pool.query("INSERT INTO nsa_episodes (etablissement_id, lit_id, patient_ref, debut_le, statut) VALUES ($1, $2, 'P-99951', now() - interval '12 days', 'actif')", [mb, lit]);
    const ch = (await pool.query("SELECT id FROM etablissements WHERE code <> 'MB' ORDER BY id LIMIT 1")).rows[0].id;
    await pool.query(`INSERT INTO demandes_hebergement (etablissement_id, numero, provenance, statut, hopital_id, hopital_lit_id) VALUES ($1, 'DH-CAS1', 'hopital', 'acceptee', $2, $3)`, [ch, mb, lit]);
    const avant = (await pool.query("SELECT md5(string_agg(l::text, '' ORDER BY id)) AS h FROM lits l")).rows[0].h;
    const jeton = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'tremblay@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
    const r = await (await fetch(`${base}/api/coordination/cascade?etablissement_id=${mb}`, { headers: { Authorization: `Bearer ${jeton}` } })).json();
    assert.ok(r.noeuds.some((n) => n.id === `demande:${d}`), JSON.stringify(r).slice(0, 400));
    const racine = r.racines.find((x) => x.racine === 'depart_a_organiser');
    assert.ok(racine, 'racine : placement accepté, départ à organiser'); assert.match(racine.libelle, /DH-CAS1/);
    assert.ok(r.liens.some((l) => l.nature === 'hypothese' && l.vers.startsWith('nsa:')), 'lien NSA = hypothèse (même type)');
    assert.ok(r.liens.some((l) => l.nature === 'fait' && l.vers.startsWith('placement:')));
    assert.match(r.regle, /Aucune corrélation n’est présentée comme une cause démontrée/);
    assert.strictEqual((await pool.query("SELECT md5(string_agg(l::text, '' ORDER BY id)) AS h FROM lits l")).rows[0].h, avant, 'lecture seule');
  } finally { serveur.close(); await pool.end(); }
});
