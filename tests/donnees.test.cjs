'use strict';
/**
 * Données (20 nov. 2026) : sommes cohérentes avec le détail, masquage sous 5, CSV sans référence, cloisonnement régional
 * (direction régionale : sa région seulement), liste d'attente cohérente avec les épisodes NSA, module non activé refusé, FR/EN.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');

let pool; let serveur; let base; const tokens = {}; const ids = {};
async function appel(qui, chemin, entetes = {}) {
  const r = await fetch(`${base}/api${chemin}`, { headers: { Authorization: `Bearer ${tokens[qui]}`, ...entetes } });
  const texte = await r.text(); let corps; try { corps = JSON.parse(texte); } catch { corps = texte; }
  return { statut: r.status, corps };
}
async function connecter(q, email) {
  const r = await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, mot_de_passe: MOT_DE_PASSE_DEMO }) });
  tokens[q] = (await r.json()).token; assert.ok(tokens[q], q);
}

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const e = Object.fromEntries((await pool.query('SELECT code, id FROM etablissements')).rows.map((r) => [r.code, r.id]));
  ids.mb = e.MB; ids.sl = e.SL; ids.lm = e.LM;
  ids.r05 = (await pool.query("SELECT id FROM regions WHERE code = 'CA-QC-05'")).rows[0].id; ids.r06 = (await pool.query("SELECT id FROM regions WHERE code = 'CA-QC-06'")).rows[0].id;
  await pool.query('UPDATE etablissements SET region_id = $1 WHERE id IN ($2, $3)', [ids.r05, ids.mb, ids.sl]);
  await pool.query('UPDATE etablissements SET region_id = $1 WHERE id = $2', [ids.r06, ids.lm]);
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"donnees_regionales": true}' WHERE id = $1`, [ids.mb]);
  // 6 patients NSA orientés CHSLD à Mont-Bellevue, 2 à Saint-Laurent (sous le seuil)
  await pool.query("UPDATE lits SET nsa_depuis = NULL, nsa_orientation = NULL WHERE etablissement_id = $1", [(await pool.query("SELECT id FROM etablissements WHERE code = 'SL'")).rows[0].id]);
  const nsa = async (etab, n) => pool.query(`UPDATE lits SET nsa_depuis = now() - interval '10 days', nsa_orientation = 'chsld'
    WHERE id IN (SELECT id FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' AND nsa_depuis IS NULL ORDER BY id LIMIT $2)`, [etab, n]);
  await nsa(ids.mb, 6); await nsa(ids.sl, 2);
  const dir = (await pool.query("INSERT INTO directions_regionales (code, nom, region_id) VALUES ('DR-T5', 'Direction fictive', $1) RETURNING id", [ids.r05])).rows[0].id;
  const u = (await pool.query("INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ('dr.t@demo.arrimo', 'Direction', $1, 'direction_regionale') RETURNING id", [hacher(MOT_DE_PASSE_DEMO)])).rows[0].id;
  await pool.query('INSERT INTO utilisateur_directions VALUES ($1, $2)', [u, dir]);
  await connecter('dr', 'dr.t@demo.arrimo'); await connecter('tremblay', 'tremblay@demo.arrimo'); await connecter('bouchard', 'bouchard@demo.arrimo'); await connecter('reseau', 'reseau@demo.arrimo');
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('direction régionale : sa région seulement ; établissement : module exigé, sa région ; masquage sous 5', async () => {
  const d = (await appel('dr', '/donnees')).corps;
  assert.deepStrictEqual(d.etablissements.map((x) => x.id).sort(), [ids.mb, ids.sl].sort(), 'Lac-Mégantic (autre région) absent');
  const mb = d.etablissements.find((x) => x.id === ids.mb); const sl = d.etablissements.find((x) => x.id === ids.sl);
  const actifs = async (id) => (await pool.query("SELECT count(*)::int n FROM nsa_episodes WHERE etablissement_id = $1 AND statut = 'actif'", [id])).rows[0].n;
  const nMb = await actifs(ids.mb); const nSl = await actifs(ids.sl);
  assert.ok(nMb >= 5 && nSl > 0 && nSl < 5, `jeu d’essai : ${nMb} et ${nSl}`);
  assert.strictEqual(mb.nsa_actifs, nMb); assert.deepStrictEqual(sl.nsa_actifs, { masque: true }, 'moins de 5 → « < 5 »');
  assert.deepStrictEqual(sl.nsa_jours_median, { masque: true }, 'la médiane d’un petit nombre est masquée aussi'); assert.ok(mb.nsa_jours_median >= 0);
  assert.strictEqual(d.totaux.nsa_actifs, nMb + nSl, 'total calculé sur les chiffres bruts, au-dessus du seuil');
  assert.strictEqual((await appel('bouchard', `/donnees?etablissement_id=${ids.sl}`)).corps.code, 'module_desactive');
  assert.deepStrictEqual((await appel('tremblay', `/donnees?etablissement_id=${ids.mb}`)).corps.etablissements.map((x) => x.id).sort(), [ids.mb, ids.sl].sort());
  assert.strictEqual((await appel('tremblay', `/donnees?etablissement_id=${ids.sl}`)).statut, 403);
  assert.ok((await appel('reseau', '/donnees')).corps.etablissements.some((x) => x.id === ids.lm), 'coordination réseau : tout le réseau');
});

test('sommes cohérentes avec le détail ; liste d’attente cohérente avec les épisodes NSA ; aucune référence', async () => {
  const d = (await appel('reseau', `/donnees?region_id=${ids.r05}`)).corps;
  const n = (x) => (typeof x === 'number' ? x : 0);
  assert.strictEqual(d.totaux.places_libres, d.etablissements.reduce((s, x) => s + n(x.places_libres), 0));
  const episodes = (await pool.query("SELECT count(*)::int n FROM nsa_episodes e JOIN etablissements t ON t.id = e.etablissement_id WHERE e.statut = 'actif' AND e.orientation = 'chsld' AND t.region_id = $1", [ids.r05])).rows[0].n;
  assert.strictEqual(d.listes_attente.find((a) => a.genre === 'chsld').personnes, episodes);
  assert.ok(!/P-\d{5}|patient_ref/.test(JSON.stringify(d)));
});

test('CSV : « < 5 » écrit, aucune référence, FR et EN', async () => {
  const fr = (await appel('dr', '/donnees.csv')).corps;
  assert.match(fr, /^\ufeff?Établissement;Région;Passages Chrono/); assert.match(fr, /<5/); assert.ok(!/P-\d{5}/.test(fr));
  assert.match((await appel('dr', '/donnees.csv', { 'X-Langue': 'en' })).corps, /Facility;Region;Chrono visits/);
});

test('anglais : textes des Données et de la page de la direction complets en FR et EN', () => {
  const fs = require('node:fs');
  for (const f of ['../public/donnees.js', '../public/direction.js']) {
    const s = fs.readFileSync(require.resolve(f), 'utf8');
    const bloc = (l) => s.slice(s.indexOf(`${l}: {`), s.indexOf(l === 'fr' ? '    en: {' : '  };'));
    const k = (x) => [...x.matchAll(/(\w+): '/g)].map((m) => m[1]).sort();
    assert.deepStrictEqual(k(bloc('fr')), k(bloc('en')), f);
  }
});
