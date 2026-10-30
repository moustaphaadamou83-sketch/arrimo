'use strict';
// Seules les migrations additives déjà restaurées et testées sont appliquées.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {Client}=require('pg');
const ident=s=>'"'+s.replace(/"/g,'""')+'"';
async function main(){
  const contenu=fs.readFileSync(process.env.SH_RECETTE_CONFIGURATION,'utf8');
  const u=new URL(contenu.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^['"]|['"]$/g,''));
  assert.equal(u.hostname,'127.0.0.1');assert.equal(u.pathname,'/arrimo_sh');
  const c=new Client({connectionString:u.href});await c.connect();
  try{
    await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='10s'");await c.query("SET LOCAL statement_timeout='60s'");
    await c.query("SELECT pg_advisory_xact_lock(hashtext('arrimo-sh-migrations'))");
    const versions=(await c.query('SELECT version FROM sh_migrations ORDER BY version')).rows.map(r=>r.version);
    assert.ok(versions.includes(6)&&versions.every(v=>[4,5,6,7,8,9].includes(v)),'Version SH inattendue');
    const rows=(await c.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'
      AND table_name<>'sh_migrations' AND table_name IN(SELECT tablename FROM pg_tables WHERE schemaname='public') ORDER BY table_name,ordinal_position`)).rows;
    const tables={};for(const r of rows)(tables[r.table_name]??=[]).push(r.column_name);
    const empreintes=async()=>{const out={};for(const [t,cols]of Object.entries(tables))out[t]=(await c.query(`SELECT count(*)::int n,
      md5(COALESCE(string_agg(to_jsonb(x)::text,E'\n' ORDER BY to_jsonb(x)::text),'')) empreinte FROM(SELECT ${cols.map(ident).join(',')} FROM public.${ident(t)})x`)).rows[0];return out;};
    const avant=await empreintes();
    await require('../src/sh/acces-migrations').migrerAcces(c);await require('../src/sh/projets-migrations').migrerProjets(c);
    await require('../src/sh/presence-migrations').migrerPresence(c);
    assert.deepEqual(await empreintes(),avant,'Les colonnes métier existantes doivent rester identiques');
    await c.query('COMMIT');console.log(JSON.stringify({versions_avant:versions,versions_apres:[4,5,6,7,8,9],tables_anciennes_verifiees:Object.keys(tables).length,donnees_existantes_preservees:true}));
  }catch(e){await c.query('ROLLBACK');throw e;}finally{await c.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
