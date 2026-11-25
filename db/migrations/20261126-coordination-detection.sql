-- Chantier coordination, lot 1 « Détecter » (cahiers du 24 nov. 2026).
-- Additif seulement : aucune ligne existante modifiée.
-- 1) Motifs de retard Chrono : trois motifs de plus (triage saturé, contraintes cliniques, cause inconnue) ; la contrainte
--    est élargie, les motifs déjà consignés restent valides.
-- 2) Seuils de Vigilance transversale (valeurs par défaut configurables, à valider localement ; ce ne sont pas des normes).
BEGIN;
ALTER TABLE passages_chrono_motifs DROP CONSTRAINT IF EXISTS passages_chrono_motifs_motif_check;
ALTER TABLE passages_chrono_motifs ADD CONSTRAINT passages_chrono_motifs_motif_check
  CHECK (motif IN ('civiere', 'personnel', 'chambre', 'dossier', 'saturation', 'nettoyage', 'technique', 'autre', 'triage', 'clinique', 'inconnue'));
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS transport_retard_marge_min int NOT NULL DEFAULT 30 CHECK (transport_retard_marge_min BETWEEN 0 AND 1440);
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS transfert_reponse_max_min int NOT NULL DEFAULT 60 CHECK (transfert_reponse_max_min BETWEEN 5 AND 2880);
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS placement_accepte_max_h int NOT NULL DEFAULT 24 CHECK (placement_accepte_max_h BETWEEN 1 AND 720);
ALTER TABLE config_pays ADD COLUMN IF NOT EXISTS connecteur_silence_max_min int NOT NULL DEFAULT 60 CHECK (connecteur_silence_max_min BETWEEN 5 AND 2880);
COMMIT;
