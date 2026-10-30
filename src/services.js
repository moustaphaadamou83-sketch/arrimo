const { transaction, ErreurHttp } = require('./db');
const { changerEtat, journaliser } = require('./regles');
const { exigerEtablissement, peutAgirPour } = require('./auth');
const { tr, dico, traducteurTypes, duree } = require('./langue');
const cv = require('./civieres');
const routage = require('./routage');

/* ------------------------------------------------------------------ outils */
function distanceKm(a, b) {
  const r = (x) => (x * Math.PI) / 180;
  const dLat = r(b.latitude - a.latitude);
  const dLon = r(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
}

async function etablissement(db, id) {
  const { rows } = await db.query(
    `SELECT e.*, row_to_json(c.*) AS config
       FROM etablissements e JOIN config_pays c ON c.id = e.config_id
      WHERE e.id = $1 AND e.actif`, [id]);
  if (!rows[0]) throw new ErreurHttp(404, 'etab_introuvable');
  return rows[0];
}

/** Besoins du patient → condition SQL sur le lit (valeurs booléennes contrôlées, jamais du texte libre). */
function lireBesoins(b = {}) {
  return {
    isolement: !!b.isolement || !!b.besoin_isolement,
    pression_negative: !!b.pression_negative || !!b.besoin_pression_negative,
    ventilation: !!b.ventilation || !!b.besoin_ventilation,
    telemetrie: !!b.telemetrie || !!b.besoin_telemetrie,
  };
}
function sqlBesoins(b, alias = 'l') {
  return Object.entries(lireBesoins(b)).filter(([, v]) => v).map(([k]) => ` AND ${alias}.${k}`).join('');
}

/** Groupes d'âge : un lit « tous » convient à chacun ; sinon le groupe du lit doit être celui du patient. */
const GROUPES_AGE = ['adulte', 'pediatrique', 'neonatal'];
function sqlAge(alias = 'l', groupe) {
  const g = GROUPES_AGE.includes(groupe) ? groupe : 'adulte';
  return ` AND ${alias}.groupe_age IN ('${g}', 'tous')`;
}
/** Groupe d'âge retenu pour une recherche : celui du patient, sinon celui du type d'unité demandé (pédiatrie → pédiatrique). */
async function groupeAgeEffectif(db, typeId, groupe) {
  if (GROUPES_AGE.includes(groupe)) return groupe;
  const r = await db.query('SELECT groupe_age FROM types_unite WHERE id = $1', [typeId]);
  const g = r.rows[0]?.groupe_age;
  return GROUPES_AGE.includes(g) ? g : 'adulte';
}

/** Module désactivé pour un établissement (configuration modulaire : par défaut, tous les modules sont actifs). */
async function exigerModule(db, etabId, module) {
  const r = await db.query('SELECT modules FROM etablissements WHERE id = $1', [etabId]);
  if (r.rows[0] && r.rows[0].modules && r.rows[0].modules[module] === false) throw new ErreurHttp(403, 'module_desactive', { module });
}

function exigerActif(etab) {
  if (!etab.module_actif) {
    throw new ErreurHttp(403, 'module_inactif', { etab: etab.nom });
  }
}

/** Notification : le texte est conservé en français, le code et les variables servent à l'afficher dans chaque langue. */
async function notifier(db, etablissementId, transfertId, code, vars) {
  await db.query(`INSERT INTO notifications (etablissement_id, transfert_id, message, code, vars) VALUES ($1, $2, $3, $4, $5)`,
    [etablissementId, transfertId, tr('fr', `notif.${code}`, vars), code, vars]);
}

/** Motif d'un blocage dans la langue de l'utilisateur (repli sur le texte enregistré). */
function motifBlocage(langue, lit) {
  return lit.blocage_code ? texteBlocage(langue, lit.blocage_code, lit.blocage_vars || {}) : lit.blocage_motif;
}
/** Texte d'un blocage : les durées enregistrées (minutes ou heures) sont mises en forme selon la langue. */
function texteBlocage(langue, code, v) {
  const d = v.min != null ? duree(langue, v.min) : v.h != null ? duree(langue, v.h * 60) : undefined;
  return tr(langue, `blocage.${code}`, { ...v, duree: d, cible: v.cible != null ? duree(langue, v.cible) : undefined });
}

/** Temps de route estimé en minutes : distance à vol d'oiseau × facteur de route, à la vitesse moyenne d'une ambulance. */
const minutesRoute = (km, cfg) => Math.max(1, Math.round(((km * Number(cfg.facteur_route)) / cfg.vitesse_kmh) * 60));
/** Heure locale (fuseau de la configuration) dans la langue : « 14 h 32 » ou « 2:32 p.m. ». */
const heureLocale = (langue, date, fuseau) => new Date(date).toLocaleTimeString(dico(langue, 'locale'), { hour: '2-digit', minute: '2-digit', timeZone: fuseau });

/* ------------------------------------------------------------------ capacité */
const SQL_CAPACITE = `
  SELECT e.id AS etablissement_id, e.code, e.nom, e.ville, e.partage, e.latitude, e.longitude,
         t.id AS type_id, t.code AS type_code, t.nom AS type_nom, t.ordre,
         count(*) FILTER (WHERE l.etat <> 'indispo')::int AS dotes,
         count(*) FILTER (WHERE l.etat = 'libre')::int AS libres,
         count(*) FILTER (WHERE l.etat = 'libre' AND l.disponibilite_confirmee_le >= now() - make_interval(mins => c.confirmation_lit_validite_min))::int AS libres_confirmes,
         count(*) FILTER (WHERE l.etat = 'libre' AND l.disponibilite_confirmee_le IS NULL)::int AS libres_non_confirmes,
         count(*) FILTER (WHERE l.etat = 'libre' AND l.disponibilite_confirmee_le < now() - make_interval(mins => c.confirmation_lit_validite_min))::int AS libres_perimes,
         max(l.disponibilite_confirmee_le) FILTER (WHERE l.etat = 'libre') AS derniere_confirmation,
         count(*) FILTER (WHERE l.etat = 'reserve')::int AS reserves,
         count(*) FILTER (WHERE l.etat = 'occupe')::int AS occupes,
         count(*) FILTER (WHERE l.etat = 'nettoyage')::int AS nettoyage,
         count(*) FILTER (WHERE l.etat = 'indispo')::int AS indispo,
         count(*) FILTER (WHERE l.etat = 'nettoyage'
                           OR (l.etat = 'occupe' AND l.sortie_prevue BETWEEN now()
                               AND now() + make_interval(hours => c.horizon_h)))::int AS prevus
    FROM lits l
    JOIN etablissements e ON e.id = l.etablissement_id
    JOIN types_unite t ON t.id = l.type_id
    JOIN config_pays c ON c.id = e.config_id
   WHERE e.module_actif AND e.actif AND e.config_id = $2
     AND (e.partage <> 'aucun' OR e.id = $1)
   GROUP BY e.id, t.id, c.confirmation_lit_validite_min
   ORDER BY e.nom, t.ordre`;

function risque(ligne) {
  if (ligne.dotes && !ligne.libres && !ligne.prevus) return 'eleve';
  const occ = ligne.dotes ? (ligne.dotes - ligne.libres) / ligne.dotes : 0;
  return occ >= 0.85 ? 'modere' : 'faible';
}

/** Capacité vue depuis un établissement. Les autres n'exposent que ce que leur partage autorise. */
async function capaciteReseau(pool, utilisateur, depuisId) {
  exigerEtablissement(utilisateur, depuisId);
  const ici = await etablissement(pool, depuisId);
  exigerActif(ici);
  const { rows } = await pool.query(SQL_CAPACITE, [ici.id, ici.config_id]);
  const parEtab = new Map();
  for (const r of rows) {
    const moi = r.etablissement_id === ici.id;
    if (!parEtab.has(r.etablissement_id)) {
      parEtab.set(r.etablissement_id, {
        id: r.etablissement_id, code: r.code, nom: r.nom, ville: r.ville, moi,
        partage: r.partage, distance_geographique_km: moi ? 0 : distanceKm(ici, r), unites: [],
      });
    }
    const detail = moi || r.partage === 'complet';
    parEtab.get(r.etablissement_id).unites.push({
      type_id: r.type_id, type_code: r.type_code, type_nom: r.type_nom,
      dotes: r.dotes, libres: r.libres, libres_confirmes: r.libres_confirmes,
      libres_non_confirmes: r.libres_non_confirmes, libres_perimes: r.libres_perimes,
      prevus: detail ? r.prevus : null,
      repartition: detail ? { libre: r.libres, reserve: r.reserves, occupe: r.occupes, nettoyage: r.nettoyage, indispo: r.indispo } : null,
      occupation: r.dotes ? Math.round(((r.dotes - r.libres) / r.dotes) * 100) : 0,
      risque: risque(r),
    });
  }
  // Un établissement nouvellement configuré reste présent même sans lit ni unité.
  if(!parEtab.has(ici.id))parEtab.set(ici.id,{id:ici.id,code:ici.code,nom:ici.nom,ville:ici.ville,moi:true,partage:ici.partage,distance_geographique_km:0,unites:[]});
  // Urgence : civières et taux d'occupation. Le partage agrégé n'expose que les totaux.
  const urg = await cv.statsUrgence(pool, [...parEtab.keys()]);
  for (const e of parEtab.values()) {
    const u = urg.get(e.id);
    if (!u) { e.urgence = null; continue; }
    const niveau = cv.niveauCivieres(u, ici.config);
    e.urgence = e.moi || e.partage === 'complet'
      ? { fonctionnelles: u.fonctionnelles, occupees: u.occupees, en_corridor: u.en_corridor, libres: u.libres, taux: u.taux,
        plus_24h: u.plus_24h, plus_48h: u.plus_48h, duree_moy_h: u.duree_moy_h, niveau }
      : { fonctionnelles: u.fonctionnelles, occupees: u.occupees, taux: u.taux, niveau };
  }
  const liste = [...parEtab.values()].sort((a, b) => (b.moi - a.moi) || (a.distance_geographique_km - b.distance_geographique_km));
  // La vue réseau n'a pas de calcul d'itinéraire : ne publie jamais la distance géographique sous le champ routier.
  for (const e of liste) e.distance_km = null;
  return { depuis: ici.id, config: ici.config, etablissements: liste };
}

/** Classe les hôpitaux pour un type d'unité. Ne réserve rien. */
/** Niveau d'alerte d'un établissement à partir de sa capacité, des patients qui attendent un lit et de son urgence (civières). */
function niveauDepuis(dotes, libres, enAttente, cfg, urgence = null) {
  const pression = dotes ? Math.round(((dotes - libres + enAttente) / dotes) * 100) : 0;
  const niveau = pression >= cfg.seuil_rouge ? 'rouge' : pression >= cfg.seuil_orange ? 'orange' : pression >= cfg.seuil_jaune ? 'jaune' : 'vert';
  return { pression, niveau: cv.pireNiveau(niveau, cv.niveauCivieres(urgence, cfg)) };
}

/**
 * Classe les hôpitaux pour un patient. Ne réserve rien.
 * Règle : l'hôpital le plus proche qui a un lit libre adapté aux besoins du patient,
 * sauf s'il est lui-même débordé (il recule alors dans le classement).
 */
async function recommander(pool, utilisateur, depuisId, typeId, besoins = {}) {
  exigerEtablissement(utilisateur, depuisId);
  const ici = await etablissement(pool, depuisId);
  exigerActif(ici);
  const cfg = ici.config;
  const { rows } = await pool.query(SQL_CAPACITE, [ici.id, ici.config_id]);
  const attente = await pool.query(
    `SELECT etablissement_id, count(*)::int AS n FROM demandes_admission WHERE statut = 'attente' GROUP BY etablissement_id`);
  const enAttente = new Map(attente.rows.map((r) => [r.etablissement_id, r.n]));
  const destinations = [...new Set(rows.filter((r) => r.etablissement_id !== ici.id).map((r) => r.etablissement_id))];
  const demandesTransfert = destinations.length ? await pool.query(
    `SELECT destination_id, count(*)::int AS n FROM transferts
      WHERE destination_id = ANY($1::int[]) AND statut = 'demande' GROUP BY destination_id`, [destinations]) : { rows: [] };
  const transfertsEnAttente = new Map(demandesTransfert.rows.map((r) => [r.destination_id, r.n]));
  const urgences = await cv.statsUrgence(pool, [...new Set(rows.map((r) => r.etablissement_id))]);
  // Charge globale de chaque établissement (tous types d'unité confondus)
  const global = new Map();
  for (const r of rows) {
    const g = global.get(r.etablissement_id) || { dotes: 0, libres: 0 };
    g.dotes += r.dotes; g.libres += r.libres;
    global.set(r.etablissement_id, g);
  }
  const groupeAge = await groupeAgeEffectif(pool, typeId, besoins.groupe_age);
  const filtre = sqlBesoins(besoins) + sqlAge('l', groupeAge);
  const res = [];
  for (const r of rows) {
    if (r.etablissement_id === ici.id || r.type_id !== Number(typeId) || r.partage === 'aucun') continue;
    const d = distanceKm(ici, r);
    if (d > cfg.rayon_km) continue;
    if (filtre) {
      const q = await pool.query(`SELECT count(*) FILTER (WHERE l.etat = 'libre')::int AS libres,
          count(*) FILTER (WHERE l.etat = 'libre' AND l.disponibilite_confirmee_le >= now() - make_interval(mins => c.confirmation_lit_validite_min))::int AS libres_confirmes,
          count(*) FILTER (WHERE l.etat = 'libre' AND l.disponibilite_confirmee_le IS NULL)::int AS libres_non_confirmes,
          count(*) FILTER (WHERE l.etat = 'libre' AND l.disponibilite_confirmee_le < now() - make_interval(mins => c.confirmation_lit_validite_min))::int AS libres_perimes,
          max(l.disponibilite_confirmee_le) FILTER (WHERE l.etat = 'libre') AS derniere_confirmation
        FROM lits l JOIN etablissements e ON e.id = l.etablissement_id JOIN config_pays c ON c.id = e.config_id
        WHERE l.etablissement_id = $1 AND l.type_id = $2${filtre}`, [r.etablissement_id, r.type_id]);
      // Exclusions expliquées : lits libres du même type écartés pour l'âge ou pour un besoin (équipement, isolement)
      const ex = await pool.query(`SELECT count(*) FILTER (WHERE l.etat = 'libre' AND NOT (true${sqlAge('l', groupeAge)}))::int AS age,
          count(*) FILTER (WHERE l.etat = 'libre' AND (true${sqlAge('l', groupeAge)}) AND NOT (true${sqlBesoins(besoins)}))::int AS besoins
        FROM lits l WHERE l.etablissement_id = $1 AND l.type_id = $2`, [r.etablissement_id, r.type_id]);
      r.exclusions = ex.rows[0];
      Object.assign(r, q.rows[0]);
    }
    if (!r.libres && !r.prevus) continue;
    const g = global.get(r.etablissement_id);
    const { pression, niveau } = niveauDepuis(g.dotes, g.libres, enAttente.get(r.etablissement_id) || 0, cfg, urgences.get(r.etablissement_id));
    const penalite = niveau === 'rouge' ? cfg.penalite_rouge_km : niveau === 'orange' ? cfg.penalite_orange_km : 0;
    const minutes = null;
    let lit = null;
    if (r.partage === 'complet' && r.libres_confirmes) {
      const l = await pool.query(
        `SELECT l.id, l.code, l.version, l.disponibilite_confirmee_le, u.nom AS confirme_par
           FROM lits l JOIN etablissements e ON e.id = l.etablissement_id JOIN config_pays c ON c.id = e.config_id
           LEFT JOIN utilisateurs u ON u.id = l.disponibilite_confirmee_par
          WHERE l.etablissement_id = $1 AND l.type_id = $2 AND l.etat = 'libre'
            AND l.disponibilite_confirmee_le >= now() - make_interval(mins => c.confirmation_lit_validite_min)${filtre}
          ORDER BY l.disponibilite_confirmee_le DESC, l.code LIMIT 1`, [r.etablissement_id, r.type_id]);
      lit = l.rows[0] || null;
    }
    const occ = r.dotes ? Math.round(((r.dotes - r.libres) / r.dotes) * 100) : 100;
    res.push({
      etablissement_id: r.etablissement_id, nom: r.nom, ville: r.ville, partage: r.partage,
      distance_geographique_km: d, distance_km: null, minutes_route: minutes,
      latitude: Number(r.latitude), longitude: Number(r.longitude),
      libres: r.libres, libres_confirmes: r.libres_confirmes, libres_non_confirmes: r.libres_non_confirmes,
      libres_perimes: r.libres_perimes, prevus: r.prevus, occupation: occ,
      capacite: r.partage === 'complet' ? { dotes: r.dotes, reserves: r.reserves, occupes: r.occupes,
        nettoyage: r.nettoyage, hors_service: r.indispo } : null,
      demandes_admission_en_attente: r.partage === 'complet' ? enAttente.get(r.etablissement_id) || 0 : null,
      transferts_a_repondre: r.partage === 'complet' ? transfertsEnAttente.get(r.etablissement_id) || 0 : null,
      simulation: {
        type: 'hypothese_operationnelle', hypothese: 'un lit supplémentaire est réservé',
        pression_actuelle: pression,
        pression_apres_reservation: g.dotes
          ? Math.round(((g.dotes - g.libres + 1 + (enAttente.get(r.etablissement_id) || 0)) / g.dotes) * 100) : null,
        capacite_reseau_dotee: g.dotes,
      },
      confirmation: {
        statut: r.libres_confirmes ? 'capacite_confirmee' : r.libres_perimes ? 'capacite_perimee' : r.libres_non_confirmes ? 'capacite_non_confirmee' : 'prevision_seulement',
        verifie_le: new Date().toISOString(), confirme_le: lit?.disponibilite_confirmee_le || r.derniere_confirmation || null,
        confirme_par: lit?.confirme_par || null, validite_min: cfg.confirmation_lit_validite_min,
      },
      niveau, pression, cout: d + penalite, lit,
      exclusions: r.partage === 'complet' ? r.exclusions || null : null,
    });
  }
  let metaRoutage = { disponible: false, fournisseur: null, actualise_le: null };
  if (res.length) {
    try {
      const matrix = await routage.matrice({ latitude: ici.latitude, longitude: ici.longitude }, res);
      for (const [i, route] of matrix.routes.entries()) {
        if (route) {
          res[i].distance_km = route.distance_km;
          res[i].minutes_route = route.duree_min;
          res[i].confirmation.routeur = matrix.fournisseur;
          res[i].confirmation.route_actualise_le = matrix.actualise_le;
          res[i].statut_route = 'calcule';
        } else res[i].statut_route = 'introuvable';
      }
      metaRoutage = { disponible: true, fournisseur: matrix.fournisseur, actualise_le: matrix.actualise_le };
    } catch (err) {
      for (const x of res) x.statut_route = 'indisponible';
      metaRoutage = { disponible: false, fournisseur: null, actualise_le: null, code: err.code || 'routeur_indisponible' };
    }
  }
  // Capacité confirmée d'abord, puis sécurité (niveau d'alerte), durée et distance routières.
  const ordreRisque = { vert: 0, jaune: 1, orange: 2, rouge: 3 };
  res.sort((a, b) => ((b.libres_confirmes > 0) - (a.libres_confirmes > 0))
    || (ordreRisque[a.niveau] - ordreRisque[b.niveau])
    || ((a.minutes_route ?? Infinity) - (b.minutes_route ?? Infinity))
    || ((a.distance_km ?? Infinity) - (b.distance_km ?? Infinity)) || (b.libres - a.libres));
  const premierLibre = res.find((x) => x.libres_confirmes && x.statut_route === 'calcule');
  const L = utilisateur.langue;
  const niv = dico(L, 'niveau');
  for (const x of res) {
    const route = x.statut_route === 'calcule'
      ? tr(L, 'route', { duree: duree(L, x.minutes_route), km: x.distance_km })
      : tr(L, 'route_indisponible');
    const dispo = x.libres_confirmes ? tr(L, 'dispo_libres', { n: x.libres_confirmes })
      : x.libres_perimes ? tr(L, 'dispo_perimee', { n: x.libres_perimes })
        : x.libres_non_confirmes ? tr(L, 'dispo_non_confirmee', { n: x.libres_non_confirmes })
          : tr(L, 'dispo_prevus', { n: x.prevus, h: cfg.horizon_h });
    const tension = x.niveau === 'vert' ? tr(L, 'tension_vert') : tr(L, 'tension', { niveau: niv[x.niveau], p: x.pression });
    x.raison = `${route} · ${dispo} · ${tension}`;
    if (x === premierLibre) {
      x.recommande = true;
      const plusProche = res.filter((y) => y.libres_confirmes && y.distance_km < x.distance_km);
      x.pourquoi = plusProche.length
        ? tr(L, plusProche.length > 1 ? 'pourquoi_plusieurs' : 'pourquoi_un',
          { noms: plusProche.map((y) => y.nom).join(', '), niveaux: plusProche.map((y) => niv[y.niveau]).join('/') })
        : tr(L, 'pourquoi_proche');
    }
  }
  const loc = await pool.query(
    `SELECT count(*) FILTER (WHERE l.etat = 'libre'${filtre})::int AS libres FROM lits l WHERE l.etablissement_id = $1 AND l.type_id = $2`,
    [ici.id, typeId]);
  return { libres_ici: loc.rows[0].libres, suggestions: res, routage: metaRoutage, groupe_age: groupeAge,
    origine: { latitude: Number(ici.latitude), longitude: Number(ici.longitude), nom: ici.nom },
    capacite_verifiee_le: new Date().toISOString() };
}

/* ------------------------------------------------------------------ lits */
async function litsEtablissement(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const { rows } = await pool.query(
    `SELECT l.id, l.code, l.etat, l.patient_ref, l.version, l.etat_depuis, l.sortie_prevue,
            l.blocage_niveau, l.blocage_motif, l.isolement, l.pression_negative, l.ventilation, l.telemetrie,
            l.motif_indispo, l.nsa_depuis, l.nsa_orientation, l.conge_statut, l.nettoyage_debut,
            ch.numero AS chambre, u.nom AS unite, u.id AS unite_id, t.code AS type_code,
            l.blocage_code, l.blocage_vars, t.id AS type_id, tr.numero AS transfert_numero,
            l.disponibilite_confirmee_le, conf.nom AS disponibilite_confirmee_par, cfg.confirmation_lit_validite_min, l.groupe_age,
            CASE WHEN p.id IS NOT NULL THEN p.prenom || ' ' || left(p.nom, 1) || '.' END AS patient_nom_court
       FROM lits l
       LEFT JOIN patients p ON p.etablissement_id = l.etablissement_id AND p.reference = l.patient_ref
       JOIN chambres ch ON ch.id = l.chambre_id
       JOIN unites u ON u.id = l.unite_id
       JOIN types_unite t ON t.id = l.type_id
       JOIN etablissements e ON e.id = l.etablissement_id
       JOIN config_pays cfg ON cfg.id = e.config_id
       LEFT JOIN utilisateurs conf ON conf.id = l.disponibilite_confirmee_par
       LEFT JOIN transferts tr ON tr.id = l.transfert_id
      WHERE l.etablissement_id = $1
      ORDER BY t.ordre, l.code`, [etabId]);
  for (const r of rows) {
    r.blocage_motif = motifBlocage(utilisateur.langue, r);
    const limite = Date.now() - Number(r.confirmation_lit_validite_min) * 60000;
    r.disponibilite_confirmation = r.etat !== 'libre' ? 'non_applicable'
      : !r.disponibilite_confirmee_le ? 'capacite_non_confirmee'
        : new Date(r.disponibilite_confirmee_le).getTime() < limite ? 'capacite_perimee' : 'capacite_confirmee';
  }
  return rows;
}

/** Vérifie que l'utilisateur peut agir sur ce lit. 404 sinon, pour ne rien révéler. */
async function litVisible(pool, utilisateur, litId) {
  const { rows } = await pool.query('SELECT id, etablissement_id FROM lits WHERE id = $1', [litId]);
  if (!rows[0] || !peutAgirPour(utilisateur, rows[0].etablissement_id)) throw new ErreurHttp(404, 'lit_introuvable');
  return rows[0];
}

/** Confirmation humaine d’un lit physiquement libre; n’altère pas son état opérationnel. */
async function confirmerDisponibilite(pool, utilisateur, litId) {
  const visible = await litVisible(pool, utilisateur, litId);
  if (utilisateur.role === 'entretien') throw new ErreurHttp(403, 'confirmation_role_interdit');
  return transaction(pool, async (c) => {
    const q = await c.query(`SELECT l.id, l.etablissement_id, l.code, l.etat, e.nom AS etablissement,
        cfg.confirmation_lit_validite_min
      FROM lits l JOIN etablissements e ON e.id = l.etablissement_id JOIN config_pays cfg ON cfg.id = e.config_id
      WHERE l.id = $1 FOR NO KEY UPDATE OF l`, [litId]);
    const lit = q.rows[0];
    if (!lit || lit.etablissement_id !== visible.etablissement_id) throw new ErreurHttp(404, 'lit_introuvable');
    if (lit.etat !== 'libre') throw new ErreurHttp(409, 'confirmation_lit_non_libre', { code: lit.code });
    const resultat = (await c.query(`UPDATE lits SET disponibilite_confirmee_le = now(), disponibilite_confirmee_par = $2
      WHERE id = $1 RETURNING id, code, etablissement_id, disponibilite_confirmee_le`, [litId, utilisateur.id])).rows[0];
    await journaliser(c, { litId, utilisateurId: utilisateur.id, action: 'Disponibilité confirmée',
      detail: `Valide ${lit.confirmation_lit_validite_min} min · ${lit.etablissement}` });
    return { ...resultat, statut_confirmation: 'capacite_confirmee', validite_min: lit.confirmation_lit_validite_min,
      confirme_par: utilisateur.nom, etablissement: lit.etablissement };
  });
}

/* ------------------------------------------------------------------ transferts */
async function creerTransfert(pool, utilisateur, b, client = null) {
  const origineId = Number(b.origine_id);
  const destId = Number(b.destination_id);
  const typeId = Number(b.type_id);
  exigerEtablissement(utilisateur, origineId);
  const origine = await etablissement(pool, origineId);
  exigerActif(origine);
  if (origineId === destId) throw new ErreurHttp(400, 'autre_etab');
  const dest = await etablissement(pool, destId);
  exigerActif(dest);
  if (dest.partage === 'aucun' || dest.config_id !== origine.config_id) {
    throw new ErreurHttp(403, 'etab_ne_partage_pas');
  }
  const type = await pool.query('SELECT * FROM types_unite WHERE id = $1 AND config_id = $2', [typeId, origine.config_id]);
  if (!type.rows[0]) throw new ErreurHttp(400, 'type_unite_inconnu');
  const distance = distanceKm(origine, dest);
  // Le rayon limite les suggestions ; un transfert choisi au tableau national (hors_rayon) peut aller au-delà
  if (distance > origine.config.rayon_km && !b.hors_rayon) throw new ErreurHttp(400, 'hors_rayon');

  const besoins = lireBesoins(b.besoins || {});
  const groupeAge = await groupeAgeEffectif(pool, typeId, b.groupe_age || b.besoins?.groupe_age);
  const filtre = sqlBesoins(besoins) + sqlAge('l', groupeAge);
  const mesureRoute = await routage.itineraire(origine, dest);
  const executer = async (c) => {
    let litId; let version;
    if (dest.partage === 'complet' && b.lit_id) {
      const l = await c.query(`SELECT l.id FROM lits l JOIN etablissements e ON e.id = l.etablissement_id JOIN config_pays cfg ON cfg.id = e.config_id
        WHERE l.id = $1 AND l.etablissement_id = $2 AND l.type_id = $3 AND l.etat = 'libre'
          AND l.disponibilite_confirmee_le >= now() - make_interval(mins => cfg.confirmation_lit_validite_min)${filtre}`,
        [b.lit_id, destId, typeId]);
      if (!l.rows[0]) throw new ErreurHttp(409, 'confirmation_capacite_requise');
      litId = l.rows[0].id;
      version = b.version;
    } else {
      // partage agrégé : le lit est attribué ici, sans jamais prendre un lit déjà verrouillé
      const l = await c.query(
        `SELECT l.id, l.version FROM lits l JOIN etablissements e ON e.id = l.etablissement_id JOIN config_pays cfg ON cfg.id = e.config_id
          WHERE l.etablissement_id = $1 AND l.type_id = $2 AND l.etat = 'libre'
            AND l.disponibilite_confirmee_le >= now() - make_interval(mins => cfg.confirmation_lit_validite_min)${filtre}
          ORDER BY l.disponibilite_confirmee_le DESC, l.code LIMIT 1 FOR NO KEY UPDATE OF l SKIP LOCKED`, [destId, typeId]);
      if (!l.rows[0]) {
        const libre = await c.query(`SELECT 1 FROM lits l WHERE l.etablissement_id = $1 AND l.type_id = $2 AND l.etat = 'libre'${filtre} LIMIT 1`, [destId, typeId]);
        if (libre.rows[0]) throw new ErreurHttp(409, 'confirmation_capacite_requise');
        throw new ErreurHttp(409, 'plus_de_lit', { etab: dest.nom });
      }
      litId = l.rows[0].id;
      version = l.rows[0].version;
    }
    const lit = await changerEtat(c, pool, utilisateur.id, litId, 'reserve', {
      versionAttendue: version, patientRef: b.patient_ref, detail: `Réservé pour un transfert depuis ${origine.nom}`,
    });
    const t = await c.query(
      `INSERT INTO transferts (numero, patient_ref, origine_id, destination_id, type_id, lit_id, urgent, distance_km, demande_par, besoins, demande_admission_id, minutes_route, route_actualise_le, route_fournisseur, route_version_donnees, groupe_age)
       VALUES ('TR-' || lpad(nextval('transfert_seq')::text, 5, '0'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [lit.patient_ref, origineId, destId, typeId, litId, !!b.urgent, mesureRoute.distance_km, utilisateur.id, besoins, b.demande_admission_id || null,
        mesureRoute.duree_min, mesureRoute.actualise_le, mesureRoute.fournisseur, mesureRoute.version_donnees, groupeAge]);
    const tr = t.rows[0];
    await c.query('UPDATE lits SET transfert_id = $2 WHERE id = $1', [litId, tr.id]);
    await journaliser(c, { litId, utilisateurId: utilisateur.id, action: 'Référence transmise',
      detail: `${tr.patient_ref} → ${dest.nom}`, transfertId: tr.id });
    await notifier(c, destId, tr.id, 'transfert_demande',
      { numero: tr.numero, urgent: tr.urgent ? ' (URGENT)' : '', type: type.rows[0].nom, lit: lit.code, origine: origine.nom });
    return { ...tr, lit_code: lit.code, route: mesureRoute };
  };
  return client ? executer(client) : transaction(pool, executer);
}

/** Plan B après refus : alternatives revalidées pour le seul établissement d'origine. */
async function alternativesTransfert(pool, utilisateur, transfertId) {
  const { rows } = await pool.query('SELECT origine_id, destination_id, type_id, statut, patient_ref, urgent, besoins, groupe_age FROM transferts WHERE id = $1', [transfertId]);
  const tr0 = rows[0];
  if (!tr0 || !peutAgirPour(utilisateur, tr0.origine_id)) throw new ErreurHttp(404, 'transfert_introuvable');
  if (tr0.statut !== 'refuse') throw new ErreurHttp(409, 'plan_b_apres_refus');
  const recherche = await recommander(pool, utilisateur, tr0.origine_id, tr0.type_id, { ...(tr0.besoins || {}), groupe_age: tr0.groupe_age });
  recherche.suggestions = recherche.suggestions.filter((x) => x.etablissement_id !== tr0.destination_id);
  const libre = recherche.suggestions.find((x) => x.libres_confirmes && x.statut_route === 'calcule');
  for (const x of recherche.suggestions) delete x.recommande;
  if (libre) libre.recommande = true;
  return { transfert_id: Number(transfertId), type_id: tr0.type_id, patient_ref: tr0.patient_ref, urgent: tr0.urgent,
    besoins: lireBesoins(tr0.besoins || {}), ...recherche };
}

/** Géométrie de route pour tracer la destination choisie sur la carte du réseau. */
async function itineraireReseau(pool, utilisateur, origineId, destinationId) {
  exigerEtablissement(utilisateur, origineId);
  const origine = await etablissement(pool, origineId);
  const destination = await etablissement(pool, destinationId);
  exigerActif(origine); exigerActif(destination);
  if (origine.config_id !== destination.config_id || destination.partage === 'aucun') throw new ErreurHttp(404, 'etab_introuvable');
  return routage.itineraire(origine, destination);
}

// « chambre_prete » ne change pas le statut : le receveur la confirme quand il veut entre l'acceptation et l'arrivée
const ETAPES = {
  accepter: { de: ['demande'], cote: 'destination', vers: 'validee' },
  chambre_prete: { de: ['validee', 'transport', 'en_route'], cote: 'destination', vers: null },
  refuser: { de: ['demande', 'validee'], cote: 'destination', vers: 'refuse' },
  transport: { de: ['validee'], cote: 'origine', vers: 'transport' },
  depart: { de: ['transport'], cote: 'origine', vers: 'en_route' },
  reception: { de: ['en_route'], cote: 'destination', vers: 'recu' },
};

async function avancerTransfert(pool, utilisateur, transfertId, etape, corps = {}, client = null) {
  const regle = ETAPES[etape];
  if (!regle) throw new ErreurHttp(400, 'action_inconnue');
  const executer = async (c) => {
    const r = await c.query(
      `SELECT t.*, o.nom AS origine_nom, d.nom AS destination_nom, c.transport_libelle, c.fuseau, c.facteur_route, c.vitesse_kmh, l.code AS lit_code
         FROM transferts t
         JOIN etablissements o ON o.id = t.origine_id
         JOIN etablissements d ON d.id = t.destination_id
         JOIN config_pays c ON c.id = o.config_id
         LEFT JOIN lits l ON l.id = t.lit_id
        WHERE t.id = $1 FOR UPDATE OF t`, [transfertId]);
    const t = r.rows[0];
    if (!t || !(peutAgirPour(utilisateur, t.origine_id) || peutAgirPour(utilisateur, t.destination_id))) {
      throw new ErreurHttp(404, 'transfert_introuvable');
    }
    const cote = regle.cote === 'origine' ? t.origine_id : t.destination_id;
    if (!peutAgirPour(utilisateur, cote)) {
      throw new ErreurHttp(403, 'action_revient_a', { etab: regle.cote === 'origine' ? t.origine_nom : t.destination_nom });
    }
    if (!regle.de.includes(t.statut)) {
      throw new ErreurHttp(409, 'transfert_statut', { numero: t.numero });
    }
    const maj = regle.vers ? { statut: regle.vers } : {};
    let journal = null; let notif = null; let dest = null;
    if (etape === 'accepter') {
      maj.date_validation = 'now()';
      journal = 'Transfert validé';
      dest = t.origine_id; notif = ['transfert_accepte', { dest: t.destination_nom, numero: t.numero, lit: t.lit_code }];
    } else if (etape === 'chambre_prete') {
      if (t.date_chambre_prete) throw new ErreurHttp(409, 'chambre_deja_prete', { numero: t.numero });
      maj.date_chambre_prete = 'now()';
      journal = 'Chambre prête';
      dest = t.origine_id; notif = ['chambre_prete', { dest: t.destination_nom, numero: t.numero, lit: t.lit_code }];
    } else if (etape === 'refuser') {
      if (t.lit_id) {
        const l = await c.query('SELECT etat FROM lits WHERE id = $1', [t.lit_id]);
        if (l.rows[0] && l.rows[0].etat === 'reserve') {
          await changerEtat(c, pool, utilisateur.id, t.lit_id, 'libre',
            { depuisTransfert: true, transfertId: t.id, detail: `Transfert ${t.numero} refusé` });
        }
      }
      maj.motif_refus = String(corps.motif || '').slice(0, 300) || null;
      maj.date_refus = 'now()';
      maj.motif_refus_code = ['pas_de_lit', 'pas_de_personnel', 'plateau_technique', 'autre'].includes(corps.motif_code) ? corps.motif_code : 'autre';
      dest = t.origine_id; notif = ['transfert_refuse', { dest: t.destination_nom, numero: t.numero }];
    } else if (etape === 'transport') {
      maj.transport_info = t.urgent ? `${t.transport_libelle} prioritaire` : t.transport_libelle;
      journal = 'Transport organisé';
    } else if (etape === 'depart') {
      if (!Number.isFinite(Number(t.minutes_route)) || !t.route_actualise_le) {
        throw new ErreurHttp(409, 'itineraire_introuvable');
      }
      maj.date_depart = 'now()';
      // L'arrivée prévue utilise seulement le temps routier réellement calculé lors de la demande.
      const arrivee = new Date(Date.now() + Number(t.minutes_route) * 60000);
      maj.arrivee_prevue = arrivee;
      journal = 'Départ confirmé';
      dest = t.destination_id;
      notif = ['transfert_depart', { ref: t.patient_ref, numero: t.numero, arrivee: arrivee.toISOString(), heure: heureLocale('fr', arrivee, t.fuseau) }];
      // Le patient quitte la civière de l'urgence d'origine : elle part au nettoyage
      if (t.demande_admission_id) {
        const d = (await c.query('SELECT * FROM demandes_admission WHERE id = $1', [t.demande_admission_id])).rows[0];
        if (d) await cv.libererPourDemande(c, pool, utilisateur.id, d, `Départ en transfert (${t.numero})`, t.id);
      }
    } else if (etape === 'reception') {
      if (t.lit_id) {
        await changerEtat(c, pool, utilisateur.id, t.lit_id, 'occupe',
          { transfertId: t.id, detail: `Patient reçu (${t.numero})` });
      }
      maj.date_reception = 'now()';
      dest = t.origine_id; notif = ['transfert_recu', { ref: t.patient_ref, dest: t.destination_nom }];
    }
    const cols = Object.keys(maj);
    const vals = [];
    const sets = cols.map((k) => {
      if (maj[k] === 'now()') return `${k} = now()`;
      vals.push(maj[k]);
      return `${k} = $${vals.length + 1}`;
    });
    const u = await c.query(`UPDATE transferts SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, [t.id, ...vals]);
    if (journal && t.lit_id) {
      await journaliser(c, { litId: t.lit_id, utilisateurId: utilisateur.id, action: journal,
        detail: maj.transport_info || t.numero, transfertId: t.id });
    }
    if (dest) await notifier(c, dest, t.id, ...notif);
    return u.rows[0];
  };
  return client ? executer(client) : transaction(pool, executer);
}

/** Désigne le service receveur chargé de traiter la demande. */
async function definirServiceResponsable(pool, utilisateur, transfertId, service) {
  if (utilisateur.role === 'entretien') throw new ErreurHttp(403, 'role_entretien');
  const nom = String(service || '').trim();
  if (!nom || nom.length > 100) throw new ErreurHttp(400, 'valeur_invalide', { champ: 'service_responsable' });
  return transaction(pool, async (c) => {
    const q = await c.query(`SELECT t.id, t.origine_id, t.destination_id, t.statut, t.numero, d.nom AS destination_nom
      FROM transferts t JOIN etablissements d ON d.id = t.destination_id WHERE t.id = $1 FOR UPDATE OF t`, [transfertId]);
    const t = q.rows[0];
    if (!t || !(peutAgirPour(utilisateur, t.origine_id) || peutAgirPour(utilisateur, t.destination_id))) throw new ErreurHttp(404, 'transfert_introuvable');
    if (!peutAgirPour(utilisateur, t.destination_id)) throw new ErreurHttp(403, 'action_revient_a', { etab: t.destination_nom });
    if (t.statut !== 'demande') throw new ErreurHttp(409, 'transfert_non_relancable');
    await c.query('UPDATE transferts SET service_responsable = $2 WHERE id = $1', [t.id, nom]);
    await journaliser(c, { etablissementId: t.destination_id, utilisateurId: utilisateur.id, action: 'Service responsable modifié', detail: `${t.numero} · ${nom}`, transfertId: t.id });
    return { transfert_id: t.id, service_responsable: nom };
  });
}

/** Relance manuelle, réservée à l'origine, avec délai anti-spam et journal d'audit. */
async function relancerTransfert(pool, utilisateur, transfertId) {
  if (utilisateur.role === 'entretien') throw new ErreurHttp(403, 'role_entretien');
  return transaction(pool, async (c) => {
    const q = await c.query(`SELECT t.id, t.origine_id, t.destination_id, t.statut, t.numero, t.date_demande,
        t.derniere_relance_le, t.nombre_relances, o.nom AS origine_nom
      FROM transferts t JOIN etablissements o ON o.id = t.origine_id WHERE t.id = $1 FOR UPDATE OF t`, [transfertId]);
    const t = q.rows[0];
    if (!t || !peutAgirPour(utilisateur, t.origine_id)) throw new ErreurHttp(404, 'transfert_introuvable');
    if (t.statut !== 'demande') throw new ErreurHttp(409, 'transfert_non_relancable');
    const age = t.derniere_relance_le || t.date_demande;
    if (Date.now() - new Date(age).getTime() < 5 * 60000) throw new ErreurHttp(429, 'relance_trop_tot');
    const r = await c.query(`UPDATE transferts SET derniere_relance_le = now(), nombre_relances = nombre_relances + 1
      WHERE id = $1 RETURNING derniere_relance_le, nombre_relances`, [t.id]);
    await journaliser(c, { etablissementId: t.origine_id, utilisateurId: utilisateur.id, action: 'Transfert relancé', detail: t.numero, transfertId: t.id });
    await notifier(c, t.destination_id, t.id, 'transfert_relance', { numero: t.numero, origine: t.origine_nom });
    return { transfert_id: t.id, ...r.rows[0] };
  });
}

/* Pagination : les listes longues sont servies par pages de 300 lignes au plus. Chaque ligne porte un « curseur »
   (date en microsecondes|id) ; la page suivante se demande avec avant=<curseur de la dernière ligne>.
   Stable même si de nouvelles lignes arrivent, et servi par les index (date DESC, id DESC). */
const PAGE = 300;
function curseur(avant) {
  if (!avant) return [null, null];
  const m = /^(\d{1,18})\|(\d{1,12})$/.exec(String(avant));
  if (!m) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'avant' });
  return [m[1], Number(m[2])];
}
// Expressions SQL : curseur d'une ligne, et condition « avant le curseur » ($d = microsecondes, $i = id)
const sqlCurseur = (date, id) => `(EXTRACT(EPOCH FROM ${date}) * 1000000)::bigint::text || '|' || ${id} AS curseur`;
const sqlAvant = (date, id, d, i) => `(${d}::bigint IS NULL OR (${date}, ${id}) < (timestamptz 'epoch' + ${d}::bigint * interval '1 microsecond', ${i}))`;
const taillePage = (limite) => Math.min(Math.max(Number(limite) || PAGE, 1), PAGE);

/** Transferts de l'établissement : tous ceux en cours, et les terminés (reçus, refusés) par pages. */
async function listeTransferts(pool, utilisateur, etabId, { avant, limite } = {}) {
  exigerEtablissement(utilisateur, etabId);
  const [d, i] = curseur(avant);
  const select = `SELECT t.*, o.nom AS origine_nom, d.nom AS destination_nom, ty.nom AS type_nom, l.code AS lit_code
       FROM transferts t
       JOIN etablissements o ON o.id = t.origine_id
       JOIN etablissements d ON d.id = t.destination_id
       JOIN types_unite ty ON ty.id = t.type_id
       LEFT JOIN lits l ON l.id = t.lit_id`;
  const actifs = d ? { rows: [] } : await pool.query(
    `${select} WHERE (t.origine_id = $1 OR t.destination_id = $1) AND t.statut NOT IN ('recu', 'refuse')
      ORDER BY t.urgent DESC, t.date_demande DESC`, [etabId]);
  const termines = await pool.query(
    `${select.replace('SELECT t.*,', `SELECT t.*, ${sqlCurseur('t.date_demande', 't.id')},`)}
      WHERE (t.origine_id = $1 OR t.destination_id = $1) AND t.statut IN ('recu', 'refuse') AND ${sqlAvant('t.date_demande', 't.id', '$2', '$3')}
      ORDER BY t.date_demande DESC, t.id DESC LIMIT $4`, [etabId, d, i, taillePage(limite)]);
  return [...actifs.rows, ...termines.rows];
}

/* ------------------------------------------------------------------ journal, notifications */
/** Journal de l'établissement (ses lits et les transferts qui le concernent), du plus récent au plus ancien, par pages. */
async function lireJournal(pool, utilisateur, etabId, { avant, limite } = {}) {
  exigerEtablissement(utilisateur, etabId);
  const [d, i] = curseur(avant);
  // Deux parties servies chacune par un index, puis fusion : les lits de l'établissement, et les transferts qui le concernent
  const { rows } = await pool.query(
    `WITH page AS (
       (SELECT id, date FROM journal WHERE etablissement_id = $1 AND ${sqlAvant('date', 'id', '$2', '$3')}
         ORDER BY date DESC, id DESC LIMIT $4)
       UNION
       (SELECT j.id, j.date FROM journal j JOIN transferts t ON t.id = j.transfert_id
         WHERE (t.origine_id = $1 OR t.destination_id = $1) AND ${sqlAvant('j.date', 'j.id', '$2', '$3')}
         ORDER BY j.date DESC, j.id DESC LIMIT $4)
       ORDER BY date DESC, id DESC LIMIT $4)
     SELECT j.id, j.date, j.action, j.ancien_etat, j.nouvel_etat, j.detail, j.refuse, ${sqlCurseur('j.date', 'j.id')},
            COALESCE(l.code, cv.code) AS lit_code, (j.civiere_id IS NOT NULL) AS civiere, u.nom AS utilisateur, t.numero AS transfert_numero
       FROM page JOIN journal j ON j.id = page.id
       LEFT JOIN lits l ON l.id = j.lit_id
       LEFT JOIN civieres cv ON cv.id = j.civiere_id
       LEFT JOIN utilisateurs u ON u.id = j.utilisateur_id
       LEFT JOIN transferts t ON t.id = j.transfert_id
      ORDER BY j.date DESC, j.id DESC`, [etabId, d, i, taillePage(limite)]);
  return rows;
}

async function lireNotifications(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const { rows } = await pool.query(
    `SELECT n.*, t.numero FROM notifications n LEFT JOIN transferts t ON t.id = n.transfert_id
      WHERE n.etablissement_id = $1 ORDER BY n.date DESC LIMIT 50`, [etabId]);
  const nomType = await traducteurTypes(pool, utilisateur.langue);
  const fuseau = rows.some((n) => n.vars?.arrivee) ? (await etablissement(pool, etabId)).config.fuseau : null;
  for (const n of rows) {
    if (!n.code) continue;
    const vars = { ...n.vars, ...(n.vars?.type ? { type: nomType(n.vars.type) } : {}) };
    if (vars.arrivee) vars.heure = heureLocale(utilisateur.langue, vars.arrivee, fuseau);
    // Disponibilité à côté : type d'unité et temps de route dans la langue du lecteur
    if (vars.type_nom) vars.type = nomType(vars.type_nom).toLowerCase();
    if (vars.min != null) vars.duree = duree(utilisateur.langue, vars.min);
    n.message = tr(utilisateur.langue, `notif.${n.code}`, vars);
  }
  return rows;
}

/* ------------------------------------------------------------------ blocages */
async function detecterBlocages(pool) {
  const { rows } = await pool.query(
    `SELECT l.id, l.etat, l.etat_depuis, l.sortie_prevue, l.blocage_niveau, l.blocage_motif,
            c.nettoyage_cible_min, c.reservation_max_min, c.marge_conge_min, c.hors_service_max_h,
            EXTRACT(EPOCH FROM (now() - l.etat_depuis)) / 60 AS age_min,
            EXTRACT(EPOCH FROM (now() - l.sortie_prevue)) / 60 AS retard_min,
            (t.id IS NOT NULL AND t.statut NOT IN ('recu', 'refuse')) AS en_transfert
       FROM lits l
       JOIN etablissements e ON e.id = l.etablissement_id AND e.module_actif AND e.actif
       JOIN config_pays c ON c.id = e.config_id
       LEFT JOIN transferts t ON t.id = l.transfert_id`);
  let changes = 0;
  for (const l of rows) {
    const age = Number(l.age_min);
    let niveau = null; let code = null; let vars = null;
    if (l.etat === 'nettoyage' && age > 2 * l.nettoyage_cible_min) {
      niveau = 'modere'; code = 'nettoyage_long'; vars = { min: Math.round(age), cible: l.nettoyage_cible_min };
    } else if (l.etat === 'reserve' && age > l.reservation_max_min && !l.en_transfert) {
      niveau = 'eleve'; code = 'reserve_long'; vars = { min: Math.round(age) };
    } else if (l.etat === 'occupe' && l.sortie_prevue && Number(l.retard_min) > l.marge_conge_min) {
      niveau = 'modere'; code = 'conge_depasse'; vars = { h: Math.floor(Number(l.retard_min) / 60) };
    } else if (l.etat === 'indispo' && age > l.hors_service_max_h * 60) {
      niveau = 'faible'; code = 'hors_service_long'; vars = { h: Math.floor(age / 60) };
    }
    const motif = code ? texteBlocage('fr', code, vars) : null;
    if (niveau !== l.blocage_niveau || motif !== l.blocage_motif) {
      await pool.query('UPDATE lits SET blocage_niveau = $2, blocage_motif = $3, blocage_code = $4, blocage_vars = $5 WHERE id = $1',
        [l.id, niveau, motif, code, vars]);
      changes += 1;
    }
  }
  return changes;
}

/* ------------------------------------------------------------------ Assistant Arrimo */
function normaliser(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

async function assistant(pool, utilisateur, etabId, question) {
  const L = utilisateur.langue;
  const reseau = await capaciteReseau(pool, utilisateur, etabId);
  const q = normaliser(question);
  const types = await pool.query('SELECT id, code, nom, nom_en FROM types_unite WHERE config_id = $1 ORDER BY ordre', [reseau.config.id]);
  const nomType = (t) => (L === 'en' && t.nom_en) || t.nom;
  const type = types.rows.find((t) => {
    const noms = [normaliser(t.nom), normaliser(t.nom_en || t.nom)];
    return noms.some((n) => q.includes(n.slice(0, 5))) || new RegExp(`\\b${normaliser(t.code)}\\b`).test(q);
  }) || (/(intensi|\brea\b|\bicu\b)/.test(q) && types.rows.find((t) => t.code === 'SI'))
     || (/(accouch|obste|deliver|birth)/.test(q) && types.rows.find((t) => t.code === 'MAT')) || null;
  const moi = reseau.etablissements.find((e) => e.moi);
  const nomUnite = (u) => nomType(types.rows.find((t) => t.id === u.type_id) || { nom: u.type_nom });

  if (/(bloqu|anomal|probleme|goulot|retard|block|stuck|problem|bottleneck|delay)/.test(q)) {
    const { rows } = await pool.query(
      `SELECT code, blocage_motif, blocage_code, blocage_vars FROM lits WHERE etablissement_id = $1 AND blocage_niveau IS NOT NULL
        ORDER BY CASE blocage_niveau WHEN 'eleve' THEN 0 WHEN 'modere' THEN 1 ELSE 2 END, code`, [etabId]);
    return rows.length
      ? `${tr(L, 'q_blocages', { n: rows.length, etab: moi.nom })}\n${rows.map((r) => tr(L, 'q_ligne', { a: r.code, b: motifBlocage(L, r) })).join('\n')}`
      : tr(L, 'q_blocages_vide', { etab: moi.nom });
  }
  if (/(prevu|bientot|liber|heure|ce soir|demain|expected|soon|free up|tonight|tomorrow|hour)/.test(q)) {
    const unites = moi.unites.filter((u) => !type || u.type_id === type.id);
    return `${tr(L, 'q_prevus', { h: reseau.config.horizon_h, etab: moi.nom })}\n`
      + unites.map((u) => tr(L, 'q_ligne', { a: nomUnite(u), b: u.prevus })).join('\n')
      + `\n${tr(L, 'q_prevus_note')}`;
  }
  if (/(\bou\b|proche|trouver|ailleurs|transf|where|closest|nearest|find|elsewhere)/.test(q)) {
    const t = type || types.rows[0];
    const r = await recommander(pool, utilisateur, etabId, t.id);
    const s = r.suggestions.find((x) => x.libres_confirmes && x.statut_route === 'calcule');
    if (!s) return tr(L, 'q_ou_aucun', { type: nomType(t).toLowerCase(), km: reseau.config.rayon_km });
    return tr(L, 'q_ou', { type: nomType(t).toLowerCase(), etab: s.nom, ville: s.ville, km: s.distance_km, duree: duree(L, s.minutes_route), libres: s.libres_confirmes, prevus: s.prevus });
  }
  if (/(combien|libre|dispo|capacite|place|how many|free|available|capacity|room|space)/.test(q)) {
    const lignes = types.rows.filter((t) => !type || t.id === type.id).map((t) => {
      const ici = moi.unites.find((u) => u.type_id === t.id);
      const reseauLibres = reseau.etablissements.reduce(
        (n, e) => n + (e.unites.find((u) => u.type_id === t.id)?.libres || 0), 0);
      return ici ? tr(L, 'q_combien', { type: nomType(t), ici: ici.libres, reseau: reseauLibres })
        : tr(L, 'q_combien_sans', { type: nomType(t), reseau: reseauLibres });
    });
    return lignes.join('\n');
  }
  return tr(L, 'q_aide');
}

module.exports = {
  distanceKm, minutesRoute, heureLocale, etablissement, capaciteReseau, recommander, alternativesTransfert, itineraireReseau, litsEtablissement, litVisible, confirmerDisponibilite,
  creerTransfert, avancerTransfert, definirServiceResponsable, relancerTransfert, listeTransferts, lireJournal, lireNotifications,
  detecterBlocages, assistant, exigerActif, exigerModule, motifBlocage, sqlAge, groupeAgeEffectif, GROUPES_AGE, curseur, taillePage, sqlCurseur, sqlAvant, niveauDepuis, lireBesoins, sqlBesoins, notifier, SQL_CAPACITE, risque,
};
