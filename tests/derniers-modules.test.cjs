'use strict';
/**
 * Derniers modules du cahier (21 nov. 2026) : Visites confirmées, Éviter les transferts inutiles, lecteur du fichier horaire du MSSS.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');
const visites = require('../src/visites');
const msss = require('../src/msss-urgences');

let pool; let serveur; let base; const tokens = {}; const ids = {};
async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${tokens[qui]}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  const texte = await r.text(); let c; try { c = JSON.parse(texte); } catch { c = texte; }
  return { statut: r.status, corps: c };
}
async function compte(cle, role, { etab, org } = {}) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [`${cle}@demo.arrimo`, cle, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (etab) await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etab]);
  if (org) await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, org]);
  const r = await appel(null, 'POST', '/connexion', { email: `${cle}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO }); tokens[cle] = r.corps.token; assert.ok(tokens[cle], cle);
  return u;
}
const dans = (min) => new Date(Date.now() + min * 60000).toISOString();

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const mb = (await pool.query("SELECT latitude, longitude, config_id FROM etablissements WHERE code = 'MB'")).rows[0]; ids.pos = mb;
  ids.rpa = (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, module_actif, type_etablissement, type_local_code, modules)
    VALUES ('RPA-V', 'RPA fictive des Visites', 'Ville', $1, $2, $3, true, 'chsld', 'rpa', '{"visites_confirmees": true, "eviter_transferts": true}') RETURNING id`, [mb.latitude, mb.longitude, mb.config_id])).rows[0].id;
  ids.res = (await pool.query("INSERT INTO residents (etablissement_id, reference, prenom, nom, date_naissance, statut) VALUES ($1, 'R-77001', 'Rose', 'Fictive', '1938-02-02', 'present') RETURNING id", [ids.rpa])).rows[0].id;
  const org = async (code) => (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ($1, $1, 'prestataire', '{visites}', $2) RETURNING id", [code, mb.config_id])).rows[0].id;
  ids.clsc = await org('CLSC-T'); ids.autre = await org('PREST-T');
  await compte('coord.rpa', 'coordonnateur', { etab: ids.rpa }); await compte('admin.rpa', 'admin_etab', { etab: ids.rpa });
  await compte('interv', 'intervenant', { org: ids.clsc }); await compte('interv2', 'intervenant', { org: ids.autre });
});
test.after(async () => { serveur?.close(); await pool?.end(); msss.definirFetchTest(null); });

test('visites : série planifiée, le prestataire voit la référence seulement, arrivée et départ au clic, autre prestataire isolé', async () => {
  const p = await appel('coord.rpa', 'POST', '/visites', { etablissement_id: ids.rpa, resident_id: ids.res, prestataire_id: ids.clsc, type_visite: 'aide_hygiene',
    debut_prevu: dans(-10), fin_prevue: dans(50), recurrence: 'hebdomadaire', occurrences: 3 });
  assert.strictEqual(p.statut, 200, JSON.stringify(p.corps)); assert.strictEqual(p.corps.length, 3); ids.v1 = p.corps[0].id; ids.v2 = p.corps[1].id;
  const mien = (await appel('interv', 'GET', '/visites?jours=1')).corps;
  assert.ok(mien.some((v) => v.id === ids.v1)); assert.ok(!JSON.stringify(mien).includes('Fictive'), 'jamais le nom chez le prestataire');
  assert.strictEqual((await appel('interv2', 'GET', '/visites?jours=1')).corps.length, 0);
  assert.strictEqual((await appel('interv2', 'POST', `/visites/${ids.v1}/pointer`, { etape: 'arrivee' })).statut, 404);
  assert.strictEqual((await appel('interv', 'GET', '/lits?etablissement_id=1')).statut, 403, 'rôle limité à ses visites');
  assert.strictEqual((await appel('interv', 'POST', `/visites/${ids.v1}/pointer`, { etape: 'depart' })).corps.code, 'visite_statut');
  const a = await appel('interv', 'POST', `/visites/${ids.v1}/pointer`, { etape: 'arrivee' });
  assert.strictEqual(a.corps.statut, 'en_cours'); assert.strictEqual(a.corps.source, 'clic');
  assert.strictEqual((await appel('interv', 'POST', `/visites/${ids.v1}/pointer`, { etape: 'depart' })).corps.statut, 'terminee');
  const r = (await appel('coord.rpa', 'GET', `/visites?etablissement_id=${ids.rpa}&jours=1`)).corps.find((v) => v.id === ids.v1);
  assert.ok(r.arrivee_le && r.depart_le); assert.strictEqual(r.nom, 'Fictive', 'le nom reste dans la résidence');
});

test('visites : la position n’est utilisée qu’avec consentement, pendant la plage et autour de la résidence', async () => {
  const p = (await appel('coord.rpa', 'POST', '/visites', { etablissement_id: ids.rpa, resident_id: ids.res, prestataire_id: ids.clsc, type_visite: 'medication', debut_prevu: dans(-5), fin_prevue: dans(40) })).corps[0];
  const loin = { latitude: ids.pos.latitude + 0.05, longitude: ids.pos.longitude };
  assert.strictEqual((await appel('interv', 'POST', `/visites/${p.id}/pointer`, { etape: 'arrivee', ...ids.pos })).corps.code, 'consentement_position_requis');
  assert.strictEqual((await appel('interv', 'POST', `/visites/${p.id}/pointer`, { etape: 'arrivee', ...loin, consentement: true })).corps.code, 'position_hors_zone');
  const a = await appel('interv', 'POST', `/visites/${p.id}/pointer`, { etape: 'arrivee', latitude: ids.pos.latitude, longitude: ids.pos.longitude, consentement: true });
  assert.strictEqual(a.corps.source, 'position');
  assert.ok(!(await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'visites' AND column_name LIKE '%latitude%'")).rowCount, 'position jamais conservée');
});

test('visite manquée : signalée à la résidence, soins donnés à la place (catégorie fermée), rapport mensuel et CSV', async () => {
  await pool.query("UPDATE visites SET debut_prevu = now() - interval '3 hours', fin_prevue = now() - interval '2 hours' WHERE id = $1", [ids.v2]);
  assert.ok(await visites.manquees(pool) >= 1);
  assert.strictEqual((await pool.query('SELECT statut FROM visites WHERE id = $1', [ids.v2])).rows[0].statut, 'manquee');
  assert.ok((await pool.query("SELECT 1 FROM notifications WHERE etablissement_id = $1 AND code = 'visite_manquee'", [ids.rpa])).rowCount);
  assert.strictEqual((await appel('coord.rpa', 'POST', `/visites/${ids.v2}/residence`, { action: 'soin_rpa', soin: 'diagnostic libre' })).statut, 400);
  assert.strictEqual((await appel('coord.rpa', 'POST', `/visites/${ids.v2}/residence`, { action: 'soin_rpa', soin: 'aide_hygiene' })).corps.soin_rpa, 'aide_hygiene');
  const r = (await appel('coord.rpa', 'GET', `/visites/rapport?etablissement_id=${ids.rpa}`)).corps;
  assert.ok(r.total.manquees >= 1 && r.total.faites >= 2 && r.total.soins_rpa === 1, JSON.stringify(r.total));
  assert.match((await appel('coord.rpa', 'GET', `/visites/rapport.csv?etablissement_id=${ids.rpa}`)).corps, /Résidence;Prestataire;Type de visite;Prévues;Faites;Manquées/);
  assert.strictEqual((await appel('interv', 'GET', '/visites/rapport')).corps.total.prevues >= 3, true, 'rapport du prestataire');
  await pool.query(`UPDATE etablissements SET modules = modules - 'visites_confirmees' WHERE id = $1`, [ids.rpa]);
  assert.strictEqual((await appel('coord.rpa', 'GET', `/visites?etablissement_id=${ids.rpa}`)).corps.code, 'module_desactive');
  await pool.query(`UPDATE etablissements SET modules = modules || '{"visites_confirmees": true}' WHERE id = $1`, [ids.rpa]);
});

test('éviter les transferts : liste de l’établissement, jamais bloquante ; décisions comptées ; aucune donnée clinique', async () => {
  let l = (await appel('coord.rpa', 'GET', `/eviter?etablissement_id=${ids.rpa}`)).corps;
  assert.deepStrictEqual(l.verifications, [], 'Arrimo n’écrit aucune liste lui-même');
  assert.strictEqual((await appel('coord.rpa', 'PUT', '/eviter', { etablissement_id: ids.rpa, version: 0, verifications: ['x'] })).statut, 200, 'coordination autorisée');
  const r = await appel('admin.rpa', 'PUT', '/eviter', { etablissement_id: ids.rpa, version: 1, verifications: ['Vérification 1 du protocole', 'Vérification 2'], alternatives: [{ code: 'medecin_garde', contact: '555-0100' }, { code: 'info_sante' }] });
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps));
  assert.strictEqual((await appel('admin.rpa', 'PUT', '/eviter', { etablissement_id: ids.rpa, version: 1, verifications: [] })).corps.code, 'version_perimee');
  assert.strictEqual((await appel('coord.rpa', 'POST', '/eviter/decisions', { etablissement_id: ids.rpa, decision: 'transfert_evite' })).statut, 400, 'alternative exigée');
  assert.strictEqual((await appel('coord.rpa', 'POST', '/eviter/decisions', { etablissement_id: ids.rpa, decision: 'transfert_evite', alternative: 'medecin_garde', resident_ref: 'R-77001' })).statut, 200);
  assert.strictEqual((await appel('coord.rpa', 'POST', '/eviter/decisions', { etablissement_id: ids.rpa, decision: 'transfert_fait', resident_ref: 'chute ce matin' })).statut, 400, 'jamais un texte clinique');
  await appel('coord.rpa', 'POST', '/eviter/decisions', { etablissement_id: ids.rpa, decision: 'transfert_fait' });
  l = (await appel('coord.rpa', 'GET', `/eviter?etablissement_id=${ids.rpa}`)).corps;
  assert.deepStrictEqual([l.mois.evites, l.mois.faits], [1, 1]); assert.strictEqual(l.alternatives.length, 2);
});

test('lecteur MSSS : format officiel (latin-1, « ; »), lignes de total ignorées, occupation seulement, source citée ; échec journalisé', async () => {
  const csv = 'RSS;Region;Nom_etablissement;Nom_installation;No_permis_installation;Nombre_de_civieres_fonctionnelles;Nombre_de_civieres_occupees;Nombre_de_patients_sur_civiere_plus_de_24_heures;Nombre_de_patients_sur_civiere_plus_de_48_heures;Heure_de_l\'extraction_(image);Mise_a_jour\r\n'
    + '06;Montréal;CIUSSS fictif;Hôpital fictif Ouest;12345678;40;52;10;3;2026-11-21 08:00;2026-11-21 08:45\r\n'
    + '06;Montréal;CIUSSS fictif;Hôpital fictif Est;87654321;30;20;1;0;2026-11-21 08:00;2026-11-21 08:45\r\n'
    + '06;Montréal;Total régional;Total régional;;70;72;11;3;2026-11-21 08:00;2026-11-21 08:45\r\n';
  const octets = Buffer.from(csv, 'latin1');
  const lignes = msss.analyser(octets);
  assert.strictEqual(lignes.length, 2); assert.strictEqual(lignes[0].installation, 'Hôpital fictif Ouest'); assert.strictEqual(lignes[0].civieres_occupees, 52);
  assert.strictEqual((await msss.lire(pool)).statut, 'desactive', 'désactivé par défaut');
  process.env.ARRIMO_MSSS_URGENCES = '1';
  try {
    msss.definirFetchTest(async () => ({ ok: true, arrayBuffer: async () => octets }));
    assert.deepStrictEqual(await msss.lire(pool), { statut: 'ok', lignes: 2 });
    const mb = (await pool.query("SELECT id FROM etablissements WHERE code = 'MB'")).rows[0].id;
    await pool.query("INSERT INTO correspondances_urgences_publiques VALUES ('87654321', $1)", [mb]);
    const autres = await msss.autresUrgences(pool);
    assert.deepStrictEqual(autres.map((a) => a.installation), ['Hôpital fictif Ouest'], 'une urgence branchée sur Arrimo n’est pas doublée');
    assert.strictEqual(autres[0].taux_occupation, 130); assert.ok(!('etat' in autres[0]), 'jamais un état « fermé » déduit');
    const avant = process.env.ARRIMO_ENV; process.env.ARRIMO_ENV = 'demo'; require('../src/urgences-direct').viderCache();
    const pub = await (await fetch(`${base}/api/public/v1/urgences`)).json();
    assert.match(pub.autres_urgences.source, /Données Québec, licence CC-BY 4\.0/); assert.strictEqual(pub.autres_urgences.occupation_seulement, true);
    process.env.ARRIMO_ENV = avant; require('../src/urgences-direct').viderCache();
    msss.definirFetchTest(async () => ({ ok: false, status: 403 }));
    assert.strictEqual((await msss.lire(pool)).statut, 'echec');
    assert.strictEqual((await pool.query('SELECT count(*)::int n FROM urgences_publiques_msss')).rows[0].n, 2, 'la dernière lecture réussie est gardée');
    assert.ok((await pool.query("SELECT 1 FROM lectures_msss WHERE statut = 'echec' AND detail = 'HTTP 403'")).rowCount);
  } finally { delete process.env.ARRIMO_MSSS_URGENCES; }
});

test('anglais : visites, « avant l’appel », page de l’intervenant et page publique complets en FR et EN', () => {
  const vm = require('node:vm'); const fs = require('node:fs');
  const c = { window: {} }; vm.createContext(c);
  for (const f of ['fr', 'en', 'aide.fr', 'aide.en']) vm.runInContext(fs.readFileSync(require.resolve(`../public/i18n/${f}.js`), 'utf8'), c);
  const { fr, en } = c.window.ARRIMO_I18N;
  const src = fs.readFileSync(require.resolve('../public/visites-eviter.js'), 'utf8');
  for (const [p, ns] of [[/V\('([a-z_]+)'/g, 'visites'], [/A\('([a-z_]+)'/g, 'eviter']]) for (const k of new Set([...src.matchAll(p)].map((m) => m[1]))) { assert.ok(fr[ns][k], `fr ${ns}.${k}`); assert.ok(en[ns][k], `en ${ns}.${k}`); }
  for (const t of visites.TYPES) { assert.ok(fr.visites[`t_${t}`] && en.visites[`t_${t}`]); }
  for (const a of require('../src/eviter-transferts').ALTERNATIVES) assert.ok(fr.eviter[`a_${a}`] && en.eviter[`a_${a}`], a);
  for (const k of ['visites', 'eviter']) assert.ok(fr.aide.ecrans[k] && en.aide.ecrans[k]);
  for (const f of ['../public/intervenant.js', '../public/urgences-direct.js']) {
    const s = fs.readFileSync(require.resolve(f), 'utf8');
    const bloc = (l) => s.slice(s.indexOf(`    ${l}: {`), s.indexOf(l === 'fr' ? '    en: {' : '  };'));
    const k = (x) => [...x.matchAll(/(\w+): '/g)].map((m) => m[1]).sort();
    assert.deepStrictEqual(k(bloc('fr')), k(bloc('en')), f);
  }
});
