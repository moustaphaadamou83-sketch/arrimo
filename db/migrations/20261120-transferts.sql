-- =====================================================================================================
-- Transferts (20 nov. 2026, cahier v2, C.3) : centrale régionale et rapatriements. Migration additive et rejouable.
-- Rapatriement : PROPOSÉ quand l'équipe receveuse marque le patient « stable pour retour », jamais déclenché ; une personne
-- accepte (un nouveau transfert est alors demandé par les règles habituelles) ou refuse avec un motif fermé.
-- =====================================================================================================
ALTER TABLE transferts ADD COLUMN IF NOT EXISTS stable_retour_le timestamptz;
ALTER TABLE transferts ADD COLUMN IF NOT EXISTS stable_retour_par int REFERENCES utilisateurs(id);
CREATE TABLE IF NOT EXISTS rapatriements (
  id                 serial PRIMARY KEY,
  transfert_id       int  NOT NULL REFERENCES transferts(id),          -- transfert d'origine (aller)
  propose_vers_id    int  NOT NULL REFERENCES etablissements(id),      -- hôpital proposé dans la région d'origine
  statut             text NOT NULL DEFAULT 'propose' CHECK (statut IN ('propose', 'accepte', 'refuse', 'annule')),
  motif_refus        text CHECK (motif_refus IS NULL OR motif_refus IN ('pas_stable', 'famille_refuse', 'pas_de_lit', 'autre')),
  retour_transfert_id int REFERENCES transferts(id),                   -- transfert de retour créé à l'acceptation
  decide_par         int  REFERENCES utilisateurs(id),
  decide_le          timestamptz,
  cree_le            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rapatriements_un_ouvert ON rapatriements (transfert_id) WHERE statut = 'propose';
INSERT INTO delais_reponse VALUES ('transfert', 120) ON CONFLICT (circuit) DO NOTHING;
