'use strict';
// Météo de l'en-tête : source Open-Meteo interrogée par le serveur, mise en cache, échec silencieux, accès par établissement.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.ARRIMO_ENV = 'demo';
const { meteo, _cache } = require('../src/meteo');
const pool = { query: async () => ({ rows: [{ ville: 'Ville Y', latitude: 45.27, longitude: -72.15 }] }) };
const u = { gestionnaire: true, etabs: [] };
test('météo : température et code du ciel lus une fois puis gardés en cache ; seules les coordonnées partent', async () => {
  _cache.clear(); const avant = global.fetch; const appels = [];
  global.fetch = async (url) => { appels.push(String(url)); return { ok: true, json: async () => ({ timezone: 'America/Toronto', current: { temperature_2m: 7.44, weather_code: 3, is_day: 0, time: '2026-10-30T18:00' } }) }; };
  try {
    const m = await meteo(pool, u, 1);
    assert.deepEqual([m.disponible, m.temperature, m.code, m.jour, m.ville, m.source], [true, 7.4, 3, false, 'Ville Y', 'Open-Meteo']);
    await meteo(pool, u, 1); assert.equal(appels.length, 1, 'cache de 15 minutes');
    assert.match(appels[0], /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=45\.270&longitude=-72\.150&/);
  } finally { global.fetch = avant; }
});
test('météo : panne du fournisseur sans erreur, désactivation possible, accès contrôlé', async () => {
  _cache.clear(); const avant = global.fetch;
  global.fetch = async () => { throw new Error('réseau'); };
  try {
    assert.equal((await meteo(pool, u, 1)).disponible, false);
    _cache.clear(); process.env.ARRIMO_METEO = '0'; let appele = false; global.fetch = async () => { appele = true; };
    assert.equal((await meteo(pool, u, 1)).disponible, false); assert.equal(appele, false);
  } finally { global.fetch = avant; delete process.env.ARRIMO_METEO; }
  await assert.rejects(meteo(pool, { gestionnaire: false, etabs: [2] }, 1), (e) => e.statut === 403 || e.status === 403 || /etab_interdit/.test(e.code || e.message));
});
