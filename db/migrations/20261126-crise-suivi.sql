-- Chantier coordination, complémentaire nº 3 (26 nov. 2026) : Mode crise, changements de destination et transports annulés comptés par résident.
BEGIN;
ALTER TABLE evacuation_residents ADD COLUMN IF NOT EXISTS changements_destination int NOT NULL DEFAULT 0;
ALTER TABLE evacuation_residents ADD COLUMN IF NOT EXISTS departs_annules int NOT NULL DEFAULT 0;
COMMIT;
