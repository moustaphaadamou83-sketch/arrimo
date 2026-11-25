'use strict';
/**
 * Chantier coordination, lot 5 « Quotes-parts » (26 nov. 2026) : saisie par une autorité (répartiteur du CCS de la région ou gestion réseau),
 * historique immuable, « non renseignée » jamais 0, marge jamais calculée, compteurs lus dans Liaison Secours, scénario B
 * (quote-part non atteinte mais aucune civière libre : signalé, aucune destination décidée), refus en pilote et en production.
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
  const texte = await r.text(); let c = null; try { c = JSON.parse(texte); } catch { c = texte; }
  return { statut: r.status, corps: c };
}
async function compte(email, role, orgId) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [email, email, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (orgId) await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, orgId]);
}
async function connecter(q, email) {
  const r = await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, mot_de_passe: MOT_DE_PASSE_DEMO }) });
  assert.strictEqual(r.status, 200, q); tokens[q] = (await r.json()).token;
}
const qpMb = async () => (await appel('ccs', 'GET', '/secours/urgences-classees?capacites_seules=1')).corps.urgences.find((h) => h.id === ids.mb).quote_part;

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL);
  await viderBase(pool);
  await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool));
  base = `http://127.0.0.1:${serveur.address().port}`;
  const e = (await pool.query("SELECT id, config_id FROM etablissements WHERE code IN ('MB', 'SL') ORDER BY code")).rows;
  [ids.mb, ids.sl] = e.map((x) => x.id); ids.config = e[0].config_id;
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"liaison_secours": true}' WHERE id IN ($1, $2)`, [ids.mb, ids.sl]);
  const autre = (await pool.query("INSERT INTO config_pays (code, nom) SELECT 'ZZ-QP', 'Autre région' WHERE NOT EXISTS (SELECT 1 FROM config_pays WHERE code = 'ZZ-QP') RETURNING id")).rows[0]?.id;
  const org = async (code, type, profils, cfg) => (await pool.query('INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ($1, $1, $2, $3, $4) RETURNING id', [code, type, profils, cfg])).rows[0].id;
  ids.ccs = await org('CCS-QP', 'ccs', ['ccs'], ids.config); ids.amb = await org('AMB-QP', 'ambulancier', ['ambulance'], ids.config);
  if (autre) ids.ccsAutre = await org('CCS-QX', 'ccs', ['ccs'], autre);
  ids.u = (await pool.query("INSERT INTO unites_secours (organisation_id, numero) VALUES ($1, '90-01') RETURNING id", [ids.amb])).rows[0].id;
  await compte('ccs.qp@demo.arrimo', 'repartiteur', ids.ccs); await compte('para.qp@demo.arrimo', 'paramedic', ids.amb);
  if (ids.ccsAutre) await compte('ccs.qx@demo.arrimo', 'repartiteur', ids.ccsAutre);
  await connecter('ccs', 'ccs.qp@demo.arrimo'); await connecter('para', 'para.qp@demo.arrimo'); await connecter('tremblay', 'tremblay@demo.arrimo');
  if (ids.ccsAutre) await connecter('ccsAutre', 'ccs.qx@demo.arrimo');
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('sans saisie : « non renseignée » (null), jamais 0', async () => {
  assert.strictEqual(await qpMb(), null);
  const h = await appel('tremblay', 'GET', `/quotes-parts?etablissement_id=${ids.mb}`);
  assert.strictEqual(h.statut, 200); assert.strictEqual(h.corps.applicable, null); assert.deepStrictEqual(h.corps.historique, []);
});

test('saisie : répartiteur de la région seulement ; paramètres validés ; aucune formule de marge', async () => {
  const corps = { etablissement_id: ids.mb, valeur: 4, periode_min: 180, autorite: 'Centre de coordination fictif', fiabilite: 'declaree' };
  assert.strictEqual((await appel('para', 'POST', '/secours/quotes-parts', corps)).statut, 403);
  assert.strictEqual((await appel('tremblay', 'POST', '/quotes-parts', corps)).statut, 403, 'un hôpital ne fixe pas sa quote-part');
  if (ids.ccsAutre) assert.strictEqual((await appel('ccsAutre', 'POST', '/secours/quotes-parts', corps)).statut, 403, 'CCS d’une autre région');
  assert.strictEqual((await appel('ccs', 'POST', '/secours/quotes-parts', { ...corps, periode_min: 5 })).statut, 400);
  assert.strictEqual((await appel('ccs', 'POST', '/secours/quotes-parts', { ...corps, exception: 'libre' })).statut, 400);
  const r = await appel('ccs', 'POST', '/secours/quotes-parts', corps);
  assert.strictEqual(r.statut, 200); assert.strictEqual(r.corps.source, 'saisie_manuelle');
  const q = await qpMb();
  assert.strictEqual(q.valeur, 4); assert.strictEqual(q.periode_min, 180); assert.strictEqual(q.marge, null); assert.strictEqual(q.marge_regle, 'non_definie');
  assert.strictEqual(q.recues, 0); assert.strictEqual(q.attendues, 0);
});

test('historique immuable : une modification = une nouvelle ligne ; la plus récente s’applique', async () => {
  await appel('ccs', 'POST', '/secours/quotes-parts', { etablissement_id: ids.mb, valeur: 3, periode_min: 120, autorite: 'Centre de coordination fictif', fiabilite: 'confirmee_autorite' });
  const h = (await appel('ccs', 'GET', `/secours/quotes-parts?etablissement_id=${ids.mb}`)).corps;
  assert.strictEqual(h.historique.length, 2); assert.strictEqual(h.applicable.valeur, 3); assert.strictEqual(h.applicable.fiabilite, 'confirmee_autorite');
  await assert.rejects(pool.query('UPDATE quotes_parts SET valeur = 99'));
  await assert.rejects(pool.query('DELETE FROM quotes_parts'));
});

test('scénario B : quote-part non atteinte mais aucune civière libre → signalé, aucune destination décidée', async () => {
  await pool.query(`INSERT INTO prealertes (numero, organisation_id, unite_id, destination_id, priorite, categorie) VALUES ('PA-QP1', $1, $2, $3, 'urgente', 'medicale')`, [ids.amb, ids.u, ids.mb]);
  assert.strictEqual((await qpMb()).attendues, 1);
  const etats = (await pool.query("SELECT id, etat FROM civieres WHERE etablissement_id = $1 AND actif AND etat = 'libre'", [ids.mb])).rows;
  await pool.query("UPDATE civieres SET etat = 'indispo' WHERE id = ANY($1)", [etats.map((x) => x.id)]);
  try {
    const v = await appel('tremblay', 'GET', `/vigilance?etablissement_id=${ids.mb}`);
    const a = v.corps.alertes.find((x) => x.type === 'quote_part_contradiction');
    assert.ok(a, 'contradiction signalée');
    assert.strictEqual(a.titre, 'Quote-part non atteinte (0 reçue(s) et 1 attendue(s) sur 3 par 120 min) alors qu’aucune civière n’est libre.');
    assert.match(a.action, /la destination reste décidée par le répartiteur/);
    assert.match(a.seuil.regle, /aucune marge n’est calculée/);
    const pa = (await pool.query("SELECT destination_id, statut FROM prealertes WHERE numero = 'PA-QP1'")).rows[0];
    assert.deepStrictEqual(pa, { destination_id: ids.mb, statut: 'envoyee' }, 'aucune redirection');
    const plan = (await appel('tremblay', 'GET', `/coordination/plan?etablissement_id=${ids.mb}`)).corps;
    assert.ok(plan.fiches.find((f) => f.type === 'quote_part_contradiction').contraintes[0].startsWith('Une quote-part ne remplace ni un critère clinique'));
  } finally {
    for (const c of etats) await pool.query('UPDATE civieres SET etat = $2 WHERE id = $1', [c.id, c.etat]);
  }
});

test('environnement : refusé en pilote et en production', async () => {
  const avant = process.env.ARRIMO_ENV;
  try {
    for (const env of ['pilote', 'production']) {
      process.env.ARRIMO_ENV = env;
      assert.strictEqual((await appel('ccs', 'POST', '/secours/quotes-parts', { etablissement_id: ids.mb, valeur: 2, periode_min: 60, autorite: 'X Y' })).statut, 403, env);
      assert.strictEqual((await require('../src/quotes-parts').etat(pool, [ids.mb])).get(ids.mb), null, `${env} : rien d’exposé`);
    }
  } finally { if (avant == null) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = avant; }
});
