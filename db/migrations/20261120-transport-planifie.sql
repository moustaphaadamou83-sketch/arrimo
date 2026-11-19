-- =====================================================================================================
-- Transport non urgent (20 nov. 2026, cahier v2, C.4). Migration additive et rejouable ; aucune donnée existante modifiée.
-- Une demande de transport peut exister sans coordination CHSLD (retour à domicile, transfert stable, départ NSA, retour CHSLD) ;
-- plage horaire demandée puis confirmée par le transporteur ; type de véhicule ; lit « à libérer » lié.
-- =====================================================================================================
ALTER TABLE demandes_transport ALTER COLUMN coordination_id DROP NOT NULL;
ALTER TABLE demandes_transport ALTER COLUMN destination_id DROP NOT NULL;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS destination_libelle text CHECK (destination_libelle IS NULL OR length(destination_libelle) BETWEEN 2 AND 120);
DO $$ BEGIN
  ALTER TABLE demandes_transport ADD CONSTRAINT demandes_transport_destination CHECK (destination_id IS NOT NULL OR destination_libelle IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS motif_transport text CHECK (motif_transport IS NULL OR motif_transport IN ('retour_domicile', 'transfert_stable', 'depart_nsa', 'retour_chsld'));
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS type_vehicule text CHECK (type_vehicule IS NULL OR type_vehicule IN ('ambulance', 'transport_adapte', 'autre'));
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS plage_debut timestamptz;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS plage_fin timestamptz;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS plage_confirmee_debut timestamptz;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS plage_confirmee_fin timestamptz;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS lit_id int REFERENCES lits(id);
DO $$ BEGIN
  ALTER TABLE demandes_transport ADD CONSTRAINT demandes_transport_plage CHECK ((plage_debut IS NULL) = (plage_fin IS NULL) AND (plage_fin IS NULL OR plage_fin > plage_debut));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS demandes_transport_lit_ouvert ON demandes_transport (lit_id) WHERE lit_id IS NOT NULL AND statut IN ('demandee', 'acceptee', 'en_route', 'pris_en_charge');
