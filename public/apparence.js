/* Apparence d'Arrimo (hospitalier et console SH) : clair, sombre, automatique (préférence du système) ou soleil
   (sombre entre le coucher et le lever du soleil au lieu indiqué). La préférence est enregistrée par utilisateur
   côté serveur ; ce script la met en cache localement pour l'appliquer dès le chargement, sans éclair blanc. */
(function (racine) {
  const MODES = ['clair', 'sombre', 'automatique', 'soleil'];
  const CLE = 'arrimo-apparence';
  const CLE_LIEU = 'arrimo-apparence-lieu';
  // Ambiance (design system du 26 nov. 2026) : Glacier ou Horizon en clair, Crépuscule en sombre. Seulement sur les pages
  // d'Arrimo (attribut data-arrimo) : la console SH garde sa présentation.
  const AMBIANCES = ['glacier', 'horizon'];
  const CLE_AMB = 'arrimo-ambiance';
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
  let ambiance = AMBIANCES.includes(lire(CLE_AMB)) ? lire(CLE_AMB) : 'glacier';
  const CLE_V2 = 'arrimo-design-v2';
  try { const q = new URLSearchParams(racine.location?.search || ''); if (q.get('design') === 'v2') ecrire(CLE_V2, '1'); if (q.get('design') === 'v1') ecrire(CLE_V2, null); } catch { /* sans adresse */ }
  const apercuV2 = () => lire(CLE_V2) === '1';

  function appliquer() {
    const theme = resoudre(mode, { systemeSombre: !!media?.matches, lieu });
    const html = document.documentElement;
    // Changement de thème : couleurs appliquées d'un coup, sans fondu (aucun état intermédiaire mal contrasté)
    if (html.dataset.theme && html.dataset.theme !== theme) { html.classList.add('theme-bascule'); setTimeout(() => html.classList.remove('theme-bascule'), 300); }
    html.dataset.theme = theme; html.dataset.apparence = mode;
    // Nouveau design en APERÇU seulement tant que la maquette n'est pas validée par Moustafa : ?design=v2 l'active, ?design=v1 le retire
    if (html.hasAttribute('data-arrimo') && apercuV2()) { html.dataset.design = 'v2'; html.dataset.ambiance = ambiance; }
    else { delete html.dataset.design; delete html.dataset.ambiance; }
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
    AMBIANCES, ambiance: () => ambiance, apercuV2: () => apercuV2(),
    /** Ambiance personnelle (enregistrée sur le compte par l'application, mise en cache ici pour éviter un éclair au chargement). */
    definirAmbiance(nouvelle) { if (AMBIANCES.includes(nouvelle)) { ambiance = nouvelle; ecrire(CLE_AMB, ambiance); } return appliquer(); },
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
