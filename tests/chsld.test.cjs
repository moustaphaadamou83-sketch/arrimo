'use strict';
/**
 * Produit CHSLD de bout en bout, données synthétiques seulement :
 * console SH (type d'établissement, catalogue de modules, provisionnement des deux CHSLD fictifs, activation),
 * environnement pilote isolé contenant les hôpitaux A, B et C, comptes invités et connexions réelles,
 * parcours CHSLD (résidents, contacts, autorisations, places, demandes, hospitalisation, retour, transfert inter-CHSLD,
 * tâches, communications), OG, sécurité (permissions, isolation, double attribution) et non-régression hospitalière.
 */
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Pool } = require('pg');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { creerAppSh } = require('../src/sh/app');
const { viderBaseSh } = require('../db/sh-vider');
const { premierCompteSh } = require('../db/sh-premier-compte');
const invitations = require('../src/sh/invitations');
const totp = require('../src/totp');
const courriel = require('../src/courriel');
const { demarrerServeur } = require('./serveur-test.cjs');
const { provisionner, peupler, CHSLD } = require('../db/provisionner-chsld');

const URL_TEST = process.env.TEST_DATABASE_URL;
const CLE_MFA = Buffer.alloc(32, 7).toString('base64');
const MDP = 'Chsld-Fictif-2026';
let pool, poolPilote, serveurSh, serveurPilote, baseSh, basePilote, dossierDocs, jetonSh;
const courriels = [];
const sessions = {};
const RESULTATS = { sh: {}, provisionnement: [], parcours: [] };

async function appelSh(methode, chemin, corps, jeton = jetonSh) {
  const r = await fetch(`${baseSh}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
async function sh(methode, chemin, corps) { const r = await appelSh(methode, chemin, corps); assert.ok(r.statut === 200, `SH ${methode} ${chemin} → ${r.statut} ${JSON.stringify(r.corps)}`); return r.corps; }
async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${basePilote}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(sessions[qui] ? { Authorization: `Bearer ${sessions[qui]}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
async function api(qui, methode, chemin, corps) { const r = await appel(qui, methode, chemin, corps); assert.ok(r.statut === 200, `${qui} ${methode} ${chemin} → ${r.statut} ${JSON.stringify(r.corps)}`); return r.corps; }
const refuse = async (qui, methode, chemin, corps, statut, code) => { const r = await appel(qui, methode, chemin, corps); assert.strictEqual(r.statut, statut, `${qui} ${methode} ${chemin} → ${r.statut} ${JSON.stringify(r.corps)}`); if (code) assert.strictEqual(r.corps.code, code); return r.corps; };
async function ouvrirSessionSh(email) {
  let r = await appelSh('POST', '/connexion', { email, mot_de_passe: MDP }, null);
  const { secret } = (await appelSh('POST', '/moi/2fa/preparer', null, r.corps.token)).corps;
  await appelSh('POST', '/moi/2fa/activer', { code: totp.codePourPas(secret, totp.pasActuel()) }, r.corps.token);
  r = await appelSh('POST', '/connexion', { email, mot_de_passe: MDP }, null);
  r = await appelSh('POST', '/connexion/2fa', { jeton: r.corps.jeton, code: totp.codePourPas(secret, totp.pasActuel() + 1) }, null);
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  return r.corps.token;
}

test.before(async () => {
  assert.ok(URL_TEST, 'TEST_DATABASE_URL requis');
  assert.match(new URL(URL_TEST).pathname, /^\/arrimo_sh_lot1_test_[a-z0-9_]+$/);
  process.env.SH_API_KEY = 'cle-chsld-sh-0123456789abcdef'; process.env.SH_MFA_ENCRYPTION_KEY = CLE_MFA;
  process.env.ARRIMO_URL = 'https://arrimo.test.invalid'; process.env.SH_PUBLIC_URL = 'https://sh.test.invalid';
  process.env.SH_INITIAL_ADMIN_EMAIL = 'admin.chsld@sh.exemple'; process.env.ARRIMO_ENV = 'pilote'; process.env.ARRIMO_PATIENTS_FICTIFS = '1';
  delete process.env.ARRIMO_DEMO;
  courriel.definirTransport(async (m) => { courriels.push(m); });
  pool = creerPool(URL_TEST);
  // Environnement pilote isolé : schéma séparé contenant les hôpitaux A, B et C (Démo ABC fictive), sans toucher à la démo publique.
  await pool.query('CREATE SCHEMA IF NOT EXISTS pilote_chsld');
  poolPilote = new Pool({ connectionString: URL_TEST, options: '-c search_path=pilote_chsld' });
  process.env.DEMO_MOT_DE_PASSE = MDP;
  await require('../db/demo-trio').preparerDemoTrio(poolPilote, { silencieux: true, fichierAcces: path.join(os.tmpdir(), `acces-chsld-${process.pid}.txt`) });
  serveurPilote = await demarrerServeur(creerApp(poolPilote)); basePilote = `http://127.0.0.1:${serveurPilote.address().port}`;
  dossierDocs = fs.mkdtempSync(path.join(os.tmpdir(), 'arrimo-chsld-docs-'));
  await viderBaseSh(pool);
  await premierCompteSh(pool, 'admin.chsld@sh.exemple', 'Administration fictive');
  await invitations.consommer(pool, { jeton: courriels.at(-1).texte.match(/#invitation=([a-f0-9]{64})/)[1], nouveau: MDP }, process.env);
  serveurSh = await demarrerServeur(creerAppSh(pool, { env: { SH_PUBLIC_URL: 'https://sh.test.invalid', SH_MFA_ENCRYPTION_KEY: CLE_MFA, SH_DOCUMENTS_DIR: dossierDocs,
    SH_ENV_PILOTE_URL: basePilote, SH_ENV_PILOTE_CLE: process.env.SH_API_KEY, SH_ENV_PILOTE_PUBLIC: 'https://pilote.example.invalid', SH_EMETTEUR_NOM: 'SH fictive inc.' } }));
  baseSh = `http://127.0.0.1:${serveurSh.address().port}`;
  jetonSh = await ouvrirSessionSh('admin.chsld@sh.exemple');
});
test.after(async () => {
  serveurSh?.close(); serveurPilote?.close(); await poolPilote?.end().catch(() => {});
  await pool?.query('DROP SCHEMA IF EXISTS pilote_chsld CASCADE').catch(() => {}); await pool?.end();
  fs.mkdirSync(path.resolve('.local'), { recursive: true });
  fs.writeFileSync(path.resolve('.local/chsld-rapport-tests.json'), `${JSON.stringify(RESULTATS, null, 2)}\n`);
});

test('SH : le type d’établissement vient en premier et commande les modules proposés', async () => {
  const hop = await sh('GET', '/catalogue-modules?type=hopital');
  const chs = await sh('GET', '/catalogue-modules?type=chsld');
  assert.deepStrictEqual(hop.types.map((t) => [t.code, t.statut]), [['hopital', 'operationnel'], ['chsld', 'operationnel'], ['maison_aines', 'a_venir'], ['rpa', 'a_venir'], ['ressource_intermediaire', 'a_venir']]);
  const codes = (r, cat) => r.modules.filter((m) => m.categorie === cat).map((m) => m.code);
  assert.ok(codes(chs, 'commun').includes('og') && codes(hop, 'commun').includes('og'), 'socle commun pour les deux types');
  assert.deepStrictEqual(codes(chs, 'hopital'), [], 'aucun module hospitalier proposé à un CHSLD');
  assert.ok(['residents', 'chambres', 'demandes_hebergement', 'entretien_chsld', 'taches', 'proches', 'hospitalisations', 'reseau_chsld'].every((c) => codes(chs, 'chsld').includes(c)));
  assert.ok(codes(hop, 'hopital').includes('civieres') && !codes(hop, 'chsld').length, 'urgence et civières (code historique « civieres ») pour l’hôpital');
  assert.deepStrictEqual(chs.modules.filter((m) => m.categorie === 'optionnel').map((m) => [m.code, m.statut]), [['portail_proches', 'disponible'], ['messagerie_securisee', 'disponible'], ['appels_video', 'etude']]);
  RESULTATS.sh.catalogue = { hopital: hop.modules.map((m) => `${m.categorie}:${m.code}:${m.statut}`), chsld: chs.modules.map((m) => `${m.categorie}:${m.code}:${m.statut}`) };
  // Types futurs : prévus mais refusés ; modules non implémentés : jamais souscrits
  for (const type of ['maison_aines', 'rpa', 'ressource_intermediaire']) {
    const r = await appelSh('POST', '/hopitaux', { type_etablissement: type, nom: `Essai ${type}`, code_etab: `ES-${type.slice(0, 3).toUpperCase()}`, environnement: 'pilote', pays_code: 'CA', latitude: 45, longitude: -71 });
    assert.strictEqual(r.statut, 409, type); assert.match(r.corps.erreur, /pas encore opérationnel/);
  }
  const r = await appelSh('POST', '/hopitaux', { type_etablissement: 'chsld', modules: { appels_video: true }, nom: 'Essai vidéo', code_etab: 'ES-VIDEO', environnement: 'pilote', pays_code: 'CA', latitude: 45, longitude: -71 });
  assert.strictEqual(r.statut, 409); assert.match(r.corps.erreur, /pas encore disponible/);
  RESULTATS.sh.refus = ['maison_aines', 'rpa', 'ressource_intermediaire', 'module appels_video (à l’étude)'];
});

let crees, ids;
test('SH : création, provisionnement et activation des deux CHSLD fictifs, sans configuration manuelle', { timeout: 300000 }, async () => {
  crees = await provisionner(sh, { environnement: 'pilote', modules: { reseau_chsld: true, proches: true } });
  for (const c of crees) {
    const fiche = await sh('GET', `/hopitaux/${c.hopital_id}`);
    assert.strictEqual(fiche.type_etablissement, 'chsld');
    assert.ok(fiche.modules.every((m) => ['commun', 'chsld', 'optionnel'].includes(m.categorie)), 'licences limitées au type');
    assert.ok(fiche.modules.filter((m) => m.statut === 'inclus').every((m) => m.licence === 'souscrit'));
    assert.ok(fiche.modules.filter((m) => ['a_venir', 'etude'].includes(m.statut)).every((m) => m.licence === 'non_selectionne'));
    const e = (await poolPilote.query('SELECT e.*, c.code AS config, p.code AS profil FROM etablissements e JOIN config_pays c ON c.id = e.config_id LEFT JOIN config_pays p ON p.id = e.profil_config_id WHERE e.code = $1', [c.code])).rows[0];
    assert.ok(e.module_actif && e.type_etablissement === 'chsld' && e.config === 'QC-CHSLD' && e.profil === 'QC');
    const n = (await poolPilote.query('SELECT count(*)::int n, count(DISTINCT chambre_id)::int ch FROM lits WHERE etablissement_id = $1', [e.id])).rows[0];
    const attendu = c.code === 'CHSLD-ERA' ? 60 : 90;
    assert.strictEqual(n.n, attendu, `${c.code} : ${attendu} lits`);
    const unites = (await poolPilote.query('SELECT count(*)::int n FROM unites WHERE etablissement_id = $1', [e.id])).rows[0].n;
    assert.strictEqual(unites, 3);
    const comptes = (await poolPilote.query('SELECT u.role FROM utilisateurs u JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id WHERE ue.etablissement_id = $1 ORDER BY u.role', [e.id])).rows.map((x) => x.role);
    assert.deepStrictEqual(comptes, ['admin_etab', 'coordonnateur', 'entretien', 'equipe_soins']);
    RESULTATS.provisionnement.push({ code: c.code, nom: c.nom, type: e.type_etablissement, configuration: e.config, profil_pays: e.profil, lits: n.n, chambres: n.ch, unites, comptes, actif: e.module_actif,
      modules_souscrits: fiche.modules.filter((m) => m.licence === 'souscrit').map((m) => m.code) });
  }
  // Les hôpitaux A, B et C restent intacts : type hôpital, configuration QC
  const hop = (await poolPilote.query(`SELECT code, type_etablissement, (SELECT code FROM config_pays WHERE id = config_id) cfg FROM etablissements WHERE code IN ('HX','HY','HC') ORDER BY code`)).rows;
  assert.ok(hop.length === 3 && hop.every((h) => h.type_etablissement === 'hopital' && h.cfg === 'QC'));
});

test('personnel : invitations, connexions réelles et interface adaptée au type', async () => {
  for (const c of crees) for (const [cle, x] of Object.entries(c.comptes)) {
    const jeton = courriels.findLast((m) => m.a === x.courriel).texte.match(/#reinit=([a-f0-9]{64})/)[1];
    await api(null, 'POST', '/mot-de-passe/reinitialiser', { jeton, nouveau: MDP });
    sessions[`${c.code === 'CHSLD-ERA' ? 'era' : 'stl'}_${cle}`] = (await api(null, 'POST', '/connexion', { email: x.courriel, mot_de_passe: MDP })).token;
  }
  sessions.era = sessions.era_coordination; sessions.stl = sessions.stl_coordination;
  sessions.b = (await api(null, 'POST', '/connexion', { email: 'hopital.b@demo.arrimo', mot_de_passe: MDP })).token;
  sessions.a = (await api(null, 'POST', '/connexion', { email: 'hopital.a@demo.arrimo', mot_de_passe: MDP })).token;
  const moi = await api('era', 'GET', '/moi');
  assert.strictEqual(moi.etablissements.length, 1); assert.strictEqual(moi.etablissements[0].type_etablissement, 'chsld');
  assert.strictEqual((await api('b', 'GET', '/moi')).etablissements.find((e) => e.code === 'HY').type_etablissement, 'hopital');
});

let p;
test('parcours CHSLD réels : peuplement par le personnel, places, contacts, demandes, hospitalisation, transfert', { timeout: 300000 }, async () => {
  const hopitalB = (await poolPilote.query("SELECT id FROM etablissements WHERE code = 'HY'")).rows[0].id;
  p = await peupler(api, { hopitalB }); ids = p.ids;
  const accueilEra = await api('era', 'GET', `/chsld/accueil?etablissement_id=${ids.era}`);
  assert.strictEqual(accueilEra.places.dotees + accueilEra.places.bloquees, 60);
  assert.strictEqual(accueilEra.places.occupees, 49, 'Érables : 50 admis, 1 fin d’hébergement'); assert.strictEqual(accueilEra.places.reservees, 1); assert.strictEqual(accueilEra.places.preparation, 1); assert.strictEqual(accueilEra.places.bloquees, 1);
  const accueilStl = await api('stl', 'GET', `/chsld/accueil?etablissement_id=${ids.stl}`);
  assert.strictEqual(accueilStl.places.conservees, 1, 'place conservée pendant l’hospitalisation'); assert.strictEqual(accueilStl.residents.hospitalise, 1);
  RESULTATS.parcours.push({ accueil_erables: accueilEra.places, accueil_saint_laurent: accueilStl.places });
  // Jean Dupont : deux contacts, autorisations distinctes ; communication refusée au fils non autorisé
  const f = await api('era', 'GET', `/chsld/residents/${p.dupont}`);
  assert.strictEqual(f.contacts.length, 2); const fille = f.contacts.find((k) => k.relation === 'fille'), fils = f.contacts.find((k) => k.relation === 'fils');
  assert.ok(fille.principal && fille.autorisations.includes('mouvements') && !fils.autorisations.length);
  await api('era', 'POST', `/chsld/residents/${p.dupont}/communications`, { contact_id: fille.id, type: 'rappel_demande', categorie: 'administratif', sujet: 'Rappeler pour la visite de samedi' });
  await refuse('era', 'POST', `/chsld/residents/${p.dupont}/communications`, { contact_id: fils.id, type: 'message', categorie: 'administratif', sujet: 'x' }, 403, 'proche_non_autorise');
  // Révocation : la fille perd ses autorisations
  const ajout = await api('era', 'POST', `/chsld/residents/${p.dupont}/contacts`, { prenom: 'Anne', nom: 'Roy', relation: 'ami', telephone: '555-0199', autorisations: ['rendez_vous'] });
  await api('era', 'PUT', `/chsld/contacts/${ajout.id}`, { actif: false, version: ajout.version });
  await refuse('era', 'POST', `/chsld/residents/${p.dupont}/communications`, { contact_id: ajout.id, type: 'appel', categorie: 'rendez_vous', sujet: 'x' }, 404, 'contact_introuvable');
  // Doublon détecté, création distincte seulement sur confirmation
  await refuse('era', 'POST', '/chsld/residents', { etablissement_id: ids.era, prenom: 'Jean', nom: 'Dupont', date_naissance: '1938-04-02' }, 409, 'resident_doublon_possible');
  // Accueil prévu → arrivée ; changement de chambre → ancienne place en préparation ; nettoyage → place libre
  const prevu = (await api('era', 'GET', `/chsld/residents?etablissement_id=${ids.era}&statut=preadmission`))[0];
  await api('era', 'POST', `/chsld/residents/${prevu.id}/arrivee`, { version: prevu.version });
  const libre = (await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).find((x) => x.etat === 'libre');
  const fd = (await api('era', 'GET', `/chsld/residents/${p.dupont}`)).resident;
  await api('era', 'POST', `/chsld/residents/${p.dupont}/changer-chambre`, { lit_id: libre.id, version: libre.version, version_resident: fd.version });
  const nettoyage = await api('era_entretien', 'GET', `/nettoyage?etablissement_id=${ids.era}`);
  assert.ok(nettoyage.length >= 2);
  const ln = nettoyage[0]; await api('era_entretien', 'POST', `/lits/${ln.id}/action`, { action: 'nettoyage_ok', version: ln.version });
  const tachesEntretien = await api('era_entretien', 'GET', `/chsld/taches?etablissement_id=${ids.era}`);
  assert.ok(tachesEntretien.length && tachesEntretien.every((x) => ['entretien', 'preparation_chambre'].includes(x.type)), 'l’entretien ne voit que ses tâches');
  await api('era_entretien', 'POST', `/chsld/taches/${tachesEntretien[0].id}/statut`, { statut: 'faite', version: tachesEntretien[0].version });
  await refuse('era_entretien', 'GET', `/chsld/residents?etablissement_id=${ids.era}`, null, 403);
  // Demande d'hébergement : documents, vérification, place proposée (réservée), acceptée, admission
  const dem = (await api('era', 'GET', `/chsld/demandes?etablissement_id=${ids.era}`))[0];
  assert.strictEqual(dem.statut, 'documents_manquants');
  await refuse('era', 'POST', `/chsld/demandes/${dem.id}/action`, { action: 'verifier', version: dem.version }, 409, 'documents_manquants');
  let d = dem; for (const code of ['carte_assurance_maladie', 'mandat_representant', 'consentement_hebergement']) d = await api('era', 'POST', `/chsld/demandes/${d.id}/action`, { action: 'document', code, recu: true, version: d.version });
  d = await api('era', 'POST', `/chsld/demandes/${d.id}/action`, { action: 'verifier', version: d.version });
  const pl = (await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).find((x) => x.etat === 'libre');
  d = await api('era', 'POST', `/chsld/demandes/${d.id}/action`, { action: 'proposer_place', lit_id: pl.id, version_lit: pl.version, version: d.version });
  d = await api('era', 'POST', `/chsld/demandes/${d.id}/action`, { action: 'accepter', version: d.version });
  const res = (await api('era', 'GET', `/chsld/residents/${d.resident_id}`)).resident;
  await api('era', 'POST', `/chsld/residents/${res.id}/arrivee`, { version: res.version });
  assert.strictEqual((await api('era', 'GET', `/chsld/demandes?etablissement_id=${ids.era}&toutes=1`)).find((x) => x.id === d.id).statut, 'admise');
  RESULTATS.parcours.push('demande d’hébergement : documents → vérification → place proposée → acceptée → admise');
});

test('CHSLD ↔ hôpital : hospitalisation, réception, retour préparé par l’hôpital, accueil confirmé, historique complet', async () => {
  const coB = await api('b', 'GET', `/coordinations?etablissement_id=${(await poolPilote.query("SELECT id FROM etablissements WHERE code='HY'")).rows[0].id}`);
  const hosp = coB.find((c) => c.id === p.hospitalisation);
  assert.ok(hosp && hosp.statut === 'recue');
  assert.ok(!JSON.stringify(coB).includes('Martin'), 'l’hôpital ne voit que la référence du résident');
  // Le CHSLD voit l'hôpital confirmé ; la place reste conservée
  const f = await api('stl', 'GET', `/chsld/residents/${p.martin}`);
  assert.ok(f.localisation && f.localisation.confirmee && /Mont-Clair/.test(f.localisation.hopital));
  assert.strictEqual(f.lit.etat, 'occupe');
  // Retour : accepté par le CHSLD (tâche de préparation), départ confirmé par l'hôpital, arrivée confirmée par le CHSLD
  let co = (await api('stl', 'GET', `/coordinations?etablissement_id=${ids.stl}`)).find((c) => c.id === p.retour);
  await refuse('b', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: hosp.destination_id, action: 'accepter', version: co.version }, 409, 'action_coordination_interdite');
  co = await api('stl', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.stl, action: 'accepter', version: co.version });
  assert.ok((await api('stl', 'GET', `/chsld/taches?etablissement_id=${ids.stl}`)).some((x) => x.type === 'preparation_chambre' && /retour/.test(x.titre)));
  co = await api('b', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: hosp.destination_id, action: 'confirmer_depart', version: co.version });
  co = await api('stl', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.stl, action: 'confirmer_arrivee', version: co.version });
  const apres = await api('stl', 'GET', `/chsld/residents/${p.martin}`);
  assert.strictEqual(apres.resident.statut, 'present');
  const types = apres.mouvements.map((m) => m.type).reverse();
  for (const x of ['admission', 'depart_hopital', 'hospitalisation_confirmee', 'retour_prevu', 'retour']) assert.ok(types.includes(x), `historique : ${x} (${types})`);
  RESULTATS.parcours.push(`CHSLD ↔ Hôpital B : ${types.filter((x) => x !== 'modification').join(' → ')}`);
});

test('inter-CHSLD : demande, acceptation avec place réservée, départ, arrivée ; jamais de double attribution', async () => {
  let co = (await api('era', 'GET', `/coordinations?etablissement_id=${ids.era}`)).find((c) => c.id === p.transfert);
  assert.strictEqual(co.statut, 'envoyee'); assert.ok(!JSON.stringify(co).match(/-Stl1/), 'le CHSLD d’accueil ne voit que la référence avant l’arrivée');
  const libres = (await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).filter((x) => x.etat === 'libre');
  // Concurrence : la même place proposée à deux opérations simultanées n'est attribuée qu'une fois
  const autre = (await api('era', 'GET', `/chsld/residents?etablissement_id=${ids.era}`)).find((r) => r.statut === 'present');
  const [a1, a2] = await Promise.all([
    appel('era', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.era, action: 'accepter', lit_id: libres[0].id, version_lit: libres[0].version, version: co.version }),
    appel('era', 'POST', `/chsld/residents/${autre.id}/changer-chambre`, { lit_id: libres[0].id, version: libres[0].version, version_resident: autre.version })]);
  assert.strictEqual([a1, a2].filter((x) => x.statut === 200).length, 1, `une seule attribution : ${a1.statut} ${a2.statut}`);
  co = (await api('era', 'GET', `/coordinations?etablissement_id=${ids.era}`)).find((c) => c.id === p.transfert);
  if (co.statut === 'envoyee') { const l2 = (await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).find((x) => x.etat === 'libre'); co = await api('era', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.era, action: 'accepter', lit_id: l2.id, version_lit: l2.version, version: co.version }); }
  co = await api('stl', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.stl, action: 'confirmer_depart', version: co.version });
  co = await api('era', 'POST', `/coordinations/${co.id}/action`, { etablissement_id: ids.era, action: 'confirmer_arrivee', version: co.version });
  assert.strictEqual(co.statut, 'recue');
  const arrive = (await api('era', 'GET', `/chsld/residents?etablissement_id=${ids.era}`)).find((r) => r.nom.endsWith('-Stl1'));
  assert.ok(arrive && arrive.statut === 'present' && arrive.contacts >= 1, 'dossier et contacts suivent le résident');
  const parti = (await poolPilote.query(`SELECT statut FROM residents WHERE etablissement_id = $1 AND nom LIKE '%-Stl1'`, [ids.stl])).rows[0];
  assert.strictEqual(parti.statut, 'transfere');
  const doubles = (await poolPilote.query(`SELECT lit_id, count(*) n FROM residents WHERE lit_id IS NOT NULL AND statut NOT IN ('sorti','transfere') GROUP BY lit_id HAVING count(*) > 1`)).rows;
  assert.deepStrictEqual(doubles, [], 'aucune place attribuée à deux résidents');
  RESULTATS.parcours.push('inter-CHSLD Saint-Laurent → Érables : envoyée → acceptée (place réservée) → départ → arrivée ; double attribution refusée');
});

test('sécurité : isolation entre établissements, permissions par rôle, identité jamais transmise hors de l’établissement', async () => {
  await refuse('stl', 'GET', `/chsld/residents/${p.dupont}`, null, 403);
  await refuse('stl', 'GET', `/chsld/residents?etablissement_id=${ids.era}`, null, 403);
  await refuse('b', 'GET', `/chsld/residents?etablissement_id=${ids.era}`, null, 403);
  await refuse('era_soins', 'POST', '/chsld/residents', { etablissement_id: ids.era, prenom: 'X', nom: 'Y', date_naissance: '1940-01-01' }, 403, 'role_insuffisant');
  await refuse('era_soins', 'POST', `/chsld/demandes`, { etablissement_id: ids.era, provenance: 'domicile', prenom: 'X', nom: 'Y', date_naissance: '1940-01-01' }, 403);
  await api('era_soins', 'GET', `/chsld/residents/${p.dupont}`);
  await refuse('a', 'GET', `/chsld/accueil?etablissement_id=${(await poolPilote.query("SELECT id FROM etablissements WHERE code='HX'")).rows[0].id}`, null, 409, 'etab_non_chsld');
  const fuites = (await poolPilote.query(`SELECT action, detail FROM journal WHERE etablissement_id = ANY($1) AND detail ~ '(Dupont|Martin|Bérubé)'`, [[ids.era, ids.stl]])).rows;
  assert.deepStrictEqual(fuites, [], 'aucun nom de résident dans le journal');
});

test('OG CHSLD : mêmes droits, données réelles, propositions à confirmer, refus des décisions humaines, FR et EN', async () => {
  const q = async (qui, e, question, langue = 'fr') => api(qui, 'POST', '/copilote/question', { etablissement_id: e, question, langue });
  let r = await q('era', ids.era, 'Combien de chambres sont disponibles aujourd’hui ?');
  const libres = (await api('era', 'GET', `/chsld/places?etablissement_id=${ids.era}`)).filter((x) => x.etat === 'libre').length;
  assert.match(r.reponse, new RegExp(`^${libres} place`)); assert.strictEqual(r.langue, 'fr');
  r = await q('era', ids.era, 'How many beds are available?', 'fr'); assert.strictEqual(r.langue, 'en'); assert.match(r.reponse, /available place/);
  r = await q('stl', ids.stl, 'Quels résidents sont actuellement hospitalisés ?'); assert.match(r.reponse, /Aucun résident n’est hospitalisé/);
  r = await q('era', ids.era, 'Retrouve le résident Jean Dupont'); assert.match(r.reponse, /Jean Dupont \(R-\d{5}\)/);
  r = await q('era', ids.era, 'Qui sont ses deux contacts principaux ?'); assert.match(r.reponse, /Marie Dupont \(fille\), principal/);
  r = await q('era', ids.era, 'Qui est autorisé à recevoir des informations sur son dossier ?'); assert.match(r.reponse, /Marie Dupont/); assert.doesNotMatch(r.reponse, /Luc Dupont/);
  r = await q('era', ids.era, 'Prépare un message à sa fille pour demander un rappel'); assert.strictEqual(r.proposition_chsld.type, 'communication');
  r = await q('era', ids.era, 'Prépare un message à son fils pour demander un rappel'); assert.match(r.reponse, /n’est autorisé/); assert.ok(!r.proposition_chsld);
  r = await q('era', ids.era, 'Prépare une tâche d’entretien pour la chambre 101'); assert.strictEqual(r.proposition_chsld.type, 'tache');
  r = await q('era', ids.era, 'Montre-moi les chambres en nettoyage'); assert.match(r.reponse, /chambre|Aucune chambre/);
  r = await q('era', ids.era, 'Quelles demandes d’hébergement attendent une confirmation ?'); assert.ok(r.reponse);
  r = await q('era', ids.era, 'Ody, aide-moi à enregistrer un nouveau résident.'); assert.strictEqual(r.formulaire, 'nouveau_resident');
  r = await q('era', ids.era, 'Décide qui doit avoir la prochaine place selon la priorité clinique'); assert.match(r.reponse, /ne décide pas/);
  r = await q('stl', ids.stl, 'Retrouve le résident Jean Dupont'); assert.doesNotMatch(r.reponse, /Jean Dupont/, 'OG du Saint-Laurent ne voit pas les résidents des Érables');
  RESULTATS.og = 'places, hospitalisés, recherche, contacts, autorisations, proposition de rappel (refusée au fils), tâche, demandes, formulaire, refus de décision clinique, isolation, FR/EN';
});

test('non-régression hospitalière : les CHSLD n’entrent jamais dans les capacités ni les recherches des hôpitaux', async () => {
  const hy = (await poolPilote.query("SELECT id FROM etablissements WHERE code='HY'")).rows[0].id;
  const reseau = await api('b', 'GET', `/reseau?depuis=${hy}`);
  assert.ok(!JSON.stringify(reseau).includes('CHSLD'), 'réseau hospitalier sans CHSLD');
  const types = (await poolPilote.query("SELECT id FROM types_unite WHERE code='MED' AND config_id=(SELECT id FROM config_pays WHERE code='QC')")).rows[0].id;
  const rec = await api('b', 'GET', `/recherche?depuis=${hy}&type_id=${types}`);
  assert.ok(!rec.suggestions.some((s) => /CHSLD/.test(s.nom)));
  for (const route of ['/lits', '/admissions', '/civieres', '/transferts', '/nettoyage', '/copilote/briefing']) await api('b', 'GET', `${route}?etablissement_id=${hy}`);
});

test('phase 2 — portail des proches : activé depuis SH, invitation, accès limité, messagerie, révocation, blocage', async () => {
  const era = crees.find((c) => c.code === 'CHSLD-ERA');
  const fd = await api('era', 'GET', `/chsld/residents/${p.dupont}`);
  const fille = fd.contacts.find((k) => k.relation === 'fille'), fils = fd.contacts.find((k) => k.relation === 'fils');
  // Module optionnel désactivé par défaut : aucune invitation possible
  await refuse('era', 'POST', `/chsld/contacts/${fille.id}/acces-portail`, {}, 403, 'module_desactive');
  // Activation depuis SH : licence souscrite, puis configuration opérationnelle publiée vers l'environnement
  const fiche = await sh('GET', `/hopitaux/${era.hopital_id}`);
  await sh('PUT', `/hopitaux/${era.hopital_id}/modules`, { modules: fiche.modules.map((m) => ({ code: m.code, licence: ['portail_proches', 'messagerie_securisee'].includes(m.code) ? 'souscrit' : m.licence })) });
  const cfg = await sh('GET', `/hopitaux/${era.hopital_id}/configuration-operationnelle`);
  assert.ok(cfg.modules_modifiables.includes('portail_proches'));
  await sh('PUT', `/hopitaux/${era.hopital_id}/configuration-operationnelle`, { version: cfg.version, vocation: 'general', modules: Object.fromEntries(cfg.modules_modifiables.map((k) => [k, true])) });
  // Invitations : un contact sans courriel ni autorisation est refusé ; le lien n'est remis qu'une fois
  await refuse('era', 'POST', `/chsld/contacts/${fils.id}/acces-portail`, {}, 409, 'proche_courriel_requis');
  await refuse('era_soins', 'POST', `/chsld/contacts/${fille.id}/acces-portail`, {}, 403, 'role_insuffisant');
  const inv = await api('era', 'POST', `/chsld/contacts/${fille.id}/acces-portail`, {});
  const cle = inv.lien.match(/invitation=([a-f0-9]{64})/)[1];
  assert.strictEqual((await poolPilote.query('SELECT count(*)::int n FROM proches_acces WHERE invitation_hash = $1', [cle])).rows[0].n, 0, 'le jeton n’est jamais stocké en clair');
  await refuse(null, 'POST', '/proches/invitation', { jeton: cle, mot_de_passe: 'court' }, 400, 'mdp_faible');
  await api(null, 'POST', '/proches/invitation', { jeton: cle, mot_de_passe: 'Proche-Fictive-2026' });
  await refuse(null, 'POST', '/proches/invitation', { jeton: cle, mot_de_passe: 'Proche-Fictive-2026' }, 400, 'invitation_invalide');
  await refuse(null, 'POST', '/proches/connexion', { courriel: 'marie.dupont@example.invalid', mot_de_passe: 'Mauvais-mot-2026' }, 401, 'identifiants_incorrects');
  sessions.marie = (await api(null, 'POST', '/proches/connexion', { courriel: 'marie.dupont@example.invalid', mot_de_passe: 'Proche-Fictive-2026' })).token;
  assert.match(sessions.marie, /^P\./);
  // Ce que voit le proche : profil, prénom et initiale du résident, établissement, catégories autorisées ; jamais la chambre ni la référence
  const moi = await api('marie', 'GET', '/proches/moi');
  assert.deepStrictEqual(moi.resident, { prenom: 'Jean', initiale: 'D.' }); assert.strictEqual(moi.etablissement.nom, 'CHSLD des Érables');
  assert.doesNotMatch(JSON.stringify(moi), /ERA-\d|R-\d{5}|chambre|lit_id|hospital/i);
  // Sessions étanches : le jeton du proche n'ouvre pas l'API du personnel, et inversement
  await refuse('marie', 'GET', '/moi', null, 401); await refuse('era', 'GET', '/proches/moi', null, 401);
  // Messagerie : message et demande de rappel ; réponse de l'établissement ; catégorie retirée → refus immédiat
  await api('marie', 'POST', '/proches/messages', { categorie: 'rendez_vous', texte: 'Puis-je venir samedi à 14 h ?' });
  await api('marie', 'POST', '/proches/messages', { categorie: 'administratif', texte: 'Merci de me rappeler pour les documents.', rappel: true });
  const portail = await api('era', 'GET', `/chsld/residents/${p.dupont}/portail`);
  assert.strictEqual(portail.messages.filter((m) => m.sens === 'proche').length, 2);
  assert.ok((await api('era', 'GET', `/chsld/residents/${p.dupont}`)).communications.some((c) => c.type === 'rappel_demande' && c.sens === 'entrant'));
  await api('era', 'POST', `/chsld/residents/${p.dupont}/messages`, { contact_id: fille.id, categorie: 'rendez_vous', texte: 'Oui, samedi à 14 h convient.' });
  assert.ok((await api('marie', 'GET', '/proches/moi')).messages.some((m) => m.sens === 'etablissement' && /samedi/.test(m.texte)));
  const k = (await api('era', 'GET', `/chsld/residents/${p.dupont}`)).contacts.find((x) => x.id === fille.id);
  await api('era', 'PUT', `/chsld/contacts/${k.id}`, { ...k, autorisations: k.autorisations.filter((c) => c !== 'rendez_vous'), version: k.version });
  await refuse('marie', 'POST', '/proches/messages', { categorie: 'rendez_vous', texte: 'Et dimanche ?' }, 403, 'proche_non_autorise');
  assert.ok(!(await api('marie', 'GET', '/proches/moi')).messages.some((m) => m.categorie === 'rendez_vous'), 'les messages d’une catégorie retirée ne sont plus visibles');
  // Révocation : effet immédiat sur la session ouverte
  const acces = (await api('era', 'GET', `/chsld/residents/${p.dupont}/portail`)).acces.find((a) => !a.revoque_le);
  await api('era', 'POST', `/chsld/acces-portail/${acces.id}/revoquer`);
  await refuse('marie', 'GET', '/proches/moi', null, 401);
  // Blocage : 5 échecs bloquent 15 minutes, même avec le bon mot de passe ensuite
  const inv2 = await api('era', 'POST', `/chsld/contacts/${fille.id}/acces-portail`, { expire_le: new Date(Date.now() + 30 * 86400000).toISOString() });
  await api(null, 'POST', '/proches/invitation', { jeton: inv2.lien.match(/invitation=([a-f0-9]{64})/)[1], mot_de_passe: 'Proche-Fictive-2027' });
  for (let i = 0; i < 5; i += 1) await refuse(null, 'POST', '/proches/connexion', { courriel: 'marie.dupont@example.invalid', mot_de_passe: `Faux-${i}-2026xx` }, 401);
  await refuse(null, 'POST', '/proches/connexion', { courriel: 'marie.dupont@example.invalid', mot_de_passe: 'Proche-Fictive-2027' }, 401, 'identifiants_incorrects');
  await poolPilote.query('UPDATE proches_acces SET bloque_jusqu_au = now() - interval \'1 second\' WHERE revoque_le IS NULL AND courriel = $1', ['marie.dupont@example.invalid']);
  sessions.marie = (await api(null, 'POST', '/proches/connexion', { courriel: 'marie.dupont@example.invalid', mot_de_passe: 'Proche-Fictive-2027' })).token;
  assert.match((await api('marie', 'GET', '/proches/moi')).expire_le, /^\d{4}-/);
  const page = await fetch(`${basePilote}/proches`); assert.strictEqual(page.status, 200);
  // Journal : aucune donnée personnelle du proche ni texte de message
  const j = (await poolPilote.query(`SELECT string_agg(detail, ' ') t FROM journal WHERE action = 'Portail des proches'`)).rows[0].t;
  assert.doesNotMatch(j, /Marie|samedi|Dupont|example\.invalid/);
  RESULTATS.portail = 'module optionnel activé depuis SH ; invitation à usage unique (empreinte seulement) ; mot de passe robuste ; aucune chambre ni référence exposée ; sessions étanches ; catégories respectées et retrait immédiat ; messagerie et rappel ; révocation immédiate ; blocage après 5 échecs ; journal sans donnée personnelle';
});

test('captures : formulaire SH (type puis modules), liste SH, écrans CHSLD réels', { timeout: 180000 }, async () => {
  const { chromium } = require('playwright'); const dossier = path.resolve('.local/captures-chsld'); fs.mkdirSync(dossier, { recursive: true });
  const navigateur = await chromium.launch(); const erreurs = [];
  try {
    // Console SH : session de l'administration (jeton déjà ouvert), formulaire de création
    const ctxSh = await navigateur.newContext({ viewport: { width: 1366, height: 1000 } }); const s = await ctxSh.newPage(); s.on('pageerror', (e) => erreurs.push(`SH ${e}`));
    await s.addInitScript((j) => sessionStorage.setItem('sh-token', j), jetonSh);
    await s.goto(baseSh); await s.waitForSelector('#b-nouveau');
    await s.screenshot({ path: `${dossier}/sh-liste-etablissements.png` });
    await s.click('#b-nouveau'); await s.waitForSelector('#h-modules [data-module]');
    await s.selectOption('#h-type', 'chsld'); await s.waitForSelector('#h-modules [data-module="residents"]');
    await s.screenshot({ path: `${dossier}/sh-formulaire-chsld.png`, fullPage: true });
    assert.strictEqual(await s.locator('#h-type option[value="rpa"]').isDisabled(), true, 'RPA non sélectionnable');
    assert.strictEqual(await s.locator('#h-modules [data-module="appels_video"]').isDisabled(), true, 'appels vidéo (à l’étude) non cochables');
    assert.strictEqual(await s.locator('#h-modules [data-module="portail_proches"]').isChecked(), false, 'portail des proches : optionnel, non coché d’office');
    assert.strictEqual(await s.locator('#h-modules [data-module="og"]').isDisabled(), true, 'module commun inclus');
    await s.selectOption('#h-type', 'hopital'); await s.waitForSelector('#h-modules [data-module="civieres"]');
    await s.screenshot({ path: `${dossier}/sh-formulaire-hopital.png`, fullPage: true });
    await ctxSh.close();
    // Arrimo CHSLD : accueil, fiche résident, chambres (ordinateur), accueil (téléphone)
    for (const [nom, vp] of [['ordinateur', { width: 1440, height: 1000 }], ['telephone', { width: 390, height: 844 }]]) {
      const ctx = await navigateur.newContext({ viewport: vp }); const pg = await ctx.newPage(); pg.on('pageerror', (e) => erreurs.push(`${nom} ${e}`));
      await pg.addInitScript(({ jeton, id }) => { localStorage.setItem('arrimo-token', jeton); localStorage.setItem('arrimo-ctx', String(id)); localStorage.setItem('arrimo-langue', 'fr'); }, { jeton: sessions.era, id: ids.era });
      await pg.goto(basePilote); await pg.waitForSelector('body[data-pret="1"]');
      if (await pg.locator('#b-premiers-pas-ok').isVisible().catch(() => false)) await pg.click('#b-premiers-pas-ok');
      await pg.waitForSelector('#v-c-accueil .tuiles');
      assert.strictEqual(await pg.locator('#onglets button[data-v="urgence"]').isHidden(), true, 'aucun onglet d’urgence en CHSLD');
      await pg.screenshot({ path: `${dossier}/chsld-accueil-${nom}.png`, fullPage: nom === 'ordinateur' });
      if (nom === 'ordinateur') {
        await pg.click('#onglets button[data-v="c-residents"]'); await pg.waitForSelector('#v-c-residents table');
        await pg.fill('#ch-q', 'Dupont'); await pg.waitForFunction(() => document.querySelectorAll('#v-c-residents tbody tr').length === 1);
        await pg.click('#v-c-residents [data-res]'); await pg.waitForSelector('#v-c-residents .ch-contact-item');
        await pg.screenshot({ path: `${dossier}/chsld-fiche-resident.png`, fullPage: true });
        await pg.click('#onglets button[data-v="c-chambres"]'); await pg.waitForSelector('#v-c-chambres .ch-place');
        await pg.screenshot({ path: `${dossier}/chsld-chambres.png` });
        await pg.click('#onglets button[data-v="c-mouvements"]'); await pg.waitForSelector('#v-c-mouvements .panneau-c');
        await pg.screenshot({ path: `${dossier}/chsld-transferts-hospitalisations.png`, fullPage: true });
      }
      await ctx.close();
    }
    const ctxP = await navigateur.newContext({ viewport: { width: 390, height: 844 } }); const pp = await ctxP.newPage(); pp.on('pageerror', (e) => erreurs.push(`portail ${e}`));
    await pp.addInitScript((j) => sessionStorage.setItem('arrimo-proche', j), sessions.marie);
    await pp.goto(`${basePilote}/proches`); await pp.waitForSelector('#txt');
    await pp.screenshot({ path: `${dossier}/portail-proches-telephone.png`, fullPage: true });
    await ctxP.close();
  } finally { await navigateur.close(); }
  assert.deepStrictEqual(erreurs, []);
  RESULTATS.captures = fs.readdirSync(path.resolve('.local/captures-chsld'));
});
