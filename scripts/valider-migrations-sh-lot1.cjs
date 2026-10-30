'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {Client}=require('pg');
const {creerPool}=require('../src/db');
const {migrerSh}=require('../src/sh/migrations');
const {hacherAsync}=require('../src/auth');
const {chiffrerSecret}=require('../src/sh/security');
const totp=require('../src/totp');
const {demarrerServeur}=require('../tests/serveur-test.cjs');
const ident=s=>'"'+s.replace(/"/g,'""')+'"';
async function empreintes(c,tables){
  const out={};
  for(const [nom,colonnes]of Object.entries(tables)){
    out[nom]=(await c.query(`SELECT count(*)::int n,md5(COALESCE(string_agg(to_jsonb(x)::text,E'\n' ORDER BY to_jsonb(x)::text),'')) empreinte
      FROM (SELECT ${colonnes.map(ident).join(',')} FROM public.${ident(nom)}) x`)).rows[0];
  }
  return out;
}
async function main(){
  const fichier=process.env.SH_RECETTE_CONFIGURATION||process.argv.find(a=>a.startsWith('--configuration='))?.slice('--configuration='.length);
  const config=fs.readFileSync(fichier,'utf8');
  const source=new URL(config.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^['"]|['"]$/g,''));
  assert.equal(source.hostname,'127.0.0.1');assert.equal(source.pathname,'/arrimo_sh');
  const stamp=new Date().toISOString().replace(/\D/g,'').slice(0,14)+'_'+crypto.randomBytes(3).toString('hex');
  const nom='arrimo_sh_lot1_restore_'+stamp;
  const dossier=path.resolve('.local','preuves-sh-lot1','migration-'+stamp);fs.mkdirSync(dossier,{recursive:true,mode:0o700});
  const dump=path.join(dossier,'sh-avant.dump');
  const pg={...process.env,PGHOST:source.hostname,PGPORT:source.port||'5432',PGUSER:source.username,PGPASSWORD:decodeURIComponent(source.password),PGDATABASE:source.pathname.slice(1)};
  const c=new Client({connectionString:source.href});await c.connect();
  let tables,avant;
  try{
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot=(await c.query('SELECT pg_export_snapshot() s')).rows[0].s;
    const colonnes=(await c.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'
      AND table_name IN(SELECT tablename FROM pg_tables WHERE schemaname='public') ORDER BY table_name,ordinal_position`)).rows;
    tables={};for(const r of colonnes)(tables[r.table_name]??=[]).push(r.column_name);
    avant=await empreintes(c,tables);
    const r=spawnSync('pg_dump',['--format=custom','--snapshot='+snapshot,'--file='+dump],{env:pg,encoding:'utf8',timeout:120000});
    if(r.status!==0)throw new Error('Sauvegarde source impossible : '+r.stderr);
    fs.chmodSync(dump,0o600);
    await c.query('ROLLBACK');
  }finally{await c.end();}
  const sha=crypto.createHash('sha256').update(fs.readFileSync(dump)).digest('hex');fs.writeFileSync(dump+'.sha256',sha+'  sh-avant.dump\n',{mode:0o600});
  for(const [b,args]of [['createdb',['--owner=arrimo_sh',nom]],['psql',['-X','-v','ON_ERROR_STOP=1','-d',nom,'-c',`REVOKE CONNECT ON DATABASE ${nom} FROM PUBLIC`]]]){
    const r=spawnSync('runuser',['-u','postgres','--',b,...args],{encoding:'utf8'});if(r.status!==0)throw new Error('Préparation copie impossible : '+r.stderr);
  }
  let r=spawnSync('pg_restore',['--exit-on-error','--no-owner','--no-acl','--dbname='+nom,dump],{env:{...pg,PGDATABASE:nom},encoding:'utf8',timeout:120000});
  if(r.status!==0)throw new Error('Restauration impossible : '+r.stderr);
  const u=new URL(source);u.pathname='/'+nom;const pool=creerPool(u.href);
  const env={SH_MFA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),SH_PUBLIC_URL:'https://sh.example.invalid'};
  const rapport={date:new Date().toISOString(),source:'arrimo_sh',copie:nom,sauvegarde:dump,sha256:sha};
  try{
    assert.deepEqual(await empreintes(pool,tables),avant);rapport.restauration_identique=true;
    rapport.migration=await migrerSh(pool,env);
    const compare={...tables};delete compare.sh_migrations;
    const avantMetier={...avant};delete avantMetier.sh_migrations;
    assert.deepEqual(await empreintes(pool,compare),avantMetier);rapport.anciennes_colonnes_preservees=true;
    assert.equal((await migrerSh(pool,env)).appliquee,false);rapport.migration_rejouable=true;
    // Fixture ajoutée uniquement APRÈS comparaison de toutes les données restaurées.
    const password=crypto.randomBytes(24).toString('base64url')+'9a',secret=totp.nouveauSecret();
    const user=(await pool.query(`INSERT INTO sh_utilisateurs(email,nom,role,mot_de_passe_hash,mdp_temporaire,totp_actif,totp_secret)
      VALUES('validation-migration@example.invalid','Validation migration','administration',$1,false,true,$2) RETURNING id`,[await hacherAsync(password),chiffrerSecret(secret,env)])).rows[0];
    rapport.compatibilite={};
    for(const [nomCode,chemin]of [['ancienne','/opt/arrimo-sh/current/src/sh/app.js'],['nouvelle',path.resolve('src/sh/app.js')]]){
      const server=await demarrerServeur(require(chemin).creerAppSh(pool,{env}));
      try{
        const base='http://127.0.0.1:'+server.address().port;
        const appel=async(method,p,b,token)=>{const r=await fetch(base+'/api'+p,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:b?JSON.stringify(b):undefined});assert.equal(r.status,200);return r.json();};
        await pool.query('UPDATE sh_utilisateurs SET totp_dernier_pas=0 WHERE id=$1',[user.id]);
        const a=await appel('POST','/connexion',{email:'validation-migration@example.invalid',mot_de_passe:password});assert.equal(a.etape,'2fa');
        const b=await appel('POST','/connexion/2fa',{jeton:a.jeton,code:totp.codePourPas(secret,totp.pasActuel())});
        await appel('GET','/moi',null,b.token);await appel('GET','/projets',null,b.token);await appel('POST','/deconnexion',{},b.token);
        rapport.compatibilite[nomCode]=true;
      }finally{await new Promise(r=>server.close(r));}
    }
    rapport.source_modifiee=false;rapport.valide=true;
    fs.writeFileSync(path.join(dossier,'rapport.json'),JSON.stringify(rapport,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify(rapport,null,2));
  }finally{await pool.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
