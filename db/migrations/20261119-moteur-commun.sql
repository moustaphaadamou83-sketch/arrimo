-- =====================================================================================================
-- Moteur commun, lot 0 (19 nov. 2026, cahier docs/cahier-6-modules.md, partie B). Migration additive et rejouable ;
-- aucune donnée existante modifiée. Décisions de Moustafa : vues de lecture sans fusion ; directions régionales dans une table à part.
-- =====================================================================================================
-- B.1 Régions (code pays-région, ex. CA-QC-06), groupes de ressources, directions régionales
CREATE TABLE IF NOT EXISTS regions (
  id        serial PRIMARY KEY,
  code      text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{2}(-[A-Z0-9]{1,6}){1,3}$'),
  nom       text NOT NULL,
  nom_en    text NOT NULL,
  pays      text NOT NULL CHECK (pays ~ '^[A-Z]{2}$')
);
INSERT INTO regions (code, nom, nom_en, pays) VALUES
  ('CA-QC-01', 'Bas-Saint-Laurent', 'Bas-Saint-Laurent', 'CA'), ('CA-QC-02', 'Saguenay–Lac-Saint-Jean', 'Saguenay–Lac-Saint-Jean', 'CA'),
  ('CA-QC-03', 'Capitale-Nationale', 'Capitale-Nationale', 'CA'), ('CA-QC-04', 'Mauricie et Centre-du-Québec', 'Mauricie and Centre-du-Québec', 'CA'),
  ('CA-QC-05', 'Estrie', 'Estrie', 'CA'), ('CA-QC-06', 'Montréal', 'Montréal', 'CA'), ('CA-QC-07', 'Outaouais', 'Outaouais', 'CA'),
  ('CA-QC-08', 'Abitibi-Témiscamingue', 'Abitibi-Témiscamingue', 'CA'), ('CA-QC-09', 'Côte-Nord', 'Côte-Nord', 'CA'),
  ('CA-QC-10', 'Nord-du-Québec', 'Nord-du-Québec', 'CA'), ('CA-QC-11', 'Gaspésie–Îles-de-la-Madeleine', 'Gaspésie–Îles-de-la-Madeleine', 'CA'),
  ('CA-QC-12', 'Chaudière-Appalaches', 'Chaudière-Appalaches', 'CA'), ('CA-QC-13', 'Laval', 'Laval', 'CA'), ('CA-QC-14', 'Lanaudière', 'Lanaudière', 'CA'),
  ('CA-QC-15', 'Laurentides', 'Laurentides', 'CA'), ('CA-QC-16', 'Montérégie', 'Montérégie', 'CA'), ('CA-QC-17', 'Nunavik', 'Nunavik', 'CA'),
  ('CA-QC-18', 'Terres-Cries-de-la-Baie-James', 'Eeyou Istchee James Bay (Cree territory)', 'CA')
ON CONFLICT (code) DO NOTHING;
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS region_id int REFERENCES regions(id);
ALTER TABLE organisations_secours ADD COLUMN IF NOT EXISTS region_id int REFERENCES regions(id);
CREATE TABLE IF NOT EXISTS groupes_ressources (
  id         serial PRIMARY KEY,
  code       text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  nom        text NOT NULL,
  region_id  int REFERENCES regions(id),
  cree_le    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS groupe_id int REFERENCES groupes_ressources(id);
-- Ressources sans chambres saisies (HAD, santé mentale) : capacité déclarée en nombre
ALTER TABLE ressource_profils ADD COLUMN IF NOT EXISTS places_declarees int CHECK (places_declarees IS NULL OR places_declarees BETWEEN 0 AND 5000);
ALTER TABLE ressource_profils ADD COLUMN IF NOT EXISTS places_libres_declarees int CHECK (places_libres_declarees IS NULL OR places_libres_declarees >= 0);
CREATE TABLE IF NOT EXISTS directions_regionales (
  id         serial PRIMARY KEY,
  code       text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  nom        text NOT NULL,
  region_id  int NOT NULL REFERENCES regions(id),
  actif      boolean NOT NULL DEFAULT true,
  cree_le    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS utilisateur_directions (
  utilisateur_id  int NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  direction_id    int NOT NULL REFERENCES directions_regionales(id) ON DELETE CASCADE,
  PRIMARY KEY (utilisateur_id, direction_id)
);
ALTER TABLE utilisateurs DROP CONSTRAINT IF EXISTS utilisateurs_role_check;
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_role_check
  CHECK (role IN ('coordonnateur', 'gestionnaire', 'entretien', 'admin_etab', 'equipe_soins', 'paramedic', 'superviseur_secours', 'repartiteur', 'direction_regionale', 'intervenant'));
-- Langue de l'établissement (notifications et courriels quand le destinataire n'a pas choisi)
ALTER TABLE etablissements ADD COLUMN IF NOT EXISTS langue text NOT NULL DEFAULT 'fr' CHECK (langue IN ('fr', 'en'));

-- B.4 Transport : type de véhicule, transporteurs adaptés et prestataires, états « en préparation » et « désinfection »
ALTER TABLE organisations_secours DROP CONSTRAINT IF EXISTS organisations_secours_type_check;
ALTER TABLE organisations_secours ADD CONSTRAINT organisations_secours_type_check
  CHECK (type IN ('ccs', 'ambulancier', 'urgences_sante', 'premiers_repondants', 'transport_adapte', 'prestataire'));
ALTER TABLE unites_secours ADD COLUMN IF NOT EXISTS type_vehicule text NOT NULL DEFAULT 'ambulance'
  CHECK (type_vehicule IN ('ambulance', 'avion', 'transport_adapte', 'autre'));
ALTER TABLE etats_vehicules DROP CONSTRAINT IF EXISTS etats_vehicules_etat_check;
ALTER TABLE etats_vehicules ADD CONSTRAINT etats_vehicules_etat_check
  CHECK (etat IN ('disponible', 'en_route', 'sur_place', 'transport_hopital', 'a_l_hopital', 'hors_service', 'en_preparation', 'desinfection'));

-- B.2 Transferts : motif de refus fermé déjà en place (transferts.motif_refus_code, codes pas_de_lit, pas_de_personnel, plateau_technique, autre)

-- B.5 Horloge : une ligne par heure marquée, immuable ; une correction est une nouvelle ligne (auteur + motif fermé)
CREATE TABLE IF NOT EXISTS horodatages (
  id                bigserial PRIMARY KEY,
  objet             text NOT NULL CHECK (objet IN ('prealerte', 'transfert', 'demande_transport', 'demande_hebergement', 'mission_ccs', 'passage_chrono', 'coordination')),
  objet_id          int  NOT NULL,
  etape             text NOT NULL CHECK (etape IN ('H11', 'H12', 'H13', 'H14', 'H15', 'demande', 'decision', 'depart', 'arrivee', 'prise_en_charge', 'remise', 'reception')),
  heure             timestamptz NOT NULL,       -- heure de l'événement (position, clic), pas de la réception
  source            text NOT NULL CHECK (source IN ('position', 'clic', 'connecteur', 'correction', 'systeme')),
  auteur_id         int REFERENCES utilisateurs(id),
  motif_correction  text CHECK (motif_correction IS NULL OR motif_correction IN ('oubli', 'erreur_saisie', 'position_imprecise', 'panne_reseau', 'autre')),
  remplace_id       bigint REFERENCES horodatages(id),
  heure_detectee    timestamptz,                -- heure détectée par la position, gardée à côté d'une heure saisie (contrôle des écarts)
  enregistre_le     timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'correction') = (motif_correction IS NOT NULL)),
  CHECK (source <> 'correction' OR auteur_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS horodatages_objet ON horodatages (objet, objet_id, etape, id DESC);
DROP TRIGGER IF EXISTS horodatages_pas_de_modif ON horodatages;
CREATE TRIGGER horodatages_pas_de_modif BEFORE UPDATE OR DELETE ON horodatages FOR EACH ROW EXECUTE FUNCTION journal_immuable();
DROP TRIGGER IF EXISTS horodatages_pas_de_vidage ON horodatages;
CREATE TRIGGER horodatages_pas_de_vidage BEFORE TRUNCATE ON horodatages FOR EACH STATEMENT EXECUTE FUNCTION journal_immuable();
CREATE OR REPLACE VIEW v_horodatages_courants AS
  SELECT DISTINCT ON (objet, objet_id, etape) * FROM horodatages ORDER BY objet, objet_id, etape, id DESC;

-- B.2 Demandes : délai de réponse attendu par circuit (réglable), vue de lecture commune des 5 circuits (aucune fusion)
CREATE TABLE IF NOT EXISTS delais_reponse (
  circuit   text PRIMARY KEY CHECK (circuit IN ('transfert', 'transfert_urgent', 'hebergement', 'transport', 'prealerte', 'mission_ccs')),
  minutes   int NOT NULL CHECK (minutes BETWEEN 1 AND 20160)
);
INSERT INTO delais_reponse VALUES ('transfert', 120), ('transfert_urgent', 30), ('hebergement', 4320), ('transport', 60), ('prealerte', 10), ('mission_ccs', 5)
ON CONFLICT (circuit) DO NOTHING;
CREATE OR REPLACE VIEW v_demandes AS
SELECT x.*, x.cree_le + make_interval(mins => d.minutes) AS echeance_le FROM (
  SELECT 'transfert'::text AS circuit, t.id, t.numero, 'etablissement'::text AS demandeur_type, t.origine_id AS demandeur_id,
    'etablissement'::text AS destinataire_type, t.destination_id AS destinataire_id, t.statut AS statut_source,
    CASE t.statut WHEN 'demande' THEN 'en_attente' WHEN 'validee' THEN 'acceptee' WHEN 'recu' THEN 'terminee' WHEN 'refuse' THEN 'refusee' ELSE 'en_cours' END AS statut,
    t.motif_refus_code AS motif, t.date_demande AS cree_le, COALESCE(t.date_validation, t.date_refus) AS repondue_le,
    CASE WHEN t.urgent THEN 'transfert_urgent' ELSE 'transfert' END AS cle_delai
  FROM transferts t
  UNION ALL
  SELECT 'hebergement', h.id, h.numero, CASE WHEN h.hopital_id IS NULL THEN NULL ELSE 'etablissement' END, h.hopital_id, 'etablissement', h.etablissement_id, h.statut,
    CASE WHEN h.statut IN ('recue', 'documents_manquants', 'en_verification') THEN 'en_attente' WHEN h.statut IN ('place_proposee', 'acceptee') THEN 'acceptee'
         WHEN h.statut = 'admise' THEN 'terminee' WHEN h.statut = 'refusee' THEN 'refusee' ELSE 'annulee' END,
    h.motif_refus_code, h.cree_le,
    (SELECT min(e.date) FROM demande_hebergement_etapes e WHERE e.demande_id = h.id AND e.statut IN ('place_proposee', 'acceptee', 'refusee', 'documents_manquants')),
    'hebergement'
  FROM demandes_hebergement h
  UNION ALL
  SELECT 'transport', d.id, d.numero, 'etablissement', d.origine_id, 'organisation', d.organisation_id, d.statut,
    CASE d.statut WHEN 'demandee' THEN 'en_attente' WHEN 'acceptee' THEN 'acceptee' WHEN 'arrivee' THEN 'terminee' WHEN 'refusee' THEN 'refusee' WHEN 'annulee' THEN 'annulee' ELSE 'en_cours' END,
    d.motif_refus, d.cree_le,
    COALESCE(d.acceptee_le, (SELECT min(e.cree_le) FROM demande_transport_evenements e WHERE e.demande_id = d.id AND e.type = 'refusee')), 'transport'
  FROM demandes_transport d
  UNION ALL
  SELECT 'prealerte', p.id, p.numero, 'organisation', p.organisation_id, 'etablissement', p.destination_id, p.statut,
    CASE WHEN p.statut IN ('envoyee', 'recue', 'consultee') THEN 'en_attente' WHEN p.statut IN ('prise_en_compte', 'preparation', 'preparation_terminee') THEN 'acceptee'
         WHEN p.statut = 'arrivee' THEN 'en_cours' WHEN p.statut = 'cloturee' THEN 'terminee' ELSE 'annulee' END,
    NULL, p.cree_le, p.prise_en_compte_le, 'prealerte'
  FROM prealertes p
  UNION ALL
  SELECT 'mission_ccs', m.id, m.numero, 'organisation', m.organisation_ccs_id, 'organisation', u.organisation_id, m.statut,
    CASE m.statut WHEN 'proposee' THEN 'en_attente' WHEN 'acceptee' THEN 'acceptee' WHEN 'sur_place' THEN 'en_cours' WHEN 'terminee' THEN 'terminee' WHEN 'refusee' THEN 'refusee' ELSE 'annulee' END,
    m.motif_refus, m.cree_le,
    (SELECT min(e.cree_le) FROM mission_ccs_evenements e WHERE e.mission_id = m.id AND e.statut IN ('acceptee', 'refusee')), 'mission_ccs'
  FROM missions_ccs m JOIN unites_secours u ON u.id = m.unite_id
) x JOIN delais_reponse d ON d.circuit = x.cle_delai;

-- B.3 Mouvements : vue de lecture commune (transferts, hébergements admis, coordinations, transports)
CREATE OR REPLACE VIEW v_mouvements AS
  SELECT 'transfert'::text AS circuit, t.id, t.numero, t.patient_ref AS reference, t.origine_id, t.destination_id, t.statut,
    t.date_depart AS depart_le, t.date_reception AS arrivee_le FROM transferts t WHERE t.statut IN ('transport', 'en_route', 'recu')
  UNION ALL
  SELECT 'hebergement', h.id, h.numero, h.reference_externe, h.hopital_id, h.etablissement_id, h.statut, h.depart_hopital_le, h.modifie_le
    FROM demandes_hebergement h WHERE h.statut = 'admise'
  UNION ALL
  SELECT 'coordination', c.id, c.numero, c.resident_ref, c.origine_id, c.destination_id, c.statut, NULL::timestamptz, NULL::timestamptz
    FROM coordinations c WHERE c.statut IN ('en_cours', 'recue')
  UNION ALL
  SELECT 'transport', d.id, d.numero, d.resident_ref, d.origine_id, d.destination_id, d.statut, d.pris_en_charge_le, d.arrivee_le
    FROM demandes_transport d WHERE d.statut IN ('en_route', 'pris_en_charge', 'arrivee');
