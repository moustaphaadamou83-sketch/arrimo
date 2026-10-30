'use strict';
const CYCLE_PROJETS_VERSION=11;
async function migrerCycleProjets(c){
  if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[CYCLE_PROJETS_VERSION])).rowCount)return false;
  await c.query(`ALTER TABLE sh_projets ADD COLUMN archive_le timestamptz, ADD COLUMN archive_par int REFERENCES sh_utilisateurs(id),
    ADD COLUMN suppression_demandee_le timestamptz, ADD COLUMN suppression_demandee_par int REFERENCES sh_utilisateurs(id), ADD COLUMN motif_suppression text`);
  await c.query(`CREATE FUNCTION sh_projet_archive_garde() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE p bigint; a timestamptz;
    BEGIN
      IF TG_TABLE_NAME='sh_projets' THEN
        IF OLD.archive_le IS NOT NULL AND
          (to_jsonb(NEW)-ARRAY['archive_le','archive_par','suppression_demandee_le','suppression_demandee_par','motif_suppression','modifie_le'])
          IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['archive_le','archive_par','suppression_demandee_le','suppression_demandee_par','motif_suppression','modifie_le']) THEN
          RAISE EXCEPTION 'Projet archivé : restaurez-le avant modification.' USING ERRCODE='P0A01';
        END IF;
        RETURN NEW;
      END IF;
      IF TG_TABLE_NAME='sh_taches_commentaires' THEN
        SELECT projet_id INTO p FROM sh_taches WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.tache_id ELSE NEW.tache_id END;
      ELSE
        IF TG_OP='DELETE' THEN p:=OLD.projet_id; ELSE p:=NEW.projet_id; END IF;
      END IF;
      SELECT archive_le INTO a FROM sh_projets WHERE id=p FOR SHARE;
      IF a IS NOT NULL AND current_setting('app.sh_suppression_projet',true) IS DISTINCT FROM p::text THEN
        RAISE EXCEPTION 'Projet archivé : restaurez-le avant modification.' USING ERRCODE='P0A01';
      END IF;
      IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END $$;
    CREATE TRIGGER sh_projet_archive_garde BEFORE UPDATE ON sh_projets FOR EACH ROW EXECUTE FUNCTION sh_projet_archive_garde();
    CREATE TRIGGER sh_projet_archive_garde BEFORE INSERT OR UPDATE OR DELETE ON sh_taches FOR EACH ROW EXECUTE FUNCTION sh_projet_archive_garde();
    CREATE TRIGGER sh_projet_archive_garde BEFORE INSERT OR UPDATE OR DELETE ON sh_jalons FOR EACH ROW EXECUTE FUNCTION sh_projet_archive_garde();
    CREATE TRIGGER sh_projet_archive_garde BEFORE INSERT OR UPDATE OR DELETE ON sh_taches_commentaires FOR EACH ROW EXECUTE FUNCTION sh_projet_archive_garde();`);
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[CYCLE_PROJETS_VERSION]);return true;
}
module.exports={CYCLE_PROJETS_VERSION,migrerCycleProjets};
