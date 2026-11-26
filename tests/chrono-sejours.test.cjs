'use strict';
/**
 * Chrono · Patients et séjours (audit du 27 nov. 2026) et universalité (hébergement). Données fictives seulement.
 * - Tous les séjours actifs autorisés remontent (lit occupé, civière, admission sans civière), avec emplacement et étape.
 * - Seuils opérationnels tirés de la configuration : une durée qui dépasse son seuil n'est jamais verte ; sans seuil = bleu.
 * - Mêmes chiffres qu'Urgences (> 24 h) et NSA ; décomposition lue dans les historiques, rien n'est écrit ; séjour jamais remis à zéro.
 * - Signal en direct après une écriture sur un lit ; OG répond depuis la même source ; CHSLD : résidents, place conservée, pas de DSN.
 */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');

let pool; let serveur; let base; const tok = {}; const ids = {}; const envAvant = process.env.ARRIMO_ENV;
async function appel(qui, c, methode = 'GET', corps) {
  const r = await fetch(`${base}/api${c}`, { method: methode, headers: { Authorization: `Bearer ${tok[qui]}`, 'Content-Type': 'application/json' }, body: corps ? JSON.stringify(corps) : undefined });
  return { s: r.status, d: await r.json() };
}
async function compte(cle, role, etab) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [`${cle}@demo.arrimo`, `Nom ${cle}`, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etab]);
  tok[cle] = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${cle}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
}
const universel = async (qui, etab) => (await appel(qui, `/chrono/universel?etablissement_id=${etab}`)).d;

test.before(async () => {
  process.env.ARRIMO_ENV = 'demo'; require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  // Hôpital qui a des lits ET au moins deux civières (urgence)
  const h = (await pool.query("SELECT l.etablissement_id AS id FROM lits l JOIN etablissements e ON e.id = l.etablissement_id WHERE e.type_etablissement = 'hopital' GROUP BY 1 HAVING count(*) >= 6 ORDER BY 1 LIMIT 1")).rows[0].id;
  await pool.query("INSERT INTO civieres (etablissement_id, code) VALUES ($1, 'CT-01'), ($1, 'CT-02') ON CONFLICT DO NOTHING", [h]);
  ids.h = h; ids.autre = (await pool.query("SELECT id FROM etablissements WHERE type_etablissement = 'hopital' AND id <> $1 ORDER BY id LIMIT 1", [h])).rows[0].id;
  // Organisation réelle : un département Urgences (civières sans unité) et un département Médecine pour une unité
  ids.dUrg = (await pool.query("INSERT INTO departements (etablissement_id, code, nom) VALUES ($1, 'URG', 'Urgences') RETURNING id", [h])).rows[0].id;
  ids.dMed = (await pool.query("INSERT INTO departements (etablissement_id, code, nom) VALUES ($1, 'MED', 'Médecine') RETURNING id", [h])).rows[0].id;
  const [l1, l2, l3] = (await pool.query("SELECT id, unite_id, type_id FROM lits WHERE etablissement_id = $1 ORDER BY id LIMIT 3", [h])).rows;
  ids.l1 = l1.id; ids.l2 = l2.id; ids.l3 = l3.id; ids.type = l1.type_id;
  await pool.query('UPDATE unites SET departement_id = $2 WHERE id = $1', [l1.unite_id, ids.dMed]);
  // Remise à plat : aucun séjour actif dans cet hôpital, puis un jeu connu
  await pool.query("UPDATE lits SET etat = 'libre', patient_ref = NULL, nsa_depuis = NULL WHERE etablissement_id = $1", [h]);
  await pool.query("UPDATE civieres SET etat = 'libre', patient_ref = NULL, arrivee_le = NULL WHERE etablissement_id = $1", [h]);
  await pool.query("UPDATE demandes_admission SET statut = 'annulee' WHERE etablissement_id = $1 AND statut IN ('attente', 'assignee')", [h]);
  // Lit occupé (hospitalisé, sans seuil → bleu), lit NSA depuis 8 jours (orange), civière 30 h (orange, jamais verte)
  await pool.query("UPDATE lits SET etat = 'occupe', patient_ref = 'P-81001', etat_depuis = now() - interval '3 days' WHERE id = $1", [l1.id]);
  await pool.query("UPDATE lits SET etat = 'occupe', patient_ref = 'P-81002', etat_depuis = now() - interval '20 days', nsa_depuis = now() - interval '8 days' WHERE id = $1", [l2.id]);
  const [c1, c2] = (await pool.query('SELECT id FROM civieres WHERE etablissement_id = $1 ORDER BY id LIMIT 2', [h])).rows;
  ids.c1 = c1.id; ids.c2 = c2.id;
  await pool.query("UPDATE civieres SET etat = 'occupee', patient_ref = 'P-81003', arrivee_le = now() - interval '30 hours', etat_depuis = now() - interval '30 hours' WHERE id = $1", [c1.id]);
  // Civière 2 h + demande d'admission en attente depuis 5 h (> 240 min configurées : orange)
  await pool.query("UPDATE civieres SET etat = 'occupee', patient_ref = 'P-81004', arrivee_le = now() - interval '6 hours', etat_depuis = now() - interval '6 hours' WHERE id = $1", [c2.id]);
  await pool.query("INSERT INTO demandes_admission (etablissement_id, provenance, type_id, patient_ref, statut, cree_le) VALUES ($1, 'urgence', $2, 'P-81004', 'attente', now() - interval '5 hours')", [h, ids.type]);
  // Admission externe sans civière ni lit (bloc) : le patient attend tout de même un lit
  await pool.query("INSERT INTO demandes_admission (etablissement_id, provenance, type_id, patient_ref, statut, cree_le) VALUES ($1, 'bloc', $2, 'P-81005', 'attente', now() - interval '30 minutes')", [h, ids.type]);
  // Historique du patient hospitalisé : admis depuis l'urgence il y a 4 jours (le séjour ne repart pas de l'occupation du lit)
  await pool.query("INSERT INTO demandes_admission (etablissement_id, provenance, type_id, patient_ref, statut, cree_le, assignee_le, terminee_le) VALUES ($1, 'urgence', $2, 'P-81001', 'admise', now() - interval '4 days', now() - interval '3 days 2 hours', now() - interval '3 days')", [h, ids.type]);
  // L'épisode NSA est créé par le déclencheur existant (synchronisation NSA ↔ lits) : aucune double saisie
  await compte('coord', 'coordonnateur', h); await compte('ent', 'entretien', h); await compte('autre', 'coordonnateur', ids.autre);
});
test.after(async () => { serveur?.close(); await pool?.end(); if (envAvant === undefined) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = envAvant; });

test('Tous les séjours actifs autorisés remontent, avec département, emplacement et étape', async () => {
  const d = await universel('coord', ids.h);
  const refs = d.patients.map((x) => x.reference).sort();
  assert.deepStrictEqual(refs, ['P-81001', 'P-81002', 'P-81003', 'P-81004', 'P-81005'], JSON.stringify(refs));
  const p = Object.fromEntries(d.patients.map((x) => [x.reference, x]));
  assert.strictEqual(p['P-81001'].etape, 'hospitalise'); assert.strictEqual(p['P-81001'].departement, 'Médecine'); assert.ok(p['P-81001'].chambre && p['P-81001'].ressource);
  assert.strictEqual(p['P-81002'].etape, 'nsa');
  assert.strictEqual(p['P-81003'].etape, 'urgence_civiere'); assert.strictEqual(p['P-81003'].departement, 'Urgences', 'civière sans unité → Urgences');
  assert.strictEqual(p['P-81004'].etape, 'attente_lit'); assert.strictEqual(p['P-81004'].objet, 'civiere');
  assert.strictEqual(p['P-81005'].objet, 'admission'); assert.strictEqual(p['P-81005'].provenance, 'bloc');
  assert.ok(d.organisation.departements.some((x) => x.nom === 'Médecine'), 'filtres : départements réellement configurés');
  for (const x of d.patients) assert.ok(!('nom' in x) && !('prenom' in x) && !('priorite' in x), 'référence seulement, aucune priorité clinique');
});

test('Seuils : une durée qui dépasse son seuil n’est jamais verte ; sans seuil = bleu ; configuration de l’établissement', async () => {
  const p = Object.fromEntries((await universel('coord', ids.h)).patients.map((x) => [x.reference, x]));
  assert.strictEqual(p['P-81003'].niveau, 'orange', 'civière 30 h > 24 h');
  assert.strictEqual(p['P-81004'].niveau_etape, 'orange', 'attente de lit 5 h > 240 min');
  assert.strictEqual(p['P-81004'].seuil_source, 'attente_admission_max_min');
  assert.strictEqual(p['P-81002'].niveau, 'orange', 'NSA 8 jours > 7 jours');
  assert.strictEqual(p['P-81001'].niveau, 'bleu', 'hospitalisation sans seuil : en cours, jamais « verte » par défaut');
  assert.strictEqual(p['P-81005'].niveau, 'vert');
  // Seuil configuré plus court : la même attente passe en escalade (2 × seuil)
  const cfg = (await pool.query('SELECT config_id FROM etablissements WHERE id = $1', [ids.h])).rows[0].config_id;
  const avant = (await pool.query('SELECT attente_admission_max_min FROM config_pays WHERE id = $1', [cfg])).rows[0].attente_admission_max_min;
  await pool.query('UPDATE config_pays SET attente_admission_max_min = 120 WHERE id = $1', [cfg]);
  try {
    const q = (await universel('coord', ids.h)).patients.find((x) => x.reference === 'P-81004');
    assert.strictEqual(q.niveau, 'rouge'); assert.deepStrictEqual(q.seuils_min, { vigilance: 120, escalade: 240 });
  } finally { await pool.query('UPDATE config_pays SET attente_admission_max_min = $2 WHERE id = $1', [cfg, avant]); }
  const { niveauDuree } = require('../src/chrono-sejours');
  assert.strictEqual(niveauDuree(null, { vigilance: 1, escalade: 2 }, Date.now()), 'gris', 'inconnu, jamais 0');
});

test('Mêmes chiffres qu’Urgences (> 24 h) et que NSA ; indicateurs cohérents avec la liste', async () => {
  const d = await universel('coord', ids.h);
  const stats = (await require('../src/civieres').statsUrgence(pool, [ids.h])).get(ids.h);
  const plus24 = d.patients.filter((x) => x.objet === 'civiere' && Date.now() - new Date(x.sejour_depuis) >= 24 * 3600000).length;
  assert.strictEqual(plus24, stats.plus_24h, 'Chrono = Urgences');
  assert.strictEqual(d.patients.filter((x) => x.objet === 'civiere').length, stats.occupees);
  const nsa = (await pool.query('SELECT count(*)::int n FROM lits WHERE etablissement_id = $1 AND nsa_depuis IS NOT NULL', [ids.h])).rows[0].n;
  assert.strictEqual(d.patients.filter((x) => x.etape === 'nsa').length, nsa, 'Chrono = NSA');
  assert.strictEqual(d.resume.patients.total, d.patients.length); assert.strictEqual(d.resume.patients.orange, d.patients.filter((x) => x.niveau === 'orange').length);
});

test('Fiche cliquable : décomposition lue dans les historiques, séjour jamais remis à zéro, aucune écriture', async () => {
  const avant = (await pool.query('SELECT (SELECT count(*) FROM journal) + (SELECT count(*) FROM demandes_admission) + (SELECT count(*) FROM nsa_episodes) AS n')).rows[0].n;
  const r = await appel('coord', `/chrono/sejour?etablissement_id=${ids.h}&reference=P-81001`);
  assert.strictEqual(r.s, 200, JSON.stringify(r.d));
  const et = r.d.etapes.map((e) => e.etape);
  assert.ok(et.includes('attente_lit') && et.includes('lit_assigne') && et.includes('hospitalise'), et.join(','));
  // Durée totale depuis la demande d'admission (4 jours), pas depuis l'occupation du lit (3 jours)
  assert.ok(r.d.duree_totale_min >= 4 * 24 * 60 - 2, `séjour ${r.d.duree_totale_min} min`);
  const close = r.d.etapes.find((e) => e.etape === 'lit_assigne'); assert.strictEqual(close.en_cours, false); assert.strictEqual(close.duree_min, 120, 'étape close : durée réelle');
  assert.ok(r.d.par_departement.some((x) => x.departement === 'Médecine'));
  assert.ok(r.d.etapes.some((e) => e.rang_delai === 1));
  const apres = (await pool.query('SELECT (SELECT count(*) FROM journal) + (SELECT count(*) FROM demandes_admission) + (SELECT count(*) FROM nsa_episodes) AS n')).rows[0].n;
  assert.strictEqual(apres, avant, 'lecture seule');
  const civ = await appel('coord', `/chrono/sejour?etablissement_id=${ids.h}&reference=P-81003`);
  assert.ok(civ.d.etapes.some((e) => e.etape === 'urgence_civiere' && e.en_cours), 'civière en cours lue dans l’état courant');
  // Permissions : autre établissement, entretien, référence invalide ou inconnue
  assert.strictEqual((await appel('autre', `/chrono/sejour?etablissement_id=${ids.h}&reference=P-81001`)).s, 403);
  assert.strictEqual((await appel('ent', `/chrono/sejour?etablissement_id=${ids.h}&reference=P-81001`)).s, 403);
  assert.strictEqual((await appel('coord', `/chrono/sejour?etablissement_id=${ids.h}&reference=${encodeURIComponent("x' OR 1=1")}`)).s, 400);
  assert.strictEqual((await appel('coord', `/chrono/sejour?etablissement_id=${ids.h}&reference=P-99999`)).s, 404);
  assert.strictEqual((await universel('ent', ids.h)).patients.length, 0, 'entretien : aucun patient');
});

test('Synchronisation : une écriture sur un lit prévient les écrans ; OG répond depuis la même source', async () => {
  const flux = require('../src/flux'); const avant = flux.etat().emis;
  const l = (await pool.query('SELECT id, version FROM lits WHERE id = $1', [ids.l3])).rows[0];
  const r = await appel('coord', `/lits/${l.id}/action`, 'POST', { action: 'hors_service', version: l.version, motif: 'equipement' });
  assert.ok(r.s < 400, JSON.stringify(r.d));
  await new Promise((ok) => setTimeout(ok, 450));
  assert.ok(flux.etat().emis > avant, 'signal émis après validation');
  const og = (await appel('coord', '/copilote/question', 'POST', { etablissement_id: ids.h, question: 'Combien de patients en escalade ou en vigilance ?' })).d;
  assert.match(og.reponse, /patient\(s\) présent\(s\)/, og.reponse); assert.match(og.reponse, /jamais une priorité clinique/);
  const og2 = (await appel('coord', '/copilote/question', 'POST', { etablissement_id: ids.h, question: 'Depuis combien de temps P-81004 attend ?' })).d;
  assert.match(og2.reponse, /P-81004/, og2.reponse);
});

test('Universalité : Chrono permis à tous les types ; CHSLD = résidents et séjours, place conservée jamais disponible ; DSN hôpital seulement', async () => {
  const TE = require('../src/types-etablissement');
  for (const type of ['hopital', 'chsld', 'rpa', 'ccs', 'entreprise_ambulanciere']) assert.ok(TE.moduleActif({ type_etablissement: type, modules: { chrono: true } }, 'chrono'), type);
  for (const type of ['chsld', 'rpa', 'maison_aines']) assert.ok(!TE.moduleActif({ type_etablissement: type, modules: { dsn: true } }, 'dsn'), `DSN refusé : ${type}`);
  assert.ok(TE.moduleActif({ type_etablissement: 'hopital', modules: { dsn: true } }, 'dsn'));
  const fs = require('node:fs'); const path = require('node:path');
  assert.ok(!/data-type="hopital"[^>]*data-v="chrono"/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8')), 'onglet Chrono non réservé aux hôpitaux');
  // CHSLD fictif : un résident présent, un résident hospitalisé (place conservée)
  const h = (await pool.query('SELECT latitude, longitude, config_id FROM etablissements WHERE id = $1', [ids.h])).rows[0];
  const c = (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, module_actif, type_etablissement, modules, conservation_place_jours)
    VALUES ('CH-CHR', 'CHSLD Chrono', 'Ville', $1, $2, $3, true, 'chsld', '{"chrono": true}', 10) RETURNING id`, [h.latitude, h.longitude, h.config_id])).rows[0].id;
  const tu = (await pool.query("SELECT id FROM types_unite WHERE code = 'HLD'")).rows[0]?.id || ids.type;
  const un = (await pool.query("INSERT INTO unites (etablissement_id, type_id, nom) VALUES ($1, $2, 'Unité Bleue') RETURNING id", [c, tu])).rows[0].id;
  const ch = (await pool.query("INSERT INTO chambres (unite_id, numero) VALUES ($1, '101') RETURNING id", [un])).rows[0].id;
  const lit = async (code, ref) => (await pool.query("INSERT INTO lits (chambre_id, unite_id, type_id, etablissement_id, code, etat, patient_ref) VALUES ($1, $2, $3, $4, $5, 'occupe', $6) RETURNING id", [ch, un, tu, c, code, ref])).rows[0].id;
  const la = await lit('101-A', 'R-90001'); const lb = await lit('101-B', 'R-90002');
  const res = async (ref, statut, litId) => (await pool.query(`INSERT INTO residents (etablissement_id, reference, prenom, nom, date_naissance, statut, lit_id, admis_le)
    VALUES ($1, $2, 'Fictif', 'Résident', '1940-01-01', $3, $4, now() - interval '200 days') RETURNING id`, [c, ref, statut, litId])).rows[0].id;
  await res('R-90001', 'present', la);
  const rb = await res('R-90002', 'hospitalise', lb);
  await pool.query("INSERT INTO resident_mouvements (resident_id, etablissement_id, type, de_lit_id, date) VALUES ($1, $2, 'admission', $3, now() - interval '200 days'), ($1, $2, 'depart_hopital', $3, now() - interval '9 days 12 hours')", [rb, c, lb]);
  await compte('chs', 'coordonnateur', c);
  const d = await universel('chs', c);
  const p = Object.fromEntries(d.patients.map((x) => [x.reference, x]));
  assert.strictEqual(p['R-90001'].etape, 'resident_present'); assert.strictEqual(p['R-90001'].niveau, 'bleu');
  assert.strictEqual(p['R-90002'].etape, 'hospitalise_externe'); assert.strictEqual(p['R-90002'].niveau, 'orange', '9,5 j sur 10 j de conservation');
  assert.ok(p['R-90002'].place_conservee);
  assert.ok(d.capacites.some((x) => x.phase === 'place_conservee' && x.ressource === '101-B'), 'place conservée visible, jamais disponible');
  const dec = await appel('chs', `/chrono/sejour?etablissement_id=${c}&reference=R-90002`);
  assert.strictEqual(dec.s, 200, JSON.stringify(dec.d)); assert.deepStrictEqual(dec.d.etapes.map((e) => e.etape), ['resident_present', 'hospitalise_externe']);
  assert.strictEqual((await appel('chs', `/dsn/patients?etablissement_id=${c}`)).s, 403, 'aucun DSN en CHSLD');
});
