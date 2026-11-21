-- =====================================================================================================
-- DSN natif (23 nov. 2026) : synchronisation contrôlée DSN ↔ Lits, Admissions, Transferts, Transport, Sillage. Additive et rejouable.
-- =====================================================================================================
-- Un séjour peut naître d'un autre module (Lits, connecteur) : l'auteur peut être absent (événement système), la source est notée.
ALTER TABLE dsn_elements ALTER COLUMN auteur_id DROP NOT NULL;
-- Liens d'une transition avec les objets opérationnels (idempotence : un seul de chaque, jamais recréé)
ALTER TABLE dsn_transitions ADD COLUMN IF NOT EXISTS dossier_patient_id int REFERENCES patients(id);
ALTER TABLE dsn_transitions ADD COLUMN IF NOT EXISTS demande_hebergement_id int REFERENCES demandes_hebergement(id);
ALTER TABLE dsn_transitions ADD COLUMN IF NOT EXISTS transfert_id int REFERENCES transferts(id);
ALTER TABLE dsn_transitions ADD COLUMN IF NOT EXISTS depart_le timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS dsn_transitions_transport_unique ON dsn_transitions (demande_transport_id) WHERE demande_transport_id IS NOT NULL;
-- Historique des événements du parcours (sans contenu clinique) : auteur (ou système), source, statut, horodatage ; immuable
CREATE TABLE IF NOT EXISTS dsn_evenements (
  id               bigserial PRIMARY KEY,
  patient_id       int  REFERENCES patients(id),
  etablissement_id int  NOT NULL REFERENCES etablissements(id),
  type             text NOT NULL CHECK (length(type) BETWEEN 2 AND 60),
  source           text NOT NULL CHECK (source IN ('dsn', 'lits', 'transferts', 'transport', 'hebergement', 'systeme')),
  objet            text CHECK (objet IS NULL OR length(objet) <= 120),
  statut           text NOT NULL CHECK (length(statut) BETWEEN 2 AND 40),
  auteur_id        int  REFERENCES utilisateurs(id),
  cree_le          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dsn_evenements_patient ON dsn_evenements (patient_id, cree_le DESC);
CREATE OR REPLACE FUNCTION dsn_evenements_immuable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'dsn_evenements est immuable'; END $$;
DROP TRIGGER IF EXISTS dsn_evenements_pas_de_modif ON dsn_evenements;
CREATE TRIGGER dsn_evenements_pas_de_modif BEFORE UPDATE OR DELETE ON dsn_evenements FOR EACH ROW EXECUTE FUNCTION dsn_evenements_immuable();
-- Source d'un élément : aussi « lits » (séjour né d'une admission confirmée dans Lits)
ALTER TABLE dsn_elements DROP CONSTRAINT IF EXISTS dsn_elements_source_check;
ALTER TABLE dsn_elements ADD CONSTRAINT dsn_elements_source_check CHECK (source IN ('saisie', 'transition', 'integration', 'demo', 'lits'));
