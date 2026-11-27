-- Centre de commandement CCS et flotte connectée (cahiers du 27 nov. 2026). Nouvelles tables et colonnes facultatives seulement :
-- aucune ligne existante n'est modifiée. Arrimo transmet, le CCS et les protocoles décident ; aucune réorientation automatique.
BEGIN;
-- Transmission d'une mission : envoyée (cree_le) ≠ reçue (accusé de l'appareil) ≠ consultée (ouverte par l'équipe) ≠ acceptée (statut)
ALTER TABLE missions_ccs ADD COLUMN IF NOT EXISTS recue_le timestamptz;
ALTER TABLE missions_ccs ADD COLUMN IF NOT EXISTS consultee_le timestamptz;
ALTER TABLE missions_ccs ADD COLUMN IF NOT EXISTS instructions text CHECK (instructions IS NULL OR length(instructions) <= 280);
ALTER TABLE missions_ccs ADD COLUMN IF NOT EXISTS destination_id int REFERENCES etablissements(id);
ALTER TABLE missions_ccs ADD COLUMN IF NOT EXISTS destination_libelle text CHECK (destination_libelle IS NULL OR length(destination_libelle) <= 120);
-- Communication opérationnelle CCS ↔ ambulance : messages rapides et instructions, traçables, sans donnée clinique ni identité
CREATE TABLE IF NOT EXISTS messages_flotte (
  id                 bigserial PRIMARY KEY,
  unite_id           int  NOT NULL REFERENCES unites_secours(id),
  mission_id         int  REFERENCES missions_ccs(id),
  organisation_ccs_id int REFERENCES organisations_secours(id),
  sens               text NOT NULL CHECK (sens IN ('ccs', 'ambulance', 'etablissement')),
  etablissement_id   int  REFERENCES etablissements(id),   -- urgence ou hébergement concerné par la mission (émetteur ou destinataire)
  genre              text NOT NULL CHECK (genre IN ('message', 'instruction', 'destination', 'retard', 'incident', 'assistance', 'reception', 'remise_dispo', 'etape')),
  code_rapide        text CHECK (code_rapide IS NULL OR code_rapide ~ '^[a-z_]{2,40}$'),
  texte              text CHECK (texte IS NULL OR length(texte) <= 200),
  cle_idempotence    text CHECK (cle_idempotence IS NULL OR cle_idempotence ~ '^[A-Za-z0-9_-]{8,64}$'),
  cree_par           int  REFERENCES utilisateurs(id),
  cree_le            timestamptz NOT NULL DEFAULT now(),
  recu_le            timestamptz,
  lu_le              timestamptz,
  lu_par             int  REFERENCES utilisateurs(id),
  UNIQUE (unite_id, cle_idempotence)
);
CREATE INDEX IF NOT EXISTS messages_flotte_unite ON messages_flotte (unite_id, cree_le DESC);
-- Seuils d'immobilisation (indicatifs, jamais cliniques), réglés depuis SH par organisation ; défaut démo : 20 min vigilance, 30 min escalade
CREATE TABLE IF NOT EXISTS seuils_flotte (
  organisation_id    int PRIMARY KEY REFERENCES organisations_secours(id),
  vigilance_min      int NOT NULL CHECK (vigilance_min BETWEEN 1 AND 600),
  escalade_min       int NOT NULL CHECK (escalade_min BETWEEN 2 AND 1440),
  modifie_par        text,
  modifie_le         timestamptz NOT NULL DEFAULT now(),
  CHECK (escalade_min > vigilance_min)
);
-- Modules et sous-modules des interfaces de secours, activés depuis SH par organisation (`sm:<profil>.<module>` = false) ; vide = tout
ALTER TABLE organisations_secours ADD COLUMN IF NOT EXISTS modules jsonb;
COMMIT;
