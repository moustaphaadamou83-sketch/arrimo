'use strict';
/**
 * Centre de commandement CCS, flotte connectée, communication et interconnexion (cahiers des 27-28 nov. 2026).
 * Base PostgreSQL de test (TEST_DATABASE_URL), données fictives : aucune identité, aucune donnée clinique.
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
const R = require('../src/registre-modules');
const FL = require('../src/flotte-ccs');

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
let pool; let serveur; let base; const tokens = {}; const ids = {};
async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${tokens[qui]}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
async function compte(email, role, orgId) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [email, email, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (orgId) await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, orgId]);
  return u;
}
async function connecter(q, email) { const r = await appel(null, 'POST', '/connexion', { email, mot_de_passe: MOT_DE_PASSE_DEMO }); assert.strictEqual(r.statut, 200, q); tokens[q] = r.corps.token; }

test.before(async () => {
  process.env.ARRIMO_ROUTEUR_URL = 'http://routeur-fictif.test';
  routage.definirFetchTest(async (url) => routeurFictif(url));
  pool = creerPool(process.env.TEST_DATABASE_URL);
  await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const cfg = (await pool.query("SELECT config_id FROM etablissements WHERE code = 'MB'")).rows[0].config_id;
  ids.mb = (await pool.query("SELECT id FROM etablissements WHERE code = 'MB'")).rows[0].id; ids.sl = (await pool.query("SELECT id FROM etablissements WHERE code = 'SL'")).rows[0].id;
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"liaison_secours": true}' WHERE code IN ('MB', 'SL')`);
  const org = async (code, type, profils) => (await pool.query('INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ($1, $1, $2, $3, $4) RETURNING id', [code, type, profils, cfg])).rows[0].id;
  ids.ambA = await org('AMB-A', 'ambulancier', ['ambulance']); ids.ambB = await org('AMB-B', 'ambulancier', ['ambulance']); ids.ccs = await org('CCS-T', 'ccs', ['ccs']);
  const unite = async (o, n) => (await pool.query('INSERT INTO unites_secours (organisation_id, numero) VALUES ($1, $2) RETURNING id', [o, n])).rows[0].id;
  ids.u1 = await unite(ids.ambA, 'A-1'); ids.u2 = await unite(ids.ambA, 'A-2'); ids.u3 = await unite(ids.ambB, 'B-1');
  // Flotte importante : 60 véhicules supplémentaires, tous accessibles depuis l'accueil (jamais limité à 5 ou 6)
  for (let i = 0; i < 60; i += 1) await unite(ids.ambB, `B-${100 + i}`);
  await compte('para.a@t.arrimo', 'paramedic', ids.ambA); await compte('sup.a@t.arrimo', 'superviseur_secours', ids.ambA); await compte('para.b@t.arrimo', 'paramedic', ids.ambB);
  await compte('ccs1@t.arrimo', 'repartiteur', ids.ccs); await compte('ccs2@t.arrimo', 'repartiteur', ids.ccs);
  for (const [q, e] of [['para', 'para.a@t.arrimo'], ['sup', 'sup.a@t.arrimo'], ['paraB', 'para.b@t.arrimo'], ['ccs', 'ccs1@t.arrimo'], ['ccs2', 'ccs2@t.arrimo'], ['tremblay', 'tremblay@demo.arrimo'], ['bouchard', 'bouchard@demo.arrimo']]) await connecter(q, e);
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('Flotte : toute la flotte du CCS (statuts harmonisés, sans double comptage), périmètre de l’équipage limité à son organisation', async () => {
  const f = (await appel('ccs', 'GET', '/secours/flotte')).corps;
  assert.strictEqual(f.total, 63); assert.strictEqual(f.vehicules.length, 63, 'aucune limite à quelques véhicules');
  assert.strictEqual(Object.values(f.compteurs).reduce((a, b) => a + b, 0), f.total, 'un véhicule = un statut');
  assert.deepStrictEqual(f.seuils, { ...FL.SEUILS_DEFAUT, source: 'defaut' });
  const p = (await appel('para', 'GET', '/secours/flotte')).corps;
  assert.deepStrictEqual(p.vehicules.map((v) => v.numero).sort(), ['A-1', 'A-2']);
  assert.strictEqual((await appel('tremblay', 'GET', '/secours/flotte')).statut, 403);
  const page = (await appel('ccs', 'GET', '/secours/flotte?taille=20&page=2')).corps;
  assert.strictEqual(page.vehicules.length, 20); assert.strictEqual(page.total, 63);
});

test('Mission : envoyée ≠ reçue ≠ consultée ≠ acceptée ; doublons sans effet ; le CCS voit le statut tout de suite', async () => {
  const m = (await appel('ccs', 'POST', '/secours/missions', { unite_id: ids.u1, lieu: 'Point fictif C', priorite: 'urgente', categorie: 'medicale', instructions: 'Entrée côté stationnement', destination_id: ids.mb })).corps;
  assert.ok(m.id); ids.m = m.id;
  let v = (await appel('ccs', 'GET', '/secours/flotte')).corps.vehicules.find((x) => x.id === ids.u1);
  assert.strictEqual(v.statut, 'mission_affectee'); assert.strictEqual(v.mission.transmission.recue_le, null, 'jamais « reçue » parce qu’envoyée');
  assert.strictEqual(v.mission.instructions, 'Entrée côté stationnement');
  assert.strictEqual((await appel('ccs', 'POST', `/secours/missions/${m.id}/recue`, {})).statut, 403, 'seul l’appareil de l’équipage accuse réception');
  assert.strictEqual((await appel('paraB', 'POST', `/secours/missions/${m.id}/recue`, {})).statut, 404, 'autre entreprise : introuvable');
  const r1 = (await appel('para', 'POST', `/secours/missions/${m.id}/recue`, {})).corps; const r2 = (await appel('para', 'POST', `/secours/missions/${m.id}/recue`, {})).corps;
  assert.ok(r1.recue_le); assert.strictEqual(r2.recue_le, r1.recue_le, 'événement dupliqué sans effet');
  assert.ok((await appel('para', 'POST', `/secours/missions/${m.id}/consultee`, {})).corps.consultee_le);
  assert.strictEqual((await pool.query("SELECT count(*)::int n FROM mission_ccs_evenements WHERE mission_id = $1 AND statut = 'recue'", [m.id])).rows[0].n, 1);
  assert.strictEqual((await appel('para', 'POST', `/secours/missions/${m.id}/action`, { action: 'accepter' })).statut, 200);
  v = (await appel('ccs2', 'GET', '/secours/flotte')).corps.vehicules.find((x) => x.id === ids.u1);
  assert.strictEqual(v.statut, 'en_route', 'un second compte CCS voit le même statut');
  const fiche = (await appel('ccs', 'GET', `/secours/flotte/${ids.u1}`)).corps;
  assert.ok(fiche.chronologie.some((e) => e.type === 'mission' && e.code === 'recue')); assert.ok(fiche.phases.some((p) => p.phase === 'acceptation'));
});

test('Communication : messages rapides, idempotence après reconnexion, accusé par le destinataire seulement, modification de destination tracée', async () => {
  const cle = 'reprise-0001';
  const a = (await appel('para', 'POST', '/secours/messages', { unite_id: ids.u1, genre: 'retard', code_rapide: 'retard_trafic', cle })).corps;
  const b = (await appel('para', 'POST', '/secours/messages', { unite_id: ids.u1, genre: 'retard', code_rapide: 'retard_trafic', cle })).corps;
  assert.strictEqual(b.id, a.id, 'même clé : aucun doublon');
  assert.strictEqual((await appel('para', 'POST', '/secours/messages', { unite_id: ids.u1, genre: 'instruction', texte: 'x' })).statut, 400, 'l’équipage ne donne pas d’instruction');
  assert.strictEqual((await appel('para', 'POST', '/secours/messages', { unite_id: ids.u1, code_rapide: 'inconnu' })).statut, 400);
  assert.strictEqual((await appel('para', 'POST', `/secours/messages/${a.id}/lu`, {})).statut, 409, 'l’auteur ne confirme pas sa propre lecture');
  assert.ok((await appel('ccs', 'POST', `/secours/messages/${a.id}/lu`, {})).corps.lu_le);
  assert.strictEqual((await appel('paraB', 'GET', `/secours/flotte/${ids.u1}/messages`)).statut, 404, 'confidentialité entre entreprises');
  const m = (await pool.query('SELECT version FROM missions_ccs WHERE id = $1', [ids.m])).rows[0];
  assert.strictEqual((await appel('para', 'POST', `/secours/missions/${ids.m}/modifier`, { destination_id: ids.sl })).statut, 403);
  assert.strictEqual((await appel('ccs', 'POST', `/secours/missions/${ids.m}/modifier`, { destination_id: ids.sl, version: m.version })).statut, 200);
  const fil = (await appel('para', 'GET', `/secours/flotte/${ids.u1}/messages`)).corps;
  assert.ok(fil.some((x) => x.sens === 'ccs' && x.genre === 'destination' && !x.lu_le), 'l’équipage reçoit la modification, à confirmer');
  assert.strictEqual((await appel('ccs', 'POST', `/secours/missions/${ids.m}/modifier`, { destination_id: ids.mb, version: m.version })).corps.code, 'version_perimee');
});

test('Interconnexion : l’urgence de destination échange avec l’ambulance ; un autre établissement non', async () => {
  const sl = (await appel('bouchard', 'GET', `/etablissement/flotte?etablissement_id=${ids.sl}`)).corps;
  assert.ok(sl.unites.some((u) => u.id === ids.u1));
  assert.strictEqual((await appel('bouchard', 'POST', '/etablissement/flotte/messages', { etablissement_id: ids.sl, unite_id: ids.u1, code_rapide: 'accueil_pret', cle: 'accueil-0001' })).statut, 200);
  assert.strictEqual((await appel('tremblay', 'POST', '/etablissement/flotte/messages', { etablissement_id: ids.mb, unite_id: ids.u1, code_rapide: 'accueil_pret' })).statut, 404, 'MB n’est plus la destination');
  assert.strictEqual((await appel('tremblay', 'GET', `/etablissement/flotte?etablissement_id=${ids.sl}`)).statut, 403);
  const fil = (await appel('ccs', 'GET', `/secours/flotte/${ids.u1}/messages`)).corps;
  assert.ok(fil.some((x) => x.sens === 'etablissement' && x.code_rapide === 'accueil_pret'), 'le CCS voit la confirmation de l’urgence');
});

test('Seuils d’immobilisation : défaut 20/30, réglés depuis SH ; alerte au CCS, jamais de réorientation', async () => {
  await pool.query("UPDATE etats_vehicules SET modifie_le = now() - interval '25 minutes' WHERE unite_id = $1", [ids.u2]).catch(() => null);
  await pool.query("INSERT INTO etats_vehicules (unite_id, etat, source, modifie_le) VALUES ($1, 'a_l_hopital', 'equipage', now() - interval '25 minutes') ON CONFLICT (unite_id) DO UPDATE SET etat = 'a_l_hopital', modifie_le = now() - interval '25 minutes'", [ids.u2]);
  let v = (await appel('ccs', 'GET', '/secours/flotte')).corps.vehicules.find((x) => x.id === ids.u2);
  assert.strictEqual(v.niveau, 'orange'); assert.ok(v.conditions.includes('immobilisation')); assert.strictEqual(v.statut, 'arrive_destination', 'condition ajoutée au statut, jamais un statut de plus');
  await FL.definirSeuils(pool, ids.ccs, { vigilance_min: 10, escalade_min: 20 }, 'test');
  v = (await appel('ccs', 'GET', '/secours/flotte')).corps.vehicules.find((x) => x.id === ids.u2);
  assert.strictEqual(v.niveau, 'rouge');
  assert.ok((await appel('ccs', 'GET', '/secours/flotte/alertes')).corps.some((a) => a.unite_id === ids.u2));
  await assert.rejects(FL.definirSeuils(pool, ids.ccs, { vigilance_min: 30, escalade_min: 20 }), (e) => e.code === 'seuils_invalides');
  assert.strictEqual((await pool.query("SELECT count(*)::int n FROM missions_ccs WHERE unite_id = $1", [ids.u2])).rows[0].n, 0, 'aucune mission ni destination créée par un seuil');
});

test('Historique paginé et synthèse (moyenne, médiane, dernier) ; les données restent entières', async () => {
  assert.strictEqual((await appel('para', 'POST', `/secours/missions/${ids.m}/action`, { action: 'terminer' })).statut, 200);
  const h = (await appel('ccs', 'GET', '/secours/flotte/historique?taille=5')).corps;
  assert.ok(h.total >= 1); assert.ok(h.lignes.length <= 5); assert.ok(h.synthese.terminees >= 1);
  assert.ok(h.synthese.mediane_min != null && h.synthese.moyenne_min != null && h.synthese.dernier);
  assert.strictEqual((await appel('para', 'GET', `/secours/flotte/historique?unite_id=${ids.u3}`)).statut, 404, 'hors périmètre');
});

test('Activation depuis SH : un module de secours désactivé disparaît et son API est refusée ; réactivation sans perte', async () => {
  await pool.query(`UPDATE organisations_secours SET modules = '{"sm:ccs.historique": false}' WHERE id = $1`, [ids.ccs]);
  assert.strictEqual((await appel('ccs', 'GET', '/secours/flotte/historique')).statut, 403);
  assert.ok(!R.modulesSecours('ccs', [{ modules: { 'sm:ccs.historique': false } }]).includes('historique'));
  const moi = (await appel('ccs', 'GET', '/moi')).corps; assert.strictEqual(moi.organisations[0].modules['sm:ccs.historique'], false);
  await pool.query('UPDATE organisations_secours SET modules = NULL WHERE id = $1', [ids.ccs]);
  assert.ok((await appel('ccs', 'GET', '/secours/flotte/historique')).corps.total >= 1, 'données intactes après réactivation');
});

test('OG proactif du CCS : plans sans valeur inventée, prévisions par horizon, signature stable sans changement', async () => {
  const o = (await appel('ccs', 'GET', '/secours/og-ccs')).corps;
  assert.deepStrictEqual(o.horizons, [15, 30, 60, 120]);
  for (const r of o.recommandations) for (const p of r.plans) { assert.ok(['A', 'B', 'C'].includes(p.plan)); if (!r.position_connue) assert.strictEqual(p.temps_min, null, 'sans position : aucun temps inventé'); }
  for (const d of o.disponibilites) assert.ok(['maintenant', 'declaree', 'inconnue'].includes(d.categorie));
  assert.strictEqual((await appel('ccs', 'GET', '/secours/og-ccs')).corps.signature, o.signature, 'aucune notification sans changement');
  assert.strictEqual((await appel('para', 'GET', '/secours/og-ccs')).statut, 403);
});

test('Composant temporel : durées du cahier, jours sur une ligne et HH:MM:SS sur la suivante', () => {
  global.document = { documentElement: { lang: 'fr' }, querySelectorAll: () => [] }; global.window = { ArrimoHorloge: { maintenant: () => Date.now() } };
  const si = global.setInterval; global.setInterval = () => 0; require('../public/vue-transferts.js'); global.setInterval = si;
  const D = global.window.ArrimoDuree; const txt = (s) => D.anneauHtml(s * 1000).replace(/<[^>]+>/g, '|').split('|').filter(Boolean);
  assert.deepStrictEqual(txt(5), ['00:00:05']); assert.deepStrictEqual(txt(3599), ['00:59:59']); assert.deepStrictEqual(txt(46799), ['12:59:59']); assert.deepStrictEqual(txt(86399), ['23:59:59']);
  assert.deepStrictEqual(txt(97015), ['1 jour', '02:56:55']); assert.deepStrictEqual(txt(909959), ['10 jours', '12:45:59']); assert.deepStrictEqual(txt(1066532), ['12 jours', '08:15:32']);
});
