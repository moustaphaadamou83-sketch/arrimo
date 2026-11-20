-- =====================================================================================================
-- Module 🎓 Formation (22 nov. 2026, lot 1). Migration additive et rejouable ; aucune donnée existante modifiée.
-- Progression par personne et par capsule, essais (quiz, exercices), parcours choisis. Le catalogue est dans le code
-- (src/formation-catalogue.js). Aucune donnée de patient.
-- =====================================================================================================
ALTER TABLE organisations_secours ADD COLUMN IF NOT EXISTS formation boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS formation_choix (
  utilisateur_id  int  NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  parcours        text NOT NULL CHECK (parcours ~ '^[a-z_]{2,30}$'),
  choisi_le       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (utilisateur_id, parcours)
);
CREATE TABLE IF NOT EXISTS formation_progression (
  utilisateur_id  int  NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  capsule         text NOT NULL CHECK (capsule ~ '^[A-Z]{1,2}[0-9]{1,2}$'),
  vu_le           timestamptz,
  pratique_le     timestamptz,
  reussi_le       timestamptz,
  meilleur_score  int CHECK (meilleur_score BETWEEN 0 AND 100),
  essais          int NOT NULL DEFAULT 0,
  quiz_debut_le   timestamptz,                -- début du test, pour le chronométrer côté serveur
  quiz_reussi_le  timestamptz,                -- mini-test réussi
  exercice_etat   jsonb,                      -- exercice guidé en cours : étape, erreurs (état tenu par le serveur)
  maj_le          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (utilisateur_id, capsule)
);
CREATE TABLE IF NOT EXISTS formation_essais (
  id              bigserial PRIMARY KEY,
  utilisateur_id  int  NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  capsule         text NOT NULL,
  genre           text NOT NULL CHECK (genre IN ('quiz', 'exercice')),
  score           int  NOT NULL CHECK (score BETWEEN 0 AND 100),
  reussi          boolean NOT NULL,
  duree_ms        int,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  cree_le         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS formation_essais_utilisateur ON formation_essais (utilisateur_id, capsule, cree_le);
-- Rejouable sur une base où la table existe déjà (lot 1 appliqué sur une copie)
ALTER TABLE formation_progression ADD COLUMN IF NOT EXISTS quiz_reussi_le timestamptz;
ALTER TABLE formation_progression ADD COLUMN IF NOT EXISTS exercice_etat jsonb;
-- Lot 5 (22 nov. 2026) : attestations, superutilisateurs par établissement, satisfaction en fin de parcours
CREATE SEQUENCE IF NOT EXISTS formation_attestation_seq;
CREATE TABLE IF NOT EXISTS formation_attestations (
  id              serial PRIMARY KEY,
  numero          text NOT NULL UNIQUE,                 -- AT-000001
  utilisateur_id  int  NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  parcours        text NOT NULL,
  emise_le        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (utilisateur_id, parcours)
);
CREATE TABLE IF NOT EXISTS formation_superutilisateurs (
  etablissement_id int NOT NULL REFERENCES etablissements(id) ON DELETE CASCADE,
  utilisateur_id   int NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  designe_par      int REFERENCES utilisateurs(id),
  designe_le       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (etablissement_id, utilisateur_id)
);
CREATE TABLE IF NOT EXISTS formation_satisfaction (
  utilisateur_id  int  NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  parcours        text NOT NULL,
  note            int  NOT NULL CHECK (note BETWEEN 1 AND 5),
  commentaire     text CHECK (commentaire IS NULL OR length(commentaire) <= 500),
  cree_le         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (utilisateur_id, parcours)
);
