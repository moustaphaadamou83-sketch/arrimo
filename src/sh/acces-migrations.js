'use strict';
const ACCES_VERSION = 7;

async function migrerAcces(c) {
  if ((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1', [ACCES_VERSION])).rowCount) return false;
  await c.query(`ALTER TABLE sh_utilisateurs ADD COLUMN IF NOT EXISTS fonction text,
    ADD COLUMN IF NOT EXISTS archive_le timestamptz`);
  await c.query(`ALTER TABLE sh_sessions ADD COLUMN IF NOT EXISTS id bigserial,
    ADD COLUMN IF NOT EXISTS cree_le timestamptz NOT NULL DEFAULT now()`);
  await c.query('CREATE UNIQUE INDEX IF NOT EXISTS sh_sessions_id_unique ON sh_sessions(id)');
  await c.query(`CREATE TABLE IF NOT EXISTS sh_recuperations (
    jeton_hache text PRIMARY KEY, utilisateur_id int NOT NULL REFERENCES sh_utilisateurs(id),
    cree_le timestamptz NOT NULL DEFAULT now(), expire_le timestamptz NOT NULL,
    utilise_le timestamptz, revoque_le timestamptz)`);
  await c.query('CREATE INDEX IF NOT EXISTS sh_recuperations_utilisateur_idx ON sh_recuperations(utilisateur_id,cree_le)');
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)', [ACCES_VERSION]);
  return true;
}
module.exports = { ACCES_VERSION, migrerAcces };
