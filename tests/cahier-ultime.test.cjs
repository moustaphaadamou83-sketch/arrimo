'use strict';
/** Cahier ultime du 21 nov. 2026 : préalerte d'arrivée (hébergement), Arrimo Flux, admission bloquée expliquée, OG central, Arrimo Connect. */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');

let pool; let serveur; let base; const tok = {}; const ids = {}; const envAvant = process.env.ARRIMO_ENV;
async function appel(qui, m, c, b) { const r = await fetch(`${base}/api${c}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok[qui]}` }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { s: r.status, d }; }
async function compte(cle, role, { etab, org } = {}) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [`${cle}@demo.arrimo`, `Nom ${cle}`, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (etab) await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etab]);
  if (org) await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, org]);
  tok[cle] = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${cle}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
  return u;
}
const og = (qui, etab, question) => appel(qui, 'POST', '/copilote/question', { etablissement_id: etab, question });

test.before(async () => {
  process.env.ARRIMO_ENV = 'demo'; require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const h = (await pool.query("SELECT id, config_id, latitude, longitude FROM etablissements WHERE code = 'MB'")).rows[0]; ids.h = h.id;
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"transport_planifie": true}' WHERE id = $1`, [h.id]);
  ids.c = (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, module_actif, type_etablissement, modules) VALUES ('CH-U', 'CHSLD ultime', 'Ville', $1, $2, $3, true, 'chsld', '{"transport_planifie": true}') RETURNING id`,
    [h.latitude + 0.01, h.longitude, h.config_id])).rows[0].id;
  // Une chambre du CHSLD et un résident en préadmission qui l'attend
  const modele = (await pool.query('SELECT chambre_id, unite_id, type_id FROM lits WHERE etablissement_id = $1 LIMIT 1', [h.id])).rows[0];
  ids.lit = (await pool.query("INSERT INTO lits (chambre_id, unite_id, type_id, etablissement_id, code, etat, patient_ref) VALUES ($1, $2, $3, $4, 'ULT-309', 'reserve', 'R-00128') RETURNING id", [modele.chambre_id, modele.unite_id, modele.type_id, ids.c])).rows[0].id;
  ids.res = (await pool.query("INSERT INTO residents (etablissement_id, reference, prenom, nom, date_naissance, statut, lit_id) VALUES ($1, 'R-00128', 'Démo', 'Ultime', '1940-01-01', 'preadmission', $2) RETURNING id", [ids.c, ids.lit])).rows[0].id;
  ids.dh = (await pool.query(`INSERT INTO demandes_hebergement (etablissement_id, numero, provenance, reference_externe, statut, hopital_id, documents, resident_id, lit_propose_id) VALUES ($1, 'DH-ULT1', 'hopital', 'P-64673', 'acceptee', $2, '[]', $3, $4) RETURNING id`, [ids.c, h.id, ids.res, ids.lit])).rows[0].id;
  ids.org = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('AMB-U', 'Ambulances ultime', 'ambulancier', '{ambulance}', $1) RETURNING id", [h.config_id])).rows[0].id;
  ids.unite = (await pool.query("INSERT INTO unites_secours (organisation_id, numero, plaque) VALUES ($1, 'DM-102', 'ULT 102') RETURNING id", [ids.org])).rows[0].id;
  ids.dt = (await pool.query(`INSERT INTO demandes_transport (numero, organisation_id, origine_id, destination_id, resident_ref, statut, heure_souhaitee, plage_debut, plage_fin, demande_hebergement_id, unite_id, motif_transport, type_vehicule)
    VALUES ('DT-000003', $1, $2, $3, 'P-64673', 'en_route', now() + interval '1 hour', now() + interval '1 hour', now() + interval '2 hours', $4, $5, 'depart_nsa', 'ambulance') RETURNING id`, [ids.org, h.id, ids.c, ids.dh, ids.unite])).rows[0].id;
  ids.admin = await compte('admin', 'admin_etab', { etab: ids.c }); ids.coord = await compte('coord', 'coordonnateur', { etab: ids.c }); ids.coord2 = await compte('coord2', 'coordonnateur', { etab: ids.c });
  await compte('ent', 'entretien', { etab: ids.c }); await compte('hop', 'coordonnateur', { etab: h.id }); await compte('para', 'paramedic', { org: ids.org });
});
test.after(async () => { serveur?.close(); await pool?.end(); if (envAvant === undefined) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = envAvant; });

test('Préalerte d’arrivée vers un CHSLD : notifiée, tâche de préparation unique, véhicule inchangé ; acquittée par la destination seulement', async () => {
  const etatAvant = (await pool.query('SELECT etat FROM etat_vehicules WHERE unite_id = $1', [ids.unite]).catch(() => ({ rows: [] }))).rows[0]?.etat ?? null;
  const v = (await pool.query('SELECT version FROM demandes_transport WHERE id = $1', [ids.dt])).rows[0].version;
  const r = await appel('para', 'POST', `/secours/transports/${ids.dt}/action`, { action: 'prealerter', version: v, eta_min: 20 });
  assert.strictEqual(r.s, 200, JSON.stringify(r.d)); assert.ok(r.d.prealerte_le);
  assert.strictEqual(r.d.statut, 'en_route', 'une préalerte ne change pas l’état du transport');
  assert.strictEqual((await pool.query('SELECT etat FROM etat_vehicules WHERE unite_id = $1', [ids.unite]).catch(() => ({ rows: [] }))).rows[0]?.etat ?? null, etatAvant, 'ni celui du véhicule');
  assert.ok((await pool.query("SELECT 1 FROM notifications WHERE etablissement_id = $1 AND code = 'transport_prealerte'", [ids.c])).rowCount, 'destination avisée');
  const v2 = (await pool.query('SELECT version FROM demandes_transport WHERE id = $1', [ids.dt])).rows[0].version;
  assert.strictEqual((await appel('para', 'POST', `/secours/transports/${ids.dt}/action`, { action: 'prealerter', version: v2, eta_min: 15 })).s, 200);
  assert.strictEqual((await pool.query("SELECT count(*)::int n FROM taches_etab WHERE lit_id = $1 AND type = 'preparation_chambre' AND statut IN ('a_faire', 'en_cours')", [ids.lit])).rows[0].n, 1, 'une seule tâche de préparation');
  assert.strictEqual((await pool.query("SELECT count(*)::int n FROM notifications WHERE etablissement_id = $1 AND code = 'transport_prealerte'", [ids.c])).rows[0].n, 1, 'pas de second avis');
  // Seule la destination acquitte
  assert.strictEqual((await appel('hop', 'POST', `/transports/${ids.dt}/action`, { etablissement_id: ids.h, action: 'accuser_prealerte' })).s >= 400, true);
  const a = await appel('coord', 'POST', `/transports/${ids.dt}/action`, { etablissement_id: ids.c, action: 'accuser_prealerte' });
  assert.strictEqual(a.s, 200, JSON.stringify(a.d)); assert.ok(a.d.prealerte_recue_le);
});

test('Arrimo Flux : arrivée avec préalerte, ETA de l’équipage, préparation de la chambre ; sans ETA → indisponible (jamais inventée)', async () => {
  const f = await appel('coord', 'GET', `/arrimo-flux?etablissement_id=${ids.c}`); assert.strictEqual(f.s, 200, JSON.stringify(f.d));
  const l = f.d.mouvements.find((x) => x.reference === 'DT-000003');
  assert.ok(l); assert.strictEqual(l.mouvement, 'arrivee'); assert.strictEqual(l.vehicule, 'DM-102'); assert.ok(l.eta && l.eta_source === 'prealerte');
  assert.ok(l.creneau && l.prevue); assert.strictEqual(l.preparation.etat, 'a_faire'); assert.strictEqual(l.preparation.chambre, 'ULT-309');
  assert.ok(!f.d.mouvements.some((x) => x.reference === 'DH-ULT1'), 'pas de doublon hébergement/transport');
  const fh = await appel('hop', 'GET', `/arrimo-flux?etablissement_id=${ids.h}`); const d = fh.d.mouvements.find((x) => x.reference === 'DT-000003');
  assert.strictEqual(d.mouvement, 'depart'); assert.strictEqual(d.eta, null, 'départ : pas d’ETA inventée');
  assert.strictEqual((await appel('hop', 'GET', `/arrimo-flux?etablissement_id=${ids.c}`)).s, 403, 'autre établissement refusé');
});

test('Admission bloquée : la chambre et la prochaine action sont nommées ; l’entretien voit la tâche et confirme ; l’admission passe ensuite', async () => {
  await pool.query('UPDATE demandes_hebergement SET depart_hopital_le = now() WHERE id = $1', [ids.dh]);   // le patient a quitté l'hôpital
  const r = (await pool.query('SELECT version FROM residents WHERE id = $1', [ids.res])).rows[0];
  const a = await appel('coord', 'POST', `/chsld/residents/${ids.res}/arrivee`, { version: r.version });
  assert.strictEqual(a.s, 409); assert.strictEqual(a.d.code, 'chambre_non_prete'); assert.match(a.d.erreur, /ULT-309/);
  const t = (await appel('ent', 'GET', `/chsld/taches?etablissement_id=${ids.c}`)).d.find((x) => x.type === 'preparation_chambre');
  assert.ok(t, 'l’entretien voit la tâche');
  assert.strictEqual((await appel('ent', 'POST', `/chsld/taches/${t.id}/statut`, { statut: 'faite', version: t.version })).s, 200);
  const r2 = (await pool.query('SELECT version FROM residents WHERE id = $1', [ids.res])).rows[0];
  assert.strictEqual((await appel('coord', 'POST', `/chsld/residents/${ids.res}/arrivee`, { version: r2.version })).s, 200);
});

test('OG central : transport, chambre, préalertes, arrivées — sourcé et horodaté ; l’entretien limité aux chambres', async () => {
  let r = await og('coord', ids.c, 'Où en est le transport DT-000003 ?');
  assert.strictEqual(r.s, 200, JSON.stringify(r.d)); assert.match(r.d.reponse, /DM-102/); assert.match(r.d.reponse, /Source/);
  r = await og('coord', ids.c, 'La chambre ULT-309 est-elle prête ?'); assert.match(r.d.reponse, /ULT-309/);
  r = await og('coord', ids.c, 'Quelles préalertes ?'); assert.match(r.d.reponse, /DT-000003/);
  r = await og('coord', ids.c, 'Quels résidents arrivent aujourd’hui ?'); assert.match(r.d.reponse, /Arriv/);
  r = await og('ent', ids.c, 'Quelles chambres doivent être préparées ?'); assert.strictEqual(r.s, 200, JSON.stringify(r.d)); assert.match(r.d.reponse, /Chambres à préparer/);
  r = await og('ent', ids.c, 'Où en est le transfert TR-00001 ?'); assert.match(r.d.reponse, /pas accessibles|not available/);
  r = await og('hop', ids.h, 'La chambre ULT-309 est-elle prête ?'); assert.ok(!/ULT-309 \(/.test(r.d.reponse || ''), 'chambre d’un autre établissement non révélée');
});

test('Arrimo Connect : demande à l’administration suivie ; message direct privé (même pour l’administration) ; annonces par l’administration seulement', async () => {
  const d = await appel('coord', 'POST', '/messagerie/messages', { etablissement_id: ids.c, boite: 'administration', categorie: 'materiel', priorite: 'haute', sujet: 'Lève-personne', corps: 'Le lève-personne de l’aile B est en panne.' });
  assert.strictEqual(d.s, 200, JSON.stringify(d.d));
  let a = await appel('admin', 'GET', `/messagerie/fils?etablissement_id=${ids.c}`); assert.strictEqual(a.d.non_lus, 1);
  assert.strictEqual((await appel('coord2', 'GET', `/messagerie/fils/${d.d.id}`)).s, 404, 'un collègue ne lit pas la demande');
  assert.strictEqual((await appel('admin', 'POST', '/messagerie/messages', { etablissement_id: ids.c, fil_id: d.d.id, corps: 'Technicien demandé pour 14 h.' })).s, 200);
  const f = await appel('coord', 'GET', `/messagerie/fils?etablissement_id=${ids.c}`); assert.strictEqual(f.d.non_lus, 1, 'réponse non lue pour l’employé');
  assert.strictEqual((await appel('admin', 'GET', `/messagerie/fils/${d.d.id}`)).d.fil.statut, 'en_cours');
  assert.strictEqual((await appel('coord', 'POST', `/messagerie/fils/${d.d.id}/statut`, { statut: 'resolue' })).s, 403);
  assert.strictEqual((await appel('admin', 'POST', `/messagerie/fils/${d.d.id}/statut`, { statut: 'resolue' })).s, 200);
  // Message direct : l'administration ne le lit pas
  const m = await appel('coord', 'POST', '/messagerie/messages', { etablissement_id: ids.c, destinataire_id: ids.coord2, sujet: 'Relève', corps: 'Message privé fictif' });
  assert.strictEqual(m.s, 200); assert.strictEqual((await appel('coord2', 'GET', `/messagerie/fils/${m.d.id}`)).s, 200);
  assert.strictEqual((await appel('admin', 'GET', `/messagerie/fils/${m.d.id}`)).s, 404, 'confidentialité des messages privés');
  assert.ok(!(await appel('admin', 'GET', `/messagerie/fils?etablissement_id=${ids.c}`)).d.fils.some((x) => x.id === m.d.id));
  // Hors établissement
  assert.strictEqual((await appel('hop', 'GET', `/messagerie/fils?etablissement_id=${ids.c}`)).s, 403);
  assert.strictEqual((await appel('coord', 'POST', '/messagerie/messages', { etablissement_id: ids.c, destinataire_id: (await pool.query("SELECT id FROM utilisateurs WHERE email = 'hop@demo.arrimo'")).rows[0].id, sujet: 'Essai', corps: 'Y' })).s, 404);
  // Annonces
  assert.strictEqual((await appel('coord', 'POST', '/messagerie/annonces', { etablissement_id: ids.c, titre: 'Essai', corps: 'Non autorisé' })).s, 403);
  assert.strictEqual((await appel('admin', 'POST', '/messagerie/annonces', { etablissement_id: ids.c, titre: 'Exercice incendie', corps: 'Jeudi 10 h (fictif)', roles: ['entretien'] })).s, 200);
  assert.strictEqual((await appel('ent', 'GET', `/messagerie/annonces?etablissement_id=${ids.c}`)).d.length, 1);
  assert.strictEqual((await appel('coord', 'GET', `/messagerie/annonces?etablissement_id=${ids.c}`)).d.length, 0, 'annonce ciblée sur un rôle');
  // OG oriente vers Arrimo Connect
  const o = await og('coord', ids.c, 'Ai-je reçu un message de l’administration ?'); assert.match(o.d.reponse, /Arrimo Connect/);
});
