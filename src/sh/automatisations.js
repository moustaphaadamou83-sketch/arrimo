'use strict';
/**
 * Liens entre modules : notifications internes et tâches modèle qui se terminent quand l'étape
 * correspondante est réellement faite dans la console (import, modules, formation, Go Live).
 * Rien ne s'exécute dans un environnement Arrimo : ces automatismes ne touchent que la base SH.
 */

/** Notifie un ou plusieurs comptes SH ; une clé évite les doublons (même rappel, même personne). */
async function notifier(db, utilisateurs, { type, titre, lien = null, cle = null }) {
  const ids = [...new Set([].concat(utilisateurs).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  for (const id of ids) {
    await db.query(`INSERT INTO sh_notifications (utilisateur_id, type, titre, lien, cle)
      SELECT $1, $2, $3, $4, $5 WHERE EXISTS (SELECT 1 FROM sh_utilisateurs WHERE id = $1 AND actif)
      ON CONFLICT (utilisateur_id, cle) WHERE cle IS NOT NULL DO NOTHING`, [id, type, String(titre).slice(0, 240), lien, cle]);
  }
}

/** Comptes actifs ayant l'un des rôles donnés. */
async function comptesAvecRoles(db, roles) {
  return (await db.query('SELECT id FROM sh_utilisateurs WHERE actif AND role = ANY($1::text[])', [roles])).rows.map((r) => r.id);
}

/**
 * Termine la tâche modèle « code » des projets de l'établissement, si elle est encore ouverte.
 * Rend les tâches terminées (pour le journal).
 */
async function terminerTacheAuto(db, hopitalId, code, u) {
  const { rows } = await db.query(`UPDATE sh_taches t SET statut = 'terminee', terminee_le = now(), modifie_le = now()
    FROM sh_projets p WHERE p.id = t.projet_id AND p.hopital_id = $1 AND t.code_auto = $2 AND t.statut <> 'terminee'
    RETURNING t.id, t.titre, p.id AS projet_id`, [hopitalId, code]);
  for (const t of rows) {
    await db.query(`INSERT INTO sh_taches_commentaires (tache_id, utilisateur_id, commentaire) VALUES ($1, $2, $3)`,
      [t.id, u ? u.id : null, 'Terminée automatiquement : l’étape correspondante est validée dans la console.']);
  }
  return rows;
}

module.exports = { notifier, comptesAvecRoles, terminerTacheAuto };
