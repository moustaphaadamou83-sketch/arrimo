/** Efface toutes les tables du module (remise à zéro de la démo et des bases de test). */
async function viderBase(db) {
  await db.query(`DROP TABLE IF EXISTS proches_sessions, messages_proches, proches_acces, communications_proches, taches_etab, coordination_etapes, coordinations,
                  demande_hebergement_etapes, demandes_hebergement, resident_mouvements, resident_contacts, residents, connecteurs_simulation_evenements, connecteurs_simulation_flux, connecteurs_correspondances, connecteurs_simulation_config, admission_habilitations, admission_referentiels, conges, patient_passages, patients, controles, specialites_catalogue, jetons_mdp, demo_etat, journal_admin, connexions_2fa, messages_connecteur, connecteurs, demandes_admission, notifications, journal, civieres, lits, transferts,
                  chambres, etages, departements, unites, services, sessions, utilisateur_etablissements, utilisateurs, etablissements, types_unite, config_pays CASCADE;
                  DROP SEQUENCE IF EXISTS transfert_seq; DROP SEQUENCE IF EXISTS patient_seq; DROP SEQUENCE IF EXISTS resident_seq; DROP SEQUENCE IF EXISTS demande_hebergement_seq; DROP SEQUENCE IF EXISTS coordination_seq; DROP FUNCTION IF EXISTS journal_immuable CASCADE;`);
}
module.exports = { viderBase };
