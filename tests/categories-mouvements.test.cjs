'use strict';
/**
 * Refonte unifiée (26 nov. 2026) : nomenclature universelle des mouvements.
 * Exemples du cahier directeur (§4.2) ; une ambulance pour un rendez-vous n'est pas un 911 ; même référence = même catégorie chez
 * l'établissement de départ et d'arrivée (Flux) ; légende complète FR/EN avec forme (jamais la couleur seule).
 */
const test = require('node:test');
const assert = require('node:assert');
const cat = require('../src/categories-mouvements');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');

test('exemples du cahier : classification par nature réelle', () => {
  const c = (m) => cat.classer(m).code;
  assert.strictEqual(c({ type: 'prealerte' }), 'secours_911', 'intervention des secours');
  assert.strictEqual(c({ type: 'transport', origine_type: 'chsld', destination_type: 'hopital', urgence: true }), 'secours_911', 'CHSLD → hôpital après un appel d’urgence');
  assert.strictEqual(c({ type: 'transport', origine_type: 'chsld', destination_type: 'hopital' }), 'transport_planifie', 'CHSLD → clinique ou hôpital pour un rendez-vous, même en ambulance');
  assert.strictEqual(c({ type: 'transport', origine_type: 'chsld', destination_type: 'rpa' }), 'interhebergement', 'CHSLD → RPA');
  assert.strictEqual(c({ type: 'transport', origine_type: 'rpa', destination_type: 'rpa' }), 'interhebergement', 'RPA → RPA');
  assert.strictEqual(c({ type: 'transfert' }), 'interhospitalier', 'hôpital → hôpital');
  assert.strictEqual(c({ type: 'transport', origine_type: 'hopital', destination_type: 'chsld', motif_transport: 'depart_nsa' }), 'hopital_hebergement', 'hôpital → CHSLD (NSA)');
  assert.strictEqual(c({ type: 'transport', origine_type: 'hopital', destination_type: 'rpa' }), 'hopital_hebergement', 'hôpital → RPA');
  assert.strictEqual(c({ type: 'transport', origine_type: 'hopital', destination_libre: true, motif_transport: 'retour_domicile' }), 'domicile', 'retour à domicile');
  assert.strictEqual(c({ type: 'hebergement', provenance: 'hopital' }), 'hopital_hebergement');
  assert.strictEqual(c({ type: 'hebergement', provenance: 'autre_chsld' }), 'interhebergement');
  assert.strictEqual(c({ type: 'hebergement', provenance: 'domicile' }), 'domicile');
  assert.strictEqual(cat.classer({ type: 'hebergement', provenance: 'mecanisme_acces' }).certain, false, 'nature incertaine : à confirmer par une personne');
});

test('légende : 7 catégories, libellé FR et EN, forme distincte pour chacune', () => {
  const fr = cat.legende('fr'); const en = cat.legende('en');
  assert.strictEqual(fr.length, 7); assert.strictEqual(new Set(fr.map((x) => x.forme)).size, 7, 'jamais la couleur seule');
  assert.ok(fr.every((x, i) => x.libelle && en[i].libelle && x.libelle !== en[i].libelle && /^#[0-9A-F]{6}$/.test(x.couleur)));
});

test('Flux : même référence, même catégorie au départ et à l’arrivée', async () => {
  require('./routeur-fictif.cjs').activer();
  const pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  const serveur = await demarrerServeur(creerApp(pool)); const base = `http://127.0.0.1:${serveur.address().port}`;
  try {
    const jeton = async (q) => (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${q}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
    const [mb, sl] = (await pool.query("SELECT id FROM etablissements WHERE code IN ('MB', 'SL') ORDER BY code")).rows.map((x) => x.id);
    const type = (await pool.query('SELECT id FROM types_unite ORDER BY id LIMIT 1')).rows[0].id;
    await pool.query(`INSERT INTO transferts (numero, patient_ref, origine_id, destination_id, type_id, statut) VALUES ('TR-CAT1', 'P-99101', $1, $2, $3, 'demande')`, [mb, sl, type]);
    const flux = async (q, e) => (await (await fetch(`${base}/api/arrimo-flux?etablissement_id=${e}`, { headers: { Authorization: `Bearer ${await jeton(q)}` } })).json());
    const a = (await flux('tremblay', mb)).mouvements.find((l) => l.reference === 'TR-CAT1');
    const b = (await flux('bouchard', sl)).mouvements.find((l) => l.reference === 'TR-CAT1');
    assert.ok(a && b, 'visible des deux côtés');
    assert.strictEqual(a.mouvement, 'depart'); assert.strictEqual(b.mouvement, 'arrivee');
    assert.deepStrictEqual(a.categorie, b.categorie); assert.strictEqual(a.categorie.code, 'interhospitalier');
    // Indice de préparation (arrivée, côté receveur) : acceptation manquante tant que le transfert n'est pas accepté, jamais « prêt »
    assert.ok(b.preparation_accueil); assert.strictEqual(b.preparation_accueil.pret, false); assert.ok(b.preparation_accueil.manquantes.includes('acceptation'));
    assert.strictEqual(a.preparation_accueil, undefined, 'pas d’indice pour un départ');
    const leg = await (await fetch(`${base}/api/mouvements/categories`, { headers: { Authorization: `Bearer ${await jeton('tremblay')}` } })).json();
    assert.strictEqual(leg.length, 7);
  } finally { serveur.close(); await pool.end(); }
});

test('file virtuelle des arrivées : tranches, priorité clinique d’abord, capacité confirmée seulement', async () => {
  require('./routeur-fictif.cjs').activer();
  const pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  const serveur = await demarrerServeur(creerApp(pool)); const base = `http://127.0.0.1:${serveur.address().port}`;
  try {
    const mb = (await pool.query("SELECT id, config_id FROM etablissements WHERE code = 'MB'")).rows[0];
    const org = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('AMB-FI', 'AMB-FI', 'ambulancier', ARRAY['ambulance'], $1) RETURNING id", [mb.config_id])).rows[0].id;
    for (const [n, prio, min] of [['PA-FI1', 'non_urgente', 8], ['PA-FI2', 'immediate', 9], ['PA-FI3', 'urgente', 50]]) {
      const un = (await pool.query("INSERT INTO unites_secours (organisation_id, numero) VALUES ($1, $2) RETURNING id", [org, `5${n.slice(-1)}-01`])).rows[0].id;
      await pool.query(`INSERT INTO prealertes (numero, organisation_id, unite_id, destination_id, priorite, categorie, heure_prevue) VALUES ($1, $2, $3, $4, $5, 'medicale', now() + make_interval(mins => $6))`, [n, org, un, mb.id, prio, min]);
    }
    const jeton = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'tremblay@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
    const r = await (await fetch(`${base}/api/arrivees/file?etablissement_id=${mb.id}`, { headers: { Authorization: `Bearer ${jeton}` } })).json();
    const t10 = r.tranches.find((t) => t.jusqu_a_min === 10).arrivees.map((a) => a.reference);
    assert.deepStrictEqual(t10, ['PA-FI2', 'PA-FI1'], 'priorité immédiate avant l’heure');
    assert.ok(r.tranches.find((t) => t.jusqu_a_min === 60).arrivees.some((a) => a.reference === 'PA-FI3'));
    assert.ok(Number.isInteger(r.capacite_confirmee.civieres_libres)); assert.strictEqual(r.horizons.length, 4);
    assert.match(r.regle, /seulement la capacité confirmée/);
  } finally { serveur.close(); await pool.end(); }
});
