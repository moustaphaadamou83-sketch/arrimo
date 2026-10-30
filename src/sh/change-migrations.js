'use strict';
const CHANGE_VERSION=27;
async function migrerChange(c){
 if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[CHANGE_VERSION])).rowCount)return false;
 await c.query(`CREATE TABLE sh_taux_change(
   id bigserial PRIMARY KEY,devise char(3) NOT NULL CHECK(devise ~ '^[A-Z]{3}$'),jour date NOT NULL,
   cad_par_unite numeric(20,10) NOT NULL CHECK(cad_par_unite>0),source_nom text NOT NULL,
   source_url text NOT NULL CHECK(source_url LIKE 'https://%'),serie text NOT NULL,
   recupere_le timestamptz NOT NULL DEFAULT now(),UNIQUE(devise,jour))`);
 // Un taux publié est une preuve : ni modifié ni supprimé.
 await c.query(`CREATE FUNCTION sh_taux_change_immuable() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN RAISE EXCEPTION 'Taux de change publié : modification interdite.'; END $$`);
 await c.query(`CREATE TRIGGER sh_taux_change_immuable BEFORE UPDATE OR DELETE ON sh_taux_change
   FOR EACH ROW EXECUTE FUNCTION sh_taux_change_immuable()`);
 // Nouvelle colonne nullable : les factures existantes restent inchangées.
 await c.query('ALTER TABLE sh_factures ADD COLUMN IF NOT EXISTS change jsonb');
 const owner=(await c.query('SELECT current_user owner')).rows[0].owner,role=owner+'_scope';
 if(!/^[a-z][a-z0-9_]{0,50}$/.test(role))throw new Error('Rôle de change SH invalide.');
 await c.query(`GRANT SELECT,INSERT ON sh_taux_change TO "${role}"`);
 await c.query(`GRANT USAGE,SELECT ON SEQUENCE sh_taux_change_id_seq TO "${role}"`);
 await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[CHANGE_VERSION]);return true;
}
module.exports={CHANGE_VERSION,migrerChange};
