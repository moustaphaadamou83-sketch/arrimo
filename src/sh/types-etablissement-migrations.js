'use strict';
/* Migration 37 : type d'établissement sur la fiche SH et catalogue de modules par type (commun, hôpital, CHSLD, optionnel).
   Le catalogue reprend src/types-etablissement.js (source unique) : un module n'est souscriptible que s'il est disponible. */
const TYPES_ETABLISSEMENT_VERSION = 37;
async function migrerTypesEtablissement(c) {
  if ((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1', [TYPES_ETABLISSEMENT_VERSION])).rowCount) return false;
  await c.query(`ALTER TABLE hopitaux ADD COLUMN IF NOT EXISTS type_etablissement text NOT NULL DEFAULT 'hopital'
    CHECK (type_etablissement IN ('hopital','chsld','maison_aines','rpa','ressource_intermediaire'))`);
  await c.query(`ALTER TABLE sh_modules_catalogue
    ADD COLUMN IF NOT EXISTS categorie text NOT NULL DEFAULT 'hopital' CHECK (categorie IN ('commun','hopital','chsld','optionnel')),
    ADD COLUMN IF NOT EXISTS types text[] NOT NULL DEFAULT '{hopital}',
    ADD COLUMN IF NOT EXISTS statut text NOT NULL DEFAULT 'disponible' CHECK (statut IN ('inclus','disponible','a_venir','etude')),
    ADD COLUMN IF NOT EXISTS ordre int NOT NULL DEFAULT 100,
    ADD COLUMN IF NOT EXISTS nom_en text,
    ADD COLUMN IF NOT EXISTS note text`);
  const { MODULES } = require('../types-etablissement');
  // Les modules existants (lits, civières, transferts, OG, notifications, rapports) gardent leur code, leurs licences et leurs
  // dépendances : une dépendance absente du catalogue d'un type est ignorée à la lecture du catalogue (src/sh/app.js).
  const anciens = { civieres: 'urgence' };
  for (const [i, m] of MODULES.entries()) {
    const code = Object.keys(anciens).find((k) => anciens[k] === m.code) || m.code;
    await c.query(`INSERT INTO sh_modules_catalogue (code, nom, description, dependances, categorie, types, statut, ordre, nom_en, note)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (code) DO UPDATE SET categorie = EXCLUDED.categorie, types = EXCLUDED.types, statut = EXCLUDED.statut, ordre = EXCLUDED.ordre,
        nom_en = EXCLUDED.nom_en, note = EXCLUDED.note`,
    [code, m.nom, m.note || m.nom, m.dependances || [], m.categorie, m.types, m.statut, i + 1, m.nom_en, m.note || null]);
  }
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)', [TYPES_ETABLISSEMENT_VERSION]);
  return true;
}
/* Migration 38 : module hospitalier « Liaison CHSLD », commun à tous les hôpitaux. Ajout d'une seule ligne au catalogue ;
   aucune ligne existante n'est modifiée (exception fermée du contrôle de publication, docs/CHSLD_MIGRATION_CATALOGUE_SH.md). */
const LIAISON_CHSLD_VERSION = 38;
async function migrerLiaisonChsld(c) {
  if ((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1', [LIAISON_CHSLD_VERSION])).rowCount) return false;
  const { MODULES } = require('../types-etablissement');
  const i = MODULES.findIndex((m) => m.code === 'liaison_chsld'); const m = MODULES[i];
  await c.query(`INSERT INTO sh_modules_catalogue (code, nom, description, dependances, categorie, types, statut, ordre, nom_en, note)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (code) DO NOTHING`,
  [m.code, m.nom, m.note || m.nom, m.dependances || [], m.categorie, m.types, m.statut, i + 1, m.nom_en, m.note || null]);
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)', [LIAISON_CHSLD_VERSION]);
  return true;
}
/* Migration 39 : une production par pays (production ou production_xx). Élargit deux contraintes, ne modifie aucune ligne. */
const PRODUCTIONS_VERSION = 39;
async function migrerProductions(c) {
  if ((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1', [PRODUCTIONS_VERSION])).rowCount) return false;
  await c.query(`ALTER TABLE hopitaux DROP CONSTRAINT IF EXISTS hopitaux_environnement_check;
    ALTER TABLE hopitaux ADD CONSTRAINT hopitaux_environnement_check CHECK (environnement IN ('demo','demo_abc','recette','pilote') OR environnement ~ '^production(_[a-z]{2})?$');
    ALTER TABLE sh_golive_operations DROP CONSTRAINT IF EXISTS sh_golive_operations_cible_check;
    ALTER TABLE sh_golive_operations ADD CONSTRAINT sh_golive_operations_cible_check CHECK (cible = 'recette' OR cible ~ '^production(_[a-z]{2})?$');`);
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)', [PRODUCTIONS_VERSION]);
  return true;
}
/* Migration 40 : types d'établissement propres à un pays. Un type local est un nom ; son comportement vient de son modèle,
   un type opérationnel déjà développé et testé (hôpital ou CHSLD). Aucune ligne existante n'est modifiée. */
const TYPES_LOCAUX_VERSION = 40;
async function migrerTypesLocaux(c) {
  if ((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1', [TYPES_LOCAUX_VERSION])).rowCount) return false;
  await c.query(`CREATE TABLE IF NOT EXISTS sh_types_locaux(
    id serial PRIMARY KEY,
    pays_code text NOT NULL CHECK (pays_code ~ '^[A-Z]{2}$'),
    code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
    nom text NOT NULL CHECK (char_length(nom) BETWEEN 2 AND 80),
    nom_en text CHECK (nom_en IS NULL OR char_length(nom_en) BETWEEN 2 AND 80),
    modele text NOT NULL CHECK (modele IN ('hopital','chsld')),
    actif boolean NOT NULL DEFAULT true,
    cree_le timestamptz NOT NULL DEFAULT now(),
    UNIQUE(pays_code, code))`);
  await c.query('ALTER TABLE hopitaux ADD COLUMN IF NOT EXISTS type_local_id int REFERENCES sh_types_locaux(id)');
  const owner = (await c.query('SELECT current_user owner')).rows[0].owner; const role = `${owner}_scope`;
  if (!/^[a-z][a-z0-9_]{0,50}$/.test(role)) throw new Error('Rôle SH invalide.');
  await c.query(`GRANT SELECT,INSERT,UPDATE ON sh_types_locaux TO "${role}"`);
  await c.query(`GRANT USAGE,SELECT ON SEQUENCE sh_types_locaux_id_seq TO "${role}"`);
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)', [TYPES_LOCAUX_VERSION]);
  return true;
}
/* Migration 41 : demandes du formulaire du site public. Table neuve ; aucune ligne existante n'est modifiée. */
const DEMANDES_SITE_VERSION = 41;
async function migrerDemandesSite(c) {
  if ((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1', [DEMANDES_SITE_VERSION])).rowCount) return false;
  await c.query(`CREATE TABLE IF NOT EXISTS sh_demandes_site(
    id serial PRIMARY KEY,
    depot_id uuid NOT NULL UNIQUE,
    type text NOT NULL CHECK (type IN ('demo','devis','contact')),
    pays text NOT NULL CHECK (pays IN ('canada','europe','afrique','autre')),
    langue text NOT NULL CHECK (langue IN ('fr','en')),
    nom text NOT NULL, fonction text, organisation text NOT NULL, courriel text NOT NULL, telephone text,
    type_organisation text, format text, nb_etablissements text, offre text, sujet text, message text NOT NULL,
    statut text NOT NULL DEFAULT 'nouvelle' CHECK (statut IN ('nouvelle','en_cours','traitee','rejetee')),
    traite_par int REFERENCES sh_utilisateurs(id) ON DELETE SET NULL, traite_le timestamptz, alerte_le timestamptz,
    recu_le timestamptz NOT NULL DEFAULT now())`);
  await c.query('CREATE INDEX IF NOT EXISTS sh_demandes_site_recu ON sh_demandes_site (recu_le)');
  const owner = (await c.query('SELECT current_user owner')).rows[0].owner; const role = `${owner}_scope`;
  if (!/^[a-z][a-z0-9_]{0,50}$/.test(role)) throw new Error('Rôle SH invalide.');
  await c.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON sh_demandes_site TO "${role}"`);
  await c.query(`GRANT USAGE,SELECT ON SEQUENCE sh_demandes_site_id_seq TO "${role}"`);
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)', [DEMANDES_SITE_VERSION]);
  return true;
}
/* Migration 42 : catégories pour aînés, sur le modèle CHSLD. Modules désactivés par défaut selon la catégorie ; soutien à domicile non inclus (pas de chambres). */
const TYPES_AINES_VERSION = 42;
async function migrerTypesAines(c) {
  if ((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1', [TYPES_AINES_VERSION])).rowCount) return false;
  await c.query("ALTER TABLE sh_types_locaux ADD COLUMN IF NOT EXISTS modules_desactives text[] NOT NULL DEFAULT '{}'");
  const seuls = ['reseau_chsld', 'demandes_hebergement'];
  for (const [code, nom, en, off] of [['chsld_prive', 'CHSLD privé', 'Private CHSLD', []], ['maison_aines', 'Maison des aînés', 'Seniors’ home', []], ['rpa', 'Résidence privée pour aînés (RPA)', 'Private seniors’ residence (RPA)', seuls],
    ['ri', 'Ressource intermédiaire (RI)', 'Intermediate resource (RI)', seuls], ['rtf', 'Ressource de type familial (RTF)', 'Family-type resource (RTF)', [...seuls, 'taches']], ['maison_retraite', 'Maison de retraite', 'Retirement home', seuls]]) {
    await c.query(`INSERT INTO sh_types_locaux (pays_code, code, nom, nom_en, modele, modules_desactives) VALUES ('CA', $1, $2, $3, 'chsld', $4) ON CONFLICT (pays_code, code) DO NOTHING`, [code, nom, en, off]);
  }
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)', [TYPES_AINES_VERSION]);
  return true;
}
/* Migration 45 (12 nov. 2026) : module hospitalier optionnel « Liaison Secours » (préalertes des ambulances).
   Une seule ligne ajoutée au catalogue, comme la migration 38 ; aucune ligne existante n'est modifiée. Recette d'abord. */
const LIAISON_SECOURS_VERSION = 45;
async function migrerLiaisonSecours(c) {
  if ((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1', [LIAISON_SECOURS_VERSION])).rowCount) return false;
  const { MODULES } = require('../types-etablissement');
  const i = MODULES.findIndex((m) => m.code === 'liaison_secours'); const m = MODULES[i];
  await c.query(`INSERT INTO sh_modules_catalogue (code, nom, description, dependances, categorie, types, statut, ordre, nom_en, note)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (code) DO NOTHING`,
  [m.code, m.nom, m.note || m.nom, m.dependances || [], m.categorie, m.types, m.statut, i + 1, m.nom_en, m.note || null]);
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)', [LIAISON_SECOURS_VERSION]);
  return true;
}
const VERSION_SH = TYPES_AINES_VERSION;
module.exports = { LIAISON_SECOURS_VERSION, migrerLiaisonSecours, TYPES_ETABLISSEMENT_VERSION, LIAISON_CHSLD_VERSION, PRODUCTIONS_VERSION, TYPES_LOCAUX_VERSION, DEMANDES_SITE_VERSION, VERSION_SH, migrerTypesEtablissement, migrerLiaisonChsld, migrerProductions, migrerTypesLocaux, migrerDemandesSite, migrerTypesAines };
