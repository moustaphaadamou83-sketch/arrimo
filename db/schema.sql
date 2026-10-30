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
  confirmation_lit_validite_min int NOT NULL DEFAULT 60 CHECK (confirmation_lit_validite_min BETWEEN 5 AND 1440),
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
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS invitation_en_attente boolean NOT NULL DEFAULT false;
-- Apparence choisie par l'utilisateur (clair, sombre, automatique selon le système, soleil selon l'établissement)
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS apparence text NOT NULL DEFAULT 'automatique'
  CHECK (apparence IN ('clair', 'sombre', 'automatique', 'soleil'));

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
  service_id        int,
  nom               text NOT NULL
);

CREATE TABLE IF NOT EXISTS departements (
  id serial PRIMARY KEY,
  etablissement_id int NOT NULL REFERENCES etablissements(id),
  code text NOT NULL,
  nom text NOT NULL,
  actif boolean NOT NULL DEFAULT true,
  attributs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributs) = 'object'),
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE(etablissement_id, code)
);
ALTER TABLE unites ADD COLUMN IF NOT EXISTS departement_id int REFERENCES departements(id);
ALTER TABLE unites ADD COLUMN IF NOT EXISTS actif boolean NOT NULL DEFAULT true;
ALTER TABLE unites ADD COLUMN IF NOT EXISTS attributs jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Services hospitaliers distincts des types techniques d'unité.
CREATE TABLE IF NOT EXISTS services (
  id serial PRIMARY KEY,
  etablissement_id int NOT NULL REFERENCES etablissements(id),
  code text NOT NULL,
  nom text NOT NULL,
  departement_id int REFERENCES departements(id),
  actif boolean NOT NULL DEFAULT true,
  attributs jsonb NOT NULL DEFAULT '{}'::jsonb,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE(etablissement_id, code)
);
ALTER TABLE unites ADD COLUMN IF NOT EXISTS service_id int;
DO $$ BEGIN
  ALTER TABLE unites ADD CONSTRAINT unites_service_fk FOREIGN KEY(service_id) REFERENCES services(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS chambres (
  id        serial PRIMARY KEY,
  unite_id  int  NOT NULL REFERENCES unites(id),
  numero    text NOT NULL,
  etage_id int,
  type_chambre text,
  capacite_declaree int CHECK (capacite_declaree IS NULL OR capacite_declaree > 0),
  accessible boolean NOT NULL DEFAULT false,
  attributs jsonb NOT NULL DEFAULT '{}'::jsonb,
  restrictions jsonb NOT NULL DEFAULT '{}'::jsonb,
  statut_operationnel text NOT NULL DEFAULT 'actif' CHECK (statut_operationnel IN ('actif', 'maintenance', 'ferme')),
  actif boolean NOT NULL DEFAULT true,
  UNIQUE (unite_id, numero)
);

CREATE TABLE IF NOT EXISTS etages (
  id serial PRIMARY KEY,
  unite_id int NOT NULL REFERENCES unites(id),
  code text NOT NULL,
  nom text NOT NULL,
  aile text,
  actif boolean NOT NULL DEFAULT true,
  attributs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributs) = 'object'),
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE(unite_id, code)
);
ALTER TABLE chambres ADD COLUMN IF NOT EXISTS etage_id int REFERENCES etages(id);

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
  categorie         text,
  attributs         jsonb NOT NULL DEFAULT '{}'::jsonb,
  actif             boolean NOT NULL DEFAULT true,
  etat              text NOT NULL DEFAULT 'libre'
                    CHECK (etat IN ('libre', 'reserve', 'occupe', 'nettoyage', 'indispo')),
  patient_ref       text,
  version           int  NOT NULL DEFAULT 1,
  etat_depuis       timestamptz NOT NULL DEFAULT now(),
  disponibilite_confirmee_le timestamptz,
  disponibilite_confirmee_par int REFERENCES utilisateurs(id),
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
  type            text NOT NULL DEFAULT 'reinitialisation' CHECK (type IN ('reinitialisation', 'invitation')),
  cree_le         timestamptz NOT NULL DEFAULT now(),
  expire_le       timestamptz NOT NULL,
  utilise_le      timestamptz
);
ALTER TABLE jetons_mdp ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'reinitialisation';
CREATE INDEX IF NOT EXISTS jetons_mdp_utilisateur ON jetons_mdp (utilisateur_id, cree_le DESC);

-- Aide intégrée : la page « Premiers pas » n'est montrée qu'une fois
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS premiers_pas_vus boolean NOT NULL DEFAULT false;

-- Civières de l'urgence : distinctes des lits. Régulières (au permis) ou de débordement (corridor).
-- Le taux d'occupation compte tous les patients sur civière, rapportés aux civières régulières fonctionnelles : il peut dépasser 100 %.
CREATE TABLE IF NOT EXISTS civieres (
  id                serial PRIMARY KEY,
  etablissement_id  int  NOT NULL REFERENCES etablissements(id),
  unite_id          int REFERENCES unites(id),
  attributs         jsonb NOT NULL DEFAULT '{}'::jsonb,
  actif             boolean NOT NULL DEFAULT true,
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

-- Transfert sans dossier côté receveur : chambre prête, temps de route estimé, heure d'arrivée prévue
ALTER TABLE transferts ADD COLUMN IF NOT EXISTS date_chambre_prete timestamptz;
ALTER TABLE transferts ADD COLUMN IF NOT EXISTS minutes_route int;
ALTER TABLE transferts ADD COLUMN IF NOT EXISTS arrivee_prevue timestamptz;
ALTER TABLE transferts ADD COLUMN IF NOT EXISTS route_actualise_le timestamptz;
ALTER TABLE transferts ADD COLUMN IF NOT EXISTS route_fournisseur text;
ALTER TABLE transferts ADD COLUMN IF NOT EXISTS route_version_donnees text;
ALTER TABLE transferts ADD COLUMN IF NOT EXISTS date_refus timestamptz;
ALTER TABLE transferts ADD COLUMN IF NOT EXISTS service_responsable text;
ALTER TABLE transferts ADD COLUMN IF NOT EXISTS derniere_relance_le timestamptz;
ALTER TABLE transferts ADD COLUMN IF NOT EXISTS nombre_relances int NOT NULL DEFAULT 0;
ALTER TABLE transferts ALTER COLUMN distance_km TYPE numeric(8,1) USING distance_km::numeric;
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS confirmation_lit_validite_min int NOT NULL DEFAULT 60
  CHECK (confirmation_lit_validite_min BETWEEN 5 AND 1440);
ALTER TABLE lits ADD COLUMN IF NOT EXISTS disponibilite_confirmee_le timestamptz;
ALTER TABLE lits ADD COLUMN IF NOT EXISTS disponibilite_confirmee_par int REFERENCES utilisateurs(id);

-- Tableau de bord national : adresse affichée (fictive en démonstration)
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS adresse text;

-- Démonstration : charge visée de chaque hôpital sans compte (simulation douce)
ALTER TABLE demo_etat ADD COLUMN IF NOT EXISTS simulation jsonb NOT NULL DEFAULT '{}';

-- Alerte « disponibilité à côté » : rayon réglable par établissement (km)
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS rayon_alerte_km int NOT NULL DEFAULT 10;
DO $$ BEGIN
  ALTER TABLE etablissements ADD CONSTRAINT etab_rayon_alerte CHECK (rayon_alerte_km BETWEEN 1 AND 200);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS notif_code_cle ON notifications (etablissement_id, code, date DESC) WHERE code IN ('dispo_lit', 'dispo_civiere');

-- Partie C2 : lien propre à chaque hôpital (<sous_domaine>.<hôte de l'environnement>), réglé depuis la console SH
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS sous_domaine text;
CREATE UNIQUE INDEX IF NOT EXISTS etablissements_sous_domaine ON etablissements (sous_domaine) WHERE sous_domaine IS NOT NULL;

-- Intégrité des relations hiérarchiques, y compris l'appartenance au même établissement.
CREATE UNIQUE INDEX IF NOT EXISTS departements_id_etab_unique ON departements(id,etablissement_id);
CREATE UNIQUE INDEX IF NOT EXISTS services_id_etab_unique ON services(id,etablissement_id);
CREATE UNIQUE INDEX IF NOT EXISTS unites_id_etab_unique ON unites(id,etablissement_id);
CREATE UNIQUE INDEX IF NOT EXISTS etages_id_unite_unique ON etages(id,unite_id);
CREATE UNIQUE INDEX IF NOT EXISTS chambres_id_unite_unique ON chambres(id,unite_id);
DO $$ BEGIN
  ALTER TABLE services ADD CONSTRAINT services_dept_etab_fk FOREIGN KEY(departement_id,etablissement_id) REFERENCES departements(id,etablissement_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE unites ADD CONSTRAINT unites_dept_etab_fk FOREIGN KEY(departement_id,etablissement_id) REFERENCES departements(id,etablissement_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE unites ADD CONSTRAINT unites_service_etab_fk FOREIGN KEY(service_id,etablissement_id) REFERENCES services(id,etablissement_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE chambres ADD CONSTRAINT chambres_etage_unite_fk FOREIGN KEY(etage_id,unite_id) REFERENCES etages(id,unite_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE lits ADD CONSTRAINT lits_chambre_unite_fk FOREIGN KEY(chambre_id,unite_id) REFERENCES chambres(id,unite_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE civieres ADD CONSTRAINT civieres_unite_etab_fk FOREIGN KEY(unite_id,etablissement_id) REFERENCES unites(id,etablissement_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------------
-- Finalisation (démonstration du 27 octobre 2026) : ajouts seulement, rejouables, sans perte de données.
-- ------------------------------------------------------------------
-- Groupes d'âge : un lit pédiatrique ou néonatal n'est jamais proposé pour un adulte, et inversement.
ALTER TABLE types_unite ADD COLUMN IF NOT EXISTS groupe_age text NOT NULL DEFAULT 'adulte';
ALTER TABLE types_unite ADD COLUMN IF NOT EXISTS specialite text;
ALTER TABLE lits ADD COLUMN IF NOT EXISTS groupe_age text NOT NULL DEFAULT 'adulte';
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS groupe_age text NOT NULL DEFAULT 'adulte';
ALTER TABLE transferts ADD COLUMN IF NOT EXISTS groupe_age text NOT NULL DEFAULT 'adulte';
DO $$ BEGIN
  ALTER TABLE types_unite ADD CONSTRAINT types_unite_groupe_age CHECK (groupe_age IN ('adulte', 'pediatrique', 'neonatal', 'tous'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE lits ADD CONSTRAINT lits_groupe_age CHECK (groupe_age IN ('adulte', 'pediatrique', 'neonatal', 'tous'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE demandes_admission ADD CONSTRAINT adm_groupe_age CHECK (groupe_age IN ('adulte', 'pediatrique', 'neonatal'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE transferts ADD CONSTRAINT transferts_groupe_age CHECK (groupe_age IN ('adulte', 'pediatrique', 'neonatal'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Catalogue extensible des spécialités : catégories possibles, activées établissement par établissement (pas une liste imposée).
CREATE TABLE IF NOT EXISTS specialites_catalogue (
  code        text PRIMARY KEY,
  nom         text NOT NULL,
  nom_en      text NOT NULL,
  groupe_age  text NOT NULL CHECK (groupe_age IN ('adulte', 'pediatrique', 'neonatal', 'tous')),
  famille     text NOT NULL,
  ordre       int  NOT NULL DEFAULT 50
);
INSERT INTO specialites_catalogue (code, nom, nom_en, groupe_age, famille, ordre) VALUES
  ('MED', 'Médecine générale', 'General medicine', 'adulte', 'medecine', 10),
  ('CHIR', 'Chirurgie', 'Surgery', 'adulte', 'chirurgie', 11),
  ('SI', 'Soins intensifs adultes', 'Adult intensive care', 'adulte', 'soins_intensifs', 12),
  ('URG', 'Urgences', 'Emergency', 'adulte', 'urgence', 13),
  ('MAT', 'Maternité', 'Maternity', 'adulte', 'maternite', 14),
  ('PED', 'Pédiatrie générale', 'General paediatrics', 'pediatrique', 'medecine', 20),
  ('URG-PED', 'Urgences pédiatriques', 'Paediatric emergency', 'pediatrique', 'urgence', 21),
  ('SIP', 'Soins intensifs pédiatriques', 'Paediatric intensive care', 'pediatrique', 'soins_intensifs', 22),
  ('NEO', 'Néonatologie', 'Neonatology', 'neonatal', 'neonatologie', 23),
  ('SIN', 'Soins intensifs néonataux', 'Neonatal intensive care', 'neonatal', 'soins_intensifs', 24),
  ('CHIR-PED', 'Chirurgie pédiatrique', 'Paediatric surgery', 'pediatrique', 'chirurgie', 25),
  ('CARDIO-PED', 'Cardiologie pédiatrique', 'Paediatric cardiology', 'pediatrique', 'cardiologie', 26),
  ('NEURO-PED', 'Neurologie pédiatrique', 'Paediatric neurology', 'pediatrique', 'neurologie', 27),
  ('HEMONC-PED', 'Hématologie-oncologie pédiatrique', 'Paediatric haematology-oncology', 'pediatrique', 'hemato_onco', 28),
  ('READ', 'Réadaptation', 'Rehabilitation', 'adulte', 'readaptation', 30),
  ('GER', 'Gériatrie', 'Geriatrics', 'adulte', 'geriatrie', 31),
  ('PSY', 'Psychiatrie', 'Psychiatry', 'adulte', 'psychiatrie', 32)
ON CONFLICT (code) DO NOTHING;

-- Modules activés par établissement (vide = tous les modules) et vocation (général, pédiatrique, spécialisé).
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS modules jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS vocation text NOT NULL DEFAULT 'general';
DO $$ BEGIN
  ALTER TABLE etablissements ADD CONSTRAINT etab_vocation CHECK (vocation IN ('general', 'pediatrique', 'specialise'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Civières : autres catégories configurables (isolement, pédiatrique, fauteuil)
ALTER TABLE civieres DROP CONSTRAINT IF EXISTS civieres_categorie_check;
DO $$ BEGIN
  ALTER TABLE civieres ADD CONSTRAINT civieres_categorie_check CHECK (categorie IN ('reguliere', 'debordement', 'isolement', 'pediatrique', 'fauteuil'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Congés : statut reporté en plus ; historique par lit (prévu, confirmé, reporté, annulé, départ réel)
ALTER TABLE lits DROP CONSTRAINT IF EXISTS lits_conge_statut_check;
DO $$ BEGIN
  ALTER TABLE lits ADD CONSTRAINT lits_conge_statut_check CHECK (conge_statut IN ('prevu', 'confirme', 'attente_transport', 'reporte'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS conges (
  id                serial PRIMARY KEY,
  lit_id            int  NOT NULL REFERENCES lits(id),
  etablissement_id  int  NOT NULL REFERENCES etablissements(id),
  patient_ref       text NOT NULL,
  sortie_prevue     timestamptz,
  statut            text NOT NULL CHECK (statut IN ('prevu', 'confirme', 'attente_transport', 'reporte', 'annule', 'realise')),
  depart_reel_le    timestamptz,
  source            text NOT NULL DEFAULT 'manuel',
  cree_le           timestamptz NOT NULL DEFAULT now(),
  maj_le            timestamptz NOT NULL DEFAULT now(),
  maj_par           int REFERENCES utilisateurs(id)
);
CREATE INDEX IF NOT EXISTS conges_etab_statut ON conges (etablissement_id, statut, sortie_prevue);
CREATE UNIQUE INDEX IF NOT EXISTS conges_ouvert_unique ON conges (lit_id) WHERE statut IN ('prevu', 'confirme', 'attente_transport', 'reporte');

-- Patients fictifs (démonstration et recette) : identification opérationnelle minimale, jamais dans les vues réseau.
CREATE SEQUENCE IF NOT EXISTS patient_seq START 1000;
CREATE TABLE IF NOT EXISTS patients (
  id                 serial PRIMARY KEY,
  etablissement_id   int  NOT NULL REFERENCES etablissements(id),
  reference          text NOT NULL,
  prenom             text NOT NULL,
  nom                text NOT NULL,
  date_naissance     date NOT NULL,
  reference_locale   text,
  source             text NOT NULL DEFAULT 'manuel' CHECK (source IN ('manuel', 'integration')),
  arrivee_le         timestamptz,
  parcours           text NOT NULL DEFAULT 'enregistre'
                     CHECK (parcours IN ('enregistre', 'urgence', 'attente_lit', 'lit_assigne', 'hospitalise', 'transfere', 'sorti', 'annule')),
  cree_par           int REFERENCES utilisateurs(id),
  cree_le            timestamptz NOT NULL DEFAULT now(),
  modifie_le         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (etablissement_id, reference)
);
CREATE INDEX IF NOT EXISTS patients_rapprochement ON patients (etablissement_id, lower(nom), date_naissance);
CREATE UNIQUE INDEX IF NOT EXISTS patients_ref_locale ON patients (etablissement_id, reference_locale) WHERE reference_locale IS NOT NULL;
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS patient_id int REFERENCES patients(id);

-- Synchronisation des admissions : un lit n'est assigné qu'à une demande ; un patient n'a qu'une demande active.
-- Créés seulement si les données existantes le permettent (jamais d'échec de mise à jour sur des données anciennes).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM demandes_admission WHERE statut = 'assignee' AND lit_id IS NOT NULL GROUP BY lit_id HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS adm_lit_assigne_unique ON demandes_admission (lit_id) WHERE statut = 'assignee';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM demandes_admission WHERE statut IN ('attente', 'assignee') GROUP BY etablissement_id, patient_ref HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS adm_patient_actif_unique ON demandes_admission (etablissement_id, patient_ref) WHERE statut IN ('attente', 'assignee');
  END IF;
END $$;

-- Contrôles périodiques : heure réelle de la dernière exécution et de la dernière donnée lue
CREATE TABLE IF NOT EXISTS controles (
  nom          text PRIMARY KEY,
  execute_le   timestamptz NOT NULL DEFAULT now(),
  duree_ms     int,
  resultat     jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Priorités configurables : aucune validation ni habilitation déduite de l'existant.
CREATE TABLE IF NOT EXISTS admission_referentiels (
  etablissement_id int PRIMARY KEY REFERENCES etablissements(id),
  revision int NOT NULL CHECK (revision > 0),
  categories jsonb NOT NULL CHECK (jsonb_typeof(categories) = 'array'),
  approuve_par int NOT NULL REFERENCES utilisateurs(id),
  approuve_le timestamptz NOT NULL DEFAULT now(),
  motif text NOT NULL
);
CREATE TABLE IF NOT EXISTS admission_habilitations (
  etablissement_id int NOT NULL REFERENCES etablissements(id),
  utilisateur_id int NOT NULL REFERENCES utilisateurs(id),
  active boolean NOT NULL DEFAULT false,
  accordee_par int NOT NULL REFERENCES utilisateurs(id),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (etablissement_id, utilisateur_id)
);
ALTER TABLE admission_habilitations ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS priorite_code text;
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS priorite_libelle text;
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS priorite_rang int;
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS priorite_revision int;
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS priorite_validee_par int REFERENCES utilisateurs(id);
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS priorite_validee_le timestamptz;
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS priorite_motif text;
ALTER TABLE demandes_admission ADD COLUMN IF NOT EXISTS priorite_version int NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'demandes_admission'::regclass AND conname = 'admission_priorite_complete') THEN
    ALTER TABLE demandes_admission ADD CONSTRAINT admission_priorite_complete CHECK (
      (priorite_code IS NULL AND priorite_libelle IS NULL AND priorite_rang IS NULL AND priorite_revision IS NULL
        AND priorite_validee_par IS NULL AND priorite_validee_le IS NULL AND priorite_motif IS NULL)
      OR (priorite_code IS NOT NULL AND priorite_libelle IS NOT NULL AND priorite_rang > 0 AND priorite_revision > 0
        AND priorite_rang IS NOT NULL AND priorite_revision IS NOT NULL
        AND priorite_validee_par IS NOT NULL AND priorite_validee_le IS NOT NULL AND priorite_motif IS NOT NULL)
    );
  END IF;
END $$;

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

-- OG par établissement : licence transmise par SH et réglages de l'administrateur hospitalier.
-- Sans ligne, OG garde son fonctionnement historique (assistant texte seul).
CREATE TABLE IF NOT EXISTS og_configurations (
  etablissement_id int PRIMARY KEY REFERENCES etablissements(id) ON DELETE CASCADE,
  licence          jsonb NOT NULL DEFAULT '{}'::jsonb,
  licence_le       timestamptz,
  reglages         jsonb NOT NULL DEFAULT '{}'::jsonb,
  modifie_par      int REFERENCES utilisateurs(id),
  modifie_le       timestamptz NOT NULL DEFAULT now()
);

-- Actions supervisées d'OG : préparation, confirmation explicite par un utilisateur habilité, exécution par l'API
-- métier existante, résultat vérifiable. Aucune identité patient n'y est stockée (référence seulement).
CREATE TABLE IF NOT EXISTS og_actions (
  id               uuid PRIMARY KEY,
  etablissement_id int NOT NULL REFERENCES etablissements(id) ON DELETE CASCADE,
  utilisateur_id   int NOT NULL REFERENCES utilisateurs(id),
  outil            text NOT NULL,
  niveau           int NOT NULL CHECK (niveau BETWEEN 0 AND 3),
  entree           jsonb NOT NULL,
  idempotence      text NOT NULL,
  etat             text NOT NULL DEFAULT 'preparee' CHECK (etat IN ('preparee', 'executee', 'annulee', 'echouee')),
  resultat         jsonb,
  confirme_par     int REFERENCES utilisateurs(id),
  cree_le          timestamptz NOT NULL DEFAULT now(),
  expire_le        timestamptz NOT NULL,
  termine_le       timestamptz,
  UNIQUE (utilisateur_id, idempotence)
);
