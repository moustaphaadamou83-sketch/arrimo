/* Rapports (27 nov. 2026) : barre commune « Imprimer · PDF · CSV · Excel » sur les écrans d'analyse (Performance).
   Les exports reprennent EXACTEMENT les tableaux affichés (mêmes filtres, mêmes chiffres) ; aucun calcul ici.
   PDF : impression du navigateur (« Enregistrer en PDF ») avec une mise en page sans menus ni boutons, en-tête et mention de confidentialité.
   Excel : générateur existant côté serveur, export journalisé. CSV : séparateur « ; », UTF-8 avec BOM. Entretien exclu. */
(() => {
  const VUES = ['indicateurs', 'vigilance', 'donnees', 'chrono', 'c-indicateurs', 'continuite'];
  const T = { fr: { imprimer: 'Imprimer', pdf: 'PDF', csv: 'CSV', excel: 'Excel', aide_pdf: 'Dans la fenêtre d’impression, choisissez « Enregistrer en PDF ».', aucun: 'Aucun tableau à exporter sur cet écran.', confid: 'Confidentiel : usage interne, destinataires autorisés seulement.', genere: 'Généré le {d}', barre: 'Exporter ce rapport' },
    en: { imprimer: 'Print', pdf: 'PDF', csv: 'CSV', excel: 'Excel', aide_pdf: 'In the print dialog, choose “Save as PDF”.', aucun: 'No table to export on this screen.', confid: 'Confidential: internal use, authorised recipients only.', genere: 'Generated {d}', barre: 'Export this report' } };
  const L = () => ((document.documentElement.lang || '').startsWith('en') ? 'en' : 'fr');
  const X = (k, v = {}) => T[L()][k].replace(/\{(\w+)\}/g, (m, y) => v[y] ?? m);
  const section = () => document.getElementById(`v-${window.etat?.vue}`);
  const titre = () => (section()?.querySelector('h2')?.textContent || 'Rapport').replace(/\s+/g, ' ').trim();
  /** Lignes des tableaux visibles de l'écran (titre de chaque tableau puis ses lignes ; texte affiché, sans boutons). */
  function lignes() {
    const s = section(); if (!s) return [];
    const out = [];
    s.querySelectorAll('table').forEach((tb) => {
      if (!tb.offsetParent) return;
      const h = tb.closest('section, .panneau-c, details')?.querySelector('h3, h4, summary')?.textContent?.trim();
      if (out.length) out.push([]);
      if (h) out.push([h]);
      tb.querySelectorAll('tr').forEach((tr) => out.push([...tr.children].map((c) => { const k = c.cloneNode(true); k.querySelectorAll('button, svg').forEach((x) => x.remove()); return k.textContent.replace(/\s+/g, ' ').trim(); })));
    });
    return out;
  }
  const nomFichier = (ext) => `arrimo-${titre().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'rapport'}.${ext}`;
  function telecharger(blob, nom) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nom; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  function csv() {
    const l = lignes(); if (!l.length) return window.toast?.(X('aucun'), true);
    const cel = (v) => { const s = String(v ?? ''); const sur = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s; return /[;"\n]/.test(sur) ? `"${sur.replace(/"/g, '""')}"` : sur; };
    telecharger(new Blob([`﻿${[[`Arrimo — ${titre()}`], [X('genere', { d: new Date().toLocaleString(L() === 'en' ? 'en-CA' : 'fr-CA') })], [X('confid')], [], ...l].map((r) => r.map(cel).join(';')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' }), nomFichier('csv'));
  }
  async function excel() {
    const l = lignes(); if (!l.length) return window.toast?.(X('aucun'), true);
    const r = await fetch('/api/rapports/excel', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${window.etat?.token}` },
      body: JSON.stringify({ etablissement_id: window.etat?.ctx, titre: titre(), lignes: l, langue: L() }) });
    if (!r.ok) return window.toast?.((await r.json().catch(() => ({}))).erreur || 'Excel', true);
    telecharger(await r.blob(), nomFichier('xlsx'));
  }
  function imprimer(pdf) {
    const s = section(); if (!s) return;
    document.body.dataset.impression = 'oui'; s.dataset.imprimer = 'oui';
    s.querySelector('.rapport-entete-impression')?.remove();
    s.insertAdjacentHTML('afterbegin', `<div class="rapport-entete-impression"><img src="/logo.svg" alt="" width="28" height="28"><div><b>Arrimo — ${titre().replace(/</g, '&lt;')}</b><br><span>${(window.etabCtx?.()?.nom || '').replace(/</g, '&lt;')} · ${X('genere', { d: new Date().toLocaleString(L() === 'en' ? 'en-CA' : 'fr-CA') })}</span><br><small>${X('confid')}</small></div></div>`);
    if (pdf) window.toast?.(X('aide_pdf'));
    setTimeout(() => { window.print(); }, pdf ? 400 : 50);
  }
  window.addEventListener('afterprint', () => { delete document.body.dataset.impression; document.querySelectorAll('[data-imprimer]').forEach((s) => { delete s.dataset.imprimer; s.querySelector('.rapport-entete-impression')?.remove(); }); });
  /** Pose la barre sur l'écran courant s'il s'agit d'un écran d'analyse (après chaque rendu). */
  function poser() {
    const vue = window.etat?.vue; const s = section();
    if (!s || !VUES.includes(vue) || window.etat?.moi?.utilisateur?.role === 'entretien' || s.querySelector('.barre-rapport')) return;
    const hote = s.querySelector('.entete') || s;
    hote.insertAdjacentHTML(hote === s ? 'afterbegin' : 'beforeend', `<div class="barre-rapport" role="group" aria-label="${X('barre')}">
      <button type="button" class="btn" data-rapport="imprimer">${X('imprimer')}</button><button type="button" class="btn" data-rapport="pdf">${X('pdf')}</button>
      <button type="button" class="btn" data-rapport="csv">${X('csv')}</button><button type="button" class="btn" data-rapport="excel">${X('excel')}</button></div>`);
  }
  document.addEventListener('click', (ev) => { const b = ev.target.closest('[data-rapport]'); if (!b) return; const a = b.dataset.rapport;
    if (a === 'csv') csv(); else if (a === 'excel') excel(); else imprimer(a === 'pdf'); });
  setInterval(poser, 1000);
  window.ArrimoRapports = { lignes, poser, VUES };
})();
