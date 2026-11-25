-- Complémentaire nº 3, §6 (26 nov. 2026) : relève entre équipes (jour, soir, nuit) ; transmission horodatée, accusée par l'équipe entrante.
BEGIN;
CREATE TABLE IF NOT EXISTS releves_equipe (
  id                bigserial PRIMARY KEY,
  etablissement_id  int  NOT NULL REFERENCES etablissements(id),
  quart             text NOT NULL CHECK (quart IN ('jour', 'soir', 'nuit')),
  transmis_par      int  NOT NULL REFERENCES utilisateurs(id),
  transmis_le       timestamptz NOT NULL DEFAULT now(),
  contenu           jsonb NOT NULL,                       -- numéros et compteurs seulement, jamais de donnée clinique
  accuse_par        int REFERENCES utilisateurs(id),
  accuse_le         timestamptz
);
CREATE INDEX IF NOT EXISTS releves_equipe_etab ON releves_equipe (etablissement_id, transmis_le DESC);
COMMIT;
