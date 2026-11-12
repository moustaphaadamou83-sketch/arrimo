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
  assert.deepStrictEqual(h.corps.evenements.map((e) => e.type), ['envoyee', 'service_propose', 'recue', 'consultee', 'prendre_en_compte', 'preparation', 'mettre_a_jour', 'signaler_arrivee',
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

test('écran Secours : page dédiée, géolocalisation permise là seulement, urgences de la région, OG ambulance et CCS sans décision', async () => {
  const page = await fetch(`${base}/secours`);
  assert.strictEqual(page.status, 200); assert.match(await page.text(), /secours\.js/);
  assert.match(page.headers.get('permissions-policy'), /geolocation=\(self\)/);
  assert.match((await fetch(`${base}/`)).headers.get('permissions-policy'), /geolocation=\(\)/);
  // Urgences de la région : seulement les hôpitaux qui reçoivent les préalertes, triés par distance à vol d'oiseau
  const d = await appel('para', 'GET', '/secours/destinations?latitude=45.40&longitude=-71.89');
  assert.strictEqual(d.statut, 200, JSON.stringify(d.corps));
  assert.deepStrictEqual(d.corps.map((h) => h.id), [ids.mb, ids.sl]);
  assert.strictEqual(d.corps[0].distance_km, 0);
  assert.ok(d.corps.every((h) => !('modules' in h) && !('config_id' in h)));
  assert.strictEqual((await appel('tremblay', 'GET', '/secours/destinations')).corps.code, 'organisation_interdite');
  // OG de l'ambulance : préalertes de son organisation seulement, réception, informations manquantes, urgences
  const og = async (qui, question) => (await appel(qui, 'POST', '/secours/og', { question })).corps;
  let r = await og('para', 'Préalertes en cours');
  assert.match(r.reponse, /12-35/); assert.deepStrictEqual(r.intentions, ['suivi']);
  r = await og('para', 'L’hôpital a-t-il confirmé la réception ?');
  assert.deepStrictEqual(r.intentions, ['reception']);
  r = await og('para', 'Que manque-t-il à ma préalerte ?');
  assert.match(r.reponse, /position de l’unité/);
  await pool.query("INSERT INTO civieres (etablissement_id, code) VALUES ($1, 'PA-T1'), ($1, 'PA-T2')", [ids.mb]);
  r = await og('para', 'État des urgences de la région');
  assert.match(r.reponse, /Hôpital Mont-Bellevue — urgence fluide, 2 civières libres/); assert.match(r.reponse, /CHU Saint-Laurent — aucune donnée d’urgence/); assert.match(r.reponse, /pas un choix de destination/);
  r = await og('para', 'Où l’amener, quel hôpital choisir ?');
  assert.deepStrictEqual(r.intentions, ['refus_decision']);
  // Une autre entreprise ne voit pas ces préalertes, même par OG
  r = await og('paraB', 'Préalertes en cours');
  assert.doesNotMatch(r.reponse, /12-35/);
  // CCS : lecture régionale par OG
  r = await og('ccs', 'Quelles ambulances sont en route ?');
  assert.match(r.reponse, /12-35/);
  // Le personnel hospitalier passe par OG de l'hôpital, pas par celui des secours
  assert.strictEqual((await appel('tremblay', 'POST', '/secours/og', { question: 'ambulances' })).statut, 403);
});

test('préparation : OG propose le service selon les règles de l’hôpital, l’équipe confirme, modifie ou refuse ; synthèse, états, notification prioritaire', async () => {
  // Règles de l'hôpital (administration) : catégories → services ; un service par défaut
  const sv = async (code, nom, attributs) => (await pool.query('INSERT INTO services (etablissement_id, code, nom, attributs) VALUES ($1, $2, $3, $4) RETURNING id', [ids.mb, code, nom, JSON.stringify(attributs)])).rows[0].id;
  const cardio = await sv('CARD', 'Cardiologie', { categories_secours: ['cardiaque'] });
  const urg = await sv('URGG', 'Urgence générale', { secours_defaut: true });
  const neuro = await sv('NEURO', 'Neurologie / AVC', { categories_secours: ['neurologique'] });
  await pool.query("UPDATE prealertes SET statut = 'annulee' WHERE unite_id = $1 AND statut NOT IN ('cloturee', 'annulee', 'remplacee')", [ids.u1]);
  const c = await appel('para', 'POST', '/secours/prealertes', { unite_id: ids.u1, destination_id: ids.mb, priorite: 'immediate', categorie: 'cardiaque', delai_min: 8 });
  assert.strictEqual(c.statut, 200, JSON.stringify(c.corps));
  assert.deepStrictEqual([c.corps.service_propose_id, c.corps.service_statut, c.corps.service_justification.regle], [cardio, 'a_confirmer', 'correspondance_etablissement']);
  // Priorité immédiate : notification adaptée
  assert.ok((await pool.query("SELECT 1 FROM notifications WHERE etablissement_id = $1 AND code = 'secours_prealerte_prioritaire' AND message LIKE $2", [ids.mb, `%${c.corps.numero}%`])).rowCount);
  let f = (await appel('tremblay', 'GET', `/secours/prealertes/${c.corps.id}?etablissement_id=${ids.mb}`)).corps;
  assert.strictEqual(f.service_propose, 'Cardiologie'); assert.strictEqual(f.etat_preparation, 'a_prendre_en_compte');
  assert.ok(f.actions.includes('confirmer_service') && f.actions.includes('modifier_service') && f.actions.includes('refuser_service'));
  // Synthèse d'OG : capacité de l'urgence (civières des tests précédents), priorité immédiate non prise en compte ; aucune donnée clinique
  // (la position de l'unité a été partagée il y a moins de 10 min dans le premier test)
  assert.deepStrictEqual(f.synthese.map((x) => x.code).sort(), ['capacite_urgence', 'immediate_non_prise_en_compte']);
  assert.deepStrictEqual(f.synthese.find((x) => x.code === 'capacite_urgence'), { code: 'capacite_urgence', niveau: 'vert', civieres_libres: 2 });
  // L'ambulance ne voit ni la synthèse hospitalière ni d'information interne de l'hôpital
  const amb = (await appel('para', 'GET', `/secours/prealertes/${c.corps.id}`)).corps;
  assert.strictEqual(amb.synthese, undefined);
  let r = await appel('tremblay', 'POST', `/secours/prealertes/${c.corps.id}/action`, { etablissement_id: ids.mb, action: 'prendre_en_compte' });
  assert.strictEqual(r.corps.statut, 'prise_en_compte');
  f = (await appel('tremblay', 'GET', `/secours/prealertes/${c.corps.id}?etablissement_id=${ids.mb}`)).corps;
  assert.strictEqual(f.etat_preparation, 'service_a_confirmer');
  r = await appel('tremblay', 'POST', `/secours/prealertes/${c.corps.id}/action`, { etablissement_id: ids.mb, action: 'confirmer_service' });
  assert.deepStrictEqual([r.corps.service_statut, r.corps.service_confirme_id], ['confirme', cardio]);
  assert.strictEqual((await appel('tremblay', 'POST', `/secours/prealertes/${c.corps.id}/action`, { etablissement_id: ids.mb, action: 'refuser_service' })).corps.code, 'prealerte_statut_incompatible');
  // L'équipe indique un autre service ; un service d'un autre hôpital est refusé
  const autre = (await pool.query("INSERT INTO services (etablissement_id, code, nom) VALUES ($1, 'X1', 'Service d’un autre hôpital') RETURNING id", [ids.sl])).rows[0].id;
  assert.strictEqual((await appel('tremblay', 'POST', `/secours/prealertes/${c.corps.id}/action`, { etablissement_id: ids.mb, action: 'modifier_service', service_id: autre })).corps.code, 'service_introuvable');
  r = await appel('tremblay', 'POST', `/secours/prealertes/${c.corps.id}/action`, { etablissement_id: ids.mb, action: 'modifier_service', service_id: neuro });
  assert.deepStrictEqual([r.corps.service_statut, r.corps.service_confirme_id], ['modifie', neuro]);
  f = (await appel('tremblay', 'GET', `/secours/prealertes/${c.corps.id}?etablissement_id=${ids.mb}`)).corps;
  assert.strictEqual(f.etat_preparation, 'preparation_a_effectuer'); assert.strictEqual(f.service_confirme, 'Neurologie / AVC');
  assert.ok(f.evenements.some((e) => e.type === 'service_propose' && e.par === null && e.detail.og === true), 'la proposition est attribuée à OG, pas à une personne');
  // OG de l'hôpital : service potentiellement concerné, d'après la proposition et la décision de l'équipe
  const ogh = (await appel('tremblay', 'POST', '/assistant', { etablissement_id: ids.mb, question: 'Quel service est potentiellement concerné ?' })).corps;
  assert.deepStrictEqual(ogh.intentions, ['liaison_secours']); assert.match(ogh.reponse, /service retenu par l’équipe : Neurologie \/ AVC/); assert.match(ogh.reponse, /je ne pose aucun diagnostic/);
  // Catégorie sans règle : service par défaut de l'établissement
  await appel('para', 'POST', `/secours/prealertes/${c.corps.id}/action`, { action: 'annuler' });
  const d = await appel('para', 'POST', '/secours/prealertes', { unite_id: ids.u1, destination_id: ids.mb, priorite: 'urgente', categorie: 'obstetrique' });
  assert.deepStrictEqual([d.corps.service_propose_id, d.corps.service_justification.regle], [urg, 'service_par_defaut']);
  // Hôpital sans aucune règle : pas de proposition, l'équipe indique le service
  await appel('para', 'POST', `/secours/prealertes/${d.corps.id}/action`, { action: 'annuler' });
  const e = await appel('para', 'POST', '/secours/prealertes', { unite_id: ids.u1, destination_id: ids.sl, priorite: 'urgente', categorie: 'cardiaque' });
  assert.deepStrictEqual([e.corps.service_propose_id, e.corps.service_statut], [null, 'sans_proposition']);
  const fs = (await appel('bouchard', 'GET', `/secours/prealertes/${e.corps.id}?etablissement_id=${ids.sl}`)).corps;
  assert.ok(fs.synthese.some((x) => x.code === 'service_sans_regle'));
  // Services actifs de l'hôpital : pour l'hôpital seulement
  assert.deepStrictEqual((await appel('tremblay', 'GET', `/secours/services?etablissement_id=${ids.mb}`)).corps.map((x) => x.nom), ['Cardiologie', 'Neurologie / AVC', 'Urgence générale']);
  assert.strictEqual((await appel('para', 'GET', `/secours/services?etablissement_id=${ids.mb}`)).statut, 403);
});

test('disponibilités : statut déclaré de l’urgence avec heure et auteur, donnée périmée signalée par OG (scénario G), droits', async () => {
  // Seuls les responsables de l'hôpital déclarent ; jamais une ambulance
  assert.strictEqual((await appel('para', 'POST', '/secours/urgence', { etablissement_id: ids.mb, statut: 'saturation' })).statut, 403);
  assert.strictEqual((await appel('tremblay', 'POST', '/secours/urgence', { etablissement_id: ids.mb, statut: 'ferme' })).corps.code, 'statut_urgence_invalide');
  assert.strictEqual((await appel('tremblay', 'POST', '/secours/urgence', { etablissement_id: ids.sl, statut: 'saturation' })).corps.code, 'etab_interdit');
  let r = await appel('tremblay', 'POST', '/secours/urgence', { etablissement_id: ids.mb, statut: 'capacite_limitee' });
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  const s = (await appel('tremblay', 'GET', `/secours/urgence?etablissement_id=${ids.mb}`)).corps;
  assert.deepStrictEqual([s.declaration.statut, s.declaration.perime, s.par, s.seuil_min], ['capacite_limitee', false, 'A. Tremblay', 15]);
  assert.ok((await pool.query("SELECT 1 FROM journal WHERE etablissement_id = $1 AND action = 'Statut de l’urgence déclaré'", [ids.mb])).rowCount);
  // Vu par l'ambulance avec sa source et son âge
  let h = (await appel('para', 'GET', '/secours/destinations')).corps.find((x) => x.id === ids.mb);
  assert.deepStrictEqual([h.statut_declare.statut, h.statut_declare.perime, h.statut_declare.source], ['capacite_limitee', false, 'declaration_etablissement']);
  // Déclaration ancienne : jamais présentée comme actuelle ; OG le dit, côté ambulance et côté hôpital
  await pool.query("UPDATE etablissements SET urgence_statut_le = now() - interval '40 minutes' WHERE id = $1", [ids.mb]);
  h = (await appel('para', 'GET', '/secours/destinations')).corps.find((x) => x.id === ids.mb);
  assert.strictEqual(h.statut_declare.perime, true);
  const og = (await appel('para', 'POST', '/secours/og', { question: 'État des urgences de la région' })).corps.reponse;
  assert.match(og, /Hôpital Mont-Bellevue ; statut déclaré : capacité limitée \(il y a 40 min, donnée ancienne\)/);
  const c = await appel('paraB', 'POST', '/secours/prealertes', { unite_id: ids.u3, destination_id: ids.mb, priorite: 'non_urgente', categorie: 'autre', delai_min: 25 });
  assert.strictEqual(c.statut, 200, JSON.stringify(c.corps));
  const f = (await appel('tremblay', 'GET', `/secours/prealertes/${c.corps.id}?etablissement_id=${ids.mb}`)).corps;
  assert.ok(f.synthese.some((x) => x.code === 'declaration_perimee' && x.minutes === 40));
  // Une confirmation renouvelle l'heure
  await appel('tremblay', 'POST', '/secours/urgence', { etablissement_id: ids.mb, statut: 'capacite_limitee' });
  assert.strictEqual((await appel('para', 'GET', '/secours/destinations')).corps.find((x) => x.id === ids.mb).statut_declare.perime, false);
});

test('Liaison Établissements : demande de transport d’un CHSLD vers une ambulance, parcours distinct, référence seulement, étapes, isolation', async () => {
  // CHSLD fictif (profil dérivé « -CHSLD »), un résident fictif et une hospitalisation transmise vers Mont-Bellevue
  const TE = require('../src/types-etablissement');
  const cfgMb = (await pool.query('SELECT config_id FROM etablissements WHERE id = $1', [ids.mb])).rows[0].config_id;
  const cfgCh = await TE.configChsld(pool, cfgMb);
  const ch = (await pool.query(`INSERT INTO etablissements (code, nom, ville, adresse, latitude, longitude, config_id, partage, module_actif, type_etablissement)
    VALUES ('CH-T1', 'CHSLD fictif des Pins', 'Sherbrooke', '12, rue des Pins', 45.41, -71.90, $1, 'complet', true, 'chsld') RETURNING id`, [cfgCh])).rows[0].id;
  const coordo = await compte('coord.ch@demo.arrimo', 'Coordination CHSLD fictif', 'coordonnateur', null);
  await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [coordo, ch]);
  await connecter('ch', 'coord.ch@demo.arrimo');
  const r0 = (await pool.query(`INSERT INTO residents (etablissement_id, reference, prenom, nom, date_naissance, statut) VALUES ($1, 'R-90001', 'Prénom', 'Fictif', '1940-01-01', 'present') RETURNING id`, [ch])).rows[0].id;
  const co = (await pool.query(`INSERT INTO coordinations (numero, type, resident_id, resident_ref, origine_id, destination_id, statut, infos_operationnelles)
    VALUES ('CO-90001', 'hospitalisation', $1, 'R-90001', $2, $3, 'envoyee', '{"accessibilite": ["fauteuil"], "accompagnateur": true, "langue": "fr"}') RETURNING id`, [r0, ch, ids.mb])).rows[0].id;
  // Entreprises de la région du CHSLD (profil d'origine) ; un hôpital n'en demande pas pour une coordination qui n'est pas la sienne
  const orgs = (await appel('ch', 'GET', `/transports/organisations?etablissement_id=${ch}`)).corps;
  assert.deepStrictEqual(orgs.map((o) => o.nom), ['Ambulances fictives A', 'Ambulances fictives B']);
  assert.strictEqual((await appel('tremblay', 'POST', `/coordinations/${co}/transport`, { organisation_id: ids.ambA })).statut, 403);
  assert.strictEqual((await appel('ch', 'POST', `/coordinations/${co}/transport`, { organisation_id: ids.ccs })).corps.code, 'organisation_introuvable');
  const corps = { organisation_id: ids.ambA, heure_souhaitee: new Date(Date.now() + 3600000).toISOString(), cle: 'chsld-poste-0001' };
  const [a, b] = await Promise.all([appel('ch', 'POST', `/coordinations/${co}/transport`, corps), appel('ch', 'POST', `/coordinations/${co}/transport`, corps)]);
  assert.strictEqual(a.statut, 200, JSON.stringify(a.corps)); assert.strictEqual(a.corps.id, b.corps.id, 'renvoi sans doublon');
  const dt = a.corps;
  assert.match(dt.numero, /^DT-\d{6}$/); assert.deepStrictEqual(dt.infos, { accessibilite: ['fauteuil'], accompagnateur: true, langue: 'fr' });
  assert.strictEqual((await appel('ch', 'POST', `/coordinations/${co}/transport`, { organisation_id: ids.ambB })).corps.code, 'transport_deja_demande');
  assert.ok((await pool.query("SELECT 1 FROM notifications WHERE etablissement_id = $1 AND code = 'transport_demande'", [ids.mb])).rowCount, 'l’hôpital est averti');
  // L'ambulance A voit la demande : référence, lieux, informations de transport ; jamais le nom du résident
  const vue = (await appel('para', 'GET', '/secours/transports')).corps.find((x) => x.id === dt.id);
  assert.deepStrictEqual([vue.resident_ref, vue.origine, vue.origine_adresse, vue.destination], ['R-90001', 'CHSLD fictif des Pins', '12, rue des Pins', 'Hôpital Mont-Bellevue']);
  assert.ok(!JSON.stringify(vue).includes('Fictif') && !JSON.stringify(vue).includes('1940'), 'aucune identité');
  assert.deepStrictEqual(vue.actions, ['accepter', 'refuser']);
  // Une autre entreprise ne la voit pas ; un CCS de la région la voit sans agir
  assert.ok(!(await appel('paraB', 'GET', '/secours/transports')).corps.some((x) => x.id === dt.id));
  assert.strictEqual((await appel('paraB', 'POST', `/secours/transports/${dt.id}/action`, { action: 'accepter', unite_id: ids.u3 })).statut, 404);
  const ccs = (await appel('ccs', 'GET', '/secours/transports')).corps.find((x) => x.id === dt.id);
  assert.deepStrictEqual(ccs.actions, []);
  // Étapes de l'ambulance, dans l'ordre ; l'unité doit être celle de l'entreprise
  assert.strictEqual((await appel('para', 'POST', `/secours/transports/${dt.id}/action`, { action: 'accepter', unite_id: ids.u3 })).corps.code, 'unite_introuvable');
  assert.strictEqual((await appel('para', 'POST', `/secours/transports/${dt.id}/action`, { action: 'pris_en_charge' })).corps.code, 'transport_statut_incompatible');
  let r = await appel('para', 'POST', `/secours/transports/${dt.id}/action`, { action: 'accepter', unite_id: ids.u2 });
  assert.deepStrictEqual([r.statut, r.corps.statut], [200, 'acceptee']);
  r = await appel('para', 'POST', `/secours/transports/${dt.id}/action`, { action: 'en_route' }); assert.strictEqual(r.corps.statut, 'en_route');
  // OG de l'ambulance : demandes des établissements, d'après les étapes
  const ogt = (await appel('para', 'POST', '/secours/og', { question: 'Demandes des établissements' })).corps;
  assert.deepStrictEqual(ogt.intentions, ['transports']); assert.match(ogt.reponse, new RegExp(`${dt.numero} · R-90001 : CHSLD fictif des Pins → Hôpital Mont-Bellevue · en route \\(12-35\\)`));
  // Le CHSLD suit son transport (notification) ; le transport ne confirme pas le départ de la coordination
  assert.ok((await pool.query("SELECT 1 FROM notifications WHERE etablissement_id = $1 AND code = 'transport_en_route'", [ch])).rowCount);
  r = await appel('para', 'POST', `/secours/transports/${dt.id}/action`, { action: 'pris_en_charge' }); assert.strictEqual(r.corps.statut, 'pris_en_charge');
  assert.strictEqual((await pool.query('SELECT statut FROM coordinations WHERE id = $1', [co])).rows[0].statut, 'envoyee', 'le départ reste confirmé par le CHSLD');
  assert.strictEqual((await appel('ch', 'POST', `/transports/${dt.id}/action`, { etablissement_id: ch, action: 'annuler' })).corps.code, 'transport_statut_incompatible');
  r = await appel('para', 'POST', `/secours/transports/${dt.id}/action`, { action: 'arrivee' }); assert.strictEqual(r.corps.statut, 'arrivee');
  // OG du CHSLD : où en est le transport du résident, d'après les étapes
  const ogc = (await appel('ch', 'POST', '/assistant', { etablissement_id: ch, question: 'Où en est le transport de R-90001 ?' })).corps;
  assert.deepStrictEqual(ogc.intentions, ['transports']); assert.match(ogc.reponse, new RegExp(`${dt.numero} · R-90001 → Hôpital Mont-Bellevue · Ambulances fictives A : arrivé à destination \\(unité 12-35\\)`));
  // Historique complet et immuable, visible par l'établissement d'origine et par l'hôpital
  const f = (await appel('ch', 'GET', `/transports/${dt.id}?etablissement_id=${ch}`)).corps;
  assert.deepStrictEqual(f.evenements.map((e) => e.type), ['demandee', 'accepter', 'en_route', 'pris_en_charge', 'arrivee']);
  assert.strictEqual((await appel('tremblay', 'GET', `/transports/${dt.id}?etablissement_id=${ids.mb}`)).statut, 200);
  assert.strictEqual((await appel('bouchard', 'GET', `/transports/${dt.id}?etablissement_id=${ids.sl}`)).statut, 404);
  await assert.rejects(pool.query('DELETE FROM demande_transport_evenements'));
  // Annulation par l'établissement d'origine avant la prise en charge
  const co2 = (await pool.query(`INSERT INTO coordinations (numero, type, resident_id, resident_ref, origine_id, destination_id, statut)
    VALUES ('CO-90002', 'retour', $1, 'R-90001', $2, $3, 'acceptee') RETURNING id`, [r0, ids.mb, ch])).rows[0].id;
  const d2 = (await appel('tremblay', 'POST', `/coordinations/${co2}/transport`, { organisation_id: ids.ambB })).corps;
  assert.strictEqual(d2.origine_id, ids.mb, 'retour : demandé par l’hôpital');
  r = await appel('tremblay', 'POST', `/transports/${d2.id}/action`, { etablissement_id: ids.mb, action: 'annuler' }); assert.strictEqual(r.corps.statut, 'annulee');
  assert.strictEqual((await appel('paraB', 'POST', `/secours/transports/${d2.id}/action`, { action: 'accepter', unite_id: ids.u3 })).corps.code, 'transport_clos');
});

test('Arrimo Connect : requêtes signées des systèmes partenaires (répartition, ambulancier), mêmes règles que l’écran, idempotence, isolation', async () => {
  const cx = require('../src/connect');
  // Comme en production (clé exigée au démarrage) : le secret de signature est chiffré au repos
  const cleAvant = process.env.ARRIMO_MFA_ENCRYPTION_KEY; process.env.ARRIMO_MFA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  test.after(() => { if (cleAvant === undefined) delete process.env.ARRIMO_MFA_ENCRYPTION_KEY; else process.env.ARRIMO_MFA_ENCRYPTION_KEY = cleAvant; });
  const sysA = await cx.creerConnecteurSecours(pool, ids.ambA, 'Système ambulancier fictif A');
  const sysCcs = await cx.creerConnecteurSecours(pool, ids.ccs, 'Répartition fictive (CCS)');
  const sysB = await cx.creerConnecteurSecours(pool, ids.ambB, 'Système ambulancier fictif B');
  assert.match(sysA.cle, /^acx_[0-9a-f]{36}$/);
  assert.ok(!(await pool.query('SELECT 1 FROM connecteurs_secours WHERE cle_hash = $1 OR secret = $2', [sysA.cle, sysA.secret])).rowCount, 'ni la clé ni le secret ne sont stockés en clair');
  assert.match((await pool.query('SELECT secret FROM connecteurs_secours WHERE id = $1', [sysA.id])).rows[0].secret, /^enc:v1:/);
  const connect = async (sys, methode, chemin, corps, { horodatage = Date.now(), signature = null } = {}) => {
    const brut = corps ? JSON.stringify(corps) : '';
    const sig = signature || cx.signer(sys.secret, horodatage, methode, `/api${chemin}`, brut);
    const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', 'X-Arrimo-Cle': sys.cle, 'X-Arrimo-Horodatage': String(horodatage), 'X-Arrimo-Signature': sig }, body: corps ? brut : undefined });
    return { statut: r.status, corps: await r.json().catch(() => null) };
  };
  let r = await connect(sysA, 'GET', '/connect/v1/statut');
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps)); assert.deepStrictEqual([r.corps.version, r.corps.type], ['v1', 'ambulancier']);
  assert.strictEqual((await connect(sysA, 'GET', '/connect/v1/statut', null, { signature: 'f'.repeat(64) })).corps.code, 'connect_signature_invalide');
  assert.strictEqual((await connect(sysA, 'GET', '/connect/v1/statut', null, { horodatage: Date.now() - 10 * 60000 })).corps.code, 'connect_horodatage_expire');
  assert.strictEqual((await connect({ ...sysA, cle: 'acx_inconnue' }, 'GET', '/connect/v1/statut')).statut, 401);
  // Corps modifié après signature : refusé
  const corps = { unite_numero: '12-35', destination_id: ids.mb, priorite: 'urgente', categorie: 'traumatologie', delai_min: 18, cle_envoi: 'cad-mission-77001', mission_externe: 'M-77001' };
  const sig = cx.signer(sysA.secret, Date.now(), 'POST', '/api/connect/v1/prealertes', JSON.stringify(corps));
  assert.strictEqual((await connect(sysA, 'POST', '/connect/v1/prealertes', { ...corps, priorite: 'immediate' }, { signature: sig })).statut, 401);
  // Préalerte transmise par le système ambulancier : mêmes règles que l'écran, idempotente
  await pool.query("UPDATE prealertes SET statut = 'annulee' WHERE unite_id = $1 AND statut NOT IN ('cloturee', 'annulee', 'remplacee')", [ids.u2]);
  const [a, b] = await Promise.all([connect(sysA, 'POST', '/connect/v1/prealertes', corps), connect(sysA, 'POST', '/connect/v1/prealertes', corps)]);
  assert.strictEqual(a.statut, 200, JSON.stringify(a.corps)); assert.strictEqual(a.corps.id, b.corps.id);
  assert.deepStrictEqual([a.corps.mission_externe, a.corps.cree_par], ['M-77001', null]);
  assert.strictEqual((await connect(sysA, 'POST', '/connect/v1/prealertes', { ...corps, cle_envoi: 'cad-mission-77002', categorie: 'douleur' })).corps.code, 'prealerte_invalide');
  assert.strictEqual((await connect(sysA, 'POST', '/connect/v1/prealertes', { ...corps, cle_envoi: 'cad-mission-77003', unite_numero: '20-01' })).corps.code, 'unite_introuvable');
  // L'hôpital la voit comme toute préalerte ; l'historique nomme le système
  const f = (await appel('tremblay', 'GET', `/secours/prealertes/${a.corps.id}?etablissement_id=${ids.mb}`)).corps;
  assert.strictEqual(f.evenements[0].detail.systeme, 'Système ambulancier fictif A');
  r = await connect(sysA, 'POST', `/connect/v1/prealertes/${a.corps.numero}/evenements`, { action: 'signaler_arrivee' });
  assert.ok(r.corps.arrivee_signalee_le);
  assert.strictEqual((await connect(sysA, 'POST', `/connect/v1/prealertes/${a.corps.numero}/evenements`, { action: 'confirmer_vehicule', unite_numero: '12-35' })).corps.code, 'action_inconnue');
  assert.strictEqual((await connect(sysA, 'POST', '/connect/v1/unites/12-35/position', { latitude: 45.4, longitude: -71.9 })).statut, 200);
  // Isolation : l'autre entreprise ne voit ni n'agit ; le CCS lit sans agir
  assert.strictEqual((await connect(sysB, 'GET', `/connect/v1/prealertes/${a.corps.numero}`)).statut, 404);
  assert.strictEqual((await connect(sysB, 'POST', `/connect/v1/prealertes/${a.corps.numero}/evenements`, { action: 'annuler' })).statut, 404);
  const lu = (await connect(sysCcs, 'GET', '/connect/v1/prealertes')).corps;
  assert.ok(lu.some((p) => p.numero === a.corps.numero && !('actions' in p)));
  assert.strictEqual((await connect(sysCcs, 'POST', '/connect/v1/prealertes', corps)).statut, 403);
  const urg = (await connect(sysCcs, 'GET', '/connect/v1/urgences')).corps;
  assert.deepStrictEqual(urg.map((h) => h.id).sort(), [ids.mb, ids.sl].sort());
  // Clé désactivée : refus
  await pool.query('UPDATE connecteurs_secours SET actif = false WHERE id = $1', [sysB.id]);
  assert.strictEqual((await connect(sysB, 'GET', '/connect/v1/statut')).statut, 401);
});
