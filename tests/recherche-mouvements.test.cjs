'use strict';
/**
 * Recherche universelle (26 nov. 2026) : la recherche existante trouve aussi les mouvements — transport, transfert, préalerte —
 * par numéro, référence ou numéro d'ambulance ; actifs et clos ; seulement ceux de l'établissement (isolation).
 * Données fictives seulement.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');

let pool; let serveur; let base; const tok = {}; const ids = {}; const envAvant = process.env.ARRIMO_ENV;
async function appel(qui, c) { const r = await fetch(`${base}/api${c}`, { headers: { Authorization: `Bearer ${tok[qui]}` } }); return { s: r.status, d: await r.json() }; }
async function compte(cle, role, etab) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [`${cle}@demo.arrimo`, `Nom ${cle}`, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etab]);
  tok[cle] = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${cle}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
}
const chercher = async (qui, etab, q) => (await appel(qui, `/recherche-personnes?etablissement_id=${etab}&q=${encodeURIComponent(q)}`)).d.resultats;

test.before(async () => {
  process.env.ARRIMO_ENV = 'demo'; require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const [h, autre] = (await pool.query("SELECT id, config_id, latitude, longitude FROM etablissements WHERE type_etablissement = 'hopital' ORDER BY id LIMIT 2")).rows;
  ids.h = h.id; ids.autre = autre.id;
  ids.c = (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, module_actif, type_etablissement)
    VALUES ('CH-R', 'CHSLD recherche', 'Ville', $1, $2, $3, true, 'chsld') RETURNING id`, [h.latitude + 0.01, h.longitude, h.config_id])).rows[0].id;
  const org = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('AMB-R', 'Ambulances recherche', 'ambulancier', '{ambulance}', $1) RETURNING id", [h.config_id])).rows[0].id;
  const un = (await pool.query("INSERT INTO unites_secours (organisation_id, numero, plaque) VALUES ($1, 'SIM-01', 'REC 001') RETURNING id", [org])).rows[0].id;
  // Transport CHSLD → hôpital (en route) et transport clos ; brouillon privé de l'hôpital vers l'autre hôpital
  await pool.query(`INSERT INTO demandes_transport (numero, organisation_id, origine_id, destination_id, resident_ref, statut, heure_souhaitee, unite_id)
    VALUES ('DT-000019', $1, $2, $3, 'P-16633', 'en_route', now(), $4), ('DT-000020', $1, $2, $3, 'P-16634', 'annulee', now(), NULL),
           ('DT-000021', $1, $3, $5, 'P-16635', 'a_valider', now(), NULL)`, [org, ids.c, ids.h, un, ids.autre]);
  // Transfert interhospitalier déjà présent dans les données fictives (seed), s'il y en a un
  ids.transfert = (await pool.query('SELECT numero, origine_id, destination_id FROM transferts ORDER BY id LIMIT 1')).rows[0];
  await compte('hop', 'coordonnateur', ids.h); await compte('autre', 'coordonnateur', ids.autre); await compte('ch', 'coordonnateur', ids.c);
});
test.after(async () => { serveur?.close(); await pool?.end(); if (envAvant === undefined) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = envAvant; });

test('Par numéro de transport, référence du patient ou numéro d’ambulance ; actifs et clos', async () => {
  for (const q of ['DT-000019', 'dt-0000', 'P-16633', 'SIM-01']) {
    const r = await chercher('hop', ids.h, q);
    assert.ok(r.some((x) => x.type === 'transport' && x.reference === 'DT-000019' && x.onglet === 'flux'), `« ${q} » trouve DT-000019 : ${JSON.stringify(r)}`);
  }
  const clos = (await chercher('hop', ids.h, 'DT-000020')).find((x) => x.reference === 'DT-000020');
  assert.ok(clos && clos.clos, 'transport clos retrouvé dans l’historique');
  const ch = await chercher('ch', ids.c, 'DT-000019');
  assert.ok(ch.some((x) => x.reference === 'DT-000019' && x.onglet === 'c-mouvements'), 'le CHSLD d’origine le trouve aussi');
});

test('Isolation : rien d’un autre établissement ; un brouillon privé reste invisible pour la destination', async () => {
  assert.ok(!(await chercher('autre', ids.autre, 'DT-000019')).length, 'autre hôpital : aucun résultat');
  assert.strictEqual((await appel('autre', `/recherche-personnes?etablissement_id=${ids.h}&q=DT-000019`)).s, 403, 'pas de recherche dans un établissement non rattaché');
  assert.ok(!(await chercher('autre', ids.autre, 'DT-000021')).some((x) => x.reference === 'DT-000021'), 'brouillon privé de l’origine invisible pour la destination');
  assert.ok((await chercher('hop', ids.h, 'DT-000021')).some((x) => x.reference === 'DT-000021'), 'visible pour l’origine');
});

test('Transfert interhospitalier retrouvé par son numéro, par l’origine et la destination seulement', async (t) => {
  const tr = ids.transfert; if (!tr) return t.skip('aucun transfert dans les données fictives');
  await compte('orig', 'coordonnateur', tr.origine_id); await compte('dest', 'coordonnateur', tr.destination_id);
  assert.ok((await chercher('orig', tr.origine_id, tr.numero)).some((x) => x.type === 'transfert' && x.onglet === 'transferts'), 'origine');
  assert.ok((await chercher('dest', tr.destination_id, tr.numero)).some((x) => x.type === 'transfert'), 'destination');
  const tiers = (await pool.query('SELECT id FROM etablissements WHERE type_etablissement = \'hopital\' AND id NOT IN ($1, $2) LIMIT 1', [tr.origine_id, tr.destination_id])).rows[0];
  if (tiers) { await compte('tiers', 'coordonnateur', tiers.id); assert.ok(!(await chercher('tiers', tiers.id, tr.numero)).some((x) => x.type === 'transfert'), 'établissement tiers : rien'); }
});

test('OG : « Retrouve le transport DT-000019 », « dernière mission de SIM-01 » : résultats réels, écran à ouvrir, mêmes permissions', async () => {
  const og = async (qui, etab, question) => (await (await fetch(`${base}/api/copilote/question`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok[qui]}` }, body: JSON.stringify({ etablissement_id: etab, question }) })).json());
  let r = await og('hop', ids.h, 'Retrouve le transport DT-000019');
  // L'OG central (existant, sourcé) répond en premier sur un transport connu ; sinon la recherche universelle
  assert.match(r.reponse, /DT-000019/, r.reponse); assert.ok(r.ouvrir, 'écran à ouvrir');
  r = await og('hop', ids.h, 'Montre-moi la dernière mission de SIM-01');
  assert.match(r.reponse, /DT-000019/, r.reponse);
  r = await og('autre', ids.autre, 'Retrouve le transport DT-000019');
  assert.match(r.reponse, /Rien trouvé|Je ne trouve pas/, 'autre établissement : rien'); assert.ok(!/DT-000019 \(/.test(r.reponse), 'aucun détail');
});
