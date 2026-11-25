-- Refonte unifiée, design system (26 nov. 2026, maquette validée par Moustafa) : ambiance personnelle (Glacier, Horizon) en mode clair ;
-- Crépuscule = mode sombre. Préférence de chaque utilisateur, sans effet sur les couleurs métier (modules, mouvements, alertes).
BEGIN;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS ambiance text NOT NULL DEFAULT 'glacier' CHECK (ambiance IN ('glacier', 'horizon'));
COMMIT;
