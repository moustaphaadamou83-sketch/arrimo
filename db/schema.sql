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
-- Langue de l'interface choisie par l'utilisateur (retrouvée à la reconnexion, sur tout appareil) ; NULL = pas encore choisie
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS langue_interface text CHECK (langue_interface IN ('fr', 'en'));
-- Préférences vocales personnelles d'OG : autorisation, langue de conversation (auto = langue de l'interface), lecture automatique
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS preferences_og jsonb NOT NULL DEFAULT '{}'::jsonb;

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
  CHECK (role IN ('coordonnateur', 'gestionnaire', 'entretien', 'admin_etab', 'equipe_soins', 'paramedic', 'superviseur_secours', 'repartiteur'));  -- liste complète : le schéma reste rejouable sur des comptes existants

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
  CHECK (role IN ('coordonnateur', 'gestionnaire', 'entretien', 'admin_etab', 'equipe_soins', 'paramedic', 'superviseur_secours', 'repartiteur'));  -- liste complète : le schéma reste rejouable sur des comptes existants
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

-- Passages des patients fictifs (démonstration et recette) : historique administratif seulement, aucune donnée clinique
-- ni texte libre. Un passage n'est jamais supprimé ; sa clôture est tracée (qui, quand).
CREATE SEQUENCE IF NOT EXISTS passage_seq START 1000;
CREATE TABLE IF NOT EXISTS patient_passages (
  id                serial PRIMARY KEY,
  patient_id        int  NOT NULL REFERENCES patients(id),
  etablissement_id  int  NOT NULL REFERENCES etablissements(id),
  reference         text NOT NULL UNIQUE,
  type              text NOT NULL CHECK (type IN ('urgence', 'consultation', 'admission')),
  arrivee_le        timestamptz NOT NULL,
  sortie_le         timestamptz,
  resultat          text NOT NULL DEFAULT 'en_cours' CHECK (resultat IN ('en_cours', 'hospitalise', 'transfere', 'sorti', 'annule')),
  cree_par          int REFERENCES utilisateurs(id),
  cree_le           timestamptz NOT NULL DEFAULT now(),
  cloture_par       int REFERENCES utilisateurs(id),
  cloture_le        timestamptz,
  CHECK (sortie_le IS NULL OR sortie_le >= arrivee_le)
);
CREATE INDEX IF NOT EXISTS patient_passages_patient ON patient_passages (patient_id, arrivee_le DESC);

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

-- =====================================================================================================
-- Types d'établissement et produit CHSLD (31 oct. 2026)
-- Un seul socle : l'établissement porte un type ; les modules et l'interface dépendent du type.
-- Les CHSLD ont leur propre configuration (unités d'hébergement, références R-00000) : les vues de capacité
-- hospitalières, qui filtrent par configuration, ne les mélangent jamais aux lits d'hôpital.
-- Identités de résidents et de proches : fictives, en démonstration et en recette seulement (même règle que patients).
-- Aucune donnée clinique : besoins d'accessibilité et équipements seulement, sous forme de codes opérationnels.
-- =====================================================================================================
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS type_etablissement text NOT NULL DEFAULT 'hopital';
DO $$ BEGIN
  ALTER TABLE etablissements ADD CONSTRAINT etab_type_etablissement
    CHECK (type_etablissement IN ('hopital', 'chsld', 'maison_aines', 'rpa', 'ressource_intermediaire'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Nom du type propre au pays (choisi dans SH) : affichage seulement ; le comportement suit toujours type_etablissement
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS type_libelle text CHECK (type_libelle IS NULL OR char_length(type_libelle) BETWEEN 2 AND 80);
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS type_libelle_en text CHECK (type_libelle_en IS NULL OR char_length(type_libelle_en) BETWEEN 2 AND 80);
-- Code du type local choisi dans SH (rpa, ri, rtf, maison_aines…) : nom court affiché à la place de « CHSLD » ; le comportement suit type_etablissement
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS type_local_code text CHECK (type_local_code IS NULL OR type_local_code ~ '^[a-z][a-z0-9_]{1,39}$');
-- Profil pays d'origine quand la configuration de l'établissement en dérive (CHSLD : configuration « <profil>-CHSLD »)
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS profil_config_id int REFERENCES config_pays(id);
-- Politique de conservation de la place pendant une hospitalisation (jours ; NULL = conservée jusqu'au retour ou à la sortie)
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS conservation_place_jours int CHECK (conservation_place_jours IS NULL OR conservation_place_jours BETWEEN 1 AND 365);

ALTER TABLE utilisateurs DROP CONSTRAINT IF EXISTS utilisateurs_role_check;
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_role_check
  CHECK (role IN ('coordonnateur', 'gestionnaire', 'entretien', 'admin_etab', 'equipe_soins', 'paramedic', 'superviseur_secours', 'repartiteur'));

CREATE SEQUENCE IF NOT EXISTS resident_seq;
CREATE TABLE IF NOT EXISTS residents (
  id                 serial PRIMARY KEY,
  etablissement_id   int  NOT NULL REFERENCES etablissements(id),
  reference          text NOT NULL,                       -- identifiant interne stable (R-00000), distinct des identifiants officiels
  prenom             text NOT NULL,
  nom                text NOT NULL,
  nom_usage          text,
  date_naissance     date NOT NULL,
  dossier_officiel   text,                                -- identifiant de dossier autorisé (saisi, jamais déduit)
  langue             text NOT NULL DEFAULT 'fr' CHECK (langue IN ('fr', 'en', 'autre')),
  telephone          text,
  courriel           text,
  adresse_precedente text,
  statut             text NOT NULL DEFAULT 'preadmission'
                     CHECK (statut IN ('preadmission', 'present', 'hospitalise', 'absent', 'transfert_en_cours', 'transfere', 'sorti')),
  lit_id             int REFERENCES lits(id),
  arrivee_prevue     date,
  admis_le           timestamptz,
  responsable_accueil int REFERENCES utilisateurs(id),
  accessibilite      text[] NOT NULL DEFAULT '{}',        -- codes opérationnels : fauteuil, deambulateur, leve_personne, lit_electrique, malentendant, malvoyant
  etapes_accueil     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(etapes_accueil) = 'object'),
  version            int  NOT NULL DEFAULT 1,
  cree_par           int REFERENCES utilisateurs(id),
  cree_le            timestamptz NOT NULL DEFAULT now(),
  modifie_le         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (etablissement_id, reference)
);
CREATE UNIQUE INDEX IF NOT EXISTS residents_lit_actif ON residents (lit_id) WHERE lit_id IS NOT NULL AND statut NOT IN ('sorti', 'transfere');
CREATE INDEX IF NOT EXISTS residents_nom ON residents (etablissement_id, lower(nom), lower(prenom));

CREATE TABLE IF NOT EXISTS resident_contacts (
  id                 serial PRIMARY KEY,
  resident_id        int  NOT NULL REFERENCES residents(id),
  prenom             text NOT NULL,
  nom                text NOT NULL,
  relation           text NOT NULL CHECK (relation IN ('fille', 'fils', 'conjoint', 'soeur', 'frere', 'parent', 'petit_enfant', 'ami', 'voisin', 'tuteur', 'autre')),
  telephone          text,
  courriel           text,
  adresse            text,
  rang               int  NOT NULL DEFAULT 1 CHECK (rang BETWEEN 1 AND 20),
  principal          boolean NOT NULL DEFAULT false,
  -- Rôles distincts : être à prévenir n'autorise pas à consulter le dossier.
  contact_urgence    boolean NOT NULL DEFAULT true,
  proche_aidant      boolean NOT NULL DEFAULT false,
  representant_legal boolean NOT NULL DEFAULT false,
  representant_verifie_le timestamptz,                    -- document de représentation vérifié par une personne habilitée
  representant_verifie_par int REFERENCES utilisateurs(id),
  -- Catégories d'informations que ce proche peut recevoir (accordées individuellement, révocables)
  autorisations      text[] NOT NULL DEFAULT '{}',        -- administratif, hebergement, rendez_vous, mouvements
  disponibilites     text,
  langue             text NOT NULL DEFAULT 'fr' CHECK (langue IN ('fr', 'en', 'autre')),
  actif              boolean NOT NULL DEFAULT true,
  version            int  NOT NULL DEFAULT 1,
  cree_le            timestamptz NOT NULL DEFAULT now(),
  modifie_le         timestamptz NOT NULL DEFAULT now(),
  CHECK (telephone IS NOT NULL OR courriel IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS resident_contacts_resident ON resident_contacts (resident_id) WHERE actif;

CREATE TABLE IF NOT EXISTS resident_mouvements (
  id                 bigserial PRIMARY KEY,
  resident_id        int  NOT NULL REFERENCES residents(id),
  etablissement_id   int  NOT NULL REFERENCES etablissements(id),
  type               text NOT NULL CHECK (type IN ('preadmission', 'admission', 'changement_chambre', 'depart_hopital', 'hospitalisation_confirmee',
                       'retour_prevu', 'retour', 'transfert_prepare', 'transfert_sortant', 'transfert_entrant', 'absence', 'fin_absence', 'sortie', 'annulation', 'modification')),
  de_lit_id          int REFERENCES lits(id),
  vers_lit_id        int REFERENCES lits(id),
  autre_etablissement_id int REFERENCES etablissements(id),
  coordination_id    int,
  detail             text,
  date               timestamptz NOT NULL DEFAULT now(),
  par                int REFERENCES utilisateurs(id)
);
CREATE INDEX IF NOT EXISTS resident_mouvements_resident ON resident_mouvements (resident_id, date);

-- Demandes d'hébergement reçues par les circuits autorisés : suivi administratif seulement (aucun classement clinique).
CREATE SEQUENCE IF NOT EXISTS demande_hebergement_seq;
CREATE TABLE IF NOT EXISTS demandes_hebergement (
  id                 serial PRIMARY KEY,
  etablissement_id   int  NOT NULL REFERENCES etablissements(id),
  numero             text NOT NULL UNIQUE,
  provenance         text NOT NULL CHECK (provenance IN ('mecanisme_acces', 'hopital', 'autre_chsld', 'domicile')),
  reference_externe  text,                                -- numéro donné par le mécanisme d'accès (saisi)
  resident_id        int REFERENCES residents(id),
  prenom             text,
  nom                text,
  date_naissance     date,
  type_id            int REFERENCES types_unite(id),
  arrivee_souhaitee  date,
  statut             text NOT NULL DEFAULT 'recue'
                     CHECK (statut IN ('recue', 'documents_manquants', 'en_verification', 'place_proposee', 'acceptee', 'admise', 'refusee', 'annulee')),
  documents          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(documents) = 'array'),
  lit_propose_id     int REFERENCES lits(id),
  version            int  NOT NULL DEFAULT 1,
  cree_par           int REFERENCES utilisateurs(id),
  cree_le            timestamptz NOT NULL DEFAULT now(),
  modifie_le         timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS demande_hebergement_etapes (
  id                 bigserial PRIMARY KEY,
  demande_id         int  NOT NULL REFERENCES demandes_hebergement(id),
  statut             text NOT NULL,
  detail             text,
  par                int REFERENCES utilisateurs(id),
  date               timestamptz NOT NULL DEFAULT now()
);

-- Coordination entre établissements : hospitalisation d'un résident, retour de l'hôpital, transfert inter-CHSLD.
-- Les autres établissements ne voient que la référence du résident (jamais son nom), comme les vues réseau.
CREATE SEQUENCE IF NOT EXISTS coordination_seq;
CREATE TABLE IF NOT EXISTS coordinations (
  id                 serial PRIMARY KEY,
  numero             text NOT NULL UNIQUE,
  type               text NOT NULL CHECK (type IN ('hospitalisation', 'retour', 'transfert_chsld')),
  resident_id        int  NOT NULL REFERENCES residents(id),
  resident_ref       text NOT NULL,
  origine_id         int  NOT NULL REFERENCES etablissements(id),
  destination_id     int  NOT NULL REFERENCES etablissements(id),
  statut             text NOT NULL DEFAULT 'preparee'
                     CHECK (statut IN ('preparee', 'envoyee', 'acceptee', 'en_cours', 'recue', 'refusee', 'annulee', 'expiree')),
  lit_id             int REFERENCES lits(id),          -- place réservée à destination (transfert inter-CHSLD) ou place conservée (retour)
  retour_prevu_le    timestamptz,
  motif_admin        text,
  incident           text CHECK (incident IN ('retour_retarde', 'chambre_indisponible', 'informations_manquantes', 'changement_hopital', 'hospitalisation_prolongee')),
  liee_id            int REFERENCES coordinations(id),  -- retour lié à l'hospitalisation
  expire_le          timestamptz,
  version            int  NOT NULL DEFAULT 1,
  cree_par           int REFERENCES utilisateurs(id),
  cree_le            timestamptz NOT NULL DEFAULT now(),
  modifie_le         timestamptz NOT NULL DEFAULT now(),
  CHECK (origine_id <> destination_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS coordinations_ouverte_resident ON coordinations (resident_id, type)
  WHERE statut IN ('preparee', 'envoyee', 'acceptee', 'en_cours');
-- Liaison CHSLD (module hospitalier) : même moteur de coordination, étapes confirmées côté hôpital.
-- Chaque horodatage est la preuve d'une confirmation humaine ; aucun statut ne change automatiquement.
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS recue_hopital_le timestamptz;     -- demande vue et accusée par l'hôpital
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS acceptee_le timestamptz;          -- demande acceptée par l'hôpital
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS arrivee_le timestamptz;           -- arrivée physique confirmée par l'hôpital
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS orientation text;                 -- décision humaine : admission ou urgence
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS orientation_le timestamptz;
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS patient_ref_hopital text;         -- référence de l'épisode hospitalier (format de l'hôpital)
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS demande_admission_id int REFERENCES demandes_admission(id);
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS cloturee_le timestamptz;          -- parcours clos (retour reçu par le CHSLD)
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS cle_idempotence text;             -- renvoi après coupure réseau : jamais de doublon
CREATE UNIQUE INDEX IF NOT EXISTS coordinations_idempotence ON coordinations (origine_id, cle_idempotence) WHERE cle_idempotence IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'coordinations'::regclass AND conname = 'coordinations_orientation_check') THEN
    ALTER TABLE coordinations ADD CONSTRAINT coordinations_orientation_check CHECK (orientation IN ('admission', 'urgence'));
  END IF;
END $$;
ALTER TABLE coordinations DROP CONSTRAINT IF EXISTS coordinations_incident_check;
ALTER TABLE coordinations ADD CONSTRAINT coordinations_incident_check
  CHECK (incident IN ('retour_retarde', 'chambre_indisponible', 'informations_manquantes', 'changement_hopital', 'hospitalisation_prolongee', 'arrivee_retardee'));
CREATE TABLE IF NOT EXISTS coordination_etapes (
  id                 bigserial PRIMARY KEY,
  coordination_id    int  NOT NULL REFERENCES coordinations(id),
  statut             text NOT NULL,
  etablissement_id   int REFERENCES etablissements(id),
  detail             text,
  par                int REFERENCES utilisateurs(id),
  date               timestamptz NOT NULL DEFAULT now()
);

-- Tâches et transmissions administratives (entretien, préparation de chambre, documents, relances)
CREATE TABLE IF NOT EXISTS taches_etab (
  id                 serial PRIMARY KEY,
  etablissement_id   int  NOT NULL REFERENCES etablissements(id),
  type               text NOT NULL CHECK (type IN ('entretien', 'preparation_chambre', 'administratif', 'transmission', 'relance')),
  titre              text NOT NULL,
  detail             text,
  lit_id             int REFERENCES lits(id),
  resident_id        int REFERENCES residents(id),
  assigne_role       text CHECK (assigne_role IN ('coordonnateur', 'entretien', 'admin_etab', 'equipe_soins')),
  statut             text NOT NULL DEFAULT 'a_faire' CHECK (statut IN ('a_faire', 'en_cours', 'faite', 'annulee')),
  echeance           timestamptz,
  version            int  NOT NULL DEFAULT 1,
  cree_par           int REFERENCES utilisateurs(id),
  cree_le            timestamptz NOT NULL DEFAULT now(),
  fait_par           int REFERENCES utilisateurs(id),
  fait_le            timestamptz
);
CREATE INDEX IF NOT EXISTS taches_etab_ouvertes ON taches_etab (etablissement_id, statut) WHERE statut IN ('a_faire', 'en_cours');

-- Communications avec les proches, côté personnel : journal des appels, rappels demandés, échanges planifiés.
-- Aucun contenu clinique ; le sujet est administratif. Rien n'est envoyé en clair par courriel ou SMS.
CREATE TABLE IF NOT EXISTS communications_proches (
  id                 serial PRIMARY KEY,
  resident_id        int  NOT NULL REFERENCES residents(id),
  contact_id         int  NOT NULL REFERENCES resident_contacts(id),
  type               text NOT NULL CHECK (type IN ('appel', 'message', 'rappel_demande', 'rendez_vous')),
  sens               text NOT NULL DEFAULT 'sortant' CHECK (sens IN ('sortant', 'entrant')),
  categorie          text NOT NULL CHECK (categorie IN ('administratif', 'hebergement', 'rendez_vous', 'mouvements')),
  sujet              text NOT NULL,
  statut             text NOT NULL DEFAULT 'a_faire' CHECK (statut IN ('a_faire', 'fait', 'annule')),
  prevu_le           timestamptz,
  fait_le            timestamptz,
  par                int REFERENCES utilisateurs(id),
  cree_le            timestamptz NOT NULL DEFAULT now()
);

-- Portail des proches (phase pilote, démonstration et recette seulement) : accès individuel sur invitation, révocable,
-- limité dans le temps ; aucune chambre, localisation ni donnée clinique ; messagerie dans l'application seulement.
CREATE TABLE IF NOT EXISTS proches_acces (
  id                 serial PRIMARY KEY,
  contact_id         int  NOT NULL REFERENCES resident_contacts(id),
  resident_id        int  NOT NULL REFERENCES residents(id),
  etablissement_id   int  NOT NULL REFERENCES etablissements(id),
  courriel           text NOT NULL,
  invitation_hash    text,                                 -- empreinte du jeton d'invitation (jamais le jeton)
  invitation_expire_le timestamptz,
  mot_de_passe_hash  text,
  actif              boolean NOT NULL DEFAULT false,      -- vrai après l'acceptation de l'invitation
  expire_le          timestamptz,                         -- fin d'accès décidée par l'établissement (facultative)
  revoque_le         timestamptz,
  revoque_par        int REFERENCES utilisateurs(id),
  echecs             int NOT NULL DEFAULT 0,
  bloque_jusqu_au    timestamptz,
  derniere_connexion timestamptz,
  cree_par           int REFERENCES utilisateurs(id),
  cree_le            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS proches_acces_contact_ouvert ON proches_acces (contact_id) WHERE revoque_le IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS proches_acces_courriel_ouvert ON proches_acces (lower(courriel)) WHERE revoque_le IS NULL;
CREATE TABLE IF NOT EXISTS proches_sessions (
  jeton_hash         text PRIMARY KEY,
  acces_id           int  NOT NULL REFERENCES proches_acces(id),
  expire_le          timestamptz NOT NULL,
  cree_le            timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages_proches (
  id                 bigserial PRIMARY KEY,
  resident_id        int  NOT NULL REFERENCES residents(id),
  contact_id         int  NOT NULL REFERENCES resident_contacts(id),
  sens               text NOT NULL CHECK (sens IN ('proche', 'etablissement')),
  categorie          text NOT NULL CHECK (categorie IN ('administratif', 'hebergement', 'rendez_vous', 'mouvements')),
  texte              text NOT NULL CHECK (length(texte) BETWEEN 1 AND 2000),
  par                int REFERENCES utilisateurs(id),
  lu_le              timestamptz,
  cree_le            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_proches_fil ON messages_proches (resident_id, contact_id, cree_le);

-- Entretien indépendant de l'occupation (CHSLD) : une place conservée pendant une hospitalisation peut être nettoyée
-- sans jamais changer d'attribution ni devenir disponible. NULL = propre (aucun entretien en attente).
ALTER TABLE lits ADD COLUMN IF NOT EXISTS entretien_statut text;
ALTER TABLE lits ADD COLUMN IF NOT EXISTS entretien_le timestamptz;
ALTER TABLE lits ADD COLUMN IF NOT EXISTS entretien_par int REFERENCES utilisateurs(id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'lits'::regclass AND conname = 'lits_entretien_statut_check') THEN
    ALTER TABLE lits ADD CONSTRAINT lits_entretien_statut_check CHECK (entretien_statut IN ('propre', 'a_nettoyer', 'en_cours', 'termine'));
  END IF;
END $$;
-- Recherche par référence normalisée (ERA117A, era-117a, R00001) : index sur les codes sans tiret ni espace
CREATE INDEX IF NOT EXISTS lits_code_normalise ON lits (etablissement_id, upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g')));
CREATE INDEX IF NOT EXISTS residents_reference_normalisee ON residents (etablissement_id, upper(regexp_replace(reference, '[^A-Za-z0-9]', '', 'g')));

-- Parcours CHSLD ↔ hôpital complet : préparation du départ, orientation avec emplacement réel, retour en étapes distinctes.
-- Degré d'urgence déclaré : information transmise, jamais une priorité clinique. Aucune donnée clinique dans ces colonnes.
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS urgence_declaree text;
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS service_souhaite_id int REFERENCES types_unite(id);
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS service_retenu_id int REFERENCES types_unite(id);
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS infos_operationnelles jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS civiere_id int REFERENCES civieres(id);
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS chambre_verifiee_le timestamptz;
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS transport_le timestamptz;
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS reintegree_le timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'coordinations'::regclass AND conname = 'coordinations_urgence_declaree_check') THEN
    ALTER TABLE coordinations ADD CONSTRAINT coordinations_urgence_declaree_check CHECK (urgence_declaree IN ('courante', 'prioritaire', 'immediate'));
  END IF;
END $$;
ALTER TABLE coordinations DROP CONSTRAINT IF EXISTS coordinations_incident_check;
ALTER TABLE coordinations ADD CONSTRAINT coordinations_incident_check
  CHECK (incident IN ('retour_retarde', 'chambre_indisponible', 'informations_manquantes', 'changement_hopital', 'hospitalisation_prolongee', 'arrivee_retardee', 'arrivee_anticipee'));
-- Une référence hospitalière ne sert qu'à un seul parcours ouvert dans un hôpital (aucune double admission)
CREATE UNIQUE INDEX IF NOT EXISTS coordinations_patient_ref_ouvert ON coordinations (destination_id, patient_ref_hopital)
  WHERE patient_ref_hopital IS NOT NULL AND cloturee_le IS NULL;
-- Résident arrivé au CHSLD, réintégration à confirmer : sa place reste conservée jusqu'à la réintégration
ALTER TABLE residents DROP CONSTRAINT IF EXISTS residents_statut_check;
ALTER TABLE residents ADD CONSTRAINT residents_statut_check
  CHECK (statut IN ('preadmission', 'present', 'hospitalise', 'retour_a_reintegrer', 'absent', 'transfert_en_cours', 'transfere', 'sorti'));
ALTER TABLE resident_mouvements DROP CONSTRAINT IF EXISTS resident_mouvements_type_check;
ALTER TABLE resident_mouvements ADD CONSTRAINT resident_mouvements_type_check
  CHECK (type IN ('preadmission', 'admission', 'changement_chambre', 'depart_hopital', 'hospitalisation_confirmee',
    'retour_prevu', 'retour', 'reintegration', 'transfert_prepare', 'transfert_sortant', 'transfert_entrant', 'absence', 'fin_absence', 'sortie', 'annulation', 'modification'));

-- Transfert d'un résident hospitalisé vers un autre hôpital (cahier du 6 nov. 2026) : identifiant et historique propres.
-- À l'arrivée, l'hospitalisation d'origine est close sans être écrasée, et une nouvelle s'ouvre dans l'hôpital d'accueil.
ALTER TABLE coordinations DROP CONSTRAINT IF EXISTS coordinations_type_check;
ALTER TABLE coordinations ADD CONSTRAINT coordinations_type_check CHECK (type IN ('hospitalisation', 'retour', 'transfert_chsld', 'transfert_hopital'));

-- Nettoyage selon les précautions (avenant du 6 nov. 2026). Données opérationnelles : aucun diagnostic, aucune référence de patient.
ALTER TABLE chambres ADD COLUMN IF NOT EXISTS precautions text[] NOT NULL DEFAULT '{}';
ALTER TABLE chambres ADD COLUMN IF NOT EXISTS precautions_version int NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS chambre_precautions_historique (
  id serial PRIMARY KEY, chambre_id int NOT NULL REFERENCES chambres(id), etablissement_id int NOT NULL REFERENCES etablissements(id),
  precautions text[] NOT NULL, par int REFERENCES utilisateurs(id), le timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS nettoyage_protocoles (
  id serial PRIMARY KEY, etablissement_id int NOT NULL REFERENCES etablissements(id), nom text NOT NULL,
  type_intervention text NOT NULL CHECK (type_intervention IN ('courant', 'terminal')),
  precautions text[] NOT NULL DEFAULT '{}', formations text[] NOT NULL DEFAULT '{}', epi text[] NOT NULL DEFAULT '{}', instructions text,
  controle_requis boolean NOT NULL DEFAULT true, delai_min int NOT NULL DEFAULT 0 CHECK (delai_min BETWEEN 0 AND 1440),
  valide_par int REFERENCES utilisateurs(id), valide_le timestamptz, actif boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS agent_formations (
  etablissement_id int NOT NULL REFERENCES etablissements(id), utilisateur_id int NOT NULL REFERENCES utilisateurs(id), formation text NOT NULL,
  expire_le timestamptz NOT NULL, accordee_par int REFERENCES utilisateurs(id), accordee_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (etablissement_id, utilisateur_id, formation));
CREATE TABLE IF NOT EXISTS etablissement_epi (
  etablissement_id int NOT NULL REFERENCES etablissements(id), epi text NOT NULL, disponible boolean NOT NULL DEFAULT false,
  modifie_par int REFERENCES utilisateurs(id), modifie_le timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (etablissement_id, epi));
CREATE TABLE IF NOT EXISTS nettoyage_interventions (
  id serial PRIMARY KEY, etablissement_id int NOT NULL REFERENCES etablissements(id), lit_id int NOT NULL REFERENCES lits(id), chambre_id int NOT NULL REFERENCES chambres(id),
  protocole_id int NOT NULL REFERENCES nettoyage_protocoles(id), precautions text[] NOT NULL, precautions_version int NOT NULL,
  statut text NOT NULL CHECK (statut IN ('en_cours', 'controle_requis', 'validee', 'annulee')), agent_id int NOT NULL REFERENCES utilisateurs(id),
  debut_le timestamptz NOT NULL DEFAULT now(), fin_le timestamptz, controle_par int REFERENCES utilisateurs(id), controle_le timestamptz, version int NOT NULL DEFAULT 1);
CREATE UNIQUE INDEX IF NOT EXISTS nettoyage_intervention_ouverte ON nettoyage_interventions (lit_id) WHERE statut IN ('en_cours', 'controle_requis');

-- Pathologies et symptômes FICTIFS, en démonstration seulement (décision du 6 nov. 2026) : refus du serveur ailleurs.
CREATE TABLE IF NOT EXISTS evaluations_fictives (
  id serial PRIMARY KEY, etablissement_id int NOT NULL REFERENCES etablissements(id), reference text NOT NULL,
  pathologies text, symptomes text, besoins text, precautions text[] NOT NULL DEFAULT '{}', contraintes_hebergement text, equipements text,
  statut text NOT NULL DEFAULT 'a_valider' CHECK (statut IN ('a_valider', 'validee')), auteur int REFERENCES utilisateurs(id), cree_le timestamptz NOT NULL DEFAULT now(),
  valide_par int REFERENCES utilisateurs(id), valide_le timestamptz);
CREATE INDEX IF NOT EXISTS evaluations_fictives_ref ON evaluations_fictives (etablissement_id, reference);
CREATE TABLE IF NOT EXISTS evaluations_fictives_acces (
  id serial PRIMARY KEY, evaluation_id int NOT NULL REFERENCES evaluations_fictives(id), utilisateur_id int REFERENCES utilisateurs(id), action text NOT NULL, le timestamptz NOT NULL DEFAULT now());
ALTER TABLE coordinations ADD COLUMN IF NOT EXISTS evaluation_transmise_id int REFERENCES evaluations_fictives(id);

-- Numérisation : événements saisis ou importés après vérification humaine
CREATE TABLE IF NOT EXISTS evenements_saisis (
  id serial PRIMARY KEY, etablissement_id int NOT NULL REFERENCES etablissements(id),
  type text NOT NULL CHECK (type IN ('demande_transfert', 'admission_retour', 'absence', 'communication', 'confirmation', 'tache_preparation', 'information')),
  reference text, contenu text NOT NULL, source text NOT NULL CHECK (source IN ('saisie', 'import')), statut text NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert', 'traite', 'annule')),
  auteur int REFERENCES utilisateurs(id), cree_le timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS evenements_saisis_historique (
  id serial PRIMARY KEY, evenement_id int NOT NULL REFERENCES evenements_saisis(id), statut text NOT NULL, par int REFERENCES utilisateurs(id), le timestamptz NOT NULL DEFAULT now());
-- Portail des proches : visites et activités
CREATE TABLE IF NOT EXISTS demandes_visite (
  id serial PRIMARY KEY, etablissement_id int NOT NULL REFERENCES etablissements(id), resident_id int NOT NULL REFERENCES residents(id), contact_id int NOT NULL REFERENCES resident_contacts(id),
  souhaitee_le timestamptz NOT NULL, statut text NOT NULL DEFAULT 'demandee' CHECK (statut IN ('demandee', 'acceptee', 'refusee', 'annulee')),
  traite_par int REFERENCES utilisateurs(id), traite_le timestamptz, cree_le timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS activites_etab (
  id serial PRIMARY KEY, etablissement_id int NOT NULL REFERENCES etablissements(id), titre text NOT NULL, description text, debut_le timestamptz NOT NULL,
  publie_par int REFERENCES utilisateurs(id), actif boolean NOT NULL DEFAULT true, cree_le timestamptz NOT NULL DEFAULT now());
-- Fonctions cliniques fictives : jamais actives d'office, activées établissement par établissement, en démo seulement
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS clinique_fictive boolean NOT NULL DEFAULT false;

-- Notifications du portail : aucune donnée sur le parcours, seulement l'accès à prévenir et l'adresse de poussée de son téléphone
CREATE TABLE IF NOT EXISTS proches_abonnements_push (
  id serial PRIMARY KEY, acces_id int NOT NULL REFERENCES proches_acces(id) ON DELETE CASCADE, endpoint text NOT NULL UNIQUE, cree_le timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS proches_notifications_attente (
  acces_id int PRIMARY KEY REFERENCES proches_acces(id) ON DELETE CASCADE, cree_le timestamptz NOT NULL DEFAULT now());

-- Coordination Famille (cahier du 8 nov. 2026) : demandes en tâches, confirmations, créneaux de visite, journal de vie, réglages
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS famille_config jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE taches_etab DROP CONSTRAINT IF EXISTS taches_etab_type_check;
ALTER TABLE taches_etab ADD CONSTRAINT taches_etab_type_check CHECK (type IN ('entretien', 'preparation_chambre', 'administratif', 'transmission', 'relance', 'demande_famille'));
CREATE TABLE IF NOT EXISTS demandes_famille (
  id serial PRIMARY KEY, etablissement_id int NOT NULL REFERENCES etablissements(id), resident_id int NOT NULL REFERENCES residents(id), contact_id int NOT NULL REFERENCES resident_contacts(id),
  categorie text NOT NULL CHECK (categorie IN ('vetements', 'lunettes', 'effets_personnels', 'objet_oublie', 'rencontre', 'administratif', 'autre')), texte text NOT NULL,
  statut text NOT NULL CHECK (statut IN ('nouvelle', 'recue', 'attribuee', 'en_cours', 'attente_information', 'attente_proche', 'resolue', 'refusee', 'annulee', 'cloturee')),
  reponse text, note_interne text, tache_id int REFERENCES taches_etab(id), echeance timestamptz, relances int NOT NULL DEFAULT 0, derniere_relance_le timestamptz,
  cree_le timestamptz NOT NULL DEFAULT now(), modifie_le timestamptz NOT NULL DEFAULT now(), resolue_le timestamptz, version int NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS demandes_famille_historique (
  id serial PRIMARY KEY, demande_id int NOT NULL REFERENCES demandes_famille(id), statut text NOT NULL, par_utilisateur int REFERENCES utilisateurs(id), note text, le timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS confirmations_famille (
  id serial PRIMARY KEY, etablissement_id int NOT NULL REFERENCES etablissements(id), resident_id int NOT NULL REFERENCES residents(id), contact_id int NOT NULL REFERENCES resident_contacts(id),
  sujet text NOT NULL, explication text, echeance timestamptz, statut text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'confirmee', 'indisponible', 'precisions')),
  reponse text, vue_le timestamptz, repondu_le timestamptz, cree_par int REFERENCES utilisateurs(id), cree_le timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS visites_creneaux (
  id serial PRIMARY KEY, etablissement_id int NOT NULL REFERENCES etablissements(id), debut timestamptz NOT NULL, fin timestamptz NOT NULL, capacite int NOT NULL CHECK (capacite BETWEEN 1 AND 50),
  actif boolean NOT NULL DEFAULT true, cree_par int REFERENCES utilisateurs(id), cree_le timestamptz NOT NULL DEFAULT now());
ALTER TABLE demandes_visite ADD COLUMN IF NOT EXISTS creneau_id int REFERENCES visites_creneaux(id);
ALTER TABLE demandes_visite ADD COLUMN IF NOT EXISTS participants int NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS journal_vie (
  id serial PRIMARY KEY, etablissement_id int NOT NULL REFERENCES etablissements(id), resident_id int REFERENCES residents(id), titre text NOT NULL, texte text NOT NULL,
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'publie', 'retire')), auteur int REFERENCES utilisateurs(id), valide_par int REFERENCES utilisateurs(id),
  publie_le timestamptz, cree_le timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS proches_notifications_journal (
  id serial PRIMARY KEY, acces_id int NOT NULL REFERENCES proches_acces(id) ON DELETE CASCADE, statut text NOT NULL CHECK (statut IN ('envoyee', 'echec', 'adresse_retiree')), code int, le timestamptz NOT NULL DEFAULT now());
ALTER TABLE proches_acces ADD COLUMN IF NOT EXISTS notif_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Un même proche peut suivre plusieurs résidents : un accès ouvert par courriel ET par résident
DROP INDEX IF EXISTS proches_acces_courriel_ouvert;
CREATE UNIQUE INDEX IF NOT EXISTS proches_acces_courriel_resident_ouvert ON proches_acces (lower(courriel), resident_id) WHERE revoque_le IS NULL;

-- ---------------------------------------------------------------- Arrimo Famille : comptes créés par les proches (10 nov. 2026)
-- Un compte ne donne accès à aucune information. Chaque lien avec un résident (proches_acces) est validé par l'établissement.
CREATE TABLE IF NOT EXISTS proches_comptes (
  id                   serial PRIMARY KEY,
  courriel             text NOT NULL,
  mot_de_passe_hash    text,
  confirme_le          timestamptz,
  confirmation_hash    text,                                -- empreinte du jeton de confirmation (jamais le jeton)
  confirmation_expire_le timestamptz,
  reinit_hash          text,
  reinit_expire_le     timestamptz,
  envois               int NOT NULL DEFAULT 0,              -- courriels envoyés dans la fenêtre en cours (limite)
  envois_depuis        timestamptz,
  echecs               int NOT NULL DEFAULT 0,
  bloque_jusqu_au      timestamptz,
  essais_code          int NOT NULL DEFAULT 0,              -- codes de rattachement erronés dans la fenêtre en cours
  essais_code_depuis   timestamptz,
  avis_accepte_le      timestamptz,
  derniere_connexion   timestamptz,
  supprime_le          timestamptz,
  cree_le              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS proches_comptes_courriel ON proches_comptes (lower(courriel)) WHERE supprime_le IS NULL;
CREATE TABLE IF NOT EXISTS proches_comptes_sessions (
  jeton_hash           text PRIMARY KEY,
  compte_id            int NOT NULL REFERENCES proches_comptes(id),
  expire_le            timestamptz NOT NULL,
  cree_le              timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE proches_acces ADD COLUMN IF NOT EXISTS compte_id int REFERENCES proches_comptes(id);
CREATE INDEX IF NOT EXISTS proches_acces_compte ON proches_acces (compte_id) WHERE revoque_le IS NULL;
CREATE TABLE IF NOT EXISTS proches_codes_rattachement (
  id                   serial PRIMARY KEY,
  resident_id          int NOT NULL REFERENCES residents(id),
  etablissement_id     int NOT NULL REFERENCES etablissements(id),
  code_hash            text NOT NULL,                       -- empreinte seulement ; le code est remis une fois
  expire_le            timestamptz NOT NULL,
  utilise_le           timestamptz,
  cree_par             int REFERENCES utilisateurs(id),
  cree_le              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS proches_codes_rattachement_code ON proches_codes_rattachement (etablissement_id, code_hash);
CREATE TABLE IF NOT EXISTS proches_demandes_rattachement (
  id                   serial PRIMARY KEY,
  compte_id            int NOT NULL REFERENCES proches_comptes(id),
  etablissement_id     int NOT NULL REFERENCES etablissements(id),
  proche_prenom        text NOT NULL,
  proche_nom           text NOT NULL,
  proche_telephone     text,
  resident_prenom      text NOT NULL,
  resident_nom         text NOT NULL,
  lien                 text NOT NULL CHECK (lien IN ('fille', 'fils', 'conjoint', 'soeur', 'frere', 'parent', 'petit_enfant', 'ami', 'voisin', 'tuteur', 'autre')),
  representant_legal   boolean NOT NULL DEFAULT false,
  code_id              int REFERENCES proches_codes_rattachement(id),   -- code valide fourni ; jamais révélé au proche
  consentement_declare_le timestamptz NOT NULL,
  statut               text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'acceptee', 'refusee', 'retiree', 'expiree')),
  traite_par           int REFERENCES utilisateurs(id),
  traite_le            timestamptz,
  acces_id             int REFERENCES proches_acces(id),
  cree_le              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proches_demandes_rattachement_file ON proches_demandes_rattachement (etablissement_id, statut, cree_le);
CREATE INDEX IF NOT EXISTS proches_demandes_rattachement_compte ON proches_demandes_rattachement (compte_id, cree_le);
CREATE TABLE IF NOT EXISTS proches_consentements (
  id                   serial PRIMARY KEY,
  acces_id             int NOT NULL REFERENCES proches_acces(id),
  demande_id           int REFERENCES proches_demandes_rattachement(id),
  resident_id          int NOT NULL REFERENCES residents(id),
  etablissement_id     int NOT NULL REFERENCES etablissements(id),
  type                 text NOT NULL CHECK (type IN ('resident', 'representant_legal', 'mandataire', 'tuteur', 'curateur')),
  donne_par            text NOT NULL,
  donne_le             date NOT NULL,
  verification         text NOT NULL CHECK (verification IN ('rappel_telephonique', 'piece_identite', 'code_remis', 'autre')),
  verification_precision text,
  enregistre_par       int REFERENCES utilisateurs(id),
  cree_le              timestamptz NOT NULL DEFAULT now()
);

-- Profils de pays créés depuis SH (11 nov. 2026) : pays ISO du profil et langues ; la correspondance ARRIMO_PROFILS_PAYS reste lue en secours
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS pays_code char(2) CHECK (pays_code IS NULL OR pays_code ~ '^[A-Z]{2}$');
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS langues text[];
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS version_sh int;

-- ======================================================================
-- Arrimo Préhospitalier, phase 1 (12 nov. 2026) : organisations de secours, unités, préalertes
-- Décisions de Moustafa (docs/AUDIT_PREHOSPITALIER_2026-11-12.md, section 14) : organisations à part (ni lits ni places),
-- aucune identité ni motif libre (catégorie en liste fermée), moteurs de transfert séparés (simple lien).
-- ======================================================================
CREATE TABLE IF NOT EXISTS organisations_secours (
  id         serial PRIMARY KEY,
  code       text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  nom        text NOT NULL,
  type       text NOT NULL CHECK (type IN ('ambulancier', 'ccs')),   -- entreprise ambulancière ou centre de communication santé
  config_id  int  NOT NULL REFERENCES config_pays(id),               -- région : profil du pays (périmètre d'un CCS)
  actif      boolean NOT NULL DEFAULT true,
  cree_le    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS utilisateur_organisations (
  utilisateur_id   int NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  organisation_id  int NOT NULL REFERENCES organisations_secours(id) ON DELETE CASCADE,
  PRIMARY KEY (utilisateur_id, organisation_id)
);
CREATE TABLE IF NOT EXISTS unites_secours (
  id               serial PRIMARY KEY,
  organisation_id  int  NOT NULL REFERENCES organisations_secours(id),
  numero           text NOT NULL,          -- numéro d'unité
  plaque           text,
  actif            boolean NOT NULL DEFAULT true,
  UNIQUE (organisation_id, numero)
);
-- Positions : seulement si l'équipe l'autorise ; conservées 24 h (purge dans src/server.js)
CREATE TABLE IF NOT EXISTS positions_unites (
  id             bigserial PRIMARY KEY,
  unite_id       int NOT NULL REFERENCES unites_secours(id) ON DELETE CASCADE,
  latitude       double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude      double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  precision_m    int CHECK (precision_m IS NULL OR precision_m >= 0),
  enregistree_le timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS positions_unite_date ON positions_unites (unite_id, enregistree_le DESC);

CREATE SEQUENCE IF NOT EXISTS prealerte_seq;
CREATE TABLE IF NOT EXISTS prealertes (
  id                    serial PRIMARY KEY,
  numero                text NOT NULL UNIQUE,     -- PA-000001 : identifiant temporaire d'intervention, jamais une identité
  organisation_id       int  NOT NULL REFERENCES organisations_secours(id),
  unite_id              int  NOT NULL REFERENCES unites_secours(id),
  destination_id        int  NOT NULL REFERENCES etablissements(id),
  statut                text NOT NULL DEFAULT 'envoyee' CHECK (statut IN ('envoyee', 'recue', 'consultee', 'prise_en_compte', 'preparation',
                          'preparation_terminee', 'arrivee', 'cloturee', 'annulee', 'remplacee')),
  priorite              text NOT NULL CHECK (priorite IN ('immediate', 'urgente', 'non_urgente')),   -- déclarée par le professionnel
  categorie             text NOT NULL,            -- liste fermée (src/prealertes.js), jamais de texte libre
  equipage              int[] NOT NULL DEFAULT '{}',
  heure_prevue          timestamptz,
  recue_le              timestamptz,              -- confirmation technique : l'écran de l'hôpital l'a reçue
  consultee_le          timestamptz,              -- fiche ouverte par une personne de l'hôpital
  prise_en_compte_le    timestamptz,              -- confirmation humaine explicite
  prise_en_compte_par   int REFERENCES utilisateurs(id),
  preparation_le        timestamptz,
  preparation_terminee_le timestamptz,
  arrivee_signalee_le   timestamptz,              -- signalée par l'ambulance
  arrivee_confirmee_le  timestamptz,              -- l'hôpital a confirmé que c'est le bon véhicule
  remise_le             timestamptz,
  cloturee_le           timestamptz,
  remplace_id           int REFERENCES prealertes(id),   -- changement de destination : l'ancienne est conservée
  transfert_id          int REFERENCES transferts(id),   -- lien facultatif vers un transfert existant
  coordination_id       int REFERENCES coordinations(id),
  cle_idempotence       text,
  version               int  NOT NULL DEFAULT 1,
  cree_par              int  REFERENCES utilisateurs(id),
  cree_le               timestamptz NOT NULL DEFAULT now(),
  modifie_le            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, cle_idempotence)
);
-- Une seule préalerte ouverte par unité
CREATE UNIQUE INDEX IF NOT EXISTS prealertes_unite_ouverte ON prealertes (unite_id)
  WHERE statut NOT IN ('cloturee', 'annulee', 'remplacee');
CREATE INDEX IF NOT EXISTS prealertes_destination ON prealertes (destination_id, statut);

-- Historique des préalertes : immuable, comme le journal
CREATE TABLE IF NOT EXISTS prealerte_evenements (
  id              bigserial PRIMARY KEY,
  prealerte_id    int  NOT NULL REFERENCES prealertes(id),
  type            text NOT NULL,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  utilisateur_id  int  REFERENCES utilisateurs(id),
  cree_le         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prealerte_evenements_pa ON prealerte_evenements (prealerte_id, id);
DROP TRIGGER IF EXISTS prealerte_evenements_pas_de_modif ON prealerte_evenements;
CREATE TRIGGER prealerte_evenements_pas_de_modif BEFORE UPDATE OR DELETE ON prealerte_evenements
  FOR EACH ROW EXECUTE FUNCTION journal_immuable();
DROP TRIGGER IF EXISTS prealerte_evenements_pas_de_vidage ON prealerte_evenements;
CREATE TRIGGER prealerte_evenements_pas_de_vidage BEFORE TRUNCATE ON prealerte_evenements
  FOR EACH STATEMENT EXECUTE FUNCTION journal_immuable();

-- Préhospitalier, phase 4 (12 nov. 2026) : proposition de service par OG, validée par l'hôpital (cahier, section 2.2)
-- La règle vient de l'établissement : services.attributs.categories_secours (liste de catégories) et services.attributs.secours_defaut.
ALTER TABLE prealertes ADD COLUMN IF NOT EXISTS service_propose_id int REFERENCES services(id);
ALTER TABLE prealertes ADD COLUMN IF NOT EXISTS service_justification jsonb;
ALTER TABLE prealertes ADD COLUMN IF NOT EXISTS service_statut text CHECK (service_statut IN ('a_confirmer', 'confirme', 'modifie', 'refuse', 'sans_proposition'));
ALTER TABLE prealertes ADD COLUMN IF NOT EXISTS service_confirme_id int REFERENCES services(id);
ALTER TABLE prealertes ADD COLUMN IF NOT EXISTS service_confirme_par int REFERENCES utilisateurs(id);
ALTER TABLE prealertes ADD COLUMN IF NOT EXISTS service_confirme_le timestamptz;

-- Préhospitalier, phase 5 (12 nov. 2026) : statut déclaré de l'urgence (cahier, section 9), avec source, auteur et heure.
-- Une déclaration plus ancienne que le seuil n'est jamais présentée comme actuelle (seuil initial 15 min, à valider avec les établissements).
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS urgence_statut_declare text CHECK (urgence_statut_declare IN ('ouvert', 'capacite_limitee', 'saturation', 'delestage'));
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS urgence_statut_le timestamptz;
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS urgence_statut_par int REFERENCES utilisateurs(id);
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS disponibilite_fraicheur_min int NOT NULL DEFAULT 15 CHECK (disponibilite_fraicheur_min BETWEEN 1 AND 240);

-- Liaison Établissements (cahier 3, 12 nov. 2026) : demandes de transport d'un établissement (CHSLD, RPA, RI, RTF) ou d'un hôpital
-- vers une entreprise ambulancière, rattachées à une coordination existante (hospitalisation ou retour). Parcours distinct des préalertes.
-- L'ambulance ne voit que la référence du résident (R-00000), les lieux et les informations de transport (listes fermées).
CREATE SEQUENCE IF NOT EXISTS transport_demande_seq;
CREATE TABLE IF NOT EXISTS demandes_transport (
  id                serial PRIMARY KEY,
  numero            text NOT NULL UNIQUE,                 -- DT-000001
  coordination_id   int  NOT NULL REFERENCES coordinations(id),
  organisation_id   int  NOT NULL REFERENCES organisations_secours(id),
  unite_id          int  REFERENCES unites_secours(id),
  origine_id        int  NOT NULL REFERENCES etablissements(id),
  destination_id    int  NOT NULL REFERENCES etablissements(id),
  resident_ref      text NOT NULL,
  heure_souhaitee   timestamptz,
  infos             jsonb NOT NULL DEFAULT '{}'::jsonb,   -- accessibilité, accompagnateur, langue (listes fermées de la coordination)
  statut            text NOT NULL DEFAULT 'demandee' CHECK (statut IN ('demandee', 'acceptee', 'refusee', 'en_route', 'pris_en_charge', 'arrivee', 'annulee')),
  acceptee_le       timestamptz, en_route_le timestamptz, pris_en_charge_le timestamptz, arrivee_le timestamptz,
  motif_refus       text CHECK (motif_refus IN ('aucune_unite', 'hors_territoire', 'autre')),
  cle_idempotence   text,
  version           int  NOT NULL DEFAULT 1,
  cree_par          int  REFERENCES utilisateurs(id),
  cree_le           timestamptz NOT NULL DEFAULT now(),
  modifie_le        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origine_id, cle_idempotence)
);
CREATE UNIQUE INDEX IF NOT EXISTS demandes_transport_ouverte ON demandes_transport (coordination_id) WHERE statut IN ('demandee', 'acceptee', 'en_route', 'pris_en_charge');
CREATE TABLE IF NOT EXISTS demande_transport_evenements (
  id             bigserial PRIMARY KEY,
  demande_id     int  NOT NULL REFERENCES demandes_transport(id),
  type           text NOT NULL,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  utilisateur_id int  REFERENCES utilisateurs(id),
  cree_le        timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS demande_transport_evenements_pas_de_modif ON demande_transport_evenements;
CREATE TRIGGER demande_transport_evenements_pas_de_modif BEFORE UPDATE OR DELETE ON demande_transport_evenements
  FOR EACH ROW EXECUTE FUNCTION journal_immuable();
DROP TRIGGER IF EXISTS demande_transport_evenements_pas_de_vidage ON demande_transport_evenements;
CREATE TRIGGER demande_transport_evenements_pas_de_vidage BEFORE TRUNCATE ON demande_transport_evenements
  FOR EACH STATEMENT EXECUTE FUNCTION journal_immuable();

-- Arrimo Connect (12 nov. 2026, cahier 2, section 11) : systèmes externes des organisations de secours (répartition des CCS,
-- systèmes ambulanciers). Clé montrée une seule fois (empreinte stockée) ; secret de signature HMAC chiffré au repos.
CREATE TABLE IF NOT EXISTS connecteurs_secours (
  id                    serial PRIMARY KEY,
  organisation_id       int  NOT NULL REFERENCES organisations_secours(id),
  nom                   text NOT NULL,
  cle_hash              text NOT NULL UNIQUE,
  secret                text NOT NULL,
  actif                 boolean NOT NULL DEFAULT true,
  cree_le               timestamptz NOT NULL DEFAULT now(),
  derniere_utilisation  timestamptz
);
ALTER TABLE prealertes ADD COLUMN IF NOT EXISTS mission_externe text;          -- identifiant de mission du système partenaire, si fourni
ALTER TABLE prealertes ADD COLUMN IF NOT EXISTS connecteur_id int REFERENCES connecteurs_secours(id);

-- Scénario D (décision de Moustafa, 12 nov. 2026) : correspondance avec un dossier par un système hospitalier SIMULÉ,
-- en démonstration seulement, parmi les fiches fictives (src/patients.js). Identité visible par l'hôpital seulement ;
-- jamais dans le journal, les notifications, ni pour l'ambulance ou le CCS.
ALTER TABLE prealertes ADD COLUMN IF NOT EXISTS correspondance_statut text CHECK (correspondance_statut IN ('confirmee', 'incertaine', 'aucune'));
ALTER TABLE prealertes ADD COLUMN IF NOT EXISTS correspondance_patient_id int REFERENCES patients(id);
ALTER TABLE prealertes ADD COLUMN IF NOT EXISTS correspondance_candidats int[];
ALTER TABLE prealertes ADD COLUMN IF NOT EXISTS correspondance_le timestamptz;
ALTER TABLE prealertes ADD COLUMN IF NOT EXISTS correspondance_par int REFERENCES utilisateurs(id);

-- Organisations de secours (décision de Moustafa, 12 nov. 2026) : un seul modèle ; le TYPE dit ce qu'est l'organisation,
-- les PROFILS activés (depuis SH) disent ce qu'elle fait dans Arrimo : CCS (répartition, vue régionale) et/ou Ambulance (unités, préalertes).
-- Urgences-santé : les deux profils sur la même organisation. Mêmes écrans, même API (Arrimo Connect v1).
ALTER TABLE organisations_secours DROP CONSTRAINT IF EXISTS organisations_secours_type_check;
ALTER TABLE organisations_secours ADD CONSTRAINT organisations_secours_type_check
  CHECK (type IN ('ccs', 'ambulancier', 'urgences_sante', 'premiers_repondants'));
ALTER TABLE organisations_secours ADD COLUMN IF NOT EXISTS profils text[];
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisations_secours_profils_check') THEN
    ALTER TABLE organisations_secours ADD CONSTRAINT organisations_secours_profils_check CHECK (profils <@ ARRAY['ccs', 'ambulance']::text[]);
  END IF;
END $$;
-- Organisations créées avant les profils (profils NULL seulement) : profil déduit du type. Un profil retiré par un administrateur
-- ('{}') n'est jamais réactivé par une reprise du schéma.
UPDATE organisations_secours SET profils = CASE type WHEN 'ccs' THEN ARRAY['ccs'] WHEN 'ambulancier' THEN ARRAY['ambulance'] WHEN 'urgences_sante' THEN ARRAY['ccs', 'ambulance'] ELSE ARRAY[]::text[] END
  WHERE profils IS NULL;
ALTER TABLE organisations_secours ALTER COLUMN profils SET DEFAULT '{}';
ALTER TABLE organisations_secours ALTER COLUMN profils SET NOT NULL;

-- Remise des secrets (exigence permanente de Moustafa, 12 nov. 2026) : clés et secrets de connexion générés sur le serveur et
-- jamais affichés (administration, SH, journal) ; remis une seule fois par un lien à usage unique, valable 24 h, envoyé au contact
-- technique du client. Contenu chiffré au repos, effacé dès qu'il est récupéré ou expiré.
CREATE TABLE IF NOT EXISTS remises_secrets (
  id             serial PRIMARY KEY,
  genre          text NOT NULL CHECK (genre IN ('connect', 'adt')),
  ref_id         int  NOT NULL,
  jeton_hash     text NOT NULL UNIQUE,
  contenu        text,                     -- chiffré ; NULL une fois récupéré ou expiré
  destinataire   text NOT NULL,
  envoyee        boolean NOT NULL DEFAULT false,
  expire_le      timestamptz NOT NULL,
  recupere_le    timestamptz,
  cree_par       int REFERENCES utilisateurs(id),
  cree_le        timestamptz NOT NULL DEFAULT now()
);

-- Démo et terrain : une préalerte peut prolonger une demande de transport (résident d'un établissement) ; simple lien, parcours distincts
ALTER TABLE prealertes ADD COLUMN IF NOT EXISTS demande_transport_id int REFERENCES demandes_transport(id);

-- Connexions des logiciels externes, client par client (exigence permanente de Moustafa, 12 nov. 2026) : activées depuis SH,
-- droits limités aux données du client, désactivables, journalisées ; secrets remis au contact technique, jamais affichés.
-- Aucun port ouvert : tout passe par HTTPS (443). Portées d'un connecteur d'établissement : adt (JSON), hl7v2 (messages bruts), fhir (lecture R4).
ALTER TABLE connecteurs ADD COLUMN IF NOT EXISTS portees text[] NOT NULL DEFAULT ARRAY['adt'];
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connecteurs_portees_check') THEN
    ALTER TABLE connecteurs ADD CONSTRAINT connecteurs_portees_check CHECK (portees <@ ARRAY['adt', 'hl7v2', 'fhir']::text[]);
  END IF;
END $$;
-- Webhooks sortants signés (HMAC-SHA256) : file d'envoi, nouvelles tentatives, abandon visible en supervision (file d'échec)
CREATE TABLE IF NOT EXISTS webhooks (
  id                serial PRIMARY KEY,
  etablissement_id  int REFERENCES etablissements(id),
  organisation_id   int REFERENCES organisations_secours(id),
  nom               text NOT NULL,
  url               text NOT NULL,
  secret            text NOT NULL,                 -- chiffré au repos, remis une seule fois
  evenements        text[] NOT NULL,
  actif             boolean NOT NULL DEFAULT true,
  cree_le           timestamptz NOT NULL DEFAULT now(),
  CHECK ((etablissement_id IS NULL) <> (organisation_id IS NULL))
);
CREATE TABLE IF NOT EXISTS webhook_livraisons (
  id               bigserial PRIMARY KEY,
  webhook_id       int NOT NULL REFERENCES webhooks(id),
  evenement        text NOT NULL,
  charge           jsonb NOT NULL,
  statut           text NOT NULL DEFAULT 'a_envoyer' CHECK (statut IN ('a_envoyer', 'envoyee', 'abandonnee')),
  tentatives       int NOT NULL DEFAULT 0,
  prochain_essai   timestamptz NOT NULL DEFAULT now(),
  derniere_erreur  text,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  envoyee_le       timestamptz
);
CREATE INDEX IF NOT EXISTS webhook_livraisons_dues ON webhook_livraisons (prochain_essai) WHERE statut = 'a_envoyer';
ALTER TABLE remises_secrets DROP CONSTRAINT IF EXISTS remises_secrets_genre_check;
ALTER TABLE remises_secrets ADD CONSTRAINT remises_secrets_genre_check CHECK (genre IN ('connect', 'adt', 'webhook'));

-- État des véhicules (décision de Moustafa, 13 nov. 2026) : le CCS voit l'état de ses ambulances, sans attribution ni répartition
-- dans Arrimo. L'équipage le change en un geste ; il passe seul à « Transport vers l'hôpital » à l'envoi d'une préalerte et à
-- « À l'hôpital » à l'arrivée confirmée par l'hôpital. Nouvelles tables seulement : aucune table existante n'est modifiée.
CREATE TABLE IF NOT EXISTS etats_vehicules (
  unite_id        int PRIMARY KEY REFERENCES unites_secours(id) ON DELETE CASCADE,
  etat            text NOT NULL CHECK (etat IN ('disponible', 'en_route', 'sur_place', 'transport_hopital', 'a_l_hopital', 'hors_service')),
  destination_id  int REFERENCES etablissements(id),
  source          text NOT NULL DEFAULT 'equipage' CHECK (source IN ('equipage', 'prealerte', 'arrivee_confirmee')),
  version         int NOT NULL DEFAULT 1,
  modifie_par     int REFERENCES utilisateurs(id),
  modifie_le      timestamptz NOT NULL DEFAULT now()
);
-- Historique des états : immuable, comme le journal
CREATE TABLE IF NOT EXISTS etat_vehicule_evenements (
  id              bigserial PRIMARY KEY,
  unite_id        int NOT NULL REFERENCES unites_secours(id),
  etat            text NOT NULL,
  destination_id  int REFERENCES etablissements(id),
  source          text NOT NULL,
  utilisateur_id  int REFERENCES utilisateurs(id),
  cree_le         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS etat_vehicule_evenements_unite ON etat_vehicule_evenements (unite_id, id);
DROP TRIGGER IF EXISTS etat_vehicule_evenements_pas_de_modif ON etat_vehicule_evenements;
CREATE TRIGGER etat_vehicule_evenements_pas_de_modif BEFORE UPDATE OR DELETE ON etat_vehicule_evenements
  FOR EACH ROW EXECUTE FUNCTION journal_immuable();
DROP TRIGGER IF EXISTS etat_vehicule_evenements_pas_de_vidage ON etat_vehicule_evenements;
CREATE TRIGGER etat_vehicule_evenements_pas_de_vidage BEFORE TRUNCATE ON etat_vehicule_evenements
  FOR EACH STATEMENT EXECUTE FUNCTION journal_immuable();

-- Demande de transport d'un établissement d'hébergement (13 nov. 2026) : type d'urgence (liste fermée des préalertes) et hôpital
-- souhaité, à titre d'information seulement. La destination reste décidée par l'équipage et les protocoles : Arrimo informe.
CREATE TABLE IF NOT EXISTS demande_transport_preferences (
  demande_id          int PRIMARY KEY REFERENCES demandes_transport(id),
  categorie           text CHECK (categorie IS NULL OR categorie IN ('medicale', 'traumatologie', 'cardiaque', 'neurologique', 'respiratoire',
                        'pediatrique', 'obstetrique', 'sante_mentale', 'autre')),
  hopital_prefere_id  int REFERENCES etablissements(id),
  cree_le             timestamptz NOT NULL DEFAULT now()
);

-- Heure d'arrivée calculée (13 nov. 2026) : recalculée par le routeur (OSRM) à chaque position transmise par l'équipage
-- (changement d'état, préalerte, « Actualiser », environ chaque minute pendant le transport). Positions conservées 24 h.
CREATE TABLE IF NOT EXISTS eta_prealertes (
  prealerte_id  int PRIMARY KEY REFERENCES prealertes(id),
  minutes       int CHECK (minutes IS NULL OR minutes >= 0),
  distance_km   numeric(7,1) CHECK (distance_km IS NULL OR distance_km >= 0),
  source        text NOT NULL CHECK (source IN ('osrm', 'vol_oiseau')),
  position_le   timestamptz NOT NULL,
  calcule_le    timestamptz NOT NULL DEFAULT now()
);

-- Parcours final du préhospitalier (décision de Moustafa, 13 nov. 2026) : demande de réservation de civière, confirmation rapide
-- de l'hôpital qui ne bloque JAMAIS un transport, civière réservée, arrivée sur la civière réservée. Nouvelles tables seulement.
-- Confirmation rapide : 60 s par défaut (ARRIMO_SECOURS_DELAI_REPONSE_S) ; sans réponse = acceptée ; priorité immédiate = hôpital averti, aucune attente.
CREATE TABLE IF NOT EXISTS prealerte_confirmations (
  prealerte_id      int PRIMARY KEY REFERENCES prealertes(id),
  statut            text NOT NULL CHECK (statut IN ('en_attente', 'acceptee', 'reorientee', 'sans_reponse', 'avertie')),
  delai_s           int  NOT NULL CHECK (delai_s BETWEEN 0 AND 600),
  echeance          timestamptz NOT NULL,
  motif             text CHECK (motif IS NULL OR motif IN ('delestage', 'scanner_indisponible', 'service_ferme', 'autre')),
  repondu_le        timestamptz,
  repondu_par       int REFERENCES utilisateurs(id),
  delai_reponse_s   int,
  cree_le           timestamptz NOT NULL DEFAULT now()
);
-- Civière réservée pour une préalerte : la civière reste « libre » dans son état, mais ne peut être donnée à un autre patient
-- (refus dans src/regles.js) et n'est plus comptée comme libre. Installation du patient à l'arrivée, puis admission en lit.
CREATE TABLE IF NOT EXISTS reservations_civieres (
  prealerte_id   int PRIMARY KEY REFERENCES prealertes(id),
  etablissement_id int NOT NULL REFERENCES etablissements(id),
  civiere_id     int REFERENCES civieres(id),
  statut         text NOT NULL CHECK (statut IN ('reservee', 'sans_civiere', 'installee', 'liberee')),
  reservee_le    timestamptz NOT NULL DEFAULT now(),
  installee_le   timestamptz,
  liberee_le     timestamptz,
  version        int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS reservations_civiere_active ON reservations_civieres (civiere_id) WHERE statut = 'reservee';
-- Profil minimal transmis à l'hôpital (démonstration seulement, décision du 6 nov. 2026) : listes fermées, jamais de nom ni de texte libre ;
-- jamais dans le journal, les notifications, ni pour l'entretien.
CREATE TABLE IF NOT EXISTS prealerte_profils (
  prealerte_id  int PRIMARY KEY REFERENCES prealertes(id),
  tranche_age   text CHECK (tranche_age IS NULL OR tranche_age IN ('0-17', '18-39', '40-64', '65-79', '80+')),
  sexe          text CHECK (sexe IS NULL OR sexe IN ('F', 'M', 'X')),
  signes        text[] NOT NULL DEFAULT '{}',
  cree_le       timestamptz NOT NULL DEFAULT now()
);
