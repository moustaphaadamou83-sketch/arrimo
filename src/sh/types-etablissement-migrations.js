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
const VERSION_SH = LIAISON_CHSLD_VERSION;
module.exports = { TYPES_ETABLISSEMENT_VERSION, LIAISON_CHSLD_VERSION, VERSION_SH, migrerTypesEtablissement, migrerLiaisonChsld };
