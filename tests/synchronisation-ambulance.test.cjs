'use strict';
/**
 * Synchronisation ambulance → établissements (26 nov. 2026, cahier V4 §4).
 * Chaque confirmation de l'équipage (sur place, prise en charge, arrivée, remise, libération) doit :
 *  - envoyer le signal en direct APRÈS la validation (l'écran qui relit voit déjà le nouveau statut) ;
 *  - aviser l'établissement d'origine ;
 *  - refuser une double confirmation.
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
const flux = require('../src/flux');

let pool; let serveur; let base; const tok = {}; const ids = {}; const envAvant = process.env.ARRIMO_ENV;
async function appel(qui, m, c, b) { const r = await fetch(`${base}/api${c}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok[qui]}` }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { s: r.status, d }; }
async function compte(cle, role, { etab, org } = {}) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [`${cle}@demo.arrimo`, `Nom ${cle}`, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (etab) await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etab]);
  if (org) await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, org]);
  tok[cle] = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${cle}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
  return u;
}
/** Attend le prochain signal en direct et lit, à cet instant, le statut enregistré (autre connexion que celle de l'action). */
function prochainSignal() {
  return new Promise((ok, ko) => {
    const minuterie = setTimeout(() => ko(new Error('aucun signal en direct')), 3000);
    flux.bus.once('secours', async () => {
      clearTimeout(minuterie);
      ok((await pool.query('SELECT statut, sur_place_le, remis_le, terminee_le FROM demandes_transport WHERE id = $1', [ids.dt])).rows[0]);
    });
  });
}

test.before(async () => {
  process.env.ARRIMO_ENV = 'demo'; require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const h = (await pool.query("SELECT id, config_id, latitude, longitude FROM etablissements WHERE code = 'MB'")).rows[0]; ids.h = h.id;
  ids.c = (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, module_actif, type_etablissement)
    VALUES ('CH-S', 'CHSLD synchro', 'Ville', $1, $2, $3, true, 'chsld') RETURNING id`, [h.latitude + 0.01, h.longitude, h.config_id])).rows[0].id;
  ids.org = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('AMB-S', 'Ambulances synchro', 'ambulancier', '{ambulance}', $1) RETURNING id", [h.config_id])).rows[0].id;
  ids.unite = (await pool.query("INSERT INTO unites_secours (organisation_id, numero, plaque) VALUES ($1, 'SIM-07', 'SYN 007') RETURNING id", [ids.org])).rows[0].id;
  // Transport CHSLD → urgences de l'hôpital, ambulance déjà en route vers le CHSLD
  ids.dt = (await pool.query(`INSERT INTO demandes_transport (numero, organisation_id, origine_id, destination_id, resident_ref, statut, heure_souhaitee, plage_debut, plage_fin, unite_id, motif_transport, type_vehicule)
    VALUES ('DT-000777', $1, $2, $3, 'P-00777', 'en_route', now(), now(), now() + interval '1 hour', $4, 'transfert_stable', 'ambulance') RETURNING id`, [ids.org, ids.c, ids.h, ids.unite])).rows[0].id;
  await compte('para', 'paramedic', { org: ids.org });
});
test.after(async () => { serveur?.close(); await pool?.end(); if (envAvant === undefined) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = envAvant; });

test('Chaque confirmation de l’ambulance est signalée en direct après enregistrement et avise l’origine', async () => {
  const attendus = { sur_place: (d) => d.sur_place_le, pris_en_charge: (d) => d.statut === 'pris_en_charge', arrivee: (d) => d.statut === 'arrivee', remis: (d) => d.remis_le, terminer: (d) => d.terminee_le };
  for (const [action, verifier] of Object.entries(attendus)) {
    const signal = prochainSignal();
    const r = await appel('para', 'POST', `/secours/transports/${ids.dt}/action`, { action });
    assert.strictEqual(r.s, 200, `${action} ${JSON.stringify(r.d)}`);
    const vu = await signal;
    assert.ok(verifier(vu), `${action} : l'écran qui relit au signal voit le nouvel état (${JSON.stringify(vu)})`);
  }
  const codes = (await pool.query('SELECT code FROM notifications WHERE etablissement_id = $1', [ids.c])).rows.map((x) => x.code);
  for (const c of ['transport_sur_place', 'transport_pris_en_charge', 'transport_arrivee', 'transport_remis', 'transport_terminer']) assert.ok(codes.includes(c), `origine avisée : ${c}`);
  const msg = (await pool.query("SELECT message FROM notifications WHERE code = 'transport_sur_place'")).rows[0].message;
  assert.ok(!/undefined|notif\./.test(msg), `texte traduit : ${msg}`);
});

test('Double confirmation refusée, sans nouvel avis', async () => {
  const avant = (await pool.query('SELECT count(*)::int n FROM notifications WHERE etablissement_id = $1', [ids.c])).rows[0].n;
  for (const action of ['sur_place', 'remis', 'terminer']) assert.strictEqual((await appel('para', 'POST', `/secours/transports/${ids.dt}/action`, { action })).s, 409, action);
  assert.strictEqual((await pool.query('SELECT count(*)::int n FROM notifications WHERE etablissement_id = $1', [ids.c])).rows[0].n, avant);
});

test('Préalerte 911 : arrivée estimée par GPS dès l’envoi, sans délai manuel ; rien d’inventé sans position', async () => {
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"liaison_secours": true}' WHERE id = $1`, [ids.h]);
  const h = (await pool.query('SELECT latitude, longitude FROM etablissements WHERE id = $1', [ids.h])).rows[0];
  // Unité sans position : la préalerte part sans heure inventée
  const u2 = (await pool.query("INSERT INTO unites_secours (organisation_id, numero, plaque) VALUES ($1, 'SIM-08', 'SYN 008') RETURNING id", [ids.org])).rows[0].id;
  const sans = await appel('para', 'POST', '/secours/prealertes', { unite_id: u2, destination_id: ids.h, priorite: 'urgente', categorie: 'medicale' });
  assert.strictEqual(sans.s, 200, JSON.stringify(sans.d));
  assert.strictEqual(sans.d.heure_prevue, null, 'aucune heure inventée sans GPS ni estimation manuelle');
  assert.ok(!sans.d.eta, 'aucune ETA sans position');
  // Unité avec une position récente à environ 5 km : ETA calculée par le routeur (fictif en test) dès l'envoi
  assert.strictEqual((await appel('para', 'POST', `/secours/unites/${ids.unite}/position`, { latitude: h.latitude + 0.045, longitude: h.longitude })).s, 200);
  const signal = new Promise((ok) => flux.bus.once('secours', ok));
  const avec = await appel('para', 'POST', '/secours/prealertes', { unite_id: ids.unite, destination_id: ids.h, priorite: 'urgente', categorie: 'medicale' });
  assert.strictEqual(avec.s, 200, JSON.stringify(avec.d));
  assert.ok(avec.d.eta && avec.d.eta.minutes > 0 && avec.d.eta.distance_km > 0, `ETA GPS : ${JSON.stringify(avec.d.eta)}`);
  assert.strictEqual(avec.d.eta.source, 'osrm');
  assert.ok((await pool.query('SELECT heure_prevue FROM prealertes WHERE id = $1', [avec.d.id])).rows[0].heure_prevue, 'heure d’arrivée prévue tirée du trajet routier');
  await signal;
});

test('Écran Embarqué : trois onglets (Mission, Chrono, Historique), OG en bas ; le superviseur garde ses transports', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'secours.js'), 'utf8');
  assert.match(src, /amb: \['mission', 'chrono', 'historique', 'og'\]/);
  assert.match(src, /sup: \['mission', 'transports', 'chrono', 'historique', 'og'\]/);
  assert.match(src, /const EN_BAS = \['og'\]/);
  assert.match(src, /delai: null \}/, 'aucun délai manuel choisi par défaut');
  assert.ok(!/amb: \[[^\]]*'urgences'/.test(src), 'pas d’urgences classées côté équipage');
});

test('Chrono seul (sans Liaison Secours) : alimenté par le logiciel externe autorisé ; l’écran Arrimo reste refusé', async () => {
  const cx = require('../src/connect');
  const cleAvant = process.env.ARRIMO_MFA_ENCRYPTION_KEY; process.env.ARRIMO_MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  try {
    // Le module se choisit seul dans le catalogue SH : aucune dépendance imposée
    const TE = require('../src/types-etablissement');
    const chrono = TE.MODULES.find((m) => m.code === 'chrono');
    assert.ok(chrono && !(chrono.dependances || []).length, 'Chrono activable sans Liaison Secours');
    await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"liaison_secours": false, "chrono": true}' WHERE id = $1`, [ids.h]);
    await pool.query("INSERT INTO unites_secours (organisation_id, numero, plaque) VALUES ($1, 'SIM-09', 'SYN 009')", [ids.org]);
    const sys = await cx.creerConnecteurSecours(pool, ids.org, 'Logiciel ambulancier fictif');
    const corps = { unite_numero: 'SIM-09', destination_id: ids.h, priorite: 'urgente', categorie: 'medicale', cle_envoi: 'ext-mission-0909', mission_externe: 'EXT-0909' };
    const brut = JSON.stringify(corps); const h = Date.now();
    const r = await fetch(`${base}/api/connect/v1/prealertes`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Arrimo-Cle': sys.cle, 'X-Arrimo-Horodatage': String(h), 'X-Arrimo-Signature': cx.signer(sys.secret, h, 'POST', '/api/connect/v1/prealertes', brut) }, body: brut });
    const d = await r.json();
    assert.strictEqual(r.status, 200, JSON.stringify(d));
    assert.strictEqual(d.mission_externe, 'EXT-0909');
    // Sans Liaison Secours, l'équipage n'envoie pas de préalerte par l'écran Arrimo
    const ecran = await appel('para', 'POST', '/secours/prealertes', { unite_id: ids.unite, destination_id: ids.h, priorite: 'urgente', categorie: 'medicale' });
    assert.strictEqual(ecran.d.code, 'liaison_secours_inactive');
  } finally { if (cleAvant === undefined) delete process.env.ARRIMO_MFA_ENCRYPTION_KEY; else process.env.ARRIMO_MFA_ENCRYPTION_KEY = cleAvant; }
});

test('Écran CCS : quatre espaces (Missions, Capacités, Chrono, Historique), quatre indicateurs, actifs et clos jamais répétés', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'secours.js'), 'utf8');
  assert.match(src, /ccs: \['missions', 'capacites', 'chrono', 'historique', 'og'\]/);
  const kpi = src.slice(src.indexOf('function chiffresCcs()'), src.indexOf('/** Couverture de la région'));
  assert.strictEqual((kpi.match(/\$\{tuile\(/g) || []).length, 4, 'quatre indicateurs essentiels');
  assert.match(src, /vue\.kanban\(actifs, \{ colonne: vue\.colonneTransport, maxClos: 0/, 'tableau de bord : transports actifs seulement, colonnes communes');
  assert.match(src, /historique: historiqueRecherche\(fermees, etat\.transports\)/, 'clos et recherche dans l’Historique');
  const vue = fs.readFileSync(path.join(__dirname, '..', 'public', 'vue-transferts.js'), 'utf8');
  assert.match(vue, /seulement === 'clos'/);
});

test('Colonnes communes (référence : transferts interhospitaliers) : chaque statut de transport à sa place, règles inchangées', () => {
  const vm = require('node:vm'); const fs = require('node:fs'); const path = require('node:path');
  const c = { window: {}, document: { documentElement: { lang: 'fr-CA' } } }; vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'vue-transferts.js'), 'utf8'), c);
  const v = c.window.ArrimoVueTransferts;
  const col = (d) => v.colonneTransport(d);
  assert.strictEqual(col({ statut: 'a_valider' }), 'demande'); assert.strictEqual(col({ statut: 'demandee' }), 'demande');
  assert.strictEqual(col({ statut: 'acceptee' }), 'validee'); assert.strictEqual(col({ statut: 'acceptee', unite_id: 4 }), 'transport');
  assert.strictEqual(col({ statut: 'en_route' }), 'en_route'); assert.strictEqual(col({ statut: 'pris_en_charge' }), 'en_route');
  assert.strictEqual(col({ statut: 'arrivee' }), 'recu'); assert.strictEqual(col({ statut: 'refusee' }), 'refuse'); assert.strictEqual(col({ statut: 'annulee' }), 'refuse');
  // Mêmes colonnes et mêmes couleurs que la vue de référence (app.js, STATUTS)
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  for (const [k, couleur] of v.COLONNES) assert.ok(app.includes(`['${k}', '${couleur}']`), `${k} : même couleur que la référence`);
  const html = v.kanban([{ numero: 'DT-1', statut: 'demandee' }], { colonne: col, carte: (d) => d.numero });
  assert.strictEqual((html.match(/class="col"/g) || []).length, 6);
  assert.match(html, /Demande <span class="num">1<\/span>/);
});
