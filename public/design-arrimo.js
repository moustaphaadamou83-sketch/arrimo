/* Composants partagés du design system (proposition visuelle validée, 4 planches) : un seul rendu pour tous les écrans et tous les comptes.
   Aucune donnée n'est inventée : chaque composant affiche ce qu'on lui donne, « inconnu » n'est jamais présenté comme 0 (planche 1, section 4). */
(() => {
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sombre = () => document.documentElement.dataset.theme === 'sombre';
  // Couleurs de la planche 1 (claires en Crépuscule)
  const MODULES = {
    accueil: ['#0E7C86', '#5BC4D0'], patients: ['#7C3AED', '#B794F6'], transferts: ['#2B59C3', '#8AA8F0'], capacites: ['#047857', '#5DD3A6'], urgences: ['#BE185D', '#F38DB8'],
    operations: ['#B45309', '#F4B35E'], pilotage: ['#4338CA', '#A5A9F5'], reseau: ['#0F766E', '#5ED1C4'], national: ['#86198F', '#E79BF0'], administration: ['#475569', '#A9BAC9'],
  };
  const ETATS = { vert: ['#15803D', '#4ADE80'], orange: ['#C2410C', '#FDBA74'], rouge: ['#B91C1C', '#FCA5A5'], gris: ['#94A3B8', '#A9BAC9'], info: ['#0E7C86', '#5BC4D0'] };
  const coul = (table, cle) => (table[cle] || table.gris || ['#94A3B8', '#A9BAC9'])[sombre() ? 1 : 0];
  const module = (cle) => coul(MODULES, cle);
  const etat = (cle) => coul(ETATS, cle);
  const piste = () => (sombre() ? '#293D4C' : '#E5EDF5');

  /** Anneau simple (arrivées attendues, planche 2) : pct 0-100 ou null (inconnu : anneau vide, « ? »). */
  function anneau(pct, couleur, { taille = 52, epaisseur = 6, texte, aria } = {}) {
    const r = (taille - epaisseur) / 2 - 1; const tour = 2 * Math.PI * r; const c = taille / 2;
    const frac = pct == null ? 0 : Math.max(0, Math.min(100, pct)) / 100;
    const lib = texte ?? (pct == null ? '?' : `${Math.round(pct)} %`);
    return `<svg class="ds-anneau" width="${taille}" height="${taille}" viewBox="0 0 ${taille} ${taille}" role="img" aria-label="${esc(aria || lib)}">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${piste()}" stroke-width="${epaisseur}"/>
      ${frac > 0 ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${couleur}" stroke-width="${epaisseur}" stroke-linecap="round" stroke-dasharray="${(frac * tour).toFixed(1)} ${tour.toFixed(1)}" transform="rotate(-90 ${c} ${c})"/>` : ''}
      <text x="${c}" y="${c + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">${esc(lib)}</text></svg>`;
  }
  /** Double anneau de Chrono (planche 3) : extérieur = remise (objectif A min), intérieur = libération (objectif B min). */
  function doubleAnneau({ minutes, remise, liberation, couleurRemise, couleurLib, aria, legende }) {
    const R1 = 2 * Math.PI * 56; const R2 = 2 * Math.PI * 40;
    const f1 = remise ? Math.min(1, (minutes ?? 0) / remise) : 0; const f2 = liberation ? Math.min(1, (minutes ?? 0) / liberation) : 0;
    return `<svg class="ds-anneau" width="132" height="132" viewBox="0 0 132 132" role="img" aria-label="${esc(aria)}">
      <circle cx="66" cy="66" r="56" fill="none" stroke="${piste()}" stroke-width="12"/>
      <circle class="arc-remise" cx="66" cy="66" r="56" fill="none" stroke="${couleurRemise}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(f1 * R1).toFixed(1)} ${R1.toFixed(1)}" transform="rotate(-90 66 66)"/>
      <circle cx="66" cy="66" r="40" fill="none" stroke="${piste()}" stroke-width="8"/>
      <circle class="arc-lib" cx="66" cy="66" r="40" fill="none" stroke="${couleurLib}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(f2 * R2).toFixed(1)} ${R2.toFixed(1)}" transform="rotate(-90 66 66)"/>
      <text class="min" x="66" y="64" text-anchor="middle" font-size="24" font-weight="700" fill="currentColor">${esc(minutes ?? '—')}</text>
      <text x="66" y="84" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75">${esc(legende || 'min à la porte')}</text></svg>`;
  }
  /** Carte indicateur (planche 2) : module (point de couleur), valeur 30 px, libellé, détail ; bouton si `aller`. */
  function kpi({ module: mod, couleur, valeur, libelle, detail, aller, alerte, code, info }) {
    const tag = aller ? 'button' : 'div';
    const v = valeur == null || valeur === '' ? '—' : valeur;
    return `<div class="ds-kpi-c" style="position:relative;min-width:0;display:flex"><${tag}${aller ? ` type="button" data-ds-aller="${esc(aller)}"` : ''} class="ds-kpi${alerte ? ' alerte' : ''}" style="--k-couleur:${esc(couleur)};flex:1">
      <span class="ds-kpi-mod">${esc(mod)}</span><span class="ds-kpi-val num">${esc(v)}</span><span class="ds-kpi-lib">${esc(libelle)}</span>${detail ? `<span class="ds-kpi-det">${esc(detail)}</span>` : ''}</${tag}>
      ${code ? `<button type="button" class="ds-kpi-info" data-acc-kpi="${esc(code)}" aria-label="${esc(info || libelle)}" title="${esc(info || libelle)}"><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-info"/></svg></button>` : ''}</div>`;
  }
  /** Barre de capacité réelle (planche 2) : segments { nom, n, couleur, aller? } ; légende sur 3 colonnes. */
  function capacite(segments, total, aria) {
    const t = total || segments.reduce((s, x) => s + (x.n || 0), 0) || 1;
    return `<div class="ds-capacite" role="img" aria-label="${esc(aria)}">${segments.filter((s) => s.n > 0).map((s) => `<span style="width:${((s.n / t) * 100).toFixed(2)}%;background:${s.couleur}" title="${esc(`${s.nom} : ${s.n}`)}"></span>`).join('')}</div>
      <div class="ds-legende">${segments.map((s) => `<${s.aller ? `button type="button" data-ds-aller="${esc(s.aller)}"` : 'div'}><i style="background:${s.couleur}"></i><span>${esc(s.nom)}</span><strong class="num">${esc(s.n ?? '—')}</strong></${s.aller ? 'button' : 'div'}>`).join('')}</div>`;
  }
  /** Progression en 7 étapes (planche 4) : fait = nombre d'étapes franchies ; bloque = étape courante en vigilance. */
  function progres(fait, { bloque = false, noms = [] } = {}) {
    return `<span class="ds-progres" role="img" aria-label="${esc(noms[Math.min(fait, 6)] || '')}">${Array.from({ length: 7 }, (_, i) => `<i class="${i < fait ? 'fait' : i === fait ? (bloque ? 'bloque' : 'cours') : ''}" title="${esc(noms[i] || '')}"></i>`).join('')}</span>`;
  }
  /** Courbe hebdomadaire (planche 3) : points [{ etiquette, valeur }], ligne d'objectif en pointillé vert. */
  function courbe(points, { objectif, couleur = '#BE185D', aria, unite = 'min' } = {}) {
    const pts = points.filter((p) => p.valeur != null);
    if (!pts.length) return '';
    const max = Math.max(30, objectif || 0, ...pts.map((p) => p.valeur)) * 1.1; const x0 = 40; const x1 = 630; const y0 = 150; const y1 = 20;
    const X = (i) => (points.length === 1 ? (x0 + x1) / 2 : x0 + 20 + (i * (x1 - x0 - 30)) / (points.length - 1));
    const Y = (v) => y0 - ((v / max) * (y0 - y1));
    const traits = points.map((p, i) => (p.valeur == null ? null : `${X(i).toFixed(0)},${Y(p.valeur).toFixed(0)}`)).filter(Boolean).join(' ');
    const graduation = [0, Math.round(max / 2 / 5) * 5, Math.round(max / 5) * 5 - 5].filter((v, i, a) => a.indexOf(v) === i);
    const tx = sombre() ? '#A9BAC9' : '#475569'; const ok = sombre() ? '#4ADE80' : '#15803D'; const grille = sombre() ? '#293D4C' : '#D5E0EA';
    return `<svg class="ds-graph" width="100%" height="180" viewBox="0 0 640 180" role="img" aria-label="${esc(aria)}" preserveAspectRatio="none">
      <line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y0}" stroke="${grille}"/>
      ${graduation.map((v) => `<text x="${x0 - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="${tx}">${v}</text>`).join('')}
      ${objectif != null ? `<line x1="${x0}" y1="${Y(objectif)}" x2="${x1}" y2="${Y(objectif)}" stroke="${ok}" stroke-dasharray="5 5"/><text x="${x0 - 6}" y="${Y(objectif) + 4}" text-anchor="end" font-size="11" fill="${ok}">${objectif}</text>` : ''}
      <polyline fill="none" stroke="${couleur}" stroke-width="3" points="${traits}"/>
      ${points.map((p, i) => (p.valeur == null ? '' : `<circle cx="${X(i).toFixed(0)}" cy="${Y(p.valeur).toFixed(0)}" r="4" fill="${couleur}"><title>${esc(`${p.etiquette} : ${p.valeur} ${unite}`)}</title></circle>`)).join('')}
      ${points.map((p, i) => `<text x="${X(i).toFixed(0)}" y="170" text-anchor="middle" font-size="10" fill="${tx}">${esc(p.etiquette)}</text>`).join('')}</svg>`;
  }
  /** Pastille d'état (planche 1, section 4) : ok · vigilance · escalade · critique · inconnu. */
  const pastille = (niveau, texte) => `<span class="ds-etat ${esc(niveau || '')}">${esc(texte)}</span>`;
  /** Lie les boutons data-ds-aller à une fonction d'ouverture d'écran. */
  function lier(racine, ouvrir) { racine.querySelectorAll('[data-ds-aller]').forEach((b) => { b.onclick = () => ouvrir?.(b.dataset.dsAller); }); }
  window.ArrimoDS = { esc, module, etat, piste, anneau, doubleAnneau, kpi, capacite, progres, courbe, pastille, lier, MODULES, sombre };
})();
