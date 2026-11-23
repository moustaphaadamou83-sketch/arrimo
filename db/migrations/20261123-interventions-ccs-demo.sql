BEGIN;
CREATE TABLE IF NOT EXISTS interventions_ccs_demo (
  id serial PRIMARY KEY,
  organisation_ccs_id int NOT NULL REFERENCES organisations_secours(id),
  scenario text NOT NULL CHECK (scenario IN ('malaise', 'chute')),
  recue_par int NOT NULL REFERENCES utilisateurs(id),
  recue_le timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE missions_ccs ADD COLUMN IF NOT EXISTS intervention_demo_id int REFERENCES interventions_ccs_demo(id);
CREATE INDEX IF NOT EXISTS interventions_ccs_demo_organisation ON interventions_ccs_demo (organisation_ccs_id, id);
CREATE INDEX IF NOT EXISTS missions_ccs_intervention_demo ON missions_ccs (intervention_demo_id, id) WHERE intervention_demo_id IS NOT NULL;
COMMIT;
