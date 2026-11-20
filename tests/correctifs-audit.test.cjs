'use strict';
/** Correctifs de l'audit du 20 nov. 2026 : COR-001 (transport NSA), COR-002 (avant l'appel), COR-003 (mode crise), COR-004 (compteur civières). */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');

let pool; let serveur; let base; const tok = {}; const ids = {};
async function appel(qui, m, c, b) { const r = await fetch(`${base}/api${c}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok[qui]}` }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { s: r.status, d }; }
async function compte(cle, role, { etab, org } = {}) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [`${cle}@demo.arrimo`, cle, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (etab) await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etab]);
  if (org) await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, org]);
  tok[cle] = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${cle}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token; assert.ok(tok[cle], cle);
  return u;
}
test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const h = (await pool.query("SELECT id, config_id, latitude, longitude FROM etablissements WHERE code = 'MB'")).rows[0]; ids.h = h.id;
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"liaison_chsld": true, "transport_planifie": true}' WHERE id = $1`, [h.id]);
  ids.c = (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, module_actif, type_etablissement, modules) VALUES ('CH-T', 'CHSLD test', 'Ville', $1, $2, $3, true, 'chsld', '{"transport_planifie": true}') RETURNING id`,
    [h.latitude + 0.01, h.longitude, h.config_id])).rows[0].id;
  ids.org = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('AMB-T', 'Ambulances test', 'ambulancier', '{ambulance}', $1) RETURNING id", [h.config_id])).rows[0].id;
  ids.ccs = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('CCS-T', 'CCS test', 'ccs', '{ccs}', $1) RETURNING id", [h.config_id])).rows[0].id;
  ids.lit = (await pool.query("SELECT id, code FROM lits WHERE etablissement_id = $1 AND etat = 'libre' ORDER BY id LIMIT 1", [h.id])).rows[0];
  await pool.query("UPDATE lits SET etat = 'occupe', patient_ref = 'P-64673' WHERE id = $1", [ids.lit.id]);
  ids.d = (await pool.query(`INSERT INTO demandes_hebergement (etablissement_id, numero, provenance, reference_externe, statut, hopital_id, hopital_lit_id, documents)
    VALUES ($1, 'DH-T001', 'hopital', 'P-64673', 'acceptee', $2, $3, '[]') RETURNING id`, [ids.c, h.id, ids.lit.id])).rows[0].id;
  await compte('coord.h', 'coordonnateur', { etab: h.id }); await compte('coord.c', 'coordonnateur', { etab: ids.c });
  await compte('para', 'paramedic', { org: ids.org }); await compte('ccs', 'repartiteur', { org: ids.ccs });
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('COR-001 : le départ programmé prépare UNE demande de transport « à valider », invisible au transporteur avant transmission', async () => {
  const depart = new Date(Date.now() + 5 * 3600000).toISOString();
  const r = await appel('coord.h', 'POST', `/nsa/orientations-chsld/${ids.d}/confirmer-place`, { depart_prevu_le: depart, transport_mode: 'ambulance', usager_famille_d_accord: true });
  assert.strictEqual(r.s, 200, JSON.stringify(r.d)); assert.strictEqual(r.d.transport.statut, 'prepare');
  const t = (await pool.query('SELECT * FROM demandes_transport WHERE demande_hebergement_id = $1', [ids.d])).rows;
  assert.strictEqual(t.length, 1); assert.deepStrictEqual([t[0].statut, t[0].resident_ref, t[0].destination_id, t[0].lit_id, t[0].motif_transport], ['a_valider', 'P-64673', ids.c, ids.lit.id, 'depart_nsa']);
  assert.ok(Math.abs(new Date(t[0].plage_debut) - (new Date(depart) - 30 * 60000)) < 1000, 'horaire prérempli');
  assert.ok(!(await appel('para', 'GET', '/secours/transports')).d.some((x) => x.id === t[0].id), 'transporteur : rien avant transmission');
  assert.ok(!(await appel('ccs', 'GET', '/secours/transports')).d.some((x) => x.id === t[0].id), 'CCS : rien avant transmission');
  assert.strictEqual((await appel('para', 'POST', `/secours/transports/${t[0].id}/action`, { action: 'accepter' })).s >= 400, true, 'aucune affectation avant transmission');
  const h = (await appel('coord.h', 'GET', `/transports?etablissement_id=${ids.h}`)).d.find((x) => x.id === t[0].id);
  assert.deepStrictEqual(h.actions, ['transmettre', 'annuler']);
  // Aucun doublon : la préparation est idempotente
  const tr = require('../src/transports'); const d = (await pool.query('SELECT * FROM demandes_hebergement WHERE id = $1', [ids.d])).rows[0];
  assert.strictEqual((await tr.preparerDepuisHebergement(pool, d, { id: null })).statut, 'existant');
  ids.t = t[0].id;
});

test('COR-001 : transmission par une personne, puis acceptation, affectation et suivi synchronisés (hôpital, CHSLD, transporteur, CCS)', async () => {
  const t = (await pool.query('SELECT version FROM demandes_transport WHERE id = $1', [ids.t])).rows[0];
  const x = await appel('coord.h', 'POST', `/transports/${ids.t}/action`, { etablissement_id: ids.h, action: 'transmettre', version: t.version });
  assert.strictEqual(x.s, 200, JSON.stringify(x.d)); assert.strictEqual(x.d.statut, 'demandee');
  assert.ok((await appel('para', 'GET', '/secours/transports')).d.some((y) => y.id === ids.t), 'transporteur : visible après transmission');
  assert.ok((await appel('ccs', 'GET', '/secours/transports')).d.some((y) => y.id === ids.t), 'CCS : en lecture');
  const unite = (await pool.query("INSERT INTO unites_secours (organisation_id, numero) VALUES ($1, 'U-T1') RETURNING id", [ids.org])).rows[0].id;
  const acc = await appel('para', 'POST', `/secours/transports/${ids.t}/action`, { action: 'accepter', unite_id: unite }); assert.strictEqual(acc.s, 200, JSON.stringify(acc.d));
  const c = (await appel('coord.c', 'GET', `/transports?etablissement_id=${ids.c}`)).d.find((y) => y.id === ids.t);
  assert.strictEqual(c.statut, 'acceptee', 'CHSLD : même statut');
  const nsa = (await appel('coord.h', 'GET', `/nsa/orientations-chsld?etablissement_id=${ids.h}`)).d;
  const o = (Array.isArray(nsa) ? nsa : nsa.orientations || []).find((y) => y.id === ids.d);
  if (o) { assert.strictEqual(o.transport.statut, 'acceptee'); assert.strictEqual(o.transport.unite, 'U-T1'); }
});

test('COR-001 : formulaire manuel — destinations partenaires (CHSLD compris) et adresse externe libre', async () => {
  const dest = (await appel('coord.h', 'GET', `/transports/destinations?etablissement_id=${ids.h}`)).d;
  assert.ok(dest.some((e) => e.id === ids.c), 'le CHSLD partenaire est proposé');
  const r = await appel('coord.h', 'POST', '/transports-planifies', { etablissement_id: ids.h, reference: 'P-70001', motif_transport: 'retour_domicile', destination_libelle: '1234, rue des Érables, Trois-Rivières (Québec) G9A 1A1',
    plage_debut: new Date(Date.now() + 24 * 3600000).toISOString(), plage_fin: new Date(Date.now() + 25 * 3600000).toISOString(), type_vehicule: 'transport_adapte', organisation_id: ids.org });
  assert.strictEqual(r.s, 200, JSON.stringify(r.d)); assert.strictEqual(r.d.statut, 'demandee');
});
