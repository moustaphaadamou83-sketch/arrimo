'use strict';
const SUPPORT_PORTAIL_VERSION=15;
async function migrerSupportPortail(c){
  if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[SUPPORT_PORTAIL_VERSION])).rowCount)return false;
  await c.query(`ALTER TABLE sh_support_tickets ADD COLUMN reference text UNIQUE,
    ADD COLUMN projet_id bigint REFERENCES sh_projets(id),ADD COLUMN categorie text NOT NULL DEFAULT 'autre',
    ADD COLUMN client_visible boolean NOT NULL DEFAULT false,ADD COLUMN demandeur_client text;
    ALTER TABLE sh_support_messages ADD COLUMN auteur_client text;
    UPDATE sh_support_tickets SET reference='TICK-'||EXTRACT(YEAR FROM cree_le)::int||'-'||lpad(id::text,GREATEST(4,length(id::text)),'0');
    INSERT INTO sh_compteurs(cle,valeur) SELECT 'TICK-'||EXTRACT(YEAR FROM cree_le)::int,max(id)::int FROM sh_support_tickets GROUP BY EXTRACT(YEAR FROM cree_le)
      ON CONFLICT(cle) DO UPDATE SET valeur=GREATEST(sh_compteurs.valeur,EXCLUDED.valeur);
    CREATE FUNCTION sh_ticket_reference() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE cle_ticket text; n int;
      BEGIN
        IF NEW.reference IS NULL THEN
          cle_ticket:='TICK-'||EXTRACT(YEAR FROM NEW.cree_le)::int;
          INSERT INTO sh_compteurs(cle,valeur) VALUES(cle_ticket,1) ON CONFLICT(cle) DO UPDATE SET valeur=sh_compteurs.valeur+1 RETURNING valeur INTO n;
          NEW.reference:=cle_ticket||'-'||lpad(n::text,GREATEST(4,length(n::text)),'0');
        END IF;
        RETURN NEW;
      END $$;
    CREATE TRIGGER sh_ticket_reference BEFORE INSERT ON sh_support_tickets FOR EACH ROW EXECUTE FUNCTION sh_ticket_reference();
    ALTER TABLE sh_support_tickets ALTER COLUMN reference SET NOT NULL;`);
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[SUPPORT_PORTAIL_VERSION]);return true;
}
module.exports={SUPPORT_PORTAIL_VERSION,migrerSupportPortail};
