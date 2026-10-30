'use strict';
const PROJETS_VERSION=8;
async function migrerProjets(c){
  if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[PROJETS_VERSION])).rowCount)return false;
  await c.query(`ALTER TABLE sh_projets ADD COLUMN IF NOT EXISTS type_projet text NOT NULL DEFAULT 'implantation'
    CHECK(type_projet IN ('pilote','implantation','extension','integration','migration','maintenance','mise_a_niveau'))`);
  await c.query(`CREATE TABLE IF NOT EXISTS sh_projet_membres(
    projet_id bigint NOT NULL REFERENCES sh_projets(id),utilisateur_id int NOT NULL REFERENCES sh_utilisateurs(id),
    responsabilite text,PRIMARY KEY(projet_id,utilisateur_id))`);
  await c.query(`ALTER TABLE sh_taches ADD COLUMN IF NOT EXISTS critique_golive boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS criteres_acceptation text`);
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[PROJETS_VERSION]);
  return true;
}
module.exports={PROJETS_VERSION,migrerProjets};
