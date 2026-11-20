'use strict';
/**
 * Bourse des places (20 nov. 2026) : filtres, classement expliqué, NEUTRALITÉ (abonné et non abonné = même score, invité = même ordre),
 * nouveaux types, lien invité (refusé partout ailleurs, expiré ou révoqué refusé, courriel professionnel), fiche sans texte clinique,
 * proposition dans le groupe (l'hôpital garde la main), module non activé refusé, FR/EN.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');

let pool; let serveur; let base; const tokens = {}; const ids = {};
async function appel(qui, methode, chemin, corps, entetes = {}) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${tokens[qui]}` } : {}), ...entetes }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
async function connecter(q, email) { const r = await appel(null, 'POST', '/connexion', { email, mot_de_passe: MOT_DE_PASSE_DEMO }); assert.strictEqual(r.statut, 200, q); tokens[q] = r.corps.token; }

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const mb = (await pool.query("SELECT id, latitude, longitude, config_id FROM etablissements WHERE code = 'MB'")).rows[0]; ids.mb = mb.id;
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"bourse_places": true}' WHERE id = $1`, [mb.id]);
  ids.grp = (await pool.query("INSERT INTO groupes_ressources (code, nom) VALUES ('GRP-T', 'Groupe fictif') RETURNING id")).rows[0].id;
  const ressource = async (code, type, dLat, capacites, libres) => {
    const id = (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, module_actif, type_etablissement, type_local_code, groupe_id, modules)
      VALUES ($1, $2, 'Ville fictive', $3, $4, $5, true, 'chsld', $6, $7, '{"demandes_hebergement": true}') RETURNING id`, [code, `Ressource ${code}`, mb.latitude + dLat, mb.longitude, mb.config_id, type, ids.grp])).rows[0].id;
    await pool.query('INSERT INTO ressource_profils (etablissement_id, capacites, places_libres_declarees) VALUES ($1, $2, $3)', [id, capacites, libres]);
    return id;
  };
  ids.rpa = await ressource('R-RPA', 'rpa', 0.05, ['marchette'], 2);
  ids.pal = await ressource('R-PAL', 'soins_palliatifs', 0.3, ['marchette', 'fauteuil', 'oxygene'], 1);
  ids.sm = await ressource('R-SM', 'sante_mentale', 0.1, ['unite_securisee'], 3);
  await connecter('tremblay', 'tremblay@demo.arrimo'); await connecter('bouchard', 'bouchard@demo.arrimo');
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('classement expliqué : besoins couverts (60) + proximité (40), filtres par type, besoins et distance ; nouveaux types présents', async () => {
  assert.strictEqual((await appel('bouchard', 'GET', '/bourse?etablissement_id=' + (await pool.query("SELECT id FROM etablissements WHERE code = 'SL'")).rows[0].id)).corps.code, 'module_desactive');
  const r = (await appel('tremblay', 'GET', `/bourse?etablissement_id=${ids.mb}&besoins=fauteuil,oxygene`)).corps;
  assert.deepStrictEqual(r.formule, { besoins: 60, proximite: 40 });
  assert.strictEqual(r.places[0].id, ids.pal, 'tous les besoins couverts : premier malgré la distance');
  assert.strictEqual(r.places[0].raison.besoins_couverts, 2); assert.deepStrictEqual(r.places.find((p) => p.id === ids.rpa).raison.manquants, ['fauteuil', 'oxygene']);
  for (const g of ['soins_palliatifs', 'sante_mentale', 'hospitalisation_domicile']) assert.ok(r.genres.includes(g));
  assert.deepStrictEqual((await appel('tremblay', 'GET', `/bourse?etablissement_id=${ids.mb}&genre=sante_mentale`)).corps.places.map((p) => p.id), [ids.sm]);
  assert.ok(!(await appel('tremblay', 'GET', `/bourse?etablissement_id=${ids.mb}&distance_max=20`)).corps.places.some((p) => p.id === ids.pal));
  assert.strictEqual((await appel('tremblay', 'GET', `/bourse?etablissement_id=${ids.mb}&besoins=diagnostic`)).statut, 400);
});

test('neutralité : abonné ou non (module, licence) = même score et même ordre', async () => {
  const avant = (await appel('tremblay', 'GET', `/bourse?etablissement_id=${ids.mb}&besoins=marchette`)).corps.places.map((p) => [p.id, p.score]);
  await pool.query(`UPDATE etablissements SET modules = modules || '{"bourse_places": true, "chrono": true}' WHERE id = $1`, [ids.rpa]);
  await pool.query(`UPDATE etablissements SET modules = modules - 'demandes_hebergement' WHERE id = $1`, [ids.sm]);
  const apres = (await appel('tremblay', 'GET', `/bourse?etablissement_id=${ids.mb}&besoins=marchette`)).corps.places.map((p) => [p.id, p.score]);
  assert.deepStrictEqual(apres, avant);
  const src = require('node:fs').readFileSync(require.resolve('../src/bourse.js'), 'utf8');
  const sql = src.slice(src.indexOf('async function classer'), src.indexOf('async function places'));
  assert.doesNotMatch(sql, /modules|licence|abonnement|paiement|sh_/i, 'aucun champ commercial lu par le classement');
});

test('lien invité : courriel professionnel, même ordre que l’abonné, demande envoyée ; refusé partout ailleurs, révoqué ou expiré refusé', async () => {
  assert.strictEqual((await appel('tremblay', 'POST', '/bourse/invitations', { etablissement_id: ids.mb, nom: 'Invitée fictive', organisation: 'Clinique fictive', courriel: 'perso@gmail.com' })).corps.code, 'courriel_professionnel_requis');
  const i = await appel('tremblay', 'POST', '/bourse/invitations', { etablissement_id: ids.mb, nom: 'Invitée fictive', organisation: 'Clinique fictive', courriel: 'invitee@clinique.exemple' });
  assert.strictEqual(i.statut, 200, JSON.stringify(i.corps));
  const jeton = i.corps.lien.split('#')[1]; const h = { 'X-Invitation': jeton };
  assert.ok(!(await pool.query('SELECT 1 FROM bourse_invitations WHERE jeton_empreinte = $1', [jeton])).rowCount, 'seule l’empreinte est gardée');
  const vue = (await appel(null, 'GET', '/invite/bourse?besoins=marchette', null, h)).corps;
  const abonne = (await appel('tremblay', 'GET', `/bourse?etablissement_id=${ids.mb}&besoins=marchette`)).corps;
  assert.deepStrictEqual(vue.places.map((p) => [p.id, p.score]), abonne.places.map((p) => [p.id, p.score]), 'même ordre, même score');
  const d = await appel(null, 'POST', '/invite/bourse/demandes', { etablissement_id: ids.rpa, reference: 'EXT-1234' }, h);
  assert.strictEqual(d.statut, 200, JSON.stringify(d.corps));
  assert.strictEqual((await pool.query('SELECT provenance FROM demandes_hebergement WHERE id = $1', [d.corps.id])).rows[0].provenance, 'invite');
  // Le jeton n'ouvre rien d'autre
  for (const ch of ['/lits?etablissement_id=' + ids.mb, '/moi', '/bourse?etablissement_id=' + ids.mb]) assert.strictEqual((await appel(null, 'GET', ch, null, { ...h, Authorization: `Bearer ${jeton}` })).statut, 401, ch);
  assert.ok((await pool.query("SELECT 1 FROM journal_admin WHERE action = 'Bourse consultée par un invité'")).rowCount, 'usage journalisé');
  await appel('tremblay', 'POST', `/bourse/invitations/${i.corps.id}/revoquer`);
  assert.strictEqual((await appel(null, 'GET', '/invite/bourse', null, h)).statut, 401, 'révoqué');
  const i2 = await appel('tremblay', 'POST', '/bourse/invitations', { etablissement_id: ids.mb, nom: 'Autre invitée', organisation: 'Clinique fictive', courriel: 'autre@clinique.exemple' });
  await pool.query("UPDATE bourse_invitations SET cree_le = now() - interval '8 days', expire_le = now() - interval '1 day' WHERE id = $1", [i2.corps.id]);
  assert.strictEqual((await appel(null, 'GET', '/invite/bourse', null, { 'X-Invitation': i2.corps.lien.split('#')[1] })).statut, 401, 'expiré');
  assert.strictEqual((await appel(null, 'GET', '/invite/bourse', null, { 'X-Invitation': 'faux' })).statut, 401);
});

test('fiche d’une page sans texte clinique ; groupe : autre résidence proposée, l’hôpital averti garde la main', async () => {
  const lit = (await pool.query("SELECT id FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' AND patient_ref IS NOT NULL LIMIT 1", [ids.mb])).rows[0];
  await pool.query("UPDATE lits SET nsa_depuis = now() - interval '12 days', nsa_orientation = 'rpa' WHERE id = $1", [lit.id]);
  const f = (await appel('tremblay', 'GET', `/bourse/fiche/${lit.id}`)).corps;
  assert.strictEqual(f.jours_nsa, 12); assert.strictEqual(f.mention, 'sans_diagnostic');
  assert.deepStrictEqual(Object.keys(f).sort(), ['besoins', 'chambre_sexe', 'date_souhaitee', 'hopital', 'jours_nsa', 'langue', 'lit', 'mention', 'nsa_depuis', 'orientation', 'reference', 'tranche_age', 'ville']);
  // Demande refusée par la RPA : la ressource de santé mentale du même groupe est PROPOSÉE à l'hôpital
  const d = (await pool.query(`INSERT INTO demandes_hebergement (etablissement_id, numero, provenance, hopital_id, statut) VALUES ($1, 'DH-T9', 'hopital', $2, 'refusee') RETURNING id`, [ids.rpa, ids.mb])).rows[0];
  const u = (await pool.query("INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) SELECT 'coord.rpa@demo.arrimo', 'Coord RPA', mot_de_passe_hash, 'coordonnateur' FROM utilisateurs WHERE email = 'tremblay@demo.arrimo' RETURNING id")).rows[0].id;
  await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, ids.rpa]); await connecter('rpa', 'coord.rpa@demo.arrimo');
  const avant = (await pool.query('SELECT count(*)::int n FROM demandes_hebergement')).rows[0].n;
  const r = await appel('rpa', 'POST', `/bourse/demandes/${d.id}/proposer-groupe`, { etablissement_id: ids.sm });
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  assert.ok((await pool.query("SELECT 1 FROM notifications WHERE etablissement_id = $1 AND code = 'bourse_groupe_propose'", [ids.mb])).rowCount);
  assert.strictEqual((await pool.query('SELECT count(*)::int n FROM demandes_hebergement')).rows[0].n, avant, 'aucune demande créée sans l’hôpital');
  assert.strictEqual((await appel('rpa', 'POST', `/bourse/demandes/${d.id}/proposer-groupe`, { etablissement_id: ids.mb })).corps.code, 'hors_groupe');
});

test('anglais : textes de la bourse, de la fiche et de la page invité complets en FR et EN', () => {
  const vm = require('node:vm'); const fs = require('node:fs');
  const c = { window: {} }; vm.createContext(c);
  for (const f of ['fr', 'en', 'aide.fr', 'aide.en']) vm.runInContext(fs.readFileSync(require.resolve(`../public/i18n/${f}.js`), 'utf8'), c);
  const { fr, en } = c.window.ARRIMO_I18N;
  const src = fs.readFileSync(require.resolve('../public/bourse.js'), 'utf8');
  const cles = [...new Set([...src.matchAll(/B\('([a-z_]+)'/g), ...src.matchAll(/t\('bourse\.([a-z_]+)'/g)].map((m) => m[1]))];
  for (const g of require('../src/bourse').GENRES) cles.push(`g_${g}`);
  for (const b of require('../src/nsa-besoins').CODES) cles.push(`b_${b}`);
  for (const a of ['moins_65', '65_74', '75_84', '85_plus']) cles.push(`age_${a}`);
  for (const k of ['reference', 'hopital', 'lit', 'orientation', 'jours_nsa', 'tranche_age', 'besoins', 'langue', 'date']) cles.push(`f_${k}`);
  for (const k of cles) { assert.ok(fr.bourse[k], `fr ${k}`); assert.ok(en.bourse[k], `en ${k}`); }
  assert.ok(fr.aide.ecrans.bourse && en.aide.ecrans.bourse);
  const inv = fs.readFileSync(require.resolve('../public/bourse-invite.js'), 'utf8');
  const bloc = (l) => inv.slice(inv.indexOf(`${l}: {`), inv.indexOf(l === 'fr' ? 'en: {' : '};'));
  const k = (x) => [...x.matchAll(/(\w+): '/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(k(bloc('fr')), k(bloc('en')));
});
