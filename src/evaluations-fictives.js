'use strict';
/**
 * Pathologies et symptômes FICTIFS, en démonstration seulement (décision de Moustafa, 6 nov. 2026).
 * Refus par le serveur dans tout autre environnement, y compris recette, validation et production.
 * - Lecture et écriture réservées au personnel de soins et à la coordination ; jamais l'entretien, ni les vues réseau.
 * - Rien dans les notifications ; le journal ne garde que le numéro et la référence. Chaque consultation est tracée.
 * - Une évaluation informe des personnes : elle ne fixe ni une admission, ni une chambre, ni une priorité. OG n'y a pas accès.
 */
const { ErreurHttp, transaction } = require('./db');
const { exigerEtablissement } = require('./auth');
const env = require('./environnement');

const ROLES = ['equipe_soins', 'coordonnateur'];
const PRECAUTIONS = ['contact', 'gouttelettes', 'aerien'];
const STATUTS = ['a_valider', 'validee'];
function exigerDemo() { if (!env.estDemo()) throw new ErreurHttp(403, 'clinique_demo_seulement'); }
const texte = (v, max) => { if (v !== undefined && v !== null && typeof v !== 'string') throw new ErreurHttp(400, 'evaluation_invalide'); const s = String(v ?? '').trim(); if (s.length > max) throw new ErreurHttp(400, 'evaluation_invalide'); return s || null; };
function exiger(u, etabId) { exigerDemo(); exigerEtablissement(u, etabId); if (!ROLES.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant'); }
const tracer = (db, id, u, action) => db.query('INSERT INTO evaluations_fictives_acces (evaluation_id, utilisateur_id, action) VALUES ($1, $2, $3)', [id, u.id, action]);

async function referenceDe(db, etabId, reference) {
  const r = String(reference ?? '').trim();
  const ok = (await db.query(`SELECT 1 FROM residents WHERE etablissement_id = $1 AND reference = $2 UNION ALL SELECT 1 FROM patients WHERE etablissement_id = $1 AND reference = $2 LIMIT 1`, [etabId, r])).rowCount;
  if (!ok) throw new ErreurHttp(404, 'reference_introuvable');
  return r;
}
async function creer(pool, u, b = {}) {
  const etab = Number(b.etablissement_id); exiger(u, etab);
  const reference = await referenceDe(pool, etab, b.reference);
  const pathologies = texte(b.pathologies, 1000); const symptomes = texte(b.symptomes, 1000);
  if (!pathologies && !symptomes) throw new ErreurHttp(400, 'evaluation_invalide');
  const precautions = Array.isArray(b.precautions) ? [...new Set(b.precautions)] : [];
  if (precautions.some((p) => !PRECAUTIONS.includes(p))) throw new ErreurHttp(400, 'evaluation_invalide');
  return transaction(pool, async (c) => {
    const e = (await c.query(`INSERT INTO evaluations_fictives (etablissement_id, reference, pathologies, symptomes, besoins, precautions, contraintes_hebergement, equipements, statut, auteur)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'a_valider', $9) RETURNING *`, [etab, reference, pathologies, symptomes, texte(b.besoins, 500), precautions, texte(b.contraintes_hebergement, 500), texte(b.equipements, 500), u.id])).rows[0];
    await tracer(c, e.id, u, 'creation');
    return e;
  });
}
async function liste(pool, u, etabId, reference) {
  exiger(u, etabId);
  const r = await referenceDe(pool, etabId, reference);
  const { rows } = await pool.query(`SELECT e.*, a.nom AS auteur_nom, v.nom AS valide_par_nom FROM evaluations_fictives e LEFT JOIN utilisateurs a ON a.id = e.auteur LEFT JOIN utilisateurs v ON v.id = e.valide_par
    WHERE e.etablissement_id = $1 AND e.reference = $2 ORDER BY e.id DESC LIMIT 50`, [etabId, r]);
  for (const e of rows) await tracer(pool, e.id, u, 'consultation');
  return rows;
}
async function valider(pool, u, id) {
  exigerDemo();
  const e0 = (await pool.query('SELECT etablissement_id, auteur FROM evaluations_fictives WHERE id = $1', [id])).rows[0];
  if (!e0) throw new ErreurHttp(404, 'evaluation_introuvable');
  exiger(u, e0.etablissement_id);
  return transaction(pool, async (c) => {
    const e = (await c.query(`UPDATE evaluations_fictives SET statut = 'validee', valide_par = $2, valide_le = now() WHERE id = $1 AND statut = 'a_valider' RETURNING *`, [id, u.id])).rows[0];
    if (!e) throw new ErreurHttp(409, 'evaluation_deja_validee');
    await tracer(c, id, u, 'validation');
    return e;
  });
}
/** Évaluation validée à joindre à une demande : même établissement, même référence. Hors démo, aucune transmission possible. */
async function aTransmettre(db, id, etabId, reference) {
  if (id === undefined || id === null || id === '') return null;
  exigerDemo();
  const e = (await db.query(`SELECT id FROM evaluations_fictives WHERE id = $1 AND etablissement_id = $2 AND reference = $3 AND statut = 'validee'`, [Number(id), etabId, reference])).rows[0];
  if (!e) throw new ErreurHttp(409, 'evaluation_non_transmissible');
  return e.id;
}
/** Hôpital ou CHSLD partie à la coordination : ce qui a été transmis, tracé à chaque consultation. */
async function transmise(pool, u, coId, etabId) {
  exiger(u, etabId);
  const co = (await pool.query('SELECT origine_id, destination_id, evaluation_transmise_id FROM coordinations WHERE id = $1', [coId])).rows[0];
  if (!co || ![co.origine_id, co.destination_id].includes(etabId)) throw new ErreurHttp(404, 'coordination_introuvable');
  if (!co.evaluation_transmise_id) throw new ErreurHttp(404, 'evaluation_introuvable');
  const e = (await pool.query('SELECT reference, pathologies, symptomes, besoins, precautions, contraintes_hebergement, equipements, statut, cree_le, valide_le FROM evaluations_fictives WHERE id = $1', [co.evaluation_transmise_id])).rows[0];
  await tracer(pool, co.evaluation_transmise_id, u, `consultation_transmise:${etabId}`);
  return e;
}
/** Précautions prescrites, sans aucun texte clinique : seule information utile au tri des chambres, hors démo : rien. */
async function precautionsTransmises(db, coId) {
  if (!env.estDemo()) return [];
  return (await db.query('SELECT e.precautions FROM coordinations c JOIN evaluations_fictives e ON e.id = c.evaluation_transmise_id WHERE c.id = $1', [coId])).rows[0]?.precautions || [];
}
function brancher(api, pool, route, entier) {
  api.post('/evaluations-fictives', route((req) => creer(pool, req.utilisateur, req.body)));
  api.get('/evaluations-fictives', route((req) => liste(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'), req.query.reference)));
  api.post('/evaluations-fictives/:id/valider', route((req) => valider(pool, req.utilisateur, entier(req.params.id, 'id'))));
  api.get('/coordinations/:id/evaluation', route((req) => transmise(pool, req.utilisateur, entier(req.params.id, 'id'), entier(req.query.etablissement_id, 'etablissement_id'))));
}
module.exports = { brancher, aTransmettre, precautionsTransmises, exigerDemo, STATUTS };
