'use strict';
const PILOTE_VERSION=12;
async function migrerPilote(c){
  if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[PILOTE_VERSION])).rowCount)return false;
  await c.query(`ALTER TABLE hopitaux DROP CONSTRAINT hopitaux_environnement_check;
    ALTER TABLE hopitaux ADD CONSTRAINT hopitaux_environnement_check CHECK(environnement IN('demo','recette','pilote','production'));`);
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[PILOTE_VERSION]);return true;
}
module.exports={PILOTE_VERSION,migrerPilote};
