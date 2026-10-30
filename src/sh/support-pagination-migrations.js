'use strict';
const SUPPORT_PAGINATION_VERSION=18;
async function migrerSupportPagination(c){
  if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[SUPPORT_PAGINATION_VERSION])).rowCount)return false;
  await c.query('CREATE INDEX sh_support_tickets_pagination_client ON sh_support_tickets(hopital_id,id DESC) WHERE client_visible');
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[SUPPORT_PAGINATION_VERSION]);return true;
}
module.exports={SUPPORT_PAGINATION_VERSION,migrerSupportPagination};
