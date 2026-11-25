'use strict';
/** Refonte unifiée (26 nov. 2026) : Impact et rentabilité — 5 piliers, mesuré / estimé / constaté, paramètres, export, droits. */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');

test('impact : sans paramètre, aucune valeur financière ; avec paramètre, estimation ; économies constatées à part ; export journalisé', async () => {
  require('./routeur-fictif.cjs').activer();
  const pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  const serveur = await demarrerServeur(creerApp(pool)); const base = `http://127.0.0.1:${serveur.address().port}`;
  try {
    const sl = (await pool.query("SELECT id FROM etablissements WHERE code = 'SL'")).rows[0].id;
    const u = (await pool.query("INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ('admin.impact@demo.arrimo', 'Admin impact', $1, 'admin_etab') RETURNING id", [hacher(MOT_DE_PASSE_DEMO)])).rows[0].id;
    await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, sl]);
    const jt = async (e) => (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
    const ja = await jt('admin.impact@demo.arrimo'); const jb = await jt('bouchard@demo.arrimo'); const jm = await jt('tremblay@demo.arrimo');
    const req = async (j, m, c, b) => { const r = await fetch(`${base}/api${c}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${j}` }, body: b ? JSON.stringify(b) : undefined }); return { statut: r.status, corps: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };
    // Épisodes NSA fictifs : référence plus longue que la période courante → journées évitées estimées
    const lits = (await pool.query("SELECT id FROM lits WHERE etablissement_id = $1 ORDER BY id LIMIT 4", [sl])).rows.map((x) => x.id);
    const ep = (l, debut, fin) => pool.query(`INSERT INTO nsa_episodes (etablissement_id, lit_id, patient_ref, debut_le, fin_le, statut) VALUES ($1, $2, 'P-99800', now() - make_interval(days => $3), now() - make_interval(days => $4), 'parti')`, [sl, l, debut, fin]);
    await ep(lits[0], 55, 40); await ep(lits[1], 50, 35); await ep(lits[2], 15, 10); await ep(lits[3], 12, 5);
    let t = (await req(jb, 'GET', `/impact?etablissement_id=${sl}`)).corps;
    assert.ok(['temps', 'argent', 'coordination', 'gestion', 'information'].every((k) => t.piliers[k]));
    assert.strictEqual(t.piliers.temps.journees_nsa_evitees.nature, 'estimation'); assert.strictEqual(t.piliers.temps.journees_nsa_evitees.valeur, 18);
    assert.strictEqual(t.piliers.argent.valeur_journees_nsa.valeur, null, 'sans paramètre : non calculée, jamais 0');
    assert.strictEqual(t.piliers.temps.heures_ambulancieres_recuperees.valeur, null, 'Chrono absent : non mesurable');
    assert.strictEqual((await req(jb, 'PUT', '/impact/parametres', { etablissement_id: sl, cle: 'cout_journee_hospitalisation', valeur: 1000, devise: 'CAD', source: 'x y' })).statut, 403, 'coordination : lecture seulement');
    assert.strictEqual((await req(ja, 'PUT', '/impact/parametres', { etablissement_id: sl, cle: 'cout_journee_hospitalisation', valeur: 1000, devise: 'XOF', source: 'Budget fictif 2026' })).statut, 200);
    t = (await req(ja, 'GET', `/impact?etablissement_id=${sl}`)).corps;
    assert.strictEqual(t.piliers.argent.valeur_journees_nsa.valeur, 18000); assert.strictEqual(t.piliers.argent.valeur_journees_nsa.nature, 'estimation'); assert.strictEqual(t.devise, 'XOF', 'devise libre (pays)');
    assert.deepStrictEqual(t.piliers.argent.economies_constatees.lignes, []);
    assert.strictEqual((await req(ja, 'POST', '/impact/economies', { etablissement_id: sl, categorie: 'journees_nsa', montant: 5000, devise: 'XOF', justificatif: 'x', periode_debut: '2026-11-01', periode_fin: '2026-11-20' })).statut, 400, 'justificatif obligatoire');
    assert.strictEqual((await req(ja, 'POST', '/impact/economies', { etablissement_id: sl, categorie: 'journees_nsa', montant: 5000, devise: 'XOF', justificatif: 'Rapport financier fictif nov. 2026', periode_debut: '2026-11-01', periode_fin: '2026-11-20' })).statut, 200);
    t = (await req(ja, 'GET', `/impact?etablissement_id=${sl}`)).corps;
    assert.deepStrictEqual(t.piliers.argent.economies_constatees.lignes, [{ categorie: 'journees_nsa', devise: 'XOF', montant: 5000 }]);
    await assert.rejects(pool.query('UPDATE economies_constatees SET montant = 1'));
    const csv = await req(ja, 'GET', `/impact.csv?etablissement_id=${sl}`);
    assert.match(csv.corps, /pilier;indicateur;valeur;unite;nature;source/); assert.match(csv.corps, /economie_constatee_journees_nsa;5000;XOF;constate/);
    assert.ok((await pool.query("SELECT 1 FROM journal_admin WHERE action = 'Export Impact et rentabilité'")).rowCount);
    assert.strictEqual((await req(jm, 'GET', `/impact?etablissement_id=${sl}`)).statut, 403, 'autre établissement');
  } finally { serveur.close(); await pool.end(); }
});
