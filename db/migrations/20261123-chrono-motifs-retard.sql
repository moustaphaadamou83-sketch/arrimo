BEGIN;
CREATE TABLE IF NOT EXISTS passages_chrono_motifs (
  id bigserial PRIMARY KEY,
  passage_id int NOT NULL REFERENCES passages_chrono(id),
  auteur_id int NOT NULL REFERENCES utilisateurs(id),
  motif text NOT NULL CHECK (motif IN ('civiere', 'personnel', 'chambre', 'dossier', 'saturation', 'nettoyage', 'technique', 'autre')),
  cree_le timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS passages_chrono_motifs_passage ON passages_chrono_motifs (passage_id, id);
DROP TRIGGER IF EXISTS passages_chrono_motifs_immuables ON passages_chrono_motifs;
CREATE TRIGGER passages_chrono_motifs_immuables BEFORE UPDATE OR DELETE ON passages_chrono_motifs
  FOR EACH ROW EXECUTE FUNCTION journal_immuable();
COMMIT;
