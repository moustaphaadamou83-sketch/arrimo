'use strict';
/**
 * Chantier coordination, lot 3 « Solutions » (26 nov. 2026) : plan de coordination d'OG en 7 points, synthèse anticipative
 * (confirmé, prévisionnel, inconnu séparés), solutions de rechange de transport, données insuffisantes signalées, OG en FR/EN,
 * comparatif CCS enrichi (ambulances annoncées, à la porte, délai porte observé). Rien n'est exécuté. Données fictives seulement.
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
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${tokens[qui]}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined });
  const texte = await r.text(); let corpsJ = null; try { corpsJ = JSON.parse(texte); } catch { corpsJ = texte; }
  return { statut: r.status, corps: corpsJ };
}
async function compte(email, role, orgId) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [email, email, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (orgId) await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, orgId]);
}
async function connecter(q, email) {
  const r = await appel(null, 'POST', '/connexion', { email, mot_de_passe: MOT_DE_PASSE_DEMO });
  assert.strictEqual(r.statut, 200, `connexion ${q}`); tokens[q] = r.corps.token;
}
const plan = async (langue = '') => { const r = await appel('tremblay', 'GET', `/coordination/plan?etablissement_id=${ids.mb}${langue ? `&langue=${langue}` : ''}`); assert.strictEqual(r.statut, 200, JSON.stringify(r.corps)); return r.corps; };

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL);
  await viderBase(pool);
  await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool));
  base = `http://127.0.0.1:${serveur.address().port}`;
  const e = (await pool.query("SELECT id, config_id FROM etablissements WHERE code IN ('MB', 'SL') ORDER BY code")).rows;
  [ids.mb, ids.sl] = e.map((x) => x.id); ids.config = e[0].config_id;
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"liaison_secours": true, "chrono": true}' WHERE id IN ($1, $2)`, [ids.mb, ids.sl]);
  const org = async (code, nom, type, profils) => (await pool.query('INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ($1, $2, $3, $4, $5) RETURNING id', [code, nom, type, profils, ids.config])).rows[0].id;
  ids.a = await org('AMB-SA', 'Ambulances A', 'ambulancier', ['ambulance']); ids.b = await org('AMB-SB', 'Ambulances B', 'ambulancier', ['ambulance']);
  ids.ccs = await org('CCS-S', 'CCS S', 'ccs', ['ccs']);
  const unite = async (o, n) => (await pool.query('INSERT INTO unites_secours (organisation_id, numero) VALUES ($1, $2) RETURNING id', [o, n])).rows[0].id;
  ids.ua = await unite(ids.a, '80-01');
  for (const n of ['81-01', '81-02', '81-03']) {
    const u = await unite(ids.b, n);
    await pool.query(`INSERT INTO etats_vehicules (unite_id, etat) VALUES ($1, $2)`, [u, n === '81-03' ? 'hors_service' : 'disponible']);
  }
  await compte('ccs.solutions@demo.arrimo', 'repartiteur', ids.ccs);
  await connecter('tremblay', 'tremblay@demo.arrimo'); await connecter('bouchard', 'bouchard@demo.arrimo'); await connecter('ccs', 'ccs.solutions@demo.arrimo');
  await pool.query(`INSERT INTO demandes_transport (numero, organisation_id, origine_id, destination_id, resident_ref, statut, heure_souhaitee)
    VALUES ('DT-SO1', $1, $2, $3, 'R-92001', 'demandee', now() - interval '2 hours')`, [ids.a, ids.mb, ids.sl]);
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('plan : chaque fiche a les 7 points ; aucune action exécutée', async () => {
  const avant = (await pool.query('SELECT statut, version FROM demandes_transport ORDER BY id')).rows;
  const p = await plan();
  assert.ok(p.fiches.length >= 2);
  for (const f of p.fiches) {
    for (const k of ['situation', 'donnees', 'contraintes', 'actions', 'acteurs', 'incertitudes', 'validations']) assert.ok(f[k] != null, `${f.type} : ${k}`);
    assert.ok(f.situation.length && f.actions.length && f.validations.length, f.type);
    assert.ok(f.donnees.sources.length && f.donnees.lues_le, f.type);
    assert.ok(f.validations.some((v) => /aucune action n’est exécutée sans décision humaine/.test(v)));
  }
  assert.match(p.regle, /OG propose, un humain décide/);
  assert.deepStrictEqual((await pool.query('SELECT statut, version FROM demandes_transport ORDER BY id')).rows, avant);
});

test('solutions de rechange : autres transporteurs autorisés de la région avec unités disponibles (hors service exclues)', async () => {
  const f = (await plan()).fiches.find((x) => x.type === 'transport_en_retard');
  assert.ok(f); assert.strictEqual(f.niveau, 'eleve');
  assert.ok(f.actions.includes('Solutions de rechange autorisées pour DT-SO1 : Ambulances B (unités déclarées disponibles : 2).'), f.actions.join(' | '));
  assert.ok(!f.actions.some((a) => a.includes('CCS S')), 'un CCS n’est pas un transporteur');
});

test('synthèse : confirmé, prévisionnel et inconnu séparés ; risque de saturation si ambulances annoncées > civières libres', async () => {
  let s = (await plan()).synthese;
  for (const k of ['confirme', 'previsionnel', 'inconnu', 'demande']) assert.ok(s[k], k);
  assert.match(s.previsionnel.note, /ce ne sont pas des lits disponibles/);
  const libres = (await pool.query("SELECT count(*)::int AS n FROM civieres WHERE etablissement_id = $1 AND actif AND etat = 'libre'", [ids.mb])).rows[0].n;
  for (let i = 0; i <= libres; i += 1) {
    await pool.query(`INSERT INTO prealertes (numero, organisation_id, unite_id, destination_id, priorite, categorie) VALUES ($1, $2, $3, $4, 'urgente', 'medicale')`, [`PA-SO${i}`, ids.a, ids.ua, ids.mb]);
  }
  await require('../src/vigilance').noterControle(pool, 'blocages', Date.now(), {});
  s = (await plan()).synthese;
  assert.strictEqual(s.risque_saturation, true); assert.strictEqual(s.demande.ambulances_annoncees, libres + 1);
  assert.match(s.texte, /^Risque de saturation\. /);
  assert.strictEqual(s.donnees_insuffisantes, false);
});

test('données insuffisantes : un connecteur silencieux limite la recommandation, dit clairement', async () => {
  const c = await require('../src/connecteurs').creerConnecteur(pool, 'ADT plan', ids.mb);
  await pool.query("UPDATE connecteurs SET cree_le = now() - interval '5 hours' WHERE id = $1", [c.id]);
  const p = await plan();
  assert.strictEqual(p.synthese.donnees_insuffisantes, true); assert.match(p.synthese.limite, /^Recommandation limitée/);
  assert.ok(p.fiches.filter((f) => f.type !== 'connecteur_silencieux').every((f) => f.incertitudes.some((i) => /connecteur est silencieux/.test(i))));
  await pool.query('UPDATE connecteurs SET actif = false WHERE id = $1', [c.id]);
});

test('OG : « que faire ? » et « why is it saturated? » répondent depuis le plan, en FR et en EN ; isolation', async () => {
  let r = await appel('tremblay', 'POST', '/copilote/question', { etablissement_id: ids.mb, question: 'Que faire maintenant ?' });
  assert.strictEqual(r.statut, 200); assert.match(r.corps.reponse, /Risque de saturation|Pas de risque de saturation établi/); assert.match(r.corps.reponse, /OG propose, un humain décide/);
  r = await appel('tremblay', 'POST', '/copilote/question', { etablissement_id: ids.mb, question: 'Why is the emergency saturated?', langue: 'en' });
  assert.match(r.corps.reponse, /Saturation risk|No established saturation risk/); assert.match(r.corps.reponse, /OG proposes, a human decides/);
  const en = await plan('en');
  assert.ok(en.fiches.find((f) => f.type === 'transport_en_retard').actions.some((a) => a.startsWith('Authorized alternatives for DT-SO1')));
  assert.strictEqual((await appel('bouchard', 'GET', `/coordination/plan?etablissement_id=${ids.mb}`)).statut, 403);
});

test('comparatif CCS : ambulances annoncées et à la porte, délai porte observé jamais estimé', async () => {
  const r = await appel('ccs', 'GET', '/secours/urgences-classees?capacites_seules=1');
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  const mb = r.corps.urgences.find((h) => h.id === ids.mb);
  const attendues = (await pool.query(`SELECT count(*)::int AS n FROM prealertes WHERE destination_id = $1 AND statut IN ('envoyee', 'recue', 'consultee', 'prise_en_compte', 'preparation', 'preparation_terminee') AND arrivee_signalee_le IS NULL`, [ids.mb])).rows[0].n;
  assert.strictEqual(mb.ambulances.annoncees, attendues);
  assert.strictEqual(mb.ambulances.a_la_porte, 0);
  assert.strictEqual(mb.ambulances.porte_mediane_24h_min, null, 'aucune mesure : rien n’est estimé'); assert.strictEqual(mb.ambulances.porte_mesures_24h, 0);
});
