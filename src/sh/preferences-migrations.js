'use strict';
const PREFERENCES_VERSION=25;
async function migrerPreferences(c){
 if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[PREFERENCES_VERSION])).rowCount)return false;
 await c.query("ALTER TABLE sh_utilisateurs ADD COLUMN IF NOT EXISTS fuseau_horaire text NOT NULL DEFAULT 'America/Toronto'");
 await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[PREFERENCES_VERSION]);return true;
}
module.exports={PREFERENCES_VERSION,migrerPreferences};
