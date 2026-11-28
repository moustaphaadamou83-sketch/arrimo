/* OG proactif (28 nov. 2026) : panneau commun à tous les Accueils. Faits, prévisions et inconnus distingués ; mêmes droits que le serveur.
   Le bouton flottant OG reste le composant commun existant (aucun second composant OG). */
(() => {
  const TXT = { fr: { titre: 'OG signale', fait: 'Fait', prevision: 'Prévision', inconnu: 'Inconnu', aucun: 'Rien à signaler pour le moment.', ouvrir: 'Ouvrir', note: 'OG propose ; une personne décide.' },
    en: { titre: 'OG reports', fait: 'Fact', prevision: 'Forecast', inconnu: 'Unknown', aucun: 'Nothing to report right now.', ouvrir: 'Open', note: 'OG suggests; a person decides.' } };
  const e = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const X = () => TXT[(document.documentElement.lang || '').startsWith('en') ? 'en' : 'fr'];
  async function panneau(zone, o) {
    if (!zone) return;
    let d; try { d = await o.api('GET', `/og/proactif?etablissement_id=${o.etablissement_id}`); } catch { zone.remove(); return; }
    zone.innerHTML = `<section class="panneau-c og-proactif"><h3><img src="/og-robot.svg" alt="" width="22" height="22"> ${X().titre}</h3>
      ${d.points.length ? `<ul class="og-points">${d.points.map((p) => `<li class="og-p n-${e(p.niveau)}"><span class="og-type">${e(X()[p.type] || p.type)}</span><span>${e(p.texte)}</span>${p.aller ? `<button type="button" class="btn" data-og-aller="${e(p.aller)}">${X().ouvrir}</button>` : ''}</li>`).join('')}</ul>` : `<p class="note">${X().aucun}</p>`}
      <p class="note">${X().note}</p></section>`;
    zone.querySelectorAll('[data-og-aller]').forEach((b) => { b.onclick = () => (b.dataset.ogAller === 'mes-taches' && window.ArrimoMesTaches?.ouvrirListe ? window.ArrimoMesTaches.ouvrirListe(o) : o.ouvrir?.(b.dataset.ogAller)); });
  }
  window.ArrimoOgProactif = { panneau };
})();
