-- Chrono T−5 (27 nov. 2026) : préparation anticipée. Préparation du patient (origine) et accueil (destination), distincts de la
-- disponibilité de l'ambulance. État courant ici ; chaque changement, son auteur et l'arrivée estimée du moment restent dans
-- demande_transport_evenements (immuable). Objectif organisationnel, jamais clinique : aucune confirmation ne bloque l'ambulance.
BEGIN;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS patient_etat text CHECK (patient_etat IS NULL OR patient_etat IN ('non_commence', 'en_cours', 'pret', 'retarde', 'indisponible', 'a_renouveler'));
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS patient_etat_motif text CHECK (patient_etat_motif IS NULL OR patient_etat_motif IN ('soins_en_cours', 'documents', 'personnel', 'examen', 'etat_clinique', 'autre'));
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS patient_etat_le timestamptz;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS patient_pret_le timestamptz;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS patient_pret_par int REFERENCES utilisateurs(id);
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS patient_pret_eta_min int;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS accueil_pret_le timestamptz;
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS accueil_pret_par int REFERENCES utilisateurs(id);
ALTER TABLE demandes_transport ADD COLUMN IF NOT EXISTS accueil_pret_eta_min int;
COMMIT;
