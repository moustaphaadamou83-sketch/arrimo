/**
 * Essais multiétablissements A/B/C (cahier de finalisation, scénarios 1 à 7) sur une copie isolée de la démonstration.
 * Base locale dédiée arrimo_demo_trio* (TRIO_TEST_DATABASE_URL), données entièrement fictives.
 * Chaque étape est vérifiée en base ; un rapport JSON des étapes est écrit si SCENARIOS_RAPPORT est défini.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
process.env.DEMO_MOT_DE_PASSE = 'Scenarios-Fictifs-2026';
process.env.ARRIMO_DEMO = '1';
process.env.ARRIMO_ENV = 'demo';
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const routeur = require('./routeur-fictif.cjs');
const { preparerDemoTrio, urlDemoLocale } = require('../db/demo-trio');
const { viderBase } = require('../db/vider');

const URL = process.env.TRIO_TEST_DATABASE_URL;
const tokens = {}; const etabs = {};
const journal = [];
let pool; let server; let base; let restaurer;

function etape(scenario, texte, preuve) { journal.push({ scenario, etape: texte, preuve, heure: new Date().toISOString() }); }
async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode,
    headers: { 'content-type': 'application/json', ...(qui ? { authorization: `Bearer ${tokens[qui]}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
const ok = (r, msg) => { assert.equal(r.statut, 200, `${msg} : ${JSON.stringify(r.corps)}`); return r.corps; };
const type = async (code) => (await pool.query('SELECT id FROM types_unite WHERE code = $1', [code])).rows[0].id;
const lit = async (id) => (await pool.query('SELECT * FROM lits WHERE id = $1', [id])).rows[0];
const og = async (qui, question) => ok(await appel(qui, 'POST', '/copilote/question', { etablissement_id: etabs[qui], question }), `OG « ${question} »`);
async function civiereLibre(qui) {
  const { civieres } = ok(await appel(qui, 'GET', `/civieres?etablissement_id=${etabs[qui]}`), 'civières');
  let c = civieres.find((x) => x.etat === 'libre');
  if (!c) {
    // Démo saturée : une civière de corridor est ajoutée par l'administration de la copie isolée
    c = (await pool.query(`INSERT INTO civieres (etablissement_id, code, categorie) VALUES ($1, 'COR-T' || nextval('patient_seq'), 'debordement') RETURNING *`, [etabs[qui]])).rows[0];
  }
  return c;
}
/** Un lit libre du type, préparé directement dans la copie isolée si l'hôpital fictif est plein. */
async function litLibreIci(qui, typeId) {
  const q = () => pool.query(`SELECT id, code, version FROM lits WHERE etablissement_id = $1 AND type_id = $2 AND etat = 'libre' AND groupe_age IN ('adulte', 'tous')
    AND NOT isolement AND NOT pression_negative ORDER BY code LIMIT 1`, [etabs[qui], typeId]);
  let l = (await q()).rows[0];
  if (!l) {
    await pool.query(`UPDATE lits SET etat = 'libre', patient_ref = NULL, sortie_prevue = NULL, conge_statut = NULL, nsa_depuis = NULL, nsa_orientation = NULL,
        isolement = false, pression_negative = false, transfert_id = NULL, motif_indispo = NULL, version = version + 1
      WHERE id = (SELECT l.id FROM lits l WHERE l.etablissement_id = $1 AND l.type_id = $2 AND l.etat = 'nettoyage' ORDER BY l.code LIMIT 1)`, [etabs[qui], typeId]);
    l = (await q()).rows[0];
  }
  assert.ok(l, 'lit libre préparé');
  return l;
}

test.before(async () => {
  assert.ok(URL && urlDemoLocale(URL), 'TRIO_TEST_DATABASE_URL locale arrimo_demo_trio* requise');
  restaurer = routeur.activer();
  pool = creerPool(URL);
  await viderBase(pool);
  await preparerDemoTrio(pool, { silencieux: true, fichierAcces: `${__dirname}/../.local/acces-scenarios-test.txt` });
  server = creerApp(pool).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const k of ['a', 'b', 'c', 'd']) {
    const r = ok(await appel(null, 'POST', '/connexion', { email: `hopital.${k}@demo.arrimo`, mot_de_passe: process.env.DEMO_MOT_DE_PASSE }), `connexion ${k}`);
    tokens[k] = r.token;
    etabs[k] = ok(await appel(k, 'GET', '/moi'), 'moi').etablissements[0].id;
  }
  // Partage limité aux établissements de la démonstration : les autres hôpitaux fictifs ne s'interposent pas
  await pool.query(`UPDATE etablissements SET partage = 'aucun' WHERE code NOT IN ('HX', 'HY', 'HC', 'HPED')`);
});
test.after(async () => {
  if (process.env.SCENARIOS_RAPPORT) fs.writeFileSync(process.env.SCENARIOS_RAPPORT, JSON.stringify(journal, null, 1));
  server?.close(); await pool?.end(); restaurer?.();
});

test('scénario 1 — admission interne : urgence, civière, demande, assignation, admission, civière au nettoyage, tableau et journal', async () => {
  const med = await type('MED');
  const cv = await civiereLibre('a');
  const arr = ok(await appel('a', 'POST', '/urgence/arrivees', { etablissement_id: etabs.a, civiere_id: cv.id, prenom: 'Alix', nom: 'Scénario-Un', date_naissance: '1980-03-14' }), 'arrivée');
  etape(1, 'Patient fictif enregistré à l’urgence de A et placé sur une civière', `${arr.patient.reference} sur ${arr.civiere.code}, groupe ${arr.patient.groupe_age}`);
  const ref = arr.patient.reference;
  const d = ok(await appel('a', 'POST', '/admissions', { etablissement_id: etabs.a, civiere_id: cv.id, type_id: med, priorite: 'p2' }), 'demande');
  etape(1, 'Demande de lit créée depuis la civière', `demande n° ${d.id}, statut ${d.statut}`);
  const l = await litLibreIci('a', med);
  ok(await appel('a', 'POST', `/admissions/${d.id}/assigner`, { lit_id: l.id, version: (await lit(l.id)).version }), 'assigner');
  assert.equal((await lit(l.id)).etat, 'reserve');
  etape(1, 'Lit adapté assigné : le lit devient réservé', `${l.code} réservé pour ${ref}`);
  const adm = ok(await appel('a', 'POST', `/admissions/${d.id}/admettre`), 'admettre');
  assert.equal(adm.statut, 'admise');
  const apres = await lit(l.id);
  assert.equal(apres.etat, 'occupe'); assert.equal(apres.patient_ref, ref);
  const civ = (await pool.query('SELECT etat FROM civieres WHERE id = $1', [cv.id])).rows[0];
  assert.equal(civ.etat, 'nettoyage');
  const p = (await pool.query('SELECT parcours FROM patients WHERE reference = $1', [ref])).rows[0];
  assert.equal(p.parcours, 'hospitalise');
  etape(1, 'Admission finalisée : lit occupé, civière en nettoyage, parcours « hospitalisé »', `${l.code} occupé ; civière ${cv.code} en nettoyage`);
  const j = (await pool.query(`SELECT action, nouvel_etat FROM journal WHERE (lit_id = $1 OR civiere_id = $2) AND date > now() - interval '5 minutes' ORDER BY id`, [l.id, cv.id])).rows;
  assert.ok(j.some((x) => x.nouvel_etat === 'occupe') && j.some((x) => x.nouvel_etat === 'nettoyage'));
  const file = ok(await appel('a', 'GET', `/admissions?etablissement_id=${etabs.a}`), 'file');
  assert.ok(!file.some((x) => x.id === d.id));
  etape(1, 'Journal et file d’admission à jour', `${j.length} événements journalisés ; demande retirée de la file`);
  // Variante : admission depuis la fiche Lit (défaut corrigé)
  const cv2 = await civiereLibre('a');
  const arr2 = ok(await appel('a', 'POST', '/urgence/arrivees', { etablissement_id: etabs.a, civiere_id: cv2.id, prenom: 'Béa', nom: 'Scénario-Un-Bis', date_naissance: '1975-06-02',
    demande: { type_id: med, priorite: 'p2' } }), 'arrivée 2');
  const l2 = await litLibreIci('a', med);
  ok(await appel('a', 'POST', `/admissions/${arr2.demande.id}/assigner`, { lit_id: l2.id, version: (await lit(l2.id)).version }), 'assigner 2');
  ok(await appel('a', 'POST', `/lits/${l2.id}/action`, { action: 'admettre' }), 'admettre depuis Lits');
  assert.equal((await pool.query('SELECT statut FROM demandes_admission WHERE id = $1', [arr2.demande.id])).rows[0].statut, 'admise');
  assert.equal((await pool.query('SELECT etat FROM civieres WHERE id = $1', [cv2.id])).rows[0].etat, 'nettoyage');
  const re = await appel('a', 'POST', `/admissions/${arr2.demande.id}/admettre`);
  assert.equal(re.statut, 200); assert.equal(re.corps.deja_admise, true);
  etape(1, 'Variante : admission lancée depuis la fiche Lit, puis second clic dans Admissions', `${l2.code} occupé, demande admise, civière ${cv2.code} en nettoyage, second clic sans effet (idempotent)`);
});

test('scénario 2 — congé : prévu, confirmé, visible par lit, OG, départ réel, nettoyage, disponibilité', async () => {
  const l = (await pool.query(`SELECT id, code FROM lits WHERE etablissement_id = $1 AND code = 'MED-204A'`, [etabs.a])).rows[0];
  const c0 = ok(await appel('a', 'GET', `/conges?etablissement_id=${etabs.a}&jour=demain`), 'congés demain');
  const ligne = c0.lignes.find((x) => x.lit === 'MED-204A');
  assert.equal(ligne.statut, 'prevu'); assert.equal(ligne.etat, 'occupe');
  etape(2, 'Congé prévu visible par numéro de lit (Congés, filtre « demain »)', `MED-204A : ${ligne.statut}, ${ligne.sortie_prevue}`);
  const r = await og('a', 'Le lit MED-204A a-t-il un congé prévu ou confirmé ?');
  assert.match(r.reponse, /Lit MED-204A/); assert.match(r.reponse, /Congé prévu pour demain à 14 h 00/);
  etape(2, 'OG retrouve le congé du lit MED-204A', r.reponse.split('\n').slice(0, 2).join(' / '));
  ok(await appel('a', 'PUT', `/lits/${l.id}/conge`, { statut: 'confirme' }), 'confirmer');
  const r2 = await og('a', 'Ce lit a-t-il un congé confirmé ?');
  assert.match(r2.reponse, /Congé confirmé/);
  etape(2, 'Congé confirmé ; OG suit le contexte (« ce lit »)', r2.reponse.split('\n')[1]);
  ok(await appel('a', 'POST', `/lits/${l.id}/action`, { action: 'liberer' }), 'départ');
  const h = (await pool.query(`SELECT statut, depart_reel_le FROM conges WHERE lit_id = $1 ORDER BY id DESC LIMIT 1`, [l.id])).rows[0];
  assert.equal(h.statut, 'realise');
  etape(2, 'Départ réel simulé : congé réalisé, lit en nettoyage', `départ réel ${h.depart_reel_le.toISOString()}`);
  ok(await appel('a', 'POST', `/nettoyage/${l.id}/debut`), 'début nettoyage');
  ok(await appel('a', 'POST', `/lits/${l.id}/action`, { action: 'nettoyage_ok' }), 'fin nettoyage');
  ok(await appel('a', 'POST', `/lits/${l.id}/confirmer-disponibilite`), 'confirmer disponibilité');
  const fin = await lit(l.id);
  assert.equal(fin.etat, 'libre'); assert.ok(fin.disponibilite_confirmee_le);
  const ind = ok(await appel('a', 'GET', `/indicateurs?etablissement_id=${etabs.a}`), 'indicateurs');
  assert.ok(ind.capacite.libres_confirmes >= 1);
  etape(2, 'Nettoyage commencé puis confirmé, disponibilité confirmée, capacités à jour', `MED-204A libre et confirmé ; ${ind.capacite.libres_confirmes} lit(s) libre(s) confirmé(s) chez A`);
});

test('scénario 3 — NSA : désignation, orientation réadaptation, suivi, compteurs, retrait', async () => {
  const l = (await pool.query(`SELECT id, code FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' AND nsa_depuis IS NULL ORDER BY code LIMIT 1`, [etabs.b])).rows[0];
  const avant = ok(await appel('b', 'GET', `/nsa?etablissement_id=${etabs.b}`), 'NSA avant').total;
  ok(await appel('b', 'POST', `/lits/${l.id}/nsa`, { orientation: 'readaptation' }), 'désigner NSA');
  const n = ok(await appel('b', 'GET', `/nsa?etablissement_id=${etabs.b}`), 'NSA');
  assert.equal(n.total, avant + 1); assert.ok(n.lits.some((x) => x.code === l.code && x.nsa_orientation === 'readaptation'));
  const ind = ok(await appel('b', 'GET', `/indicateurs?etablissement_id=${etabs.b}`), 'indicateurs');
  assert.equal(ind.nsa.total, n.total);
  etape(3, 'Patient de B désigné NSA, orientation réadaptation ; NSA et Indicateurs synchronisés', `${l.code} ; ${n.total} NSA (${n.taux} %)`);
  const r = await og('b', 'Résume les NSA');
  assert.match(r.reponse, new RegExp(l.code));
  etape(3, 'OG résume les NSA de B', r.reponse.split('\n')[0]);
  ok(await appel('b', 'PUT', `/lits/${l.id}/nsa`, { orientation: 'chsld' }), 'orientation');
  ok(await appel('b', 'DELETE', `/lits/${l.id}/nsa`), 'retrait');
  assert.equal(ok(await appel('b', 'GET', `/nsa?etablissement_id=${etabs.b}`), 'NSA après').total, avant);
  // Un autre établissement ne peut pas modifier ce lit
  assert.equal((await appel('a', 'POST', `/lits/${l.id}/nsa`, { orientation: 'chsld' })).statut, 404);
  etape(3, 'Orientation modifiée puis statut retiré ; A ne peut pas agir sur un lit de B', 'refus 404 pour A');
  // Le centre pédiatrique n'a pas le module NSA adulte
  assert.equal((await appel('d', 'GET', `/nsa?etablissement_id=${etabs.d}`)).statut, 403);
  etape(3, 'Module NSA désactivé pour le centre pédiatrique (configuration modulaire)', 'refus 403 module_desactive');
});

let trB;
test('scénario 4 — transfert A → B de bout en bout : même numéro, lit réservé, chambre prête, transport, départ, réception', async () => {
  const med = await type('MED');
  // Préparation du scénario : B confirme ses lits de médecine ; ceux de C ne sont pas confirmés (donc pas proposés)
  await pool.query(`UPDATE lits SET disponibilite_confirmee_le = now() WHERE etablissement_id = $1 AND type_id = $2 AND etat = 'libre'`, [etabs.b, med]);
  await pool.query(`UPDATE lits SET disponibilite_confirmee_le = NULL WHERE etablissement_id = $1 AND type_id = $2 AND etat = 'libre'`, [etabs.c, med]);
  const cv = await civiereLibre('a');
  const arr = ok(await appel('a', 'POST', '/urgence/arrivees', { etablissement_id: etabs.a, civiere_id: cv.id, prenom: 'Côme', nom: 'Scénario-Quatre', date_naissance: '1961-11-30',
    demande: { type_id: med, priorite: 'p1' } }), 'arrivée');
  const rech = ok(await appel('a', 'GET', `/recherche?depuis=${etabs.a}&type_id=${med}`), 'recherche');
  const propose = rech.suggestions.find((x) => x.recommande);
  assert.equal(propose.etablissement_id, etabs.b);
  etape(4, 'A recherche un lit de médecine : B est proposé (capacité confirmée, route calculée)', `${propose.nom} · ${propose.raison}`);
  const r = await og('a', 'Où trouver un lit de médecine le plus proche ?');
  assert.match(r.reponse, /Hôpital B/);
  etape(4, 'OG propose B', r.reponse.split('\n')[0]);
  const t = ok(await appel('a', 'POST', `/admissions/${arr.demande.id}/transferer`, { destination_id: etabs.b, lit_id: propose.lit?.id, version: propose.lit?.version }), 'transfert');
  trB = t;
  assert.equal((await lit(t.lit_id)).etat, 'reserve');
  etape(4, 'A envoie la demande ; le lit de B est réservé', `${t.numero} · lit ${t.lit_code}`);
  for (const [qui, e] of [['b', 'accepter'], ['b', 'chambre_prete'], ['a', 'transport'], ['a', 'depart'], ['b', 'reception']]) {
    const x = ok(await appel(qui, 'POST', `/transferts/${t.id}/${e}`), e);
    assert.equal(x.numero, t.numero, 'même numéro de bout en bout');
    etape(4, `Étape ${e} (${qui.toUpperCase()})`, `${x.numero} : ${x.statut}`);
  }
  assert.equal((await lit(t.lit_id)).etat, 'occupe');
  assert.equal((await pool.query('SELECT etat FROM civieres WHERE id = $1', [cv.id])).rows[0].etat, 'nettoyage');
  const jb = ok(await appel('b', 'GET', `/journal?etablissement_id=${etabs.b}`), 'journal B');
  assert.ok(jb.some((x) => x.transfert_numero === t.numero));
  etape(4, 'Réception : lit de B occupé, civière de A au nettoyage, journaux cohérents', `${t.lit_code} occupé`);
});

test('scénario 5 — refus de B, explication par OG, alternative C acceptée', async () => {
  const chir = await type('CHIR');
  await pool.query(`UPDATE lits SET disponibilite_confirmee_le = now() WHERE etablissement_id IN ($1, $2) AND type_id = $3 AND etat = 'libre'`, [etabs.b, etabs.c, chir]);
  const d = ok(await appel('a', 'POST', '/admissions', { etablissement_id: etabs.a, type_id: chir, patient_ref: 'P-95005', priorite: 'p2' }), 'demande');
  const rech = ok(await appel('a', 'GET', `/recherche?depuis=${etabs.a}&type_id=${chir}`), 'recherche');
  const b = rech.suggestions.find((x) => x.etablissement_id === etabs.b);
  const t = ok(await appel('a', 'POST', `/admissions/${d.id}/transferer`, { destination_id: etabs.b, lit_id: b.lit?.id, version: b.lit?.version }), 'transfert vers B');
  ok(await appel('b', 'POST', `/transferts/${t.id}/refuser`, { motif_code: 'pas_de_personnel', motif: 'Plus de personnel en chirurgie cette nuit' }), 'refus');
  assert.equal((await lit(t.lit_id)).etat, 'libre');
  etape(5, 'B refuse avec un motif ; son lit redevient libre', `${t.numero} refusé`);
  const alt = ok(await appel('a', 'GET', `/transferts/${t.id}/alternatives`), 'alternatives');
  assert.ok(!alt.suggestions.some((x) => x.etablissement_id === etabs.b), 'B exclu après refus');
  const c = alt.suggestions.find((x) => x.recommande);
  assert.equal(c.etablissement_id, etabs.c);
  etape(5, 'Plan B : la recherche actualisée exclut B et propose C', `${c.nom} · ${c.raison}`);
  const r = await og('a', 'Pourquoi l’hôpital C est-il proposé plutôt que B en chirurgie ?');
  assert.match(r.reponse, /a refusé TR-\d+ : « Plus de personnel en chirurgie cette nuit »/);
  etape(5, 'OG explique le refus de B et la proposition', r.reponse.split('\n').filter((x) => /Hôpital B|Hôpital C|proposé/.test(x)).join(' / '));
  const d2 = ok(await appel('a', 'POST', '/admissions', { etablissement_id: etabs.a, type_id: chir, patient_ref: 'P-95006', priorite: 'p2' }), 'nouvelle demande');
  const t2 = ok(await appel('a', 'POST', `/admissions/${d2.id}/transferer`, { destination_id: etabs.c, lit_id: c.lit?.id, version: c.lit?.version }), 'transfert vers C');
  ok(await appel('c', 'POST', `/transferts/${t2.id}/accepter`), 'C accepte');
  ok(await appel('c', 'POST', `/transferts/${t2.id}/chambre_prete`), 'C chambre prête');
  etape(5, 'A transmet une nouvelle demande ; C accepte et prépare la réception', `${t2.numero} accepté, chambre prête`);
});

test('scénario 6 — pédiatrie : aucun lit adulte proposé, groupe d’âge, équipements, droits, explication OG', async () => {
  const sip = await type('SIP'); const si = await type('SI'); const chir = await type('CHIR');
  // Enfant fictif de 7 ans à l'urgence de A (groupe d'âge calculé depuis la date de naissance)
  const cv = await civiereLibre('a');
  const n = new Date(); const dn = `${n.getFullYear() - 7}-01-15`;
  const arr = ok(await appel('a', 'POST', '/urgence/arrivees', { etablissement_id: etabs.a, civiere_id: cv.id, prenom: 'Pia', nom: 'Scénario-Six', date_naissance: dn }), 'arrivée enfant');
  assert.equal(arr.patient.groupe_age, 'pediatrique');
  etape(6, 'Enfant fictif enregistré à l’urgence de A', `${arr.patient.reference}, groupe d’âge calculé : pédiatrique`);
  // Soins intensifs pédiatriques : seul le centre pédiatrique est proposé, jamais un lit de soins intensifs adultes de B
  const rSip = ok(await appel('a', 'GET', `/recherche?depuis=${etabs.a}&type_id=${sip}&ventilation=1`), 'recherche SIP');
  assert.ok(rSip.suggestions.length >= 1);
  assert.ok(rSip.suggestions.every((x) => x.etablissement_id === etabs.d), 'seul le centre pédiatrique a des SIP');
  const libresSiB = (await pool.query(`SELECT count(*)::int n FROM lits WHERE etablissement_id = $1 AND type_id = $2 AND etat = 'libre'`, [etabs.b, si])).rows[0].n;
  assert.ok(libresSiB > 0, 'B a des lits de soins intensifs adultes libres');
  etape(6, 'Demande de soins intensifs pédiatriques : B (lits SI adultes libres) n’est pas proposé ; le centre pédiatrique l’est', `${libresSiB} lit(s) SI adulte(s) libre(s) chez B, exclus ; proposé : ${rSip.suggestions[0].nom}`);
  // Chirurgie générale pour un enfant : les lits adultes de B sont écartés et expliqués ; les lits « tous âges » de C restent possibles
  // Configuration de C : un lit de chirurgie libre en chambre mixte « tous âges » (réglage d'administration de la structure)
  const libreC = await litLibreIci('c', chir);
  await pool.query(`UPDATE lits SET groupe_age = 'tous' WHERE id = $1`, [libreC.id]);
  await pool.query(`UPDATE lits SET disponibilite_confirmee_le = now() WHERE type_id = $1 AND etat = 'libre'`, [chir]);
  const d = ok(await appel('a', 'POST', '/admissions', { etablissement_id: etabs.a, civiere_id: cv.id, type_id: chir, priorite: 'p2' }), 'demande chirurgie enfant');
  assert.equal(d.groupe_age, 'pediatrique');
  const rCh = ok(await appel('a', 'GET', `/recherche?depuis=${etabs.a}&type_id=${chir}&groupe_age=pediatrique`), 'recherche chirurgie enfant');
  const b = rCh.suggestions.find((x) => x.etablissement_id === etabs.b);
  const c = rCh.suggestions.find((x) => x.etablissement_id === etabs.c);
  assert.ok(!b || b.libres === 0, 'aucun lit adulte de B compté pour un enfant');
  if (b) assert.ok(b.exclusions.age > 0, 'exclusion expliquée par le groupe d’âge');
  assert.ok(c && c.libres >= 1, 'lit « tous âges » de C proposé');
  etape(6, 'Chirurgie pour un enfant : lits adultes écartés (raison : groupe d’âge), lit « tous âges » de C possible', `B : ${b ? `${b.exclusions.age} lit(s) écarté(s) pour l’âge` : 'non proposé'} ; C : ${c.libres} lit(s) compatible(s)`);
  // Transfert direct vers un lit adulte : refusé par le serveur
  const litAdulteB = (await pool.query(`SELECT id, version FROM lits WHERE etablissement_id = $1 AND type_id = $2 AND etat = 'libre' AND groupe_age = 'adulte' LIMIT 1`, [etabs.b, chir])).rows[0];
  if (litAdulteB) {
    const refus = await appel('a', 'POST', `/admissions/${d.id}/transferer`, { destination_id: etabs.b, lit_id: litAdulteB.id, version: litAdulteB.version });
    assert.equal(refus.statut, 409);
    etape(6, 'Transfert forcé vers un lit adulte de B refusé par le serveur', `code ${refus.corps.code}`);
  }
  const r = await og('a', 'Quels établissements ont des lits pédiatriques potentiellement compatibles ?');
  assert.match(r.reponse, /Centre pédiatrique des Érables/); assert.match(r.reponse, /compatibilité clinique reste à valider/);
  etape(6, 'OG liste les capacités pédiatriques compatibles et rappelle la validation clinique', r.reponse.split('\n').slice(0, 3).join(' / '));
  // Droits : le centre pédiatrique ne lit pas les lits de A ; A ne lit pas les patients du centre
  assert.equal((await appel('d', 'GET', `/lits?etablissement_id=${etabs.a}`)).statut, 403);
  assert.equal((await appel('a', 'GET', `/patients?etablissement_id=${etabs.d}`)).statut, 403);
  const rd = await og('d', 'Quels lits sont libres en soins intensifs pédiatriques ?');
  assert.match(rd.reponse, /SIP-/);
  etape(6, 'Droits respectés entre A et le centre pédiatrique ; OG du centre liste ses lits SIP', rd.reponse.split('\n')[0]);
  // Le réseau ne voit jamais le nom d'un patient fictif
  const reseau = JSON.stringify(ok(await appel('b', 'GET', `/reseau?depuis=${etabs.b}`), 'réseau'));
  assert.ok(!reseau.includes('Scénario-Six') && !reseau.includes('Pia'));
});

test('scénario 7 — concurrence et sécurité : une seule réservation, pas de double admission, isolement, reprise', async () => {
  const med = await type('MED');
  const debut = new Date();
  const l = await litLibreIci('b', med);
  const v = (await lit(l.id)).version;
  const essais = await Promise.all(Array.from({ length: 8 }, (_, i) => appel('b', 'POST', `/lits/${l.id}/action`, { action: 'reserver', version: v, patient_ref: `P-9700${i}` })));
  assert.equal(essais.filter((x) => x.statut === 200).length, 1);
  etape(7, 'Huit réservations simultanées du même lit : une seule valide', `${essais.filter((x) => x.statut === 409).length} refus 409`);
  const adm = await Promise.all([appel('b', 'POST', `/lits/${l.id}/action`, { action: 'admettre' }), appel('b', 'POST', `/lits/${l.id}/action`, { action: 'admettre' })]);
  assert.deepEqual(adm.map((x) => x.statut).sort(), [200, 409]);
  const occ = (await pool.query(`SELECT count(*)::int n FROM journal WHERE lit_id = $1 AND nouvel_etat = 'occupe' AND NOT refuse AND date >= $2`, [l.id, debut])).rows[0].n;
  assert.equal(occ, 1);
  etape(7, 'Deux admissions simultanées : une seule appliquée', 'un seul passage à « occupé » au journal');
  for (const [qui, autre] of [['a', 'b'], ['b', 'c'], ['c', 'a'], ['d', 'b']]) {
    assert.equal((await appel(qui, 'GET', `/lits?etablissement_id=${etabs[autre]}`)).statut, 403);
    assert.equal((await appel(qui, 'GET', `/conges?etablissement_id=${etabs[autre]}`)).statut, 403);
    assert.equal((await appel(qui, 'GET', `/vigilance?etablissement_id=${etabs[autre]}`)).statut, 403);
    assert.equal((await appel(qui, 'POST', '/copilote/question', { etablissement_id: etabs[autre], question: 'État actuel ?' })).statut, 403);
  }
  etape(7, 'Aucun accès interétablissement (lits, congés, alertes, OG) entre A, B, C et le centre pédiatrique', '16 refus 403');
  // Panne au milieu d'une admission : la transaction est annulée en entier (aucune demande admise sans lit occupé)
  const cv = await civiereLibre('b');
  const arr = ok(await appel('b', 'POST', '/urgence/arrivees', { etablissement_id: etabs.b, civiere_id: cv.id, prenom: 'Dom', nom: 'Scénario-Sept', date_naissance: '1990-01-01', demande: { type_id: med } }), 'arrivée');
  const l2 = await litLibreIci('b', med);
  ok(await appel('b', 'POST', `/admissions/${arr.demande.id}/assigner`, { lit_id: l2.id, version: (await lit(l2.id)).version }), 'assigner');
  const c = await pool.connect();
  await c.query('BEGIN'); await c.query('SELECT 1 FROM lits WHERE id = $1 FOR NO KEY UPDATE', [l2.id]);   // lit verrouillé par un autre poste
  const bloque = await appel('b', 'POST', `/admissions/${arr.demande.id}/admettre`);
  await c.query('ROLLBACK'); c.release();
  assert.equal(bloque.statut, 409);
  assert.equal((await pool.query('SELECT statut FROM demandes_admission WHERE id = $1', [arr.demande.id])).rows[0].statut, 'assignee');
  assert.equal((await pool.query('SELECT etat FROM civieres WHERE id = $1', [cv.id])).rows[0].etat, 'occupee');
  const reprise = ok(await appel('b', 'POST', `/admissions/${arr.demande.id}/admettre`), 'reprise');
  assert.equal(reprise.statut, 'admise');
  etape(7, 'Lit verrouillé pendant l’admission : refus propre sans état partiel, puis reprise réussie', 'demande restée « assignée », civière occupée ; reprise : admise');
});
