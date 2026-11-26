'use strict';
// Refonte visuelle (cahiers 1-7, maquette validée le 26 nov. 2026) : design system par défaut, CHSLD avec leur thème propre,
// navigation verticale dépliable, densité, Accueil personnalisable, mode présentation réservé à la démonstration.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('design system validé : actif par défaut, retour personnel ?design=v1 ; console SH comprise (cahier correctif final, 26 nov. 2026)', () => {
  const a = lire('apparence.js');
  assert.match(a, /const apercuV2 = \(\) => lire\(CLE_V2\) !== '0';/);
  assert.match(a, /html\.hasAttribute\('data-arrimo'\) && apercuV2\(\)/);
  const sh = fs.readFileSync(path.join(__dirname, '..', 'public-sh', 'index.html'), 'utf8');
  assert.match(sh, /data-arrimo/); assert.match(sh, /design-arrimo\.css/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'sh', 'app.js'), 'utf8'), /'design-arrimo\.css'/);
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
  for (const L of ['fr', 'en']) { const i = lire(`i18n/${L}.js`); assert.match(i, /replier:/); assert.match(i, /affichage: \{[^}]*densite:/); }
});

test('cahier correctif final : les 4 planches reproduites par des composants partagés, chargés par toutes les pages', () => {
  const css = lire('design-arrimo.css') + lire('style.css'); const ds = lire('design-arrimo.js');
  // Planche 1 : couleurs HEX des ambiances, modules, catégories et alertes
  for (const hex of ['#EDF4FA', '#F6F3EE', '#0B141D', '#087F8C', '#0E7C86', '#7C3AED', '#2B59C3', '#047857', '#BE185D', '#B45309', '#4338CA', '#0F766E', '#86198F', '#475569']) assert.ok(css.includes(hex) || ds.includes(hex), hex);
  // Planche 2 : barre latérale de 250 px, sous-onglets indentés, police Inter
  assert.match(css, /--largeur-barre-laterale: 250px/); assert.match(css, /margin-left: 28px/); assert.match(css, /font-family: "Inter"/);
  // Planches 3 et 4 : double anneau, progression en 7 étapes
  assert.match(ds, /function doubleAnneau/); assert.match(ds, /length: 7/);
  for (const page of ['index.html', 'secours.html']) { const h = lire(page); assert.match(h, /design-arrimo\.css/); assert.match(h, /design-arrimo\.js/); }
  assert.match(lire('espaces.js'), /arrimo-nav-ouverts/);   // modules dépliables individuellement
  assert.match(lire('chrono.js'), /acquittement coupe le son|Acquitter le son/);
  assert.match(lire('arrimo-flux.js'), /\/transferts\/\$\{l\.transfert\.id\}\/plans/);   // plans A, B, C réels d'OG
});
