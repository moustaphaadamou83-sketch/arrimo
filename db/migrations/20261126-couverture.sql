-- Chantier coordination, lot 6 (26 nov. 2026) : ruptures de couverture ambulancière (cahier « optimisation transversale » §10, scénario E).
-- Seuil de SIMULATION seulement (démo, recette) : aucun seuil officiel n'est inventé ; aucune mesure réglementaire déclenchée.
BEGIN;
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS couverture_seuil_simulation int CHECK (couverture_seuil_simulation BETWEEN 0 AND 500);
CREATE TABLE IF NOT EXISTS ruptures_couverture (
  id                 bigserial PRIMARY KEY,
  config_id          int  NOT NULL REFERENCES config_pays(id),
  debut              timestamptz NOT NULL DEFAULT now(),
  fin                timestamptz,
  seuil              int  NOT NULL,
  disponibles_min    int  NOT NULL,
  immobilisees_max   int  NOT NULL,
  cause              text NOT NULL DEFAULT 'inconnue' CHECK (cause IN ('inconnue', 'immobilisations_hospitalieres', 'interventions_multiples', 'vehicules_hors_service', 'autre_documentee')),
  gravite            text NOT NULL DEFAULT 'simulation' CHECK (gravite IN ('simulation', 'moderee', 'elevee', 'critique')),
  mesure             text CHECK (mesure IN ('aucune', 'renfort_demande', 'redistribution_decidee', 'contingence_autorite', 'autre_documentee')),
  decide_par         int REFERENCES utilisateurs(id),
  decide_le          timestamptz,
  CHECK (fin IS NULL OR fin >= debut)
);
CREATE UNIQUE INDEX IF NOT EXISTS ruptures_couverture_ouverte ON ruptures_couverture (config_id) WHERE fin IS NULL;
COMMIT;
