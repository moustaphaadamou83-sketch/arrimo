/** Recette PostgreSQL réelle, uniquement sur une base locale NEUVE dédiée.
 * PRIORITES_TEST_DATABASE_URL=postgresql://.../arrimo_vnext_test_<suffixe> node tests/priorites-postgres.test.cjs
 * Ne supprime aucune table et conserve les données fictives pour inspection.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { creerPool, transaction } = require('../src/db');
const priorites = require('../src/priorites');
const terrain = require('../src/terrain');
const cx = require('../src/connecteurs');
const cible = process.env.PRIORITES_TEST_DATABASE_URL;

test('recette réelle : migration, validation professionnelle, concurrence et admission pédiatrique', { skip: !cible && 'PRIORITES_TEST_DATABASE_URL absent : aucune base testée' }, async (t) => {
  const url = new URL(cible);
  assert.ok(['localhost', '127.0.0.1', ''].includes(url.hostname), 'base locale uniquement');
  assert.match(url.pathname, /^\/arrimo_vnext_test_[a-z0-9_]+$/, 'nom de base dédié obligatoire');
  const pool = creerPool(cible);
  t.after(() => pool.end());
  const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = current_schema()");
  assert.equal(tables.rows.length, 0, 'base neuve requise ; aucune réinitialisation autorisée');
  const restaurer = require('./routeur-fictif.cjs').activer(); t.after(restaurer);
  const migration = fs.readFileSync(require.resolve('../db/migrations/20261025-priorites.sql'), 'utf8');
  const schema = fs.readFileSync(require.resolve('../db/schema.sql'), 'utf8');
  assert.ok(schema.includes(migration));
  await pool.query(schema.replace(migration, ""));
  // Le seed applique aussi le schéma courant ; l'ancien schéma a été créé avant.
  await require('../db/seed').seed(pool, { silencieux: true });
  const etab = (await pool.query("SELECT * FROM etablissements WHERE code = 'MB'")).rows[0];
  const autre = (await pool.query("SELECT id FROM etablissements WHERE code = 'SL'")).rows[0].id;
  const type = (await pool.query("SELECT id FROM types_unite WHERE config_id = $1 AND code = 'MED'", [etab.config_id])).rows[0].id;
  const medecin = (await pool.query("SELECT id FROM utilisateurs WHERE email = 'tremblay@demo.arrimo'")).rows[0];
  const reseau = (await pool.query("SELECT id FROM utilisateurs WHERE email = 'reseau@demo.arrimo'")).rows[0];
  const u = { ...medecin, role: 'coordonnateur', etabs: [etab.id] };
  const admin = { ...reseau, role: 'gestionnaire', gestionnaire: true, admin: true, totp_actif: true, etabs: [] };
  const categories = [{ code: 'critique_demo', libelle: 'Critique — fictif', rang: 1 }, { code: 'planifiable_demo', libelle: 'Planifiable — fictif', rang: 2 }];
  const d = await terrain.creerDemande(pool, u, { etablissement_id: etab.id, type_id: type, patient_ref: 'P-90101', groupe_age: 'pediatrique', priorite: 'p1' });
  await t.test('migration répétable : demande préservée et aucune validation rétroactive', async () => {
    const avant = (await pool.query('SELECT * FROM demandes_admission WHERE id=$1', [d.id])).rows;
    await transaction(pool, (c) => c.query(migration));
    await transaction(pool, (c) => c.query(migration));
    assert.deepEqual((await pool.query('SELECT * FROM demandes_admission WHERE id=$1', [d.id])).rows, avant);
    assert.equal(avant[0].priorite_validee_par, null);
  });
  await t.test('habilitation humaine et référentiel approuvé', async () => {
    await priorites.habiliter(pool, admin, etab.id, admin.id, { active: true, version: 0, confirmation: true, motif: 'Professionnel fictif habilité pour recette' });
    await priorites.habiliter(pool, admin, etab.id, u.id, { active: true, version: 0, confirmation: true, motif: 'Professionnel fictif habilité pour recette' });
    const r = await priorites.configurer(pool, admin, etab.id, { revision: 0, categories, motif: 'Référentiel fictif approuvé pour recette', confirmation: true });
    assert.equal(r.revision, 1);
  });
  const validation = { version: 0, revision: 1, code: 'critique_demo', motif: 'Choix humain fictif', confirmation: true };
  await t.test('deux validations simultanées : une réussite, un conflit, un seul journal', async () => {
    const resultats = await Promise.allSettled([1, 2].map(() => priorites.valider(pool, u, d.id, validation)));
    assert.equal(resultats.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(resultats.find((r) => r.status === 'rejected').reason.statut, 409);
    assert.equal((await pool.query('SELECT priorite_version FROM demandes_admission WHERE id=$1', [d.id])).rows[0].priorite_version, 1);
    assert.equal((await pool.query("SELECT count(*)::int n FROM journal WHERE action='Priorité de demande validée'")).rows[0].n, 1);
  });
  await t.test('isolation interétablissements : refus sans changement', async () => {
    await assert.rejects(priorites.valider(pool, { ...u, etabs: [autre] }, d.id, { ...validation, version: 1 }), { statut: 403 });
  });
  await t.test('changement de référentiel concurrent : une version publiée, revalidation explicite', async () => {
    const b = { revision: 1, categories, motif: 'Nouvelle version fictive', confirmation: true };
    const resultats = await Promise.allSettled([1, 2].map(() => priorites.configurer(pool, admin, etab.id, b)));
    assert.equal(resultats.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(resultats.find((r) => r.status === 'rejected').reason.statut, 409);
    const file = await terrain.fileAdmission(pool, u, etab.id);
    assert.equal(file.find((x) => x.id === d.id).priorite_a_revalider, true);
    await priorites.valider(pool, u, d.id, { ...validation, revision: 2, version: 1 });
  });
  let pediatrique;
  await t.test('compatibilité : lit adulte écarté pour demande pédiatrique', async () => {
    const unite = (await pool.query('SELECT id FROM unites WHERE etablissement_id=$1 AND type_id=$2 LIMIT 1', [etab.id, type])).rows[0].id;
    const chambre = (await pool.query("INSERT INTO chambres (unite_id,numero) VALUES ($1,'VNext') RETURNING id", [unite])).rows[0].id;
    await pool.query("INSERT INTO lits(etablissement_id,chambre_id,type_id,unite_id,code,groupe_age) VALUES($1,$2,$3,$4,'000-adulte','adulte')", [etab.id, chambre, type, unite]);
    pediatrique = (await pool.query("INSERT INTO lits(etablissement_id,chambre_id,type_id,unite_id,code,groupe_age) VALUES($1,$2,$3,$4,'001-enfant','pediatrique') RETURNING *", [etab.id, chambre, type, unite])).rows[0];
    const file = await terrain.fileAdmission(pool, u, etab.id);
    assert.equal(file.find((x) => x.id === d.id).lit_suggere.id, pediatrique.id);
  });
  let gagnante;
  await t.test('réservation concurrente : un lit, une seule demande assignée', async () => {
    const d2 = await terrain.creerDemande(pool, u, { etablissement_id: etab.id, type_id: type, patient_ref: 'P-90102', groupe_age: 'pediatrique' });
    const resultats = await Promise.allSettled([d, d2].map((demande) => terrain.assignerLit(pool, u, demande.id, pediatrique.id, pediatrique.version)));
    assert.equal(resultats.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(resultats.find((r) => r.status === 'rejected').reason.statut, 409);
    const affectees = (await pool.query("SELECT * FROM demandes_admission WHERE lit_id=$1 AND statut='assignee'", [pediatrique.id])).rows;
    assert.equal(affectees.length, 1); gagnante = affectees[0];
  });
  await t.test('admission depuis Lits : même demande clôturée et lit occupé', async () => {
    const lit = (await pool.query('SELECT * FROM lits WHERE id=$1', [pediatrique.id])).rows[0];
    await transaction(pool, (c) => terrain.admettreDepuisLit(c, pool, u, lit.id, lit.version));
    assert.equal((await pool.query('SELECT statut FROM demandes_admission WHERE id=$1', [gagnante.id])).rows[0].statut, 'admise');
    assert.equal((await pool.query('SELECT etat FROM lits WHERE id=$1', [lit.id])).rows[0].etat, 'occupe');
  });
  await t.test('connecteur : événement neuf simultané appliqué une seule fois', async () => {
    const con = await cx.creerConnecteur(pool, 'Simulation VNext', etab.id);
    const ev = { identifiant: 'VNext-CONCURRENT', evenement: 'conge', lit: pediatrique.code };
    const resultats = await Promise.all([1, 2].map(() => cx.recevoirEvenement(pool, con, ev)));
    assert.deepEqual(resultats.map((r) => r.statut).sort(), ['applique', 'deja_recu']);
    assert.equal((await pool.query('SELECT etat FROM lits WHERE id=$1', [pediatrique.id])).rows[0].etat, 'nettoyage');
    assert.equal((await pool.query('SELECT count(*)::int n FROM messages_connecteur WHERE connecteur_id=$1 AND identifiant=$2', [con.id, ev.identifiant])).rows[0].n, 1);
  });
});
