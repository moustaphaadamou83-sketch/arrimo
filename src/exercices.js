'use strict';
/**
 * Exercice de formation isolé avec injection d'événements (complémentaire nº 3 « résilience », §9 ; 26 nov. 2026).
 * - Démonstration et recette seulement (refus prouvé par test ailleurs).
 * - Un formateur (coordination, administration de l'établissement, gestion réseau) ouvre un exercice et injecte des événements
 *   d'une liste fermée. Ce sont des MESSAGES D'EXERCICE : aucun lit, civière, transfert ni connecteur réel n'est modifié.
 * - Les participants de l'établissement répondent par une action d'une liste fermée ; le délai de réponse est mesuré.
 * - Événements et réponses sont immuables ; le rapport de fin donne les délais mesurés, sans note ni classement des personnes.
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const { environnement } = require('./environnement');

const TYPES = ['afflux_ambulances', 'lit_bloque', 'connecteur_silencieux', 'evacuation_partielle', 'transfert_sans_reponse', 'penurie_personnel'];
const ACTIONS = ['escalader', 'reaffecter', 'demander_transfert', 'activer_crise', 'informer_reseau', 'suspendre_connecteur', 'rappeler_personnel', 'aucune_action'];
const FORMATEURS = ['coordonnateur', 'admin_etab', 'gestionnaire'];

function exigerEnvironnement() {
  if (!['demo', 'recette', 'developpement'].includes(environnement())) throw new ErreurHttp(403, 'module_desactive', { module: 'exercices' });
}
const entier = (v, nom) => { const n = Number(v); if (!Number.isSafeInteger(n) || n < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom }); return n; };
function exigerFormateur(u) { if (!(FORMATEURS.includes(u.role) || u.gestionnaire)) throw new ErreurHttp(403, 'role_insuffisant'); }

async function exercice(db, u, id) {
  const x = (await db.query('SELECT * FROM exercices WHERE id = $1', [id])).rows[0];
  if (!x) throw new ErreurHttp(404, 'exercice_introuvable');
  exigerEtablissement(u, x.etablissement_id);
  return x;
}

async function ouvrir(pool, u, b = {}) {
  exigerEnvironnement(); exigerFormateur(u);
  const etabId = entier(b.etablissement_id, 'etablissement_id'); exigerEtablissement(u, etabId);
  const titre = String(b.titre || '').trim() || (u.langue === 'en' ? 'Coordination exercise' : 'Exercice de coordination');
  if (titre.length > 120) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'titre' });
  try {
    const { rows: [x] } = await pool.query('INSERT INTO exercices (etablissement_id, titre, cree_par) VALUES ($1, $2, $3) RETURNING *', [etabId, titre, u.id]);
    require('./flux').signaler();
    return x;
  } catch (e) { if (e.code === '23505') throw new ErreurHttp(409, 'exercice_deja_en_cours'); throw e; }
}

async function injecter(pool, u, id, b = {}) {
  exigerEnvironnement(); exigerFormateur(u);
  const x = await exercice(pool, u, entier(id, 'id'));
  if (x.statut !== 'en_cours') throw new ErreurHttp(409, 'exercice_termine');
  if (!TYPES.includes(b.type)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'type' });
  const { rows: [ev] } = await pool.query('INSERT INTO exercice_evenements (exercice_id, type, injecte_par) VALUES ($1, $2, $3) RETURNING *', [x.id, b.type, u.id]);
  require('./flux').signaler();
  return ev;
}

async function repondre(pool, u, id, evenementId, b = {}) {
  exigerEnvironnement();
  const x = await exercice(pool, u, entier(id, 'id'));
  if (x.statut !== 'en_cours') throw new ErreurHttp(409, 'exercice_termine');
  const ev = (await pool.query('SELECT * FROM exercice_evenements WHERE id = $1 AND exercice_id = $2', [entier(evenementId, 'evenement_id'), x.id])).rows[0];
  if (!ev) throw new ErreurHttp(404, 'exercice_introuvable');
  if (!ACTIONS.includes(b.action)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'action' });
  const { rows: [r] } = await pool.query('INSERT INTO exercice_reponses (evenement_id, action, repondu_par) VALUES ($1, $2, $3) RETURNING *', [ev.id, b.action, u.id]);
  require('./flux').signaler();
  return r;
}

/** Délai de réponse de chaque événement (première réponse), médiane et événements sans réponse. */
function synthese(evenements) {
  const delais = evenements.map((e) => e.premiere_reponse_min).filter((n) => n != null).sort((a, b) => a - b);
  const med = delais.length ? (delais.length % 2 ? delais[(delais.length - 1) / 2] : Math.round(((delais[delais.length / 2 - 1] + delais[delais.length / 2]) / 2) * 10) / 10) : null;
  return { evenements: evenements.length, avec_reponse: delais.length, sans_reponse: evenements.length - delais.length, delai_median_min: med, delai_max_min: delais.length ? delais[delais.length - 1] : null };
}

async function details(db, x) {
  const evenements = (await db.query(`SELECT ev.id, ev.type, ev.injecte_le,
      (SELECT min(r.repondu_le) FROM exercice_reponses r WHERE r.evenement_id = ev.id) AS premiere_reponse_le,
      (SELECT COALESCE(json_agg(json_build_object('action', r.action, 'le', r.repondu_le, 'par', us.nom) ORDER BY r.repondu_le), '[]')
         FROM exercice_reponses r JOIN utilisateurs us ON us.id = r.repondu_par WHERE r.evenement_id = ev.id) AS reponses
    FROM exercice_evenements ev WHERE ev.exercice_id = $1 ORDER BY ev.id`, [x.id])).rows
    .map((e) => ({ ...e, premiere_reponse_min: e.premiere_reponse_le ? Math.round((new Date(e.premiere_reponse_le) - new Date(e.injecte_le)) / 6000) / 10 : null }));
  return { ...x, evenements, synthese: synthese(evenements) };
}

async function etat(pool, u, q = {}) {
  exigerEnvironnement();
  const etabId = entier(q.etablissement_id, 'etablissement_id'); exigerEtablissement(u, etabId);
  const xs = (await pool.query(`SELECT * FROM exercices WHERE etablissement_id = $1 AND (statut = 'en_cours' OR debut_le > now() - interval '30 days') ORDER BY id DESC LIMIT 5`, [etabId])).rows;
  return { en_cours: xs.find((x) => x.statut === 'en_cours') ? await details(pool, xs.find((x) => x.statut === 'en_cours')) : null,
    recents: await Promise.all(xs.filter((x) => x.statut === 'termine').map((x) => details(pool, x))),
    types: TYPES, actions: ACTIONS, formateur: FORMATEURS.includes(u.role) || !!u.gestionnaire };
}

async function terminer(pool, u, id) {
  exigerEnvironnement(); exigerFormateur(u);
  const x = await exercice(pool, u, entier(id, 'id'));
  if (x.statut !== 'en_cours') throw new ErreurHttp(409, 'exercice_termine');
  const { rows: [f] } = await pool.query(`UPDATE exercices SET statut = 'termine', fin_le = now() WHERE id = $1 AND statut = 'en_cours' RETURNING *`, [x.id]);
  require('./flux').signaler();
  return details(pool, f);
}

module.exports = { ouvrir, injecter, repondre, etat, terminer, synthese, TYPES, ACTIONS };
