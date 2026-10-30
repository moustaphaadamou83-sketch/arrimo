'use strict';
const SUPPORT_DROITS_VERSION=16;
async function migrerSupportDroits(c){
  if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[SUPPORT_DROITS_VERSION])).rowCount)return false;
  const owner=(await c.query('SELECT current_user owner')).rows[0].owner,role=owner+'_scope';
  if(!/^[a-z][a-z0-9_]{0,50}$/.test(role))throw new Error('Rôle restreint invalide');
  await c.query(`CREATE FUNCTION sh_support_destinataires(hopital_cible int) RETURNS TABLE(utilisateur_id int)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
    SELECT DISTINCT u.id FROM public.sh_utilisateurs u
    LEFT JOIN public.sh_roles_personnalises r ON r.id=u.role_personnalise_id JOIN public.hopitaux h ON h.id=hopital_cible
    WHERE (public.sh_scope_root() OR public.sh_scope_hopital(h.id))
      AND u.actif AND u.archive_le IS NULL AND u.role IN('administration','support','implantation')
      AND (u.role_personnalise_id IS NULL OR(r.actif AND 'GET /support/tickets'=ANY(r.permissions)))
      AND ((u.role='administration' AND u.role_personnalise_id IS NULL)
        OR EXISTS(SELECT 1 FROM public.sh_affectations a WHERE a.utilisateur_id=u.id AND
          (a.type='global' OR(a.type='pays' AND a.pays_code=h.pays_code) OR(a.type='client' AND a.organisation_id=h.organisation_id) OR(a.type='hopital' AND a.hopital_id=h.id)))
        OR EXISTS(SELECT 1 FROM public.sh_projets p WHERE p.hopital_id=h.id AND(p.responsable_id=u.id
          OR EXISTS(SELECT 1 FROM public.sh_projet_membres m WHERE m.projet_id=p.id AND m.utilisateur_id=u.id)
          OR EXISTS(SELECT 1 FROM public.sh_affectations a WHERE a.utilisateur_id=u.id AND a.type='projet' AND a.projet_id=p.id)))) $$;
    REVOKE ALL ON FUNCTION sh_support_destinataires(integer) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION sh_support_destinataires(integer) TO "${role}";`);
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[SUPPORT_DROITS_VERSION]);return true;
}
module.exports={SUPPORT_DROITS_VERSION,migrerSupportDroits};
