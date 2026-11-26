'use strict';
// Coopération entre territoires : déclenchée seulement sans capacité confirmée dans le rayon ; autres territoires agrégés, sans nom.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');

test('coopération entre territoires : appelée seulement sans capacité confirmée ; aucune écriture ; autres territoires sans nom', () => {
  const s = fs.readFileSync(path.join(__dirname, '../src/services.js'), 'utf8');
  assert.match(s, /res\.some\(\(x\) => x\.libres_confirmes > 0\) \? null : await cooperationTerritoires/);
  const f = s.slice(s.indexOf('async function cooperationTerritoires'), s.indexOf('function priseEnCharge'));
  assert.doesNotMatch(f, /\b(INSERT|UPDATE|DELETE)\b/);
  const autres = f.slice(f.indexOf('const autres'));
  assert.doesNotMatch(autres.slice(0, autres.indexOf('rows[0]')), /e\.nom/);
  assert.match(f, /accord_requis: true/);
});
