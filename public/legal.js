'use strict';
(function () {
  const DATE = '2026-10-16';
  const PAGES = { '/confidentialite': ['confidentialite', 'fr'], '/privacy': ['confidentialite', 'en'], '/conditions': ['conditions', 'fr'], '/terms': ['conditions', 'en'] };
  const [page, langueUrl] = PAGES[location.pathname.replace(/\/$/, '')] || ['confidentialite', 'fr'];
  const lire = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const ecrire = (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };
  const params = new URLSearchParams(location.search);
  let langue = ['fr', 'en'].includes(params.get('langue')) ? params.get('langue') : (lire('arrimo-langue') || langueUrl);
  if (!['fr', 'en'].includes(langue)) langue = 'fr';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let champs = {}; let env = null;

  function afficher() {
    const L = window.ARRIMO_LEGAL[langue];
    const I = window.ARRIMO_I18N[langue];
    const remplir = (texte) => esc(texte).replace(/\{(\w+)\}/g, (m, k) => (champs[k]
      ? esc(champs[k]) : `<span class="a-remplir">${esc(L.a_remplir)}</span>`));
    document.documentElement.lang = I.langue.locale;
    document.title = `${L[page].titre} · Arrimo`;
    document.getElementById('avertissement').textContent = L.avertissement;
    document.getElementById('titre').textContent = L[page].titre;
    document.getElementById('mise-a-jour').textContent = L.mise_a_jour.replace('{date}', new Date(`${DATE}T12:00:00`).toLocaleDateString(I.langue.locale, { year: 'numeric', month: 'long', day: 'numeric' }));
    document.getElementById('corps').innerHTML = L[page].sections.map(([titre, paras]) => `<section><h2>${esc(titre)}</h2>${paras.map((p) => `<p>${remplir(p)}</p>`).join('')}</section>`).join('');
    document.getElementById('lien-retour').textContent = L.retour;
    const autre = page === 'confidentialite' ? 'conditions' : 'confidentialite';
    const lien = document.getElementById('lien-autre');
    lien.textContent = L.autre_page[page];
    lien.href = `/${autre}`;
    const bd = document.getElementById('bandeau-demo');
    bd.textContent = env === 'recette' ? I.barre.recette : I.barre.demo;
    bd.classList.toggle('recette', env === 'recette');
    bd.hidden = !['demo', 'recette'].includes(env);
    const s = document.getElementById('langue-legale');
    s.innerHTML = ['fr', 'en'].map((l) => `<option value="${l}">${esc(window.ARRIMO_I18N[l].langue.court)} · ${esc(window.ARRIMO_I18N[l].langue.nom)}</option>`).join('');
    s.setAttribute('aria-label', I.langue.choisir);
    s.value = langue;
  }
  document.getElementById('langue-legale').onchange = (e) => { langue = e.target.value; ecrire('arrimo-langue', langue); afficher(); };
  afficher();
  fetch('/api/public').then((r) => r.json()).then((p) => { champs = p.legal || {}; env = p.environnement; afficher(); }).catch(() => {});
}());
