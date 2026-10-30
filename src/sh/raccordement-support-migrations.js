'use strict';
const RACCORDEMENT_SUPPORT_VERSION=20;
async function migrerRaccordementSupport(c){
  if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[RACCORDEMENT_SUPPORT_VERSION])).rowCount)return false;
  await c.query(`ALTER TABLE hopitaux DROP CONSTRAINT hopitaux_environnement_check;
    ALTER TABLE hopitaux ADD CONSTRAINT hopitaux_environnement_check CHECK(environnement IN('demo','demo_abc','recette','pilote','production'));`);
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[RACCORDEMENT_SUPPORT_VERSION]);return true;
}
module.exports={RACCORDEMENT_SUPPORT_VERSION,migrerRaccordementSupport};
