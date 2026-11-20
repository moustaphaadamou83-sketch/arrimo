-- =====================================================================================================
-- Mode crise (20 nov. 2026, cahier v2, C.7) : évacuation d'un établissement d'hébergement. Migration additive et rejouable.
-- Un lieu est PROPOSÉ par résident (classement de la bourse), une personne confirme ; la place est réservée par les règles des lits ;
-- départ, arrivée et retour suivis ; familles avisées par Arrimo Famille (catégorie « mouvements », sans détail) ; levée journalisée.
-- =====================================================================================================
CREATE SEQUENCE IF NOT EXISTS evacuation_seq;
CREATE TABLE IF NOT EXISTS evacuations (
  id                serial PRIMARY KEY,
  numero            text NOT NULL UNIQUE,
  etablissement_id  int  NOT NULL REFERENCES etablissements(id),
  motif             text NOT NULL CHECK (motif IN ('incendie', 'inondation', 'panne_electrique', 'panne_chauffage', 'contamination', 'autre')),
  statut            text NOT NULL DEFAULT 'active' CHECK (statut IN ('active', 'levee')),
  declenchee_par    int  REFERENCES utilisateurs(id),
  declencheur_role  text NOT NULL,
  debut_le          timestamptz NOT NULL DEFAULT now(),
  levee_le          timestamptz,
  levee_par         int  REFERENCES utilisateurs(id),
  version           int  NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS evacuations_une_active ON evacuations (etablissement_id) WHERE statut = 'active';
CREATE TABLE IF NOT EXISTS evacuation_residents (
  id                serial PRIMARY KEY,
  evacuation_id     int  NOT NULL REFERENCES evacuations(id),
  resident_id       int  NOT NULL REFERENCES residents(id),
  resident_ref      text NOT NULL,
  destination_id    int  REFERENCES etablissements(id),
  lit_id            int  REFERENCES lits(id),
  statut            text NOT NULL DEFAULT 'a_placer' CHECK (statut IN ('a_placer', 'confirme', 'parti', 'arrive', 'retour_planifie', 'revenu')),
  transport_mode    text CHECK (transport_mode IS NULL OR transport_mode IN ('ambulance', 'transport_adapte', 'famille', 'autre')),
  confirme_le       timestamptz, depart_le timestamptz, arrivee_le timestamptz, retour_prevu_le timestamptz, revenu_le timestamptz, famille_avisee_le timestamptz,
  version           int  NOT NULL DEFAULT 1,
  UNIQUE (evacuation_id, resident_id)
);
