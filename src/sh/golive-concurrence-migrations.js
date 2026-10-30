'use strict';
const GOLIVE_CONCURRENCE_VERSION=13;
async function migrerGoliveConcurrence(c){
  if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[GOLIVE_CONCURRENCE_VERSION])).rowCount)return false;
  // Les éventuels doublons historiques arrêtent la migration ; aucun état n'est réécrit implicitement.
  await c.query("CREATE UNIQUE INDEX sh_golive_operation_en_cours_unique ON sh_golive_operations(hopital_id,cible) WHERE statut='en_cours'");
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[GOLIVE_CONCURRENCE_VERSION]);return true;
}
module.exports={GOLIVE_CONCURRENCE_VERSION,migrerGoliveConcurrence};
