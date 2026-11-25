'use strict';
/**
 * Chantier coordination, lot 2 « Coordonner » (26 nov. 2026) : suivi des alertes de Vigilance.
 * Un seul suivi par fait (déduplication, même en concurrence), accusé ≠ résolution, action en liste fermée, escalade sans réponse,
 * responsable absent → niveau suivant tracé, fait disparu = « levée » (pas « résolue »), résolution confirmée par une personne,
 * grille d'escalade configurable par l'administration seulement, journal immuable, isolation. Données fictives seulement.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');
const suivi = require('../src/suivi-alertes');

let pool; let serveur; let base; const tokens = {}; const ids = {};
async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${tokens[qui]}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined });
  const texte = await r.text(); let corpsJ = null; try { corpsJ = JSON.parse(texte); } catch { corpsJ = texte; }
  return { statut: r.status, corps: corpsJ };
}
async function compte(email, role, etabId) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [email, email, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (etabId) await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etabId]);
  return u;
}
async function connecter(q, email) {
  const r = await appel(null, 'POST', '/connexion', { email, mot_de_passe: MOT_DE_PASSE_DEMO });
  assert.strictEqual(r.statut, 200, `connexion ${q}`); tokens[q] = r.corps.token;
}
const suivisDe = async (type) => (await pool.query('SELECT * FROM suivis_alertes WHERE etablissement_id = $1 AND type = $2 ORDER BY id', [ids.mb, type])).rows;

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL);
  await viderBase(pool);
  await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool));
  base = `http://127.0.0.1:${serveur.address().port}`;
  [ids.mb, ids.sl] = (await pool.query("SELECT id FROM etablissements WHERE code IN ('MB', 'SL') ORDER BY code")).rows.map((x) => x.id);
  ids.admin = await compte('admin.suivi@demo.arrimo', 'admin_etab', ids.mb);
  ids.entretien = await compte('entretien.suivi@demo.arrimo', 'entretien', ids.mb);
  await connecter('tremblay', 'tremblay@demo.arrimo'); await connecter('bouchard', 'bouchard@demo.arrimo');
  await connecter('admin', 'admin.suivi@demo.arrimo'); await connecter('entretien', 'entretien.suivi@demo.arrimo');
  ids.lit = (await pool.query("SELECT id, code, version FROM lits WHERE etablissement_id = $1 AND etat = 'reserve' AND transfert_id IS NULL ORDER BY etat_depuis LIMIT 1", [ids.mb])).rows[0];
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('ouverture : un seul suivi par fait, même en synchronisations concurrentes ; visible sur la fiche Vigilance', async () => {
  await Promise.all([suivi.synchroniserEtab(pool, ids.mb), suivi.synchroniserEtab(pool, ids.mb)]);
  await suivi.synchroniserEtab(pool, ids.mb);
  const s = (await suivisDe('reservation_prolongee')).filter((x) => x.cle.endsWith(`:${ids.lit.id}`));
  assert.strictEqual(s.length, 1, 'déduplication'); ids.s = s[0];
  assert.strictEqual(s[0].statut, 'ouverte'); assert.strictEqual(s[0].responsable_role, 'coordonnateur'); assert.strictEqual(s[0].remplacant_role, 'gestionnaire');
  assert.ok(new Date(s[0].echeance) > new Date(), 'échéance future');
  const v = await appel('tremblay', 'GET', `/vigilance?etablissement_id=${ids.mb}`);
  const a = v.corps.alertes.find((x) => x.type === 'reservation_prolongee' && x.ressource_id === ids.lit.id);
  assert.strictEqual(a.suivi.id, Number(s[0].id)); assert.strictEqual(a.suivi.statut, 'ouverte');
  const j = await appel('tremblay', 'GET', `/coordination/alertes/${s[0].id}/journal`);
  assert.deepStrictEqual(j.corps.map((x) => x.action), ['ouverture']);
});

test('accusé de réception : ne résout rien, idempotent ; action en liste fermée ; version contrôlée', async () => {
  const id = ids.s.id;
  assert.strictEqual((await appel('tremblay', 'POST', `/coordination/alertes/${id}/accuser`, { version: 999 })).statut, 409);
  let r = await appel('tremblay', 'POST', `/coordination/alertes/${id}/accuser`, {});
  assert.strictEqual(r.statut, 200); assert.strictEqual(r.corps.statut, 'accusee'); assert.strictEqual(r.corps.resolue_le, null);
  r = await appel('tremblay', 'POST', `/coordination/alertes/${id}/accuser`, {});
  assert.strictEqual(r.corps.deja, true);
  assert.strictEqual((await appel('tremblay', 'POST', `/coordination/alertes/${id}/action`, { action: 'texte libre' })).statut, 400);
  r = await appel('tremblay', 'POST', `/coordination/alertes/${id}/action`, { action: 'contact_responsable' });
  assert.strictEqual(r.corps.statut, 'en_action'); assert.strictEqual(r.corps.action_code, 'contact_responsable');
  // L'entretien n'est ni responsable ni remplaçant de cette alerte
  assert.strictEqual((await appel('entretien', 'POST', `/coordination/alertes/${id}/resoudre`, {})).statut, 403);
});

test('escalade : sans réponse avant l’échéance → niveau suivant, notification, une seule fois par échéance', async () => {
  // Un autre fait de Mont-Bellevue : le nettoyage en attente (responsable initial : entretien)
  const nett = (await suivisDe('nettoyage_en_attente'))[0];
  assert.ok(nett, 'nettoyage en attente suivi'); assert.strictEqual(nett.responsable_role, 'entretien');
  await pool.query("UPDATE suivis_alertes SET echeance = now() - interval '1 minute' WHERE id = $1", [nett.id]);
  const [n1, n2] = await Promise.all([suivi.escalader(pool), suivi.escalader(pool)]);
  assert.ok(n1 + n2 >= 1);
  const apres = (await pool.query('SELECT * FROM suivis_alertes WHERE id = $1', [nett.id])).rows[0];
  assert.strictEqual(apres.escalade_niveau, 1); assert.strictEqual(apres.responsable_role, 'coordonnateur'); assert.strictEqual(apres.remplacant_role, 'gestionnaire');
  assert.ok(new Date(apres.echeance) > new Date());
  const notifs = (await pool.query("SELECT vars FROM notifications WHERE etablissement_id = $1 AND code = 'alerte_escalade'", [ids.mb])).rows;
  assert.strictEqual(notifs.filter((x) => Number(x.vars.niveau) === 1).length, 1, 'une seule notification malgré deux balayages');
  // Une alerte en action n'est pas escaladée
  await pool.query("UPDATE suivis_alertes SET echeance = now() - interval '1 minute' WHERE id = $1", [ids.s.id]);
  await suivi.escalader(pool);
  assert.strictEqual((await pool.query('SELECT escalade_niveau FROM suivis_alertes WHERE id = $1', [ids.s.id])).rows[0].escalade_niveau, 0);
});

test('responsable absent : aucun compte actif pour le rôle → niveau suivant, tracé et notifié', async () => {
  await pool.query('UPDATE utilisateurs SET actif = false WHERE id = $1', [ids.admin]);
  try {
    const c = await require('../src/connecteurs').creerConnecteur(pool, 'ADT suivi', ids.mb);
    await pool.query("UPDATE connecteurs SET cree_le = now() - interval '3 hours' WHERE id = $1", [c.id]);
    await suivi.synchroniserEtab(pool, ids.mb);
    const s = (await suivisDe('connecteur_silencieux'))[0];
    assert.strictEqual(s.escalade_niveau, 1); assert.strictEqual(s.responsable_role, 'gestionnaire');
    const n = (await pool.query("SELECT vars FROM notifications WHERE etablissement_id = $1 AND code = 'alerte_responsable_absent'", [ids.mb])).rows;
    assert.ok(n.some((x) => x.vars.absent === 'admin_etab' && x.vars.role === 'gestionnaire'));
    ids.connecteur = c.id;
  } finally { await pool.query('UPDATE utilisateurs SET actif = true WHERE id = $1', [ids.admin]); }
});

test('fait disparu : « levée », jamais « résolue » sans confirmation ; puis résolution confirmée par une personne', async () => {
  await pool.query("INSERT INTO messages_connecteur (connecteur_id, identifiant, evenement, statut) VALUES ($1, 'x-1', 'A01', 'applique')", [ids.connecteur]);
  await suivi.synchroniserEtab(pool, ids.mb);
  const s = (await suivisDe('connecteur_silencieux'))[0];
  assert.strictEqual(s.statut, 'levee'); assert.ok(s.levee_le); assert.strictEqual(s.resolue_le, null);
  const r = await appel('admin', 'POST', `/coordination/alertes/${s.id}/resoudre`, {});
  assert.strictEqual(r.statut, 200); assert.strictEqual(r.corps.statut, 'resolue'); assert.ok(r.corps.resolue_nom);
  assert.strictEqual((await appel('admin', 'POST', `/coordination/alertes/${s.id}/resoudre`, {})).statut, 409);
  const j = (await appel('admin', 'GET', `/coordination/alertes/${s.id}/journal`)).corps.map((x) => x.action);
  assert.deepStrictEqual(j, ['responsable_absent', 'ouverture', 'levee', 'resolution_confirmee']);
  // Le même fait redétecté plus tard ouvre un nouveau suivi
  await pool.query("UPDATE messages_connecteur SET recu_le = recu_le WHERE false");
  const liste = await appel('admin', 'GET', `/coordination/alertes?etablissement_id=${ids.mb}`);
  assert.ok(liste.corps.some((x) => x.id === Number(s.id) && x.statut === 'resolue'), 'résolue visible 24 h');
});

test('grille d’escalade : lecture par le personnel, modification par l’administration seulement, appliquée aux nouveaux suivis', async () => {
  const g = await appel('tremblay', 'GET', `/coordination/escalades?etablissement_id=${ids.mb}`);
  assert.deepStrictEqual(g.corps.grille.ambulance_immobilisee.niveaux.map((x) => x.role), ['coordonnateur', 'gestionnaire', 'admin_etab']);
  const corps = { etablissement_id: ids.mb, type: 'transfert_sans_reponse', niveaux: [{ role: 'equipe_soins', delai_min: 5 }, { role: 'admin_etab', delai_min: 10 }] };
  assert.strictEqual((await appel('tremblay', 'PUT', '/coordination/escalades', corps)).statut, 403);
  assert.strictEqual((await appel('admin', 'PUT', '/coordination/escalades', { ...corps, niveaux: [{ role: 'paramedic', delai_min: 5 }] })).statut, 400);
  const r = await appel('admin', 'PUT', '/coordination/escalades', corps);
  assert.strictEqual(r.statut, 200); assert.strictEqual(r.corps.grille.transfert_sans_reponse.configuree, true);
  await compte('soins.suivi@demo.arrimo', 'equipe_soins', ids.mb);
  const type = (await pool.query('SELECT id FROM types_unite ORDER BY id LIMIT 1')).rows[0].id;
  await pool.query(`INSERT INTO transferts (numero, patient_ref, origine_id, destination_id, type_id, statut, date_demande)
    VALUES ('TR-SU1', 'P-91001', $1, $2, $3, 'demande', now() - interval '3 hours')`, [ids.mb, ids.sl, type]);
  await suivi.synchroniserEtab(pool, ids.mb);
  const s = (await suivisDe('transfert_sans_reponse'))[0];
  assert.strictEqual(s.responsable_role, 'equipe_soins'); assert.strictEqual(s.remplacant_role, 'admin_etab');
  assert.ok(new Date(s.echeance) - Date.now() <= 5 * 60000 + 5000);
});

test('isolation et journal immuable', async () => {
  assert.strictEqual((await appel('bouchard', 'GET', `/coordination/alertes?etablissement_id=${ids.mb}`)).statut, 403);
  assert.strictEqual((await appel('bouchard', 'POST', `/coordination/alertes/${ids.s.id}/accuser`, {})).statut, 403);
  await assert.rejects(pool.query('UPDATE suivis_alertes_journal SET action = $1', ['x']));
  await assert.rejects(pool.query('DELETE FROM suivis_alertes_journal'));
});
