-- =====================================================================================================
-- Derniers modules du cahier v2 (21 nov. 2026) : Visites confirmées, Éviter les transferts inutiles, lecteur du fichier horaire
-- des urgences du MSSS (Données Québec, CC-BY 4.0). Migration additive et rejouable ; aucune donnée existante modifiée.
-- =====================================================================================================
-- Rôle « intervenant » (prestataire de soins à domicile, CLSC) : ses visites seulement
ALTER TABLE utilisateurs DROP CONSTRAINT IF EXISTS utilisateurs_role_check;
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_role_check
  CHECK (role IN ('coordonnateur', 'gestionnaire', 'entretien', 'admin_etab', 'equipe_soins', 'paramedic', 'superviseur_secours', 'repartiteur', 'direction_regionale', 'intervenant'));
-- Profil « visites » des organisations prestataires (même modèle que les organisations de secours)
ALTER TABLE organisations_secours DROP CONSTRAINT IF EXISTS organisations_secours_profils_check;
ALTER TABLE organisations_secours ADD CONSTRAINT organisations_secours_profils_check CHECK (profils <@ ARRAY['ccs', 'ambulance', 'visites']::text[]);
-- L'Horloge suit aussi les visites
ALTER TABLE horodatages DROP CONSTRAINT IF EXISTS horodatages_objet_check;
ALTER TABLE horodatages ADD CONSTRAINT horodatages_objet_check CHECK (objet IN ('prealerte', 'transfert', 'demande_transport', 'demande_hebergement', 'mission_ccs', 'passage_chrono', 'coordination', 'visite'));

-- Visites confirmées : visites prévues du CLSC ou d'un prestataire chez les résidents d'une résidence (RPA, CHSLD…).
-- Type de visite = catégorie de service (jamais un diagnostic) ; arrivée et départ au clic ou par la position autour de la résidence
-- (pendant la plage seulement, avec consentement, position jamais conservée) ; visite manquée signalée ; soins donnés par la résidence à la place.
CREATE SEQUENCE IF NOT EXISTS visite_seq;
CREATE TABLE IF NOT EXISTS visites (
  id                 serial PRIMARY KEY,
  numero             text NOT NULL UNIQUE,
  etablissement_id   int  NOT NULL REFERENCES etablissements(id),
  resident_id        int  NOT NULL REFERENCES residents(id),
  resident_ref       text NOT NULL,
  prestataire_id     int  NOT NULL REFERENCES organisations_secours(id),
  type_visite        text NOT NULL CHECK (type_visite IN ('aide_hygiene', 'soins_infirmiers', 'medication', 'readaptation', 'autre')),
  debut_prevu        timestamptz NOT NULL,
  fin_prevue         timestamptz NOT NULL,
  serie              text,                               -- même série = récurrence créée ensemble
  statut             text NOT NULL DEFAULT 'prevue' CHECK (statut IN ('prevue', 'en_cours', 'terminee', 'manquee', 'annulee')),
  intervenant_id     int  REFERENCES utilisateurs(id),
  soin_rpa           text CHECK (soin_rpa IS NULL OR soin_rpa IN ('aide_hygiene', 'soins_infirmiers', 'medication', 'readaptation', 'autre')),
  soin_rpa_par       int  REFERENCES utilisateurs(id),
  version            int  NOT NULL DEFAULT 1,
  cree_par           int  REFERENCES utilisateurs(id),
  cree_le            timestamptz NOT NULL DEFAULT now(),
  modifie_le         timestamptz NOT NULL DEFAULT now(),
  CHECK (fin_prevue > debut_prevu)
);
CREATE INDEX IF NOT EXISTS visites_etab ON visites (etablissement_id, debut_prevu);
CREATE INDEX IF NOT EXISTS visites_prestataire ON visites (prestataire_id, debut_prevu);
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS visites_rayon_m int NOT NULL DEFAULT 150 CHECK (visites_rayon_m BETWEEN 30 AND 1000);

-- Éviter les transferts inutiles : la liste de vérification et les alternatives viennent DE L'ÉTABLISSEMENT (son protocole) ;
-- Arrimo n'affiche aucune recommandation clinique et ne bloque jamais l'appel ; il compte les transferts évités et ceux faits.
CREATE TABLE IF NOT EXISTS eviter_listes (
  etablissement_id   int PRIMARY KEY REFERENCES etablissements(id),
  verifications      jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(verifications) = 'array'),
  alternatives       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(alternatives) = 'array'),
  version            int NOT NULL DEFAULT 1,
  modifie_par        int REFERENCES utilisateurs(id),
  modifie_le         timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS eviter_decisions (
  id                 serial PRIMARY KEY,
  etablissement_id   int NOT NULL REFERENCES etablissements(id),
  resident_ref       text,
  decision           text NOT NULL CHECK (decision IN ('transfert_evite', 'transfert_fait')),
  alternative        text CHECK (alternative IS NULL OR alternative IN ('medecin_garde', 'infirmiere_praticienne', 'info_sante', 'soutien_domicile', 'telesoins', 'autre')),
  cree_par           int REFERENCES utilisateurs(id),
  cree_le            timestamptz NOT NULL DEFAULT now(),
  CHECK ((decision = 'transfert_evite') = (alternative IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS eviter_decisions_etab ON eviter_decisions (etablissement_id, cree_le);

-- Lecteur du fichier horaire des urgences du MSSS (Données Québec, licence CC-BY 4.0, source citée) : occupation seulement,
-- jamais un état « fermé » déduit ; correspondance installation MSSS → établissement Arrimo pour ne pas doubler une urgence.
CREATE TABLE IF NOT EXISTS urgences_publiques_msss (
  no_permis          text PRIMARY KEY,
  etablissement      text,
  installation       text NOT NULL,
  region             text,
  civieres_fonctionnelles int,
  civieres_occupees  int,
  plus_24h           int,
  plus_48h           int,
  extraction         text,
  mise_a_jour        text,
  lu_le              timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS correspondances_urgences_publiques (
  no_permis          text PRIMARY KEY,
  etablissement_id   int NOT NULL REFERENCES etablissements(id)
);
CREATE TABLE IF NOT EXISTS lectures_msss (
  id                 serial PRIMARY KEY,
  lu_le              timestamptz NOT NULL DEFAULT now(),
  statut             text NOT NULL CHECK (statut IN ('ok', 'echec')),
  lignes             int,
  detail             text
);
