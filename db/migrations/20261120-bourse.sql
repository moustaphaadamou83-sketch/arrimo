-- =====================================================================================================
-- Bourse des places (20 nov. 2026, cahier v2, C.5). Migration additive et rejouable ; aucune donnée existante modifiée.
-- Lien invité : nominatif, expire après 7 jours, révocable, journalisé ; accès limité à la bourse et à l'envoi d'une demande.
-- Seule l'empreinte du jeton est gardée (une copie de la base ne donne aucun accès).
-- =====================================================================================================
CREATE TABLE IF NOT EXISTS bourse_invitations (
  id                serial PRIMARY KEY,
  jeton_empreinte   text NOT NULL UNIQUE,
  courriel          text NOT NULL CHECK (courriel ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  nom               text NOT NULL CHECK (char_length(nom) BETWEEN 2 AND 120),
  organisation      text NOT NULL CHECK (char_length(organisation) BETWEEN 2 AND 120),
  etablissement_id  int  NOT NULL REFERENCES etablissements(id),   -- établissement qui invite (périmètre : son profil de pays)
  expire_le         timestamptz NOT NULL,
  revoque_le        timestamptz,
  derniere_utilisation_le timestamptz,
  cree_par          int  REFERENCES utilisateurs(id),
  cree_le           timestamptz NOT NULL DEFAULT now(),
  CHECK (expire_le <= cree_le + interval '7 days')
);
ALTER TABLE demandes_hebergement ADD COLUMN IF NOT EXISTS invitation_id int REFERENCES bourse_invitations(id);
DO $$ DECLARE n text; BEGIN
  SELECT conname INTO n FROM pg_constraint WHERE conrelid = 'demandes_hebergement'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%provenance%' AND conname <> 'demandes_hebergement_provenance_v2';
  IF n IS NOT NULL THEN EXECUTE format('ALTER TABLE demandes_hebergement DROP CONSTRAINT %I', n); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'demandes_hebergement_provenance_v2') THEN
    ALTER TABLE demandes_hebergement ADD CONSTRAINT demandes_hebergement_provenance_v2 CHECK (provenance IN ('mecanisme_acces', 'hopital', 'autre_chsld', 'domicile', 'invite'));
  END IF;
END $$;
