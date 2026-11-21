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
-- COR-003 : mode crise — déclaration complète, simulation isolée, accueil confirmé, alertes aux secours compétents
ALTER TABLE evacuations ADD COLUMN IF NOT EXISTS simulation boolean NOT NULL DEFAULT false;
ALTER TABLE evacuations ADD COLUMN IF NOT EXISTS gravite text CHECK (gravite IS NULL OR gravite IN ('moderee', 'elevee', 'critique'));
ALTER TABLE evacuations ADD COLUMN IF NOT EXISTS unites_touchees text CHECK (unites_touchees IS NULL OR length(unites_touchees) <= 300);
ALTER TABLE evacuations ADD COLUMN IF NOT EXISTS point_rassemblement text CHECK (point_rassemblement IS NULL OR length(point_rassemblement) <= 200);
DROP INDEX IF EXISTS evacuations_une_active;
CREATE UNIQUE INDEX IF NOT EXISTS evacuations_une_active ON evacuations (etablissement_id, simulation) WHERE statut = 'active';
ALTER TABLE evacuation_residents DROP CONSTRAINT IF EXISTS evacuation_residents_statut_check;
ALTER TABLE evacuation_residents ADD CONSTRAINT evacuation_residents_statut_check CHECK (statut IN ('a_placer', 'confirme', 'parti', 'arrive', 'accueilli', 'retour_planifie', 'revenu'));
ALTER TABLE evacuation_residents ADD COLUMN IF NOT EXISTS accueilli_le timestamptz;
CREATE TABLE IF NOT EXISTS crise_alertes (
  id               serial PRIMARY KEY,
  evacuation_id    int  NOT NULL REFERENCES evacuations(id),
  organisation_id  int  NOT NULL REFERENCES organisations_secours(id),
  role             text NOT NULL CHECK (role IN ('coordination', 'transport')),
  statut           text NOT NULL DEFAULT 'envoyee' CHECK (statut IN ('envoyee', 'recue', 'acceptee', 'vehicule_affecte', 'refusee', 'escaladee', 'cloturee')),
  simulation       boolean NOT NULL DEFAULT false,
  unite_id         int  REFERENCES unites_secours(id),
  eta_min          int  CHECK (eta_min IS NULL OR eta_min BETWEEN 0 AND 600),
  envoyee_le       timestamptz NOT NULL DEFAULT now(),
  recue_le         timestamptz, acceptee_le timestamptz, affectee_le timestamptz, escaladee_le timestamptz,
  par              int  REFERENCES utilisateurs(id),
  version          int  NOT NULL DEFAULT 1,
  UNIQUE (evacuation_id, organisation_id)
);
