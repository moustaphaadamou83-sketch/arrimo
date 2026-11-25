-- Chantier coordination, lot 5 « Quotes-parts » (26 nov. 2026, cahier « optimisation transversale » §3).
-- Saisie par un rôle autorisé, historique immuable (une ligne par modification). Aucune formule de marge : non définie officiellement.
-- Activé en démonstration et en recette seulement tant que les règles réelles ne sont pas confirmées par les autorités compétentes.
BEGIN;
CREATE TABLE IF NOT EXISTS quotes_parts (
  id                bigserial PRIMARY KEY,
  etablissement_id  int  NOT NULL REFERENCES etablissements(id),
  ccs_id            int  REFERENCES organisations_secours(id),          -- CCS concerné, si la règle lui est propre
  autorite          text NOT NULL CHECK (length(autorite) BETWEEN 2 AND 120),
  valeur            int  NOT NULL CHECK (valeur BETWEEN 0 AND 500),     -- ambulances attribuées pour la période
  periode_min       int  NOT NULL CHECK (periode_min BETWEEN 15 AND 10080),
  valide_du         timestamptz NOT NULL,
  valide_au         timestamptz,
  exception         text CHECK (exception IN ('aucune', 'delestage_autorise', 'suspension_temporaire', 'protocole_regional')),
  source            text NOT NULL CHECK (source IN ('saisie_manuelle', 'connecteur', 'import')),
  fiabilite         text NOT NULL CHECK (fiabilite IN ('confirmee_autorite', 'declaree', 'a_verifier')),
  saisi_par         int  REFERENCES utilisateurs(id),
  saisi_le          timestamptz NOT NULL DEFAULT now(),
  CHECK (valide_au IS NULL OR valide_au > valide_du)
);
CREATE INDEX IF NOT EXISTS quotes_parts_etab ON quotes_parts (etablissement_id, saisi_le DESC);
DROP TRIGGER IF EXISTS quotes_parts_immuables ON quotes_parts;
CREATE TRIGGER quotes_parts_immuables BEFORE UPDATE OR DELETE ON quotes_parts FOR EACH ROW EXECUTE FUNCTION journal_immuable();
COMMIT;
