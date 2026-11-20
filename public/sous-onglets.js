/* Sous-onglets des modules (22 nov. 2026) : chaque écran de module est rangé en sous-onglets (ex. Chrono : En direct · Rapport).
   Le contenu ne change pas : les blocs existants sont seulement montrés par groupe. Choix mémorisé par écran ; FR/EN ; clavier. */
(() => {
  // Index = position parmi les enfants directs de l'écran, sans l'en-tête (.entete) ni la barre ; non listé = toujours visible
  const CONFIG = {
    chrono: [['direct', 'En direct', 'Live', [1, 2, 3]], ['rapport', 'Rapport et écarts', 'Report and gaps', [4, 5]]],
    secours: [['prealertes', 'Préalertes', 'Pre-alerts', [3, 4]], ['urgence', 'Statut et fermetures', 'Status and closures', [1, 2]]],
    bourse: [['places', 'Places', 'Places', [0, 1]], ['fiche', 'Fiche de transfert', 'Transfer sheet', [2]], ['invites', 'Accès invités', 'Guest access', [3]]],
    donnees: [['tableau', 'Tableau régional', 'Regional table', [0]], ['attente', 'Listes d’attente', 'Waiting lists', [1]], ['refus', 'Refus par motif', 'Declines by reason', [2]]],
    vigilance: [['alertes', 'Blocages et alertes', 'Blocks and alerts', [3]], ['parcours', 'Parcours à surveiller', 'Paths to watch', [0]], ['conges', 'Congés prévus', 'Planned discharges', [1, 2]]],
    visites: [['horaire', 'Horaire', 'Schedule', [0]], ['rapport', 'Rapport mensuel', 'Monthly report', [1]]],
    eviter: [['appel', 'Avant l’appel', 'Before calling', [0, 1]], ['regler', 'Régler la liste', 'Set the list', [2]]],
  };
  const choix = {};
  const langue = () => { try { return localStorage.getItem('arrimo-langue') === 'en' ? 1 : 0; } catch { return 0; } };
  const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function appliquer(vue) {
    const v = document.getElementById(`v-${vue}`); const conf = CONFIG[vue]; if (!v || !conf) return;
    const blocs = [...v.children].filter((e) => !e.classList.contains('entete') && !e.classList.contains('sous-onglets'));
    const groupes = conf.map(([cle, fr, en, idx]) => ({ cle, libelle: langue() ? en : fr, elems: idx.map((i) => blocs[i]).filter(Boolean) })).filter((g) => g.elems.length);
    let barre = v.querySelector(':scope > .sous-onglets');
    if (groupes.length < 2) { barre?.remove(); blocs.forEach((e) => { e.hidden = false; }); return; }
    const actif = groupes.some((g) => g.cle === choix[vue]) ? choix[vue] : groupes[0].cle;
    const html = groupes.map((g) => `<button type="button" role="tab" data-so="${g.cle}" aria-selected="${g.cle === actif}" tabindex="${g.cle === actif ? 0 : -1}">${esc(g.libelle)}</button>`).join('');
    if (!barre) { barre = document.createElement('div'); barre.className = 'sous-onglets'; barre.setAttribute('role', 'tablist'); const e = v.querySelector(':scope > .entete'); if (e) e.after(barre); else v.prepend(barre); }
    if (barre.innerHTML !== html) barre.innerHTML = html;
    const dans = new Set(groupes.flatMap((g) => g.elems));
    for (const g of groupes) for (const e of g.elems) e.hidden = g.cle !== actif;
    blocs.forEach((e) => { if (!dans.has(e)) e.hidden = false; });
  }
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('.sous-onglets [data-so]'); if (!b) return;
    const vue = b.closest('section[id^="v-"]')?.id.slice(2); if (!vue) return;
    choix[vue] = b.dataset.so; appliquer(vue); b.closest('.sous-onglets').querySelector(`[data-so="${b.dataset.so}"]`)?.focus();
  });
  document.addEventListener('keydown', (ev) => {
    const b = ev.target.closest?.('.sous-onglets [data-so]'); if (!b || !['ArrowRight', 'ArrowLeft'].includes(ev.key)) return;
    const l = [...b.parentElement.children]; const n = l[(l.indexOf(b) + (ev.key === 'ArrowRight' ? 1 : l.length - 1)) % l.length]; n.click();
  });
  const attentes = {};
  for (const vue of Object.keys(CONFIG)) {
    const v = document.getElementById(`v-${vue}`); if (!v) continue;
    new MutationObserver(() => { cancelAnimationFrame(attentes[vue]); attentes[vue] = requestAnimationFrame(() => appliquer(vue)); }).observe(v, { childList: true });
  }
  window.ArrimoSousOnglets = { appliquer, CONFIG };
})();
