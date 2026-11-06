/** Efface les tables de la console SH (bases de test seulement). */
async function viderBaseSh(db) {
  const base=(await db.query('SELECT current_database() AS base')).rows[0]?.base;
  if(typeof base!=='string'||!/^arrimo_(?:[a-z0-9_]*_)?test(?:_[a-z0-9_]+)?$/.test(base))throw new Error('Nettoyage SH refusé : une base de test explicitement nommée est obligatoire.');
  await db.query(`DROP TABLE IF EXISTS sh_support_courriels,sh_support_escalades,sh_support_sla,sh_notifications_genres,sh_affectations,sh_roles_personnalises,sh_projet_membres, sh_recuperations, sh_supervision, sh_formation_participants, sh_formation_sessions, sh_notifications, sh_equipes_membres, sh_equipes,
                    sh_support_evenements, sh_support_messages, sh_paiements, sh_factures, sh_abonnements, sh_compteurs, sh_contrats_renouvellements,
                    sh_taxes, sh_tarifs, sh_profils_fiscaux, sh_demandes_site, sh_types_locaux, sh_taux_change, sh_parametres, sh_projet_finances, sh_taches_checklist, sh_taches_temps, sh_projet_registre, sh_competences, sh_filtres, sh_deploiement_etapes, sh_taches_collaborateurs CASCADE;
                  DROP FUNCTION IF EXISTS sh_tache_archive_garde() CASCADE;
                  DROP FUNCTION IF EXISTS sh_taux_change_immuable() CASCADE;
                  DROP TABLE IF EXISTS sh_hopital_modules, sh_contacts, sh_sites, sh_modules_catalogue CASCADE;
                  DROP TABLE IF EXISTS sh_audit_metier, sh_documents, sh_support_tickets, sh_jalons, sh_taches_dependances,
                    sh_taches_commentaires, sh_taches, sh_projets, sh_contrats, sh_devis, sh_activites, sh_opportunites,
                    sh_crm_contacts, sh_crm_organisations CASCADE;
                  DROP TABLE IF EXISTS sh_golive_operations, sh_invitations, sh_migrations, formation_elements, formation_roles, sh_journal, activations, imports, verifications, etapes, hopitaux, sh_connexions_2fa, sh_sessions, sh_utilisateurs CASCADE;
                  DROP FUNCTION IF EXISTS sh_journal_immuable CASCADE;
                  DROP FUNCTION IF EXISTS sh_projet_archive_garde();
                  DROP FUNCTION IF EXISTS sh_ticket_reference();
                  DROP FUNCTION IF EXISTS sh_ticket_sla(),sh_sla_version_immuable(),sh_sla_regles_valides(jsonb);
                  DROP FUNCTION IF EXISTS sh_support_destinataires(integer);
                  DROP FUNCTION IF EXISTS sh_notification_financiere_visible(bigint),sh_facturation_destinataires(bigint);
                  DROP FUNCTION IF EXISTS sh_notifier_employe(integer,text,text,text,text,bigint);
                  DROP FUNCTION IF EXISTS sh_notifier_employe(integer,text,text,text,text,bigint,text,bigint);
                  DROP FUNCTION IF EXISTS sh_notification_eligible(integer,text,text,bigint,bigint),sh_notification_role_pour(integer,text),sh_notification_portee_pour(integer,text,bigint);
                  DROP FUNCTION IF EXISTS public.sh_scope_document(integer,bigint,bigint,bigint,bigint,text,boolean),
                    public.sh_scope_tache(bigint),public.sh_scope_ticket(bigint),public.sh_scope_facture(bigint),
                    public.sh_scope_contrat(bigint),public.sh_scope_opportunite(bigint),public.sh_scope_hopital_direct(integer),
                    public.sh_scope_projet(bigint),public.sh_scope_hopital(integer),public.sh_scope_client(bigint,boolean),
                    public.sh_scope_pays(text),public.sh_scope_global(),public.sh_scope_write(),public.sh_scope_root(),public.sh_scope_uid();`);
}
module.exports = { viderBaseSh };
