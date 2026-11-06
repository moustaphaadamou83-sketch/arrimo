'use strict';
const crypto = require('node:crypto');
const { transaction } = require('../db');
const { chiffrerSecret } = require('./security');
const { ERP_VERSION, migrerErp } = require('./erp-migrations');
const { ACCES_VERSION, migrerAcces } = require('./acces-migrations');
const { PROJETS_VERSION, migrerProjets } = require('./projets-migrations');
const { PRESENCE_VERSION,migrerPresence } = require('./presence-migrations');
const { PERIMETRE_VERSION,migrerPerimetre } = require('./perimetre-migrations');
const {CYCLE_PROJETS_VERSION,migrerCycleProjets}=require('./cycle-projets-migrations');
const {PILOTE_VERSION,migrerPilote}=require('./pilote-migrations');
const {GOLIVE_CONCURRENCE_VERSION,migrerGoliveConcurrence}=require('./golive-concurrence-migrations');
const {LIENS_CLIENTS_VERSION,migrerLiensClients}=require('./liens-clients-migrations');
const {SUPPORT_PORTAIL_VERSION,migrerSupportPortail}=require('./support-portail-migrations');
const {SUPPORT_DROITS_VERSION,migrerSupportDroits}=require('./support-droits-migrations');
const {NOTIFICATIONS_FINANCES_VERSION,migrerNotificationsFinances}=require('./notifications-finances-migrations');
const {SUPPORT_PAGINATION_VERSION,migrerSupportPagination}=require('./support-pagination-migrations');

const {NOTIFICATIONS_PERIMETRES_VERSION,migrerNotificationsPerimetres}=require('./notifications-perimetres-migrations');

const {RACCORDEMENT_SUPPORT_VERSION,migrerRaccordementSupport}=require('./raccordement-support-migrations');

const {SUPPORT_SLA_VERSION,migrerSupportSla}=require('./support-sla-migrations');
const {SUPPORT_PJ_VERSION,migrerSupportPj}=require('./support-pj-migrations');
const {SUPPORT_COURRIELS_VERSION,migrerSupportCourriels}=require('./support-courriels-migrations');
const {SUPPORT_CALENDRIER_VERSION,migrerSupportCalendrier}=require('./support-calendrier-migrations');
const {PREFERENCES_VERSION,migrerPreferences}=require('./preferences-migrations');
const {FISCALITE_VERSION,migrerFiscalite}=require('./fiscalite-migrations');
const {CHANGE_VERSION,migrerChange}=require('./change-migrations');
const {APPARENCE_VERSION,migrerApparence}=require('./apparence-migrations');
const {PARAMETRES_VERSION,migrerParametres}=require('./parametres-migrations');
const {FINANCES_PROJETS_VERSION,migrerFinancesProjets}=require('./finances-projets-migrations');
const {TACHES_SUIVI_VERSION,migrerTachesSuivi}=require('./taches-suivi-migrations');
const {PROJETS_PILOTAGE_VERSION,migrerProjetsPilotage}=require('./projets-pilotage-migrations');
const {COMPETENCES_VERSION,migrerCompetences}=require('./competences-migrations');
const {RECHERCHE_VERSION,migrerRecherche}=require('./recherche-migrations');
const {DEPLOIEMENT_VERSION,migrerDeploiement}=require('./deploiement-migrations');
const {COLLABORATEURS_VERSION,migrerCollaborateurs}=require('./collaborateurs-migrations');

const VERSION = 4;
const LANGUE_VERSION = 5;
const empreinte = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function migrerSh(pool, env = process.env) {
  return transaction(pool, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('arrimo-sh-migrations'))");
    await c.query('CREATE TABLE IF NOT EXISTS sh_migrations (version integer PRIMARY KEY, applique_le timestamptz NOT NULL DEFAULT now())');
    const socle = await migrerSocle(c, env);
    const erp = await migrerErp(c);
    const acces = await migrerAcces(c);
    const projets = await migrerProjets(c);
    const presence=await migrerPresence(c);
    const perimetre=await migrerPerimetre(c);
    const cycle=await migrerCycleProjets(c);
    const pilote=await migrerPilote(c);
    const concurrence=await migrerGoliveConcurrence(c);
    const liens=await migrerLiensClients(c);
    const support=await migrerSupportPortail(c);
    const supportDroits=await migrerSupportDroits(c);
    const notificationsFinances=await migrerNotificationsFinances(c);
    const supportPagination=await migrerSupportPagination(c);
    const notificationsPerimetres=await migrerNotificationsPerimetres(c);
    const raccordementSupport=await migrerRaccordementSupport(c);
    const supportSla=await migrerSupportSla(c);
    const supportPj=await migrerSupportPj(c);
    const supportCourriels=await migrerSupportCourriels(c);
    const supportCalendrier=await migrerSupportCalendrier(c);
    const preferences=await migrerPreferences(c);
    const fiscalite=await migrerFiscalite(c);
    const change=await migrerChange(c);
    const apparence=await migrerApparence(c);
    const parametres=await migrerParametres(c);
    const financesProjets=await migrerFinancesProjets(c);
    const tachesSuivi=await migrerTachesSuivi(c);
    const projetsPilotage=await migrerProjetsPilotage(c);
    const competences=await migrerCompetences(c);
    const recherche=await migrerRecherche(c);
    const deploiement=await migrerDeploiement(c);
    const collaborateurs=await migrerCollaborateurs(c);
    const typesEtablissement=await require('./types-etablissement-migrations').migrerTypesEtablissement(c);
    const liaisonChsld=await require('./types-etablissement-migrations').migrerLiaisonChsld(c);
    const productions=await require('./types-etablissement-migrations').migrerProductions(c);
    const typesLocaux=await require('./types-etablissement-migrations').migrerTypesLocaux(c);
    const demandesSite=await require('./types-etablissement-migrations').migrerDemandesSite(c);
    return { version: require('./types-etablissement-migrations').VERSION_SH, appliquee: demandesSite || typesLocaux || productions || liaisonChsld || socle || erp || acces || projets || presence || perimetre || cycle || pilote || concurrence || liens || support || supportDroits || notificationsFinances || supportPagination || notificationsPerimetres || raccordementSupport || supportSla || supportPj || supportCourriels || supportCalendrier || preferences || fiscalite || change || apparence || parametres || financesProjets || tachesSuivi || projetsPilotage || competences || recherche || deploiement || collaborateurs || typesEtablissement };
  });
}

/** Lots 1 à 5 (schéma publié le 24 octobre 2026), inchangés. Rend true si une version a été appliquée. */
async function migrerSocle(c, env) {
  {
    const langueFaite = await c.query('SELECT 1 FROM sh_migrations WHERE version = $1', [LANGUE_VERSION]);
    if (langueFaite.rowCount) return false;
    const done = await c.query('SELECT 1 FROM sh_migrations WHERE version = $1', [VERSION]);
    if (done.rowCount) {
      await c.query("ALTER TABLE sh_utilisateurs ADD COLUMN IF NOT EXISTS langue text NOT NULL DEFAULT 'fr'");
      await c.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sh_utilisateurs_langue_chk') THEN ALTER TABLE sh_utilisateurs ADD CONSTRAINT sh_utilisateurs_langue_chk CHECK (langue IN ('fr','en')); END IF; END $$");
      await c.query('INSERT INTO sh_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING', [LANGUE_VERSION]);
      return true;
    }

    // Lot 2 : compléments strictement additifs pour la fiche, les accès et les modules.
    // Les coordonnées/contact historiques restent la source principale compatible.
    await c.query(`ALTER TABLE hopitaux
      ADD COLUMN IF NOT EXISTS raison_sociale text,
      ADD COLUMN IF NOT EXISTS identifiant_legal text,
      ADD COLUMN IF NOT EXISTS pays_code char(2) NOT NULL DEFAULT 'CA',
      ADD COLUMN IF NOT EXISTS region text,
      ADD COLUMN IF NOT EXISTS fuseau_horaire text NOT NULL DEFAULT 'America/Toronto',
      ADD COLUMN IF NOT EXISTS utilisateurs_prevus integer NOT NULL DEFAULT 0 CHECK (utilisateurs_prevus >= 0),
      ADD COLUMN IF NOT EXISTS utilisateurs_autorises integer NOT NULL DEFAULT 0 CHECK (utilisateurs_autorises >= 0)`);
    await c.query(`CREATE TABLE IF NOT EXISTS sh_sites (
      id bigserial PRIMARY KEY, hopital_id int NOT NULL REFERENCES hopitaux(id),
      code text NOT NULL, nom text NOT NULL, adresse text, ville text, region text, pays_code char(2) NOT NULL DEFAULT 'CA',
      latitude double precision CHECK (latitude BETWEEN -90 AND 90), longitude double precision CHECK (longitude BETWEEN -180 AND 180),
      cree_le timestamptz NOT NULL DEFAULT now(), modifie_le timestamptz NOT NULL DEFAULT now(), UNIQUE(hopital_id,code))`);
    await c.query(`CREATE TABLE IF NOT EXISTS sh_contacts (
      id bigserial PRIMARY KEY, hopital_id int NOT NULL REFERENCES hopitaux(id), site_id bigint REFERENCES sh_sites(id),
      nom text NOT NULL, fonction text, courriel text, telephone text, categorie text NOT NULL DEFAULT 'general',
      cree_le timestamptz NOT NULL DEFAULT now(), modifie_le timestamptz NOT NULL DEFAULT now())`);
    await c.query(`CREATE TABLE IF NOT EXISTS sh_modules_catalogue (
      code text PRIMARY KEY, nom text NOT NULL, description text NOT NULL, version text NOT NULL DEFAULT '1',
      dependances text[] NOT NULL DEFAULT '{}', parametres jsonb NOT NULL DEFAULT '{}'::jsonb, actif boolean NOT NULL DEFAULT true)`);
    await c.query(`CREATE TABLE IF NOT EXISTS sh_hopital_modules (
      hopital_id int NOT NULL REFERENCES hopitaux(id), module_code text NOT NULL REFERENCES sh_modules_catalogue(code),
      licence text NOT NULL DEFAULT 'non_selectionne' CHECK (licence IN ('non_selectionne','propose','souscrit','suspendu')),
      parametres jsonb NOT NULL DEFAULT '{}'::jsonb, modifie_par text NOT NULL, modifie_le timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(hopital_id,module_code))`);
    await c.query(`INSERT INTO sh_modules_catalogue(code,nom,description,dependances) VALUES
      ('lits','Gestion des lits','Unités, chambres, lits et confirmations.','{}'),
      ('civieres','Gestion des civières','Capacités et suivi des civières.','{}'),
      ('transferts','Transferts interhospitaliers','Demandes, acceptations et suivi des transferts.',ARRAY['lits']),
      ('og','OG','Copilote opérationnel avec recommandations supervisées.',ARRAY['lits','transferts']),
      ('notifications','Notifications','Notifications opérationnelles par rôle.','{}'),
      ('rapports','Rapports et statistiques','Indicateurs calculés depuis les données disponibles.','{}')
      ON CONFLICT(code) DO NOTHING`);

    await c.query('ALTER TABLE sh_utilisateurs ADD COLUMN IF NOT EXISTS role text');
    const legacy = await c.query('SELECT id, email FROM sh_utilisateurs WHERE role IS NULL ORDER BY id');
    if (legacy.rowCount) {
      const adminEmail = String(env.SH_INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
      if (!adminEmail || !legacy.rows.some((u) => u.email.toLowerCase() === adminEmail)) {
        throw new Error('SH_INITIAL_ADMIN_EMAIL_REQUIRED_FOR_LEGACY_USERS');
      }
      await c.query("UPDATE sh_utilisateurs SET role = 'support' WHERE role IS NULL");
      await c.query("UPDATE sh_utilisateurs SET role = 'administration' WHERE lower(email) = $1", [adminEmail]);
    }
    await c.query("ALTER TABLE sh_utilisateurs ALTER COLUMN role SET DEFAULT 'support'");
    await c.query('ALTER TABLE sh_utilisateurs ALTER COLUMN role SET NOT NULL');
    await c.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sh_utilisateurs_role_phase1_chk') THEN
        ALTER TABLE sh_utilisateurs ADD CONSTRAINT sh_utilisateurs_role_phase1_chk
        CHECK (role IN ('administration', 'commercial', 'implantation', 'formation', 'support'));
      END IF;
    END $$`);

    await c.query('ALTER TABLE sh_sessions ADD COLUMN IF NOT EXISTS token_hache boolean NOT NULL DEFAULT false');
    await c.query('ALTER TABLE sh_connexions_2fa ADD COLUMN IF NOT EXISTS jeton_hache boolean NOT NULL DEFAULT false');
    for (const row of (await c.query('SELECT token FROM sh_sessions WHERE NOT token_hache FOR UPDATE')).rows) {
      await c.query('UPDATE sh_sessions SET token = $2, token_hache = true WHERE token = $1', [row.token, empreinte(row.token)]);
    }
    for (const row of (await c.query('SELECT jeton FROM sh_connexions_2fa WHERE NOT jeton_hache FOR UPDATE')).rows) {
      await c.query('UPDATE sh_connexions_2fa SET jeton = $2, jeton_hache = true WHERE jeton = $1', [row.jeton, empreinte(row.jeton)]);
    }

    const secrets = (await c.query("SELECT id, totp_secret FROM sh_utilisateurs WHERE totp_secret IS NOT NULL AND totp_secret NOT LIKE 'enc:v1:%' FOR UPDATE")).rows;
    if (secrets.length && !env.SH_MFA_ENCRYPTION_KEY) throw new Error('SH_MFA_ENCRYPTION_KEY_REQUIRED_TO_MIGRATE_TOTP');
    for (const u of secrets) {
      await c.query('UPDATE sh_utilisateurs SET totp_secret = $2 WHERE id = $1', [u.id, chiffrerSecret(u.totp_secret, env)]);
    }

    await c.query(`CREATE TABLE IF NOT EXISTS sh_invitations (
      id bigserial PRIMARY KEY, jeton_hache text NOT NULL UNIQUE, email text NOT NULL, nom text NOT NULL,
      role text NOT NULL CHECK (role IN ('administration','commercial','implantation','formation','support')),
      utilisateur_id int REFERENCES sh_utilisateurs(id), cree_par int REFERENCES sh_utilisateurs(id),
      expire_le timestamptz NOT NULL, utilise_le timestamptz, revoquee_le timestamptz, cree_le timestamptz NOT NULL DEFAULT now())`);
    await c.query('CREATE INDEX IF NOT EXISTS sh_invitations_email ON sh_invitations (lower(email), cree_le DESC)');
    await c.query(`CREATE TABLE IF NOT EXISTS sh_golive_operations (
      id bigserial PRIMARY KEY, hopital_id int NOT NULL REFERENCES hopitaux(id), cible text NOT NULL CHECK (cible IN ('recette','production')),
      empreinte text NOT NULL, statut text NOT NULL CHECK (statut IN ('en_cours','interrompu','termine')), phase text NOT NULL,
      resultats jsonb NOT NULL DEFAULT '{}'::jsonb, code_erreur text, lance_par text NOT NULL,
      cree_le timestamptz NOT NULL DEFAULT now(), modifie_le timestamptz NOT NULL DEFAULT now(), UNIQUE (hopital_id,cible,empreinte))`);
    await c.query("ALTER TABLE sh_golive_operations ALTER COLUMN resultats SET DEFAULT '{}'::jsonb");
    // v1 n'écrivait pas encore de résultats de phase; normalise uniquement son tableau vide.
    await c.query("UPDATE sh_golive_operations SET resultats='{}'::jsonb WHERE jsonb_typeof(resultats)='array' AND resultats='[]'::jsonb");
    // Lot 3–6 : données commerciales et de collaboration internes à SH. Elles ne contiennent
    // aucune donnée clinique et restent rattachées à l'hôpital SH lorsqu'elles le concernent.
    await c.query(`CREATE TABLE IF NOT EXISTS sh_crm_organisations (
      id bigserial PRIMARY KEY, hopital_id int UNIQUE REFERENCES hopitaux(id), nom text NOT NULL,
      type text NOT NULL DEFAULT 'prospect' CHECK(type IN ('prospect','client','partenaire')),
      site_web text, notes text, cree_par int REFERENCES sh_utilisateurs(id), cree_le timestamptz NOT NULL DEFAULT now(), modifie_le timestamptz NOT NULL DEFAULT now())`);
    await c.query(`CREATE TABLE IF NOT EXISTS sh_crm_contacts (
      id bigserial PRIMARY KEY, organisation_id bigint NOT NULL REFERENCES sh_crm_organisations(id), nom text NOT NULL,
      fonction text, courriel text, telephone text, decideur boolean NOT NULL DEFAULT false,
      cree_le timestamptz NOT NULL DEFAULT now(), UNIQUE(organisation_id,courriel))`);
    await c.query(`CREATE TABLE IF NOT EXISTS sh_opportunites (
      id bigserial PRIMARY KEY, organisation_id bigint NOT NULL REFERENCES sh_crm_organisations(id), titre text NOT NULL,
      statut text NOT NULL DEFAULT 'qualification' CHECK(statut IN ('qualification','analyse','proposition','negociation','gagnee','perdue')),
      montant numeric(14,2) CHECK(montant IS NULL OR montant>=0), devise char(3) NOT NULL DEFAULT 'CAD', probabilite int NOT NULL DEFAULT 0 CHECK(probabilite BETWEEN 0 AND 100),
      responsable_id int REFERENCES sh_utilisateurs(id), prochaine_action text, echeance date, perdue_motif text,
      cree_par int REFERENCES sh_utilisateurs(id), cree_le timestamptz NOT NULL DEFAULT now(), modifie_le timestamptz NOT NULL DEFAULT now())`);
    await c.query(`CREATE TABLE IF NOT EXISTS sh_activites (
      id bigserial PRIMARY KEY, opportunite_id bigint REFERENCES sh_opportunites(id) ON DELETE CASCADE,
      hopital_id int REFERENCES hopitaux(id), type text NOT NULL CHECK(type IN ('appel','reunion','courriel','relance','note')),
      titre text NOT NULL, contenu text, echeance timestamptz, terminee_le timestamptz, responsable_id int REFERENCES sh_utilisateurs(id),
      cree_par int REFERENCES sh_utilisateurs(id), cree_le timestamptz NOT NULL DEFAULT now())`);
    await c.query(`CREATE TABLE IF NOT EXISTS sh_devis (
      id bigserial PRIMARY KEY, opportunite_id bigint NOT NULL REFERENCES sh_opportunites(id), version int NOT NULL,
      statut text NOT NULL DEFAULT 'brouillon' CHECK(statut IN ('brouillon','a_valider','approuve','envoye','accepte','refuse','expire')),
      lignes jsonb NOT NULL DEFAULT '[]'::jsonb, devise char(3) NOT NULL DEFAULT 'CAD', valide_par int REFERENCES sh_utilisateurs(id), valide_le timestamptz,
      cree_par int REFERENCES sh_utilisateurs(id), cree_le timestamptz NOT NULL DEFAULT now(), UNIQUE(opportunite_id,version))`);
    await c.query(`CREATE TABLE IF NOT EXISTS sh_contrats (
      id bigserial PRIMARY KEY, hopital_id int REFERENCES hopitaux(id), opportunite_id bigint NOT NULL REFERENCES sh_opportunites(id), devis_id bigint REFERENCES sh_devis(id),
      reference text NOT NULL UNIQUE, statut text NOT NULL DEFAULT 'negociation' CHECK(statut IN ('negociation','pret_a_signer','signe','resilie','expire')),
      date_debut date, date_fin date, renouvellement_le date, document_ref text, signe_par text, cree_par int REFERENCES sh_utilisateurs(id), cree_le timestamptz NOT NULL DEFAULT now())`);
    await c.query(`CREATE TABLE IF NOT EXISTS sh_projets (
      id bigserial PRIMARY KEY, hopital_id int NOT NULL REFERENCES hopitaux(id), contrat_id bigint REFERENCES sh_contrats(id), nom text NOT NULL,
      statut text NOT NULL DEFAULT 'planification' CHECK(statut IN ('planification','en_cours','bloque','termine','annule')),
      debut date, echeance date, cree_par int REFERENCES sh_utilisateurs(id), cree_le timestamptz NOT NULL DEFAULT now())`);
    await c.query(`CREATE TABLE IF NOT EXISTS sh_taches (
      id bigserial PRIMARY KEY, projet_id bigint NOT NULL REFERENCES sh_projets(id) ON DELETE CASCADE, parent_id bigint REFERENCES sh_taches(id),
      titre text NOT NULL, description text, statut text NOT NULL DEFAULT 'a_faire' CHECK(statut IN ('a_faire','en_cours','bloquee','terminee')),
      priorite text NOT NULL DEFAULT 'normale' CHECK(priorite IN ('basse','normale','haute','urgente')), responsable_id int REFERENCES sh_utilisateurs(id),
      echeance date, cree_par int REFERENCES sh_utilisateurs(id), cree_le timestamptz NOT NULL DEFAULT now(), modifie_le timestamptz NOT NULL DEFAULT now())`);
    await c.query(`CREATE TABLE IF NOT EXISTS sh_taches_dependances (
      tache_id bigint NOT NULL REFERENCES sh_taches(id) ON DELETE CASCADE, depend_de bigint NOT NULL REFERENCES sh_taches(id) ON DELETE CASCADE,
      PRIMARY KEY(tache_id,depend_de), CHECK(tache_id<>depend_de))`);
    await c.query(`CREATE TABLE IF NOT EXISTS sh_taches_commentaires (
      id bigserial PRIMARY KEY, tache_id bigint NOT NULL REFERENCES sh_taches(id) ON DELETE CASCADE,
      utilisateur_id int REFERENCES sh_utilisateurs(id), commentaire text NOT NULL, cree_le timestamptz NOT NULL DEFAULT now())`);
    await c.query(`CREATE TABLE IF NOT EXISTS sh_jalons (
      id bigserial PRIMARY KEY, projet_id bigint NOT NULL REFERENCES sh_projets(id) ON DELETE CASCADE,
      nom text NOT NULL, echeance date, termine_le timestamptz, responsable_id int REFERENCES sh_utilisateurs(id))`);
    await c.query(`CREATE TABLE IF NOT EXISTS sh_support_tickets (
      id bigserial PRIMARY KEY, hopital_id int NOT NULL REFERENCES hopitaux(id), titre text NOT NULL, description text,
      statut text NOT NULL DEFAULT 'ouvert' CHECK(statut IN ('ouvert','en_cours','en_attente','resolu','ferme')),
      priorite text NOT NULL DEFAULT 'normale' CHECK(priorite IN ('basse','normale','haute','urgente')),
      responsable_id int REFERENCES sh_utilisateurs(id), echeance timestamptz, cree_par int REFERENCES sh_utilisateurs(id), cree_le timestamptz NOT NULL DEFAULT now())`);
    await c.query(`CREATE TABLE IF NOT EXISTS sh_documents (
      id bigserial PRIMARY KEY, hopital_id int REFERENCES hopitaux(id), projet_id bigint REFERENCES sh_projets(id), contrat_id bigint REFERENCES sh_contrats(id),
      nom text NOT NULL, categorie text NOT NULL, stockage_ref text NOT NULL, version int NOT NULL DEFAULT 1,
      depose_par int REFERENCES sh_utilisateurs(id), cree_le timestamptz NOT NULL DEFAULT now())`);
    await c.query(`CREATE TABLE IF NOT EXISTS sh_audit_metier (
      id bigserial PRIMARY KEY, utilisateur_id int REFERENCES sh_utilisateurs(id), action text NOT NULL,
      entite text NOT NULL, entite_id bigint, details jsonb NOT NULL DEFAULT '{}'::jsonb, cree_le timestamptz NOT NULL DEFAULT now())`);
    await c.query('CREATE INDEX IF NOT EXISTS sh_opp_pipeline_idx ON sh_opportunites(statut, echeance)');
    await c.query('CREATE INDEX IF NOT EXISTS sh_taches_responsable_idx ON sh_taches(responsable_id, statut, echeance)');
    await c.query('CREATE INDEX IF NOT EXISTS sh_support_hopital_idx ON sh_support_tickets(hopital_id, statut, cree_le DESC)');
    await c.query('CREATE UNIQUE INDEX IF NOT EXISTS sh_projets_contrat_unique ON sh_projets(contrat_id) WHERE contrat_id IS NOT NULL');
    await c.query('CREATE UNIQUE INDEX IF NOT EXISTS sh_taches_projet_titre_unique ON sh_taches(projet_id,lower(titre))');
    await c.query('INSERT INTO sh_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING', [VERSION]);
    await c.query("ALTER TABLE sh_utilisateurs ADD COLUMN IF NOT EXISTS langue text NOT NULL DEFAULT 'fr'");
    await c.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sh_utilisateurs_langue_chk') THEN ALTER TABLE sh_utilisateurs ADD CONSTRAINT sh_utilisateurs_langue_chk CHECK (langue IN ('fr','en')); END IF; END $$");
    await c.query('INSERT INTO sh_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING', [LANGUE_VERSION]);
    return true;
  }
}

module.exports = { VERSION, LANGUE_VERSION, ERP_VERSION, ACCES_VERSION, PROJETS_VERSION, PRESENCE_VERSION, PERIMETRE_VERSION, migrerSh };
