'use strict';
/**
 * Transport non urgent (20 nov. 2026) : demande sans coordination, réservation tardive signalée, plage confirmée par le transporteur,
 * refus motivé (liste fermée), lit « à libérer » puis libéré à la prise en charge, le transporteur ne voit que la référence et les lieux,
 * pas deux acceptations, horodatages, module non activé refusé, FR/EN.
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
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(qui ? { Authorization: `Bearer ${tokens[qui]}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
async function connecter(q, email) { const r = await appel(null, 'POST', '/connexion', { email, mot_de_passe: MOT_DE_PASSE_DEMO }); assert.strictEqual(r.statut, 200, q); tokens[q] = r.corps.token; }
const dans = (h) => new Date(Date.now() + h * 3600000).toISOString();
const demande = (b) => appel('tremblay', 'POST', '/transports-planifies', { etablissement_id: ids.mb, organisation_id: ids.amb, motif_transport: 'retour_domicile', destination_libelle: 'Sherbrooke',
  plage_debut: dans(24), plage_fin: dans(25), type_vehicule: 'transport_adapte', infos: { accessibilite: ['fauteuil'], accompagnateur: true }, ...b });

test.before(async () => {
  require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const e = (await pool.query("SELECT id, config_id FROM etablissements WHERE code = 'MB'")).rows[0]; ids.mb = e.id;
  ids.sl = (await pool.query("SELECT id FROM etablissements WHERE code = 'SL'")).rows[0].id;
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"transport_planifie": true}' WHERE id = $1`, [ids.mb]);
  ids.amb = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('TA-1', 'Transport adapté fictif', 'transport_adapte', '{ambulance}', $1) RETURNING id", [e.config_id])).rows[0].id;
  ids.u1 = (await pool.query("INSERT INTO unites_secours (organisation_id, numero, type_vehicule) VALUES ($1, 'TA-01', 'transport_adapte') RETURNING id", [ids.amb])).rows[0].id;
  const u = (await pool.query("INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ('ta@demo.arrimo', 'Transporteur fictif', $1, 'superviseur_secours') RETURNING id", [hacher(MOT_DE_PASSE_DEMO)])).rows[0].id;
  await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, ids.amb]);
  ids.lit = (await pool.query("SELECT id, patient_ref FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' AND patient_ref IS NOT NULL ORDER BY id LIMIT 1", [ids.mb])).rows[0];
  await connecter('tremblay', 'tremblay@demo.arrimo'); await connecter('bouchard', 'bouchard@demo.arrimo'); await connecter('ta', 'ta@demo.arrimo');
});
test.after(async () => { serveur?.close(); await pool?.end(); });

test('demande sans coordination : contrôles, module non activé refusé, réservation tardive signalée', async () => {
  assert.strictEqual((await appel('bouchard', 'POST', '/transports-planifies', { etablissement_id: ids.sl, organisation_id: ids.amb, motif_transport: 'retour_domicile', destination_libelle: 'Montréal', plage_debut: dans(24), plage_fin: dans(25), type_vehicule: 'ambulance' })).corps.code, 'module_desactive');
  assert.strictEqual((await demande({ motif_transport: 'autre' })).statut, 400);
  assert.strictEqual((await demande({ plage_fin: dans(23) })).corps.code, 'plage_invalide');
  assert.strictEqual((await demande({ infos: { accessibilite: ['fusee'] } })).statut, 400);
  const tard = await demande({ reference: 'P-88001', plage_debut: dans(2), plage_fin: dans(3) });
  assert.strictEqual(tard.statut, 200, JSON.stringify(tard.corps)); assert.strictEqual(tard.corps.avertissement, 'reservation_tardive'); assert.strictEqual(tard.corps.coordination_id, null);
  const r = await demande({ lit_id: ids.lit.id });
  assert.strictEqual(r.statut, 200, JSON.stringify(r.corps)); assert.strictEqual(r.corps.avertissement, null); assert.strictEqual(r.corps.resident_ref, ids.lit.patient_ref);
  ids.d1 = r.corps.id; ids.d2 = tard.corps.id;
  assert.strictEqual((await demande({ lit_id: ids.lit.id })).corps.code, 'transport_deja_demande', 'une seule demande ouverte par lit');
});

test('transporteur : ne voit que la référence et les lieux ; confirme la plage sans unité ; le lit passe « en attente de transport »', async () => {
  const l = (await appel('ta', 'GET', '/secours/transports')).corps;
  const d = l.find((x) => x.id === ids.d1);
  assert.ok(d); assert.strictEqual(d.destination, 'Sherbrooke'); assert.deepStrictEqual(d.infos, { accessibilite: ['fauteuil'], accompagnateur: true });
  for (const cle of ['patient', 'nom', 'prenom', 'date_naissance', 'diagnostic']) assert.ok(!(cle in d), cle);
  const pd = dans(24.5); const pf = dans(25.5);
  const a = await appel('ta', 'POST', `/secours/transports/${ids.d1}/action`, { action: 'accepter', plage_confirmee_debut: pd, plage_confirmee_fin: pf });
  assert.strictEqual(a.statut, 200, JSON.stringify(a.corps)); assert.strictEqual(new Date(a.corps.plage_confirmee_debut).toISOString(), pd);
  assert.strictEqual((await appel('ta', 'POST', `/secours/transports/${ids.d1}/action`, { action: 'accepter' })).statut, 409, 'pas deux acceptations');
  const lit = (await pool.query('SELECT conge_statut, sortie_prevue FROM lits WHERE id = $1', [ids.lit.id])).rows[0];
  assert.strictEqual(lit.conge_statut, 'attente_transport'); assert.strictEqual(new Date(lit.sortie_prevue).toISOString(), pd);
  // Refus motivé (liste fermée) sur l'autre demande
  const ref = await appel('ta', 'POST', `/secours/transports/${ids.d2}/action`, { action: 'refuser', motif: 'hors_territoire' });
  assert.strictEqual(ref.corps.motif_refus, 'hors_territoire');
});

test('départ (unité exigée), prise en charge → lit au nettoyage, arrivée ; heures dans l’Horloge ; l’hôpital voit la plage confirmée', async () => {
  assert.strictEqual((await appel('ta', 'POST', `/secours/transports/${ids.d1}/action`, { action: 'en_route' })).corps.code, 'unite_introuvable');
  assert.strictEqual((await appel('ta', 'POST', `/secours/transports/${ids.d1}/action`, { action: 'en_route', unite_id: ids.u1 })).statut, 200);
  assert.strictEqual((await appel('ta', 'POST', `/secours/transports/${ids.d1}/action`, { action: 'pris_en_charge' })).statut, 200);
  assert.strictEqual((await pool.query('SELECT etat FROM lits WHERE id = $1', [ids.lit.id])).rows[0].etat, 'nettoyage', 'lit libéré à la prise en charge');
  const d = await appel('ta', 'POST', `/secours/transports/${ids.d1}/action`, { action: 'partir_destination' });
  assert.strictEqual(d.statut, 200);
  assert.ok(d.corps.depart_reel);
  assert.strictEqual((await appel('ta', 'POST', `/secours/transports/${ids.d1}/action`, { action: 'partir_destination' })).corps.deja, true);
  assert.strictEqual((await appel('ta', 'POST', `/secours/transports/${ids.d1}/action`, { action: 'arrivee' })).statut, 200);
  const h = (await pool.query("SELECT etape FROM horodatages WHERE objet = 'demande_transport' AND objet_id = $1 ORDER BY id", [ids.d1])).rows.map((r) => r.etape);
  assert.deepStrictEqual(h, ['demande', 'decision', 'prise_en_charge', 'depart', 'arrivee']);
  const vue = (await appel('tremblay', 'GET', `/transports?etablissement_id=${ids.mb}`)).corps.find((x) => x.id === ids.d1);
  assert.ok(vue.plage_confirmee_debut); assert.strictEqual(vue.statut, 'arrivee');
  assert.ok(vue.durees_planifiees.trajet_patient >= 0);
  assert.ok((await pool.query("SELECT 1 FROM v_demandes WHERE circuit = 'transport' AND id = $1 AND statut = 'terminee'", [ids.d1])).rowCount, 'lecture commune des demandes');
  const etat = async () => (await pool.query('SELECT etat FROM etats_vehicules WHERE unite_id = $1', [ids.u1])).rows[0].etat;
  const action = (nom) => appel('ta', 'POST', `/secours/transports/${ids.d1}/action`, { action: nom });
  assert.strictEqual(await etat(), 'a_l_hopital');
  assert.strictEqual((await appel('ta', 'POST', `/secours/unites/${ids.u1}/etat`, { etat: 'disponible' })).corps.code, 'vehicule_mission_active');
  assert.strictEqual((await action('terminer')).statut, 409);
  assert.strictEqual((await action('remis')).statut, 200);
  assert.strictEqual(await etat(), 'a_l_hopital');
  assert.strictEqual((await action('terminer')).statut, 200);
  assert.strictEqual(await etat(), 'disponible');
});

test('véhicule planifié : deux acceptations concurrentes ne réservent pas la même plage', async () => {
  const premier = await demande({ reference: 'P-88021', plage_debut: dans(48), plage_fin: dans(50) });
  const second = await demande({ reference: 'P-88022', plage_debut: dans(49), plage_fin: dans(51) });
  assert.strictEqual(premier.statut, 200);
  assert.strictEqual(second.statut, 200);
  const accepter = (id) => appel('ta', 'POST', `/secours/transports/${id}/action`,
    { action: 'accepter', unite_id: ids.u1 });
  const reponses = await Promise.all([accepter(premier.corps.id), accepter(second.corps.id)]);
  assert.deepStrictEqual(reponses.map((r) => r.statut).sort(), [200, 409]);
  assert.strictEqual(reponses.find((r) => r.statut === 409).corps.code, 'transport_vehicule_reserve');
  const affectee = reponses.find((r) => r.statut === 200).corps;
  const unit = (await pool.query(`INSERT INTO unites_secours (organisation_id, numero, type_vehicule)
    VALUES ($1, 'TA-02', 'transport_adapte') RETURNING id`, [ids.amb])).rows[0];
  const changement = await appel('ta', 'POST', `/secours/transports/${affectee.id}/action`,
    { action: 'affecter', unite_id: unit.id, version: affectee.version });
  assert.strictEqual(changement.statut, 200);
  assert.strictEqual(changement.corps.unite_id, unit.id);
  const historique = (await pool.query("SELECT detail FROM demande_transport_evenements WHERE demande_id = $1 AND type = 'affecter'", [affectee.id])).rows;
  assert.strictEqual(historique[0].detail.unite_id_avant, ids.u1);
  const horaire = { action: 'replanifier', version: changement.corps.version, plage_confirmee_debut: dans(60), plage_confirmee_fin: dans(61) };
  const url = `/secours/transports/${affectee.id}/action`;
  assert.strictEqual((await appel('ta', 'POST', url, { ...horaire, plage_confirmee_fin: dans(59) })).corps.code, 'plage_invalide');
  const replanifie = await appel('ta', 'POST', url, horaire);
  assert.strictEqual(replanifie.statut, 200);
  assert.strictEqual(new Date(replanifie.corps.plage_confirmee_debut).toISOString(), horaire.plage_confirmee_debut);
  assert.strictEqual(new Date(replanifie.corps.plage_debut).toISOString(), new Date(affectee.plage_debut).toISOString());
  assert.strictEqual((await appel('ta', 'POST', url, horaire)).corps.code, 'version_perimee');
});

test('brouillon privé, retrait sans transmission et archive consultable', async () => {
  const draft = await demande({ reference: 'P-88026', destination_id: ids.sl, brouillon: true });
  assert.strictEqual(draft.statut, 200);
  assert.strictEqual(draft.corps.statut, 'a_valider');
  const id = draft.corps.id;
  for (const [role, route] of [
    ['ta', `/secours/transports/${id}`], ['bouchard', `/transports/${id}?etablissement_id=${ids.sl}`],
    ['bouchard', `/arrimo-flux/fiche?type=transport&id=${id}`], ['bouchard', `/sillage?objet=demande_transport&id=${id}`],
  ]) assert.strictEqual((await appel(role, 'GET', route)).statut, 404, route);
  const chemin = `/transports/${id}/action`;
  const retire = await appel('tremblay', 'POST', chemin, { etablissement_id: ids.mb, action: 'retirer_brouillon', version: draft.corps.version });
  assert.strictEqual(retire.statut, 200);
  assert.ok(!(await appel('tremblay', 'GET', `/transports?etablissement_id=${ids.mb}`)).corps.some((d) => d.id === id));
  const evenements = await pool.query('SELECT type FROM demande_transport_evenements WHERE demande_id = $1 ORDER BY id', [id]);
  assert.deepStrictEqual(evenements.rows.map((e) => e.type), ['preparee', 'retirer_brouillon']);
  const archive = await appel('tremblay', 'POST', `/transports/${ids.d2}/action`, { etablissement_id: ids.mb, action: 'archiver' });
  assert.strictEqual(archive.statut, 200);
  const lire = (suffixe = '') => appel('tremblay', 'GET', `/transports?etablissement_id=${ids.mb}${suffixe}`);
  assert.ok(!(await lire()).corps.some((d) => d.id === ids.d2));
  assert.ok((await lire('&historique=1')).corps.some((d) => d.id === ids.d2 && d.archivee));
  const fiche = await appel('ta', 'GET', `/secours/transports/${ids.d2}`);
  assert.strictEqual(fiche.statut, 200);
  assert.ok(fiche.corps.evenements.some((e) => e.type === 'archiver'));
});

test('anglais : chaque texte de l’écran et de l’ambulance existe en FR et en EN', () => {
  const vm = require('node:vm'); const fs = require('node:fs');
  const c = { window: {} }; vm.createContext(c);
  for (const f of ['fr', 'en', 'aide.fr', 'aide.en']) vm.runInContext(fs.readFileSync(require.resolve(`../public/i18n/${f}.js`), 'utf8'), c);
  const { fr, en } = c.window.ARRIMO_I18N;
  const src = fs.readFileSync(require.resolve('../public/transport-planifie.js'), 'utf8');
  const cles = [...new Set([...src.matchAll(/P\('([a-z_]+)'/g), ...src.matchAll(/t\('transport_planifie\.([a-z_]+)'/g)].map((m) => m[1]))];
  for (const p of ['m_retour_domicile', 'm_transfert_stable', 'm_depart_nsa', 'm_retour_chsld', 'v_ambulance', 'v_transport_adapte', 'v_autre', 's_demandee', 's_acceptee', 's_refusee', 's_en_route', 's_pris_en_charge', 's_arrivee', 's_annulee', 'a_fauteuil', 'a_malvoyant']) cles.push(p);
  for (const k of cles) { assert.ok(fr.transport_planifie[k], `fr ${k}`); assert.ok(en.transport_planifie[k], `en ${k}`); }
  assert.ok(fr.aide.ecrans['transports-planifies'] && en.aide.ecrans['transports-planifies']);
});
