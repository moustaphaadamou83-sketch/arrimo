'use strict';
/**
 * Audit de l'anglais (chantier du 19 nov. 2026) : repère dans l'interface les textes français écrits en dur (hors dictionnaires),
 * qui resteraient en français pour un utilisateur anglophone. Heuristique : chaîne littérale avec une lettre accentuée française
 * ou un mot français courant, hors commentaires, hors appels t('…'), hors clés de dictionnaire.
 * Usage : node scripts/audit-anglais.cjs [--json]   ·   sortie : fichier, ligne, texte
 */
const fs = require('fs'); const path = require('path');
const FICHIERS = ['public/app.js', 'public/chsld.js', 'public/secours.js', 'public/liaison-secours.js', 'public/transports.js', 'public/og.js', 'public/proches.js',
  'public/carte-arrimo.js', 'public/og-vocal.js', 'public/og-message-vocal.js', 'public/remise.js', 'public/legal.js', 'public/support-client.js', 'public/apparence.js', 'public/flux.js'];
const MOTS = /\b(le|la|les|des|du|une|aucun|aucune|pour|avec|sans|dans|est|sont|Enregistrer|Annuler|Confirmer|Fermer|Ouvrir|Modifier|Ajouter|Supprimer|Chargement|Erreur|demande|lit|lits|chambre|résident|patient)\b/;
const ACCENTS = /[éèêàâçôîûùëïÉÈÀÇ’]/;
function chaines(ligne) {
  const res = []; const re = /(['"`])((?:\\.|(?!\1).)*)\1/g; let m;
  while ((m = re.exec(ligne))) res.push({ texte: m[2], index: m.index });
  return res;
}
function auditer(racine = path.join(__dirname, '..')) {
  const trouves = [];
  for (const f of FICHIERS) {
    const p = path.join(racine, f); if (!fs.existsSync(p)) continue;
    let bloc = false;
    fs.readFileSync(p, 'utf8').split('\n').forEach((brut, i) => {
      let ligne = brut;
      if (bloc) { const fin = ligne.indexOf('*/'); if (fin < 0) return; ligne = ligne.slice(fin + 2); bloc = false; }
      ligne = ligne.replace(/\/\*.*?\*\//g, '');
      const deb = ligne.indexOf('/*'); if (deb >= 0) { bloc = true; ligne = ligne.slice(0, deb); }
      const com = ligne.search(/(^|[^:'"`\\])\/\/(?![^'"`]*['"`])/); if (com >= 0) ligne = ligne.slice(0, com + 1);
      for (const c of chaines(ligne)) {
        const avant = ligne.slice(Math.max(0, c.index - 3), c.index);
        if (/\bt\($|tt\($|\bL\($/.test(avant)) continue;                      // clé de traduction
        const texte = c.texte.replace(/\$\{[^}]*\}/g, ' ').replace(/<[^>]+>/g, ' ').trim();
        if (texte.length < 3 || /^[a-z0-9_.\-/#:[\]=" ]+$/i.test(texte) && !MOTS.test(texte)) continue;
        if (!ACCENTS.test(texte) && !(MOTS.test(texte) && /\s/.test(texte))) continue;
        if (/^(fr|en)(-CA)?$/.test(texte)) continue;
        trouves.push({ fichier: f, ligne: i + 1, texte: texte.slice(0, 120) });
      }
    });
  }
  return trouves;
}
if (require.main === module) {
  const t = auditer();
  if (process.argv.includes('--json')) console.log(JSON.stringify(t, null, 2));
  else {
    const parFichier = {}; for (const x of t) parFichier[x.fichier] = (parFichier[x.fichier] || 0) + 1;
    console.log(parFichier); console.log(`total : ${t.length}`);
  }
}
module.exports = { auditer, FICHIERS };
