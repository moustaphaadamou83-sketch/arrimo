'use strict';
/**
 * État des véhicules et urgences proches (décisions de Moustafa, 13 nov. 2026).
 * - Le CCS voit l'état des ambulances de sa région (carte et liste) : aucune attribution ni répartition dans Arrimo.
 * - L'équipage change l'état en un geste ; Arrimo le passe seul à « Transport vers l'hôpital » à l'envoi d'une préalerte
 *   et à « À l'hôpital » quand l'hôpital confirme l'arrivée du bon véhicule. Chaque changement est historisé (immuable).
 * - Un établissement d'hébergement (CHSLD, RPA, RI, RTF, maison des aînés) voit les urgences proches (capacités globales :
 *   civières libres, statut déclaré, services ouverts, lits de soins intensifs à titre d'information) et le transport de
 *   SES résidents seulement. Aucune donnée d'un autre patient ; Arrimo informe, l'équipage et les protocoles décident.
 */
const { transaction, ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const TE = require('./types-etablissement');

const ETATS = ['disponible', 'en_route', 'sur_place', 'transport_hopital', 'a_l_hopital', 'hors_service'];
const AVEC_DESTINATION = ['transport_hopital', 'a_l_hopital'];
const ROLES_AMBULANCE = ['paramedic', 'superviseur_secours'];
const ROLES_ETAB = ['coordonnateur', 'admin_etab', 'gestionnaire', 'equipe_soins'];
// Services montrés aux établissements d'hébergement : catégorie de préalerte qui désigne chacun (règles de l'hôpital)
const SERVICES_URGENCE = [['urgence_generale', null], ['cardiologie', 'cardiaque'], ['neurologie', 'neurologique'], ['traumatologie', 'traumatologie']];
const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

/** Change l'état d'une unité dans la transaction en cours (équipage, préalerte ou arrivée confirmée) et l'inscrit à l'historique. */
async function fixer(c, uniteId, etat, { destinationId = null, source = 'equipage', utilisateurId = null } = {}) {
  if (!ETATS.includes(etat)) throw new ErreurHttp(400, 'etat_vehicule_invalide');
  const dest = AVEC_DESTINATION.includes(etat) ? destinationId : null;
  const r = (await c.query(`INSERT INTO etats_vehicules (unite_id, etat, destination_id, source, modifie_par) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (unite_id) DO UPDATE SET etat = EXCLUDED.etat, destination_id = EXCLUDED.destination_id, source = EXCLUDED.source,
      modifie_par = EXCLUDED.modifie_par, modifie_le = now(), version = etats_vehicules.version + 1 RETURNING *`,
  [uniteId, etat, dest, source, utilisateurId])).rows[0];
  await c.query('INSERT INTO etat_vehicule_evenements (unite_id, etat, destination_id, source, utilisateur_id) VALUES ($1, $2, $3, $4, $5)',
    [uniteId, etat, dest, source, utilisateurId]);
  return r;
}

async function organisationsDe(db, u) {
  return (await db.query(`SELECT o.id, o.profils, o.config_id FROM utilisateur_organisations uo JOIN organisations_secours o ON o.id = uo.organisation_id
    WHERE uo.utilisateur_id = $1 AND o.actif`, [u.id])).rows;
}

/** L'équipage change l'état de son véhicule (un geste). La destination n'est gardée que pour les états qui en ont une. */
async function definir(pool, u, uniteId, b) {
  if (!ROLES_AMBULANCE.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const orgs = (await organisationsDe(pool, u)).filter((o) => o.profils.includes('ambulance')).map((o) => o.id);
  const etat = String(b.etat || '');
  if (!ETATS.includes(etat)) throw new ErreurHttp(400, 'etat_vehicule_invalide');
  return transaction(pool, async (c) => {
    const un = (await c.query('SELECT id, organisation_id FROM unites_secours WHERE id = $1 AND actif FOR UPDATE', [entier(uniteId)])).rows[0];
    if (!un || !orgs.includes(un.organisation_id)) throw new ErreurHttp(404, 'unite_introuvable');
    const avant = (await c.query('SELECT * FROM etats_vehicules WHERE unite_id = $1', [un.id])).rows[0];
    if (b.version != null && avant && Number(b.version) !== avant.version) throw new ErreurHttp(409, 'version_perimee');
    return fixer(c, un.id, etat, { destinationId: avant?.destination_id || null, source: 'equipage', utilisateurId: u.id });
  });
}

/** Véhicules visibles : ceux de l'organisation (ambulance) ou ceux de la région (CCS, lecture seule). Position récente si l'équipe la partage. */
async function liste(pool, u) {
  const orgs = await organisationsDe(pool, u);
  let filtre; let args;
  if (ROLES_AMBULANCE.includes(u.role)) {
    const ids = orgs.filter((o) => o.profils.includes('ambulance')).map((o) => o.id);
    if (!ids.length) throw new ErreurHttp(403, 'organisation_interdite');
    filtre = 'o.id = ANY($1)'; args = [ids];
  } else if (u.role === 'repartiteur') {
    const cfg = orgs.filter((o) => o.profils.includes('ccs')).map((o) => o.config_id);
    if (!cfg.length) throw new ErreurHttp(403, 'organisation_interdite');
    filtre = "o.config_id = ANY($1) AND 'ambulance' = ANY(o.profils)"; args = [cfg];
  } else throw new ErreurHttp(403, 'role_insuffisant');
  return (await pool.query(`SELECT un.id, un.numero, un.plaque, o.nom AS organisation, ev.etat, ev.source, ev.version, ev.modifie_le,
      ev.destination_id, e.nom AS destination,
      (SELECT json_build_object('latitude', pu.latitude, 'longitude', pu.longitude, 'le', pu.enregistree_le) FROM positions_unites pu
        WHERE pu.unite_id = un.id AND pu.enregistree_le > now() - interval '30 minutes' ORDER BY pu.enregistree_le DESC LIMIT 1) AS position
    FROM unites_secours un JOIN organisations_secours o ON o.id = un.organisation_id
    LEFT JOIN etats_vehicules ev ON ev.unite_id = un.id LEFT JOIN etablissements e ON e.id = ev.destination_id
    WHERE un.actif AND o.actif AND ${filtre} ORDER BY o.nom, un.numero`, args)).rows;
}

/** Profils de la région d'un établissement : le sien et, pour un établissement d'hébergement, le profil de base (« QC-CHSLD » → « QC »). */
async function configsRegion(db, etabId) {
  return (await db.query(`SELECT c.id FROM config_pays c WHERE c.id = (SELECT config_id FROM etablissements WHERE id = $1)
    OR c.code = regexp_replace((SELECT c2.code FROM config_pays c2 JOIN etablissements e ON e.config_id = c2.id WHERE e.id = $1), '-CHSLD$', '')`, [etabId])).rows.map((r) => r.id);
}
const km = (a, b) => {
  if (a.latitude == null || b.latitude == null) return null;
  const r = (x) => x * Math.PI / 180; const dLat = r(b.latitude - a.latitude); const dLon = r(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
};

/**
 * Urgences proches pour un établissement d'hébergement (module Liaison Établissements actif) : capacités globales seulement.
 * Jamais de référence patient, de civière nominative ni de donnée clinique.
 */
async function urgencesProches(pool, u, etabId) {
  const id = entier(etabId); if (!id) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, id);
  if (!ROLES_ETAB.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const ici = (await pool.query('SELECT id, latitude, longitude, type_etablissement, modules FROM etablissements WHERE id = $1 AND actif', [id])).rows[0];
  if (!ici) throw new ErreurHttp(404, 'etab_introuvable');
  if ((ici.type_etablissement || 'hopital') === 'hopital') throw new ErreurHttp(403, 'role_insuffisant');
  if (!TE.moduleActif(ici, 'transport_ambulancier')) throw new ErreurHttp(403, 'module_desactive', { module: 'transport_ambulancier' });
  const hop = (await pool.query(`SELECT e.id, e.nom, e.ville, e.latitude, e.longitude, e.modules, e.type_etablissement,
      e.urgence_statut_declare, e.urgence_statut_le, c.disponibilite_fraicheur_min, c.seuil_civieres_jaune, c.seuil_civieres_orange, c.seuil_civieres_rouge
    FROM etablissements e JOIN config_pays c ON c.id = e.config_id WHERE e.actif AND e.config_id = ANY($1) AND COALESCE(e.type_etablissement, 'hopital') = 'hopital'`,
  [await configsRegion(pool, id)])).rows;
  const ids = hop.map((e) => e.id);
  const cv = require('./civieres'); const pa = require('./prealertes');
  const stats = await cv.statsUrgence(pool, ids);
  const services = (await pool.query(`SELECT etablissement_id, attributs FROM services WHERE actif AND etablissement_id = ANY($1)`, [ids])).rows;
  const si = (await pool.query(`SELECT l.etablissement_id, count(*)::int AS total, count(*) FILTER (WHERE l.etat = 'libre')::int AS libres
    FROM lits l JOIN unites un ON un.id = l.unite_id JOIN types_unite t ON t.id = un.type_id WHERE t.code = 'SI' AND un.actif AND l.etablissement_id = ANY($1)
    GROUP BY l.etablissement_id`, [ids])).rows;
  return hop.map((e) => {
    const st = stats.get(e.id);
    const sv = services.filter((s) => s.etablissement_id === e.id);
    const ouverts = sv.length ? SERVICES_URGENCE.filter(([, cat]) => sv.some((s) => (cat ? (s.attributs?.categories_secours || []).includes(cat) : s.attributs?.secours_defaut === true))).map(([code]) => code) : null;
    const lits = si.find((x) => x.etablissement_id === e.id);
    return { id: e.id, nom: e.nom, ville: e.ville, latitude: e.latitude, longitude: e.longitude, distance_km: km(ici, e),
      liaison_secours: TE.moduleActif(e, 'liaison_secours'),
      urgence: st ? { niveau: cv.niveauCivieres(st, e), civieres_libres: st.libres } : null,
      statut_declare: pa.declaration(e), services_ouverts: ouverts, soins_intensifs: lits ? { libres: lits.libres, total: lits.total } : null };
  }).sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9) || a.nom.localeCompare(b.nom));
}

module.exports = { ETATS, fixer, definir, liste, urgencesProches };
