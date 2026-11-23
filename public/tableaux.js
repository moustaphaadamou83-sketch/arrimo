/* Tableaux de niveau ERP (cahier « Professionnalisation ERP », section 4) : recherche, tri par colonne (clic ou clavier, aria-sort) et
   pagination pour les grands tableaux (12 lignes et plus). Le contenu, les colonnes et les actions de chaque tableau ne changent pas.
   Un tableau peut refuser l'amélioration avec data-erp="non". FR/EN. */
(() => {
  const SEUIL = 12; const PAGE = 50;
  const en = () => (document.documentElement.lang || '').startsWith('en');
  const X = () => (en() ? { chercher: 'Search this table', lignes: '{n} rows', page: 'Page {p} of {t}', prec: 'Previous', suiv: 'Next', trier: 'Sort by {c}' }
    : { chercher: 'Rechercher dans ce tableau', lignes: '{n} lignes', page: 'Page {p} sur {t}', prec: 'Précédente', suiv: 'Suivante', trier: 'Trier par {c}' });
  const f = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
  const valeur = (td) => { const t = (td?.dataset.erpValeur || td?.textContent || '').trim(); const n = Number(t.replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '')); return /^[\s\d.,%-]+$/.test(t) && t && !Number.isNaN(n) ? n : t.toLowerCase(); };
  function ameliorer(table) {
    if (table.dataset.erp) return; const tb = table.tBodies[0]; if (!tb || !tb.rows.length || (tb.rows.length < SEUIL && !table.hasAttribute('data-transferts-commun'))) return;
    table.dataset.erp = 'oui';
    const etat = { q: '', page: 1, col: -1, sens: 1 };
    const barre = document.createElement('div'); barre.className = 'erp-barre';
    const id = `erp-${Math.random().toString(36).slice(2, 8)}`;
    barre.innerHTML = `<label class="sr-only" for="${id}">${X().chercher}</label><input id="${id}" type="search" class="erp-recherche" placeholder="${X().chercher}">
      <span class="note erp-compte" aria-live="polite"></span><span class="erp-pages"></span>`;
    (table.closest('.tableau') || table).before(barre);
    const entetes = [...(table.tHead?.rows[0]?.cells || [])];
    entetes.forEach((th, i) => {
      if (!th.textContent.trim()) return;
      th.tabIndex = 0; th.classList.add('erp-triable'); th.setAttribute('aria-sort', 'none'); th.title = f(X().trier, { c: th.textContent.trim() });
      const trier = () => { etat.sens = etat.col === i ? -etat.sens : 1; etat.col = i; appliquer(true); };
      th.addEventListener('click', trier); th.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); trier(); } });
    });
    function appliquer(retrier) {
      const lignes = [...tb.rows];
      if (retrier && etat.col >= 0) {
        lignes.sort((a, b) => { const x = valeur(a.cells[etat.col]); const y = valeur(b.cells[etat.col]); return (x > y ? 1 : x < y ? -1 : 0) * etat.sens; }).forEach((r) => tb.appendChild(r));
        entetes.forEach((th, i) => th.getAttribute('aria-sort') !== null && th.setAttribute('aria-sort', i === etat.col ? (etat.sens > 0 ? 'ascending' : 'descending') : 'none'));
      }
      const q = etat.q.toLowerCase(); const visibles = [...tb.rows].filter((r) => !q || r.textContent.toLowerCase().includes(q));
      const total = Math.max(1, Math.ceil(visibles.length / PAGE)); if (etat.page > total) etat.page = total;
      [...tb.rows].forEach((r) => { r.hidden = true; });
      visibles.slice((etat.page - 1) * PAGE, etat.page * PAGE).forEach((r) => { r.hidden = false; });
      barre.querySelector('.erp-compte').textContent = f(X().lignes, { n: visibles.length });
      const p = barre.querySelector('.erp-pages');
      p.innerHTML = total > 1 ? `<button type="button" class="btn" data-erp-p="-1"${etat.page === 1 ? ' disabled' : ''}>${X().prec}</button><span class="note">${f(X().page, { p: etat.page, t: total })}</span><button type="button" class="btn" data-erp-p="1"${etat.page === total ? ' disabled' : ''}>${X().suiv}</button>` : '';
      p.querySelectorAll('[data-erp-p]').forEach((b) => { b.onclick = () => { etat.page += Number(b.dataset.erpP); appliquer(); }; });
    }
    barre.querySelector('input').addEventListener('input', (ev) => { etat.q = ev.target.value; etat.page = 1; appliquer(); });
    appliquer();
  }
  const balayer = () => document.querySelectorAll('.tableau > table:not([data-erp]), table.erp:not([data-erp])').forEach(ameliorer);
  let t = null; new MutationObserver(() => { clearTimeout(t); t = setTimeout(balayer, 120); }).observe(document.body, { childList: true, subtree: true });
  setTimeout(balayer, 500);
  window.ArrimoTableaux = { ameliorer, balayer };
})();
