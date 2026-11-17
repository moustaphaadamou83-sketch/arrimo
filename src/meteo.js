'use strict';
/**
 * Météo actuelle à l'emplacement de l'établissement (en-tête et barre latérale).
 * - Source : Open-Meteo (gratuit, sans clé). Le serveur l'interroge ; le navigateur n'appelle aucun site externe.
 * - Seules les coordonnées de l'établissement sont transmises ; aucune donnée patient ni utilisateur.
 * - Résultat gardé 15 minutes par établissement ; en cas d'échec, l'interface affiche seulement l'heure et la date.
 * - Désactivée hors démonstration, recette, pilote et production, ou avec ARRIMO_METEO=0 (tests sans réseau).
 * - Démonstration et recette (villes fictives) et console SH : météo réelle d'une vraie ville de référence,
 *   Montréal par défaut (décision de Moustafa, 17 nov. 2026) ; autre ville : ARRIMO_METEO_LIEU="Nom;latitude;longitude".
 *   Pilote et production : la vraie ville de l'établissement, à ses coordonnées.
 */
const { exigerEtablissement } = require('./auth');
const { environnement } = require('./environnement');

const DUREE_MS = 10 * 60 * 1000;   // Open-Meteo actualise la mesure courante toutes les 15 minutes
const ECHEC_MS = 5 * 60 * 1000;
const cache = new Map();

const active = () => process.env.ARRIMO_METEO !== '0' && ['demo', 'recette', 'pilote', 'production'].includes(environnement());
/** Données fictives : les villes des établissements sont inventées, la météo vient de la ville de référence. */
const villesFictives = () => ['demo', 'recette'].includes(environnement());
/** Ville réelle de référence (démonstration, recette, console SH). */
function lieuReference() {
  const [nom, lat, lon] = String(process.env.ARRIMO_METEO_LIEU || '').split(';').map((x) => x.trim());
  if (nom && lat && lon && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180) {
    return { ville: nom.slice(0, 80), latitude: Number(lat), longitude: Number(lon) };
  }
  return { ville: 'Montréal', latitude: 45.5017, longitude: -73.5673 };
}

async function lireOpenMeteo(latitude, longitude) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,is_day&timezone=auto`;
  const r = await fetch(url, { signal: AbortSignal.timeout(3500), headers: { 'User-Agent': 'Arrimo' } });
  if (!r.ok) throw new Error(`meteo ${r.status}`);
  const j = await r.json();
  const c = j.current || {};
  if (typeof c.temperature_2m !== 'number') throw new Error('meteo incomplete');
  return { temperature: Math.round(c.temperature_2m * 10) / 10, code: Number(c.weather_code), jour: c.is_day === 1, mesure_le: c.time, fuseau: j.timezone };
}

/** Météo actuelle à des coordonnées, gardée 10 minutes (5 minutes après un échec). */
async function meteoA(ville, latitude, longitude) {
  const base = { ville, source: 'Open-Meteo' };
  const cle = `${Number(latitude).toFixed(2)},${Number(longitude).toFixed(2)}`;
  const memo = cache.get(cle);
  if (memo && Date.now() - memo.t < (memo.ok ? DUREE_MS : ECHEC_MS)) return { ...base, ...memo.donnees };
  try {
    const donnees = { disponible: true, ...(await lireOpenMeteo(Number(latitude).toFixed(3), Number(longitude).toFixed(3))) };
    cache.set(cle, { t: Date.now(), ok: true, donnees });
    return { ...base, ...donnees };
  } catch {
    cache.set(cle, { t: Date.now(), ok: false, donnees: { disponible: false } });
    return { ...base, disponible: false };
  }
}

async function meteo(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const e = (await pool.query('SELECT ville, latitude, longitude FROM etablissements WHERE id = $1', [etabId])).rows[0];
  if (!active() || !e) return { ville: e?.ville || null, source: 'Open-Meteo', disponible: false };
  if (villesFictives()) { const r = lieuReference(); return meteoA(r.ville, r.latitude, r.longitude); }
  if (e.latitude == null || e.longitude == null) return { ville: e.ville || null, source: 'Open-Meteo', disponible: false };
  return meteoA(e.ville || null, e.latitude, e.longitude);
}

/** Console SH (siège) : météo réelle de la ville de référence. */
async function meteoSiege() {
  const r = lieuReference();
  if (process.env.ARRIMO_METEO === '0') return { ville: r.ville, source: 'Open-Meteo', disponible: false };
  return meteoA(r.ville, r.latitude, r.longitude);
}

module.exports = { meteo, meteoSiege, lieuReference, _cache: cache };
