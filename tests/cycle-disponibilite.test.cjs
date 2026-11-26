'use strict';
// Cahier 15 : cycle de disponibilité dérivé ; l'état réel (regles.js) n'est jamais modifié ; « prête » ≠ « confirmée ».
const test = require('node:test');
const assert = require('node:assert/strict');
const { etatCycle, ETATS } = require('../src/cycle-disponibilite');

test('cycle : chaque état réel et ses faits donnent une seule étape', () => {
  const e = (l) => etatCycle(l, 60);
  assert.equal(e({ etat: 'occupe' }), 'occupee');
  assert.equal(e({ etat: 'occupe', conge_ouvert: true }), 'liberation_previsionnelle');
  assert.equal(e({ etat: 'nettoyage' }), 'liberee');
  assert.equal(e({ etat: 'nettoyage', intervention_ouverte: true }), 'nettoyage');
  assert.equal(e({ etat: 'libre', preparation_ouverte: true, confirmation_min: 5 }), 'preparation');
  assert.equal(e({ etat: 'libre', confirmation_min: 30 }), 'confirmee');
  assert.equal(e({ etat: 'libre', confirmation_min: 61 }), 'prete');
  assert.equal(e({ etat: 'libre', confirmation_min: null }), 'prete');
  assert.equal(e({ etat: 'reserve' }), 'attribuee');
  assert.equal(e({ etat: 'indispo' }), 'indisponible');
  assert.equal(new Set(ETATS).size, 9);
});

test('cycle : le module ne modifie aucun lit (lecture seule)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/cycle-disponibilite.js'), 'utf8');
  assert.doesNotMatch(src, /\b(UPDATE|INSERT|DELETE)\b/);
});
