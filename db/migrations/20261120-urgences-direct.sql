-- =====================================================================================================
-- Urgences en direct (20 nov. 2026, cahier v2, C.2). Migration additive et rejouable ; aucune donnée existante modifiée.
-- État « fermée temporairement » avec heure de réouverture ; fermetures planifiées avec services touchés (liste fermée) ;
-- avis tracés ; numéro d'urgence et autres options du profil de pays (page publique, démonstration seulement : décision 4 du 19 nov.).
-- =====================================================================================================
DO $$ DECLARE n text; BEGIN
  SELECT conname INTO n FROM pg_constraint WHERE conrelid = 'etablissements'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%urgence_statut_declare%';
  IF n IS NOT NULL AND n <> 'etablissements_urgence_statut_v2' THEN EXECUTE format('ALTER TABLE etablissements DROP CONSTRAINT %I', n); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'etablissements_urgence_statut_v2') THEN
    ALTER TABLE etablissements ADD CONSTRAINT etablissements_urgence_statut_v2 CHECK (urgence_statut_declare IN ('ouvert', 'capacite_limitee', 'saturation', 'delestage', 'fermee_temporairement'));
  END IF;
END $$;
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS reouverture_prevue_le timestamptz;
CREATE TABLE IF NOT EXISTS fermetures_urgence (
  id                serial PRIMARY KEY,
  etablissement_id  int  NOT NULL REFERENCES etablissements(id),
  debut_le          timestamptz NOT NULL,
  fin_prevue_le     timestamptz NOT NULL,
  services          text[] NOT NULL CHECK (cardinality(services) > 0 AND services <@ ARRAY['toute_urgence', 'pediatrie', 'obstetrique', 'imagerie', 'sante_mentale', 'traumatologie']::text[]),
  statut            text NOT NULL DEFAULT 'planifiee' CHECK (statut IN ('planifiee', 'en_cours', 'terminee', 'annulee')),
  rappel_le         timestamptz,                    -- rappel envoyé 1 h avant le début
  version           int  NOT NULL DEFAULT 1,
  cree_par          int  REFERENCES utilisateurs(id),
  cree_le           timestamptz NOT NULL DEFAULT now(),
  modifie_le        timestamptz NOT NULL DEFAULT now(),
  CHECK (fin_prevue_le > debut_le)
);
CREATE INDEX IF NOT EXISTS fermetures_urgence_etab ON fermetures_urgence (etablissement_id, statut, debut_le);
-- Avis envoyés (annonce, rappel, début, fin) : qui a été prévenu, quand ; immuable comme le journal
CREATE TABLE IF NOT EXISTS fermeture_avis (
  id                 bigserial PRIMARY KEY,
  fermeture_id       int  NOT NULL REFERENCES fermetures_urgence(id),
  type               text NOT NULL CHECK (type IN ('annonce', 'rappel', 'debut', 'fin', 'annulation')),
  destinataire_type  text NOT NULL CHECK (destinataire_type IN ('etablissement', 'organisation')),
  destinataire_id    int  NOT NULL,
  cree_le            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fermeture_avis_f ON fermeture_avis (fermeture_id);
DROP TRIGGER IF EXISTS fermeture_avis_pas_de_modif ON fermeture_avis;
CREATE TRIGGER fermeture_avis_pas_de_modif BEFORE UPDATE OR DELETE ON fermeture_avis FOR EACH ROW EXECUTE FUNCTION journal_immuable();
-- Profil de pays : numéro d'urgence vitale, nombre d'urgences voisines prévenues, autres options affichées au public
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS numero_urgence text NOT NULL DEFAULT '911' CHECK (numero_urgence ~ '^[0-9]{2,4}$');
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS voisins_avises int NOT NULL DEFAULT 3 CHECK (voisins_avises BETWEEN 0 AND 20);
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS options_publiques jsonb NOT NULL DEFAULT
  '[{"code":"811","fr":"Info-Santé 811 : une infirmière au téléphone, jour et nuit","en":"Info-Santé 811: a nurse on the phone, day and night"},
    {"code":"clinique","fr":"Clinique ou GMF : consultation sans rendez-vous","en":"Clinic or family medicine group: walk-in visit"},
    {"code":"pharmacie","fr":"Pharmacien : conseils et certains traitements","en":"Pharmacist: advice and some treatments"}]'::jsonb;
