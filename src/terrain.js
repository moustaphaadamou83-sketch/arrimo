/**
 * Fonctions qui répondent aux problèmes du terrain :
 * file d'admission, NSA, congés, nettoyage priorisé, niveaux d'alerte, indicateurs.
 */
const { transaction, ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const { changerEtat, journaliser } = require('./regles');
const s = require('./services');
const { tr, traducteurTypes, duree } = require('./langue');
const cv = require('./civieres');

const ORIENTATIONS = ['chsld', 'ri', 'readaptation', 'domicile', 'palliatif', 'autre'];
const CONGES = ['prevu', 'confirme', 'attente_transport'];

/** Modifie un attribut d'un lit occupé sans changer son état, sous verrou, avec journal. */
async function modifierLitOccupe(pool, utilisateur, litId, champs, action, detail) {
  return transaction(pool, async (c) => {
    const r = await c.query(
      `SELECT l.*, e.module_actif FROM lits l JOIN etablissements e ON e.id = l.etablissement_id
        WHERE l.id = $1 FOR NO KEY UPDATE OF l`, [litId]);
    const lit = r.rows[0];
    if (!lit) throw new ErreurHttp(404, 'lit_introuvable');
    if (!lit.module_actif) throw new ErreurHttp(403, 'module_inactif_etab');
    if (lit.etat !== 'occupe') throw new ErreurHttp(409, 'lit_non_occupe', { code: lit.code });
    const cles = Object.keys(champs);
    const sets = cles.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const u = await c.query(`UPDATE lits SET ${sets} WHERE id = $1 RETURNING *`, [litId, ...cles.map((k) => champs[k])]);
    await journaliser(c, { litId, utilisateurId: utilisateur.id, action, detail });
    return u.rows[0];
  });
}

async function designerNsa(pool, utilisateur, litId, orientation) {
  if (!ORIENTATIONS.includes(orientation)) throw new ErreurHttp(400, 'orientation_inconnue');
  return modifierLitOccupe(pool, utilisateur, litId,
    { nsa_depuis: new Date(), nsa_orientation: orientation }, 'Désignation NSA', `Orientation : ${orientation}`);
}
async function retirerNsa(pool, utilisateur, litId) {
  return modifierLitOccupe(pool, utilisateur, litId, { nsa_depuis: null, nsa_orientation: null }, 'Fin du statut NSA', null);
}
async function changerNsaOrientation(pool, utilisateur, litId, orientation) {
  if (!ORIENTATIONS.includes(orientation)) throw new ErreurHttp(400, 'orientation_inconnue');
  return modifierLitOccupe(pool, utilisateur, litId, { nsa_orientation: orientation }, 'Orientation NSA modifiée', orientation);
}
async function majConge(pool, utilisateur, litId, statut, date) {
  if (statut !== null && !CONGES.includes(statut)) throw new ErreurHttp(400, 'conge_statut_inconnu');
  const champs = { conge_statut: statut };
  if (date !== undefined) {
    const d = date ? new Date(date) : null;
    if (d && Number.isNaN(d.getTime())) throw new ErreurHttp(400, 'date_invalide');
    champs.sortie_prevue = d;
  }
  return modifierLitOccupe(pool, utilisateur, litId, champs, 'Congé mis à jour',
    `${statut || 'aucun'}${champs.sortie_prevue ? ` · ${champs.sortie_prevue.toISOString()}` : ''}`);
}

/* ------------------------------------------------------------------ nettoyage */
async function debuterNettoyage(pool, utilisateur, litId) {
  return transaction(pool, async (c) => {
    const { rows } = await c.query(
      `UPDATE lits SET nettoyage_debut = now() WHERE id = $1 AND etat = 'nettoyage' AND nettoyage_debut IS NULL RETURNING *`, [litId]);
    if (!rows[0]) throw new ErreurHttp(409, 'nettoyage_impossible');
    await journaliser(c, { litId, utilisateurId: utilisateur.id, action: 'Nettoyage commencé' });
    return rows[0];
  });
}

/** Lits à nettoyer, du plus urgent au moins urgent : une unité avec des patients en attente passe en premier. */
async function fileNettoyage(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const { rows } = await pool.query(
    `SELECT l.id, l.code, l.version, l.etat_depuis, l.nettoyage_debut, l.isolement, u.nom AS unite, ch.numero AS chambre,
            t.nom AS type_nom, c.nettoyage_cible_min,
            (SELECT count(*)::int FROM demandes_admission d
              WHERE d.etablissement_id = l.etablissement_id AND d.type_id = l.type_id AND d.statut = 'attente') AS en_attente,
            (SELECT count(*)::int FROM lits l2
              WHERE l2.etablissement_id = l.etablissement_id AND l2.type_id = l.type_id AND l2.etat = 'libre') AS libres_unite,
            EXTRACT(EPOCH FROM (now() - l.etat_depuis)) / 60 AS age_min
       FROM lits l
       JOIN unites u ON u.id = l.unite_id JOIN chambres ch ON ch.id = l.chambre_id
       JOIN types_unite t ON t.id = l.type_id
       JOIN etablissements e ON e.id = l.etablissement_id JOIN config_pays c ON c.id = e.config_id
      WHERE l.etablissement_id = $1 AND l.etat = 'nettoyage'`, [etabId]);
  const L = utilisateur.langue;
  const nomType = await traducteurTypes(pool, L);
  for (const r of rows) {
    r.genre = 'lit';
    const manque = Math.max(0, r.en_attente - r.libres_unite);
    r.priorite_score = manque * 100 + Number(r.age_min);
    r.priorite = manque > 0 ? 'haute' : Number(r.age_min) > r.nettoyage_cible_min ? 'moyenne' : 'normale';
    r.raison = manque > 0 ? tr(L, 'net_attente', { n: r.en_attente, type: nomType(r.type_nom).toLowerCase() })
      : Number(r.age_min) > r.nettoyage_cible_min ? tr(L, 'net_long', { duree: duree(L, r.nettoyage_cible_min) }) : tr(L, 'net_ordre');
  }
  // Civières de l'urgence à nettoyer : une civière régulière passe en premier si des patients attendent en corridor
  const civ = await pool.query(
    `SELECT cv.id, cv.code, cv.categorie, cv.version, cv.etat_depuis, c.nettoyage_civiere_cible_min,
            EXTRACT(EPOCH FROM (now() - cv.etat_depuis)) / 60 AS age_min,
            (SELECT count(*)::int FROM civieres x WHERE x.etablissement_id = cv.etablissement_id AND x.etat = 'occupee' AND x.categorie = 'debordement') AS en_corridor
       FROM civieres cv JOIN etablissements e ON e.id = cv.etablissement_id JOIN config_pays c ON c.id = e.config_id
      WHERE cv.etablissement_id = $1 AND cv.etat = 'nettoyage'`, [etabId]);
  for (const r of civ.rows) {
    r.genre = 'civiere';
    const manque = r.categorie === 'reguliere' ? r.en_corridor : 0;
    const age = Number(r.age_min);
    r.priorite_score = manque * 100 + age;
    r.priorite = manque > 0 ? 'haute' : age > r.nettoyage_civiere_cible_min ? 'moyenne' : 'normale';
    r.raison = manque > 0 ? tr(L, 'net_civiere_corridor', { n: manque })
      : age > r.nettoyage_civiere_cible_min ? tr(L, 'net_long', { duree: duree(L, r.nettoyage_civiere_cible_min) }) : tr(L, 'net_ordre');
  }
  return [...rows, ...civ.rows].sort((a, b) => b.priorite_score - a.priorite_score);
}

/* ------------------------------------------------------------------ file d'admission */
function besoinsDemande(d) {
  return { isolement: d.besoin_isolement, pression_negative: d.besoin_pression_negative,
    ventilation: d.besoin_ventilation, telemetrie: d.besoin_telemetrie };
}

async function creerDemande(pool, utilisateur, b) {
  const etabId = Number(b.etablissement_id);
  exigerEtablissement(utilisateur, etabId);
  const etab = await s.etablissement(pool, etabId);
  s.exigerActif(etab);
  // Patient sur civière à l'urgence : la demande est liée à sa civière (la référence vient de la civière)
  const civiereId = b.civiere_id ? Number(b.civiere_id) : null;
  if (b.civiere_id && !Number.isInteger(civiereId)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'civiere_id' });
  const civiere = civiereId ? await cv.civierePourDemande(pool, etabId, civiereId, String(b.patient_ref || '').trim() || null) : null;
  const ref = civiere ? civiere.patient_ref : String(b.patient_ref || '').trim();
  if (!new RegExp(etab.config.reference_regex).test(ref)) {
    throw new ErreurHttp(400, 'reference_invalide', { exemple: etab.config.reference_exemple });
  }
  const type = await pool.query('SELECT id FROM types_unite WHERE id = $1 AND config_id = $2', [b.type_id, etab.config_id]);
  if (!type.rows[0]) throw new ErreurHttp(400, 'type_unite_inconnu');
  const be = s.lireBesoins(b.besoins || b);
  try {
    const { rows } = await pool.query(
      `INSERT INTO demandes_admission (etablissement_id, provenance, type_id, patient_ref, priorite,
         besoin_isolement, besoin_pression_negative, besoin_ventilation, besoin_telemetrie, cree_par, civiere_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [etabId, civiere ? 'urgence' : ['urgence', 'bloc', 'externe', 'autre'].includes(b.provenance) ? b.provenance : 'urgence', type.rows[0].id, ref,
        ['p1', 'p2', 'p3'].includes(b.priorite) ? b.priorite : 'p2',
        be.isolement, be.pression_negative, be.ventilation, be.telemetrie, utilisateur.id, civiereId]);
    return rows[0];
  } catch (e) {
    if (e.code === '23505' && civiere) throw new ErreurHttp(409, 'civiere_deja_demande', { code: civiere.code });
    throw e;
  }
}

/** File d'admission avec, pour chaque demande, le meilleur lit libre de l'établissement qui respecte les besoins. */
async function fileAdmission(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const { rows } = await pool.query(
    `SELECT d.*, t.nom AS type_nom, l.code AS lit_code, c.attente_admission_max_min,
            EXTRACT(EPOCH FROM (now() - d.cree_le)) / 60 AS attente_min,
            cv.code AS civiere_code, cv.categorie AS civiere_categorie,
            EXTRACT(EPOCH FROM (now() - cv.arrivee_le)) / 3600 AS heures_civiere
       FROM demandes_admission d
       JOIN types_unite t ON t.id = d.type_id
       JOIN etablissements e ON e.id = d.etablissement_id JOIN config_pays c ON c.id = e.config_id
       LEFT JOIN lits l ON l.id = d.lit_id
       LEFT JOIN civieres cv ON cv.id = d.civiere_id AND cv.etat = 'occupee'
      WHERE d.etablissement_id = $1 AND d.statut IN ('attente', 'assignee')
      ORDER BY d.priorite, d.cree_le`, [etabId]);
  for (const d of rows) {
    d.attente_min = Math.round(Number(d.attente_min));
    d.depasse = d.attente_min > d.attente_admission_max_min;
    d.heures_civiere = d.heures_civiere == null ? null : Math.floor(Number(d.heures_civiere));
    if (d.statut === 'attente') {
      const l = await pool.query(
        `SELECT l.id, l.code, l.version FROM lits l WHERE l.etablissement_id = $1 AND l.type_id = $2 AND l.etat = 'libre'${s.sqlBesoins(besoinsDemande(d))}
          ORDER BY l.isolement, l.pression_negative, l.ventilation, l.telemetrie, l.code LIMIT 1`, [etabId, d.type_id]);
      d.lit_suggere = l.rows[0] || null;
    }
  }
  return rows;
}

async function lireDemande(c, utilisateur, id) {
  const r = await c.query('SELECT * FROM demandes_admission WHERE id = $1 FOR UPDATE', [id]);
  const d = r.rows[0];
  if (!d) throw new ErreurHttp(404, 'demande_introuvable');
  exigerEtablissement(utilisateur, d.etablissement_id);
  return d;
}

async function assignerLit(pool, utilisateur, demandeId, litId, version) {
  return transaction(pool, async (c) => {
    const d = await lireDemande(c, utilisateur, demandeId);
    if (d.statut !== 'attente') throw new ErreurHttp(409, 'demande_plus_en_attente');
    const ok = await c.query(`SELECT l.id FROM lits l WHERE l.id = $1 AND l.etablissement_id = $2 AND l.type_id = $3${s.sqlBesoins(besoinsDemande(d))}`,
      [litId, d.etablissement_id, d.type_id]);
    if (!ok.rows[0]) throw new ErreurHttp(400, 'lit_inadapte');
    const lit = await changerEtat(c, pool, utilisateur.id, litId, 'reserve',
      { versionAttendue: version, patientRef: d.patient_ref, detail: `Assigné à la demande d’admission n° ${d.id} (${d.provenance})` });
    const u = await c.query(`UPDATE demandes_admission SET statut = 'assignee', lit_id = $2, assignee_le = now() WHERE id = $1 RETURNING *`, [d.id, litId]);
    return { ...u.rows[0], lit_code: lit.code };
  });
}

async function admettreDemande(pool, utilisateur, demandeId) {
  return transaction(pool, async (c) => {
    const d = await lireDemande(c, utilisateur, demandeId);
    if (d.statut !== 'assignee') throw new ErreurHttp(409, 'assigner_dabord');
    const lit = await changerEtat(c, pool, utilisateur.id, d.lit_id, 'occupe', { detail: `Admission depuis ${d.provenance}` });
    // Le patient quitte sa civière : elle part au nettoyage
    await cv.libererPourDemande(c, pool, utilisateur.id, d, `Patient admis au lit ${lit.code}`);
    const u = await c.query(`UPDATE demandes_admission SET statut = 'admise', terminee_le = now() WHERE id = $1 RETURNING *`, [d.id]);
    return u.rows[0];
  });
}

async function annulerDemande(pool, utilisateur, demandeId) {
  return transaction(pool, async (c) => {
    const d = await lireDemande(c, utilisateur, demandeId);
    if (!['attente', 'assignee'].includes(d.statut)) throw new ErreurHttp(409, 'demande_terminee');
    if (d.statut === 'assignee') {
      await changerEtat(c, pool, utilisateur.id, d.lit_id, 'libre', { detail: `Demande d’admission n° ${d.id} annulée` });
    }
    const u = await c.query(`UPDATE demandes_admission SET statut = 'annulee', terminee_le = now() WHERE id = $1 RETURNING *`, [d.id]);
    return u.rows[0];
  });
}

/** Pas de lit adapté ici : la demande devient un transfert vers un autre établissement, dans la même transaction. */
async function transfererDemande(pool, utilisateur, demandeId, b) {
  return transaction(pool, async (c) => {
    const d = await lireDemande(c, utilisateur, demandeId);
    if (d.statut !== 'attente') throw new ErreurHttp(409, 'demande_plus_en_attente');
    const tr = await s.creerTransfert(pool, utilisateur, {
      origine_id: d.etablissement_id, destination_id: b.destination_id, type_id: d.type_id,
      lit_id: b.lit_id, version: b.version, patient_ref: d.patient_ref, urgent: d.priorite === 'p1',
      besoins: besoinsDemande(d), demande_admission_id: d.id,
    }, c);
    await c.query(`UPDATE demandes_admission SET statut = 'transferee', transfert_id = $2, terminee_le = now() WHERE id = $1`, [d.id, tr.id]);
    return tr;
  });
}

/* ------------------------------------------------------------------ niveaux d'alerte */
async function niveauAlerte(db, etabId, langue = 'fr') {
  const { rows } = await db.query(
    `SELECT c.seuil_jaune, c.seuil_orange, c.seuil_rouge, c.attente_admission_max_min, c.protocoles, c.protocoles_en,
            c.seuil_civieres_jaune, c.seuil_civieres_orange, c.seuil_civieres_rouge,
            count(l.*) FILTER (WHERE l.etat <> 'indispo')::int AS dotes,
            count(l.*) FILTER (WHERE l.etat = 'libre')::int AS libres,
            count(l.*) FILTER (WHERE l.etat = 'indispo' AND l.motif_indispo = 'personnel')::int AS fermes_personnel,
            (SELECT count(*)::int FROM demandes_admission d WHERE d.etablissement_id = e.id AND d.statut = 'attente') AS en_attente,
            (SELECT count(*)::int FROM demandes_admission d WHERE d.etablissement_id = e.id AND d.statut = 'attente'
               AND d.cree_le < now() - make_interval(mins => c.attente_admission_max_min)) AS attente_longue
       FROM etablissements e JOIN config_pays c ON c.id = e.config_id
       LEFT JOIN lits l ON l.etablissement_id = e.id
      WHERE e.id = $1 GROUP BY e.id, c.id`, [etabId]);
  const r = rows[0];
  if (!r) return null;
  // La pression réelle compte les patients qui attendent un lit, pas seulement les lits occupés
  const pression = r.dotes ? Math.round(((r.dotes - r.libres + r.en_attente) / r.dotes) * 100) : 0;
  let niveauLits = 'vert';
  if (pression >= r.seuil_rouge || r.attente_longue >= 3) niveauLits = 'rouge';
  else if (pression >= r.seuil_orange || r.attente_longue >= 1) niveauLits = 'orange';
  else if (pression >= r.seuil_jaune) niveauLits = 'jaune';
  // L'urgence compte aussi : une urgence débordée (civières) relève le niveau de l'établissement
  const urgence = (await cv.statsUrgence(db, [etabId])).get(etabId) || null;
  if (urgence) urgence.niveau = cv.niveauCivieres(urgence, r);
  const niveau = cv.pireNiveau(niveauLits, urgence?.niveau || 'vert');
  return { niveau, niveau_lits: niveauLits, pression, dotes: r.dotes, libres: r.libres, en_attente: r.en_attente,
    attente_longue: r.attente_longue, fermes_personnel: r.fermes_personnel, urgence,
    protocole: (langue === 'en' && r.protocoles_en?.[niveau]) || r.protocoles[niveau] };
}

/* ------------------------------------------------------------------ NSA */
async function listeNsa(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const lits = await pool.query(
    `SELECT l.id, l.code, l.patient_ref, l.nsa_depuis, l.nsa_orientation, u.nom AS unite,
            EXTRACT(EPOCH FROM (now() - l.nsa_depuis)) / 86400 AS jours
       FROM lits l JOIN unites u ON u.id = l.unite_id
      WHERE l.etablissement_id = $1 AND l.nsa_depuis IS NOT NULL ORDER BY l.nsa_depuis`, [etabId]);
  const tot = await pool.query(
    `SELECT count(*) FILTER (WHERE l.etat = 'occupe')::int AS occupes, c.cible_nsa_pct
       FROM lits l JOIN etablissements e ON e.id = l.etablissement_id JOIN config_pays c ON c.id = e.config_id
      WHERE l.etablissement_id = $1 GROUP BY c.cible_nsa_pct`, [etabId]);
  const occupes = tot.rows[0]?.occupes || 0;
  const n = lits.rows.length;
  const parOrientation = {};
  for (const l of lits.rows) {
    l.jours = Math.floor(Number(l.jours));
    parOrientation[l.nsa_orientation] = (parOrientation[l.nsa_orientation] || 0) + 1;
  }
  return {
    lits: lits.rows, total: n, occupes, taux: occupes ? Math.round((n / occupes) * 1000) / 10 : 0,
    cible: tot.rows[0]?.cible_nsa_pct ?? 8, par_orientation: parOrientation,
    jours_lits: lits.rows.reduce((a, l) => a + l.jours, 0),
  };
}

/* ------------------------------------------------------------------ indicateurs */
/** Mesures de fluidité sur une fenêtre de temps : de `debut` jours avant maintenant à `fin` jours avant maintenant. */
async function mesuresPeriode(pool, etabId, debut, fin) {
  const fenetre = (col) => `${col} > now() - make_interval(days => $2) AND ${col} <= now() - make_interval(days => $3)`;
  const tr = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE origine_id = $1)::int AS sortants,
            count(*) FILTER (WHERE destination_id = $1)::int AS entrants,
            count(*) FILTER (WHERE statut = 'refuse')::int AS refuses,
            round(avg(EXTRACT(EPOCH FROM (date_validation - date_demande)) / 60) FILTER (WHERE date_validation IS NOT NULL))::int AS delai_validation_min,
            round(avg(EXTRACT(EPOCH FROM (date_reception - date_demande)) / 60) FILTER (WHERE date_reception IS NOT NULL))::int AS delai_total_min,
            COALESCE(jsonb_object_agg(motif_refus_code, n) FILTER (WHERE motif_refus_code IS NOT NULL), '{}') AS refus_par_motif
       FROM (SELECT t.*, count(*) OVER (PARTITION BY motif_refus_code) AS n FROM transferts t
              WHERE (origine_id = $1 OR destination_id = $1) AND ${fenetre('date_demande')}) x`, [etabId, debut, fin]);
  const adm = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE statut = 'attente')::int AS en_attente,
            round(avg(EXTRACT(EPOCH FROM (assignee_le - cree_le)) / 60) FILTER (WHERE assignee_le IS NOT NULL))::int AS delai_assignation_min,
            count(*) FILTER (WHERE statut = 'transferee')::int AS transferees
       FROM demandes_admission WHERE etablissement_id = $1 AND ${fenetre('cree_le')}`, [etabId, debut, fin]);
  const net = await pool.query(
    `WITH ev AS (
       SELECT lit_id, date, nouvel_etat, ancien_etat,
              lag(date) OVER (PARTITION BY lit_id ORDER BY date, id) AS date_prec,
              lag(nouvel_etat) OVER (PARTITION BY lit_id ORDER BY date, id) AS etat_prec
         FROM journal WHERE etablissement_id = $1 AND action = 'Changement d’état'
          AND date > now() - make_interval(days => $2) - interval '1 day' AND date <= now() - make_interval(days => $3))
     SELECT round(avg(EXTRACT(EPOCH FROM (date - date_prec)) / 60))::int AS duree_moy_min, count(*)::int AS nettoyages
       FROM ev WHERE ancien_etat = 'nettoyage' AND nouvel_etat = 'libre' AND etat_prec = 'nettoyage'
        AND date > now() - make_interval(days => $2)`, [etabId, debut, fin]);
  const t = tr.rows[0];
  return {
    transferts: { ...t, taux_refus: t.total ? Math.round((t.refuses / t.total) * 1000) / 10 : 0 },
    admissions: adm.rows[0],
    nettoyage: net.rows[0],
    civieres: await cv.dureePeriode(pool, etabId, debut, fin),
  };
}

/**
 * Indicateurs de l'établissement : capacité maintenant, fluidité sur la période et sur la période précédente
 * (même durée, juste avant), pour afficher la tendance ; cibles issues de la configuration du pays.
 */
async function indicateurs(pool, utilisateur, etabId, jours = 30) {
  exigerEtablissement(utilisateur, etabId);
  const j = Math.min(Math.max(Number(jours) || 30, 1), 365);
  const [actuelle, precedente] = [await mesuresPeriode(pool, etabId, j, 0), await mesuresPeriode(pool, etabId, 2 * j, j)];
  const cap = await pool.query(
    `SELECT count(*) FILTER (WHERE etat <> 'indispo')::int AS dotes,
            count(*) FILTER (WHERE etat = 'libre')::int AS libres,
            count(*) FILTER (WHERE etat = 'indispo')::int AS indispo,
            COALESCE(jsonb_object_agg(motif_indispo, n) FILTER (WHERE motif_indispo IS NOT NULL), '{}') AS indispo_par_motif
       FROM (SELECT l.*, count(*) OVER (PARTITION BY motif_indispo) AS n FROM lits l WHERE etablissement_id = $1) x`, [etabId]);
  const cfg = (await pool.query(
    `SELECT c.seuil_jaune, c.seuil_orange, c.seuil_rouge, c.attente_admission_max_min, c.nettoyage_cible_min, c.cible_nsa_pct,
            c.seuil_civieres_jaune, c.seuil_civieres_orange, c.seuil_civieres_rouge
       FROM etablissements e JOIN config_pays c ON c.id = e.config_id WHERE e.id = $1`, [etabId])).rows[0];
  const nsa = await listeNsa(pool, utilisateur, etabId);
  const alerte = await niveauAlerte(pool, etabId, utilisateur.langue);
  const urgence = alerte.urgence ? { ...alerte.urgence, periode: actuelle.civieres } : null;
  const c = cap.rows[0];
  return {
    periode_jours: j,
    capacite: { ...c, occupation: c.dotes ? Math.round(((c.dotes - c.libres) / c.dotes) * 1000) / 10 : 0 },
    transferts: actuelle.transferts,
    admissions: actuelle.admissions,
    nettoyage: actuelle.nettoyage,
    nsa: { total: nsa.total, taux: nsa.taux, cible: nsa.cible, jours_lits: nsa.jours_lits, par_orientation: nsa.par_orientation },
    urgence,
    alerte,
    // Période précédente, de même durée : pour la tendance (↑ ↓)
    precedent: {
      delai_assignation_min: precedente.admissions.delai_assignation_min,
      delai_validation_min: precedente.transferts.delai_validation_min,
      delai_total_min: precedente.transferts.delai_total_min,
      taux_refus: precedente.transferts.total ? precedente.transferts.taux_refus : null,
      nettoyage_min: precedente.nettoyage.duree_moy_min,
      civiere_h: precedente.civieres.duree_moy_h,
    },
    cibles: cfg,
  };
}

function indicateursCsv(ind) {
  const lignes = [['Indicateur', 'Valeur']];
  const plat = (o, prefixe = '') => Object.entries(o).forEach(([k, v]) => {
    if (v && typeof v === 'object') plat(v, `${prefixe}${k}.`);
    else lignes.push([`${prefixe}${k}`, v ?? '']);
  });
  plat(ind);
  return lignes.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n');
}

module.exports = {
  designerNsa, retirerNsa, changerNsaOrientation, majConge, debuterNettoyage, fileNettoyage,
  creerDemande, fileAdmission, assignerLit, admettreDemande, annulerDemande, transfererDemande,
  niveauAlerte, listeNsa, indicateurs, indicateursCsv, besoinsDemande, ORIENTATIONS,
};
