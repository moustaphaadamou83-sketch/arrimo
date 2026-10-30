'use strict';
const FISCALITE_VERSION=26;
const CRA='https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html';
const RQ='https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/basic-rules-for-applying-the-gsthst-and-qst/tables-of-gst-and-qst-rates/';
async function migrerFiscalite(c){
 if((await c.query('SELECT 1 FROM sh_migrations WHERE version=$1',[FISCALITE_VERSION])).rowCount)return false;
 await c.query(`ALTER TABLE sh_taxes
   ADD COLUMN IF NOT EXISTS source_nom text,
   ADD COLUMN IF NOT EXISTS source_url text,
   ADD COLUMN IF NOT EXISTS verifie_le date,
   ADD COLUMN IF NOT EXISTS valide_de date,
   ADD COLUMN IF NOT EXISTS valide_jusqua date`);
 await c.query('ALTER TABLE sh_taxes DROP CONSTRAINT IF EXISTS sh_taxes_pays_code_region_code_key');
 await c.query('CREATE UNIQUE INDEX IF NOT EXISTS sh_taxes_version_unique ON sh_taxes(pays_code,region,code,valide_de)');
 await c.query(`UPDATE sh_taxes SET source_nom=CASE WHEN code='TVQ' THEN 'Revenu Québec' ELSE 'Agence du revenu du Canada' END,
   source_url=CASE WHEN code='TVQ' THEN $1 ELSE $2 END,
   verifie_le=DATE '2026-10-29',valide_de=DATE '2026-10-29'
   WHERE pays_code='CA' AND source_url IS NULL AND
     ((code='TPS' AND taux=5 AND region IN('*','QC')) OR(code='TVQ' AND taux=9.975 AND region='QC')
       OR(code='TVH' AND ((region='ON' AND taux=13) OR(region IN('NB','NL','PE') AND taux=15) OR(region='NS' AND taux=14))))`,[RQ,CRA]);
 await c.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='sh_taxes_validite_dates_chk') THEN
   ALTER TABLE sh_taxes ADD CONSTRAINT sh_taxes_validite_dates_chk CHECK(valide_jusqua IS NULL OR valide_de IS NULL OR valide_jusqua>=valide_de);
 END IF; END $$`);
 await c.query(`CREATE TABLE sh_profils_fiscaux(
   id bigserial PRIMARY KEY,pays_code char(2) NOT NULL,region text NOT NULL DEFAULT '*',
   statut text NOT NULL DEFAULT 'a_verifier' CHECK(statut IN('a_verifier','valide','exonere')),
   source_nom text,source_url text,verifie_le date,motif text,modifie_par text,
   modifie_le timestamptz NOT NULL DEFAULT now(),UNIQUE(pays_code,region),
   CHECK((statut='a_verifier') OR(source_nom IS NOT NULL AND source_url LIKE 'https://%' AND verifie_le IS NOT NULL AND length(coalesce(motif,''))>=8))
 )`);
 // Aucune ligne ajoutée à sh_taxes (table existante) : AB, NT et NU utilisent la règle nationale CA/* sourcée.
 await c.query(`INSERT INTO sh_profils_fiscaux(pays_code,region,statut,source_nom,source_url,verifie_le,motif) VALUES
   ('CA','AB','valide','Agence du revenu du Canada',$1,DATE '2026-10-29','GST 5 %, aucune taxe de vente provinciale dans le tableau fédéral.'),
   ('CA','NT','valide','Agence du revenu du Canada',$1,DATE '2026-10-29','GST 5 %, aucune taxe de vente territoriale dans le tableau fédéral.'),
   ('CA','NU','valide','Agence du revenu du Canada',$1,DATE '2026-10-29','GST 5 %, aucune taxe de vente territoriale dans le tableau fédéral.'),
   ('CA','QC','valide','Revenu Québec',$2,DATE '2026-10-29','TPS 5 % et TVQ 9,975 % selon le barème officiel en vigueur.'),
   ('CA','ON','valide','Agence du revenu du Canada',$1,DATE '2026-10-29','TVH 13 % selon le tableau officiel fédéral.'),
   ('CA','NB','valide','Agence du revenu du Canada',$1,DATE '2026-10-29','TVH 15 % selon le tableau officiel fédéral.'),
   ('CA','NL','valide','Agence du revenu du Canada',$1,DATE '2026-10-29','TVH 15 % selon le tableau officiel fédéral.'),
   ('CA','PE','valide','Agence du revenu du Canada',$1,DATE '2026-10-29','TVH 15 % selon le tableau officiel fédéral.'),
   ('CA','NS','valide','Agence du revenu du Canada',$1,DATE '2026-10-29','TVH 14 % depuis le 1 avril 2025 selon le tableau officiel fédéral.'),
   ('CA','BC','a_verifier',NULL,NULL,NULL,'TPS/PST : vérifier les règles applicables à la fourniture et l’inscription fiscale.'),
   ('CA','MB','a_verifier',NULL,NULL,NULL,'TPS/RST : vérifier les règles applicables à la fourniture et l’inscription fiscale.'),
   ('CA','SK','a_verifier',NULL,NULL,NULL,'TPS/PST : vérifier les règles applicables à la fourniture et l’inscription fiscale.')
   ON CONFLICT(pays_code,region) DO NOTHING`,[CRA,RQ]);
 const owner=(await c.query('SELECT current_user owner')).rows[0].owner,role=owner+'_scope';
 if(!/^[a-z][a-z0-9_]{0,50}$/.test(role))throw new Error('Rôle fiscal SH invalide.');
 await c.query(`GRANT SELECT,INSERT,UPDATE ON sh_profils_fiscaux TO "${role}"`);
 await c.query(`GRANT USAGE,SELECT ON SEQUENCE sh_profils_fiscaux_id_seq TO "${role}"`);
 await c.query('INSERT INTO sh_migrations(version) VALUES($1)',[FISCALITE_VERSION]);return true;
}
module.exports={FISCALITE_VERSION,migrerFiscalite};
