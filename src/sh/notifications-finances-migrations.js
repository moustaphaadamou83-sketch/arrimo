'use strict';
const NOTIFICATIONS_FINANCES_VERSION=17;
async function migrerNotificationsFinances(c){
  if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[NOTIFICATIONS_FINANCES_VERSION])).rowCount)return false;
  const owner=(await c.query('SELECT current_user owner')).rows[0].owner,role=owner+'_scope';
  if(!/^[a-z][a-z0-9_]{0,50}$/.test(role))throw new Error('Rôle restreint invalide');
  await c.query(`ALTER TABLE sh_notifications ADD COLUMN organisation_id bigint;
    CREATE FUNCTION sh_notification_financiere_visible(client_cible bigint) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      SELECT public.sh_scope_root() OR (client_cible IS NOT NULL AND current_setting('app.sh_role',true)='finance'
        AND public.sh_scope_client(client_cible,true)
        AND (NULLIF(current_setting('app.sh_role_personnalise',true),'') IS NULL
          OR EXISTS(SELECT 1 FROM public.sh_roles_personnalises r WHERE r.id=NULLIF(current_setting('app.sh_role_personnalise',true),'')::int
            AND r.actif AND 'GET /facturation/factures'=ANY(r.permissions)))) $$;
    CREATE FUNCTION sh_facturation_destinataires(client_cible bigint) RETURNS TABLE(utilisateur_id int)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      SELECT DISTINCT u.id FROM public.sh_utilisateurs u
        LEFT JOIN public.sh_roles_personnalises r ON r.id=u.role_personnalise_id
        JOIN public.sh_crm_organisations o ON o.id=client_cible
      WHERE public.sh_scope_client(client_cible,true) AND u.actif AND u.archive_le IS NULL
        AND ((u.role='administration' AND u.role_personnalise_id IS NULL)
          OR (u.role='finance' AND (u.role_personnalise_id IS NULL OR(r.actif AND 'GET /facturation/factures'=ANY(r.permissions)))
            AND EXISTS(SELECT 1 FROM public.sh_affectations a WHERE a.utilisateur_id=u.id
              AND (a.type='global' OR(a.type='pays' AND a.pays_code=o.pays_code) OR(a.type='client' AND a.organisation_id=o.id))))) $$;
    REVOKE ALL ON FUNCTION sh_notification_financiere_visible(bigint),sh_facturation_destinataires(bigint) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION sh_notification_financiere_visible(bigint),sh_facturation_destinataires(bigint) TO "${role}";
    ALTER TABLE sh_notifications ENABLE ROW LEVEL SECURITY;
    CREATE POLICY sh_notifications_lecture ON sh_notifications FOR SELECT
      USING(utilisateur_id=sh_scope_uid() AND(type<>'facturation' OR sh_notification_financiere_visible(organisation_id)));
    CREATE POLICY sh_notifications_insertion ON sh_notifications FOR INSERT
      WITH CHECK(sh_scope_write() OR utilisateur_id=sh_scope_uid());
    CREATE POLICY sh_notifications_modification ON sh_notifications FOR UPDATE
      USING(utilisateur_id=sh_scope_uid() AND(type<>'facturation' OR sh_notification_financiere_visible(organisation_id)))
      WITH CHECK(utilisateur_id=sh_scope_uid());
    CREATE POLICY sh_notifications_suppression ON sh_notifications FOR DELETE USING(utilisateur_id=sh_scope_uid());
    CREATE FUNCTION sh_notifier_employe(destinataire int,genre text,libelle text,cible text,identifiant text,client_cible bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
    BEGIN
      IF NOT (public.sh_scope_write() OR COALESCE(destinataire=public.sh_scope_uid(),false) OR current_setting('role')='none') THEN
        RAISE EXCEPTION 'Notification hors contexte autorisé' USING ERRCODE='42501';
      END IF;
      IF genre='facturation' AND current_setting('role')<>'none' AND NOT EXISTS(
        SELECT 1 FROM public.sh_facturation_destinataires(client_cible) WHERE utilisateur_id=destinataire) THEN RETURN; END IF;
      INSERT INTO public.sh_notifications(utilisateur_id,type,titre,lien,cle,organisation_id)
        SELECT destinataire,genre,left(libelle,240),cible,identifiant,client_cible
        WHERE EXISTS(SELECT 1 FROM public.sh_utilisateurs WHERE id=destinataire AND actif AND archive_le IS NULL)
        ON CONFLICT(utilisateur_id,cle) WHERE cle IS NOT NULL DO NOTHING;
    END $$;
    REVOKE ALL ON FUNCTION sh_notifier_employe(integer,text,text,text,text,bigint) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION sh_notifier_employe(integer,text,text,text,text,bigint) TO "${role}";`);
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[NOTIFICATIONS_FINANCES_VERSION]);return true;
}
module.exports={NOTIFICATIONS_FINANCES_VERSION,migrerNotificationsFinances};
