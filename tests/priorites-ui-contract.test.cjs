// Contrats des callbacks d'interface, exécutés dans VM. Aucun navigateur n'est simulé comme réussi.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
function contexte() {
  const appels = []; const messages = []; let fenetre;
  const champs = { '#p-categorie': { value: 'rapide' }, '#p-motif': { value: 'Validation fictive' }, '#p-confirmation': { checked: true } };
  const etat = { ctx: 4, recherche: {} };
  const bac = vm.createContext({ etat, $: (s) => champs[s], t: (s) => s, toast: (message) => messages.push(message),
    etabCtx: () => ({ nom: 'Établissement fictif' }), api: async (...args) => { appels.push(args); return {}; },
    agir: async (_b, fn) => fn(), allerA: () => {}, qsBesoins: () => '',
    modale: (titre, html, actions) => { fenetre = { titre, html, actions }; } });
  vm.runInContext(source.split('\n').find((s) => s.startsWith('const esc =')), bac);
  vm.runInContext(source.slice(source.indexOf('function validerPriorite('), source.indexOf('function configurerPriorites(')), bac);
  vm.runInContext(source.slice(source.indexOf('function executerProposition('), source.indexOf('/* ---------------- Copilote ---------------- */')), bac);
  return { bac, appels, messages, champs, etat, get fenetre() { return fenetre; } };
}
const d = { id: 20, patient_ref: 'P-00001', priorite_version: 5 };
const r = { revision: 2, categories: [{ code: 'rapide', libelle: 'Rapide fictif', rang: 2 }] };
test('priorité : aucun appel API avant confirmation humaine', async () => {
  const c = contexte(); c.bac.validerPriorite(d, r);
  assert.equal(c.appels.length, 0);
  await c.fenetre.actions[1].run();
  assert.equal(c.appels.length, 1);
  const [methode, url, body] = c.appels[0];
  assert.equal(methode, 'POST'); assert.equal(url, '/admissions/20/priorite');
  assert.equal(body.version, 5); assert.equal(body.revision, 2); assert.equal(body.code, 'rapide');
  assert.ok(!('priorite_rang' in body)); assert.ok(!('priorite_validee_par' in body));
});
test('priorité : changement d’établissement interdit l’envoi depuis une ancienne fenêtre', async () => {
  const c = contexte(); c.bac.validerPriorite(d, r); c.etat.ctx = 7;
  assert.equal(await c.fenetre.actions[1].run(), false); assert.equal(c.appels.length, 0);
  assert.ok(c.messages.length);
});
test('priorité : libellés et référence patient échappés ; aucune catégorie choisie par défaut', () => {
  const c = contexte(); c.bac.validerPriorite({ ...d, patient_ref: '<img src=x onerror=alert(1)>' }, { ...r, categories: [{ code: 'rapide', libelle: '<script>1</script>', rang: 2 }] });
  assert.ok(!c.fenetre.html.includes('<script>')); assert.ok(!c.fenetre.html.includes('<img'));
  assert.ok(c.fenetre.html.includes('&lt;script&gt;')); assert.ok(c.fenetre.html.includes('<option value="">'));
  assert.ok(!c.fenetre.html.includes(' selected'));
});
for (const type of ['assigner', 'debut_nettoyage', 'lit', 'conge', 'civiere', 'deplacer']) {
  test(`OG : confirmation obligatoire avant action ${type}`, async () => {
    const c = contexte();
    c.bac.executerProposition({ type, demande_id: 20, lit_id: 30, civiere_id: 9, vers_id: 10, version: 1, action: 'admettre', statut: 'confirme', libelle: 'Action fictive' });
    assert.equal(c.appels.length, 0);
    assert.ok(c.fenetre);
    await c.fenetre.actions[1].run();
    assert.equal(c.appels.length, 1);
  });
}
test('OG : recherche réseau transmet le groupe d’âge et ne crée pas de transfert', async () => {
  const c = contexte();
  c.bac.executerProposition({ type: 'recherche_reseau', type_id: 7, groupe_age: 'pediatrique', patient_ref: 'P-00001', besoins: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(c.appels.length, 1);
  assert.equal(c.appels[0][0], 'GET'); assert.match(c.appels[0][1], /groupe_age=pediatrique/);
  assert.equal(c.etat.recherche.groupe_age, 'pediatrique');
});
test('OG : alternative après refus conserve les besoins pédiatriques du transfert', async () => {
  const c = contexte();
  c.etat.recherche.groupe_age = 'adulte';
  c.bac.api = async (...args) => { c.appels.push(args); return { type_id: 7, patient_ref: 'P-00001', urgent: false, groupe_age: 'pediatrique', besoins: { ventilation: true } }; };
  c.bac.executerProposition({ type: 'plan_b', transfert_id: 19 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(c.etat.recherche.groupe_age, 'pediatrique');
  assert.equal(c.etat.recherche.besoins.ventilation, true);
  assert.equal(c.appels[0][0], 'GET');
});
