'use strict';
/* Registre universel des modules (27 nov. 2026) : quatre conditions, hiérarchie SH, catégories par type, redirections. Sans base. */
const test = require('node:test');
const assert = require('node:assert');
const R = require('../src/registre-modules');
const TE = require('../src/types-etablissement');
const ecrans = (etab, role = 'coordonnateur') => [...R.ecransAutorises(etab, { role }, TE.moduleActif)];
const hop = (m = {}) => ({ type_etablissement: 'hopital', modules: m });
const heb = (m = {}, local = null) => ({ type_etablissement: 'chsld', type_local_code: local, modules: m });

test('Hôpital : 12 modules au plus, Congés et Alertes séparés, jamais Départs ni Inter-hébergement', () => {
  const ids = R.NAV.hopital.map((m) => m.id);
  assert.deepStrictEqual(ids, ['accueil', 'patients', 'capacites', 'conges', 'transferts', 'urgences', 'chrono', 'alertes', 'operations', 'pilotage', 'reseau', 'national', 'administration']);
  const e = ecrans(hop({ chrono: true, liaison_secours: true }));
  assert.ok(e.includes('conges') && e.includes('vigilance'));
  for (const v of ['c-departs', 'c-reseau', 'c-urgences', 'eviter']) assert.ok(!e.includes(v), v);
  assert.ok(!R.CATEGORIES_FLUX.hopital.includes('interhebergement'));
});
test('Hébergement (CHSLD, RPA) : Résidents, Départs, Secours 911, jamais Interhospitalier', () => {
  assert.deepStrictEqual(R.NAV.hebergement.map((m) => m.id), ['accueil', 'residents', 'capacites', 'departs', 'transferts', 'urgences', 'chrono', 'alertes', 'operations', 'pilotage', 'reseau', 'administration']);
  for (const type of [null, 'rpa', 'ri']) {
    const e = ecrans(heb({ transport_ambulancier: true }, type));
    assert.ok(e.includes('c-departs') && e.includes('c-alertes') && e.includes('c-urgences'), type);
    for (const v of ['transferts', 'liaison', 'secours', 'urgence', 'vigilance', 'conges']) assert.ok(!e.includes(v), `${type} ${v}`);
  }
  assert.ok(!R.CATEGORIES_FLUX.hebergement.includes('interhospitalier'));
});
test('Intitulés : plus de Liaison Secours, Liaison CHSLD ni Avant l’appel ; Secours 911 dans Urgences', () => {
  const tous = JSON.stringify(R.NAV);
  for (const x of ['Liaison Secours', 'Liaison CHSLD', 'Avant l', 'Congés et alertes']) assert.ok(!tous.includes(x), x);
  for (const f of ['hopital', 'hebergement']) assert.ok(R.NAV[f].find((m) => m.id === 'urgences').sous.some((s) => s.fr === 'Secours 911'), f);
  assert.strictEqual(R.REDIRECTIONS.eviter, 'c-urgences');
});
test('Licence : un module optionnel non souscrit n’a ni écran ni route', () => {
  assert.ok(!ecrans(hop()).includes('chrono'));
  assert.ok(ecrans(hop({ chrono: true })).includes('chrono'));
  assert.deepStrictEqual(R.routeAutorisee(hop(), '/bourse/places', TE.moduleActif), { ok: false, raison: 'licence', module: 'capacites' });
  assert.deepStrictEqual(R.routeAutorisee(hop({ bourse_places: true }), '/bourse/places', TE.moduleActif), { ok: true });
  assert.strictEqual(R.routeAutorisee(hop(), '/lits', TE.moduleActif), null);   // route sans propriétaire : contrôlée par la route elle-même
});
test('Hiérarchie SH : module désactivé = sous-modules inaccessibles ; réactivation = retour sans perte', () => {
  const avant = ecrans(hop({ bourse_places: true }));
  const sans = ecrans(hop({ bourse_places: true, 'sm:capacites': false }));
  assert.ok(avant.includes('lits') && avant.includes('bourse'));
  assert.ok(!sans.includes('lits') && !sans.includes('bourse'));
  assert.strictEqual(R.routeAutorisee(hop({ bourse_places: true, 'sm:capacites': false }), '/bourse', TE.moduleActif).raison, 'sous_module');
  const sous = ecrans(hop({ bourse_places: true, 'sm:capacites.bourse': false }));
  assert.ok(sous.includes('lits') && !sous.includes('bourse'));
  assert.deepStrictEqual(ecrans(hop({ bourse_places: true })), avant);
  assert.ok(R.clesSousModules('hopital').includes('transferts.hopital_hebergement'));
});
test('Rôles : National au gestionnaire seulement ; Administration aux administrateurs', () => {
  assert.ok(!ecrans(hop()).includes('national'));
  assert.ok(ecrans(hop(), 'gestionnaire').includes('national'));
  assert.ok(!ecrans(hop(), 'equipe_soins').includes('admin'));
});
test('Secours 911 hébergement : ouvert avec la préparation de l’intervention seule (ex « Avant l’appel »)', () => {
  assert.ok(ecrans(heb({ eviter_transferts: true })).includes('c-urgences'));
  assert.ok(!ecrans(heb()).includes('c-urgences'));
});
test('Offres commerciales : Chrono seul et combinaisons, codes connus du catalogue', () => {
  const codes = new Set(TE.MODULES.map((m) => m.code));
  for (const o of R.OFFRES) if (o.modules !== '*') for (const c of o.modules) assert.ok(codes.has(c), `${o.id} ${c}`);
  assert.deepStrictEqual(R.OFFRES.find((o) => o.id === 'chrono_seul').modules, ['chrono']);
  for (const o of R.OFFRES) assert.ok(o.fr && o.en);
});
test('Parité FR/EN des intitulés du registre et des modules Congés/Alertes', () => {
  for (const l of Object.values(R.NAV)) for (const m of l) { assert.ok(m.fr && m.en); for (const s of m.sous || []) assert.ok(s.fr && s.en, s.id); }
  global.window = {}; global.document = { documentElement: {} };
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/conges-alertes.js'), 'utf8');
  const m = src.match(/const TX = (\{[\s\S]*?\n  \});/); const TX = Function(`return ${m[1]}`)();
  assert.deepStrictEqual(Object.keys(TX.fr).sort(), Object.keys(TX.en).sort());
});
