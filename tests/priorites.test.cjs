const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const p = require('../src/priorites');
const categories = [{ code: 'rapide', libelle: 'Rapide (fictif)', rang: 2 }, { code: 'critique', libelle: 'Critique (fictif)', rang: 1 }];
const ref = { revision: 3, categories };
const u = { id: 8, role: 'coordonnateur', etabs: [4] };
const demande = { id: 11, etablissement_id: 4, priorite_version: 0, statut: 'attente' };
const corps = { version: 0, revision: 3, code: 'critique', motif: 'Validation fictive pour recette', confirmation: true };

function base({ habilite = true, d = demande, referentiel = ref, erreurJournal = false, habilitationVersion = 0 } = {}) {
  const requetes = [];
  const query = async (sql, args) => {
    requetes.push({ sql, args });
    if (sql.includes('SELECT * FROM demandes_admission')) return { rows: d ? [{ ...d }] : [] };
    if (sql.includes('FROM admission_habilitations h')) return { rows: habilite ? [{ utilisateur_id: u.id }] : [] };
    if (sql.startsWith('SELECT u.id FROM utilisateurs')) return { rows: [{ id: 9 }] };
    if (sql.startsWith('SELECT version FROM admission_habilitations')) return { rows: habilitationVersion ? [{ version: habilitationVersion }] : [] };
    if (sql.includes('SELECT * FROM admission_referentiels')) return { rows: referentiel ? [referentiel] : [] };
    if (sql.includes('UPDATE demandes_admission')) return { rows: [{ ...d, priorite_code: args[1], priorite_version: d.priorite_version + 1 }] };
    if (sql.includes('INSERT INTO admission_referentiels')) return { rows: [{ revision: args[1], categories: JSON.parse(args[2]) }] };
    if (sql.includes('INSERT INTO journal') && erreurJournal) throw new Error('Journal indisponible');
    return { rows: [] };
  };
  return { requetes, query, connect: async () => ({ query, release() { requetes.push({ sql: 'RELEASE' }); } }) };
}

test('référentiel : ordre déterministe, valeurs conservées, sans mutation ni classement inventé', () => {
  assert.deepEqual(p.categoriesValides(categories).map((x) => x.code), ['critique', 'rapide']);
  assert.equal(categories[0].code, 'rapide');
});
for (const [nom, invalide] of Object.entries({
  vide: [], tropCourt: [categories[0]], tropLong: Array(13).fill(categories[0]),
  codeDouble: [categories[0], { ...categories[1], code: 'rapide' }], rangDouble: [categories[0], { ...categories[1], rang: 2 }],
  codeSQL: [{ ...categories[0], code: "';DROP" }, categories[1]], rangDecimal: [{ ...categories[0], rang: 1.5 }, categories[1]],
  rangNul: [{ ...categories[0], rang: 0 }, categories[1]], libelleVide: [{ ...categories[0], libelle: ' ' }, categories[1]],
  libelleTropLong: [{ ...categories[0], libelle: 'x'.repeat(81) }, categories[1]], categorieNulle: [null, categories[1]],
})) test(`référentiel invalide refusé : ${nom}`, () => assert.throws(() => p.categoriesValides(invalide), { statut: 400 }));

const classee = (id, rang, cree, revision = 3) => ({ id, priorite: 'p2', priorite_code: rang === 1 ? 'critique' : 'rapide',
  priorite_libelle: rang === 1 ? 'Critique (fictif)' : 'Rapide (fictif)', priorite_rang: rang,
  priorite_revision: revision, priorite_validee_par: 8, priorite_validee_le: '2026-10-25T08:00:00Z', cree_le: cree });
test('file : priorité validée avant attente, ancienneté seulement à rang égal, P1 historique sans rang', () => {
  const historique = { id: 1, priorite: 'p1', cree_le: '2026-10-01T00:00:00Z' };
  const liste = [historique, classee(3, 2, '2026-10-20'), classee(5, 1, '2026-10-24'), classee(4, 1, '2026-10-23')];
  const resultat = p.organiserFile(liste, ref);
  assert.deepEqual(resultat.map((x) => x.id), [4, 5, 3, 1]);
  assert.equal(resultat[3].priorite_validee, false);
  assert.equal(resultat[3].priorite_affichage, 'À valider');
  assert.match(resultat[0].priorite_explication, /rang 1.*v3.*compte 8/);
  assert.equal(liste[0], historique);
});
test('changement de référentiel : revalidation nécessaire, aucun ancien rang appliqué', () => {
  const ancienne = classee(2, 1, '2026-10-01', 2);
  const [actuelle, perimee] = p.organiserFile([ancienne, classee(3, 2, '2026-10-24')], ref);
  assert.equal(actuelle.id, 3); assert.equal(perimee.priorite_a_revalider, true);
  assert.match(perimee.priorite_explication, /renouveler/);
});
test('aucun référentiel : aucune priorité considérée validée', () => {
  assert.equal(p.organiserFile([classee(1, 1, '2026-10-01')], null)[0].priorite_validee, false);
});
test('égalité totale : ordre stable par identifiant', () => {
  assert.deepEqual(p.organiserFile([classee(3, 1, '2026-10-01'), classee(2, 1, '2026-10-01')], ref).map((x) => x.id), [2, 3]);
});
test('isolation : validation de B refusée au compte de A avant toute recherche d’habilitation', async () => {
  const pool = base({ d: { ...demande, etablissement_id: 7 } });
  await assert.rejects(p.valider(pool, u, 11, corps), { statut: 403 });
  assert.ok(!pool.requetes.some((x) => x.sql.includes('FROM admission_habilitations')));
});
test('habilitation explicite obligatoire, même pour un gestionnaire réseau', async () => {
  for (const utilisateur of [u, { ...u, role: 'gestionnaire', gestionnaire: true }]) {
    await assert.rejects(p.valider(base({ habilite: false }), utilisateur, 11, corps), { statut: 403 });
  }
});
test('entretien : aucune validation clinique', async () => {
  await assert.rejects(p.valider(base(), { ...u, role: 'entretien' }, 11, corps), { statut: 403 });
});
for (const [nom, b] of Object.entries({ confirmation: { ...corps, confirmation: false }, motif: { ...corps, motif: '' },
  versionAbsente: { ...corps, version: undefined }, versionTexte: { ...corps, version: '0' },
})) test(`validation sans ${nom} valable refusée avant transaction`, async () => {
  const pool = base(); await assert.rejects(p.valider(pool, u, 11, b), { statut: 400 }); assert.equal(pool.requetes.length, 0);
});
test('concurrence : version de demande obsolète refusée, sans mise à jour', async () => {
  const pool = base({ d: { ...demande, priorite_version: 1 } });
  await assert.rejects(p.valider(pool, u, 11, corps), { statut: 409 });
  assert.ok(!pool.requetes.some((x) => x.sql.startsWith('UPDATE')));
});
test('référentiel modifié entre affichage et validation : refus 409', async () => {
  await assert.rejects(p.valider(base({ referentiel: { ...ref, revision: 4 } }), u, 11, corps), { statut: 409 });
});
test('demande clôturée : priorité immuable', async () => {
  await assert.rejects(p.valider(base({ d: { ...demande, statut: 'admise' } }), u, 11, corps), { statut: 409 });
});
test('catégorie inconnue : refus 400 sans choix automatique', async () => {
  await assert.rejects(p.valider(base(), u, 11, { ...corps, code: 'inconnue' }), { statut: 400 });
});
test('validation : auteur, catégorie et motif proviennent du compte et du référentiel serveur', async () => {
  const pool = base();
  await p.valider(pool, u, 11, { ...corps, priorite_rang: 99, priorite_validee_par: 100, priorite_libelle: 'Faux' });
  const update = pool.requetes.find((x) => x.sql.startsWith('UPDATE'));
  assert.deepEqual(update.args, [11, 'critique', 'Critique (fictif)', 1, 3, 8, corps.motif]);
  const journal = pool.requetes.findIndex((x) => x.sql.includes('INSERT INTO journal'));
  assert.ok(journal < pool.requetes.findIndex((x) => x.sql === 'COMMIT'));
});
test('journal indisponible : validation annulée', async () => {
  const pool = base({ erreurJournal: true });
  await assert.rejects(p.valider(pool, u, 11, corps), /Journal indisponible/);
  assert.ok(pool.requetes.some((x) => x.sql === 'ROLLBACK'));
  assert.ok(!pool.requetes.some((x) => x.sql === 'COMMIT'));
});
test('configuration : un professionnel sans rôle administrateur ne peut changer les règles', async () => {
  await assert.rejects(p.configurer(base(), u, 4, { categories, revision: 0, confirmation: true, motif: 'Fictif' }), { statut: 403 });
});
test('configuration : administrateur sans habilitation professionnelle refusé', async () => {
  await assert.rejects(p.configurer(base({ habilite: false }), { ...u, role: 'admin_etab', admin: true, totp_actif: true }, 4,
    { categories, revision: 0, confirmation: true, motif: 'Fictif' }), { statut: 403 });
});
test('configuration : nouvelle version et catégories approuvées journalisées', async () => {
  const pool = base();
  const resultat = await p.configurer(pool, { ...u, role: 'admin_etab', admin: true, totp_actif: true }, 4,
    { categories, revision: 3, confirmation: true, motif: 'Référentiel fictif approuvé' });
  assert.equal(resultat.revision, 4);
  assert.ok(pool.requetes.some((x) => x.sql.includes('INSERT INTO journal')));
});
test('habilitation : aucun droit accordé sans administration, MFA et attestation', async () => {
  await assert.rejects(p.habiliter(base(), u, 4, 9, { active: true, version: 0, confirmation: true, motif: 'Fictif' }), { statut: 403 });
  await assert.rejects(p.habiliter(base(), { ...u, role: 'admin_etab', admin: true }, 4, 9,
    { active: true, version: 0, confirmation: true, motif: 'Fictif' }), { statut: 403 });
  await assert.rejects(p.habiliter(base(), { ...u, role: 'admin_etab', admin: true, totp_actif: true }, 4, 9,
    { active: true, version: 0, confirmation: false, motif: 'Fictif' }), { statut: 400 });
});
test('habilitation : attribution explicite versionnée et journalisée', async () => {
  const pool = base();
  const r = await p.habiliter(pool, { ...u, role: 'admin_etab', admin: true, totp_actif: true }, 4, 9,
    { active: true, version: 0, confirmation: true, motif: 'Professionnel fictif vérifié' });
  assert.deepEqual(r, { utilisateur_id: 9, active: true, version: 1 });
  assert.ok(pool.requetes.some((x) => x.sql.includes('INSERT INTO journal')));
});
test('habilitation : changement concurrent refusé sans écraser le droit courant', async () => {
  const pool = base({ habilitationVersion: 2 });
  await assert.rejects(p.habiliter(pool, { ...u, role: 'admin_etab', admin: true, totp_actif: true }, 4, 9,
    { active: false, version: 1, confirmation: true, motif: 'Révocation fictive' }), { statut: 409 });
  assert.ok(!pool.requetes.some((x) => x.sql.includes('INSERT INTO admission_habilitations')));
});
test('OG : questions sur le classement dirigées vers les priorités, sans explication de transfert inventée', () => {
  const og = require('../src/og-outils');
  for (const question of ['Pourquoi ce classement des demandes ?', 'Quelles demandes ont la priorité la plus élevée ?', 'Explique le rang des demandes.']) {
    const qn = og.norm(question); const intentions = og.choisir(og.detecterIntentions(qn), { qn, lits: [] });
    assert.ok(intentions.includes('priorites'), question);
    assert.ok(!intentions.includes('pourquoi'), question);
  }
});
test('migration et schema restent identiques ; aucune validation rétroactive', () => {
  const migration = fs.readFileSync(require.resolve('../db/migrations/20261025-priorites.sql'), 'utf8');
  assert.ok(fs.readFileSync(require.resolve('../db/schema.sql'), 'utf8').includes(migration));
  assert.ok(!/UPDATE\s+demandes_admission/i.test(migration));
});
test('traductions : nouvelles clés FR/EN et catalogue des erreurs cohérents', () => {
  const bac = { window: {} };
  for (const l of ['fr', 'en']) vm.runInNewContext(fs.readFileSync(require.resolve(`../public/i18n/${l}.js`), 'utf8'), bac);
  const { fr, en } = bac.window.ARRIMO_I18N;
  assert.deepEqual(Object.keys(fr.priorites_ui).sort(), Object.keys(en.priorites_ui).sort());
  for (const cle of Object.keys(require('../src/erreurs').MESSAGES).filter((x) => x.startsWith('priorites_'))) {
    assert.ok(fr.erreurs[cle]); assert.ok(en.erreurs[cle]);
  }
});


test('OG traduit uniquement le statut non validé et conserve les libellés professionnels', () => {
  const { libellePriorite } = require('../src/langue');
  assert.equal(libellePriorite({ priorite_validee: false, priorite_affichage: 'À valider' }, 'en'), 'Awaiting validation');
  assert.equal(libellePriorite({ priorite_validee: false }, 'fr'), 'À valider');
  assert.equal(libellePriorite({ priorite_validee: true, priorite_affichage: 'Priorité partenaire' }, 'en'), 'Priorité partenaire');
});

test('présentation anglaise des priorités et explications pour Admissions et Urgences', () => {
  const nonValidee = p.presenterPriorite({ id: 1 }, ref, 'en');
  assert.equal(nonValidee.priorite_affichage, 'Awaiting validation');
  assert.match(nonValidee.priorite_explication, /^Clinical priority has not been validated/);
  const ancienne = p.presenterPriorite({ priorite_validee_le: '2026-10-25T00:00:00Z' }, ref, 'en');
  assert.match(ancienne.priorite_explication, /^Reference changed/);
});
