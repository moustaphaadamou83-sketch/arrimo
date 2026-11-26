'use strict';
// Refonte visuelle (cahiers 1-7, maquette validée le 26 nov. 2026) : design system par défaut, CHSLD avec leur thème propre,
// navigation verticale dépliable, densité, Accueil personnalisable, mode présentation réservé à la démonstration.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('design system validé : actif par défaut, retour personnel ?design=v1 ; la console SH n’est pas concernée (data-arrimo)', () => {
  const a = lire('apparence.js');
  assert.match(a, /const apercuV2 = \(\) => lire\(CLE_V2\) !== '0';/);
  assert.match(a, /html\.hasAttribute\('data-arrimo'\) && apercuV2\(\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'public-sh', 'index.html'), 'utf8'), /data-arrimo/);
});

test('CHSLD : ambiances Glacier, Horizon et Crépuscule ne remplacent jamais leur thème propre', () => {
  const css = lire('style.css');
  for (const sel of ['[data-ambiance="glacier"]:not([data-theme="sombre"])', '[data-ambiance="horizon"]:not([data-theme="sombre"])', '[data-design="v2"][data-theme="sombre"]:not']) {
    const i = css.indexOf(sel); assert.ok(i > 0, sel);
    assert.match(css.slice(i, css.indexOf('{', i)), /:not\(\[data-type-etab="chsld"\]\)/, sel);
  }
});

test('cahiers 5 et 7 : menu vertical dépliable, densité, Accueil personnalisable, mode présentation en démonstration seulement', () => {
  const app = lire('app.js'); const acc = lire('accueil.js'); const html = lire('index.html');
  assert.match(html, /id="b-replier-nav"/); assert.match(app, /arrimo-nav-repliee/);
  assert.match(html, /id="densite-barre"/); assert.match(app, /dataset\.densite = densite\(\)/);
  assert.match(acc, /arrimo-accueil-perso/); assert.match(acc, /data-acc-perso/);
  assert.match(app, /presentation: etat\.moi\?\.environnement === 'demo'/);
  for (const L of ['fr', 'en']) { const i = lire(`i18n/${L}.js`); assert.match(i, /replier:/); assert.match(i, /affichage: \{ densite:/); }
});
