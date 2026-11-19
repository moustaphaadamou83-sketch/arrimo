'use strict';
/**
 * Transferts (20 nov. 2026) : la même fiche pour l'origine, la destination, la coordination et le transporteur (et rien pour les autres),
 * délais décision → départ → arrivée depuis l'Horloge, alertes de blocage levées et déclenchées, centrale régionale des urgents,
 * rapatriement proposé (jamais déclenché), accepté ou refusé avec motif fermé, motif de refus fermé du transfert ; FR/EN.
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
async function appel(qui, methode, chemin, corps, entetes = {}) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${tokens[qui]}` } : {}), ...entetes },
    body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
async function connecter(q, email) {
  const r = await appel(null, 'POST', '/connexion', { email, mot_de_passe: MOT_DE_PASSE_DEMO }); assert.strictEqual(r.statut, 200, q); tokens[q] = r.corps.token;
}
const idEtab = async (code) => (await pool.query('SELECT id FROM etablissements WHERE code = $1', [code])).rows[0].id;
async function nouveauTransfert(ref, urgent = true) {
  const rec = await appel('tremblay', 'GET', `/recherche?depuis=${ids.mb}&type_id=${ids.si}`);
  const s = rec.corps.suggestions.find((x) => x.libres && x.partage === 'complet' && x.etablissement_id === ids.sl);
  const tr = await appel('tremblay', 'POST', '/transferts', { origine_id: ids.mb, destination_id: ids.sl, type_id: ids.si, lit_id: s.lit.id, version: s.lit.version, patient_ref: ref, urgent });
  assert.strictEqual(tr.statut, 200, JSON.stringify(tr.corps));
  return tr.corps.id;
}

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  ids.mb = await idEtab('MB'); ids.sl = await idEtab('SL'); ids.lm = await idEtab('LM');
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"transferts_suivi": true}' WHERE id IN ($1, $2)`, [ids.mb, ids.sl]);
  ids.si = (await pool.query("SELECT t.id FROM types_unite t JOIN etablissements e ON e.config_id = t.config_id WHERE e.id = $1 AND t.code = 'SI'", [ids.mb])).rows[0].id;
  await pool.query(`UPDATE lits SET disponibilite_confirmee_le = now() WHERE etat = 'libre'`);
  const cfg = (await pool.query('SELECT config_id FROM etablissements WHERE id = $1', [ids.mb])).rows[0].config_id;
  ids.amb = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('AMB-TS', 'Ambulances TS', 'ambulancier', '{ambulance}', $1) RETURNING id", [cfg])).rows[0].id;
  ids.autre = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('AMB-TS2', 'Ambulances TS2', 'ambulancier', '{ambulance}', $1) RETURNING id", [cfg])).rows[0].id;
  ids.ccs = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('CCS-TS', 'CCS TS', 'ccs', '{ccs}', $1) RETURNING id", [cfg])).rows[0].id;
  ids.u1 = (await pool.query("INSERT INTO unites_secours (organisation_id, numero) VALUES ($1, '60-01') RETURNING id", [ids.amb])).rows[0].id;
  for (const [email, role, org] of [['para.ts@demo.arrimo', 'paramedic', ids.amb], ['parab.ts@demo.arrimo', 'paramedic', ids.autre], ['ccs.ts@demo.arrimo', 'repartiteur', ids.ccs]]) {
    const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $1, $2, $3) RETURNING id', [email, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
    await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, org]);
  }
  await connecter('tremblay', 'tremblay@demo.arrimo'); await connecter('bouchard', 'bouchard@demo.arrimo'); await connecter('gagnon', 'gagnon@demo.arrimo');
  await connecter('reseau', 'reseau@demo.arrimo'); await connecter('para', 'para.ts@demo.arrimo'); await connecter('paraB', 'parab.ts@demo.arrimo'); await connecter('ccs', 'ccs.ts@demo.arrimo');
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('fiche unique : origine, destination, coordination et transporteur voient la même fiche ; la référence patient reste aux hôpitaux', async () => {
  ids.t1 = await nouveauTransfert('P-70001');
  await pool.query("INSERT INTO prealertes (numero, organisation_id, unite_id, destination_id, priorite, categorie, transfert_id) VALUES ('PA-TS1', $1, $2, $3, 'urgente', 'medicale', $4)", [ids.amb, ids.u1, ids.sl, ids.t1]);
  const vues = {};
  for (const [qui, chemin] of [['tremblay', '/transferts-suivi'], ['bouchard', '/transferts-suivi'], ['reseau', '/transferts-suivi'], ['para', '/secours/transferts']]) {
    const r = await appel(qui, 'GET', `${chemin}/${ids.t1}`); assert.strictEqual(r.statut, 200, `${qui} ${JSON.stringify(r.corps)}`); vues[qui] = r.corps;
  }
  assert.deepStrictEqual([vues.tremblay.cote, vues.bouchard.cote, vues.reseau.cote, vues.para.cote], ['origine', 'destination', 'coordination', 'transporteur']);
  for (const q of ['bouchard', 'reseau', 'para']) assert.deepStrictEqual(vues[q].heures, vues.tremblay.heures, q);
  assert.strictEqual(vues.tremblay.patient_ref, 'P-70001'); assert.strictEqual(vues.reseau.patient_ref, undefined); assert.strictEqual(vues.para.patient_ref, undefined);
  assert.ok(!JSON.stringify(vues.para).includes('P-70001'));
  assert.strictEqual(vues.para.transport.unite, '60-01');
  // Rien pour un autre hôpital ni une autre entreprise
  assert.strictEqual((await appel('gagnon', 'GET', `/transferts-suivi/${ids.t1}`)).statut, 404);
  assert.strictEqual((await appel('paraB', 'GET', `/secours/transferts/${ids.t1}`)).statut, 404);
});

test('délais décision → départ → arrivée depuis l’Horloge ; alertes déclenchées puis levées', async () => {
  // Sans décision au-delà de l'échéance (urgent : 30 min) : alerte
  await pool.query("UPDATE transferts SET date_demande = now() - interval '45 minutes' WHERE id = $1", [ids.t1]);
  let f = (await appel('reseau', 'GET', `/transferts-suivi/${ids.t1}`)).corps;
  assert.ok(f.alertes.some((a) => a.code === 'sans_decision'));
  assert.strictEqual((await appel('bouchard', 'POST', `/transferts/${ids.t1}/accepter`)).statut, 200);
  f = (await appel('reseau', 'GET', `/transferts-suivi/${ids.t1}`)).corps;
  assert.ok(!f.alertes.some((a) => a.code === 'sans_decision'), 'levée à la décision'); assert.ok(f.heures.decision);
  // Véhicule indisponible
  await pool.query("INSERT INTO etats_vehicules (unite_id, etat) VALUES ($1, 'desinfection') ON CONFLICT (unite_id) DO UPDATE SET etat = 'desinfection'", [ids.u1]);
  assert.ok((await appel('bouchard', 'GET', `/transferts-suivi/${ids.t1}`)).corps.alertes.some((a) => a.code === 'vehicule_indisponible'));
  await pool.query("UPDATE etats_vehicules SET etat = 'disponible' WHERE unite_id = $1", [ids.u1]);
  for (const [qui, e] of [['tremblay', 'transport'], ['tremblay', 'depart'], ['bouchard', 'reception']]) assert.strictEqual((await appel(qui, 'POST', `/transferts/${ids.t1}/${e}`)).statut, 200, e);
  f = (await appel('tremblay', 'GET', `/transferts-suivi/${ids.t1}`)).corps;
  assert.ok(f.heures.depart && f.heures.arrivee); assert.ok(f.delais.route_min >= 0); assert.strictEqual(f.alertes.length, 0);
  assert.strictEqual((await pool.query("SELECT count(*)::int n FROM horodatages WHERE objet = 'transfert' AND objet_id = $1", [ids.t1])).rows[0].n, 4);
});

test('centrale : transferts urgents en cours de la région, coordination et CCS ; refusée aux hôpitaux', async () => {
  ids.t2 = await nouveauTransfert('P-70002');
  const c = (await appel('reseau', 'GET', '/transferts-suivi/centrale')).corps.transferts;
  assert.ok(c.some((x) => x.id === ids.t2)); assert.ok(!c.some((x) => x.id === ids.t1), 'terminé : hors de la centrale');
  assert.ok(!JSON.stringify(c).includes('P-7000'), 'aucune référence patient');
  assert.ok((await appel('ccs', 'GET', '/secours/transferts-centrale')).corps.transferts.some((x) => x.id === ids.t2));
  assert.strictEqual((await appel('tremblay', 'GET', '/transferts-suivi/centrale')).statut, 403);
  // Refus du transfert : motif fermé
  assert.strictEqual((await appel('bouchard', 'POST', `/transferts/${ids.t2}/refuser`, { motif_code: 'pas_de_personnel' })).statut, 200);
  assert.strictEqual((await appel('bouchard', 'GET', `/transferts-suivi/${ids.t2}`)).corps.motif_refus, 'pas_de_personnel');
});

test('rapatriement : proposé quand « stable pour retour », jamais déclenché ; refusé avec motif, puis accepté → transfert de retour', async () => {
  // Préparation : un lit de soins intensifs libre et confirmé à l'hôpital d'origine
  await pool.query(`UPDATE lits SET etat = 'libre', patient_ref = NULL, transfert_id = NULL, disponibilite_confirmee_le = now()
    WHERE id = (SELECT id FROM lits WHERE etablissement_id = $1 AND type_id = $2 AND etat IN ('libre', 'occupe') ORDER BY etat DESC, id LIMIT 1)`, [ids.mb, ids.si]);
  assert.strictEqual((await appel('tremblay', 'POST', `/transferts/${ids.t1}/stable-retour`)).statut, 403, 'seulement l’équipe receveuse');
  const r = await appel('bouchard', 'POST', `/transferts/${ids.t1}/stable-retour`);
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps)); assert.strictEqual(r.corps.statut, 'propose');
  assert.strictEqual(r.corps.raison, 'hopital_origine', 'l’hôpital d’origine d’abord');
  assert.strictEqual((await pool.query("SELECT count(*)::int n FROM transferts WHERE origine_id = $1 AND destination_id = $2", [ids.sl, ids.mb])).rows[0].n, 0, 'rien n’est déclenché');
  assert.ok((await pool.query("SELECT 1 FROM notifications WHERE etablissement_id = $1 AND code = 'rapatriement_propose'", [ids.mb])).rowCount);
  assert.strictEqual((await appel('bouchard', 'POST', `/transferts/${ids.t1}/stable-retour`)).corps.code, 'rapatriement_deja_propose');
  assert.strictEqual((await appel('bouchard', 'POST', `/rapatriements/${r.corps.id}/decision`, { decision: 'refuser', motif: 'texte libre' })).statut, 400);
  assert.strictEqual((await appel('bouchard', 'POST', `/rapatriements/${r.corps.id}/decision`, { decision: 'refuser', motif: 'famille_refuse' })).corps.statut, 'refuse');
  // Nouvelle proposition, acceptée : un transfert de retour est DEMANDÉ par les règles habituelles (lit réservé à l'origine)
  await pool.query('UPDATE transferts SET stable_retour_le = NULL WHERE id = $1', [ids.t1]);
  const r2 = (await appel('bouchard', 'POST', `/transferts/${ids.t1}/stable-retour`)).corps;
  const a = await appel('bouchard', 'POST', `/rapatriements/${r2.id}/decision`, { decision: 'accepter' });
  assert.strictEqual(a.statut, 200, JSON.stringify(a.corps)); assert.strictEqual(a.corps.statut, 'accepte');
  const retour = (await pool.query('SELECT origine_id, destination_id, statut, patient_ref FROM transferts WHERE id = $1', [a.corps.retour_transfert_id])).rows[0];
  assert.deepStrictEqual(retour, { origine_id: ids.sl, destination_id: ids.mb, statut: 'demande', patient_ref: 'P-70001' });
  assert.strictEqual((await appel('bouchard', 'POST', `/rapatriements/${r2.id}/decision`, { decision: 'accepter' })).corps.code, 'rapatriement_statut');
});

test('anglais : textes de la fiche et des alertes complets en FR et EN', () => {
  const vm = require('node:vm'); const fs = require('node:fs');
  const c = { window: {} }; vm.createContext(c);
  for (const f of ['fr', 'en']) vm.runInContext(fs.readFileSync(require.resolve(`../public/i18n/${f}.js`), 'utf8'), c);
  const src = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  const debut = src.indexOf('async function ficheTransfert'); const bloc = src.slice(debut, src.indexOf('async function vueTransferts'));
  const cles = [...new Set([...bloc.matchAll(/T\('([a-z_]+)'/g), ...bloc.matchAll(/t\('transferts\.([a-z_]+)'/g)].map((m) => m[1]))];
  for (const code of ['sans_decision', 'transport_non_organise', 'vehicule_indisponible', 'lit_non_reserve']) cles.push(`alerte_${code}`);
  for (const s of ['propose', 'accepte', 'refuse', 'annule']) cles.push(`rapatriement_${s}`);
  for (const m of ['pas_stable', 'famille_refuse', 'pas_de_lit', 'autre']) cles.push(`rap_motif_${m}`);
  for (const k of cles) { assert.ok(c.window.ARRIMO_I18N.fr.transferts[k], `fr transferts.${k}`); assert.ok(c.window.ARRIMO_I18N.en.transferts[k], `en transferts.${k}`); }
});
