'use strict';
const SUPPORT_COURRIELS_VERSION=23;
async function migrerSupportCourriels(c){
 if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[SUPPORT_COURRIELS_VERSION])).rowCount)return false;
 await c.query(`CREATE TABLE sh_support_courriels(
  id bigserial PRIMARY KEY,ticket_id bigint NOT NULL REFERENCES sh_support_tickets(id),destinataire text NOT NULL CHECK(length(destinataire)<=254 AND position('@' in destinataire)>1),
  evenement text NOT NULL CHECK(evenement IN('ticket_cree','message_client','reponse_support','statut','piece_jointe','ticket_attribue')),
  cle text NOT NULL UNIQUE,etat text NOT NULL DEFAULT 'en_attente' CHECK(etat IN('en_attente','envoi','envoye','abandonne')),
  tentatives integer NOT NULL DEFAULT 0 CHECK(tentatives>=0),prochaine_tentative timestamptz NOT NULL DEFAULT now(),verrou_jusqua timestamptz,
  dernier_code text,cree_le timestamptz NOT NULL DEFAULT now(),envoye_le timestamptz)`);
 await c.query('CREATE INDEX sh_support_courriels_a_envoyer_idx ON sh_support_courriels(prochaine_tentative,id) WHERE etat IN(\'en_attente\',\'envoi\')');
 await c.query('ALTER TABLE sh_support_courriels ENABLE ROW LEVEL SECURITY');
 await c.query('CREATE POLICY sh_support_courriels_perimetre ON sh_support_courriels USING(sh_scope_ticket(ticket_id)) WITH CHECK(sh_scope_write() AND sh_scope_ticket(ticket_id))');
 const role=(await c.query('SELECT current_user owner')).rows[0].owner+'_scope';if(!/^[a-z][a-z0-9_]{0,50}$/.test(role))throw new Error('Rôle PostgreSQL restreint invalide');
 await c.query(`GRANT SELECT,INSERT ON sh_support_courriels TO "${role}"`);
 await c.query(`GRANT USAGE,SELECT ON SEQUENCE sh_support_courriels_id_seq TO "${role}"`);
 await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[SUPPORT_COURRIELS_VERSION]);return true;
}
module.exports={SUPPORT_COURRIELS_VERSION,migrerSupportCourriels};
