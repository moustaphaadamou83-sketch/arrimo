-- Entretien (28 nov. 2026) : début du nettoyage d'une civière, pour mesurer l'attente et la durée du nettoyage (comme pour les lits)
ALTER TABLE civieres ADD COLUMN IF NOT EXISTS nettoyage_debut timestamptz;
