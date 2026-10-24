/** Efface les tables de la console SH (bases de test seulement). */
async function viderBaseSh(db) {
  await db.query(`DROP TABLE IF EXISTS sh_hopital_modules, sh_contacts, sh_sites, sh_modules_catalogue CASCADE;
                  DROP TABLE IF EXISTS sh_audit_metier, sh_documents, sh_support_tickets, sh_jalons, sh_taches_dependances,
                    sh_taches_commentaires, sh_taches, sh_projets, sh_contrats, sh_devis, sh_activites, sh_opportunites,
                    sh_crm_contacts, sh_crm_organisations CASCADE;
                  DROP TABLE IF EXISTS sh_golive_operations, sh_invitations, sh_migrations, formation_elements, formation_roles, sh_journal, activations, imports, verifications, etapes, hopitaux, sh_connexions_2fa, sh_sessions, sh_utilisateurs CASCADE;
                  DROP FUNCTION IF EXISTS sh_journal_immuable CASCADE;`);
}
module.exports = { viderBaseSh };
