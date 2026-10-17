-- Console SH (siège) : base séparée (arrimo_sh). Idempotent, rejouable à chaque installation.
-- Aucune donnée de patient : hôpitaux clients, projet d'implantation, imports (empreinte et compteurs), activations, journal.

CREATE TABLE IF NOT EXISTS sh_utilisateurs (
  id                 serial PRIMARY KEY,
  email              text NOT NULL UNIQUE,
  nom                text NOT NULL,
  mot_de_passe_hash  text NOT NULL,
  mdp_temporaire     boolean NOT NULL DEFAULT true,
  totp_secret        text,
  totp_actif         boolean NOT NULL DEFAULT false,
  totp_dernier_pas   bigint NOT NULL DEFAULT 0,
  actif              boolean NOT NULL DEFAULT true,
  cree_le            timestamptz NOT NULL DEFAULT now(),
  derniere_connexion timestamptz
);

CREATE TABLE IF NOT EXISTS sh_sessions (
  token           text PRIMARY KEY,
  utilisateur_id  int NOT NULL REFERENCES sh_utilisateurs(id) ON DELETE CASCADE,
  expire_le       timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sh_connexions_2fa (
  jeton           text PRIMARY KEY,
  utilisateur_id  int NOT NULL REFERENCES sh_utilisateurs(id) ON DELETE CASCADE,
  expire_le       timestamptz NOT NULL,
  essais          int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hopitaux (
  id                 serial PRIMARY KEY,
  nom                text NOT NULL,
  adresse            text,
  ville              text,
  latitude           double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude          double precision CHECK (longitude BETWEEN -180 AND 180),
  contact_nom        text,
  contact_courriel   text,
  contact_telephone  text,
  environnement      text NOT NULL CHECK (environnement IN ('demo', 'recette', 'production')),
  statut             text NOT NULL DEFAULT 'prospect' CHECK (statut IN ('prospect', 'implantation', 'actif', 'suspendu')),
  code_etab          text NOT NULL CHECK (code_etab ~ '^[A-Z0-9-]{2,12}$'),
  sous_domaine       text,
  relie              boolean NOT NULL DEFAULT false,   -- l'établissement existe dans l'environnement
  cree_le            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environnement, code_etab)
);
CREATE UNIQUE INDEX IF NOT EXISTS hopitaux_sous_domaine ON hopitaux (environnement, sous_domaine) WHERE sous_domaine IS NOT NULL;

-- Projet d'implantation : 7 étapes par hôpital, chacune avec sa liste de vérification
CREATE TABLE IF NOT EXISTS etapes (
  id            serial PRIMARY KEY,
  hopital_id    int NOT NULL REFERENCES hopitaux(id) ON DELETE CASCADE,
  rang          int NOT NULL CHECK (rang BETWEEN 1 AND 7),
  code          text NOT NULL,
  date_prevue   date,
  date_reelle   date,
  responsable   text,
  notes         text,
  UNIQUE (hopital_id, rang)
);
CREATE TABLE IF NOT EXISTS verifications (
  id         serial PRIMARY KEY,
  etape_id   int NOT NULL REFERENCES etapes(id) ON DELETE CASCADE,
  rang       int NOT NULL,
  code       text NOT NULL,
  libelle    text NOT NULL,
  faite      boolean NOT NULL DEFAULT false,
  par        text,
  quand      timestamptz,
  UNIQUE (etape_id, code)
);

-- Imports : empreinte du fichier et compteurs seulement (ni contenu, ni mot de passe)
CREATE TABLE IF NOT EXISTS imports (
  id          serial PRIMARY KEY,
  hopital_id  int NOT NULL REFERENCES hopitaux(id) ON DELETE CASCADE,
  type        text NOT NULL,
  empreinte   text NOT NULL,
  lignes      int NOT NULL,
  creations   int NOT NULL,
  mises_a_jour int NOT NULL,
  inchangees  int NOT NULL,
  auteur      text NOT NULL,
  quand       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activations (
  id          serial PRIMARY KEY,
  hopital_id  int NOT NULL REFERENCES hopitaux(id) ON DELETE CASCADE,
  action      text NOT NULL CHECK (action IN ('activation', 'desactivation')),
  motif       text,
  par         text NOT NULL,
  quand       timestamptz NOT NULL DEFAULT now()
);

-- Journal SH immuable (même principe que les journaux d'Arrimo)
CREATE TABLE IF NOT EXISTS sh_journal (
  id              bigserial PRIMARY KEY,
  date            timestamptz NOT NULL DEFAULT now(),
  utilisateur_id  int REFERENCES sh_utilisateurs(id),
  hopital_id      int REFERENCES hopitaux(id),
  action          text NOT NULL,
  cible           text,
  detail          text
);
CREATE INDEX IF NOT EXISTS sh_journal_date ON sh_journal (date DESC, id DESC);
CREATE OR REPLACE FUNCTION sh_journal_immuable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Le journal SH ne peut pas être modifié ni supprimé';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS sh_journal_pas_de_modif ON sh_journal;
CREATE TRIGGER sh_journal_pas_de_modif BEFORE UPDATE OR DELETE ON sh_journal
  FOR EACH ROW EXECUTE FUNCTION sh_journal_immuable();
DROP TRIGGER IF EXISTS sh_journal_pas_de_vidage ON sh_journal;
CREATE TRIGGER sh_journal_pas_de_vidage BEFORE TRUNCATE ON sh_journal
  FOR EACH STATEMENT EXECUTE FUNCTION sh_journal_immuable();
