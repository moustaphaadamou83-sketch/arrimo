'use strict';
/**
 * Mode crise (20 nov. 2026) : déclenchement réservé aux rôles autorisés (établissement, direction de sa région, coordination réseau),
 * proposition par résident (proximité), double réservation impossible, suivi départ/arrivée/retour, avis aux familles, levée journalisée,
 * identité réservée à l'établissement évacué, FR/EN.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');
const TE = require('../src/types-etablissement');

let pool; let serveur; let base; const tokens = {}; const ids = {};
async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[qui]}` }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
async function compte(email, role, etab) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $1, $2, $3) RETURNING id', [email, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (etab) await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etab]);
  const r = await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, mot_de_passe: MOT_DE_PASSE_DEMO }) });
  tokens[email.split('@')[0]] = (await r.json()).token; return u;
}
/** Résidence fictive avec n lits (une unité, une chambre par lit). */
async function residence(code, dLat, n, cfg, mb) {
  const id = (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, module_actif, type_etablissement, region_id, modules)
    VALUES ($1, $2, 'Ville fictive', $3, $4, $5, true, 'chsld', $6, '{"mode_crise": true}') RETURNING id`, [code, `Résidence ${code}`, mb.latitude + dLat, mb.longitude, cfg, ids.region])).rows[0].id;
  const type = (await pool.query("SELECT id FROM types_unite WHERE config_id = $1 AND code = 'HLD'", [cfg])).rows[0].id;
  const un = (await pool.query('INSERT INTO unites (etablissement_id, type_id, nom) VALUES ($1, $2, $3) RETURNING id', [id, type, `Unité ${code}`])).rows[0].id;
  const lits = [];
  for (let i = 1; i <= n; i += 1) {
    const ch = (await pool.query('INSERT INTO chambres (unite_id, numero) VALUES ($1, $2) RETURNING id', [un, `${i}`])).rows[0].id;
    lits.push((await pool.query("INSERT INTO lits (chambre_id, unite_id, type_id, etablissement_id, code, etat, disponibilite_confirmee_le) VALUES ($1, $2, $3, $4, $5, 'libre', now()) RETURNING id", [ch, un, type, id, `${code}-${i}`])).rows[0].id);
  }
  return { id, lits };
}

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const mb = (await pool.query("SELECT latitude, longitude, config_id FROM etablissements WHERE code = 'MB'")).rows[0];
  const c = await pool.connect(); let cfg; try { cfg = await TE.configChsld(c, mb.config_id); } finally { c.release(); }
  ids.region = (await pool.query("SELECT id FROM regions WHERE code = 'CA-QC-05'")).rows[0].id;
  ids.autreRegion = (await pool.query("SELECT id FROM regions WHERE code = 'CA-QC-06'")).rows[0].id;
  const src = await residence('EVA', 0, 0, cfg, mb); ids.src = src.id;
  const proche = await residence('PRO', 0.05, 1, cfg, mb); ids.proche = proche.id;
  const loin = await residence('LOI', 0.4, 3, cfg, mb); ids.loin = loin.id;
  for (const [i, ref] of ['R-90001', 'R-90002'].entries()) {
    ids[`r${i}`] = (await pool.query(`INSERT INTO residents (etablissement_id, reference, prenom, nom, date_naissance, statut) VALUES ($1, $2, 'Prénom', $3, '1940-01-01', 'present') RETURNING id`,
      [ids.src, ref, `Fictif${i}`])).rows[0].id;
  }
  await compte('admin.eva@demo.arrimo', 'admin_etab', ids.src);
  await compte('coord.pro@demo.arrimo', 'coordonnateur', ids.proche);
  const dir = (await pool.query("INSERT INTO directions_regionales (code, nom, region_id) VALUES ('DR-C5', 'Direction fictive', $1) RETURNING id", [ids.region])).rows[0].id;
  const dir2 = (await pool.query("INSERT INTO directions_regionales (code, nom, region_id) VALUES ('DR-C6', 'Autre direction', $1) RETURNING id", [ids.autreRegion])).rows[0].id;
  const u1 = await compte('dir.c5@demo.arrimo', 'direction_regionale'); await pool.query('INSERT INTO utilisateur_directions VALUES ($1, $2)', [u1, dir]);
  const u2 = await compte('dir.c6@demo.arrimo', 'direction_regionale'); await pool.query('INSERT INTO utilisateur_directions VALUES ($1, $2)', [u2, dir2]);
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('déclenchement : rôles autorisés seulement ; une seule évacuation active', async () => {
  assert.strictEqual((await appel('coord.pro', 'POST', '/crise/evacuations', { etablissement_id: ids.src, motif: 'incendie' })).statut, 403, 'autre établissement');
  assert.strictEqual((await appel('dir.c6', 'POST', '/crise/evacuations', { etablissement_id: ids.src, motif: 'incendie' })).statut, 403, 'direction d’une autre région');
  assert.strictEqual((await appel('admin.eva', 'POST', '/crise/evacuations', { etablissement_id: ids.src, motif: 'tempete' })).statut, 400);
  const r = await appel('dir.c5', 'POST', '/crise/evacuations', { etablissement_id: ids.src, motif: 'panne_chauffage' });
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps)); ids.ev = r.corps.id;
  assert.strictEqual((await appel('admin.eva', 'POST', '/crise/evacuations', { etablissement_id: ids.src, motif: 'incendie' })).corps.code, 'evacuation_deja_active');
});

test('proposition par résident, proximité d’abord, places restantes respectées ; identité seulement dans l’établissement évacué', async () => {
  const v = (await appel('admin.eva', 'GET', `/crise/evacuations/${ids.ev}`)).corps;
  assert.strictEqual(v.resume.a_placer, 2);
  const props = v.residents.map((r) => r.proposition.id);
  assert.deepStrictEqual(props, [ids.proche, ids.loin], 'le plus proche n’a qu’une place : le second résident est proposé ailleurs');
  assert.ok(v.residents[0].nom);
  const d = (await appel('dir.c5', 'GET', `/crise/evacuations/${ids.ev}`)).corps;
  assert.ok(!JSON.stringify(d).includes('Fictif0'), 'la direction voit la référence, jamais le nom');
});

test('confirmation : place réservée par les règles des lits ; double réservation impossible', async () => {
  const v = (await appel('admin.eva', 'GET', `/crise/evacuations/${ids.ev}`)).corps;
  const [a, b] = v.residents;
  const r1 = await appel('admin.eva', 'POST', `/crise/evacuations/${ids.ev}/residents/${a.id}`, { action: 'confirmer', destination_id: ids.proche });
  assert.strictEqual(r1.statut, 200, JSON.stringify(r1.corps));
  assert.strictEqual((await pool.query('SELECT etat, patient_ref FROM lits WHERE id = $1', [r1.corps.lit_id])).rows[0].patient_ref, 'R-90001');
  // Le seul lit de la résidence proche est pris : le second résident ne peut pas y être placé
  assert.strictEqual((await appel('admin.eva', 'POST', `/crise/evacuations/${ids.ev}/residents/${b.id}`, { action: 'confirmer', destination_id: ids.proche })).corps.code, 'evacuation_plus_de_place');
  assert.strictEqual((await appel('admin.eva', 'POST', `/crise/evacuations/${ids.ev}/residents/${a.id}`, { action: 'confirmer', destination_id: ids.loin })).corps.code, 'evacuation_statut');
  ids.a = a.id; ids.litA = r1.corps.lit_id;
});

test('suivi : départ (famille avisée), arrivée (lit occupé), retour planifié, revenu ; levée journalisée', async () => {
  const pas = (corps) => appel('admin.eva', 'POST', `/crise/evacuations/${ids.ev}/residents/${ids.a}`, corps);
  assert.strictEqual((await pas({ action: 'arrivee' })).corps.code, 'evacuation_statut', 'ordre des étapes');
  const d = await pas({ action: 'depart', transport_mode: 'transport_adapte' });
  assert.strictEqual(d.corps.statut, 'parti'); assert.ok(d.corps.famille_avisee_le);
  assert.strictEqual((await pas({ action: 'arrivee' })).corps.statut, 'arrive');
  assert.strictEqual((await pool.query('SELECT etat FROM lits WHERE id = $1', [ids.litA])).rows[0].etat, 'occupe');
  assert.strictEqual((await pas({ action: 'planifier_retour', retour_prevu_le: new Date(Date.now() + 2 * 86400000).toISOString() })).corps.statut, 'retour_planifie');
  assert.strictEqual((await pas({ action: 'revenu' })).corps.statut, 'revenu');
  assert.strictEqual((await pool.query('SELECT etat FROM lits WHERE id = $1', [ids.litA])).rows[0].etat, 'nettoyage', 'la place d’accueil est libérée pour le nettoyage');
  assert.strictEqual((await appel('admin.eva', 'POST', `/crise/evacuations/${ids.ev}/lever`)).corps.statut, 'levee');
  assert.ok((await pool.query("SELECT 1 FROM journal WHERE etablissement_id = $1 AND action = 'Évacuation levée'", [ids.src])).rowCount);
  assert.strictEqual((await pas({ action: 'revenu' })).corps.code, 'evacuation_levee');
});

test('anglais : textes du Mode crise complets en FR et EN', () => {
  const s = require('node:fs').readFileSync(require.resolve('../public/crise.js'), 'utf8');
  const bloc = (l) => s.slice(s.indexOf(`    ${l}: {`), s.indexOf(l === 'fr' ? '    en: {' : '  };'));
  const k = (x) => [...x.matchAll(/(\w+): '/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(k(bloc('fr')), k(bloc('en')));
});
