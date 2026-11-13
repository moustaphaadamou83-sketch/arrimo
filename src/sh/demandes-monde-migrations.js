'use strict';
/* Migration 47 : demandes du site ouvertes au monde entier.
   Pays ISO 3166-1 (alpha-2), ville libre, langue de contact préférée, téléphone international (E.164).
   Un numéro qui n'est pas au format E.164 est gardé tel quel et marqué « à vérifier » : une demande n'est jamais perdue.
   Les anciennes demandes (pays par continent) restent lisibles. */
const DEMANDES_MONDE_VERSION = 47;
const LANGUES_CONTACT = ['fr', 'en', 'es', 'pt', 'ar', 'de', 'it', 'zh', 'ht', 'autre'];
async function migrerDemandesMonde(c) {
  if ((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1', [DEMANDES_MONDE_VERSION])).rowCount) return false;
  await c.query(`ALTER TABLE sh_demandes_site ALTER COLUMN pays DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS pays_code char(2) CHECK (pays_code ~ '^[A-Z]{2}$'),
    ADD COLUMN IF NOT EXISTS ville text CHECK (length(ville) <= 120),
    ADD COLUMN IF NOT EXISTS langue_contact text CHECK (langue_contact IN (${LANGUES_CONTACT.map((l) => `'${l}'`).join(',')})),
    ADD COLUMN IF NOT EXISTS telephone_a_verifier boolean NOT NULL DEFAULT false`);
  await c.query(`ALTER TABLE sh_demandes_site ADD CONSTRAINT sh_demandes_site_pays_present CHECK (pays IS NOT NULL OR pays_code IS NOT NULL)`);
  await c.query('CREATE INDEX IF NOT EXISTS sh_demandes_site_pays_code ON sh_demandes_site (pays_code)');
  await c.query('INSERT INTO sh_migrations(version) VALUES($1)', [DEMANDES_MONDE_VERSION]);
  return true;
}
module.exports = { DEMANDES_MONDE_VERSION, LANGUES_CONTACT, migrerDemandesMonde };
