-- Migration additive et réexécutable pour la version OG/RescueMatch.
-- À appliquer sur une copie validée avant le pilote. Ne marque aucune capacité
-- historique comme confirmée et ne supprime aucune donnée métier.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';
SELECT pg_advisory_xact_lock(hashtext('arrimo:20261022:capacites-og'));

ALTER TABLE public.config_pays
  ADD COLUMN IF NOT EXISTS confirmation_lit_validite_min integer NOT NULL DEFAULT 60;
ALTER TABLE public.lits
  ADD COLUMN IF NOT EXISTS disponibilite_confirmee_le timestamptz;
ALTER TABLE public.lits
  ADD COLUMN IF NOT EXISTS disponibilite_confirmee_par integer;
ALTER TABLE public.transferts
  ADD COLUMN IF NOT EXISTS route_actualise_le timestamptz,
  ADD COLUMN IF NOT EXISTS route_fournisseur text,
  ADD COLUMN IF NOT EXISTS route_version_donnees text,
  ADD COLUMN IF NOT EXISTS date_refus timestamptz,
  ADD COLUMN IF NOT EXISTS service_responsable text,
  ADD COLUMN IF NOT EXISTS derniere_relance_le timestamptz,
  ADD COLUMN IF NOT EXISTS nombre_relances integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS minutes_route integer,
  ADD COLUMN IF NOT EXISTS arrivee_prevue timestamptz,
  ADD COLUMN IF NOT EXISTS date_chambre_prete timestamptz;

-- Conserver les FK et valeurs historiques. Ne réduire la précision dans aucun
-- sens : integer -> numeric(8,1) est sans perte pour les valeurs existantes.
DO $$
DECLARE type_distance text;
BEGIN
  SELECT data_type INTO type_distance
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'transferts' AND column_name = 'distance_km';
  IF type_distance = 'integer' THEN
    ALTER TABLE public.transferts ALTER COLUMN distance_km TYPE numeric(8,1)
      USING distance_km::numeric(8,1);
  ELSIF type_distance IS DISTINCT FROM 'numeric' THEN
    RAISE EXCEPTION 'Type inattendu pour transferts.distance_km: %', type_distance;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lits_disponibilite_confirmee_par_fk'
    AND conrelid = 'public.lits'::regclass) THEN
    ALTER TABLE public.lits ADD CONSTRAINT lits_disponibilite_confirmee_par_fk
      FOREIGN KEY (disponibilite_confirmee_par) REFERENCES public.utilisateurs(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'config_confirmation_validite_range'
    AND conrelid = 'public.config_pays'::regclass) THEN
    ALTER TABLE public.config_pays ADD CONSTRAINT config_confirmation_validite_range
      CHECK (confirmation_lit_validite_min BETWEEN 5 AND 1440) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.lits VALIDATE CONSTRAINT lits_disponibilite_confirmee_par_fk;
ALTER TABLE public.config_pays VALIDATE CONSTRAINT config_confirmation_validite_range;
CREATE INDEX IF NOT EXISTS transferts_date_refus_idx ON public.transferts (date_refus) WHERE date_refus IS NOT NULL;
COMMIT;
