'use strict';
/**
 * Plans A, B et C d'OG pour un transfert (refonte unifiée, cahier directeur §5.2-5.5 ; cahier final §16).
 * Préparés pendant l'attente, sans attendre un refus : A = destination demandée (son état et le délai écoulé), B et C = meilleures
 * solutions de rechange compatibles, calculées par le moteur existant (`services.recommander` : mêmes besoins, même classement,
 * mêmes droits de partage). Chaque plan explique : besoins couverts, disponibilité confirmée (et quand), trajet (calculé ou non),
 * critères restant à vérifier. Rien n'est réservé ni modifié : une personne habilitée décide ; jamais deux réservations.
 */
const { ErreurHttp } = require('./db');
const { peutAgirPour } = require('./auth');

const EN = (u) => u.langue === 'en';
const L = (u, fr, en) => (EN(u) ? en : fr);

function expliquer(u, s) {
  const confirme = s.libres_confirmes > 0;
  const route = s.statut_route === 'calcule' && s.minutes_route != null
    ? L(u, `${s.minutes_route} min de route (${s.distance_km} km, itinéraire calculé)`, `${s.minutes_route} min drive (${s.distance_km} km, computed route)`)
    : s.distance_geographique_km != null ? L(u, `${s.distance_geographique_km} km à vol d’oiseau (temps de route non calculé)`, `${s.distance_geographique_km} km straight line (drive time not computed)`) : L(u, 'distance inconnue', 'distance unknown');
  return {
    etablissement_id: s.etablissement_id, nom: s.nom, ville: s.ville,
    disponibilite: confirme
      ? L(u, `${s.libres_confirmes} lit(s) compatible(s) confirmé(s)`, `${s.libres_confirmes} compatible bed(s) confirmed`)
      : s.libres_non_confirmes ? L(u, `${s.libres_non_confirmes} lit(s) déclaré(s), non confirmé(s)`, `${s.libres_non_confirmes} bed(s) declared, not confirmed`)
        : L(u, 'aucune disponibilité confirmée', 'no confirmed availability'),
    confirme, confirme_le: s.confirmation?.confirme_le || null, trajet: route, trajet_calcule: s.statut_route === 'calcule',
    a_verifier: [
      ...(confirme ? [] : [L(u, 'disponibilité à confirmer par l’établissement', 'availability to be confirmed by the facility')]),
      L(u, 'acceptation de l’établissement receveur', 'acceptance by the receiving facility'),
      ...(s.transferts_a_repondre ? [L(u, `${s.transferts_a_repondre} autre(s) demande(s) en attente chez lui`, `${s.transferts_a_repondre} other request(s) pending there`)] : []),
    ],
  };
}

async function plans(pool, u, transfertId) {
  const t = (await pool.query(`SELECT t.*, d.nom AS destination_nom, EXTRACT(EPOCH FROM (now() - t.date_demande)) / 60 AS attente_min,
      c.transfert_reponse_max_min FROM transferts t JOIN etablissements d ON d.id = t.destination_id JOIN etablissements o ON o.id = t.origine_id
      JOIN config_pays c ON c.id = o.config_id WHERE t.id = $1`, [Number(transfertId)])).rows[0];
  if (!t || !peutAgirPour(u, t.origine_id)) throw new ErreurHttp(404, 'transfert_introuvable');
  const attente = Math.round(Number(t.attente_min));
  const planA = { plan: 'A', etablissement_id: t.destination_id, nom: t.destination_nom, statut: t.statut,
    situation: t.statut === 'demande'
      ? (attente > t.transfert_reponse_max_min
        ? L(u, `sans réponse depuis ${attente} min (délai configuré : ${t.transfert_reponse_max_min} min)`, `no response for ${attente} min (configured delay: ${t.transfert_reponse_max_min} min)`)
        : L(u, `en attente de réponse depuis ${attente} min`, `awaiting response for ${attente} min`))
      : t.statut === 'refuse' ? L(u, 'refusé', 'refused') : L(u, 'accepté ou en cours', 'accepted or in progress') };
  if (!['demande', 'refuse'].includes(t.statut)) return { transfert: t.numero, plan_a: planA, alternatives: [], regle: L(u, 'Aucune alternative nécessaire : le transfert suit son cours.', 'No alternative needed: the transfer is under way.') };
  const r = await require('./services').recommander(pool, u, t.origine_id, t.type_id, { ...(t.besoins || {}), groupe_age: t.groupe_age });
  const candidats = r.suggestions.filter((s) => s.etablissement_id !== t.destination_id);
  // Confirmées d'abord (ordre du moteur : confirmées, puis trajet) ; jamais une prévision présentée comme une place
  const tri = [...candidats.filter((s) => s.libres_confirmes > 0), ...candidats.filter((s) => !(s.libres_confirmes > 0))];
  const alternatives = tri.slice(0, 2).map((s, i) => ({ plan: i === 0 ? 'B' : 'C', ...expliquer(u, s) }));
  return {
    transfert: t.numero, plan_a: planA, alternatives,
    besoins_utilises: Object.keys(t.besoins || {}).length ? t.besoins : null,
    incertitude: Object.keys(t.besoins || {}).length ? null : L(u, 'Besoins non renseignés : la compatibilité n’est pas établie, seulement le type de lit.', 'Needs not provided: compatibility is not established, only the bed type.'),
    regle: L(u, 'OG prépare les alternatives ; rien n’est réservé. Changer de destination passe par l’annulation de la demande initiale, décidée par une personne habilitée.',
      'OG prepares alternatives; nothing is reserved. Changing destination requires cancelling the initial request, decided by an authorized person.'),
  };
}

module.exports = { plans };
