-- Import distinct des services, sans remplacer types_unite ni modifier les données existantes.
BEGIN;
CREATE TABLE IF NOT EXISTS services (
  id serial PRIMARY KEY,
  etablissement_id int NOT NULL REFERENCES etablissements(id),
  code text NOT NULL,
  nom text NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE(etablissement_id, code)
);
ALTER TABLE unites ADD COLUMN IF NOT EXISTS service_id int;
DO $$ BEGIN
  ALTER TABLE unites ADD CONSTRAINT unites_service_fk FOREIGN KEY(service_id) REFERENCES services(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS unites_service_id_idx ON unites(service_id);
COMMIT;
