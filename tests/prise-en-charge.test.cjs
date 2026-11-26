'use strict';
// Cahier 16 : orienter vers des capacités prêtes, compatibles et confirmées ; délai avant prise en charge jamais inventé.
const test = require('node:test');
const assert = require('node:assert/strict');
const { priseEnCharge } = require('../src/services');

const base = { libres_confirmes: 1, libres_non_confirmes: 0, libres_perimes: 0, lit: { id: 7 }, statut_route: 'calcule', minutes_route: 18 };

test('prête et confirmée : délai = trajet calculé ; préparation 0', () => {
  const p = priseEnCharge(base, new Set(), true);
  assert.equal(p.capacite, 'prete_confirmee'); assert.equal(p.besoins, 'verifies'); assert.deepEqual(p.delai, { route_min: 18, preparation_min: 0, total_min: 18, estimation: true });
  assert.equal(p.equipe_accueil, 'non_renseignee');
});

test('confirmée mais chambre en préparation, ou non confirmée : délai inconnu (jamais 0)', () => {
  assert.equal(priseEnCharge(base, new Set([7]), true).capacite, 'confirmee_en_preparation');
  assert.equal(priseEnCharge(base, new Set([7]), true).delai.total_min, null);
  const nc = priseEnCharge({ ...base, libres_confirmes: 0, libres_non_confirmes: 2, lit: null }, new Set(), false);
  assert.equal(nc.capacite, 'declaree_non_confirmee'); assert.equal(nc.besoins, 'non_transmis'); assert.equal(nc.delai.total_min, null);
});

test('trajet non calculé : délai total inconnu', () => {
  assert.equal(priseEnCharge({ ...base, statut_route: 'indisponible', minutes_route: null }, new Set(), true).delai.total_min, null);
});
