'use strict';
const PERIMETRE_VERSION=10;
async function migrerPerimetre(c){
  if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[PERIMETRE_VERSION])).rowCount)return false;
  const owner=(await c.query('SELECT current_user owner')).rows[0].owner,role=owner+'_scope';
  if(!/^[a-z][a-z0-9_]{0,50}$/.test(role))throw new Error('Rôle restreint invalide');
  if(!(await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)throw new Error('Préparer le rôle PostgreSQL restreint avant la migration SH 10.');
  await c.query(`CREATE TABLE sh_roles_personnalises(id serial PRIMARY KEY,nom text NOT NULL UNIQUE,
    base_role text NOT NULL CHECK(base_role IN('commercial','implantation','formation','support','finance')),
    permissions text[] NOT NULL DEFAULT '{}',actif boolean NOT NULL DEFAULT true,cree_le timestamptz NOT NULL DEFAULT now())`);
  await c.query('ALTER TABLE sh_utilisateurs ADD COLUMN role_personnalise_id int REFERENCES sh_roles_personnalises(id)');
  await c.query(`CREATE TABLE sh_affectations(id bigserial PRIMARY KEY,utilisateur_id int NOT NULL REFERENCES sh_utilisateurs(id),
    type text NOT NULL CHECK(type IN('global','pays','client','hopital','projet')),pays_code char(2),organisation_id bigint REFERENCES sh_crm_organisations(id),
    hopital_id int REFERENCES hopitaux(id),projet_id bigint REFERENCES sh_projets(id),cree_par int REFERENCES sh_utilisateurs(id),cree_le timestamptz NOT NULL DEFAULT now(),
    CHECK((type='global' AND num_nonnulls(pays_code,organisation_id,hopital_id,projet_id)=0)
      OR(type='pays' AND pays_code IS NOT NULL AND num_nonnulls(organisation_id,hopital_id,projet_id)=0)
      OR(type='client' AND organisation_id IS NOT NULL AND num_nonnulls(pays_code,hopital_id,projet_id)=0)
      OR(type='hopital' AND hopital_id IS NOT NULL AND num_nonnulls(pays_code,organisation_id,projet_id)=0)
      OR(type='projet' AND projet_id IS NOT NULL AND num_nonnulls(pays_code,organisation_id,hopital_id)=0)))`);
  await c.query('CREATE INDEX sh_affectations_utilisateur_idx ON sh_affectations(utilisateur_id,type)');
  await c.query('ALTER TABLE hopitaux ADD COLUMN organisation_id bigint REFERENCES sh_crm_organisations(id)');
  await c.query('UPDATE hopitaux h SET organisation_id=o.id FROM sh_crm_organisations o WHERE o.hopital_id=h.id');
  const fonctions=`
    CREATE FUNCTION sh_scope_uid() RETURNS int LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.sh_uid',true),'')::int $$;
    CREATE FUNCTION sh_scope_root() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.sh_root',true)='1',false) $$;
    CREATE FUNCTION sh_scope_write() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.sh_write',true)='1',false) $$;
    CREATE FUNCTION sh_scope_global() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      SELECT public.sh_scope_root() OR EXISTS(SELECT 1 FROM public.sh_affectations WHERE utilisateur_id=public.sh_scope_uid() AND type='global') $$;
    CREATE FUNCTION sh_scope_pays(p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      SELECT public.sh_scope_global() OR EXISTS(SELECT 1 FROM public.sh_affectations WHERE utilisateur_id=public.sh_scope_uid() AND type='pays' AND pays_code=p) $$;
    CREATE FUNCTION sh_scope_client(o bigint,financier boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      SELECT public.sh_scope_global() OR EXISTS(SELECT 1 FROM public.sh_crm_organisations org WHERE org.id=o AND public.sh_scope_pays(org.pays_code))
      OR EXISTS(SELECT 1 FROM public.sh_affectations a WHERE a.utilisateur_id=public.sh_scope_uid() AND a.type='client' AND a.organisation_id=o)
      OR (NOT financier AND EXISTS(SELECT 1 FROM public.sh_projets p WHERE p.organisation_id=o AND
        (p.responsable_id=public.sh_scope_uid() OR EXISTS(SELECT 1 FROM public.sh_projet_membres m WHERE m.projet_id=p.id AND m.utilisateur_id=public.sh_scope_uid())
        OR EXISTS(SELECT 1 FROM public.sh_affectations a WHERE a.utilisateur_id=public.sh_scope_uid() AND a.projet_id=p.id)))) $$;
    CREATE FUNCTION sh_scope_hopital(h int) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      SELECT public.sh_scope_global() OR EXISTS(SELECT 1 FROM public.hopitaux x WHERE x.id=h AND
        (public.sh_scope_pays(x.pays_code) OR EXISTS(SELECT 1 FROM public.sh_affectations a WHERE a.utilisateur_id=public.sh_scope_uid() AND
          (a.hopital_id=x.id OR(a.type='client' AND a.organisation_id=x.organisation_id)))))
      OR EXISTS(SELECT 1 FROM public.sh_projets p WHERE p.hopital_id=h AND
        (p.responsable_id=public.sh_scope_uid() OR EXISTS(SELECT 1 FROM public.sh_projet_membres m WHERE m.projet_id=p.id AND m.utilisateur_id=public.sh_scope_uid())
        OR EXISTS(SELECT 1 FROM public.sh_affectations a WHERE a.utilisateur_id=public.sh_scope_uid() AND a.projet_id=p.id))) $$;
    CREATE FUNCTION sh_scope_projet(p bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      SELECT public.sh_scope_global() OR EXISTS(SELECT 1 FROM public.sh_projets x WHERE x.id=p AND
        (x.responsable_id=public.sh_scope_uid() OR EXISTS(SELECT 1 FROM public.sh_projet_membres m WHERE m.projet_id=x.id AND m.utilisateur_id=public.sh_scope_uid())
          OR EXISTS(SELECT 1 FROM public.sh_affectations a WHERE a.utilisateur_id=public.sh_scope_uid() AND a.projet_id=x.id)
          OR EXISTS(SELECT 1 FROM public.hopitaux h WHERE h.id=x.hopital_id AND (public.sh_scope_pays(h.pays_code)
            OR EXISTS(SELECT 1 FROM public.sh_affectations a WHERE a.utilisateur_id=public.sh_scope_uid() AND(a.hopital_id=h.id OR(a.type='client' AND a.organisation_id=h.organisation_id))))))) $$;
    CREATE FUNCTION sh_scope_hopital_direct(h int) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      SELECT public.sh_scope_global() OR EXISTS(SELECT 1 FROM public.hopitaux x WHERE x.id=h AND
        (public.sh_scope_pays(x.pays_code) OR EXISTS(SELECT 1 FROM public.sh_affectations a WHERE a.utilisateur_id=public.sh_scope_uid()
          AND(a.hopital_id=x.id OR(a.type='client' AND a.organisation_id=x.organisation_id))))) $$;
    CREATE FUNCTION sh_scope_opportunite(o bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      SELECT EXISTS(SELECT 1 FROM public.sh_opportunites WHERE id=o AND public.sh_scope_client(organisation_id,true)) $$;
    CREATE FUNCTION sh_scope_contrat(o bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      SELECT EXISTS(SELECT 1 FROM public.sh_contrats WHERE id=o AND public.sh_scope_opportunite(opportunite_id)) $$;
    CREATE FUNCTION sh_scope_facture(f bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      SELECT EXISTS(SELECT 1 FROM public.sh_factures WHERE id=f AND public.sh_scope_client(organisation_id,true)) $$;
    CREATE FUNCTION sh_scope_ticket(t bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      SELECT EXISTS(SELECT 1 FROM public.sh_support_tickets WHERE id=t AND public.sh_scope_hopital(hopital_id)) $$;
    CREATE FUNCTION sh_scope_tache(t bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      SELECT EXISTS(SELECT 1 FROM public.sh_taches WHERE id=t AND public.sh_scope_projet(projet_id)) $$;
    CREATE FUNCTION sh_scope_document(h int,o bigint,c bigint,p bigint,t bigint,categorie text,conf boolean) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
    BEGIN
      IF public.sh_scope_root() THEN RETURN true; END IF;
      IF conf OR (categorie IN('contrat','devis') AND current_setting('app.sh_role',true) NOT IN('commercial','finance'))
        OR(categorie='facture' AND current_setting('app.sh_role',true)<>'finance') THEN RETURN false; END IF;
      IF (categorie='technique' AND current_setting('app.sh_role',true) NOT IN('implantation','support'))
        OR(categorie='formation' AND current_setting('app.sh_role',true) NOT IN('implantation','formation'))
        OR(categorie='support' AND current_setting('app.sh_role',true) NOT IN('implantation','support')) THEN RETURN false; END IF;
      IF num_nonnulls(h,o,c,p,t)=0 THEN RETURN public.sh_scope_global(); END IF;
      IF h IS NOT NULL AND NOT public.sh_scope_hopital(h) THEN RETURN false; END IF;
      IF o IS NOT NULL AND NOT public.sh_scope_client(o,categorie IN('contrat','devis','facture')) THEN RETURN false; END IF;
      IF c IS NOT NULL AND NOT public.sh_scope_contrat(c) THEN RETURN false; END IF;
      IF p IS NOT NULL AND NOT public.sh_scope_projet(p) THEN RETURN false; END IF;
      IF t IS NOT NULL AND NOT public.sh_scope_ticket(t) THEN RETURN false; END IF;
      IF h IS NOT NULL AND p IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sh_projets WHERE id=p AND hopital_id=h) THEN RETURN false; END IF;
      IF o IS NOT NULL AND p IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sh_projets WHERE id=p AND organisation_id=o) THEN RETURN false; END IF;
      RETURN true;
    END $$;
  `;
  await c.query(fonctions);
  const policies={
    hopitaux:'sh_scope_hopital(id) OR sh_scope_pays(pays_code) OR(organisation_id IS NOT NULL AND sh_scope_client(organisation_id,true))',sh_sites:'sh_scope_hopital(hopital_id)',sh_contacts:'sh_scope_hopital(hopital_id)',
    sh_hopital_modules:'sh_scope_hopital(hopital_id)',etapes:'sh_scope_hopital(hopital_id)',
    verifications:'EXISTS(SELECT 1 FROM etapes e WHERE e.id=etape_id)',imports:'sh_scope_hopital(hopital_id)',activations:'sh_scope_hopital(hopital_id)',
    formation_roles:'sh_scope_hopital(hopital_id)',formation_elements:'sh_scope_hopital(hopital_id)',sh_golive_operations:'sh_scope_hopital(hopital_id)',
    sh_crm_organisations:'sh_scope_client(id)',sh_crm_contacts:'sh_scope_client(organisation_id)',
    sh_opportunites:'sh_scope_client(organisation_id,true)',sh_devis:'sh_scope_opportunite(opportunite_id)',sh_contrats:'sh_scope_opportunite(opportunite_id)',
    sh_activites:'sh_scope_global() OR (organisation_id IS NOT NULL AND sh_scope_client(organisation_id)) OR (hopital_id IS NOT NULL AND sh_scope_hopital(hopital_id)) OR (opportunite_id IS NOT NULL AND sh_scope_opportunite(opportunite_id))',
    sh_projets:'sh_scope_projet(id) OR responsable_id=sh_scope_uid() OR(hopital_id IS NOT NULL AND sh_scope_hopital_direct(hopital_id))',sh_projet_membres:'sh_scope_projet(projet_id)',sh_taches:'sh_scope_projet(projet_id)',sh_jalons:'sh_scope_projet(projet_id)',
    sh_taches_dependances:'sh_scope_tache(tache_id) AND sh_scope_tache(depend_de)',sh_taches_commentaires:'sh_scope_tache(tache_id)',
    sh_abonnements:'sh_scope_client(organisation_id,true)',sh_factures:'sh_scope_client(organisation_id,true)',sh_paiements:'sh_scope_facture(facture_id)',
    sh_contrats_renouvellements:'sh_scope_contrat(contrat_id)',sh_support_tickets:'sh_scope_hopital(hopital_id)',
    sh_support_messages:'sh_scope_ticket(ticket_id)',sh_support_evenements:'sh_scope_ticket(ticket_id)',
    sh_documents:'sh_scope_document(hopital_id,organisation_id,contrat_id,projet_id,ticket_id,categorie,confidentiel)',
    sh_formation_sessions:'sh_scope_hopital(hopital_id)',sh_formation_participants:'EXISTS(SELECT 1 FROM sh_formation_sessions s WHERE s.id=session_id)',
    sh_affectations:'sh_scope_root() OR utilisateur_id=sh_scope_uid()',
    sh_roles_personnalises:'sh_scope_root() OR id=(SELECT role_personnalise_id FROM sh_utilisateurs WHERE id=sh_scope_uid())',
    sh_journal:'sh_scope_global() OR utilisateur_id=sh_scope_uid() OR(hopital_id IS NOT NULL AND sh_scope_hopital(hopital_id))',
    sh_sessions:'sh_scope_root() OR utilisateur_id=sh_scope_uid()',sh_connexions_2fa:'sh_scope_root() OR utilisateur_id=sh_scope_uid()',
    sh_recuperations:'sh_scope_root() OR utilisateur_id=sh_scope_uid()'
  };
  const checks={
    hopitaux:'sh_scope_global() OR sh_scope_pays(pays_code) OR(organisation_id IS NOT NULL AND sh_scope_client(organisation_id,true))',
    sh_crm_organisations:'sh_scope_global() OR sh_scope_pays(pays_code)',
    sh_projets:'sh_scope_projet(id) OR sh_scope_global() OR(hopital_id IS NOT NULL AND sh_scope_hopital_direct(hopital_id)) OR(organisation_id IS NOT NULL AND sh_scope_client(organisation_id,true))'
  };
  for(const [table,condition]of Object.entries(policies)){
    await c.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    if(['sh_affectations','sh_roles_personnalises'].includes(table)){
      await c.query(`CREATE POLICY sh_perimetre_lecture ON ${table} FOR SELECT USING(${condition})`);
      await c.query(`CREATE POLICY sh_perimetre_insert ON ${table} FOR INSERT WITH CHECK(sh_scope_root())`);
      await c.query(`CREATE POLICY sh_perimetre_update ON ${table} FOR UPDATE USING(sh_scope_root()) WITH CHECK(sh_scope_root())`);
      await c.query(`CREATE POLICY sh_perimetre_delete ON ${table} FOR DELETE USING(sh_scope_root())`);
    }else if(!['sh_journal','sh_sessions','sh_connexions_2fa','sh_recuperations'].includes(table)){
      await c.query(`CREATE POLICY sh_perimetre_lecture ON ${table} FOR SELECT USING(${condition})`);
      await c.query(`CREATE POLICY sh_perimetre_insert ON ${table} FOR INSERT WITH CHECK(sh_scope_write() AND (${checks[table]||condition}))`);
      await c.query(`CREATE POLICY sh_perimetre_update ON ${table} FOR UPDATE USING(sh_scope_write() AND (${condition})) WITH CHECK(sh_scope_write() AND (${checks[table]||condition}))`);
      await c.query(`CREATE POLICY sh_perimetre_delete ON ${table} FOR DELETE USING(sh_scope_write() AND (${condition}))`);
    }else await c.query(`CREATE POLICY sh_perimetre ON ${table} USING(${condition}) WITH CHECK(${checks[table]||condition})`);
  }
  await c.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  await c.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`);
  await c.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`);
  await c.query(`REVOKE UPDATE,DELETE ON sh_journal FROM "${role}"`);
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[PERIMETRE_VERSION]);return true;
}
module.exports={PERIMETRE_VERSION,migrerPerimetre};
