'use strict';

const concerne = (u) => u.role === 'paramedic' && !u.connecteur;

// Les expressions et le rang des paramètres sont fournis par les appelants SQL.
function condition(organisation, unite, parametre) {
  return `(NOT ${organisation}.restreindre_equipages_aux_unites OR EXISTS (
    SELECT 1 FROM utilisateur_unites_secours aua JOIN unites_secours ua ON ua.id = aua.unite_id
    WHERE aua.utilisateur_id = $${parametre} AND ua.organisation_id = ${organisation}.id AND ua.actif
      AND (${unite} IS NULL OR ua.id = ${unite})))`;
}

// L'appartenance à l'organisation est vérifiée par l'appelant, en plus de ce contrôle.
async function autorise(db, u, organisationId, uniteId) {
  if (!concerne(u)) return true;
  const { rowCount } = await db.query(`SELECT 1 FROM organisations_secours o
    WHERE o.id = $1 AND o.actif AND ${condition('o', '$2::int', 3)}`, [organisationId, uniteId ?? null, u.id]);
  return rowCount > 0;
}

module.exports = { concerne, condition, autorise };
