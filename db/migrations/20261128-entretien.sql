-- Entretien (28 nov. 2026) : début du nettoyage d'une civière, pour mesurer l'attente et la durée du nettoyage (comme pour les lits)
ALTER TABLE civieres ADD COLUMN IF NOT EXISTS nettoyage_debut timestamptz;
-- Mes tâches universel (28 nov. 2026) : heure du statut actuel et de l'affectation, tenues par la base quel que soit le module
ALTER TABLE taches_etab ADD COLUMN IF NOT EXISTS statut_depuis timestamptz;
ALTER TABLE taches_etab ADD COLUMN IF NOT EXISTS assigne_le timestamptz;
CREATE OR REPLACE FUNCTION taches_etab_horodatage() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.statut_depuis := COALESCE(NEW.statut_depuis, NEW.cree_le, now());
    IF NEW.assigne_a IS NOT NULL THEN NEW.assigne_le := COALESCE(NEW.assigne_le, now()); END IF;
  ELSE
    IF NEW.statut IS DISTINCT FROM OLD.statut THEN NEW.statut_depuis := now(); END IF;
    IF NEW.assigne_a IS DISTINCT FROM OLD.assigne_a THEN NEW.assigne_le := CASE WHEN NEW.assigne_a IS NULL THEN NULL ELSE now() END; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS taches_etab_horodatage ON taches_etab;
CREATE TRIGGER taches_etab_horodatage BEFORE INSERT OR UPDATE ON taches_etab FOR EACH ROW EXECUTE FUNCTION taches_etab_horodatage();
