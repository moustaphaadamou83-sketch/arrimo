-- =====================================================================================================
-- DSN international (22 nov. 2026). Migration additive et rejouable. DÉMONSTRATION ET RECETTE SEULEMENT : le serveur refuse
-- toute écriture ou lecture clinique ailleurs (src/dsn/garde.js). Patients synthétiques uniquement.
-- Données rattachées au dossier maître existant (table patients). Aucun élément signé n'est supprimé : annulation ou amendement.
-- =====================================================================================================
CREATE TABLE IF NOT EXISTS dsn_habilitations (
  etablissement_id int NOT NULL REFERENCES etablissements(id) ON DELETE CASCADE,
  utilisateur_id   int NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  fonction         text NOT NULL CHECK (fonction IN ('admission', 'infirmier', 'medecin', 'sortie', 'auditeur')),
  accorde_par      int REFERENCES utilisateurs(id),
  accorde_le       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (etablissement_id, utilisateur_id, fonction)
);
CREATE TABLE IF NOT EXISTS dsn_identifiants (
  id          serial PRIMARY KEY,
  patient_id  int  NOT NULL REFERENCES patients(id),
  systeme     text NOT NULL CHECK (length(systeme) BETWEEN 2 AND 60),
  valeur      text NOT NULL CHECK (length(valeur) BETWEEN 1 AND 60),
  cree_le     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (systeme, valeur)
);
CREATE SEQUENCE IF NOT EXISTS dsn_numero_seq START 1000;
-- Éléments cliniques : une seule table typée, versionnée (remplace_id), jamais supprimée
CREATE TABLE IF NOT EXISTS dsn_elements (
  id               serial PRIMARY KEY,
  numero           text NOT NULL UNIQUE,                       -- DSN-001000
  patient_id       int  NOT NULL REFERENCES patients(id),
  etablissement_id int  NOT NULL REFERENCES etablissements(id),
  genre            text NOT NULL CHECK (genre IN ('allergie', 'antecedent', 'rencontre', 'note', 'observation', 'diagnostic', 'prescription', 'examen', 'sejour')),
  rencontre_id     int  REFERENCES dsn_elements(id),
  donnees          jsonb NOT NULL,                              -- champs du genre (validés par src/dsn/clinique.js)
  statut           text NOT NULL,
  version          int  NOT NULL DEFAULT 1,
  remplace_id      int  REFERENCES dsn_elements(id),            -- amendement : nouvelle version, l'ancienne reste lisible
  remplace_par     int  REFERENCES dsn_elements(id),
  auteur_id        int  NOT NULL REFERENCES utilisateurs(id),
  signe_par        int  REFERENCES utilisateurs(id),
  signe_le         timestamptz,
  motif            text CHECK (motif IS NULL OR length(motif) <= 300),
  source           text NOT NULL DEFAULT 'saisie' CHECK (source IN ('saisie', 'transition', 'integration', 'demo')),
  cree_le          timestamptz NOT NULL DEFAULT now(),
  modifie_le       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dsn_elements_patient ON dsn_elements (patient_id, genre, cree_le DESC);
CREATE TABLE IF NOT EXISTS dsn_documents (
  id               serial PRIMARY KEY,
  numero           text NOT NULL UNIQUE,
  patient_id       int  NOT NULL REFERENCES patients(id),
  etablissement_id int  NOT NULL REFERENCES etablissements(id),
  type_doc         text NOT NULL CHECK (type_doc IN ('rapport', 'resultat', 'imagerie', 'lettre', 'consentement', 'autre')),
  titre            text NOT NULL CHECK (length(titre) BETWEEN 2 AND 160),
  mime             text NOT NULL CHECK (mime IN ('application/pdf', 'image/png', 'image/jpeg')),
  taille           int  NOT NULL CHECK (taille BETWEEN 1 AND 5242880),
  sha256           text NOT NULL,
  contenu          bytea NOT NULL,
  version          int  NOT NULL DEFAULT 1,
  remplace_id      int  REFERENCES dsn_documents(id),
  statut           text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'remplace', 'annule')),
  auteur_id        int  NOT NULL REFERENCES utilisateurs(id),
  cree_le          timestamptz NOT NULL DEFAULT now()
);
-- Paquet de transition : contenu CHOISI et validé par un professionnel, figé (instantané) ; seul ce paquet est visible à la destination
CREATE TABLE IF NOT EXISTS dsn_transitions (
  id                 serial PRIMARY KEY,
  numero             text NOT NULL UNIQUE,                     -- TRX-001000
  patient_id         int  NOT NULL REFERENCES patients(id),
  etablissement_id   int  NOT NULL REFERENCES etablissements(id),
  destination_id     int  NOT NULL REFERENCES etablissements(id),
  sejour_id          int  REFERENCES dsn_elements(id),
  contenu            jsonb NOT NULL DEFAULT '{}'::jsonb,
  elements           int[] NOT NULL DEFAULT '{}',
  statut             text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'valide', 'envoye', 'accepte', 'refuse', 'recu', 'annule')),
  valide_par         int REFERENCES utilisateurs(id), valide_le timestamptz,
  envoye_le          timestamptz,
  decision_par       int REFERENCES utilisateurs(id), decision_le timestamptz, motif_refus text,
  recu_par           int REFERENCES utilisateurs(id), recu_le timestamptz,
  arrivee_prevue_le  timestamptz,
  demande_transport_id int REFERENCES demandes_transport(id),
  version            int NOT NULL DEFAULT 1,
  cree_par           int NOT NULL REFERENCES utilisateurs(id),
  cree_le            timestamptz NOT NULL DEFAULT now()
);
-- Journal d'accès au dossier : immuable, sans contenu clinique
CREATE TABLE IF NOT EXISTS dsn_acces (
  id               bigserial PRIMARY KEY,
  utilisateur_id   int  NOT NULL REFERENCES utilisateurs(id),
  patient_id       int  REFERENCES patients(id),
  etablissement_id int  REFERENCES etablissements(id),
  action           text NOT NULL CHECK (action IN ('lecture', 'ecriture', 'signature', 'export', 'partage', 'urgence', 'reception', 'refus')),
  objet            text,
  justification    text CHECK (justification IS NULL OR length(justification) <= 300),
  cree_le          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dsn_acces_patient ON dsn_acces (patient_id, cree_le DESC);
CREATE OR REPLACE FUNCTION dsn_acces_immuable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'dsn_acces est immuable'; END $$;
DROP TRIGGER IF EXISTS dsn_acces_pas_de_modif ON dsn_acces;
CREATE TRIGGER dsn_acces_pas_de_modif BEFORE UPDATE OR DELETE ON dsn_acces FOR EACH ROW EXECUTE FUNCTION dsn_acces_immuable();
-- Accès d'urgence (bris de glace) : justification, 4 h, journalisé
CREATE TABLE IF NOT EXISTS dsn_acces_urgence (
  id               serial PRIMARY KEY,
  utilisateur_id   int  NOT NULL REFERENCES utilisateurs(id),
  patient_id       int  NOT NULL REFERENCES patients(id),
  justification    text NOT NULL CHECK (length(justification) BETWEEN 10 AND 300),
  expire_le        timestamptz NOT NULL,
  cree_le          timestamptz NOT NULL DEFAULT now()
);
-- Horloge : la transition est un objet du parcours (Sillage, Vigilance)
ALTER TABLE horodatages DROP CONSTRAINT IF EXISTS horodatages_objet_check;
ALTER TABLE horodatages ADD CONSTRAINT horodatages_objet_check CHECK (objet IN ('prealerte', 'transfert', 'demande_transport', 'demande_hebergement', 'mission_ccs', 'passage_chrono', 'coordination', 'visite', 'dsn_transition'));
