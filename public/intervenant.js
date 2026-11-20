/* Intervenant d'un prestataire (CLSC, entreprise de soins à domicile), 21 nov. 2026 : ses visites seulement (référence du résident,
   résidence, type, plage) ; « Je suis arrivé » et « Je pars » au clic, ou par la position avec son accord explicite, pendant la plage,
   autour de la résidence (position jamais conservée). */
(() => {
  const TXT = {
    fr: { sous: 'Mes visites', sortir: 'Se déconnecter', o_jour: 'Mes visites', o_rapport: 'Rapport du mois', aucune: 'Aucune visite prévue.', arrive: 'Je suis arrivé', part: 'Je pars',
      position: 'Utiliser ma position pendant la plage de visite (jamais conservée)', fait: 'Enregistré.', prevues: '{prevues} prévues · {faites} faites · {manquees} manquées',
      s: { prevue: 'Prévue', en_cours: 'En cours', terminee: 'Faite', manquee: 'Manquée', annulee: 'Annulée' },
      t: { aide_hygiene: 'Aide à l’hygiène', soins_infirmiers: 'Soins infirmiers', medication: 'Médication', readaptation: 'Réadaptation', autre: 'Autre' } },
    en: { sous: 'My visits', sortir: 'Sign out', o_jour: 'My visits', o_rapport: 'Month report', aucune: 'No visit planned.', arrive: 'I have arrived', part: 'I am leaving',
      position: 'Use my position during the visit time slot (never kept)', fait: 'Recorded.', prevues: '{prevues} planned · {faites} done · {manquees} missed',
      s: { prevue: 'Planned', en_cours: 'In progress', terminee: 'Done', manquee: 'Missed', annulee: 'Cancelled' },
      t: { aide_hygiene: 'Hygiene assistance', soins_infirmiers: 'Nursing care', medication: 'Medication', readaptation: 'Rehabilitation', autre: 'Other' } },
  };
  const lire = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  let L = lire('arrimo-langue') === 'en' ? 'en' : 'fr'; const jeton = lire('arrimo-token'); let onglet = 'jour'; let message = '';
  const e = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = (k, v = {}) => e(String(TXT[L][k]).replace(/\{(\w+)\}/g, (m, x) => v[x] ?? m));
  const h = (d) => new Date(d).toLocaleString(L === 'en' ? 'en-CA' : 'fr-CA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  async function api(methode, chemin, corps) {
    const r = await fetch(`/api${chemin}`, { method: methode, headers: { Authorization: `Bearer ${jeton}`, 'X-Langue': L, 'Content-Type': 'application/json' }, body: corps ? JSON.stringify(corps) : undefined });
    if (r.status === 401) { location.replace('/'); throw new Error('session'); }
    const d = await r.json().catch(() => null); if (!r.ok || d === null) throw new Error((d && d.erreur) || `Erreur ${r.status}`); return d;
  }
  const position = () => new Promise((ok) => { if (!navigator.geolocation) return ok(null); navigator.geolocation.getCurrentPosition((p) => ok(p), () => ok(null), { enableHighAccuracy: true, timeout: 10000 }); });
  async function rendre() {
    document.documentElement.lang = L === 'en' ? 'en-CA' : 'fr-CA';
    document.querySelectorAll('[data-iv-langue]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ivLangue === L)));
    document.getElementById('iv-sous').textContent = TXT[L].sous; document.getElementById('iv-sortir').textContent = TXT[L].sortir;
    document.getElementById('iv-onglets').innerHTML = ['jour', 'rapport'].map((o) => `<button role="tab" type="button" data-iv-onglet="${o}" aria-selected="${o === onglet}">${T(`o_${o}`)}</button>`).join('');
    const m = document.getElementById('iv-contenu');
    try {
      if (onglet === 'rapport') { const r = await api('GET', '/visites/rapport'); m.innerHTML = `<h2>${T('o_rapport')}</h2><p>${T('prevues', r.total)}</p>`; return; }
      const v = await api('GET', '/visites?jours=2');
      m.innerHTML = `${message ? `<p class="bandeau" role="status">${e(message)}</p>` : ''}<label class="case"><input type="checkbox" id="iv-pos"${lire('arrimo-visites-position') === '1' ? ' checked' : ''}> ${T('position')}</label>
        ${v.length ? v.map((x) => `<article class="panneau-c"><h3>${e(h(x.debut_prevu))} · ${e(x.residence)}</h3><p>${e(x.resident_ref)} · ${e(TXT[L].t[x.type_visite])} · <strong>${e(TXT[L].s[x.statut])}</strong></p>
          ${['prevue', 'manquee'].includes(x.statut) ? `<button class="btn pri" data-iv="arrivee" data-id="${x.id}">${T('arrive')}</button>` : ''}${x.statut === 'en_cours' ? `<button class="btn pri" data-iv="depart" data-id="${x.id}">${T('part')}</button>` : ''}</article>`).join('') : `<p class="note">${T('aucune')}</p>`}`;
    } catch (err) { m.innerHTML = `<p class="note" role="alert">${e(err.message)}</p>`; }
  }
  document.addEventListener('change', (ev) => { if (ev.target.id === 'iv-pos') { try { localStorage.setItem('arrimo-visites-position', ev.target.checked ? '1' : '0'); } catch { /* */ } } });
  document.addEventListener('click', async (ev) => {
    const o = ev.target.closest('[data-iv-onglet]'); if (o) { onglet = o.dataset.ivOnglet; rendre(); return; }
    const l = ev.target.closest('[data-iv-langue]'); if (l) { L = l.dataset.ivLangue; try { localStorage.setItem('arrimo-langue', L); } catch { /* */ } rendre(); return; }
    const b = ev.target.closest('[data-iv]');
    if (b) {
      b.disabled = true; const corps = { etape: b.dataset.iv };
      if (document.getElementById('iv-pos')?.checked) { const p = await position(); if (p) Object.assign(corps, { latitude: p.coords.latitude, longitude: p.coords.longitude, horodatage: new Date(p.timestamp).toISOString(), consentement: true }); }
      try { await api('POST', `/visites/${b.dataset.id}/pointer`, corps); message = TXT[L].fait; }
      catch (err) { if (corps.latitude != null) { try { await api('POST', `/visites/${b.dataset.id}/pointer`, { etape: corps.etape }); message = TXT[L].fait; } catch (e2) { message = e2.message; } } else message = err.message; }
      rendre(); return;
    }
    if (ev.target.id === 'iv-sortir') { await fetch('/api/deconnexion', { method: 'POST', headers: { Authorization: `Bearer ${jeton}` } }).catch(() => {}); try { localStorage.removeItem('arrimo-token'); } catch { /* */ } location.replace('/'); }
  });
  if (!jeton) location.replace('/'); else rendre();
})();
