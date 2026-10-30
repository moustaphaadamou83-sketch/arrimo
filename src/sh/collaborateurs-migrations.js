'use strict';
const COLLABORATEURS_VERSION=36;
async function migrerCollaborateurs(c){
 if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[COLLABORATEURS_VERSION])).rowCount)return false;
 await c.query(`CREATE TABLE sh_taches_collaborateurs(tache_id bigint NOT NULL REFERENCES sh_taches(id) ON DELETE CASCADE,
   utilisateur_id int NOT NULL REFERENCES sh_utilisateurs(id),ajoute_par int REFERENCES sh_utilisateurs(id),ajoute_le timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY(tache_id,utilisateur_id))`);
 await c.query('CREATE TRIGGER sh_tache_archive_garde BEFORE INSERT OR UPDATE OR DELETE ON sh_taches_collaborateurs FOR EACH ROW EXECUTE FUNCTION sh_tache_archive_garde()');
 await c.query('ALTER TABLE sh_taches_collaborateurs ENABLE ROW LEVEL SECURITY');
 await c.query('CREATE POLICY sh_perimetre_lecture ON sh_taches_collaborateurs FOR SELECT USING(sh_scope_tache(tache_id))');
 await c.query('CREATE POLICY sh_perimetre_insert ON sh_taches_collaborateurs FOR INSERT WITH CHECK(sh_scope_write() AND sh_scope_tache(tache_id))');
 await c.query('CREATE POLICY sh_perimetre_delete ON sh_taches_collaborateurs FOR DELETE USING(sh_scope_write() AND sh_scope_tache(tache_id))');
 const owner=(await c.query('SELECT current_user owner')).rows[0].owner,role=owner+'_scope';
 if(!/^[a-z][a-z0-9_]{0,50}$/.test(role))throw new Error('Rôle des collaborateurs invalide.');
 await c.query(`GRANT SELECT,INSERT,DELETE ON sh_taches_collaborateurs TO "${role}"`);
 await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[COLLABORATEURS_VERSION]);return true;
}
module.exports={COLLABORATEURS_VERSION,migrerCollaborateurs};
