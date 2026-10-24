/**
 * Tableau de bord national par proximité : tous les établissements qui partagent leur capacité, sans limite de rayon,
 * du plus proche au plus loin depuis l'établissement de l'utilisateur.
 * - Distance (formule de haversine) et filtres calculés en SQL, pagination en SQL : rapide même avec des centaines d'établissements.
 * - Le détail (lits par type d'unité, prévus, civières) n'est calculé que pour la page affichée.
 * - Partage agrégé respecté : pas de lits prévus ni de détail des séjours sur civière.
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const s = require('./services');
const cv = require('./civieres');

const TAILLE = 20;

// Distance à vol d'oiseau en km entre l'établissement e et le point de départ ici (degrés)
const SQL_DISTANCE = `round(2 * 6371 * asin(sqrt(power(sin(radians(e.latitude - ici.latitude) / 2), 2)
  + cos(radians(ici.latitude)) * cos(radians(e.latitude)) * power(sin(radians(e.longitude - ici.longitude) / 2), 2))))::int`;

/** Filtres : type_id, besoins {isolement…}, max_minutes (temps de route), avec_lit (lit libre adapté du type), page. */
async function national(pool, utilisateur, depuisId, f = {}) {
  exigerEtablissement(utilisateur, depuisId);
  const ici = await s.etablissement(pool, depuisId);
  s.exigerActif(ici);
  const cfg = ici.config;
  const typeId = f.type_id ? Number(f.type_id) : null;
  const besoins = s.lireBesoins(f.besoins || {});
  const filtreLit = s.sqlBesoins(besoins);
  const page = Math.max(1, Number(f.page) || 1);
  const taille = Math.min(Math.max(Number(f.taille) || TAILLE, 1), 50);
  const maxMin = f.max_minutes ? Number(f.max_minutes) : null;
  if ((f.type_id && !Number.isInteger(typeId)) || (f.max_minutes && !(maxMin > 0))) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'filtre' });
  if (f.avec_lit && !typeId) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'type_id' });

  // Établissements visibles, distance et filtres en SQL ; « avec lit libre » : un lit libre du type qui respecte les besoins
  const conditions = ['e.actif', 'e.module_actif', 'e.config_id = ici.config_id', "(e.partage <> 'aucun' OR e.id = ici.id)"];
  const vals = [ici.id];
  if (maxMin) {
    vals.push(Number(cfg.facteur_route), cfg.vitesse_kmh, maxMin);
    conditions.push(`(e.id = ici.id OR ${SQL_DISTANCE} * $2::numeric / $3::numeric * 60 <= $4::numeric)`);
  }
  if (f.avec_lit) {
    vals.push(typeId);
    conditions.push(`(e.id = ici.id OR EXISTS (SELECT 1 FROM lits l WHERE l.etablissement_id = e.id AND l.type_id = $${vals.length} AND l.etat = 'libre'${filtreLit}))`);
  }
  const base = `FROM etablissements e, (SELECT id, latitude, longitude, config_id FROM etablissements WHERE id = $1) ici WHERE ${conditions.join(' AND ')}`;
  const total = (await pool.query(`SELECT count(*)::int AS n ${base}`, vals)).rows[0].n;
  vals.push(taille, (page - 1) * taille);
  const { rows } = await pool.query(
    `SELECT e.id, e.code, e.nom, e.ville, e.adresse, e.partage, e.latitude, e.longitude, (e.id = ici.id) AS moi, ${SQL_DISTANCE} AS distance_km
       ${base} ORDER BY (e.id = ici.id) DESC, distance_km, e.nom LIMIT $${vals.length - 1} OFFSET $${vals.length}`, vals);

  const ids = rows.map((r) => r.id);
  // Détail de la page : lits par type (libres adaptés aux besoins, avec personnel, prévus), patients en attente, civières
  const lits = ids.length ? (await pool.query(
    `SELECT l.etablissement_id, t.id AS type_id, t.code AS type_code, t.nom AS type_nom, t.ordre,
            count(*) FILTER (WHERE l.etat <> 'indispo')::int AS dotes,
            count(*) FILTER (WHERE l.etat = 'libre')::int AS libres_tous,
            count(*) FILTER (WHERE l.etat = 'libre'${filtreLit})::int AS libres,
            count(*) FILTER (WHERE l.etat = 'nettoyage' OR (l.etat = 'occupe' AND l.sortie_prevue BETWEEN now() AND now() + make_interval(hours => $2)))::int AS prevus
       FROM lits l JOIN types_unite t ON t.id = l.type_id
      WHERE l.etablissement_id = ANY($1::int[]) GROUP BY l.etablissement_id, t.id ORDER BY t.ordre`, [ids, cfg.horizon_h])).rows : [];
  const attente = ids.length ? new Map((await pool.query(
    `SELECT etablissement_id, count(*)::int AS n FROM demandes_admission WHERE statut = 'attente' AND etablissement_id = ANY($1::int[]) GROUP BY 1`, [ids])).rows
    .map((r) => [r.etablissement_id, r.n])) : new Map();
  const urgences = await cv.statsUrgence(pool, ids);

  const etablissements = rows.map((e) => {
    const complet = e.moi || e.partage === 'complet';
    const siens = lits.filter((l) => l.etablissement_id === e.id);
    const dotes = siens.reduce((a, l) => a + l.dotes, 0);
    const libres = siens.reduce((a, l) => a + l.libres_tous, 0);
    const u = urgences.get(e.id);
    const { niveau, pression } = s.niveauDepuis(dotes, libres, attente.get(e.id) || 0, cfg, u);
    return {
      id: e.id, nom: e.nom, ville: e.ville, adresse: e.adresse, moi: e.moi, partage: e.partage,
      latitude: e.latitude, longitude: e.longitude, distance_km: e.distance_km, minutes_route: e.moi ? 0 : s.minutesRoute(e.distance_km, cfg),
      niveau, pression,
      unites: siens.map((l) => ({ type_id: l.type_id, type_code: l.type_code, type_nom: l.type_nom, dotes: l.dotes, libres: l.libres, prevus: complet ? l.prevus : null })),
      urgence: u ? (complet
        ? { fonctionnelles: u.fonctionnelles, occupees: u.occupees, taux: u.taux, plus_24h: u.plus_24h, niveau: cv.niveauCivieres(u, cfg) }
        : { fonctionnelles: u.fonctionnelles, occupees: u.occupees, taux: u.taux, niveau: cv.niveauCivieres(u, cfg) }) : null,
    };
  });
  return { depuis: ici.id, total, page, taille, pages: Math.max(1, Math.ceil(total / taille)), etablissements };
}

/** Points de la carte : tous les établissements filtrés, position et niveau d'alerte (calculé en quelques requêtes groupées). */
async function carte(pool, utilisateur, depuisId) {
  exigerEtablissement(utilisateur, depuisId);
  const ici = await s.etablissement(pool, depuisId);
  s.exigerActif(ici);
  const cfg = ici.config;
  const { rows } = await pool.query(
    `SELECT e.id, e.nom, e.ville, e.latitude, e.longitude, (e.id = $1) AS moi,
            count(l.*) FILTER (WHERE l.etat <> 'indispo')::int AS dotes, count(l.*) FILTER (WHERE l.etat = 'libre')::int AS libres,
            (SELECT count(*)::int FROM demandes_admission d WHERE d.etablissement_id = e.id AND d.statut = 'attente') AS attente
       FROM etablissements e LEFT JOIN lits l ON l.etablissement_id = e.id
      WHERE e.actif AND e.module_actif AND e.config_id = $2 AND (e.partage <> 'aucun' OR e.id = $1)
      GROUP BY e.id`, [ici.id, ici.config_id]);
  const urgences = await cv.statsUrgence(pool, rows.map((r) => r.id));
  return rows.map((r) => ({ id: r.id, nom: r.nom, ville: r.ville, latitude: r.latitude, longitude: r.longitude, moi: r.moi, libres: r.libres,
    niveau: s.niveauDepuis(r.dotes, r.libres, r.attente, cfg, urgences.get(r.id)).niveau }));
}

module.exports = { national, carte };
