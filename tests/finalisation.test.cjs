/**
 * Finalisation (démonstration du 27 octobre 2026) : cohérence Admissions / Lits / Urgences, congés par lit,
 * blocages explicables, OG transversal, pédiatrie et groupes d'âge, patients fictifs.
 * Base PostgreSQL de test (TEST_DATABASE_URL), données fictives seulement.
 */
const test = require('node:test');
const assert = require('node:assert');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const routage = require('../src/routage');
const totp = require('../src/totp');

let pool; let serveur; let base;
const tokens = {};

function routeurFictif(url) {
  const km = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]) * 111000);
  const mat = String(url).match(/\/table\/v1\/[^/]+\/([^?]+)/);
  if (mat) {
    const p = mat[1].split(';').map((x) => x.split(',').map(Number));
    return { ok: true, json: async () => ({ code: 'Ok', data_version: 'fixture', distances: [p.slice(1).map((x) => km(p[0], x))], durations: [p.slice(1).map((x) => Math.max(60, km(p[0], x) / 1000 * 60))] }) };
  }
  const r = String(url).match(/\/route\/v1\/[^/]+\/([^?]+)/);
  if (r) {
    const p = r[1].split(';').map((x) => x.split(',').map(Number));
    return { ok: true, json: async () => ({ code: 'Ok', data_version: 'fixture', routes: [{ distance: km(p[0], p[1]), duration: Math.max(60, km(p[0], p[1]) / 1000 * 60), geometry: { type: 'LineString', coordinates: p } }] }) };
  }
  return { ok: false, json: async () => ({}) };
}

async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${tokens[qui]}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
const id = async (code) => (await pool.query('SELECT id FROM etablissements WHERE code = $1', [code])).rows[0].id;
const type = async (code) => (await pool.query('SELECT id FROM types_unite WHERE code = $1', [code])).rows[0].id;
const lit = async (litId) => (await pool.query('SELECT * FROM lits WHERE id = $1', [litId])).rows[0];
const demande = async (dId) => (await pool.query('SELECT * FROM demandes_admission WHERE id = $1', [dId])).rows[0];
/** Un lit libre sans équipement particulier (préparé directement en base si l'hôpital fictif est saturé). */
async function litLibre(etab, t) {
  const q = () => pool.query(`SELECT id, version, code FROM lits WHERE etablissement_id = $1 AND type_id = $2 AND etat = 'libre'
    AND NOT isolement AND NOT pression_negative AND NOT ventilation AND NOT telemetrie ORDER BY code LIMIT 1`, [etab, t]);
  let r = (await q()).rows[0];
  if (r) return r;
  await pool.query(`UPDATE lits SET etat = 'libre', patient_ref = NULL, isolement = false, pression_negative = false, ventilation = false, telemetrie = false,
      sortie_prevue = NULL, conge_statut = NULL, nsa_depuis = NULL, nsa_orientation = NULL, motif_indispo = NULL, transfert_id = NULL, version = version + 1
    WHERE id = (SELECT l.id FROM lits l WHERE l.etablissement_id = $1 AND l.type_id = $2 AND l.transfert_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM demandes_admission d WHERE d.lit_id = l.id AND d.statut = 'assignee') ORDER BY (l.etat = 'occupe'), l.code LIMIT 1)`, [etab, t]);
  r = (await q()).rows[0];
  assert.ok(r, 'lit libre de test');
  return r;
}
/** Une civière libre pour le patient (créée au besoin), puis le patient y est placé. */
async function surCiviere(qui, etab, ref) {
  let cv = (await pool.query(`SELECT id, version FROM civieres WHERE etablissement_id = $1 AND etat = 'libre' ORDER BY id LIMIT 1`, [etab])).rows[0];
  if (!cv) cv = (await pool.query(`INSERT INTO civieres (etablissement_id, code) VALUES ($1, 'T-' || nextval('patient_seq')) RETURNING id, version`, [etab])).rows[0];
  const r = await appel(qui, 'POST', `/civieres/${cv.id}/action`, { action: 'placer', version: cv.version, patient_ref: ref });
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  return cv.id;
}

test.before(async () => {
  process.env.ARRIMO_ROUTEUR_URL = 'http://routeur-fictif.test';
  routage.definirFetchTest(async (url) => routeurFictif(url));
  pool = creerPool(process.env.TEST_DATABASE_URL);
  await viderBase(pool);
  await seed(pool, { silencieux: true });
  serveur = creerApp(pool).listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${serveur.address().port}`;
  const secret = totp.nouveauSecret();
  await pool.query(`UPDATE utilisateurs SET totp_secret = $1, totp_actif = true, totp_dernier_pas = 0 WHERE email = 'reseau@demo.arrimo'`, [secret]);
  for (const q of ['tremblay', 'bouchard', 'roy', 'reseau']) {
    let r = await appel(null, 'POST', '/connexion', { email: `${q}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO });
    if (r.corps?.etape === '2fa') r = await appel(null, 'POST', '/connexion/2fa', { jeton: r.corps.jeton, code: totp.codePourPas(secret, totp.pasActuel()) });
    assert.strictEqual(r.statut, 200, q);
    tokens[q] = r.corps.token;
  }
});
test.after(async () => { serveur?.close(); await pool?.end(); routage.definirFetchTest(null); });

test('admission depuis la fiche Lit : demande finalisée, lit occupé, civière au nettoyage ; idempotente', async () => {
  const sl = await id('SL'); const med = await type('MED');
  const cvId = await surCiviere('bouchard', sl, 'P-71001');
  const d = await appel('bouchard', 'POST', '/admissions', { etablissement_id: sl, type_id: med, patient_ref: 'P-71001', civiere_id: cvId });
  assert.strictEqual(d.statut, 200, JSON.stringify(d.corps));
  // Une seconde demande active pour le même patient est refusée avec un message clair
  const doublon = await appel('bouchard', 'POST', '/admissions', { etablissement_id: sl, type_id: med, patient_ref: 'P-71001' });
  assert.strictEqual(doublon.statut, 409); assert.strictEqual(doublon.corps.code, 'patient_deja_demande');
  const l = await litLibre(sl, med);
  assert.strictEqual((await appel('bouchard', 'POST', `/admissions/${d.corps.id}/assigner`, { lit_id: l.id, version: l.version })).statut, 200);
  // Le personnel admet depuis l'écran Lits (et non depuis Admissions)
  const v = (await lit(l.id)).version;
  const a = await appel('bouchard', 'POST', `/lits/${l.id}/action`, { action: 'admettre', version: v });
  assert.strictEqual(a.statut, 200, JSON.stringify(a.corps));
  assert.strictEqual((await lit(l.id)).etat, 'occupe');
  assert.strictEqual((await demande(d.corps.id)).statut, 'admise', 'la demande quitte la file active');
  assert.strictEqual((await pool.query('SELECT etat FROM civieres WHERE id = $1', [cvId])).rows[0].etat, 'nettoyage', 'la civière part au nettoyage');
  const file = await appel('bouchard', 'GET', `/admissions?etablissement_id=${sl}`);
  assert.ok(!file.corps.some((x) => x.id === d.corps.id));
  // Second clic depuis Admissions : aucune transition « occupé → occupé », réponse idempotente
  const a2 = await appel('bouchard', 'POST', `/admissions/${d.corps.id}/admettre`);
  assert.strictEqual(a2.statut, 200); assert.strictEqual(a2.corps.deja_admise, true);
  const a3 = await appel('bouchard', 'POST', `/lits/${l.id}/action`, { action: 'admettre' });
  assert.strictEqual(a3.statut, 409); assert.strictEqual(a3.corps.code, 'lit_deja_occupe');
  const occ = await pool.query(`SELECT count(*)::int n FROM journal WHERE lit_id = $1 AND nouvel_etat = 'occupe' AND NOT refuse`, [l.id]);
  assert.strictEqual(occ.rows[0].n, 1, 'une seule admission journalisée');
});

test('réserver puis annuler depuis la fiche Lit : la demande suit (assignée, puis remise en attente)', async () => {
  const sl = await id('SL'); const med = await type('MED');
  const d = await appel('bouchard', 'POST', '/admissions', { etablissement_id: sl, type_id: med, patient_ref: 'P-71002', provenance: 'bloc' });
  const l = await litLibre(sl, med);
  const r = await appel('bouchard', 'POST', `/lits/${l.id}/action`, { action: 'reserver', version: l.version, patient_ref: 'P-71002' });
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  let dm = await demande(d.corps.id);
  assert.strictEqual(dm.statut, 'assignee'); assert.strictEqual(dm.lit_id, l.id);
  // Un autre lit pour le même patient : refusé, il a déjà un lit assigné
  const autre = await litLibre(sl, med);
  const r2 = await appel('bouchard', 'POST', `/lits/${autre.id}/action`, { action: 'reserver', version: autre.version, patient_ref: 'P-71002' });
  assert.strictEqual(r2.corps.code, 'patient_deja_assigne');
  const an = await appel('bouchard', 'POST', `/lits/${l.id}/action`, { action: 'annuler', version: (await lit(l.id)).version });
  assert.strictEqual(an.statut, 200);
  dm = await demande(d.corps.id);
  assert.strictEqual(dm.statut, 'attente'); assert.strictEqual(dm.lit_id, null);
  assert.strictEqual((await lit(l.id)).etat, 'libre');
  await appel('bouchard', 'POST', `/admissions/${d.corps.id}/annuler`);
});

test('ancienne désynchronisation (lit déjà occupé, demande encore assignée) : réparée sans transition interdite', async () => {
  const sl = await id('SL'); const med = await type('MED');
  const cvId = await surCiviere('bouchard', sl, 'P-71003');
  const d = await appel('bouchard', 'POST', '/admissions', { etablissement_id: sl, type_id: med, patient_ref: 'P-71003', civiere_id: cvId });
  const l = await litLibre(sl, med);
  await appel('bouchard', 'POST', `/admissions/${d.corps.id}/assigner`, { lit_id: l.id, version: l.version });
  // État produit par l'ancienne version : le lit est passé à « occupé » sans la demande
  await pool.query(`UPDATE lits SET etat = 'occupe', version = version + 1 WHERE id = $1`, [l.id]);
  const a = await appel('bouchard', 'POST', `/admissions/${d.corps.id}/admettre`);
  assert.strictEqual(a.statut, 200, JSON.stringify(a.corps));
  assert.strictEqual((await demande(d.corps.id)).statut, 'admise');
  assert.strictEqual((await pool.query('SELECT etat FROM civieres WHERE id = $1', [cvId])).rows[0].etat, 'nettoyage');
  const j = await pool.query(`SELECT 1 FROM journal WHERE lit_id = $1 AND action = 'Admission synchronisée'`, [l.id]);
  assert.strictEqual(j.rowCount, 1);
});

test('lit réservé pour un transfert : l’admission se fait par la réception, pas depuis la fiche Lit', async () => {
  const mb = await id('MB'); const sl = await id('SL'); const med = await type('MED');
  await pool.query(`UPDATE lits SET disponibilite_confirmee_le = now() WHERE etablissement_id = $1 AND type_id = $2 AND etat = 'libre'`, [sl, med]);
  const tr = await appel('tremblay', 'POST', '/transferts', { origine_id: mb, destination_id: sl, type_id: med, patient_ref: 'P-71004' });
  assert.strictEqual(tr.statut, 200, JSON.stringify(tr.corps));
  const a = await appel('bouchard', 'POST', `/lits/${tr.corps.lit_id}/action`, { action: 'admettre' });
  assert.strictEqual(a.statut, 409); assert.strictEqual(a.corps.code, 'admission_par_transfert');
  assert.strictEqual((await lit(tr.corps.lit_id)).etat, 'reserve');
});

test('admissions simultanées de la même demande depuis deux écrans : une seule admission', async () => {
  const sl = await id('SL'); const chir = await type('CHIR');
  const cvId = await surCiviere('bouchard', sl, 'P-71005');
  const d = await appel('bouchard', 'POST', '/admissions', { etablissement_id: sl, type_id: chir, patient_ref: 'P-71005', civiere_id: cvId });
  const l = await litLibre(sl, chir);
  await appel('bouchard', 'POST', `/admissions/${d.corps.id}/assigner`, { lit_id: l.id, version: l.version });
  const res = await Promise.all([
    appel('bouchard', 'POST', `/admissions/${d.corps.id}/admettre`),
    appel('bouchard', 'POST', `/lits/${l.id}/action`, { action: 'admettre' }),
    appel('bouchard', 'POST', `/admissions/${d.corps.id}/admettre`),
  ]);
  assert.ok(res.every((r) => [200, 409].includes(r.statut)), JSON.stringify(res.map((r) => r.corps)));
  assert.strictEqual((await lit(l.id)).etat, 'occupe');
  assert.strictEqual((await demande(d.corps.id)).statut, 'admise');
  const occ = await pool.query(`SELECT count(*)::int n FROM journal WHERE lit_id = $1 AND nouvel_etat = 'occupe' AND NOT refuse`, [l.id]);
  assert.strictEqual(occ.rows[0].n, 1);
});

test('congés par lit : prévu, confirmé, retard sans libération automatique, départ réel ; alertes explicables', async () => {
  const sl = await id('SL'); const med = await type('MED');
  const l = await litLibre(sl, med);
  await appel('bouchard', 'POST', `/lits/${l.id}/action`, { action: 'reserver', version: l.version, patient_ref: 'P-72001' });
  await appel('bouchard', 'POST', `/lits/${l.id}/action`, { action: 'admettre' });
  const dans2h = new Date(Date.now() + 2 * 3600000).toISOString();
  assert.strictEqual((await appel('bouchard', 'PUT', `/lits/${l.id}/conge`, { statut: 'prevu', sortie_prevue: dans2h })).statut, 200);
  let c = await appel('bouchard', 'GET', `/conges?etablissement_id=${sl}&horizon=4`);
  assert.strictEqual(c.statut, 200, JSON.stringify(c.corps));
  let ligne = c.corps.lignes.find((x) => x.lit === l.code);
  assert.ok(ligne, 'le lit est listé par son numéro');
  assert.strictEqual(ligne.statut, 'prevu'); assert.strictEqual(ligne.etat, 'occupe'); assert.strictEqual(ligne.disponibilite_estimee, null);
  assert.ok(ligne.chambre && ligne.unite);
  assert.ok(c.corps.resume[4].lits.includes(l.code));
  assert.ok(c.corps.donnees_lues_le && c.corps.controle_periodique);
  await appel('bouchard', 'PUT', `/lits/${l.id}/conge`, { statut: 'confirme' });
  ligne = (await appel('bouchard', 'GET', `/conges?etablissement_id=${sl}&statut=confirme`)).corps.lignes.find((x) => x.lit === l.code);
  assert.ok(ligne.disponibilite_estimee && ligne.disponibilite_estimee_regle, 'estimation justifiée pour un congé confirmé');
  // Heure dépassée : vérification nécessaire, le lit reste occupé
  await appel('bouchard', 'PUT', `/lits/${l.id}/conge`, { statut: 'confirme', sortie_prevue: new Date(Date.now() - 90 * 60000).toISOString() });
  ligne = (await appel('bouchard', 'GET', `/conges?etablissement_id=${sl}&statut=retard`)).corps.lignes.find((x) => x.lit === l.code);
  assert.strictEqual(ligne.verification, 'verification_necessaire');
  assert.strictEqual((await lit(l.id)).etat, 'occupe');
  const v = await appel('bouchard', 'GET', `/vigilance?etablissement_id=${sl}`);
  const al = v.corps.alertes.find((a) => a.type === 'conge_retarde' && a.ressource === l.code);
  assert.ok(al, 'alerte de congé retardé');
  for (const k of ['etablissement', 'unite', 'duree_min', 'evenement', 'seuil', 'cause', 'action', 'responsable', 'actualise_le']) assert.ok(al[k] != null, k);
  assert.strictEqual(al.cause.nature, 'hypothese', 'une hypothèse n’est pas présentée comme un fait');
  // Départ réel : historique « réalisé » avec l'heure
  await appel('bouchard', 'POST', `/lits/${l.id}/action`, { action: 'liberer' });
  const h = (await pool.query(`SELECT statut, depart_reel_le FROM conges WHERE lit_id = $1 ORDER BY id DESC LIMIT 1`, [l.id])).rows[0];
  assert.strictEqual(h.statut, 'realise'); assert.ok(h.depart_reel_le);
  ligne = (await appel('bouchard', 'GET', `/conges?etablissement_id=${sl}`)).corps.lignes.find((x) => x.lit === l.code);
  assert.strictEqual(ligne.statut, 'realise');
});

test('vigilance : réservation prolongée identifiée sans annulation automatique', async () => {
  const sl = await id('SL'); const chir = await type('CHIR');
  const l = await litLibre(sl, chir);
  await appel('bouchard', 'POST', `/lits/${l.id}/action`, { action: 'reserver', version: l.version, patient_ref: 'P-72002' });
  await pool.query(`UPDATE lits SET etat_depuis = now() - interval '4 hours' WHERE id = $1`, [l.id]);
  const v = await appel('bouchard', 'GET', `/vigilance?etablissement_id=${sl}`);
  const al = v.corps.alertes.find((a) => a.type === 'reservation_prolongee' && a.ressource === l.code);
  assert.ok(al); assert.match(al.titre, /Réservé depuis 4 h sans admission enregistrée/);
  assert.match(al.action, /maintenue/);
  assert.strictEqual((await lit(l.id)).etat, 'reserve', 'rien n’est annulé automatiquement');
  assert.ok(v.corps.regles_couleurs.eleve);
  // Isolation : un autre établissement ne lit pas ces alertes
  assert.strictEqual((await appel('tremblay', 'GET', `/vigilance?etablissement_id=${sl}`)).statut, 403);
  assert.strictEqual((await appel('tremblay', 'GET', `/conges?etablissement_id=${sl}`)).statut, 403);
});

test('OG transversal : congé d’un lit précis, numéros exacts, contexte, sources ; permissions entre établissements', async () => {
  const sl = await id('SL'); const mb = await id('MB'); const med = await type('MED');
  const l = await litLibre(sl, med);
  await appel('bouchard', 'POST', `/lits/${l.id}/action`, { action: 'reserver', version: l.version, patient_ref: 'P-73001' });
  await appel('bouchard', 'POST', `/lits/${l.id}/action`, { action: 'admettre' });
  await appel('bouchard', 'PUT', `/lits/${l.id}/conge`, { statut: 'prevu', sortie_prevue: new Date(Date.now() + 3 * 3600000).toISOString() });
  const q = async (qui, etab, question) => (await appel(qui, 'POST', '/copilote/question', { etablissement_id: etab, question })).corps;
  const r1 = await q('bouchard', sl, `Le lit ${l.code} a-t-il un congé prévu ou confirmé ?`);
  assert.match(r1.reponse, new RegExp(`Lit ${l.code}`)); assert.match(r1.reponse, /Congé prévu/); assert.match(r1.reponse, /n’est pas libre/);
  assert.ok(r1.sources.some((x) => x.module === 'Congés'), 'sources citées');
  const r2 = await q('bouchard', sl, 'Quels lits vont se libérer dans les 4 prochaines heures ?');
  assert.match(r2.reponse, new RegExp(l.code), 'numéro exact du lit');
  const r3 = await q('bouchard', sl, 'Ce lit a-t-il un congé ?');
  assert.match(r3.reponse, new RegExp(`Lit ${l.code}`), 'référence au contexte');
  // Composée : deux intentions dans une même question
  const r4 = await q('bouchard', sl, 'Combien de lits libres en chirurgie et quelles demandes de transfert attendent une réponse ?');
  assert.deepStrictEqual(r4.intentions, ['lits_libres', 'transferts']);
  // Un autre établissement n'obtient jamais le patient de SL
  const r5 = await q('tremblay', mb, `Le lit ${l.code} a-t-il un congé prévu ?`);
  assert.doesNotMatch(r5.reponse, /P-73001/);
  assert.strictEqual((await appel('tremblay', 'POST', '/copilote/question', { etablissement_id: sl, question: 'État actuel ?' })).statut, 403);
  // Données absentes : OG le dit, sans inventer
  const r6 = await q('bouchard', sl, 'Le lit ZZZ-999 a-t-il un congé prévu ?');
  assert.match(r6.reponse, /Je ne trouve pas de lit ZZZ-999/);
  const r7 = await q('bouchard', sl, 'De quel lit tu parles, celui-ci ?');
  assert.ok(r7.reponse.length > 10);
});

test('administration et SH : spécialité du catalogue, lits avec groupe d’âge, civière d’isolement, import, modules par établissement', async () => {
  const sl = await id('SL');
  const cfg = (await pool.query('SELECT config_id FROM etablissements WHERE id = $1', [sl])).rows[0].config_id;
  const a = async (m, c, b) => appel('reseau', m, c, b);
  const sp = await a('POST', '/admin/specialites', { config_id: cfg, code: 'PED' });
  assert.strictEqual(sp.statut, 200, JSON.stringify(sp.corps)); assert.strictEqual(sp.corps.groupe_age, 'pediatrique');
  assert.strictEqual((await a('POST', '/admin/specialites', { config_id: cfg, code: 'INCONNUE' })).corps.code, 'specialite_inconnue');
  assert.strictEqual((await appel('bouchard', 'POST', '/admin/specialites', { config_id: cfg, code: 'SIP' })).statut, 403);
  const u = await a('POST', '/admin/unites', { etablissement_id: sl, type_id: sp.corps.id, nom: 'Pédiatrie test' });
  assert.strictEqual(u.statut, 200, JSON.stringify(u.corps));
  const ch = await a('POST', '/admin/chambres', { unite_id: u.corps.id, numero: '901', capacite_declaree: 2 });
  const l1 = await a('POST', '/admin/lits', { chambre_id: ch.corps.id, code: 'PED-901A' });
  assert.strictEqual(l1.corps.groupe_age, 'pediatrique', 'groupe d’âge hérité du type');
  const l2 = await a('POST', '/admin/lits', { chambre_id: ch.corps.id, code: 'PED-901B', groupe_age: 'tous' });
  assert.strictEqual(l2.corps.groupe_age, 'tous');
  assert.strictEqual((await a('POST', '/admin/lits', { chambre_id: ch.corps.id, code: 'PED-901C' })).corps.code, 'structure_capacite_depassee');
  const cv = await a('POST', '/admin/civieres', { etablissement_id: sl, code: 'ISO-T1', categorie: 'isolement' });
  assert.strictEqual(cv.statut, 200, JSON.stringify(cv.corps));
  // Import : colonne groupe_age
  const contenu = 'unite;chambre;lit;groupe_age\nPédiatrie test;901;PED-901B;neonatal\n';
  const v = await a('POST', '/admin/import/verifier', { etablissement_id: sl, type: 'lits', contenu });
  assert.strictEqual(v.statut, 200, JSON.stringify(v.corps));
  await a('POST', '/admin/import/importer', { etablissement_id: sl, type: 'lits', contenu, empreinte: v.corps.empreinte });
  assert.strictEqual((await pool.query(`SELECT groupe_age FROM lits WHERE code = 'PED-901B'`)).rows[0].groupe_age, 'neonatal');
  // Un adulte ne reçoit pas un lit pédiatrique ; un enfant oui
  await pool.query(`UPDATE lits SET disponibilite_confirmee_le = now() WHERE code IN ('PED-901A', 'PED-901B')`);
  const rAd = await appel('tremblay', 'GET', `/recherche?depuis=${await id('MB')}&type_id=${sp.corps.id}&groupe_age=adulte`);
  assert.ok(!rAd.corps.suggestions.some((x) => x.etablissement_id === sl && x.libres > 0));
  const rEnf = await appel('tremblay', 'GET', `/recherche?depuis=${await id('MB')}&type_id=${sp.corps.id}`);
  assert.ok(rEnf.corps.suggestions.some((x) => x.etablissement_id === sl && x.libres_confirmes === 1), 'le type pédiatrique sert de groupe par défaut');
  // Modules par établissement, réglés depuis la console SH
  const cle = { 'X-SH-Key': 'cle-de-test-sh-finalisation' };
  process.env.SH_API_KEY = 'cle-de-test-sh-finalisation';
  const r = await fetch(`${base}/api/sh/etablissements/SL`, { method: 'PUT', headers: { 'content-type': 'application/json', ...cle }, body: JSON.stringify({ modules: { nsa: false }, vocation: 'general', par: 'sh@test' }) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await appel('bouchard', 'GET', `/nsa?etablissement_id=${sl}`)).corps.code, 'module_desactive');
  const sp2 = await fetch(`${base}/api/sh/etablissements/SL/specialites`, { method: 'POST', headers: { 'content-type': 'application/json', ...cle }, body: JSON.stringify({ specialite: 'NEO', par: 'sh@test' }) });
  assert.strictEqual((await sp2.json()).groupe_age, 'neonatal');
  await pool.query(`UPDATE etablissements SET modules = '{}' WHERE id = $1`, [sl]);
  assert.strictEqual((await appel('bouchard', 'GET', `/nsa?etablissement_id=${sl}`)).statut, 200);
});
