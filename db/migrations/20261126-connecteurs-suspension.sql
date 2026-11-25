-- Complémentaire nº 3, §12 (26 nov. 2026) : suspension réversible d'un connecteur défaillant, sans révocation ni arrêt d'Arrimo.
BEGIN;
ALTER TABLE connecteurs ADD COLUMN IF NOT EXISTS suspendu_le timestamptz;
ALTER TABLE connecteurs ADD COLUMN IF NOT EXISTS suspendu_par int REFERENCES utilisateurs(id);
ALTER TABLE connecteurs ADD COLUMN IF NOT EXISTS motif_suspension text CHECK (motif_suspension IN ('erreurs_repetees', 'donnees_incoherentes', 'maintenance_partenaire', 'securite', 'autre'));
COMMIT;
