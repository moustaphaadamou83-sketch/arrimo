'use strict';
const LIENS_CLIENTS_VERSION=14;
async function migrerLiensClients(c){
  if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[LIENS_CLIENTS_VERSION])).rowCount)return false;
  if((await c.query(`SELECT 1 FROM hopitaux h JOIN sh_crm_organisations o ON o.hopital_id=h.id
    WHERE h.organisation_id IS NOT NULL AND h.organisation_id<>o.id LIMIT 1`)).rowCount)throw new Error('Association client/hôpital contradictoire : résoudre avant migration SH 14.');
  await c.query('UPDATE hopitaux h SET organisation_id=o.id FROM sh_crm_organisations o WHERE o.hopital_id=h.id AND h.organisation_id IS NULL');
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[LIENS_CLIENTS_VERSION]);return true;
}
module.exports={LIENS_CLIENTS_VERSION,migrerLiensClients};
