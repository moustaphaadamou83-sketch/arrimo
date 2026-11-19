'use strict';
/**
 * Urgences en direct (20 nov. 2026) : fermeture planifiée → avis aux bons destinataires seulement (région, voisines), rappel,
 * début et fin à l'heure prévue, urgence fermée écartée du classement avec la raison (et service touché pour sa catégorie),
 * page publique et API (démonstration seulement, urgences consentantes seulement, aucune donnée interne, cache, limite de débit,
 * déclaration ancienne « non à jour »), FR/EN.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');
const ud = require('../src/urgences-direct');

let pool; let serveur; let base; const tokens = {}; const ids = {};
async function appel(qui, methode, chemin, corps, entetes = {}) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${tokens[qui]}` } : {}), ...entetes },
    body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
async function connecter(q, email) {
  const r = await appel(null, 'POST', '/connexion', { email, mot_de_passe: MOT_DE_PASSE_DEMO }); assert.strictEqual(r.statut, 200, q); tokens[q] = r.corps.token;
}
const dans = (min) => new Date(Date.now() + min * 60000).toISOString();

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const e = (await pool.query("SELECT id, code, config_id FROM etablissements WHERE COALESCE(type_etablissement, 'hopital') = 'hopital' ORDER BY id")).rows;
  ids.mb = e.find((x) => x.code === 'MB').id; ids.sl = e.find((x) => x.code === 'SL').id; ids.cfg = e[0].config_id;
  ids.hopitaux = e.map((x) => x.id);
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"liaison_secours": true}' WHERE id = ANY($1)`, [ids.hopitaux]);
  await pool.query(`UPDATE etablissements SET modules = modules || '{"urgences_direct": true}' WHERE id IN ($1, $2)`, [ids.mb, ids.sl]);   // seules MB et SL acceptent d'être publiées
  await pool.query('UPDATE config_pays SET voisins_avises = 2');
  const org = async (code, type, profils, cfg) => (await pool.query('INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ($1, $1, $2, $3, $4) RETURNING id', [code, type, profils, cfg])).rows[0].id;
  ids.amb = await org('AMB-UD', 'ambulancier', ['ambulance'], ids.cfg); ids.ccs = await org('CCS-UD', 'ccs', ['ccs'], ids.cfg);
  const autreCfg = (await pool.query("INSERT INTO config_pays (code, nom) VALUES ('XX-UD', 'Autre profil fictif') RETURNING id")).rows[0].id;
  ids.loin = await org('AMB-LOIN', 'ambulancier', ['ambulance'], autreCfg);
  ids.u1 = (await pool.query("INSERT INTO unites_secours (organisation_id, numero) VALUES ($1, '50-01') RETURNING id", [ids.amb])).rows[0].id;
  const u = (await pool.query("INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ('ccs.ud@demo.arrimo', 'CCS UD', $1, 'repartiteur') RETURNING id", [hacher(MOT_DE_PASSE_DEMO)])).rows[0].id;
  await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, ids.ccs]);
  await connecter('ccs', 'ccs.ud@demo.arrimo'); await connecter('tremblay', 'tremblay@demo.arrimo'); await connecter('bouchard', 'bouchard@demo.arrimo');
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('fermeture planifiée : contrôles, avis aux bons destinataires seulement (région, 2 urgences voisines), journal', async () => {
  const p = (b) => appel('tremblay', 'POST', '/urgences-direct/fermetures', { etablissement_id: ids.mb, ...b });
  assert.strictEqual((await p({ debut_le: dans(30), fin_prevue_le: dans(20), services: ['toute_urgence'] })).corps.code, 'fermeture_invalide');
  assert.strictEqual((await p({ debut_le: dans(30), fin_prevue_le: dans(90), services: ['radiologie'] })).corps.code, 'fermeture_invalide');
  const r = await p({ debut_le: dans(30), fin_prevue_le: dans(180), services: ['toute_urgence'] });
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps)); ids.f1 = r.corps.id;
  assert.deepStrictEqual(r.corps.avis, { etablissements: 2, organisations: 2 });
  assert.strictEqual((await p({ debut_le: dans(60), fin_prevue_le: dans(120), services: ['pediatrie'] })).corps.code, 'fermeture_chevauchement');
  const avis = (await pool.query("SELECT destinataire_type, destinataire_id FROM fermeture_avis WHERE fermeture_id = $1 AND type = 'annonce'", [ids.f1])).rows;
  assert.ok(!avis.some((a) => a.destinataire_type === 'organisation' && a.destinataire_id === ids.loin), 'organisation d’un autre profil : jamais prévenue');
  assert.ok(!avis.some((a) => a.destinataire_type === 'etablissement' && a.destinataire_id === ids.mb));
  const voisin = avis.find((a) => a.destinataire_type === 'etablissement').destinataire_id;
  assert.ok((await pool.query("SELECT 1 FROM notifications WHERE etablissement_id = $1 AND code = 'urgence_fermeture_annonce'", [voisin])).rowCount);
  assert.ok((await pool.query("SELECT 1 FROM journal WHERE etablissement_id = $1 AND action = 'Fermeture de l’urgence planifiée'", [ids.mb])).rowCount);
  // Un rôle sans droit de gestion de l'urgence (autre établissement) : refusé
  assert.strictEqual((await appel('bouchard', 'POST', '/urgences-direct/fermetures', { etablissement_id: ids.mb, debut_le: dans(300), fin_prevue_le: dans(400), services: ['imagerie'] })).statut, 403);
  // Le CCS voit la fermeture planifiée de sa région
  assert.ok((await appel('ccs', 'GET', '/secours/urgences-direct')).corps.fermetures.some((f) => f.id === ids.f1));
});

test('rappel 1 h avant, puis début à l’heure prévue : « fermée temporairement », écartée du classement avec la raison', async () => {
  await ud.echeances(pool);
  assert.ok((await pool.query("SELECT rappel_le FROM fermetures_urgence WHERE id = $1", [ids.f1])).rows[0].rappel_le, 'rappel envoyé');
  assert.ok((await pool.query("SELECT 1 FROM notifications WHERE etablissement_id = $1 AND code = 'urgence_fermeture_rappel_moi'", [ids.mb])).rowCount);
  await pool.query("UPDATE fermetures_urgence SET debut_le = now() - interval '1 minute' WHERE id = $1", [ids.f1]);
  await ud.echeances(pool);
  const e = (await pool.query('SELECT urgence_statut_declare, reouverture_prevue_le FROM etablissements WHERE id = $1', [ids.mb])).rows[0];
  assert.strictEqual(e.urgence_statut_declare, 'fermee_temporairement'); assert.ok(e.reouverture_prevue_le);
  const pos = (await pool.query('SELECT latitude, longitude FROM etablissements WHERE id = $1', [ids.mb])).rows[0];
  const c = (await appel('ccs', 'GET', `/secours/urgences-classees?latitude=${pos.latitude}&longitude=${pos.longitude}`)).corps;
  const mb = c.urgences.find((h) => h.id === ids.mb);
  assert.strictEqual(mb.ecartee.raison, 'fermee_temporairement'); assert.strictEqual(mb.rang, 4);
  assert.notStrictEqual(c.og?.id, ids.mb, 'l’urgence ouverte la plus proche est proposée, jamais la fermée');
  assert.strictEqual(c.urgences.at(-1).id, ids.mb, 'classée en dernier');
});

test('service touché : écartée pour sa catégorie seulement', async () => {
  const f = (await pool.query(`INSERT INTO fermetures_urgence (etablissement_id, debut_le, fin_prevue_le, services, statut) VALUES ($1, now() - interval '1 minute', now() + interval '2 hours', '{pediatrie}', 'en_cours') RETURNING id`, [ids.sl])).rows[0];
  const pos = (await pool.query('SELECT latitude, longitude FROM etablissements WHERE id = $1', [ids.sl])).rows[0];
  const ped = (await appel('ccs', 'GET', `/secours/urgences-classees?latitude=${pos.latitude}&longitude=${pos.longitude}&categorie=pediatrique`)).corps.urgences.find((h) => h.id === ids.sl);
  assert.strictEqual(ped.ecartee.raison, 'service_ferme');
  const card = (await appel('ccs', 'GET', `/secours/urgences-classees?latitude=${pos.latitude}&longitude=${pos.longitude}&categorie=cardiaque`)).corps.urgences.find((h) => h.id === ids.sl);
  assert.strictEqual(card.ecartee, undefined);
  ids.fSl = f.id;
});

test('page publique et API : démonstration seulement, urgences consentantes seulement, aucune donnée interne, « non à jour »', async () => {
  const avant = process.env.ARRIMO_ENV;
  try {
    for (const e of ['recette', 'production']) {
      process.env.ARRIMO_ENV = e;
      assert.strictEqual((await appel(null, 'GET', '/public/v1/urgences')).statut, 404, e);
      assert.strictEqual((await fetch(`${base}/urgences`)).status, 404, e);
    }
    process.env.ARRIMO_ENV = 'demo'; ud.viderCache();
    assert.strictEqual((await fetch(`${base}/urgences`)).status, 200);
    await pool.query("UPDATE etablissements SET urgence_statut_declare = 'ouvert', urgence_statut_le = now() - interval '3 hours' WHERE id = $1", [ids.sl]);
    const r = await fetch(`${base}/api/public/v1/urgences`);
    assert.strictEqual(r.status, 200); assert.match(r.headers.get('cache-control'), /max-age=60/);
    const d = await r.json();
    assert.strictEqual(d.version, 'v1'); assert.strictEqual(d.numero_urgence, '911'); assert.strictEqual(d.licence, 'CC-BY 4.0'); assert.ok(d.options.some((o) => o.code === '811'));
    assert.deepStrictEqual(d.urgences.map((u) => u.id).sort(), [ids.mb, ids.sl].sort(), 'seulement les urgences qui ont accepté');
    const mb = d.urgences.find((u) => u.id === ids.mb); const sl = d.urgences.find((u) => u.id === ids.sl);
    assert.strictEqual(mb.etat, 'fermee_temporairement'); assert.strictEqual(mb.a_jour, true); assert.ok(mb.reouverture_prevue_le);
    assert.strictEqual(sl.a_jour, false, 'déclaration de 3 h : non à jour');
    assert.deepStrictEqual(sl.services_touches, ['pediatrie']);
    const brut = JSON.stringify(d);
    for (const interdit of ['patient', 'civiere', 'P-0', 'modules', 'utilisateur', 'urgence_statut_par', 'email']) assert.ok(!brut.includes(interdit), interdit);
    // Limite de débit : 60 requêtes par minute et par adresse
    let dernier = 200;
    for (let i = 0; i < 65; i += 1) dernier = (await fetch(`${base}/api/public/v1/urgences`)).status;
    assert.strictEqual(dernier, 429);
  } finally { process.env.ARRIMO_ENV = avant; ud.viderCache(); }
});

test('fin à l’heure prévue : urgence rouverte (à confirmer), hôpital prévenu ; annulation d’une fermeture planifiée', async () => {
  await pool.query("UPDATE fermetures_urgence SET fin_prevue_le = now() - interval '1 minute' WHERE id = $1", [ids.f1]);
  await ud.echeances(pool);
  assert.strictEqual((await pool.query('SELECT urgence_statut_declare FROM etablissements WHERE id = $1', [ids.mb])).rows[0].urgence_statut_declare, 'ouvert');
  assert.ok((await pool.query("SELECT 1 FROM notifications WHERE etablissement_id = $1 AND code = 'urgence_fermeture_fin_moi'", [ids.mb])).rowCount);
  const r = await appel('tremblay', 'POST', '/urgences-direct/fermetures', { etablissement_id: ids.mb, debut_le: dans(600), fin_prevue_le: dans(700), services: ['imagerie'] });
  assert.strictEqual((await appel('tremblay', 'POST', `/urgences-direct/fermetures/${r.corps.id}/action`, { action: 'terminer' })).corps.code, 'fermeture_statut_incompatible');
  assert.strictEqual((await appel('tremblay', 'POST', `/urgences-direct/fermetures/${r.corps.id}/action`, { action: 'annuler' })).statut, 200);
  assert.ok((await pool.query("SELECT 1 FROM fermeture_avis WHERE fermeture_id = $1 AND type = 'annulation'", [r.corps.id])).rowCount);
});

test('fermée temporairement déclarée à la main : heure de réouverture exigée ; jamais « périmée » avant la réouverture', async () => {
  const d = (b) => appel('tremblay', 'POST', '/secours/urgence', { etablissement_id: ids.mb, ...b });
  assert.strictEqual((await d({ statut: 'fermee_temporairement' })).corps.code, 'reouverture_requise');
  assert.strictEqual((await d({ statut: 'fermee_temporairement', reouverture_prevue_le: dans(240) })).statut, 200);
  await pool.query("UPDATE etablissements SET urgence_statut_le = now() - interval '2 hours' WHERE id = $1", [ids.mb]);
  const s = (await appel('tremblay', 'GET', `/secours/urgence?etablissement_id=${ids.mb}`)).corps;
  assert.strictEqual(s.declaration.perime, false); assert.ok(s.declaration.reouverture_prevue_le);
  assert.ok(s.statuts.includes('fermee_temporairement'));
});

test('anglais : avis dans la langue du lecteur, textes de la page publique et de l’hôpital complets en FR et EN', async () => {
  const en = (await fetch(`${base}/api/notifications?etablissement_id=${ids.mb}`, { headers: { Authorization: `Bearer ${tokens.tremblay}`, 'X-Langue': 'en' } }));
  const liste = await en.json();
  const n = (Array.isArray(liste) ? liste : liste.notifications || []).find((x) => x.code === 'urgence_fermeture_fin_moi');
  assert.ok(n, 'avis présent'); assert.match(n.message, /End of the planned closure/);
  const fs = require('node:fs'); const vm = require('node:vm');
  const src = fs.readFileSync(require.resolve('../public/urgences-direct.js'), 'utf8');
  const fr = src.slice(src.indexOf('fr: {'), src.indexOf('en: {')); const enTxt = src.slice(src.indexOf('en: {'), src.indexOf('};'));
  const cles = (x) => [...x.matchAll(/(\w+): '/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(cles(fr), cles(enTxt));
  const c = { window: {} }; vm.createContext(c);
  for (const f of ['fr', 'en']) vm.runInContext(fs.readFileSync(require.resolve(`../public/i18n/${f}.js`), 'utf8'), c);
  for (const k of [...src.matchAll(/S\('([a-z_]+)'/g)].map((m) => m[1]).concat(['sv_toute_urgence', 'sv_pediatrie', 'fd_planifiee', 'fd_en_cours', 'st_fermee_temporairement'])) {
    assert.ok(c.window.ARRIMO_I18N.fr.liaison_secours[k] !== undefined || !k, `fr ${k}`);
  }
  const ls = fs.readFileSync(require.resolve('../public/liaison-secours.js'), 'utf8');
  for (const k of [...new Set([...ls.matchAll(/S\('((?:fd|sv|urg)_[a-z_]+)'/g)].map((m) => m[1]))]) {
    assert.ok(c.window.ARRIMO_I18N.fr.liaison_secours[k], `fr ${k}`); assert.ok(c.window.ARRIMO_I18N.en.liaison_secours[k], `en ${k}`);
  }
});
