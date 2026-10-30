'use strict';
const DEPLOIEMENT_VERSION=35;
async function migrerDeploiement(c){
 if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[DEPLOIEMENT_VERSION])).rowCount)return false;
 // Parcours détaillé en 17 étapes (cahier §11) : nouvelle table, les 7 étapes historiques restent inchangées.
 await c.query(`CREATE TABLE sh_deploiement_etapes(hopital_id int NOT NULL REFERENCES hopitaux(id) ON DELETE CASCADE,code text NOT NULL CHECK(code ~ '^[a-z_]{3,40}$'),
   statut text NOT NULL DEFAULT 'a_faire' CHECK(statut IN('a_faire','en_cours','bloquee','terminee','non_applicable')),
   responsable_id int REFERENCES sh_utilisateurs(id),livrables text,notes text,motif text,preuves jsonb NOT NULL DEFAULT '[]'::jsonb,
   modifie_par int REFERENCES sh_utilisateurs(id),modifie_le timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(hopital_id,code))`);
 await c.query('ALTER TABLE sh_deploiement_etapes ENABLE ROW LEVEL SECURITY');
 await c.query('CREATE POLICY sh_perimetre_lecture ON sh_deploiement_etapes FOR SELECT USING(sh_scope_hopital(hopital_id))');
 await c.query('CREATE POLICY sh_perimetre_insert ON sh_deploiement_etapes FOR INSERT WITH CHECK(sh_scope_write() AND sh_scope_hopital(hopital_id))');
 await c.query('CREATE POLICY sh_perimetre_update ON sh_deploiement_etapes FOR UPDATE USING(sh_scope_write() AND sh_scope_hopital(hopital_id)) WITH CHECK(sh_scope_write() AND sh_scope_hopital(hopital_id))');
 await c.query('CREATE POLICY sh_perimetre_delete ON sh_deploiement_etapes FOR DELETE USING(sh_scope_write() AND sh_scope_hopital(hopital_id))');
 const owner=(await c.query('SELECT current_user owner')).rows[0].owner,role=owner+'_scope';
 if(!/^[a-z][a-z0-9_]{0,50}$/.test(role))throw new Error('Rôle du déploiement invalide.');
 await c.query(`GRANT SELECT,INSERT,UPDATE ON sh_deploiement_etapes TO "${role}"`);
 await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[DEPLOIEMENT_VERSION]);return true;
}
module.exports={DEPLOIEMENT_VERSION,migrerDeploiement};
