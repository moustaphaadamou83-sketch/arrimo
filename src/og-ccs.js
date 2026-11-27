'use strict';
/**
 * OG proactif permanent du CCS (cahier du 28 nov. 2026). Copilote alimenté par les événements du réseau : il lit, à chaque appel, les
 * capacités confirmées, les nettoyages en cours, les congés, les fermetures, les ambulances et les missions, puis propose des plans A, B, C
 * par mission. OG recommande ; le CCS ou le système habilité décide. Jamais de disponibilité, de position ni de temps de trajet inventés :
 * une valeur inconnue reste « inconnue ». Une prévision n'est ni une réservation ni une acceptation du patient.
 * Quatre catégories distinctes : maintenant (confirmé), confirmée à venir (nettoyage en cours d'une ressource déjà libérée),
 * prévisionnelle non confirmée (congé prévu ou confirmé, départ non encore réalisé), inconnue (aucune donnée ou donnée périmée).
 */
const crypto = require('node:crypto');
const vehicules = require('./vehicules');
const flotte = require('./flotte-ccs');
const { ErreurHttp } = require('./db');
const HORIZONS = [15, 30, 60, 120];

/** Anticipation par établissement (Chrono : horodatages réels des nettoyages et des congés). */
async function anticipation(pool, ids) {
  if (!ids.length) return new Map();
  const r = await pool.query(`SELECT e.id, c.nettoyage_cible_min,
      (SELECT json_agg(EXTRACT(EPOCH FROM (cv.etat_depuis + make_interval(mins => c.nettoyage_cible_min) - now())) / 60) FROM civieres cv
        WHERE cv.etablissement_id = e.id AND cv.actif AND cv.etat = 'nettoyage') AS civ_nettoyage,
      (SELECT json_agg(EXTRACT(EPOCH FROM (l.etat_depuis + make_interval(mins => c.nettoyage_cible_min) - now())) / 60) FROM lits l
        WHERE l.etablissement_id = e.id AND l.etat = 'nettoyage') AS lits_nettoyage,
      (SELECT json_agg(json_build_object('min', EXTRACT(EPOCH FROM (g.sortie_prevue + make_interval(mins => c.nettoyage_cible_min) - now())) / 60, 'statut', g.statut)) FROM conges g
        WHERE g.etablissement_id = e.id AND g.statut IN ('prevu', 'confirme') AND g.sortie_prevue IS NOT NULL AND g.sortie_prevue < now() + interval '2 hours') AS conges,
      (SELECT count(*)::int FROM lits l WHERE l.etablissement_id = e.id AND l.etat = 'libre') AS lits_libres
    FROM etablissements e JOIN config_pays c ON c.id = e.config_id WHERE e.id = ANY($1)`, [ids]);
  return new Map(r.rows.map((x) => {
    const n = (l, h) => (l || []).filter((m) => Number(m) <= h).length;
    const horizons = Object.fromEntries(HORIZONS.map((h) => [h, { confirmee_a_venir: n(x.civ_nettoyage, h) + n(x.lits_nettoyage, h),
      previsionnelle: (x.conges || []).filter((g) => g.min <= h).length }]));
    const prochaine = [...(x.civ_nettoyage || []), ...(x.lits_nettoyage || [])].map(Number).filter((m) => m >= 0).sort((a, b) => a - b)[0];
    return [x.id, { lits_libres: x.lits_libres, horizons, prochaine_min: prochaine != null ? Math.round(prochaine) : null }];
  }));
}

/** Une proposition : tous les champs du cahier, null quand la donnée n'existe pas. */
function proposition(h, a, i) {
  const st = h.statut_declare && !h.statut_declare.perime ? h.statut_declare : null;
  const restrictions = [h.ecartee ? `fermeture:${h.ecartee}` : null, st && ['saturation', 'delestage', 'capacite_limitee'].includes(st.statut) ? st.statut : null].filter(Boolean);
  const civ = h.urgence?.civieres_libres ?? null;
  const motif = civ == null ? 'capacite_inconnue' : civ > 0 && h.temps_min != null ? 'capacite_et_trajet' : civ > 0 ? 'capacite_trajet_inconnu' : 'prochaine_liberation';
  return { plan: 'ABC'[i], id: h.id, etablissement: h.nom, service: (h.services_ouverts && h.services_ouverts[0]) || 'urgence_generale', services: h.services_ouverts || [],
    distance_km: h.distance_km ?? null, temps_min: h.temps_min ?? null, source_temps: h.source_distance || null,
    disponible_maintenant: civ, lits_libres: a?.lits_libres ?? null, previsions: a?.horizons || null,
    heure_estimee_disponibilite: civ ? new Date().toISOString() : a?.prochaine_min != null ? new Date(Date.now() + a.prochaine_min * 60000).toISOString() : null,
    restrictions, fraicheur: st ? { declare_le: st.le || null, perime: false } : { declare_le: null, perime: !!h.statut_declare?.perime }, motif };
}

/** Carte OG permanente : recommandations par mission, nouvelles disponibilités, prévisions, situations prioritaires ; signature pour notifier. */
async function tableau(pool, u) {
  if (u.role !== 'repartiteur') throw new ErreurHttp(403, 'role_insuffisant');
  const reseau = await vehicules.urgencesClassees(pool, u, { capacites_seules: '1' });
  const hops = reseau.urgences || [];
  const ant = await anticipation(pool, hops.map((h) => h.id));
  const fl = await flotte.tableau(pool, u, { tri: 'priorite' });
  // Missions qui ont besoin d'une destination : missions CCS ouvertes et préalertes en cours de la flotte supervisée
  const missions = fl.vehicules.filter((v) => v.mission && ['mission', 'prealerte'].includes(v.mission.type) && !['patient_receptionne'].includes(v.statut)).slice(0, 8);
  const recommandations = [];
  for (const v of missions) {
    const depart = v.position ? { latitude: v.position.latitude, longitude: v.position.longitude, le: v.position.le, nom: v.numero } : null;
    const c = depart ? await vehicules.classer(hops.map((h) => ({ ...h, ecartee: undefined })), depart, { pool }) : { urgences: hops.map((h) => ({ ...h, temps_min: null, distance_km: null, rang: vehicules.rangDisponibilite(h) })).sort((a, b) => a.rang - b.rang) };
    const choix = (c.urgences || []).filter((h) => !h.ecartee && h.rang < 3).slice(0, 3).map((h, i) => proposition(h, ant.get(h.id), i));
    recommandations.push({ unite_id: v.id, unite: v.numero, mission: v.mission.numero, type: v.mission.type, destination_actuelle: v.mission.destination || null,
      position_connue: !!depart, plans: choix, note: depart ? null : 'position_inconnue' });
  }
  const disponibilites = hops.map((h) => { const a = ant.get(h.id); const st = h.statut_declare && !h.statut_declare.perime;
    return { id: h.id, etablissement: h.nom, maintenant: h.urgence?.civieres_libres ?? null, lits_libres: a?.lits_libres ?? null, horizons: a?.horizons || null,
      categorie: h.urgence ? 'maintenant' : st ? 'declaree' : 'inconnue' }; });
  const prioritaires = fl.vehicules.filter((v) => v.niveau === 'rouge').map((v) => ({ unite_id: v.id, unite: v.numero, conditions: v.conditions, depuis: v.depuis }));
  // Signature : change seulement si une recommandation ou une disponibilité importante change (une notification, jamais des doublons)
  const signature = crypto.createHash('sha1').update(JSON.stringify([recommandations.map((r) => [r.mission, r.plans.map((p) => p.id)]),
    disponibilites.map((d) => [d.id, d.maintenant > 0]), prioritaires.map((p) => p.unite_id)])).digest('hex').slice(0, 16);
  return { genere_le: new Date().toISOString(), horizons: HORIZONS, recommandations, disponibilites, prioritaires, signature,
    regle: 'OG recommande ; le CCS ou le système habilité décide. Une prévision n’est ni une réservation ni une acceptation du patient.' };
}
module.exports = { tableau, anticipation, proposition, HORIZONS };
