-- Chantier coordination, lot 2 « Coordonner » (26 nov. 2026) : cycle de vie des alertes de Vigilance.
-- Responsable et remplaçant (grille configurable), échéance, accusé de réception, action engagée (liste fermée),
-- escalade en cas de non-réponse, résolution confirmée par une personne. Un accusé n'est jamais une résolution.
BEGIN;
CREATE TABLE IF NOT EXISTS suivis_alertes (
  id                bigserial PRIMARY KEY,
  etablissement_id  int  NOT NULL REFERENCES etablissements(id),
  cle               text NOT NULL,                      -- type:genre:ressource : un seul suivi ouvert par fait
  type              text NOT NULL,
  niveau            text NOT NULL CHECK (niveau IN ('eleve', 'modere', 'faible')),
  titre             text NOT NULL,
  objet             jsonb,
  statut            text NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte', 'accusee', 'en_action', 'levee', 'resolue')),
  escalade_niveau   int  NOT NULL DEFAULT 0 CHECK (escalade_niveau BETWEEN 0 AND 5),
  responsable_role  text NOT NULL,
  remplacant_role   text,
  assigne_a         int REFERENCES utilisateurs(id),
  echeance          timestamptz NOT NULL,
  accuse_le         timestamptz, accuse_par int REFERENCES utilisateurs(id),
  action_code       text CHECK (action_code IN ('contact_responsable', 'relance_partenaire', 'ressource_mobilisee', 'reaffectation', 'escalade_demandee', 'attente_externe')),
  action_le         timestamptz, action_par int REFERENCES utilisateurs(id),
  levee_le          timestamptz,                         -- le fait n'est plus détecté (pas encore confirmé par une personne)
  resolue_le        timestamptz, resolue_par int REFERENCES utilisateurs(id),
  cree_le           timestamptz NOT NULL DEFAULT now(),
  version           int  NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS suivis_alertes_ouverts ON suivis_alertes (etablissement_id, cle) WHERE statut IN ('ouverte', 'accusee', 'en_action');
CREATE INDEX IF NOT EXISTS suivis_alertes_etab ON suivis_alertes (etablissement_id, cree_le DESC);
CREATE TABLE IF NOT EXISTS suivis_alertes_journal (
  id          bigserial PRIMARY KEY,
  suivi_id    bigint NOT NULL REFERENCES suivis_alertes(id),
  action      text NOT NULL,
  auteur_id   int REFERENCES utilisateurs(id),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  cree_le     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS suivis_alertes_journal_suivi ON suivis_alertes_journal (suivi_id, id);
DROP TRIGGER IF EXISTS suivis_alertes_journal_immuable ON suivis_alertes_journal;
CREATE TRIGGER suivis_alertes_journal_immuable BEFORE UPDATE OR DELETE ON suivis_alertes_journal
  FOR EACH ROW EXECUTE FUNCTION journal_immuable();
-- Grille d'escalade par établissement (à défaut : grille proposée par le cahier nº 2, §5, dans src/suivi-alertes.js)
CREATE TABLE IF NOT EXISTS escalades_regles (
  etablissement_id int  NOT NULL REFERENCES etablissements(id),
  type             text NOT NULL,
  niveau           int  NOT NULL CHECK (niveau BETWEEN 0 AND 5),
  role             text NOT NULL CHECK (role IN ('coordonnateur', 'gestionnaire', 'entretien', 'admin_etab', 'equipe_soins')),
  delai_min        int  NOT NULL CHECK (delai_min BETWEEN 1 AND 1440),
  modifie_par      int REFERENCES utilisateurs(id),
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (etablissement_id, type, niveau)
);
COMMIT;
