'use strict';
/** Chrono T−5 (27 nov. 2026) : patient prêt au transfert (origine), accueil prêt (destination), historique, synchronisation. Données fictives. */
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
const ch = (b) => appel('ch', 'POST', `/transports/${ids.dt}/action`, { etablissement_id: ids.c, ...b });
const hop = (b) => appel('hop', 'POST', `/transports/${ids.dt}/action`, { etablissement_id: ids.h, ...b });

test.before(async () => {
  process.env.ARRIMO_ENV = 'demo'; require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const h = (await pool.query("SELECT id, config_id, latitude, longitude FROM etablissements WHERE code = 'MB'")).rows[0]; ids.h = h.id;
  ids.c = (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, module_actif, type_etablissement)
    VALUES ('CH-T5', 'CHSLD T5', 'Ville', $1, $2, $3, true, 'chsld') RETURNING id`, [h.latitude + 0.01, h.longitude, h.config_id])).rows[0].id;
  ids.org = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('AMB-T5', 'Ambulances T5', 'ambulancier', '{ambulance}', $1) RETURNING id", [h.config_id])).rows[0].id;
  ids.unite = (await pool.query("INSERT INTO unites_secours (organisation_id, numero, plaque) VALUES ($1, 'SIM-05', 'T5 005') RETURNING id", [ids.org])).rows[0].id;
  // CHSLD → hôpital, ambulance en route ; arrivée estimée transmise par l'équipage : 12 min
  ids.dt = (await pool.query(`INSERT INTO demandes_transport (numero, organisation_id, origine_id, destination_id, resident_ref, statut, heure_souhaitee, plage_debut, plage_fin, unite_id, motif_transport, type_vehicule, prealerte_le, prealerte_eta_min, prealerte_eta_le)
    VALUES ('DT-000505', $1, $2, $3, 'P-00505', 'acceptee', now(), now(), now() + interval '1 hour', $4, 'transfert_stable', 'ambulance', now(), 12, now()) RETURNING id`, [ids.org, ids.c, ids.h, ids.unite])).rows[0].id;
  await compte('ch', 'coordonnateur', { etab: ids.c }); await compte('hop', 'coordonnateur', { etab: ids.h }); await compte('para', 'paramedic', { org: ids.org });
});
test.after(async () => { serveur?.close(); await pool?.end(); if (envAvant === undefined) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = envAvant; });

test('Origine : préparation en cours puis patient prêt au transfert ; heure, auteur et arrivée estimée enregistrés ; signal en direct', async () => {
  assert.strictEqual((await ch({ action: 'etat_patient', etat: 'en_cours' })).s, 200);
  const signal = new Promise((ok) => flux.bus.once('secours', ok));
  const r = await ch({ action: 'etat_patient', etat: 'pret' });
  assert.strictEqual(r.s, 200, JSON.stringify(r.d)); await signal;
  assert.strictEqual(r.d.patient_etat, 'pret'); assert.ok(r.d.patient_pret_le); assert.ok(r.d.patient_pret_par);
  assert.ok(r.d.patient_pret_eta_min >= 11 && r.d.patient_pret_eta_min <= 12, `ETA au moment de la confirmation : ${r.d.patient_pret_eta_min}`);
  assert.strictEqual((await ch({ action: 'etat_patient', etat: 'pret' })).d.deja, true, 'pas de double confirmation');
  // L'équipage voit l'indicateur
  const amb = (await appel('para', 'GET', '/secours/transports')).d;
  const vu = (Array.isArray(amb) ? amb : amb.transports || []).find((x) => x.id === ids.dt);
  assert.strictEqual(vu?.patient_etat, 'pret', 'l’ambulancier reçoit « patient prêt »');
});

test('Prêt puis temporairement indisponible : état courant corrigé, historique conservé, motif fermé', async () => {
  const r = await ch({ action: 'etat_patient', etat: 'indisponible', motif: 'examen' });
  assert.strictEqual(r.s, 200); assert.strictEqual(r.d.patient_pret_le, null); assert.strictEqual(r.d.patient_etat_motif, 'examen');
  assert.strictEqual((await ch({ action: 'etat_patient', etat: 'retarde', motif: 'texte libre interdit' })).d.patient_etat_motif, 'autre', 'motif hors liste → autre');
  assert.strictEqual((await ch({ action: 'etat_patient', etat: 'inconnu' })).s, 400);
  const ev = (await pool.query("SELECT detail->>'etat' AS etat FROM demande_transport_evenements WHERE demande_id = $1 AND type = 'etat_patient' ORDER BY id", [ids.dt])).rows.map((x) => x.etat);
  assert.deepStrictEqual(ev, ['en_cours', 'pret', 'indisponible', 'retarde'], 'chaque changement reste dans l’historique');
});

test('Destination : accueil prêt pour la réception ; chaque côté ne fait que son action ; l’ambulance n’est jamais bloquée', async () => {
  assert.ok((await hop({ action: 'etat_patient', etat: 'pret' })).s >= 400, 'la destination ne déclare pas le patient prêt');
  assert.ok((await ch({ action: 'accueil_pret' })).s >= 400, 'l’origine ne déclare pas l’accueil prêt');
  const r = await hop({ action: 'accueil_pret' });
  assert.strictEqual(r.s, 200, JSON.stringify(r.d)); assert.ok(r.d.accueil_pret_le); assert.ok(r.d.accueil_pret_eta_min != null);
  assert.strictEqual((await hop({ action: 'accueil_pret' })).d.deja, true);
  // Patient « retardé » : l'ambulance part quand même (objectif organisationnel, jamais bloquant)
  assert.strictEqual((await appel('para', 'POST', `/secours/transports/${ids.dt}/action`, { action: 'en_route' })).s, 200);
});

test('Durées au format HH:MM:SS, jours au-delà de 24 h ; inconnu jamais affiché comme zéro', () => {
  const vm = require('node:vm'); const fs = require('node:fs'); const path = require('node:path');
  const c = { window: {}, document: { documentElement: { lang: 'fr-CA' } } }; vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'vue-transferts.js'), 'utf8'), c);
  const { hhmmss } = c.window.ArrimoDuree;
  assert.strictEqual(hhmmss(324000), '00:05:24'); assert.strictEqual(hhmmss(4123000), '01:08:43');
  assert.strictEqual(hhmmss((3 * 86400 + 8 * 3600 + 12 * 60 + 38) * 1000), '3 jours 08:12:38');
  assert.strictEqual(hhmmss(NaN), '--:--:--');
  const html = c.window.ArrimoVueTransferts.preparation({ destination_id: 1, patient_etat: 'pret', patient_pret_le: new Date().toISOString(), prealerte_eta_min: 10, prealerte_eta_le: new Date().toISOString() }, { heure: () => '12 h 00' });
  assert.match(html, /prep-badge ok">Patient prêt au transfert · 12 h 00/); assert.match(html, /Objectif T−5/); assert.match(html, /Accueil : non confirmé/);
});

test('Indicateurs T−5 : taux observés (accueil prêt à T−5), motifs de non-préparation ; inconnu sans mesure, jamais 0 %', async () => {
  const hopital = (await appel('hop', 'GET', `/chrono/universel?etablissement_id=${ids.h}`)).d.performance_t5;
  assert.strictEqual(hopital.accueils_mesures, 1); assert.strictEqual(hopital.accueils_prets_t5_pct, 100);
  assert.strictEqual(hopital.patients_prets_t5_pct, null, 'aucun patient mesuré à l’hôpital : inconnu');
  const chsld = (await appel('ch', 'GET', `/chrono/universel?etablissement_id=${ids.c}`)).d.performance_t5;
  const motifs = Object.fromEntries(chsld.motifs_non_preparation.map((m) => [m.motif, m.n]));
  assert.deepStrictEqual(motifs, { examen: 1, autre: 1 });
});
