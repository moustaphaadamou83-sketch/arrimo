'use strict';
/**
 * Complémentaire nº 3 (26 nov. 2026) : relève entre équipes (§6) et visites suspendues pendant une évacuation réelle (§4).
 * Relève : contenu limité aux numéros et compteurs, transmission journalisée, accusée par une autre personne, idempotente, isolée.
 * Visites : arrivée refusée et horaire marqué « suspendue » pendant une évacuation réelle ; une simulation ne suspend rien.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');

let pool; let serveur; let base; const tokens = {}; const ids = {};
async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[qui]}` }, body: corps ? JSON.stringify(corps) : undefined });
  const t = await r.text(); let c = null; try { c = JSON.parse(t); } catch { c = t; }
  return { statut: r.status, corps: c };
}
async function compte(nom, role, { etab, org } = {}) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $1, $2, $3) RETURNING id', [`${nom}@demo.arrimo`, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (etab) await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etab]);
  if (org) await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, org]);
  const r = await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${nom}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO }) });
  tokens[nom] = (await r.json()).token; return u;
}
const dans = (min) => new Date(Date.now() + min * 60000).toISOString();

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const mb = (await pool.query("SELECT id, latitude, longitude, config_id FROM etablissements WHERE code = 'MB'")).rows[0]; ids.mb = mb.id;
  ids.rpa = (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, module_actif, type_etablissement, type_local_code, modules)
    VALUES ('RPA-RV', 'RPA fictive relève', 'Ville', $1, $2, $3, true, 'chsld', 'rpa', '{"visites_confirmees": true}') RETURNING id`, [mb.latitude, mb.longitude, mb.config_id])).rows[0].id;
  ids.res = (await pool.query("INSERT INTO residents (etablissement_id, reference, prenom, nom, date_naissance, statut) VALUES ($1, 'R-78001', 'Rose', 'Fictive', '1938-02-02', 'present') RETURNING id", [ids.rpa])).rows[0].id;
  ids.clsc = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('CLSC-RV', 'CLSC-RV', 'prestataire', '{visites}', $1) RETURNING id", [mb.config_id])).rows[0].id;
  ids.coord = await compte('coord.rv', 'coordonnateur', { etab: ids.rpa }); await compte('interv.rv', 'intervenant', { org: ids.clsc });
  ids.jour = await compte('jour.mb', 'coordonnateur', { etab: ids.mb }); await compte('soir.mb', 'coordonnateur', { etab: ids.mb });
  await compte('autre.sl', 'coordonnateur', { etab: (await pool.query("SELECT id FROM etablissements WHERE code = 'SL'")).rows[0].id });
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('relève : contenu sans donnée libre, transmise puis accusée par une autre personne ; isolée', async () => {
  await pool.query(`INSERT INTO taches_etab (etablissement_id, type, titre, assigne_role, echeance) VALUES ($1, 'administratif', 'Dossier P-78002 à compléter', 'coordonnateur', now() - interval '1 hour')`, [ids.mb]);
  const apercu = (await appel('jour.mb', 'GET', `/taches/releve?etablissement_id=${ids.mb}`)).corps;
  assert.ok(apercu.maintenant.compteurs.taches >= 1); assert.ok(apercu.maintenant.compteurs.en_retard >= 1);
  assert.ok(!JSON.stringify(apercu.maintenant).includes('P-78002'), 'aucun titre libre ni référence dans la relève');
  assert.strictEqual((await appel('jour.mb', 'POST', '/taches/releve', { etablissement_id: ids.mb, quart: 'matin' })).statut, 400);
  const r = await appel('jour.mb', 'POST', '/taches/releve', { etablissement_id: ids.mb, quart: 'jour' });
  assert.strictEqual(r.statut, 200); ids.releve = r.corps.id;
  assert.strictEqual((await appel('jour.mb', 'POST', `/taches/releve/${ids.releve}/accuser`)).corps.code, 'releve_meme_personne');
  assert.strictEqual((await appel('autre.sl', 'POST', `/taches/releve/${ids.releve}/accuser`)).statut, 403, 'autre établissement');
  const a = await appel('soir.mb', 'POST', `/taches/releve/${ids.releve}/accuser`);
  assert.strictEqual(a.statut, 200); assert.ok(a.corps.accuse_le);
  assert.strictEqual((await appel('soir.mb', 'POST', `/taches/releve/${ids.releve}/accuser`)).corps.deja, true);
  const d = (await appel('soir.mb', 'GET', `/taches/releve?etablissement_id=${ids.mb}`)).corps.derniere;
  assert.strictEqual(d.quart, 'jour'); assert.strictEqual(d.accuse_par_nom, 'soir.mb@demo.arrimo');
  const j = (await pool.query("SELECT action FROM journal WHERE etablissement_id = $1 AND action LIKE 'Relève%' ORDER BY id", [ids.mb])).rows.map((x) => x.action);
  assert.deepStrictEqual(j, ['Relève transmise', 'Relève accusée']);
});

test('visites : suspendues pendant une évacuation réelle ; une simulation ne suspend rien', async () => {
  const v = (await appel('coord.rv', 'POST', '/visites', { etablissement_id: ids.rpa, resident_id: ids.res, prestataire_id: ids.clsc, type_visite: 'aide_hygiene', debut_prevu: dans(-5), fin_prevue: dans(40) })).corps[0];
  const sim = (await pool.query("INSERT INTO evacuations (numero, etablissement_id, motif, declencheur_role, simulation) VALUES ('SIM-RV1', $1, 'incendie', 'admin_etab', true) RETURNING id", [ids.rpa])).rows[0].id;
  assert.strictEqual((await appel('interv.rv', 'GET', '/visites?jours=1')).corps.find((x) => x.id === v.id).suspendue_crise, false, 'simulation : rien de suspendu');
  await pool.query("UPDATE evacuations SET statut = 'levee', levee_le = now() WHERE id = $1", [sim]);
  const ev = (await pool.query("INSERT INTO evacuations (numero, etablissement_id, motif, declencheur_role) VALUES ('EV-RV1', $1, 'incendie', 'admin_etab') RETURNING id", [ids.rpa])).rows[0].id;
  assert.strictEqual((await appel('interv.rv', 'GET', '/visites?jours=1')).corps.find((x) => x.id === v.id).suspendue_crise, true);
  const r = await appel('interv.rv', 'POST', `/visites/${v.id}/pointer`, { etape: 'arrivee' });
  assert.strictEqual(r.statut, 409); assert.strictEqual(r.corps.code, 'visites_suspendues_crise');
  await pool.query("UPDATE evacuations SET statut = 'levee', levee_le = now() WHERE id = $1", [ev]);
  assert.strictEqual((await appel('interv.rv', 'POST', `/visites/${v.id}/pointer`, { etape: 'arrivee' })).statut, 200, 'reprise après la levée');
});
