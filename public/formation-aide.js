/* Aide en contexte (22 nov. 2026, module Formation) : un bouton « ? » dans l'en-tête de chaque écran ouvre la capsule de cet écran.
   Rien n'apparaît si la formation n'est pas activée ou si aucune capsule ne couvre l'écran. */
(() => {
  let carte = null; let charge = false;
  const lire = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function charger() {
    if (charge) return; charge = true;
    try { const r = await fetch('/api/formation/aide', { headers: { Authorization: `Bearer ${lire('arrimo-token')}`, 'X-Langue': lire('arrimo-langue') === 'en' ? 'en' : 'fr' } }); carte = r.ok ? await r.json() : {}; } catch { carte = {}; }
    poser();
  }
  function poser() {
    if (!carte) return;
    const en = lire('arrimo-langue') === 'en';
    document.querySelectorAll('.contenu > section[id^="v-"]:not([hidden])').forEach((v) => {
      const c = carte[v.id.slice(2)]; const h = v.querySelector('.entete h2, h2'); if (!c || !h || h.querySelector('.aide-capsule')) return;
      const libelle = `${en ? 'Lesson' : 'Capsule'} : ${c.titre} (${Math.max(1, Math.round(c.duree / 60))} min)`;
      h.insertAdjacentHTML('beforeend', ` <a class="aide-capsule" href="/formation#capsule/${esc(c.code)}" title="${esc(libelle)}" aria-label="${esc(libelle)}">?</a>`);
    });
  }
  const contenu = document.querySelector('.contenu');
  if (contenu) new MutationObserver(() => { if (carte) poser(); else if (lire('arrimo-token')) charger(); }).observe(contenu, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('arrimo:session-reset', () => { carte = null; charge = false; });
})();
