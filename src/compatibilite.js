'use strict';
/**
 * Règle fondamentale de compatibilité des capacités (cahier nº 19, 26 nov. 2026). Une ressource n'est jamais proposée ni attribuée
 * seulement parce qu'elle est libre : le moteur vérifie sa compatibilité (type d'unité / spécialité, équipements, groupe d'âge,
 * catégorie de civière). Une attribution incompatible n'est possible qu'à titre EXCEPTIONNEL : rôle habilité, motif en liste fermée,
 * justification, registre immuable (Sillage, Vigilance, centre d'audit). Le groupe d'âge n'admet jamais d'exception.
 */
const { ErreurHttp } = require('./db');

const MOTIFS = ['debordement_capacite', 'urgence_vitale', 'decision_medicale', 'isolement_requis', 'autre_documente'];
const ROLES = ['coordonnateur', 'gestionnaire', 'admin_etab'];

/** Valide une demande d'exception (sans rien écrire) ; null si aucune exception n'est demandée. */
function lireException(u, e) {
  if (!e) return null;
  if (!ROLES.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  if (!MOTIFS.includes(e.motif)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'motif' });
  const j = String(e.justification || '').trim();
  if (j.length < 5 || j.length > 300) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'justification' });
  return { motif: e.motif, justification: j };
}

/** Inscrit la réaffectation exceptionnelle (même transaction que l'attribution) et la journalise. */
async function tracer(c, u, { etablissementId, ressourceType, ressourceId, objet, objetId, exception, ecart = {} }) {
  await c.query(`INSERT INTO reaffectations_exceptionnelles (etablissement_id, ressource_type, ressource_id, objet, objet_id, motif, justification, ecart, autorise_par)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [etablissementId, ressourceType, ressourceId, objet, objetId, exception.motif, exception.justification, ecart, u.id]);
  await c.query(`INSERT INTO journal (etablissement_id, utilisateur_id, action, detail, ${ressourceType === 'lit' ? 'lit_id' : 'civiere_id'}) VALUES ($1, $2, 'Réaffectation exceptionnelle', $3, $4)`,
    [etablissementId, u.id, `${exception.motif} · ${exception.justification}`, ressourceId]);
}

/**
 * Catégories de civières compatibles avec une préalerte, par ordre de préférence. Une civière pédiatrique ne va jamais à un adulte ;
 * une civière d'isolement n'est jamais attribuée automatiquement (décision de l'équipe).
 */
function civieresCompatibles(categoriePrealerte) {
  return categoriePrealerte === 'pediatrique' ? ['pediatrique', 'reguliere', 'debordement'] : ['reguliere', 'debordement'];
}

module.exports = { MOTIFS, ROLES, lireException, tracer, civieresCompatibles };
