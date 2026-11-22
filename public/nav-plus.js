/* Barre d'onglets (22 nov. 2026) : sur ordinateur et tablette, les onglets qui ne tiennent pas passent dans un menu « Plus »,
   rangés sous leur groupe (Opérations, Pilotage, Gestion…). L'onglet ouvert reste toujours dans la barre. Le contenu des pages
   ne change pas : un choix du menu clique simplement l'onglet d'origine. Téléphone (tiroir) et barre verticale : tout reste listé. */
(() => {
  const nav = document.getElementById('onglets'); if (!nav) return;
  const tr = (k, d) => { try { return (typeof t === 'function' && t(k)) || d; } catch { return d; } };
  const etroit = window.matchMedia('(max-width: 600px)');
  let plus; let menu; let attente = 0; let occupe = false; let dernierMenu = ''; let derniereTete = '';
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function creer() {
    plus = document.createElement('button'); plus.type = 'button'; plus.id = 'b-onglets-plus'; plus.className = 'onglets-plus'; plus.hidden = true;
    plus.setAttribute('aria-haspopup', 'menu'); plus.setAttribute('aria-expanded', 'false');
    nav.appendChild(plus);
    menu = document.createElement('div'); menu.id = 'menu-onglets-plus'; menu.className = 'menu-onglets-plus'; menu.setAttribute('role', 'menu'); menu.hidden = true;
    document.body.appendChild(menu);
    plus.addEventListener('click', (e) => { e.stopPropagation(); basculer(menu.hidden); });
    menu.addEventListener('click', (e) => { const b = e.target.closest('[data-proxy]'); if (!b) return; basculer(false); nav.querySelector(`button[role="tab"][data-v="${b.dataset.proxy}"]`)?.click(); });
    document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) basculer(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { basculer(false); plus.focus(); } });
  }
  function basculer(ouvrir) {
    menu.hidden = !ouvrir; plus.setAttribute('aria-expanded', String(!!ouvrir));
    if (ouvrir) { const r = plus.getBoundingClientRect(); menu.style.top = `${Math.round(r.bottom + window.scrollY + 4)}px`; menu.style.right = `${Math.max(8, Math.round(document.documentElement.clientWidth - r.right))}px`; menu.querySelector('button')?.focus(); }
  }
  const onglets = () => [...nav.querySelectorAll('button[role="tab"]')];
  function ajuster() {
    if (occupe) return; occupe = true;
    try {
      if (!plus) creer();
      const ouvert = !menu.hidden;
      onglets().forEach((b) => b.classList.remove('hors-barre'));
      nav.querySelectorAll('.onglets-groupe').forEach((g) => g.classList.remove('hors-barre'));
      plus.hidden = true;
      // Navigation par espaces (cahier directeur) : les espaces remplacent le menu « Plus »
      if (nav.classList.contains('avec-espaces') || etroit.matches || document.body.classList.contains('nav-verticale') || nav.scrollWidth <= nav.clientWidth + 1) { basculer(false); return; }
      plus.hidden = false;
      const visibles = onglets().filter((b) => !b.hidden);
      for (let i = visibles.length - 1; i >= 0 && nav.scrollWidth > nav.clientWidth + 1; i -= 1) {
        if (visibles[i].getAttribute('aria-selected') === 'true') continue;
        visibles[i].classList.add('hors-barre');
      }
      // Un intitulé de groupe dont plus aucun onglet n'est dans la barre passe aussi dans le menu
      const elems = [...nav.children];
      elems.forEach((g, i) => {
        if (!g.classList.contains('onglets-groupe') || g.hidden) return;
        let j = i + 1; let reste = false;
        while (j < elems.length && !elems[j].classList.contains('onglets-groupe')) { if (elems[j].matches?.('button[role="tab"]') && !elems[j].hidden && !elems[j].classList.contains('hors-barre')) reste = true; j += 1; }
        if (!reste) g.classList.add('hors-barre');
      });
      // Menu : onglets hors barre, sous l'intitulé de leur groupe
      let groupe = ''; const sections = [];
      for (const el of elems) {
        if (el.classList.contains('onglets-groupe') && !el.hidden) groupe = el.textContent.trim();
        if (el.matches?.('button[role="tab"]') && !el.hidden && !el.classList.contains('hors-menu') && el.classList.contains('hors-barre')) {
          let s = sections.at(-1); if (!s || s.groupe !== groupe) sections.push(s = { groupe, items: [] });
          s.items.push({ v: el.dataset.v, libelle: el.textContent.trim().replace(/\s+/g, ' ') });
        }
      }
      const tete = `<span>${esc(tr('nav.plus', 'Plus'))}</span><svg class="ic" aria-hidden="true" focusable="false"><use href="icones.svg#i-chevron-down"/></svg>`;
      if (derniereTete !== tete) { plus.innerHTML = tete; derniereTete = tete; }
      plus.setAttribute('aria-label', `${tr('nav.plus', 'Plus')} · ${tr('nav.plus_aide', '')}`);
      // Menu reconstruit seulement si son contenu change : un compteur qui bouge ne ferme pas un menu ouvert
      const contenu = sections.map((s) => `${s.groupe ? `<div class="mop-groupe" role="presentation">${esc(s.groupe)}</div>` : ''}${s.items.map((i) => `<button type="button" role="menuitem" data-proxy="${esc(i.v)}">${esc(i.libelle)}</button>`).join('')}`).join('');
      if (dernierMenu !== contenu) { menu.innerHTML = contenu; dernierMenu = contenu; }
      if (!sections.length) { plus.hidden = true; basculer(false); } else if (ouvert) menu.hidden = false;
      nav.scrollLeft = 0;
    } finally { occupe = false; }
  }
  const planifier = () => { cancelAnimationFrame(attente); attente = requestAnimationFrame(ajuster); };
  new MutationObserver((ms) => { if (ms.some((m) => m.target !== plus && !plus?.contains(m.target))) planifier(); })
    .observe(nav, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'aria-selected'], characterData: true });
  window.addEventListener('resize', planifier); etroit.addEventListener?.('change', planifier);
  new MutationObserver(planifier).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.ArrimoNavPlus = { ajuster };
  planifier();
})();
