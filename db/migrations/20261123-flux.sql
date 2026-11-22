-- =====================================================================================================
-- Cahier ultime (21 nov. 2026) : préalerte d'arrivée des transports vers l'hébergement, Arrimo Connect (messagerie interne). Additive.
-- =====================================================================================================
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS prealerte_le timestamptz;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS prealerte_eta_min int CHECK (prealerte_eta_min IS NULL OR prealerte_eta_min BETWEEN 0 AND 600);
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS prealerte_eta_le timestamptz;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS prealerte_recue_le timestamptz;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS prealerte_recue_par int REFERENCES utilisateurs(id);
-- Arrimo Connect (addendum du 21 nov. 2026) : messagerie professionnelle interne, limitée à l'établissement
CREATE TABLE IF NOT EXISTS connect_messages (
  id               serial PRIMARY KEY,
  etablissement_id int  NOT NULL REFERENCES etablissements(id),
  fil_id           int  REFERENCES connect_messages(id),
  expediteur_id    int  NOT NULL REFERENCES utilisateurs(id),
  destinataire_id  int  REFERENCES utilisateurs(id),
  boite            text CHECK (boite IS NULL OR boite = 'administration'),
  categorie        text NOT NULL DEFAULT 'message' CHECK (categorie IN ('message', 'materiel', 'technique', 'administratif', 'planning', 'soutien', 'signalement', 'autre')),
  sujet            text CHECK (sujet IS NULL OR length(sujet) <= 120),
  corps            text NOT NULL CHECK (length(corps) BETWEEN 1 AND 4000),
  priorite         text NOT NULL DEFAULT 'normale' CHECK (priorite IN ('normale', 'haute')),
  statut           text CHECK (statut IS NULL OR statut IN ('ouverte', 'en_cours', 'resolue')),
  traite_par       int  REFERENCES utilisateurs(id),
  cree_le          timestamptz NOT NULL DEFAULT now(),
  CHECK ((destinataire_id IS NOT NULL) <> (boite IS NOT NULL) OR fil_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS connect_messages_fil ON connect_messages (COALESCE(fil_id, id), cree_le);
CREATE INDEX IF NOT EXISTS connect_messages_etab ON connect_messages (etablissement_id, cree_le DESC);
CREATE TABLE IF NOT EXISTS connect_lectures (
  message_id     int NOT NULL REFERENCES connect_messages(id),
  utilisateur_id int NOT NULL REFERENCES utilisateurs(id),
  lu_le          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, utilisateur_id)
);
CREATE TABLE IF NOT EXISTS connect_annonces (
  id               serial PRIMARY KEY,
  etablissement_id int  NOT NULL REFERENCES etablissements(id),
  auteur_id        int  NOT NULL REFERENCES utilisateurs(id),
  titre            text NOT NULL CHECK (length(titre) BETWEEN 2 AND 120),
  corps            text NOT NULL CHECK (length(corps) BETWEEN 1 AND 4000),
  roles            text[] NOT NULL DEFAULT '{}',
  cree_le          timestamptz NOT NULL DEFAULT now()
);
-- États complets d'une mission de transport (cahier ultime, 11.3) : étapes horodatées, sans changer les statuts existants
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS sur_place_le timestamptz;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS remis_le timestamptz;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS terminee_le timestamptz;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS incident_le timestamptz;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS incident_motif text CHECK (incident_motif IS NULL OR length(incident_motif) <= 300);
-- Personnel & Tâches (22 nov. 2026) : attribution nominative (moteur unique : taches_etab) ; NULL = file du rôle / non attribuée
ALTER TABLE taches_etab ADD COLUMN IF NOT EXISTS assigne_a int REFERENCES utilisateurs(id);
-- Paramètres propres aux modules (cahier Personnel & Tâches, section 19) : par établissement, distincts des paramètres généraux
CREATE TABLE IF NOT EXISTS parametres_modules (
  etablissement_id int  NOT NULL REFERENCES etablissements(id),
  module           text NOT NULL CHECK (module IN ('taches', 'nettoyage')),
  valeurs          jsonb NOT NULL DEFAULT '{}'::jsonb,
  maj_par          int REFERENCES utilisateurs(id),
  maj_le           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (etablissement_id, module)
);
-- Arrimo Connect : conversations de groupe autorisées (membres du même établissement) ; lisibles par les participants seulement
CREATE TABLE IF NOT EXISTS connect_participants (
  fil_id         int NOT NULL REFERENCES connect_messages(id),
  utilisateur_id int NOT NULL REFERENCES utilisateurs(id),
  PRIMARY KEY (fil_id, utilisateur_id)
);
-- Personnel & Tâches : notification de retard envoyée une seule fois par tâche (pas de répétition)
ALTER TABLE taches_etab ADD COLUMN IF NOT EXISTS retard_notifie_le timestamptz;
