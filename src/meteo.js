'use strict';
/**
 * Météo actuelle à l'emplacement de l'établissement (en-tête et barre latérale).
 * - Source : Open-Meteo (gratuit, sans clé). Le serveur l'interroge ; le navigateur n'appelle aucun site externe.
 * - Seules les coordonnées de l'établissement sont transmises ; aucune donnée patient ni utilisateur.
 * - Résultat gardé 15 minutes par établissement ; en cas d'échec, l'interface affiche seulement l'heure et la date.
 * - Désactivée hors démonstration, recette, pilote et production, ou avec ARRIMO_METEO=0 (tests sans réseau).
 */
const { exigerEtablissement } = require('./auth');
const { environnement } = require('./environnement');

const DUREE_MS = 15 * 60 * 1000;
const ECHEC_MS = 5 * 60 * 1000;
const cache = new Map();

const active = () => process.env.ARRIMO_METEO !== '0' && ['demo', 'recette', 'pilote', 'production'].includes(environnement());

async function lireOpenMeteo(latitude, longitude) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,is_day&timezone=auto`;
  const r = await fetch(url, { signal: AbortSignal.timeout(3500), headers: { 'User-Agent': 'Arrimo' } });
  if (!r.ok) throw new Error(`meteo ${r.status}`);
  const j = await r.json();
  const c = j.current || {};
  if (typeof c.temperature_2m !== 'number') throw new Error('meteo incomplete');
  return { temperature: Math.round(c.temperature_2m * 10) / 10, code: Number(c.weather_code), jour: c.is_day === 1, mesure_le: c.time, fuseau: j.timezone };
}

async function meteo(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const e = (await pool.query('SELECT ville, latitude, longitude FROM etablissements WHERE id = $1', [etabId])).rows[0];
  const base = { ville: e?.ville || null, source: 'Open-Meteo' };
  if (!active() || !e || e.latitude == null || e.longitude == null) return { ...base, disponible: false };
  const cle = `${Number(e.latitude).toFixed(2)},${Number(e.longitude).toFixed(2)}`;
  const memo = cache.get(cle);
  if (memo && Date.now() - memo.t < (memo.ok ? DUREE_MS : ECHEC_MS)) return { ...base, ...memo.donnees };
  try {
    const donnees = { disponible: true, ...(await lireOpenMeteo(Number(e.latitude).toFixed(3), Number(e.longitude).toFixed(3))) };
    cache.set(cle, { t: Date.now(), ok: true, donnees });
    return { ...base, ...donnees };
  } catch {
    cache.set(cle, { t: Date.now(), ok: false, donnees: { disponible: false } });
    return { ...base, disponible: false };
  }
}

module.exports = { meteo, _cache: cache };
