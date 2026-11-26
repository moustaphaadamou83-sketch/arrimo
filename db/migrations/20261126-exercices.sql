-- Exercice de formation isolé avec injection d'événements (complémentaire nº 3, §9 ; 26 nov. 2026).
-- Démonstration et recette seulement. Les événements injectés sont des messages d'exercice : aucun lit, civière ni transfert réel n'est modifié.
BEGIN;
CREATE TABLE IF NOT EXISTS exercices (
  id                bigserial PRIMARY KEY,
  etablissement_id  int  NOT NULL REFERENCES etablissements(id),
  titre             text NOT NULL CHECK (length(titre) BETWEEN 2 AND 120),
  statut            text NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'termine')),
  cree_par          int  NOT NULL REFERENCES utilisateurs(id),
  debut_le          timestamptz NOT NULL DEFAULT now(),
  fin_le            timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS exercices_un_en_cours ON exercices (etablissement_id) WHERE statut = 'en_cours';
CREATE TABLE IF NOT EXISTS exercice_evenements (
  id                bigserial PRIMARY KEY,
  exercice_id       bigint NOT NULL REFERENCES exercices(id),
  type              text NOT NULL CHECK (type IN ('afflux_ambulances', 'lit_bloque', 'connecteur_silencieux', 'evacuation_partielle', 'transfert_sans_reponse', 'penurie_personnel')),
  injecte_par       int  NOT NULL REFERENCES utilisateurs(id),
  injecte_le        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS exercice_reponses (
  id                bigserial PRIMARY KEY,
  evenement_id      bigint NOT NULL REFERENCES exercice_evenements(id),
  action            text NOT NULL CHECK (action IN ('escalader', 'reaffecter', 'demander_transfert', 'activer_crise', 'informer_reseau', 'suspendre_connecteur', 'rappeler_personnel', 'aucune_action')),
  repondu_par       int  NOT NULL REFERENCES utilisateurs(id),
  repondu_le        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exercice_reponses_ev ON exercice_reponses (evenement_id, repondu_le);
DROP TRIGGER IF EXISTS exercice_evenements_immuables ON exercice_evenements;
CREATE TRIGGER exercice_evenements_immuables BEFORE UPDATE OR DELETE ON exercice_evenements FOR EACH ROW EXECUTE FUNCTION journal_immuable();
DROP TRIGGER IF EXISTS exercice_reponses_immuables ON exercice_reponses;
CREATE TRIGGER exercice_reponses_immuables BEFORE UPDATE OR DELETE ON exercice_reponses FOR EACH ROW EXECUTE FUNCTION journal_immuable();
COMMIT;
