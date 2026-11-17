-- Migration additive des lots A et B du parcours NSA (17 nov. 2026), identique à la fin de db/schema.sql ; rejouable.

-- =====================================================================================================
-- Parcours NSA vers l'hébergement, lot A (17 nov. 2026, cahier docs/cahier-nsa-hebergement.md)
-- Épisode NSA par patient : date de début saisie par l'équipe, orientation élargie, place transitoire, historique.
-- Besoins en catégories fermées (aucun diagnostic, aucun texte libre clinique) : jamais dans le journal ni les notifications.
-- lits.nsa_depuis / lits.nsa_orientation restent l'état courant (vues, indicateurs) ; l'épisode suit, par déclencheur.
-- =====================================================================================================
-- Orientation élargie : « chsld » reste le code du CHSLD public (aucune donnée à convertir)
ALTER TABLE lits DROP CONSTRAINT IF EXISTS lits_nsa_orientation_check;
ALTER TABLE lits ADD CONSTRAINT lits_nsa_orientation_check CHECK (nsa_orientation IN ('chsld', 'chsld_prive_conventionne', 'chsld_prive', 'ri', 'rtf', 'rpa',
  'maison_aines', 'domicile', 'readaptation', 'palliatif', 'autre'));

CREATE TABLE IF NOT EXISTS nsa_episodes (
  id                 serial PRIMARY KEY,
  etablissement_id   int  NOT NULL REFERENCES etablissements(id),
  lit_id             int  NOT NULL REFERENCES lits(id),
  patient_ref        text,
  debut_le           timestamptz NOT NULL,
  orientation        text,
  transitoire        boolean NOT NULL DEFAULT false,   -- l'équipe accepte une place transitoire en attendant la place permanente
  statut             text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'retire', 'parti')),
  declare_par        int REFERENCES utilisateurs(id),
  fin_le             timestamptz,
  version            int  NOT NULL DEFAULT 1,
  cree_le            timestamptz NOT NULL DEFAULT now(),
  modifie_le         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS nsa_episodes_lit_actif ON nsa_episodes (lit_id) WHERE statut = 'actif';
CREATE INDEX IF NOT EXISTS nsa_episodes_etab ON nsa_episodes (etablissement_id, statut);

-- Historique des orientations décidées par l'équipe (qui, quand) ; codes seulement
CREATE TABLE IF NOT EXISTS nsa_orientations (
  id                 bigserial PRIMARY KEY,
  episode_id         int  NOT NULL REFERENCES nsa_episodes(id),
  orientation        text,
  transitoire        boolean NOT NULL DEFAULT false,
  par                int REFERENCES utilisateurs(id),
  le                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nsa_orientations_episode ON nsa_orientations (episode_id, le);

-- Besoins en catégories (Loi 25 : renseignements de santé minimaux, inscrits à l'EFVP) ; accès : équipe et coordination de l'hôpital
CREATE TABLE IF NOT EXISTS nsa_besoins (
  episode_id         int PRIMARY KEY REFERENCES nsa_episodes(id),
  codes              text[] NOT NULL DEFAULT '{}' CHECK (codes <@ ARRAY['marchette', 'fauteuil', 'leve_personne', 'unite_securisee', 'oxygene', 'soins_particuliers']::text[]),
  chambre_sexe       text NOT NULL DEFAULT 'indifferent' CHECK (chambre_sexe IN ('indifferent', 'F', 'M')),
  langue             text CHECK (langue IS NULL OR langue IN ('fr', 'en', 'autre')),
  municipalite_famille text CHECK (municipalite_famille IS NULL OR char_length(municipalite_famille) BETWEEN 2 AND 80),
  preferences        int[] NOT NULL DEFAULT '{}' CHECK (cardinality(preferences) <= 3),
  version            int  NOT NULL DEFAULT 1,
  modifie_par        int REFERENCES utilisateurs(id),
  modifie_le         timestamptz NOT NULL DEFAULT now()
);

-- L'épisode suit le lit : ouvert quand le lit devient NSA, synchronisé (début, orientation), fermé quand le statut est retiré
-- (« retire ») ou que le patient quitte le lit (« parti », via regles.js). Couvre aussi les scripts de démonstration.
CREATE OR REPLACE FUNCTION nsa_episode_suivre() RETURNS trigger AS $$
BEGIN
  IF NEW.nsa_depuis IS NOT NULL THEN
    UPDATE nsa_episodes SET debut_le = NEW.nsa_depuis, orientation = NEW.nsa_orientation, patient_ref = NEW.patient_ref, modifie_le = now()
     WHERE lit_id = NEW.id AND statut = 'actif'
       AND (debut_le, orientation, patient_ref) IS DISTINCT FROM (NEW.nsa_depuis, NEW.nsa_orientation, NEW.patient_ref);
    IF NOT EXISTS (SELECT 1 FROM nsa_episodes WHERE lit_id = NEW.id AND statut = 'actif') THEN
      INSERT INTO nsa_episodes (etablissement_id, lit_id, patient_ref, debut_le, orientation) VALUES (NEW.etablissement_id, NEW.id, NEW.patient_ref, NEW.nsa_depuis, NEW.nsa_orientation);
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.nsa_depuis IS NOT NULL THEN
    UPDATE nsa_episodes SET statut = CASE WHEN NEW.etat = 'occupe' THEN 'retire' ELSE 'parti' END, fin_le = now(), version = version + 1, modifie_le = now()
     WHERE lit_id = NEW.id AND statut = 'actif';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS lits_nsa_episode ON lits;
CREATE TRIGGER lits_nsa_episode AFTER INSERT OR UPDATE OF nsa_depuis, nsa_orientation, patient_ref, etat ON lits
  FOR EACH ROW EXECUTE FUNCTION nsa_episode_suivre();
-- Reprise des lits déjà NSA (rejouable : seulement ceux sans épisode actif)
INSERT INTO nsa_episodes (etablissement_id, lit_id, patient_ref, debut_le, orientation)
SELECT l.etablissement_id, l.id, l.patient_ref, l.nsa_depuis, l.nsa_orientation FROM lits l
 WHERE l.nsa_depuis IS NOT NULL AND NOT EXISTS (SELECT 1 FROM nsa_episodes e WHERE e.lit_id = l.id AND e.statut = 'actif');

-- =====================================================================================================
-- Parcours NSA vers l'hébergement, lot B (17 nov. 2026) : capacités déclarées par les ressources, places à venir,
-- poids du classement réglables par établissement. Arrimo propose des places compatibles et explique pourquoi ; l'équipe choisit.
-- Aucune donnée de patient dans ces tables.
-- =====================================================================================================
CREATE TABLE IF NOT EXISTS ressource_profils (
  etablissement_id   int PRIMARY KEY REFERENCES etablissements(id),
  statut_ressource   text NOT NULL DEFAULT 'public' CHECK (statut_ressource IN ('public', 'conventionne', 'prive')),
  circuit            text NOT NULL DEFAULT 'mecanisme_acces' CHECK (circuit IN ('mecanisme_acces', 'direct')),
  capacites          text[] NOT NULL DEFAULT '{}' CHECK (capacites <@ ARRAY['marchette', 'fauteuil', 'leve_personne', 'unite_securisee', 'oxygene', 'soins_particuliers']::text[]),
  sexes              text NOT NULL DEFAULT 'mixte' CHECK (sexes IN ('mixte', 'F', 'M')),
  langues            text[] NOT NULL DEFAULT '{fr}' CHECK (langues <@ ARRAY['fr', 'en', 'autre']::text[]),
  delai_admission_jours int NOT NULL DEFAULT 0 CHECK (delai_admission_jours BETWEEN 0 AND 90),
  accepte_transitoire boolean NOT NULL DEFAULT false,
  version            int NOT NULL DEFAULT 1,
  modifie_par        int REFERENCES utilisateurs(id),
  modifie_le         timestamptz NOT NULL DEFAULT now()
);

-- Places qui vont se libérer (départ prévu), déclarées par la ressource ; sans identité ni motif clinique.
-- Ignorées automatiquement le lendemain de la date prévue si elles n'ont pas été mises à jour.
CREATE TABLE IF NOT EXISTS places_a_venir (
  id                 serial PRIMARY KEY,
  etablissement_id   int NOT NULL REFERENCES etablissements(id),
  lit_id             int REFERENCES lits(id),
  date_prevue        date NOT NULL,
  certitude          text NOT NULL DEFAULT 'probable' CHECK (certitude IN ('confirmee', 'probable')),
  statut             text NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte', 'liberee', 'annulee')),
  version            int NOT NULL DEFAULT 1,
  cree_par           int REFERENCES utilisateurs(id),
  cree_le            timestamptz NOT NULL DEFAULT now(),
  modifie_le         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS places_a_venir_etab ON places_a_venir (etablissement_id, statut, date_prevue);

-- Poids du classement des places (total 100, contrôlé), par établissement demandeur ; absent = barème par défaut
CREATE TABLE IF NOT EXISTS nsa_poids (
  etablissement_id   int PRIMARY KEY REFERENCES etablissements(id),
  preference         int NOT NULL CHECK (preference BETWEEN 0 AND 100),
  proximite          int NOT NULL CHECK (proximite BETWEEN 0 AND 100),
  delai              int NOT NULL CHECK (delai BETWEEN 0 AND 100),
  langue             int NOT NULL CHECK (langue BETWEEN 0 AND 100),
  reactivite         int NOT NULL CHECK (reactivite BETWEEN 0 AND 100),
  penalite_refus     int NOT NULL DEFAULT 10 CHECK (penalite_refus BETWEEN 0 AND 50),
  horizon_jours      int NOT NULL DEFAULT 14 CHECK (horizon_jours BETWEEN 1 AND 60),
  version            int NOT NULL DEFAULT 1,
  modifie_par        int REFERENCES utilisateurs(id),
  modifie_le         timestamptz NOT NULL DEFAULT now(),
  CHECK (preference + proximite + delai + langue + reactivite = 100)
);
