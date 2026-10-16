-- Arrimo : schéma PostgreSQL
-- Hiérarchie : établissement > unité > chambre > lit. Aucune donnée médicale : référence patient seulement.

CREATE TABLE IF NOT EXISTS config_pays (
  id                   serial PRIMARY KEY,
  code                 text NOT NULL UNIQUE,
  nom                  text NOT NULL,
  rayon_km             int  NOT NULL DEFAULT 250 CHECK (rayon_km > 0),
  horizon_h            int  NOT NULL DEFAULT 4   CHECK (horizon_h > 0),
  nettoyage_cible_min  int  NOT NULL DEFAULT 45  CHECK (nettoyage_cible_min > 0),
  reservation_max_min  int  NOT NULL DEFAULT 120 CHECK (reservation_max_min > 0),
  marge_conge_min      int  NOT NULL DEFAULT 60  CHECK (marge_conge_min > 0),
  hors_service_max_h   int  NOT NULL DEFAULT 24  CHECK (hors_service_max_h > 0),
  reference_regex      text NOT NULL DEFAULT '^P-[0-9]{5}$',
  reference_exemple    text NOT NULL DEFAULT 'P-00000',
  transport_libelle    text NOT NULL DEFAULT 'Ambulance (M2)',
  fuseau               text NOT NULL DEFAULT 'America/Toronto'
);

CREATE TABLE IF NOT EXISTS types_unite (
  id         serial PRIMARY KEY,
  config_id  int  NOT NULL REFERENCES config_pays(id) ON DELETE CASCADE,
  code       text NOT NULL,
  nom        text NOT NULL,
  ordre      int  NOT NULL DEFAULT 10,
  UNIQUE (config_id, code)
);

CREATE TABLE IF NOT EXISTS etablissements (
  id            serial PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  nom           text NOT NULL,
  ville         text,
  latitude      double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude     double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  config_id     int  NOT NULL REFERENCES config_pays(id),
  partage       text NOT NULL DEFAULT 'agrege' CHECK (partage IN ('complet', 'agrege', 'aucun')),
  module_actif  boolean NOT NULL DEFAULT false,   -- activation gérée depuis SH
  actif         boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS utilisateurs (
  id                 serial PRIMARY KEY,
  email              text NOT NULL UNIQUE,
  nom                text NOT NULL,
  mot_de_passe_hash  text NOT NULL,
  role               text NOT NULL DEFAULT 'coordonnateur' CHECK (role IN ('coordonnateur', 'gestionnaire')),
  actif              boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS utilisateur_etablissements (
  utilisateur_id    int NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  etablissement_id  int NOT NULL REFERENCES etablissements(id) ON DELETE CASCADE,
  PRIMARY KEY (utilisateur_id, etablissement_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token           text PRIMARY KEY,
  utilisateur_id  int NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  expire_le       timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS unites (
  id                serial PRIMARY KEY,
  etablissement_id  int  NOT NULL REFERENCES etablissements(id),
  type_id           int  NOT NULL REFERENCES types_unite(id),
  nom               text NOT NULL
);

CREATE TABLE IF NOT EXISTS chambres (
  id        serial PRIMARY KEY,
  unite_id  int  NOT NULL REFERENCES unites(id),
  numero    text NOT NULL,
  UNIQUE (unite_id, numero)
);

CREATE TABLE IF NOT EXISTS transferts (
  id               serial PRIMARY KEY,
  numero           text NOT NULL UNIQUE,
  patient_ref      text NOT NULL,
  origine_id       int  NOT NULL REFERENCES etablissements(id),
  destination_id   int  NOT NULL REFERENCES etablissements(id),
  type_id          int  NOT NULL REFERENCES types_unite(id),
  lit_id           int,
  urgent           boolean NOT NULL DEFAULT false,
  statut           text NOT NULL DEFAULT 'demande'
                   CHECK (statut IN ('demande', 'validee', 'transport', 'en_route', 'recu', 'refuse')),
  distance_km      int,
  transport_info   text,
  motif_refus      text,
  demande_par      int REFERENCES utilisateurs(id),
  date_demande     timestamptz NOT NULL DEFAULT now(),
  date_validation  timestamptz,
  date_depart      timestamptz,
  date_reception   timestamptz,
  CHECK (origine_id <> destination_id)
);
CREATE SEQUENCE IF NOT EXISTS transfert_seq;

CREATE TABLE IF NOT EXISTS lits (
  id                serial PRIMARY KEY,
  chambre_id        int  NOT NULL REFERENCES chambres(id),
  unite_id          int  NOT NULL REFERENCES unites(id),
  type_id           int  NOT NULL REFERENCES types_unite(id),
  etablissement_id  int  NOT NULL REFERENCES etablissements(id),
  code              text NOT NULL,
  etat              text NOT NULL DEFAULT 'libre'
                    CHECK (etat IN ('libre', 'reserve', 'occupe', 'nettoyage', 'indispo')),
  patient_ref       text,
  version           int  NOT NULL DEFAULT 1,
  etat_depuis       timestamptz NOT NULL DEFAULT now(),
  sortie_prevue     timestamptz,
  transfert_id      int REFERENCES transferts(id),
  blocage_niveau    text CHECK (blocage_niveau IN ('eleve', 'modere', 'faible')),
  blocage_motif     text,
  UNIQUE (chambre_id, code),
  -- un patient seulement sur un lit réservé ou occupé
  CHECK ((etat IN ('reserve', 'occupe')) = (patient_ref IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS lits_etab_etat ON lits (etablissement_id, etat);
CREATE INDEX IF NOT EXISTS lits_type_etat ON lits (type_id, etat);

DO $$ BEGIN
  ALTER TABLE transferts ADD CONSTRAINT transferts_lit_fk FOREIGN KEY (lit_id) REFERENCES lits(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Journal : qui a changé quoi, quand. Les refus aussi.
CREATE TABLE IF NOT EXISTS journal (
  id                bigserial PRIMARY KEY,
  date              timestamptz NOT NULL DEFAULT now(),
  lit_id            int  REFERENCES lits(id),
  etablissement_id  int  NOT NULL REFERENCES etablissements(id),
  utilisateur_id    int  REFERENCES utilisateurs(id),
  action            text NOT NULL,
  ancien_etat       text,
  nouvel_etat       text,
  detail            text,
  refuse            boolean NOT NULL DEFAULT false,
  transfert_id      int REFERENCES transferts(id)
);
CREATE INDEX IF NOT EXISTS journal_etab_date ON journal (etablissement_id, date DESC);
CREATE INDEX IF NOT EXISTS journal_transfert ON journal (transfert_id);

-- Le journal est immuable, même pour un accès direct à la base
CREATE OR REPLACE FUNCTION journal_immuable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Le journal ne peut pas être modifié ni supprimé';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS journal_pas_de_modif ON journal;
CREATE TRIGGER journal_pas_de_modif BEFORE UPDATE OR DELETE ON journal
  FOR EACH ROW EXECUTE FUNCTION journal_immuable();
DROP TRIGGER IF EXISTS journal_pas_de_vidage ON journal;
CREATE TRIGGER journal_pas_de_vidage BEFORE TRUNCATE ON journal
  FOR EACH STATEMENT EXECUTE FUNCTION journal_immuable();

CREATE TABLE IF NOT EXISTS notifications (
  id                bigserial PRIMARY KEY,
  etablissement_id  int  NOT NULL REFERENCES etablissements(id),
  transfert_id      int  REFERENCES transferts(id),
  message           text NOT NULL,
  lu                boolean NOT NULL DEFAULT false,
  date              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notif_etab ON notifications (etablissement_id, lu, date DESC);

-- ======================================================================
-- Version 2 : problèmes réels du terrain
-- ======================================================================

-- Rôle entretien (écran Nettoyage seulement) et rôle connecteur (systèmes externes)
ALTER TABLE utilisateurs DROP CONSTRAINT IF EXISTS utilisateurs_role_check;
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_role_check
  CHECK (role IN ('coordonnateur', 'gestionnaire', 'entretien'));

-- Seuils d'alerte et protocoles, par pays
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS seuil_jaune int NOT NULL DEFAULT 85;
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS seuil_orange int NOT NULL DEFAULT 95;
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS seuil_rouge int NOT NULL DEFAULT 100;
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS attente_admission_max_min int NOT NULL DEFAULT 240;
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS cible_nsa_pct int NOT NULL DEFAULT 8;
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS protocoles jsonb NOT NULL DEFAULT '{
  "vert": "Fonctionnement normal.",
  "jaune": "Revoir les congés prévus aujourd’hui et accélérer les nettoyages.",
  "orange": "Réunion de gestion des lits immédiate, confirmer les congés avant midi, préparer des transferts sortants.",
  "rouge": "Plan de débordement : ouvrir les lits de surcapacité, transferts sortants prioritaires, aviser la coordination régionale."
}';

-- Caractéristiques des lits (pour respecter les besoins du patient)
ALTER TABLE lits ADD COLUMN IF NOT EXISTS isolement boolean NOT NULL DEFAULT false;
ALTER TABLE lits ADD COLUMN IF NOT EXISTS pression_negative boolean NOT NULL DEFAULT false;
ALTER TABLE lits ADD COLUMN IF NOT EXISTS ventilation boolean NOT NULL DEFAULT false;
ALTER TABLE lits ADD COLUMN IF NOT EXISTS telemetrie boolean NOT NULL DEFAULT false;
-- Motif d'indisponibilité : voir la capacité perdue faute de personnel
ALTER TABLE lits ADD COLUMN IF NOT EXISTS motif_indispo text
  CHECK (motif_indispo IN ('personnel', 'equipement', 'travaux', 'infection', 'autre'));
-- NSA : patient qui n'a plus besoin de soins aigus et attend une autre ressource
ALTER TABLE lits ADD COLUMN IF NOT EXISTS nsa_depuis timestamptz;
ALTER TABLE lits ADD COLUMN IF NOT EXISTS nsa_orientation text
  CHECK (nsa_orientation IN ('chsld', 'ri', 'readaptation', 'domicile', 'palliatif', 'autre'));
-- Congé : prévu, confirmé, en attente de transport
ALTER TABLE lits ADD COLUMN IF NOT EXISTS conge_statut text CHECK (conge_statut IN ('prevu', 'confirme', 'attente_transport'));
-- Nettoyage : début réel
ALTER TABLE lits ADD COLUMN IF NOT EXISTS nettoyage_debut timestamptz;
ALTER TABLE lits DROP CONSTRAINT IF EXISTS lits_nsa_coherent;
ALTER TABLE lits ADD CONSTRAINT lits_nsa_coherent CHECK (nsa_depuis IS NULL OR etat = 'occupe');

-- File d'admission : patients (souvent à l'urgence) qui attendent un lit dans l'établissement
CREATE TABLE IF NOT EXISTS demandes_admission (
  id                serial PRIMARY KEY,
  etablissement_id  int  NOT NULL REFERENCES etablissements(id),
  provenance        text NOT NULL DEFAULT 'urgence' CHECK (provenance IN ('urgence', 'bloc', 'externe', 'autre')),
  type_id           int  NOT NULL REFERENCES types_unite(id),
  patient_ref       text NOT NULL,
  priorite          text NOT NULL DEFAULT 'p2' CHECK (priorite IN ('p1', 'p2', 'p3')),
  besoin_isolement  boolean NOT NULL DEFAULT false,
  besoin_pression_negative boolean NOT NULL DEFAULT false,
  besoin_ventilation boolean NOT NULL DEFAULT false,
  besoin_telemetrie boolean NOT NULL DEFAULT false,
  statut            text NOT NULL DEFAULT 'attente' CHECK (statut IN ('attente', 'assignee', 'admise', 'annulee', 'transferee')),
  lit_id            int REFERENCES lits(id),
  transfert_id      int REFERENCES transferts(id),
  cree_par          int REFERENCES utilisateurs(id),
  cree_le           timestamptz NOT NULL DEFAULT now(),
  assignee_le       timestamptz,
  terminee_le       timestamptz
);
CREATE INDEX IF NOT EXISTS adm_etab_statut ON demandes_admission (etablissement_id, statut);

-- Besoins du patient et motif de refus classé pour les transferts
ALTER TABLE transferts ADD COLUMN IF NOT EXISTS besoins jsonb NOT NULL DEFAULT '{}';
ALTER TABLE transferts ADD COLUMN IF NOT EXISTS motif_refus_code text
  CHECK (motif_refus_code IN ('pas_de_lit', 'pas_de_personnel', 'plateau_technique', 'autre'));
ALTER TABLE transferts ADD COLUMN IF NOT EXISTS demande_admission_id int REFERENCES demandes_admission(id);

-- Connecteurs : systèmes externes autorisés (hôpital, DSN, coordination régionale) et messages reçus
CREATE TABLE IF NOT EXISTS connecteurs (
  id                serial PRIMARY KEY,
  nom               text NOT NULL,
  cle_hash          text NOT NULL UNIQUE,
  etablissement_id  int REFERENCES etablissements(id),   -- NULL = connecteur réseau (lecture seulement)
  actif             boolean NOT NULL DEFAULT true,
  cree_le           timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages_connecteur (
  id             bigserial PRIMARY KEY,
  connecteur_id  int NOT NULL REFERENCES connecteurs(id),
  identifiant    text NOT NULL,          -- identifiant du message chez l'émetteur (idempotence)
  evenement      text NOT NULL,
  statut         text NOT NULL CHECK (statut IN ('applique', 'ignore', 'rejete')),
  detail         text,
  recu_le        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connecteur_id, identifiant)
);

-- Version 3 : proximité d'abord (paramètres par pays)
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS facteur_route numeric NOT NULL DEFAULT 1.3;      -- route ≈ vol d'oiseau × facteur
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS vitesse_kmh int NOT NULL DEFAULT 70;             -- vitesse moyenne d'une ambulance
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS penalite_orange_km int NOT NULL DEFAULT 25;      -- un hôpital en tension recule
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS penalite_rouge_km int NOT NULL DEFAULT 80;       -- un hôpital débordé recule beaucoup

-- Version 4 : comptes, double authentification, administration
ALTER TABLE utilisateurs DROP CONSTRAINT IF EXISTS utilisateurs_role_check;
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_role_check
  CHECK (role IN ('coordonnateur', 'gestionnaire', 'entretien', 'admin_etab'));
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS totp_actif boolean NOT NULL DEFAULT false;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS totp_dernier_pas bigint NOT NULL DEFAULT 0;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS mdp_temporaire boolean NOT NULL DEFAULT false;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS cree_le timestamptz NOT NULL DEFAULT now();
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS derniere_connexion timestamptz;

-- Étape intermédiaire de connexion : mot de passe validé, code de double authentification attendu
CREATE TABLE IF NOT EXISTS connexions_2fa (
  jeton           text PRIMARY KEY,
  utilisateur_id  int NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  essais          int NOT NULL DEFAULT 0,
  expire_le       timestamptz NOT NULL
);

-- Journal des actions d'administration, immuable comme le journal des lits
CREATE TABLE IF NOT EXISTS journal_admin (
  id              bigserial PRIMARY KEY,
  date            timestamptz NOT NULL DEFAULT now(),
  utilisateur_id  int REFERENCES utilisateurs(id),
  etablissement_id int REFERENCES etablissements(id),
  action          text NOT NULL,
  cible           text,
  detail          text
);
DROP TRIGGER IF EXISTS journal_admin_pas_de_modif ON journal_admin;
CREATE TRIGGER journal_admin_pas_de_modif BEFORE UPDATE OR DELETE ON journal_admin
  FOR EACH ROW EXECUTE FUNCTION journal_immuable();

-- Version 5 : interface en français et en anglais
-- Nom anglais des types d'unité (repli sur le nom français)
ALTER TABLE types_unite ADD COLUMN IF NOT EXISTS nom_en text;
UPDATE types_unite SET nom_en = v.nom_en
  FROM (VALUES ('SI', 'Intensive care'), ('MED', 'Medicine'), ('CHIR', 'Surgery'), ('MAT', 'Maternity')) AS v(code, nom_en)
 WHERE types_unite.code = v.code AND types_unite.nom_en IS NULL;
-- Protocoles par niveau d'alerte, en anglais
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS protocoles_en jsonb NOT NULL DEFAULT '{
  "vert": "Normal operations.",
  "jaune": "Review today’s planned discharges and speed up cleaning.",
  "orange": "Immediate bed management meeting, confirm discharges before noon, prepare outgoing transfers.",
  "rouge": "Overcapacity plan: open surge beds, prioritize outgoing transfers, notify regional coordination."
}';
-- Notifications et blocages : code et variables, pour les afficher dans la langue de l'utilisateur
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS vars jsonb;
ALTER TABLE lits ADD COLUMN IF NOT EXISTS blocage_code text;
ALTER TABLE lits ADD COLUMN IF NOT EXISTS blocage_vars jsonb;

-- Démonstration : heure de référence de la situation de départ (recalage des horloges)
CREATE TABLE IF NOT EXISTS demo_etat (
  id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  reference  timestamptz NOT NULL DEFAULT now()
);

-- Pagination et temps de réponse : index (date DESC, id DESC) pour les journaux et les transferts
CREATE INDEX IF NOT EXISTS journal_etab_date_id ON journal (etablissement_id, date DESC, id DESC);
DROP INDEX IF EXISTS journal_etab_date;
CREATE INDEX IF NOT EXISTS journal_admin_date_id ON journal_admin (date DESC, id DESC);
CREATE INDEX IF NOT EXISTS transferts_origine ON transferts (origine_id, date_demande DESC);
CREATE INDEX IF NOT EXISTS transferts_destination ON transferts (destination_id, date_demande DESC);
CREATE INDEX IF NOT EXISTS journal_utilisateur_date ON journal (utilisateur_id, date DESC) WHERE utilisateur_id IS NOT NULL;

-- Mot de passe oublié : jeton à usage unique, valable 30 minutes (seule son empreinte est gardée)
CREATE TABLE IF NOT EXISTS jetons_mdp (
  jeton_hash      text PRIMARY KEY,
  utilisateur_id  int NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  cree_le         timestamptz NOT NULL DEFAULT now(),
  expire_le       timestamptz NOT NULL,
  utilise_le      timestamptz
);
CREATE INDEX IF NOT EXISTS jetons_mdp_utilisateur ON jetons_mdp (utilisateur_id, cree_le DESC);

-- Aide intégrée : la page « Premiers pas » n'est montrée qu'une fois
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS premiers_pas_vus boolean NOT NULL DEFAULT false;

-- Civières de l'urgence : distinctes des lits. Régulières (au permis) ou de débordement (corridor).
-- Le taux d'occupation compte tous les patients sur civière, rapportés aux civières régulières fonctionnelles : il peut dépasser 100 %.
CREATE TABLE IF NOT EXISTS civieres (
  id                serial PRIMARY KEY,
  etablissement_id  int  NOT NULL REFERENCES etablissements(id),
  code              text NOT NULL,
  categorie         text NOT NULL DEFAULT 'reguliere' CHECK (categorie IN ('reguliere', 'debordement')),
  etat              text NOT NULL DEFAULT 'libre' CHECK (etat IN ('libre', 'occupee', 'nettoyage', 'indispo')),
  patient_ref       text,
  arrivee_le        timestamptz,            -- arrivée du patient sur civière (suit le patient s'il change de civière)
  version           int  NOT NULL DEFAULT 1,
  etat_depuis       timestamptz NOT NULL DEFAULT now(),
  motif_indispo     text CHECK (motif_indispo IN ('personnel', 'equipement', 'travaux', 'infection', 'autre')),
  UNIQUE (etablissement_id, code),
  CHECK ((etat = 'occupee') = (patient_ref IS NOT NULL)),
  CHECK ((etat = 'occupee') = (arrivee_le IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS civieres_etab_etat ON civieres (etablissement_id, etat);
-- Un patient n'est que sur une civière à la fois
CREATE UNIQUE INDEX IF NOT EXISTS civieres_patient_unique ON civieres (etablissement_id, patient_ref) WHERE etat = 'occupee';
ALTER TABLE journal ADD COLUMN IF NOT EXISTS civiere_id int REFERENCES civieres(id);
CREATE INDEX IF NOT EXISTS journal_civiere ON journal (civiere_id, date) WHERE civiere_id IS NOT NULL;
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS civiere_id int REFERENCES civieres(id);
-- Seuils d'alerte sur le taux d'occupation des civières (%)
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS seuil_civieres_jaune int NOT NULL DEFAULT 90;
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS seuil_civieres_orange int NOT NULL DEFAULT 110;
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS seuil_civieres_rouge int NOT NULL DEFAULT 140;
-- Nettoyage d'une civière : cible plus courte qu'une chambre
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS nettoyage_civiere_cible_min int NOT NULL DEFAULT 15;
-- Une seule demande de lit active par civière
CREATE UNIQUE INDEX IF NOT EXISTS adm_civiere_active ON demandes_admission (civiere_id) WHERE civiere_id IS NOT NULL AND statut IN ('attente', 'assignee');
