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
const accesVehicules = require('./acces-vehicules-secours');

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
  require('./flux').signaler();
  return r;
}

async function organisationsDe(db, u) {
  // Système externe (Arrimo Connect) : son organisation seulement, avec ses profils
  if (u.connecteur) return [{ id: u.connecteur.organisation_id, profils: u.connecteur.profils, config_id: u.connecteur.config_id }];
  return (await db.query(`SELECT o.id, o.profils, o.config_id FROM utilisateur_organisations uo JOIN organisations_secours o ON o.id = uo.organisation_id
    WHERE uo.utilisateur_id = $1 AND o.actif`, [u.id])).rows;
}

/** Vérification commune aux changements d'état et aux affectations, après verrouillage de l'unité. */
async function missionActive(c, uniteId) {
  const r = await c.query(`SELECT
    EXISTS (SELECT 1 FROM prealertes WHERE unite_id = $1 AND statut NOT IN ('cloturee', 'annulee', 'remplacee'))
    OR EXISTS (SELECT 1 FROM missions_ccs WHERE unite_id = $1 AND statut IN ('proposee', 'acceptee', 'sur_place'))
    OR EXISTS (SELECT 1 FROM demandes_transport d LEFT JOIN etats_vehicules ev ON ev.unite_id = d.unite_id
      WHERE d.unite_id = $1 AND (d.statut IN ('en_route', 'pris_en_charge') OR
        (d.statut = 'arrivee' AND d.motif_transport IS NOT NULL AND d.terminee_le IS NULL
          AND ev.etat = 'a_l_hopital' AND ev.source = 'transport' AND ev.modifie_le = d.arrivee_le))) AS occupe`, [uniteId]);
  return r.rows[0].occupe;
}

/** L'équipage change l'état de son véhicule (un geste). La destination n'est gardée que pour les états qui en ont une. */
async function definir(pool, u, uniteId, b) {
  if (!ROLES_AMBULANCE.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const orgs = (await organisationsDe(pool, u)).filter((o) => o.profils.includes('ambulance')).map((o) => o.id);
  const etat = String(b.etat || '');
  if (!ETATS.includes(etat)) throw new ErreurHttp(400, 'etat_vehicule_invalide');
  return transaction(pool, async (c) => {
    const un = (await c.query('SELECT id, organisation_id FROM unites_secours WHERE id = $1 AND actif FOR UPDATE', [entier(uniteId)])).rows[0];
    if (!un || !orgs.includes(un.organisation_id) || !(await accesVehicules.autorise(c, u, un.organisation_id, un.id))) throw new ErreurHttp(404, 'unite_introuvable');
    const avant = (await c.query('SELECT * FROM etats_vehicules WHERE unite_id = $1', [un.id])).rows[0];
    if (b.version != null && avant && Number(b.version) !== avant.version) throw new ErreurHttp(409, 'version_perimee');
    if (etat === 'disponible' && await missionActive(c, un.id)) throw new ErreurHttp(409, 'vehicule_mission_active');
    return fixer(c, un.id, etat, { destinationId: avant?.destination_id || null, source: 'equipage', utilisateurId: u.id || null });
  });
}

/** Véhicules visibles : ceux de l'organisation (ambulance) ou ceux de la région (CCS, lecture seule). Position récente si l'équipe la partage. */
async function liste(pool, u, { uniteId = null } = {}) {
  const orgs = await organisationsDe(pool, u);
  let filtre; let args;
  if (ROLES_AMBULANCE.includes(u.role) && !(u.connecteur && u.connecteur.profils.includes('ccs'))) {
    const ids = orgs.filter((o) => o.profils.includes('ambulance')).map((o) => o.id);
    if (!ids.length) throw new ErreurHttp(403, 'organisation_interdite');
    filtre = 'o.id = ANY($1)'; args = [ids];
  } else if (u.role === 'repartiteur' || u.connecteur?.profils.includes('ccs')) {
    const cfg = orgs.filter((o) => o.profils.includes('ccs')).map((o) => o.config_id);
    if (!cfg.length) throw new ErreurHttp(403, 'organisation_interdite');
    filtre = "o.config_id = ANY($1) AND 'ambulance' = ANY(o.profils)"; args = [cfg];
  } else throw new ErreurHttp(403, 'role_insuffisant');
  const rangUnite = args.push(uniteId);
  const droits = accesVehicules.concerne(u) ? ` AND ${accesVehicules.condition('o', 'un.id', args.push(u.id))}` : '';
  return (await pool.query(`SELECT un.id, un.numero, un.plaque, un.type_vehicule, o.nom AS organisation, ev.etat, ev.source, ev.version, ev.modifie_le,
      ev.destination_id, e.nom AS destination,
      (SELECT json_build_object('latitude', pu.latitude, 'longitude', pu.longitude, 'le', pu.enregistree_le) FROM positions_unites pu
        WHERE pu.unite_id = un.id AND pu.enregistree_le > now() - interval '30 minutes' AND COALESCE(ev.etat, 'disponible') <> 'hors_service'
        ORDER BY pu.enregistree_le DESC LIMIT 1) AS position,
      -- Mission en cours de l'unité (préalerte ouverte, sinon transport ouvert) : même statut sur tous les écrans
      (SELECT json_build_object('type', m.type, 'numero', m.numero, 'statut', m.statut) FROM (
          SELECT 'prealerte' AS type, p.numero, p.statut, p.modifie_le FROM prealertes p WHERE p.unite_id = un.id AND p.statut NOT IN ('cloturee', 'annulee', 'remplacee')
          UNION ALL SELECT 'transport', d.numero, d.statut, d.modifie_le FROM demandes_transport d WHERE d.unite_id = un.id AND (d.statut IN ('acceptee', 'en_route', 'pris_en_charge')
            OR (d.statut = 'arrivee' AND d.motif_transport IS NOT NULL AND d.terminee_le IS NULL
              AND ev.etat = 'a_l_hopital' AND ev.source = 'transport' AND ev.modifie_le = d.arrivee_le))
          UNION ALL SELECT 'mission', mi.numero, mi.statut, mi.modifie_le FROM missions_ccs mi WHERE mi.unite_id = un.id AND mi.statut IN ('proposee', 'acceptee', 'sur_place')
        ) m ORDER BY m.modifie_le DESC LIMIT 1) AS mission
    FROM unites_secours un JOIN organisations_secours o ON o.id = un.organisation_id
    LEFT JOIN etats_vehicules ev ON ev.unite_id = un.id LEFT JOIN etablissements e ON e.id = ev.destination_id
    WHERE un.actif AND o.actif AND ${filtre} AND ($${rangUnite}::int IS NULL OR un.id = $${rangUnite})${droits} ORDER BY o.nom, un.numero`, args)).rows;
}

/** Fiche et historique opérationnel dans le même périmètre que la flotte. */
async function fiche(pool, u, uniteId) {
  const [vehicule] = await liste(pool, u, { uniteId });
  if (!vehicule) throw new ErreurHttp(404, 'unite_introuvable');
  const [etats, transports] = await Promise.all([
    pool.query(`SELECT v.etat, v.source, v.cree_le, e.nom AS destination
      FROM etat_vehicule_evenements v LEFT JOIN etablissements e ON e.id = v.destination_id
      WHERE v.unite_id = $1 ORDER BY v.id DESC LIMIT 30`, [vehicule.id]),
    pool.query(`SELECT d.id, d.numero, d.statut, d.cree_le, d.acceptee_le, d.en_route_le, d.arrivee_le, d.remis_le, d.terminee_le,
        eo.nom AS origine, COALESCE(ed.nom, d.destination_libelle) AS destination
      FROM demandes_transport d JOIN unites_secours un ON un.id = d.unite_id AND un.organisation_id = d.organisation_id
      JOIN etablissements eo ON eo.id = d.origine_id LEFT JOIN etablissements ed ON ed.id = d.destination_id
      WHERE un.id = $1 AND d.statut <> 'a_valider' ORDER BY d.cree_le DESC, d.id DESC LIMIT 20`, [vehicule.id]),
  ]);
  return { vehicule, etats: etats.rows, transports: transports.rows };
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

/** Capacités des urgences (tenues à jour par chaque hôpital dans Arrimo) : civières, statut déclaré, services ouverts, soins intensifs. */
async function capacites(pool, hop) {
  const ids = hop.map((e) => e.id);
  const cv = require('./civieres'); const pa = require('./prealertes');
  const stats = await cv.statsUrgence(pool, ids);
  const services = (await pool.query(`SELECT etablissement_id, attributs FROM services WHERE actif AND etablissement_id = ANY($1)`, [ids])).rows;
  const si = (await pool.query(`SELECT l.etablissement_id, count(*)::int AS total, count(*) FILTER (WHERE l.etat = 'libre')::int AS libres
    FROM lits l JOIN unites un ON un.id = l.unite_id JOIN types_unite t ON t.id = un.type_id WHERE t.code = 'SI' AND un.actif AND l.etablissement_id = ANY($1)
    GROUP BY l.etablissement_id`, [ids])).rows;
  return hop.map((e) => {
    const st = stats.get(e.id);
    const sv = services.filter((x) => x.etablissement_id === e.id);
    const ouverts = sv.length ? SERVICES_URGENCE.filter(([, cat]) => sv.some((x) => (cat ? (x.attributs?.categories_secours || []).includes(cat) : x.attributs?.secours_defaut === true))).map(([code]) => code) : null;
    const lits = si.find((x) => x.etablissement_id === e.id);
    return { id: e.id, nom: e.nom, ville: e.ville, latitude: e.latitude, longitude: e.longitude,
      liaison_secours: TE.moduleActif(e, 'liaison_secours'), chrono: TE.moduleActif(e, 'chrono'),
      urgence: st ? { niveau: cv.niveauCivieres(st, e), civieres_libres: st.libres, taux: st.fonctionnelles > 0 ? st.taux : null } : null,
      statut_declare: pa.declaration(e), services_ouverts: ouverts, soins_intensifs: lits ? { libres: lits.libres, total: lits.total } : null };
  });
}
const SQL_HOPITAUX = `SELECT e.id, e.nom, e.ville, e.latitude, e.longitude, e.modules, e.type_etablissement,
    e.urgence_statut_declare, e.urgence_statut_le, e.reouverture_prevue_le, c.disponibilite_fraicheur_min, c.seuil_civieres_jaune, c.seuil_civieres_orange, c.seuil_civieres_rouge
  FROM etablissements e JOIN config_pays c ON c.id = e.config_id WHERE e.actif AND e.config_id = ANY($1) AND COALESCE(e.type_etablissement, 'hopital') = 'hopital'`;
// Disponibilité : 0 disponible, 1 capacité limitée ou tendue, 2 saturation ou délestage, 3 inconnue
function rangDisponibilite(h) {
  if (h.ecartee) return 4;
  const d = h.statut_declare && !h.statut_declare.perime ? h.statut_declare.statut : null;
  if (d === 'saturation' || d === 'delestage' || h.urgence?.niveau === 'rouge' || h.urgence?.civieres_libres === 0) return 2;
  if (d === 'capacite_limitee' || ['jaune', 'orange'].includes(h.urgence?.niveau)) return 1;
  return h.urgence || d ? 0 : 3;
}
/**
 * Classement des urgences depuis un point de départ : temps de route OSRM (distance à vol d'oiseau si le routeur ne répond pas),
 * tri par disponibilité puis temps de route. Le premier est le « meilleur choix » signalé par OG : une information, jamais une décision.
 */
async function classer(hops, depart, { categorie = null, pool = null } = {}) {
  // Urgences en direct : une urgence fermée (ou dont le service de la catégorie est fermé) est écartée, avec la raison
  if (pool && hops.length) {
    const ud = require('./urgences-direct');
    const f = await ud.fermeturesEnCours(pool, hops.map((h) => h.id));
    for (const h of hops) { const e = ud.ecartee(h, f.get(h.id), categorie); if (e) h.ecartee = e; }
  }
  let routes = null; let source = null;
  if (depart) {
    source = 'osrm';
    try { routes = (await require('./routage').matrice(depart, hops.filter((h) => h.latitude != null))).routes; }
    catch { source = 'vol_oiseau'; }
  }
  const avecCoord = hops.filter((h) => h.latitude != null);
  const lignes = hops.map((h) => {
    const r = routes ? routes[avecCoord.indexOf(h)] : null;
    return { ...h, temps_min: r ? r.duree_min : null, distance_km: r ? r.distance_km : depart ? km(depart, h) : null, source_distance: r ? 'osrm' : depart ? 'vol_oiseau' : null, rang: rangDisponibilite(h) };
  }).sort((a, b) => a.rang - b.rang || (a.temps_min ?? 1e6) - (b.temps_min ?? 1e6) || (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9) || a.nom.localeCompare(b.nom));
  const meilleur = depart ? lignes.find((l) => l.rang < 2) : null;
  return { depart: depart ? { latitude: depart.latitude, longitude: depart.longitude, le: depart.le || null, nom: depart.nom || null } : null,
    ...(!depart ? { sans_position: true } : {}), source, urgences: lignes,
    og: meilleur ? { id: meilleur.id, nom: meilleur.nom, temps_min: meilleur.temps_min, distance_km: meilleur.distance_km, civieres_libres: meilleur.urgence?.civieres_libres ?? null,
      services_ouverts: meilleur.services_ouverts } : null };
}

/**
 * Urgences proches pour un établissement d'hébergement (module Liaison Établissements actif) : capacités globales seulement,
 * classées depuis l'établissement. Jamais de référence patient, de civière nominative ni de donnée clinique.
 */
async function urgencesProches(pool, u, etabId) {
  const id = entier(etabId); if (!id) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, id);
  if (!ROLES_ETAB.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const ici = (await pool.query('SELECT id, nom, latitude, longitude, type_etablissement, modules FROM etablissements WHERE id = $1 AND actif', [id])).rows[0];
  if (!ici) throw new ErreurHttp(404, 'etab_introuvable');
  if ((ici.type_etablissement || 'hopital') === 'hopital') throw new ErreurHttp(403, 'role_insuffisant');
  if (!TE.moduleActif(ici, 'transport_ambulancier')) throw new ErreurHttp(403, 'module_desactive', { module: 'transport_ambulancier' });
  const hops = await capacites(pool, (await pool.query(SQL_HOPITAUX, [await configsRegion(pool, id)])).rows);
  // Les 8 plus proches à vol d'oiseau sont classées par le routeur (requête légère) ; les autres suivent
  const proches = hops.map((h) => ({ ...h, vol: km(ici, h) })).sort((a, b) => (a.vol ?? 1e9) - (b.vol ?? 1e9));
  const c = await classer(proches.slice(0, 8).map(({ vol, ...h }) => h), ici, { pool });
  const reste = proches.slice(8).map(({ vol, ...h }) => ({ ...h, distance_km: vol, temps_min: null, source_distance: 'vol_oiseau', rang: rangDisponibilite(h) }));
  return [...c.urgences, ...reste];
}

/** Point de départ d'un classement pour les secours : une unité (dernière position, 24 h) ou un établissement d'hébergement de la région. */
async function urgencesClassees(pool, u, q = {}) {
  const orgs = await organisationsDe(pool, u);
  const ccs = u.role === 'repartiteur' || Boolean(u.connecteur?.profils.includes('ccs')); const ambulance = ROLES_AMBULANCE.includes(u.role) && !ccs;
  if (!ambulance && !ccs) throw new ErreurHttp(403, 'role_insuffisant');
  const voit = ambulance ? orgs.filter((o) => o.profils.includes('ambulance')) : orgs.filter((o) => o.profils.includes('ccs'));
  if (!voit.length) throw new ErreurHttp(403, 'organisation_interdite');
  const cfgs = [...new Set(voit.map((o) => o.config_id))];
  let depart = null;
  if (q.unite_id) {
    const un = (await pool.query(`SELECT un.id, un.numero, un.organisation_id, o.config_id, o.profils FROM unites_secours un JOIN organisations_secours o ON o.id = un.organisation_id
      WHERE un.id = $1 AND un.actif`, [entier(q.unite_id)])).rows[0];
    if (!un || (ambulance ? !voit.some((o) => o.id === un.organisation_id) : !cfgs.includes(un.config_id))) throw new ErreurHttp(404, 'unite_introuvable');
    if (!(await accesVehicules.autorise(pool, u, un.organisation_id, un.id))) throw new ErreurHttp(404, 'unite_introuvable');
    const pos = (await pool.query(`SELECT latitude, longitude, enregistree_le AS le FROM positions_unites WHERE unite_id = $1 AND enregistree_le > now() - interval '24 hours'
      ORDER BY enregistree_le DESC LIMIT 1`, [un.id])).rows[0];
    if (pos) depart = { ...pos, nom: un.numero };
  } else if (q.etablissement_id) {
    const e = (await pool.query(`SELECT e.id, e.nom, e.latitude, e.longitude FROM etablissements e JOIN config_pays c ON c.id = e.config_id WHERE e.id = $1 AND e.actif
      AND COALESCE(e.type_etablissement, 'hopital') <> 'hopital' AND (e.config_id = ANY($2) OR regexp_replace(c.code, '-CHSLD$', '') IN (SELECT code FROM config_pays WHERE id = ANY($2)))`,
    [entier(q.etablissement_id), cfgs])).rows[0];
    if (!e) throw new ErreurHttp(404, 'etab_introuvable');
    depart = e;
  } else if (q.latitude != null && q.longitude != null && Math.abs(Number(q.latitude)) <= 90 && Math.abs(Number(q.longitude)) <= 180) {
    depart = { latitude: Number(q.latitude), longitude: Number(q.longitude), nom: null };
  } else if (q.capacites_seules !== '1') throw new ErreurHttp(400, 'parametre_invalide', { nom: 'unite_id' });
  // Hôpitaux qui reçoivent les préalertes (Liaison Secours actif) dans la région
  const hops = (await pool.query(SQL_HOPITAUX, [cfgs])).rows.filter((e) => TE.moduleActif(e, 'liaison_secours'));
  return classer(await capacites(pool, hops), depart, { pool, categorie: q.categorie ? String(q.categorie) : null });
}

/** Établissements d'hébergement de la région (nom et position seulement) : symboles de la carte des secours. */
async function hebergements(pool, u) {
  const orgs = await organisationsDe(pool, u);
  if (!orgs.length) throw new ErreurHttp(403, 'organisation_interdite');
  return (await pool.query(`SELECT e.id, e.nom, e.ville, e.latitude, e.longitude FROM etablissements e JOIN config_pays c ON c.id = e.config_id
    WHERE e.actif AND COALESCE(e.type_etablissement, 'hopital') <> 'hopital' AND e.latitude IS NOT NULL
      AND (e.config_id = ANY($1) OR regexp_replace(c.code, '-CHSLD$', '') IN (SELECT code FROM config_pays WHERE id = ANY($1))) ORDER BY e.nom`,
  [[...new Set(orgs.map((o) => o.config_id))]])).rows;
}

module.exports = { ETATS, fixer, definir, liste, fiche, missionActive, urgencesProches, urgencesClassees, hebergements, classer, rangDisponibilite };
