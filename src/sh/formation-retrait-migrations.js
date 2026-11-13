'use strict';
/* Migration 46 :
   - formation : invitations (courriel + calendrier .ics, même UID et SEQUENCE pour les reports et annulations), réponse des participants
     par lien à usage unique, avis transmis à l'établissement client ; rôles formés élargis (CHSLD et résidences, préhospitalier) ;
   - retrait d'un client créé par erreur : statut « retire » (caché des listes, rétablissable, journalisé ; le journal reste immuable) ;
   - annulation d'un paiement saisi par erreur (jamais effacé : annulé avec motif, auteur et date). */
const FORMATION_RETRAIT_VERSION = 46;
async function migrerFormationRetrait(c) {
  if ((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1', [FORMATION_RETRAIT_VERSION])).rowCount) return false;
  await c.query(`ALTER TABLE hopitaux DROP CONSTRAINT IF EXISTS hopitaux_statut_check;
    ALTER TABLE hopitaux ADD CONSTRAINT hopitaux_statut_check CHECK (statut IN ('prospect','implantation','actif','suspendu','retire'));
    ALTER TABLE hopitaux ADD COLUMN IF NOT EXISTS retire_le timestamptz, ADD COLUMN IF NOT EXISTS retire_par int REFERENCES sh_utilisateurs(id),
      ADD COLUMN IF NOT EXISTS retire_motif text, ADD COLUMN IF NOT EXISTS statut_avant_retrait text`);
  await c.query(`ALTER TABLE sh_paiements ADD COLUMN IF NOT EXISTS annule_le timestamptz, ADD COLUMN IF NOT EXISTS annule_par int REFERENCES sh_utilisateurs(id),
    ADD COLUMN IF NOT EXISTS annule_motif text`);
  await c.query(`ALTER TABLE sh_formation_sessions
    ADD COLUMN IF NOT EXISTS uid uuid NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS sequence int NOT NULL DEFAULT 0 CHECK (sequence >= 0),
    ADD COLUMN IF NOT EXISTS objectifs text, ADD COLUMN IF NOT EXISTS prerequis text, ADD COLUMN IF NOT EXISTS visio_url text,
    ADD COLUMN IF NOT EXISTS annulation_motif text, ADD COLUMN IF NOT EXISTS modifie_le timestamptz,
    ADD COLUMN IF NOT EXISTS avis_client text CHECK (avis_client IN ('transmis','echec','non_relie','non_applicable')),
    ADD COLUMN IF NOT EXISTS avis_client_le timestamptz`);
  await c.query(`ALTER TABLE sh_formation_participants
    ADD COLUMN IF NOT EXISTS reponse text NOT NULL DEFAULT 'en_attente' CHECK (reponse IN ('en_attente','confirme','autre_moment','decline')),
    ADD COLUMN IF NOT EXISTS reponse_le timestamptz, ADD COLUMN IF NOT EXISTS reponse_note text,
    ADD COLUMN IF NOT EXISTS jeton_hache text UNIQUE, ADD COLUMN IF NOT EXISTS jeton_expire timestamptz`);
  await c.query(`CREATE TABLE sh_formation_courriels(
    id bigserial PRIMARY KEY, session_id bigint NOT NULL REFERENCES sh_formation_sessions(id), participant_id bigint REFERENCES sh_formation_participants(id),
    destinataire text NOT NULL CHECK (length(destinataire) <= 254 AND position('@' in destinataire) > 1),
    evenement text NOT NULL CHECK (evenement IN ('invitation','modification','annulation')), sequence int NOT NULL DEFAULT 0,
    cle text NOT NULL UNIQUE, etat text NOT NULL DEFAULT 'en_attente' CHECK (etat IN ('en_attente','envoi','envoye','abandonne','remplace')),
    tentatives int NOT NULL DEFAULT 0, prochaine_tentative timestamptz NOT NULL DEFAULT now(), verrou_jusqua timestamptz, dernier_code text,
    cree_le timestamptz NOT NULL DEFAULT now(), envoye_le timestamptz)`);
  await c.query("CREATE INDEX sh_formation_courriels_a_envoyer_idx ON sh_formation_courriels(prochaine_tentative, id) WHERE etat IN ('en_attente','envoi')");
  await c.query('ALTER TABLE sh_formation_courriels ENABLE ROW LEVEL SECURITY');
  await c.query(`CREATE POLICY sh_formation_courriels_perimetre ON sh_formation_courriels USING (EXISTS (SELECT 1 FROM sh_formation_sessions s WHERE s.id = session_id))
    WITH CHECK (sh_scope_write() AND EXISTS (SELECT 1 FROM sh_formation_sessions s WHERE s.id = session_id))`);
  const role = (await c.query('SELECT current_user owner')).rows[0].owner + '_scope';
  if (!/^[a-z][a-z0-9_]{0,50}$/.test(role)) throw new Error('Rôle PostgreSQL restreint invalide');
  if ((await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
    await c.query(`GRANT SELECT, INSERT, UPDATE ON sh_formation_courriels TO "${role}"`);
    await c.query(`GRANT USAGE, SELECT ON SEQUENCE sh_formation_courriels_id_seq TO "${role}"`);
  }
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)', [FORMATION_RETRAIT_VERSION]);
  return true;
}
module.exports = { FORMATION_RETRAIT_VERSION, migrerFormationRetrait };
