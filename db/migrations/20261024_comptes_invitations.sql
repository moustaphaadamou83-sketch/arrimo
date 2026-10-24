-- Compatibilité additive entre les comptes historiques et le parcours
-- d'invitation introduit dans la version candidate.
-- Les comptes existants restent actifs : false signifie qu'ils ne sont pas
-- en attente d'une invitation, conformément au schéma d'initialisation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';
SELECT pg_advisory_xact_lock(hashtext('arrimo:20261024:invitation-en-attente'));

ALTER TABLE public.utilisateurs
  ADD COLUMN IF NOT EXISTS invitation_en_attente boolean NOT NULL DEFAULT false;

ALTER TABLE public.jetons_mdp
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'reinitialisation';

COMMIT;
