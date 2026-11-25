'use strict';
/**
 * Indicateurs de coordination (chantier coordination, lot 4 « Mesurer », 26 nov. 2026 ; cahier « optimisation transversale » §17,
 * cahier final §20, cahier nº 2 §6). Mesurés à partir des heures enregistrées (Horloge, transferts, transports, placements, suivis),
 * pour une période et une période de référence de même durée : les écarts sont observés, jamais attribués à Arrimo,
 * et aucune valeur manquante n'est estimée (null = « non mesurable »).
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');

const ROLES = ['coordonnateur', 'gestionnaire', 'admin_etab'];
const JOUR = 86400000;
const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

function periodes(q) {
  const date = (v, nom) => { if (v == null || v === '') return null; const d = new Date(String(v)); if (Number.isNaN(d.getTime())) throw new ErreurHttp(400, 'parametre_invalide', { nom }); return d; };
  const fin = date(q.fin, 'fin') || new Date();
  const debut = date(q.debut, 'debut') || new Date(fin.getTime() - 30 * JOUR);
  if (debut >= fin || fin - debut > 366 * JOUR) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'debut' });
  const duree = fin - debut;
  return { courante: { debut, fin }, reference: { debut: new Date(debut.getTime() - duree), fin: debut } };
}

/** Statistiques (médiane, P90) en minutes d'une expression d'intervalle, en SQL. */
const STATS = (expr) => `round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ${expr}))::numeric, 1)::float AS mediane,
  round((percentile_cont(0.9) WITHIN GROUP (ORDER BY ${expr}))::numeric, 1)::float AS p90, count(${expr})::int AS n`;
const MIN = (a, b) => `EXTRACT(EPOCH FROM (${b} - ${a})) / 60`;

async function mesurer(db, etabId, { debut, fin }) {
  const p = [etabId, debut, fin];
  const chrono = (await db.query(`WITH h AS (
      SELECT pc.id, max(v.heure) FILTER (WHERE v.etape = 'H11') AS h11, max(v.heure) FILTER (WHERE v.etape = 'H14') AS h14, max(v.heure) FILTER (WHERE v.etape = 'H15') AS h15
        FROM passages_chrono pc JOIN v_horodatages_courants v ON v.objet = 'passage_chrono' AND v.objet_id = pc.id
       WHERE pc.etablissement_id = $1 GROUP BY pc.id)
    SELECT ${STATS(MIN('h11', 'h14'))}, (SELECT round((sum(${MIN('h11', 'h15')}) / 60)::numeric, 1)::float FROM h WHERE h11 >= $2 AND h11 < $3 AND h15 >= h11) AS heures_cumulees
      FROM h WHERE h11 >= $2 AND h11 < $3 AND h14 >= h11`, p)).rows[0];
  const transferts = (await db.query(`SELECT count(*)::int AS demandes, count(*) FILTER (WHERE statut = 'recu')::int AS recus,
      ${STATS(MIN('date_demande', 'COALESCE(date_validation, date_refus)'))}
      FROM transferts WHERE (origine_id = $1 OR destination_id = $1) AND date_demande >= $2 AND date_demande < $3`, p)).rows[0];
  const transports = (await db.query(`SELECT count(*)::int AS demandes, count(*) FILTER (WHERE statut = 'annulee')::int AS annules,
      ${STATS(MIN('cree_le', 'pris_en_charge_le'))}
      FROM demandes_transport WHERE (origine_id = $1 OR destination_id = $1) AND statut <> 'a_valider' AND cree_le >= $2 AND cree_le < $3`, p)).rows[0];
  const placements = (await db.query(`SELECT ${STATS(MIN('acceptation_equipe_le', 'depart_hopital_le'))}
      FROM demandes_hebergement WHERE (hopital_id = $1 OR etablissement_id = $1) AND acceptation_equipe_le >= $2 AND acceptation_equipe_le < $3
        AND depart_hopital_le >= acceptation_equipe_le`, p)).rows[0];
  const alertes = (await db.query(`SELECT count(*)::int AS ouvertes, count(*) FILTER (WHERE statut = 'resolue')::int AS resolues,
      count(*) FILTER (WHERE statut = 'levee')::int AS levees, count(*) FILTER (WHERE escalade_niveau > 0)::int AS escaladees,
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ${MIN('cree_le', 'accuse_le')}))::numeric, 1)::float AS accuse_mediane,
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ${MIN('cree_le', 'resolue_le')}))::numeric, 1)::float AS resolution_mediane
      FROM suivis_alertes WHERE etablissement_id = $1 AND cree_le >= $2 AND cree_le < $3`, p)).rows[0];
  return {
    chrono: { passages_mesures: chrono.n, porte_mediane_min: chrono.mediane, porte_p90_min: chrono.p90, immobilisation_heures: chrono.heures_cumulees },
    transferts: { demandes: transferts.demandes, recus: transferts.recus, taux_realises_pct: transferts.demandes ? Math.round((transferts.recus / transferts.demandes) * 1000) / 10 : null,
      reponse_mediane_min: transferts.mediane, reponse_p90_min: transferts.p90 },
    transports: { demandes: transports.demandes, annules: transports.annules, prise_en_charge_mediane_min: transports.mediane, prise_en_charge_p90_min: transports.p90 },
    placements: { mesures: placements.n, acceptation_depart_mediane_min: placements.mediane, acceptation_depart_p90_min: placements.p90 },
    alertes: { ouvertes: alertes.ouvertes, resolues_confirmees: alertes.resolues, levees: alertes.levees, escaladees: alertes.escaladees,
      accuse_mediane_min: alertes.accuse_mediane, resolution_mediane_min: alertes.resolution_mediane },
  };
}

/** Écart (courante − référence) pour chaque valeur numérique ; null si l'une des deux n'est pas mesurable. */
function ecarts(a, b) {
  const r = {};
  for (const [k, v] of Object.entries(a)) {
    if (v && typeof v === 'object') r[k] = ecarts(v, b[k] || {});
    else r[k] = typeof v === 'number' && typeof b[k] === 'number' ? Math.round((v - b[k]) * 10) / 10 : null;
  }
  return r;
}

async function indicateurs(pool, u, q = {}) {
  const etabId = entier(q.etablissement_id); if (!etabId) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, etabId);
  if (!ROLES.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const per = periodes(q);
  const [courante, reference] = await Promise.all([mesurer(pool, etabId, per.courante), mesurer(pool, etabId, per.reference)]);
  const en = u.langue === 'en';
  return { etablissement_id: etabId, periode: per.courante, periode_reference: per.reference, courante, reference, ecart: ecarts(courante, reference),
    avertissement: en ? 'Observed differences between two periods of equal length; they are not attributed to Arrimo without an evaluation method. Missing values are never estimated.'
      : 'Écarts observés entre deux périodes de même durée ; ils ne sont pas attribués à Arrimo sans méthode d’évaluation. Les valeurs manquantes ne sont jamais estimées.' };
}

module.exports = { indicateurs, periodes, ecarts };
