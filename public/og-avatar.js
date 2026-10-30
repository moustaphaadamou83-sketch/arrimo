/* Avatars d'OG : trois modèles sobres (robot, symbole, personnage) paramétrés par établissement.
   Aucun visage réaliste, aucune ressemblance avec une personne réelle ; SVG généré localement, sans ressource externe. */
(function (racine) {
  const echapper = (s) => String(s).replace(/[^#0-9A-Fa-f]/g, '');
  const assombrir = (hex, k = 0.72) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
  function svg(a, taille = 64) {
    const c = echapper(a.couleur || '#0E5E6F'), peau = echapper(a.peau || '#C68642'), f = assombrir(c);
    const rayon = a.style === 'amical' ? 26 : a.style === 'moderne' ? 14 : 20;
    const tenue = a.tenue === 'veste' ? `<path d="M18 64 L26 46 L32 54 L38 46 L46 64 Z" fill="${f}"/><path d="M28 47 L32 54 L36 47" fill="#fff"/>`
      : a.tenue === 'polo' ? `<path d="M16 64 Q32 42 48 64 Z" fill="${c}"/><path d="M29 46 L32 51 L35 46" fill="${f}"/>`
      : `<path d="M16 64 Q32 42 48 64 Z" fill="#fff" stroke="${f}" stroke-width="1.5"/><path d="M32 47 L32 64" stroke="${f}" stroke-width="1.5"/>`;
    const accessoire = a.accessoire === 'lunettes' ? `<g fill="none" stroke="#1F2937" stroke-width="1.6"><circle cx="26.5" cy="28" r="4"/><circle cx="37.5" cy="28" r="4"/><path d="M30.5 28h3"/></g>`
      : a.accessoire === 'casque' ? `<path d="M17 28 Q17 12 32 12 Q47 12 47 28" fill="none" stroke="#1F2937" stroke-width="2.4"/><rect x="14" y="26" width="5" height="9" rx="2" fill="#1F2937"/><rect x="45" y="26" width="5" height="9" rx="2" fill="#1F2937"/>` : '';
    let corps;
    if (a.modele === 'symbole') {
      corps = `<rect x="6" y="6" width="52" height="52" rx="${rayon}" fill="${c}"/><path d="M20 36 Q32 18 44 36" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="42" r="4" fill="#fff"/>`;
    } else if (a.modele === 'humain') {
      // Personnage stylisé : silhouette géométrique, teinte de peau choisie, sans traits réalistes.
      corps = `<rect x="2" y="2" width="60" height="60" rx="${rayon}" fill="${c}" opacity=".18"/>${tenue}<circle cx="32" cy="28" r="12" fill="${peau}"/><path d="M20 26 Q32 10 44 26 Q40 18 32 18 Q24 18 20 26 Z" fill="${f}"/>
        <circle cx="27.5" cy="29" r="1.6" fill="#1F2937"/><circle cx="36.5" cy="29" r="1.6" fill="#1F2937"/><path d="M28 34 Q32 37 36 34" fill="none" stroke="#1F2937" stroke-width="1.4" stroke-linecap="round"/>${accessoire}`;
    } else {
      corps = `<rect x="2" y="2" width="60" height="60" rx="${rayon}" fill="${c}" opacity=".18"/><line x1="32" y1="6" x2="32" y2="13" stroke="${f}" stroke-width="2"/><circle cx="32" cy="6" r="2.5" fill="${f}"/>
        <rect x="14" y="13" width="36" height="30" rx="10" fill="${c}"/><circle cx="25" cy="27" r="4" fill="#fff"/><circle cx="39" cy="27" r="4" fill="#fff"/>
        <path d="M25 36 Q32 40 39 36" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>${tenue}${accessoire}`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${taille}" height="${taille}" role="img" aria-hidden="true" focusable="false">${corps}</svg>`;
  }
  const api = { svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else racine.ArrimoOgAvatar = api;
})(typeof window === 'undefined' ? globalThis : window);
