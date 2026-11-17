-- Migration additive des lots C et D du parcours NSA (17 nov. 2026), identique à la fin de db/schema.sql ; rejouable ; aucune donnée existante modifiée.

-- =====================================================================================================
-- Parcours NSA vers l'hébergement, lots C et D (17 nov. 2026) : boucle complète d'une demande venue d'un hôpital.
-- La ressource répond (délai mesuré à partir des étapes) ou refuse avec un motif fermé (jamais de texte libre clinique) ; l'hôpital confirme la place
-- avec l'usager ou la famille et organise le départ (date, heure, transport, documents, famille avisée) ; le lit passe « à libérer ».
-- =====================================================================================================
ALTER TABLE demandes_hebergement ADD COLUMN IF NOT EXISTS motif_refus_code text;
DO $$ BEGIN
  ALTER TABLE demandes_hebergement ADD CONSTRAINT demandes_hebergement_motif_refus CHECK (motif_refus_code IS NULL OR motif_refus_code IN
    ('capacite_insuffisante', 'besoin_non_couvert', 'place_plus_disponible', 'dossier_incomplet', 'choix_usager', 'autre'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE demandes_hebergement ADD COLUMN IF NOT EXISTS transitoire boolean NOT NULL DEFAULT false;
ALTER TABLE demandes_hebergement ADD COLUMN IF NOT EXISTS acceptation_equipe_le timestamptz;   -- place confirmée par l'équipe avec l'usager ou la famille
ALTER TABLE demandes_hebergement ADD COLUMN IF NOT EXISTS acceptation_equipe_par int REFERENCES utilisateurs(id);
ALTER TABLE demandes_hebergement ADD COLUMN IF NOT EXISTS depart_prevu_le timestamptz;
ALTER TABLE demandes_hebergement ADD COLUMN IF NOT EXISTS transport_mode text;
DO $$ BEGIN
  ALTER TABLE demandes_hebergement ADD CONSTRAINT demandes_hebergement_transport_mode CHECK (transport_mode IS NULL OR transport_mode IN ('ambulance', 'transport_adapte', 'famille', 'autre'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE demandes_hebergement ADD COLUMN IF NOT EXISTS documents_transmis text[] NOT NULL DEFAULT '{}';
ALTER TABLE demandes_hebergement ADD COLUMN IF NOT EXISTS famille_avisee_le timestamptz;
