'use strict';
const FINANCES_PROJETS_VERSION=30;
const NATURES=['budget','cout_prevu','cout_reel'];
const CATEGORIES=['main_oeuvre','licences','deplacements','materiel','sous_traitance','formation','autre'];
async function migrerFinancesProjets(c){
 if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[FINANCES_PROJETS_VERSION])).rowCount)return false;
 await c.query(`CREATE TABLE sh_projet_finances(
   id bigserial PRIMARY KEY,projet_id bigint NOT NULL REFERENCES sh_projets(id) ON DELETE CASCADE,
   nature text NOT NULL CHECK(nature IN('budget','cout_prevu','cout_reel')),
   categorie text NOT NULL CHECK(categorie IN('main_oeuvre','licences','deplacements','materiel','sous_traitance','formation','autre')),
   libelle text NOT NULL CHECK(length(libelle) BETWEEN 2 AND 200),montant numeric(14,2) NOT NULL CHECK(montant>=0),
   devise char(3) NOT NULL CHECK(devise ~ '^[A-Z]{3}$'),jour date NOT NULL,
   cree_par int REFERENCES sh_utilisateurs(id),cree_le timestamptz NOT NULL DEFAULT now())`);
 await c.query('CREATE INDEX sh_projet_finances_projet_idx ON sh_projet_finances(projet_id,nature)');
 // Même isolation que les autres données d'un projet : périmètre en lecture, écriture autorisée, projet archivé figé.
 await c.query('ALTER TABLE sh_projet_finances ENABLE ROW LEVEL SECURITY');
 await c.query('CREATE POLICY sh_perimetre_lecture ON sh_projet_finances FOR SELECT USING(sh_scope_projet(projet_id))');
 await c.query('CREATE POLICY sh_perimetre_insert ON sh_projet_finances FOR INSERT WITH CHECK(sh_scope_write() AND sh_scope_projet(projet_id))');
 await c.query('CREATE POLICY sh_perimetre_update ON sh_projet_finances FOR UPDATE USING(sh_scope_write() AND sh_scope_projet(projet_id)) WITH CHECK(sh_scope_write() AND sh_scope_projet(projet_id))');
 await c.query('CREATE POLICY sh_perimetre_delete ON sh_projet_finances FOR DELETE USING(sh_scope_write() AND sh_scope_projet(projet_id))');
 await c.query('CREATE TRIGGER sh_projet_archive_garde BEFORE INSERT OR UPDATE OR DELETE ON sh_projet_finances FOR EACH ROW EXECUTE FUNCTION sh_projet_archive_garde()');
 const owner=(await c.query('SELECT current_user owner')).rows[0].owner,role=owner+'_scope';
 if(!/^[a-z][a-z0-9_]{0,50}$/.test(role))throw new Error('Rôle des finances de projet invalide.');
 await c.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON sh_projet_finances TO "${role}"`);
 await c.query(`GRANT USAGE,SELECT ON SEQUENCE sh_projet_finances_id_seq TO "${role}"`);
 await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[FINANCES_PROJETS_VERSION]);return true;
}
module.exports={FINANCES_PROJETS_VERSION,NATURES,CATEGORIES,migrerFinancesProjets};
