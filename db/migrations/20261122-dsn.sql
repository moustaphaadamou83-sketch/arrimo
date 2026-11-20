-- =====================================================================================================
-- Connecteur DSN (Epic), lot 1 (22 nov. 2026). Migration additive et rejouable.
-- Correspondance des codes : code du lit ou de la civière dans le DSN → code Arrimo, par connecteur. Aucune donnée de patient.
-- =====================================================================================================
CREATE TABLE IF NOT EXISTS connecteur_correspondances (
  connecteur_id  int  NOT NULL REFERENCES connecteurs(id) ON DELETE CASCADE,
  genre          text NOT NULL CHECK (genre IN ('lit', 'civiere')),
  code_externe   text NOT NULL CHECK (length(code_externe) BETWEEN 1 AND 60),
  code_arrimo    text NOT NULL CHECK (length(code_arrimo) BETWEEN 1 AND 60),
  modifie_le     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connecteur_id, genre, code_externe)
);
