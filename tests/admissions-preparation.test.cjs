'use strict';
// Liste de préparation des admissions : étapes = faits enregistrés ; inconnu jamais compté comme fait ; plan B seulement sans lit compatible.
const test = require('node:test');
const assert = require('node:assert/strict');
const { etapes } = require('../src/admissions-preparation');

test('demande sans lit compatible ici : plan B requis, prochaine étape dans l’ordre du parcours', () => {
  const r = etapes({ priorite_validee_le: '2026-11-26T10:00:00Z', lit_id: null, compatibles: 0, transfert_id: null });
  assert.deepEqual(r.restantes, ['lit_compatible', 'lit_assigne', 'chambre_prete', 'plan_b']);
  assert.equal(r.prochaine, 'lit_compatible'); assert.equal(r.prete, false);
  assert.equal(r.etapes.find((e) => e.code === 'chambre_prete').ok, null);
});

test('lit assigné et réservé sans préparation ni nettoyage ouvert : prête ; sinon chambre non prête', () => {
  const base = { priorite_validee_le: 'x', lit_id: 3, compatibles: null, lit_etat: 'reserve', preparation_ouverte: false, nettoyage_ouvert: false };
  assert.equal(etapes(base).prete, true);
  assert.equal(etapes({ ...base, preparation_ouverte: true }).prochaine, 'chambre_prete');
  assert.equal(etapes({ ...base, lit_etat: 'nettoyage' }).prete, false);
  assert.equal(etapes(base).etapes.some((e) => e.code === 'plan_b'), false);
});
