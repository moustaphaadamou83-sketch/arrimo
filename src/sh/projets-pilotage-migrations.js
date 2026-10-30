'use strict';
const PROJETS_PILOTAGE_VERSION=32;
const ETAPES_PROJET=['nouveau','qualification','cadrage','preparation','configuration','migration','integrations','formation','tests_uat','pret_lancement','go_live','stabilisation','maintenance','termine'];
const STATUTS_PROJET=['planification','en_cours','en_attente','suspendu','bloque','termine','annule'];
async function migrerProjetsPilotage(c){
 if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[PROJETS_PILOTAGE_VERSION])).rowCount)return false;
 // Étape Kanban nulle pour les projets existants (« à classer ») : aucune étape n'est inventée.
 await c.query(`ALTER TABLE sh_projets ADD COLUMN IF NOT EXISTS etape text CHECK(etape IN(${ETAPES_PROJET.map(e=>`'${e}'`).join(',')})),
   ADD COLUMN IF NOT EXISTS etape_le timestamptz`);
 await c.query('ALTER TABLE sh_projets DROP CONSTRAINT IF EXISTS sh_projets_statut_check');
 await c.query(`ALTER TABLE sh_projets ADD CONSTRAINT sh_projets_statut_check CHECK(statut IN(${STATUTS_PROJET.map(e=>`'${e}'`).join(',')}))`);
 await c.query(`CREATE TABLE sh_projet_registre(id bigserial PRIMARY KEY,projet_id bigint NOT NULL REFERENCES sh_projets(id) ON DELETE CASCADE,
   type text NOT NULL CHECK(type IN('risque','decision')),titre text NOT NULL CHECK(length(titre) BETWEEN 3 AND 200),description text,
   gravite text CHECK(gravite IN('faible','moderee','elevee')),probabilite text CHECK(probabilite IN('faible','moderee','elevee')),
   statut text NOT NULL DEFAULT 'ouvert' CHECK(statut IN('ouvert','en_traitement','clos')),responsable_id int REFERENCES sh_utilisateurs(id),echeance date,
   decide_par text,decide_le date,cree_par int REFERENCES sh_utilisateurs(id),cree_le timestamptz NOT NULL DEFAULT now(),modifie_le timestamptz NOT NULL DEFAULT now(),
   CHECK(type<>'risque' OR (gravite IS NOT NULL AND probabilite IS NOT NULL)),CHECK(type<>'decision' OR (decide_par IS NOT NULL AND decide_le IS NOT NULL)))`);
 await c.query('CREATE INDEX sh_projet_registre_projet_idx ON sh_projet_registre(projet_id,type,statut)');
 await c.query('ALTER TABLE sh_projet_registre ENABLE ROW LEVEL SECURITY');
 await c.query('CREATE POLICY sh_perimetre_lecture ON sh_projet_registre FOR SELECT USING(sh_scope_projet(projet_id))');
 await c.query('CREATE POLICY sh_perimetre_insert ON sh_projet_registre FOR INSERT WITH CHECK(sh_scope_write() AND sh_scope_projet(projet_id))');
 await c.query('CREATE POLICY sh_perimetre_update ON sh_projet_registre FOR UPDATE USING(sh_scope_write() AND sh_scope_projet(projet_id)) WITH CHECK(sh_scope_write() AND sh_scope_projet(projet_id))');
 await c.query('CREATE POLICY sh_perimetre_delete ON sh_projet_registre FOR DELETE USING(sh_scope_write() AND sh_scope_projet(projet_id))');
 await c.query('CREATE TRIGGER sh_projet_archive_garde BEFORE INSERT OR UPDATE OR DELETE ON sh_projet_registre FOR EACH ROW EXECUTE FUNCTION sh_projet_archive_garde()');
 const owner=(await c.query('SELECT current_user owner')).rows[0].owner,role=owner+'_scope';
 if(!/^[a-z][a-z0-9_]{0,50}$/.test(role))throw new Error('Rôle du pilotage de projet invalide.');
 await c.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON sh_projet_registre TO "${role}"`);
 await c.query(`GRANT USAGE,SELECT ON SEQUENCE sh_projet_registre_id_seq TO "${role}"`);
 await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[PROJETS_PILOTAGE_VERSION]);return true;
}
module.exports={PROJETS_PILOTAGE_VERSION,ETAPES_PROJET,STATUTS_PROJET,migrerProjetsPilotage};
