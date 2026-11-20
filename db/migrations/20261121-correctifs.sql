-- =====================================================================================================
-- Correctifs de l'audit du 20 nov. 2026 (COR-001 à COR-004). Migration additive et rejouable.
-- =====================================================================================================
-- COR-001 : transport préparé automatiquement au départ programmé (statut « a_valider »), transmis après validation humaine ;
-- une seule demande active par demande d'hébergement.
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS demande_hebergement_id int REFERENCES demandes_hebergement(id);
ALTER TABLE demandes_transport DROP CONSTRAINT IF EXISTS demandes_transport_statut_check;
ALTER TABLE demandes_transport ADD CONSTRAINT demandes_transport_statut_check CHECK (statut IN ('a_valider', 'demandee', 'acceptee', 'refusee', 'en_route', 'pris_en_charge', 'arrivee', 'annulee'));
CREATE UNIQUE INDEX IF NOT EXISTS demandes_transport_hebergement_ouverte ON demandes_transport (demande_hebergement_id)
  WHERE demande_hebergement_id IS NOT NULL AND statut IN ('a_valider', 'demandee', 'acceptee', 'en_route', 'pris_en_charge');
DROP INDEX IF EXISTS demandes_transport_lit_ouvert;
CREATE UNIQUE INDEX IF NOT EXISTS demandes_transport_lit_ouvert ON demandes_transport (lit_id) WHERE lit_id IS NOT NULL AND statut IN ('a_valider', 'demandee', 'acceptee', 'en_route', 'pris_en_charge');
