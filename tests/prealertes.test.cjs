'use strict';
/**
 * Arrimo Préhospitalier, phase 1 : préalertes (module hospitalier Liaison Secours).
 * Base PostgreSQL de test (TEST_DATABASE_URL), données fictives seulement : aucune identité, aucun motif libre.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');
const routage = require('../src/routage');
// Routeur fictif (aucun appel réseau) : distances à vol d'oiseau
function routeurFictif(url) {
  const km = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]) * 111000);
  const mat = String(url).match(/\/table\/v1\/[^/]+\/([^?]+)/);
  const route = String(url).match(/\/route\/v1\/[^/]+\/([^?]+)/);
  if (route) {
    const p = route[1].split(';').map((x) => x.split(',').map(Number)); const m = km(p[0], p[1]);
    return { ok: true, json: async () => ({ code: 'Ok', data_version: 'fixture', routes: [{ distance: m, duration: Math.max(60, m / 1000 * 60), geometry: { type: 'LineString', coordinates: p } }] }) };
  }
  if (!mat) return { ok: false, json: async () => ({}) };
  const p = mat[1].split(';').map((x) => x.split(',').map(Number));
  return { ok: true, json: async () => ({ code: 'Ok', data_version: 'fixture', distances: [p.slice(1).map((x) => km(p[0], x))], durations: [p.slice(1).map((x) => Math.max(60, km(p[0], x) / 1000 * 60))] }) };
}

let pool; let serveur; let base;
const tokens = {};
const ids = {};

async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${tokens[qui]}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
const etab = async (code) => (await pool.query('SELECT id FROM etablissements WHERE code = $1', [code])).rows[0].id;
async function compte(email, nom, role, orgId) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [email, nom, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (orgId) await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, orgId]);
  return u;
}
async function connecter(q, email) {
  const r = await appel(null, 'POST', '/connexion', { email, mot_de_passe: MOT_DE_PASSE_DEMO });
  assert.strictEqual(r.statut, 200, `connexion ${q}`);
  tokens[q] = r.corps.token;
}
const action = (qui, pa, corps) => appel(qui, 'POST', `/secours/prealertes/${pa.id}/action`, corps);

test.before(async () => {
  process.env.ARRIMO_ROUTEUR_URL = 'http://routeur-fictif.test';
  routage.definirFetchTest(async (url) => routeurFictif(url));
  pool = creerPool(process.env.TEST_DATABASE_URL);
  await viderBase(pool);
  await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool));
  base = `http://127.0.0.1:${serveur.address().port}`;
  const cfg = (await pool.query('SELECT config_id FROM etablissements WHERE code = $1', ['MB'])).rows[0].config_id;
  ids.mb = await etab('MB'); ids.sl = await etab('SL'); ids.lm = await etab('LM');
  // Liaison Secours activée à Mont-Bellevue et au CHU Saint-Laurent seulement
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"liaison_secours": true}' WHERE code IN ('MB', 'SL')`);
  const org = async (code, nom, type) => (await pool.query('INSERT INTO organisations_secours (code, nom, type, config_id) VALUES ($1, $2, $3, $4) RETURNING id', [code, nom, type, cfg])).rows[0].id;
  ids.ambA = await org('AMB-A', 'Ambulances fictives A', 'ambulancier');
  ids.ambB = await org('AMB-B', 'Ambulances fictives B', 'ambulancier');
  ids.ccs = await org('CCS-EST', 'CCS fictif de l’Estrie', 'ccs');
  const unite = async (orgId, numero, plaque) => (await pool.query('INSERT INTO unites_secours (organisation_id, numero, plaque) VALUES ($1, $2, $3) RETURNING id', [orgId, numero, plaque])).rows[0].id;
  ids.u1 = await unite(ids.ambA, '12-34', 'FICT 001'); ids.u2 = await unite(ids.ambA, '12-35', 'FICT 002'); ids.u3 = await unite(ids.ambB, '20-01', 'FICT 003');
  ids.para = await compte('para.a@demo.arrimo', 'Paramédic A1', 'paramedic', ids.ambA);
  ids.para2 = await compte('para2.a@demo.arrimo', 'Paramédic A2', 'paramedic', ids.ambA);
  await compte('para.b@demo.arrimo', 'Paramédic B1', 'paramedic', ids.ambB);
  await compte('ccs@demo.arrimo', 'Répartition fictive', 'repartiteur', ids.ccs);
  await connecter('para', 'para.a@demo.arrimo'); await connecter('paraB', 'para.b@demo.arrimo'); await connecter('ccs', 'ccs@demo.arrimo');
  await connecter('tremblay', 'tremblay@demo.arrimo'); await connecter('bouchard', 'bouchard@demo.arrimo'); await connecter('gagnon', 'gagnon@demo.arrimo');
});
test.after(async () => { serveur?.close(); await pool?.end(); routage.definirFetchTest(null); });

test('préalerte : création, confirmation technique, consultation, prise en compte, préparation, bon véhicule, remise, historique immuable', async () => {
  // Un paramédic n'accède à aucun écran hospitalier
  for (const chemin of ['/lits?etablissement_id=' + ids.mb, '/reseau?depuis=' + ids.mb, '/patients/recherche?q=a', '/chsld/residents?etablissement_id=' + ids.mb]) {
    const r = await appel('para', 'GET', chemin);
    assert.strictEqual(r.statut, 403, chemin); assert.strictEqual(r.corps.code, 'role_secours');
  }
  const moi = await appel('para', 'GET', '/moi');
  assert.deepStrictEqual(moi.corps.organisations.map((o) => o.code), ['AMB-A']); assert.deepStrictEqual(moi.corps.etablissements, []);
  // Hôpital sans Liaison Secours : la préalerte ne peut pas lui être transmise
  const refus = await appel('para', 'POST', '/secours/prealertes', { unite_id: ids.u1, destination_id: ids.lm, priorite: 'urgente', categorie: 'cardiaque', delai_min: 12 });
  assert.strictEqual(refus.statut, 409); assert.strictEqual(refus.corps.code, 'liaison_secours_inactive');
  // Aucun texte libre : catégorie et priorité en listes fermées
  assert.strictEqual((await appel('para', 'POST', '/secours/prealertes', { unite_id: ids.u1, destination_id: ids.mb, priorite: 'urgente', categorie: 'douleur thoracique' })).corps.code, 'prealerte_invalide');
  // Unité d'une autre organisation : refusée
  assert.strictEqual((await appel('para', 'POST', '/secours/prealertes', { unite_id: ids.u3, destination_id: ids.mb, priorite: 'urgente', categorie: 'cardiaque' })).statut, 404);

  const c = await appel('para', 'POST', '/secours/prealertes', { unite_id: ids.u1, destination_id: ids.mb, priorite: 'urgente', categorie: 'cardiaque', delai_min: 12, equipage: [ids.para, ids.para2], cle: 'poste-0001-abc' });
  assert.strictEqual(c.statut, 200, JSON.stringify(c.corps));
  const pa = c.corps;
  assert.match(pa.numero, /^PA-\d{6}$/); assert.strictEqual(pa.statut, 'envoyee'); assert.ok(pa.heure_prevue);
  // Notification à l'hôpital, jamais d'identité
  const notif = (await pool.query(`SELECT message FROM notifications WHERE etablissement_id = $1 AND code = 'secours_prealerte' ORDER BY id DESC LIMIT 1`, [ids.mb])).rows[0];
  assert.match(notif.message, new RegExp(`${pa.numero}.*12-34`));
  // Une seule préalerte ouverte par unité
  const doublon = await appel('para', 'POST', '/secours/prealertes', { unite_id: ids.u1, destination_id: ids.sl, priorite: 'urgente', categorie: 'cardiaque' });
  assert.strictEqual(doublon.statut, 409); assert.strictEqual(doublon.corps.code, 'prealerte_deja_ouverte');

  // Côté ambulance : rien n'est encore reçu par l'hôpital
  assert.strictEqual((await appel('para', 'GET', '/secours/prealertes')).corps.prealertes[0].recue_le, null);
  // L'écran de l'hôpital la reçoit : confirmation technique (pas une prise en compte humaine)
  const l = await appel('tremblay', 'GET', `/secours/prealertes?etablissement_id=${ids.mb}`);
  assert.strictEqual(l.statut, 200, JSON.stringify(l.corps));
  const vue = l.corps.prealertes.find((x) => x.id === pa.id);
  assert.strictEqual(vue.statut, 'recue'); assert.ok(vue.recue_le); assert.strictEqual(vue.prise_en_compte_le, null);
  assert.deepStrictEqual([vue.organisation, vue.unite, vue.plaque, vue.priorite, vue.categorie], ['Ambulances fictives A', '12-34', 'FICT 001', 'urgente', 'cardiaque']);
  assert.deepStrictEqual(vue.equipage_noms, ['Paramédic A1', 'Paramédic A2']);
  // Position en direct : la dernière position de l'unité apparaît sur la préalerte ouverte
  assert.strictEqual((await appel('para', 'POST', `/secours/unites/${ids.u1}/position`, { latitude: 45.41, longitude: -71.95, precision_m: 15 })).statut, 200);
  assert.strictEqual((await appel('para', 'POST', `/secours/unites/${ids.u3}/position`, { latitude: 45.41, longitude: -71.95 })).statut, 404);
  const pos = (await appel('tremblay', 'GET', `/secours/prealertes?etablissement_id=${ids.mb}`)).corps.prealertes.find((x) => x.id === pa.id).position;
  assert.deepStrictEqual([pos.latitude, pos.longitude, pos.precision_m], [45.41, -71.95, 15]);
  // Fiche ouverte : « consultée » ; la prise en compte reste une action explicite
  const f = await appel('tremblay', 'GET', `/secours/prealertes/${pa.id}?etablissement_id=${ids.mb}`);
  assert.strictEqual(f.corps.statut, 'consultee'); assert.ok(f.corps.actions.includes('prendre_en_compte'));
  let v = f.corps.version;
  let r = await action('tremblay', pa, { etablissement_id: ids.mb, action: 'prendre_en_compte', version: v });
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps)); assert.strictEqual(r.corps.statut, 'prise_en_compte');
  // Version périmée : refusée (deux personnes ne peuvent pas avancer la même étape en même temps)
  assert.strictEqual((await action('tremblay', pa, { etablissement_id: ids.mb, action: 'preparation', version: v })).corps.code, 'version_perimee');
  v = r.corps.version;
  r = await action('tremblay', pa, { etablissement_id: ids.mb, action: 'preparation', version: v }); assert.strictEqual(r.corps.statut, 'preparation');
  // L'ambulance voit l'accusé et met à jour son heure d'arrivée et la priorité
  const amb = (await appel('para', 'GET', '/secours/prealertes')).corps.prealertes.find((x) => x.id === pa.id);
  assert.ok(amb.prise_en_compte_le); assert.ok(amb.recue_le);
  r = await action('para', pa, { action: 'mettre_a_jour', delai_min: 5, priorite: 'immediate', version: amb.version });
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps)); assert.strictEqual(r.corps.priorite, 'immediate');
  r = await action('para', pa, { action: 'signaler_arrivee' }); assert.ok(r.corps.arrivee_signalee_le);
  assert.strictEqual(r.corps.statut, 'preparation', 'l’arrivée signalée ne change pas le statut : l’hôpital confirme le véhicule');
  // Un autre véhicule se présente : enregistré, la préalerte reste ouverte
  r = await action('tremblay', pa, { etablissement_id: ids.mb, action: 'confirmer_vehicule', unite_numero: '20-01' });
  assert.strictEqual(r.statut, 200); assert.strictEqual(r.corps.correspond, false); assert.strictEqual(r.corps.unite_attendue, '12-34');
  assert.strictEqual((await pool.query('SELECT statut FROM prealertes WHERE id = $1', [pa.id])).rows[0].statut, 'preparation');
  // La remise exige l'arrivée confirmée du bon véhicule
  assert.strictEqual((await action('tremblay', pa, { etablissement_id: ids.mb, action: 'confirmer_remise' })).corps.code, 'prealerte_statut_incompatible');
  r = await action('tremblay', pa, { etablissement_id: ids.mb, action: 'confirmer_vehicule', unite_numero: '12-34' });
  assert.strictEqual(r.corps.correspond, true); assert.strictEqual(r.corps.statut, 'arrivee');
  r = await action('tremblay', pa, { etablissement_id: ids.mb, action: 'confirmer_remise' });
  assert.strictEqual(r.corps.statut, 'cloturee'); assert.ok(r.corps.remise_le);
  assert.strictEqual((await action('para', pa, { action: 'annuler' })).corps.code, 'prealerte_close');
  // Historique complet, horodaté et immuable ; aucune identité dans le journal de l'hôpital
  const h = await appel('tremblay', 'GET', `/secours/prealertes/${pa.id}?etablissement_id=${ids.mb}`);
  assert.deepStrictEqual(h.corps.evenements.map((e) => e.type), ['envoyee', 'recue', 'consultee', 'prendre_en_compte', 'preparation', 'mettre_a_jour', 'signaler_arrivee',
    'vehicule_different', 'confirmer_vehicule', 'confirmer_remise']);
  await assert.rejects(pool.query('UPDATE prealerte_evenements SET type = $1', ['x']));
  await assert.rejects(pool.query('DELETE FROM prealerte_evenements'));
  // L'unité est de nouveau libre pour une nouvelle préalerte
  assert.strictEqual((await appel('para', 'POST', '/secours/prealertes', { unite_id: ids.u1, destination_id: ids.sl, priorite: 'non_urgente', categorie: 'autre' })).statut, 200);
});

test('préalerte : renvoi après coupure sans doublon, changement de destination conservé, isolation entre organisations et hôpitaux', async () => {
  const corps = { unite_id: ids.u2, destination_id: ids.mb, priorite: 'immediate', categorie: 'traumatologie', delai_min: 20, cle: 'poste-0002-reseau' };
  const [a, b] = await Promise.all([appel('para', 'POST', '/secours/prealertes', corps), appel('para', 'POST', '/secours/prealertes', corps)]);
  assert.deepStrictEqual([a.statut, b.statut], [200, 200]);
  assert.strictEqual(a.corps.id, b.corps.id, 'même préalerte après un renvoi');
  assert.strictEqual((await pool.query("SELECT count(*)::int AS n FROM prealertes WHERE cle_idempotence = 'poste-0002-reseau'")).rows[0].n, 1);
  const pa = a.corps;
  // Isolation : une autre entreprise, un autre hôpital et un rôle hospitalier sans accès ne voient rien
  assert.ok(!(await appel('paraB', 'GET', '/secours/prealertes')).corps.prealertes.some((x) => x.id === pa.id));
  assert.strictEqual((await appel('paraB', 'GET', `/secours/prealertes/${pa.id}`)).statut, 404);
  assert.strictEqual((await action('paraB', pa, { action: 'annuler' })).statut, 404);
  assert.ok(!(await appel('bouchard', 'GET', `/secours/prealertes?etablissement_id=${ids.sl}`)).corps.prealertes.some((x) => x.id === pa.id));
  assert.strictEqual((await appel('bouchard', 'GET', `/secours/prealertes/${pa.id}?etablissement_id=${ids.sl}`)).statut, 404);
  assert.strictEqual((await appel('bouchard', 'GET', `/secours/prealertes?etablissement_id=${ids.mb}`)).corps.code, 'etab_interdit');
  assert.strictEqual((await appel('gagnon', 'GET', `/secours/prealertes?etablissement_id=${ids.lm}`)).corps.code, 'module_desactive');
  // Le CCS de la région consulte, sans agir
  const ccs = await appel('ccs', 'GET', '/secours/prealertes');
  assert.ok(ccs.corps.prealertes.some((x) => x.id === pa.id && x.actions.length === 0));
  assert.strictEqual((await action('ccs', pa, { action: 'annuler' })).statut, 403);
  assert.strictEqual((await appel('ccs', 'GET', `/lits?etablissement_id=${ids.mb}`)).corps.code, 'role_secours');
  // Changement de destination décidé par les professionnels : l'ancienne est conservée et l'ancien hôpital informé
  const r = await action('para', pa, { action: 'changer_destination', destination_id: ids.sl });
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  assert.strictEqual(r.corps.remplace, pa.numero); assert.strictEqual(r.corps.destination_id, ids.sl);
  const ancienne = (await pool.query('SELECT statut FROM prealertes WHERE id = $1', [pa.id])).rows[0];
  assert.strictEqual(ancienne.statut, 'remplacee');
  assert.ok((await pool.query(`SELECT 1 FROM notifications WHERE etablissement_id = $1 AND code = 'secours_destination_modifiee'`, [ids.mb])).rowCount);
  const mb = (await appel('tremblay', 'GET', `/secours/prealertes?etablissement_id=${ids.mb}`)).corps.prealertes.find((x) => x.id === pa.id);
  assert.strictEqual(mb.statut, 'remplacee'); assert.deepStrictEqual(mb.actions, []); assert.strictEqual(mb.position, null);
  assert.ok((await appel('bouchard', 'GET', `/secours/prealertes?etablissement_id=${ids.sl}`)).corps.prealertes.some((x) => x.id === r.corps.id));
  // Positions : conservées 24 h au plus
  await pool.query(`INSERT INTO positions_unites (unite_id, latitude, longitude, enregistree_le) VALUES ($1, 45, -72, now() - interval '25 hours')`, [ids.u2]);
  assert.ok((await require('../src/prealertes').purgerPositions(pool)) >= 1);
  assert.strictEqual((await pool.query(`SELECT count(*)::int AS n FROM positions_unites WHERE enregistree_le < now() - interval '24 hours'`)).rows[0].n, 0);
});

test('OG : ambulances annoncées et préalertes à prendre en compte, d’après les étapes enregistrées ; aucune décision de destination', async () => {
  // Le test précédent laisse une préalerte ouverte de l'unité 12-35 vers le CHU Saint-Laurent (après changement de destination)
  const num = (await pool.query("SELECT numero FROM prealertes WHERE unite_id = $1 AND destination_id = $2 AND statut NOT IN ('cloturee', 'annulee', 'remplacee')", [ids.u2, ids.sl])).rows[0].numero;
  const og = async (question) => (await appel('bouchard', 'POST', '/assistant', { etablissement_id: ids.sl, question })).corps;
  let r = await og('Quelles ambulances sont en approche ?');
  assert.deepStrictEqual(r.intentions, ['liaison_secours']);
  assert.match(r.reponse, new RegExp(`${num} · 12-35 \\(Ambulances fictives A\\)`));
  r = await og(`Où en est la préalerte ${num} ?`);
  assert.match(r.reponse, new RegExp(num));
  r = await og('Quelles préalertes sont en attente de prise en compte ?');
  assert.match(r.reponse, /à prendre en compte/);
  r = await og('Quel hôpital choisir pour envoyer cette ambulance ?');
  assert.match(r.reponse, /Je ne décide ni de la destination/);
  // Hôpital sans Liaison Secours : la question est laissée aux autres réponses d'OG, sans préalerte
  r = await appel('gagnon', 'POST', '/assistant', { etablissement_id: ids.lm, question: 'Quelles ambulances sont en approche ?' });
  assert.strictEqual(r.statut, 200); assert.ok(!(r.corps.intentions || []).includes('liaison_secours'));
});
