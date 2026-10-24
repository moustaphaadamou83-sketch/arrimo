/**
 * Audit : 20 établissements fictifs simultanés, 3 comptes par établissement, sur une base dédiée et jetable.
 * Isolation (accès croisés par identifiant sur chaque route), confidentialité de la capacité partagée,
 * réservations concurrentes d'un même lit, transferts réservés à leurs participants, notifications, sessions.
 *
 *   AUDIT_DATABASE_URL=postgres:///arrimo_audit_multi node --test tests/audit-multi-etab.test.cjs
 * La base doit s'appeler arrimo_audit_* : elle est entièrement effacée.
 */
const test = require('node:test');
const assert = require('node:assert');
const { creerPool } = require('../src/db');
const { creerApp } = require('../src/app');
const { viderBase } = require('../db/vider');
const { demoReseau } = require('../db/demo-reseau');
const { hacher } = require('../src/auth');
const routeurTest = require('./routeur-fictif.cjs');

const URL_AUDIT = process.env.AUDIT_DATABASE_URL;
const MDP = 'Audit-Arrimo-2026';
let pool; let serveur; let base; let restaurerRouteur;
const etabs = [];          // { id, code, partage }
const jetons = {};         // email → jeton
const comptes = {};        // etab id → [emails]

async function appel(jeton, methode, chemin, corps) {
  const r = await fetch(`${base}/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
    body: corps && !['GET', 'HEAD'].includes(methode) ? JSON.stringify(corps) : undefined });
  const texte = await r.text();
  let json = null; try { json = JSON.parse(texte); } catch { /* texte */ }
  return { statut: r.status, corps: json, texte };
}
const premier = (etabId) => jetons[comptes[etabId][0]];

test.before(async () => {
  assert.ok(URL_AUDIT && /\/arrimo_audit_[a-z0-9_]+(\?|$)/.test(URL_AUDIT), 'AUDIT_DATABASE_URL vers une base arrimo_audit_* requis');
  restaurerRouteur = routeurTest.activer();
  process.env.ARRIMO_ENV = 'recette';
  pool = creerPool(URL_AUDIT);
  await viderBase(pool);
  await demoReseau(pool, { silencieux: true });
  const hash = hacher(MDP);
  for (const e of (await pool.query('SELECT id, code, partage FROM etablissements WHERE actif ORDER BY id')).rows) {
    etabs.push(e); comptes[e.id] = [];
    for (const [i, role] of [['1', 'coordonnateur'], ['2', 'coordonnateur'], ['a', 'admin_etab']]) {
      const email = `audit.${e.code.toLowerCase()}.${i}@audit.exemple`;
      const u = (await pool.query('INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role) VALUES ($1,$2,$3,$4) RETURNING id', [email, `Audit ${e.code} ${i}`, hash, role])).rows[0];
      await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1,$2)', [u.id, e.id]);
      comptes[e.id].push(email);
    }
  }
  serveur = creerApp(pool).listen(0); base = `http://127.0.0.1:${serveur.address().port}`;
});
test.after(async () => { serveur?.close(); await pool?.end(); restaurerRouteur?.(); });

test('20 établissements : 60 connexions simultanées, jetons distincts', async () => {
  assert.strictEqual(etabs.length, 20);
  const emails = Object.values(comptes).flat();
  const r = await Promise.all(emails.map((email) => appel(null, 'POST', '/connexion', { email, mot_de_passe: MDP }).then((x) => [email, x])));
  for (const [email, x] of r) { assert.strictEqual(x.statut, 200, `${email} ${x.texte}`); jetons[email] = x.corps.token; }
  assert.strictEqual(new Set(Object.values(jetons)).size, 60);
  const moi = await Promise.all(etabs.map((e) => appel(premier(e.id), 'GET', '/moi')));
  moi.forEach((m, i) => assert.deepStrictEqual(m.corps.etablissements.map((x) => x.id), [etabs[i].id], 'chaque compte ne voit que son établissement'));
});

test('isolation : aucun accès aux ressources d’un autre établissement en changeant l’identifiant', async () => {
  // Ressources de B : lit, civière, demande d'admission, notification ; A et B pris dans 6 paires différentes
  const paires = [[0, 1], [1, 0], [2, 7], [5, 12], [12, 19], [19, 3]];
  let essais = 0;
  for (const [ia, ib] of paires) {
    const A = etabs[ia]; const B = etabs[ib]; const jA = premier(A.id); const jB = premier(B.id);
    const lit = (await pool.query(`SELECT id, version FROM lits WHERE etablissement_id=$1 ORDER BY (etat='libre') DESC, id LIMIT 1`, [B.id])).rows[0];
    // Lit occupé et civière : créés au besoin pour que chaque paire couvre toutes les routes
    let occupe = (await pool.query(`SELECT id, version FROM lits WHERE etablissement_id=$1 AND etat='occupe' ORDER BY id LIMIT 1`, [B.id])).rows[0];
    if (!occupe) {
      const l = (await pool.query(`SELECT id, version FROM lits WHERE etablissement_id=$1 AND etat='libre' ORDER BY id DESC LIMIT 1`, [B.id])).rows[0];
      for (const action of ['reserver', 'admettre']) {
        const v = (await pool.query('SELECT version FROM lits WHERE id=$1', [l.id])).rows[0].version;
        await appel(jB, 'POST', `/lits/${l.id}/action`, { action, version: v, patient_ref: `P-${String(75000 + ib).padStart(5, '0')}` });
      }
      occupe = (await pool.query(`SELECT id, version, etat FROM lits WHERE id=$1`, [l.id])).rows[0];
    }
    let civiere = (await pool.query('SELECT id, version FROM civieres WHERE etablissement_id=$1 ORDER BY id LIMIT 1', [B.id])).rows[0];
    if (!civiere) civiere = (await pool.query(`INSERT INTO civieres (etablissement_id, code, categorie) VALUES ($1, 'AUD-C1', 'reguliere') RETURNING id, version`, [B.id])).rows[0];
    const type = (await pool.query('SELECT t.id FROM types_unite t JOIN etablissements e ON e.config_id=t.config_id WHERE e.id=$1 ORDER BY t.ordre LIMIT 1', [B.id])).rows[0].id;
    const dem = await appel(jB, 'POST', '/admissions', { etablissement_id: B.id, type_id: type, patient_ref: `P-${String(70000 + ib).padStart(5, '0')}`, provenance: 'urgence', priorite: 'p2' });
    const demId = dem.corps?.id;
    const lectures = ['/lits', '/structure', '/nettoyage', '/nsa', '/admissions', '/indicateurs', '/indicateurs.csv', '/civieres', '/journal', '/notifications', '/blocages',
      '/copilote/briefing', '/copilote/previsions', '/copilote/reseau', '/transferts'].map((p) => ['GET', `${p}?etablissement_id=${B.id}`]);
    const autres = [
      ['GET', `/reseau?depuis=${B.id}`], ['GET', `/recherche?depuis=${B.id}&type_id=${type}`], ['GET', `/national?depuis=${B.id}`], ['GET', `/national/carte?depuis=${B.id}`],
      ['GET', `/itineraire?depuis=${B.id}&vers=${A.id}`],
      ['POST', '/assistant', { etablissement_id: B.id, question: 'Combien de lits libres ?' }], ['POST', '/copilote/question', { etablissement_id: B.id, question: 'Lits libres ?' }],
      ['POST', `/lits/${lit.id}/action`, { action: 'reserver', version: lit.version, patient_ref: 'P-00001' }], ['POST', `/lits/${lit.id}/confirmer-disponibilite`],
      ['POST', `/lits/${occupe.id}/nsa`, { orientation: 'chsld' }], ['PUT', `/lits/${occupe.id}/conge`, { statut: 'confirme' }], ['PUT', `/lits/${occupe.id}/sortie-prevue`, { sortie_prevue: new Date().toISOString() }],
      ['DELETE', `/lits/${occupe.id}/nsa`], ['POST', `/nettoyage/${lit.id}/debut`],
      ['POST', `/civieres/${civiere.id}/action`, { action: 'indisponible', version: civiere.version, motif: 'test' }],
      ['POST', '/notifications/lues', { etablissement_id: B.id }],
      ['POST', '/admissions', { etablissement_id: B.id, type_id: type, patient_ref: 'P-00002', provenance: 'urgence', priorite: 'p2' }],
      ['POST', '/transferts', { origine_id: B.id, destination_id: A.id, type_id: type, patient_ref: 'P-00003' }],
      ...(demId ? ['assigner', 'admettre', 'annuler', 'transferer'].map((e) => ['POST', `/admissions/${demId}/${e}`, { lit_id: lit.id, version: lit.version, destination_id: A.id }]) : []),
    ];
    assert.ok(demId, `demande d’admission de B créée : ${dem.texte}`);
    for (const [m, chemin, corps] of [...lectures, ...autres]) {
      const r = await appel(jA, m, chemin, corps); essais += 1;
      assert.ok([403, 404].includes(r.statut), `${A.code} → ${B.code} ${m} ${chemin} : ${r.statut} ${r.texte.slice(0, 160)}`);
    }
    // Rien n'a changé chez B
    assert.strictEqual((await pool.query('SELECT version FROM lits WHERE id=$1', [lit.id])).rows[0].version, lit.version);
    assert.strictEqual((await pool.query('SELECT statut FROM demandes_admission WHERE id=$1', [demId])).rows[0].statut, 'attente');
  }
  assert.ok(essais > 200);
});

test('confidentialité : la capacité partagée n’expose que les champs autorisés et aucune référence patient', async () => {
  const refs = new Set((await pool.query(`SELECT patient_ref FROM lits WHERE patient_ref IS NOT NULL UNION SELECT patient_ref FROM civieres WHERE patient_ref IS NOT NULL
    UNION SELECT patient_ref FROM transferts`)).rows.map((r) => r.patient_ref));
  assert.ok(refs.size > 20, 'des références fictives existent dans la démo');
  for (const A of etabs.filter((e) => e.partage !== 'aucun').slice(0, 6)) {
    const jA = premier(A.id);
    const propres = new Set((await pool.query(`SELECT patient_ref FROM lits WHERE etablissement_id=$1 AND patient_ref IS NOT NULL UNION SELECT patient_ref FROM civieres WHERE etablissement_id=$1 AND patient_ref IS NOT NULL
      UNION SELECT patient_ref FROM transferts WHERE origine_id=$1 OR destination_id=$1`, [A.id])).rows.map((r) => r.patient_ref));
    const type = (await pool.query('SELECT t.id FROM types_unite t JOIN etablissements e ON e.config_id=t.config_id WHERE e.id=$1 ORDER BY t.ordre LIMIT 1', [A.id])).rows[0].id;
    for (const chemin of [`/reseau?depuis=${A.id}`, `/recherche?depuis=${A.id}&type_id=${type}`, `/national?depuis=${A.id}`, `/national/carte?depuis=${A.id}`, `/copilote/reseau?etablissement_id=${A.id}`,
      `/copilote/briefing?etablissement_id=${A.id}`, `/notifications?etablissement_id=${A.id}`, `/transferts?etablissement_id=${A.id}`, `/journal?etablissement_id=${A.id}`]) {
      const r = await appel(jA, 'GET', chemin);
      assert.strictEqual(r.statut, 200, `${chemin} ${r.texte.slice(0, 120)}`);
      const fuites = [...refs].filter((p) => !propres.has(p) && r.texte.includes(p));
      assert.deepStrictEqual(fuites, [], `${A.code} ${chemin} : références patient d’autres établissements`);
    }
    const reseau = (await appel(jA, 'GET', `/reseau?depuis=${A.id}`)).corps;
    for (const e of reseau.etablissements.filter((x) => !x.moi)) {
      const src = etabs.find((x) => x.id === e.id);
      assert.notStrictEqual(src.partage, 'aucun', `${e.code} ne partage pas et apparaît pourtant`);
      if (src.partage === 'agrege') {
        assert.ok(e.unites.every((u) => u.repartition === null && u.prevus === null), `${e.code} agrégé : détail exposé`);
        assert.ok(!e.urgence || e.urgence.plus_24h === undefined, `${e.code} agrégé : détail de l’urgence exposé`);
      }
    }
  }
});

test('réservation concurrente : 20 établissements visent le même lit, un seul l’obtient', async () => {
  const Z = etabs.find((e) => e.partage === 'complet' && e.id !== etabs[0].id);
  const lit = (await pool.query(`SELECT l.id, l.version, l.type_id FROM lits l WHERE l.etablissement_id=$1 AND l.etat='libre' ORDER BY id LIMIT 1`, [Z.id])).rows[0];
  assert.strictEqual((await appel(premier(Z.id), 'POST', `/lits/${lit.id}/confirmer-disponibilite`)).statut, 200);
  const v = (await pool.query('SELECT version FROM lits WHERE id=$1', [lit.id])).rows[0].version;
  const origines = etabs.filter((e) => e.id !== Z.id && e.partage !== 'aucun');
  const tentatives = [
    ...origines.map((o, i) => appel(premier(o.id), 'POST', '/transferts', { origine_id: o.id, destination_id: Z.id, type_id: lit.type_id, lit_id: lit.id, version: v,
      patient_ref: `P-${String(81000 + i).padStart(5, '0')}`, hors_rayon: true })),
    appel(jetons[comptes[Z.id][1]], 'POST', `/lits/${lit.id}/action`, { action: 'reserver', version: v, patient_ref: 'P-81999' }),
  ];
  const r = await Promise.all(tentatives);
  const gagnants = r.filter((x) => x.statut === 200);
  assert.strictEqual(gagnants.length, 1, `un seul gagnant : ${r.map((x) => x.statut).join(',')}`);
  assert.ok(r.filter((x) => x.statut !== 200).every((x) => [409, 403, 400].includes(x.statut)), r.map((x) => `${x.statut}:${x.corps?.code}`).join(' '));
  const etat = (await pool.query('SELECT etat, patient_ref FROM lits WHERE id=$1', [lit.id])).rows[0];
  assert.strictEqual(etat.etat, 'reserve');
  const actifs = (await pool.query(`SELECT count(*)::int n FROM transferts WHERE lit_id=$1 AND statut NOT IN ('refuse','recu','annule')`, [lit.id])).rows[0].n;
  assert.ok(actifs <= 1, 'au plus un transfert actif sur ce lit');
  // Rejeu du même appel gagnant : refusé (version périmée), pas de second dossier
  assert.notStrictEqual((await appel(premier(origines[0].id), 'POST', '/transferts', { origine_id: origines[0].id, destination_id: Z.id, type_id: lit.type_id, lit_id: lit.id, version: v, patient_ref: 'P-81998', hors_rayon: true })).statut, 200);
});

test('transferts : seuls les participants voient et agissent ; notifications ciblées ; refus libère le lit', async () => {
  const [O, D, T] = etabs.filter((e) => e.partage === 'complet').slice(3, 6);
  const type = (await pool.query(`SELECT l.type_id FROM lits l WHERE l.etablissement_id=$1 AND l.etat='libre' GROUP BY l.type_id ORDER BY count(*) DESC LIMIT 1`, [D.id])).rows[0].type_id;
  const notifAvantT = (await pool.query('SELECT count(*)::int n FROM notifications WHERE etablissement_id=$1', [T.id])).rows[0].n;
  const tr = await appel(premier(O.id), 'POST', '/transferts', { origine_id: O.id, destination_id: D.id, type_id: type, patient_ref: 'P-82001', hors_rayon: true });
  assert.strictEqual(tr.statut, 200, tr.texte);
  const id = tr.corps.id;
  for (const [m, c] of [['POST', `/transferts/${id}/accepter`], ['POST', `/transferts/${id}/refuser`], ['POST', `/transferts/${id}/transport`], ['POST', `/transferts/${id}/reception`],
    ['GET', `/transferts/${id}/alternatives`], ['PUT', `/transferts/${id}/responsable`], ['POST', `/transferts/${id}/relancer`]]) {
    const r = await appel(premier(T.id), m, c, { motif: 'tiers', service_responsable: 'x' });
    assert.ok([403, 404].includes(r.statut), `tiers ${m} ${c} : ${r.statut}`);
  }
  assert.ok(!(await appel(premier(T.id), 'GET', `/transferts?etablissement_id=${T.id}`)).texte.includes('P-82001'));
  assert.strictEqual((await appel(premier(O.id), 'POST', `/transferts/${id}/accepter`)).statut, 403, 'l’origine n’accepte pas');
  // Deux receveurs cliquent en même temps : un seul refus/acceptation compte
  const [r1, r2] = await Promise.all([appel(jetons[comptes[D.id][0]], 'POST', `/transferts/${id}/refuser`, { motif: 'Pas de personnel (fictif)' }),
    appel(jetons[comptes[D.id][1]], 'POST', `/transferts/${id}/accepter`)]);
  // Les deux clics sont sérialisés par le verrou du transfert : soit un seul passe, soit « accepter » puis « refuser »
  // (le receveur peut refuser après validation). Jamais deux états contradictoires.
  assert.ok([r1.statut, r2.statut].includes(200), `${r1.statut}/${r2.statut}`);
  if (r1.statut === 200 && r2.statut === 200) assert.strictEqual((await pool.query('SELECT statut FROM transferts WHERE id=$1', [id])).rows[0].statut, 'refuse');
  const final = (await pool.query('SELECT statut, lit_id FROM transferts WHERE id=$1', [id])).rows[0];
  const lit = (await pool.query('SELECT etat FROM lits WHERE id=$1', [final.lit_id])).rows[0];
  assert.ok((final.statut === 'refuse' && lit.etat === 'libre') || (final.statut === 'accepte' && lit.etat === 'reserve'), `cohérence ${final.statut}/${lit.etat}`);
  // Le tiers peut recevoir l'alerte « lits libres à proximité » (comptes agrégés) mais rien sur ce transfert.
  const chezTiers = (await pool.query('SELECT code, transfert_id, message, vars::text AS vars FROM notifications WHERE etablissement_id=$1 ORDER BY id OFFSET $2', [T.id, notifAvantT])).rows;
  const numero = (await pool.query('SELECT numero FROM transferts WHERE id=$1', [id])).rows[0].numero;
  assert.ok(chezTiers.every((n) => n.code === 'dispo_lit' && !n.transfert_id && !`${n.message}${n.vars}`.includes(numero) && !`${n.message}${n.vars}`.includes('P-82001')),
    `notification de transfert chez le tiers : ${JSON.stringify(chezTiers)}`);
});

test('sessions : déconnexion d’une session, les autres restent ; reconnexion ; compte désactivé coupé', async () => {
  const E = etabs[8]; const [e1, e2] = comptes[E.id];
  assert.strictEqual((await appel(jetons[e1], 'POST', '/deconnexion')).statut, 200);
  assert.strictEqual((await appel(jetons[e1], 'GET', '/moi')).statut, 401);
  assert.strictEqual((await appel(jetons[e2], 'GET', '/moi')).statut, 200);
  const re = await appel(null, 'POST', '/connexion', { email: e1, mot_de_passe: MDP });
  assert.strictEqual(re.statut, 200); jetons[e1] = re.corps.token;
  await pool.query('UPDATE utilisateurs SET actif=false WHERE email=$1', [e2]);
  assert.strictEqual((await appel(jetons[e2], 'GET', '/moi')).statut, 401, 'compte désactivé : session refusée immédiatement');
});

test('élévation de privilèges : un coordonnateur n’atteint aucune route d’administration', async () => {
  const avant2fa = process.env.ARRIMO_2FA_ADMIN; process.env.ARRIMO_2FA_ADMIN = '0';   // la garde de rôle doit refuser même sans exigence 2FA
  try {
  const E = etabs[10]; const j = premier(E.id); const autre = etabs[11];
  const routes = [['GET', '/admin/utilisateurs'], ['POST', '/admin/utilisateurs', { email: 'pirate@audit.exemple', nom: 'x', role: 'gestionnaire', etablissements: [autre.id] }],
    ['PUT', `/admin/etablissements/${autre.id}`, { partage: 'complet', module_actif: true }], ['POST', '/admin/demo/reinitialiser'],
    ['GET', '/admin/journal'], ['POST', '/admin/etablissements', { code: 'PIR', nom: 'x' }]];
  for (const [m, c, b] of routes) {
    const r = await appel(j, m, c, b);
    assert.ok([403, 404].includes(r.statut), `coordonnateur ${m} ${c} : ${r.statut} ${r.texte.slice(0, 100)}`);
  }
  // L'administrateur d'établissement ne peut pas créer de gestionnaire réseau ni se rattacher à un autre établissement
  const ja = jetons[comptes[E.id][2]];
  const r1 = await appel(ja, 'POST', '/admin/utilisateurs', { email: 'pirate2@audit.exemple', nom: 'x', role: 'gestionnaire', etablissements: [E.id] });
  assert.ok(r1.statut >= 400, `admin_etab crée un gestionnaire : ${r1.statut} ${r1.texte.slice(0, 120)}`);
  const r2 = await appel(ja, 'POST', '/admin/utilisateurs', { email: 'pirate3@audit.exemple', nom: 'x', role: 'coordonnateur', etablissements: [autre.id] });
  assert.ok(r2.statut >= 400, `admin_etab rattache à un autre établissement : ${r2.statut} ${r2.texte.slice(0, 120)}`);
  assert.strictEqual((await pool.query(`SELECT count(*)::int n FROM utilisateurs WHERE email LIKE 'pirate%'`)).rows[0].n, 0);
  } finally { if (avant2fa === undefined) delete process.env.ARRIMO_2FA_ADMIN; else process.env.ARRIMO_2FA_ADMIN = avant2fa; }
});

test('administration d’établissement : 2FA exigée, aucune action sur les ressources d’un autre établissement', async () => {
  const A = etabs[13]; const B = etabs[14]; const ja = jetons[comptes[A.id][2]];
  assert.strictEqual((await appel(ja, 'GET', `/admin/structure/detaillee?etablissement_id=${A.id}`)).corps?.code, 'admin_exige_2fa', 'administration sans double authentification refusée');
  const avant2fa = process.env.ARRIMO_2FA_ADMIN; process.env.ARRIMO_2FA_ADMIN = '0';   // pour atteindre les contrôles de périmètre eux-mêmes
  try {
    assert.strictEqual((await appel(ja, 'GET', `/admin/structure/detaillee?etablissement_id=${A.id}`)).statut, 200);
    const q = async (sql) => (await pool.query(sql, [B.id])).rows[0];
    const litB = await q('SELECT id FROM lits WHERE etablissement_id=$1 ORDER BY id LIMIT 1');
    const chB = await q('SELECT ch.id FROM chambres ch JOIN unites u ON u.id=ch.unite_id WHERE u.etablissement_id=$1 ORDER BY ch.id LIMIT 1');
    const unB = await q('SELECT id FROM unites WHERE etablissement_id=$1 ORDER BY id LIMIT 1');
    const cvB = await q('SELECT id FROM civieres WHERE etablissement_id=$1 ORDER BY id LIMIT 1');
    const usB = await q('SELECT u.id FROM utilisateurs u JOIN utilisateur_etablissements ue ON ue.utilisateur_id=u.id WHERE ue.etablissement_id=$1 ORDER BY u.id LIMIT 1');
    const routes = [
      ['GET', `/admin/structure/detaillee?etablissement_id=${B.id}`], ['GET', `/admin/structure?etablissement_id=${B.id}`], ['GET', `/admin/civieres?etablissement_id=${B.id}`],
      ['PUT', `/admin/lits/${litB.id}/details`, { categorie: 'x' }], ['PUT', `/admin/lits/${litB.id}/equipement`, { isolement: true }],
      ['PUT', `/admin/chambres/${chB.id}`, { type_chambre: 'x' }], ['PUT', `/admin/unites/${unB.id}`, { nom: 'Piratée' }], ['PUT', `/admin/civieres/${cvB.id}/details`, { attributs: {} }],
      ['POST', '/admin/chambres', { unite_id: unB.id, numero: '999' }], ['POST', '/admin/unites', { etablissement_id: B.id, nom: 'x', type_id: 1 }],
      ['POST', '/admin/departements', { etablissement_id: B.id, code: 'X', nom: 'x' }], ['POST', '/admin/civieres', { etablissement_id: B.id, code: 'X-1' }],
      ['PUT', `/admin/utilisateurs/${usB.id}`, { nom: 'Pirate', actif: false }], ['POST', `/admin/utilisateurs/${usB.id}/reinitialiser`, {}],
      ['POST', '/admin/import/verifier', { etablissement_id: B.id, type: 'unites', contenu: 'unite;type_unite\nX;MED\n' }],
      ['PUT', `/admin/etablissements/${B.id}/rayon-alerte`, { rayon_alerte_km: 5 }], ['PUT', `/admin/etablissements/${B.id}`, { partage: 'aucun' }],
      ['POST', '/admin/connecteurs', { nom: 'x', etablissement_id: B.id }], ['POST', '/admin/connecteurs', { nom: 'réseau' }], ['PUT', '/admin/config/1', { rayon_km: 5 }],
    ];
    for (const [m, c, b] of routes) {
      const r = await appel(ja, m, c, b);
      assert.ok([403, 404].includes(r.statut), `admin ${A.code} → ${B.code} ${m} ${c} : ${r.statut} ${r.texte.slice(0, 120)}`);
    }
    assert.ok(!(await appel(ja, 'GET', '/admin/utilisateurs')).corps.some((u) => u.etablissements.includes(B.id)), 'liste des comptes limitée au périmètre');
    assert.ok(!(await appel(ja, 'GET', '/admin/journal')).texte.includes(B.code), 'journal d’administration limité');
  } finally { if (avant2fa === undefined) delete process.env.ARRIMO_2FA_ADMIN; else process.env.ARRIMO_2FA_ADMIN = avant2fa; }
});

test('élévation par import : un compte partagé avec un autre établissement ne peut pas être promu par un seul administrateur', async () => {
  const A = etabs[15]; const B = etabs[16]; const ja = jetons[comptes[A.id][2]];
  const email = comptes[A.id][1];
  const partage = (await pool.query('SELECT id FROM utilisateurs WHERE email=$1', [email])).rows[0].id;
  await pool.query('INSERT INTO utilisateur_etablissements VALUES ($1,$2)', [partage, B.id]);   // compte rattaché à A et à B
  const avant2fa = process.env.ARRIMO_2FA_ADMIN; process.env.ARRIMO_2FA_ADMIN = '0';
  try {
    const contenu = `nom;courriel;role\nAudit promu;${email};admin_etab\n`;
    const v = await appel(ja, 'POST', '/admin/import/verifier', { etablissement_id: A.id, type: 'utilisateurs', contenu });
    if (v.corps?.nb_erreurs === 0) await appel(ja, 'POST', '/admin/import/importer', { etablissement_id: A.id, type: 'utilisateurs', contenu, empreinte: v.corps.empreinte });
    assert.strictEqual((await pool.query('SELECT role FROM utilisateurs WHERE id=$1', [partage])).rows[0].role, 'coordonnateur',
      'le compte partagé A+B n’est pas promu administrateur (il le serait aussi pour B)');
    // Même règle que la modification directe
    assert.strictEqual((await appel(ja, 'PUT', `/admin/utilisateurs/${partage}`, { role: 'admin_etab', etablissements: [A.id] })).statut, 403);
  } finally { if (avant2fa === undefined) delete process.env.ARRIMO_2FA_ADMIN; else process.env.ARRIMO_2FA_ADMIN = avant2fa; }
});

test('authentification : jetons stockés hachés, fermeture des autres sessions, MFA chiffrée, limiteur non contournable', async () => {
  const totp = require('../src/totp');
  const E = etabs[17]; const [e1, e2] = comptes[E.id];
  // Jeton de session : seule l'empreinte est en base
  const brut = jetons[e1];
  assert.strictEqual((await pool.query('SELECT count(*)::int n FROM sessions WHERE token=$1', [brut])).rows[0].n, 0, 'aucun jeton brut en base');
  assert.ok((await pool.query(`SELECT count(*)::int n FROM sessions WHERE token LIKE 'h:%'`)).rows[0].n >= 59);
  // Deux sessions du même compte, puis « fermer mes autres sessions »
  const autre = (await appel(null, 'POST', '/connexion', { email: e1, mot_de_passe: MDP })).corps.token;
  const r = await appel(brut, 'POST', '/moi/sessions/fermer');
  assert.deepStrictEqual([r.statut, r.corps.fermees], [200, 1]);
  assert.strictEqual((await appel(autre, 'GET', '/moi')).statut, 401);
  assert.strictEqual((await appel(brut, 'GET', '/moi')).statut, 200, 'la session courante reste ouverte');
  // Secret MFA chiffré au repos quand la clé est configurée ; connexion en deux étapes
  const avantCle = process.env.ARRIMO_MFA_ENCRYPTION_KEY; process.env.ARRIMO_MFA_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString('base64');
  try {
    const j2 = jetons[e2];
    const { secret } = (await appel(j2, 'POST', '/moi/2fa/preparer')).corps;
    assert.match((await pool.query('SELECT totp_secret FROM utilisateurs WHERE email=$1', [e2])).rows[0].totp_secret, /^enc:v1:/);
    assert.strictEqual((await appel(j2, 'POST', '/moi/2fa/activer', { code: totp.codePourPas(secret, totp.pasActuel()) })).statut, 200);
    const etape = (await appel(null, 'POST', '/connexion', { email: e2, mot_de_passe: MDP })).corps;
    assert.strictEqual((await pool.query('SELECT count(*)::int n FROM connexions_2fa WHERE jeton=$1', [etape.jeton])).rows[0].n, 0, 'jeton d’étape haché');
    const fin = await appel(null, 'POST', '/connexion/2fa', { jeton: etape.jeton, code: totp.codePourPas(secret, totp.pasActuel() + 1) });
    assert.strictEqual(fin.statut, 200, fin.texte);
  } finally { if (avantCle === undefined) delete process.env.ARRIMO_MFA_ENCRYPTION_KEY; else process.env.ARRIMO_MFA_ENCRYPTION_KEY = avantCle; }
  // Limiteur : 130 tentatives de connexion, chacune avec un jeton inventé différent, restent comptées par adresse IP (120/min)
  const essais = await Promise.all(Array.from({ length: 130 }, (_, i) => fetch(`${base}/api/connexion`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer invente-${i}` }, body: JSON.stringify({ email: `inconnu${i}@audit.exemple`, mot_de_passe: 'x' }) }).then((x) => x.status)));
  assert.ok(essais.filter((s) => s === 429).length >= 1, `limite par IP appliquée malgré les jetons inventés : ${[...new Set(essais)]}`);
});
