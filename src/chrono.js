'use strict';
/**
 * Chrono (cahier v2, C.1 ; décisions de Moustafa du 19 nov. 2026) : temps des ambulances à l'urgence, H11 à H15.
 * Définitions : guide du MSSS ; cibles (porte 20 min, sortie 25 min, total 45 min) dans le profil de pays ; validation plus tard
 * avec la première entreprise ambulancière (mention « indicatif » affichée).
 *   H11 arrivée à l'urgence (première position dans la zone, confirmée par une 2e position ou par « Arrivée » de l'équipage)
 *   H12 début du triage · H13 fin du triage · H14 civière libérée (transfert de responsabilité) · H15 départ de l'hôpital
 *   (première position hors zone après H14).
 * Les heures vivent dans l'Horloge (src/horloge.js) : immuables, source et auteur, corrections tracées, jamais inventées.
 * Arrimo mesure : aucune prime ni pénalité n'est calculée. Les deux côtés (urgence, ambulance, CCS) lisent les mêmes heures.
 */
const { ErreurHttp, transaction } = require('./db');
const TE = require('./types-etablissement');
const horloge = require('./horloge');
const accesVehicules = require('./acces-vehicules-secours');

const ETAPES = ['H11', 'H12', 'H13', 'H14', 'H15'];
// Liste fermée, jamais de texte libre ni d'attribution automatique ; « inconnue » = la cause n'est pas documentée (lot 1 du 26 nov. 2026).
const MOTIFS_RETARD = ['civiere', 'personnel', 'chambre', 'dossier', 'saturation', 'nettoyage', 'technique', 'autre', 'triage', 'clinique', 'inconnue'];
/**
 * Palier d'escalade (cahier final du 24 nov. 2026, §4) : normal → vigilance (orange) → escalade (cible porte) → critique (cible totale).
 * Seuils configurables par profil de pays, indicatifs et non cliniques ; `niveau` (vert, orange, rouge) reste inchangé pour les écrans existants.
 */
function palier(attente, c) {
  if (attente == null) return null;
  if (attente >= c.total) return 'critique';
  if (attente >= c.porte) return 'escalade';
  if (attente >= c.orange) return 'vigilance';
  return 'normal';
}
const BOUTONS = ['H12', 'H13', 'H14'];               // un clic chacun, côté urgence
const ROLES_HOPITAL = ['coordonnateur', 'gestionnaire', 'admin_etab', 'equipe_soins'];
const ROLES_AMBULANCE = ['paramedic', 'superviseur_secours'];
const ROLES_CCS = ['repartiteur'];
const ZONE_DEFAUT_M = 200;
const DEUXIEME_POSITION_MAX_MS = 10 * 60000;        // la 2e position confirme l'entrée si elle arrive dans les 10 min
const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

function metres(a, b) {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.latitude - a.latitude) / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}
const actifChrono = (e) => TE.moduleActif(e, 'chrono');

/** Cibles du profil de pays (minutes). */
async function cibles(db, etabId) {
  const c = (await db.query(`SELECT c.chrono_cible_porte_min AS porte, c.chrono_cible_sortie_min AS sortie, c.chrono_cible_total_min AS total, c.chrono_orange_min AS orange
    FROM etablissements e JOIN config_pays c ON c.id = e.config_id WHERE e.id = $1`, [etabId])).rows[0];
  return c || { porte: 20, sortie: 25, total: 45, orange: 15 };
}

async function prochainNumero(c) {
  return `CH-${String((await c.query("SELECT nextval('passage_chrono_seq') AS n")).rows[0].n).padStart(6, '0')}`;
}
async function passageOuvert(c, uniteId, etabId) {
  return (await c.query(`SELECT * FROM passages_chrono WHERE unite_id = $1 AND ($2::int IS NULL OR etablissement_id = $2) AND statut IN ('detecte', 'a_la_porte')
    ORDER BY id DESC LIMIT 1 FOR UPDATE`, [uniteId, etabId ?? null])).rows[0];
}
async function creerPassage(c, { etabId, unite, prealerteId = null, source }) {
  const pa = prealerteId ?? (await c.query(`SELECT id FROM prealertes WHERE unite_id = $1 AND destination_id = $2 AND statut NOT IN ('cloturee', 'annulee', 'remplacee')
    ORDER BY id DESC LIMIT 1`, [unite.id, etabId])).rows[0]?.id ?? null;
  return (await c.query(`INSERT INTO passages_chrono (numero, etablissement_id, unite_id, organisation_id, prealerte_id, source)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [await prochainNumero(c), etabId, unite.id, unite.organisation_id, pa, source])).rows[0];
}

/**
 * Position d'une unité (téléphone de l'équipage ou connecteur), dans la transaction de son enregistrement.
 * `heure` = heure de la position (pas de la réception). Aucune position n'est inventée ; une position isolée n'ouvre rien.
 */
async function traiterPosition(c, unite, { latitude, longitude, heure, precision_m: precision, source = 'position' }) {
  const h = heure ? new Date(heure) : new Date();
  // Position trop imprécise : ignorée pour la détection (elle reste enregistrée pour l'heure d'arrivée)
  if (precision != null && precision > 150) return [];
  const hopitaux = (await c.query(`SELECT id, latitude, longitude, modules, type_etablissement, zone_rayon_m FROM etablissements
    WHERE actif AND type_etablissement = 'hopital' AND (modules->>'chrono') = 'true'`)).rows.filter(actifChrono);
  const dedans = hopitaux.find((e) => metres({ latitude, longitude }, e) <= (e.zone_rayon_m || ZONE_DEFAUT_M));
  const changements = [];
  // Sorties : tout passage ouvert de l'unité hors de la zone où l'on se trouve
  const ouverts = (await c.query("SELECT * FROM passages_chrono WHERE unite_id = $1 AND statut IN ('detecte', 'a_la_porte') FOR UPDATE", [unite.id])).rows;
  for (const p of ouverts) {
    if (dedans && dedans.id === p.etablissement_id) continue;
    const heures = await horloge.lire(c, 'passage_chrono', p.id);
    if (heures.H14 && h >= new Date(heures.H14.heure)) {
      await horloge.marquer(c, { objet: 'passage_chrono', objetId: p.id, etape: 'H15', heure: h, source, heureDetectee: h });
      await c.query("UPDATE passages_chrono SET statut = 'termine', version = version + 1, modifie_le = now() WHERE id = $1", [p.id]);
      changements.push({ passage: p.numero, etape: 'H15' });
    } else if (!heures.H11 && !heures.H14) {
      // Position isolée dans la zone, non confirmée : bruit GPS ; le passage candidat est abandonné
      await c.query("UPDATE passages_chrono SET statut = 'abandonne', version = version + 1, modifie_le = now() WHERE id = $1", [p.id]);
    }
  }
  if (!dedans) return changements;
  let p = await passageOuvert(c, unite.id, dedans.id);
  // Un passage reste ouvert ailleurs (arrivée sans remise) : rien n'est ouvert ici tant qu'il n'est pas fermé
  if (!p && (await c.query("SELECT 1 FROM passages_chrono WHERE unite_id = $1 AND statut IN ('detecte', 'a_la_porte')", [unite.id])).rowCount) return changements;
  if (!p) {
    p = await creerPassage(c, { etabId: dedans.id, unite, source });
    await c.query('UPDATE passages_chrono SET premiere_position_le = $2 WHERE id = $1', [p.id, h]);
    changements.push({ passage: p.numero, etape: 'candidat' });
    return changements;
  }
  const heures = await horloge.lire(c, 'passage_chrono', p.id);
  if (!heures.H11 && p.premiere_position_le && h - new Date(p.premiere_position_le) <= DEUXIEME_POSITION_MAX_MS && h >= new Date(p.premiere_position_le)) {
    // 2e position dans la zone : H11 = heure de la PREMIÈRE position
    await horloge.marquer(c, { objet: 'passage_chrono', objetId: p.id, etape: 'H11', heure: p.premiere_position_le, source, heureDetectee: p.premiere_position_le });
    await c.query("UPDATE passages_chrono SET statut = 'a_la_porte', version = version + 1, modifie_le = now() WHERE id = $1", [p.id]);
    changements.push({ passage: p.numero, etape: 'H11' });
  } else if (!heures.H11 && (!p.premiere_position_le || h - new Date(p.premiere_position_le) > DEUXIEME_POSITION_MAX_MS)) {
    await c.query('UPDATE passages_chrono SET premiere_position_le = $2 WHERE id = $1', [p.id, h]);
  }
  return changements;
}

/**
 * « Arrivée » de l'équipage (préalerte) ou arrivée confirmée par l'hôpital : H11. Si une position dans la zone a précédé, H11 = heure
 * de cette position (l'heure du clic est gardée comme heure détectée pour le contrôle des écarts).
 */
async function arriveeSignalee(c, pa, u) {
  const e = (await c.query('SELECT id, modules, type_etablissement FROM etablissements WHERE id = $1', [pa.destination_id])).rows[0];
  if (!e || !actifChrono(e)) return null;
  const unite = (await c.query('SELECT id, organisation_id FROM unites_secours WHERE id = $1', [pa.unite_id])).rows[0];
  let p = await passageOuvert(c, unite.id, e.id);
  if (!p) {
    // Un véhicule n'est qu'à une porte à la fois : un passage resté ouvert ailleurs est abandonné (journalisé par l'horloge du passage)
    await c.query("UPDATE passages_chrono SET statut = 'abandonne', version = version + 1, modifie_le = now() WHERE unite_id = $1 AND etablissement_id <> $2 AND statut IN ('detecte', 'a_la_porte')", [unite.id, e.id]);
    p = await creerPassage(c, { etabId: e.id, unite, prealerteId: pa.id, source: 'clic' });
  }
  else if (!p.prealerte_id) await c.query('UPDATE passages_chrono SET prealerte_id = $2 WHERE id = $1', [p.id, pa.id]);
  const maintenant = new Date();
  const recente = p.premiere_position_le && maintenant - new Date(p.premiere_position_le) <= 30 * 60000;
  await horloge.marquer(c, { objet: 'passage_chrono', objetId: p.id, etape: 'H11', heure: recente ? p.premiere_position_le : maintenant,
    source: recente ? 'position' : (u?.connecteur ? 'connecteur' : 'clic'), auteurId: u?.id || null, heureDetectee: recente ? maintenant : null });
  await c.query("UPDATE passages_chrono SET statut = 'a_la_porte', version = version + 1, modifie_le = now() WHERE id = $1 AND statut = 'detecte'", [p.id]);
  return p;
}

/** Remise du patient enregistrée sur la préalerte : H14 si l'ordre le permet (H11 présent, aucune étape plus tardive). */
async function remise(c, pa, u) {
  const p = (await c.query("SELECT * FROM passages_chrono WHERE prealerte_id = $1 AND statut = 'a_la_porte' FOR UPDATE", [pa.id])).rows[0];
  if (!p) return null;
  const heures = await horloge.lire(c, 'passage_chrono', p.id);
  if (!heures.H11 || heures.H14) return p;
  await horloge.marquer(c, { objet: 'passage_chrono', objetId: p.id, etape: 'H14', source: u?.connecteur ? 'connecteur' : 'clic', auteurId: u?.id || null });
  return p;
}

/* ------------------------------------------------------------------ lecture, droits */
async function organisationsDe(db, u) {
  return (await db.query(`SELECT o.id, o.profils, o.config_id, o.region_id FROM utilisateur_organisations uo JOIN organisations_secours o ON o.id = uo.organisation_id
    WHERE uo.utilisateur_id = $1 AND o.actif`, [u.id])).rows;
}
/** Filtre SQL des passages visibles : urgence (son hôpital, module actif), entreprise (ses unités), CCS (sa région). */
async function perimetre(db, u, etabId) {
  if (ROLES_HOPITAL.includes(u.role)) {
    const id = entier(etabId);
    if (!id || !(u.gestionnaire || (u.etabs || []).map(Number).includes(id))) throw new ErreurHttp(403, 'etab_interdit');
    const e = (await db.query('SELECT id, modules, type_etablissement, actif FROM etablissements WHERE id = $1', [id])).rows[0];
    if (!e || !e.actif) throw new ErreurHttp(404, 'etab_introuvable');
    if (!actifChrono(e)) throw new ErreurHttp(403, 'module_desactive', { module: 'chrono' });
    return { cote: 'urgence', sql: 'p.etablissement_id = $1', vals: [id], etabId: id };
  }
  const orgs = await organisationsDe(db, u);
  if (ROLES_AMBULANCE.includes(u.role)) {
    const ids = orgs.filter((o) => (o.profils || []).includes('ambulance')).map((o) => o.id);
    if (!ids.length) throw new ErreurHttp(403, 'organisation_interdite');
    const droit = (alias) => accesVehicules.concerne(u) ? ` AND ${accesVehicules.condition('o', `${alias}.unite_id`, 2)}` : '';
    return { cote: 'ambulance', sql: `p.organisation_id = ANY($1)${droit('p')}`,
      sqlEnRoute: `pa.organisation_id = ANY($1)${droit('pa')}`, vals: accesVehicules.concerne(u) ? [ids, u.id] : [ids] };
  }
  if (ROLES_CCS.includes(u.role)) {
    const ccs = orgs.filter((o) => (o.profils || []).includes('ccs'));
    if (!ccs.length) throw new ErreurHttp(403, 'organisation_interdite');
    return { cote: 'ccs', sql: '(o.config_id = ANY($1) OR (o.region_id IS NOT NULL AND o.region_id = ANY($2)))',
      vals: [ccs.map((o) => o.config_id), ccs.map((o) => o.region_id).filter(Boolean)] };
  }
  throw new ErreurHttp(403, 'role_insuffisant');
}
const SELECT_PASSAGES = `SELECT p.id, p.numero, p.statut, p.source, p.etablissement_id, e.nom AS hopital, p.unite_id, un.numero AS unite, un.type_vehicule,
    p.organisation_id, o.nom AS organisation, p.prealerte_id, pa.numero AS prealerte, pa.priorite, p.cree_le, p.version,
    COALESCE(cfg.chrono_cible_porte_min, 20) AS cible_porte, COALESCE(cfg.chrono_orange_min, 15) AS cible_orange,
    COALESCE(cfg.chrono_cible_sortie_min, 25) AS cible_sortie, COALESCE(cfg.chrono_cible_total_min, 45) AS cible_total, retard.motif AS motif_retard
  FROM passages_chrono p JOIN etablissements e ON e.id = p.etablissement_id JOIN unites_secours un ON un.id = p.unite_id
  JOIN organisations_secours o ON o.id = p.organisation_id LEFT JOIN prealertes pa ON pa.id = p.prealerte_id
  LEFT JOIN config_pays cfg ON cfg.id = e.config_id
  LEFT JOIN LATERAL (SELECT motif FROM passages_chrono_motifs m WHERE m.passage_id = p.id ORDER BY m.id DESC LIMIT 1) retard ON true`;

function durees(h) {
  const t = (e) => (h[e] ? new Date(h[e].heure).getTime() : null);
  const min = (a, b) => (t(a) != null && t(b) != null && t(b) >= t(a) ? Math.round((t(b) - t(a)) / 6000) / 10 : null);
  return { porte: min('H11', 'H14'), sortie: min('H14', 'H15'), total: min('H11', 'H15'), triage: min('H12', 'H13') };
}
function vueHeures(h) {
  return Object.fromEntries(ETAPES.map((e) => [e, h[e] ? { heure: h[e].heure, source: h[e].source, corrigee: h[e].source === 'correction', motif: h[e].motif_correction,
    heure_detectee: h[e].heure_detectee, ecart_min: horloge.ecartMinutes(h[e]) } : null]));
}
async function enrichir(db, rows) {
  if (!rows.length) return [];
  const toutes = (await db.query("SELECT * FROM v_horodatages_courants WHERE objet = 'passage_chrono' AND objet_id = ANY($1)", [rows.map((r) => r.id)])).rows;
  const parPassage = new Map();
  for (const heure of toutes) {
    if (!parPassage.has(heure.objet_id)) parPassage.set(heure.objet_id, {});
    parPassage.get(heure.objet_id)[heure.etape] = heure;
  }
  const maintenant = Date.now();
  return rows.map(({ cible_porte, cible_orange, cible_sortie, cible_total, ...r }) => {
    const h = parPassage.get(r.id) || {};
    const cibles = { porte: cible_porte, orange: cible_orange, sortie: cible_sortie, total: cible_total };
    const ms = h.H11 ? maintenant - new Date(h.H11.heure).getTime() : null;
    const attente = r.statut === 'a_la_porte' && !h.H14 && ms != null && ms >= 0 ? Math.floor(ms / 60000) : null;
    const niveau = attente == null ? null : attente >= cibles.porte ? 'rouge' : attente >= cibles.orange ? 'orange' : 'vert';
    return { ...r, cibles, heures: vueHeures(h), durees: durees(h), a_la_porte_min: attente, niveau, palier: palier(attente, cibles),
      prochaine: BOUTONS.find((e) => !h[e] && h.H11 && !(e !== 'H14' && h.H14)) || null };
  });
}

function filtresTableau(q, vals) {
  const parametres = [...vals];
  const clauses = [];
  for (const [nom, champ] of [['vehicule', 'un.numero'], ['organisation', 'o.nom'], ['etablissement', 'e.nom']]) {
    const valeur = String(q[nom] ?? '').trim().slice(0, 100);
    if (!valeur) continue;
    parametres.push(valeur);
    clauses.push(`strpos(lower(${champ}), lower($${parametres.length}::text)) > 0`);
  }
  if (q.region_id != null && q.region_id !== '') {
    const id = entier(q.region_id);
    if (!id) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'region_id' });
    parametres.push(id);
    clauses.push(`e.region_id = $${parametres.length}`);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', parametres };
}

/** Écran Chrono : « En route » (préalertes ouvertes, heure prévue) et « À la porte » (passages ouverts, chrono). Mêmes données des deux côtés. */
async function tableau(pool, u, q = {}) {
  const per = await perimetre(pool, u, q.etablissement_id);
  const h = Number(q.heures_historique ?? 12);
  if (![12, 24, 48, 168].includes(h)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'heures_historique' });
  const filtre = filtresTableau(q, per.vals);
  const ouverts = (await pool.query(`${SELECT_PASSAGES} WHERE ${per.sql}${filtre.sql} AND p.statut = 'a_la_porte' ORDER BY p.id`, filtre.parametres)).rows;
  const termines = (await pool.query(`${SELECT_PASSAGES} WHERE ${per.sql}${filtre.sql} AND p.statut = 'termine'
    AND p.modifie_le > now() - make_interval(hours => $${filtre.parametres.length + 1}) ORDER BY p.modifie_le DESC, p.id DESC
    LIMIT $${filtre.parametres.length + 2}`, [...filtre.parametres, h, h === 12 ? 20 : 100])).rows;
  const enRouteSql = per.cote === 'urgence' ? 'pa.destination_id = $1' : per.cote === 'ambulance' ? per.sqlEnRoute
    : '(o.config_id = ANY($1) OR (o.region_id IS NOT NULL AND o.region_id = ANY($2)))';
  const enRoute = (await pool.query(`SELECT pa.id, pa.numero, pa.priorite, pa.heure_prevue, un.numero AS unite, e.nom AS hopital, pa.destination_id AS etablissement_id,
      o.nom AS organisation, eta.minutes AS eta_min, eta.distance_km::float AS eta_km
    FROM prealertes pa JOIN unites_secours un ON un.id = pa.unite_id JOIN etablissements e ON e.id = pa.destination_id JOIN organisations_secours o ON o.id = pa.organisation_id
    LEFT JOIN eta_prealertes eta ON eta.prealerte_id = pa.id
    WHERE ${enRouteSql}${filtre.sql} AND pa.statut IN ('envoyee', 'recue', 'consultee', 'prise_en_compte', 'preparation', 'preparation_terminee') AND (e.modules->>'chrono') = 'true'
      AND NOT EXISTS (SELECT 1 FROM passages_chrono p WHERE p.prealerte_id = pa.id AND p.statut IN ('a_la_porte', 'termine'))
      AND NOT EXISTS (SELECT 1 FROM demandes_transport d WHERE d.id = pa.demande_transport_id
        AND d.unite_id = pa.unite_id AND d.destination_id = pa.destination_id AND d.arrivee_le IS NOT NULL)
    ORDER BY pa.heure_prevue NULLS LAST`, filtre.parametres)).rows;
  const c = per.etabId ? await cibles(pool, per.etabId) : { porte: 20, sortie: 25, total: 45, orange: 15 };
  const [aLaPorte, derniersTermines] = await Promise.all([enrichir(pool, ouverts), enrichir(pool, termines)]);
  const attentes = aLaPorte.map((p) => p.a_la_porte_min).filter((min) => min != null && min >= 0);
  return { cote: per.cote, cibles: c, indicatif: true, en_route: enRoute, a_la_porte: aLaPorte, termines: derniersTermines,
    actualise_le: new Date().toISOString(), heures_historique: h,
    attente: { en_cours: attentes.length, seuil_atteint: aLaPorte.filter((p) => p.niveau === 'rouge').length, surveillance: aLaPorte.filter((p) => p.niveau === 'orange').length,
      moyenne_min: moyenne(attentes), mediane_min: mediane(attentes),
      minutes_cumulees: attentes.reduce((total, min) => total + min, 0) } };
}

async function passageVisible(c, u, id, etabId, verrou = false) {
  const per = await perimetre(c, u, etabId);
  const p = (await c.query(`${SELECT_PASSAGES} WHERE p.id = $${per.vals.length + 1} AND ${per.sql}${verrou ? ' FOR UPDATE OF p' : ''}`, [...per.vals, entier(id)])).rows[0];
  if (!p) throw new ErreurHttp(404, 'passage_introuvable');
  return { p, per };
}

/** Clic de l'urgence : H12, H13 ou H14, dans l'ordre (une étape oubliée se corrige après coup, jamais inventée). */
async function marquerEtape(pool, u, id, b = {}) {
  if (!BOUTONS.includes(b.etape)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etape' });
  return transaction(pool, async (c) => {
    const { p, per } = await passageVisible(c, u, id, b.etablissement_id, true);
    if (per.cote !== 'urgence') throw new ErreurHttp(403, 'role_insuffisant');
    if (p.statut !== 'a_la_porte') throw new ErreurHttp(409, 'passage_statut_incompatible');
    const h = await horloge.lire(c, 'passage_chrono', p.id);
    if (h[b.etape]) throw new ErreurHttp(409, 'etape_deja_marquee', { etape: b.etape });
    if (!h.H11) throw new ErreurHttp(409, 'etape_precedente_manquante', { etape: 'H11' });
    if (b.etape === 'H13' && !h.H12) throw new ErreurHttp(409, 'etape_precedente_manquante', { etape: 'H12' });
    if (b.etape !== 'H14' && h.H14) throw new ErreurHttp(409, 'etape_trop_tard', { etape: b.etape });
    const r = await horloge.marquer(c, { objet: 'passage_chrono', objetId: p.id, etape: b.etape, source: 'clic', auteurId: u.id });
    await journaliser(c, p, u, `Chrono ${p.numero} : ${b.etape}`);
    return { passage: p.numero, etape: b.etape, heure: r.heure };
  }).finally(() => require('./flux').signaler());
}

/** « Départ de l'hôpital » au clic de l'équipage (sans position partagée) : H15, après H14 seulement. */
async function depart(pool, u, id, b = {}) {
  return transaction(pool, async (c) => {
    const { p, per } = await passageVisible(c, u, id, b.etablissement_id, true);
    if (per.cote !== 'ambulance') throw new ErreurHttp(403, 'role_insuffisant');
    if (p.statut !== 'a_la_porte') throw new ErreurHttp(409, 'passage_statut_incompatible');
    const h = await horloge.lire(c, 'passage_chrono', p.id);
    if (!h.H14) throw new ErreurHttp(409, 'etape_precedente_manquante', { etape: 'H14' });
    const r = await horloge.marquer(c, { objet: 'passage_chrono', objetId: p.id, etape: 'H15', source: 'clic', auteurId: u.id });
    await c.query("UPDATE passages_chrono SET statut = 'termine', version = version + 1, modifie_le = now() WHERE id = $1", [p.id]);
    await journaliser(c, p, u, `Chrono ${p.numero} : H15`);
    return { passage: p.numero, etape: 'H15', heure: r.heure };
  }).finally(() => require('./flux').signaler());
}

/** « Corriger l'heure » (urgence, ou équipage pour H11 et H15) : motif fermé, ordre conservé, nouvelle ligne tracée. */
async function corriger(pool, u, id, b = {}) {
  if (!ETAPES.includes(b.etape)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etape' });
  return transaction(pool, async (c) => {
    const { p, per } = await passageVisible(c, u, id, b.etablissement_id, true);
    if (per.cote === 'ccs' || (per.cote === 'ambulance' && !['H11', 'H15'].includes(b.etape))) throw new ErreurHttp(403, 'role_insuffisant');
    const h = await horloge.lire(c, 'passage_chrono', p.id);
    const nouvelle = new Date(b.heure);
    if (Number.isNaN(nouvelle.getTime())) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'heure' });
    const i = ETAPES.indexOf(b.etape);
    const avant = ETAPES.slice(0, i).map((e) => h[e]).filter(Boolean).map((x) => new Date(x.heure));
    const apres = ETAPES.slice(i + 1).map((e) => h[e]).filter(Boolean).map((x) => new Date(x.heure));
    if (avant.some((x) => x > nouvelle) || apres.some((x) => x < nouvelle)) throw new ErreurHttp(409, 'ordre_etapes');
    const r = await horloge.corriger(c, { objet: 'passage_chrono', objetId: p.id, etape: b.etape, heure: nouvelle, motif: b.motif, auteurId: u.id });
    await journaliser(c, p, u, `Chrono ${p.numero} : ${b.etape} corrigée (${b.motif})`);
    return { passage: p.numero, etape: b.etape, heure: r.heure, remplace_id: r.remplace_id };
  }).finally(() => require('./flux').signaler());
}

async function signalerRetard(pool, u, id, b = {}) {
  if (!MOTIFS_RETARD.includes(b.motif)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'motif' });
  const r = await transaction(pool, async (c) => {
    const { p, per } = await passageVisible(c, u, id, b.etablissement_id, true);
    if (per.cote === 'ccs') throw new ErreurHttp(403, 'role_insuffisant');
    if (b.version != null && Number(b.version) !== p.version) throw new ErreurHttp(409, 'version_perimee');
    if (p.statut !== 'a_la_porte') throw new ErreurHttp(409, 'mission_statut_incompatible');
    if (p.motif_retard === b.motif) return { motif: p.motif_retard, version: p.version, deja: true };
    const { rows: [motif] } = await c.query(`INSERT INTO passages_chrono_motifs (passage_id, auteur_id, motif)
      VALUES ($1, $2, $3) RETURNING motif, cree_le`, [p.id, u.id, b.motif]);
    const { rows: [passage] } = await c.query('UPDATE passages_chrono SET version = version + 1 WHERE id = $1 RETURNING version', [p.id]);
    return { ...motif, version: passage.version };
  });
  if (!r.deja) require('./flux').signaler();
  return r;
}

async function journaliser(c, p, u, detail) {
  await c.query(`INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Chrono', $3)`, [p.etablissement_id, u?.id || null, detail]);
}

/** Alerte persistante, atomique et unique par passage ouvert. */
async function notifierAttentes(pool) {
  const n = await transaction(pool, async (c) => {
    const { rows } = await c.query(`WITH candidats AS (
      SELECT p.id, COALESCE(cfg.chrono_cible_porte_min, 20) AS seuil
      FROM passages_chrono p JOIN etablissements e ON e.id = p.etablissement_id
      JOIN v_horodatages_courants h ON h.objet = 'passage_chrono' AND h.objet_id = p.id AND h.etape = 'H11'
      LEFT JOIN config_pays cfg ON cfg.id = e.config_id
      WHERE p.statut = 'a_la_porte' AND p.alerte_notifiee_le IS NULL AND e.actif AND e.module_actif
        AND e.modules->>'chrono' = 'true'
        AND h.heure <= now() - make_interval(mins => COALESCE(cfg.chrono_cible_porte_min, 20))
        AND NOT EXISTS (SELECT 1 FROM v_horodatages_courants hr
          WHERE hr.objet = 'passage_chrono' AND hr.objet_id = p.id AND hr.etape = 'H14')
      ORDER BY h.heure, p.id LIMIT 100 FOR UPDATE OF p SKIP LOCKED
    )
    UPDATE passages_chrono p SET alerte_notifiee_le = now() FROM candidats ca WHERE p.id = ca.id
    RETURNING p.numero, p.etablissement_id, ca.seuil`);
    for (const p of rows) {
      await require('./services').notifier(c, p.etablissement_id, null, 'chrono_seuil_atteint', { passage: p.numero, seuil: p.seuil });
    }
    return rows.length;
  });
  if (n) require('./flux').signaler();
  return n;
}

/* ------------------------------------------------------------------ rapport mensuel, écarts */
const mediane = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10; };
const moyenne = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
function mois(q) {
  const m = String(q.mois || new Date().toISOString().slice(0, 7));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'mois' });
  return m;
}
/** Rapport mensuel : par hôpital (urgence), par entreprise (ambulance), par région (CCS). Étapes manquantes comptées, jamais estimées. */
async function rapport(pool, u, q = {}) {
  const per = await perimetre(pool, u, q.etablissement_id); const m = mois(q);
  const filtre = filtresTableau(q, per.vals);
  const rows = await enrichir(pool, (await pool.query(`${SELECT_PASSAGES} WHERE ${per.sql}${filtre.sql} AND p.statut IN ('a_la_porte', 'termine')
    AND to_char(p.cree_le AT TIME ZONE 'America/Toronto', 'YYYY-MM') = $${filtre.parametres.length + 1} ORDER BY p.id`, [...filtre.parametres, m])).rows);
  const c = per.etabId ? await cibles(pool, per.etabId) : { porte: 20, sortie: 25, total: 45, orange: 15 };
  const stat = (k, cible) => {
    const mesures = rows.filter((r) => r.durees[k] != null);
    const xs = mesures.map((r) => r.durees[k]);
    const seuils = new Set(mesures.map((r) => r.cibles[k]));
    return { n: xs.length, moyenne_min: moyenne(xs), mediane_min: mediane(xs),
      cible_min: seuils.size > 1 ? null : [...seuils][0] ?? cible,
      hors_cible_pct: xs.length ? Math.round((mesures.filter((r) => r.durees[k] > r.cibles[k]).length / xs.length) * 1000) / 10 : null };
  };
  const complets = rows.filter((r) => ETAPES.every((e) => r.heures[e])).length;
  const visitesMesurees = rows.filter((r) => r.statut === 'termine' && r.durees.total != null);
  const pilotes = {
    passages_mesures: visitesMesurees.length,
    immobilisation_min: visitesMesurees.length ? Math.round(visitesMesurees.reduce((total, r) => total + r.durees.total, 0) * 10) / 10 : null,
    porte_hors_cible: rows.filter((r) => r.durees.porte != null && r.durees.porte > r.cibles.porte).length,
  };
  return { mois: m, cote: per.cote, cibles: c, indicatif: true, passages: rows.length, pilote: pilotes,
    completude_pct: rows.length ? Math.round((complets / rows.length) * 1000) / 10 : null,
    etapes_manquantes: Object.fromEntries(ETAPES.map((e) => [e, rows.filter((r) => !r.heures[e]).length])),
    porte: stat('porte', c.porte), sortie: stat('sortie', c.sortie), total: stat('total', c.total),
    motifs_retard: Object.fromEntries(MOTIFS_RETARD.map((motif) => [motif, rows.filter((r) => r.motif_retard === motif).length])),
    corrections: rows.reduce((n, r) => n + ETAPES.filter((e) => r.heures[e]?.corrigee).length, 0), lignes: rows };
}
function csv(r, langue = 'fr') {
  const en = langue === 'en';
  const tete = en ? ['Number', 'Hospital', 'Company', 'Unit', 'H11', 'H12', 'H13', 'H14', 'H15', 'Door (min)', 'Exit (min)', 'Total (min)', 'Corrected']
    : ['Numéro', 'Hôpital', 'Entreprise', 'Unité', 'H11', 'H12', 'H13', 'H14', 'H15', 'Porte (min)', 'Sortie (min)', 'Total (min)', 'Corrigées'];
  const champ = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lignes = r.lignes.map((l) => [l.numero, l.hopital, l.organisation, l.unite, ...ETAPES.map((e) => (l.heures[e] ? new Date(l.heures[e].heure).toISOString() : '')),
    l.durees.porte, l.durees.sortie, l.durees.total, ETAPES.filter((e) => l.heures[e]?.corrigee).join(' ')].map(champ).join(';'));
  return `﻿${[tete.join(';'), ...lignes].join('\r\n')}\r\n`;
}
/** Contrôle des écarts : heures saisies ou corrigées qui s'éloignent de l'heure détectée (seuil 5 min). */
async function ecarts(pool, u, q = {}) {
  const per = await perimetre(pool, u, q.etablissement_id); const seuil = Number(q.seuil_min) > 0 ? Number(q.seuil_min) : 5;
  const rows = (await pool.query(`SELECT h.*, p.numero, un.numero AS unite FROM v_horodatages_courants h JOIN passages_chrono p ON p.id = h.objet_id
      JOIN unites_secours un ON un.id = p.unite_id JOIN organisations_secours o ON o.id = p.organisation_id
    WHERE h.objet = 'passage_chrono' AND h.heure_detectee IS NOT NULL AND ${per.sql} ORDER BY h.id DESC LIMIT 200`, per.vals)).rows;
  return rows.map((h) => ({ passage: h.numero, unite: h.unite, etape: h.etape, heure: h.heure, heure_detectee: h.heure_detectee, source: h.source, motif: h.motif_correction,
    ecart_min: horloge.ecartMinutes(h) })).filter((x) => Math.abs(x.ecart_min) >= seuil);
}
/** Historique complet d'un passage (corrections comprises) : même vue des deux côtés. */
async function fiche(pool, u, id, q = {}) {
  const { p } = await passageVisible(pool, u, id, q.etablissement_id);
  const [e] = await enrichir(pool, [p]);
  const [historique, motifs] = await Promise.all([
    horloge.lire(pool, 'passage_chrono', p.id, { historique: true }),
    pool.query(`SELECT m.motif, m.cree_le, u.nom AS auteur FROM passages_chrono_motifs m
      JOIN utilisateurs u ON u.id = m.auteur_id WHERE m.passage_id = $1 ORDER BY m.id`, [p.id]),
  ]);
  return { ...e, historique, historique_retards: motifs.rows };
}

module.exports = { traiterPosition, arriveeSignalee, remise, tableau, marquerEtape, depart, corriger, signalerRetard, notifierAttentes, rapport, csv, ecarts, fiche, metres, ETAPES, MOTIFS_RETARD, palier, peutLireAlerte: (u) => ROLES_HOPITAL.includes(u.role), ZONE_DEFAUT_M };
