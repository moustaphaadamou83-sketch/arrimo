'use strict';
/**
 * Chantier coordination, lot 6 (26 nov. 2026) : scénarios E et F du cahier « optimisation transversale » (§16).
 * E — rupture de couverture selon un seuil de SIMULATION : ouverture, documentation (cause, mesure, responsable), clôture et durée ;
 *     aucun seuil = aucune rupture ; jamais en pilote ni en production ; aucune ambulance mobilisée.
 * F — libération complète d'une capacité : départ → nettoyage → nettoyé (non confirmé) → disponibilité confirmée → réservation → admission,
 *     la capacité réelle et Vigilance suivent chaque étape sans jamais compter un lit non confirmé comme opérationnel.
 * (A, B, C, D, G : tests coordination-detection, quotes-parts, coordination-solutions.) Données fictives seulement.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');
const couverture = require('../src/couverture');

let pool; let serveur; let base; const tokens = {}; const ids = {};
async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[qui]}` }, body: corps ? JSON.stringify(corps) : undefined });
  const texte = await r.text(); let c = null; try { c = JSON.parse(texte); } catch { c = texte; }
  return { statut: r.status, corps: c };
}
async function connecter(q, email) {
  const r = await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, mot_de_passe: MOT_DE_PASSE_DEMO }) });
  assert.strictEqual(r.status, 200, q); tokens[q] = (await r.json()).token;
}

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL);
  await viderBase(pool);
  await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool));
  base = `http://127.0.0.1:${serveur.address().port}`;
  const e = (await pool.query("SELECT id, config_id FROM etablissements WHERE code = 'MB'")).rows[0];
  ids.mb = e.id; ids.config = e.config_id;
  const org = async (code, type, profils) => (await pool.query('INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ($1, $1, $2, $3, $4) RETURNING id', [code, type, profils, ids.config])).rows[0].id;
  ids.amb = await org('AMB-SC', 'ambulancier', ['ambulance']); ids.ccs = await org('CCS-SC', 'ccs', ['ccs']);
  ids.unites = [];
  for (const [n, etat] of [['95-01', 'disponible'], ['95-02', 'a_l_hopital'], ['95-03', 'a_l_hopital']]) {
    const u = (await pool.query('INSERT INTO unites_secours (organisation_id, numero) VALUES ($1, $2) RETURNING id', [ids.amb, n])).rows[0].id;
    await pool.query('INSERT INTO etats_vehicules (unite_id, etat) VALUES ($1, $2)', [u, etat]); ids.unites.push(u);
  }
  const u = (await pool.query("INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ('ccs.sc@demo.arrimo', 'CCS SC', $1, 'repartiteur') RETURNING id", [hacher(MOT_DE_PASSE_DEMO)])).rows[0].id;
  await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, ids.ccs]);
  await connecter('ccs', 'ccs.sc@demo.arrimo'); await connecter('tremblay', 'tremblay@demo.arrimo');
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('E : sans seuil de simulation, aucune rupture n’est calculée', async () => {
  await couverture.controler(pool);
  const t = (await appel('ccs', 'GET', '/secours/couverture')).corps;
  const r = t.regions.find((x) => x.region.id === ids.config);
  assert.strictEqual(r.seuil_simulation, null); assert.strictEqual(r.rupture_en_cours, null);
  assert.strictEqual(r.etat.disponibles >= 1, true); assert.strictEqual(r.etat.immobilisees >= 2, true);
});

test('E : seuil de simulation atteint → rupture ouverte, documentée par le répartiteur, close au retour des unités ; rien n’est mobilisé', async () => {
  const dispo = (await couverture.etatRegion(pool, ids.config)).disponibles;
  await pool.query('UPDATE config_pays SET couverture_seuil_simulation = $2 WHERE id = $1', [ids.config, dispo]);
  try {
    await Promise.all([couverture.controler(pool), couverture.controler(pool)]);
    const ouvertes = (await pool.query('SELECT * FROM ruptures_couverture WHERE config_id = $1 AND fin IS NULL', [ids.config])).rows;
    assert.strictEqual(ouvertes.length, 1, 'une seule rupture ouverte');
    const avant = (await pool.query('SELECT unite_id, etat, version FROM etats_vehicules ORDER BY unite_id')).rows;
    let t = (await appel('ccs', 'GET', '/secours/couverture')).corps.regions.find((x) => x.region.id === ids.config);
    assert.ok(t.rupture_en_cours); assert.strictEqual(t.rupture_en_cours.cause, 'inconnue', 'cause inconnue tant qu’elle n’est pas documentée');
    assert.strictEqual((await appel('ccs', 'POST', `/secours/couverture/${ouvertes[0].id}`, { mesure: 'mobiliser_tout' })).statut, 400);
    const d = await appel('ccs', 'POST', `/secours/couverture/${ouvertes[0].id}`, { cause: 'immobilisations_hospitalieres', mesure: 'renfort_demande' });
    assert.strictEqual(d.statut, 200); assert.ok(d.corps.decide_par); assert.ok(d.corps.decide_le);
    assert.strictEqual((await appel('tremblay', 'GET', '/secours/couverture')).statut, 403, 'un hôpital ne lit pas la couverture du CCS');
    assert.deepStrictEqual((await pool.query('SELECT unite_id, etat, version FROM etats_vehicules ORDER BY unite_id')).rows, avant, 'aucune ambulance mobilisée');
    // Retour des unités : clôture et durée
    await pool.query("UPDATE etats_vehicules SET etat = 'disponible' WHERE unite_id = ANY($1)", [ids.unites]);
    await couverture.controler(pool);
    t = (await appel('ccs', 'GET', '/secours/couverture')).corps.regions.find((x) => x.region.id === ids.config);
    assert.strictEqual(t.rupture_en_cours, null);
    const close = t.historique.find((h) => h.id === Number(ouvertes[0].id));
    assert.ok(close.fin); assert.ok(close.duree_min >= 0); assert.strictEqual(close.mesure, 'renfort_demande');
  } finally { await pool.query('UPDATE config_pays SET couverture_seuil_simulation = NULL WHERE id = $1', [ids.config]); }
});

test('E : jamais en pilote ni en production (seuils de simulation ignorés)', async () => {
  await pool.query("UPDATE etats_vehicules SET etat = 'a_l_hopital' WHERE unite_id = ANY($1)", [ids.unites]);
  await pool.query('UPDATE config_pays SET couverture_seuil_simulation = 50 WHERE id = $1', [ids.config]);
  const avant = process.env.ARRIMO_ENV;
  try {
    process.env.ARRIMO_ENV = 'production';
    assert.deepStrictEqual(await couverture.controler(pool), { ouvertes: 0, closes: 0 });
    assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM ruptures_couverture WHERE config_id = $1 AND fin IS NULL', [ids.config])).rows[0].n, 0);
  } finally {
    if (avant == null) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = avant;
    await pool.query('UPDATE config_pays SET couverture_seuil_simulation = NULL WHERE id = $1', [ids.config]);
  }
});

test('F : libération complète d’une capacité, propagée à la capacité réelle et à Vigilance à chaque étape', async () => {
  const cap = async () => (await appel('tremblay', 'GET', `/vigilance?etablissement_id=${ids.mb}`)).corps;
  const lit = (await pool.query(`SELECT id, version FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' AND nsa_depuis IS NULL AND transfert_id IS NULL ORDER BY id LIMIT 1`, [ids.mb])).rows[0];
  const version = async () => (await pool.query('SELECT version FROM lits WHERE id = $1', [lit.id])).rows[0].version;
  const action = async (a, extra = {}) => { const r = await appel('tremblay', 'POST', `/lits/${lit.id}/action`, { action: a, version: await version(), ...extra }); assert.strictEqual(r.statut, 200, `${a} : ${JSON.stringify(r.corps)}`); };
  const c0 = (await cap()).capacite.lits;
  await action('liberer');
  let v = await cap();
  assert.strictEqual(v.capacite.lits.nettoyage, c0.nettoyage + 1); assert.strictEqual(v.capacite.lits.occupes, c0.occupes - 1);
  assert.strictEqual(v.capacite.lits.operationnels, c0.operationnels, 'un lit au nettoyage n’est pas opérationnel');
  await action('nettoyage_ok');
  v = await cap();
  assert.strictEqual(v.capacite.lits.vides, c0.vides + 1); assert.strictEqual(v.capacite.lits.operationnels, c0.operationnels, 'nettoyé mais non confirmé : non opérationnel');
  assert.ok(v.alertes.some((a) => a.type === 'disponibilite_perimee' && a.ressource_id === lit.id), 'Vigilance demande la confirmation');
  assert.strictEqual((await appel('tremblay', 'POST', `/lits/${lit.id}/confirmer-disponibilite`, {})).statut, 200);
  v = await cap();
  assert.strictEqual(v.capacite.lits.operationnels, c0.operationnels + 1, 'confirmé : opérationnel');
  assert.ok(!v.alertes.some((a) => a.type === 'disponibilite_perimee' && a.ressource_id === lit.id));
  await action('reserver', { patient_ref: 'P-95001' }); await action('admettre');
  v = await cap();
  assert.strictEqual(v.capacite.lits.occupes, c0.occupes); assert.strictEqual(v.capacite.lits.operationnels, c0.operationnels);
  const j = (await pool.query("SELECT nouvel_etat FROM journal WHERE lit_id = $1 AND NOT refuse AND nouvel_etat IS NOT NULL ORDER BY id DESC LIMIT 4", [lit.id])).rows.map((x) => x.nouvel_etat).reverse();
  assert.deepStrictEqual(j, ['nettoyage', 'libre', 'reserve', 'occupe'], 'chaque étape journalisée dans l’ordre');
});
