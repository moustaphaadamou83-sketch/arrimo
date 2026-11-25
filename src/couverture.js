'use strict';
/**
 * Couverture ambulancière d'une région (chantier coordination, lot 6, 26 nov. 2026 ; scénario E, cahier « optimisation transversale » §10).
 * Lecture : unités de la région par état (disponibles, engagées, immobilisées à l'hôpital, hors service, état inconnu), ambulances à la porte.
 * Rupture : seulement si un seuil de SIMULATION est configuré (démo, recette) ; elle est enregistrée (début, fin, durée, cause, gravité,
 * mesure et responsable de la décision) ; aucune mesure réglementaire n'est déclenchée et aucune ambulance n'est mobilisée.
 */
const { ErreurHttp } = require('./db');
const { environnement } = require('./environnement');

const CAUSES = ['inconnue', 'immobilisations_hospitalieres', 'interventions_multiples', 'vehicules_hors_service', 'autre_documentee'];
const MESURES = ['aucune', 'renfort_demande', 'redistribution_decidee', 'contingence_autorite', 'autre_documentee'];
const GRAVITES = ['simulation', 'moderee', 'elevee', 'critique'];
const simulationPermise = () => !['pilote', 'production'].includes(environnement());

async function etatRegion(db, configId) {
  const { rows: [r] } = await db.query(`SELECT count(un.id)::int AS unites,
      count(*) FILTER (WHERE ev.etat = 'disponible')::int AS disponibles,
      count(*) FILTER (WHERE ev.etat IN ('en_route', 'sur_place', 'transport_hopital'))::int AS engagees,
      count(*) FILTER (WHERE ev.etat = 'a_l_hopital')::int AS immobilisees,
      count(*) FILTER (WHERE ev.etat IN ('hors_service', 'desinfection', 'en_preparation'))::int AS indisponibles,
      count(*) FILTER (WHERE ev.etat IS NULL)::int AS inconnues,
      max(ev.modifie_le) AS derniere_maj
    FROM unites_secours un JOIN organisations_secours o ON o.id = un.organisation_id AND o.actif AND 'ambulance' = ANY(o.profils)
    LEFT JOIN etats_vehicules ev ON ev.unite_id = un.id
    WHERE un.actif AND o.config_id = $1`, [configId]);
  const porte = (await db.query(`SELECT count(*)::int AS n FROM passages_chrono pc JOIN etablissements e ON e.id = pc.etablissement_id
    WHERE pc.statut = 'a_la_porte' AND e.config_id = $1`, [configId])).rows[0].n;
  return { ...r, a_la_porte_chrono: porte };
}

/** Contrôle périodique : ouvre ou clôt l'événement de rupture d'une région selon le seuil de simulation (jamais en pilote ni production). */
async function controler(pool) {
  if (!simulationPermise()) return { ouvertes: 0, closes: 0 };
  const regions = (await pool.query('SELECT id, couverture_seuil_simulation AS seuil FROM config_pays WHERE couverture_seuil_simulation IS NOT NULL')).rows;
  let ouvertes = 0; let closes = 0;
  for (const g of regions) {
    const e = await etatRegion(pool, g.id);
    const ouverte = (await pool.query('SELECT * FROM ruptures_couverture WHERE config_id = $1 AND fin IS NULL', [g.id])).rows[0];
    if (e.unites && e.disponibles <= g.seuil) {
      if (ouverte) {
        await pool.query('UPDATE ruptures_couverture SET disponibles_min = LEAST(disponibles_min, $2), immobilisees_max = GREATEST(immobilisees_max, $3) WHERE id = $1', [ouverte.id, e.disponibles, e.immobilisees]);
      } else {
        const { rowCount } = await pool.query(`INSERT INTO ruptures_couverture (config_id, seuil, disponibles_min, immobilisees_max) VALUES ($1, $2, $3, $4)
          ON CONFLICT (config_id) WHERE fin IS NULL DO NOTHING`, [g.id, g.seuil, e.disponibles, e.immobilisees]);
        ouvertes += rowCount;
      }
    } else if (ouverte) {
      await pool.query('UPDATE ruptures_couverture SET fin = now() WHERE id = $1 AND fin IS NULL', [ouverte.id]); closes += 1;
    }
  }
  if (ouvertes || closes) require('./flux').signaler();
  return { ouvertes, closes };
}

async function regionsDe(db, u) {
  if (u.role !== 'repartiteur' && u.role !== 'superviseur_secours') throw new ErreurHttp(403, 'role_insuffisant');
  const r = (await db.query(`SELECT DISTINCT o.config_id FROM utilisateur_organisations uo JOIN organisations_secours o ON o.id = uo.organisation_id
    WHERE uo.utilisateur_id = $1 AND o.actif`, [u.id])).rows.map((x) => x.config_id);
  if (!r.length) throw new ErreurHttp(403, 'organisation_interdite');
  return r;
}

/** Tableau du CCS : couverture de ses régions, rupture en cours et historique (30 jours). */
async function tableau(pool, u) {
  const regions = await regionsDe(pool, u);
  const res = [];
  for (const id of regions) {
    const cfg = (await pool.query('SELECT id, nom, couverture_seuil_simulation AS seuil FROM config_pays WHERE id = $1', [id])).rows[0];
    const ev = (await pool.query(`SELECT r.*, x.nom AS decide_par_nom, EXTRACT(EPOCH FROM (COALESCE(r.fin, now()) - r.debut)) / 60 AS duree_min
      FROM ruptures_couverture r LEFT JOIN utilisateurs x ON x.id = r.decide_par WHERE r.config_id = $1 AND r.debut > now() - interval '30 days' ORDER BY r.debut DESC`, [id])).rows
      .map((r) => ({ ...r, id: Number(r.id), duree_min: Math.round(Number(r.duree_min)) }));
    res.push({ region: { id: cfg.id, nom: cfg.nom }, etat: await etatRegion(pool, id),
      seuil_simulation: simulationPermise() ? cfg.seuil : null, rupture_en_cours: ev.find((r) => !r.fin) || null, historique: ev });
  }
  return { regions: res, regle: u.langue === 'en' ? 'Simulation thresholds only; no measure is triggered automatically. The decision belongs to the competent authority.'
    : 'Seuils de simulation seulement ; aucune mesure n’est déclenchée automatiquement. La décision appartient à l’autorité compétente.' };
}

/** Le répartiteur documente la cause, la gravité et la mesure décidée (listes fermées) ; la décision est tracée à son nom. */
async function documenter(pool, u, id, b = {}) {
  const regions = await regionsDe(pool, u);
  const r = (await pool.query('SELECT * FROM ruptures_couverture WHERE id = $1', [Number(id)])).rows[0];
  if (!r || !regions.includes(r.config_id)) throw new ErreurHttp(404, 'introuvable');
  if (b.cause != null && !CAUSES.includes(b.cause)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'cause' });
  if (b.mesure != null && !MESURES.includes(b.mesure)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'mesure' });
  if (b.gravite != null && !GRAVITES.includes(b.gravite)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'gravite' });
  const { rows: [x] } = await pool.query(`UPDATE ruptures_couverture SET cause = COALESCE($2, cause), mesure = COALESCE($3, mesure), gravite = COALESCE($4, gravite),
      decide_par = CASE WHEN $3::text IS NULL THEN decide_par ELSE $5 END, decide_le = CASE WHEN $3::text IS NULL THEN decide_le ELSE now() END WHERE id = $1 RETURNING *`,
  [r.id, b.cause ?? null, b.mesure ?? null, b.gravite ?? null, u.id]);
  return { ...x, id: Number(x.id) };
}

module.exports = { controler, tableau, documenter, etatRegion, CAUSES, MESURES, GRAVITES };
