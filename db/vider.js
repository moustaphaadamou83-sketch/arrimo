/** Efface toutes les tables du module (remise à zéro de la démo et des bases de test). */
async function viderBase(db) {
  await db.query(`DROP TABLE IF EXISTS connecteurs_simulation_evenements, connecteurs_simulation_flux, connecteurs_correspondances, connecteurs_simulation_config, admission_habilitations, admission_referentiels, conges, patient_passages, patients, controles, specialites_catalogue, jetons_mdp, demo_etat, journal_admin, connexions_2fa, messages_connecteur, connecteurs, demandes_admission, notifications, journal, civieres, lits, transferts,
                  chambres, etages, departements, unites, services, sessions, utilisateur_etablissements, utilisateurs, etablissements, types_unite, config_pays CASCADE;
                  DROP SEQUENCE IF EXISTS transfert_seq; DROP SEQUENCE IF EXISTS patient_seq; DROP FUNCTION IF EXISTS journal_immuable CASCADE;`);
}
module.exports = { viderBase };
