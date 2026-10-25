-- Simulation explicite : désactivée par défaut, sans données injectées.
CREATE TABLE IF NOT EXISTS connecteurs_simulation_config (
  connecteur_id int PRIMARY KEY REFERENCES connecteurs(id),
  actif boolean NOT NULL DEFAULT false,
  configure_par int NOT NULL REFERENCES utilisateurs(id),
  configure_le timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS connecteurs_correspondances (
  connecteur_id int NOT NULL REFERENCES connecteurs(id),
  genre text NOT NULL CHECK (genre IN ('patient','lit','civiere','type_unite','demande','transfert','etablissement')),
  reference_externe text NOT NULL,
  valeur_locale text NOT NULL,
  cree_par int NOT NULL REFERENCES utilisateurs(id),
  cree_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connecteur_id, genre, reference_externe)
);
CREATE TABLE IF NOT EXISTS connecteurs_simulation_flux (
  connecteur_id int NOT NULL REFERENCES connecteurs(id),
  flux text NOT NULL,
  derniere_sequence bigint NOT NULL DEFAULT 0 CHECK (derniere_sequence >= 0),
  derniere_date_source timestamptz,
  PRIMARY KEY (connecteur_id, flux)
);
CREATE TABLE IF NOT EXISTS connecteurs_simulation_evenements (
  connecteur_id int NOT NULL REFERENCES connecteurs(id),
  identifiant text NOT NULL,
  flux text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  empreinte text NOT NULL,
  evenement text NOT NULL,
  donnees jsonb NOT NULL,
  acteur_id int NOT NULL REFERENCES utilisateurs(id),
  date_source timestamptz NOT NULL,
  recu_le timestamptz NOT NULL DEFAULT now(),
  dernier_essai_le timestamptz NOT NULL DEFAULT now(),
  tentatives int NOT NULL DEFAULT 1,
  traite_le timestamptz,
  statut text NOT NULL CHECK (statut IN ('applique','en_attente','conflit','rejete')),
  detail text,
  resultat jsonb,
  PRIMARY KEY (connecteur_id, identifiant)
);
CREATE UNIQUE INDEX IF NOT EXISTS simulation_sequence_appliquee_unique
  ON connecteurs_simulation_evenements(connecteur_id, flux, sequence) WHERE statut = 'applique';
