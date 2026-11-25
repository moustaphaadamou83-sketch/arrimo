-- Refonte unifiée, Pilotage « Impact et rentabilité » (26 nov. 2026). Paramètres économiques par établissement (devise libre :
-- CAD, XOF, EUR…), et économies CONSTATÉES saisies avec justificatif (immuables). Les valeurs estimées ne sont jamais des économies réelles.
BEGIN;
CREATE TABLE IF NOT EXISTS parametres_economiques (
  etablissement_id int  NOT NULL REFERENCES etablissements(id),
  cle              text NOT NULL CHECK (cle IN ('cout_heure_ambulance', 'cout_journee_hospitalisation', 'cout_heure_administrative', 'minutes_par_suivi_automatise')),
  valeur           numeric(12,2) NOT NULL CHECK (valeur >= 0),
  devise           text NOT NULL DEFAULT 'CAD' CHECK (devise ~ '^[A-Z]{3}$'),
  source           text NOT NULL CHECK (length(source) BETWEEN 2 AND 200),
  modifie_par      int  REFERENCES utilisateurs(id),
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (etablissement_id, cle)
);
CREATE TABLE IF NOT EXISTS economies_constatees (
  id               bigserial PRIMARY KEY,
  etablissement_id int  NOT NULL REFERENCES etablissements(id),
  periode_debut    date NOT NULL,
  periode_fin      date NOT NULL,
  categorie        text NOT NULL CHECK (categorie IN ('heures_ambulancieres', 'journees_nsa', 'capacite', 'administratif', 'autre')),
  montant          numeric(14,2) NOT NULL CHECK (montant >= 0),
  devise           text NOT NULL CHECK (devise ~ '^[A-Z]{3}$'),
  justificatif     text NOT NULL CHECK (length(justificatif) BETWEEN 5 AND 300),
  saisi_par        int  REFERENCES utilisateurs(id),
  saisi_le         timestamptz NOT NULL DEFAULT now(),
  CHECK (periode_fin >= periode_debut)
);
DROP TRIGGER IF EXISTS economies_constatees_immuables ON economies_constatees;
CREATE TRIGGER economies_constatees_immuables BEFORE UPDATE OR DELETE ON economies_constatees FOR EACH ROW EXECUTE FUNCTION journal_immuable();
COMMIT;
