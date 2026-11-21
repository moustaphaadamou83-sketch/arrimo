'use strict';
/** DSN clinique (cahier « DSN international » v1.0, décision de Moustafa du 22 nov. 2026) : démo et recette seulement, patients synthétiques,
 *  habilitations, éléments jamais supprimés, prescriptions simulées, paquet de transition seul visible à la destination, journal d'accès. */
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
async function compte(cle, role, etab) {
  const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1, $2, $3, $4) RETURNING id', [`${cle}@demo.arrimo`, cle, hacher(MOT_DE_PASSE_DEMO), role])).rows[0].id;
  await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1, $2)', [u, etab]);
  tok[cle] = (await (await fetch(`${base}/api/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${cle}@demo.arrimo`, mot_de_passe: MOT_DE_PASSE_DEMO }) })).json()).token;
  return u;
}
const habiliter = (etab, u, f) => pool.query('INSERT INTO dsn_habilitations (etablissement_id, utilisateur_id, fonction) VALUES ($1, $2, $3)', [etab, u, f]);

test.before(async () => {
  process.env.ARRIMO_ENV = 'demo'; require('./routeur-fictif.cjs').activer();
  pool = creerPool(process.env.TEST_DATABASE_URL); await viderBase(pool); await seed(pool, { silencieux: true });
  serveur = await demarrerServeur(creerApp(pool)); base = `http://127.0.0.1:${serveur.address().port}`;
  const h = (await pool.query("SELECT id, config_id, latitude, longitude FROM etablissements WHERE code = 'MB'")).rows[0]; ids.h = h.id;
  await pool.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"dsn": true}' WHERE id = $1`, [h.id]);
  ids.m = (await pool.query(`INSERT INTO etablissements (code, nom, ville, latitude, longitude, config_id, module_actif, type_etablissement, modules) VALUES ('MR-B', 'Maison de retraite B', 'Ville', $1, $2, $3, true, 'chsld', '{}') RETURNING id`,
    [h.latitude + 0.01, h.longitude, h.config_id])).rows[0].id;
  ids.adm = await compte('admission', 'coordonnateur', h.id); await habiliter(h.id, ids.adm, 'admission');
  ids.inf = await compte('infirmiere', 'equipe_soins', h.id); await habiliter(h.id, ids.inf, 'infirmier');
  ids.med = await compte('medecin', 'equipe_soins', h.id); await habiliter(h.id, ids.med, 'medecin');
  ids.aud = await compte('auditeur', 'coordonnateur', h.id); await habiliter(h.id, ids.aud, 'auditeur');
  ids.sans = await compte('sans', 'coordonnateur', h.id);
  ids.adminH = await compte('adminh', 'admin_etab', h.id);
  ids.mr = await compte('mr', 'admin_etab', ids.m);
});
test.after(async () => { serveur?.close(); await pool?.end(); if (envAvant === undefined) delete process.env.ARRIMO_ENV; else process.env.ARRIMO_ENV = envAvant; });

test('DSN : refusé hors démo et recette (production, validation)', async () => {
  for (const e of ['production', 'validation']) {
    process.env.ARRIMO_ENV = e;
    try { const r = await appel('admission', 'GET', `/dsn/patients?etablissement_id=${ids.h}`); assert.strictEqual(r.s, 403); assert.strictEqual(r.d.code, 'dsn_reserve_demo'); }
    finally { process.env.ARRIMO_ENV = 'demo'; }
  }
});

test('DSN : parcours clinique complet, habilitations, prescription simulée, aucune suppression, journal d’accès', async () => {
  // Sans habilitation : refus ; l'administrateur ne s'habilite pas lui-même
  assert.strictEqual((await appel('sans', 'GET', `/dsn/patients?etablissement_id=${ids.h}`)).s, 403);
  assert.strictEqual((await appel('adminh', 'PUT', '/dsn/habilitations', { etablissement_id: ids.h, utilisateur_id: ids.adminH, fonction: 'medecin', actif: true })).d.code, 'dsn_auto_habilitation');
  // Admission : patient synthétique
  const p = await appel('admission', 'POST', '/dsn/patients', { etablissement_id: ids.h, prenom: 'Alice', nom: 'Démo-Synthèse', date_naissance: '1944-03-02' });
  assert.strictEqual(p.s, 200, JSON.stringify(p.d)); ids.p = p.d.id;
  assert.strictEqual((await appel('admission', 'POST', `/dsn/patients/${ids.p}/elements`, { genre: 'diagnostic', donnees: { libelle: 'Fictif' } })).s, 403, 'l’admission ne pose pas de diagnostic');
  // Infirmière : allergie ; médecin : diagnostic, prescription simulée validée
  const al = await appel('infirmiere', 'POST', `/dsn/patients/${ids.p}/elements`, { genre: 'allergie', donnees: { substance: 'Pénicilline (fictif)', gravite: 'severe' } });
  assert.strictEqual(al.s, 200, JSON.stringify(al.d));
  const rx = await appel('infirmiere', 'POST', `/dsn/patients/${ids.p}/elements`, { genre: 'prescription', donnees: { substance: 'Produit fictif', dose: '1 cp', voie: 'orale', frequence: '2 fois par jour' } });
  assert.strictEqual(rx.d.statut, 'brouillon');
  assert.strictEqual((await appel('infirmiere', 'POST', `/dsn/elements/${rx.d.id}/action`, { action: 'valider' })).s, 403, 'seul le médecin valide');
  const v = await appel('medecin', 'POST', `/dsn/elements/${rx.d.id}/action`, { action: 'valider' });
  assert.deepStrictEqual([v.d.statut, v.d.simulee, v.d.envoyee], ['validee', true, false], 'prescription simulée, jamais envoyée');
  // Amendement : nouvelle version, l'ancienne reste
  const am = await appel('infirmiere', 'POST', `/dsn/elements/${al.d.id}/action`, { action: 'amender', motif: 'Précision de la réaction', donnees: { reaction: 'Urticaire (fictif)' } });
  assert.strictEqual(am.d.version, 2);
  assert.strictEqual((await appel('infirmiere', 'POST', `/dsn/elements/${al.d.id}/action`, { action: 'annuler', motif: 'essai' })).s, 409, 'une version remplacée ne change plus');
  const dos = (await appel('medecin', 'GET', `/dsn/patients/${ids.p}`)).d;
  assert.strictEqual(dos.allergies.length, 1); assert.strictEqual(dos.versions.length, 1);
  // Une autre organisation ne voit pas le dossier
  assert.strictEqual((await appel('mr', 'GET', `/dsn/patients/${ids.p}`)).s, 404);
  // Journal d'accès : auditeur seulement, immuable
  const j = await appel('auditeur', 'GET', `/dsn/acces?etablissement_id=${ids.h}`);
  assert.strictEqual(j.s, 200); assert.ok(j.d.some((x) => x.action === 'lecture') && j.d.some((x) => x.action === 'signature'));
  assert.ok(!JSON.stringify(j.d).includes('Pénicilline'), 'aucun contenu clinique dans le journal');
  await assert.rejects(pool.query('DELETE FROM dsn_acces'));
});

test('DSN : transition Hôpital → Maison de retraite ; la destination ne voit que le paquet validé ; avis sans contenu clinique ; Sillage', async () => {
  const el = (await pool.query("SELECT id FROM dsn_elements WHERE patient_id = $1 AND remplace_par IS NULL AND genre IN ('allergie', 'prescription')", [ids.p])).rows.map((r) => r.id);
  const t = await appel('medecin', 'POST', `/dsn/patients/${ids.p}/transitions`, { destination_id: ids.m, elements: el, note_transition: 'Consignes fictives' });
  assert.strictEqual(t.s, 200, JSON.stringify(t.d));
  assert.strictEqual((await appel('medecin', 'POST', `/dsn/transitions/${t.d.id}/envoyer`, {})).s, 409, 'non validée : pas d’envoi');
  assert.strictEqual((await appel('medecin', 'POST', `/dsn/transitions/${t.d.id}/valider`)).d.statut, 'valide');
  assert.strictEqual((await appel('mr', 'GET', `/dsn/transitions/recues?etablissement_id=${ids.m}`)).d.length, 0, 'invisible avant l’envoi');
  const e = await appel('medecin', 'POST', `/dsn/transitions/${t.d.id}/envoyer`, {}); assert.strictEqual(e.d.statut, 'envoye');
  const n = (await pool.query("SELECT message FROM notifications WHERE etablissement_id = $1 AND code = 'dsn_transition'", [ids.m])).rows;
  assert.strictEqual(n.length, 1); assert.ok(!n[0].message.includes('Pénicilline'), 'avis sans contenu clinique');
  const r = (await appel('mr', 'GET', `/dsn/transitions/recues?etablissement_id=${ids.m}`)).d;
  assert.strictEqual(r.length, 1); assert.strictEqual(r[0].contenu.elements.length, 2); assert.ok(!JSON.stringify(r[0]).includes('Consignes internes'));
  assert.strictEqual((await appel('mr', 'POST', `/dsn/transitions/${t.d.id}/decision`, { decision: 'accepter' })).d.statut, 'accepte');
  assert.strictEqual((await appel('mr', 'POST', `/dsn/transitions/${t.d.id}/decision`, { decision: 'reception' })).d.statut, 'recu');
  // Horloge : demande, décision, arrivée
  const h = (await pool.query("SELECT etape FROM horodatages WHERE objet = 'dsn_transition' AND objet_id = $1 ORDER BY etape", [t.d.id])).rows.map((x) => x.etape);
  assert.deepStrictEqual(h.sort(), ['arrivee', 'decision', 'demande']);
});
