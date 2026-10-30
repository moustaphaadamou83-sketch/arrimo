'use strict';
const PRESENCE_VERSION=9;
async function migrerPresence(c){
  if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[PRESENCE_VERSION])).rowCount)return false;
  await c.query(`ALTER TABLE sh_utilisateurs ADD COLUMN IF NOT EXISTS presence_manuelle text NOT NULL DEFAULT 'en_ligne'
    CHECK(presence_manuelle IN('en_ligne','occupe','en_reunion','en_pause','absent','hors_ligne'))`);
  await c.query('ALTER TABLE sh_sessions ADD COLUMN IF NOT EXISTS presence_le timestamptz');
  await c.query('CREATE INDEX IF NOT EXISTS sh_sessions_presence_idx ON sh_sessions(utilisateur_id,presence_le)');
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[PRESENCE_VERSION]);return true;
}
module.exports={PRESENCE_VERSION,migrerPresence};
