'use strict';
/**
 * Moteur commun, lot 0 (19 nov. 2026) : Horloge immuable, corrections tracées, lecture commune des demandes (5 circuits),
 * régions et direction régionale (sa région seulement), nouveaux types et modules « Bientôt » non activables, FR/EN complets.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');
const horloge = require('../src/horloge');
const motifs = require('../src/motifs');
const TE = require('../src/types-etablissement');

let pool; let serveur; let base; const tokens = {}; const ids = {};
async function appel(qui, methode, chemin, corps, entetes = {}) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${tokens[qui]}` } : {}), ...entetes },
    body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
async function connecter(q, email) {
  const r = await appel(null, 'POST', '/connexion', { email, mot_de_passe: MOT_DE_PASSE_DEMO });
  assert.strictEqual(r.statut, 200, `connexion ${q}`); tokens[q] = r.corps.token;
}
const etab = async (code) => (await pool.query('SELECT id FROM etablissements WHERE code = $1', [code])).rows[0].id;

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  process.env.SH_API_KEY = `test-${require('crypto').randomBytes(16).toString('hex')}`;
  pool = creerPool(process.env.TEST_DATABASE_URL);
  await viderBase(pool);
  await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool));
  base = `http://127.0.0.1:${serveur.address().port}`;
  ids.mb = await etab('MB'); ids.sl = await etab('SL'); ids.lm = await etab('LM');
  ids.r05 = (await pool.query("SELECT id FROM regions WHERE code = 'CA-QC-05'")).rows[0].id;
  ids.r06 = (await pool.query("SELECT id FROM regions WHERE code = 'CA-QC-06'")).rows[0].id;
  await pool.query('UPDATE etablissements SET region_id = $1 WHERE id IN ($2, $3)', [ids.r05, ids.mb, ids.sl]);
  await pool.query('UPDATE etablissements SET region_id = $1 WHERE id = $2', [ids.r06, ids.lm]);
  const cfg = (await pool.query('SELECT config_id FROM etablissements WHERE id = $1', [ids.mb])).rows[0].config_id;
  ids.amb = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id, region_id) VALUES ('AMB-T', 'Ambulances fictives', 'ambulancier', '{ambulance}', $1, $2) RETURNING id", [cfg, ids.r05])).rows[0].id;
  ids.u1 = (await pool.query("INSERT INTO unites_secours (organisation_id, numero) VALUES ($1, '05-01') RETURNING id", [ids.amb])).rows[0].id;
  ids.dir = (await pool.query("INSERT INTO directions_regionales (code, nom, region_id) VALUES ('DR-05', 'Direction fictive de l’Estrie', $1) RETURNING id", [ids.r05])).rows[0].id;
  ids.udir = (await pool.query("INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ('dr@demo.arrimo', 'Direction fictive', $1, 'direction_regionale') RETURNING id", [hacher(MOT_DE_PASSE_DEMO)])).rows[0].id;
  await pool.query('INSERT INTO utilisateur_directions VALUES ($1, $2)', [ids.udir, ids.dir]);
  ids.tremblay = (await pool.query("SELECT id FROM utilisateurs WHERE email = 'tremblay@demo.arrimo'")).rows[0].id;
  await connecter('dr', 'dr@demo.arrimo'); await connecter('tremblay', 'tremblay@demo.arrimo');
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('Horloge : marquage idempotent, ligne immuable, correction = nouvelle ligne avec auteur et motif fermé', async () => {
  const c = await pool.connect();
  try {
    const h = new Date(Date.now() - 10 * 60000);
    const a = await horloge.marquer(c, { objet: 'prealerte', objetId: 1, etape: 'H11', heure: h, source: 'position' });
    const b = await horloge.marquer(c, { objet: 'prealerte', objetId: 1, etape: 'H11', heure: new Date(), source: 'clic' });
    assert.strictEqual(b.deja, true); assert.strictEqual(String(b.id), String(a.id));
    await assert.rejects(c.query('UPDATE horodatages SET heure = now() WHERE id = $1', [a.id]), /ne peut pas être modifié/);
    await assert.rejects(c.query('DELETE FROM horodatages WHERE id = $1', [a.id]), /ne peut pas être modifié/);
    await assert.rejects(c.query('TRUNCATE horodatages'), /ne peut pas être modifié/);
    await assert.rejects(horloge.corriger(c, { objet: 'prealerte', objetId: 1, etape: 'H11', heure: h, motif: 'parce que', auteurId: ids.tremblay }), { code: 'motif_correction_invalide' });
    await assert.rejects(horloge.corriger(c, { objet: 'prealerte', objetId: 1, etape: 'H11', heure: h, motif: 'oubli' }), { code: 'auteur_obligatoire' });
    await assert.rejects(horloge.marquer(c, { objet: 'prealerte', objetId: 1, etape: 'H12', heure: new Date(Date.now() + 3600000) }), { code: 'heure_future' });
    await assert.rejects(horloge.marquer(c, { objet: 'prealerte', objetId: 1, etape: 'H99' }), { code: 'parametre_invalide' });
    const h2 = new Date(Date.now() - 12 * 60000);
    const corr = await horloge.corriger(c, { objet: 'prealerte', objetId: 1, etape: 'H11', heure: h2, motif: 'position_imprecise', auteurId: ids.tremblay });
    assert.strictEqual(String(corr.remplace_id), String(a.id)); assert.strictEqual(corr.source, 'correction');
    assert.strictEqual(new Date(corr.heure_detectee).getTime(), h.getTime(), 'l’heure détectée reste visible pour le contrôle des écarts');
    assert.strictEqual(horloge.ecartMinutes(corr), -2);
    const courantes = await horloge.lire(c, 'prealerte', 1);
    assert.strictEqual(new Date(courantes.H11.heure).getTime(), h2.getTime());
    assert.strictEqual((await horloge.lire(c, 'prealerte', 1, { historique: true })).length, 2, 'rien n’est effacé');
    // La base refuse une correction sans motif, même en accès direct
    await assert.rejects(c.query("INSERT INTO horodatages (objet, objet_id, etape, heure, source) VALUES ('prealerte', 1, 'H12', now(), 'correction')"));
  } finally { c.release(); }
});

test('Demandes : la vue commune lit les 5 circuits, sans fusion, avec échéance et retard', async () => {
  const cfgTypes = (await pool.query('SELECT id FROM types_unite LIMIT 1')).rows[0].id;
  await pool.query(`INSERT INTO transferts (numero, patient_ref, origine_id, destination_id, type_id, statut, date_demande) VALUES ('TR-T1', 'P-00001', $1, $2, $3, 'demande', now() - interval '5 hours')`, [ids.lm, ids.mb, cfgTypes]);
  const pa = (await pool.query(`INSERT INTO prealertes (numero, organisation_id, unite_id, destination_id, priorite, categorie) VALUES ('PA-T1', $1, $2, $3, 'urgente', 'medicale') RETURNING id`, [ids.amb, ids.u1, ids.mb])).rows[0].id;
  await pool.query(`INSERT INTO missions_ccs (numero, unite_id, lieu, priorite, categorie) VALUES ('MC-T1', $1, 'Repère fictif', 'urgente', 'medicale')`, [ids.u1]);
  await pool.query(`INSERT INTO demandes_hebergement (etablissement_id, numero, provenance, hopital_id) VALUES ($1, 'DH-T1', 'hopital', $2)`, [ids.sl, ids.mb]);
  const circuits = (await pool.query('SELECT DISTINCT circuit FROM v_demandes')).rows.map((r) => r.circuit).sort();
  for (const c of ['hebergement', 'mission_ccs', 'prealerte', 'transfert']) assert.ok(circuits.includes(c), c);
  assert.ok((await pool.query("SELECT 1 FROM pg_views WHERE viewname = 'v_demandes' AND definition ILIKE '%demandes_transport%'")).rowCount, 'transport lu par la vue');
  const v = (await pool.query("SELECT * FROM v_demandes WHERE numero = 'TR-T1'")).rows[0];
  assert.strictEqual(v.statut, 'en_attente'); assert.ok(new Date(v.echeance_le) < new Date(), 'échéance de 2 h dépassée');
  const r = await appel('tremblay', 'GET', '/demandes');
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  assert.ok(r.corps.some((d) => d.numero === 'TR-T1' && d.en_retard));
  assert.ok(!JSON.stringify(r.corps).includes('P-00001'), 'aucune référence patient dans la lecture commune');
  assert.strictEqual(pa > 0, true);
});

test('Direction régionale : sa région seulement, en lecture ; aucun lit, patient ni résident', async () => {
  const r = await appel('dr', 'GET', '/direction/region');
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  const codes = r.corps.etablissements.map((e) => e.code);
  assert.ok(codes.includes('MB') && codes.includes('SL')); assert.ok(!codes.includes('LM'), 'autre région invisible');
  assert.deepStrictEqual(r.corps.organisations.map((o) => o.code), ['AMB-T']);
  const d = (await appel('dr', 'GET', '/demandes')).corps.map((x) => x.numero);
  assert.ok(d.includes('PA-T1') && d.includes('DH-T1') && d.includes('TR-T1'), 'demandes touchant sa région');
  for (const [m, ch] of [['GET', '/lits'], ['GET', '/patients/recherche?q=P'], ['GET', '/chsld/residents'], ['GET', '/journal'], ['POST', '/transferts']]) {
    assert.strictEqual((await appel('dr', m, ch, m === 'POST' ? {} : undefined)).statut, 403, ch);
  }
  // Un autre rôle n'obtient pas de région
  assert.strictEqual((await appel('tremblay', 'GET', '/direction/region')).statut, 403);
});

test('SH : régions, direction régionale et région d’un établissement réglées par la clé SH, journalisées', async () => {
  const cle = { 'x-sh-key': process.env.SH_API_KEY };
  assert.strictEqual((await appel(null, 'POST', '/sh/directions-regionales', { code: 'DR-06', nom: 'X', region_code: 'CA-QC-06' })).statut, 401);
  let r = await appel(null, 'POST', '/sh/directions-regionales', { code: 'DR-06', nom: 'Direction fictive de Montréal', region_code: 'CA-QC-06', par: 'test' }, cle);
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  assert.strictEqual((await appel(null, 'POST', '/sh/directions-regionales', { code: 'DR-99', nom: 'Inconnue', region_code: 'CA-QC-99' }, cle)).corps.code, 'region_inconnue');
  r = await appel(null, 'GET', '/sh/regions?pays=CA', null, cle); assert.strictEqual(r.corps.length, 18);
  r = await appel(null, 'PUT', '/sh/etablissements/LM', { region_code: 'CA-QC-05', langue: 'en', par: 'test' }, cle);
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  assert.deepStrictEqual((await pool.query('SELECT region_id, langue FROM etablissements WHERE id = $1', [ids.lm])).rows[0], { region_id: ids.r05, langue: 'en' });
  assert.ok((await pool.query("SELECT 1 FROM journal_admin WHERE action = 'Direction régionale enregistrée'")).rowCount);
  await pool.query('UPDATE etablissements SET region_id = $1 WHERE id = $2', [ids.r06, ids.lm]);
});

test('Modules du chantier : « Bientôt », jamais activables ; nouveaux types locaux ; tout est traduit', () => {
  // Chrono livré le 19 nov. 2026 : disponible et activable ; les autres restent « Bientôt »
  const chrono = TE.MODULES.find((x) => x.code === 'chrono');
  assert.strictEqual(chrono.statut, 'disponible'); assert.deepStrictEqual(TE.drapeauxDepuisChoix('hopital', { chrono: true }), { chrono: true });
  assert.strictEqual(TE.moduleActif({ type_etablissement: 'hopital', modules: { chrono: true } }, 'chrono'), true);
  for (const code of [ 'visites_confirmees', 'eviter_transferts']) {
    const m = TE.MODULES.find((x) => x.code === code);
    assert.ok(m, code); assert.strictEqual(m.statut, 'a_venir', code);
    assert.ok(m.nom && m.nom_en && m.note && m.note_en, `traduction complète : ${code}`);
    assert.throws(() => TE.drapeauxDepuisChoix(m.types[0], { [code]: true }), { code: 'module_non_disponible' }, code);
    assert.strictEqual(TE.moduleActif({ type_etablissement: m.types[0], modules: { [m.drapeau]: true } }, code), false, code);
  }
  for (const t of ['soins_palliatifs', 'hospitalisation_domicile', 'sante_mentale']) {
    assert.ok(TE.TYPES_LOCAUX[t].court && TE.TYPES_LOCAUX[t].court_en, t);
  }
  for (const m of TE.MODULES) assert.ok(m.nom_en, `nom anglais : ${m.code}`);
  for (const [code, l] of Object.entries(motifs.MOTIFS)) assert.ok(l.fr && l.en && l.fr !== '' && l.en !== '', code);
  for (const codes of Object.values(motifs.PAR_CIRCUIT)) for (const c of codes) assert.ok(motifs.MOTIFS[c], `motif sans libellé : ${c}`);
});

test('Transport : type de véhicule et nouveaux états acceptés par la base', async () => {
  await pool.query("UPDATE unites_secours SET type_vehicule = 'transport_adapte' WHERE id = $1", [ids.u1]);
  for (const etat of ['en_preparation', 'desinfection']) {
    await pool.query(`INSERT INTO etats_vehicules (unite_id, etat) VALUES ($1, $2) ON CONFLICT (unite_id) DO UPDATE SET etat = EXCLUDED.etat`, [ids.u1, etat]);
  }
  await assert.rejects(pool.query("UPDATE unites_secours SET type_vehicule = 'fusee' WHERE id = $1", [ids.u1]));
});

test('Anglais : chaque message d’erreur du serveur a sa traduction anglaise (échoue s’il en manque une)', () => {
  const vm = require('node:vm'); const fs = require('node:fs');
  const c = { window: {} }; vm.createContext(c); vm.runInContext(fs.readFileSync(require.resolve('../public/i18n/en.js'), 'utf8'), c);
  const en = c.window.ARRIMO_I18N.en.erreurs;
  const codes = [...fs.readFileSync(require.resolve('../src/erreurs.js'), 'utf8').matchAll(/^\s+([a-z_0-9]+):\s*['"]/gm)].map((x) => x[1]);
  assert.ok(codes.length > 400);
  assert.deepStrictEqual(codes.filter((x) => !(x in en)), []);
});

test('Anglais : courriels dans la langue du destinataire (choisie, sinon celle de son établissement), jamais celle de la requête', async () => {
  const courriel = require('../src/courriel'); const envoyes = [];
  courriel.definirTransport(async (m) => { envoyes.push(m); });
  try {
    await pool.query("UPDATE utilisateurs SET langue_interface = 'en' WHERE email = 'tremblay@demo.arrimo'");
    await require('../src/motdepasse').demander(pool, 'tremblay@demo.arrimo', 'fr');
    await new Promise((r) => setTimeout(r, 50));
    assert.match(envoyes.at(-1).sujet, /Reset your password/);
    await pool.query("UPDATE utilisateurs SET langue_interface = NULL WHERE email = 'tremblay@demo.arrimo'");
    await pool.query("UPDATE etablissements SET langue = 'en' WHERE id IN (SELECT etablissement_id FROM utilisateur_etablissements ue JOIN utilisateurs u ON u.id = ue.utilisateur_id WHERE u.email = 'tremblay@demo.arrimo')");
    const u = (await pool.query("SELECT id FROM utilisateurs WHERE email = 'tremblay@demo.arrimo'")).rows[0].id;
    assert.strictEqual(await require('../src/motdepasse').langueDe(pool, u), 'en', 'sans choix ni demande : langue de l’établissement (invitation)');
    assert.strictEqual(await require('../src/motdepasse').langueDe(pool, u, 'fr'), 'fr', 'mot de passe oublié : langue de la demande avant celle de l’établissement');
  } finally {
    courriel.definirTransport(null);
    await pool.query("UPDATE etablissements SET langue = 'fr'");
  }
});
