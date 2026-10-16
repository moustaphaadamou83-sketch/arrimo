/**
 * Alerte « disponibilité à côté » : quand un lit ou une civière se libère, les hôpitaux proches qui en ont besoin sont avisés.
 * - Proche : à moins du rayon d'alerte du receveur (etablissements.rayon_alerte_km, 10 km par défaut).
 * - Besoin : des patients attendent un lit de ce type d'unité, ou l'hôpital est au niveau orange ou rouge
 *   (pour une civière : des patients attendent en corridor, ou l'urgence est au niveau orange ou rouge).
 * - Pas de spam : au plus une alerte par type d'unité (ou pour les civières) et par hôpital toutes les 10 minutes,
 *   regroupée : elle indique aussi combien d'autres établissements proches ont de la place.
 * Appelée dans la transaction qui libère le lit : si le changement est annulé, l'alerte l'est aussi.
 */
const { notifier, niveauDepuis, minutesRoute } = require('./services');
const { duree } = require('./langue');
const cv = require('./civieres');

const DELAI_MIN = 10;
const SQL_DISTANCE = (a, b) => `round(2 * 6371 * asin(sqrt(power(sin(radians(${b}.latitude - ${a}.latitude) / 2), 2)
  + cos(radians(${a}.latitude)) * cos(radians(${b}.latitude)) * power(sin(radians(${b}.longitude - ${a}.longitude) / 2), 2))))::int`;

/** Receveurs proches d'un établissement source, avec ce qu'il faut pour juger du besoin. */
async function receveurs(c, sourceId, typeId) {
  const { rows } = await c.query(
    `SELECT r.id, r.rayon_alerte_km, ${SQL_DISTANCE('s', 'r')} AS distance_km, row_to_json(cfg.*) AS cfg,
            (SELECT count(*)::int FROM demandes_admission d WHERE d.etablissement_id = r.id AND d.statut = 'attente' AND ($2::int IS NULL OR d.type_id = $2)) AS attente_type,
            (SELECT count(*)::int FROM demandes_admission d WHERE d.etablissement_id = r.id AND d.statut = 'attente') AS attente,
            (SELECT count(*) FILTER (WHERE l.etat <> 'indispo')::int FROM lits l WHERE l.etablissement_id = r.id) AS dotes,
            (SELECT count(*) FILTER (WHERE l.etat = 'libre')::int FROM lits l WHERE l.etablissement_id = r.id) AS libres
       FROM etablissements s JOIN etablissements r ON r.config_id = s.config_id AND r.id <> s.id AND r.actif AND r.module_actif
       JOIN config_pays cfg ON cfg.id = r.config_id
      WHERE s.id = $1 AND ${SQL_DISTANCE('s', 'r')} <= r.rayon_alerte_km`, [sourceId, typeId]);
  return rows;
}

/** Établissements proches du receveur (sauf la source) qui ont aussi de la place : pour regrouper l'alerte. */
async function autresAvecPlace(c, receveurId, sourceId, rayon, typeId) {
  const cond = typeId ? `EXISTS (SELECT 1 FROM lits l WHERE l.etablissement_id = e.id AND l.type_id = $4 AND l.etat = 'libre')`
    : `EXISTS (SELECT 1 FROM civieres v WHERE v.etablissement_id = e.id AND v.etat = 'libre' AND v.categorie = 'reguliere')`;
  const vals = [receveurId, sourceId, rayon]; if (typeId) vals.push(typeId);
  return (await c.query(
    `SELECT count(*)::int AS n FROM etablissements r JOIN etablissements e ON e.config_id = r.config_id
      WHERE r.id = $1 AND e.id NOT IN ($1, $2) AND e.actif AND e.module_actif AND e.partage <> 'aucun'
        AND ${SQL_DISTANCE('r', 'e')} <= $3 AND ${cond}`, vals)).rows[0].n;
}

/** Envoie l'alerte au receveur si aucune alerte du même genre n'est partie depuis 10 minutes. */
async function envoyer(c, r, code, vars, cle) {
  const recente = await c.query(
    `SELECT 1 FROM notifications WHERE etablissement_id = $1 AND code IN ('dispo_lit', 'dispo_civiere') AND vars->>'cle' = $2
        AND date > now() - make_interval(mins => $3) LIMIT 1`, [r.id, cle, DELAI_MIN]);
  if (recente.rows[0]) return false;
  // Texte enregistré en français ; type d'unité et durée remis dans la langue du lecteur à l'affichage
  await notifier(c, r.id, null, code, { ...vars, cle, duree: duree('fr', vars.min), ...(vars.type_nom ? { type: vars.type_nom.toLowerCase() } : {}) });
  return true;
}

/** Un lit vient de se libérer (dans la transaction `c`). Retourne le nombre d'hôpitaux avisés. */
async function litLibere(c, litId) {
  const s = (await c.query(
    `SELECT l.etablissement_id, l.type_id, t.nom AS type_nom, e.nom, e.partage, e.module_actif,
            (SELECT count(*)::int FROM lits x WHERE x.etablissement_id = l.etablissement_id AND x.type_id = l.type_id AND x.etat = 'libre') AS libres
       FROM lits l JOIN types_unite t ON t.id = l.type_id JOIN etablissements e ON e.id = l.etablissement_id WHERE l.id = $1`, [litId])).rows[0];
  if (!s || s.partage === 'aucun' || !s.module_actif) return 0;
  let n = 0;
  const rs = await receveurs(c, s.etablissement_id, s.type_id);
  const urg = await cv.statsUrgence(c, rs.map((r) => r.id));
  for (const r of rs) {
    const { niveau } = niveauDepuis(r.dotes, r.libres, r.attente, r.cfg, urg.get(r.id));
    if (!r.attente_type && !['orange', 'rouge'].includes(niveau)) continue;
    const autres = await autresAvecPlace(c, r.id, s.etablissement_id, r.rayon_alerte_km, s.type_id);
    if (await envoyer(c, r, 'dispo_lit', { type_nom: s.type_nom, type_id: s.type_id, etab: s.nom, etab_id: s.etablissement_id, km: r.distance_km,
      min: minutesRoute(r.distance_km, r.cfg), n: s.libres, autres, attente: r.attente_type }, `lit-${s.type_id}`)) n += 1;
  }
  return n;
}

/** Une civière régulière vient de se libérer : avise les urgences proches qui ont des patients en corridor ou qui débordent. */
async function civiereLiberee(c, civiereId) {
  const s = (await c.query(
    `SELECT v.etablissement_id, v.categorie, e.nom, e.partage, e.module_actif FROM civieres v JOIN etablissements e ON e.id = v.etablissement_id WHERE v.id = $1`,
    [civiereId])).rows[0];
  if (!s || s.categorie !== 'reguliere' || s.partage === 'aucun' || !s.module_actif) return 0;
  let n = 0;
  const rs = await receveurs(c, s.etablissement_id, null);
  const urg = await cv.statsUrgence(c, rs.map((r) => r.id));
  for (const r of rs) {
    const u = urg.get(r.id);
    if (!u || !(u.en_corridor > 0 || ['orange', 'rouge'].includes(cv.niveauCivieres(u, r.cfg)))) continue;
    const autres = await autresAvecPlace(c, r.id, s.etablissement_id, r.rayon_alerte_km, null);
    if (await envoyer(c, r, 'dispo_civiere', { etab: s.nom, etab_id: s.etablissement_id, km: r.distance_km, min: minutesRoute(r.distance_km, r.cfg),
      n: 1, autres, attente: u.en_corridor }, 'civiere')) n += 1;
  }
  return n;
}

module.exports = { litLibere, civiereLiberee, DELAI_MIN };
