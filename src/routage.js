/**
 * Adaptateur OSRM pour RescueMatch. Aucune distance de repli n'est calculée ici :
 * si le moteur ne répond pas ou ne trouve pas de route, la mesure reste indisponible.
 */
const { ErreurHttp } = require('./db');

let fetcher = (...args) => fetch(...args);
const PROFIL_DEFAUT = 'driving';
const TIMEOUT_MS = Math.min(10000, Math.max(1000, Number(process.env.ARRIMO_ROUTAGE_TIMEOUT_MS) || 5000));

function configuration() {
  const base = String(process.env.ARRIMO_ROUTEUR_URL || '').trim().replace(/\/$/, '');
  if (!base) throw new ErreurHttp(503, 'routeur_indisponible');
  let url;
  try { url = new URL(base); } catch { throw new ErreurHttp(503, 'routeur_configuration_invalide'); }
  const localHttp = url.protocol === 'http:' && (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.test'));
  if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.search || url.hash) {
    throw new ErreurHttp(503, 'routeur_configuration_invalide');
  }
  return { base, profil: process.env.ARRIMO_ROUTEUR_PROFIL || PROFIL_DEFAUT,
    nom: process.env.ARRIMO_ROUTEUR_NOM || url.host };
}

function coordonnee(c) {
  if (c.latitude == null || c.longitude == null || String(c.latitude).trim() === '' || String(c.longitude).trim() === '') {
    throw new ErreurHttp(503, 'coordonnees_indisponibles');
  }
  const longitude = Number(c.longitude); const latitude = Number(c.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) {
    throw new ErreurHttp(503, 'coordonnees_indisponibles');
  }
  return `${longitude},${latitude}`;
}

async function requete(path) {
  const cfg = configuration();
  let reponse;
  try {
    const headers = { Accept: 'application/json' };
    if (process.env.ARRIMO_ROUTEUR_CLE) headers.Authorization = `Bearer ${process.env.ARRIMO_ROUTEUR_CLE}`;
    reponse = await fetcher(`${cfg.base}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers, redirect: 'error' });
  } catch {
    throw new ErreurHttp(503, 'routeur_indisponible');
  }
  if (!reponse.ok) throw new ErreurHttp(503, 'routeur_indisponible');
  const corps = await reponse.json().catch(() => null);
  if (!corps || corps.code !== 'Ok') throw new ErreurHttp(503, 'itineraire_introuvable');
  return { corps, cfg };
}

/** Une requête Table OSRM pour toutes les destinations compatibles. */
async function matrice(origine, destinations) {
  if (!destinations.length) return { routes: [], fournisseur: configuration().nom, actualise_le: new Date().toISOString() };
  // OSRM Table prend une liste ordonnée de coordonnées, origine en premier.
  const coords = [coordonnee(origine), ...destinations.map(coordonnee)].join(';');
  const ids = destinations.map((_, i) => i + 1).join(';');
  const { corps, cfg } = await requete(`/table/v1/${encodeURIComponentProfile(configuration().profil)}/${coords}?sources=0&destinations=${ids}&annotations=distance,duration`);
  const distances = corps.distances?.[0]; const durees = corps.durations?.[0];
  if (!Array.isArray(distances) || !Array.isArray(durees) || distances.length !== destinations.length || durees.length !== destinations.length) {
    throw new ErreurHttp(503, 'reponse_routeur_invalide');
  }
  const routes = destinations.map((_, i) => {
    const metres = distances[i]; const secondes = durees[i];
    return Number.isFinite(metres) && metres >= 0 && Number.isFinite(secondes) && secondes >= 0
      ? { distance_km: Math.round((metres / 1000) * 10) / 10, duree_min: Math.max(1, Math.round(secondes / 60)) }
      : null;
  });
  return { routes, fournisseur: cfg.nom, actualise_le: new Date().toISOString(), version_donnees: corps.data_version || null };
}

function encodeURIComponentProfile(profile) {
  if (!/^[a-z0-9_-]+$/i.test(profile)) throw new ErreurHttp(503, 'routeur_configuration_invalide');
  return profile;
}

async function itineraire(origine, destination) {
  const profil = configuration().profil;
  const coords = `${coordonnee(origine)};${coordonnee(destination)}`;
  const { corps, cfg } = await requete(`/route/v1/${encodeURIComponentProfile(profil)}/${coords}?overview=full&geometries=geojson&steps=false`);
  const r = corps.routes?.[0];
  if (!r || !Number.isFinite(r.distance) || !Number.isFinite(r.duration) || r.distance < 0 || r.duration < 0
      || r.geometry?.type !== 'LineString' || !Array.isArray(r.geometry.coordinates)) {
    throw new ErreurHttp(503, 'reponse_routeur_invalide');
  }
  return { distance_km: Math.round((r.distance / 1000) * 10) / 10,
    duree_min: Math.max(1, Math.round(r.duration / 60)), geometrie: r.geometry,
    fournisseur: cfg.nom, actualise_le: new Date().toISOString(), version_donnees: corps.data_version || null };
}

function definirFetchTest(f) { fetcher = f || ((...args) => fetch(...args)); }
module.exports = { matrice, itineraire, definirFetchTest };
