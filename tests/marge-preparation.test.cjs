'use strict';
// Cahier 12 : marge de préparation = arrivée de l'ambulance comparée au délai mesuré de préparation ; jamais « inconnu » compté 0.
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluer, arrivee } = require('../src/marge-preparation');

const NOW = Date.parse('2026-11-26T12:00:00Z');
const m = (c = {}, l = {}) => ({ civieres: { libres: 0, nettoyage: 0, nettoyage_depuis: null, nettoyage_mediane_min: null, nettoyage_mesures: 0, ...c },
  lits: { libres: 0, nettoyage: 0, nettoyage_mediane_min: null, nettoyage_mesures: 0, ...l } });
const pEta = (min) => ({ id: 1, eta: { minutes: min, le: new Date(NOW).toISOString() } });

test('arrivée : ETA de position d’abord, heure déclarée ensuite, sinon inconnue', () => {
  assert.deepEqual(arrivee(pEta(12), NOW), { minutes: 12, source: 'position', estimation: true });
  assert.equal(arrivee({ heure_prevue: new Date(NOW + 20 * 60000).toISOString() }, NOW).source, 'declaree');
  assert.deepEqual(arrivee({}, NOW), { minutes: null, source: 'inconnue' });
});

test('civière libre : marge = minutes avant l’arrivée ; réservée prête : délai 0 mesuré', () => {
  const r = evaluer(m({ libres: 2 }), pEta(12), null, NOW);
  assert.equal(r.verdict, 'marge'); assert.equal(r.marge_min, 12); assert.equal(r.civiere.source, 'mesure');
  assert.equal(evaluer(m(), pEta(3), { statut: 'reservee', civiere_etat: 'libre' }, NOW).civiere.etat, 'reservee_prete');
  assert.equal(evaluer(m({ libres: 1 }), pEta(3), null, NOW).verdict, 'marge_faible');
});

test('nettoyage en cours : délai = médiane mesurée moins le temps écoulé ; risque de retard si l’ambulance arrive avant', () => {
  const debut = new Date(NOW - 5 * 60000).toISOString();
  const r = evaluer(m({ nettoyage: 1, nettoyage_depuis: debut, nettoyage_mediane_min: 25, nettoyage_mesures: 14 }), pEta(8), null, NOW);
  assert.equal(r.civiere.delai_min, 20); assert.equal(r.marge_min, -12); assert.equal(r.verdict, 'risque_retard'); assert.equal(r.estimation, true);
});

test('jamais d’invention : nettoyage sans mesure ou arrivée inconnue → « inconnu » ; aucune civière → risque signalé', () => {
  const sansMesure = evaluer(m({ nettoyage: 1 }), pEta(30), null, NOW);
  assert.equal(sansMesure.verdict, 'inconnu'); assert.equal(sansMesure.civiere.delai_min, null); assert.equal(sansMesure.marge_min, null);
  assert.equal(evaluer(m({ libres: 1 }), {}, null, NOW).verdict, 'inconnu');
  const aucune = evaluer(m(), pEta(30), null, NOW);
  assert.equal(aucune.verdict, 'risque_retard'); assert.equal(aucune.civiere.etat, 'aucune_civiere'); assert.equal(aucune.marge_min, null);
});

test('lit : indicatif, compatibilité toujours à vérifier (règle du cahier 19)', () => {
  assert.equal(evaluer(m({ libres: 1 }, { libres: 3 }), pEta(10), null, NOW).lit.compatibilite, 'a_verifier');
  assert.equal(evaluer(m({ libres: 1 }, { nettoyage: 2, nettoyage_mediane_min: 40, nettoyage_mesures: 9 }), pEta(10), null, NOW).lit.delai_min, 40);
  assert.equal(evaluer(m({ libres: 1 }, { nettoyage: 2 }), pEta(10), null, NOW).lit.delai_min, null);
});
