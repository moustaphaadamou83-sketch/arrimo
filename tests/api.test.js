/**
 * Tests de bout en bout sur une vraie base PostgreSQL (TEST_DATABASE_URL).
 * La base de test est entièrement réinitialisée à chaque exécution.
 */
const test = require('node:test');
const assert = require('node:assert');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { detecterBlocages } = require('../src/services');
const { viderBase } = require('../db/vider');

const URL_TEST = process.env.TEST_DATABASE_URL;
let pool; let serveur; let base;
const tokens = {};

async function appel(qui, methode, chemin, corps, entetes = {}) {
  const r = await fetch(`${base}/api${chemin}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${tokens[qui]}` } : {}), ...entetes },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
const id = async (code) => (await pool.query('SELECT id FROM etablissements WHERE code = $1', [code])).rows[0].id;
const type = async (code) => (await pool.query('SELECT id FROM types_unite WHERE code = $1', [code])).rows[0].id;
const litLibre = async (etab, t) => (await pool.query(
  `SELECT id, version, code FROM lits WHERE etablissement_id = $1 ${t ? 'AND type_id = $2' : ''} AND etat = 'libre' ORDER BY code LIMIT 1`,
  t ? [etab, t] : [etab])).rows[0];

test.before(async () => {
  assert.ok(URL_TEST, 'TEST_DATABASE_URL requis');
  pool = creerPool(URL_TEST);
  await viderBase(pool);
  await seed(pool, { silencieux: true });
  process.env.SH_API_KEY = 'cle-de-test-sh-123456';
  serveur = creerApp(pool).listen(0);
  base = `http://127.0.0.1:${serveur.address().port}`;
  for (const q of ['tremblay', 'bouchard', 'roy', 'cote', 'reseau']) {
    const r = await appel(null, 'POST', '/connexion', { email: `${q}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO });
    assert.strictEqual(r.statut, 200, `connexion ${q}`);
    tokens[q] = r.corps.token;
  }
});
test.after(async () => { serveur.close(); await pool.end(); });

test('connexion : mauvais mot de passe refusé, accès sans session refusé', async () => {
  const r = await appel(null, 'POST', '/connexion', { email: 'tremblay@demo.arrimo', mot_de_passe: 'faux' });
  assert.strictEqual(r.statut, 401);
  assert.strictEqual((await appel(null, 'GET', '/moi')).statut, 401);
});

test('cycle complet d’un lit, version et journal', async () => {
  const mb = await id('MB');
  const l = await litLibre(mb);
  let r = await appel('tremblay', 'POST', `/lits/${l.id}/action`, { action: 'reserver', version: l.version, patient_ref: 'P-12345' });
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  for (const action of ['admettre', 'liberer', 'nettoyage_ok']) {
    r = await appel('tremblay', 'POST', `/lits/${l.id}/action`, { action });
    assert.strictEqual(r.statut, 200, action);
  }
  assert.strictEqual(r.corps.etat, 'libre');
  assert.strictEqual(r.corps.patient_ref, null);
  assert.strictEqual(r.corps.version, l.version + 4);
  const j = await pool.query(`SELECT count(*)::int AS n FROM journal WHERE lit_id = $1 AND action = 'Changement d’état'`, [l.id]);
  assert.strictEqual(j.rows[0].n, 4);
});

test('transition interdite refusée et journalisée', async () => {
  const l = await litLibre(await id('MB'));
  const r = await appel('tremblay', 'POST', `/lits/${l.id}/action`, { action: 'liberer' });
  assert.strictEqual(r.statut, 409);
  const j = await pool.query('SELECT count(*)::int AS n FROM journal WHERE lit_id = $1 AND refuse', [l.id]);
  assert.ok(j.rows[0].n >= 1);
});

test('un lit ne peut être pris qu’une fois : 10 réservations simultanées, une seule gagne', async () => {
  const l = await litLibre(await id('MB'));
  const avant = (await pool.query('SELECT count(*)::int AS n FROM journal WHERE lit_id = $1 AND refuse', [l.id])).rows[0].n;
  const essais = await Promise.all(Array.from({ length: 10 }, (_, i) => appel('tremblay', 'POST', `/lits/${l.id}/action`,
    { action: 'reserver', version: l.version, patient_ref: `P-${String(30000 + i)}` })));
  const ok = essais.filter((e) => e.statut === 200);
  assert.strictEqual(ok.length, 1, essais.map((e) => e.statut).join(','));
  assert.ok(essais.filter((e) => e.statut === 409).length === 9);
  const lit = (await pool.query('SELECT etat, version FROM lits WHERE id = $1', [l.id])).rows[0];
  assert.strictEqual(lit.etat, 'reserve');
  assert.strictEqual(lit.version, l.version + 1);
  const refus = await pool.query('SELECT count(*)::int AS n FROM journal WHERE lit_id = $1 AND refuse', [l.id]);
  assert.strictEqual(refus.rows[0].n - avant, 9, 'chaque refus est journalisé');
  await appel('tremblay', 'POST', `/lits/${l.id}/action`, { action: 'annuler' });
});

test('aucune donnée médicale : la référence doit respecter le format', async () => {
  const l = await litLibre(await id('MB'));
  const r = await appel('tremblay', 'POST', `/lits/${l.id}/action`, { action: 'reserver', version: l.version, patient_ref: 'Mme X, insuffisance cardiaque' });
  assert.strictEqual(r.statut, 400);
});

test('journal immuable même en accès direct à la base', async () => {
  await assert.rejects(pool.query('UPDATE journal SET detail = $1 WHERE id = (SELECT min(id) FROM journal)', ['x']));
  await assert.rejects(pool.query('DELETE FROM journal WHERE id = (SELECT min(id) FROM journal)'));
  await assert.rejects(pool.query('TRUNCATE journal'));
});

test('isolation : un établissement ne voit ni n’agit sur les lits d’un autre', async () => {
  const sl = await id('SL');
  assert.strictEqual((await appel('tremblay', 'GET', `/lits?etablissement_id=${sl}`)).statut, 403);
  const l = await litLibre(sl);
  assert.strictEqual((await appel('tremblay', 'POST', `/lits/${l.id}/action`, { action: 'hors_service' })).statut, 404);
  assert.strictEqual((await appel('tremblay', 'GET', `/journal?etablissement_id=${sl}`)).statut, 403);
});

test('capacité du réseau : respecte le partage complet, agrégé et aucun', async () => {
  const r = await appel('tremblay', 'GET', `/reseau?depuis=${await id('MB')}`);
  assert.strictEqual(r.statut, 200);
  const codes = r.corps.etablissements.map((e) => e.code);
  assert.ok(!codes.includes('MS'), 'aucun partage ou module inactif : invisible');
  const agrege = r.corps.etablissements.find((e) => e.code === 'MI');
  assert.ok(agrege.unites.every((u) => u.repartition === null && u.prevus === null), 'agrégé : pas de détail');
  const complet = r.corps.etablissements.find((e) => e.code === 'SL');
  assert.ok(complet.unites.every((u) => u.repartition !== null));
});

test('recherche, réservation et transfert complet avec le bon côté à chaque étape', async () => {
  const mb = await id('MB'); const si = await type('SI');
  const rec = await appel('tremblay', 'GET', `/recherche?depuis=${mb}&type_id=${si}`);
  assert.strictEqual(rec.statut, 200);
  const s = rec.corps.suggestions.find((x) => x.libres && x.partage === 'complet');
  assert.ok(s, 'au moins une suggestion avec lit');
  const tr = await appel('tremblay', 'POST', '/transferts', {
    origine_id: mb, destination_id: s.etablissement_id, type_id: si, lit_id: s.lit.id, version: s.lit.version, patient_ref: 'P-54321', urgent: true,
  });
  assert.strictEqual(tr.statut, 200, JSON.stringify(tr.corps));
  const tid = tr.corps.id;
  const qui = s.etablissement_id === await id('SL') ? 'bouchard' : 'roy';
  assert.strictEqual((await appel('tremblay', 'POST', `/transferts/${tid}/accepter`)).statut, 403, 'le demandeur ne valide pas');
  assert.strictEqual((await appel(qui, 'POST', `/transferts/${tid}/accepter`)).statut, 200);
  assert.strictEqual((await appel(qui, 'POST', `/transferts/${tid}/accepter`)).statut, 409, 'pas deux fois');
  assert.strictEqual((await appel('tremblay', 'POST', `/transferts/${tid}/transport`)).statut, 200);
  assert.strictEqual((await appel('tremblay', 'POST', `/transferts/${tid}/depart`)).statut, 200);
  const fin = await appel(qui, 'POST', `/transferts/${tid}/reception`);
  assert.strictEqual(fin.corps.statut, 'recu');
  const lit = (await pool.query('SELECT etat FROM lits WHERE id = $1', [s.lit.id])).rows[0];
  assert.strictEqual(lit.etat, 'occupe');
  const notifs = await pool.query('SELECT count(*)::int AS n FROM notifications WHERE transfert_id = $1', [tid]);
  assert.ok(notifs.rows[0].n >= 3);
});

test('version périmée : le lit proposé a été pris entre-temps', async () => {
  const mb = await id('MB'); const sl = await id('SL'); const med = await type('MED');
  const l = await litLibre(sl, med);
  assert.strictEqual((await appel('bouchard', 'POST', `/lits/${l.id}/action`, { action: 'reserver', version: l.version, patient_ref: 'P-99999' })).statut, 200);
  const r = await appel('tremblay', 'POST', '/transferts', { origine_id: mb, destination_id: sl, type_id: med, lit_id: l.id, version: l.version, patient_ref: 'P-11111' });
  assert.strictEqual(r.statut, 409);
});

test('refus d’un transfert : le lit redevient libre ; annulation directe bloquée', async () => {
  const mb = await id('MB'); const mi = await id('MI'); const si = await type('SI');
  const tr = await appel('tremblay', 'POST', '/transferts', { origine_id: mb, destination_id: mi, type_id: si, patient_ref: 'P-22222' });
  assert.strictEqual(tr.statut, 200, JSON.stringify(tr.corps));
  const litId = tr.corps.lit_id;
  assert.strictEqual((await appel('cote', 'POST', `/lits/${litId}/action`, { action: 'annuler' })).statut, 409);
  const r = await appel('cote', 'POST', `/transferts/${tr.corps.id}/refuser`, { motif: 'Plus de personnel cette nuit' });
  assert.strictEqual(r.corps.statut, 'refuse');
  assert.strictEqual((await pool.query('SELECT etat FROM lits WHERE id = $1', [litId])).rows[0].etat, 'libre');
});

test('établissement sans partage : impossible d’y envoyer un transfert', async () => {
  await pool.query(`UPDATE etablissements SET module_actif = true WHERE code = 'MS'`);
  const r = await appel('tremblay', 'POST', '/transferts', { origine_id: await id('MB'), destination_id: await id('MS'), type_id: await type('MED'), patient_ref: 'P-33333' });
  assert.strictEqual(r.statut, 403);
  await pool.query(`UPDATE etablissements SET module_actif = false WHERE code = 'MS'`);
});

test('détection des blocages et prévision', async () => {
  const mb = await id('MB');
  const l = await litLibre(mb);
  await appel('tremblay', 'POST', `/lits/${l.id}/action`, { action: 'reserver', version: l.version, patient_ref: 'P-44444' });
  await pool.query(`UPDATE lits SET etat_depuis = now() - interval '5 hours' WHERE id = $1`, [l.id]);
  await detecterBlocages(pool);
  const b = await appel('tremblay', 'GET', `/blocages?etablissement_id=${mb}`);
  assert.ok(b.corps.some((x) => x.id === l.id && x.blocage_niveau === 'eleve'));
  await appel('tremblay', 'POST', `/lits/${l.id}/action`, { action: 'admettre' });
  const conge = await appel('tremblay', 'PUT', `/lits/${l.id}/sortie-prevue`, { sortie_prevue: new Date(Date.now() + 2 * 3600000).toISOString() });
  assert.strictEqual(conge.statut, 200);
  const res = await appel('tremblay', 'GET', `/reseau?depuis=${mb}`);
  assert.ok(res.corps.etablissements.find((e) => e.moi).unites.some((u) => u.prevus > 0));
});

test('Assistant Arrimo répond à partir des données', async () => {
  const r = await appel('tremblay', 'POST', '/assistant', { etablissement_id: await id('MB'), question: 'Où trouver un lit de chirurgie le plus proche ?' });
  assert.strictEqual(r.statut, 200);
  assert.match(r.corps.reponse, /chirurgie/i);
});

test('activation depuis SH : clé exigée ; module désactivé bloque les actions', async () => {
  assert.strictEqual((await appel(null, 'PUT', '/sh/etablissements/RC', { module_actif: false }, { 'X-SH-Key': 'mauvaise' })).statut, 401);
  const r = await appel(null, 'PUT', '/sh/etablissements/RC', { module_actif: false }, { 'X-SH-Key': 'cle-de-test-sh-123456' });
  assert.strictEqual(r.corps.module_actif, false);
  const l = await litLibre(await id('RC'));
  assert.strictEqual((await appel('roy', 'POST', `/lits/${l.id}/action`, { action: 'hors_service' })).statut, 403);
  await appel(null, 'PUT', '/sh/etablissements/RC', { module_actif: true }, { 'X-SH-Key': 'cle-de-test-sh-123456' });
  assert.strictEqual((await appel('roy', 'PUT', `/admin/etablissements/${await id('RC')}`, { partage: 'aucun' })).statut, 403, 'réservé au gestionnaire');
});

/* ======================= Version 2 ======================= */
const copiloteMod = require('../src/copilote');
const connecteurs = require('../src/connecteurs');

test('hors service : le motif est obligatoire et compté dans les indicateurs', async () => {
  const sl = await id('SL');
  const l = await litLibre(sl);
  assert.strictEqual((await appel('bouchard', 'POST', `/lits/${l.id}/action`, { action: 'hors_service', version: l.version })).statut, 400);
  const r = await appel('bouchard', 'POST', `/lits/${l.id}/action`, { action: 'hors_service', version: l.version, motif: 'personnel' });
  assert.strictEqual(r.corps.motif_indispo, 'personnel');
  const ind = await appel('bouchard', 'GET', `/indicateurs?etablissement_id=${sl}`);
  assert.ok(ind.corps.capacite.indispo_par_motif.personnel >= 1);
  const remis = await appel('bouchard', 'POST', `/lits/${l.id}/action`, { action: 'remettre' });
  assert.strictEqual(remis.corps.motif_indispo, null);
});

test('NSA : désignation, taux, et effacement automatique au départ du patient', async () => {
  const sl = await id('SL');
  const l = (await pool.query(`SELECT id FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' AND nsa_depuis IS NULL LIMIT 1`, [sl])).rows[0];
  assert.strictEqual((await appel('bouchard', 'POST', `/lits/${l.id}/nsa`, { orientation: 'inconnue' })).statut, 400);
  assert.strictEqual((await appel('bouchard', 'POST', `/lits/${l.id}/nsa`, { orientation: 'chsld' })).statut, 200);
  const n = await appel('bouchard', 'GET', `/nsa?etablissement_id=${sl}`);
  assert.ok(n.corps.lits.some((x) => x.id === l.id));
  const lib = await appel('bouchard', 'POST', `/lits/${l.id}/action`, { action: 'liberer' });
  assert.strictEqual(lib.corps.nsa_depuis, null);
  assert.strictEqual(lib.corps.etat, 'nettoyage');
  const libre = await litLibre(sl);
  assert.strictEqual((await appel('bouchard', 'POST', `/lits/${libre.id}/nsa`, { orientation: 'chsld' })).statut, 409, 'NSA seulement sur un lit occupé');
});

test('file d’admission : besoins respectés, assignation, admission ; concurrence sur l’assignation', async () => {
  const sl = await id('SL'); const med = await type('MED');
  const d = await appel('bouchard', 'POST', '/admissions', { etablissement_id: sl, type_id: med, patient_ref: 'P-70001', priorite: 'p1', besoins: { isolement: true } });
  assert.strictEqual(d.statut, 200, JSON.stringify(d.corps));
  assert.strictEqual((await appel('bouchard', 'POST', '/admissions', { etablissement_id: sl, type_id: med, patient_ref: 'nom du patient' })).statut, 400);
  const file = await appel('bouchard', 'GET', `/admissions?etablissement_id=${sl}`);
  const dem = file.corps.find((x) => x.id === d.corps.id);
  const nonIso = (await pool.query(`SELECT id, version FROM lits WHERE etablissement_id = $1 AND type_id = $2 AND etat = 'libre' AND NOT isolement LIMIT 1`, [sl, med])).rows[0];
  if (nonIso) {
    assert.strictEqual((await appel('bouchard', 'POST', `/admissions/${dem.id}/assigner`, { lit_id: nonIso.id, version: nonIso.version })).statut, 400, 'lit sans isolement refusé');
  }
  if (!dem.lit_suggere) {
    await pool.query(`UPDATE lits SET isolement = true WHERE id = (SELECT id FROM lits WHERE etablissement_id = $1 AND type_id = $2 AND etat = 'libre' LIMIT 1)`, [sl, med]);
  }
  const f2 = (await appel('bouchard', 'GET', `/admissions?etablissement_id=${sl}`)).corps.find((x) => x.id === d.corps.id);
  assert.ok(f2.lit_suggere, 'un lit isolé libre est suggéré');
  const [a1, a2] = await Promise.all([
    appel('bouchard', 'POST', `/admissions/${dem.id}/assigner`, { lit_id: f2.lit_suggere.id, version: f2.lit_suggere.version }),
    appel('bouchard', 'POST', `/admissions/${dem.id}/assigner`, { lit_id: f2.lit_suggere.id, version: f2.lit_suggere.version }),
  ]);
  assert.deepStrictEqual([a1.statut, a2.statut].sort(), [200, 409]);
  const adm = await appel('bouchard', 'POST', `/admissions/${dem.id}/admettre`);
  assert.strictEqual(adm.corps.statut, 'admise');
  assert.strictEqual((await pool.query('SELECT etat, patient_ref FROM lits WHERE id = $1', [f2.lit_suggere.id])).rows[0].patient_ref, 'P-70001');
});

test('demande sans lit ici : transfert vers un autre hôpital avec les besoins du patient', async () => {
  const mb = await id('MB'); const si = await type('SI');
  const d = await appel('tremblay', 'POST', '/admissions', { etablissement_id: mb, type_id: si, patient_ref: 'P-70002', priorite: 'p1', besoins: { ventilation: true } });
  const rec = await appel('tremblay', 'GET', `/recherche?depuis=${mb}&type_id=${si}&ventilation=1`);
  const s = rec.corps.suggestions.find((x) => x.libres);
  assert.ok(s);
  const tr = await appel('tremblay', 'POST', `/admissions/${d.corps.id}/transferer`, { destination_id: s.etablissement_id, lit_id: s.lit?.id, version: s.lit?.version });
  assert.strictEqual(tr.statut, 200, JSON.stringify(tr.corps));
  assert.strictEqual(tr.corps.besoins.ventilation, true);
  assert.strictEqual(tr.corps.urgent, true);
  const dem = (await pool.query('SELECT statut, transfert_id FROM demandes_admission WHERE id = $1', [d.corps.id])).rows[0];
  assert.strictEqual(dem.statut, 'transferee');
  assert.strictEqual((await pool.query('SELECT ventilation FROM lits WHERE id = $1', [tr.corps.lit_id])).rows[0].ventilation, true);
});

test('nettoyage priorisé et rôle entretien limité à son écran', async () => {
  const mb = await id('MB');
  const r = await appel(null, 'POST', '/connexion', { email: 'entretien.mb@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO });
  tokens.entretien = r.corps.token;
  const file = await appel('entretien', 'GET', `/nettoyage?etablissement_id=${mb}`);
  assert.strictEqual(file.statut, 200);
  assert.ok(file.corps.length >= 1);
  for (let i = 1; i < file.corps.length; i += 1) assert.ok(file.corps[i - 1].priorite_score >= file.corps[i].priorite_score);
  const l = file.corps[0];
  assert.strictEqual((await appel('entretien', 'POST', `/nettoyage/${l.id}/debut`)).statut, 200);
  assert.strictEqual((await appel('entretien', 'POST', `/nettoyage/${l.id}/debut`)).statut, 409);
  assert.strictEqual((await appel('entretien', 'GET', `/lits?etablissement_id=${mb}`)).statut, 403);
  assert.strictEqual((await appel('entretien', 'GET', `/transferts?etablissement_id=${mb}`)).statut, 403);
  const libre = await litLibre(mb);
  if (libre) assert.strictEqual((await appel('entretien', 'POST', `/lits/${libre.id}/action`, { action: 'reserver', version: libre.version, patient_ref: 'P-12345' })).statut, 403);
  const fin = await appel('entretien', 'POST', `/lits/${l.id}/action`, { action: 'nettoyage_ok', version: l.version });
  assert.strictEqual(fin.corps.etat, 'libre');
});

test('Copilote : briefing, recommandations exécutables, vue réseau', async () => {
  const mb = await id('MB'); const med = await type('MED');
  await appel('tremblay', 'POST', '/admissions', { etablissement_id: mb, type_id: med, patient_ref: 'P-70003', priorite: 'p2' });
  const b = await appel('tremblay', 'GET', `/copilote/briefing?etablissement_id=${mb}`);
  assert.strictEqual(b.statut, 200);
  assert.ok(['vert', 'jaune', 'orange', 'rouge'].includes(b.corps.alerte.niveau));
  assert.ok(b.corps.recommandations.length > 0);
  for (let i = 1; i < b.corps.recommandations.length; i += 1) {
    assert.ok(b.corps.recommandations[i - 1].priorite <= b.corps.recommandations[i].priorite);
  }
  const reco = b.corps.recommandations.find((x) => x.action && x.action.type === 'transfert');
  if (reco) {
    const r = await appel('tremblay', 'POST', `/transferts/${reco.action.transfert_id}/${reco.action.etape}`);
    assert.strictEqual(r.statut, 200, 'l’action proposée passe par les règles normales');
  }
  const res = await appel('tremblay', 'GET', `/copilote/reseau?etablissement_id=${mb}`);
  assert.ok(res.corps.etablissements.length >= 4);
  assert.ok(!res.corps.etablissements.some((e) => e.nom.includes('Monts-Sutton')), 'les établissements sans partage restent invisibles');
  const q = await appel('tremblay', 'POST', '/copilote/question', { etablissement_id: mb, question: 'Qui attend un lit à l’urgence ?' });
  assert.match(q.corps.reponse, /attend/);
  assert.strictEqual(q.corps.mode, 'local');
  assert.strictEqual((await appel('tremblay', 'GET', `/copilote/briefing?etablissement_id=${await id('SL')}`)).statut, 403);
});

test('Copilote mode IA : aucune référence patient n’est envoyée', async () => {
  const mb = await id('MB');
  const u = { id: 0, role: 'coordonnateur', gestionnaire: false, etabs: [mb] };
  const [b, r] = await Promise.all([copiloteMod.briefing(pool, u, mb), copiloteMod.briefingReseau(pool, u, mb)]);
  let envoye = '';
  const fauxFetch = async (url, opts) => { envoye = opts.body; return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Réponse simulée' }] }) }; };
  process.env.COPILOTE_IA_CLE = 'test';
  const texte = await copiloteMod.questionIa(copiloteMod.sansPatients({ briefing: b, reseau: r }), 'Que faire ?', fauxFetch);
  delete process.env.COPILOTE_IA_CLE;
  assert.strictEqual(texte, 'Réponse simulée');
  assert.ok(envoye.length > 100);
  assert.ok(!/P-\d{5}/.test(envoye), 'aucune référence patient dans la requête');
});

test('connecteur ADT : admission, congé, idempotence, isolation ; connecteur réseau en lecture', async () => {
  const mb = await id('MB');
  const con = await connecteurs.creerConnecteur(pool, 'Test ADT', mb);
  const lec = await connecteurs.creerConnecteur(pool, 'Test réseau', null);
  const libre = await litLibre(mb);
  const ev = { identifiant: 'MSG-0001', evenement: 'admission', lit: libre.code, patient_ref: 'P-80001' };
  assert.strictEqual((await appel(null, 'POST', '/connecteurs/evenements', ev, { 'X-Connecteur-Key': 'faux' })).statut, 401);
  const r1 = await appel(null, 'POST', '/connecteurs/evenements', ev, { 'X-Connecteur-Key': con.cle });
  assert.strictEqual(r1.corps.statut, 'applique', JSON.stringify(r1.corps));
  assert.strictEqual((await pool.query('SELECT etat, patient_ref FROM lits WHERE id = $1', [libre.id])).rows[0].etat, 'occupe');
  const r2 = await appel(null, 'POST', '/connecteurs/evenements', ev, { 'X-Connecteur-Key': con.cle });
  assert.strictEqual(r2.corps.statut, 'deja_recu');
  const lot = await appel(null, 'POST', '/connecteurs/evenements', [
    { identifiant: 'MSG-0002', evenement: 'conge_prevu', lit: libre.code, date: new Date(Date.now() + 3600000).toISOString() },
    { identifiant: 'MSG-0003', evenement: 'conge', lit: libre.code },
    { identifiant: 'MSG-0004', evenement: 'admission', lit: 'INEXISTANT', patient_ref: 'P-80002' },
  ], { 'X-Connecteur-Key': con.cle });
  assert.deepStrictEqual(lot.corps.map((x) => x.statut), ['applique', 'applique', 'rejete']);
  assert.strictEqual((await pool.query('SELECT etat FROM lits WHERE id = $1', [libre.id])).rows[0].etat, 'nettoyage');
  // Même code de lit dans un autre hôpital : le connecteur n'agit que sur son propre établissement
  const autre = (await pool.query(`SELECT id, code, version FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' ORDER BY id LIMIT 1`, [await id('SL')])).rows[0];
  await appel(null, 'POST', '/connecteurs/evenements', { identifiant: 'MSG-0005', evenement: 'conge', lit: autre.code }, { 'X-Connecteur-Key': con.cle });
  const apres = (await pool.query('SELECT etat, version FROM lits WHERE id = $1', [autre.id])).rows[0];
  assert.strictEqual(apres.etat, 'occupe', 'le lit de l’autre hôpital n’est pas touché');
  assert.strictEqual(apres.version, autre.version);
  assert.strictEqual((await appel(null, 'POST', '/connecteurs/evenements', ev, { 'X-Connecteur-Key': lec.cle })).corps.statut, 'rejete');
  const cap = await appel(null, 'GET', '/connecteurs/capacite', null, { 'X-Connecteur-Key': lec.cle });
  assert.ok(cap.corps.lignes.length > 0);
  assert.ok(!JSON.stringify(cap.corps).includes('P-'), 'aucune référence patient');
  assert.ok(!cap.corps.lignes.some((l) => l.code === 'MS'));
  const jr = await pool.query(`SELECT count(*)::int AS n FROM journal WHERE lit_id = $1 AND detail LIKE 'Test ADT%'`, [libre.id]);
  assert.ok(jr.rows[0].n >= 3, 'les événements du connecteur sont journalisés');
});

test('indicateurs et export CSV', async () => {
  const mb = await id('MB');
  const i = await appel('tremblay', 'GET', `/indicateurs?etablissement_id=${mb}&jours=30`);
  assert.strictEqual(i.statut, 200);
  assert.ok(i.corps.transferts.total >= 1);
  assert.ok(i.corps.nettoyage.nettoyages >= 1, 'les nettoyages sont mesurés à partir du journal');
  // Comparaison avec la période précédente (même durée) et cibles de la configuration
  assert.ok('delai_assignation_min' in i.corps.precedent && 'nettoyage_min' in i.corps.precedent && 'civiere_h' in i.corps.precedent);
  assert.strictEqual(i.corps.cibles.nettoyage_cible_min, 45);
  assert.strictEqual(i.corps.cibles.attente_admission_max_min, 240);
  const r = await fetch(`${base}/api/indicateurs.csv?etablissement_id=${mb}`, { headers: { Authorization: `Bearer ${tokens.tremblay}` } });
  assert.strictEqual(r.status, 200);
  assert.match(await r.text(), /capacite\.occupation/);
});

test('proximité d’abord : le plus proche avec un lit adapté, sauf s’il déborde', async () => {
  const mb = await id('MB'); const si = await type('SI'); const rc = await id('RC');
  // Hôpital régional des Cantons (66 km) a un lit libre ; CHU Saint-Laurent (132 km) en a davantage
  await pool.query(`UPDATE lits SET etat = 'libre', patient_ref = NULL, sortie_prevue = NULL, nsa_depuis = NULL, nsa_orientation = NULL, conge_statut = NULL
                     WHERE id = (SELECT id FROM lits WHERE etablissement_id = $1 AND type_id = $2 AND etat = 'occupe' ORDER BY id LIMIT 1)`, [rc, si]);
  let r = (await appel('tremblay', 'GET', `/recherche?depuis=${mb}&type_id=${si}`)).corps.suggestions;
  const reco = r.find((x) => x.recommande);
  const rcSug = r.find((x) => x.etablissement_id === rc);
  assert.ok(rcSug && rcSug.libres >= 1);
  const plusProcheCalme = r.filter((x) => x.libres && ['vert', 'jaune'].includes(x.niveau)).sort((a, b) => a.distance_km - b.distance_km)[0];
  assert.strictEqual(reco.etablissement_id, plusProcheCalme.etablissement_id, 'le plus proche sans tension est recommandé');
  assert.ok(reco.minutes_route > 0 && / de route \(\d+ km\)/.test(reco.raison));
  // Si cet hôpital se met à déborder (patients en attente), il recule au profit d'un hôpital plus loin mais disponible
  const roy = { id: (await pool.query(`SELECT id FROM utilisateurs WHERE email = 'roy@demo.arrimo'`)).rows[0].id };
  for (let i = 0; i < 25; i += 1) {
    await pool.query(`INSERT INTO demandes_admission (etablissement_id, type_id, patient_ref, cree_par) VALUES ($1, $2, $3, $4)`,
      [reco.etablissement_id, si, `P-${50000 + i}`, roy.id]);
  }
  r = (await appel('tremblay', 'GET', `/recherche?depuis=${mb}&type_id=${si}`)).corps.suggestions;
  const deborde = r.find((x) => x.etablissement_id === reco.etablissement_id);
  assert.strictEqual(deborde.niveau, 'rouge');
  const nouveau = r.find((x) => x.recommande);
  assert.notStrictEqual(nouveau.etablissement_id, reco.etablissement_id, 'un hôpital débordé n’est plus recommandé');
  assert.match(nouveau.pourquoi, /plus proche/);
  await pool.query(`DELETE FROM demandes_admission WHERE patient_ref LIKE 'P-5%' AND etablissement_id = $1`, [reco.etablissement_id]);
});

test('démonstration : réseau de 20 hôpitaux : se crée et donne une situation présentable', async () => {
  const { demoReseau } = require('../db/demo-reseau');
  await viderBase(pool);
  const { ids } = await demoReseau(pool, { silencieux: true, comptesRoles: true });
  const co = async (email) => (await appel(null, 'POST', '/connexion', { email, mot_de_passe: MOT_DE_PASSE_DEMO })).corps.token;
  tokens.x = await co('hopital.x@demo.arrimo');
  tokens.y = await co('hopital.y@demo.arrimo');
  tokens.ex = await co('entretien.x@demo.arrimo');
  const bx = await appel('x', 'GET', `/copilote/briefing?etablissement_id=${ids.HX}`);
  assert.strictEqual(bx.corps.alerte.niveau, 'rouge');
  assert.ok(bx.corps.recommandations.length >= 8);
  const titres = bx.corps.recommandations.map((r) => r.titre);
  assert.strictEqual(new Set(titres).size, titres.length, 'aucune recommandation en double');
  // Recommandations du même genre regroupées : congés à confirmer, chacun avec son action dans la liste
  const conges = bx.corps.recommandations.find((r) => /^Confirmer \d+ congés prévus$/.test(r.titre));
  assert.ok(conges && conges.details.length >= 2 && conges.details.every((d) => d.action?.type === 'conge' && /^Lit [\w-]+ · congé prévu à /.test(d.titre)));
  assert.ok(!titres.some((x) => /^Confirmer le congé du lit/.test(x)));
  const by = await appel('y', 'GET', `/copilote/briefing?etablissement_id=${ids.HY}`);
  assert.ok(['vert', 'jaune'].includes(by.corps.alerte.niveau));
  assert.ok(by.corps.recommandations.some((r) => r.titre.startsWith('Répondre à la demande')));
  const ind = await appel('x', 'GET', `/indicateurs?etablissement_id=${ids.HX}`);
  assert.ok(ind.corps.transferts.total >= 20 && ind.corps.nettoyage.nettoyages >= 10 && ind.corps.admissions.delai_assignation_min > 0);
  assert.ok((await appel('ex', 'GET', `/nettoyage?etablissement_id=${ids.HX}`)).corps.length >= 3);
  // Le scénario du guide : patient P1 isolé de X transféré vers Y, accepté par Y
  const file = (await appel('x', 'GET', `/admissions?etablissement_id=${ids.HX}`)).corps;
  const p1 = file.find((d) => d.priorite === 'p1' && d.besoin_isolement);
  const rec = await appel('x', 'GET', `/recherche?depuis=${ids.HX}&type_id=${p1.type_id}&isolement=1`);
  const s = rec.corps.suggestions.find((x) => x.libres);
  assert.strictEqual(s.etablissement_id, ids.HY, 'Hôpital Y est proposé : les hôpitaux voisins n’ont plus de chambre d’isolement libre');
  const tr = await appel('x', 'POST', `/admissions/${p1.id}/transferer`, { destination_id: s.etablissement_id, lit_id: s.lit?.id, version: s.lit?.version });
  assert.strictEqual(tr.statut, 200, JSON.stringify(tr.corps));
  assert.strictEqual((await appel('y', 'POST', `/transferts/${tr.corps.id}/accepter`)).statut, 200);
});

test('réseau de démonstration : 20 hôpitaux, un compte par hôpital, proximité, simulation douce des hôpitaux sans compte', async () => {
  const { distanceKm } = require('../src/services');
  const { simuler } = require('../src/simulation');
  const etabs = (await pool.query('SELECT id, code, nom, latitude, longitude, partage FROM etablissements WHERE actif')).rows;
  assert.strictEqual(etabs.length, 20);
  const x = etabs.find((e) => e.code === 'HX'); const y = etabs.find((e) => e.code === 'HY');
  const d = (a, b) => distanceKm(a, b);
  assert.ok(etabs.filter((e) => e !== x && d(x, e) < 10).length >= 3, 'plusieurs hôpitaux à moins de 10 km de X');
  assert.ok(etabs.filter((e) => e !== y && d(y, e) < 10).length >= 2, 'plusieurs hôpitaux à moins de 10 km de Y');
  assert.ok(etabs.every((e) => d(x, e) <= 150), 'tous à moins de 150 km');
  assert.ok(etabs.filter((e) => d(x, e) > 10 && d(y, e) > 10).length >= 10);
  // Un seul compte par hôpital (X, Y) et le compte réseau ; les autres hôpitaux n'ont pas de compte
  const comptes = (await pool.query(`SELECT u.email, array_agg(ue.etablissement_id) AS etabs FROM utilisateurs u
    LEFT JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id WHERE u.email NOT LIKE 'entretien.%' GROUP BY u.email ORDER BY u.email`)).rows;
  assert.deepStrictEqual(comptes.map((c) => c.email), ['hopital.x@demo.arrimo', 'hopital.y@demo.arrimo', 'reseau@demo.arrimo']);
  // Chacun a des lits et des civières, avec des charges différentes
  const charge = (await pool.query(`SELECT e.code, count(l.*) FILTER (WHERE l.etat <> 'indispo')::int AS dotes, count(l.*) FILTER (WHERE l.etat = 'libre')::int AS libres,
      (SELECT count(*)::int FROM civieres c WHERE c.etablissement_id = e.id) AS civieres
    FROM etablissements e JOIN lits l ON l.etablissement_id = e.id WHERE e.actif GROUP BY e.id`)).rows;
  assert.strictEqual(charge.length, 20);
  assert.ok(charge.every((c) => c.dotes >= 10 && c.civieres >= 6));
  const niveaux = new Set((await appel('x', 'GET', `/national/carte?depuis=${x.id}`)).corps.map((p) => p.niveau));
  assert.ok(niveaux.has('rouge') && niveaux.has('vert'), [...niveaux].join(','));

  // Simulation : jamais hors démonstration ; X et Y ne bougent pas ; les autres vivent doucement
  delete process.env.ARRIMO_DEMO;
  assert.strictEqual(await simuler(pool), 0);
  process.env.ARRIMO_DEMO = '1';
  try {
    const instantane = async () => (await pool.query(`SELECT 'l' || id AS k, version FROM lits WHERE etablissement_id IN ($1, $2)
      UNION ALL SELECT 'c' || id, version FROM civieres WHERE etablissement_id IN ($1, $2) ORDER BY k`, [x.id, y.id])).rows;
    const avant = await instantane();
    // Un transfert vers un hôpital sans compte : son équipe (simulée) accepte, puis prépare la chambre
    const ha = etabs.find((e) => e.code === 'HA');
    const med = await type('MED');
    const tr = (await appel('x', 'POST', '/transferts', { origine_id: x.id, destination_id: ha.id, type_id: med, patient_ref: 'P-90010' })).corps;
    await pool.query(`UPDATE transferts SET date_demande = now() - interval '2 minutes' WHERE id = $1`, [tr.id]);
    let total = 0;
    for (let i = 0; i < 4; i += 1) total += await simuler(pool);
    assert.ok(total >= 20, `${total} changements`);
    assert.deepStrictEqual(await instantane(), avant, 'les hôpitaux qui ont un compte ne sont jamais touchés');
    const j = await pool.query(`SELECT count(*)::int AS n FROM journal WHERE detail = 'Simulation de démonstration' AND utilisateur_id IS NULL`);
    assert.ok(j.rows[0].n >= 10, 'chaque changement simulé est journalisé');
    const t2 = (await pool.query('SELECT statut, date_chambre_prete FROM transferts WHERE id = $1', [tr.id])).rows[0];
    assert.ok(t2.statut === 'validee' && t2.date_chambre_prete, JSON.stringify(t2));
    // La charge de chaque hôpital simulé reste proche de sa charge de départ
    const cibles = (await pool.query('SELECT simulation FROM demo_etat')).rows[0].simulation;
    const apres = (await pool.query(`SELECT e.code, count(l.*) FILTER (WHERE l.etat <> 'indispo')::int AS dotes, count(l.*) FILTER (WHERE l.etat = 'libre')::int AS libres
      FROM etablissements e JOIN lits l ON l.etablissement_id = e.id WHERE e.code = ANY($1::text[]) GROUP BY e.code`, [Object.keys(cibles)])).rows;
    for (const a of apres) assert.ok(Math.abs((a.dotes - a.libres) / a.dotes - cibles[a.code].lits) < 0.2, `${a.code} : charge stable`);
  } finally {
    delete process.env.ARRIMO_DEMO;
  }
});

test('disponibilité à côté : alerte aux hôpitaux proches qui en ont besoin, sans spam, rayon réglable, Copilote', async () => {
  const { transaction } = require('../src/db');
  const { changerEtat, changerEtatCiviere } = require('../src/regles');
  const hx = await id('HX'); const hy = await id('HY'); const ha = await id('HA'); const hb = await id('HB');
  const liberer = async (etab, typeCode) => {
    const l = (await pool.query(`SELECT l.id FROM lits l JOIN types_unite t ON t.id = l.type_id WHERE l.etablissement_id = $1 AND t.code = $2 AND l.etat = 'occupe' AND l.nsa_depuis IS NULL LIMIT 1`, [etab, typeCode])).rows[0];
    await transaction(pool, (c) => changerEtat(c, pool, null, l.id, 'nettoyage', {}));
    await transaction(pool, (c) => changerEtat(c, pool, null, l.id, 'libre', {}));
    return l.id;
  };
  const alertes = async (etab, code = 'dispo_lit') => (await pool.query(`SELECT message, vars FROM notifications WHERE etablissement_id = $1 AND code = $2 ORDER BY id`, [etab, code])).rows;
  await pool.query(`DELETE FROM notifications WHERE code IN ('dispo_lit', 'dispo_civiere')`);
  // Un lit de médecine se libère à 5 km de X, qui a des patients en attente de médecine : X est avisé, Y (25 km) ne l'est pas
  await liberer(ha, 'MED');
  let ax = await alertes(hx);
  assert.strictEqual(ax.length, 1);
  assert.match(ax[0].message, /^Lit de médecine libre à côté : Hôpital du Bois-Joli, 5 km, environ \d+\smin/);
  assert.ok(!(await alertes(hy)).some((a) => a.vars.etab_id === ha), 'hors du rayon de Y');
  // Pas de spam : un autre lit de médecine à côté dans les 10 minutes ne crée pas de nouvelle alerte
  await liberer(hb, 'MED');
  assert.strictEqual((await alertes(hx)).length, 1);
  // Un autre type d'unité dont X a besoin : nouvelle alerte, regroupée (autres établissements proches avec de la place)
  await liberer(hb, 'CHIR');
  ax = await alertes(hx);
  assert.strictEqual(ax.length, 2);
  assert.match(ax[1].message, /^(Lit|\d+ lits) de chirurgie libres? à côté : Centre hospitalier Val-des-Cèdres, 5 km, environ \d+\smin \(et \d+ autres? établissements? proches?\)\.$/);
  // Lu en anglais
  const en = await fetch(`${base}/api/notifications?etablissement_id=${hx}`, { headers: { Authorization: `Bearer ${tokens.x}`, 'X-Langue': 'en' } }).then((r) => r.json());
  assert.ok(en.some((n) => /^1 free medicine bed nearby: Hôpital du Bois-Joli, 5 km, about \d+\smin/.test(n.message)), en.map((n) => n.message).join(' | '));
  // Civière régulière libérée à côté : X a des patients en corridor
  const cv = (await pool.query(`SELECT id FROM civieres WHERE etablissement_id = $1 AND categorie = 'reguliere' AND etat = 'occupee'
    AND NOT EXISTS (SELECT 1 FROM demandes_admission d WHERE d.civiere_id = civieres.id AND d.statut IN ('attente', 'assignee')) LIMIT 1`, [ha])).rows[0];
  await transaction(pool, (c) => changerEtatCiviere(c, pool, null, cv.id, 'nettoyage', {}));
  await transaction(pool, (c) => changerEtatCiviere(c, pool, null, cv.id, 'libre', {}));
  assert.match((await alertes(hx, 'dispo_civiere'))[0].message, /^Civière libre à côté : urgence de Hôpital du Bois-Joli/);
  // Le Copilote reprend l'alerte : transférer le patient qui attend un lit de médecine vers l'hôpital voisin
  const b = (await appel('x', 'GET', `/copilote/briefing?etablissement_id=${hx}`)).corps;
  const reco = b.recommandations.find((r) => /lit libre à côté/.test(r.titre));
  assert.ok(reco && reco.action.type === 'transferer' && [ha, hb].includes(reco.action.destination_id), JSON.stringify(b.recommandations.map((r) => r.titre)));
  // Rayon réglable par établissement (administrateur) : à 3 km, l'hôpital à 5 km n'avise plus X
  const avant2fa = process.env.ARRIMO_2FA_ADMIN;
  process.env.ARRIMO_2FA_ADMIN = '0';
  try {
    tokens.gest = (await appel(null, 'POST', '/connexion', { email: 'reseau@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO })).corps.token;
    assert.strictEqual((await appel('x', 'PUT', `/admin/etablissements/${hx}/rayon-alerte`, { rayon_alerte_km: 3 })).statut, 403);
    assert.strictEqual((await appel('gest', 'PUT', `/admin/etablissements/${hx}/rayon-alerte`, { rayon_alerte_km: 500 })).statut, 400);
    assert.strictEqual((await appel('gest', 'PUT', `/admin/etablissements/${hx}/rayon-alerte`, { rayon_alerte_km: 3 })).corps.rayon_alerte_km, 3);
    await liberer(ha, 'SI');
    assert.ok(!(await alertes(hx)).some((a) => a.vars.type_nom === 'Soins intensifs'));
    await appel('gest', 'PUT', `/admin/etablissements/${hx}/rayon-alerte`, { rayon_alerte_km: 10 });
  } finally {
    if (avant2fa === undefined) delete process.env.ARRIMO_2FA_ADMIN; else process.env.ARRIMO_2FA_ADMIN = avant2fa;
  }
});

test('Copilote : vue complète, prévisions à 4 h, 12 h et 24 h avec marge, questions de prévision', async () => {
  const hx = await id('HX'); const hy = await id('HY'); const med = await type('MED');
  const p = (await appel('x', 'GET', `/copilote/previsions?etablissement_id=${hx}`)).corps;
  assert.deepStrictEqual(p.horizons, [4, 12, 24]);
  assert.strictEqual(p.semaines, 8, 'huit semaines d’historique');
  for (const u of p.unites) {
    for (const h of p.horizons) {
      const x = u.horizons[h];
      assert.ok(x.marge >= 0 && Number.isInteger(x.libres_prevus));
      assert.strictEqual(x.sature, x.libres_prevus <= 0);
      assert.ok(x.liberations >= 0 && x.arrivees >= u.en_attente);
    }
    assert.ok(u.horizons[24].arrivees >= u.horizons[4].arrivees, 'les arrivées attendues croissent avec l’horizon');
  }
  assert.ok(p.civieres && p.civieres.horizons[4].occupees >= 0 && p.civieres.horizons[4].marge > 0);
  // Méthode : des congés confirmés dans l'heure s'ajoutent aux lits qui vont se libérer (pondérés à 95 %)
  const avant = (await appel('y', 'GET', `/copilote/previsions?etablissement_id=${hy}`)).corps.unites.find((u) => u.type_id === med).horizons[4];
  const occ = (await pool.query(`SELECT id FROM lits WHERE etablissement_id = $1 AND type_id = $2 AND etat = 'occupe' AND nsa_depuis IS NULL`, [hy, med])).rows;
  await pool.query(`UPDATE lits SET sortie_prevue = now() + interval '1 hour', conge_statut = 'confirme' WHERE id = ANY($1::int[])`, [occ.map((l) => l.id)]);
  const apres = (await appel('y', 'GET', `/copilote/previsions?etablissement_id=${hy}`)).corps.unites.find((u) => u.type_id === med).horizons[4];
  assert.ok(apres.liberations >= Math.floor(occ.length * 0.95), `${apres.liberations} libérations pour ${occ.length} congés confirmés`);
  assert.ok(apres.libres_prevus > avant.libres_prevus);
  // Vue complète : lits, chambres, civières, file, transferts, NSA, nettoyage, voisins
  const t0 = Date.now();
  const b = (await appel('x', 'GET', `/copilote/briefing?etablissement_id=${hx}`)).corps;
  assert.ok(Date.now() - t0 < 1500, `briefing en ${Date.now() - t0} ms`);
  assert.deepStrictEqual(Object.keys(b.vue).sort(), ['chambres', 'civieres', 'file', 'lits', 'nettoyage', 'nsa', 'proches', 'transferts']);
  assert.ok(b.vue.proches.etablissements >= 3 && b.vue.proches.rayon_km === 10);
  assert.ok(b.previsions.unites.length >= 3);
  // Questions de prévision et de proximité, en français et en anglais
  const q = async (question, langue) => (await appel('x', 'POST', '/copilote/question', { etablissement_id: hx, question, langue })).corps.reponse;
  const soir = await q('Est-ce qu’on sera saturés ce soir ?');
  assert.match(soir, /^(Oui, probablement|Non, probablement pas)/);
  assert.match(soir, /Médecine : .*\(± \d+\)/);
  assert.match(soir, /Calculé à partir des congés prévus/);
  assert.match(await q('Où envoyer un patient de chirurgie le plus vite ?'), /^Meilleure option en chirurgie : .* km, environ .* de route\)/);
  assert.match(await q('Combien de civières occupées depuis plus de 24 h ?'), /depuis plus de 24 h/);
  assert.match(await q('Will we be full tonight?', 'en'), /^(Yes, probably|No, probably not)/);
});

test('civières de l’urgence : états, verrou, demande liée, admission, changement de civière, réseau, Copilote, indicateurs', async () => {
  const hx = await id('HX'); const hy = await id('HY'); const med = await type('MED');
  const civ = async (qui, etab) => (await appel(qui, 'GET', `/civieres?etablissement_id=${etab}`)).corps;
  // Urgence de X débordée : taux au-delà de 100 %, patients en corridor, séjours de plus de 24 h et 48 h
  let ux = await civ('x', hx);
  assert.ok(ux.stats.taux > 100 && ux.stats.en_corridor > 0 && ux.stats.plus_24h >= 3 && ux.stats.plus_48h >= 1, JSON.stringify(ux.stats));
  assert.strictEqual(ux.stats.occupees, ux.civieres.filter((c) => c.etat === 'occupee').length);
  const alerteX = (await appel('x', 'GET', `/indicateurs?etablissement_id=${hx}`)).corps;
  assert.strictEqual(alerteX.urgence.niveau, 'rouge');
  assert.ok(alerteX.urgence.periode.sejours >= 30 && alerteX.urgence.periode.duree_moy_h > 0, 'durée moyenne sur la période, depuis le journal');
  const uy = await civ('y', hy);
  assert.ok(uy.stats.taux < 90, 'Y a de la place');

  // Isolation : Y ne voit ni n'agit sur les civières de X
  assert.strictEqual((await appel('y', 'GET', `/civieres?etablissement_id=${hx}`)).statut, 403);
  const libreY = uy.civieres.find((c) => c.etat === 'libre' && c.categorie === 'reguliere');
  assert.strictEqual((await appel('x', 'POST', `/civieres/${libreY.id}/action`, { action: 'placer', patient_ref: 'P-81000' })).statut, 404);

  // Placer : référence seulement ; une civière n'est prise qu'une fois (5 essais simultanés, un seul gagne, refus journalisés)
  assert.strictEqual((await appel('y', 'POST', `/civieres/${libreY.id}/action`, { action: 'placer', patient_ref: 'Mme Untel' })).statut, 400);
  const essais = await Promise.all([0, 1, 2, 3, 4].map((i) => appel('y', 'POST', `/civieres/${libreY.id}/action`,
    { action: 'placer', version: libreY.version, patient_ref: `P-8100${i}` })));
  assert.strictEqual(essais.filter((e) => e.statut === 200).length, 1, essais.map((e) => e.statut).join(','));
  assert.ok(essais.filter((e) => e.statut === 409).every((e) => ['civiere_verrouillee', 'civiere_deja_modifiee'].includes(e.corps.code)));
  const refus = (await pool.query('SELECT count(*)::int AS n FROM journal WHERE civiere_id = $1 AND refuse', [libreY.id])).rows[0].n;
  assert.strictEqual(refus, 4, 'chaque refus est journalisé');
  const place = essais.find((e) => e.statut === 200).corps;
  const autre = (await civ('y', hy)).civieres.find((c) => c.etat === 'libre' && c.id !== libreY.id);
  const double = await appel('y', 'POST', `/civieres/${autre.id}/action`, { action: 'placer', patient_ref: place.patient_ref });
  assert.deepStrictEqual([double.statut, double.corps.code], [409, 'patient_deja_sur_civiere']);
  assert.strictEqual((await appel('y', 'POST', `/civieres/${libreY.id}/action`, { action: 'nettoyage_ok' })).statut, 409, 'transition interdite');

  // Demande de lit liée à la civière : la référence vient de la civière, une seule demande active
  const d = await appel('y', 'POST', '/admissions', { etablissement_id: hy, type_id: med, civiere_id: libreY.id, priorite: 'p2' });
  assert.strictEqual(d.statut, 200, JSON.stringify(d.corps));
  assert.deepStrictEqual([d.corps.patient_ref, d.corps.civiere_id, d.corps.provenance], [place.patient_ref, libreY.id, 'urgence']);
  assert.strictEqual((await appel('y', 'POST', '/admissions', { etablissement_id: hy, type_id: med, civiere_id: libreY.id })).corps.code, 'civiere_deja_demande');
  assert.strictEqual((await appel('y', 'POST', '/admissions', { etablissement_id: hy, type_id: med, civiere_id: libreY.id + 100000 })).statut, 400);
  const bloque = await appel('y', 'POST', `/civieres/${libreY.id}/action`, { action: 'liberer' });
  assert.deepStrictEqual([bloque.statut, bloque.corps.code], [409, 'civiere_demande_active']);
  const fileY = (await appel('y', 'GET', `/admissions?etablissement_id=${hy}`)).corps.find((x) => x.id === d.corps.id);
  assert.strictEqual(fileY.civiere_code, libreY.code);
  // Admission dans un lit : la civière passe en nettoyage dans la même transaction
  assert.strictEqual((await appel('y', 'POST', `/admissions/${d.corps.id}/assigner`, { lit_id: fileY.lit_suggere.id, version: fileY.lit_suggere.version })).statut, 200);
  assert.strictEqual((await appel('y', 'POST', `/admissions/${d.corps.id}/admettre`)).statut, 200);
  const apres = (await pool.query('SELECT etat, patient_ref FROM civieres WHERE id = $1', [libreY.id])).rows[0];
  assert.deepStrictEqual(apres, { etat: 'nettoyage', patient_ref: null });
  const j = await pool.query(`SELECT detail FROM journal WHERE civiere_id = $1 AND nouvel_etat = 'nettoyage' AND NOT refuse ORDER BY date DESC, id DESC LIMIT 1`, [libreY.id]);
  assert.match(j.rows[0].detail, /admis au lit/);
  // L'entretien nettoie les civières (et rien d'autre)
  const netY = (await appel('y', 'GET', `/nettoyage?etablissement_id=${hy}`)).corps;
  assert.ok(netY.some((x) => x.genre === 'civiere' && x.id === libreY.id));
  const ex = (await pool.query('SELECT id FROM civieres WHERE etablissement_id = $1 AND etat = $2 LIMIT 1', [hx, 'nettoyage'])).rows[0];
  const netX = (await appel('ex', 'GET', `/nettoyage?etablissement_id=${hx}`)).corps;
  assert.strictEqual(netX[0].genre, 'civiere', 'une civière régulière passe en premier quand des patients attendent en corridor');
  assert.strictEqual(netX[0].priorite, 'haute');
  const libreX = (await pool.query(`SELECT id FROM civieres WHERE etablissement_id = $1 AND etat = 'libre' LIMIT 1`, [hx])).rows[0];
  if (libreX) assert.strictEqual((await appel('ex', 'POST', `/civieres/${libreX.id}/action`, { action: 'placer', patient_ref: 'P-81111' })).statut, 403);
  assert.strictEqual((await appel('ex', 'POST', `/civieres/${ex.id}/action`, { action: 'nettoyage_ok' })).corps.etat, 'libre');

  // Changer de civière : du corridor vers la civière régulière libérée ; la demande et l'heure d'arrivée suivent
  ux = await civ('x', hx);
  const cible = ux.civieres.find((c) => c.id === ex.id);
  const corridor = ux.civieres.filter((c) => c.categorie === 'debordement' && c.etat === 'occupee').sort((a, b) => b.heures - a.heures)[0];
  const arrivee = corridor.arrivee_le;
  const b = (await appel('x', 'GET', `/copilote/briefing?etablissement_id=${hx}`)).corps;
  const reco = b.recommandations.find((r) => r.action?.type === 'deplacer');
  assert.ok(reco && reco.action.civiere_id === corridor.id && reco.action.vers_id === cible.id, 'le Copilote propose de sortir le patient du corridor');
  const dep = await appel('x', 'POST', `/civieres/${corridor.id}/deplacer`, { vers_id: cible.id, version: cible.version });
  assert.strictEqual(dep.statut, 200, JSON.stringify(dep.corps));
  assert.deepStrictEqual([dep.corps.patient_ref, new Date(dep.corps.arrivee_le).getTime()], [corridor.patient_ref, new Date(arrivee).getTime()]);
  assert.strictEqual((await pool.query('SELECT etat FROM civieres WHERE id = $1', [corridor.id])).rows[0].etat, 'nettoyage');

  // Transfert depuis l'urgence : au départ de l'ambulance, la civière part au nettoyage
  const surCiv = (await appel('x', 'GET', `/admissions?etablissement_id=${hx}`)).corps.find((x) => x.civiere_code && x.type_id === med && x.statut === 'attente'
    && !x.besoin_isolement && !x.besoin_ventilation && !x.besoin_pression_negative && !x.besoin_telemetrie);
  const rec = (await appel('x', 'GET', `/recherche?depuis=${hx}&type_id=${med}`)).corps.suggestions.find((x) => x.libres && x.etablissement_id === hy);
  const tr = await appel('x', 'POST', `/admissions/${surCiv.id}/transferer`, { destination_id: rec.etablissement_id, lit_id: rec.lit?.id, version: rec.lit?.version });
  assert.strictEqual(tr.statut, 200, JSON.stringify(tr.corps));
  for (const [qui, etape] of [['y', 'accepter'], ['x', 'transport']]) assert.strictEqual((await appel(qui, 'POST', `/transferts/${tr.corps.id}/${etape}`)).statut, 200);
  assert.strictEqual((await pool.query('SELECT etat FROM civieres WHERE id = $1', [surCiv.civiere_id])).rows[0].etat, 'occupee', 'le patient attend l’ambulance');
  assert.strictEqual((await appel('x', 'POST', `/transferts/${tr.corps.id}/depart`)).statut, 200);
  assert.strictEqual((await pool.query('SELECT etat FROM civieres WHERE id = $1', [surCiv.civiere_id])).rows[0].etat, 'nettoyage');

  // Réseau, niveaux d'alerte et Copilote
  const res = (await appel('y', 'GET', `/reseau?depuis=${hy}`)).corps;
  const vuX = res.etablissements.find((e) => e.id === hx);
  assert.ok(vuX.urgence.taux > 100 && ['orange', 'rouge'].includes(vuX.urgence.niveau), JSON.stringify(vuX.urgence));
  assert.ok(vuX.urgence.plus_24h >= 1, 'partage complet : détail des séjours');
  await pool.query(`UPDATE etablissements SET partage = 'agrege' WHERE id = $1`, [hx]);
  const agrege = (await appel('y', 'GET', `/reseau?depuis=${hy}`)).corps.etablissements.find((e) => e.id === hx).urgence;
  await pool.query(`UPDATE etablissements SET partage = 'complet' WHERE id = $1`, [hx]);
  assert.deepStrictEqual(Object.keys(agrege).sort(), ['fonctionnelles', 'niveau', 'occupees', 'taux'], 'partage agrégé : totaux seulement');
  const brx = (await appel('x', 'GET', `/copilote/briefing?etablissement_id=${hx}`)).corps;
  assert.match(brx.resume, /Urgence : \d+ patients sur civière pour \d+ civières \(\d+\s%\)/);
  assert.ok(!brx.recommandations.some((r) => /^Urgence à/.test(r.titre)), 'le taux de l’urgence est déjà dans le bandeau : pas répété');
  // Patients sur civière depuis plus de 24 h sans demande de lit : une seule recommandation, liste dépliable, une action (ouvrir l'urgence)
  const groupe = brx.recommandations.find((r) => /^\d+ patients sur civière depuis plus de 24 h sans demande de lit$/.test(r.titre));
  assert.ok(groupe && groupe.action.type === 'aller' && groupe.details.length >= 2, JSON.stringify(brx.recommandations.map((r) => r.titre)));
  assert.strictEqual(Number(groupe.titre.split(' ')[0]), groupe.details.length);
  assert.ok(groupe.details.every((d) => /^P-\d{5} · civière [\w-]+ · depuis /.test(d.titre)));
  assert.ok(!brx.recommandations.some((r) => /^Demander un lit pour P-/.test(r.titre)), 'plus de recommandation par patient');
  const titres = brx.recommandations.map((r) => r.titre);
  assert.strictEqual(new Set(titres).size, titres.length);
  const vueRes = (await appel('x', 'GET', `/copilote/reseau?etablissement_id=${hx}`)).corps;
  assert.ok(vueRes.etablissements.every((e) => e.urgence && e.urgence.taux >= 0));
  ux = await civ('x', hx);
  const q = (await appel('x', 'POST', '/copilote/question', { etablissement_id: hx, question: 'Combien de civières occupées depuis plus de 24 h ?' })).corps;
  assert.match(q.reponse, new RegExp(`\n${ux.stats.plus_24h} patients depuis plus de 24 h`));
  assert.strictEqual(q.reponse.split('\n').filter((l) => l.startsWith('•')).length, ux.stats.plus_24h, 'la liste montre les patients de plus de 24 h');
  const qen = (await appel('x', 'POST', '/copilote/question', { etablissement_id: hx, question: 'How many stretchers have been occupied for more than 24 h?', langue: 'en' })).corps;
  assert.match(qen.reponse, /^ER at /);

  // Administration : ajout d'une civière (code unique, catégorie contrôlée)
  const avant2fa = process.env.ARRIMO_2FA_ADMIN;
  process.env.ARRIMO_2FA_ADMIN = '0';
  try {
    tokens.res = (await appel(null, 'POST', '/connexion', { email: 'reseau@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO })).corps.token;
    const n = await appel('res', 'POST', '/admin/civieres', { etablissement_id: hy, code: 'COR-09', categorie: 'debordement' });
    assert.strictEqual(n.statut, 200, JSON.stringify(n.corps));
    assert.strictEqual((await appel('res', 'POST', '/admin/civieres', { etablissement_id: hy, code: 'COR-09' })).corps.code, 'code_civiere_existe');
    assert.strictEqual((await appel('res', 'POST', '/admin/civieres', { etablissement_id: hy, code: 'X-1', categorie: 'lit' })).corps.code, 'categorie_invalide');
    assert.strictEqual((await appel('y', 'POST', '/admin/civieres', { etablissement_id: hy, code: 'X-2' })).statut, 403);
  } finally {
    if (avant2fa === undefined) delete process.env.ARRIMO_2FA_ADMIN; else process.env.ARRIMO_2FA_ADMIN = avant2fa;
  }
});

test('transfert sans dossier côté receveur : chambre prête, heure d’arrivée prévue, besoins transmis', async () => {
  const hx = await id('HX'); const hy = await id('HY'); const med = await type('MED');
  const lit = (await pool.query(`SELECT id, version FROM lits WHERE etablissement_id = $1 AND type_id = $2 AND etat = 'libre' AND isolement LIMIT 1`, [hy, med])).rows[0];
  const tr = (await appel('x', 'POST', '/transferts', { origine_id: hx, destination_id: hy, type_id: med, lit_id: lit.id, version: lit.version,
    patient_ref: 'P-90001', besoins: { isolement: true } })).corps;
  assert.ok(tr.minutes_route > 0, 'temps de route estimé dès la demande');
  assert.strictEqual((await appel('y', 'POST', `/transferts/${tr.id}/chambre_prete`)).statut, 409, 'pas avant l’acceptation');
  assert.strictEqual((await appel('y', 'POST', `/transferts/${tr.id}/accepter`)).statut, 200);
  // Le receveur voit la référence et les besoins ; le Copilote lui propose de préparer la chambre
  let b = (await appel('y', 'GET', `/copilote/briefing?etablissement_id=${hy}`)).corps;
  const reco = b.recommandations.find((r) => r.action?.etape === 'chambre_prete' && r.action.transfert_id === tr.id);
  assert.ok(reco && /P-90001/.test(reco.raison) && /isolement/.test(reco.raison) && /pas encore confirmé/.test(reco.raison), JSON.stringify(reco));
  assert.strictEqual((await appel('x', 'POST', `/transferts/${tr.id}/chambre_prete`)).statut, 403, 'seul le receveur confirme la chambre');
  const cp = await appel('y', 'POST', `/transferts/${tr.id}/chambre_prete`);
  assert.strictEqual(cp.statut, 200);
  assert.strictEqual(cp.corps.statut, 'validee', 'chambre prête ne change pas le statut');
  assert.ok(cp.corps.date_chambre_prete);
  assert.strictEqual((await appel('y', 'POST', `/transferts/${tr.id}/chambre_prete`)).corps.code, 'chambre_deja_prete');
  const nx = (await appel('x', 'GET', `/notifications?etablissement_id=${hx}`)).corps;
  assert.ok(nx.some((n) => n.message === `Hôpital Y : la chambre du lit ${tr.lit_code} est prête pour le transfert ${tr.numero}.`));
  b = (await appel('y', 'GET', `/copilote/briefing?etablissement_id=${hy}`)).corps;
  assert.ok(!b.recommandations.some((r) => r.action?.transfert_id === tr.id && r.action.etape === 'chambre_prete'));
  // Départ : heure d'arrivée prévue = départ + temps de route, annoncée au receveur dans sa langue
  assert.strictEqual((await appel('x', 'POST', `/transferts/${tr.id}/transport`)).statut, 200);
  const dep = (await appel('x', 'POST', `/transferts/${tr.id}/depart`)).corps;
  const ecart = new Date(dep.arrivee_prevue) - new Date(dep.date_depart);
  assert.ok(Math.abs(ecart - tr.minutes_route * 60000) < 5000, `${ecart} ms`);
  const ny = (await appel('y', 'GET', `/notifications?etablissement_id=${hy}`)).corps.find((n) => n.code === 'transfert_depart' && n.transfert_id === tr.id);
  assert.match(ny.message, /est en route\. Arrivée prévue vers \d{1,2} h \d{2}\.$/);
  const nyEn = (await fetch(`${base}/api/notifications?etablissement_id=${hy}`, { headers: { Authorization: `Bearer ${tokens.y}`, 'X-Langue': 'en' } }).then((r) => r.json()))
    .find((n) => n.code === 'transfert_depart' && n.transfert_id === tr.id);
  assert.match(nyEn.message, /Expected arrival around \d{1,2}:\d{2}/);
  const liste = (await appel('y', 'GET', `/transferts?etablissement_id=${hy}`)).corps.find((x) => x.id === tr.id);
  assert.deepStrictEqual([liste.patient_ref, liste.besoins.isolement, !!liste.arrivee_prevue], ['P-90001', true, true]);
  assert.strictEqual((await appel('y', 'POST', `/transferts/${tr.id}/reception`)).statut, 200);
});

test('tableau national : 200 établissements, tri par distance, filtres, partage agrégé, pagination, moins de 300 ms', async () => {
  const hx = await id('HX'); const med = await type('MED');
  const cfg = (await pool.query('SELECT config_id FROM etablissements WHERE id = $1', [hx])).rows[0].config_id;
  // 200 établissements fictifs répartis sur le territoire : 1 sur 10 en partage agrégé, 1 sur 25 sans partage, 1 sur 40 sans module
  await pool.query(`INSERT INTO etablissements (code, nom, ville, adresse, latitude, longitude, config_id, partage, module_actif)
    SELECT 'NAT' || g, 'Établissement fictif ' || g, 'Ville ' || g, g || ' rue Fictive', 45 + (g * 37 % 400) / 100.0, -79 + (g * 53 % 1500) / 100.0, $1,
           CASE WHEN g % 25 = 0 THEN 'aucun' WHEN g % 10 = 0 THEN 'agrege' ELSE 'complet' END, g % 40 <> 0
      FROM generate_series(1, 200) g`, [cfg]);
  await pool.query(`INSERT INTO unites (etablissement_id, type_id, nom) SELECT e.id, t.id, t.nom FROM etablissements e, types_unite t
    WHERE e.code LIKE 'NAT%' AND t.config_id = $1`, [cfg]);
  await pool.query(`INSERT INTO chambres (unite_id, numero) SELECT u.id, '100' FROM unites u JOIN etablissements e ON e.id = u.etablissement_id WHERE e.code LIKE 'NAT%'`);
  await pool.query(`INSERT INTO lits (chambre_id, unite_id, type_id, etablissement_id, code, etat, patient_ref, isolement)
    SELECT c.id, u.id, u.type_id, u.etablissement_id, 'L' || u.id || '-' || k,
           CASE WHEN (u.id + k) % 4 = 0 THEN 'libre' ELSE 'occupe' END,
           CASE WHEN (u.id + k) % 4 = 0 THEN NULL ELSE 'P-' || lpad(((u.id * 10 + k) % 99999)::text, 5, '0') END, k % 3 = 0
      FROM chambres c JOIN unites u ON u.id = c.unite_id JOIN etablissements e ON e.id = u.etablissement_id, generate_series(1, 10) k
     WHERE e.code LIKE 'NAT%'`);
  try {
    const visibles = (await pool.query(`SELECT count(*)::int AS n FROM etablissements WHERE actif AND module_actif AND config_id = $1 AND partage <> 'aucun'`, [cfg])).rows[0].n;
    const r = (await appel('x', 'GET', `/national?depuis=${hx}`)).corps;
    assert.strictEqual(r.total, visibles, 'tous ceux qui partagent leur capacité, sans limite de rayon');
    assert.deepStrictEqual([r.taille, r.etablissements.length, r.pages], [20, 20, Math.ceil(visibles / 20)]);
    assert.ok(r.etablissements[0].moi);
    const dist = r.etablissements.slice(1).map((e) => e.distance_km);
    assert.deepStrictEqual(dist, [...dist].sort((a, b) => a - b), 'du plus proche au plus loin');
    // Pages suivantes : sans doublon, la distance continue de croître
    const p2 = (await appel('x', 'GET', `/national?depuis=${hx}&page=2`)).corps;
    assert.ok(p2.etablissements[0].distance_km >= dist[dist.length - 1]);
    assert.ok(!p2.etablissements.some((e) => r.etablissements.some((x) => x.id === e.id)));
    // Partage : « aucun » et module inactif absents ; « agrégé » sans prévisions ni détail des séjours
    const tous = [];
    for (let p = 1; p <= r.pages; p += 1) tous.push(...(await appel('x', 'GET', `/national?depuis=${hx}&page=${p}`)).corps.etablissements);
    assert.strictEqual(tous.length, visibles);
    const codes = new Set((await pool.query(`SELECT id FROM etablissements WHERE partage = 'aucun' OR NOT module_actif`)).rows.map((x) => x.id));
    assert.ok(!tous.some((e) => codes.has(e.id)));
    const agrege = tous.find((e) => e.partage === 'agrege');
    assert.ok(agrege.unites.every((u) => u.prevus === null));
    const complet = tous.find((e) => e.partage === 'complet' && !e.moi);
    assert.ok(complet.unites.every((u) => u.prevus !== null) && complet.adresse && complet.minutes_route > 0);
    // Filtres : temps de route maximal, lit libre adapté du type
    const proche = (await appel('x', 'GET', `/national?depuis=${hx}&max_minutes=60&taille=50`)).corps;
    assert.ok(proche.total < visibles && proche.etablissements.every((e) => e.minutes_route <= 60));
    const libre = (await appel('x', 'GET', `/national?depuis=${hx}&type_id=${med}&isolement=1&avec_lit=1&taille=50`)).corps;
    assert.ok(libre.total > 0 && libre.etablissements.filter((e) => !e.moi).every((e) => e.unites.find((u) => u.type_id === med).libres > 0));
    assert.strictEqual((await appel('x', 'GET', `/national?depuis=${hx}&avec_lit=1`)).statut, 400, 'le type d’unité est requis');
    // Carte : tous les établissements visibles, avec leur niveau
    const carte = (await appel('x', 'GET', `/national/carte?depuis=${hx}`)).corps;
    assert.strictEqual(carte.length, visibles);
    assert.ok(carte.every((p) => ['vert', 'jaune', 'orange', 'rouge'].includes(p.niveau)));
    // Temps de réponse : moins de 300 ms, avec et sans filtres
    for (const q of ['', `&type_id=${med}&isolement=1&avec_lit=1`, '&max_minutes=120&page=2']) {
      const t0 = Date.now();
      for (let i = 0; i < 5; i += 1) assert.strictEqual((await appel('x', 'GET', `/national?depuis=${hx}${q}`)).statut, 200);
      const moyenne = (Date.now() - t0) / 5;
      assert.ok(moyenne < 300, `national${q} : ${moyenne} ms`);
    }
    // « Transférer ici » au-delà du rayon de suggestion : permis seulement quand l'utilisateur le choisit au tableau national
    const loin = tous.find((e) => e.partage === 'complet' && e.distance_km > 250 && e.unites.find((u) => u.type_id === med)?.libres > 0);
    assert.ok(loin, 'un établissement à plus de 250 km avec un lit libre');
    const sans = await appel('x', 'POST', '/transferts', { origine_id: hx, destination_id: loin.id, type_id: med, patient_ref: 'P-90002' });
    assert.strictEqual(sans.corps.code, 'hors_rayon');
    const avec = await appel('x', 'POST', '/transferts', { origine_id: hx, destination_id: loin.id, type_id: med, patient_ref: 'P-90002', hors_rayon: true });
    assert.strictEqual(avec.statut, 200, JSON.stringify(avec.corps));
  } finally {
    // Les tests suivants reviennent à la démo X / Y
    await pool.query(`UPDATE etablissements SET actif = false WHERE code LIKE 'NAT%'`);
  }
});

/* ======================= Version 4 : comptes et administration ======================= */
const totp = require('../src/totp');

test('administration : double authentification obligatoire, création de compte, mot de passe temporaire', async () => {
  // reseau@ est gestionnaire mais sans double authentification : administration refusée
  const t = (await appel(null, 'POST', '/connexion', { email: 'reseau@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO })).corps.token;
  tokens.reseau2 = t;
  const refus = await appel('reseau2', 'GET', '/admin/utilisateurs');
  assert.strictEqual(refus.statut, 403);
  assert.match(refus.corps.erreur, /double authentification/);
  // Activation : QR code, puis code correct
  const prep = await appel('reseau2', 'POST', '/moi/2fa/preparer');
  assert.match(prep.corps.qr_svg, /<svg/);
  assert.strictEqual((await appel('reseau2', 'POST', '/moi/2fa/activer', { code: '000000' })).statut, 400);
  const code = totp.codePourPas(prep.corps.secret, totp.pasActuel());
  assert.strictEqual((await appel('reseau2', 'POST', '/moi/2fa/activer', { code })).statut, 200);
  // Connexion suivante : deux étapes
  const e1 = await appel(null, 'POST', '/connexion', { email: 'reseau@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO });
  assert.strictEqual(e1.corps.etape, '2fa');
  assert.ok(!e1.corps.token, 'pas de session avant le code');
  assert.strictEqual((await appel(null, 'POST', '/connexion/2fa', { jeton: e1.corps.jeton, code })).statut, 401, 'un code déjà utilisé est refusé');
  const suivant = totp.codePourPas(prep.corps.secret, totp.pasActuel() + 1);
  const e2 = await appel(null, 'POST', '/connexion/2fa', { jeton: e1.corps.jeton, code: suivant });
  assert.strictEqual(e2.statut, 200);
  tokens.admin = e2.corps.token;
  // Création d'un compte : mot de passe temporaire, seul le changement est permis
  const sl = await id('HY');
  const cree = await appel('admin', 'POST', '/admin/utilisateurs', { nom: 'Infirmière test', email: 'test.inf@demo.arrimo', role: 'coordonnateur', etablissements: [sl] });
  assert.strictEqual(cree.statut, 200, JSON.stringify(cree.corps));
  assert.strictEqual((await appel('admin', 'POST', '/admin/utilisateurs', { nom: 'Doublon', email: 'test.inf@demo.arrimo', role: 'coordonnateur', etablissements: [sl] })).statut, 409);
  const tmp = await appel(null, 'POST', '/connexion', { email: 'test.inf@demo.arrimo', mot_de_passe: cree.corps.mot_de_passe_temporaire });
  assert.strictEqual(tmp.corps.mdp_temporaire, true);
  tokens.inf = tmp.corps.token;
  assert.strictEqual((await appel('inf', 'GET', `/lits?etablissement_id=${sl}`)).statut, 403, 'rien d’autre avant le changement');
  assert.strictEqual((await appel('inf', 'PUT', '/moi/mot-de-passe', { actuel: cree.corps.mot_de_passe_temporaire, nouveau: 'court1' })).statut, 400);
  assert.strictEqual((await appel('inf', 'PUT', '/moi/mot-de-passe', { actuel: cree.corps.mot_de_passe_temporaire, nouveau: 'Nouveau-mot-2026' })).statut, 200);
  assert.strictEqual((await appel('inf', 'GET', `/lits?etablissement_id=${sl}`)).statut, 200);
  // Désactivation : la session tombe immédiatement
  assert.strictEqual((await appel('admin', 'PUT', `/admin/utilisateurs/${cree.corps.id}`, { actif: false })).statut, 200);
  assert.strictEqual((await appel('inf', 'GET', '/moi')).statut, 401);
  const j = await appel('admin', 'GET', '/admin/journal');
  assert.ok(j.corps.some((x) => x.action === 'Compte créé') && j.corps.some((x) => x.action === 'Compte désactivé'));
  await assert.rejects(pool.query('DELETE FROM journal_admin'), 'journal d’administration immuable');
});

test('admin d’établissement : limité à ses établissements ; structure et équipement', async () => {
  const sl = await id('HY'); const mb = await id('HX');
  const cree = await appel('admin', 'POST', '/admin/utilisateurs', { nom: 'Admin SL', email: 'admin.sl@demo.arrimo', role: 'admin_etab', etablissements: [sl] });
  const tmp = (await appel(null, 'POST', '/connexion', { email: 'admin.sl@demo.arrimo', mot_de_passe: cree.corps.mot_de_passe_temporaire })).corps.token;
  tokens.asl = tmp;
  await appel('asl', 'PUT', '/moi/mot-de-passe', { actuel: cree.corps.mot_de_passe_temporaire, nouveau: 'Admin-SL-2026-ok' });
  const prep = await appel('asl', 'POST', '/moi/2fa/preparer');
  await appel('asl', 'POST', '/moi/2fa/activer', { code: totp.codePourPas(prep.corps.secret, totp.pasActuel()) });
  // Ne peut pas créer de gestionnaire, ni de compte dans un autre établissement
  assert.strictEqual((await appel('asl', 'POST', '/admin/utilisateurs', { nom: 'X', email: 'x1@demo.arrimo', role: 'gestionnaire' })).statut, 403);
  assert.strictEqual((await appel('asl', 'POST', '/admin/utilisateurs', { nom: 'X', email: 'x2@demo.arrimo', role: 'coordonnateur', etablissements: [mb] })).statut, 403);
  const liste = (await appel('asl', 'GET', '/admin/utilisateurs')).corps;
  assert.ok(liste.every((u) => u.etablissements.every((e) => e === sl)), 'ne voit que les comptes de son établissement');
  assert.strictEqual((await appel('asl', 'GET', `/admin/structure?etablissement_id=${mb}`)).statut, 403);
  assert.strictEqual((await appel('asl', 'PUT', '/admin/config/1', { rayon_km: 10 })).statut, 403, 'configuration pays : gestionnaire seulement');
  // Structure : unité, chambre, lit, équipement
  const types = (await appel('asl', 'GET', '/moi')).corps.configs[0].types;
  const unite = await appel('asl', 'POST', '/admin/unites', { etablissement_id: sl, type_id: types[1].id, nom: 'Médecine B' });
  assert.strictEqual(unite.statut, 200);
  const ch = await appel('asl', 'POST', '/admin/chambres', { unite_id: unite.corps.id, numero: '901' });
  assert.strictEqual((await appel('asl', 'POST', '/admin/chambres', { unite_id: unite.corps.id, numero: '901' })).statut, 409);
  const lit = await appel('asl', 'POST', '/admin/lits', { chambre_id: ch.corps.id, code: 'MEDB-901A', isolement: true });
  assert.strictEqual(lit.corps.etat, 'libre');
  assert.strictEqual(lit.corps.isolement, true);
  assert.strictEqual((await appel('asl', 'POST', '/admin/lits', { chambre_id: ch.corps.id, code: 'MEDB-901A' })).statut, 409);
  const eq = await appel('asl', 'PUT', `/admin/lits/${lit.corps.id}/equipement`, { telemetrie: true });
  assert.strictEqual(eq.corps.telemetrie, true);
  assert.strictEqual(eq.corps.isolement, true, 'les autres équipements sont conservés');
  // Connecteur d'établissement : créé, puis révoqué, la clé ne fonctionne plus
  const con = await appel('asl', 'POST', '/admin/connecteurs', { nom: 'ADT test', etablissement_id: sl });
  assert.strictEqual((await appel('asl', 'POST', '/admin/connecteurs', { nom: 'Réseau', etablissement_id: null })).statut, 403);
  await appel('asl', 'POST', `/admin/connecteurs/${con.corps.id}/revoquer`);
  assert.strictEqual((await appel(null, 'GET', '/connecteurs/capacite', null, { 'X-Connecteur-Key': con.corps.cle })).statut, 401);
  // Réinitialisation d'un compte par le gestionnaire, avec la double authentification
  const r = await appel('admin', 'POST', `/admin/utilisateurs/${cree.corps.id}/reinitialiser`, { reinitialiser_2fa: true });
  assert.ok(r.corps.mot_de_passe_temporaire);
  assert.strictEqual((await appel('asl', 'GET', '/moi')).statut, 401, 'sessions fermées');
  const apres = await appel(null, 'POST', '/connexion', { email: 'admin.sl@demo.arrimo', mot_de_passe: r.corps.mot_de_passe_temporaire });
  assert.ok(apres.corps.token && !apres.corps.etape, 'double authentification réinitialisée');
});

test('configuration pays : validation des seuils ; état du service', async () => {
  const cfg = (await appel('admin', 'GET', '/admin/config')).corps[0];
  assert.strictEqual((await appel('admin', 'PUT', `/admin/config/${cfg.id}`, { seuil_jaune: 99, seuil_orange: 90 })).statut, 400);
  assert.strictEqual((await appel('admin', 'GET', '/admin/config')).corps[0].seuil_jaune, cfg.seuil_jaune, 'une modification refusée n’est pas enregistrée');
  const ok = await appel('admin', 'PUT', `/admin/config/${cfg.id}`, { rayon_km: 300, facteur_route: 1.4 });
  assert.strictEqual(ok.corps.rayon_km, 300);
  const s = await appel(null, 'GET', '/sante');
  assert.strictEqual(s.corps.etat, 'ok');
  assert.ok(!JSON.stringify(s.corps).includes('P-'));
});

/* ------------------------------------------------------------------ langues */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { MESSAGES } = require('../src/erreurs');

function dictionnaires() {
  const bac = { window: {} };
  for (const f of ['fr', 'en', 'aide.fr', 'aide.en']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', `${f}.js`), 'utf8'), bac);
  return bac.window.ARRIMO_I18N;
}
const cles = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? cles(v, `${p}${k}.`) : [`${p}${k}`]));

test('langues : dictionnaires FR et EN complets, chaque code d’erreur traduit', () => {
  const { fr, en } = dictionnaires();
  const sansErreurs = (l) => cles(l).filter((k) => !k.startsWith('erreurs.'));
  assert.deepStrictEqual(sansErreurs(en).sort(), sansErreurs(fr).sort(), 'mêmes clés en français et en anglais');
  assert.deepStrictEqual(Object.keys(en.erreurs).sort(), Object.keys(MESSAGES).sort(), 'chaque code d’erreur a sa traduction anglaise');
  // Chaque code utilisé dans le code du serveur existe dans le catalogue
  const src = fs.readdirSync(path.join(__dirname, '..', 'src')).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n');
  const utilises = [...src.matchAll(/new ErreurHttp\(\d+, '(\w+)'/g)].map((m) => m[1]);
  assert.ok(utilises.length > 80);
  assert.deepStrictEqual(utilises.filter((c) => !MESSAGES[c]), []);
});

test('mise en forme : pluriels, nombres et durées selon la langue ; aucun « (s) » dans les textes', () => {
  const F = require('../public/i18n/format');
  const { TEXTES } = require('../src/langue');
  // Pluriels : en français 0 et 1 au singulier, en anglais seulement 1 ; forme zéro si fournie
  assert.strictEqual(F.remplir('fr-CA', '{n|# lit libre|# lits libres}', { n: 1 }), '1 lit libre');
  assert.strictEqual(F.remplir('fr-CA', '{n|# lit libre|# lits libres}', { n: 3 }), '3 lits libres');
  assert.strictEqual(F.remplir('fr-CA', '{n|aucune demande transférée|# demande transférée|# demandes transférées}', { n: 0 }), 'aucune demande transférée');
  assert.strictEqual(F.remplir('en-CA', '{n|# free bed|# free beds}', { n: 0 }), '0 free beds');
  assert.strictEqual(F.remplir('en-CA', '{n|# free bed|# free beds}', { n: 1 }), '1 free bed');
  assert.strictEqual(F.remplir('fr-CA', '{n|# nettoyage mesuré|# nettoyages mesurés}', { n: 25 }), '25 nettoyages mesurés');
  // Nombres et pourcentages : virgule et espace en français, point sans espace en anglais
  assert.strictEqual(F.pourcent('fr-CA', 9.5).replace(/\s/g, ' '), '9,5 %');
  assert.strictEqual(F.pourcent('en-CA', 9.5), '9.5%');
  assert.strictEqual(F.nombre('fr-CA', 15.6), '15,6');
  assert.strictEqual(F.remplir('fr-CA', '{p} %', { p: 9.5 }), '9,5 %');
  // Durées : « 49 min », « 5 h 08 » / « 5 h 8 min », « 3 j 4 h » / « 3 d 4 h »
  const d = (l, m) => F.duree(l, m).replace(/ /g, ' ');
  assert.deepStrictEqual([d('fr-CA', 49), d('fr-CA', 308), d('fr-CA', 300), d('fr-CA', 76 * 60)], ['49 min', '5 h 08', '5 h', '3 j 4 h']);
  assert.deepStrictEqual([d('en-CA', 49), d('en-CA', 308), d('en-CA', 76 * 60)], ['49 min', '5 h 8 min', '3 d 4 h']);
  // Aucun « (s) » : interface, aide, pages légales, textes du serveur, messages d'erreur
  const { fr, en } = dictionnaires();
  const tous = (o) => (typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(tous) : o && typeof o === 'object' ? Object.values(o).flatMap(tous) : []);
  const bac = { window: {} };
  for (const f of ['legal.fr', 'legal.en']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', `${f}.js`), 'utf8'), bac);
  const textes = [...tous(fr), ...tous(en), ...tous(bac.window), ...tous(TEXTES), ...Object.values(MESSAGES)];
  assert.ok(textes.length > 800);
  assert.deepStrictEqual(textes.filter((x) => /\(s\)|\(e\)|\(es\)/.test(x)), [], 'vraies formes du singulier et du pluriel');
  // Chaque modèle de pluriel est bien formé : 2 ou 3 formes, et le nombre (#) dans au moins une forme
  for (const x of textes) {
    for (const m of x.matchAll(/\{(\w+)\|([^{}]*)\}/g)) {
      const formes = m[2].split('|');
      assert.ok(formes.length === 2 || formes.length === 3, `${m[0]} : 2 ou 3 formes`);
    }
  }
});

test('langues : erreurs avec code stable, Copilote et notifications en anglais', async () => {
  // La base contient ici la démonstration : réseau de 20 hôpitaux (test précédent)
  const r = await appel(null, 'POST', '/connexion', { email: 'hopital.x@demo.arrimo', mot_de_passe: 'faux' });
  assert.strictEqual(r.corps.code, 'identifiants_incorrects');
  assert.strictEqual(r.corps.erreur, 'Adresse courriel ou mot de passe incorrect.');
  const inv = await appel('x', 'GET', '/lits?etablissement_id=abc');
  assert.deepStrictEqual([inv.corps.code, inv.corps.vars], ['parametre_invalide', { nom: 'etablissement_id' }]);

  const hx = await id('HX'); const hy = await id('HY');
  const noms = (await pool.query('SELECT nom FROM etablissements UNION SELECT ville FROM etablissements')).rows.map((x) => x.nom).sort((a, b) => b.length - a.length);
  const francais = /[àâçéèêëîïôûùüÿœ]|\b(le|la|les|des|du|une|et|pour|dans|depuis|aucun|lits?|attente|libres?)\b/i;
  const nettoyer = (txt) => noms.reduce((x, n) => x.split(n).join(' '), txt);
  const b = await appel('x', 'GET', `/copilote/briefing?etablissement_id=${hx}&langue=en`);
  assert.strictEqual(b.statut, 200);
  const textes = [b.corps.resume, b.corps.alerte.protocole, ...b.corps.recommandations.flatMap((x) => [x.titre, x.raison, x.action?.libelle || '',
    ...(x.details || []).flatMap((d) => [d.titre, d.raison || '', d.action?.libelle || ''])])];
  assert.deepStrictEqual(textes.map(nettoyer).filter((x) => francais.test(x)), []);
  assert.match(b.corps.resume, /level \(pressure/);
  // Questions en anglais, réponses en anglais
  for (const q of ['What should we do first?', 'Who is waiting for a bed in the ER?', 'Where are the ALC patients?', 'Where can I find an ICU bed?',
    'How many beds will free up by tonight?', 'Which beds are blocked here?', 'Is the network overflowing?']) {
    const rep = await appel('x', 'POST', '/copilote/question', { etablissement_id: hx, question: q, langue: 'en' });
    assert.strictEqual(rep.statut, 200, q);
    assert.ok(!francais.test(nettoyer(rep.corps.reponse)), `${q} → ${rep.corps.reponse}`);
  }
  // Notification créée en français, lue dans chaque langue
  const ty = await type('MED');
  const lit = await litLibre(hy, ty);
  const tr = await appel('x', 'POST', '/transferts', { origine_id: hx, destination_id: hy, type_id: ty, lit_id: lit.id, version: lit.version, patient_ref: 'P-54321' });
  assert.strictEqual(tr.statut, 200, JSON.stringify(tr.corps));
  const fr = await appel('y', 'GET', `/notifications?etablissement_id=${hy}`);
  const en = await fetch(`${base}/api/notifications?etablissement_id=${hy}`, { headers: { Authorization: `Bearer ${tokens.y}`, 'X-Langue': 'en' } }).then((x) => x.json());
  const n = (liste) => liste.find((x) => x.message.includes(tr.corps.numero)).message;
  assert.match(n(fr.corps), /^Nouvelle demande .* : Médecine, lit/);
  assert.match(n(en), /^New request .*: Medicine, bed/);
});

test('aide : premiers pas mémorisés côté serveur, une seule fois', async () => {
  const avant = await appel('x', 'GET', '/moi');
  assert.strictEqual(avant.corps.utilisateur.premiers_pas_vus, false);
  assert.strictEqual((await appel('x', 'POST', '/moi/premiers-pas')).statut, 200);
  assert.strictEqual((await appel('x', 'GET', '/moi')).corps.utilisateur.premiers_pas_vus, true);
  // Le rôle entretien peut aussi le marquer (route sous /moi/)
  assert.strictEqual((await appel('ex', 'POST', '/moi/premiers-pas')).statut, 200);
});

test('aide : chaque écran a son aide complète, en français et en anglais, pour chaque rôle', () => {
  const { fr, en } = dictionnaires();
  const ecrans = ['copilote', 'reseau', 'national', 'lits', 'urgence', 'admissions', 'transferts', 'nettoyage', 'nsa', 'indicateurs', 'journal', 'params', 'admin', 'compte'];
  for (const d of [fr, en]) {
    for (const e of ecrans) {
      const a = d.aide.ecrans[e];
      assert.ok(a && a.nom && a.but && a.gestes.length >= 2 && a.gestes.length <= 5 && Array.isArray(a.erreurs), `aide ${e}`);
    }
    for (const r of ['coordonnateur', 'entretien', 'admin_etab', 'gestionnaire']) {
      assert.ok(d.aide.roles[r].titre && d.aide.roles[r].texte && d.aide.premiers_pas.roles[r].length, `rôle ${r}`);
    }
  }
});

test('pages légales : accessibles sans connexion, en français et en anglais ; informations publiques', async () => {
  for (const chemin of ['/confidentialite', '/conditions', '/privacy', '/terms']) {
    const r = await fetch(`${base}${chemin}`);
    assert.strictEqual(r.status, 200, chemin);
    assert.match(await r.text(), /legal\.fr\.js[\s\S]*legal\.en\.js/);
  }
  const { fr, en } = (() => { const bac = { window: {} }; for (const l of ['fr', 'en']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', `legal.${l}.js`), 'utf8'), bac); return bac.window.ARRIMO_LEGAL; })();
  for (const page of ['confidentialite', 'conditions']) {
    assert.strictEqual(fr[page].sections.length, en[page].sections.length, `${page} : mêmes sections`);
    fr[page].sections.forEach(([, p], i) => assert.strictEqual(p.length, en[page].sections[i][1].length, `${page} section ${i}`));
  }
  const texte = JSON.stringify(fr.confidentialite);
  for (const mot of ['Données|données', 'conservation', 'Sécurité', 'Hébergement', 'rectification', 'Responsable|responsable']) assert.match(texte, new RegExp(mot));
  assert.match(fr.avertissement, /avocat/);
  assert.ok(!/Odoo|Afrique/i.test(JSON.stringify({ fr, en })));
  const p = await appel(null, 'GET', '/public');
  assert.strictEqual(p.statut, 200);
  assert.strictEqual(p.corps.demo, false);
  assert.deepStrictEqual(p.corps.legal, {});
});

test('robustesse : fréquence limitée par session, taille limitée, /api/sante jamais limitée', async () => {
  const avant = process.env.API_LIMITE_SESSION;
  process.env.API_LIMITE_SESSION = '20';
  const srv = creerApp(pool).listen(0);
  try {
    const b = `http://127.0.0.1:${srv.address().port}/api`;
    const h = { Authorization: `Bearer ${tokens.x}` };
    const statuts = [];
    for (let i = 0; i < 25; i += 1) statuts.push((await fetch(`${b}/moi`, { headers: h })).status);
    assert.strictEqual(statuts.filter((x) => x === 200).length, 20);
    const r = await fetch(`${b}/moi`, { headers: h });
    assert.strictEqual(r.status, 429);
    assert.strictEqual((await r.json()).code, 'trop_requetes');
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    // Une autre session n'est pas touchée ; la surveillance non plus
    assert.strictEqual((await fetch(`${b}/moi`, { headers: { Authorization: `Bearer ${tokens.y}` } })).status, 200);
    for (let i = 0; i < 30; i += 1) assert.strictEqual((await fetch(`${b}/sante`)).status, 200);
    // Corps de plus de 50 ko refusé avec un code clair
    const gros = await fetch(`${b}/copilote/question`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.y}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ q: 'x'.repeat(60000) }) });
    assert.strictEqual(gros.status, 413);
    assert.strictEqual((await gros.json()).code, 'requete_trop_grosse');
  } finally {
    srv.close();
    if (avant === undefined) delete process.env.API_LIMITE_SESSION; else process.env.API_LIMITE_SESSION = avant;
  }
});

test('pagination : journal et transferts au-delà de 300 lignes, sans doublon ni oubli', async () => {
  const hx = await id('HX');
  const lit = (await pool.query('SELECT id FROM lits WHERE etablissement_id = $1 LIMIT 1', [hx])).rows[0].id;
  // 650 entrées de même horodatage : le cas le plus difficile pour un curseur
  await pool.query(`INSERT INTO journal (lit_id, etablissement_id, action, detail, date)
                    SELECT $1, $2, 'Création', 'essai pagination ' || g, now() - interval '40 days' FROM generate_series(1, 650) g`, [lit, hx]);
  const attendu = (await pool.query(`SELECT count(*)::int AS n FROM journal j LEFT JOIN transferts t ON t.id = j.transfert_id
                                      WHERE j.etablissement_id = $1 OR t.origine_id = $1 OR t.destination_id = $1`, [hx])).rows[0].n;
  const vus = []; let avant = null; let pages = 0;
  for (;;) {
    const r = await appel('x', 'GET', `/journal?etablissement_id=${hx}${avant ? `&avant=${encodeURIComponent(avant)}` : ''}`);
    assert.strictEqual(r.statut, 200);
    assert.ok(r.corps.length <= 300);
    pages += 1;
    vus.push(...r.corps.map((x) => x.id));
    if (r.corps.length < 300) break;
    avant = r.corps[r.corps.length - 1].curseur;
  }
  assert.ok(pages >= 3);
  assert.strictEqual(new Set(vus).size, vus.length, 'aucun doublon');
  assert.strictEqual(vus.length, attendu, 'aucune ligne oubliée');
  assert.strictEqual((await appel('x', 'GET', `/journal?etablissement_id=${hx}&avant=nimporte`)).corps.code, 'parametre_invalide');
  // Transferts : tous ceux en cours toujours présents, les terminés par pages
  const tr = await appel('x', 'GET', `/transferts?etablissement_id=${hx}&limite=5`);
  const enCours = (await pool.query(`SELECT count(*)::int AS n FROM transferts WHERE (origine_id = $1 OR destination_id = $1) AND statut NOT IN ('recu', 'refuse')`, [hx])).rows[0].n;
  assert.strictEqual(tr.corps.filter((x) => !['recu', 'refuse'].includes(x.statut)).length, enCours);
  const termines = tr.corps.filter((x) => ['recu', 'refuse'].includes(x.statut));
  assert.strictEqual(termines.length, 5);
  const suite = await appel('x', 'GET', `/transferts?etablissement_id=${hx}&limite=5&avant=${encodeURIComponent(termines[4].curseur)}`);
  assert.ok(suite.corps.every((x) => ['recu', 'refuse'].includes(x.statut)), 'la page suivante ne répète pas les transferts en cours');
  assert.ok(suite.corps.every((x) => !termines.some((y) => y.id === x.id)));
});

test('mot de passe oublié : inactif sans courriel ; lien unique de 30 min ; même réponse que le compte existe ou non', async () => {
  const courriel = require('../src/courriel');
  assert.strictEqual((await appel(null, 'GET', '/public')).corps.mot_de_passe_oublie, false);
  const off = await appel(null, 'POST', '/mot-de-passe/oubli', { email: 'entretien.y@demo.arrimo' });
  assert.deepStrictEqual([off.statut, off.corps.code], [503, 'courriel_non_configure']);
  const envoyes = [];
  courriel.definirTransport(async (m) => { envoyes.push(m); });
  process.env.ARRIMO_URL = 'https://arrimo.exemple.ca';
  try {
    assert.strictEqual((await appel(null, 'GET', '/public')).corps.mot_de_passe_oublie, true);
    const existe = await appel(null, 'POST', '/mot-de-passe/oubli', { email: 'Entretien.Y@demo.arrimo' });
    const inconnu = await appel(null, 'POST', '/mot-de-passe/oubli', { email: 'personne@demo.arrimo' });
    assert.deepStrictEqual([existe.statut, existe.corps], [inconnu.statut, inconnu.corps], 'réponse identique');
    await new Promise((r) => { setImmediate(r); });
    assert.strictEqual(envoyes.length, 1);
    assert.strictEqual(envoyes[0].a, 'entretien.y@demo.arrimo');
    const jeton = /\?reinit=([0-9a-f]{64})/.exec(envoyes[0].texte)[1];
    assert.match(envoyes[0].texte, /^Bonjour .*30 minutes/s);
    assert.ok(!(await pool.query('SELECT 1 FROM jetons_mdp WHERE jeton_hash = $1', [jeton])).rows[0], 'seule l’empreinte du jeton est gardée');
    // En anglais si demandé en anglais
    await fetch(`${base}/api/mot-de-passe/oubli`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Langue': 'en' }, body: JSON.stringify({ email: 'entretien.y@demo.arrimo' }) });
    await new Promise((r) => { setImmediate(r); });
    assert.match(envoyes[1].texte, /^Hello .*valid for 30 minutes/s);
    // Mot de passe trop faible, puis réussite, puis lien déjà utilisé
    assert.strictEqual((await appel(null, 'POST', '/mot-de-passe/reinitialiser', { jeton, nouveau: 'court1' })).corps.code, 'mdp_faible');
    const sess = (await appel(null, 'POST', '/connexion', { email: 'entretien.y@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO })).corps.token;
    tokens.uy = sess;
    const ok = await appel(null, 'POST', '/mot-de-passe/reinitialiser', { jeton, nouveau: 'Nouveau-mdp-2026' });
    assert.strictEqual(ok.statut, 200, JSON.stringify(ok.corps));
    assert.strictEqual((await appel('uy', 'GET', '/moi')).statut, 401, 'les sessions ouvertes sont fermées');
    assert.strictEqual((await appel(null, 'POST', '/connexion', { email: 'entretien.y@demo.arrimo', mot_de_passe: 'Nouveau-mdp-2026' })).statut, 200);
    assert.strictEqual((await appel(null, 'POST', '/mot-de-passe/reinitialiser', { jeton, nouveau: 'Encore-un-autre-2026' })).corps.code, 'jeton_invalide');
    const jeton2 = /\?reinit=([0-9a-f]{64})/.exec(envoyes[1].texte)[1];
    assert.strictEqual((await appel(null, 'POST', '/mot-de-passe/reinitialiser', { jeton: jeton2, nouveau: 'Encore-un-autre-2026' })).corps.code, 'jeton_invalide', 'les autres liens du compte sont annulés');
    // Lien expiré au-delà de 30 minutes
    await appel(null, 'POST', '/mot-de-passe/oubli', { email: 'entretien.y@demo.arrimo' });
    await new Promise((r) => { setImmediate(r); });
    const jeton3 = /\?reinit=([0-9a-f]{64})/.exec(envoyes[2].texte)[1];
    await pool.query(`UPDATE jetons_mdp SET expire_le = now() - interval '1 minute' WHERE utilise_le IS NULL`);
    assert.strictEqual((await appel(null, 'POST', '/mot-de-passe/reinitialiser', { jeton: jeton3, nouveau: 'Encore-un-autre-2026' })).corps.code, 'jeton_invalide');
    // Au plus 3 liens par heure et par compte, sans le dire
    const r4 = await appel(null, 'POST', '/mot-de-passe/oubli', { email: 'entretien.y@demo.arrimo' });
    await new Promise((r) => { setImmediate(r); });
    assert.deepStrictEqual([r4.statut, envoyes.length], [200, 3]);
    const j = await pool.query(`SELECT detail FROM journal_admin WHERE action = 'Mot de passe réinitialisé' AND cible = 'entretien.y@demo.arrimo'`);
    assert.deepStrictEqual(j.rows.map((x) => x.detail), ['par lien envoyé par courriel']);
    await pool.query('UPDATE utilisateurs SET mot_de_passe_hash = $2 WHERE email = $1', ['entretien.y@demo.arrimo', require('../src/auth').hacher(MOT_DE_PASSE_DEMO)]);
  } finally {
    courriel.definirTransport(null);
    delete process.env.ARRIMO_URL;
  }
});

test('verrou des lits sous forte concurrence : plus de réservations que de connexions, aucun blocage, refus journalisés', async () => {
  // Réservoir de 3 connexions et 12 réservations simultanées du même lit : chaque refus doit être journalisé
  // sans attendre une connexion tenue par une autre transaction.
  const petit = creerPool(URL_TEST);
  petit.options.max = 3;
  const srv = creerApp(petit).listen(0);
  try {
    const b = `http://127.0.0.1:${srv.address().port}/api`;
    const hy = await id('HY');
    const lit = await litLibre(hy);
    const avant = (await pool.query('SELECT count(*)::int AS n FROM journal WHERE lit_id = $1 AND refuse', [lit.id])).rows[0].n;
    const essais = Array.from({ length: 12 }, (_, i) => fetch(`${b}/lits/${lit.id}/action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.y}` },
      body: JSON.stringify({ action: 'reserver', version: lit.version, patient_ref: `P-${60000 + i}` }) }).then((r) => r.status));
    const delai = new Promise((_, rejet) => { setTimeout(() => rejet(new Error('blocage : les réservations ne se terminent pas')), 8000); });
    const statuts = await Promise.race([Promise.all(essais), delai]);
    assert.strictEqual(statuts.filter((x) => x === 200).length, 1);
    assert.strictEqual(statuts.filter((x) => x === 409).length, 11);
    const apres = (await pool.query('SELECT count(*)::int AS n FROM journal WHERE lit_id = $1 AND refuse', [lit.id])).rows[0].n;
    assert.strictEqual(apres - avant, 11, 'chaque refus est journalisé');
    await pool.query(`UPDATE lits SET etat = 'libre', patient_ref = NULL, version = version + 1 WHERE id = $1`, [lit.id]);
  } finally {
    srv.close();
    await petit.end();
  }
});

/* Ce test remet la base à zéro : il reste le dernier du fichier. */
test('démo toujours prête : remise à zéro refusée sans ARRIMO_DEMO=1, réservée au gestionnaire ; horloges recalées', async () => {
  const demo = require('../src/demo');
  const avant2fa = process.env.ARRIMO_2FA_ADMIN;
  process.env.ARRIMO_2FA_ADMIN = '0';
  try {
    const { hacher } = require('../src/auth');
    await pool.query(`INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ('gest.demo@demo.arrimo', 'Gestionnaire (test)', $1, 'gestionnaire')`, [hacher(MOT_DE_PASSE_DEMO)]);
    tokens.gdemo = (await appel(null, 'POST', '/connexion', { email: 'gest.demo@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO })).corps.token;
    delete process.env.ARRIMO_DEMO;
    const refus = await appel('gdemo', 'POST', '/admin/demo/reinitialiser');
    assert.deepStrictEqual([refus.statut, refus.corps.code], [403, 'demo_desactivee']);
    assert.strictEqual((await appel(null, 'GET', '/public')).corps.demo, false);
    process.env.ARRIMO_DEMO = '1';
    const pasGest = await appel('x', 'POST', '/admin/demo/reinitialiser');
    assert.strictEqual(pasGest.statut, 403);
    assert.strictEqual((await appel(null, 'GET', '/public')).corps.demo, true);
    // Une action pendant la démonstration, puis la remise à zéro l'efface
    const hx = await id('HX');
    await appel('x', 'POST', '/admissions', { etablissement_id: hx, type_id: await type('MED'), patient_ref: 'P-77777', priorite: 'p3' });
    const ok = await appel('gdemo', 'POST', '/admin/demo/reinitialiser');
    assert.strictEqual(ok.statut, 200, JSON.stringify(ok.corps));
    assert.strictEqual((await pool.query(`SELECT count(*)::int AS n FROM demandes_admission WHERE patient_ref = 'P-77777'`)).rows[0].n, 0);
    assert.strictEqual((await appel('gdemo', 'GET', '/moi')).statut, 401, 'les sessions sont fermées');
    const j = await pool.query(`SELECT detail FROM journal_admin WHERE action = 'Démo remise à zéro'`);
    assert.deepStrictEqual(j.rows.map((r) => r.detail), ['par gest.demo@demo.arrimo']);

    // Recalage : trois heures plus tard, les attentes de la démo sont celles du départ
    const attente = async () => (await pool.query(`SELECT max(EXTRACT(EPOCH FROM (now() - cree_le)) / 60)::int AS m FROM demandes_admission WHERE statut = 'attente'`)).rows[0].m;
    const depart = await attente();
    await pool.query(`UPDATE demandes_admission SET cree_le = cree_le - interval '180 minutes'`);
    await pool.query(`UPDATE demo_etat SET reference = reference - interval '180 minutes'`);
    assert.ok(await attente() >= depart + 179);
    const etatsAvant = (await pool.query('SELECT id, etat, version FROM lits ORDER BY id')).rows;
    assert.strictEqual(await demo.recaler(pool, { calmeMin: 0 }), 180);
    assert.ok(Math.abs(await attente() - depart) <= 1, 'attentes revenues à la situation de départ');
    assert.deepStrictEqual((await pool.query('SELECT id, etat, version FROM lits ORDER BY id')).rows, etatsAvant, 'aucun état de lit ne change');
    assert.strictEqual(await demo.recaler(pool, { calmeMin: 0 }), 0, 'rien à recaler juste après');
    // Si quelqu'un utilise la démo, on ne recale pas
    await pool.query(`UPDATE demo_etat SET reference = reference - interval '60 minutes'`);
    await pool.query('UPDATE utilisateurs SET derniere_connexion = now() WHERE email = $1', ['hopital.x@demo.arrimo']);
    assert.strictEqual(await demo.recaler(pool, { calmeMin: 30 }), 0);
    delete process.env.ARRIMO_DEMO;
    assert.strictEqual(await demo.recaler(pool, { calmeMin: 0 }), 0, 'jamais hors démonstration');
  } finally {
    delete process.env.ARRIMO_DEMO;
    if (avant2fa === undefined) delete process.env.ARRIMO_2FA_ADMIN; else process.env.ARRIMO_2FA_ADMIN = avant2fa;
  }
});

/* ======================= Partie C1 : environnements ======================= */
test('environnements : démo, recette, production ; domaine en un seul réglage ; garde-fous', async () => {
  const { spawnSync } = require('child_process');
  const env = require('../src/environnement');
  const avant = { ...process.env };
  const regler = (v) => { for (const k of ['ARRIMO_ENV', 'ARRIMO_DEMO', 'ARRIMO_DOMAINE', 'ARRIMO_URL', 'NODE_ENV']) delete process.env[k]; Object.assign(process.env, v); };
  try {
    regler({ ARRIMO_ENV: 'demo', ARRIMO_DOMAINE: 'arrimo.senseafri.com' });
    assert.deepStrictEqual([env.environnement(), env.estDemo(), env.hote(), env.urlPublique()], ['demo', true, 'arrimo.senseafri.com', 'https://arrimo.senseafri.com']);
    regler({ ARRIMO_ENV: 'recette', ARRIMO_DEMO: '1', ARRIMO_DOMAINE: 'arrimo.senseafri.com' });
    assert.deepStrictEqual([env.environnement(), env.estDemo(), env.urlPublique()], ['recette', false, 'https://recette.arrimo.senseafri.com'], 'ARRIMO_ENV prime sur l’ancien ARRIMO_DEMO');
    // Changer de domaine : un seul réglage
    regler({ ARRIMO_ENV: 'recette', ARRIMO_DOMAINE: 'arrimo.ca' });
    assert.strictEqual(env.urlPublique(), 'https://recette.arrimo.ca');
    regler({ ARRIMO_ENV: 'production', ARRIMO_DOMAINE: 'arrimo.ca', ARRIMO_URL: 'https://app.arrimo.ca/' });
    assert.deepStrictEqual([env.estProduction(), env.urlPublique()], [true, 'https://app.arrimo.ca']);
    regler({ ARRIMO_DEMO: '1' });
    assert.strictEqual(env.environnement(), 'demo', 'compatibilité avec les serveurs existants');
    regler({ NODE_ENV: 'production' });
    assert.strictEqual(env.environnement(), 'production');

    // Le serveur annonce son environnement ; hors démo : pas de remise à zéro, pas de simulation
    regler({ ARRIMO_ENV: 'recette', ARRIMO_DEMO: '1' });
    const pub = (await appel(null, 'GET', '/public')).corps;
    assert.deepStrictEqual([pub.environnement, pub.demo], ['recette', false]);
    assert.strictEqual((await require('../src/simulation').simuler(pool)), 0);
    assert.strictEqual(await require('../src/demo').recaler(pool, { calmeMin: 0 }), 0);
    // Scripts de données fictives refusés en recette et en production, avant tout accès à la base
    for (const e of ['recette', 'production']) {
      for (const script of ['db/reset.js', 'db/demo-reseau.js', 'db/seed.js']) {
        const r = spawnSync(process.execPath, [script, 'demo'], { cwd: require('path').join(__dirname, '..'),
          env: { PATH: process.env.PATH, ARRIMO_ENV: e, ARRIMO_DEMO: '1', DATABASE_URL: 'postgres://personne@127.0.0.1:1/aucune' }, encoding: 'utf8' });
        assert.strictEqual(r.status, 1, `${script} en ${e}`);
        assert.match(r.stderr, /Interdit en (recette|production)/);
      }
    }
  } finally {
    for (const k of ['ARRIMO_ENV', 'ARRIMO_DEMO', 'ARRIMO_DOMAINE', 'ARRIMO_URL', 'NODE_ENV']) { if (avant[k] === undefined) delete process.env[k]; else process.env[k] = avant[k]; }
  }
});

test('installateur : noms propres à chaque environnement, domaine changeable ; scripts valides', () => {
  const { spawnSync } = require('child_process');
  const racine = require('path').join(__dirname, '..');
  const noms = (vars) => {
    const r = spawnSync('bash', ['-c', '. deploy/noms.sh && printf "%s|%s|%s|%s|%s|%s|%s" "$NOM" "$DOSSIER" "$UTILISATEUR" "$BASE" "$PORT" "$HOTE" "$SAUVEGARDES"'],
      { cwd: racine, env: { PATH: process.env.PATH, ...vars }, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.split('|') : [`erreur ${r.status}`, r.stdout.trim()];
  };
  assert.deepStrictEqual(noms({ DOMAINE: 'arrimo.senseafri.com' }),
    ['arrimo', '/opt/arrimo', 'arrimo', 'arrimo', '3010', 'arrimo.senseafri.com', '/var/backups/arrimo'], 'la démo actuelle ne change pas');
  assert.deepStrictEqual(noms({ ARRIMO_ENV: 'recette', DOMAINE: 'arrimo.senseafri.com' }),
    ['arrimo-recette', '/opt/arrimo-recette', 'arrimo-recette', 'arrimo_recette', '3011', 'recette.arrimo.senseafri.com', '/var/backups/arrimo-recette']);
  assert.strictEqual(noms({ ARRIMO_ENV: 'recette', DOMAINE: 'Arrimo.CA' })[5], 'recette.arrimo.ca');
  assert.deepStrictEqual(noms({ ARRIMO_ENV: 'production', DOMAINE: 'arrimo.ca' }).slice(0, 6), ['arrimo', '/opt/arrimo', 'arrimo', 'arrimo', '3010', 'arrimo.ca']);
  assert.deepStrictEqual(noms({ ARRIMO_ENV: 'sh', DOMAINE: 'arrimo.senseafri.com' }),
    ['arrimo-sh', '/opt/arrimo-sh', 'arrimo-sh', 'arrimo_sh', '3012', 'sh.arrimo.senseafri.com', '/var/backups/arrimo-sh'], 'console SH');
  assert.match(noms({ ARRIMO_ENV: 'essai', DOMAINE: 'x' })[0], /^erreur 1/);
  for (const f of ['installer.sh', 'noms.sh', 'sauvegarde.sh', 'restaurer.sh', 'surveillance.sh', 'lien.sh']) {
    assert.strictEqual(spawnSync('bash', ['-n', `deploy/${f}`], { cwd: racine }).status, 0, f);
  }
  // Garde-fous de l'installateur, vérifiés dans le texte (il n'est jamais lancé par les tests : il installerait des paquets)
  const inst = require('fs').readFileSync(require('path').join(racine, 'deploy', 'installer.sh'), 'utf8');
  const avantPaquets = inst.slice(0, inst.indexOf('apt-get update'));
  assert.match(avantPaquets, /CONFIRMER_HEBERGEMENT_CANADA:-\}" = oui/, 'production : confirmation d’hébergement au Canada avant toute installation');
  assert.match(avantPaquets, /contient un autre environnement/, 'jamais un environnement par-dessus un autre');
  assert.match(inst, /NOUVELLE_INSTALLATION:-0\}" = 1 \] && \[ "\$ARRIMO_ENV" = demo \]/, 'données de démonstration en démo seulement');
  assert.doesNotMatch(inst, /server_name[^;\n]*\*\./, 'jamais de nom générique dans Nginx : certbot y installerait le certificat d’un autre environnement');
  assert.doesNotMatch(inst, /NOMS_NGINX="[^"]*\*/, 'jamais de nom générique dans Nginx');
});

test('premier compte d’un environnement vide : gestionnaire, mot de passe temporaire ; refusé s’il existe des comptes', async () => {
  const { premierCompte } = require('../db/premier-compte');
  await assert.rejects(premierCompte(pool, 'premier@exemple.ca', 'Premier'), /déjà des comptes/);
  const nomBase = `arrimo_test_premier_${process.pid}`;
  await pool.query(`DROP DATABASE IF EXISTS ${nomBase}`);
  await pool.query(`CREATE DATABASE ${nomBase}`);
  const url = new URL(URL_TEST); url.pathname = `/${nomBase}`;
  const vide = creerPool(url.toString());
  try {
    await assert.rejects(premierCompte(vide, 'pas un courriel', 'X'), /Courriel invalide/);
    const mdp = await premierCompte(vide, 'Moustafa@Exemple.ca', 'Moustafa Adamou');
    assert.ok(mdp.length >= 12);
    const u = (await vide.query('SELECT email, role, mdp_temporaire FROM utilisateurs')).rows;
    assert.deepStrictEqual(u, [{ email: 'moustafa@exemple.ca', role: 'gestionnaire', mdp_temporaire: true }]);
    assert.strictEqual((await vide.query('SELECT count(*)::int AS n FROM etablissements')).rows[0].n, 0, 'aucune donnée de démonstration');
    assert.deepStrictEqual((await vide.query('SELECT code FROM types_unite ORDER BY ordre')).rows.map((r) => r.code), ['SI', 'MED', 'CHIR', 'MAT'], 'configuration de base du Québec');
    await assert.rejects(premierCompte(vide, 'autre@exemple.ca', 'Autre'), /déjà des comptes/);
  } finally {
    await vide.end();
    await pool.query(`DROP DATABASE IF EXISTS ${nomBase}`);
  }
});

/* ======================= Partie C3 : import CSV ======================= */
test('import CSV : nouvel établissement, vérification ligne par ligne, import tout ou rien, réimport sans doublon, comptes temporaires', async () => {
  const avant2fa = process.env.ARRIMO_2FA_ADMIN;
  process.env.ARRIMO_2FA_ADMIN = '0';
  try {
    tokens.gi = (await appel(null, 'POST', '/connexion', { email: 'reseau@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO })).corps.token;
    tokens.x = (await appel(null, 'POST', '/connexion', { email: 'hopital.x@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO })).corps.token;
    // Nouvel établissement : gestionnaire seulement, code unique, position valide, créé inactif
    const nouveau = { code: 'hop-imp', nom: 'Hôpital de l’Import', ville: 'Ville I', adresse: '1, rue du Test', latitude: '45.5', longitude: '-72.1' };
    assert.strictEqual((await appel('x', 'POST', '/admin/etablissements', nouveau)).statut, 403);
    assert.strictEqual((await appel('gi', 'POST', '/admin/etablissements', { ...nouveau, latitude: '95' })).corps.code, 'position_invalide');
    const e = (await appel('gi', 'POST', '/admin/etablissements', nouveau)).corps;
    assert.deepStrictEqual([e.code, e.module_actif], ['HOP-IMP', false]);
    assert.strictEqual((await appel('gi', 'POST', '/admin/etablissements', nouveau)).corps.code, 'code_etab_existe');
    const etab = e.id;
    const verifier = (type, contenu) => appel('gi', 'POST', '/admin/import/verifier', { etablissement_id: etab, type, contenu });
    const importer = (type, contenu, empreinte) => appel('gi', 'POST', '/admin/import/importer', { etablissement_id: etab, type, contenu, empreinte });

    // Modèle téléchargeable : séparateur « ; », BOM pour Excel, exemples fictifs
    const m = await fetch(`${base}/api/admin/import/modeles/lits`, { headers: { Authorization: `Bearer ${tokens.gi}` } });
    const octets = Buffer.from(await m.arrayBuffer());
    assert.match(m.headers.get('content-type'), /text\/csv/);
    assert.deepStrictEqual([...octets.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM pour Excel');
    assert.ok(octets.subarray(3).toString('utf8').startsWith('unite;chambre;lit;isolement;pression_negative;ventilation;telemetrie\r\n'));

    // Vérification : erreurs ligne par ligne, rien n'est écrit
    let v = (await verifier('unites', 'unite;type_unite;nom_patient\nMédecine;MED;x')).corps;
    assert.deepStrictEqual(v.erreurs.map((x) => [x.ligne, x.colonne, x.code]), [[1, 'nom_patient', 'donnees_patient']]);
    v = (await verifier('unites', 'unite;type_unite\nMédecine;MED\nUrgence;URG\nMédecine;MED\nChirurgie;;\nGériatrie;P-12345')).corps;
    assert.deepStrictEqual(v.erreurs.map((x) => [x.ligne, x.colonne, x.code]),
      [[3, 'type_unite', 'type_unite_inconnu'], [4, 'unite', 'doublon'], [5, 'type_unite', 'valeur_requise'], [6, 'type_unite', 'donnees_patient']]);
    assert.strictEqual(v.erreurs[1].vars.premiere, 2);
    assert.strictEqual((await importer('unites', 'unite;type_unite\nMédecine;MED\nUrgence;URG', v.empreinte)).corps.code, 'import_erreurs');
    assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM unites WHERE etablissement_id = $1', [etab])).rows[0].n, 0, 'rien n’est écrit');
    // Ordre : les chambres demandent des unités existantes
    v = (await verifier('chambres', 'unite;chambre\nMédecine;301')).corps;
    assert.strictEqual(v.erreurs[0].code, 'unite_inconnue');

    // Unités : vérifier, importer ; une empreinte différente est refusée
    const unites = 'unite;type_unite\nMédecine 3e;MED\n"Soins intensifs";Soins intensifs\nChirurgie;chir\n';
    v = (await verifier('unites', unites)).corps;
    assert.deepStrictEqual([v.nb_erreurs, v.resume], [0, { creer: 3, maj: 0, inchange: 0 }]);
    assert.strictEqual((await importer('unites', `${unites}Maternité;MAT\n`, v.empreinte)).corps.code, 'import_fichier_change');
    let r = (await importer('unites', unites, v.empreinte)).corps;
    assert.deepStrictEqual(r.resume, { creer: 3, maj: 0, inchange: 0 });
    // Réimporter : rien de neuf, pas de doublon
    v = (await verifier('unites', unites)).corps;
    assert.deepStrictEqual(v.resume, { creer: 0, maj: 0, inchange: 3 });
    // Une unité existante ne change pas de type
    assert.strictEqual((await verifier('unites', 'unite;type_unite\nChirurgie;MED')).corps.erreurs[0].code, 'unite_autre_type');

    // Chambres (séparateur « , » accepté), puis lits avec équipement
    const chambres = 'unite,chambre\nMédecine 3e,301\nMédecine 3e,302\nSoins intensifs,101\n';
    v = (await verifier('chambres', chambres)).corps;
    assert.strictEqual(v.resume.creer, 3);
    await importer('chambres', chambres, v.empreinte);
    const lits = 'unite;chambre;lit;isolement;pression_negative;ventilation;telemetrie\nMédecine 3e;301;MED-301A;oui;non;non;non\nMédecine 3e;301;MED-301B;;;;oui\nSoins intensifs;101;SI-101;Oui;Oui;Oui;Oui\n';
    assert.strictEqual((await verifier('lits', lits.replace(';oui;non;non;non', ';peut-être;non;non;non'))).corps.erreurs[0].code, 'oui_non');
    v = (await verifier('lits', lits)).corps;
    r = (await importer('lits', lits, v.empreinte)).corps;
    assert.strictEqual(r.resume.creer, 3);
    const si = (await pool.query(`SELECT etat, isolement, pression_negative, ventilation, telemetrie, type_id FROM lits WHERE etablissement_id = $1 AND code = 'SI-101'`, [etab])).rows[0];
    assert.deepStrictEqual([si.etat, si.isolement, si.pression_negative, si.ventilation, si.telemetrie], ['libre', true, true, true, true]);
    assert.strictEqual((await pool.query(`SELECT count(*)::int AS n FROM journal j JOIN lits l ON l.id = j.lit_id WHERE l.etablissement_id = $1 AND j.detail = 'Import CSV'`, [etab])).rows[0].n, 3);
    // Réimport avec un équipement changé : mise à jour ; un lit ne change pas de chambre
    const lits2 = lits.replace('MED-301B;;;;oui', 'MED-301B;oui;;;oui');
    v = (await verifier('lits', lits2)).corps;
    assert.deepStrictEqual(v.resume, { creer: 0, maj: 1, inchange: 2 });
    await importer('lits', lits2, v.empreinte);
    assert.strictEqual((await pool.query(`SELECT isolement FROM lits WHERE etablissement_id = $1 AND code = 'MED-301B'`, [etab])).rows[0].isolement, true);
    assert.strictEqual((await verifier('lits', 'unite;chambre;lit\nMédecine 3e;302;MED-301A')).corps.erreurs[0].code, 'lit_autre_chambre');

    // Civières
    const civs = 'civiere;categorie\nURG-01;reguliere\nURG-02;Régulière\nCOR-01;debordement\n';
    v = (await verifier('civieres', civs)).corps;
    await importer('civieres', civs, v.empreinte);
    assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM civieres WHERE etablissement_id = $1', [etab])).rows[0].n, 3);

    // Utilisateurs : mot de passe temporaire retourné une seule fois ; un courriel d'un autre établissement est refusé
    const users = 'nom;courriel;role\nCoordination Import;Coord@Import.exemple;coordonnateur\nEntretien Import;entretien@import.exemple;entretien\n';
    assert.strictEqual((await verifier('utilisateurs', `${users}Intrus;hopital.x@demo.arrimo;coordonnateur\n`)).corps.erreurs[0].code, 'courriel_autre_etab');
    assert.strictEqual((await verifier('utilisateurs', 'nom;courriel;role\nChef;chef@import.exemple;gestionnaire')).corps.erreurs[0].code, 'role_inconnu');
    v = (await verifier('utilisateurs', users)).corps;
    r = (await importer('utilisateurs', users, v.empreinte)).corps;
    assert.strictEqual(r.comptes.length, 2);
    assert.strictEqual(r.comptes[0].courriel, 'coord@import.exemple');
    const cnx = await appel(null, 'POST', '/connexion', { email: 'coord@import.exemple', mot_de_passe: r.comptes[0].mot_de_passe_temporaire });
    assert.strictEqual(cnx.statut, 200);
    assert.strictEqual((await appel(null, 'GET', '/moi', null, { Authorization: `Bearer ${cnx.corps.token}` })).corps.utilisateur.mdp_temporaire, true);
    const stocke = (await pool.query(`SELECT mot_de_passe_hash FROM utilisateurs WHERE email = 'coord@import.exemple'`)).rows[0].mot_de_passe_hash;
    assert.ok(!stocke.includes(r.comptes[0].mot_de_passe_temporaire), 'jamais conservé en clair');
    v = (await verifier('utilisateurs', users)).corps;
    assert.deepStrictEqual(v.resume, { creer: 0, maj: 0, inchange: 2 });
    r = (await importer('utilisateurs', users, v.empreinte)).corps;
    assert.deepStrictEqual(r.comptes, [], 'réimport : aucun nouveau mot de passe');
    // Journal d'administration : une entrée par import
    const j = (await pool.query(`SELECT cible, detail FROM journal_admin WHERE action = 'Import CSV' AND etablissement_id = $1 ORDER BY id`, [etab])).rows;
    assert.ok(j.length >= 7 && j.every((x) => /créations : \d+ · mises à jour : \d+ · inchangées : \d+/.test(x.detail)));
    // Un administrateur d'établissement n'importe pas dans un autre établissement
    assert.strictEqual((await appel('x', 'POST', '/admin/import/verifier', { etablissement_id: etab, type: 'unites', contenu: unites })).statut, 403);
  } finally {
    if (avant2fa === undefined) delete process.env.ARRIMO_2FA_ADMIN; else process.env.ARRIMO_2FA_ADMIN = avant2fa;
    await pool.query(`UPDATE etablissements SET actif = false WHERE code = 'HOP-IMP'`);
  }
});

test('import CSV : lecture robuste (guillemets, fins de ligne Windows, BOM) et valeurs oui/non', () => {
  const { lireCsv, ouiNon } = require('../src/import');
  assert.deepStrictEqual(lireCsv('﻿a;b\r\n"x;y";"il dit ""oui"""\r\n'), [['a', 'b'], ['x;y', 'il dit "oui"']]);
  assert.deepStrictEqual(lireCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepStrictEqual(['oui', 'Non', '', 'X', 'vrai', '1', 'peut-être'].map(ouiNon), [true, false, false, true, true, true, null]);
});

/* ======================= Partie C2 : console SH ======================= */
test('console SH : première connexion (mot de passe, double authentification), hôpital, implantation, import, activation, désactivation', async () => {
  const { creerAppSh } = require('../src/sh/app');
  const { premierCompteSh } = require('../db/sh-premier-compte');
  const { viderBaseSh } = require('../db/sh-vider');
  const http = require('http');
  // Dans les tests, les tables de la console vivent dans la base de test (en production : base arrimo_sh séparée)
  await viderBaseSh(pool);
  const temporaire = await premierCompteSh(pool, 'sh@exemple.ca', 'Équipe SH');
  await assert.rejects(premierCompteSh(pool, 'autre@exemple.ca', 'Autre'), /déjà des comptes/);
  const cle = process.env.SH_API_KEY;
  const serveurSh = creerAppSh(pool, { env: { SH_ENV_RECETTE_URL: base, SH_ENV_RECETTE_CLE: cle, SH_ENV_RECETTE_PUBLIC: 'https://recette.exemple.ca' } }).listen(0);
  const baseSh = `http://127.0.0.1:${serveurSh.address().port}`;
  let jeton = null;
  const sh = async (methode, chemin, corps) => {
    const r = await fetch(`${baseSh}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
    return { statut: r.status, corps: await r.json().catch(() => null) };
  };
  try {
    // Première connexion : mot de passe à choisir, puis double authentification, avant tout le reste
    assert.strictEqual((await sh('GET', '/hopitaux')).statut, 401);
    jeton = (await sh('POST', '/connexion', { email: 'sh@exemple.ca', mot_de_passe: temporaire })).corps.token;
    assert.match((await sh('GET', '/hopitaux')).corps.erreur, /propre mot de passe/);
    assert.strictEqual((await sh('PUT', '/moi/mot-de-passe', { actuel: temporaire, nouveau: 'Console-SH-2026' })).statut, 200);
    assert.match((await sh('GET', '/hopitaux')).corps.erreur, /double authentification/);
    const { secret } = (await sh('POST', '/moi/2fa/preparer')).corps;
    assert.strictEqual((await sh('POST', '/moi/2fa/activer', { code: totp.codePourPas(secret, totp.pasActuel()) })).statut, 200);
    jeton = null;
    const etape = (await sh('POST', '/connexion', { email: 'sh@exemple.ca', mot_de_passe: 'Console-SH-2026' })).corps;
    assert.strictEqual(etape.etape, '2fa');
    jeton = (await sh('POST', '/connexion/2fa', { jeton: etape.jeton, code: totp.codePourPas(secret, totp.pasActuel() + 1) })).corps.token;
    assert.ok(jeton);
    assert.deepStrictEqual((await sh('GET', '/moi')).corps.environnements.map((e) => e.code), ['recette']);

    // Hôpital et projet d'implantation en 7 étapes
    assert.strictEqual((await sh('POST', '/hopitaux', { nom: 'Sans code', environnement: 'recette', code_etab: 'x' })).statut, 400);
    const h = (await sh('POST', '/hopitaux', { nom: 'Hôpital SH', ville: 'Ville SH', environnement: 'recette', code_etab: 'hop-sh', sous_domaine: 'hopital-sh',
      latitude: '45,5', longitude: '-72,1', contact_nom: 'Contact', contact_courriel: 'contact@hopital.exemple' })).corps;
    assert.strictEqual(h.code_etab, 'HOP-SH');
    assert.strictEqual(h.statut, 'prospect');
    assert.strictEqual((await sh('POST', '/hopitaux', { nom: 'Doublon', environnement: 'recette', code_etab: 'HOP-SH' })).statut, 409);
    let f = (await sh('GET', `/hopitaux/${h.id}`)).corps;
    assert.deepStrictEqual(f.etapes.map((e) => e.nom), ['Contrat', 'Configuration', 'Import des données', 'Tests', 'Formation', 'Go-live', 'Production']);
    assert.strictEqual(f.lien, 'https://hopital-sh.recette.exemple.ca');
    assert.strictEqual(f.peut_activer, false);
    assert.strictEqual(f.distant, null, 'pas encore d’établissement dans la recette');
    assert.match((await sh('POST', `/hopitaux/${h.id}/activation`)).corps.erreur, /Reliez/);

    // Relier : l'établissement est créé, inactif, dans l'environnement, avec son lien propre ; journal de l'environnement
    assert.strictEqual((await sh('POST', `/hopitaux/${h.id}/relier`)).corps.cree, true);
    const e = (await pool.query(`SELECT id, module_actif, sous_domaine FROM etablissements WHERE code = 'HOP-SH'`)).rows[0];
    assert.deepStrictEqual([e.module_actif, e.sous_domaine], [false, 'hopital-sh']);
    assert.ok((await pool.query(`SELECT 1 FROM journal_admin WHERE etablissement_id = $1 AND action = 'Établissement créé' AND detail LIKE '%console SH · sh@exemple.ca%'`, [e.id])).rows[0]);
    assert.strictEqual((await sh('POST', `/hopitaux/${h.id}/relier`)).corps.cree, false, 'relier deux fois ne crée pas de doublon');
    f = (await sh('GET', `/hopitaux/${h.id}`)).corps;
    assert.strictEqual(f.statut, 'implantation');
    const element = (code) => f.etapes.flatMap((x) => x.verifications).find((x) => x.code === code);
    assert.ok(element('etablissement_cree').faite && element('lien_defini').faite);
    assert.strictEqual(element('etablissement_cree').par, 'sh@exemple.ca');

    // Lien propre : hopital-sh.<hôte> mène à l'établissement (la page de connexion affiche son nom)
    const avantDomaine = process.env.ARRIMO_DOMAINE;
    process.env.ARRIMO_DOMAINE = 'exemple.ca';
    const publicPour = (hote) => new Promise((ok, ko) => {
      http.get(`${base}/api/public`, { headers: { Host: hote } }, (r) => { let d = ''; r.on('data', (x) => { d += x; }); r.on('end', () => ok(JSON.parse(d))); }).on('error', ko);
    });
    try {
      assert.deepStrictEqual((await publicPour('hopital-sh.exemple.ca')).lien, { id: e.id, nom: 'Hôpital SH' });
      assert.strictEqual((await publicPour('inconnu.exemple.ca')).lien, null);
      assert.strictEqual((await publicPour('exemple.ca')).lien, null);
    } finally { if (avantDomaine === undefined) delete process.env.ARRIMO_DOMAINE; else process.env.ARRIMO_DOMAINE = avantDomaine; }

    // Import par la console : vérifier, importer ; seuls l'empreinte et les compteurs sont gardés ; l'élément se coche seul
    const csv = 'unite;type_unite\nMédecine SH;MED\n';
    const modele = await fetch(`${baseSh}/api/hopitaux/${h.id}/import/modeles/unites`, { headers: { Authorization: `Bearer ${jeton}` } });
    assert.match(await modele.text(), /unite;type_unite/);
    const v = (await sh('POST', `/hopitaux/${h.id}/import/verifier`, { type: 'unites', contenu: csv })).corps;
    assert.deepStrictEqual(v.resume, { creer: 1, maj: 0, inchange: 0 });
    assert.strictEqual((await sh('POST', `/hopitaux/${h.id}/import/importer`, { type: 'unites', contenu: `${csv}Chirurgie SH;CHIR\n`, empreinte: v.empreinte })).statut, 409, 'fichier changé depuis la vérification');
    const imp = (await sh('POST', `/hopitaux/${h.id}/import/importer`, { type: 'unites', contenu: csv, empreinte: v.empreinte })).corps;
    assert.strictEqual(imp.resume.creer, 1);
    assert.ok((await pool.query(`SELECT 1 FROM unites WHERE etablissement_id = $1 AND nom = 'Médecine SH'`, [e.id])).rows[0]);
    const ligne = (await pool.query('SELECT * FROM imports WHERE hopital_id = $1', [h.id])).rows[0];
    assert.deepStrictEqual([ligne.type, ligne.creations, ligne.auteur, ligne.empreinte], ['unites', 1, 'sh@exemple.ca', v.empreinte]);
    assert.ok(!Object.keys(ligne).includes('contenu'));
    assert.ok((await pool.query(`SELECT 1 FROM journal_admin WHERE action = 'Import CSV' AND etablissement_id = $1 AND detail LIKE '%console SH%'`, [e.id])).rows[0]);
    f = (await sh('GET', `/hopitaux/${h.id}`)).corps;
    assert.ok(element('import_unites').faite);

    // Activation : refusée tant que les étapes avant le go-live ne sont pas toutes cochées
    assert.match((await sh('POST', `/hopitaux/${h.id}/activation`)).corps.erreur, /Activation impossible : \d+ éléments à cocher/);
    assert.strictEqual((await sh('PUT', `/verifications/${element('module_active').id}`, { faite: true })).statut, 409, 'suit l’activation');
    const auto = ['formation_coordination', 'formation_entretien', 'formation_admin'];
    for (const x of f.etapes.filter((et) => et.rang < 6).flatMap((et) => et.verifications).filter((x) => !x.faite && !auto.includes(x.code))) {
      assert.strictEqual((await sh('PUT', `/verifications/${x.id}`, { faite: true })).statut, 200);
    }
    // Étape Formation : cochée par le parcours de formation, rôle par rôle
    for (const el of f.formation.flatMap((r) => r.elements)) assert.strictEqual((await sh('PUT', `/formation/${el.id}`, { faite: true })).statut, 200);
    assert.strictEqual((await sh('PUT', `/etapes/${f.etapes[0].id}`, { date_prevue: '2026-11-02', responsable: 'Moustafa', notes: 'Signé.' })).statut, 200);
    assert.strictEqual((await sh('PUT', `/etapes/${f.etapes[0].id}`, { date_prevue: '02/11/2026' })).statut, 400);
    assert.strictEqual((await sh('POST', `/hopitaux/${h.id}/activation`)).statut, 200);
    assert.strictEqual((await pool.query('SELECT module_actif FROM etablissements WHERE id = $1', [e.id])).rows[0].module_actif, true);
    f = (await sh('GET', `/hopitaux/${h.id}`)).corps;
    assert.strictEqual(f.statut, 'actif');
    assert.ok(element('module_active').faite);
    assert.strictEqual(f.etapes[0].responsable, 'Moustafa');
    assert.ok(f.etapes[0].date_reelle, 'étape terminée : date réelle remplie');
    assert.strictEqual(f.etapes[0].date_prevue, '2026-11-02', 'date rendue telle quelle, sans décalage de fuseau');
    assert.strictEqual(f.etapes[0].date_reelle, (await pool.query("SELECT to_char(now() AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD') AS d")).rows[0].d, 'date du jour au Québec');
    assert.strictEqual(f.distant.module_actif, true);
    assert.strictEqual(f.distant.unites, 1);

    // Désactivation : motif obligatoire, inscrit dans le journal de l'environnement
    assert.strictEqual((await sh('POST', `/hopitaux/${h.id}/desactivation`, { motif: '' })).statut, 400);
    assert.strictEqual((await sh('POST', `/hopitaux/${h.id}/desactivation`, { motif: 'Fin du contrat' })).statut, 200);
    assert.strictEqual((await pool.query('SELECT module_actif FROM etablissements WHERE id = $1', [e.id])).rows[0].module_actif, false);
    assert.ok((await pool.query(`SELECT 1 FROM journal_admin WHERE etablissement_id = $1 AND detail LIKE '%module désactivé · motif : Fin du contrat%'`, [e.id])).rows[0]);
    f = (await sh('GET', `/hopitaux/${h.id}`)).corps;
    assert.strictEqual(f.statut, 'suspendu');
    assert.deepStrictEqual(f.activations.map((a) => a.action), ['desactivation', 'activation']);
    assert.strictEqual((await sh('PUT', `/hopitaux/${h.id}`, { statut: 'actif' })).statut, 409, 'le statut suit l’activation');
    assert.strictEqual((await sh('PUT', `/hopitaux/${h.id}`, { code_etab: 'AUTRE' })).statut, 409, 'relié : le code ne change plus');
    // Changer le lien propre le change aussi dans l'environnement
    assert.strictEqual((await sh('PUT', `/hopitaux/${h.id}`, { sous_domaine: 'hopital-sh2' })).statut, 200);
    assert.strictEqual((await pool.query('SELECT sous_domaine FROM etablissements WHERE id = $1', [e.id])).rows[0].sous_domaine, 'hopital-sh2');
    assert.strictEqual((await sh('PUT', `/hopitaux/${h.id}`, { sous_domaine: 'sh' })).statut, 400, 'nom réservé');

    // Liste : recherche, filtres, informations de l'environnement, jamais de référence patient
    const liste = (await sh('GET', '/hopitaux?q=ville sh&statut=suspendu')).corps;
    assert.deepStrictEqual(liste.map((x) => x.code_etab), ['HOP-SH']);
    assert.strictEqual((await sh('GET', '/hopitaux?statut=actif')).corps.length, 0);
    assert.doesNotMatch(JSON.stringify(liste), /P-\d{5}/);
    assert.deepStrictEqual((await sh('GET', '/environnements')).corps.map((x) => [x.code, x.joignable]), [['recette', true]]);

    // Équipe SH : comptes, mot de passe temporaire, pas d'action sur son propre compte
    const m = (await sh('POST', '/equipe', { nom: 'Second membre', email: 'second@exemple.ca' })).corps;
    assert.ok(m.mot_de_passe_temporaire);
    assert.strictEqual((await sh('POST', '/equipe', { nom: 'Doublon', email: 'second@exemple.ca' })).statut, 409);
    const equipe = (await sh('GET', '/equipe')).corps;
    const moi = equipe.find((x) => x.email === 'sh@exemple.ca');
    assert.strictEqual((await sh('PUT', `/equipe/${moi.id}`, { actif: false })).statut, 409);
    assert.ok(!JSON.stringify(equipe).includes('mot_de_passe_hash') && !JSON.stringify(equipe).includes('totp_secret'));

    // Journal SH : chaque action, immuable
    const j = (await sh('GET', '/journal')).corps;
    for (const a of ['Hôpital créé', 'Établissement créé', 'Import CSV', 'Élément coché', 'Module activé', 'Module désactivé', 'Compte SH créé']) assert.ok(j.some((x) => x.action === a), a);
    await assert.rejects(pool.query('UPDATE sh_journal SET action = $1', ['x']), /ne peut pas être modifié/);
    await assert.rejects(pool.query('DELETE FROM sh_journal'), /ne peut pas être modifié/);

    // Clé de l'environnement : obligatoire
    assert.strictEqual((await appel(null, 'GET', '/sh/etablissements', null, { 'X-SH-Key': 'mauvaise' })).statut, 401);
  } finally {
    serveurSh.close();
    await pool.query(`UPDATE etablissements SET actif = false WHERE code = 'HOP-SH'`);
  }
});

/* ======================= Partie C4 : formation et go-live ======================= */
test('C4 : patients fictifs en recette seulement, formation par rôle, go-live sans donnée de test, rapport PDF', { timeout: 120000 }, async () => {
  const { Pool } = require('pg');
  const { creerAppSh } = require('../src/sh/app');
  const { premierCompteSh } = require('../db/sh-premier-compte');
  const { viderBaseSh } = require('../db/sh-vider');
  const { configurationBase } = require('../db/configuration-base');
  const { verifier: verifierMdp } = require('../src/auth');
  // « Production » de test : une seconde instance d'Arrimo sur un schéma séparé de la base de test (base séparée en vrai)
  await pool.query('DROP SCHEMA IF EXISTS prod_c4 CASCADE; CREATE SCHEMA prod_c4');
  const poolProd = new Pool({ connectionString: URL_TEST, options: '-c search_path=prod_c4' });
  await poolProd.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  await configurationBase(poolProd);
  const serveurProd = creerApp(poolProd).listen(0);
  const baseProd = `http://127.0.0.1:${serveurProd.address().port}`;
  const cle = process.env.SH_API_KEY;
  await viderBaseSh(pool);
  const temporaire = await premierCompteSh(pool, 'sh@exemple.ca', 'Équipe SH');
  const serveurSh = creerAppSh(pool, { env: { SH_ENV_RECETTE_URL: base, SH_ENV_RECETTE_CLE: cle, SH_ENV_PRODUCTION_URL: baseProd, SH_ENV_PRODUCTION_CLE: cle, SH_ENV_PRODUCTION_PUBLIC: 'https://arrimo.exemple' } }).listen(0);
  const baseSh = `http://127.0.0.1:${serveurSh.address().port}`;
  let jeton = null;
  const sh = async (methode, chemin, corps) => {
    const r = await fetch(`${baseSh}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
    return { statut: r.status, corps: await r.json().catch(() => null) };
  };
  const avantEnv = process.env.ARRIMO_ENV;
  const enEnv = (e) => { if (e === undefined) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = e; };
  try {
    jeton = (await sh('POST', '/connexion', { email: 'sh@exemple.ca', mot_de_passe: temporaire })).corps.token;
    await sh('PUT', '/moi/mot-de-passe', { actuel: temporaire, nouveau: 'Console-SH-2026' });
    const { secret } = (await sh('POST', '/moi/2fa/preparer')).corps;
    await sh('POST', '/moi/2fa/activer', { code: totp.codePourPas(secret, totp.pasActuel()) });

    // Recette : l'établissement est ouvert dès sa création (tests et formation)
    enEnv('recette');
    const h = (await sh('POST', '/hopitaux', { nom: 'Hôpital C4', ville: 'Ville C4', environnement: 'recette', code_etab: 'HOP-C4', sous_domaine: 'hopital-c4', latitude: 46.1, longitude: -71.2, contact_nom: 'Contact C4' })).corps;
    assert.strictEqual((await sh('POST', `/hopitaux/${h.id}/relier`)).statut, 200);
    const eRec = (await pool.query(`SELECT id, module_actif FROM etablissements WHERE code = 'HOP-C4'`)).rows[0];
    assert.strictEqual(eRec.module_actif, true, 'recette : ouvert pour les tests et la formation');
    const fichiers = {
      unites: 'unite;type_unite\nMédecine C4;MED\nChirurgie C4;CHIR\n',
      chambres: 'unite;chambre\nMédecine C4;101\nMédecine C4;102\nChirurgie C4;201\n',
      lits: 'unite;chambre;lit;isolement;pression_negative;ventilation;telemetrie\nMédecine C4;101;C4-101A;oui;non;non;non\nMédecine C4;101;C4-101B;non;non;non;non\nMédecine C4;102;C4-102A;non;non;non;oui\nChirurgie C4;201;C4-201A;non;oui;non;non\nChirurgie C4;201;C4-201B;non;non;oui;non\n',
      civieres: 'civiere;categorie\nC4-C1;reguliere\nC4-C2;reguliere\nC4-C3;debordement\n',
      utilisateurs: 'nom;courriel;role\nCoordination C4;coord@c4.exemple;coordonnateur\nEntretien C4;entretien@c4.exemple;entretien\n',
    };
    let comptesRecette = [];
    for (const [type, contenu] of Object.entries(fichiers)) {
      const v = (await sh('POST', `/hopitaux/${h.id}/import/verifier`, { type, contenu })).corps;
      assert.strictEqual(v.nb_erreurs, 0, `${type} : ${JSON.stringify(v.erreurs)}`);
      const r = (await sh('POST', `/hopitaux/${h.id}/import/importer`, { type, contenu, empreinte: v.empreinte })).corps;
      if (type === 'utilisateurs') comptesRecette = r.comptes;
    }

    // 1. Générateur de patients fictifs : recette seulement
    const n = (await sh('POST', `/hopitaux/${h.id}/formation/generer`)).corps;
    assert.ok(n.admissions >= 2 && n.civieres >= 1 && n.demandes >= 1, JSON.stringify(n));
    const occupes = (await pool.query(`SELECT patient_ref FROM lits WHERE etablissement_id = $1 AND patient_ref IS NOT NULL`, [eRec.id])).rows;
    assert.ok(occupes.length && occupes.every((l) => /^P-9\d{4}$/.test(l.patient_ref)), 'références fictives P-9xxxx');
    assert.ok((await pool.query(`SELECT 1 FROM journal WHERE detail = 'Formation (données fictives)' AND lit_id IN (SELECT id FROM lits WHERE etablissement_id = $1)`, [eRec.id])).rows[0]);
    assert.ok((await pool.query(`SELECT 1 FROM journal_admin WHERE action = 'Données de formation générées' AND etablissement_id = $1`, [eRec.id])).rows[0]);
    for (const e of ['production', 'demo']) {
      enEnv(e);
      const r = await appel(null, 'POST', '/sh/formation/generer', { code: 'HOP-C4', par: 'test' }, { 'X-SH-Key': cle });
      assert.strictEqual(r.statut, 403, `générateur refusé en ${e}`);
      assert.strictEqual(r.corps.code, 'formation_recette_seulement');
    }
    enEnv('recette');

    // 2. Parcours de formation : l'étape Formation se coche rôle par rôle
    let f = (await sh('GET', `/hopitaux/${h.id}`)).corps;
    assert.deepStrictEqual(f.formation.map((r) => r.role), ['coordination', 'urgence', 'entretien', 'administration']);
    const element = (code) => f.etapes.flatMap((x) => x.verifications).find((x) => x.code === code);
    assert.strictEqual((await sh('PUT', `/verifications/${element('formation_entretien').id}`, { faite: true })).statut, 409, 'suit le parcours de formation');
    for (const el of f.formation.find((r) => r.role === 'entretien').elements) { const r = await sh('PUT', `/formation/${el.id}`, { faite: true }); assert.strictEqual(r.statut, 200, JSON.stringify(r.corps)); }
    assert.strictEqual((await sh('PUT', `/hopitaux/${h.id}/formation/entretien`, { seance_le: '2026-11-10', formateur: 'Moustafa', personnes: 6 })).statut, 200);
    f = (await sh('GET', `/hopitaux/${h.id}`)).corps;
    assert.ok(element('formation_entretien').faite, JSON.stringify(f.etapes[4].verifications.map((v) => [v.code, v.faite])));
    assert.ok(!element('formation_coordination').faite, JSON.stringify([element('formation_coordination'), (await pool.query('SELECT role, faite, count(*) FROM formation_elements WHERE hopital_id = $1 GROUP BY 1, 2', [h.id])).rows]));
    assert.strictEqual(f.formation.find((r) => r.role === 'entretien').personnes, 6);
    // Coordination seule ne suffit pas : l'urgence aussi
    for (const el of f.formation.find((r) => r.role === 'coordination').elements) await sh('PUT', `/formation/${el.id}`, { faite: true });
    f = (await sh('GET', `/hopitaux/${h.id}`)).corps;
    assert.ok(!element('formation_coordination').faite, JSON.stringify([element('formation_coordination'), (await pool.query('SELECT role, faite, count(*) FROM formation_elements WHERE hopital_id = $1 GROUP BY 1, 2', [h.id])).rows]));
    for (const el of f.formation.filter((r) => ['urgence', 'administration'].includes(r.role)).flatMap((r) => r.elements)) await sh('PUT', `/formation/${el.id}`, { faite: true });
    f = (await sh('GET', `/hopitaux/${h.id}`)).corps;
    assert.ok(element('formation_coordination').faite && element('formation_admin').faite);
    // Décocher un élément décoche l'étape
    const un = f.formation[0].elements[0];
    await sh('PUT', `/formation/${un.id}`, { faite: false });
    f = (await sh('GET', `/hopitaux/${h.id}`)).corps;
    assert.ok(!element('formation_coordination').faite, JSON.stringify([element('formation_coordination'), (await pool.query('SELECT role, faite, count(*) FROM formation_elements WHERE hopital_id = $1 GROUP BY 1, 2', [h.id])).rows]));
    await sh('PUT', `/formation/${un.id}`, { faite: true });

    // 3. Go-live : refusé tant que les étapes avant le go-live ne sont pas cochées
    assert.match((await sh('POST', `/hopitaux/${h.id}/golive`)).corps.erreur, /Go-live impossible/);
    f = (await sh('GET', `/hopitaux/${h.id}`)).corps;
    for (const x of f.etapes.filter((et) => et.rang < 6).flatMap((et) => et.verifications).filter((x) => !x.faite)) await sh('PUT', `/verifications/${x.id}`, { faite: true });
    f = (await sh('GET', `/hopitaux/${h.id}`)).corps;
    assert.strictEqual(f.golive.possible, true);
    // Les deux instances partagent ce processus de test : la production se comporte en production pendant le go-live
    enEnv('production');
    const g = await sh('POST', `/hopitaux/${h.id}/golive`);
    assert.strictEqual(g.statut, 200, JSON.stringify(g.corps));
    // Structure et comptes en production, nouveaux mots de passe ; aucune donnée de test
    assert.deepStrictEqual(g.corps.resultats.map((x) => [x.type, x.resume.creer]), [['unites', 2], ['chambres', 3], ['lits', 5], ['civieres', 3], ['utilisateurs', 2]]);
    assert.strictEqual(g.corps.comptes.length, 2);
    const eProd = (await poolProd.query(`SELECT id, module_actif, sous_domaine FROM etablissements WHERE code = 'HOP-C4'`)).rows[0];
    assert.deepStrictEqual([eProd.module_actif, eProd.sous_domaine], [false, 'hopital-c4'], 'production : créé inactif, avec son lien');
    const litsProd = (await poolProd.query('SELECT code, etat, patient_ref, isolement, telemetrie FROM lits WHERE etablissement_id = $1 ORDER BY code', [eProd.id])).rows;
    assert.strictEqual(litsProd.length, 5);
    assert.ok(litsProd.every((l) => l.etat === 'libre' && l.patient_ref == null), 'aucun patient de test en production');
    assert.deepStrictEqual(litsProd.filter((l) => l.isolement || l.telemetrie).map((l) => l.code), ['C4-101A', 'C4-102A'], 'équipement repris');
    assert.ok((await poolProd.query(`SELECT count(*)::int AS n FROM civieres WHERE etablissement_id = $1 AND etat = 'libre'`, [eProd.id])).rows[0].n === 3);
    assert.strictEqual((await poolProd.query('SELECT count(*)::int AS n FROM demandes_admission')).rows[0].n, 0);
    assert.strictEqual((await poolProd.query(`SELECT count(*)::int AS n FROM journal WHERE detail = 'Formation (données fictives)'`)).rows[0].n, 0);
    for (const c of g.corps.comptes) {
      const u = (await poolProd.query('SELECT mot_de_passe_hash, mdp_temporaire FROM utilisateurs WHERE email = $1', [c.courriel])).rows[0];
      assert.ok(u.mdp_temporaire && verifierMdp(c.mot_de_passe_temporaire, u.mot_de_passe_hash));
      const ancien = comptesRecette.find((x) => x.courriel === c.courriel).mot_de_passe_temporaire;
      assert.notStrictEqual(c.mot_de_passe_temporaire, ancien, 'nouveau mot de passe temporaire');
      assert.ok(!verifierMdp(ancien, u.mot_de_passe_hash));
    }
    f = (await sh('GET', `/hopitaux/${h.id}`)).corps;
    assert.strictEqual(f.environnement, 'production');
    assert.strictEqual(f.lien, 'https://hopital-c4.arrimo.exemple');
    assert.ok(element('production_importee').faite && !element('module_active').faite);
    assert.ok(f.golive_le && f.golive_par === 'sh@exemple.ca');
    assert.strictEqual(f.imports.filter((i) => i.environnement === 'production').length, 5);
    assert.strictEqual((await sh('POST', `/hopitaux/${h.id}/formation/generer`)).statut, 403, 'jamais de patients fictifs en production');
    assert.strictEqual((await sh('POST', `/hopitaux/${h.id}/golive`)).statut, 409, 'go-live une seule fois');
    // Activation en production
    assert.strictEqual((await sh('POST', `/hopitaux/${h.id}/activation`)).statut, 200);
    assert.strictEqual((await poolProd.query('SELECT module_actif FROM etablissements WHERE id = $1', [eProd.id])).rows[0].module_actif, true);

    // 4. Rapport de go-live en PDF
    const pdf = await fetch(`${baseSh}/api/hopitaux/${h.id}/rapport.pdf`, { headers: { Authorization: `Bearer ${jeton}` } });
    assert.strictEqual(pdf.headers.get('content-type'), 'application/pdf');
    const octets = Buffer.from(await pdf.arrayBuffer());
    assert.strictEqual(octets.subarray(0, 5).toString(), '%PDF-');
    assert.ok(octets.length > 5000);
    fs.mkdirSync(path.join(__dirname, '..', 'captures', 'sh'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '..', 'captures', 'sh', 'rapport-golive-complet.pdf'), octets);
    assert.match(octets.toString('latin1'), /\/Count [1-9]/);
    assert.ok((await sh('GET', '/journal')).corps.some((j) => j.action === 'Rapport de go-live téléchargé'));
    assert.ok((await sh('GET', '/journal')).corps.some((j) => j.action === 'Go-live' && /nouveaux comptes : 2/.test(j.detail)));
    // La console a son propre quota de requêtes (clé exacte) ; une fausse clé reste limitée comme un appel anonyme
    const rafale = await Promise.all(Array.from({ length: 150 }, () => fetch(`${base}/api/sh/etablissements`, { headers: { 'X-SH-Key': cle } }).then((r) => r.status)));
    assert.ok(rafale.every((x) => x === 200), 'console SH : pas bloquée à 120 requêtes par minute');
    const fausses = await Promise.all(Array.from({ length: 130 }, () => fetch(`${base}/api/sh/etablissements`, { headers: { 'X-SH-Key': 'x'.repeat(cle.length) } }).then((r) => r.status)));
    assert.ok(fausses.includes(429), 'fausse clé : limite anonyme');
  } finally {
    enEnv(avantEnv);
    serveurSh.close(); serveurProd.close();
    await poolProd.end();
    await pool.query('DROP SCHEMA IF EXISTS prod_c4 CASCADE');
    await pool.query(`UPDATE etablissements SET actif = false, sous_domaine = NULL WHERE code = 'HOP-C4'`);
  }
});
