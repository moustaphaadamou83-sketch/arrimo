'use strict';
/**
 * Sillage transversal (22 nov. 2026, cahier correctif « OG et Sillage transversaux »).
 * Chronologie d'un parcours vue depuis n'importe quel module : préalerte, passage Chrono, transfert, transport, demande d'hébergement,
 * mission CCS, coordination CHSLD, visite. Aucune donnée nouvelle : tout est lu dans l'Horloge (heures immuables, corrections tracées)
 * et dans les tables des modules ; rien n'est dupliqué. Les objets liés (ex. préalerte → passage Chrono → transfert) forment un même
 * parcours, désigné par le numéro de son premier objet. Chaque objet est contrôlé séparément : on ne voit que ce que son rôle permet.
 * Vigilance lit les mêmes faits (`attention`) : confirmations manquantes, délais dépassés, étapes sautées ; une ligne par fait, sans
 * notification répétée ; elle disparaît quand l'étape est faite. OG explique un parcours (`expliquer`) ; il ne décide de rien.
 */
const { ErreurHttp } = require('./db');
const { OBJETS } = require('./horloge');
const accesVehicules = require('./acces-vehicules-secours');
const { DEPART_NSA_SQL, BROUILLON_PRIVE_SQL } = require('./transports');

// Étapes attendues, dans l'ordre (Horloge) : une étape absente alors qu'une étape suivante est marquée = transition incomplète
const SEQUENCES = {
  passage_chrono: ['H11', 'H12', 'H13', 'H14', 'H15'],
  transfert: ['demande', 'decision', 'depart', 'arrivee'],
  demande_transport: ['demande', 'decision', 'prise_en_charge', 'depart', 'arrivee'],
  prealerte: ['demande', 'reception', 'prise_en_charge', 'arrivee', 'remise'],
  demande_hebergement: ['demande', 'decision', 'arrivee'],
  mission_ccs: ['demande', 'decision', 'arrivee'],
  coordination: ['demande', 'depart', 'arrivee'],
  visite: ['arrivee', 'depart'],
  dsn_transition: ['demande', 'decision', 'depart', 'arrivee'],
};
// Écran du module qui porte l'objet (pour « ouvrir dans le module »)
const ECRANS = { passage_chrono: 'chrono', prealerte: 'secours', transfert: 'transferts', demande_transport: 'transports-planifies', demande_hebergement: 'c-demandes',
  mission_ccs: 'secours', coordination: 'continuite', visite: 'visites' };

/** Fiche minimale d'un objet : numéro, statut, établissements et organisations concernés, objets liés. */
const FICHES = {
  prealerte: `SELECT p.numero, p.statut, p.cree_le, p.unite_id, p.organisation_id AS organisation_vehicule_id, ARRAY[p.destination_id] AS etabs, ARRAY[p.organisation_id] AS orgs,
      array_remove(ARRAY[CASE WHEN p.transfert_id IS NOT NULL THEN 'transfert:' || p.transfert_id END, CASE WHEN p.coordination_id IS NOT NULL THEN 'coordination:' || p.coordination_id END,
        CASE WHEN p.remplace_id IS NOT NULL THEN 'prealerte:' || p.remplace_id END,
        CASE WHEN p.demande_transport_id IS NOT NULL THEN 'demande_transport:' || p.demande_transport_id END], NULL)
      || ARRAY(SELECT 'passage_chrono:' || c.id FROM passages_chrono c WHERE c.prealerte_id = p.id) || ARRAY(SELECT 'prealerte:' || r.id FROM prealertes r WHERE r.remplace_id = p.id) AS liens,
      (SELECT e.nom FROM etablissements e WHERE e.id = p.destination_id) AS lieu FROM prealertes p WHERE p.id = $1`,
  passage_chrono: `SELECT p.numero, p.statut, p.cree_le, p.unite_id, p.organisation_id AS organisation_vehicule_id, ARRAY[p.etablissement_id] AS etabs, ARRAY[p.organisation_id] AS orgs,
      array_remove(ARRAY[CASE WHEN p.prealerte_id IS NOT NULL THEN 'prealerte:' || p.prealerte_id END], NULL) AS liens,
      (SELECT e.nom FROM etablissements e WHERE e.id = p.etablissement_id) AS lieu FROM passages_chrono p WHERE p.id = $1`,
  transfert: `SELECT t.numero, t.statut, t.date_demande AS cree_le, ARRAY[t.origine_id, t.destination_id] AS etabs, '{}'::int[] AS orgs,
      ARRAY(SELECT 'prealerte:' || p.id FROM prealertes p WHERE p.transfert_id = t.id)
      || ARRAY(SELECT 'dsn_transition:' || d.id FROM dsn_transitions d WHERE d.transfert_id = t.id) AS liens,
      (SELECT o.nom || ' → ' || d.nom FROM etablissements o, etablissements d WHERE o.id = t.origine_id AND d.id = t.destination_id) AS lieu FROM transferts t WHERE t.id = $1`,
  demande_transport: `SELECT d.numero, d.statut, d.cree_le, d.unite_id, d.organisation_id AS organisation_vehicule_id, ${BROUILLON_PRIVE_SQL} AS brouillon_prive,
      array_remove(ARRAY[d.origine_id, CASE WHEN NOT ${BROUILLON_PRIVE_SQL} THEN d.destination_id END], NULL) AS etabs,
      CASE WHEN ${BROUILLON_PRIVE_SQL} THEN '{}'::int[] ELSE ARRAY[d.organisation_id] END AS orgs,
      array_remove(ARRAY[CASE WHEN d.coordination_id IS NOT NULL THEN 'coordination:' || d.coordination_id END,
        CASE WHEN d.demande_hebergement_id IS NOT NULL THEN 'demande_hebergement:' || d.demande_hebergement_id END], NULL)
      || ARRAY(SELECT 'prealerte:' || p.id FROM prealertes p WHERE p.demande_transport_id = d.id)
      || ARRAY(SELECT 'dsn_transition:' || t.id FROM dsn_transitions t WHERE t.demande_transport_id = d.id) AS liens,
      (SELECT o.nom FROM etablissements o WHERE o.id = d.origine_id) || ' → ' || COALESCE((SELECT x.nom FROM etablissements x WHERE x.id = d.destination_id), d.destination_libelle) AS lieu
    FROM demandes_transport d WHERE d.id = $1`,
  demande_hebergement: `SELECT h.numero, h.statut, h.cree_le, array_remove(ARRAY[h.etablissement_id, h.hopital_id], NULL) AS etabs, '{}'::int[] AS orgs,
      ARRAY(SELECT 'demande_transport:' || d.id FROM demandes_transport d WHERE d.demande_hebergement_id = h.id)
      || ARRAY(SELECT 'dsn_transition:' || t.id FROM dsn_transitions t WHERE t.demande_hebergement_id = h.id) AS liens,
      (SELECT e.nom FROM etablissements e WHERE e.id = h.etablissement_id) AS lieu FROM demandes_hebergement h WHERE h.id = $1`,
  mission_ccs: `SELECT m.numero, m.statut, m.cree_le, m.unite_id, u.organisation_id AS organisation_vehicule_id, '{}'::int[] AS etabs, ARRAY[m.organisation_ccs_id, u.organisation_id] AS orgs, '{}'::text[] AS liens, u.numero AS lieu
    FROM missions_ccs m JOIN unites_secours u ON u.id = m.unite_id WHERE m.id = $1`,
  coordination: `SELECT c.numero, c.statut, c.cree_le, ARRAY[c.origine_id, c.destination_id] AS etabs, '{}'::int[] AS orgs,
      ARRAY(SELECT 'demande_transport:' || d.id FROM demandes_transport d WHERE d.coordination_id = c.id) || ARRAY(SELECT 'prealerte:' || p.id FROM prealertes p WHERE p.coordination_id = c.id) AS liens,
      (SELECT o.nom || ' → ' || d.nom FROM etablissements o, etablissements d WHERE o.id = c.origine_id AND d.id = c.destination_id) AS lieu FROM coordinations c WHERE c.id = $1`,
  dsn_transition: `SELECT t.numero, t.statut, t.cree_le, t.patient_id, t.etablissement_id, t.destination_id,
      ARRAY[t.etablissement_id, t.destination_id] AS etabs, '{}'::int[] AS orgs,
      array_remove(ARRAY[CASE WHEN t.demande_transport_id IS NOT NULL THEN 'demande_transport:' || t.demande_transport_id END,
        CASE WHEN t.transfert_id IS NOT NULL THEN 'transfert:' || t.transfert_id END,
        CASE WHEN t.demande_hebergement_id IS NOT NULL THEN 'demande_hebergement:' || t.demande_hebergement_id END], NULL) AS liens,
      (SELECT o.nom || ' → ' || d.nom FROM etablissements o, etablissements d WHERE o.id = t.etablissement_id AND d.id = t.destination_id) AS lieu FROM dsn_transitions t WHERE t.id = $1`,
  visite: `SELECT v.numero, v.statut, v.cree_le, ARRAY[v.etablissement_id] AS etabs, ARRAY[v.prestataire_id] AS orgs, '{}'::text[] AS liens,
      (SELECT e.nom FROM etablissements e WHERE e.id = v.etablissement_id) AS lieu FROM visites v WHERE v.id = $1`,
};

/** Périmètre de l'utilisateur, lu une fois : établissements, organisations, régions (direction régionale). */
async function perimetre(db, u) {
  if (u.gestionnaire) return { tout: true };
  const orgs = (await db.query('SELECT organisation_id FROM utilisateur_organisations WHERE utilisateur_id = $1', [u.id])).rows.map((x) => x.organisation_id);
  const regions = u.role === 'direction_regionale' ? (await db.query(`SELECT d.region_id FROM utilisateur_directions ud JOIN directions_regionales d ON d.id = ud.direction_id AND d.actif
    WHERE ud.utilisateur_id = $1`, [u.id])).rows.map((x) => x.region_id) : [];
  return { etabs: (u.etabs || []).map(Number), orgs, regions };
}
// Une transition DSN suit les règles du dossier à l'origine et du paquet transmis à destination.
async function visibleDsn(db, u, t) {
  const dsn = require('./dsn');
  try { dsn.exigerEnvironnement(); } catch (e) { if (e.statut === 403) return false; throw e; }
  const membres = (u.etabs || []).map(Number);
  if (!u.gestionnaire && membres.includes(t.destination_id) && u.role !== 'entretien'
    && ['envoye', 'accepte', 'refuse', 'recu'].includes(t.statut)) return true;
  if (u.gestionnaire || !membres.includes(t.etablissement_id)) return false;
  try {
    await dsn.patientLisible(db, u, t.patient_id);
    return true;
  } catch (e) {
    if (e.statut === 403 || e.statut === 404) return false;
    throw e;
  }
}
async function visible(db, per, f, u, objet) {
  if (objet === 'dsn_transition') return visibleDsn(db, u, f);
  if (f.organisation_vehicule_id && !(await accesVehicules.autorise(db, u, f.organisation_vehicule_id, f.unite_id))) return false;
  if (per.tout) return true;
  if (f.brouillon_prive) return f.etabs.some((e) => per.etabs.includes(Number(e)));
  if (f.etabs.some((e) => per.etabs.includes(Number(e))) || f.orgs.some((o) => per.orgs.includes(Number(o)))) return true;
  if (per.regions.length && f.etabs.length) return (await db.query('SELECT 1 FROM etablissements WHERE id = ANY($1) AND region_id = ANY($2) LIMIT 1', [f.etabs, per.regions])).rowCount > 0;
  return false;
}
async function lireFiche(db, objet, id) {
  const f = (await db.query(FICHES[objet], [id])).rows[0];
  return f && { ...f, etabs: (f.etabs || []).filter((x) => x != null), orgs: (f.orgs || []).filter((x) => x != null) };
}
function incompletes(objet, heures) {
  const seq = SEQUENCES[objet] || []; const faites = new Set(heures.map((h) => h.etape));
  const derniere = Math.max(-1, ...seq.map((e, i) => (faites.has(e) ? i : -1)));
  return derniere < 1 ? [] : seq.slice(0, derniere).filter((e) => !faites.has(e));
}

/** Parcours complet autour d'un objet : objets liés visibles (jusqu'à 12), heures de l'Horloge, corrections, étapes sautées. */
async function fil(pool, u, objet, id) {
  if (!OBJETS.includes(objet) || !FICHES[objet]) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'objet' });
  const n = Number(id); if (!Number.isSafeInteger(n) || n < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'id' });
  const per = await perimetre(pool, u);
  const racine = await lireFiche(pool, objet, n);
  if (!racine || !(await visible(pool, per, racine, u, objet))) throw new ErreurHttp(404, 'objet_introuvable');
  const vus = new Map([[`${objet}:${n}`, racine]]); const file = [...racine.liens]; let caches = 0;
  while (file.length && vus.size < 12) {
    const cle = file.shift(); if (vus.has(cle)) continue;
    const [o, i] = cle.split(':'); if (!FICHES[o]) continue;
    const f = await lireFiche(pool, o, Number(i));
    if (!f) continue;
    if (!(await visible(pool, per, f, u, o))) {
      // Le compteur générique n'indique pas l'existence d'un dossier DSN hors périmètre.
      if (o !== 'dsn_transition') { vus.set(cle, null); caches += 1; }
      continue;
    }
    vus.set(cle, f); file.push(...f.liens);
  }
  const objets = [...vus.entries()].filter(([, f]) => f).map(([cle, f]) => ({ objet: cle.split(':')[0], id: Number(cle.split(':')[1]), numero: f.numero, statut: f.statut, cree_le: f.cree_le, lieu: f.lieu, ecran: ECRANS[cle.split(':')[0]] }));
  objets.sort((a, b) => new Date(a.cree_le) - new Date(b.cree_le));
  const heures = (await pool.query(`WITH objets_visibles AS (
      SELECT * FROM unnest($1::text[], $2::int[]) AS o(objet, id)
    ), heures AS (
      SELECT h.objet, h.objet_id, h.etape, h.heure, h.source, h.motif_correction AS motif, u.nom AS auteur,
        (SELECT count(*)::int FROM horodatages x WHERE x.objet = h.objet AND x.objet_id = h.objet_id AND x.etape = h.etape) - 1 AS corrections
      FROM v_horodatages_courants h JOIN objets_visibles o ON o.objet = h.objet AND o.id = h.objet_id
      LEFT JOIN utilisateurs u ON u.id = h.auteur_id
    ), departs_nsa AS (
      SELECT 'demande_transport' AS objet, d.id AS objet_id, 'depart' AS etape,
        ${DEPART_NSA_SQL} AS heure, 'systeme' AS source, NULL AS motif, NULL AS auteur, 0 AS corrections
      FROM objets_visibles o JOIN demandes_transport d ON o.objet = 'demande_transport' AND o.id = d.id
      JOIN demandes_hebergement dh ON dh.id = d.demande_hebergement_id
      WHERE NOT EXISTS (SELECT 1 FROM heures h WHERE h.objet = o.objet AND h.objet_id = o.id AND h.etape = 'depart')
    ), operations_transport AS (
      SELECT 'demande_transport' AS objet, e.demande_id AS objet_id,
        CASE e.type WHEN 'remis' THEN 'remise' WHEN 'terminer' THEN 'cloture' ELSE e.type END AS etape,
        e.cree_le AS heure, CASE WHEN e.utilisateur_id IS NULL THEN 'systeme' ELSE 'clic' END AS source,
        NULL AS motif, u.nom AS auteur, 0 AS corrections
      FROM objets_visibles o JOIN demande_transport_evenements e ON o.objet = 'demande_transport' AND o.id = e.demande_id
      LEFT JOIN utilisateurs u ON u.id = e.utilisateur_id
      WHERE e.type IN ('affecter', 'replanifier', 'sur_place', 'remis', 'terminer', 'incident', 'annuler', 'archiver')
    )
    SELECT * FROM heures UNION ALL SELECT * FROM departs_nsa WHERE heure IS NOT NULL
    UNION ALL SELECT op.* FROM operations_transport op WHERE NOT EXISTS
      (SELECT 1 FROM heures h WHERE h.objet = op.objet AND h.objet_id = op.objet_id AND h.etape = op.etape)
    UNION ALL SELECT re.objet, re.objet_id, 'reaffectation_exceptionnelle', re.cree_le, 'clic', re.motif, u.nom, 0
      FROM objets_visibles o JOIN reaffectations_exceptionnelles re ON re.objet = o.objet AND re.objet_id = o.id JOIN utilisateurs u ON u.id = re.autorise_par
    UNION ALL SELECT 'passage_chrono', m.passage_id, 'retard_' || m.motif, m.cree_le, 'clic', NULL, u.nom, 0
      FROM objets_visibles o JOIN passages_chrono_motifs m ON o.objet = 'passage_chrono' AND o.id = m.passage_id
      JOIN utilisateurs u ON u.id = m.auteur_id
    ORDER BY heure`, [objets.map((o) => o.objet), objets.map((o) => o.id)])).rows;
  const evenements = heures.map((h) => { const o = objets.find((x) => x.objet === h.objet && x.id === h.objet_id); return { heure: h.heure, objet: h.objet, numero: o.numero, etape: h.etape, source: h.source, auteur: h.auteur, corrigee: h.corrections > 0, motif_correction: h.corrections > 0 ? h.motif : null, lieu: o.lieu }; });
  const manques = objets.flatMap((o) => incompletes(o.objet, heures.filter((h) => h.objet === o.objet && h.objet_id === o.id)).map((etape) => ({ objet: o.objet, numero: o.numero, etape })));
  return { parcours: objets[0]?.numero || racine.numero, objet, id: n, objets, evenements, incompletes: manques, autres_organismes: caches };
}

/**
 * Vigilance des parcours d'un établissement (ou de l'organisation de l'utilisateur) : faits vérifiables, un par ligne, sans répétition.
 * Confirmation manquante = demande en attente au-delà de son délai configuré (delais_reponse) ; ambulance à la porte au-delà de la cible ;
 * visite manquée sans suite ; étape sautée dans les 48 dernières heures.
 */
async function attention(pool, u, etabId) {
  const per = await perimetre(pool, u);
  const id = Number(etabId);
  if (!per.tout && !per.etabs.includes(id)) throw new ErreurHttp(403, 'etab_interdit');
  const items = [];
  const retards = (await pool.query(`SELECT circuit, id, numero, statut, echeance_le, destinataire_type, destinataire_id FROM v_demandes
    WHERE statut = 'en_attente' AND echeance_le < now() AND ((demandeur_type = 'etablissement' AND demandeur_id = $1) OR (destinataire_type = 'etablissement' AND destinataire_id = $1))
    ORDER BY echeance_le LIMIT 30`, [id])).rows;
  const OBJ = { transfert: 'transfert', hebergement: 'demande_hebergement', transport: 'demande_transport', prealerte: 'prealerte', mission_ccs: 'mission_ccs' };
  for (const r of retards) {
    items.push({ cle: `${OBJ[r.circuit]}:${r.id}:confirmation`, code: 'confirmation_manquante', objet: OBJ[r.circuit], id: r.id, numero: r.numero, depuis: r.echeance_le,
      chez_nous: r.destinataire_type === 'etablissement' && Number(r.destinataire_id) === id, ecran: ECRANS[OBJ[r.circuit]] });
  }
  const porte = (await pool.query(`SELECT p.id, p.numero, h.heure FROM passages_chrono p JOIN v_horodatages_courants h ON h.objet = 'passage_chrono' AND h.objet_id = p.id AND h.etape = 'H11'
    JOIN etablissements e ON e.id = p.etablissement_id LEFT JOIN config_pays c ON c.id = e.config_id
    WHERE p.etablissement_id = $1 AND p.statut = 'a_la_porte' AND NOT EXISTS (SELECT 1 FROM v_horodatages_courants x WHERE x.objet = 'passage_chrono' AND x.objet_id = p.id AND x.etape = 'H14')
      AND h.heure <= now() - make_interval(mins => COALESCE(c.chrono_cible_porte_min, 20))`, [id])).rows;
  for (const p of porte) items.push({ cle: `passage_chrono:${p.id}:porte`, code: 'civiere_au_dela_cible', objet: 'passage_chrono', id: p.id, numero: p.numero, depuis: p.heure, chez_nous: true, ecran: 'chrono' });
  const manquees = (await pool.query("SELECT id, numero, fin_prevue FROM visites WHERE etablissement_id = $1 AND statut = 'manquee' AND soin_rpa IS NULL AND fin_prevue > now() - interval '7 days'", [id])).rows;
  for (const v of manquees) items.push({ cle: `visite:${v.id}:manquee`, code: 'visite_manquee', objet: 'visite', id: v.id, numero: v.numero, depuis: v.fin_prevue, chez_nous: true, ecran: 'visites' });
  // DSN : paquet de transition envoyé sans décision depuis 24 h, ou accepté sans réception 2 h après l'arrivée prévue
  const trx = (await pool.query(`SELECT id, numero, envoye_le, arrivee_prevue_le, statut, destination_id, etablissement_id, patient_id FROM dsn_transitions WHERE (etablissement_id = $1 OR destination_id = $1)
    AND ((statut = 'envoye' AND envoye_le < now() - interval '24 hours') OR (statut = 'accepte' AND arrivee_prevue_le < now() - interval '2 hours'))`, [id]).catch(() => ({ rows: [] }))).rows;
  for (const t of trx) if (await visibleDsn(pool, u, t)) items.push({ cle: `dsn_transition:${t.id}:confirmation`, code: t.statut === 'envoye' ? 'confirmation_manquante' : 'reception_manquante', objet: 'dsn_transition', id: t.id, numero: t.numero,
    depuis: t.statut === 'envoye' ? t.envoye_le : t.arrivee_prevue_le, chez_nous: Number(t.destination_id) === id, ecran: 'dsn' });
  // Étapes sautées (48 h) sur les objets de l'établissement
  const recents = (await pool.query(`SELECT DISTINCT h.objet, h.objet_id FROM horodatages h WHERE h.enregistre_le > now() - interval '48 hours' AND h.objet = ANY($2)
      AND ((h.objet = 'passage_chrono' AND EXISTS (SELECT 1 FROM passages_chrono p WHERE p.id = h.objet_id AND p.etablissement_id = $1))
        OR (h.objet = 'transfert' AND EXISTS (SELECT 1 FROM transferts t WHERE t.id = h.objet_id AND $1 IN (t.origine_id, t.destination_id)))
        OR (h.objet = 'demande_transport' AND EXISTS (SELECT 1 FROM demandes_transport d WHERE d.id = h.objet_id AND $1 IN (d.origine_id, d.destination_id)))
        OR (h.objet = 'visite' AND EXISTS (SELECT 1 FROM visites v WHERE v.id = h.objet_id AND v.etablissement_id = $1))) LIMIT 200`, [id, Object.keys(SEQUENCES)])).rows;
  for (const r of recents) {
    const hs = (await pool.query(`SELECT etape FROM v_horodatages_courants WHERE objet = $1 AND objet_id = $2
      UNION SELECT 'depart' FROM demandes_transport d JOIN demandes_hebergement dh ON dh.id = d.demande_hebergement_id
      WHERE $1 = 'demande_transport' AND d.id = $2 AND (${DEPART_NSA_SQL}) IS NOT NULL`, [r.objet, r.objet_id])).rows;
    const manque = incompletes(r.objet, hs);
    if (manque.length) {
      const f = await lireFiche(pool, r.objet, r.objet_id);
      items.push({ cle: `${r.objet}:${r.objet_id}:incomplet`, code: 'transition_incomplete', objet: r.objet, id: r.objet_id, numero: f?.numero, etapes: manque, chez_nous: true, ecran: ECRANS[r.objet] });
    }
  }
  const uniques = [...new Map(items.map((x) => [x.cle, x])).values()];
  return { items: uniques, total: uniques.length };
}

/** Explication en langage simple pour OG (FR/EN) : étapes faites, étapes manquantes, prochaine action humaine. Aucune décision clinique. */
async function expliquer(pool, u, numero, langue = 'fr') {
  const en = langue === 'en';
  const num = String(numero || '').trim().toUpperCase();
  const TABLES = [['TRX-', 'dsn_transition', 'dsn_transitions'], ['PA-', 'prealerte', 'prealertes'], ['CH-', 'passage_chrono', 'passages_chrono'], ['DT-', 'demande_transport', 'demandes_transport'], ['VI-', 'visite', 'visites'],
    ['DH-', 'demande_hebergement', 'demandes_hebergement'], ['MI-', 'mission_ccs', 'missions_ccs'], ['MC-', 'mission_ccs', 'missions_ccs'], ['CO-', 'coordination', 'coordinations'], ['TR-', 'transfert', 'transferts'], ['T-', 'transfert', 'transferts']];
  const t = TABLES.find(([p]) => num.startsWith(p)); if (!t) return null;
  const r = (await pool.query(`SELECT id FROM ${t[2]} WHERE upper(numero) = $1`, [num])).rows[0]; if (!r) return null;
  let f; try { f = await fil(pool, u, t[1], r.id); } catch (e) { if (e.statut === 404 || e.statut === 403) return null; throw e; }
  const h = (d) => new Date(d).toLocaleString(en ? 'en-CA' : 'fr-CA', { timeZone: 'America/Toronto', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const lignes = [en ? `Path ${f.parcours} (${f.objets.map((o) => o.numero).join(' → ')}):` : `Parcours ${f.parcours} (${f.objets.map((o) => o.numero).join(' → ')}) :`];
  // Coordination CHSLD : référence du résident (jamais son identité), pour relier le parcours à la bonne personne
  if (t[1] === 'coordination') { const ref = (await pool.query('SELECT resident_ref FROM coordinations WHERE id = $1', [r.id])).rows[0]?.resident_ref; if (ref) lignes[0] += en ? ` Resident ${ref}.` : ` Résident ${ref}.`; }
  for (const o of f.objets) lignes.push(`  ${o.numero} · ${o.statut}${o.lieu ? ` · ${o.lieu}` : ''}`);
  if (!f.evenements.length) lignes.push(en ? 'No time recorded in the Clock for this path yet.' : 'Aucune heure enregistrée dans l’Horloge pour ce parcours.');
  for (const e of f.evenements) lignes.push(`• ${h(e.heure)} · ${e.numero} · ${e.etape}${e.corrigee ? (en ? ' (corrected)' : ' (corrigée)') : ''}${e.lieu ? ` · ${e.lieu}` : ''}`);
  if (f.incompletes.length) lignes.push(en ? `Steps not confirmed: ${f.incompletes.map((x) => `${x.numero} ${x.etape}`).join(', ')}. Ask the team concerned to record them (with a correction reason if after the fact).`
    : `Étapes non confirmées : ${f.incompletes.map((x) => `${x.numero} ${x.etape}`).join(', ')}. Demandez à l’équipe concernée de les enregistrer (avec un motif de correction si c’est après coup).`);
  if (f.autres_organismes) lignes.push(en ? `${f.autres_organismes} linked step(s) belong to another organisation and are not shown.` : `${f.autres_organismes} étape(s) liée(s) appartiennent à un autre organisme et ne sont pas montrées.`);
  lignes.push(en ? 'OG explains; the team decides.' : 'OG explique ; l’équipe décide.');
  return { texte: lignes.join('\n'), parcours: f.parcours, objet: t[1], id: r.id };
}
module.exports = { fil, attention, expliquer, SEQUENCES, ECRANS };
