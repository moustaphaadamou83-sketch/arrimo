'use strict';
const TACHES_SUIVI_VERSION=31;
const STATUTS_TACHE=['a_faire','en_cours','bloquee','en_validation','terminee','annulee'];
async function migrerTachesSuivi(c){
 if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[TACHES_SUIVI_VERSION])).rowCount)return false;
 // Deux états ajoutés ; les valeurs existantes restent toutes valides.
 await c.query('ALTER TABLE sh_taches DROP CONSTRAINT IF EXISTS sh_taches_statut_check');
 await c.query(`ALTER TABLE sh_taches ADD CONSTRAINT sh_taches_statut_check CHECK(statut IN('a_faire','en_cours','bloquee','en_validation','terminee','annulee'))`);
 await c.query(`ALTER TABLE sh_taches ADD COLUMN IF NOT EXISTS temps_estime_minutes int CHECK(temps_estime_minutes BETWEEN 0 AND 100000),
   ADD COLUMN IF NOT EXISTS annulee_motif text, ADD COLUMN IF NOT EXISTS validee_par int REFERENCES sh_utilisateurs(id), ADD COLUMN IF NOT EXISTS validee_le timestamptz`);
 await c.query(`CREATE TABLE sh_taches_checklist(id bigserial PRIMARY KEY,tache_id bigint NOT NULL REFERENCES sh_taches(id) ON DELETE CASCADE,
   libelle text NOT NULL CHECK(length(libelle) BETWEEN 2 AND 200),ordre int NOT NULL DEFAULT 1,faite boolean NOT NULL DEFAULT false,
   faite_par int REFERENCES sh_utilisateurs(id),faite_le timestamptz,cree_le timestamptz NOT NULL DEFAULT now())`);
 await c.query(`CREATE TABLE sh_taches_temps(id bigserial PRIMARY KEY,tache_id bigint NOT NULL REFERENCES sh_taches(id) ON DELETE CASCADE,
   utilisateur_id int NOT NULL REFERENCES sh_utilisateurs(id),jour date NOT NULL,minutes int NOT NULL CHECK(minutes BETWEEN 1 AND 1440),
   note text,cree_le timestamptz NOT NULL DEFAULT now())`);
 await c.query('CREATE INDEX sh_taches_checklist_tache_idx ON sh_taches_checklist(tache_id,ordre)');
 await c.query('CREATE INDEX sh_taches_temps_tache_idx ON sh_taches_temps(tache_id,jour)');
 // Projet archivé : la checklist et les temps sont figés comme le reste du projet.
 await c.query(`CREATE FUNCTION sh_tache_archive_garde() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE t bigint; p bigint; a timestamptz;
   BEGIN
     IF TG_OP='DELETE' THEN t:=OLD.tache_id; ELSE t:=NEW.tache_id; END IF;
     SELECT projet_id INTO p FROM sh_taches WHERE id=t;
     SELECT archive_le INTO a FROM sh_projets WHERE id=p FOR SHARE;
     IF a IS NOT NULL AND current_setting('app.sh_suppression_projet',true) IS DISTINCT FROM p::text THEN
       RAISE EXCEPTION 'Projet archivé : restaurez-le avant modification.' USING ERRCODE='P0A01';
     END IF;
     IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
   END $$`);
 for(const table of ['sh_taches_checklist','sh_taches_temps']){
  await c.query(`CREATE TRIGGER sh_tache_archive_garde BEFORE INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION sh_tache_archive_garde()`);
  await c.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  await c.query(`CREATE POLICY sh_perimetre_lecture ON ${table} FOR SELECT USING(sh_scope_tache(tache_id))`);
  await c.query(`CREATE POLICY sh_perimetre_insert ON ${table} FOR INSERT WITH CHECK(sh_scope_write() AND sh_scope_tache(tache_id))`);
  await c.query(`CREATE POLICY sh_perimetre_update ON ${table} FOR UPDATE USING(sh_scope_write() AND sh_scope_tache(tache_id)) WITH CHECK(sh_scope_write() AND sh_scope_tache(tache_id))`);
  await c.query(`CREATE POLICY sh_perimetre_delete ON ${table} FOR DELETE USING(sh_scope_write() AND sh_scope_tache(tache_id))`);
 }
 const owner=(await c.query('SELECT current_user owner')).rows[0].owner,role=owner+'_scope';
 if(!/^[a-z][a-z0-9_]{0,50}$/.test(role))throw new Error('Rôle du suivi des tâches invalide.');
 await c.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON sh_taches_checklist,sh_taches_temps TO "${role}"`);
 await c.query(`GRANT USAGE,SELECT ON SEQUENCE sh_taches_checklist_id_seq,sh_taches_temps_id_seq TO "${role}"`);
 await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[TACHES_SUIVI_VERSION]);return true;
}
module.exports={TACHES_SUIVI_VERSION,STATUTS_TACHE,migrerTachesSuivi};
