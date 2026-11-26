'use strict';
/** Annonces vocales Chrono (26 nov. 2026) : étapes, seuils, une annonce par étape, aucune donnée patient prononcée. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');

function charger() {
  const dits = []; const stock = {};
  const doc = { documentElement: { lang: 'fr-CA' }, getElementById: () => null, createElement: () => ({ setAttribute() {}, appendChild() {}, querySelector: () => null, addEventListener() {}, remove() {}, classList: { toggle() {} } }), body: { appendChild() {} } };
  const ctx = { window: {}, document: doc, location: { pathname: '/' }, localStorage: { getItem: (k) => stock[k] ?? null, setItem: (k, v) => { stock[k] = v; } },
    setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => {}, Date, Math, JSON, Number, String, Set, Array };
  ctx.window.speechSynthesis = { speak: (u) => dits.push(u.text) };
  ctx.window.SpeechSynthesisUtterance = function U(t) { this.text = t; };
  ctx.window.addEventListener = () => {};
  ctx.speechSynthesis = ctx.window.speechSynthesis; ctx.SpeechSynthesisUtterance = ctx.window.SpeechSynthesisUtterance;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'chrono-annonces.js'), 'utf8'), ctx);
  return { A: ctx.window.ArrimoAnnonces, dits, stock };
}
const R = { actif: true, volume: 1, attendue: 5, approche: 2, sur_place: 10 };
const now = Date.parse('2026-11-26T12:00:00Z');
const pa = (x) => ({ id: 1, unite: 'SIM-01', numero: 'PA-000001', ...x });

test('Étapes : attendue, en approche, arrivée, rappel sur place ; ETA GPS d’abord, jamais inventée', () => {
  const { A } = charger();
  assert.strictEqual(A.etapes(pa({ heure_prevue: null }), R, now).length, 0, 'sans ETA ni heure : rien');
  assert.strictEqual(A.etapes(pa({ heure_prevue: new Date(now + 4.6 * 60000) }), R, now)[0].texte, 'Ambulance SIM-01 attendue dans 5 minutes.');
  assert.strictEqual(A.etapes(pa({ eta: { minutes: 2, le: new Date(now) }, heure_prevue: new Date(now + 30 * 60000) }), R, now)[0].cle, 'approche', 'GPS prioritaire sur l’heure prévue');
  assert.strictEqual(A.etapes(pa({ heure_prevue: new Date(now + 20 * 60000) }), R, now).length, 0, 'trop tôt');
  const sur = A.etapes(pa({ arrivee_signalee_le: new Date(now - 12 * 60000) }), R, now);
  assert.deepStrictEqual([...sur].map((e) => e.cle), ['arrivee', 'sur_place_10']);
  assert.match(sur[1].texte, /sur place depuis 10 minutes/);
  assert.strictEqual(A.etapes(pa({ arrivee_signalee_le: new Date(now - 12 * 60000), remise_le: new Date(now) }), R, now).length, 1, 'remise : plus de rappel');
});

test('Une annonce par étape ; rien au premier passage ; rien si désactivées ; aucune donnée patient', () => {
  const { A, dits, stock } = charger();
  stock['arrimo-annonces'] = JSON.stringify(R);
  const p = pa({ heure_prevue: new Date(Date.now() + 4 * 60000), resident_ref: 'P-16633', categorie: 'cardiaque' });
  A.traiter([p]); assert.strictEqual(dits.length, 0, 'premier passage : état déjà connu');
  const q = pa({ id: 2, unite: 'SIM-02', heure_prevue: new Date(Date.now() + 4 * 60000), resident_ref: 'P-16634', categorie: 'cardiaque' });
  A.traiter([p, q]); A.traiter([p, q]);
  assert.deepStrictEqual([...dits], ['Ambulance SIM 02 attendue dans 4 minutes.'], 'une seule fois');
  assert.ok(!dits.join(' ').match(/P-1663|cardiaque/), 'aucune référence ni catégorie prononcée');
  stock['arrimo-annonces'] = JSON.stringify({ ...R, actif: false });
  A.traiter([pa({ id: 3, unite: 'SIM-03', arrivee_signalee_le: new Date() })]);
  assert.strictEqual(dits.length, 1, 'désactivées : silence');
});

test('Chargées sur les postes des établissements, branchées sur la veille existante (pas de second moteur)', () => {
  const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
  assert.match(lire('index.html'), /<script src="son-notif\.js"><\/script>\s*<script src="chrono-annonces\.js"><\/script>/);
  assert.match(lire('liaison-secours.js'), /window\.ArrimoAnnonces\?\.traiter\(ouvertes\)/);
  assert.ok(!/speechSynthesis/.test(lire('secours.js')), 'pas d’annonce sur l’écran de l’ambulance (conduite)');
});
