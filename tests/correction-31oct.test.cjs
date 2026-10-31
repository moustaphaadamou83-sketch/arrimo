'use strict';
/* Chantier du 31 oct. 2026 : langue des réponses d'OG, préférences sur le compte, nom de l'assistant par établissement,
   alternatives du réseau calculées automatiquement dans les Admissions. Base dédiée arrimo_demo_trio* (données fictives). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
process.env.DEMO_MOT_DE_PASSE = 'Trio-Fictif-2026';
process.env.ARRIMO_DEMO = '1';
process.env.ARRIMO_ENV = 'demo';
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const routeur = require('./routeur-fictif.cjs');
const { preparerDemoTrio, urlDemoLocale } = require('../db/demo-trio');

const URL_TEST = process.env.TRIO_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;
const comptes = { a: 'hopital.a@demo.arrimo', b: 'hopital.b@demo.arrimo', c: 'hopital.c@demo.arrimo' };
const tokens = {};
let pool; let server; let base; let restaurerRouteur;
async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode,
    headers: { 'content-type': 'application/json', ...(qui ? { authorization: `Bearer ${tokens[qui]}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
const ok = async (qui, m, c, b) => { const r = await appel(qui, m, c, b); assert.ok(r.statut < 300, `${m} ${c} → ${r.statut} ${JSON.stringify(r.corps)}`); return r.corps; };
const id = async (code) => (await pool.query('SELECT id FROM etablissements WHERE code=$1', [code])).rows[0].id;
const type = async (code) => (await pool.query('SELECT id FROM types_unite WHERE code=$1', [code])).rows[0].id;

test.before(async () => {
  assert.ok(URL_TEST, 'TRIO_TEST_DATABASE_URL requis');
  assert.ok(urlDemoLocale(URL_TEST), 'base locale arrimo_demo_trio* exigée');
  restaurerRouteur = routeur.activer();
  pool = creerPool(URL_TEST);
  await preparerDemoTrio(pool, { silencieux: true, fichierAcces: path.join(__dirname, '..', '.local', 'acces-correction-31oct-test.txt') });
  server = creerApp(pool).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, email] of Object.entries(comptes)) {
    const r = await appel(null, 'POST', '/connexion', { email, mot_de_passe: 'Trio-Fictif-2026' });
    assert.equal(r.statut, 200, `connexion ${k}`); tokens[k] = r.corps.token;
  }
});
test.after(async () => { server?.close(); await pool?.end(); restaurerRouteur?.(); });

test('OG : réponse dans la langue de la question, quelle que soit la langue de l’interface, et langue renvoyée au navigateur', async () => {
  const hx = await id('HX');
  const en = await ok('a', 'POST', '/copilote/question', { etablissement_id: hx, langue: 'fr', question: 'How many beds are available?' });
  assert.equal(en.langue, 'en'); assert.doesNotMatch(en.reponse, /\b(lits?|disponibles?)\b/i, en.reponse);
  const fr = await ok('a', 'POST', '/copilote/question', { etablissement_id: hx, langue: 'en', question: 'Combien de lits sont disponibles ?' });
  assert.equal(fr.langue, 'fr'); assert.match(fr.reponse, /lit/i);
  const explicite = await ok('a', 'POST', '/copilote/question', { etablissement_id: hx, langue: 'fr', question: 'Réponds en anglais : combien de lits libres ?' });
  assert.equal(explicite.langue, 'en');
  const ambigu = await ok('a', 'POST', '/copilote/question', { etablissement_id: hx, langue: 'en', question: 'ok' });
  assert.equal(ambigu.langue, 'en', 'question ambiguë : préférence de conversation');
});

test('compte : langue de l’interface et préférences vocales enregistrées en base, propres à chaque utilisateur', async () => {
  assert.equal((await appel('a', 'PUT', '/moi/langue', { langue_interface: 'de' })).statut, 400);
  await ok('a', 'PUT', '/moi/langue', { langue_interface: 'en' });
  assert.equal((await ok('a', 'GET', '/moi')).utilisateur.langue_interface, 'en');
  assert.equal((await ok('b', 'GET', '/moi')).utilisateur.langue_interface, null, 'autre compte inchangé');
  assert.equal((await appel('a', 'PUT', '/moi/og-voix', { consentement: true, langue: 'klingon', automatique: false })).statut, 400);
  assert.equal((await appel('a', 'PUT', '/moi/og-voix', { consentement: 'oui', langue: 'en', automatique: false })).statut, 400);
  const p = await ok('a', 'PUT', '/moi/og-voix', { consentement: true, langue: 'en', automatique: true });
  assert.equal(p.langue, 'en'); assert.equal(p.consentement, true);
  const moi = await ok('a', 'GET', '/moi');
  assert.deepEqual({ c: moi.utilisateur.preferences_og.consentement, l: moi.utilisateur.preferences_og.langue, a: moi.utilisateur.preferences_og.automatique }, { c: true, l: 'en', a: true });
  assert.deepEqual((await ok('b', 'GET', '/moi')).utilisateur.preferences_og, {});
  await ok('a', 'PUT', '/moi/langue', { langue_interface: 'fr' });
});

test('assistant : nom propre à chaque établissement (Charles, Aya, OG), sans fuite entre hôpitaux', async () => {
  const [hx, hy, hc] = await Promise.all([id('HX'), id('HY'), id('HC')]);
  const lire = (qui, e) => ok(qui, 'GET', `/og/configuration?etablissement_id=${e}`);
  const nommer = async (qui, e, nom) => { const c = await lire(qui, e); return ok(qui, 'PUT', '/og/configuration', { etablissement_id: e, fonctions: {}, personnalisation: { ...c.personnalisation, nom } }); };
  await nommer('a', hx, 'Charles'); await nommer('b', hy, 'Aya');
  assert.equal((await lire('a', hx)).personnalisation.nom, 'Charles');
  assert.equal((await lire('b', hy)).personnalisation.nom, 'Aya');
  assert.equal((await lire('c', hc)).personnalisation.nom, 'OG');
  assert.equal((await appel('a', 'GET', `/og/configuration?etablissement_id=${hy}`)).statut, 403, 'A ne lit pas la configuration de B');
  assert.equal((await appel('a', 'PUT', '/og/configuration', { etablissement_id: hy, fonctions: {}, personnalisation: { nom: 'Pirate' } })).statut, 403);
  // Les journaux historiques ne sont pas réécrits : « OG » reste l'identifiant technique.
  await nommer('a', hx, 'OG'); await nommer('b', hy, 'OG');
});

test('admissions : capacité insuffisante détectée et alternatives du réseau proposées automatiquement, sans transfert automatique', async () => {
  const [hx, hy, si] = await Promise.all([id('HX'), id('HY'), type('SI')]);
  const transfertsAvant = (await pool.query('SELECT count(*)::int n FROM transferts')).rows[0].n;
  // Hôpital A : exactement un lit SI libre et compatible (par les actions normales : nettoyage confirmé, remise en service).
  const libererUn = async (exclure = []) => {
    const l = (await pool.query(`SELECT id, version, etat FROM lits WHERE etablissement_id=$1 AND type_id=$2 AND etat IN ('nettoyage','indispo') AND NOT (id = ANY($3)) ORDER BY etat, code LIMIT 1`, [hx, si, exclure])).rows[0];
    if (l) { await ok('a', 'POST', `/lits/${l.id}/action`, { action: l.etat === 'nettoyage' ? 'nettoyage_ok' : 'remettre', version: l.version }); return l.id; }
    const o = (await pool.query(`SELECT id, version FROM lits WHERE etablissement_id=$1 AND type_id=$2 AND etat='occupe' AND NOT (id = ANY($3)) ORDER BY code LIMIT 1`, [hx, si, exclure])).rows[0];
    await ok('a', 'POST', `/lits/${o.id}/action`, { action: 'liberer', version: o.version });
    const n = (await pool.query('SELECT version FROM lits WHERE id=$1', [o.id])).rows[0];
    await ok('a', 'POST', `/lits/${o.id}/action`, { action: 'nettoyage_ok', version: n.version }); return o.id;
  };
  let libres = (await pool.query(`SELECT id, version FROM lits WHERE etablissement_id=$1 AND type_id=$2 AND etat='libre' ORDER BY code`, [hx, si])).rows;
  if (!libres.length) await libererUn();
  libres = (await pool.query(`SELECT id, code, version FROM lits WHERE etablissement_id=$1 AND type_id=$2 AND etat='libre' ORDER BY code`, [hx, si])).rows;
  for (const l of libres.slice(1)) await ok('a', 'POST', `/lits/${l.id}/action`, { action: 'hors_service', version: l.version, motif: 'travaux' });
  const litsA = libres.slice(0, 1);
  // Le réseau a des lits SI libres et confirmés en B.
  const litsB = (await pool.query(`SELECT id FROM lits WHERE etablissement_id=$1 AND type_id=$2 AND etat='libre' ORDER BY code`, [hy, si])).rows;
  assert.ok(litsB.length >= 1, 'lits SI libres en B');
  for (const l of litsB) await ok('b', 'POST', `/lits/${l.id}/confirmer-disponibilite`);
  // File SI de A vidée des demandes de démonstration (base de test dédiée) pour un scénario déterministe.
  for (const d of (await pool.query(`SELECT id FROM demandes_admission WHERE etablissement_id=$1 AND type_id=$2 AND statut='attente'`, [hx, si])).rows) await ok('a', 'POST', `/admissions/${d.id}/annuler`);
  // Deux patients pour un lit, puis trois patients pour deux lits.
  const d1 = await ok('a', 'POST', '/admissions', { etablissement_id: hx, type_id: si, patient_ref: 'P-30862', priorite: 'p2', provenance: 'urgence', besoins: {} });
  const d2 = await ok('a', 'POST', '/admissions', { etablissement_id: hx, type_id: si, patient_ref: 'P-54073', priorite: 'p2', provenance: 'urgence', besoins: {} });
  let file = await ok('a', 'GET', `/admissions?etablissement_id=${hx}`);
  const f1 = file.find((d) => d.id === d1.id), f2 = file.find((d) => d.id === d2.id);
  assert.equal(f1.lit_suggere?.id, litsA[0].id, 'le premier de la file a le lit local');
  assert.equal(f2.lit_suggere, null, 'le même lit n’est pas proposé deux fois');
  assert.equal(f2.couverture_locale, 'insuffisante'); assert.equal(f2.lit_concurrent?.id, litsA[0].id, 'attribution locale toujours possible sur décision du personnel');
  assert.equal(f2.deficit.manque >= 1, true);
  let alt = await ok('a', 'GET', `/admissions/alternatives?etablissement_id=${hx}`);
  const a2 = alt.demandes.find((x) => x.demande_id === d2.id);
  assert.ok(a2, 'alternatives calculées pour P-54073 sans clic');
  assert.ok(a2.suggestions.length >= 1); assert.ok(a2.suggestions.every((x) => x.etablissement_id !== hx && x.libres > 0));
  const b = a2.suggestions.find((x) => x.etablissement_id === hy);
  assert.ok(b, 'Hôpital B proposé'); assert.equal(b.confirmation.statut, 'capacite_confirmee'); assert.ok(b.confirmation.confirme_le, 'fraîcheur de la confirmation');
  assert.ok(!alt.demandes.some((x) => x.demande_id === d1.id), 'pas d’alternatives pour une demande couverte localement');
  // Trois patients pour deux lits : le troisième est signalé.
  const l2 = await libererUn([litsA[0].id]);
  const d3 = await ok('a', 'POST', '/admissions', { etablissement_id: hx, type_id: si, patient_ref: 'P-77001', priorite: 'p2', provenance: 'urgence', besoins: {} });
  file = await ok('a', 'GET', `/admissions?etablissement_id=${hx}`);
  const enAttente = file.filter((d) => [d1.id, d2.id, d3.id].includes(d.id));
  const sansLit = enAttente.filter((d) => !d.lit_suggere);
  if (l2) { assert.equal(sansLit.length, 1, 'trois demandes, deux lits'); assert.equal(sansLit[0].id, d3.id); assert.equal(sansLit[0].deficit.manque, 1); }
  assert.equal(new Set(enAttente.filter((d) => d.lit_suggere).map((d) => d.lit_suggere.id)).size, enAttente.filter((d) => d.lit_suggere).length, 'aucun lit proposé deux fois');
  // Lit externe devenu indisponible : la proposition disparaît à l'actualisation (cache invalidé par le changement d'état).
  for (const l of (await pool.query(`SELECT id, version FROM lits WHERE etablissement_id=$1 AND type_id=$2 AND etat='libre'`, [hy, si])).rows)
    await ok('b', 'POST', `/lits/${l.id}/action`, { action: 'hors_service', version: l.version, motif: 'equipement' });
  await new Promise((r) => setTimeout(r, 5100));   // rythme minimal entre deux recherches identiques
  alt = await ok('a', 'GET', `/admissions/alternatives?etablissement_id=${hx}`);
  for (const x of alt.demandes.filter((x) => x.type_id === si)) assert.ok(!x.suggestions.some((s) => s.etablissement_id === hy), 'B n’est plus proposé en soins intensifs');
  // Tous les types d'unité sont traités (aucune liste de départements) : chaque demande sans lit local, quelle que soit
  // son unité (médecine, chirurgie, pédiatrie, soins intensifs…), reçoit ses alternatives.
  const fileTous = await ok('a', 'GET', `/admissions?etablissement_id=${hx}`);
  const sansLitTous = fileTous.filter((d) => d.statut === 'attente' && !d.lit_suggere);
  assert.deepEqual(new Set(alt.demandes.map((x) => x.demande_id)), new Set(sansLitTous.map((d) => d.id)));
  assert.ok(new Set(sansLitTous.map((d) => d.type_id)).size >= 1);
  // Permissions : B ne voit pas les admissions ni les alternatives de A.
  assert.equal((await appel('b', 'GET', `/admissions/alternatives?etablissement_id=${hx}`)).statut, 403);
  // Aucune attribution ni aucun transfert automatique.
  assert.equal((await pool.query('SELECT count(*)::int n FROM transferts')).rows[0].n, transfertsAvant);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM demandes_admission WHERE id = ANY($1) AND statut <> 'attente'`, [[d1.id, d2.id, d3.id]])).rows[0].n, 0);
  // Recherches concurrentes : regroupées, sans erreur.
  const lots = await Promise.all([1, 2, 3, 4].map(() => appel('a', 'GET', `/admissions/alternatives?etablissement_id=${hx}`)));
  assert.ok(lots.every((r) => r.statut === 200));
  // Préparer le transfert reste une action explicite, confirmée par l'utilisateur.
  for (const d of [d1, d2, d3]) await ok('a', 'POST', `/admissions/${d.id}/annuler`);
});
