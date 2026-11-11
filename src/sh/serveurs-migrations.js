'use strict';
/**
 * Migration 43 : registre des serveurs (environnements) ajoutés depuis SH.
 * - Plusieurs serveurs par pays : un code libre rattaché au pays (ex. production_ca_estrie, production_ca_chu_exemple),
 *   un serveur pour une région, un client ou un seul établissement. Chaque serveur a sa base, son adresse et sa clé.
 * - La clé de service n'est jamais affichée : elle est chiffrée (AES-256-GCM) et remise une seule fois au serveur,
 *   par un code d'appairage à usage unique (empreinte seulement, 15 minutes, 5 essais).
 * Migration 44 : profils de pays créés depuis SH (format de référence, fuseau, langues, réglages), diffusés aux serveurs.
 * Aucune ligne existante n'est modifiée ; les contraintes d'environnement sont élargies aux codes du registre.
 */
const SERVEURS_VERSION = 43;
const PROFILS_PAYS_VERSION = 44;
const CODE_SERVEUR = '^(production|pilote|recette)_[a-z]{2}(_[a-z0-9]{2,24})?$';

async function role(c) {
  const owner = (await c.query('SELECT current_user owner')).rows[0].owner; const r = `${owner}_scope`;
  if (!/^[a-z][a-z0-9_]{0,50}$/.test(r)) throw new Error('Rôle SH invalide.');
  return (await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [r])).rowCount ? r : null;
}

async function migrerServeurs(c) {
  if ((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1', [SERVEURS_VERSION])).rowCount) return false;
  await c.query(`CREATE TABLE IF NOT EXISTS sh_serveurs(
    code text PRIMARY KEY CHECK (code ~ '${CODE_SERVEUR}'),
    type text NOT NULL CHECK (type IN ('production','pilote','recette')),
    pays_code char(2) NOT NULL CHECK (pays_code ~ '^[A-Z]{2}$'),
    region text CHECK (region IS NULL OR char_length(region) BETWEEN 2 AND 80),
    nom text NOT NULL CHECK (char_length(nom) BETWEEN 2 AND 60),
    url text NOT NULL CHECK (url ~ '^https://[^/?#@ ]+$' OR url ~ '^http://127\.0\.0\.1:[0-9]{2,5}$'),
    public text NOT NULL CHECK (public ~ '^https://[^/?#@ ]+$'),
    cle_chiffree text NOT NULL,
    cle_empreinte text NOT NULL UNIQUE,
    appairage_empreinte text UNIQUE,
    appairage_expire timestamptz,
    appairage_essais int NOT NULL DEFAULT 0,
    statut text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','appaire','relie','desactive')),
    cree_par int REFERENCES sh_utilisateurs(id),
    cree_le timestamptz NOT NULL DEFAULT now(),
    appaire_le timestamptz, relie_le timestamptz, desactive_le timestamptz,
    UNIQUE (url))`);
  // Les fiches et les mises en ligne acceptent aussi les codes du registre
  await c.query(`ALTER TABLE hopitaux DROP CONSTRAINT IF EXISTS hopitaux_environnement_check;
    ALTER TABLE hopitaux ADD CONSTRAINT hopitaux_environnement_check CHECK (environnement IN ('demo','demo_abc','recette','pilote') OR environnement ~ '^production(_[a-z]{2})?$' OR environnement ~ '${CODE_SERVEUR}');
    ALTER TABLE sh_golive_operations DROP CONSTRAINT IF EXISTS sh_golive_operations_cible_check;
    ALTER TABLE sh_golive_operations ADD CONSTRAINT sh_golive_operations_cible_check CHECK (cible = 'recette' OR cible ~ '^production(_[a-z]{2})?$' OR cible ~ '${CODE_SERVEUR}');`);
  const r = await role(c);
  if (r) await c.query(`GRANT SELECT,INSERT,UPDATE ON sh_serveurs TO "${r}"`);
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)', [SERVEURS_VERSION]);
  return true;
}

async function migrerProfilsPays(c) {
  if ((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1', [PROFILS_PAYS_VERSION])).rowCount) return false;
  await c.query(`CREATE TABLE IF NOT EXISTS sh_profils_pays(
    id serial PRIMARY KEY,
    code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9-]{1,11}$'),
    pays_code char(2) NOT NULL CHECK (pays_code ~ '^[A-Z]{2}$'),
    nom text NOT NULL CHECK (char_length(nom) BETWEEN 2 AND 80),
    fuseau text NOT NULL CHECK (char_length(fuseau) BETWEEN 3 AND 60),
    langues text[] NOT NULL CHECK (cardinality(langues) BETWEEN 1 AND 4),
    reference_prefixe text NOT NULL CHECK (reference_prefixe ~ '^[A-Z]{1,4}$'),
    reference_chiffres int NOT NULL CHECK (reference_chiffres BETWEEN 5 AND 8),
    rayon_km int NOT NULL DEFAULT 150 CHECK (rayon_km BETWEEN 5 AND 2000),
    nettoyage_cible_min int NOT NULL DEFAULT 45 CHECK (nettoyage_cible_min BETWEEN 10 AND 240),
    transport_libelle text NOT NULL DEFAULT 'Ambulance' CHECK (char_length(transport_libelle) BETWEEN 2 AND 60),
    version int NOT NULL DEFAULT 1,
    cree_par int REFERENCES sh_utilisateurs(id),
    cree_le timestamptz NOT NULL DEFAULT now(),
    modifie_le timestamptz NOT NULL DEFAULT now())`);
  await c.query(`CREATE TABLE IF NOT EXISTS sh_profils_pays_diffusions(
    profil_id int NOT NULL REFERENCES sh_profils_pays(id), environnement text NOT NULL, version int NOT NULL,
    diffuse_le timestamptz NOT NULL DEFAULT now(), par int REFERENCES sh_utilisateurs(id), PRIMARY KEY (profil_id, environnement))`);
  const r = await role(c);
  if (r) {
    await c.query(`GRANT SELECT,INSERT,UPDATE ON sh_profils_pays, sh_profils_pays_diffusions TO "${r}"`);
    await c.query(`GRANT USAGE,SELECT ON SEQUENCE sh_profils_pays_id_seq TO "${r}"`);
  }
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)', [PROFILS_PAYS_VERSION]);
  return true;
}

module.exports = { SERVEURS_VERSION, PROFILS_PAYS_VERSION, CODE_SERVEUR, migrerServeurs, migrerProfilsPays };
