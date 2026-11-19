/* Console SH : heure à jour (fuseau de l'utilisateur, Montréal par défaut) et météo réelle de la ville de référence. */
(function () {
  const CIEL = [[[0], '☀️', '🌙', 'Dégagé', 'Clear'], [[1, 2], '🌤️', '☁️', 'Peu nuageux', 'Partly cloudy'], [[3], '☁️', '☁️', 'Couvert', 'Overcast'],
    [[45, 48], '🌫️', '🌫️', 'Brouillard', 'Fog'], [[51, 53, 55, 56, 57], '🌦️', '🌧️', 'Bruine', 'Drizzle'], [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️', '🌧️', 'Pluie', 'Rain'],
    [[71, 73, 75, 77, 85, 86], '❄️', '❄️', 'Neige', 'Snow'], [[95, 96, 99], '⛈️', '⛈️', 'Orage', 'Thunderstorm']];
  let meteo = null; let lue = 0; let minute = '';
  const en = () => (typeof langueUI !== 'undefined' && langueUI === 'en');
  const fuseau = () => { try { return (etat.moi && etat.moi.utilisateur && etat.moi.utilisateur.fuseau_horaire) || 'America/Toronto'; } catch { return 'America/Toronto'; } };
  // Session complète seulement (écran de l'application affiché, après la double authentification) : avant, /api/meteo répond 403
  const connecte = () => { try { const app = document.getElementById('ecran-app'); return !!etat.token && !!app && !app.hidden; } catch { return false; } };
  function afficher() {
    const z = document.getElementById('infos-siege'); if (!z) return;
    if (!connecte()) { z.hidden = true; return; }
    const L = en() ? 'en-CA' : 'fr-CA'; const tz = fuseau(); const n = new Date();
    let date; let heure;
    try { date = n.toLocaleDateString(L, { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }); heure = n.toLocaleTimeString(L, { hour: '2-digit', minute: '2-digit', timeZone: tz }); }
    catch { date = n.toLocaleDateString(L); heure = n.toLocaleTimeString(L, { hour: '2-digit', minute: '2-digit' }); }
    const c = meteo && meteo.disponible ? CIEL.find(([codes]) => codes.includes(meteo.code)) : null;
    z.textContent = '';
    if (meteo && meteo.disponible) {
      const m = document.createElement('span'); m.className = 'is-meteo'; m.title = `Source : ${meteo.source}`;
      m.textContent = `${c ? (meteo.jour ? c[1] : c[2]) : '🌡️'} ${(Math.round(meteo.temperature) || 0)} °C${c ? ` ${en() ? c[4] : c[3]}` : ''}`;
      z.appendChild(m);
    }
    for (const [cls, txt] of [['is-lieu', (meteo && meteo.ville) || 'Montréal'], ['is-date', date], ['is-heure num', heure]]) {
      const s = document.createElement('span'); s.className = cls; s.textContent = txt; z.appendChild(s);
    }
    z.hidden = false;
  }
  async function lire(forcer) {
    if (!connecte() || (!forcer && Date.now() - lue < 10 * 60 * 1000)) return;
    lue = Date.now();
    try { meteo = await api('GET', '/meteo'); } catch { /* l'heure et la date restent affichées */ }
    afficher();
  }
  setInterval(() => { const m = new Date().toISOString().slice(0, 16); const visible = !document.getElementById('infos-siege')?.hidden; if (m !== minute || !visible) { minute = m; afficher(); } lire(false); }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { afficher(); lire(false); } });
})();
