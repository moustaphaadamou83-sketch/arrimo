'use strict';
/**
 * Lot ERP (version 6) : tarification, facturation, documents, équipes, notifications, support détaillé,
 * formation par séances, supervision de l'hébergement. Strictement additif : aucune table ni colonne
 * existante n'est supprimée ; l'ancienne release continue de fonctionner sur ce schéma.
 */
const ERP_VERSION = 6;
const ROLES_V6 = "('administration','commercial','implantation','formation','support','finance')";

async function migrerErp(c) {
  if ((await c.query('SELECT 1 FROM sh_migrations WHERE version = $1', [ERP_VERSION])).rowCount) return false;

  // Rôle Finance : facturation et encaissements, sans accès aux écrans d'implantation.
  // Selon l'historique de la base, la contrainte porte l'un ou l'autre nom.
  await c.query('ALTER TABLE sh_utilisateurs DROP CONSTRAINT IF EXISTS sh_utilisateurs_role_check');
  await c.query('ALTER TABLE sh_utilisateurs DROP CONSTRAINT IF EXISTS sh_utilisateurs_role_phase1_chk');
  await c.query(`ALTER TABLE sh_utilisateurs ADD CONSTRAINT sh_utilisateurs_role_phase1_chk CHECK (role IN ${ROLES_V6})`);
  await c.query('ALTER TABLE sh_invitations DROP CONSTRAINT IF EXISTS sh_invitations_role_check');
  await c.query(`ALTER TABLE sh_invitations ADD CONSTRAINT sh_invitations_role_check CHECK (role IN ${ROLES_V6})`);

  // CRM : coordonnées de facturation de l'organisation (la province détermine les taxes).
  await c.query(`ALTER TABLE sh_crm_organisations
    ADD COLUMN IF NOT EXISTS adresse text, ADD COLUMN IF NOT EXISTS ville text, ADD COLUMN IF NOT EXISTS region text,
    ADD COLUMN IF NOT EXISTS pays_code char(2) NOT NULL DEFAULT 'CA', ADD COLUMN IF NOT EXISTS courriel_facturation text`);
  await c.query('ALTER TABLE sh_activites ADD COLUMN IF NOT EXISTS organisation_id bigint REFERENCES sh_crm_organisations(id)');
  await c.query('CREATE INDEX IF NOT EXISTS sh_activites_relances_idx ON sh_activites(responsable_id, terminee_le, echeance)');

  // Tarification : grille de prix réutilisée par les devis.
  await c.query(`CREATE TABLE IF NOT EXISTS sh_tarifs (
    code text PRIMARY KEY CHECK (code ~ '^[a-z0-9_-]{2,40}$'), libelle text NOT NULL, description text,
    prix_unitaire numeric(14,2) NOT NULL CHECK (prix_unitaire >= 0), unite text NOT NULL DEFAULT 'forfait',
    periodicite text NOT NULL DEFAULT 'unique' CHECK (periodicite IN ('unique','mensuel','annuel')),
    taxable boolean NOT NULL DEFAULT true, actif boolean NOT NULL DEFAULT true,
    modifie_par text, modifie_le timestamptz NOT NULL DEFAULT now())`);
  await c.query(`CREATE TABLE IF NOT EXISTS sh_taxes (
    id serial PRIMARY KEY, pays_code char(2) NOT NULL, region text NOT NULL DEFAULT '*', code text NOT NULL, nom text NOT NULL,
    taux numeric(6,3) NOT NULL CHECK (taux >= 0 AND taux < 100), ordre int NOT NULL DEFAULT 1, UNIQUE (pays_code, region, code))`);
  // Taux en vigueur au Canada à l'automne 2026 (TPS fédérale, TVQ, TVH). À confirmer par la comptabilité ; modifiables.
  await c.query(`INSERT INTO sh_taxes (pays_code, region, code, nom, taux, ordre) VALUES
    ('CA','*','TPS','TPS',5,1), ('CA','QC','TPS','TPS',5,1), ('CA','QC','TVQ','TVQ',9.975,2),
    ('CA','ON','TVH','TVH',13,1), ('CA','NB','TVH','TVH',15,1), ('CA','NL','TVH','TVH',15,1), ('CA','PE','TVH','TVH',15,1), ('CA','NS','TVH','TVH',14,1)
    ON CONFLICT DO NOTHING`);

  // Devis : totaux calculés par le serveur, validité et conditions.
  await c.query(`ALTER TABLE sh_devis
    ADD COLUMN IF NOT EXISTS sous_total numeric(14,2), ADD COLUMN IF NOT EXISTS taxes jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS total numeric(14,2), ADD COLUMN IF NOT EXISTS valide_jusqu date, ADD COLUMN IF NOT EXISTS conditions text,
    ADD COLUMN IF NOT EXISTS statut_modifie_le timestamptz, ADD COLUMN IF NOT EXISTS motif_refus text`);

  // Contrats : période, renouvellement et pièce signée.
  await c.query(`ALTER TABLE sh_contrats
    ADD COLUMN IF NOT EXISTS duree_mois int NOT NULL DEFAULT 12 CHECK (duree_mois BETWEEN 1 AND 120),
    ADD COLUMN IF NOT EXISTS preavis_jours int NOT NULL DEFAULT 60 CHECK (preavis_jours BETWEEN 0 AND 365),
    ADD COLUMN IF NOT EXISTS renouvellement_auto boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS signe_le timestamptz, ADD COLUMN IF NOT EXISTS document_id bigint,
    ADD COLUMN IF NOT EXISTS resilie_le timestamptz, ADD COLUMN IF NOT EXISTS motif_resiliation text`);
  await c.query(`CREATE TABLE IF NOT EXISTS sh_contrats_renouvellements (
    id bigserial PRIMARY KEY, contrat_id bigint NOT NULL REFERENCES sh_contrats(id), ancienne_fin date, nouvelle_fin date NOT NULL,
    par text NOT NULL, quand timestamptz NOT NULL DEFAULT now())`);

  // Projets : rattachés à l'organisation dès la signature ; l'établissement est créé ensuite.
  await c.query('ALTER TABLE sh_projets ALTER COLUMN hopital_id DROP NOT NULL');
  await c.query(`ALTER TABLE sh_projets ADD COLUMN IF NOT EXISTS organisation_id bigint REFERENCES sh_crm_organisations(id),
    ADD COLUMN IF NOT EXISTS responsable_id int REFERENCES sh_utilisateurs(id), ADD COLUMN IF NOT EXISTS description text,
    ADD COLUMN IF NOT EXISTS modifie_le timestamptz NOT NULL DEFAULT now()`);
  await c.query(`UPDATE sh_projets p SET organisation_id = o.id FROM sh_crm_organisations o
    WHERE p.organisation_id IS NULL AND o.hopital_id = p.hopital_id`);
  await c.query(`ALTER TABLE sh_taches ADD COLUMN IF NOT EXISTS code_auto text, ADD COLUMN IF NOT EXISTS terminee_le timestamptz`);
  await c.query('CREATE UNIQUE INDEX IF NOT EXISTS sh_taches_code_auto_unique ON sh_taches(projet_id, code_auto) WHERE code_auto IS NOT NULL');
  // Tâches modèle déjà créées : on retrouve leur code pour les cocher automatiquement.
  await c.query(`UPDATE sh_taches SET code_auto = CASE titre
      WHEN 'Valider les données administratives' THEN 'donnees_administratives'
      WHEN 'Importer services, unités, chambres et lits' THEN 'import_structure'
      WHEN 'Configurer les modules et les quotas' THEN 'modules'
      WHEN 'Inviter les administrateurs de l’établissement' THEN 'utilisateurs'
      WHEN 'Planifier et réaliser la formation' THEN 'formation'
      WHEN 'Exécuter la recette et valider le Go Live' THEN 'golive' END
    WHERE code_auto IS NULL AND titre IN ('Valider les données administratives','Importer services, unités, chambres et lits',
      'Configurer les modules et les quotas','Inviter les administrateurs de l’établissement','Planifier et réaliser la formation','Exécuter la recette et valider le Go Live')`);
  await c.query('ALTER TABLE sh_jalons ADD COLUMN IF NOT EXISTS cree_le timestamptz NOT NULL DEFAULT now()');

  // Facturation : abonnements issus des contrats, factures numérotées sans trou, paiements.
  await c.query(`CREATE TABLE IF NOT EXISTS sh_compteurs (cle text PRIMARY KEY, valeur int NOT NULL DEFAULT 0)`);
  await c.query(`CREATE TABLE IF NOT EXISTS sh_abonnements (
    id bigserial PRIMARY KEY, contrat_id bigint NOT NULL REFERENCES sh_contrats(id), organisation_id bigint NOT NULL REFERENCES sh_crm_organisations(id),
    libelle text NOT NULL, periodicite text NOT NULL CHECK (periodicite IN ('mensuel','annuel')), lignes jsonb NOT NULL,
    devise char(3) NOT NULL DEFAULT 'CAD', debut date NOT NULL, fin date, prochaine_facture_le date NOT NULL,
    delai_paiement_jours int NOT NULL DEFAULT 30 CHECK (delai_paiement_jours BETWEEN 0 AND 120),
    statut text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','suspendu','termine')),
    cree_le timestamptz NOT NULL DEFAULT now(), UNIQUE (contrat_id, periodicite))`);
  await c.query(`CREATE TABLE IF NOT EXISTS sh_factures (
    id bigserial PRIMARY KEY, numero text UNIQUE, organisation_id bigint NOT NULL REFERENCES sh_crm_organisations(id),
    hopital_id int REFERENCES hopitaux(id), contrat_id bigint REFERENCES sh_contrats(id), abonnement_id bigint REFERENCES sh_abonnements(id),
    periode_debut date, periode_fin date, lignes jsonb NOT NULL, devise char(3) NOT NULL DEFAULT 'CAD',
    sous_total numeric(14,2) NOT NULL, taxes jsonb NOT NULL DEFAULT '[]'::jsonb, total numeric(14,2) NOT NULL,
    statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','emise','annulee')),
    emise_le date, echeance_le date, annulee_motif text, note text,
    cree_par int REFERENCES sh_utilisateurs(id), cree_le timestamptz NOT NULL DEFAULT now())`);
  await c.query('CREATE UNIQUE INDEX IF NOT EXISTS sh_factures_periode_unique ON sh_factures(abonnement_id, periode_debut) WHERE abonnement_id IS NOT NULL');
  await c.query("CREATE UNIQUE INDEX IF NOT EXISTS sh_factures_frais_uniques ON sh_factures(contrat_id) WHERE abonnement_id IS NULL AND note = 'frais_uniques_contrat'");
  await c.query(`CREATE TABLE IF NOT EXISTS sh_paiements (
    id bigserial PRIMARY KEY, facture_id bigint NOT NULL REFERENCES sh_factures(id), montant numeric(14,2) NOT NULL CHECK (montant > 0),
    recu_le date NOT NULL, mode text NOT NULL CHECK (mode IN ('virement','cheque','carte','prelevement','autre')), reference text,
    saisi_par int REFERENCES sh_utilisateurs(id), cree_le timestamptz NOT NULL DEFAULT now())`);

  // Support : type, gravité, échéance de service, messages et historique.
  await c.query(`ALTER TABLE sh_support_tickets
    ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'demande' CHECK (type IN ('demande','incident','question')),
    ADD COLUMN IF NOT EXISTS gravite text CHECK (gravite IS NULL OR gravite IN ('critique','majeure','mineure')),
    ADD COLUMN IF NOT EXISTS contact text, ADD COLUMN IF NOT EXISTS resolution text,
    ADD COLUMN IF NOT EXISTS resolu_le timestamptz, ADD COLUMN IF NOT EXISTS modifie_le timestamptz NOT NULL DEFAULT now()`);
  await c.query(`CREATE TABLE IF NOT EXISTS sh_support_messages (
    id bigserial PRIMARY KEY, ticket_id bigint NOT NULL REFERENCES sh_support_tickets(id), auteur_id int REFERENCES sh_utilisateurs(id),
    message text NOT NULL, interne boolean NOT NULL DEFAULT true, cree_le timestamptz NOT NULL DEFAULT now())`);
  await c.query(`CREATE TABLE IF NOT EXISTS sh_support_evenements (
    id bigserial PRIMARY KEY, ticket_id bigint NOT NULL REFERENCES sh_support_tickets(id), champ text NOT NULL,
    avant text, apres text, par text NOT NULL, quand timestamptz NOT NULL DEFAULT now())`);

  // Personnel : équipes.
  await c.query(`CREATE TABLE IF NOT EXISTS sh_equipes (
    id serial PRIMARY KEY, nom text NOT NULL, description text, cree_le timestamptz NOT NULL DEFAULT now())`);
  await c.query('CREATE UNIQUE INDEX IF NOT EXISTS sh_equipes_nom_unique ON sh_equipes(lower(nom))');
  await c.query(`CREATE TABLE IF NOT EXISTS sh_equipes_membres (
    equipe_id int NOT NULL REFERENCES sh_equipes(id) ON DELETE CASCADE, utilisateur_id int NOT NULL REFERENCES sh_utilisateurs(id),
    chef boolean NOT NULL DEFAULT false, PRIMARY KEY (equipe_id, utilisateur_id))`);

  // Documents : fichiers chiffrés sur disque, métadonnées et versions ici.
  await c.query(`ALTER TABLE sh_documents
    ADD COLUMN IF NOT EXISTS organisation_id bigint REFERENCES sh_crm_organisations(id), ADD COLUMN IF NOT EXISTS ticket_id bigint REFERENCES sh_support_tickets(id),
    ADD COLUMN IF NOT EXISTS type_mime text, ADD COLUMN IF NOT EXISTS taille int, ADD COLUMN IF NOT EXISTS empreinte text,
    ADD COLUMN IF NOT EXISTS confidentiel boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS archive_le timestamptz,
    ADD COLUMN IF NOT EXISTS groupe text`);
  await c.query('CREATE INDEX IF NOT EXISTS sh_documents_groupe_idx ON sh_documents(groupe, version DESC)');
  await c.query('CREATE UNIQUE INDEX IF NOT EXISTS sh_documents_groupe_version ON sh_documents(groupe, version) WHERE groupe IS NOT NULL');

  // Notifications internes de l'équipe SH.
  await c.query(`CREATE TABLE IF NOT EXISTS sh_notifications (
    id bigserial PRIMARY KEY, utilisateur_id int NOT NULL REFERENCES sh_utilisateurs(id), type text NOT NULL, titre text NOT NULL,
    lien text, cle text, lu_le timestamptz, cree_le timestamptz NOT NULL DEFAULT now())`);
  await c.query('CREATE INDEX IF NOT EXISTS sh_notifications_utilisateur_idx ON sh_notifications(utilisateur_id, lu_le, cree_le DESC)');
  await c.query('CREATE UNIQUE INDEX IF NOT EXISTS sh_notifications_cle_unique ON sh_notifications(utilisateur_id, cle) WHERE cle IS NOT NULL');

  // Formation : séances datées et participants validés individuellement.
  await c.query(`CREATE TABLE IF NOT EXISTS sh_formation_sessions (
    id bigserial PRIMARY KEY, hopital_id int NOT NULL REFERENCES hopitaux(id), role text NOT NULL, titre text NOT NULL,
    debut timestamptz NOT NULL, duree_minutes int NOT NULL DEFAULT 90 CHECK (duree_minutes BETWEEN 15 AND 600), lieu text,
    formateur_id int REFERENCES sh_utilisateurs(id), statut text NOT NULL DEFAULT 'planifiee' CHECK (statut IN ('planifiee','realisee','annulee')),
    cree_par int REFERENCES sh_utilisateurs(id), cree_le timestamptz NOT NULL DEFAULT now())`);
  await c.query(`CREATE TABLE IF NOT EXISTS sh_formation_participants (
    id bigserial PRIMARY KEY, session_id bigint NOT NULL REFERENCES sh_formation_sessions(id), nom text NOT NULL, courriel text,
    role_arrimo text, present boolean NOT NULL DEFAULT false, valide boolean NOT NULL DEFAULT false, valide_par text, valide_le timestamptz, note text)`);
  await c.query('CREATE UNIQUE INDEX IF NOT EXISTS sh_formation_participants_unique ON sh_formation_participants(session_id, lower(coalesce(courriel, nom)))');

  // Hébergement : relevés de supervision des environnements.
  await c.query(`CREATE TABLE IF NOT EXISTS sh_supervision (
    id bigserial PRIMARY KEY, environnement text NOT NULL, ok boolean NOT NULL, latence_ms int, version text, detail text,
    quand timestamptz NOT NULL DEFAULT now())`);
  await c.query('CREATE INDEX IF NOT EXISTS sh_supervision_env_idx ON sh_supervision(environnement, quand DESC)');

  await c.query('INSERT INTO sh_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING', [ERP_VERSION]);
  return true;
}

module.exports = { ERP_VERSION, migrerErp };
