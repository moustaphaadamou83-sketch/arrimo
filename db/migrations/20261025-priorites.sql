-- Priorités configurables : aucune validation ni habilitation déduite de l'existant.
CREATE TABLE IF NOT EXISTS admission_referentiels (
  etablissement_id int PRIMARY KEY REFERENCES etablissements(id),
  revision int NOT NULL CHECK (revision > 0),
  categories jsonb NOT NULL CHECK (jsonb_typeof(categories) = 'array'),
  approuve_par int NOT NULL REFERENCES utilisateurs(id),
  approuve_le timestamptz NOT NULL DEFAULT now(),
  motif text NOT NULL
);
CREATE TABLE IF NOT EXISTS admission_habilitations (
  etablissement_id int NOT NULL REFERENCES etablissements(id),
  utilisateur_id int NOT NULL REFERENCES utilisateurs(id),
  active boolean NOT NULL DEFAULT false,
  accordee_par int NOT NULL REFERENCES utilisateurs(id),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (etablissement_id, utilisateur_id)
);
ALTER TABLE admission_habilitations ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS priorite_code text;
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS priorite_libelle text;
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS priorite_rang int;
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS priorite_revision int;
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS priorite_validee_par int REFERENCES utilisateurs(id);
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS priorite_validee_le timestamptz;
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS priorite_motif text;
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS priorite_version int NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'demandes_admission'::regclass AND conname = 'admission_priorite_complete') THEN
    ALTER TABLE demandes_admission ADD CONSTRAINT admission_priorite_complete CHECK (
      (priorite_code IS NULL AND priorite_libelle IS NULL AND priorite_rang IS NULL AND priorite_revision IS NULL
        AND priorite_validee_par IS NULL AND priorite_validee_le IS NULL AND priorite_motif IS NULL)
      OR (priorite_code IS NOT NULL AND priorite_libelle IS NOT NULL AND priorite_rang > 0 AND priorite_revision > 0
        AND priorite_rang IS NOT NULL AND priorite_revision IS NOT NULL
        AND priorite_validee_par IS NOT NULL AND priorite_validee_le IS NOT NULL AND priorite_motif IS NOT NULL)
    );
  END IF;
END $$;
