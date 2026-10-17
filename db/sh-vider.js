/** Efface les tables de la console SH (bases de test seulement). */
async function viderBaseSh(db) {
  await db.query(`DROP TABLE IF EXISTS formation_elements, formation_roles, sh_journal, activations, imports, verifications, etapes, hopitaux, sh_connexions_2fa, sh_sessions, sh_utilisateurs CASCADE;
                  DROP FUNCTION IF EXISTS sh_journal_immuable CASCADE;`);
}
module.exports = { viderBaseSh };
