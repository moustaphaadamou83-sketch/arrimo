'use strict';
const APPARENCE_VERSION=28;
const APPARENCES=['clair','sombre','automatique','soleil'];
async function migrerApparence(c){
 if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[APPARENCE_VERSION])).rowCount)return false;
 // Nouvelle colonne avec valeur par défaut : les données existantes ne changent pas.
 await c.query(`ALTER TABLE sh_utilisateurs ADD COLUMN IF NOT EXISTS apparence text NOT NULL DEFAULT 'automatique'
   CHECK(apparence IN('clair','sombre','automatique','soleil'))`);
 await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[APPARENCE_VERSION]);return true;
}
module.exports={APPARENCE_VERSION,APPARENCES,migrerApparence};
