'use strict';
/* Migration 48 : demandes du site rangées et reliées au CRM.
   - Demandes : boîte d'arrivée (à traiter, traitée, rejetée avec motif), attribution, module d'intérêt, date du consentement,
     prospect et contact rattachés ; les anciens statuts (nouvelle, en cours) deviennent « à traiter ».
   - CRM : étapes du suivi des prospects au niveau de l'organisation (prospect → contacté → démo planifiée → devis envoyé → gagné / perdu),
     origine (site ou saisie) ; contacts avec pays, ville et langue de contact.
   - File des courriels des demandes : accusé de réception automatique et réponses de l'équipe (texte conservé = historique). */
const DEMANDES_CRM_VERSION = 48;
const ETAPES = ['prospect', 'contacte', 'demo_planifiee', 'devis_envoye', 'gagne', 'perdu'];
const MOTIFS_REJET = ['pourriel', 'hors_cible', 'doublon', 'autre'];
const MODULES_INTERET = ['lits_urgence', 'hebergement', 'secours', 'transferts', 'reseau', 'integration', 'indecis'];
const liste = (l) => l.map((x) => `'${x}'`).join(',');
async function migrerDemandesCrm(c) {
  if ((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1', [DEMANDES_CRM_VERSION])).rowCount) return false;
  await c.query(`ALTER TABLE sh_crm_organisations
    ADD COLUMN IF NOT EXISTS etape text NOT NULL DEFAULT 'prospect' CHECK (etape IN (${liste(ETAPES)})),
    ADD COLUMN IF NOT EXISTS etape_le timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS perdu_motif text CHECK (length(perdu_motif) <= 500),
    ADD COLUMN IF NOT EXISTS origine text NOT NULL DEFAULT 'saisie' CHECK (origine IN ('saisie','site'))`);
  await c.query(`UPDATE sh_crm_organisations SET etape = 'gagne' WHERE type = 'client'`);
  await c.query(`ALTER TABLE sh_crm_contacts ADD COLUMN IF NOT EXISTS pays_code char(2), ADD COLUMN IF NOT EXISTS ville text,
    ADD COLUMN IF NOT EXISTS langue_contact text, ADD COLUMN IF NOT EXISTS modifie_le timestamptz`);
  await c.query('CREATE INDEX IF NOT EXISTS sh_crm_contacts_courriel ON sh_crm_contacts (lower(courriel))');
  await c.query(`ALTER TABLE sh_demandes_site DROP CONSTRAINT IF EXISTS sh_demandes_site_statut_check`);
  await c.query(`UPDATE sh_demandes_site SET statut = 'a_traiter' WHERE statut IN ('nouvelle','en_cours')`);
  await c.query(`ALTER TABLE sh_demandes_site ALTER COLUMN statut SET DEFAULT 'a_traiter',
    ADD CONSTRAINT sh_demandes_site_statut_check CHECK (statut IN ('a_traiter','traitee','rejetee')),
    ADD COLUMN IF NOT EXISTS rejet_motif text CHECK (rejet_motif IN (${liste(MOTIFS_REJET)})),
    ADD COLUMN IF NOT EXISTS rejet_note text CHECK (length(rejet_note) <= 500),
    ADD COLUMN IF NOT EXISTS attribue_a int REFERENCES sh_utilisateurs(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS module_interet text CHECK (module_interet IN (${liste(MODULES_INTERET)})),
    ADD COLUMN IF NOT EXISTS consentement_le timestamptz,
    ADD COLUMN IF NOT EXISTS organisation_id bigint REFERENCES sh_crm_organisations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS contact_id bigint REFERENCES sh_crm_contacts(id) ON DELETE SET NULL`);
  await c.query(`ALTER TABLE sh_demandes_site ADD CONSTRAINT sh_demandes_site_rejet_motif CHECK (statut <> 'rejetee' OR rejet_motif IS NOT NULL) NOT VALID`);
  await c.query('CREATE INDEX IF NOT EXISTS sh_demandes_site_statut ON sh_demandes_site (statut, recu_le DESC)');
  await c.query(`CREATE TABLE sh_demandes_courriels(
    id bigserial PRIMARY KEY, demande_id int REFERENCES sh_demandes_site(id) ON DELETE SET NULL, organisation_id bigint REFERENCES sh_crm_organisations(id) ON DELETE SET NULL,
    genre text NOT NULL CHECK (genre IN ('accuse','reponse')), destinataire text NOT NULL CHECK (length(destinataire) <= 254 AND position('@' in destinataire) > 1),
    langue text NOT NULL CHECK (langue IN ('fr','en')), sujet text NOT NULL CHECK (length(sujet) <= 200), texte text NOT NULL CHECK (length(texte) <= 8000),
    cree_par int REFERENCES sh_utilisateurs(id), cle text NOT NULL UNIQUE,
    etat text NOT NULL DEFAULT 'en_attente' CHECK (etat IN ('en_attente','envoi','envoye','abandonne')), tentatives int NOT NULL DEFAULT 0,
    prochaine_tentative timestamptz NOT NULL DEFAULT now(), verrou_jusqua timestamptz, dernier_code text, cree_le timestamptz NOT NULL DEFAULT now(), envoye_le timestamptz)`);
  await c.query("CREATE INDEX sh_demandes_courriels_a_envoyer ON sh_demandes_courriels (prochaine_tentative, id) WHERE etat IN ('en_attente','envoi')");
  await c.query('CREATE INDEX sh_demandes_courriels_destinataire ON sh_demandes_courriels (lower(destinataire), cree_le)');
  const role = (await c.query('SELECT current_user owner')).rows[0].owner + '_scope';
  if (!/^[a-z][a-z0-9_]{0,50}$/.test(role)) throw new Error('Rôle PostgreSQL restreint invalide');
  if ((await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
    await c.query(`GRANT SELECT, INSERT, UPDATE ON sh_demandes_courriels TO "${role}"`);
    await c.query(`GRANT USAGE, SELECT ON SEQUENCE sh_demandes_courriels_id_seq TO "${role}"`);
  }
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)', [DEMANDES_CRM_VERSION]);
  return true;
}
module.exports = { DEMANDES_CRM_VERSION, ETAPES, MOTIFS_REJET, MODULES_INTERET, migrerDemandesCrm };
