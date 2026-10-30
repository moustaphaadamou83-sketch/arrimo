/* Apparence d'Arrimo (hospitalier et console SH) : clair, sombre, automatique (préférence du système) ou soleil
   (sombre entre le coucher et le lever du soleil au lieu indiqué). La préférence est enregistrée par utilisateur
   côté serveur ; ce script la met en cache localement pour l'appliquer dès le chargement, sans éclair blanc. */
(function (racine) {
  const MODES = ['clair', 'sombre', 'automatique', 'soleil'];
  const CLE = 'arrimo-apparence';
  const CLE_LIEU = 'arrimo-apparence-lieu';
  const RAD = Math.PI / 180;

  /** Lever et coucher du soleil (équation solaire, précision de quelques minutes) pour le jour de `date`. */
  function soleil(date, latitude, longitude) {
    const jour = Math.floor(date.getTime() / 86400000 + 2440587.5 - 2451545 + 0.0008 + 0.5);
    const jEtoile = jour - longitude / 360;
    const m = (357.5291 + 0.98560028 * jEtoile) % 360;
    const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
    const lambda = (m + c + 180 + 102.9372) % 360;
    const transit = 2451545 + jEtoile + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
    const declinaison = Math.asin(Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD));
    const cosOmega = (Math.sin(-0.833 * RAD) - Math.sin(latitude * RAD) * Math.sin(declinaison)) / (Math.cos(latitude * RAD) * Math.cos(declinaison));
    if (cosOmega > 1) return { etat: 'nuit_polaire', lever: null, coucher: null };
    if (cosOmega < -1) return { etat: 'jour_polaire', lever: null, coucher: null };
    const omega = Math.acos(cosOmega) / RAD;
    const versDate = (j) => new Date((j - 2440587.5) * 86400000);
    return { etat: 'normal', lever: versDate(transit - omega / 360), coucher: versDate(transit + omega / 360) };
  }

  /** Thème effectif ('clair' ou 'sombre') pour un mode donné. Sans lieu connu, le mode soleil suit le système. */
  function resoudre(mode, { systemeSombre = false, maintenant = new Date(), lieu = null } = {}) {
    if (mode === 'clair' || mode === 'sombre') return mode;
    if (mode === 'soleil' && lieu && Number.isFinite(lieu.latitude) && Number.isFinite(lieu.longitude)) {
      const s = soleil(maintenant, lieu.latitude, lieu.longitude);
      if (s.etat === 'jour_polaire') return 'clair';
      if (s.etat === 'nuit_polaire') return 'sombre';
      return maintenant >= s.lever && maintenant < s.coucher ? 'clair' : 'sombre';
    }
    return systemeSombre ? 'sombre' : 'clair';
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { MODES, soleil, resoudre }; return; }

  const lire = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const ecrire = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };
  const media = racine.matchMedia ? racine.matchMedia('(prefers-color-scheme: dark)') : null;
  let mode = MODES.includes(lire(CLE)) ? lire(CLE) : 'automatique';
  let lieu = null; try { lieu = JSON.parse(lire(CLE_LIEU) || 'null'); } catch { lieu = null; }

  function appliquer() {
    const theme = resoudre(mode, { systemeSombre: !!media?.matches, lieu });
    const html = document.documentElement;
    html.dataset.theme = theme; html.dataset.apparence = mode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'sombre' ? '#0B1820' : '#0E5E6F';
    return theme;
  }
  media?.addEventListener?.('change', appliquer);
  // Le mode soleil se réévalue chaque minute pour basculer à l'heure dite.
  setInterval(() => { if (mode === 'soleil') appliquer(); }, 60000);

  racine.ArrimoApparence = {
    MODES, soleil, resoudre, appliquer,
    mode: () => mode,
    lieu: () => lieu,
    /** Applique le mode choisi (serveur ou utilisateur) et le met en cache pour le prochain chargement. */
    definir(nouveau, { lieu: nouveauLieu } = {}) {
      if (!MODES.includes(nouveau)) return appliquer();
      mode = nouveau; ecrire(CLE, mode);
      if (nouveauLieu !== undefined) {
        lieu = nouveauLieu && Number.isFinite(+nouveauLieu.latitude) && Number.isFinite(+nouveauLieu.longitude)
          // Position arrondie (environ 10 km) : suffisante pour le soleil, rien de plus n'est conservé.
          ? { latitude: Math.round(+nouveauLieu.latitude * 10) / 10, longitude: Math.round(+nouveauLieu.longitude * 10) / 10, source: nouveauLieu.source || 'appareil' }
          : null;
        ecrire(CLE_LIEU, lieu && JSON.stringify(lieu));
      }
      return appliquer();
    },
    /** Demande la position approximative de l'appareil (consentement du navigateur) pour le mode soleil. */
    localiser() {
      return new Promise((ok) => {
        if (!navigator.geolocation) return ok(null);
        navigator.geolocation.getCurrentPosition((p) => ok({ latitude: p.coords.latitude, longitude: p.coords.longitude, source: 'appareil' }),
          () => ok(null), { maximumAge: 86400000, timeout: 10000, enableHighAccuracy: false });
      });
    },
  };
  appliquer();
})(typeof window === 'undefined' ? globalThis : window);
