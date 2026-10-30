'use strict';
const RECHERCHE_VERSION=34;
async function migrerRecherche(c){
 if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[RECHERCHE_VERSION])).rowCount)return false;
 // Filtres enregistrables : propres à chaque utilisateur, jamais partagés.
 await c.query(`CREATE TABLE sh_filtres(id bigserial PRIMARY KEY,utilisateur_id int NOT NULL REFERENCES sh_utilisateurs(id) ON DELETE CASCADE,
   vue text NOT NULL CHECK(vue ~ '^[a-z_]{2,40}$'),nom text NOT NULL CHECK(length(nom) BETWEEN 2 AND 80),filtres jsonb NOT NULL,
   cree_le timestamptz NOT NULL DEFAULT now(),UNIQUE(utilisateur_id,vue,nom))`);
 const owner=(await c.query('SELECT current_user owner')).rows[0].owner,role=owner+'_scope';
 if(!/^[a-z][a-z0-9_]{0,50}$/.test(role))throw new Error('Rôle de recherche invalide.');
 await c.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON sh_filtres TO "${role}"`);
 await c.query(`GRANT USAGE,SELECT ON SEQUENCE sh_filtres_id_seq TO "${role}"`);
 await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[RECHERCHE_VERSION]);return true;
}
module.exports={RECHERCHE_VERSION,migrerRecherche};
