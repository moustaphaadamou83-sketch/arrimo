'use strict';
/**
 * Complémentaire nº 3 (26 nov. 2026) : résilience des intégrations (§12) et gouvernance des données (§10).
 * Connecteur : état de santé (sain, silencieux, erreurs, suspendu, révoqué), suspension réversible (503 au partenaire, Arrimo continue,
 * journal d'administration), reprise contrôlée ; Vigilance signale le connecteur suspendu.
 * Incohérences entre modules : lit réservé pour un transfert clos, arrivée confirmée sans passage Chrono ; rien n'est corrigé automatiquement.
 */
process.env.ARRIMO_2FA_ADMIN = '0';   // essai seulement : l'administration sans double authentification (la règle réelle est testée ailleurs)
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');
const { hacherCle } = require('../src/connecteurs');

let pool; let serveur; let base; const tokens = {}; const ids = {}; const CLE = 'arr_test_resilience_0123456789ab';
async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[qui]}` }, body: corps ? JSON.stringify(corps) : undefined });
  const t = await r.text(); let c = null; try { c = JSON.parse(t); } catch { c = t; }
  return { statut: r.status, corps: c };
}
const partenaire = () => fetch(`${base}/api/connecteurs/capacite`, { headers: { 'X-Connecteur-Key': CLE } });
const vigilance = async () => (await appel('admin', 'GET', `/vigilance?etablissement_id=${ids.mb}`)).corps;

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  [ids.mb, ids.sl] = (await pool.query("SELECT id FROM etablissements WHERE code IN ('MB', 'SL') ORDER BY code")).rows.map((x) => x.id);
  ids.c = (await pool.query("INSERT INTO connecteurs (nom, cle_hash, etablissement_id) VALUES ('ADT résilience', $1, $2) RETURNING id", [hacherCle(CLE), ids.mb])).rows[0].id;
  for (const [email, role, etab] of [['admin.res@demo.arrimo', 'admin_etab', ids.mb], ['admin.sl@demo.arrimo', 'admin_etab', ids.sl]]) {
    const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $1, $2, $3) RETURNING id', [email, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
    await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etab]);
    const r = await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, mot_de_passe: MOT_DE_PASSE_DEMO }) });
    tokens[email.split('.')[1].split('@')[0] === 'res' ? 'admin' : 'autre'] = (await r.json()).token;
  }
});
test.after(async () => { serveur?.close(); await pool?.end(); });

const santeDe = async () => (await appel('admin', 'GET', '/admin/connecteurs')).corps.find((x) => x.id === ids.c).sante;

test('état de santé : silencieux, sain, erreurs', async () => {
  assert.strictEqual(await santeDe(), 'silencieux');
  for (let i = 0; i < 5; i += 1) await pool.query("INSERT INTO messages_connecteur (connecteur_id, identifiant, evenement, statut) VALUES ($1, $2, 'A01', 'applique')", [ids.c, `ok-${i}`]);
  assert.strictEqual(await santeDe(), 'sain');
  for (let i = 0; i < 3; i += 1) await pool.query("INSERT INTO messages_connecteur (connecteur_id, identifiant, evenement, statut) VALUES ($1, $2, 'A01', 'rejete')", [ids.c, `ko-${i}`]);
  assert.strictEqual(await santeDe(), 'erreurs');
});

test('suspension réversible : 503 au partenaire, Arrimo continue, journalisée ; reprise contrôlée', async () => {
  assert.strictEqual((await partenaire()).status, 200);
  assert.strictEqual((await appel('autre', 'POST', `/admin/connecteurs/${ids.c}/suspendre`, { motif: 'erreurs_repetees' })).statut, 403, 'un autre établissement');
  assert.strictEqual((await appel('admin', 'POST', `/admin/connecteurs/${ids.c}/suspendre`, { motif: 'texte libre' })).statut, 400);
  assert.strictEqual((await appel('admin', 'POST', `/admin/connecteurs/${ids.c}/suspendre`, { motif: 'erreurs_repetees' })).statut, 200);
  const r = await partenaire();
  assert.strictEqual(r.status, 503); assert.strictEqual((await r.json()).code, 'connecteur_suspendu');
  assert.strictEqual(await santeDe(), 'suspendu');
  assert.strictEqual((await appel('admin', 'GET', `/lits?etablissement_id=${ids.mb}`)).statut, 200, 'Arrimo continue');
  const a = (await vigilance()).alertes.find((x) => x.type === 'connecteur_silencieux' && x.ressource === 'ADT résilience');
  assert.match(a.titre, /suspendu : les données qu’il alimente ne sont plus actualisées/);
  const j = (await pool.query("SELECT action FROM journal_admin WHERE cible = 'ADT résilience' ORDER BY id")).rows.map((x) => x.action);
  assert.ok(j.includes('Connecteur suspendu'));
  assert.strictEqual((await appel('admin', 'POST', `/admin/connecteurs/${ids.c}/reprendre`, {})).statut, 200);
  assert.strictEqual((await partenaire()).status, 200, 'reprise');
  assert.notStrictEqual(await santeDe(), 'suspendu');
});

test('incohérences entre modules : signalées sans correction automatique', async () => {
  const type = (await pool.query('SELECT id FROM types_unite ORDER BY id LIMIT 1')).rows[0].id;
  const lit = (await pool.query("SELECT id, code FROM lits WHERE etablissement_id = $1 AND etat = 'libre' ORDER BY id LIMIT 1", [ids.mb])).rows[0];
  const t = (await pool.query(`INSERT INTO transferts (numero, patient_ref, origine_id, destination_id, type_id, statut, lit_id) VALUES ('TR-INC1', 'P-96001', $1, $2, $3, 'refuse', $4) RETURNING id`, [ids.sl, ids.mb, type, lit.id])).rows[0].id;
  await pool.query("UPDATE lits SET etat = 'reserve', transfert_id = $2, patient_ref = 'P-96001' WHERE id = $1", [lit.id, t]);
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"chrono": true, "liaison_secours": true}' WHERE id = $1`, [ids.mb]);
  const org = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) SELECT 'AMB-INC', 'AMB-INC', 'ambulancier', ARRAY['ambulance'], config_id FROM etablissements WHERE id = $1 RETURNING id", [ids.mb])).rows[0].id;
  const u = (await pool.query("INSERT INTO unites_secours (organisation_id, numero) VALUES ($1, '97-01') RETURNING id", [org])).rows[0].id;
  await pool.query(`INSERT INTO prealertes (numero, organisation_id, unite_id, destination_id, statut, priorite, categorie, arrivee_confirmee_le) VALUES ('PA-INC1', $1, $2, $3, 'arrivee', 'urgente', 'medicale', now() - interval '45 minutes')`, [org, u, ids.mb]);
  const v = await vigilance();
  const inc = v.alertes.filter((a) => a.type === 'incoherence');
  assert.ok(inc.some((a) => a.titre === `Lit ${lit.code} encore réservé pour le transfert TR-INC1, déjà clos (refuse).`), JSON.stringify(inc.map((a) => a.titre)));
  assert.ok(inc.some((a) => a.titre === 'Préalerte PA-INC1 : arrivée confirmée sans passage Chrono correspondant.'));
  assert.ok(inc.every((a) => a.cause.nature === 'fait' && /correction tracée/.test(a.action)));
  assert.strictEqual((await pool.query('SELECT etat FROM lits WHERE id = $1', [lit.id])).rows[0].etat, 'reserve', 'rien n’est corrigé automatiquement');
  const en = (await appel('admin', 'GET', `/vigilance?etablissement_id=${ids.mb}&langue=en`)).corps.alertes.filter((a) => a.type === 'incoherence');
  assert.ok(en.some((a) => a.titre === 'Pre-alert PA-INC1: arrival confirmed with no matching Chrono visit.'));
});
