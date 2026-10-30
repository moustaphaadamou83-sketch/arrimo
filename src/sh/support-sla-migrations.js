'use strict';
const SUPPORT_SLA_VERSION=21;
const STANDARD={basse:{prise_en_charge_minutes:10080,resolution_minutes:null,escalade_apres_minutes:0},normale:{prise_en_charge_minutes:4320,resolution_minutes:null,escalade_apres_minutes:0},haute:{prise_en_charge_minutes:1440,resolution_minutes:null,escalade_apres_minutes:0},urgente:{prise_en_charge_minutes:240,resolution_minutes:null,escalade_apres_minutes:0}};
async function migrerSupportSla(c){
 if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[SUPPORT_SLA_VERSION])).rowCount)return false;
 const role=(await c.query('SELECT current_user owner')).rows[0].owner+'_scope';if(!/^[a-z][a-z0-9_]{0,50}$/.test(role))throw new Error('Rôle restreint invalide');
 await c.query(`CREATE TABLE sh_support_sla(id bigserial PRIMARY KEY,hopital_id int NOT NULL REFERENCES hopitaux(id),contrat_id bigint NOT NULL REFERENCES sh_contrats(id),nom text NOT NULL CHECK(length(nom) BETWEEN 1 AND 120),regles jsonb NOT NULL,actif boolean NOT NULL DEFAULT true,destinataire_id int REFERENCES sh_utilisateurs(id),cree_par int REFERENCES sh_utilisateurs(id),cree_le timestamptz NOT NULL DEFAULT now());
 CREATE UNIQUE INDEX sh_support_sla_active_unique ON sh_support_sla(hopital_id) WHERE actif;
 ALTER TABLE sh_support_tickets ADD COLUMN sla_id bigint REFERENCES sh_support_sla(id),ADD COLUMN sla_snapshot jsonb,ADD COLUMN sla_generation int NOT NULL DEFAULT 0,ADD COLUMN sla_debut_le timestamptz,ADD COLUMN prise_en_charge_le timestamptz,ADD COLUMN prise_en_charge_echeance timestamptz,ADD COLUMN resolution_echeance timestamptz;
 CREATE TABLE sh_support_escalades(id bigserial PRIMARY KEY,ticket_id bigint NOT NULL REFERENCES sh_support_tickets(id),generation int NOT NULL,phase text NOT NULL CHECK(phase IN('prise_en_charge','resolution')),destinataires int[] NOT NULL,cree_le timestamptz NOT NULL DEFAULT now(),UNIQUE(ticket_id,generation,phase));
 CREATE FUNCTION sh_sla_regles_valides(j jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
 DECLARE p text; r jsonb; k text; n numeric;
 BEGIN
  IF jsonb_typeof(j) IS DISTINCT FROM 'object' OR NOT j ?& ARRAY['basse','normale','haute','urgente'] OR (SELECT count(*) FROM jsonb_object_keys(j))<>4 THEN RETURN false; END IF;
  FOREACH p IN ARRAY ARRAY['basse','normale','haute','urgente'] LOOP
   r=j->p;IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT r ?& ARRAY['prise_en_charge_minutes','resolution_minutes','escalade_apres_minutes'] OR (SELECT count(*) FROM jsonb_object_keys(r))<>3 THEN RETURN false; END IF;
   FOREACH k IN ARRAY ARRAY['prise_en_charge_minutes','resolution_minutes','escalade_apres_minutes'] LOOP
    IF jsonb_typeof(r->k) IS DISTINCT FROM 'number' THEN RETURN false; END IF;n=(r->>k)::numeric;
    IF n<>trunc(n) OR n<(CASE WHEN k='escalade_apres_minutes' THEN 0 ELSE 1 END) OR n>(CASE WHEN k='escalade_apres_minutes' THEN 43200 ELSE 525600 END) THEN RETURN false; END IF;
   END LOOP;
   IF (r->>'resolution_minutes')::numeric<(r->>'prise_en_charge_minutes')::numeric THEN RETURN false; END IF;
  END LOOP;RETURN true;
 END $$;
 ALTER TABLE sh_support_sla ADD CONSTRAINT sh_sla_regles_check CHECK(sh_sla_regles_valides(regles));
 CREATE FUNCTION sh_sla_version_immuable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF (to_jsonb(NEW)-'actif') IS DISTINCT FROM(to_jsonb(OLD)-'actif') OR(NEW.actif AND NOT OLD.actif) THEN RAISE EXCEPTION 'Créer une nouvelle version SLA' USING ERRCODE='23514'; END IF;RETURN NEW;
 END $$;
 CREATE TRIGGER sh_sla_version_immuable BEFORE UPDATE ON sh_support_sla FOR EACH ROW EXECUTE FUNCTION sh_sla_version_immuable();
 CREATE FUNCTION sh_ticket_sla() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 DECLARE s record;r jsonb;recalcul boolean:=false;reouvert boolean:=false;
 BEGIN
  IF TG_OP='INSERT' THEN
   SELECT p.*,c.reference INTO s FROM public.sh_support_sla p JOIN public.sh_contrats c ON c.id=p.contrat_id JOIN public.sh_opportunites o ON o.id=c.opportunite_id JOIN public.hopitaux h ON h.id=p.hopital_id
    WHERE p.hopital_id=NEW.hopital_id AND p.actif AND c.statut='signe' AND(c.hopital_id=h.id OR(c.hopital_id IS NULL AND h.organisation_id=o.organisation_id)) AND(h.organisation_id IS NULL OR h.organisation_id=o.organisation_id) AND c.date_debut IS NOT NULL AND c.date_fin IS NOT NULL
    AND (NEW.cree_le AT TIME ZONE h.fuseau_horaire)::date BETWEEN c.date_debut AND c.date_fin;
   NEW.sla_id:=s.id;NEW.sla_snapshot:=CASE WHEN s.id IS NULL THEN jsonb_build_object('nature','standard','regles','${JSON.stringify(STANDARD)}'::jsonb) ELSE jsonb_build_object('nature','contractuel','nom',s.nom,'version',s.id,'regles',s.regles,'destinataire_id',s.destinataire_id) END;
   NEW.sla_debut_le:=NEW.cree_le;NEW.sla_generation:=0;NEW.prise_en_charge_le:=NULL;recalcul:=true;
  ELSE
   reouvert:=OLD.statut IN('resolu','ferme') AND NEW.statut NOT IN('resolu','ferme');
   NEW.sla_id:=OLD.sla_id;NEW.sla_snapshot:=OLD.sla_snapshot;NEW.sla_generation:=OLD.sla_generation;NEW.sla_debut_le:=OLD.sla_debut_le;
   NEW.prise_en_charge_echeance:=OLD.prise_en_charge_echeance;NEW.resolution_echeance:=OLD.resolution_echeance;
   IF NEW.priorite<>OLD.priorite OR reouvert THEN
    IF NEW.sla_snapshot IS NULL THEN NEW.sla_snapshot:=jsonb_build_object('nature','standard','regles','${JSON.stringify(STANDARD)}'::jsonb);NEW.sla_debut_le:=OLD.cree_le;END IF;
    NEW.sla_generation:=OLD.sla_generation+1;recalcul:=true;
   END IF;
   IF reouvert THEN NEW.sla_debut_le:=clock_timestamp();NEW.prise_en_charge_le:=NULL;
   ELSIF OLD.prise_en_charge_le IS NOT NULL THEN NEW.prise_en_charge_le:=OLD.prise_en_charge_le;
   ELSIF NEW.prise_en_charge_le IS NOT NULL OR NEW.statut IN('en_cours','en_attente','resolu','ferme') THEN NEW.prise_en_charge_le:=clock_timestamp();END IF;
   IF OLD.prise_en_charge_le IS NULL AND NEW.prise_en_charge_le IS NOT NULL THEN
    INSERT INTO public.sh_support_evenements(ticket_id,champ,avant,apres,par) VALUES(NEW.id,'prise_en_charge',NULL,NEW.prise_en_charge_le::text,'intervention support');
   END IF;
  END IF;
  IF recalcul THEN
   r=NEW.sla_snapshot->'regles'->NEW.priorite;
   NEW.prise_en_charge_echeance:=NEW.sla_debut_le+make_interval(mins=>(r->>'prise_en_charge_minutes')::int);
   NEW.resolution_echeance:=NEW.sla_debut_le+make_interval(mins=>(r->>'resolution_minutes')::int);
   NEW.echeance:=COALESCE(NEW.resolution_echeance,NEW.prise_en_charge_echeance);
  END IF;RETURN NEW;
 END $$;
 CREATE TRIGGER sh_ticket_sla BEFORE INSERT OR UPDATE ON sh_support_tickets FOR EACH ROW EXECUTE FUNCTION sh_ticket_sla();
 CREATE INDEX sh_ticket_sla_retard ON sh_support_tickets(prise_en_charge_echeance,resolution_echeance) WHERE statut NOT IN('resolu','ferme') AND sla_snapshot IS NOT NULL;
 ALTER TABLE sh_support_sla ENABLE ROW LEVEL SECURITY;ALTER TABLE sh_support_escalades ENABLE ROW LEVEL SECURITY;
 CREATE POLICY sh_sla_lecture ON sh_support_sla FOR SELECT USING(sh_scope_hopital(hopital_id));
 CREATE POLICY sh_sla_creation ON sh_support_sla FOR INSERT WITH CHECK(sh_scope_write() AND sh_scope_root());
 CREATE POLICY sh_sla_modification ON sh_support_sla FOR UPDATE USING(sh_scope_write() AND sh_scope_root()) WITH CHECK(sh_scope_root());
 CREATE POLICY sh_escalade_lecture ON sh_support_escalades FOR SELECT USING(sh_scope_ticket(ticket_id));
 CREATE POLICY sh_escalade_creation ON sh_support_escalades FOR INSERT WITH CHECK(sh_scope_write() AND sh_scope_ticket(ticket_id));
 GRANT SELECT,INSERT,UPDATE ON sh_support_sla TO "${role}";GRANT SELECT,INSERT ON sh_support_escalades TO "${role}";
 GRANT USAGE,SELECT ON SEQUENCE sh_support_sla_id_seq,sh_support_escalades_id_seq TO "${role}";
 REVOKE ALL ON FUNCTION sh_ticket_sla(),sh_sla_version_immuable() FROM PUBLIC;`);
 await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[SUPPORT_SLA_VERSION]);return true;
}
module.exports={SUPPORT_SLA_VERSION,migrerSupportSla,STANDARD};
