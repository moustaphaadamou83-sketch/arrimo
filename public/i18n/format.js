/* Arrimo — mise en forme commune à l'interface et au serveur : nombres, pourcentages, durées, pluriels.
 * Une seule implémentation, chargée par le navigateur (window.ArrimoFormat) et par le serveur (require).
 *
 * Modèles de texte :
 *   {nom}                      variable ; un nombre est mis en forme selon la langue (9,5 en français, 9.5 en anglais)
 *   {n|# lit libre|# lits libres}             singulier | pluriel (# = le nombre mis en forme)
 *   {n|aucun lit libre|# lit libre|# lits libres}   zéro | singulier | pluriel
 * Les règles de pluriel viennent d'Intl.PluralRules : en français 0 et 1 sont au singulier, en anglais seulement 1.
 */
(function (racine) {
  const cache = new Map();
  const memo = (cle, fabrique) => { if (!cache.has(cle)) cache.set(cle, fabrique()); return cache.get(cle); };

  /** Nombre selon la langue, au plus `dec` décimales (1 par défaut). */
  function nombre(locale, n, dec = 1) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return memo(`n${locale}${dec}`, () => new Intl.NumberFormat(locale, { maximumFractionDigits: dec })).format(Number(n));
  }
  /** Pourcentage : « 9,5 % » en français, « 9.5% » en anglais. `n` est déjà en pour cent (9.5 pour 9,5 %). */
  function pourcent(locale, n, dec = 1) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return memo(`p${locale}${dec}`, () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: dec })).format(Number(n) / 100);
  }
  /** Durée à partir de minutes : « 49 min », « 5 h 08 » (français), « 5 h 8 min » (anglais), « 3 j 4 h » / « 3 d 4 h » au-delà de 72 h. */
  function duree(locale, minutes) {
    if (minutes == null || Number.isNaN(Number(minutes))) return '—';
    const m = Math.max(0, Math.round(Number(minutes)));
    const fr = !String(locale).startsWith('en');
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h >= 72) {
      const j = Math.floor(h / 24); const rh = h % 24;
      return fr ? `${j} j${rh ? ` ${rh} h` : ''}` : `${j} d${rh ? ` ${rh} h` : ''}`;
    }
    const r = m % 60;
    if (!r) return `${h} h`;
    return fr ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h ${r} min`;
  }
  /** Forme du singulier ou du pluriel. formes : [un, plusieurs] ou [zéro, un, plusieurs]. */
  function pluriel(locale, n, formes) {
    const nb = Number(n);
    if (formes.length >= 3 && nb === 0) return formes[0];
    const [un, plusieurs] = formes.length >= 3 ? formes.slice(1) : formes;
    const cat = memo(`r${locale}`, () => new Intl.PluralRules(locale)).select(nb);
    return cat === 'one' ? un : plusieurs;
  }
  /** Remplit un modèle. `special(nom, valeur)` peut traduire une variable (ex. état d'un lit) ; sinon les nombres sont mis en forme. */
  function remplir(locale, modele, vars = {}, special = null) {
    return String(modele).replace(/\{(\w+)((?:\|[^{}|]*){2,3})?\}/g, (m, k, formes) => {
      const v = vars[k];
      if (v === undefined) return m;
      if (formes) {
        const texte = typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v)) ? nombre(locale, v) : String(v);
        return pluriel(locale, Number(v), formes.slice(1).split('|')).replace(/#/g, texte);
      }
      if (special) { const s = special(k, v); if (s !== undefined) return s; }
      return typeof v === 'number' ? nombre(locale, v) : String(v);
    });
  }
  const api = { nombre, pourcent, duree, pluriel, remplir };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else racine.ArrimoFormat = api;
}(typeof window !== 'undefined' ? window : globalThis));
