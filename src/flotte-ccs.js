'use strict';
/**
 * Centre de commandement CCS et flotte connectée (cahiers du 27 nov. 2026 : refonte Ambulance/CCS, centre de commandement,
 * communication CCS-ambulances, simplification). Lecture des sources existantes (états des véhicules, missions CCS, préalertes,
 * transports, positions) : aucun moteur parallèle, une seule chronologie par mission (mêmes horodatages que Chrono).
 * - Statut du véhicule, phase de mission et niveau de vigilance sont distincts ; immobilisation, retard, perte de connexion et position
 *   obsolète sont des CONDITIONS ajoutées au statut, jamais un statut de plus (pas de double comptage).
 * - Seuils d'immobilisation indicatifs (défaut démo 20 / 30 min), réglés depuis SH ; ils déclenchent une alerte, jamais une réorientation.
 * - Arrimo transmet, le CCS et les protocoles décident : aucune affectation, destination ni réorientation automatique.
 */
const { transaction, ErreurHttp } = require('./db');
const vehicules = require('./vehicules');
const { ROLES_AMBULANCE, ROLES_CCS } = require('./prealertes');

const SEUILS_DEFAUT = { vigilance_min: 20, escalade_min: 30 };
const STATUTS = ['disponible', 'mission_affectee', 'mission_acceptee', 'en_route', 'sur_place', 'patient_pris_en_charge', 'en_transport',
  'arrive_destination', 'patient_receptionne', 'remise_en_service', 'hors_service'];
const CONDITIONS = ['immobilisation', 'retard', 'vigilance', 'escalade', 'perte_connexion', 'position_obsolete'];
const GENRES_AMBULANCE = ['message', 'retard', 'incident', 'assistance', 'reception', 'remise_dispo', 'etape'];
const GENRES_CCS = ['message', 'instruction', 'destination'];
// Messages rapides prédéfinis (aucun texte libre nécessaire en conduite ; libellés dans l'interface)
const RAPIDES = { ambulance: ['bien_recu', 'en_route', 'retard_trafic', 'attente_civiere', 'besoin_assistance', 'incident_vehicule', 'disponible'],
  ccs: ['bien_recu', 'appelez_ccs', 'nouvelle_destination', 'attendre_instructions', 'retour_base', 'priorite_modifiee'],
  etablissement: ['bien_recu', 'accueil_pret', 'resident_pret', 'preparation_en_cours', 'retard_preparation', 'appelez_nous'] };
const POSITION_OBSOLETE_MIN = 10; const DECONNEXION_MIN = 15;
const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const minutes = (d, now) => (d ? Math.max(0, Math.round((now - new Date(d).getTime()) / 60000)) : null);
const cote = (u) => (ROLES_CCS.includes(u.role) || u.connecteur?.profils?.includes('ccs') ? 'ccs' : ROLES_AMBULANCE.includes(u.role) ? 'ambulance' : null);

/** Seuils de l'organisation de l'utilisateur (CCS ou entreprise), sinon défaut indicatif. */
async function seuils(db, u) {
  const r = (await db.query(`SELECT s.vigilance_min, s.escalade_min FROM utilisateur_organisations uo JOIN seuils_flotte s ON s.organisation_id = uo.organisation_id
    WHERE uo.utilisateur_id = $1 ORDER BY s.modifie_le DESC LIMIT 1`, [u.id])).rows[0];
  return r ? { ...r, source: 'sh' } : { ...SEUILS_DEFAUT, source: 'defaut' };
}

/** Statut harmonisé (un seul) à partir de l'état réel du véhicule et de sa mission en cours. */
function statutDe(v, m) {
  const e = v.etat || 'disponible';
  if (e === 'hors_service') return 'hors_service';
  if (['en_preparation', 'desinfection'].includes(e)) return 'remise_en_service';
  if (e === 'a_l_hopital') return m?.pa_statut === 'cloturee' || m?.tr_remis ? 'patient_receptionne' : 'arrive_destination';
  if (e === 'transport_hopital') return 'en_transport';
  if (e === 'sur_place') return m?.tr_statut === 'pris_en_charge' ? 'patient_pris_en_charge' : 'sur_place';
  if (e === 'en_route') return 'en_route';
  if (m?.mi_statut === 'proposee') return 'mission_affectee';
  if (m?.mi_statut === 'acceptee') return 'mission_acceptee';
  if (m?.tr_statut === 'acceptee') return 'mission_acceptee';
  return 'disponible';
}

/** Détails complémentaires de chaque unité : mission CCS ouverte, préalerte, transport, dernière position et dernier message. */
async function details(db, ids) {
  if (!ids.length) return new Map();
  const r = await db.query(`SELECT un.id,
      mi.id AS mi_id, mi.numero AS mi_numero, mi.statut AS mi_statut, mi.lieu AS mi_lieu, mi.priorite AS mi_priorite, mi.categorie AS mi_categorie,
      mi.cree_le AS mi_envoyee_le, mi.recue_le AS mi_recue_le, mi.consultee_le AS mi_consultee_le, mi.instructions AS mi_instructions, mi.version AS mi_version,
      COALESCE(mde.nom, mi.destination_libelle) AS mi_destination, mi.destination_id AS mi_destination_id,
      pa.id AS pa_id, pa.numero AS pa_numero, pa.statut AS pa_statut, pde.nom AS pa_destination, pa.cree_le AS pa_cree_le,
      tr.id AS tr_id, tr.numero AS tr_numero, tr.statut AS tr_statut, teo.nom AS tr_origine, COALESCE(ted.nom, tr.destination_libelle) AS tr_destination, tr.remis_le IS NOT NULL AS tr_remis,
      pos.latitude, pos.longitude, pos.le AS position_le,
      (SELECT max(cree_le) FROM messages_flotte mf WHERE mf.unite_id = un.id AND mf.sens = 'ambulance') AS dernier_message_le,
      (SELECT count(*)::int FROM messages_flotte mf WHERE mf.unite_id = un.id AND mf.lu_le IS NULL AND mf.cree_le > now() - interval '24 hours') AS messages_non_lus
    FROM unites_secours un
    LEFT JOIN LATERAL (SELECT * FROM missions_ccs WHERE unite_id = un.id AND statut IN ('proposee', 'acceptee', 'sur_place') ORDER BY id DESC LIMIT 1) mi ON true
    LEFT JOIN etablissements mde ON mde.id = mi.destination_id
    LEFT JOIN LATERAL (SELECT * FROM prealertes WHERE unite_id = un.id AND statut NOT IN ('cloturee', 'annulee', 'remplacee') ORDER BY id DESC LIMIT 1) pa ON true
    LEFT JOIN etablissements pde ON pde.id = pa.destination_id
    LEFT JOIN LATERAL (SELECT * FROM demandes_transport WHERE unite_id = un.id AND statut IN ('acceptee', 'en_route', 'pris_en_charge', 'arrivee') AND terminee_le IS NULL ORDER BY id DESC LIMIT 1) tr ON true
    LEFT JOIN etablissements teo ON teo.id = tr.origine_id LEFT JOIN etablissements ted ON ted.id = tr.destination_id
    LEFT JOIN LATERAL (SELECT latitude, longitude, enregistree_le AS le FROM positions_unites WHERE unite_id = un.id ORDER BY enregistree_le DESC LIMIT 1) pos ON true
    WHERE un.id = ANY($1::int[])`, [ids]);
  return new Map(r.rows.map((x) => [x.id, x]));
}

/** Une carte par véhicule : statut, durée depuis le début du statut, mission, origine/destination, synchronisation, conditions. */
function carte(v, d, s, now) {
  const statut = statutDe(v, d);
  const depuis = v.modifie_le || null; const dureeMin = minutes(depuis, now);
  const enMission = !['disponible', 'hors_service', 'remise_en_service'].includes(statut);
  const sync = [v.modifie_le, d?.position_le, d?.dernier_message_le].filter(Boolean).map((x) => new Date(x).getTime());
  const derniereSync = sync.length ? new Date(Math.max(...sync)).toISOString() : null;
  const conditions = [];
  // Immobilisation : véhicule arrivé à destination et non libéré (attente civière, remise du patient) au-delà des seuils indicatifs
  const immobile = ['arrive_destination', 'patient_receptionne'].includes(statut);
  let niveau = 'vert';
  if (immobile && dureeMin != null && dureeMin >= s.vigilance_min) { conditions.push('immobilisation'); niveau = dureeMin >= s.escalade_min ? 'rouge' : 'orange'; }
  if (statut === 'en_route' && dureeMin != null && dureeMin >= s.escalade_min) { conditions.push('retard'); niveau = niveau === 'rouge' ? 'rouge' : 'orange'; }
  if (niveau === 'orange') conditions.push('vigilance'); if (niveau === 'rouge') conditions.push('escalade');
  if (enMission && d?.position_le && minutes(d.position_le, now) >= POSITION_OBSOLETE_MIN) conditions.push('position_obsolete');
  if (enMission && (!derniereSync || minutes(derniereSync, now) >= DECONNEXION_MIN)) conditions.push('perte_connexion');
  if (!d?.position_le && enMission && !conditions.includes('perte_connexion')) { /* position non partagée : jamais inventée */ }
  const mission = d?.pa_id ? { type: 'prealerte', id: d.pa_id, numero: d.pa_numero, statut: d.pa_statut, destination: d.pa_destination }
    : d?.tr_id ? { type: 'transport', id: d.tr_id, numero: d.tr_numero, statut: d.tr_statut, origine: d.tr_origine, destination: d.tr_destination }
      : d?.mi_id ? { type: 'mission', id: d.mi_id, numero: d.mi_numero, statut: d.mi_statut, origine: d.mi_lieu, destination: d.mi_destination, priorite: d.mi_priorite,
        instructions: d.mi_instructions, version: d.mi_version, transmission: { envoyee_le: d.mi_envoyee_le, recue_le: d.mi_recue_le, consultee_le: d.mi_consultee_le } } : null;
  return { id: v.id, numero: v.numero, plaque: v.plaque, type_vehicule: v.type_vehicule, organisation: v.organisation, statut, etat: v.etat || 'disponible',
    depuis, duree_min: dureeMin, niveau, conditions, mission, derniere_sync: derniereSync, messages_non_lus: d?.messages_non_lus || 0,
    position: d?.position_le ? { latitude: d.latitude, longitude: d.longitude, le: d.position_le, age_min: minutes(d.position_le, now) } : null };
}

/** Tableau de la flotte du périmètre (CCS : sa région ; entreprise : ses véhicules ; embarqué : son organisation). */
async function tableau(pool, u, q = {}) {
  if (!cote(u)) throw new ErreurHttp(403, 'role_insuffisant');
  const [liste, s] = await Promise.all([vehicules.liste(pool, u), seuils(pool, u)]);
  const d = await details(pool, liste.map((v) => v.id)); const now = Date.now();
  let cartes = liste.map((v) => carte(v, d.get(v.id), s, now));
  const compteurs = Object.fromEntries(STATUTS.map((k) => [k, cartes.filter((c) => c.statut === k).length]));
  const conditions = Object.fromEntries(CONDITIONS.map((k) => [k, cartes.filter((c) => c.conditions.includes(k)).length]));
  // Missions en attente d'affectation : interventions reçues (démonstration) sans mission ouverte
  let enAttente = 0;
  try { enAttente = (await require('./missions-ccs').interventionsDemo(pool, u)).filter((i) => !i.statut || ['refusee', 'annulee'].includes(i.statut)).length; } catch { enAttente = 0; }
  const total = cartes.length;
  const tri = q.tri === 'priorite' ? (a, b) => ({ rouge: 2, orange: 1, vert: 0 }[b.niveau] - { rouge: 2, orange: 1, vert: 0 }[a.niveau]) || (b.duree_min || 0) - (a.duree_min || 0) : null;
  if (q.statut) cartes = cartes.filter((c) => c.statut === q.statut || c.conditions.includes(q.statut));
  if (q.q) { const t = String(q.q).toLowerCase(); cartes = cartes.filter((c) => [c.numero, c.organisation, c.mission?.numero].some((x) => String(x || '').toLowerCase().includes(t))); }
  if (tri) cartes.sort(tri);
  const taille = Math.min(Math.max(Number(q.taille) || 500, 1), 500); const page = Math.max(Number(q.page) || 1, 1);
  return { genere_le: new Date(now).toISOString(), seuils: s, total, filtres: cartes.length, page, taille, vehicules: cartes.slice((page - 1) * taille, page * taille),
    compteurs, conditions, missions_en_attente: enAttente, statuts: STATUTS, rapides: RAPIDES[cote(u)] };
}

/** Phases chronométrées d'une mission (même horodatage source partout) : seulement celles du parcours réel. */
function phases(evts, m) {
  const t = (etat) => evts.find((e) => e.etat === etat)?.cree_le || null;
  const accept = m?.acceptee_le || null;
  const p = [['acceptation', accept, t('en_route')], ['deplacement', t('en_route'), t('sur_place')], ['sur_place', t('sur_place'), t('transport_hopital')],
    ['transport', t('transport_hopital'), t('a_l_hopital')], ['attente_destination', t('a_l_hopital'), t('en_preparation') || t('disponible')],
    ['remise_en_service', t('en_preparation') || t('desinfection'), t('disponible')]];
  return p.filter(([, debut]) => debut).map(([phase, debut, fin]) => ({ phase, debut, fin, en_cours: !fin }));
}

/** Fiche d'un véhicule : carte, chronologie unique (états, mission, messages), phases et plans de destination proposés par OG. */
async function fiche(pool, u, uniteId) {
  const id = entier(uniteId); if (!id) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'unite_id' });
  const [v] = await vehicules.liste(pool, u, { uniteId: id });
  if (!v) throw new ErreurHttp(404, 'unite_introuvable');
  const s = await seuils(pool, u); const d = (await details(pool, [id])).get(id); const c = carte(v, d, s, Date.now());
  const debutMission = d?.mi_envoyee_le || d?.pa_cree_le || null;
  const [etats, missionEvts, messages] = await Promise.all([
    pool.query(`SELECT etat, source, cree_le FROM etat_vehicule_evenements WHERE unite_id = $1 AND ($2::timestamptz IS NULL OR cree_le >= $2) ORDER BY id LIMIT 200`, [id, debutMission]),
    d?.mi_id ? pool.query('SELECT statut, detail, cree_le FROM mission_ccs_evenements WHERE mission_id = $1 ORDER BY id', [d.mi_id]) : { rows: [] },
    fil(pool, u, id),
  ]);
  const accepte = missionEvts.rows.find((e) => e.statut === 'acceptee');
  return { vehicule: c, seuils: s, chronologie: [...etats.rows.map((e) => ({ le: e.cree_le, type: 'etat', code: e.etat, source: e.source })),
    ...missionEvts.rows.map((e) => ({ le: e.cree_le, type: 'mission', code: e.statut, detail: e.detail })),
    ...messages.map((m) => ({ le: m.cree_le, type: 'message', code: m.genre, sens: m.sens, rapide: m.code_rapide }))].sort((a, b) => new Date(a.le) - new Date(b.le)),
    phases: phases(etats.rows, { acceptee_le: accepte?.cree_le }), messages };
}

/** Plans A, B, C de destination proposés par OG (capacités confirmées, temps de trajet, restrictions) : jamais appliqués seuls. */
async function plans(pool, u, uniteId) {
  const r = await vehicules.urgencesClassees(pool, u, { unite_id: uniteId }).catch((e) => { if (e.statut === 400) return []; throw e; });
  return { plans: ((r && r.urgences) || []).filter((h) => !h.ecartee && h.rang < 3).slice(0, 3).map((h, i) => ({ plan: 'ABC'[i], id: h.id, nom: h.nom, temps_min: h.temps_min ?? null, distance_km: h.distance_km ?? null,
    civieres_libres: h.urgence?.civieres_libres ?? null, statut: h.statut_declare?.statut || null, services: h.services_ouverts || [], source_temps: h.source_distance || null })),
  note: 'Proposition d’OG : la décision appartient au professionnel ou au système habilité. Une disponibilité affichée n’est pas une acceptation du patient.' };
}

/* ---------------- Communication opérationnelle CCS ↔ ambulance ---------------- */
async function uniteAutorisee(db, u, uniteId) {
  const [v] = await vehicules.liste(db, u, { uniteId: entier(uniteId) });
  if (!v) throw new ErreurHttp(404, 'unite_introuvable');
  return v;
}
async function fil(pool, u, uniteId) {
  await uniteAutorisee(pool, u, uniteId);
  return (await pool.query(`SELECT m.id, m.sens, m.genre, m.code_rapide, m.texte, m.mission_id, m.cree_le, m.recu_le, m.lu_le, uc.nom AS auteur, e.nom AS etablissement
    FROM messages_flotte m LEFT JOIN utilisateurs uc ON uc.id = m.cree_par LEFT JOIN etablissements e ON e.id = m.etablissement_id WHERE m.unite_id = $1 ORDER BY m.cree_le DESC LIMIT 50`, [entier(uniteId)])).rows;
}
async function envoyer(pool, u, b = {}) {
  const c0 = cote(u); if (!c0) throw new ErreurHttp(403, 'role_insuffisant');
  await uniteAutorisee(pool, u, b.unite_id);
  const genre = String(b.genre || 'message');
  if (!(c0 === 'ccs' ? GENRES_CCS : GENRES_AMBULANCE).includes(genre)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'genre' });
  const rapide = b.code_rapide ? String(b.code_rapide) : null;
  if (rapide && !RAPIDES[c0].includes(rapide)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'code_rapide' });
  const texte = b.texte ? String(b.texte).trim().replace(/\s+/g, ' ').slice(0, 200) : null;
  if (!rapide && !texte) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'texte' });
  const cle = b.cle ? String(b.cle) : null; if (cle && !/^[A-Za-z0-9_-]{8,64}$/.test(cle)) throw new ErreurHttp(400, 'cle_idempotence_invalide');
  const etab = b.etablissement_id ? Number(b.etablissement_id) : null;
  if (etab && !(await etablissementsDeMission(pool, entier(b.unite_id))).includes(etab)) throw new ErreurHttp(404, 'etab_introuvable');
  const mission = (await pool.query(`SELECT id, organisation_ccs_id FROM missions_ccs WHERE unite_id = $1 AND statut IN ('proposee', 'acceptee', 'sur_place') ORDER BY id DESC LIMIT 1`, [entier(b.unite_id)])).rows[0];
  // Événement rejoué après une reconnexion (même clé) : le premier enregistrement est rendu, jamais un doublon
  const r = (await pool.query(`INSERT INTO messages_flotte (unite_id, mission_id, organisation_ccs_id, sens, genre, code_rapide, texte, cle_idempotence, cree_par, etablissement_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (unite_id, cle_idempotence) DO NOTHING RETURNING *`,
  [entier(b.unite_id), mission?.id || null, mission?.organisation_ccs_id || null, c0, genre, rapide, texte, cle, u.id, etab])).rows[0]
    || (await pool.query('SELECT *, true AS rejoue FROM messages_flotte WHERE unite_id = $1 AND cle_idempotence = $2', [entier(b.unite_id), cle])).rows[0];
  require('./flux').signaler();
  return r;
}
/** Accusé de lecture par le destinataire (l'auteur ne peut pas accuser son propre message). */
async function lire(pool, u, id) {
  const m = (await pool.query('SELECT * FROM messages_flotte WHERE id = $1', [entier(id)])).rows[0];
  if (!m) throw new ErreurHttp(404, 'message_introuvable');
  let c0 = cote(u);
  if (c0) await uniteAutorisee(pool, u, m.unite_id);
  else { if (!m.etablissement_id) throw new ErreurHttp(404, 'message_introuvable'); require('./auth').exigerEtablissement(u, m.etablissement_id); c0 = 'etablissement'; }
  if (m.sens === c0) throw new ErreurHttp(409, 'message_propre');
  const r = (await pool.query('UPDATE messages_flotte SET recu_le = COALESCE(recu_le, now()), lu_le = COALESCE(lu_le, now()), lu_par = COALESCE(lu_par, $2) WHERE id = $1 RETURNING *', [m.id, u.id])).rows[0];
  require('./flux').signaler();
  return r;
}

/* ---------------- Établissements liés à une mission (urgence de destination, hébergement d'origine ou de destination) ---------------- */
async function etablissementsDeMission(db, uniteId) {
  const r = await db.query(`SELECT destination_id AS id FROM prealertes WHERE unite_id = $1 AND statut NOT IN ('cloturee', 'annulee', 'remplacee') AND destination_id IS NOT NULL
    UNION SELECT origine_id FROM demandes_transport WHERE unite_id = $1 AND terminee_le IS NULL AND statut IN ('acceptee', 'en_route', 'pris_en_charge', 'arrivee')
    UNION SELECT destination_id FROM demandes_transport WHERE unite_id = $1 AND terminee_le IS NULL AND statut IN ('acceptee', 'en_route', 'pris_en_charge', 'arrivee') AND destination_id IS NOT NULL
    UNION SELECT destination_id FROM missions_ccs WHERE unite_id = $1 AND statut IN ('proposee', 'acceptee', 'sur_place') AND destination_id IS NOT NULL
    UNION SELECT origine_id FROM missions_ccs WHERE unite_id = $1 AND statut IN ('proposee', 'acceptee', 'sur_place') AND origine_id IS NOT NULL`, [uniteId]);
  return r.rows.map((x) => x.id);
}
/** Côté établissement (Urgences → Secours 911) : ambulances liées à ses missions en cours et leurs échanges avec lui. */
async function filEtablissement(pool, u, etabId) {
  const id = entier(etabId); require('./auth').exigerEtablissement(u, id);
  const unites = (await pool.query(`SELECT DISTINCT un.id, un.numero, COALESCE(pa.numero, d.numero, mi.numero) AS mission, COALESCE(pa.statut, d.statut, mi.statut) AS mission_statut, ev.etat, ev.modifie_le
    FROM unites_secours un LEFT JOIN etats_vehicules ev ON ev.unite_id = un.id
    LEFT JOIN prealertes pa ON pa.unite_id = un.id AND pa.destination_id = $1 AND pa.statut NOT IN ('cloturee', 'annulee', 'remplacee')
    LEFT JOIN demandes_transport d ON d.unite_id = un.id AND (d.origine_id = $1 OR d.destination_id = $1) AND d.terminee_le IS NULL AND d.statut IN ('acceptee', 'en_route', 'pris_en_charge', 'arrivee')
    LEFT JOIN missions_ccs mi ON mi.unite_id = un.id AND (mi.destination_id = $1 OR mi.origine_id = $1) AND mi.statut IN ('proposee', 'acceptee', 'sur_place')
    WHERE COALESCE(pa.id, d.id, mi.id) IS NOT NULL ORDER BY un.numero`, [id])).rows;
  const messages = (await pool.query(`SELECT m.id, m.unite_id, un.numero AS unite, m.sens, m.genre, m.code_rapide, m.texte, m.cree_le, m.lu_le
    FROM messages_flotte m JOIN unites_secours un ON un.id = m.unite_id WHERE m.etablissement_id = $1 AND m.cree_le > now() - interval '24 hours' ORDER BY m.cree_le DESC LIMIT 40`, [id])).rows;
  // Messages rapides selon le type : l'urgence confirme l'accueil, l'hébergement la préparation du résident
  const type = (await pool.query('SELECT type_etablissement FROM etablissements WHERE id = $1', [id])).rows[0]?.type_etablissement || 'hopital';
  return { unites, messages, rapides: RAPIDES.etablissement.filter((r) => (type === 'hopital' ? r !== 'resident_pret' : r !== 'accueil_pret')) };
}
async function envoyerEtablissement(pool, u, b = {}) {
  const etab = entier(b.etablissement_id); require('./auth').exigerEtablissement(u, etab);
  if (!['coordonnateur', 'admin_etab', 'gestionnaire', 'equipe_soins'].includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const unite = entier(b.unite_id); if (!unite || !(await etablissementsDeMission(pool, unite)).includes(etab)) throw new ErreurHttp(404, 'unite_introuvable');
  const rapide = b.code_rapide ? String(b.code_rapide) : null; if (rapide && !RAPIDES.etablissement.includes(rapide)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'code_rapide' });
  const texte = b.texte ? String(b.texte).trim().replace(/\s+/g, ' ').slice(0, 200) : null; if (!rapide && !texte) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'texte' });
  const cle = b.cle ? String(b.cle) : null; if (cle && !/^[A-Za-z0-9_-]{8,64}$/.test(cle)) throw new ErreurHttp(400, 'cle_idempotence_invalide');
  const genre = ['reception', 'etape'].includes(b.genre) ? b.genre : 'message';
  const r = (await pool.query(`INSERT INTO messages_flotte (unite_id, sens, genre, code_rapide, texte, cle_idempotence, cree_par, etablissement_id) VALUES ($1, 'etablissement', $2, $3, $4, $5, $6, $7)
    ON CONFLICT (unite_id, cle_idempotence) DO NOTHING RETURNING *`, [unite, genre, rapide, texte, cle, u.id, etab])).rows[0];
  require('./flux').signaler();
  return r || { rejoue: true };
}

/* ---------------- Transmission d'une mission : envoyée ≠ reçue ≠ consultée ≠ acceptée ---------------- */
async function transmission(pool, u, missionId, etape) {
  if (cote(u) !== 'ambulance') throw new ErreurHttp(403, 'role_insuffisant');
  if (!['recue', 'consultee'].includes(etape)) throw new ErreurHttp(400, 'action_inconnue');
  return transaction(pool, async (c) => {
    const m = (await c.query('SELECT * FROM missions_ccs WHERE id = $1 FOR UPDATE', [entier(missionId)])).rows[0];
    if (!m) throw new ErreurHttp(404, 'mission_introuvable');
    await uniteAutorisee(c, u, m.unite_id);
    const col = etape === 'recue' ? 'recue_le' : 'consultee_le';
    if (m[col]) return m;   // déjà enregistré : un événement dupliqué ne change rien
    // Consultée implique reçue (l'écran l'a forcément reçue) ; une seule affectation par colonne
    const n = (await c.query(etape === 'recue' ? 'UPDATE missions_ccs SET recue_le = now() WHERE id = $1 RETURNING *'
      : 'UPDATE missions_ccs SET consultee_le = now(), recue_le = COALESCE(recue_le, now()) WHERE id = $1 RETURNING *', [m.id])).rows[0];
    await c.query('INSERT INTO mission_ccs_evenements (mission_id, statut, utilisateur_id) VALUES ($1, $2, $3)', [m.id, etape, u.id]);
    require('./flux').signaler();
    return n;
  });
}
/** Modification autorisée de destination ou d'instructions par le CCS : horodatée, transmise, à confirmer par l'équipage. */
async function modifierMission(pool, u, missionId, b = {}) {
  if (cote(u) !== 'ccs') throw new ErreurHttp(403, 'role_insuffisant');
  return transaction(pool, async (c) => {
    const m = (await c.query(`SELECT * FROM missions_ccs WHERE id = $1 AND statut IN ('proposee', 'acceptee', 'sur_place') FOR UPDATE`, [entier(missionId)])).rows[0];
    if (!m) throw new ErreurHttp(404, 'mission_introuvable');
    await uniteAutorisee(c, u, m.unite_id);
    if (b.version != null && Number(b.version) !== m.version) throw new ErreurHttp(409, 'version_perimee');
    const dest = b.destination_id ? entier(b.destination_id) : null;
    if (b.destination_id && !(await c.query("SELECT 1 FROM etablissements WHERE id = $1 AND actif AND COALESCE(type_etablissement, 'hopital') = 'hopital'", [dest])).rowCount) throw new ErreurHttp(404, 'hopital_introuvable');
    const instr = b.instructions != null ? String(b.instructions).trim().replace(/\s+/g, ' ').slice(0, 280) || null : m.instructions;
    const n = (await c.query(`UPDATE missions_ccs SET destination_id = COALESCE($2, destination_id), instructions = $3, version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`, [m.id, dest, instr])).rows[0];
    const genre = dest && dest !== m.destination_id ? 'destination' : 'instruction';
    await c.query('INSERT INTO mission_ccs_evenements (mission_id, statut, utilisateur_id, detail) VALUES ($1, $2, $3, $4)', [m.id, genre === 'destination' ? 'destination_modifiee' : 'instructions_modifiees', u.id, dest ? String(dest) : null]);
    await c.query(`INSERT INTO messages_flotte (unite_id, mission_id, organisation_ccs_id, sens, genre, code_rapide, texte, cree_par) VALUES ($1, $2, $3, 'ccs', $4, $5, $6, $7)`,
      [m.unite_id, m.id, m.organisation_ccs_id, genre, genre === 'destination' ? 'nouvelle_destination' : null, genre === 'instruction' ? instr : null, u.id]);
    require('./flux').signaler();
    return n;
  });
}

/* ---------------- Historique paginé et synthèses (remplace les longues listes des écrans opérationnels) ---------------- */
/** Nombre, moyenne et médiane des missions terminées, par clé. Indicateurs d'organisation, jamais de sanction automatique. */
function groupe(lignes, cle) {
  const m = new Map();
  for (const x of lignes) { const k = cle(x); if (!k) continue; const g = m.get(k) || { cle: k, nombre: 0, durees: [] }; g.nombre += 1;
    if (['terminee', 'cloturee', 'arrivee'].includes(x.statut)) { const d = Math.round((new Date(x.fin) - new Date(x.debut)) / 60000); if (d >= 0) g.durees.push(d); } m.set(k, g); }
  return [...m.values()].map((g) => ({ cle: g.cle, nombre: g.nombre, moyenne_min: g.durees.length ? Math.round(g.durees.reduce((a, b) => a + b, 0) / g.durees.length) : null, mediane_min: mediane(g.durees) }))
    .sort((a, b) => b.nombre - a.nombre);
}
const mediane = (l) => { if (!l.length) return null; const s = [...l].sort((a, b) => a - b); const k = Math.floor(s.length / 2); return s.length % 2 ? s[k] : Math.round((s[k - 1] + s[k]) / 2); };
async function historique(pool, u, q = {}) {
  if (!cote(u)) throw new ErreurHttp(403, 'role_insuffisant');
  const liste = await vehicules.liste(pool, u); const ids = liste.map((v) => v.id);
  const unite = q.unite_id ? entier(q.unite_id) : null; if (unite && !ids.includes(unite)) throw new ErreurHttp(404, 'unite_introuvable');
  const jours = Math.min(Math.max(Number(q.jours) || 30, 1), 365);
  const taille = Math.min(Math.max(Number(q.taille) || 25, 5), 100); const page = Math.max(Number(q.page) || 1, 1);
  const r = (await pool.query(`SELECT * FROM (
      SELECT 'mission' AS type, m.id, m.numero, m.statut, un.numero AS unite, m.lieu AS origine, NULL::text AS destination, m.cree_le AS debut, m.modifie_le AS fin
        FROM missions_ccs m JOIN unites_secours un ON un.id = m.unite_id WHERE m.unite_id = ANY($1) AND m.statut IN ('terminee', 'refusee', 'annulee')
      UNION ALL SELECT 'prealerte', p.id, p.numero, p.statut, un.numero, NULL, e.nom, p.cree_le, p.modifie_le
        FROM prealertes p JOIN unites_secours un ON un.id = p.unite_id LEFT JOIN etablissements e ON e.id = p.destination_id WHERE p.unite_id = ANY($1) AND p.statut IN ('cloturee', 'annulee', 'remplacee')
      UNION ALL SELECT 'transport', d.id, d.numero, d.statut, un.numero, eo.nom, COALESCE(ed.nom, d.destination_libelle), d.cree_le, COALESCE(d.terminee_le, d.remis_le, d.arrivee_le, d.modifie_le)
        FROM demandes_transport d JOIN unites_secours un ON un.id = d.unite_id JOIN etablissements eo ON eo.id = d.origine_id LEFT JOIN etablissements ed ON ed.id = d.destination_id
        WHERE d.unite_id = ANY($1) AND (d.terminee_le IS NOT NULL OR d.statut IN ('annulee', 'refusee'))
    ) h WHERE fin > now() - make_interval(days => $2) AND ($3::text IS NULL OR type = $3) AND ($4::text IS NULL OR h.numero ILIKE '%' || $4 || '%')
      AND ($5::int IS NULL OR unite = (SELECT numero FROM unites_secours WHERE id = $5))
    ORDER BY fin DESC`, [unite ? [unite] : ids, jours, ['mission', 'prealerte', 'transport'].includes(q.type) ? q.type : null, q.q ? String(q.q).slice(0, 40) : null, unite])).rows;
  const durees = r.filter((x) => ['terminee', 'cloturee', 'arrivee'].includes(x.statut)).map((x) => Math.round((new Date(x.fin) - new Date(x.debut)) / 60000)).filter((n) => n >= 0);
  const parJour = {}; for (const x of r) { const k = new Date(x.fin).toISOString().slice(0, 10); parJour[k] = (parJour[k] || 0) + 1; }
  return { jours, total: r.length, page, taille, pages: Math.max(1, Math.ceil(r.length / taille)), lignes: r.slice((page - 1) * taille, page * taille),
    synthese: { nombre: r.length, terminees: durees.length, moyenne_min: durees.length ? Math.round(durees.reduce((a, b) => a + b, 0) / durees.length) : null,
      mediane_min: mediane(durees), dernier: r[0] ? { numero: r[0].numero, fin: r[0].fin, duree_min: Math.round((new Date(r[0].fin) - new Date(r[0].debut)) / 60000) } : null,
      par_jour: Object.entries(parJour).sort(([a], [b]) => a.localeCompare(b)).map(([jour, n]) => ({ jour, n })),
      // Performance par type de mission et par établissement (selon les permissions : périmètre de l'utilisateur seulement)
      par_type: groupe(r, (x) => x.type), par_etablissement: groupe(r, (x) => x.destination || x.origine).slice(0, 15) } };
}

/* ---------------- Alertes d'immobilisation pour le CCS (même seuils, jamais de réorientation automatique) ---------------- */
async function alertes(pool, u) {
  const t = await tableau(pool, u, { tri: 'priorite' });
  return t.vehicules.filter((v) => v.niveau !== 'vert' || v.conditions.includes('perte_connexion')).map((v) => ({ unite_id: v.id, unite: v.numero, niveau: v.niveau,
    conditions: v.conditions, depuis: v.depuis, duree_min: v.duree_min, mission: v.mission?.numero || null, destination: v.mission?.destination || null }));
}

/* ---------------- Seuils depuis SH ---------------- */
async function definirSeuils(db, organisationId, b, par) {
  const vig = Number(b.vigilance_min); const esc = Number(b.escalade_min);
  if (!Number.isInteger(vig) || !Number.isInteger(esc) || vig < 1 || esc <= vig || esc > 1440) throw new ErreurHttp(400, 'seuils_invalides');
  return (await db.query(`INSERT INTO seuils_flotte (organisation_id, vigilance_min, escalade_min, modifie_par) VALUES ($1, $2, $3, $4)
    ON CONFLICT (organisation_id) DO UPDATE SET vigilance_min = EXCLUDED.vigilance_min, escalade_min = EXCLUDED.escalade_min, modifie_par = EXCLUDED.modifie_par, modifie_le = now() RETURNING *`,
  [organisationId, vig, esc, par || null])).rows[0];
}

module.exports = { filEtablissement, envoyerEtablissement, etablissementsDeMission, tableau, fiche, plans, fil, envoyer, lire, transmission, modifierMission, historique, alertes, seuils, definirSeuils, statutDe, carte, STATUTS, CONDITIONS, RAPIDES, SEUILS_DEFAUT };
