const { transaction, ErreurHttp } = require('./db');
const { changerEtat, journaliser } = require('./regles');
const { exigerEtablissement, peutAgirPour } = require('./auth');

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
  if (!rows[0]) throw new ErreurHttp(404, 'Établissement introuvable.');
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

function exigerActif(etab) {
  if (!etab.module_actif) {
    throw new ErreurHttp(403, `Le module n'est pas activé pour ${etab.nom}. L'activation se fait depuis SH.`);
  }
}

async function notifier(db, etablissementId, transfertId, message) {
  await db.query(`INSERT INTO notifications (etablissement_id, transfert_id, message) VALUES ($1, $2, $3)`,
    [etablissementId, transfertId, message]);
}

/* ------------------------------------------------------------------ capacité */
const SQL_CAPACITE = `
  SELECT e.id AS etablissement_id, e.code, e.nom, e.ville, e.partage, e.latitude, e.longitude,
         t.id AS type_id, t.code AS type_code, t.nom AS type_nom, t.ordre,
         count(*) FILTER (WHERE l.etat <> 'indispo')::int AS dotes,
         count(*) FILTER (WHERE l.etat = 'libre')::int AS libres,
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
   GROUP BY e.id, t.id
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
        partage: r.partage, distance_km: moi ? 0 : distanceKm(ici, r), unites: [],
      });
    }
    const detail = moi || r.partage === 'complet';
    parEtab.get(r.etablissement_id).unites.push({
      type_id: r.type_id, type_code: r.type_code, type_nom: r.type_nom,
      dotes: r.dotes, libres: r.libres,
      prevus: detail ? r.prevus : null,
      repartition: detail ? { libre: r.libres, reserve: r.reserves, occupe: r.occupes, nettoyage: r.nettoyage, indispo: r.indispo } : null,
      occupation: r.dotes ? Math.round(((r.dotes - r.libres) / r.dotes) * 100) : 0,
      risque: risque(r),
    });
  }
  const liste = [...parEtab.values()].sort((a, b) => (b.moi - a.moi) || (a.distance_km - b.distance_km));
  return { depuis: ici.id, config: ici.config, etablissements: liste };
}

/** Classe les hôpitaux pour un type d'unité. Ne réserve rien. */
/** Niveau d'alerte d'un établissement à partir de sa capacité et des patients qui attendent un lit. */
function niveauDepuis(dotes, libres, enAttente, cfg) {
  const pression = dotes ? Math.round(((dotes - libres + enAttente) / dotes) * 100) : 0;
  const niveau = pression >= cfg.seuil_rouge ? 'rouge' : pression >= cfg.seuil_orange ? 'orange' : pression >= cfg.seuil_jaune ? 'jaune' : 'vert';
  return { pression, niveau };
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
  // Charge globale de chaque établissement (tous types d'unité confondus)
  const global = new Map();
  for (const r of rows) {
    const g = global.get(r.etablissement_id) || { dotes: 0, libres: 0 };
    g.dotes += r.dotes; g.libres += r.libres;
    global.set(r.etablissement_id, g);
  }
  const filtre = sqlBesoins(besoins);
  const res = [];
  for (const r of rows) {
    if (r.etablissement_id === ici.id || r.type_id !== Number(typeId) || r.partage === 'aucun') continue;
    const d = distanceKm(ici, r);
    if (d > cfg.rayon_km) continue;
    if (filtre) {
      const q = await pool.query(`SELECT count(*)::int AS n FROM lits l WHERE l.etablissement_id = $1 AND l.type_id = $2 AND l.etat = 'libre'${filtre}`,
        [r.etablissement_id, r.type_id]);
      r.libres = q.rows[0].n;
    }
    if (!r.libres && !r.prevus) continue;
    const g = global.get(r.etablissement_id);
    const { pression, niveau } = niveauDepuis(g.dotes, g.libres, enAttente.get(r.etablissement_id) || 0, cfg);
    const penalite = niveau === 'rouge' ? cfg.penalite_rouge_km : niveau === 'orange' ? cfg.penalite_orange_km : 0;
    const minutes = Math.round(((d * Number(cfg.facteur_route)) / cfg.vitesse_kmh) * 60);
    let lit = null;
    if (r.partage === 'complet' && r.libres) {
      const l = await pool.query(
        `SELECT l.id, l.code, l.version FROM lits l WHERE l.etablissement_id = $1 AND l.type_id = $2 AND l.etat = 'libre'${filtre}
          ORDER BY l.code LIMIT 1`, [r.etablissement_id, r.type_id]);
      lit = l.rows[0] || null;
    }
    const occ = r.dotes ? Math.round(((r.dotes - r.libres) / r.dotes) * 100) : 100;
    res.push({
      etablissement_id: r.etablissement_id, nom: r.nom, ville: r.ville, partage: r.partage,
      distance_km: d, minutes_route: minutes, libres: r.libres, prevus: r.prevus, occupation: occ,
      niveau, pression, cout: d + penalite, lit,
    });
  }
  // Lits disponibles maintenant d'abord, puis du plus proche (pénalité de tension comprise) au plus loin
  res.sort((a, b) => ((b.libres > 0) - (a.libres > 0)) || (a.cout - b.cout) || (b.libres - a.libres));
  const premierLibre = res.find((x) => x.libres);
  for (const x of res) {
    const route = `≈ ${x.minutes_route} min de route (${x.distance_km} km)`;
    const dispo = x.libres ? `${x.libres} lit(s) adapté(s) libre(s)` : `aucun lit libre, ${x.prevus} prévu(s) d’ici ${cfg.horizon_h} h`;
    const tension = x.niveau === 'vert' ? 'niveau vert' : `niveau ${x.niveau}, pression ${x.pression} %`;
    x.raison = `${route} · ${dispo} · ${tension}`;
    if (x === premierLibre) {
      x.recommande = true;
      const plusProche = res.filter((y) => y.libres && y.distance_km < x.distance_km);
      x.pourquoi = plusProche.length
        ? `Recommandé : ${plusProche.map((y) => y.nom).join(', ')} ${plusProche.length > 1 ? 'sont' : 'est'} plus proche${plusProche.length > 1 ? 's' : ''} mais en ${plusProche.map((y) => y.niveau).join('/')}`
        : 'Recommandé : le plus proche avec un lit adapté';
    }
  }
  const loc = await pool.query(
    `SELECT count(*) FILTER (WHERE l.etat = 'libre'${filtre})::int AS libres FROM lits l WHERE l.etablissement_id = $1 AND l.type_id = $2`,
    [ici.id, typeId]);
  return { libres_ici: loc.rows[0].libres, suggestions: res };
}

/* ------------------------------------------------------------------ lits */
async function litsEtablissement(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const { rows } = await pool.query(
    `SELECT l.id, l.code, l.etat, l.patient_ref, l.version, l.etat_depuis, l.sortie_prevue,
            l.blocage_niveau, l.blocage_motif, l.isolement, l.pression_negative, l.ventilation, l.telemetrie,
            l.motif_indispo, l.nsa_depuis, l.nsa_orientation, l.conge_statut, l.nettoyage_debut,
            ch.numero AS chambre, u.nom AS unite, t.code AS type_code,
            t.id AS type_id, tr.numero AS transfert_numero
       FROM lits l
       JOIN chambres ch ON ch.id = l.chambre_id
       JOIN unites u ON u.id = l.unite_id
       JOIN types_unite t ON t.id = l.type_id
       LEFT JOIN transferts tr ON tr.id = l.transfert_id
      WHERE l.etablissement_id = $1
      ORDER BY t.ordre, l.code`, [etabId]);
  return rows;
}

/** Vérifie que l'utilisateur peut agir sur ce lit. 404 sinon, pour ne rien révéler. */
async function litVisible(pool, utilisateur, litId) {
  const { rows } = await pool.query('SELECT id, etablissement_id FROM lits WHERE id = $1', [litId]);
  if (!rows[0] || !peutAgirPour(utilisateur, rows[0].etablissement_id)) throw new ErreurHttp(404, 'Lit introuvable.');
  return rows[0];
}

/* ------------------------------------------------------------------ transferts */
async function creerTransfert(pool, utilisateur, b, client = null) {
  const origineId = Number(b.origine_id);
  const destId = Number(b.destination_id);
  const typeId = Number(b.type_id);
  exigerEtablissement(utilisateur, origineId);
  const origine = await etablissement(pool, origineId);
  exigerActif(origine);
  if (origineId === destId) throw new ErreurHttp(400, 'Choisissez un autre établissement que le vôtre.');
  const dest = await etablissement(pool, destId);
  exigerActif(dest);
  if (dest.partage === 'aucun' || dest.config_id !== origine.config_id) {
    throw new ErreurHttp(403, 'Cet établissement ne partage pas sa capacité.');
  }
  const type = await pool.query('SELECT * FROM types_unite WHERE id = $1 AND config_id = $2', [typeId, origine.config_id]);
  if (!type.rows[0]) throw new ErreurHttp(400, "Type d'unité inconnu.");
  const distance = distanceKm(origine, dest);
  if (distance > origine.config.rayon_km) throw new ErreurHttp(400, 'Établissement hors du rayon de suggestion.');

  const besoins = lireBesoins(b.besoins || {});
  const filtre = sqlBesoins(besoins);
  const executer = async (c) => {
    let litId; let version;
    if (dest.partage === 'complet' && b.lit_id) {
      const l = await c.query(`SELECT l.id FROM lits l WHERE l.id = $1 AND l.etablissement_id = $2 AND l.type_id = $3${filtre}`,
        [b.lit_id, destId, typeId]);
      if (!l.rows[0]) throw new ErreurHttp(400, 'Lit proposé invalide ou ne répondant pas aux besoins du patient.');
      litId = l.rows[0].id;
      version = b.version;
    } else {
      // partage agrégé : le lit est attribué ici, sans jamais prendre un lit déjà verrouillé
      const l = await c.query(
        `SELECT l.id, l.version FROM lits l WHERE l.etablissement_id = $1 AND l.type_id = $2 AND l.etat = 'libre'${filtre}
          ORDER BY l.code LIMIT 1 FOR NO KEY UPDATE OF l SKIP LOCKED`, [destId, typeId]);
      if (!l.rows[0]) throw new ErreurHttp(409, `Plus aucun lit libre à ${dest.nom}. Relancez la recherche.`);
      litId = l.rows[0].id;
      version = l.rows[0].version;
    }
    const lit = await changerEtat(c, pool, utilisateur.id, litId, 'reserve', {
      versionAttendue: version, patientRef: b.patient_ref, detail: `Réservé pour un transfert depuis ${origine.nom}`,
    });
    const t = await c.query(
      `INSERT INTO transferts (numero, patient_ref, origine_id, destination_id, type_id, lit_id, urgent, distance_km, demande_par, besoins, demande_admission_id)
       VALUES ('TR-' || lpad(nextval('transfert_seq')::text, 5, '0'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [lit.patient_ref, origineId, destId, typeId, litId, !!b.urgent, distance, utilisateur.id, besoins, b.demande_admission_id || null]);
    const tr = t.rows[0];
    await c.query('UPDATE lits SET transfert_id = $2 WHERE id = $1', [litId, tr.id]);
    await journaliser(c, { litId, utilisateurId: utilisateur.id, action: 'Référence transmise',
      detail: `${tr.patient_ref} → ${dest.nom}`, transfertId: tr.id });
    await notifier(c, destId, tr.id,
      `Nouvelle demande ${tr.numero}${tr.urgent ? ' (URGENT)' : ''} : ${type.rows[0].nom}, lit ${lit.code} réservé, depuis ${origine.nom}.`);
    return { ...tr, lit_code: lit.code };
  };
  return client ? executer(client) : transaction(pool, executer);
}

const ETAPES = {
  accepter: { de: ['demande'], cote: 'destination', vers: 'validee' },
  refuser: { de: ['demande', 'validee'], cote: 'destination', vers: 'refuse' },
  transport: { de: ['validee'], cote: 'origine', vers: 'transport' },
  depart: { de: ['transport'], cote: 'origine', vers: 'en_route' },
  reception: { de: ['en_route'], cote: 'destination', vers: 'recu' },
};

async function avancerTransfert(pool, utilisateur, transfertId, etape, corps = {}) {
  const regle = ETAPES[etape];
  if (!regle) throw new ErreurHttp(400, 'Action inconnue.');
  return transaction(pool, async (c) => {
    const r = await c.query(
      `SELECT t.*, o.nom AS origine_nom, d.nom AS destination_nom, c.transport_libelle, l.code AS lit_code
         FROM transferts t
         JOIN etablissements o ON o.id = t.origine_id
         JOIN etablissements d ON d.id = t.destination_id
         JOIN config_pays c ON c.id = o.config_id
         LEFT JOIN lits l ON l.id = t.lit_id
        WHERE t.id = $1 FOR UPDATE OF t`, [transfertId]);
    const t = r.rows[0];
    if (!t || !(peutAgirPour(utilisateur, t.origine_id) || peutAgirPour(utilisateur, t.destination_id))) {
      throw new ErreurHttp(404, 'Transfert introuvable.');
    }
    const cote = regle.cote === 'origine' ? t.origine_id : t.destination_id;
    if (!peutAgirPour(utilisateur, cote)) {
      throw new ErreurHttp(403, `Cette action revient à ${regle.cote === 'origine' ? t.origine_nom : t.destination_nom}.`);
    }
    if (!regle.de.includes(t.statut)) {
      throw new ErreurHttp(409, `Le transfert ${t.numero} n’est plus au statut attendu. Rafraîchissez la page.`);
    }
    const maj = { statut: regle.vers };
    let journal = null; let message = null; let dest = null;
    if (etape === 'accepter') {
      maj.date_validation = 'now()';
      journal = 'Transfert validé';
      dest = t.origine_id; message = `${t.destination_nom} accepte le transfert ${t.numero} (lit ${t.lit_code}).`;
    } else if (etape === 'refuser') {
      if (t.lit_id) {
        const l = await c.query('SELECT etat FROM lits WHERE id = $1', [t.lit_id]);
        if (l.rows[0] && l.rows[0].etat === 'reserve') {
          await changerEtat(c, pool, utilisateur.id, t.lit_id, 'libre',
            { depuisTransfert: true, transfertId: t.id, detail: `Transfert ${t.numero} refusé` });
        }
      }
      maj.motif_refus = String(corps.motif || '').slice(0, 300) || null;
      maj.motif_refus_code = ['pas_de_lit', 'pas_de_personnel', 'plateau_technique', 'autre'].includes(corps.motif_code) ? corps.motif_code : 'autre';
      dest = t.origine_id; message = `${t.destination_nom} refuse le transfert ${t.numero}. Cherchez un autre lit.`;
    } else if (etape === 'transport') {
      maj.transport_info = t.urgent ? `${t.transport_libelle} prioritaire` : t.transport_libelle;
      journal = 'Transport organisé';
    } else if (etape === 'depart') {
      maj.date_depart = 'now()';
      journal = 'Départ confirmé';
      dest = t.destination_id; message = `Le patient ${t.patient_ref} du transfert ${t.numero} est en route.`;
    } else if (etape === 'reception') {
      if (t.lit_id) {
        await changerEtat(c, pool, utilisateur.id, t.lit_id, 'occupe',
          { transfertId: t.id, detail: `Patient reçu (${t.numero})` });
      }
      maj.date_reception = 'now()';
      dest = t.origine_id; message = `Patient ${t.patient_ref} reçu à ${t.destination_nom}.`;
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
    if (dest) await notifier(c, dest, t.id, message);
    return u.rows[0];
  });
}

async function listeTransferts(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const { rows } = await pool.query(
    `SELECT t.*, o.nom AS origine_nom, d.nom AS destination_nom, ty.nom AS type_nom, l.code AS lit_code
       FROM transferts t
       JOIN etablissements o ON o.id = t.origine_id
       JOIN etablissements d ON d.id = t.destination_id
       JOIN types_unite ty ON ty.id = t.type_id
       LEFT JOIN lits l ON l.id = t.lit_id
      WHERE t.origine_id = $1 OR t.destination_id = $1
      ORDER BY t.urgent DESC, t.date_demande DESC
      LIMIT 300`, [etabId]);
  return rows;
}

/* ------------------------------------------------------------------ journal, notifications */
async function lireJournal(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const { rows } = await pool.query(
    `SELECT j.id, j.date, j.action, j.ancien_etat, j.nouvel_etat, j.detail, j.refuse,
            l.code AS lit_code, u.nom AS utilisateur, t.numero AS transfert_numero
       FROM journal j
       LEFT JOIN lits l ON l.id = j.lit_id
       LEFT JOIN utilisateurs u ON u.id = j.utilisateur_id
       LEFT JOIN transferts t ON t.id = j.transfert_id
      WHERE j.etablissement_id = $1
         OR j.transfert_id IN (SELECT id FROM transferts WHERE origine_id = $1 OR destination_id = $1)
      ORDER BY j.date DESC, j.id DESC
      LIMIT 300`, [etabId]);
  return rows;
}

async function lireNotifications(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const { rows } = await pool.query(
    `SELECT n.*, t.numero FROM notifications n LEFT JOIN transferts t ON t.id = n.transfert_id
      WHERE n.etablissement_id = $1 ORDER BY n.date DESC LIMIT 50`, [etabId]);
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
    let niveau = null; let motif = null;
    if (l.etat === 'nettoyage' && age > 2 * l.nettoyage_cible_min) {
      niveau = 'modere'; motif = `Nettoyage depuis ${Math.round(age)} min (cible ${l.nettoyage_cible_min} min)`;
    } else if (l.etat === 'reserve' && age > l.reservation_max_min && !l.en_transfert) {
      niveau = 'eleve'; motif = `Réservé depuis ${Math.round(age)} min sans admission`;
    } else if (l.etat === 'occupe' && l.sortie_prevue && Number(l.retard_min) > l.marge_conge_min) {
      niveau = 'modere'; motif = `Congé prévu dépassé de ${Math.floor(Number(l.retard_min) / 60)} h (attente d’hébergement ?)`;
    } else if (l.etat === 'indispo' && age > l.hors_service_max_h * 60) {
      niveau = 'faible'; motif = `Hors service depuis ${Math.floor(age / 60)} h`;
    }
    if (niveau !== l.blocage_niveau || motif !== l.blocage_motif) {
      await pool.query('UPDATE lits SET blocage_niveau = $2, blocage_motif = $3 WHERE id = $1', [l.id, niveau, motif]);
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
  const reseau = await capaciteReseau(pool, utilisateur, etabId);
  const q = normaliser(question);
  const types = await pool.query('SELECT id, code, nom FROM types_unite WHERE config_id = $1 ORDER BY ordre', [reseau.config.id]);
  const type = types.rows.find((t) => {
    const n = normaliser(t.nom);
    return q.includes(n.slice(0, 5)) || new RegExp(`\\b${normaliser(t.code)}\\b`).test(q);
  }) || (/(intensi|\brea\b)/.test(q) && types.rows.find((t) => t.code === 'SI'))
     || (/(accouch|obste)/.test(q) && types.rows.find((t) => t.code === 'MAT')) || null;
  const moi = reseau.etablissements.find((e) => e.moi);

  if (/(bloqu|anomal|probleme|goulot|retard)/.test(q)) {
    const { rows } = await pool.query(
      `SELECT code, blocage_motif FROM lits WHERE etablissement_id = $1 AND blocage_niveau IS NOT NULL
        ORDER BY CASE blocage_niveau WHEN 'eleve' THEN 0 WHEN 'modere' THEN 1 ELSE 2 END, code`, [etabId]);
    return rows.length
      ? `${rows.length} blocage(s) à ${moi.nom} :\n${rows.map((r) => `• ${r.code} : ${r.blocage_motif}`).join('\n')}`
      : `Aucun blocage détecté à ${moi.nom}.`;
  }
  if (/(prevu|bientot|liber|heure|ce soir|demain)/.test(q)) {
    const unites = moi.unites.filter((u) => !type || u.type_id === type.id);
    return `Lits qui devraient se libérer d’ici ${reseau.config.horizon_h} h à ${moi.nom} :\n`
      + unites.map((u) => `• ${u.type_nom} : ${u.prevus}`).join('\n')
      + '\nPrévision basée sur les congés prévus et les nettoyages en cours.';
  }
  if (/(\bou\b|proche|trouver|ailleurs|transf)/.test(q)) {
    const t = type || types.rows[0];
    const r = await recommander(pool, utilisateur, etabId, t.id);
    const s = r.suggestions.find((x) => x.libres);
    if (!s) return `Aucun lit ${t.nom.toLowerCase()} libre dans le rayon de ${reseau.config.rayon_km} km.`;
    return `Meilleure option en ${t.nom.toLowerCase()} : ${s.nom} (${s.ville}, ${s.distance_km} km), `
      + `${s.libres} lit(s) libre(s), ${s.prevus} prévu(s).\nUtilisez « Chercher un lit ailleurs » pour réserver. `
      + 'La réservation demande toujours une validation.';
  }
  if (/(combien|libre|dispo|capacite|place)/.test(q)) {
    const lignes = types.rows.filter((t) => !type || t.id === type.id).map((t) => {
      const ici = moi.unites.find((u) => u.type_id === t.id);
      const reseauLibres = reseau.etablissements.reduce(
        (s, e) => s + (e.unites.find((u) => u.type_id === t.id)?.libres || 0), 0);
      return `• ${t.nom} : ${ici ? `${ici.libres} libre(s) ici, ` : 'pas d’unité ici, '}${reseauLibres} dans le réseau`;
    });
    return lignes.join('\n');
  }
  return 'Je peux répondre à des questions comme :\n• Combien de lits libres en soins intensifs ?\n'
    + '• Où trouver un lit de chirurgie le plus proche ?\n• Quels lits bloquent chez nous ?\n'
    + '• Combien de lits vont se libérer d’ici ce soir ?';
}

module.exports = {
  distanceKm, etablissement, capaciteReseau, recommander, litsEtablissement, litVisible,
  creerTransfert, avancerTransfert, listeTransferts, lireJournal, lireNotifications,
  detecterBlocages, assistant, exigerActif, niveauDepuis, lireBesoins, sqlBesoins, notifier, SQL_CAPACITE, risque,
};
