'use strict';
// Cahier 3 (entreprises ambulancières) : chaque état réel d'une unité tombe dans une seule catégorie de flotte ; sans état, jamais « disponible ».
const test = require('node:test');
const assert = require('node:assert/strict');
const { resumeFlotte, CATEGORIES_FLOTTE } = require('../src/vehicules');

test('flotte : disponibles, en intervention, en transport, à l’hôpital, en préparation, indisponibles', () => {
  const r = resumeFlotte(['disponible', 'en_route', 'sur_place', 'transport_hopital', 'a_l_hopital', 'en_preparation', 'desinfection', 'hors_service', undefined].map((etat) => ({ etat })));
  assert.deepEqual(r, { disponibles: 1, en_intervention: 2, en_transport: 1, a_l_hopital: 1, en_preparation: 2, indisponibles: 1, sans_etat: 1 });
  const ui = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/secours.js'), 'utf8');
  for (const [etat, cat] of Object.entries(CATEGORIES_FLOTTE)) assert.match(ui, new RegExp(`${etat}: '${cat}'`), `${etat} : même catégorie à l’écran`);
});
