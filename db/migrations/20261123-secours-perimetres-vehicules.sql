BEGIN;
ALTER TABLE organisations_secours ADD COLUMN IF NOT EXISTS restreindre_equipages_aux_unites boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS utilisateur_unites_secours (
  utilisateur_id int NOT NULL REFERENCES utilisateurs(id),
  unite_id int NOT NULL REFERENCES unites_secours(id),
  PRIMARY KEY (utilisateur_id, unite_id)
);
COMMIT;
