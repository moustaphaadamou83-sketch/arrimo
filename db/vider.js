const fs = require('fs'); const path = require('path');
/** Toutes les tables du module, lues dans db/schema.sql : une table ajoutée au schéma est effacée elle aussi (incident du 9 nov. 2026). */
const TABLES_SCHEMA = [...fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8').matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_0-9]+)/g)].map((m) => m[1]);
/** Efface toutes les tables du module (remise à zéro de la démo et des bases de test). */
async function viderBase(db) {
  await db.query(`DROP TABLE IF EXISTS ${[...new Set(TABLES_SCHEMA)].join(', ')} CASCADE`);
  await db.query(`DROP TABLE IF EXISTS proches_sessions, messages_proches, proches_acces, communications_proches, taches_etab, coordination_etapes, coordinations,
                  demande_hebergement_etapes, demandes_hebergement, resident_mouvements, resident_contacts, residents, connecteurs_simulation_evenements, connecteurs_simulation_flux, connecteurs_correspondances, connecteurs_simulation_config, admission_habilitations, admission_referentiels, conges, patient_passages, patients, controles, specialites_catalogue, jetons_mdp, demo_etat, journal_admin, connexions_2fa, messages_connecteur, connecteurs, demandes_admission, notifications, journal, civieres, lits, transferts,
                  chambres, etages, departements, unites, services, sessions, utilisateur_etablissements, utilisateurs, etablissements, types_unite, config_pays CASCADE;
                  DROP SEQUENCE IF EXISTS transfert_seq; DROP SEQUENCE IF EXISTS patient_seq; DROP SEQUENCE IF EXISTS resident_seq; DROP SEQUENCE IF EXISTS demande_hebergement_seq; DROP SEQUENCE IF EXISTS coordination_seq; DROP SEQUENCE IF EXISTS prealerte_seq; DROP FUNCTION IF EXISTS journal_immuable CASCADE;`);
}
module.exports = { viderBase, TABLES_SCHEMA };
