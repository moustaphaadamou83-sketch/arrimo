const { transaction, ErreurHttp } = require('./db');
const { changerEtat, journaliser } = require('./regles');
const { exigerEtablissement, peutAgirPour } = require('./auth');
const { tr, dico, traducteurTypes } = require('./langue');

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
  return lit.blocage_code ? tr(langue, `blocage.${lit.blocage_code}`, lit.blocage_vars || {}) : lit.blocage_motif;
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
  const L = utilisateur.langue;
  const niv = dico(L, 'niveau');
  for (const x of res) {
    const route = tr(L, 'route', { min: x.minutes_route, km: x.distance_km });
    const dispo = x.libres ? tr(L, 'dispo_libres', { n: x.libres }) : tr(L, 'dispo_prevus', { n: x.prevus, h: cfg.horizon_h });
    const tension = x.niveau === 'vert' ? tr(L, 'tension_vert') : tr(L, 'tension', { niveau: niv[x.niveau], p: x.pression });
    x.raison = `${route} · ${dispo} · ${tension}`;
    if (x === premierLibre) {
      x.recommande = true;
      const plusProche = res.filter((y) => y.libres && y.distance_km < x.distance_km);
      x.pourquoi = plusProche.length
        ? tr(L, plusProche.length > 1 ? 'pourquoi_plusieurs' : 'pourquoi_un',
          { noms: plusProche.map((y) => y.nom).join(', '), niveaux: plusProche.map((y) => niv[y.niveau]).join('/') })
        : tr(L, 'pourquoi_proche');
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
            l.blocage_code, l.blocage_vars, t.id AS type_id, tr.numero AS transfert_numero
       FROM lits l
       JOIN chambres ch ON ch.id = l.chambre_id
       JOIN unites u ON u.id = l.unite_id
       JOIN types_unite t ON t.id = l.type_id
       LEFT JOIN transferts tr ON tr.id = l.transfert_id
      WHERE l.etablissement_id = $1
      ORDER BY t.ordre, l.code`, [etabId]);
  for (const r of rows) r.blocage_motif = motifBlocage(utilisateur.langue, r);
  return rows;
}

/** Vérifie que l'utilisateur peut agir sur ce lit. 404 sinon, pour ne rien révéler. */
async function litVisible(pool, utilisateur, litId) {
  const { rows } = await pool.query('SELECT id, etablissement_id FROM lits WHERE id = $1', [litId]);
  if (!rows[0] || !peutAgirPour(utilisateur, rows[0].etablissement_id)) throw new ErreurHttp(404, 'lit_introuvable');
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
  if (origineId === destId) throw new ErreurHttp(400, 'autre_etab');
  const dest = await etablissement(pool, destId);
  exigerActif(dest);
  if (dest.partage === 'aucun' || dest.config_id !== origine.config_id) {
    throw new ErreurHttp(403, 'etab_ne_partage_pas');
  }
  const type = await pool.query('SELECT * FROM types_unite WHERE id = $1 AND config_id = $2', [typeId, origine.config_id]);
  if (!type.rows[0]) throw new ErreurHttp(400, 'type_unite_inconnu');
  const distance = distanceKm(origine, dest);
  if (distance > origine.config.rayon_km) throw new ErreurHttp(400, 'hors_rayon');

  const besoins = lireBesoins(b.besoins || {});
  const filtre = sqlBesoins(besoins);
  const executer = async (c) => {
    let litId; let version;
    if (dest.partage === 'complet' && b.lit_id) {
      const l = await c.query(`SELECT l.id FROM lits l WHERE l.id = $1 AND l.etablissement_id = $2 AND l.type_id = $3${filtre}`,
        [b.lit_id, destId, typeId]);
      if (!l.rows[0]) throw new ErreurHttp(400, 'lit_propose_invalide');
      litId = l.rows[0].id;
      version = b.version;
    } else {
      // partage agrégé : le lit est attribué ici, sans jamais prendre un lit déjà verrouillé
      const l = await c.query(
        `SELECT l.id, l.version FROM lits l WHERE l.etablissement_id = $1 AND l.type_id = $2 AND l.etat = 'libre'${filtre}
          ORDER BY l.code LIMIT 1 FOR NO KEY UPDATE OF l SKIP LOCKED`, [destId, typeId]);
      if (!l.rows[0]) throw new ErreurHttp(409, 'plus_de_lit', { etab: dest.nom });
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
    await notifier(c, destId, tr.id, 'transfert_demande',
      { numero: tr.numero, urgent: tr.urgent ? ' (URGENT)' : '', type: type.rows[0].nom, lit: lit.code, origine: origine.nom });
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
  if (!regle) throw new ErreurHttp(400, 'action_inconnue');
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
      throw new ErreurHttp(404, 'transfert_introuvable');
    }
    const cote = regle.cote === 'origine' ? t.origine_id : t.destination_id;
    if (!peutAgirPour(utilisateur, cote)) {
      throw new ErreurHttp(403, 'action_revient_a', { etab: regle.cote === 'origine' ? t.origine_nom : t.destination_nom });
    }
    if (!regle.de.includes(t.statut)) {
      throw new ErreurHttp(409, 'transfert_statut', { numero: t.numero });
    }
    const maj = { statut: regle.vers };
    let journal = null; let notif = null; let dest = null;
    if (etape === 'accepter') {
      maj.date_validation = 'now()';
      journal = 'Transfert validé';
      dest = t.origine_id; notif = ['transfert_accepte', { dest: t.destination_nom, numero: t.numero, lit: t.lit_code }];
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
      dest = t.origine_id; notif = ['transfert_refuse', { dest: t.destination_nom, numero: t.numero }];
    } else if (etape === 'transport') {
      maj.transport_info = t.urgent ? `${t.transport_libelle} prioritaire` : t.transport_libelle;
      journal = 'Transport organisé';
    } else if (etape === 'depart') {
      maj.date_depart = 'now()';
      journal = 'Départ confirmé';
      dest = t.destination_id; notif = ['transfert_depart', { ref: t.patient_ref, numero: t.numero }];
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
  const nomType = await traducteurTypes(pool, utilisateur.langue);
  for (const n of rows) {
    if (n.code) n.message = tr(utilisateur.langue, `notif.${n.code}`, { ...n.vars, ...(n.vars?.type ? { type: nomType(n.vars.type) } : {}) });
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
    const motif = code ? tr('fr', `blocage.${code}`, vars) : null;
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
    const s = r.suggestions.find((x) => x.libres);
    if (!s) return tr(L, 'q_ou_aucun', { type: nomType(t).toLowerCase(), km: reseau.config.rayon_km });
    return tr(L, 'q_ou', { type: nomType(t).toLowerCase(), etab: s.nom, ville: s.ville, km: s.distance_km, libres: s.libres, prevus: s.prevus });
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
  distanceKm, etablissement, capaciteReseau, recommander, litsEtablissement, litVisible,
  creerTransfert, avancerTransfert, listeTransferts, lireJournal, lireNotifications,
  detecterBlocages, assistant, exigerActif, motifBlocage, niveauDepuis, lireBesoins, sqlBesoins, notifier, SQL_CAPACITE, risque,
};
