-- Extensions additives du référentiel hospitalier. Les états opérationnels existants
-- demeurent la source de vérité pour les lits et les civières.
BEGIN;

CREATE TABLE IF NOT EXISTS departements (
  id serial PRIMARY KEY,
  etablissement_id int NOT NULL REFERENCES etablissements(id),
  code text NOT NULL,
  nom text NOT NULL,
  actif boolean NOT NULL DEFAULT true,
  attributs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributs) = 'object'),
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE(etablissement_id, code)
);

ALTER TABLE services ADD COLUMN IF NOT EXISTS departement_id int REFERENCES departements(id);
ALTER TABLE services ADD COLUMN IF NOT EXISTS actif boolean NOT NULL DEFAULT true;
ALTER TABLE services ADD COLUMN IF NOT EXISTS attributs jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE unites ADD COLUMN IF NOT EXISTS departement_id int REFERENCES departements(id);
ALTER TABLE unites ADD COLUMN IF NOT EXISTS actif boolean NOT NULL DEFAULT true;
ALTER TABLE unites ADD COLUMN IF NOT EXISTS attributs jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS etages (
  id serial PRIMARY KEY,
  unite_id int NOT NULL REFERENCES unites(id),
  code text NOT NULL,
  nom text NOT NULL,
  aile text,
  actif boolean NOT NULL DEFAULT true,
  attributs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributs) = 'object'),
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE(unite_id, code)
);

ALTER TABLE chambres ADD COLUMN IF NOT EXISTS etage_id int REFERENCES etages(id);
ALTER TABLE chambres ADD COLUMN IF NOT EXISTS type_chambre text;
ALTER TABLE chambres ADD COLUMN IF NOT EXISTS capacite_declaree int CHECK (capacite_declaree IS NULL OR capacite_declaree > 0);
ALTER TABLE chambres ADD COLUMN IF NOT EXISTS accessible boolean NOT NULL DEFAULT false;
ALTER TABLE chambres ADD COLUMN IF NOT EXISTS attributs jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE chambres ADD COLUMN IF NOT EXISTS restrictions jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE chambres ADD COLUMN IF NOT EXISTS statut_operationnel text NOT NULL DEFAULT 'actif'
  CHECK (statut_operationnel IN ('actif', 'maintenance', 'ferme'));
ALTER TABLE chambres ADD COLUMN IF NOT EXISTS actif boolean NOT NULL DEFAULT true;

ALTER TABLE lits ADD COLUMN IF NOT EXISTS categorie text;
ALTER TABLE lits ADD COLUMN IF NOT EXISTS attributs jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE lits ADD COLUMN IF NOT EXISTS actif boolean NOT NULL DEFAULT true;

ALTER TABLE civieres ADD COLUMN IF NOT EXISTS unite_id int REFERENCES unites(id);
ALTER TABLE civieres ADD COLUMN IF NOT EXISTS attributs jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE civieres ADD COLUMN IF NOT EXISTS actif boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS departements_etab_actif_idx ON departements(etablissement_id, actif);
CREATE INDEX IF NOT EXISTS etages_unite_actif_idx ON etages(unite_id, actif);
CREATE INDEX IF NOT EXISTS chambres_etage_idx ON chambres(etage_id) WHERE etage_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lits_chambre_actif_idx ON lits(chambre_id, actif);
CREATE INDEX IF NOT EXISTS civieres_unite_idx ON civieres(unite_id) WHERE unite_id IS NOT NULL;

-- Empêche les rattachements inter-établissements même si une future intégration contourne l'API.
CREATE UNIQUE INDEX IF NOT EXISTS departements_id_etab_unique ON departements(id,etablissement_id);
CREATE UNIQUE INDEX IF NOT EXISTS services_id_etab_unique ON services(id,etablissement_id);
CREATE UNIQUE INDEX IF NOT EXISTS unites_id_etab_unique ON unites(id,etablissement_id);
CREATE UNIQUE INDEX IF NOT EXISTS etages_id_unite_unique ON etages(id,unite_id);
CREATE UNIQUE INDEX IF NOT EXISTS chambres_id_unite_unique ON chambres(id,unite_id);
DO $$ BEGIN
  ALTER TABLE services ADD CONSTRAINT services_dept_etab_fk FOREIGN KEY(departement_id,etablissement_id)
    REFERENCES departements(id,etablissement_id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE unites ADD CONSTRAINT unites_dept_etab_fk FOREIGN KEY(departement_id,etablissement_id)
    REFERENCES departements(id,etablissement_id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE unites ADD CONSTRAINT unites_service_etab_fk FOREIGN KEY(service_id,etablissement_id)
    REFERENCES services(id,etablissement_id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE chambres ADD CONSTRAINT chambres_etage_unite_fk FOREIGN KEY(etage_id,unite_id)
    REFERENCES etages(id,unite_id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE lits ADD CONSTRAINT lits_chambre_unite_fk FOREIGN KEY(chambre_id,unite_id)
    REFERENCES chambres(id,unite_id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE civieres ADD CONSTRAINT civieres_unite_etab_fk FOREIGN KEY(unite_id,etablissement_id)
    REFERENCES unites(id,etablissement_id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMIT;
