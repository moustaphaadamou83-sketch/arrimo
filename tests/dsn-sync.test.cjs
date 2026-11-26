'use strict';
/** DSN natif (23 nov. 2026) : synchronisation contrôlée DSN ↔ Lits ↔ Transferts ↔ Hébergement ↔ Transport ↔ Sillage, sans doublon, historisée. */
const test = require('node:test');
const assert = require('node:assert');
const { demarrerServeur } = require('./serveur-test.cjs');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { seed, MOT_DE_PASSE_DEMO } = require('../db/seed');
const { hacher } = require('../src/auth');

let pool; let serveur; let base; const tok = {}; const ids = {}; const envAvant = process.env.ARRIMO_ENV;
async function appel(qui, m, c, b) { const r = await fetch(`${base}/api${c}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok[qui]}` }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { s: r.status, d }; }
async function compte(cle, role, { etab, org } = {}) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [`${cle}@demo.arrimo`, cle, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  if (etab) await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etab]);
  if (org) await pool.query('INSERT INTO utilisateur_organisations VALUES ($1, $2)', [u, org]);
  tok[cle] = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${cle}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
  return u;
}
const litLibre = async (etab, decalage = 0) => (await pool.query("SELECT id, code, version FROM lits WHERE etablissement_id = $1 AND etat = 'libre' AND actif ORDER BY code LIMIT 1 OFFSET $2", [etab, decalage])).rows[0];
const sejours = async (pid) => (await pool.query("SELECT * FROM dsn_elements WHERE patient_id = $1 AND genre = 'sejour' AND remplace_par IS NULL ORDER BY id", [pid])).rows;
async function patient(prenom, nom) { const r = await appel('med', 'POST', '/dsn/patients', { etablissement_id: ids.h, prenom, nom, date_naissance: '1945-04-04' }); assert.strictEqual(r.s, 200, JSON.stringify(r.d)); return r.d; }

test.before(async () => {
  process.env.ARRIMO_ENV = 'demo'; require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const h = (await pool.query("SELECT id, config_id, latitude, longitude FROM etablissements WHERE code = 'MB'")).rows[0]; ids.h = h.id;
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"dsn": true, "transport_planifie": true}' WHERE id = $1`, [h.id]);
  ids.c = (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, module_actif, type_etablissement, modules) VALUES ('CH-S', 'CHSLD sync', 'Ville', $1, $2, $3, true, 'chsld', '{"dsn": true}') RETURNING id`,
    [h.latitude + 0.01, h.longitude, h.config_id])).rows[0].id;
  ids.org = (await pool.query("INSERT INTO organisations_secours (code, nom, type, profils, config_id) VALUES ('AMB-S', 'Ambulances sync', 'ambulancier', '{ambulance}', $1) RETURNING id", [h.config_id])).rows[0].id;
  ids.unite = (await pool.query("INSERT INTO unites_secours (organisation_id, numero, plaque) VALUES ($1, 'S-101', 'SYNC 101') RETURNING id", [ids.org])).rows[0].id;
  // Lits libres de test (le jeu de données de base n'en laisse aucun à cet hôpital)
  for (let i = 1; i <= 8; i++) await pool.query(`INSERT INTO lits (chambre_id, unite_id, type_id, etablissement_id, code, etat) SELECT chambre_id, unite_id, type_id, etablissement_id, $2, 'libre' FROM lits WHERE etablissement_id = $1 ORDER BY id LIMIT 1`, [h.id, `SYNC-${i}`]);
  const med = await compte('med', 'equipe_soins', { etab: h.id }); await pool.query("INSERT INTO dsn_habilitations VALUES ($1, $2, 'medecin'), ($1, $2, 'admission'), ($1, $2, 'sortie')", [h.id, med]);
  await compte('coord', 'coordonnateur', { etab: h.id }); await compte('ch', 'coordonnateur', { etab: ids.c }); await compte('para', 'paramedic', { org: ids.org });
  await compte('aud', 'coordonnateur', { etab: h.id }); await pool.query("INSERT INTO dsn_habilitations SELECT $1, id, 'auditeur' FROM utilisateurs WHERE email = 'aud@demo.arrimo'", [h.id]);
});
test.after(async () => { serveur?.close(); await pool?.end(); if (envAvant === undefined) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = envAvant; });

test('DSN → Lits : l’admission réserve puis occupe un VRAI lit ; lit occupé, lit inconnu et second séjour refusés', async () => {
  const p = await patient('Ada', 'Sync-Un'); ids.p1 = p;
  const lit = await litLibre(ids.h);
  const r = await appel('med', 'POST', `/dsn/patients/${p.id}/elements`, { genre: 'sejour', donnees: { service: 'Médecine', lit: lit.code } });
  assert.strictEqual(r.s, 200, JSON.stringify(r.d)); assert.strictEqual(r.d.donnees.lit_id, lit.id);
  const l = (await pool.query('SELECT etat, patient_ref FROM lits WHERE id = $1', [lit.id])).rows[0];
  assert.deepStrictEqual([l.etat, l.patient_ref], ['occupe', p.reference]); ids.lit1 = lit;
  assert.strictEqual((await sejours(p.id)).length, 1, 'la synchronisation des lits ne crée pas un second séjour');
  assert.strictEqual((await pool.query('SELECT parcours FROM patients WHERE id = $1', [p.id])).rows[0].parcours, 'hospitalise');
  const p2 = await patient('Bea', 'Sync-Deux');
  assert.strictEqual((await appel('med', 'POST', `/dsn/patients/${p2.id}/elements`, { genre: 'sejour', donnees: { service: 'Médecine', lit: lit.code } })).d.code, 'dsn_lit_non_disponible');
  assert.strictEqual((await appel('med', 'POST', `/dsn/patients/${p2.id}/elements`, { genre: 'sejour', donnees: { service: 'Médecine', lit: 'ZZZ-999' } })).s, 404);
  const autre = await litLibre(ids.h);
  assert.strictEqual((await appel('med', 'POST', `/dsn/patients/${p.id}/elements`, { genre: 'sejour', donnees: { service: 'Médecine', lit: autre.code } })).d.code, 'dsn_sejour_deja_actif');
  assert.strictEqual((await pool.query('SELECT etat FROM lits WHERE id = $1', [autre.id])).rows[0].etat, 'libre', 'aucun lit pris par une admission refusée');
});

test('DSN → Lits : deux admissions simultanées sur le même lit : une seule réussit, jamais de double occupation', async () => {
  const [a, b] = [await patient('Cy', 'Sync-Trois'), await patient('Di', 'Sync-Quatre')]; const lit = await litLibre(ids.h);
  const r = await Promise.all([a, b].map((p) => appel('med', 'POST', `/dsn/patients/${p.id}/elements`, { genre: 'sejour', donnees: { service: 'Médecine', lit: lit.code } })));
  assert.strictEqual(r.filter((x) => x.s === 200).length, 1, JSON.stringify(r.map((x) => [x.s, x.d.code])));
  const actifs = (await pool.query("SELECT count(*)::int n FROM dsn_elements WHERE genre = 'sejour' AND statut = 'en_cours' AND remplace_par IS NULL AND (donnees->>'lit_id')::int = $1", [lit.id])).rows[0].n;
  assert.strictEqual(actifs, 1);
  // Nettoyage pour la suite : le perdant n'a rien pris ; le gagnant libère
  const g = r.findIndex((x) => x.s === 200); ids.p3 = [a, b][g];
});

test('Lits → DSN : une admission confirmée dans Lits crée le séjour (une seule fois) ; une simple réservation n’en crée aucun ; la sortie le termine', async () => {
  const p = await patient('Eve', 'Sync-Cinq'); const lit = await litLibre(ids.h);
  const res = await appel('coord', 'POST', `/lits/${lit.id}/action`, { action: 'reserver', version: lit.version, patient_ref: p.reference });
  assert.strictEqual(res.s, 200, JSON.stringify(res.d)); assert.strictEqual((await sejours(p.id)).length, 0, 'réservation seule : aucun séjour');
  const v = (await pool.query('SELECT version FROM lits WHERE id = $1', [lit.id])).rows[0].version;
  const adm = await appel('coord', 'POST', `/lits/${lit.id}/action`, { action: 'admettre', version: v });
  assert.strictEqual(adm.s, 200, JSON.stringify(adm.d));
  let s = await sejours(p.id); assert.strictEqual(s.length, 1); assert.deepStrictEqual([s[0].statut, s[0].source, Number(s[0].donnees.lit_id)], ['en_cours', 'lits', lit.id]);
  // Changement de lit dans Lits : le séjour suit (nouvelle version), toujours un seul actif
  const v2 = (await pool.query('SELECT version FROM lits WHERE id = $1', [lit.id])).rows[0].version;
  assert.strictEqual((await appel('coord', 'POST', `/lits/${lit.id}/action`, { action: 'liberer', version: v2 })).s, 200);
  s = await sejours(p.id); assert.strictEqual(s[0].statut, 'termine', 'la sortie du lit termine le séjour');
  assert.strictEqual((await pool.query('SELECT parcours FROM patients WHERE id = $1', [p.id])).rows[0].parcours, 'enregistre');
  const ev = (await pool.query("SELECT type, source, statut FROM dsn_evenements WHERE patient_id = $1 ORDER BY id", [p.id])).rows.map((x) => `${x.type}:${x.source}:${x.statut}`);
  assert.deepStrictEqual(ev, ['admission:lits:sejour_cree', 'sortie_lit:lits:sejour_termine']);
});

test('Annulation d’un séjour DSN : lit au nettoyage par les règles, parcours recalculé ; changement de lit refusé dans le DSN', async () => {
  const s = (await sejours(ids.p1.id))[0];
  assert.strictEqual((await appel('med', 'POST', `/dsn/elements/${s.id}/action`, { action: 'amender', motif: 'Essai de lit', donnees: { lit: 'AUTRE-1' } })).d.code, 'dsn_lit_par_lits');
  const r = await appel('med', 'POST', `/dsn/elements/${s.id}/action`, { action: 'annuler', motif: 'Admission annulée (test)' });
  assert.strictEqual(r.d.statut, 'annule');
  assert.strictEqual((await pool.query('SELECT etat FROM lits WHERE id = $1', [ids.lit1.id])).rows[0].etat, 'nettoyage');
  assert.strictEqual((await pool.query('SELECT parcours FROM patients WHERE id = $1', [ids.p1.id])).rows[0].parcours, 'enregistre');
});

test('Transition vers un CHSLD : demande d’hébergement liée (une seule), envois simultanés = une seule demande de transport ; avis à l’origine ; départ par le transport ; dossier ouvert une seule fois', async () => {
  const p = ids.p3;
  const el = (await appel('med', 'POST', `/dsn/patients/${p.id}/elements`, { genre: 'allergie', donnees: { substance: 'Latex (fictif)' } })).d;
  const t = (await appel('med', 'POST', `/dsn/patients/${p.id}/transitions`, { destination_id: ids.c, elements: [el.id] })).d;
  assert.strictEqual((await appel('med', 'POST', `/dsn/transitions/${t.id}/valider`)).d.statut, 'valide');
  const debut = new Date(Date.now() + 3 * 3600000).toISOString(); const fin = new Date(Date.now() + 4 * 3600000).toISOString();
  const corps = { transport: { organisation_id: ids.org, type_vehicule: 'ambulance', plage_debut: debut, plage_fin: fin } };
  const r = await Promise.all([1, 2, 3].map(() => appel('med', 'POST', `/dsn/transitions/${t.id}/envoyer`, corps)));
  assert.strictEqual(r.filter((x) => x.s === 200).length, 1, JSON.stringify(r.map((x) => [x.s, x.d.code])));
  const tr = (await pool.query('SELECT * FROM dsn_transitions WHERE id = $1', [t.id])).rows[0];
  assert.ok(tr.demande_hebergement_id && tr.demande_transport_id);
  const trajetAmb = await appel('para', 'GET', `/secours/sillage?objet=demande_transport&id=${tr.demande_transport_id}`);
  assert.strictEqual(trajetAmb.s, 200);
  assert.ok(trajetAmb.d.objets.every((o) => o.objet !== 'dsn_transition'), 'le transporteur ne voit pas le dossier DSN lié');
  assert.strictEqual((await pool.query("SELECT count(*)::int n FROM demandes_transport WHERE resident_ref = $1", [p.reference])).rows[0].n, 1, 'une seule demande de transport');
  assert.strictEqual((await pool.query("SELECT count(*)::int n FROM demandes_hebergement WHERE reference_externe = $1", [p.reference])).rows[0].n, 1, 'une seule demande d’hébergement');
  const dt = (await pool.query('SELECT statut, unite_id FROM demandes_transport WHERE id = $1', [tr.demande_transport_id])).rows[0];
  assert.deepStrictEqual([dt.statut, dt.unite_id], ['demandee', null], 'demande créée ≠ ambulance affectée');
  // Le CHSLD accepte : l'origine est avisée
  assert.strictEqual((await appel('ch', 'POST', `/dsn/transitions/${t.id}/decision`, { decision: 'accepter' })).d.statut, 'accepte');
  assert.ok((await pool.query("SELECT 1 FROM notifications WHERE etablissement_id = $1 AND code = 'dsn_transition_acceptee'", [ids.h])).rowCount);
  // Transport : accepter, en route, pris en charge → départ de la transition (Horloge), lit au nettoyage, séjour terminé
  for (const a of ['accepter', 'en_route', 'pris_en_charge']) {
    const v = (await pool.query('SELECT version FROM demandes_transport WHERE id = $1', [tr.demande_transport_id])).rows[0].version;
    const x = await appel('para', 'POST', `/secours/transports/${tr.demande_transport_id}/action`, { action: a, version: v, unite_id: ids.unite });
    assert.strictEqual(x.s, 200, `${a} ${JSON.stringify(x.d)}`);
  }
  const t2 = (await pool.query('SELECT depart_le FROM dsn_transitions WHERE id = $1', [t.id])).rows[0]; assert.ok(t2.depart_le, 'départ enregistré par la prise en charge');
  const et = (await pool.query("SELECT etape FROM horodatages WHERE objet = 'dsn_transition' AND objet_id = $1", [t.id])).rows.map((x) => x.etape).sort();
  assert.deepStrictEqual(et, ['decision', 'demande', 'depart']);
  assert.strictEqual((await sejours(p.id))[0].statut, 'termine');
  // Le dossier DSN montre le transport et la demande d'hébergement liés
  const d = (await appel('med', 'GET', `/dsn/patients/${p.id}`)).d.transitions.find((x) => x.id === t.id);
  assert.ok(d.transport && d.transport_statut === 'pris_en_charge' && d.demande_hebergement);
  // Réception puis dossier ouvert deux fois : un seul patient
  assert.strictEqual((await appel('ch', 'POST', `/dsn/transitions/${t.id}/decision`, { decision: 'reception' })).d.statut, 'recu');
  // DSN réservé aux hôpitaux (27 nov. 2026) : le CHSLD reçoit le paquet, mais n'ouvre jamais de dossier DSN, même avec le drapeau et une habilitation
  await pool.query("INSERT INTO dsn_habilitations SELECT $1, id, 'admission' FROM utilisateurs WHERE email = 'ch@demo.arrimo'", [ids.c]);
  const o = await Promise.all([1, 2].map(() => appel('ch', 'POST', `/dsn/transitions/${t.id}/dossier`)));
  assert.ok(o.every((x) => x.s === 403 && x.d.code === 'module_desactive'), JSON.stringify(o.map((x) => [x.s, x.d.code])));
  assert.strictEqual((await pool.query("SELECT count(*)::int n FROM patients WHERE etablissement_id = $1 AND nom = 'Sync-Trois' OR etablissement_id = $1 AND nom = 'Sync-Quatre'", [ids.c])).rows[0].n, 0);
  assert.strictEqual((await appel('ch', 'GET', `/dsn/patients?etablissement_id=${ids.c}`)).s, 403, 'aucune liste DSN dans un CHSLD');
});

test('Historique : chaque événement a son auteur (ou « système »), sa source, son statut et son heure ; immuable ; aucune donnée clinique', async () => {
  const ev = (await pool.query('SELECT * FROM dsn_evenements')).rows;
  assert.ok(ev.length >= 8); assert.ok(ev.every((x) => x.cree_le && x.statut && x.source));
  assert.ok(!JSON.stringify(ev).includes('Latex'));
  await assert.rejects(pool.query('UPDATE dsn_evenements SET statut = $1', ['x'])); await assert.rejects(pool.query('DELETE FROM dsn_evenements'));
  const d = (await appel('med', 'GET', `/dsn/patients/${ids.p3.id}`)).d; assert.ok(d.chronologie.some((x) => x.genre === 'evenement'));
});
