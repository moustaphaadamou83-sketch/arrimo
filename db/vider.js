/** Efface toutes les tables du module (remise à zéro de la démo et des bases de test). */
async function viderBase(db) {
  await db.query(`DROP TABLE IF EXISTS demo_etat, journal_admin, connexions_2fa, messages_connecteur, connecteurs, demandes_admission, notifications, journal, lits, transferts,
                  chambres, unites, sessions, utilisateur_etablissements, utilisateurs, etablissements, types_unite, config_pays CASCADE;
                  DROP SEQUENCE IF EXISTS transfert_seq; DROP FUNCTION IF EXISTS journal_immuable CASCADE;`);
}
module.exports = { viderBase };
