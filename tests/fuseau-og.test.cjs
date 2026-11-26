'use strict';
// « Aujourd’hui » d'OG suit le jour civil du Québec, même si le serveur est à l'heure de l'Europe (recette du 26 nov. 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { jourQuebec } = require('../src/og-liaison');

test('OG Liaison/CHSLD : jour civil du Québec, indépendant du fuseau du serveur', () => {
  assert.equal(jourQuebec(new Date('2026-11-26T00:30:00Z')), '2026-11-25');   // 01 h 30 à Paris = 19 h 30 la veille à Montréal
  assert.equal(jourQuebec(new Date('2026-11-26T05:30:00Z')), '2026-11-26');
  for (const f of ['og-liaison.js', 'og-chsld.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8'), /toDateString\(\)/, `${f} : jour du serveur utilisé`);
  }
});
