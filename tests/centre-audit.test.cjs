'use strict';
/** Refonte unifiée (26 nov. 2026) : centre d'audit — recherche unifiée, filtres, refus, export journalisé, droits. */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');

test('centre d’audit : sources unifiées, filtres, export journalisé, réservé à l’administration', async () => {
  require('./routeur-fictif.cjs').activer();
  const pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  const serveur = await demarrerServeur(creerApp(pool)); const base = `http://127.0.0.1:${serveur.address().port}`;
  try {
    const mb = (await pool.query("SELECT id FROM etablissements WHERE code = 'MB'")).rows[0].id;
    const u = (await pool.query("INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ('admin.audit@demo.arrimo', 'Admin audit', $1, 'admin_etab') RETURNING id", [hacher(MOT_DE_PASSE_DEMO)])).rows[0].id;
    await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, mb]);
    await pool.query(`INSERT INTO journal (etablissement_id, utilisateur_id, action, detail, refuse) VALUES ($1, $2, 'Réservation refusée', 'lit MED-201 : version périmée', true)`, [mb, u]);
    await pool.query(`INSERT INTO journal_admin (utilisateur_id, etablissement_id, action, cible) VALUES ($1, $2, 'Connecteur suspendu', 'ADT audit')`, [u, mb]);
    const jeton = async (e) => (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
    const ja = await jeton('admin.audit@demo.arrimo'); const jt = await jeton('tremblay@demo.arrimo');
    const get = async (j, c) => { const r = await fetch(`${base}/api${c}`, { headers: { Authorization: `Bearer ${j}` } }); return { statut: r.status, corps: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };
    assert.strictEqual((await get(jt, `/audit?etablissement_id=${mb}`)).statut, 403, 'coordination : non');
    const tout = (await get(ja, `/audit?etablissement_id=${mb}`)).corps;
    assert.ok(tout.evenements.some((e) => e.source === 'operations' && e.refuse)); assert.ok(tout.evenements.some((e) => e.source === 'administration' && /Connecteur suspendu/.test(e.action)));
    assert.ok(tout.activite.operations.refus >= 1);
    const refus = (await get(ja, `/audit?etablissement_id=${mb}&refus=1`)).corps;
    assert.ok(refus.evenements.length >= 1 && refus.evenements.every((e) => e.refuse));
    const texte = (await get(ja, `/audit?etablissement_id=${mb}&texte=MED-201`)).corps;
    assert.ok(texte.evenements.every((e) => /MED-201/.test(`${e.detail} ${e.reference}`)));
    assert.strictEqual((await get(ja, `/audit?etablissement_id=${mb}&du=hier`)).statut, 400);
    const csv = await get(ja, `/audit.csv?etablissement_id=${mb}`);
    assert.match(csv.corps, /^﻿source;date;utilisateur;action/);
    assert.ok((await pool.query("SELECT 1 FROM journal_admin WHERE action = 'Export du centre d’audit'")).rowCount, 'export journalisé');
  } finally { serveur.close(); await pool.end(); }
});
