const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
process.env.DEMO_MOT_DE_PASSE = 'Trio-Fictif-2026';
process.env.ARRIMO_DEMO = '1';
process.env.ARRIMO_ENV = 'demo';
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const routeur = require('./routeur-fictif.cjs');
const { construirePlanCoordination } = require('../src/copilote');
const { preparerDemoTrio, urlDemoLocale } = require('../db/demo-trio');

const URL_TEST = process.env.TRIO_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;
const comptes = { a: 'hopital.a@demo.arrimo', b: 'hopital.b@demo.arrimo', c: 'hopital.c@demo.arrimo', reseau: 'reseau@demo.arrimo' };
const accesTest = path.join(__dirname, '..', '.local', 'acces-demo-trio-test.txt');
const tokens = {};
let pool; let server; let base; let browser; let restaurerRouteur;

async function appel(qui, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode,
    headers: { 'content-type': 'application/json', ...(qui ? { authorization: `Bearer ${tokens[qui]}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
const id = async (code) => (await pool.query('SELECT id FROM etablissements WHERE code=$1', [code])).rows[0].id;
const type = async (code) => (await pool.query('SELECT id FROM types_unite WHERE code=$1', [code])).rows[0].id;
const litLibre = async (etab, typeId) => (await pool.query(
  `SELECT id, code, version FROM lits WHERE etablissement_id=$1 AND type_id=$2 AND etat='libre'
    AND disponibilite_confirmee_le >= now() - interval '1 hour' ORDER BY code LIMIT 1`, [etab, typeId])).rows[0];

test.before(async () => {
  assert.ok(URL_TEST, 'TRIO_TEST_DATABASE_URL requis');
  assert.ok(urlDemoLocale(URL_TEST), 'les tests exigent une base locale arrimo_demo_trio*');
  assert.equal(urlDemoLocale('postgresql://user@db.example/arrimo_demo_trio_prod'), false, 'jamais de reset distant');
  assert.equal(urlDemoLocale('postgresql://user@127.0.0.1/arrimo_production'), false, 'jamais de reset de base non dédiée');
  restaurerRouteur = routeur.activer();
  pool = creerPool(URL_TEST);
  await preparerDemoTrio(pool, { silencieux: true, fichierAcces: accesTest });
  server = creerApp(pool).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  for (const [key, email] of Object.entries(comptes)) {
    const r = await appel(null, 'POST', '/connexion', { email, mot_de_passe: 'Trio-Fictif-2026' });
    assert.equal(r.statut, 200, `connexion ${key}`);
    tokens[key] = r.corps.token;
  }
});
test.after(async () => { await browser?.close(); server?.close(); await pool?.end(); restaurerRouteur?.(); });

test('démo A/B/C : modèle existant, trois accès isolés, transaction, refus Plan B et réception fictive', async () => {
  const [hx, hy, hc, med] = await Promise.all([id('HX'), id('HY'), id('HC'), type('MED')]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM transferts WHERE distance_km IS NOT NULL OR minutes_route IS NOT NULL')).rows[0].n, 0,
    'les scénarios historiques n’affichent aucun trajet inventé');
  assert.equal(fs.statSync(accesTest).mode & 0o777, 0o600, 'fichier de comptes de test en lecture propriétaire uniquement');
  const liens = (await pool.query(`SELECT count(*)::int AS n FROM lits l JOIN chambres ch ON ch.id=l.chambre_id
    JOIN unites u ON u.id=l.unite_id WHERE l.etablissement_id IN ($1,$2,$3)
    AND (ch.unite_id<>u.id OR l.etablissement_id<>u.etablissement_id OR l.type_id<>u.type_id)`, [hx,hy,hc])).rows[0].n;
  assert.equal(liens, 0, 'structure lits → chambres → unités cohérente');
  const doublons = (await pool.query(`SELECT count(*)::int AS n FROM (SELECT etablissement_id,code FROM lits GROUP BY 1,2 HAVING count(*)>1) d`)).rows[0].n;
  assert.equal(doublons, 0, 'identifiants de lits sans doublon par établissement');
  const etats = ['libre', 'occupe', 'reserve', 'nettoyage', 'indispo'];
  for (const etabId of [hx, hy, hc]) {
    const vus = (await pool.query('SELECT DISTINCT etat FROM lits WHERE etablissement_id=$1', [etabId])).rows.map((x) => x.etat);
    assert.ok(etats.every((etat) => vus.includes(etat)), `les cinq états physiques sont présents chez ${etabId}`);
  }
  for (const [key, code] of [['a','HX'],['b','HY'],['c','HC']]) {
    const moi = (await appel(key, 'GET', '/moi')).corps;
    assert.deepEqual(moi.etablissements.map((e) => e.code), [code]);
  }
  const reseau = (await appel('reseau', 'GET', `/moi`)).corps;
  assert.equal(reseau.utilisateur.gestionnaire, true);
  assert.ok(reseau.etablissements.length >= 3);
  assert.equal((await appel('a', 'GET', `/lits?etablissement_id=${hc}`)).statut, 403);
  assert.equal((await appel('c', 'GET', `/transferts?etablissement_id=${hx}`)).statut, 403);
  assert.equal((await appel('c', 'POST', '/admissions', { etablissement_id: hc, type_id: med, patient_ref: 'P-93004', priorite: 'p2' })).statut, 200,
    'C peut aussi initier une demande dans son établissement');

  const candidats = (await appel('a', 'GET', `/recherche?depuis=${hx}&type_id=${med}`)).corps.suggestions;
  for (const [code, etabId] of [['HY', hy], ['HC', hc]]) {
    const c = candidats.find((x) => x.etablissement_id === etabId);
    assert.ok(c?.libres_confirmes > 0 && c.statut_route === 'calcule');
    assert.ok(c.distance_km > 0 && c.minutes_route > 0);
    assert.equal(c.confirmation.routeur, 'routeur de test fictif');
  }
  assert.ok(candidats.find((x) => x.etablissement_id === hc).libres_confirmes > 0, 'C fournit une alternative confirmée à OG');

  // Admission fictive minimale chez A puis transfert vers un lit nominatif chez B.
  const dem = await appel('a', 'POST', '/admissions', { etablissement_id: hx, type_id: med, patient_ref: 'P-93001', priorite: 'p2' });
  assert.equal(dem.statut, 200);
  const cible = await litLibre(hy, med);
  assert.ok(cible);
  const libresAvant = (await appel('b', 'GET', `/reseau?depuis=${hy}`)).corps.etablissements.find((e) => e.moi).unites.find((u) => u.type_code === 'MED').libres;
  const tr = await appel('a', 'POST', `/admissions/${dem.corps.id}/transferer`, {
    destination_id: hy, lit_id: cible.id, version: cible.version,
  });
  assert.equal(tr.statut, 200, JSON.stringify(tr.corps));
  assert.equal((await pool.query('SELECT etat,code FROM lits WHERE id=$1', [cible.id])).rows[0].etat, 'reserve');
  const libresApres = (await appel('b', 'GET', `/reseau?depuis=${hy}`)).corps.etablissements.find((e) => e.moi).unites.find((u) => u.type_code === 'MED').libres;
  assert.equal(libresApres, libresAvant - 1, 'la réservation actualise le dashboard receveur');
  assert.equal((await appel('a', 'POST', `/transferts/${tr.corps.id}/accepter`)).statut, 403);
  assert.equal((await appel('b', 'POST', `/transferts/${tr.corps.id}/accepter`)).statut, 200);
  assert.equal((await appel('b', 'POST', `/transferts/${tr.corps.id}/chambre_prete`)).statut, 200);
  assert.equal((await appel('a', 'POST', `/transferts/${tr.corps.id}/transport`)).statut, 200);
  assert.equal((await appel('a', 'POST', `/transferts/${tr.corps.id}/depart`)).statut, 200);
  assert.equal((await appel('b', 'POST', `/transferts/${tr.corps.id}/reception`)).corps.statut, 'recu');
  assert.equal((await pool.query('SELECT etat,patient_ref FROM lits WHERE id=$1', [cible.id])).rows[0].etat, 'occupe');
  assert.equal((await appel('a', 'GET', `/transferts?etablissement_id=${hx}`)).corps.some((x) => x.id === tr.corps.id), true);
  assert.equal((await appel('b', 'GET', `/transferts?etablissement_id=${hy}`)).corps.some((x) => x.id === tr.corps.id), true);
  assert.equal((await appel('c', 'GET', `/transferts?etablissement_id=${hc}`)).corps.length, 0);
  assert.ok((await pool.query('SELECT count(*)::int AS n FROM notifications WHERE transfert_id=$1 AND etablissement_id=$2', [tr.corps.id,hy])).rows[0].n > 0);

  // Deux demandes concurrentes sur un même lit confirmé : un seul verrou aboutit.
  const concurrent = await litLibre(hy, med);
  assert.ok(concurrent);
  const courses = await Promise.all([
    appel('a', 'POST', '/transferts', { origine_id: hx, destination_id: hy, type_id: med, lit_id: concurrent.id, version: concurrent.version, patient_ref: 'P-93002' }),
    appel('a', 'POST', '/transferts', { origine_id: hx, destination_id: hy, type_id: med, lit_id: concurrent.id, version: concurrent.version, patient_ref: 'P-93003' }),
  ]);
  assert.equal(courses.filter((x) => x.statut === 200).length, 1);
  assert.equal(courses.filter((x) => x.statut === 409).length, 1);
  const refuse = courses.find((x) => x.statut === 200).corps;
  assert.equal((await appel('b', 'POST', `/transferts/${refuse.id}/refuser`, { motif: 'Capacité fictive devenue indisponible' })).statut, 200);
  const planB = await appel('a', 'GET', `/transferts/${refuse.id}/alternatives`);
  assert.equal(planB.statut, 200);
  assert.ok(planB.corps.suggestions.some((x) => x.etablissement_id === hc), 'OG propose C après le refus de B');
  assert.ok(planB.corps.suggestions.find((x) => x.etablissement_id === hc).libres_confirmes > 0);
  assert.ok(planB.corps.suggestions.every((x) => x.etablissement_id !== hy));

  const countAvant = (await pool.query('SELECT count(*)::int AS n FROM lits')).rows[0].n;
  await assert.rejects(preparerDemoTrio(pool, { silencieux: true }), /La base contient déjà des données/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM lits')).rows[0].n, countAvant,
    'le générateur refuse une base peuplée et préserve ses données');
});

test('OG : plan coordonné sépare les faits, prévisions et inconnues sans agir automatiquement', () => {
  const plan = construirePlanCoordination({ id: 41, type_nom: 'Médecine', attente_min: 18 }, {
    capacite_verifiee_le: '2026-10-22T12:00:00.000Z',
    suggestions: [
      { etablissement_id: 2, nom: 'Hôpital B', partage: 'complet', libres_confirmes: 0, libres_non_confirmes: 1, libres_perimes: 0,
        prevus: 1, statut_route: 'indisponible', distance_km: null, minutes_route: null, confirmation: {}, niveau: 'orange', pression: 88,
        simulation: { type: 'hypothese_operationnelle', pression_actuelle: 88, pression_apres_reservation: 90 },
        capacite: { nettoyage: 1 }, demandes_admission_en_attente: 2, transferts_a_repondre: 1 },
      { etablissement_id: 3, nom: 'Hôpital C', partage: 'complet', libres_confirmes: 1, libres_non_confirmes: 0, libres_perimes: 0,
        prevus: 0, statut_route: 'calcule', distance_km: 34, minutes_route: 29,
        confirmation: { routeur: 'fournisseur approuvé', route_actualise_le: '2026-10-22T11:59:00.000Z' }, niveau: 'vert', pression: 40,
        simulation: { type: 'hypothese_operationnelle', pression_actuelle: 40, pression_apres_reservation: 45 },
        capacite: { nettoyage: 0 }, demandes_admission_en_attente: 0, transferts_a_repondre: 0 },
    ],
  });
  assert.equal(plan.alternatives[0].etat, 'Confirmation manquante');
  assert.equal(plan.alternatives[0].trajet.distance_km, null, 'aucune distance inventée sans itinéraire calculé');
  assert.ok(plan.alternatives[0].actions.some((a) => a.type === 'confirmer_capacite' && a.echeance === null));
  assert.equal(plan.alternatives[0].capacites.nettoyage, 1, 'le nettoyage ne compte pas comme lit libre');
  assert.equal(plan.alternatives[1].compatibilite, 'Compatible selon les critères structurés fournis');
  assert.ok(plan.alternatives[1].actions.some((a) => a.type === 'demande_transfert' && /décision humaine/.test(a.statut)));
  assert.equal(plan.escalade, null, 'une alternative confirmée existe');
  assert.ok(plan.limites.some((x) => /ne sont pas déclarés/.test(x)));
  const anglais = construirePlanCoordination({ id: 41, type_nom: 'Medicine', attente_min: 18 }, {
    capacite_verifiee_le: '2026-10-22T12:00:00.000Z', suggestions: [
      { etablissement_id: 2, nom: 'Hospital B', partage: 'complet', libres_confirmes: 0, libres_non_confirmes: 1,
        libres_perimes: 0, prevus: 1, statut_route: 'indisponible', confirmation: {}, niveau: 'orange', pression: 88,
        capacite: { nettoyage: 1 }, simulation: { pression_apres_reservation: 90 } },
    ],
  }, 'en');
  assert.match(anglais.alternatives[0].etat, /^Confirmation missing$/);
  const textesAnglais = (objet, cle = '') => typeof objet === 'string' ? (cle === 'type' ? [] : [objet])
    : Array.isArray(objet) ? objet.flatMap((x) => textesAnglais(x))
      : objet && typeof objet === 'object' ? Object.entries(objet).flatMap(([k, v]) => textesAnglais(v, k)) : [];
  assert.doesNotMatch(textesAnglais(anglais).join(' '), /capacité|Coordonnateur|nettoyage|prévision/i);
});

test('sessions navigateur séparées : tableaux A, B, C et réseau', async () => {
  const hx = await id('HX');
  const sansCapacite = await pool.query(`INSERT INTO types_unite (config_id, code, nom, ordre)
    SELECT config_id, 'DEMO-PLAN', 'Capacité de démonstration', 99 FROM etablissements WHERE id = $1 RETURNING id`, [hx]);
  assert.equal((await appel('a', 'POST', '/admissions', { etablissement_id: hx, type_id: sansCapacite.rows[0].id,
    patient_ref: 'P-93005', priorite: 'p2' })).statut, 200);
  const dossier = path.join(__dirname, '..', '.local', 'preuves-demo-trio');
  fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
  for (const [key, fichier] of [['a','dashboard-a.png'], ['b','dashboard-b.png'], ['c','dashboard-c.png'], ['reseau','dashboard-reseau.png']]) {
    const contexte = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'fr-CA' });
    await contexte.addInitScript((token) => localStorage.setItem('arrimo-token', token), tokens[key]);
    const page = await contexte.newPage();
    await page.goto(base);
    await page.waitForSelector('body[data-pret="1"]');
    const ok = page.locator('#b-premiers-pas-ok');
    if (await ok.isVisible().catch(() => false)) await ok.click();
    if (key === 'reseau') {
      await page.locator('#onglets button[data-v="reseau"]').click();
      await page.waitForFunction(() => !enCours);
    } else {
      assert.ok(await page.locator('#v-copilote').isVisible());
      if (key === 'a') {
        await page.waitForSelector('#v-copilote .panneau-plan');
        assert.match(await page.locator('#v-copilote .panneau-plan').innerText(), /Escalade proposée/);
      }
    }
    await page.screenshot({ path: path.join(dossier, fichier) });
    if (key === 'a') {
      await page.locator('#v-copilote .panneau-plan').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(dossier, 'og-plan-a.png') });
    }
    await contexte.close();
  }
});

test('interface A/B/C : OG voit le blocage puis le lit confirmé après nettoyage et le même transfert est reçu', async () => {
  const ids = { a: await id('HX'), b: await id('HY'), c: await id('HC') };
  const medId = await type('MED');
  // Réserver le réseau de ce scénario aux trois établissements fictifs; retirer
  // les confirmations de départ pour que le blocage soit réel et reproductible.
  await pool.query("UPDATE etablissements SET partage='aucun' WHERE code NOT IN ('HX','HY','HC')");
  await pool.query(`UPDATE lits SET disponibilite_confirmee_le=NULL, disponibilite_confirmee_par=NULL
    WHERE etablissement_id IN ($1,$2,$3) AND etat='libre'`, [ids.a, ids.b, ids.c]);
  const admission = await appel('a', 'POST', '/admissions', { etablissement_id: ids.a, type_id: medId, patient_ref: 'P-93006', priorite: 'p2' });
  assert.equal(admission.statut, 200, 'la demande fictive de A existe avant le blocage');
  const contexts = {};
  const pages = {};
  for (const key of ['a','b','c']) {
    contexts[key] = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'fr-CA' });
    await contexts[key].addInitScript((token) => localStorage.setItem('arrimo-token', token), tokens[key]);
    pages[key] = await contexts[key].newPage();
    await pages[key].goto(base);
    await pages[key].waitForSelector('body[data-pret="1"]');
    const welcome = pages[key].locator('#b-premiers-pas-ok');
    if (await welcome.isVisible().catch(() => false)) await welcome.click();
  }
  const ouvrir = async (page, name) => {
    await page.locator(`#onglets button[data-v="${name}"]`).click();
    await page.waitForFunction(() => !enCours);
  };
  try {
    // A recherche avant l'intervention: les capacités de B et C ne sont pas confirmées.
    await ouvrir(pages.a, 'reseau');
    await pages.a.locator('#r-type').selectOption(String(medId));
    await pages.a.locator('#r-pat').fill('P-93006');
    await pages.a.locator('#b-chercher').click();
    await pages.a.waitForFunction(() => !enCours);
    assert.equal(await pages.a.locator(`#v-reseau [data-choix="${ids.b}"]`).count(), 0,
      'B non confirmé ne peut pas être choisi avant le nettoyage');
    const ogAvant = await appel('a', 'GET', `/copilote/briefing?etablissement_id=${ids.a}`);
    assert.equal(ogAvant.statut, 200);
    assert.ok(ogAvant.corps.plans_coordination.some((p) => p.alternatives?.some((x) => x.etablissement_id === ids.b)),
      'OG inclut B dans son analyse des blocages autorisés');

    // B libère un patient fictif, l'entretien termine la tâche, puis B confirme.
    await ouvrir(pages.b, 'lits');
    await pages.b.locator(`#v-lits [data-u="${medId}"]`).click();
    await pages.b.waitForFunction(() => !enCours);
    const occupe = pages.b.locator('#v-lits .col.e-occupe [data-action="liberer"]').first();
    const code = await occupe.getAttribute('data-code');
    assert.ok(code, 'un lit occupé identifié existe chez B');
    await occupe.click();
    await pages.b.waitForFunction((c) => [...document.querySelectorAll('#v-lits .col.e-nettoyage .fiche b')].some((x) => x.textContent === c), code);
    await ouvrir(pages.b, 'nettoyage');
    await pages.b.locator(`#v-nettoyage [data-fini][data-genre="lit"][data-code="${code}"]`).click();
    await pages.b.waitForFunction(() => !enCours);
    await ouvrir(pages.b, 'lits');
    await pages.b.locator(`#v-lits [data-confirmer-libre][data-code="${code}"]`).click();
    await pages.b.waitForFunction(() => !enCours);

    // Le même parcours réseau est relancé par A; la recommandation est désormais sélectionnable.
    await ouvrir(pages.a, 'reseau');
    await pages.a.locator('#r-type').selectOption(String(medId));
    await pages.a.locator('#r-pat').fill('P-93006');
    await pages.a.locator('#b-chercher').click();
    await pages.a.waitForFunction(() => !enCours);
    await pages.a.locator(`#v-reseau [data-choix="${ids.b}"]`).waitFor();
    const ogApres = await appel('a', 'GET', `/copilote/briefing?etablissement_id=${ids.a}`);
    assert.equal(ogApres.statut, 200);
    assert.ok(ogApres.corps.plans_coordination.some((p) => p.alternatives?.some((x) => x.etablissement_id === ids.b && x.capacites?.lits_confirmes > 0)),
      'OG voit la capacité confirmée de B après mise à jour');

    // Demande UI, acceptation chez B, puis même transfert jusqu’à la réception.
    await pages.a.locator(`#v-reseau [data-choix="${ids.b}"]`).click();
    await pages.a.locator('#b-valider').click();
    await pages.a.waitForFunction(() => !enCours);
    await ouvrir(pages.b, 'transferts');
    const accepter = pages.b.locator('#v-transferts [data-etape="accepter"]').first();
    await accepter.waitFor();
    const transferNumber = await accepter.getAttribute('data-num');
    assert.ok(transferNumber);
    await accepter.click();
    await pages.b.waitForFunction(() => !enCours);
    const prepare = pages.b.locator(`#v-transferts [data-etape="chambre_prete"][data-num="${transferNumber}"]`);
    if (await prepare.count()) { await prepare.click(); await pages.b.waitForFunction(() => !enCours); }
    await ouvrir(pages.a, 'transferts');
    await pages.a.locator(`#v-transferts [data-etape="transport"][data-num="${transferNumber}"]`).click();
    await pages.a.waitForFunction(() => !enCours);
    await pages.a.locator(`#v-transferts [data-etape="depart"][data-num="${transferNumber}"]`).click();
    await pages.a.waitForFunction(() => !enCours);
    await ouvrir(pages.b, 'transferts');
    const reception = pages.b.locator(`#v-transferts [data-etape="reception"][data-num="${transferNumber}"]`);
    const reponseReception = pages.b.waitForResponse((r) => /\/api\/transferts\/\d+\/reception$/.test(new URL(r.url()).pathname));
    await reception.click();
    const resultatReception = await reponseReception;
    assert.equal(resultatReception.status(), 200, `réception interface HTTP ${resultatReception.status()}`);
    const transfer = (await pool.query('SELECT statut, lit_id FROM transferts WHERE numero=$1', [transferNumber])).rows[0];
    assert.equal(transfer.statut, 'recu');
    assert.equal((await pool.query('SELECT etat FROM lits WHERE id=$1', [transfer.lit_id])).rows[0].etat, 'occupe');
    // Les trois sessions restent actives et C ne voit pas le dossier A/B.
    await ouvrir(pages.c, 'transferts');
    assert.equal(await pages.c.locator('#v-transferts [data-num]').count(), 0);
  } finally {
    await Promise.all(Object.values(contexts).map((c) => c.close()));
  }
});
