'use strict';
/**
 * Marge de préparation (cahier « coordination temporelle et anticipation des capacités », nº 12, 26 nov. 2026).
 * Compare l'heure d'arrivée d'une ambulance au délai de préparation de l'accueil (civière, nettoyage, lit) :
 * marge de préparation ou risque de retard. Règles :
 * - Délais MESURÉS seulement (médiane des nettoyages du journal immuable, 30 derniers jours) ; aucune donnée → « inconnu », jamais 0.
 * - Arrivée : ETA calculée sur la position (estimation), sinon heure prévue déclarée, sinon inconnue.
 * - Indicateur d'anticipation : ne réserve rien, ne change aucune destination ; une personne habilitée décide.
 * - Le lit est indicatif (tous services) : la compatibilité avec les besoins reste à vérifier (règle de compatibilité, cahier 19).
 */

const FENETRE_JOURS = 30;
const MARGE_FAIBLE_MIN = 5;

/** Médiane des durées « nettoyage → libre » du journal, pour les civières ou les lits d'un établissement. */
async function medianeNettoyage(db, etabId, colonne, etatLibre = 'libre') {
  const { rows: [r] } = await db.query(
    `WITH ev AS (
       SELECT date, nouvel_etat, ancien_etat, lag(date) OVER (PARTITION BY ${colonne} ORDER BY date, id) AS date_prec,
              lag(nouvel_etat) OVER (PARTITION BY ${colonne} ORDER BY date, id) AS etat_prec
         FROM journal WHERE etablissement_id = $1 AND ${colonne} IS NOT NULL AND NOT refuse AND date > now() - make_interval(days => $2 + 1))
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (date - date_prec)) / 60) AS mediane, count(*)::int AS n
       FROM ev WHERE ancien_etat = 'nettoyage' AND nouvel_etat = $3 AND etat_prec = 'nettoyage' AND date > now() - make_interval(days => $2)`,
    [etabId, FENETRE_JOURS, etatLibre]);
  return { mediane_min: r.n ? Math.round(Number(r.mediane)) : null, mesures: r.n };
}

/** État des ressources d'accueil d'un hôpital, calculé une fois pour toutes ses arrivées. */
async function mesures(db, etabId) {
  const [{ rows: [c] }, { rows: [l] }, nc, nl] = await Promise.all([
    db.query(`SELECT count(*) FILTER (WHERE c.etat = 'libre' AND c.categorie <> 'debordement'
                AND NOT EXISTS (SELECT 1 FROM reservations_civieres r WHERE r.civiere_id = c.id AND r.statut IN ('reservee', 'installee')))::int AS libres,
              count(*) FILTER (WHERE c.etat = 'nettoyage')::int AS nettoyage,
              min(j.date) FILTER (WHERE c.etat = 'nettoyage') AS nettoyage_depuis
         FROM civieres c LEFT JOIN LATERAL (SELECT max(date) AS date FROM journal WHERE civiere_id = c.id AND nouvel_etat = 'nettoyage') j ON true
        WHERE c.etablissement_id = $1 AND c.actif`, [etabId]),
    db.query(`SELECT count(*) FILTER (WHERE etat = 'libre')::int AS libres, count(*) FILTER (WHERE etat = 'nettoyage')::int AS nettoyage
         FROM lits WHERE etablissement_id = $1 AND actif`, [etabId]),
    medianeNettoyage(db, etabId, 'civiere_id'),
    medianeNettoyage(db, etabId, 'lit_id'),
  ]);
  return { civieres: { ...c, nettoyage_mediane_min: nc.mediane_min, nettoyage_mesures: nc.mesures },
    lits: { ...l, nettoyage_mediane_min: nl.mediane_min, nettoyage_mesures: nl.mesures } };
}

/** Minutes restantes avant l'arrivée : ETA (position) d'abord, sinon heure prévue ; null = inconnue. */
function arrivee(p, now = Date.now()) {
  if (p.arrivee_confirmee_le || p.arrivee_signalee_le) return { minutes: 0, source: 'arrivee' };
  if (p.eta?.minutes != null && p.eta.le) return { minutes: Math.max(0, Math.round((new Date(p.eta.le).getTime() + p.eta.minutes * 60000 - now) / 60000)), source: 'position', estimation: true };
  if (p.heure_prevue) return { minutes: Math.round((new Date(p.heure_prevue).getTime() - now) / 60000), source: 'declaree', estimation: true };
  return { minutes: null, source: 'inconnue' };
}

/** Délai avant qu'une civière soit prête pour cette ambulance. */
function delaiCiviere(m, reservation, now = Date.now()) {
  if (reservation && ['reservee', 'installee'].includes(reservation.statut) && reservation.civiere_etat === 'libre') return { delai_min: 0, etat: 'reservee_prete', source: 'mesure' };
  if (reservation?.statut === 'installee') return { delai_min: 0, etat: 'installee', source: 'mesure' };
  if (m.civieres.libres > 0) return { delai_min: 0, etat: 'libre_non_reservee', source: 'mesure' };
  if (m.civieres.nettoyage > 0) {
    if (m.civieres.nettoyage_mediane_min == null) return { delai_min: null, etat: 'nettoyage_duree_inconnue', source: 'inconnue' };
    const ecoule = m.civieres.nettoyage_depuis ? (now - new Date(m.civieres.nettoyage_depuis).getTime()) / 60000 : 0;
    return { delai_min: Math.max(0, Math.round(m.civieres.nettoyage_mediane_min - ecoule)), etat: 'nettoyage_en_cours', source: 'estimation_mediane',
      mediane_min: m.civieres.nettoyage_mediane_min, mesures: m.civieres.nettoyage_mesures };
  }
  return { delai_min: null, etat: 'aucune_civiere', source: 'inconnue' };
}

function delaiLit(m) {
  if (m.lits.libres > 0) return { delai_min: 0, etat: 'libre', source: 'mesure', compatibilite: 'a_verifier' };
  if (m.lits.nettoyage > 0 && m.lits.nettoyage_mediane_min != null) return { delai_min: m.lits.nettoyage_mediane_min, etat: 'nettoyage_en_cours', source: 'estimation_mediane', mesures: m.lits.nettoyage_mesures, compatibilite: 'a_verifier' };
  return { delai_min: null, etat: m.lits.nettoyage > 0 ? 'nettoyage_duree_inconnue' : 'aucun_lit', source: 'inconnue', compatibilite: 'a_verifier' };
}

/**
 * Évaluation pour une préalerte. Le verdict porte sur la civière (première ressource requise à l'arrivée) ;
 * le lit est affiché pour anticiper l'admission. `inconnu` dès qu'une des deux heures manque.
 */
function evaluer(m, p, reservation, now = Date.now()) {
  const a = arrivee(p, now); const civ = delaiCiviere(m, reservation, now); const lit = delaiLit(m);
  const marge = a.minutes != null && civ.delai_min != null ? a.minutes - civ.delai_min : null;
  const verdict = civ.etat === 'aucune_civiere' ? 'risque_retard'
    : marge == null ? 'inconnu' : marge < 0 ? 'risque_retard' : marge < MARGE_FAIBLE_MIN ? 'marge_faible' : 'marge';
  return { arrivee: a, civiere: civ, lit, marge_min: marge, verdict, estimation: !!a.estimation || civ.source === 'estimation_mediane',
    regle: 'Délais mesurés (médiane du journal, 30 jours) ; inconnu jamais compté 0 ; aucune réservation ni réorientation automatique.' };
}

/** Évaluations des préalertes ouvertes d'un hôpital (pour la file d'arrivées et la fiche). */
async function pourPrealertes(db, etabId, prealertes) {
  if (!prealertes.length) return new Map();
  const m = await mesures(db, etabId);
  const res = (await db.query(`SELECT r.prealerte_id, r.statut, cv.etat AS civiere_etat FROM reservations_civieres r LEFT JOIN civieres cv ON cv.id = r.civiere_id
    WHERE r.prealerte_id = ANY($1)`, [prealertes.map((p) => p.id)])).rows;
  const par = new Map(res.map((r) => [r.prealerte_id, r]));
  return new Map(prealertes.map((p) => [p.id, evaluer(m, p, par.get(p.id))]));
}

/** Historique Chrono récent d'une unité dans cet hôpital (temps à la porte mesurés, sans identité). */
async function historiqueChrono(db, etabId, uniteId) {
  return (await db.query(`SELECT pc.numero, pc.statut, pc.cree_le,
      (SELECT h.heure FROM v_horodatages_courants h WHERE h.objet = 'passage_chrono' AND h.objet_id = pc.id AND h.etape = 'H11') AS h11,
      (SELECT h.heure FROM v_horodatages_courants h WHERE h.objet = 'passage_chrono' AND h.objet_id = pc.id AND h.etape = 'H15') AS h15
    FROM passages_chrono pc WHERE pc.etablissement_id = $1 AND pc.unite_id = $2 ORDER BY pc.cree_le DESC LIMIT 5`, [etabId, uniteId])).rows
    .map((r) => ({ ...r, porte_min: r.h11 && r.h15 ? Math.round((new Date(r.h15) - new Date(r.h11)) / 60000) : null }));
}

module.exports = { mesures, evaluer, arrivee, pourPrealertes, historiqueChrono, MARGE_FAIBLE_MIN };
