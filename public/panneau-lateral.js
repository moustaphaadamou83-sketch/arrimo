/* Panneau latéral universel (cahier « interactivité universelle et navigation contextuelle », nº 10 ; maquette validée, planche 4).
   Un seul composant pour tous les modules : il s'ouvre à droite sans quitter l'écran, garde les filtres et le défilement de la vue,
   et réunit Détails, Sillage (parcours et heures), OG (question préremplie avec la référence) et actions rapides.
   Les actions passent par les mêmes routes et les mêmes droits que l'interface : le panneau ne décide rien. FR/EN. */
(() => {
  const TXT = {
    fr: { fermer: 'Fermer', details: 'Détails', sillage: 'Sillage', og: 'OG', actions: 'Actions', og_intro: 'OG répond d’après les mêmes faits et les mêmes droits que cet écran.',
      og_bouton: 'Demander à OG', og_q: 'Où en est {n} et que reste-t-il à faire ?', aucune_action: 'Aucune action rapide disponible pour votre rôle.', sillage_ind: 'Parcours indisponible pour cet élément.', charge: 'Chargement…' },
    en: { fermer: 'Close', details: 'Details', sillage: 'Trail', og: 'OG', actions: 'Actions', og_intro: 'OG answers from the same facts and the same rights as this screen.',
      og_bouton: 'Ask OG', og_q: 'Where is {n} and what remains to be done?', aucune_action: 'No quick action available for your role.', sillage_ind: 'Trail unavailable for this item.', charge: 'Loading…' },
  };
  const lire = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const X = () => TXT[(document.documentElement.lang || lire('arrimo-langue') || 'fr').startsWith('en') ? 'en' : 'fr'];
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let dlg; let courant = null; let retour = null;

  function panneau() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog'); dlg.id = 'panneau-lateral'; dlg.className = 'panneau-lateral'; dlg.setAttribute('aria-labelledby', 'pl-titre');
    document.body.appendChild(dlg);
    dlg.addEventListener('click', async (e) => {
      if (e.target === dlg || e.target.closest('[data-pl-fermer]')) return fermer();
      const o = e.target.closest('[data-pl-onglet]'); if (o) return onglet(o.dataset.plOnglet);
      const a = e.target.closest('[data-pl-action]');
      if (a && courant) {
        const act = courant.actions[Number(a.dataset.plAction)]; a.disabled = true;
        try { const garder = await act.run(); if (garder !== true) fermer(); } finally { a.disabled = false; }
        return;
      }
      const q = e.target.closest('[data-pl-og], [data-sillage-og]');
      if (q) { const n = q.dataset.plOg || q.dataset.sillageOg; fermer(); window.ArrimoSillage?.demanderOg ? window.ArrimoSillage.demanderOg(n) : null; return; }
      const ec = e.target.closest('[data-sillage-ecran]'); if (ec) { fermer(); document.querySelector(`#onglets button[data-v="${ec.dataset.sillageEcran}"]`)?.click(); }
    });
    dlg.addEventListener('close', () => { courant = null; retour?.focus?.(); });
    return dlg;
  }
  function fermer() { if (dlg?.open) dlg.close(); }

  async function onglet(nom) {
    const x = X(); const c = courant; if (!c) return;
    dlg.querySelectorAll('[data-pl-onglet]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.plOnglet === nom)));
    const z = dlg.querySelector('#pl-corps'); z.setAttribute('aria-labelledby', `pl-o-${nom}`);
    if (nom === 'details') z.innerHTML = c.details || '';
    else if (nom === 'sillage') {
      z.innerHTML = `<p class="note">${esc(x.charge)}</p>`;
      try {
        const r = await window.ArrimoSillage.contenu(c.objet, c.id);
        if (courant !== c) return;
        z.innerHTML = r.html.replace(/<header class="sillage-tete">[\s\S]*?<\/header>/, '');
      } catch { z.innerHTML = `<p class="note">${esc(x.sillage_ind)}</p>`; }
    } else if (nom === 'og') {
      z.innerHTML = `<p class="note">${esc(x.og_intro)}</p><button type="button" class="btn pri" data-pl-og="${esc(c.numero)}">${esc(x.og_bouton)}</button>
        <p class="note">« ${esc(x.og_q.replace('{n}', c.numero))} »</p>`;
    } else {
      z.innerHTML = c.actions.length ? `<div class="pl-actions">${c.actions.map((a, i) => `<button type="button" class="btn${a.pri ? ' pri' : ''}" data-pl-action="${i}">${esc(a.label)}</button>`).join('')}</div>`
        : `<p class="note">${esc(x.aucune_action)}</p>`;
    }
  }

  /**
   * Ouvre le panneau. `o` : { titre, sous_titre?, numero, objet?, id?, details (HTML déjà échappé), actions?: [{ label, pri?, run }], onglet? }.
   * Sans `objet`, l'onglet Sillage n'apparaît pas.
   */
  function ouvrir(o) {
    const x = X(); const d = panneau(); retour = document.activeElement;
    courant = { actions: [], ...o };
    const onglets = ['details', ...(o.objet && window.ArrimoSillage ? ['sillage'] : []), 'og', 'actions'];
    d.innerHTML = `<div class="pl-cadre"><header class="pl-tete"><div><h2 id="pl-titre">${esc(o.titre)}</h2>${o.sous_titre ? `<p class="note">${esc(o.sous_titre)}</p>` : ''}</div>
        <button type="button" class="btn" data-pl-fermer>${esc(x.fermer)}</button></header>
      <div class="pl-onglets" role="tablist">${onglets.map((n) => `<button type="button" role="tab" id="pl-o-${n}" data-pl-onglet="${n}" aria-selected="false" aria-controls="pl-corps">${esc(x[n])}</button>`).join('')}</div>
      <div id="pl-corps" class="pl-corps" role="tabpanel" tabindex="0"></div></div>`;
    if (!d.open) d.showModal();
    onglet(onglets.includes(o.onglet) ? o.onglet : 'details');
    d.querySelector('[data-pl-fermer]').focus();
  }

  window.ArrimoPanneau = { ouvrir, fermer, TXT };
})();
