-- Règle fondamentale de compatibilité des capacités (cahier nº 19, 26 nov. 2026) : une ressource incompatible n'est attribuée
-- qu'à titre exceptionnel, autorisé, justifié et tracé (registre immuable, lu par Sillage, Vigilance et le centre d'audit).
BEGIN;
CREATE TABLE IF NOT EXISTS reaffectations_exceptionnelles (
  id                bigserial PRIMARY KEY,
  etablissement_id  int  NOT NULL REFERENCES etablissements(id),
  ressource_type    text NOT NULL CHECK (ressource_type IN ('lit', 'civiere')),
  ressource_id      int  NOT NULL,
  objet             text NOT NULL CHECK (objet IN ('demande_admission', 'prealerte', 'transfert', 'evacuation')),
  objet_id          int  NOT NULL,
  motif             text NOT NULL CHECK (motif IN ('debordement_capacite', 'urgence_vitale', 'decision_medicale', 'isolement_requis', 'autre_documente')),
  justification     text NOT NULL CHECK (length(justification) BETWEEN 5 AND 300),
  ecart             jsonb NOT NULL DEFAULT '{}'::jsonb,   -- ce qui n'était pas compatible (type, équipement), sans donnée clinique
  autorise_par      int  NOT NULL REFERENCES utilisateurs(id),
  cree_le           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reaffectations_etab ON reaffectations_exceptionnelles (etablissement_id, cree_le DESC);
DROP TRIGGER IF EXISTS reaffectations_immuables ON reaffectations_exceptionnelles;
CREATE TRIGGER reaffectations_immuables BEFORE UPDATE OR DELETE ON reaffectations_exceptionnelles FOR EACH ROW EXECUTE FUNCTION journal_immuable();
COMMIT;
