'use strict';
const SUPPORT_PJ_VERSION=22;
async function migrerSupportPj(c){
 const r=await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[SUPPORT_PJ_VERSION]);
 if(r.rowCount)return false;
 await c.query('CREATE INDEX IF NOT EXISTS sh_documents_ticket_idx ON sh_documents(ticket_id,cree_le DESC) WHERE ticket_id IS NOT NULL AND archive_le IS NULL');
 await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[SUPPORT_PJ_VERSION]);
 return true;
}
module.exports={SUPPORT_PJ_VERSION,migrerSupportPj};
