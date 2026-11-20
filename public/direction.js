/* Direction régionale (20 nov. 2026) : lecture de sa région seulement — données et listes d'attente, centrale des transferts urgents,
   demandes en retard, établissements. Aucun lit, patient ni résident. */
(() => {
  const TXT = {
    fr: { sous: 'Direction régionale', sortir: 'Se déconnecter', o_donnees: 'Données', o_transferts: 'Transferts urgents', o_demandes: 'Demandes', o_region: 'Région',
      centrale_vide: 'Aucun transfert urgent en cours.', attente: 'demandé il y a {n} min', retard: '{n} demandes en attente au-delà de leur échéance', circuit: 'Circuit', total: 'Total', en_retard: 'En retard',
      etablissements: 'Établissements', organisations: 'Organisations de secours', c: { transfert: 'Transferts', hebergement: 'Hébergement', transport: 'Transports', prealerte: 'Préalertes', mission_ccs: 'Missions CCS' } },
    en: { sous: 'Regional directorate', sortir: 'Sign out', o_donnees: 'Data', o_transferts: 'Urgent transfers', o_demandes: 'Requests', o_region: 'Region',
      centrale_vide: 'No urgent transfer in progress.', attente: 'requested {n} min ago', retard: '{n} requests waiting past their due time', circuit: 'Flow', total: 'Total', en_retard: 'Overdue',
      etablissements: 'Facilities', organisations: 'Emergency organizations', c: { transfert: 'Transfers', hebergement: 'Placement', transport: 'Transport', prealerte: 'Pre-alerts', mission_ccs: 'CCS missions' } },
  };
  const lire = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  let L = lire('arrimo-langue') === 'en' ? 'en' : 'fr'; const jeton = lire('arrimo-token'); let onglet = 'donnees';
  const e = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = (k, v = {}) => e(String(TXT[L][k]).replace(/\{(\w+)\}/g, (m, x) => v[x] ?? m));
  async function api(methode, chemin) {
    const r = await fetch(`/api${chemin}`, { method: methode, headers: { Authorization: `Bearer ${jeton}`, 'X-Langue': L } });
    if (r.status === 401) { location.replace('/'); throw new Error('session'); }
    const d = await r.json().catch(() => null); if (!r.ok || d === null) throw new Error((d && d.erreur) || `Erreur ${r.status}`); return d;
  }
  async function rendre() {
    document.documentElement.lang = L === 'en' ? 'en-CA' : 'fr-CA';
    document.querySelectorAll('[data-dr-langue]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.drLangue === L)));
    document.getElementById('dr-sous').textContent = TXT[L].sous; document.getElementById('dr-sortir').textContent = TXT[L].sortir;
    document.getElementById('dr-onglets').innerHTML = ['donnees', 'transferts', 'demandes', 'region'].map((o) => `<button role="tab" type="button" data-dr-onglet="${o}" aria-selected="${o === onglet}">${T(`o_${o}`)}</button>`).join('');
    const m = document.getElementById('dr-contenu');
    try {
      if (onglet === 'donnees') return window.ArrimoDonnees.afficher(m, { api, langue: L });
      if (onglet === 'transferts') {
        const c = await api('GET', '/transferts-suivi/centrale');
        m.innerHTML = `<h2>${T('o_transferts')}</h2>${c.transferts.length ? `<ul class="liste-simple">${c.transferts.map((x) => `<li><strong>${e(x.numero)}</strong> · ${e(x.origine)} → ${e(x.destination)} · ${T('attente', { n: x.attente_min })}</li>`).join('')}</ul>` : `<p class="note">${T('centrale_vide')}</p>`}`;
      } else if (onglet === 'demandes') {
        const s = await api('GET', '/demandes/synthese');
        m.innerHTML = `<h2>${T('o_demandes')}</h2><p>${T('retard', { n: s.en_retard })}</p><div class="tableau"><table><thead><tr><th>${T('circuit')}</th><th>${T('total')}</th><th>${T('en_retard')}</th></tr></thead><tbody>
          ${Object.entries(s.par_circuit).map(([k, v]) => `<tr><td>${e(TXT[L].c[k] || k)}</td><td>${v.total}</td><td>${v.en_retard}</td></tr>`).join('')}</tbody></table></div>`;
      } else {
        const r = await api('GET', '/direction/region');
        m.innerHTML = `<h2>${e(r.directions.map((d) => `${d.nom} · ${L === 'en' ? d.region_nom_en : d.region_nom}`).join(' / '))}</h2><h3>${T('etablissements')}</h3><ul class="liste-simple">${r.etablissements.map((x) => `<li>${e(x.nom)}${x.ville ? ` · ${e(x.ville)}` : ''}</li>`).join('')}</ul>
          <h3>${T('organisations')}</h3><ul class="liste-simple">${r.organisations.map((x) => `<li>${e(x.nom)}</li>`).join('')}</ul>`;
      }
    } catch (err) { m.innerHTML = `<p class="note" role="alert">${e(err.message)}</p>`; }
  }
  document.addEventListener('click', async (ev) => {
    const o = ev.target.closest('[data-dr-onglet]'); if (o) { onglet = o.dataset.drOnglet; rendre(); return; }
    const l = ev.target.closest('[data-dr-langue]'); if (l) { L = l.dataset.drLangue; try { localStorage.setItem('arrimo-langue', L); } catch { /* */ } rendre(); return; }
    if (ev.target.id === 'dr-sortir') { await fetch('/api/deconnexion', { method: 'POST', headers: { Authorization: `Bearer ${jeton}` } }).catch(() => {}); try { localStorage.removeItem('arrimo-token'); } catch { /* */ } location.replace('/'); }
  });
  if (!jeton) location.replace('/'); else rendre();
})();
