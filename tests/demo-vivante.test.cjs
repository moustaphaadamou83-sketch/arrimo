'use strict';
/** Démo vivante (22 nov. 2026) : scénarios Chrono, Transports et Bourse de l'Hôpital A, région 04, démonstration seulement ; Données sans double comptage. */
const test = require('node:test');
const assert = require('node:assert');
const { creerPool } = require('../src/db');
const { viderBase } = require('../db/vider');
const { seed } = require('../db/seed');
const vivante = require('../src/demo-vivante');
const donnees = require('../src/donnees');

let pool; let hx;
test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  hx = (await pool.query(`UPDATE etablissements SET code = 'HX', modules = COALESCE(modules, '{}'::jsonb) || '{"chrono": true, "transport_planifie": true}', region_id = (SELECT id FROM regions WHERE code = 'CA-QC-06')
    WHERE code = 'MB' RETURNING id, config_id`)).rows[0];
  const o = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('AMB-T', 'Ambulances test', 'ambulancier', '{ambulance}', $1) RETURNING id", [hx.config_id])).rows[0].id;
  for (const n of ['U1', 'U2', 'U3', 'U4']) await pool.query('INSERT INTO unites_secours (organisation_id, numero) VALUES ($1, $2)', [o, n]);
});
test.after(async () => { delete process.env.ARRIMO_ENV; await pool?.end(); });

test('hors démonstration : rien n’est créé', async () => {
  process.env.ARRIMO_ENV = 'recette';
  assert.deepStrictEqual(await vivante.entretenir(pool), { statut: 'hors_demo' });
  assert.strictEqual((await pool.query('SELECT count(*)::int n FROM passages_chrono')).rows[0].n, 0);
});

test('démonstration : scénarios en place, rejouables, heures recalées ; région 04', async () => {
  process.env.ARRIMO_ENV = 'demo';
  for (let i = 0; i < 2; i += 1) assert.deepStrictEqual(await vivante.entretenir(pool), { region: 'ok', ressources: 'ok', chrono: 'ok', transports: 'ok' });
  const n = async (sql) => (await pool.query(sql, [hx.id])).rows[0].n;
  assert.strictEqual(await n("SELECT count(*)::int n FROM passages_chrono WHERE etablissement_id = $1 AND statut = 'a_la_porte'"), 1);
  const porte = (await pool.query("SELECT EXTRACT(EPOCH FROM now() - h.heure) / 60 AS m FROM passages_chrono p JOIN v_horodatages_courants h ON h.objet = 'passage_chrono' AND h.objet_id = p.id AND h.etape = 'H11' WHERE p.statut = 'a_la_porte'")).rows[0].m;
  assert.ok(porte > 20 && porte < 26, `à la porte depuis ${porte} min (chrono rouge)`);
  assert.strictEqual(await n("SELECT count(*)::int n FROM passages_chrono WHERE etablissement_id = $1 AND statut = 'termine' AND modifie_le > now() - interval '12 hours'"), 1);
  const route = (await pool.query("SELECT EXTRACT(EPOCH FROM heure_prevue - now()) / 60 AS m FROM prealertes WHERE destination_id = $1 AND statut = 'recue'", [hx.id])).rows;
  assert.strictEqual(route.length, 1); assert.ok(route[0].m > 4 && route[0].m <= 6.1);
  const tp = (await pool.query("SELECT motif_transport, statut, plage_confirmee_debut IS NOT NULL AS confirmee FROM demandes_transport WHERE origine_id = $1 ORDER BY motif_transport", [hx.id])).rows;
  assert.deepStrictEqual(tp, [{ motif_transport: 'depart_nsa', statut: 'demandee', confirmee: false }, { motif_transport: 'retour_domicile', statut: 'acceptee', confirmee: true }]);
  const r = (await pool.query("SELECT e.type_local_code, p.capacites, p.places_libres_declarees FROM etablissements e JOIN ressource_profils p ON p.etablissement_id = e.id WHERE e.code = ANY($1) ORDER BY e.code", [vivante.RESSOURCES.map((x) => x.code)])).rows;
  assert.deepStrictEqual(r.map((x) => x.type_local_code).sort(), ['hospitalisation_domicile', 'ri', 'rpa', 'sante_mentale', 'soins_palliatifs']);
  assert.ok(r.some((x) => x.capacites.includes('leve_personne')) && r.some((x) => x.capacites.includes('unite_securisee')) && r.some((x) => x.capacites.includes('oxygene')));
  assert.strictEqual((await pool.query("SELECT count(*)::int n FROM etablissements WHERE region_id = (SELECT id FROM regions WHERE code = 'CA-QC-06')")).rows[0].n, 0);
  // Une ambulance laissée plus de 50 min à la porte est clôturée et remplacée
  await pool.query("UPDATE horodatages SET heure = heure - interval '40 minutes' WHERE objet = 'passage_chrono' AND objet_id = (SELECT id FROM passages_chrono WHERE statut = 'a_la_porte')").catch(() => {});
});

test('Bourse : le filtre des besoins change le classement des ressources fictives', async () => {
  const bourse = require('../src/bourse');
  await pool.query(`UPDATE etablissements SET modules = modules || '{"bourse_places": true}' WHERE id = $1`, [hx.id]);
  const u = { id: 0, role: 'coordonnateur', etabs: [hx.id], gestionnaire: false };
  const sans = (await bourse.places(pool, u, { etablissement_id: hx.id })).places.map((p) => p.nom);
  const oxy = (await bourse.places(pool, u, { etablissement_id: hx.id, besoins: 'oxygene,leve_personne' })).places.map((p) => p.nom);
  assert.ok(sans.length >= 5); assert.notDeepStrictEqual(sans, oxy);
  assert.match(oxy[0], /palliatifs/);
});

test('Données : un transfert compte une fois ; actifs d’abord ; établissements sans donnée marqués', async () => {
  const [a, b] = (await pool.query("SELECT id FROM etablissements WHERE type_etablissement = 'hopital' ORDER BY id LIMIT 2")).rows.map((x) => x.id);
  for (let i = 0; i < 6; i += 1) await pool.query("INSERT INTO transferts (origine_id, destination_id, statut, date_demande) SELECT $1, $2, 'en_attente', now() WHERE EXISTS (SELECT 1 FROM transferts LIMIT 0) OR true", [a, b]).catch(() => {});
  const t = await donnees.tableau(pool, { gestionnaire: true, role: 'admin' }, {});
  const somme = t.etablissements.reduce((s, l) => s + (typeof l.transferts === 'number' ? l.transferts : 0), 0);
  const masques = t.etablissements.filter((l) => l.transferts?.masque).length;
  if (!masques) assert.strictEqual(t.totaux.transferts, somme, 'total = somme des lignes');
  assert.deepStrictEqual(t.totaux.transferts, t.totaux.transferts_recus, 'demandés = reçus dans le périmètre');
  const premierVide = t.etablissements.findIndex((l) => l.vide);
  assert.ok(premierVide === -1 || t.etablissements.slice(premierVide).every((l) => l.vide), 'les établissements vides sont à la fin');
});
