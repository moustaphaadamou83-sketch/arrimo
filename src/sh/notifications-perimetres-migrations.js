'use strict';
const {PERMISSIONS}=require('./permissions');
const NOTIFICATIONS_PERIMETRES_VERSION=19;
const ROUTES={crm:'GET /crm/opportunites',relance:'GET /crm/activites',devis:'GET /crm/devis/:id/pdf',projet:'GET /projets/:id',tache:'GET /taches',rappel:'GET /taches',formation:'GET /hopitaux/:id/formation/sessions',support:'GET /support/tickets',hebergement:'GET /hebergement',facturation:'GET /facturation/factures'};
async function migrerNotificationsPerimetres(c){
  if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[NOTIFICATIONS_PERIMETRES_VERSION])).rowCount)return false;
  const owner=(await c.query('SELECT current_user owner')).rows[0].owner,role=owner+'_scope';
  if(!/^[a-z][a-z0-9_]{0,50}$/.test(role))throw new Error('Rôle restreint invalide');
  await c.query(`ALTER TABLE sh_notifications ADD COLUMN ressource_type text,ADD COLUMN ressource_id bigint,
    ADD CONSTRAINT sh_notifications_ressource_check CHECK(
      (ressource_type IS NULL AND ressource_id IS NULL) OR(ressource_type='global' AND ressource_id IS NULL)
      OR(ressource_type IN('client','opportunite','activite','devis','projet','tache','hopital','ticket') AND ressource_id IS NOT NULL AND ressource_id>0));
    CREATE TABLE sh_notifications_genres(genre text PRIMARY KEY,permission text NOT NULL,roles text[] NOT NULL);
    ALTER TABLE sh_notifications_genres ENABLE ROW LEVEL SECURITY;`);
  for(const [genre,permission]of Object.entries(ROUTES))await c.query('INSERT INTO sh_notifications_genres(genre,permission,roles) VALUES($1,$2,$3)',[genre,permission,PERMISSIONS[permission]]);
  await c.query(`CREATE FUNCTION sh_notification_role_pour(personne int,genre_cible text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      SELECT EXISTS(SELECT 1 FROM public.sh_utilisateurs u LEFT JOIN public.sh_roles_personnalises r ON r.id=u.role_personnalise_id
        JOIN public.sh_notifications_genres g ON g.genre=genre_cible WHERE u.id=personne AND u.actif AND u.archive_le IS NULL
          AND ((u.role='administration' AND u.role_personnalise_id IS NULL)
            OR(u.role=ANY(g.roles) AND(u.role_personnalise_id IS NULL OR(r.actif AND g.permission=ANY(r.permissions)))))) $$;
    CREATE FUNCTION sh_notification_portee_pour(personne int,nature text,cible bigint) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
    DECLARE h int; p bigint; o bigint;
    BEGIN
      IF nature='global' THEN RETURN EXISTS(SELECT 1 FROM public.sh_affectations WHERE utilisateur_id=personne AND type='global'); END IF;
      IF cible IS NULL THEN RETURN false; END IF;
      IF nature='opportunite' THEN
        SELECT organisation_id INTO o FROM public.sh_opportunites WHERE id=cible;
        RETURN public.sh_notification_portee_pour(personne,'client',o);
      ELSIF nature='activite' THEN
        RETURN EXISTS(SELECT 1 FROM public.sh_activites a WHERE a.id=cible AND (
          public.sh_notification_portee_pour(personne,'global',NULL)
          OR public.sh_notification_portee_pour(personne,'client_operationnel',a.organisation_id)
          OR public.sh_notification_portee_pour(personne,'hopital',a.hopital_id)
          OR public.sh_notification_portee_pour(personne,'opportunite',a.opportunite_id)));
      ELSIF nature='devis' THEN
        SELECT x.organisation_id INTO o FROM public.sh_devis d JOIN public.sh_opportunites x ON x.id=d.opportunite_id WHERE d.id=cible;
        RETURN public.sh_notification_portee_pour(personne,'client',o);
      ELSIF nature='tache' THEN
        SELECT projet_id INTO p FROM public.sh_taches WHERE id=cible;
        RETURN public.sh_notification_portee_pour(personne,'projet',p);
      ELSIF nature='ticket' THEN
        SELECT hopital_id INTO h FROM public.sh_support_tickets WHERE id=cible;
        RETURN public.sh_notification_portee_pour(personne,'hopital',h);
      ELSIF nature='client_operationnel' THEN
        RETURN public.sh_notification_portee_pour(personne,'client',cible) OR EXISTS(
          SELECT 1 FROM public.sh_projets x WHERE x.organisation_id=cible AND (x.responsable_id=personne
            OR EXISTS(SELECT 1 FROM public.sh_projet_membres WHERE projet_id=x.id AND utilisateur_id=personne)
            OR EXISTS(SELECT 1 FROM public.sh_affectations WHERE utilisateur_id=personne AND type='projet' AND projet_id=x.id)));
      ELSIF nature='client' THEN
        RETURN EXISTS(SELECT 1 FROM public.sh_crm_organisations x WHERE x.id=cible AND EXISTS(
          SELECT 1 FROM public.sh_affectations a WHERE a.utilisateur_id=personne AND
            (a.type='global' OR(a.type='pays' AND a.pays_code=x.pays_code) OR(a.type='client' AND a.organisation_id=x.id))));
      ELSIF nature='projet' THEN
        RETURN EXISTS(SELECT 1 FROM public.sh_projets x LEFT JOIN public.hopitaux y ON y.id=x.hopital_id WHERE x.id=cible AND
          (x.responsable_id=personne OR EXISTS(SELECT 1 FROM public.sh_projet_membres WHERE projet_id=x.id AND utilisateur_id=personne)
            OR EXISTS(SELECT 1 FROM public.sh_affectations a WHERE a.utilisateur_id=personne AND
              (a.type='global' OR(a.type='projet' AND a.projet_id=x.id) OR(a.type='pays' AND a.pays_code=y.pays_code)
                OR(a.type='client' AND a.organisation_id=y.organisation_id) OR(a.type='hopital' AND a.hopital_id=y.id)))));
      ELSIF nature='hopital' THEN
        RETURN EXISTS(SELECT 1 FROM public.hopitaux x WHERE x.id=cible AND(
          EXISTS(SELECT 1 FROM public.sh_affectations a WHERE a.utilisateur_id=personne AND
            (a.type='global' OR(a.type='pays' AND a.pays_code=x.pays_code) OR(a.type='client' AND a.organisation_id=x.organisation_id) OR(a.type='hopital' AND a.hopital_id=x.id)))
          OR EXISTS(SELECT 1 FROM public.sh_projets p WHERE p.hopital_id=x.id AND(p.responsable_id=personne
            OR EXISTS(SELECT 1 FROM public.sh_projet_membres WHERE projet_id=p.id AND utilisateur_id=personne)
            OR EXISTS(SELECT 1 FROM public.sh_affectations WHERE utilisateur_id=personne AND type='projet' AND projet_id=p.id)))));
      END IF;
      RETURN false;
    END $$;
    CREATE FUNCTION sh_notification_eligible(personne int,genre_cible text,nature text,cible bigint,client_cible bigint) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
    DECLARE u public.sh_utilisateurs%ROWTYPE;
    BEGIN
      SELECT * INTO u FROM public.sh_utilisateurs WHERE id=personne AND actif AND archive_le IS NULL;
      IF NOT FOUND THEN RETURN false; END IF;
      IF u.role_personnalise_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sh_roles_personnalises WHERE id=u.role_personnalise_id AND actif) THEN RETURN false; END IF;
      IF u.role='administration' AND u.role_personnalise_id IS NULL THEN RETURN true; END IF;
      IF NOT public.sh_notification_role_pour(personne,genre_cible) THEN RETURN false; END IF;
      IF genre_cible='facturation' THEN RETURN public.sh_notification_portee_pour(personne,'client',client_cible); END IF;
      IF genre_cible='hebergement' THEN RETURN public.sh_notification_portee_pour(personne,'global',NULL); END IF;
      IF (genre_cible='crm' AND nature NOT IN('opportunite','client')) OR(genre_cible='relance' AND nature NOT IN('activite','client'))
        OR(genre_cible='devis' AND nature<>'devis') OR(genre_cible='projet' AND nature<>'projet')
        OR(genre_cible IN('tache','rappel') AND nature NOT IN('tache','projet'))
        OR(genre_cible='formation' AND nature<>'hopital') OR(genre_cible='support' AND nature NOT IN('ticket','hopital')) THEN RETURN false; END IF;
      IF genre_cible='relance' AND nature='client' THEN RETURN COALESCE(public.sh_notification_portee_pour(personne,'client_operationnel',cible),false); END IF;
      RETURN COALESCE(public.sh_notification_portee_pour(personne,nature,cible),false);
    END $$;
    REVOKE ALL ON FUNCTION sh_notification_role_pour(integer,text),sh_notification_portee_pour(integer,text,bigint),sh_notification_eligible(integer,text,text,bigint,bigint) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION sh_notification_role_pour(integer,text),sh_notification_eligible(integer,text,text,bigint,bigint) TO "${role}";
    DROP POLICY sh_notifications_lecture ON sh_notifications;
    DROP POLICY sh_notifications_modification ON sh_notifications;
    CREATE POLICY sh_notifications_lecture ON sh_notifications FOR SELECT USING(utilisateur_id=sh_scope_uid() AND sh_notification_eligible(utilisateur_id,type,ressource_type,ressource_id,organisation_id));
    CREATE POLICY sh_notifications_modification ON sh_notifications FOR UPDATE
      USING(utilisateur_id=sh_scope_uid() AND sh_notification_eligible(utilisateur_id,type,ressource_type,ressource_id,organisation_id))
      WITH CHECK(utilisateur_id=sh_scope_uid() AND sh_notification_eligible(utilisateur_id,type,ressource_type,ressource_id,organisation_id));
    CREATE FUNCTION sh_notifier_employe(destinataire int,genre text,libelle text,cible_lien text,identifiant text,client_cible bigint,nature text,objet bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
    BEGIN
      IF NOT (public.sh_scope_write() OR COALESCE(destinataire=public.sh_scope_uid(),false) OR current_setting('role')='none') THEN RAISE EXCEPTION 'Notification hors contexte autorisé' USING ERRCODE='42501'; END IF;
      IF current_setting('role')<>'none' AND NOT public.sh_scope_root() THEN
        IF genre='facturation' THEN
          IF NOT public.sh_scope_client(client_cible,true) THEN RETURN; END IF;
        ELSIF NOT COALESCE(public.sh_notification_portee_pour(public.sh_scope_uid(),CASE WHEN genre='hebergement' THEN 'global' WHEN genre='relance' AND nature='client' THEN 'client_operationnel' ELSE nature END,objet),false) THEN
          RAISE EXCEPTION 'Notification hors périmètre de l’émetteur' USING ERRCODE='42501';
        END IF;
      END IF;
      IF NOT public.sh_notification_eligible(destinataire,genre,nature,objet,client_cible) THEN RETURN; END IF;
      INSERT INTO public.sh_notifications(utilisateur_id,type,titre,lien,cle,organisation_id,ressource_type,ressource_id)
        VALUES(destinataire,genre,left(libelle,240),cible_lien,identifiant,client_cible,nature,objet)
        ON CONFLICT(utilisateur_id,cle) WHERE cle IS NOT NULL DO NOTHING;
    END $$;
    CREATE OR REPLACE FUNCTION sh_notifier_employe(destinataire int,genre text,libelle text,cible text,identifiant text,client_cible bigint) RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.sh_notifier_employe(destinataire,genre,libelle,cible,identifiant,client_cible,NULL,NULL) $$;
    REVOKE ALL ON FUNCTION sh_notifier_employe(integer,text,text,text,text,bigint,text,bigint) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION sh_notifier_employe(integer,text,text,text,text,bigint,text,bigint) TO "${role}";`);
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[NOTIFICATIONS_PERIMETRES_VERSION]);return true;
}
module.exports={NOTIFICATIONS_PERIMETRES_VERSION,migrerNotificationsPerimetres};
