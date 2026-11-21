'use strict';
/** Correctifs de l'audit du 20 nov. 2026 : COR-001 (transport NSA), COR-002 (avant l'appel), COR-003 (mode crise), COR-004 (compteur civières). */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');

let pool; let serveur; let base; const tok = {}; const ids = {};
async function appel(qui, m, c, b) { const r = await fetch(`${base}/api${c}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok[qui]}` }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { s: r.status, d }; }
async function compte(cle, role, { etab, org } = {}) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [`${cle}@demo.arrimo`, cle, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (etab) await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etab]);
  if (org) await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, org]);
  tok[cle] = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${cle}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token; assert.ok(tok[cle], cle);
  return u;
}
test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const h = (await pool.query("SELECT id, config_id, latitude, longitude FROM etablissements WHERE code = 'MB'")).rows[0]; ids.h = h.id;
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"liaison_chsld": true, "transport_planifie": true}' WHERE id = $1`, [h.id]);
  ids.c = (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, module_actif, type_etablissement, modules) VALUES ('CH-T', 'CHSLD test', 'Ville', $1, $2, $3, true, 'chsld', '{"transport_planifie": true}') RETURNING id`,
    [h.latitude + 0.01, h.longitude, h.config_id])).rows[0].id;
  ids.org = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('AMB-T', 'Ambulances test', 'ambulancier', '{ambulance}', $1) RETURNING id", [h.config_id])).rows[0].id;
  ids.ccs = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('CCS-T', 'CCS test', 'ccs', '{ccs}', $1) RETURNING id", [h.config_id])).rows[0].id;
  ids.lit = (await pool.query("SELECT id, code FROM lits WHERE etablissement_id = $1 AND etat = 'libre' ORDER BY id LIMIT 1", [h.id])).rows[0];
  await pool.query("UPDATE lits SET etat = 'occupe', patient_ref = 'P-64673' WHERE id = $1", [ids.lit.id]);
  ids.d = (await pool.query(`INSERT INTO demandes_hebergement (etablissement_id, numero, provenance, reference_externe, statut, hopital_id, hopital_lit_id, documents)
    VALUES ($1, 'DH-T001', 'hopital', 'P-64673', 'acceptee', $2, $3, '[]') RETURNING id`, [ids.c, h.id, ids.lit.id])).rows[0].id;
  await compte('coord.h', 'coordonnateur', { etab: h.id }); await compte('coord.c', 'coordonnateur', { etab: ids.c });
  await compte('para', 'paramedic', { org: ids.org }); await compte('ccs', 'repartiteur', { org: ids.ccs });
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('COR-001 : le départ programmé prépare UNE demande de transport « à valider », invisible au transporteur avant transmission', async () => {
  const depart = new Date(Date.now() + 5 * 3600000).toISOString();
  const r = await appel('coord.h', 'POST', `/nsa/orientations-chsld/${ids.d}/confirmer-place`, { depart_prevu_le: depart, transport_mode: 'ambulance', usager_famille_d_accord: true });
  assert.strictEqual(r.s, 200, JSON.stringify(r.d)); assert.strictEqual(r.d.transport.statut, 'prepare');
  const t = (await pool.query('SELECT * FROM demandes_transport WHERE demande_hebergement_id = $1', [ids.d])).rows;
  assert.strictEqual(t.length, 1); assert.deepStrictEqual([t[0].statut, t[0].resident_ref, t[0].destination_id, t[0].lit_id, t[0].motif_transport], ['a_valider', 'P-64673', ids.c, ids.lit.id, 'depart_nsa']);
  assert.ok(Math.abs(new Date(t[0].plage_debut) - (new Date(depart) - 30 * 60000)) < 1000, 'horaire prérempli');
  assert.ok(!(await appel('para', 'GET', '/secours/transports')).d.some((x) => x.id === t[0].id), 'transporteur : rien avant transmission');
  assert.ok(!(await appel('ccs', 'GET', '/secours/transports')).d.some((x) => x.id === t[0].id), 'CCS : rien avant transmission');
  assert.strictEqual((await appel('para', 'POST', `/secours/transports/${t[0].id}/action`, { action: 'accepter' })).s >= 400, true, 'aucune affectation avant transmission');
  const h = (await appel('coord.h', 'GET', `/transports?etablissement_id=${ids.h}`)).d.find((x) => x.id === t[0].id);
  assert.deepStrictEqual(h.actions, ['transmettre', 'annuler']);
  // Aucun doublon : la préparation est idempotente
  const tr = require('../src/transports'); const d = (await pool.query('SELECT * FROM demandes_hebergement WHERE id = $1', [ids.d])).rows[0];
  assert.strictEqual((await tr.preparerDepuisHebergement(pool, d, { id: null })).statut, 'existant');
  ids.t = t[0].id;
});

test('COR-001 : transmission par une personne, puis acceptation, affectation et suivi synchronisés (hôpital, CHSLD, transporteur, CCS)', async () => {
  const t = (await pool.query('SELECT version FROM demandes_transport WHERE id = $1', [ids.t])).rows[0];
  const x = await appel('coord.h', 'POST', `/transports/${ids.t}/action`, { etablissement_id: ids.h, action: 'transmettre', version: t.version });
  assert.strictEqual(x.s, 200, JSON.stringify(x.d)); assert.strictEqual(x.d.statut, 'demandee');
  assert.ok((await appel('para', 'GET', '/secours/transports')).d.some((y) => y.id === ids.t), 'transporteur : visible après transmission');
  assert.ok((await appel('ccs', 'GET', '/secours/transports')).d.some((y) => y.id === ids.t), 'CCS : en lecture');
  const unite = (await pool.query("INSERT INTO unites_secours (organisation_id, numero) VALUES ($1, 'U-T1') RETURNING id", [ids.org])).rows[0].id;
  const acc = await appel('para', 'POST', `/secours/transports/${ids.t}/action`, { action: 'accepter', unite_id: unite }); assert.strictEqual(acc.s, 200, JSON.stringify(acc.d));
  const c = (await appel('coord.c', 'GET', `/transports?etablissement_id=${ids.c}`)).d.find((y) => y.id === ids.t);
  assert.strictEqual(c.statut, 'acceptee', 'CHSLD : même statut');
  const nsa = (await appel('coord.h', 'GET', `/nsa/orientations-chsld?etablissement_id=${ids.h}`)).d;
  const o = (Array.isArray(nsa) ? nsa : nsa.orientations || []).find((y) => y.id === ids.d);
  if (o) { assert.strictEqual(o.transport.statut, 'acceptee'); assert.strictEqual(o.transport.unite, 'U-T1'); }
});

test('COR-001 : formulaire manuel — destinations partenaires (CHSLD compris) et adresse externe libre', async () => {
  const dest = (await appel('coord.h', 'GET', `/transports/destinations?etablissement_id=${ids.h}`)).d;
  assert.ok(dest.some((e) => e.id === ids.c), 'le CHSLD partenaire est proposé');
  const r = await appel('coord.h', 'POST', '/transports-planifies', { etablissement_id: ids.h, reference: 'P-70001', motif_transport: 'retour_domicile', destination_libelle: '1234, rue des Érables, Trois-Rivières (Québec) G9A 1A1',
    plage_debut: new Date(Date.now() + 24 * 3600000).toISOString(), plage_fin: new Date(Date.now() + 25 * 3600000).toISOString(), type_vehicule: 'transport_adapte', organisation_id: ids.org });
  assert.strictEqual(r.s, 200, JSON.stringify(r.d)); assert.strictEqual(r.d.statut, 'demandee');
});

test('COR-004 : le compteur des civières libres suit « hors service » et « remettre en service », même valeur que « Urgences proches »', async () => {
  const lire = async () => (await appel('coord.h', 'GET', `/civieres?etablissement_id=${ids.h}`)).d;
  if (!(await pool.query("SELECT 1 FROM civieres WHERE etablissement_id = $1 AND categorie = 'reguliere' AND etat = 'libre'", [ids.h])).rowCount) {
    for (const n of [1, 2]) await pool.query("INSERT INTO civieres (etablissement_id, code, categorie, etat) VALUES ($1, $2, 'reguliere', 'libre')", [ids.h, `URG-T${n}`]);
  }
  const avant = await lire();
  const c = avant.civieres.find((x) => x.etat === 'libre' && x.categorie === 'reguliere' && !x.reservation);
  assert.ok(c, 'une civière régulière libre');
  const hs = await appel('coord.h', 'POST', `/civieres/${c.id}/action`, { action: 'hors_service', version: c.version, motif: 'equipement' });
  assert.strictEqual(hs.s, 200, JSON.stringify(hs.d));
  const pendant = await lire(); assert.strictEqual(pendant.stats.libres, avant.stats.libres - 1);
  const c2 = pendant.civieres.find((x) => x.id === c.id);
  const re = await appel('coord.h', 'POST', `/civieres/${c.id}/action`, { action: 'remettre', version: c2.version });
  assert.strictEqual(re.s, 200, JSON.stringify(re.d));
  assert.strictEqual((await lire()).stats.libres, avant.stats.libres);
  // « Urgences proches » (CHSLD) lit la même valeur (statsUrgence)
  const st = await require('../src/civieres').statsUrgence(pool, [ids.h]);
  assert.strictEqual(st.get(ids.h).libres, avant.stats.libres);
});

test('COR-003 : aperçu sans effet, simulation isolée (aucune réservation ni notification), alertes reçue → acceptée → véhicule affecté par le répartiteur', async () => {
  await pool.query(`UPDATE etablissements SET modules = modules || '{"mode_crise": true}' WHERE id = $1`, [ids.c]);
  for (const n of [1, 2, 3]) await pool.query("INSERT INTO residents (etablissement_id, reference, prenom, nom, date_naissance, statut) VALUES ($1, $2, 'Démo', $3, '1940-01-01', 'present')", [ids.c, `R-9900${n}`, `Résident ${n}`]);
  const corps = { etablissement_id: ids.c, motif: 'panne_chauffage', gravite: 'elevee', unites_touchees: 'Aile B', point_rassemblement: 'Hall d’entrée', simulation: true };
  const avant = (await pool.query('SELECT count(*)::int n FROM evacuations')).rows[0].n;
  const a = await appel('coord.c', 'POST', '/crise/apercu', corps);
  assert.strictEqual(a.s, 200, JSON.stringify(a.d)); assert.strictEqual(a.d.residents, 3); assert.ok(a.d.alertes.some((x) => x.role === 'coordination') && a.d.alertes.some((x) => x.role === 'transport'));
  assert.strictEqual((await pool.query('SELECT count(*)::int n FROM evacuations')).rows[0].n, avant, 'aperçu : rien n’est créé');
  assert.strictEqual((await appel('coord.c', 'POST', '/crise/apercu', { ...corps, gravite: 'xx' })).s, 400);
  const notifAvant = (await pool.query('SELECT count(*)::int n FROM notifications')).rows[0].n;
  const ev = await appel('coord.c', 'POST', '/crise/evacuations', corps);
  assert.strictEqual(ev.s, 200, JSON.stringify(ev.d)); assert.match(ev.d.numero, /^SIM-/); assert.strictEqual(ev.d.simulation, true);
  assert.strictEqual((await pool.query('SELECT count(*)::int n FROM notifications')).rows[0].n, notifAvant, 'simulation : aucune notification');
  const v = (await appel('coord.c', 'GET', `/crise/evacuations/${ev.d.id}`)).d;
  assert.strictEqual(v.alertes.length, 2); assert.ok(v.alertes.every((x) => x.statut === 'envoyee' && x.simulation));
  // Côté secours : l'ambulance accuse réception et accepte ; seul le répartiteur affecte un véhicule
  const al = (await appel('para', 'GET', '/secours/crise/alertes')).d; assert.strictEqual(al.length, 1); assert.ok(!JSON.stringify(al).includes('Résident 1'), 'aucun nom');
  assert.strictEqual((await appel('para', 'POST', `/secours/crise/alertes/${al[0].id}/action`, { action: 'accuser' })).d.statut, 'recue');
  assert.strictEqual((await appel('para', 'POST', `/secours/crise/alertes/${al[0].id}/action`, { action: 'accepter' })).d.statut, 'acceptee');
  const unite = (await pool.query("SELECT id FROM unites_secours WHERE organisation_id = $1 LIMIT 1", [ids.org])).rows[0].id;
  assert.strictEqual((await appel('para', 'POST', `/secours/crise/alertes/${al[0].id}/action`, { action: 'affecter', unite_id: unite })).s, 403, 'l’équipage n’affecte pas');
  await compte('sup', 'superviseur_secours', { org: ids.org });
  const aff = (await appel('sup', 'POST', `/secours/crise/alertes/${al[0].id}/action`, { action: 'affecter', unite_id: unite, eta_min: 12 })).d;
  assert.deepStrictEqual([aff.statut, aff.eta_min], ['vehicule_affecte', 12]);
  // Escalade : jamais en simulation
  await pool.query("UPDATE crise_alertes SET envoyee_le = now() - interval '10 minutes' WHERE evacuation_id = $1", [ev.d.id]);
  assert.strictEqual(await require('../src/crise').echeances(pool), 0);
  // Une simulation n'empêche pas une vraie évacuation ; la vraie alerte sans réponse est escaladée
  const reel = await appel('coord.c', 'POST', '/crise/evacuations', { ...corps, simulation: false });
  assert.strictEqual(reel.s, 200, JSON.stringify(reel.d)); assert.match(reel.d.numero, /^EV-/);
  await pool.query("UPDATE crise_alertes SET envoyee_le = now() - interval '10 minutes' WHERE evacuation_id = $1", [reel.d.id]);
  assert.strictEqual(await require('../src/crise').echeances(pool), 2);
});

test('COR-002 : la décision « transfert » ne demande aucune ambulance ; la demande, l’accusé et l’affectation apparaissent à part', async () => {
  await pool.query(`UPDATE etablissements SET modules = modules || '{"eviter_transferts": true}' WHERE id = $1`, [ids.c]);
  const d = (await appel('coord.c', 'POST', '/eviter/decisions', { etablissement_id: ids.c, decision: 'transfert_fait', resident_ref: 'R-99001' })).d;
  assert.deepStrictEqual([d.ambulance_demandee, d.prochaine_etape], [false, 'demander_transport']);
  let l = (await appel('coord.c', 'GET', `/eviter?etablissement_id=${ids.c}`)).d.decisions[0];
  assert.deepStrictEqual([l.transport, l.accuse, l.vehicule_affecte], [null, false, false], 'aucune demande liée tant qu’elle n’est pas faite');
  // Demande réelle du même résident : elle apparaît comme suite de la décision
  await pool.query(`INSERT INTO demandes_transport (numero, organisation_id, origine_id, destination_libelle, resident_ref, statut, heure_souhaitee) VALUES ('DT-COR2', $1, $2, 'Urgence', 'R-99001', 'demandee', now())`, [ids.org, ids.c]);
  l = (await appel('coord.c', 'GET', `/eviter?etablissement_id=${ids.c}`)).d.decisions[0];
  assert.deepStrictEqual([l.transport, l.accuse, l.vehicule_affecte], ['DT-COR2', false, false]);
});

test('Liens automatiques : la prise en charge par le transporteur d’un départ NSA vaut départ de l’hôpital (lit au nettoyage, ressource avisée)', async () => {
  const unite = (await pool.query("SELECT id FROM unites_secours WHERE organisation_id = $1 LIMIT 1", [ids.org])).rows[0].id;
  assert.strictEqual((await appel('para', 'POST', `/secours/transports/${ids.t}/action`, { action: 'en_route', unite_id: unite })).s, 200);
  const r = await appel('para', 'POST', `/secours/transports/${ids.t}/action`, { action: 'pris_en_charge' }); assert.strictEqual(r.s, 200, JSON.stringify(r.d));
  const dh = (await pool.query('SELECT depart_hopital_le FROM demandes_hebergement WHERE id = $1', [ids.d])).rows[0];
  assert.ok(dh.depart_hopital_le, 'départ de l’hôpital enregistré automatiquement');
  assert.strictEqual((await pool.query('SELECT etat FROM lits WHERE id = $1', [ids.lit.id])).rows[0].etat, 'nettoyage');
  assert.ok((await pool.query("SELECT 1 FROM notifications WHERE etablissement_id = $1 AND code = 'nsa_depart'", [ids.c])).rowCount, 'ressource avisée');
});
