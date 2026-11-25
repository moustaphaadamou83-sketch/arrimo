'use strict';
/**
 * Chantier coordination, lot 4 « Mesurer » (26 nov. 2026) : P90 et simultanéité Chrono sur jeux connus, indicateurs de coordination
 * (transferts, transports, placements, suivis d'alertes) sur deux périodes de même durée, écarts observés sans attribution,
 * valeurs manquantes jamais estimées, droits. Données fictives seulement.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const chrono = require('../src/chrono');
const ind = require('../src/coordination-indicateurs');

let pool; let serveur; let base; const tokens = {}; const ids = {};
async function appel(qui, methode, chemin) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { Authorization: `Bearer ${tokens[qui]}` } });
  const texte = await r.text(); let corps = null; try { corps = JSON.parse(texte); } catch { corps = texte; }
  return { statut: r.status, corps };
}

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL);
  await viderBase(pool);
  await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool));
  base = `http://127.0.0.1:${serveur.address().port}`;
  [ids.mb, ids.sl] = (await pool.query("SELECT id FROM etablissements WHERE code IN ('MB', 'SL') ORDER BY code")).rows.map((x) => x.id);
  for (const q of ['tremblay', 'bouchard']) {
    const r = await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${q}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO }) });
    tokens[q] = (await r.json()).token;
  }
  ids.type = (await pool.query('SELECT id FROM types_unite ORDER BY id LIMIT 1')).rows[0].id;
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('P90 et simultanéité : calculs exacts sur jeux connus, rien d’estimé', () => {
  assert.strictEqual(chrono.percentile([], 0.9), null);
  assert.strictEqual(chrono.percentile([10], 0.9), 10);
  assert.strictEqual(chrono.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9.1);
  const h = (min) => ({ heure: new Date(Date.UTC(2026, 10, 1, 8, min)).toISOString() });
  const rows = [
    { statut: 'termine', heures: { H11: h(0), H14: h(30) } }, { statut: 'termine', heures: { H11: h(10), H14: h(20) } },
    { statut: 'termine', heures: { H11: h(15), H14: h(40) } }, { statut: 'termine', heures: { H11: h(35), H14: h(50) } },
    { statut: 'termine', heures: { H11: h(60) } },   // remise manquante sur un passage terminé : ignoré, jamais inventé
  ];
  assert.strictEqual(chrono.simultanesMax(rows), 3);
  assert.strictEqual(chrono.simultanesMax([]), 0);
});

test('périodes : par défaut 30 jours et la période précédente de même durée ; paramètres invalides refusés', () => {
  const p = ind.periodes({ debut: '2026-10-01T00:00:00Z', fin: '2026-10-11T00:00:00Z' });
  assert.strictEqual(p.reference.debut.toISOString(), '2026-09-21T00:00:00.000Z'); assert.strictEqual(p.reference.fin.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.throws(() => ind.periodes({ debut: '2026-10-11', fin: '2026-10-01' }));
  assert.throws(() => ind.periodes({ debut: 'hier' }));
  assert.deepStrictEqual(ind.ecarts({ a: { x: 5, y: null } }, { a: { x: 3, y: 2 } }), { a: { x: 2, y: null } });
});

test('indicateurs : transferts, transports et suivis mesurés sur deux périodes ; écarts observés ; non attribués à Arrimo', async () => {
  const tr = (n, statut, jours, reponseMin) => pool.query(`INSERT INTO transferts (numero, patient_ref, origine_id, destination_id, type_id, statut, date_demande, date_validation)
    VALUES ($1, 'P-93001', $2, $3, $4, $5, $6::timestamptz, $6::timestamptz + make_interval(mins => $7))`, [n, ids.mb, ids.sl, ids.type, statut, jours, reponseMin]);
  await tr('TR-ME1', 'recu', '2025-06-10T10:00:00Z', 20); await tr('TR-ME2', 'recu', '2025-06-12T10:00:00Z', 40); await tr('TR-ME3', 'validee', '2025-06-20T10:00:00Z', 60);   // période courante
  await tr('TR-ME4', 'recu', '2025-05-20T10:00:00Z', 90);                                                                             // période de référence
  await pool.query(`INSERT INTO suivis_alertes (etablissement_id, cle, type, niveau, titre, statut, responsable_role, echeance, cree_le, accuse_le, resolue_le)
    VALUES ($1, 'test:me:1', 'test', 'faible', 'Essai', 'resolue', 'coordonnateur', now(), '2025-06-15T08:00:00Z', '2025-06-15T08:06:00Z', '2025-06-15T08:50:00Z')`, [ids.mb]);
  const r = await appel('tremblay', 'GET', `/coordination/indicateurs?etablissement_id=${ids.mb}&debut=2025-06-01T00:00:00Z&fin=2025-07-01T00:00:00Z`);
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  const c = r.corps.courante; const ref = r.corps.reference;
  assert.strictEqual(c.transferts.demandes, 3); assert.strictEqual(c.transferts.recus, 2); assert.strictEqual(c.transferts.taux_realises_pct, 66.7);
  assert.strictEqual(c.transferts.reponse_mediane_min, 40);
  assert.strictEqual(ref.transferts.demandes, 1); assert.strictEqual(ref.transferts.reponse_mediane_min, 90);
  assert.strictEqual(r.corps.ecart.transferts.reponse_mediane_min, -50);
  assert.strictEqual(c.alertes.resolues_confirmees, 1); assert.strictEqual(c.alertes.accuse_mediane_min, 6); assert.strictEqual(c.alertes.resolution_mediane_min, 50);
  assert.strictEqual(c.chrono.porte_mediane_min, null, 'aucun passage : non mesurable, jamais 0');
  assert.strictEqual(r.corps.ecart.chrono.porte_mediane_min, null);
  assert.match(r.corps.avertissement, /ne sont pas attribués à Arrimo/);
});

test('droits : établissement d’autrui refusé', async () => {
  assert.strictEqual((await appel('bouchard', 'GET', `/coordination/indicateurs?etablissement_id=${ids.mb}`)).statut, 403);
});
