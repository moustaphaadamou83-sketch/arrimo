'use strict';
/**
 * Garantie de continuité (20 nov. 2026) : l'archive contient les tables de l'établissement et aucune donnée d'un autre ; aucun secret
 * (recherche de motifs) ; JSON et CSV relisibles ; dictionnaire des données ; route protégée par la clé SH et journalisée ;
 * dossier d'entiercement vérifié.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed } = require('../db/seed');
const { lire } = require('../src/zip');

let pool; let serveur; let base; const ids = {};
test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  process.env.SH_API_KEY = `test-export-${Date.now()}-0123456789`;
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  ids.mb = (await pool.query("SELECT id FROM etablissements WHERE code = 'MB'")).rows[0].id;
  ids.sl = (await pool.query("SELECT id FROM etablissements WHERE code = 'SL'")).rows[0].id;
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('archive : tables de l’établissement seulement, aucun secret, JSON et CSV relisibles, dictionnaire', async () => {
  assert.strictEqual((await fetch(`${base}/api/sh/etablissements/MB/export`)).status, 401, 'clé SH exigée');
  const r = await fetch(`${base}/api/sh/etablissements/MB/export`, { headers: { 'X-SH-Key': process.env.SH_API_KEY } });
  assert.strictEqual(r.status, 200);
  const d = await r.json();
  const octets = Buffer.from(d.base64, 'base64');
  assert.strictEqual(require('crypto').createHash('sha256').update(octets).digest('hex'), d.sha256);
  const f = lire(octets);
  const json = JSON.parse(f['donnees.json'].toString('utf8'));
  for (const t of ['etablissements', 'lits', 'unites', 'chambres', 'journal', 'utilisateurs']) assert.ok(json.tables[t]?.length, `table ${t}`);
  assert.deepStrictEqual(json.tables.etablissements.map((e) => e.id), [ids.mb]);
  assert.ok(json.tables.lits.every((l) => l.etablissement_id === ids.mb), 'aucun lit d’un autre établissement');
  const litsMb = (await pool.query('SELECT count(*)::int n FROM lits WHERE etablissement_id = $1', [ids.mb])).rows[0].n;
  assert.strictEqual(json.tables.lits.length, litsMb, 'tous les lits de l’établissement');
  // CSV : une ligne d'en-tête + une ligne par enregistrement
  const csv = f['csv/lits.csv'].toString('utf8').replace(/^﻿/, '').trim().split('\r\n');
  assert.strictEqual(csv.length, litsMb + 1);
  assert.match(f.LISEZMOI.toString('utf8'), /DICTIONNAIRE DES DONNÉES[\s\S]*lits/);
  // Aucun secret : ni empreinte de mot de passe, ni jeton, ni colonne secrète
  const tout = Object.values(f).map((b) => b.toString('utf8')).join('\n');
  const hashes = (await pool.query('SELECT mot_de_passe_hash FROM utilisateurs')).rows.map((u) => u.mot_de_passe_hash);
  assert.ok(!hashes.some((h) => tout.includes(h)), 'aucune empreinte de mot de passe');
  assert.doesNotMatch(tout, /mot_de_passe|totp_secret|"token"|jeton_empreinte|[0-9a-f]{32}:[0-9a-f]{128}/);
  assert.ok(!Object.keys(json.tables).some((t) => ['sessions', 'connexions_2fa', 'jetons_mdp', 'remises_secrets'].includes(t)));
  assert.ok((await pool.query("SELECT 1 FROM journal_admin WHERE action = 'Export complet des données'")).rowCount, 'journalisé');
});

test('dossier d’entiercement : fichiers présents, variables documentées, aucun .env', () => {
  const r = require('../scripts/verifier-entiercement.cjs').verifier();
  assert.deepStrictEqual(r.erreurs, []); assert.match(r.empreinte_sources, /^[0-9a-f]{64}$/);
});
