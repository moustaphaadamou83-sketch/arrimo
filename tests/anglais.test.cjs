'use strict';
/**
 * Anglais partout (19 nov. 2026) : tests qui échouent s'il manque une traduction dans les textes produits par le serveur.
 * Vigilance : chaque texte français fixe de src/vigilance.js a son modèle anglais, avec les mêmes variables.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const ven = require('../src/vigilance-en');

test('Vigilance : chaque modèle anglais garde les mêmes variables', () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
  for (const [fr, en] of ven.MODELES) { assert.deepStrictEqual(vars(fr), vars(en), fr); assert.notStrictEqual(fr, en, fr); }
});

test('Vigilance : chaque texte français fixe du serveur est traduit (échoue s’il en manque un)', () => {
  const src = fs.readFileSync(require.resolve('../src/vigilance.js'), 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  const fixes = [...src.matchAll(/'([^'\n]*[a-zàâçéèêîôû’][^'\n]* [^'\n]*)'/g)].map((m) => m[1])
    .filter((s) => /[éèêàçô’]|\b(le|la|les|des|du|une|est|sans|depuis)\b/.test(s) && !/^(SELECT|UPDATE)/.test(s) && !s.includes('${'));
  assert.ok(fixes.length > 20, `${fixes.length} textes trouvés`);
  // Fragments insérés dans une phrase complète déjà couverte par son propre modèle
  const FRAGMENTS = [', nettoyage non commencé', 'non précisé'];
  const manquants = fixes.filter((s) => !FRAGMENTS.includes(s) && ven.traduireTexte(s) === s);
  assert.deepStrictEqual(manquants, []);
  // Textes à variables : exemples réels
  assert.strictEqual(ven.traduireTexte('B-12 — Réservé depuis 3 j 4 h sans admission enregistrée.'), 'B-12 — Reserved for 3 d 4 h with no recorded admission.');
  assert.strictEqual(ven.traduireTexte('P-00012 attend un lit de medicine depuis 45 min (civière C-3).'), 'P-00012 has been waiting for a medicine bed for 45 min (stretcher C-3).');
  assert.strictEqual(ven.traduireTexte('Une confirmation reste valable 60 min (confirmation_lit_validite_min).'), 'A confirmation stays valid for 60 min (confirmation_lit_validite_min).');
  // Les données saisies (motifs, noms) restent telles quelles
  assert.strictEqual(ven.traduireTexte('B-3 — Hors service depuis 2 h (motif : Plomberie).'), 'B-3 — Out of service for 2 h (reason: Plomberie).');
});

test('Vigilance : la réponse entière passe en anglais, le français reste intact', () => {
  const fr = { alertes: [{ titre: 'Aucun début de nettoyage enregistré.', unite: 'Urgence', dernier_evenement: { action: 'Changement d’état' } }], regles_couleurs: { faible: 'Jaune : à vérifier (seuil atteint, sans effet bloquant établi).' } };
  assert.deepStrictEqual(ven.traduire(fr, 'fr'), fr);
  const en = ven.traduire(fr, 'en');
  assert.strictEqual(en.alertes[0].titre, 'No cleaning start recorded.'); assert.strictEqual(en.alertes[0].unite, 'Emergency');
  assert.strictEqual(en.alertes[0].dernier_evenement.action, 'Status change');
  assert.match(en.regles_couleurs.faible, /^Yellow/);
});
