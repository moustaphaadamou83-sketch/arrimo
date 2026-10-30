const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../src/services');
const t = require('../src/terrain');
const civ = require('../src/civieres');
const og = require('../src/og-outils');
const suivi = require('../src/og-suivi');
const suiviOriginal = suivi.repondreSuivi;
const originaux = { etablissement: s.etablissement, lits: s.litsEtablissement, transferts: s.listeTransferts, file: t.fileAdmission, civ: civ.listeCivieres };
const etabs = [{ id: 1, nom: 'Hôpital A', partage: 'complet' }, { id: 3, nom: 'Hôpital C', partage: 'complet' }];
const utilisateur = { id: 500, etabs: [3], langue: 'fr', role: 'coordonnateur' };
const lits = [
  { id: 20, code: 'MED-204B', type_id: 10, etat: 'occupe', patient_ref: 'P-01004', unite: 'Médecine' },
  { id: 21, code: 'MED-205A', type_id: 10, etat: 'occupe', unite: 'Médecine' },
  { id: 22, code: 'MED-206A', type_id: 10, etat: 'libre', unite: 'Médecine', disponibilite_confirmation: 'capacite_confirmee' },
];
const file = [{ id: 11, civiere_id: 6, patient_ref: 'P-01005', statut: 'attente', lit_suggere: { id: 22, code: 'MED-206A' }, priorite_affichage: 'Priorité clinique non validée', priorite_explication: 'Aucun référentiel approuvé.' }];
const transferts = ['demande', 'validee', 'transport', 'en_route', 'recu', 'refuse'].map((statut, i) => ({ numero: `TR-${i}`, statut, origine_id: 3, destination_id: 1, origine_nom: 'Hôpital C', destination_nom: 'Hôpital A' }));
let lectures;
const pool = { query: async (sql, params) => {
  lectures.push({ sql, params });
  if (sql.includes('FROM types_unite')) return { rows: [{ id: 10, code: 'MED', nom: 'Médecine' }] };
  if (sql.includes('FROM etablissements')) return { rows: etabs };
  throw new Error('Requête inattendue : ' + sql);
} };
test.before(() => {
  suivi.repondreSuivi = async () => null;
  s.etablissement = async (_, id) => ({ ...etabs.find(e => e.id === id), actif: true, module_actif: true, config_id: 1, config: { fuseau: 'Europe/Paris' } });
  s.litsEtablissement = async (_, u, id) => { assert.ok(u.gestionnaire || u.etabs.includes(id)); return id === 3 ? lits : []; };
  s.listeTransferts = async () => transferts;
  t.fileAdmission = async () => file;
  civ.listeCivieres = async () => ({ stats: { occupees: 3, fonctionnelles: 4, taux: 75, libres: 1, nettoyage: 0, plus_24h: 0, plus_48h: 0 }, civieres: [
    { id: 6, code: 'CV-6', etat: 'occupee', heures: 5, patient_ref: 'P-01005' },
    { id: 7, code: 'CV-7', etat: 'occupee', heures: 3, patient_ref: 'P-01006' },
    { id: 8, code: 'CV-8', etat: 'occupee', heures: 4, patient_ref: 'P-01007' },
  ] });
});
test.beforeEach(() => { lectures = []; });
test.after(() => { suivi.repondreSuivi=suiviOriginal;s.etablissement = originaux.etablissement; s.litsEtablissement = originaux.lits; s.listeTransferts = originaux.transferts; t.fileAdmission = originaux.file; civ.listeCivieres = originaux.civ; });
const q = question => og.repondre(pool, utilisateur, 3, question);
test('1 — statut individuel : P-01004 admis à MED-204B, Hôpital C', async () => {
  const r = await q('Quel est le statut actuel du patient P-01004 ?');
  assert.match(r.reponse, /P-01004.*Hôpital C/); assert.match(r.reponse, /admis ; lit MED-204B/);
  assert.deepEqual(r.intentions, ['patient']); assert.doesNotMatch(r.reponse, /Aucun patient en attente/);
});
test('recherche individuelle composée ne retombe pas sur la file d’attente', async () => {
  assert.match((await q('OG, retrouve le patient P-01004 et indique son lit et son statut d’admission.')).reponse, /admis ; lit MED-204B/);
});
test('2 — nombre de lits occupés, distinct des lits libres', async () => {
  const r = await q('Combien de lits de médecine sont occupés à l’Hôpital C ?');
  assert.match(r.reponse, /Lits occupés en médecine — Hôpital C : 2/); assert.deepEqual(r.intentions, ['lits_occupes']);
});
test('3 — explication locale : ne prétend pas connaître les critères historiques', async () => {
  const r = await q('Pourquoi MED-204B a-t-il été proposé ?');
  assert.deepEqual(r.intentions, ['attribution_locale']); assert.match(r.reponse, /Règle locale actuelle/);
  assert.match(r.reponse, /critères historiques.*non conservés/); assert.doesNotMatch(r.reponse, /Établissement proposé maintenant/);
});
test('proposition actuelle : explique les critères métier sur la demande associée', async () => {
  const r = await q('Pourquoi MED-206A a-t-il été proposé ?');
  assert.match(r.reponse, /Proposition locale actuelle pour P-01005/); assert.match(r.reponse, /Priorité clinique non validée/);
});
test('lit inconnu : aucune recommandation réseau hors sujet', async () => {
  const r = await q('Pourquoi MED-999B a-t-il été proposé ?');
  assert.match(r.reponse, /Je ne trouve pas de lit MED-999B/); assert.deepEqual(r.intentions, []);
});
test('4 — transferts en cours excluent demandes, reçus et refusés', async () => {
  const r = await q('Quels transferts sont actuellement en cours ?');
  for (const n of [1, 2, 3]) assert.match(r.reponse, new RegExp(`TR-${n}`));
  for (const n of [0, 4, 5]) assert.doesNotMatch(r.reponse, new RegExp(`TR-${n}`));
});
test('5 — plus de quatre heures : seuil strict et aucune priorité inventée', async () => {
  const r = await q('Quelles civières sont occupées depuis plus de quatre heures ?');
  assert.match(r.reponse, /CV-6/); assert.doesNotMatch(r.reponse, /CV-7|CV-8/);
  assert.match(r.reponse, /Priorité clinique non validée/); assert.match(r.reponse, /ne mesure pas la gravité/);
});
test('6 — procédure après transport : départ puis réception validés par les équipes', async () => {
  const r = await q('Quelle est la prochaine étape après l’organisation d’un transport ?');
  assert.deepEqual(r.intentions, ['procedure']); assert.match(r.reponse, /départ réel/); assert.match(r.reponse, /réception/);
});
test('7 — accès établissement interdit avant toute lecture', async () => {
  await assert.rejects(og.repondre(pool, { ...utilisateur, etabs: [1] }, 3, 'Quel est le statut du patient P-01004 ?'), e => e.statut === 403 || e.status === 403 || e.code === 'etab_interdit');
  assert.equal(lectures.length, 0);
});
test('établissement explicitement cité : pas de fuite interhospitalière', async () => {
  await assert.rejects(og.repondre(pool, { ...utilisateur, etabs: [1] }, 1, 'Quel est le statut du patient P-01004 à l’Hôpital C ?'), e => e.code === 'etab_interdit');
});
test('gestionnaire habilité : bascule explicite vers C', async () => {
  const r = await og.repondre(pool, { ...utilisateur, gestionnaire: true }, 1, 'Quel est le statut du patient P-01004 à l’Hôpital C ?');
  assert.match(r.reponse, /admis ; lit MED-204B/);
});
test('référence absente : indique les limites sans inventer un patient', async () => {
  const r = await q('Quel est le statut actuel du patient P-99999 ?');
  assert.match(r.reponse, /Aucune situation active accessible/); assert.doesNotMatch(r.reponse, /admis ; lit/);
});
test('routage français ne contourne pas OG lorsque l’IA est configurée', async () => {
  const avant = process.env.COPILOTE_IA_CLE; process.env.COPILOTE_IA_CLE = 'fixture';
  try { const r = await require('../src/copilote').question(pool, utilisateur, 3, 'Quel est le statut actuel du patient P-01004 ?'); assert.equal(r.moteur, 'og-outils'); }
  finally { if (avant === undefined) delete process.env.COPILOTE_IA_CLE; else process.env.COPILOTE_IA_CLE = avant; }
});
test('priorité validée : affiche la validation existante sans en inventer une autre', async () => {
  const avant = file[0].priorite_affichage;
  file[0].priorite_affichage = 'Priorité validée : catégorie de démonstration approuvée';
  try {
    const r = await q('Quelles civières sont occupées depuis plus de quatre heures ?');
    assert.match(r.reponse, /CV-6 : Priorité validée : catégorie de démonstration approuvée/);
  } finally { file[0].priorite_affichage = avant; }
});
test('les sources portent une date de lecture et aucune requête n’écrit de données', async () => {
  const r = await q('Quel est le statut du patient P-01004 ?');
  assert.ok(r.sources.some(x => x.module === 'Admissions'));
  assert.ok(r.sources.every(x => Number.isFinite(Date.parse(x.lu_le))));
  assert.ok(lectures.every(x => /^SELECT/.test(x.sql.trim())));
});

test('seuil de quatre heures : utilise l’arrivée exacte, sans perdre les minutes arrondies', async () => {
  const avant = civ.listeCivieres;
  civ.listeCivieres = async () => ({ stats: {occupees:1,fonctionnelles:1,taux:100}, civieres: [{id:77,code:'CV-EXACT',etat:'occupee',heures:4,arrivee_le:new Date(Date.now()-243*60000).toISOString(),patient_ref:'P-01077'}] });
  try { assert.match((await q('Quelles civières sont occupées depuis plus de quatre heures ?')).reponse, /CV-EXACT/); }
  finally { civ.listeCivieres = avant; }
});
