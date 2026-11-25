-- Refonte unifiée, Chrono (26 nov. 2026) : objectifs internes Arrimo 15/30 et 5/10, configurables, affichés à côté des cibles MSSS
-- (jamais à leur place). Indicatifs, soumis à validation des établissements partenaires ; aucune prise en charge n'est pressée.
BEGIN;
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS objectif_remise_min int NOT NULL DEFAULT 15 CHECK (objectif_remise_min BETWEEN 1 AND 240);
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS objectif_liberation_min int NOT NULL DEFAULT 30 CHECK (objectif_liberation_min BETWEEN 1 AND 480);
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS objectif_escalade_majeure_min int NOT NULL DEFAULT 45 CHECK (objectif_escalade_majeure_min BETWEEN 1 AND 600);
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS excellence_remise_min int NOT NULL DEFAULT 5 CHECK (excellence_remise_min BETWEEN 1 AND 240);
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS excellence_liberation_min int NOT NULL DEFAULT 10 CHECK (excellence_liberation_min BETWEEN 1 AND 480);
COMMIT;
