'use strict';
/**
 * Complémentaire nº 3, scénario transversal (§16) : évacuation fictive d'un CHSLD de 49 résidents.
 * Activation par un responsable autorisé, 49 résidents identifiés, destinations validées (places réservées par les règles des lits,
 * jamais deux résidents sur un lit), départs, transport annulé, changement de destination (ancienne place rendue, aucun doublon),
 * capacité devenue indisponible, arrivées, accueil confirmé, rapport post-incident (aucun résident compté accueilli sans confirmation),
 * levée. Données entièrement fictives.
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
async function residence(code, dLat, n, cfg, mb) {
  const id = (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, module_actif, type_etablissement, region_id, modules)
    VALUES ($1, $2, 'Ville fictive', $3, $4, $5, true, 'chsld', $6, '{"mode_crise": true}') RETURNING id`, [code, `Résidence ${code}`, mb.latitude + dLat, mb.longitude, cfg, ids.region])).rows[0].id;
  const type = (await pool.query("SELECT id FROM types_unite WHERE config_id = $1 AND code = 'HLD'", [cfg])).rows[0].id;
  const un = (await pool.query('INSERT INTO unites (etablissement_id, type_id, nom) VALUES ($1, $2, $3) RETURNING id', [id, type, `Unité ${code}`])).rows[0].id;
  for (let i = 1; i <= n; i += 1) {
    const ch = (await pool.query('INSERT INTO chambres (unite_id, numero) VALUES ($1, $2) RETURNING id', [un, `${i}`])).rows[0].id;
    await pool.query("INSERT INTO lits (chambre_id, unite_id, type_id, etablissement_id, code, etat, disponibilite_confirmee_le) VALUES ($1, $2, $3, $4, $5, 'libre', now())", [ch, un, type, id, `${code}-${String(i).padStart(3, '0')}`]);
  }
  return id;
}
const agir = (rid, corps) => appel('admin', 'POST', `/crise/evacuations/${ids.ev}/residents/${rid}`, corps);
const vue = async () => (await appel('admin', 'GET', `/crise/evacuations/${ids.ev}`)).corps;

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const mb = (await pool.query("SELECT latitude, longitude, config_id FROM etablissements WHERE code = 'MB'")).rows[0];
  const c = await pool.connect(); let cfg; try { cfg = await TE.configChsld(c, mb.config_id); } finally { c.release(); }
  ids.region = (await pool.query("SELECT id FROM regions WHERE code = 'CA-QC-05'")).rows[0].id;
  ids.src = await residence('E49', 0, 0, cfg, mb);
  ids.a = await residence('A49', 0.03, 30, cfg, mb); ids.b = await residence('B49', 0.06, 25, cfg, mb); ids.c = await residence('C49', 0.09, 5, cfg, mb);
  for (let i = 1; i <= 49; i += 1) {
    await pool.query(`INSERT INTO residents (etablissement_id, reference, prenom, nom, date_naissance, statut) VALUES ($1, $2, 'Prénom', 'Fictif', '1940-01-01', 'present')`, [ids.src, `R-49${String(i).padStart(3, '0')}`]);
  }
  const u = (await pool.query("INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ('admin.e49@demo.arrimo', 'Admin E49', $1, 'admin_etab') RETURNING id", [hacher(MOT_DE_PASSE_DEMO)])).rows[0].id;
  await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, ids.src]);
  const r = await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin.e49@demo.arrimo', mot_de_passe: MOT_DE_PASSE_DEMO }) });
  tokens.admin = (await r.json()).token;
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('1-2. activation par un responsable autorisé : 49 résidents identifiés', async () => {
  const r = await appel('admin', 'POST', '/crise/evacuations', { etablissement_id: ids.src, motif: 'incendie' });
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps)); ids.ev = r.corps.id;
  const v = await vue();
  assert.strictEqual(v.residents.length, 49); assert.strictEqual(v.resume.a_placer, 49);
  assert.strictEqual(new Set(v.residents.map((x) => x.resident_ref)).size, 49, 'chaque résident une seule fois');
});

test('3-4. destinations validées : 49 places réservées, jamais deux résidents sur un lit', async () => {
  let v = await vue();
  await Promise.all(v.residents.map((r) => agir(r.id, { action: 'confirmer', destination_id: r.proposition.id })));
  v = await vue();
  assert.strictEqual(v.resume.confirmes, 49);
  const lits = v.residents.map((x) => x.lit_id);
  assert.strictEqual(new Set(lits).size, 49, 'lits distincts');
  const reserves = (await pool.query("SELECT count(*)::int AS n FROM lits WHERE etablissement_id = ANY($1) AND etat = 'reserve'", [[ids.a, ids.b, ids.c]])).rows[0].n;
  assert.strictEqual(reserves, 49);
});

test('5-7. départs, transport annulé, changement de destination sans doublon ni perte ; capacité devenue indisponible', async () => {
  let v = await vue();
  for (const r of v.residents) assert.strictEqual((await agir(r.id, { action: 'depart', transport_mode: 'transport_adapte' })).statut, 200);
  v = await vue(); assert.strictEqual(v.resume.partis, 49);
  const [r1, r2, r3] = v.residents;
  // Transport annulé : le résident reste suivi, place conservée
  assert.strictEqual((await agir(r1.id, { action: 'annuler_depart' })).statut, 200);
  // Changement de destination vers C49 : ancienne place rendue, nouvelle réservée
  const cible = r2.destination_id === ids.c ? ids.a : ids.c;
  const ancien = r2.lit_id;
  const ch = await agir(r2.id, { action: 'changer_destination', destination_id: cible });
  assert.strictEqual(ch.statut, 200, JSON.stringify(ch.corps));
  assert.strictEqual((await pool.query('SELECT etat FROM lits WHERE id = $1', [ancien])).rows[0].etat, 'libre', 'ancienne place rendue');
  assert.strictEqual(ch.corps.changements_destination, 1);
  // Capacité devenue indisponible : plus aucune place à la destination demandée → refus explicite, le résident garde sa place
  await pool.query("UPDATE lits SET etat = 'indispo' WHERE etablissement_id = $1 AND etat = 'libre'", [r3.destination_id === ids.b ? ids.a : ids.b]);
  const refus = await agir(r3.id, { action: 'changer_destination', destination_id: r3.destination_id === ids.b ? ids.a : ids.b });
  assert.strictEqual(refus.corps.code, 'evacuation_plus_de_place');
  v = await vue();
  assert.strictEqual(v.residents.length, 49); assert.strictEqual(v.resume.partis + v.resume.confirmes, 49, 'personne n’est perdu ni compté deux fois');
  const reserves = (await pool.query("SELECT count(*)::int AS n FROM lits WHERE etablissement_id = ANY($1) AND etat = 'reserve'", [[ids.a, ids.b, ids.c]])).rows[0].n;
  assert.strictEqual(reserves, 49, 'toujours exactement une place par résident');
  ids.r1 = r1.id;
});

test('3.5. coupure réseau : gestes de terrain rejoués avec leur heure réelle ; conflit de version jamais écrasé', async () => {
  const r = (await vue()).residents.find((x) => x.statut === 'parti');
  assert.ok(r, 'un résident en route');
  const conflit = await agir(r.id, { action: 'arrivee', version_attendue: r.version - 1, heure_terrain: new Date(Date.now() - 20 * 60000).toISOString() });
  assert.strictEqual(conflit.statut, 409); assert.strictEqual(conflit.corps.code, 'evacuation_conflit');
  assert.strictEqual((await vue()).residents.find((x) => x.id === r.id).statut, 'parti', 'rien n’est écrasé');
  assert.strictEqual((await agir(r.id, { action: 'arrivee', version_attendue: r.version, heure_terrain: new Date(Date.now() + 3600000).toISOString() })).statut, 400, 'jamais dans le futur');
  assert.strictEqual((await agir(r.id, { action: 'changer_destination', heure_terrain: new Date().toISOString() })).statut, 400, 'affecter un lieu exige la connexion');
  const heure = new Date(Date.now() - 20 * 60000);
  const ok = await agir(r.id, { action: 'arrivee', version_attendue: r.version, heure_terrain: heure.toISOString() });
  assert.strictEqual(ok.statut, 200, JSON.stringify(ok.corps));
  assert.ok(Math.abs(new Date(ok.corps.arrivee_le) - heure) < 1000, 'heure réelle de terrain conservée');
  const j = (await pool.query("SELECT detail FROM journal WHERE action = 'Évacuation : étape' ORDER BY id DESC LIMIT 1")).rows[0].detail;
  assert.match(j, /saisi hors connexion/);
});

test('11. arrivée et accueil : jamais « accueilli » sans confirmation ; rapport post-incident exact', async () => {
  assert.strictEqual((await agir(ids.r1, { action: 'arrivee' })).corps.code, 'evacuation_statut', 'pas d’arrivée sans départ');
  await agir(ids.r1, { action: 'depart', transport_mode: 'ambulance' });
  let v = await vue();
  const partis = v.residents.filter((r) => r.statut === 'parti');
  for (const r of partis) await agir(r.id, { action: 'arrivee' });
  // Deux accueils restent non confirmés
  const arrives = (await vue()).residents.filter((r) => r.statut === 'arrive');
  for (const r of arrives.slice(2)) await agir(r.id, { action: 'accueilli' });
  const rap = (await appel('admin', 'GET', `/crise/evacuations/${ids.ev}/rapport`)).corps;
  assert.strictEqual(rap.residents, 49); assert.strictEqual(rap.accueil_confirme, 47); assert.strictEqual(rap.sans_accueil_confirme.length, 2);
  assert.ok(rap.sans_accueil_confirme.every((x) => x.statut === 'arrive'));
  assert.strictEqual(rap.changements_destination, 1); assert.strictEqual(rap.departs_annules, 1);
  assert.strictEqual(rap.complet, false); assert.strictEqual(rap.durees_min.jusqu_au_dernier_accueil, null, 'durée non estimée tant que tout n’est pas confirmé');
  for (const r of arrives.slice(0, 2)) await agir(r.id, { action: 'accueilli' });
  const fin = (await appel('admin', 'GET', `/crise/evacuations/${ids.ev}/rapport`)).corps;
  assert.strictEqual(fin.complet, true); assert.ok(fin.durees_min.jusqu_au_dernier_accueil >= 0);
  v = await vue(); assert.strictEqual(v.resume.accueillis, 49);
});

test('12-13. levée journalisée ; rapport toujours lisible après la levée', async () => {
  assert.strictEqual((await appel('admin', 'POST', `/crise/evacuations/${ids.ev}/lever`)).statut, 200);
  const rap = (await appel('admin', 'GET', `/crise/evacuations/${ids.ev}/rapport`)).corps;
  assert.strictEqual(rap.statut, 'levee'); assert.ok(rap.levee_le);
});
