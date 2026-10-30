'use strict';
const SUPPORT_CALENDRIER_VERSION=24;
const CALENDRIER_CONTINU={mode:'continu',jours:[1,2,3,4,5],debut:'09:00',fin:'17:00',jours_feries:[]};
async function migrerSupportCalendrier(c){
 if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[SUPPORT_CALENDRIER_VERSION])).rowCount)return false;
 const role=(await c.query('SELECT current_user owner')).rows[0].owner+'_scope';if(!/^[a-z][a-z0-9_]{0,50}$/.test(role))throw new Error('Rôle restreint invalide');
 await c.query(`ALTER TABLE sh_support_sla ADD COLUMN IF NOT EXISTS calendrier jsonb NOT NULL DEFAULT '${JSON.stringify(CALENDRIER_CONTINU)}'::jsonb;
 CREATE OR REPLACE FUNCTION sh_sla_calendrier_valide(j jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
 DECLARE d text; valide_date boolean;
 BEGIN
  IF jsonb_typeof(j) IS DISTINCT FROM 'object' OR j->>'mode' NOT IN('continu','ouvrable') THEN RETURN false; END IF;
  IF j->>'mode'='continu' THEN RETURN true; END IF;
  IF jsonb_typeof(j->'jours') IS DISTINCT FROM 'array' OR jsonb_array_length(j->'jours')=0 OR jsonb_array_length(j->'jours')>7
    OR (j->>'debut') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR (j->>'fin') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR (j->>'debut')::time >= (j->>'fin')::time OR jsonb_typeof(j->'jours_feries') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR d IN SELECT value FROM jsonb_array_elements_text(j->'jours') LOOP
   IF d !~ '^[1-7]$' OR (SELECT count(*) FROM jsonb_array_elements_text(j->'jours') x WHERE x.value=d)<>1 THEN RETURN false; END IF;
  END LOOP;
  IF jsonb_array_length(j->'jours_feries')>366 THEN RETURN false; END IF;
  FOR d IN SELECT value FROM jsonb_array_elements_text(j->'jours_feries') LOOP
   IF d !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
   BEGIN valide_date:=to_char(d::date,'YYYY-MM-DD')=d; EXCEPTION WHEN OTHERS THEN RETURN false; END;
   IF NOT valide_date THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
 END $$;
 DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.sh_support_sla'::regclass AND conname='sh_sla_calendrier_chk') THEN ALTER TABLE public.sh_support_sla ADD CONSTRAINT sh_sla_calendrier_chk CHECK(sh_sla_calendrier_valide(calendrier)); END IF; END $$;
 CREATE OR REPLACE FUNCTION sh_sla_echeance(debut timestamptz, minutes int, calendrier jsonb, fuseau text) RETURNS timestamptz
 LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
 DECLARE reste int:=minutes;curseur timestamptz:=debut;local_date date;ouvre timestamptz;ferme timestamptz;disponible int;jour int;
 BEGIN
  IF debut IS NULL OR minutes IS NULL THEN RETURN NULL; END IF;
  IF minutes<0 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=fuseau) THEN RAISE EXCEPTION 'SLA calendar input invalid'; END IF;
  IF calendrier IS NULL OR calendrier->>'mode' IS DISTINCT FROM 'ouvrable' THEN RETURN debut+make_interval(mins=>minutes); END IF;
  IF NOT public.sh_sla_calendrier_valide(calendrier) THEN RAISE EXCEPTION 'SLA calendar invalid'; END IF;
  WHILE reste>0 LOOP
   local_date:=(curseur AT TIME ZONE fuseau)::date;jour:=extract(isodow FROM local_date)::int;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(calendrier->'jours') j WHERE j.value::int=jour)
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(calendrier->'jours_feries') f WHERE f.value=local_date::text) THEN
    ouvre:=(local_date+(calendrier->>'debut')::time) AT TIME ZONE fuseau;
    ferme:=(local_date+(calendrier->>'fin')::time) AT TIME ZONE fuseau;
    IF curseur<ouvre THEN curseur:=ouvre; END IF;
    IF curseur<ferme THEN
     disponible:=floor(extract(epoch FROM (ferme-curseur))/60)::int;
     IF reste<=disponible THEN RETURN curseur+make_interval(mins=>reste); END IF;
     reste:=reste-disponible;
    END IF;
   END IF;
   curseur:=((local_date+1)::timestamp AT TIME ZONE fuseau);
  END LOOP;
  RETURN curseur;
 END $$;
 CREATE OR REPLACE FUNCTION sh_ticket_sla_calendrier() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 DECLARE cal jsonb:='${JSON.stringify(CALENDRIER_CONTINU)}'::jsonb;tz text:='UTC';r jsonb;
 BEGIN
  IF NEW.sla_snapshot IS NULL OR NEW.sla_debut_le IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
   SELECT h.fuseau_horaire,COALESCE(s.calendrier,'${JSON.stringify(CALENDRIER_CONTINU)}'::jsonb) INTO tz,cal
    FROM public.hopitaux h LEFT JOIN public.sh_support_sla s ON s.id=NEW.sla_id WHERE h.id=NEW.hopital_id;
   tz:=COALESCE(tz,'UTC');cal:=COALESCE(cal,'${JSON.stringify(CALENDRIER_CONTINU)}'::jsonb);
   NEW.sla_snapshot:=NEW.sla_snapshot||jsonb_build_object('calendrier',cal,'fuseau_horaire',tz);
  ELSE
   cal:=COALESCE(NEW.sla_snapshot->'calendrier','${JSON.stringify(CALENDRIER_CONTINU)}'::jsonb);
   tz:=COALESCE(NEW.sla_snapshot->>'fuseau_horaire','UTC');
  END IF;
  r:=NEW.sla_snapshot->'regles'->NEW.priorite;
  NEW.prise_en_charge_echeance:=public.sh_sla_echeance(NEW.sla_debut_le,(r->>'prise_en_charge_minutes')::int,cal,tz);
  NEW.resolution_echeance:=public.sh_sla_echeance(NEW.sla_debut_le,(r->>'resolution_minutes')::int,cal,tz);
  NEW.echeance:=COALESCE(NEW.resolution_echeance,NEW.prise_en_charge_echeance);
  RETURN NEW;
 END $$;
 DROP TRIGGER IF EXISTS zz_ticket_sla_calendrier ON sh_support_tickets;
 CREATE TRIGGER zz_ticket_sla_calendrier BEFORE INSERT OR UPDATE ON sh_support_tickets FOR EACH ROW EXECUTE FUNCTION sh_ticket_sla_calendrier();
 GRANT EXECUTE ON FUNCTION sh_sla_echeance(timestamptz,int,jsonb,text) TO "${role}";
 REVOKE ALL ON FUNCTION sh_ticket_sla_calendrier() FROM PUBLIC;`);
 await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[SUPPORT_CALENDRIER_VERSION]);
 return true;
}
module.exports={SUPPORT_CALENDRIER_VERSION,CALENDRIER_CONTINU,migrerSupportCalendrier};
