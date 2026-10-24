const test = require('node:test');
const assert = require('node:assert/strict');
const routage = require('../src/routage');

const old = {
  url: process.env.ARRIMO_ROUTEUR_URL,
  profil: process.env.ARRIMO_ROUTEUR_PROFIL,
  nom: process.env.ARRIMO_ROUTEUR_NOM,
  cle: process.env.ARRIMO_ROUTEUR_CLE,
};
const origin = { latitude: 46.8, longitude: -71.2 };
const destination = { latitude: 46.9, longitude: -71.1 };
function restore() {
  for (const [k, v] of Object.entries({ ARRIMO_ROUTEUR_URL: old.url, ARRIMO_ROUTEUR_PROFIL: old.profil, ARRIMO_ROUTEUR_NOM: old.nom, ARRIMO_ROUTEUR_CLE: old.cle })) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  routage.definirFetchTest(null);
}

test.after(restore);

test('routeur : aucune distance inventée si le fournisseur n’est pas configuré', async () => {
  delete process.env.ARRIMO_ROUTEUR_URL;
  await assert.rejects(routage.itineraire(origin, destination), (e) => e.code === 'routeur_indisponible');
});

test('routeur : convertit les mètres et secondes OSRM et conserve la géométrie réelle', async () => {
  process.env.ARRIMO_ROUTEUR_URL = 'https://router.example.test';
  process.env.ARRIMO_ROUTEUR_NOM = 'routeur fictif';
  const seen = [];
  routage.definirFetchTest(async (url) => {
    seen.push(String(url));
    return { ok: true, json: async () => ({ code: 'Ok', routes: [{ distance: 12345, duration: 2345,
      geometry: { type: 'LineString', coordinates: [[-71.2, 46.8], [-71.1, 46.9]] } }] }) };
  });
  const r = await routage.itineraire(origin, destination);
  assert.equal(r.distance_km, 12.3);
  assert.equal(r.duree_min, 39);
  assert.equal(r.fournisseur, 'routeur fictif');
  assert.equal(r.geometrie.type, 'LineString');
  assert.ok(r.actualise_le);
  assert.match(seen[0], /geometries=geojson/);
  assert.doesNotMatch(seen[0], /fallback_speed/);
});

test('routeur : transmet la clé facultative par en-tête sans l’ajouter à l’URL', async () => {
  process.env.ARRIMO_ROUTEUR_URL = 'https://router.example.test';
  process.env.ARRIMO_ROUTEUR_CLE = 'cle-fixture-secrete';
  let appel;
  routage.definirFetchTest(async (url, opts) => {
    appel = { url: String(url), authorization: opts.headers.Authorization, redirect: opts.redirect };
    return { ok: true, json: async () => ({ code: 'Ok', routes: [{ distance: 1000, duration: 120,
      geometry: { type: 'LineString', coordinates: [[-71.2, 46.8], [-71.1, 46.9]] } }] }) };
  });
  await routage.itineraire(origin, destination);
  assert.equal(appel.authorization, 'Bearer cle-fixture-secrete');
  assert.equal(appel.redirect, 'error', 'un fournisseur ne peut pas rediriger la requête vers un autre hôte');
  assert.doesNotMatch(appel.url, /cle-fixture-secrete/);
});

test('routeur : une matrice nulle reste introuvable, sans estimation de repli', async () => {
  process.env.ARRIMO_ROUTEUR_URL = 'https://router.example.test';
  routage.definirFetchTest(async () => ({ ok: true, json: async () => ({ code: 'Ok', distances: [[null]], durations: [[null]] }) }));
  const r = await routage.matrice(origin, [destination]);
  assert.deepEqual(r.routes, [null]);
});

test('routeur : valide le profil et refuse les coordonnées manquantes', async () => {
  process.env.ARRIMO_ROUTEUR_URL = 'https://router.example.test';
  process.env.ARRIMO_ROUTEUR_PROFIL = '../driving';
  await assert.rejects(routage.itineraire(origin, destination), (e) => e.code === 'routeur_configuration_invalide');
  process.env.ARRIMO_ROUTEUR_PROFIL = 'driving';
  await assert.rejects(routage.itineraire(origin, { latitude: null, longitude: null }), (e) => e.code === 'coordonnees_indisponibles');
});

test('routeur : HTTPS obligatoire hors boucle locale et URLs de test', async () => {
  process.env.ARRIMO_ROUTEUR_URL = 'http://insecure.example.test.com';
  await assert.rejects(routage.itineraire(origin, destination), (e) => e.code === 'routeur_configuration_invalide');
  process.env.ARRIMO_ROUTEUR_URL = 'http://localhost:5000';
  routage.definirFetchTest(async () => ({ ok: true, json: async () => ({ code: 'Ok', routes: [{ distance: 1000, duration: 120,
    geometry: { type: 'LineString', coordinates: [[-71.2, 46.8], [-71.1, 46.9]] } }] }) }));
  assert.equal((await routage.itineraire(origin, destination)).distance_km, 1);
});
