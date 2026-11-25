'use strict';
/**
 * Chantier coordination, lot 1 « Détecter » (26 nov. 2026) : Vigilance transversale et capacité réelle.
 * Ambulance immobilisée (paliers vigilance / escalade / critique, cause inconnue tant qu'aucun motif n'est consigné),
 * ambulances annoncées au-delà des civières libres (scénario A), transport en retard ou non confirmé (scénario D),
 * placement accepté non réalisé (scénario C), transfert sans réponse, connecteur silencieux (scénario G),
 * capacité réelle (vides ≠ opérationnels), anglais, isolation, et rien n'est modifié par la lecture. Données fictives seulement.
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
async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${tokens[qui]}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined });
  const texte = await r.text(); let corpsJ = null; try { corpsJ = JSON.parse(texte); } catch { corpsJ = texte; }
  return { statut: r.status, corps: corpsJ };
}
async function compte(email, role, orgId) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [email, email, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (orgId) await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, orgId]);
}
async function connecter(q, email) {
  const r = await appel(null, 'POST', '/connexion', { email, mot_de_passe: MOT_DE_PASSE_DEMO });
  assert.strictEqual(r.statut, 200, `connexion ${q}`); tokens[q] = r.corps.token;
}
const il_y_a = (min) => new Date(Date.now() - min * 60000).toISOString();
const position = (unite, pos, min) => appel('para', 'POST', `/secours/unites/${unite}/position`, { latitude: pos.latitude, longitude: pos.longitude, precision_m: 10, horodatage: il_y_a(min) });
const vigilance = async (qui = 'tremblay', etab = ids.mb, langue = '') => {
  const r = await appel(qui, 'GET', `/vigilance?etablissement_id=${etab}${langue ? `&langue=${langue}` : ''}`);
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps)); return r.corps;
};
const alerte = (v, type, ressource) => v.alertes.find((a) => a.type === type && (ressource == null || a.ressource === ressource));

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL);
  await viderBase(pool);
  await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool));
  base = `http://127.0.0.1:${serveur.address().port}`;
  const e = (await pool.query("SELECT id, latitude, longitude, config_id FROM etablissements WHERE code IN ('MB', 'SL') ORDER BY code")).rows;
  [ids.mb, ids.sl] = e.map((x) => x.id); ids.posMb = { latitude: e[0].latitude, longitude: e[0].longitude }; ids.config = e[0].config_id;
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"liaison_secours": true, "chrono": true}' WHERE id IN ($1, $2)`, [ids.mb, ids.sl]);
  ids.amb = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('AMB-COORD', 'Ambulances Coord', 'ambulancier', ARRAY['ambulance'], $1) RETURNING id", [ids.config])).rows[0].id;
  const unite = async (n) => (await pool.query('INSERT INTO unites_secours (organisation_id, numero) VALUES ($1, $2) RETURNING id', [ids.amb, n])).rows[0].id;
  ids.u1 = await unite('70-01'); ids.u2 = await unite('70-02'); ids.u3 = await unite('70-03');
  await compte('para.coord@demo.arrimo', 'paramedic', ids.amb);
  await connecter('para', 'para.coord@demo.arrimo'); await connecter('tremblay', 'tremblay@demo.arrimo'); await connecter('bouchard', 'bouchard@demo.arrimo');
  ids.type = (await pool.query('SELECT id FROM types_unite ORDER BY id LIMIT 1')).rows[0].id;
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('ambulance immobilisée : palier critique au-delà de la cible totale, cause inconnue tant qu’aucun motif n’est consigné', async () => {
  await position(ids.u1, ids.posMb, 50); await position(ids.u1, ids.posMb, 49);
  const p = (await pool.query("SELECT * FROM passages_chrono WHERE unite_id = $1 ORDER BY id DESC LIMIT 1", [ids.u1])).rows[0];
  assert.strictEqual(p.statut, 'a_la_porte'); ids.p1 = p.id;
  // Chrono : le niveau historique reste « rouge » ; le palier dit « critique »
  const ch = await appel('tremblay', 'GET', `/chrono?etablissement_id=${ids.mb}`);
  const fiche = ch.corps.a_la_porte.find((x) => x.id === p.id);
  assert.strictEqual(fiche.niveau, 'rouge'); assert.strictEqual(fiche.palier, 'critique');
  let v = await vigilance();
  let a = alerte(v, 'ambulance_immobilisee', '70-01');
  assert.ok(a, 'ambulance immobilisée signalée');
  assert.strictEqual(a.palier, 'critique'); assert.strictEqual(a.niveau, 'eleve');
  assert.match(a.titre, /^Ambulance 70-01 \(Ambulances Coord\) à la porte depuis (49|5\d) min, responsabilité non transférée — palier critique\.$/);
  assert.strictEqual(a.cause.nature, 'hypothese', 'sans motif, la cause n’est pas inventée');
  assert.strictEqual(a.responsable, 'Responsable opérationnel de l’urgence');
  assert.deepStrictEqual(a.objet, { type: 'passage_chrono', id: p.id, numero: p.numero });
  // Motif hors liste refusé ; nouveau motif « triage saturé » accepté puis repris comme fait
  assert.strictEqual((await appel('tremblay', 'POST', `/chrono/passages/${p.id}/retard`, { etablissement_id: ids.mb, motif: 'meteo' })).statut, 400);
  assert.strictEqual((await appel('tremblay', 'POST', `/chrono/passages/${p.id}/retard`, { etablissement_id: ids.mb, motif: 'triage' })).statut, 200);
  v = await vigilance(); a = alerte(v, 'ambulance_immobilisee', '70-01');
  assert.strictEqual(a.cause.nature, 'fait'); assert.strictEqual(a.cause.texte, 'Motif consigné dans Chrono : triage saturé.');
  // Anglais : titre, cause et responsable traduits
  const en = alerte(await vigilance('tremblay', ids.mb, 'en'), 'ambulance_immobilisee', '70-01');
  assert.match(en.titre, /^Ambulance 70-01 \(Ambulances Coord\) at the door for (49|5\d) min, responsibility not transferred — critical level\.$/);
  assert.strictEqual(en.cause.texte, 'Reason recorded in Chrono: triage at capacity.');
  assert.strictEqual(en.responsable, 'Emergency operations lead');
  // « Cause inconnue » est un motif consignable
  assert.strictEqual((await appel('tremblay', 'POST', `/chrono/passages/${p.id}/retard`, { etablissement_id: ids.mb, motif: 'inconnue' })).statut, 200);
});

test('paliers : vigilance puis escalade selon la configuration ; sous le seuil orange, aucune alerte', async () => {
  const chrono = require('../src/chrono');
  const c = { orange: 15, porte: 20, total: 45 };
  assert.deepStrictEqual([0, 14, 15, 19, 20, 44, 45, 90].map((m) => chrono.palier(m, c)),
    ['normal', 'normal', 'vigilance', 'vigilance', 'escalade', 'escalade', 'critique', 'critique']);
  assert.strictEqual(chrono.palier(null, c), null);
  await position(ids.u2, ids.posMb, 17); await position(ids.u2, ids.posMb, 16);
  let a = alerte(await vigilance(), 'ambulance_immobilisee', '70-02');
  assert.strictEqual(a.palier, 'vigilance'); assert.strictEqual(a.niveau, 'modere');
  await pool.query('UPDATE config_pays SET chrono_orange_min = 30, chrono_cible_porte_min = 35 WHERE id = $1', [ids.config]);
  try {
    assert.ok(!alerte(await vigilance(), 'ambulance_immobilisee', '70-02'), 'sous le seuil configuré : pas d’alerte');
  } finally {
    await pool.query('UPDATE config_pays SET chrono_orange_min = 15, chrono_cible_porte_min = 20 WHERE id = $1', [ids.config]);
  }
  await pool.query('UPDATE config_pays SET chrono_cible_porte_min = 16 WHERE id = $1', [ids.config]);
  try {
    a = alerte(await vigilance(), 'ambulance_immobilisee', '70-02');
    assert.strictEqual(a.palier, 'escalade'); assert.strictEqual(a.niveau, 'eleve');
  } finally {
    await pool.query('UPDATE config_pays SET chrono_cible_porte_min = 20 WHERE id = $1', [ids.config]);
  }
});

test('scénario A : ambulances annoncées au-delà des civières libres ; aucune préalerte modifiée', async () => {
  const libres = (await pool.query("SELECT count(*)::int AS n FROM civieres WHERE etablissement_id = $1 AND actif AND etat = 'libre'", [ids.mb])).rows[0].n;
  for (let i = 0; i <= libres; i += 1) {
    await pool.query(`INSERT INTO prealertes (numero, organisation_id, unite_id, destination_id, priorite, categorie) VALUES ($1, $2, $3, $4, 'urgente', 'medicale')`,
      [`PA-CO${String(i).padStart(3, '0')}`, ids.amb, ids.u3, ids.mb]);
  }
  const avant = (await pool.query("SELECT id, statut, version FROM prealertes WHERE numero LIKE 'PA-CO%' ORDER BY id")).rows;
  const v = await vigilance();
  const a = alerte(v, 'ambulances_attendues');
  assert.ok(a); assert.strictEqual(a.titre, `${libres + 1} ambulance(s) annoncée(s) pour ${libres} civière(s) libre(s) à l’urgence.`);
  assert.strictEqual(a.niveau, libres === 0 ? 'eleve' : 'modere');
  assert.match(a.action, /La destination reste décidée par le CCS/);
  assert.strictEqual(v.capacite.ambulances_attendues, libres + 1);
  assert.deepStrictEqual((await pool.query("SELECT id, statut, version FROM prealertes WHERE numero LIKE 'PA-CO%' ORDER BY id")).rows, avant, 'la lecture ne change rien');
  // Une préalerte arrivée ne compte plus
  await pool.query("UPDATE prealertes SET statut = 'annulee' WHERE numero LIKE 'PA-CO%'");
  assert.ok(!alerte(await vigilance(), 'ambulances_attendues'));
});

test('scénario D : transport en retard (non accepté = élevé), transport imminent non confirmé, destination libre acceptée', async () => {
  const ins = (numero, statut, minutes) => pool.query(`INSERT INTO demandes_transport (numero, organisation_id, origine_id, destination_id, destination_libelle, resident_ref, statut, heure_souhaitee)
    VALUES ($1, $2, $3, $4, $5, 'R-90001', $6, now() + make_interval(mins => $7)) RETURNING id`,
  [numero, ids.amb, ids.mb, numero === 'DT-CO3' ? null : ids.sl, numero === 'DT-CO3' ? 'Domicile' : null, statut, minutes]);
  await ins('DT-CO1', 'demandee', -90); await ins('DT-CO2', 'acceptee', -45); await ins('DT-CO3', 'demandee', 60); await ins('DT-CO4', 'acceptee', -10);
  const v = await vigilance();
  const r1 = alerte(v, 'transport_en_retard', 'DT-CO1'); const r2 = alerte(v, 'transport_en_retard', 'DT-CO2');
  assert.strictEqual(r1.niveau, 'eleve'); assert.strictEqual(r1.cause.texte, 'La demande n’a pas été acceptée par le transporteur.');
  assert.strictEqual(r2.niveau, 'modere'); assert.strictEqual(r2.cause.texte, 'Transport accepté, prise en charge non enregistrée.');
  assert.match(r1.titre, /^Transport DT-CO1 \(Ambulances Coord\) : heure souhaitée dépassée de 1 h 30, résident non pris en charge\.$/);
  const imm = alerte(v, 'transport_non_confirme', 'DT-CO3');
  assert.ok(imm, 'transport imminent non accepté'); assert.strictEqual(imm.unite, `${(await pool.query('SELECT nom FROM etablissements WHERE id = $1', [ids.mb])).rows[0].nom} → Domicile`);
  assert.ok(!alerte(v, 'transport_en_retard', 'DT-CO4'), 'dans la marge configurée : rien');
  // Le transporteur et l'établissement de destination voient le même fait (destination SL)
  assert.ok(alerte(await vigilance('bouchard', ids.sl), 'transport_en_retard', 'DT-CO1'));
  assert.strictEqual((await pool.query("SELECT statut FROM demandes_transport WHERE numero = 'DT-CO1'")).rows[0].statut, 'demandee');
});

test('scénario C : placement accepté non réalisé, sans identité affichée', async () => {
  await pool.query(`INSERT INTO demandes_hebergement (etablissement_id, numero, provenance, prenom, nom, statut, hopital_id, depart_prevu_le)
    VALUES ($1, 'DH-CO1', 'hopital', 'Fictif', 'Résident', 'acceptee', $2, now() - interval '3 hours')`, [ids.sl, ids.mb]);
  await pool.query(`INSERT INTO demandes_hebergement (etablissement_id, numero, provenance, statut, hopital_id, modifie_le)
    VALUES ($1, 'DH-CO2', 'hopital', 'acceptee', $2, now() - interval '30 hours')`, [ids.sl, ids.mb]);
  const v = await vigilance();
  const a1 = alerte(v, 'placement_non_realise', 'DH-CO1'); const a2 = alerte(v, 'placement_non_realise', 'DH-CO2');
  assert.strictEqual(a1.niveau, 'modere'); assert.match(a1.titre, /^Placement DH-CO1 accepté : départ prévu dépassé de 3 h, départ de l’hôpital non enregistré\.$/);
  assert.strictEqual(a2.niveau, 'faible'); assert.match(a2.titre, /^Placement DH-CO2 accepté depuis 30 h sans départ planifié\.$/);
  assert.ok(!JSON.stringify(v).includes('Fictif'), 'aucun nom dans Vigilance');
  await pool.query("UPDATE demandes_hebergement SET depart_hopital_le = now() WHERE numero = 'DH-CO1'");
  assert.ok(!alerte(await vigilance(), 'placement_non_realise', 'DH-CO1'), 'départ enregistré : l’alerte disparaît');
});

test('transfert sans réponse : signalé aux deux établissements, au-delà du délai configuré seulement', async () => {
  await pool.query(`INSERT INTO transferts (numero, patient_ref, origine_id, destination_id, type_id, statut, date_demande)
    VALUES ('TR-CO1', 'P-90001', $1, $2, $3, 'demande', now() - interval '2 hours'), ('TR-CO2', 'P-90002', $1, $2, $3, 'demande', now() - interval '10 minutes')`,
  [ids.mb, ids.sl, ids.type]);
  const v = await vigilance();
  assert.ok(alerte(v, 'transfert_sans_reponse', 'TR-CO1')); assert.ok(!alerte(v, 'transfert_sans_reponse', 'TR-CO2'));
  assert.strictEqual(alerte(v, 'transfert_sans_reponse', 'TR-CO1').responsable, 'Établissement d’accueil');
  assert.ok(alerte(await vigilance('bouchard', ids.sl), 'transfert_sans_reponse', 'TR-CO1'));
});

test('scénario G : connecteur silencieux signalé, puis disparu à la reprise des messages', async () => {
  const c = await require('../src/connecteurs').creerConnecteur(pool, 'ADT fictif', ids.mb);
  const cid = c.id ?? c.connecteur?.id;
  await pool.query("UPDATE connecteurs SET cree_le = now() - interval '3 hours' WHERE id = $1", [cid]);
  let a = alerte(await vigilance(), 'connecteur_silencieux', 'ADT fictif');
  assert.ok(a); assert.strictEqual(a.titre, 'Connecteur ADT fictif : aucun message reçu depuis sa création.');
  await pool.query("INSERT INTO messages_connecteur (connecteur_id, identifiant, evenement, statut, recu_le) VALUES ($1, 'm-1', 'A01', 'applique', now() - interval '2 hours')", [cid]);
  a = alerte(await vigilance(), 'connecteur_silencieux', 'ADT fictif');
  assert.match(a.titre, /^Connecteur ADT fictif : aucun message reçu depuis 2 h ; les données qu’il alimente peuvent être périmées\.$/);
  await pool.query("INSERT INTO messages_connecteur (connecteur_id, identifiant, evenement, statut) VALUES ($1, 'm-2', 'A01', 'applique')", [cid]);
  assert.ok(!alerte(await vigilance(), 'connecteur_silencieux', 'ADT fictif'));
});

test('capacité réelle : vides, opérationnels et non confirmés comptés à part, cohérents avec les lits', async () => {
  const v = await vigilance();
  const lits = (await pool.query(`SELECT l.etat, l.disponibilite_confirmee_le > now() - make_interval(mins => c.confirmation_lit_validite_min) AS ok
    FROM lits l JOIN etablissements e ON e.id = l.etablissement_id JOIN config_pays c ON c.id = e.config_id WHERE l.etablissement_id = $1 AND l.actif`, [ids.mb])).rows;
  const cap = v.capacite.lits;
  assert.strictEqual(cap.total, lits.length);
  assert.strictEqual(cap.vides, lits.filter((l) => l.etat === 'libre').length);
  assert.strictEqual(cap.operationnels, lits.filter((l) => l.etat === 'libre' && l.ok).length);
  assert.strictEqual(cap.vides, cap.operationnels + cap.non_confirmes);
  assert.strictEqual(cap.vides + cap.reserves + cap.occupes + cap.nettoyage + cap.indisponibles, cap.total);
  assert.ok(v.capacite.validite_confirmation_min > 0);
});

test('isolation : un autre établissement ne lit pas ces alertes', async () => {
  assert.strictEqual((await appel('bouchard', 'GET', `/vigilance?etablissement_id=${ids.mb}`)).statut, 403);
});
