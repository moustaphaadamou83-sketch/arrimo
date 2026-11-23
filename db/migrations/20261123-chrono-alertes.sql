BEGIN;
ALTER TABLE passages_chrono ADD COLUMN IF NOT EXISTS alerte_notifiee_le timestamptz;
COMMIT;
