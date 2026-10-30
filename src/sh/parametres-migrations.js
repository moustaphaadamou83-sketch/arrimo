'use strict';
const PARAMETRES_VERSION=29;
async function migrerParametres(c){
 if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[PARAMETRES_VERSION])).rowCount)return false;
 await c.query(`CREATE TABLE sh_parametres(cle text PRIMARY KEY CHECK(cle ~ '^[a-z_]{2,60}$'),valeur text NOT NULL,
   modifie_par int REFERENCES sh_utilisateurs(id),modifie_le timestamptz NOT NULL DEFAULT now())`);
 // Cycle de suppression d'un employé : colonnes nouvelles et nulles, aucune donnée existante modifiée.
 await c.query(`ALTER TABLE sh_utilisateurs ADD COLUMN IF NOT EXISTS suppression_demandee_le timestamptz,
   ADD COLUMN IF NOT EXISTS suppression_demandee_par int REFERENCES sh_utilisateurs(id),
   ADD COLUMN IF NOT EXISTS suppression_motif text, ADD COLUMN IF NOT EXISTS supprime_le timestamptz`);
 const owner=(await c.query('SELECT current_user owner')).rows[0].owner,role=owner+'_scope';
 if(!/^[a-z][a-z0-9_]{0,50}$/.test(role))throw new Error('Rôle des paramètres SH invalide.');
 await c.query(`GRANT SELECT,INSERT,UPDATE ON sh_parametres TO "${role}"`);
 await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[PARAMETRES_VERSION]);return true;
}
module.exports={PARAMETRES_VERSION,migrerParametres};
