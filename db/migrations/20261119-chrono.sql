-- =====================================================================================================
-- Chrono (19 nov. 2026, cahier v2, C.1) : temps des ambulances à l'urgence, H11 à H15. Migration additive et rejouable.
-- Les heures sont dans l'Horloge (horodatages, objet « passage_chrono ») ; ici, seulement le passage et la zone.
-- =====================================================================================================
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS zone_rayon_m int NOT NULL DEFAULT 200 CHECK (zone_rayon_m BETWEEN 50 AND 2000);
-- Cibles du profil de pays (définitions officielles du guide du MSSS pour le Québec ; autre pays = autres cibles)
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS chrono_cible_porte_min int NOT NULL DEFAULT 20 CHECK (chrono_cible_porte_min BETWEEN 1 AND 240);
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS chrono_cible_sortie_min int NOT NULL DEFAULT 25 CHECK (chrono_cible_sortie_min BETWEEN 1 AND 240);
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS chrono_cible_total_min int NOT NULL DEFAULT 45 CHECK (chrono_cible_total_min BETWEEN 1 AND 480);
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS chrono_orange_min int NOT NULL DEFAULT 15 CHECK (chrono_orange_min BETWEEN 1 AND 240);
CREATE SEQUENCE IF NOT EXISTS passage_chrono_seq;
CREATE TABLE IF NOT EXISTS passages_chrono (
  id                    serial PRIMARY KEY,
  numero                text NOT NULL UNIQUE,             -- CH-000001 ; numéro d'unité seulement, jamais une identité
  etablissement_id      int  NOT NULL REFERENCES etablissements(id),
  unite_id              int  NOT NULL REFERENCES unites_secours(id),
  organisation_id       int  NOT NULL REFERENCES organisations_secours(id),
  prealerte_id          int  REFERENCES prealertes(id),   -- absent : ambulance arrivée sans préalerte
  statut                text NOT NULL DEFAULT 'detecte' CHECK (statut IN ('detecte', 'a_la_porte', 'termine', 'abandonne')),
  source                text NOT NULL CHECK (source IN ('position', 'clic', 'connecteur')),
  premiere_position_le  timestamptz,                      -- 1re position dans la zone, en attente d'une 2e pour confirmer H11
  version               int  NOT NULL DEFAULT 1,
  cree_le               timestamptz NOT NULL DEFAULT now(),
  modifie_le            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS passages_chrono_un_ouvert ON passages_chrono (unite_id) WHERE statut IN ('detecte', 'a_la_porte');
CREATE INDEX IF NOT EXISTS passages_chrono_etab ON passages_chrono (etablissement_id, statut, cree_le);
CREATE INDEX IF NOT EXISTS passages_chrono_org ON passages_chrono (organisation_id, cree_le);
-- Heure de la position (téléphone), distincte de l'heure de réception
ALTER TABLE positions_unites ADD COLUMN IF NOT EXISTS position_le timestamptz;
