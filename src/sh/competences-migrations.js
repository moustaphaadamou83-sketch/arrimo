'use strict';
const COMPETENCES_VERSION=33;
const NIVEAUX_COMPETENCE=['notions','autonome','expert'];
async function migrerCompetences(c){
 if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[COMPETENCES_VERSION])).rowCount)return false;
 await c.query(`CREATE TABLE sh_competences(id bigserial PRIMARY KEY,utilisateur_id int NOT NULL REFERENCES sh_utilisateurs(id) ON DELETE CASCADE,
   competence text NOT NULL CHECK(length(competence) BETWEEN 2 AND 80),niveau text NOT NULL CHECK(niveau IN('notions','autonome','expert')),
   modifie_par int REFERENCES sh_utilisateurs(id),modifie_le timestamptz NOT NULL DEFAULT now())`);
 await c.query('CREATE UNIQUE INDEX sh_competences_unique ON sh_competences(utilisateur_id,lower(competence))');
 // Zones d'intervention (pays ou régions) : colonne nouvelle, vide pour les comptes existants.
 await c.query("ALTER TABLE sh_utilisateurs ADD COLUMN IF NOT EXISTS zones text[] NOT NULL DEFAULT '{}'");
 const owner=(await c.query('SELECT current_user owner')).rows[0].owner,role=owner+'_scope';
 if(!/^[a-z][a-z0-9_]{0,50}$/.test(role))throw new Error('Rôle des compétences invalide.');
 await c.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON sh_competences TO "${role}"`);
 await c.query(`GRANT USAGE,SELECT ON SEQUENCE sh_competences_id_seq TO "${role}"`);
 await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[COMPETENCES_VERSION]);return true;
}
module.exports={COMPETENCES_VERSION,NIVEAUX_COMPETENCE,migrerCompetences};
