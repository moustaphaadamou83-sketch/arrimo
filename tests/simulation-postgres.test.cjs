/** PostgreSQL RÉEL, base locale neuve dédiée. Jamais de reset ou de base publique. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerPool } = require('../src/db');
const cx = require('../src/connecteurs');
const sim = require('../src/simulation-connecteurs');
const terrain = require('../src/terrain');
const priorites = require('../src/priorites');
const cible = process.env.SIMULATION_TEST_DATABASE_URL;
test('interopérabilité fictive : parcours réel PostgreSQL et concurrence', { skip: !cible && 'SIMULATION_TEST_DATABASE_URL absent : PostgreSQL non testé' }, async (t) => {
  const url = new URL(cible); assert.ok(['localhost', '127.0.0.1', ''].includes(url.hostname));
  assert.match(url.pathname, /^\/arrimo_simulation_test_[a-z0-9_]+$/);
  const pool = creerPool(cible); t.after(() => pool.end());
  assert.equal((await pool.query('SELECT tablename FROM pg_tables WHERE schemaname=current_schema()')).rows.length, 0, 'base neuve obligatoire ; aucun effacement autorisé');
  const avantEnv = process.env.ARRIMO_ENV; process.env.ARRIMO_ENV = 'recette';
  t.after(() => { if (avantEnv === undefined) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = avantEnv; });
  const restaurer = require('./routeur-fictif.cjs').activer(); t.after(restaurer);
  await require('../db/seed').seed(pool, { silencieux: true });
  const A = (await pool.query("SELECT * FROM etablissements WHERE code='MB'")).rows[0];
  const B = (await pool.query("SELECT * FROM etablissements WHERE code='RC'")).rows[0];
  const type = (await pool.query("SELECT id FROM types_unite WHERE config_id=$1 AND code='MED'", [A.config_id])).rows[0].id;
  const compte = async (email, etab) => ({ ...(await pool.query('SELECT id FROM utilisateurs WHERE email=$1', [email])).rows[0], role: 'coordonnateur', etabs: [etab] });
  const a = await compte('tremblay@demo.arrimo', A.id); const b = await compte('roy@demo.arrimo', B.id);
  const admin = { ...(await pool.query("SELECT id FROM utilisateurs WHERE email='reseau@demo.arrimo'")).rows[0], role: 'gestionnaire', gestionnaire: true, admin: true, totp_actif: true, etabs: [] };
  const conA = await cx.creerConnecteur(pool, 'Simulateur A fictif', A.id);
  const conB = await cx.creerConnecteur(pool, 'Simulateur B fictif', B.id);
  const conA2 = await cx.creerConnecteur(pool, 'Simulateur A concurrent fictif', A.id);
  for (const con of [conA, conB, conA2]) await sim.configurer(pool, admin, con.id, { actif: true, confirmation: true });
  const lier = (con, genre, reference_externe, valeur_locale) => sim.correspondance(pool, admin, con, { genre, reference_externe, valeur_locale: String(valeur_locale), confirmation: true });
  async function creerLit(etab, code) {
    const unite = (await pool.query('SELECT id FROM unites WHERE etablissement_id=$1 AND type_id=$2 LIMIT 1', [etab, type])).rows[0].id;
    const ch = (await pool.query('INSERT INTO chambres(unite_id,numero) VALUES($1,$2) RETURNING id', [unite, code])).rows[0].id;
    return (await pool.query("INSERT INTO lits(etablissement_id,unite_id,chambre_id,type_id,code,groupe_age,disponibilite_confirmee_le,disponibilite_confirmee_par) VALUES($1,$2,$3,$4,$5,'pediatrique',now(),$6) RETURNING *", [etab, unite, ch, type, code, admin.id])).rows[0];
  }
  const LA = await creerLit(A.id, '000-SIM-A'); const LB = await creerLit(B.id, '000-SIM-B');
  const cv = (await pool.query("INSERT INTO civieres(etablissement_id,code,categorie) VALUES($1,'SIM-C1','pediatrique') RETURNING *", [A.id])).rows[0];
  for (const [genre, ref, valeur] of [['patient','PAT-1','P-90600'],['patient','PAT-2','P-90601'],['type_unite','MED',type],['lit','LIT-A',LA.id],['civiere','CIV-1',cv.id],['etablissement','B',B.id]]) await lier(conA, genre, ref, valeur);
  for (const utilisateur of [admin, a]) await priorites.habiliter(pool, admin, A.id, utilisateur.id, { active: true, version: 0, motif: 'Professionnel fictif habilité pour recette', confirmation: true });
  await priorites.configurer(pool, admin, A.id, { revision: 0, categories: [{ code: 'rapide_demo', libelle: 'Rapide — fictif', rang: 1 }, { code: 'planifiable_demo', libelle: 'Planifiable — fictif', rang: 2 }], motif: 'Référentiel fictif approuvé', confirmation: true });
  const date = new Date().toISOString();
  const ev = (flux, sequence, evenement, donnees, identifiant = `${flux}-${sequence}`) => ({ identifiant, flux, sequence, date_source: date, evenement, donnees, confirmation: true });
  const envoyer = async (acteur, con, e) => { const r = await sim.recevoir(pool, acteur, con, e); assert.equal(r.statut, 'applique', JSON.stringify(r)); return r; };
  const lit = async (id) => (await pool.query('SELECT * FROM lits WHERE id=$1', [id])).rows[0];
  const civiere = async () => (await pool.query('SELECT * FROM civieres WHERE id=$1', [cv.id])).rows[0];
  let demande;
  const creation = ev('LOCAL', 2, 'demande_lit', { patient: 'PAT-1', type_unite: 'MED', civiere: 'CIV-1', demande: 'DEM-1', groupe_age: 'pediatrique' });
  await t.test('désordre : demande conservée sans effet avant arrivée', async () => {
    assert.equal((await sim.recevoir(pool, a, conA, creation)).statut, 'en_attente');
    assert.equal((await pool.query("SELECT count(*)::int n FROM demandes_admission WHERE patient_ref='P-90600'")).rows[0].n, 0);
  });
  await t.test('même arrivée simultanée : une application et un accusé de doublon', async () => {
    const arrivee = ev('LOCAL', 1, 'arrivee_urgence', { patient: 'PAT-1', civiere: 'CIV-1', version: cv.version });
    const r = await Promise.all([1, 2].map(() => sim.recevoir(pool, a, conA, arrivee)));
    assert.deepEqual(r.map((x) => x.statut).sort(), ['applique', 'deja_recu']);
    assert.equal((await civiere()).etat, 'occupee');
    demande = (await envoyer(a, conA, creation)).resultat.id;
  });
  await t.test('priorité humaine, attribution pédiatrique, admission et civière au nettoyage', async () => {
    await envoyer(a, conA, ev('LOCAL', 3, 'priorite_validee', { demande: 'DEM-1', code: 'planifiable_demo', revision: 1, version: 0, motif: 'Validation professionnelle fictive' }));
    const d = (await pool.query('SELECT * FROM demandes_admission WHERE id=$1', [demande])).rows[0]; assert.equal(d.priorite_validee_par, a.id);
    await envoyer(a, conA, ev('LOCAL', 4, 'attribution', { demande: 'DEM-1', lit: 'LIT-A', version: (await lit(LA.id)).version }));
    await envoyer(a, conA, ev('LOCAL', 5, 'admission', { demande: 'DEM-1', lit: 'LIT-A', version: (await lit(LA.id)).version }));
    assert.equal((await lit(LA.id)).etat, 'occupe'); assert.equal((await civiere()).etat, 'nettoyage');
    assert.equal((await pool.query('SELECT statut FROM demandes_admission WHERE id=$1', [demande])).rows[0].statut, 'admise');
  });
  await t.test('congé prévu puis confirmé ne libère pas le lit ; départ et nettoyage le libèrent', async () => {
    const dateSortie = new Date(Date.now() + 3600000).toISOString();
    await envoyer(a, conA, ev('LOCAL', 6, 'conge_prevu', { lit: 'LIT-A', patient: 'PAT-1', version: (await lit(LA.id)).version, date: dateSortie }));
    await envoyer(a, conA, ev('LOCAL', 7, 'conge_confirme', { lit: 'LIT-A', patient: 'PAT-1', version: (await lit(LA.id)).version, date: dateSortie }));
    assert.equal((await lit(LA.id)).etat, 'occupe'); assert.equal((await lit(LA.id)).conge_statut, 'confirme');
    await envoyer(a, conA, ev('LOCAL', 8, 'conge', { lit: 'LIT-A', patient: 'PAT-1', version: (await lit(LA.id)).version }));
    assert.equal((await lit(LA.id)).etat, 'nettoyage');
    await envoyer(a, conA, ev('LOCAL', 9, 'nettoyage', { genre: 'lit', ressource: 'LIT-A', version: (await lit(LA.id)).version }));
    await envoyer(a, conA, ev('LOCAL', 10, 'nettoyage', { genre: 'civiere', ressource: 'CIV-1', version: (await civiere()).version }));
    assert.equal((await lit(LA.id)).etat, 'libre'); assert.equal((await civiere()).etat, 'libre');
  });
  await t.test('deux connecteurs concurrents demandent le même lit : une seule réservation', async () => {
    const demandes = [];
    for (const [index, con] of [conA, conA2].entries()) {
      const d = await terrain.creerDemande(pool, a, { etablissement_id: A.id, type_id: type, patient_ref: `P-${90602 + index}`, groupe_age: 'pediatrique' });
      await lier(con, 'demande', 'DEM-CONC', d.id); await lier(con, 'lit', 'LIT-CONC', LA.id); demandes.push(d.id);
    }
    const version = (await lit(LA.id)).version;
    const r = await Promise.all([conA, conA2].map((con) => sim.recevoir(pool, a, con, ev('CONCURRENT', 1, 'attribution', { demande: 'DEM-CONC', lit: 'LIT-CONC', version }))));
    assert.deepEqual(r.map((x) => x.statut).sort(), ['applique', 'conflit']);
    assert.equal((await pool.query("SELECT count(*)::int n FROM demandes_admission WHERE id=ANY($1::int[]) AND statut='assignee'", [demandes])).rows[0].n, 1);
  });
  let transfert;
  await t.test('transfert fictif : départ et réception gardent les étapes métier', async () => {
    await envoyer(a, conA, ev('TRANSFERT', 1, 'arrivee_urgence', { patient: 'PAT-2', civiere: 'CIV-1', version: (await civiere()).version }));
    await envoyer(a, conA, ev('TRANSFERT', 2, 'demande_lit', { patient: 'PAT-2', civiere: 'CIV-1', type_unite: 'MED', demande: 'DEM-2', groupe_age: 'pediatrique' }));
    await envoyer(a, conA, ev('TRANSFERT', 3, 'priorite_validee', { demande: 'DEM-2', code: 'rapide_demo', revision: 1, version: 0, motif: 'Validation professionnelle fictive' }));
    transfert = (await envoyer(a, conA, ev('TRANSFERT', 4, 'transfert', { demande: 'DEM-2', destination: 'B', transfert: 'TR-1', urgent: false }))).resultat.id;
    await lier(conB, 'transfert', 'TR-1', transfert);
    const premature = await sim.recevoir(pool, b, conB, ev('RECEPTION', 1, 'reception', { transfert: 'TR-1' }, 'RECEPTION-PREMATUREE'));
    assert.equal(premature.statut, 'conflit'); assert.equal((await lit(LB.id)).etat, 'reserve');
    await envoyer(b, conB, ev('RECEPTION', 1, 'transfert_etape', { transfert: 'TR-1', etape: 'accepter' }));
    await envoyer(b, conB, ev('RECEPTION', 2, 'transfert_etape', { transfert: 'TR-1', etape: 'chambre_prete' }));
    await envoyer(a, conA, ev('TRANSFERT', 5, 'transfert_etape', { transfert: 'TR-1', etape: 'transport' }));
    await envoyer(a, conA, ev('TRANSFERT', 6, 'transfert_etape', { transfert: 'TR-1', etape: 'depart' }));
    await envoyer(b, conB, ev('RECEPTION', 3, 'reception', { transfert: 'TR-1' }));
    assert.equal((await lit(LB.id)).etat, 'occupe'); assert.equal((await civiere()).etat, 'nettoyage');
    assert.equal((await pool.query('SELECT statut FROM transferts WHERE id=$1', [transfert])).rows[0].statut, 'recu');
  });
  await t.test('isolation : clé seule, mauvaise correspondance et acteur hors établissement refusés', async () => {
    await assert.rejects(cx.recevoirEvenement(pool, conA, { identifiant: 'LEGACY-INTERDIT', evenement: 'conge', lit: LA.code }), { statut: 403 });
    await assert.rejects(lier(conA, 'lit', 'LIT-B-INTERDIT', LB.id), { statut: 403 });
    await assert.rejects(sim.recevoir(pool, a, conB, ev('INTERDIT', 1, 'reception', { transfert: 'TR-1' })), { statut: 403 });
    await assert.rejects(sim.supervision(pool, a, B.id), { statut: 403 });
  });
  await t.test('OG répond depuis les événements synchronisés autorisés et leur fraîcheur', async () => {
    const r = await require('../src/og-outils').repondre(pool, b, B.id, 'Quelle est la synchronisation des connecteurs simulés ?');
    assert.match(r.reponse, /Simulateur B fictif/); assert.match(r.reponse, /Dernière date source/); assert.ok(!r.reponse.includes('Simulateur A fictif'));
    const vue = await terrain.fileAdmission(pool, a, A.id); assert.ok(!vue.some((d) => d.id === demande));
  });
  await t.test('API réelle : session obligatoire, clé et compte limités au même établissement', async () => {
    const serveur = require('../src/app').creerApp(pool).listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { serveur.once('listening', resolve); serveur.once('error', reject); });
    try {
      const base = `http://127.0.0.1:${serveur.address().port}/api`;
      const corps = ev('HTTP', 1, 'admission', { demande: 'DEM-1' });
      const sansSession = await fetch(`${base}/connecteurs/simulation/evenements`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-connecteur-key': conA.cle }, body: JSON.stringify(corps) });
      assert.equal(sansSession.status, 401);
      const connexion = await fetch(`${base}/connexion`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'tremblay@demo.arrimo', mot_de_passe: require('../db/seed').MOT_DE_PASSE_DEMO }) });
      assert.equal(connexion.status, 200); const token = (await connexion.json()).token; assert.ok(token);
      const autreCle = await fetch(`${base}/connecteurs/simulation/evenements`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-connecteur-key': conB.cle, authorization: `Bearer ${token}` }, body: JSON.stringify(corps) });
      assert.equal(autreCle.status, 403);
      const autreVue = await fetch(`${base}/connecteurs/simulation/supervision?etablissement_id=${B.id}`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(autreVue.status, 403);
    } finally { await new Promise((resolve) => serveur.close(resolve)); }
  });
});
