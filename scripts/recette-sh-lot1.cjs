'use strict';
// Crée exclusivement des bases NEUVES dédiées. Ne réinitialise, ne supprime ni ne déploie aucun environnement.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {environnementTest,environnementAdministration,masquer,PREFIXES_BASE}=require('./recette-sh-garde.cjs');
const {diagnostiquer}=require('./diagnostic-recette-sh.cjs');
const {empreinteSources}=require('./empreinte-sources.cjs');
const racine=path.resolve(__dirname,'..');
async function main(){
const stamp=new Date().toISOString().replace(/\D/g,'').slice(0,14)+'_'+crypto.randomBytes(3).toString('hex');
const dossier=path.join(racine,'.local','preuves-sh-lot1',stamp);fs.mkdirSync(dossier,{recursive:true,mode:0o700});
const diagnostic=await diagnostiquer();
fs.writeFileSync(path.join(dossier,'diagnostic.json'),JSON.stringify(diagnostic,null,2)+'\n',{mode:0o600});
if(process.argv.includes('--diagnostic')||!diagnostic.prerequisSystemeValides){
  const rapport={date:diagnostic.date,dossier,statut:diagnostic.prerequisSystemeValides?'diagnostic_systeme_valide':'bloque_prerequis_systeme',suites:[],donnees_publiques_modifiees:false};
  fs.writeFileSync(path.join(dossier,'rapport.json'),JSON.stringify(rapport,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({rapport:path.join(dossier,'rapport.json'),diagnostic},null,2));
  if(!diagnostic.prerequisSystemeValides)process.exitCode=2;
  return;
}
const source=process.env.SH_RECETTE_CONFIGURATION||process.argv.find(a=>a.startsWith('--configuration='))?.slice('--configuration='.length);
if(!source)throw new Error('SH_RECETTE_CONFIGURATION : fichier privé donnant uniquement la connexion PostgreSQL source requis.');
const texte=fs.readFileSync(source,'utf8');
const base=new URL(texte.match(/^DATABASE_URL=(.*)$/m)?.[1].trim().replace(/^['"]|['"]$/g,''));
if(base.hostname!=='127.0.0.1'||base.username!=='arrimo_sh')throw new Error('Serveur local et rôle SH attendus.');
const demandes=process.argv.slice(2).filter(a=>!a.startsWith('--configuration='));
const suites=demandes.length?demandes:['acces','erp','interface','parite'];
const autorisees={sla:['tests/sh-support-sla.test.cjs','TEST_DATABASE_URL'],raccordement:['tests/sh-raccordement-support.test.cjs','TEST_DATABASE_URL'],parite:['tests/sh-activation-parite.test.cjs','TEST_DATABASE_URL'],notifications:['tests/sh-notifications-perimetres.test.cjs','TEST_DATABASE_URL'],portail:['tests/sh-portail-support.test.cjs','TEST_DATABASE_URL'],restauration:['tests/sh-restauration.test.cjs','TEST_DATABASE_URL'],cycle:['tests/sh-cycle-projets.test.cjs','TEST_DATABASE_URL'],acces:['tests/sh-acces.test.cjs','SH_ACCES_TEST_DATABASE_URL'],erp:['tests/sh-erp.test.cjs','TEST_DATABASE_URL'],interface:['tests/sh-erp.interface.spec.cjs','TEST_DATABASE_URL'],hopital:['tests/interface.spec.js','INTERFACE_DATABASE_URL'],og:['tests/og-suivi-postgres.test.cjs','OG_SUIVI_TEST_DATABASE_URL'],api:['tests/api.test.js','TEST_DATABASE_URL'],scenarios:['tests/scenarios-abc.test.cjs','TRIO_TEST_DATABASE_URL'],correction:['tests/correction-31oct.test.cjs','TRIO_TEST_DATABASE_URL'],structure:['tests/structure-ui.spec.cjs','STRUCTURE_DATABASE_URL'],priorites:['tests/priorites-postgres.test.cjs','PRIORITES_TEST_DATABASE_URL'],interop:['tests/simulation-postgres.test.cjs','SIMULATION_TEST_DATABASE_URL'],'og-base':['tests/og-postgres.test.cjs','OG_TEST_DATABASE_URL']};
if(suites.some(s=>!Object.hasOwn(autorisees,s))||new Set(suites).size!==suites.length)throw new Error('Suites inconnues ou répétées : aucune base créée.');
const rapport={date:new Date().toISOString(),sources_sha256:empreinteSources(),dossier,statut:'en_cours',suites:[],donnees_publiques_modifiees:false};
fs.writeFileSync(path.join(dossier,'rapport.json'),JSON.stringify(rapport,null,2)+'\n',{mode:0o600});
try{
const administration=environnementAdministration(process.env,base.port||'5432');
const controleRole=spawnSync('runuser',['-u','postgres','--','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-d','postgres','-c',
  "SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_roles WHERE rolname='arrimo_sh_scope' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls) THEN pg_has_role('arrimo_sh','arrimo_sh_scope','MEMBER') ELSE false END"],{encoding:'utf8',env:administration});
if(controleRole.status!==0||controleRole.stdout.trim()!=='t')throw new Error('Rôle restreint arrimo_sh_scope absent, non conforme ou non attribué dans le cluster de recette. Aucun rôle n’a été modifié.');
for(const suite of suites){
  const [fichier,variable]=autorisees[suite];
  const nom=PREFIXES_BASE[variable]+(suite==='og'||suite==='og-base'?crypto.randomBytes(6).toString('hex'):`${stamp}_${suite}`);
  const u=new URL(base);u.pathname='/'+nom;
  const envTest=environnementTest(process.env,variable,u.href);
  if(nom.length>63)throw new Error('Nom de base refusé.');
  let r=spawnSync('runuser',['-u','postgres','--','createdb','--owner=arrimo_sh',nom],{encoding:'utf8',env:administration});
  if(r.status!==0)throw new Error('Création base neuve impossible : '+r.stderr);
  r=spawnSync('runuser',['-u','postgres','--','psql','-X','-v','ON_ERROR_STOP=1','-d',nom,'-c',`REVOKE CONNECT ON DATABASE ${nom} FROM PUBLIC`],{encoding:'utf8',env:administration});
  if(r.status!==0)throw new Error('Restriction de la nouvelle base impossible.');
  console.log(`Recette ${suite} sur base fictive neuve ${nom}`);
  // La suite hospitalière complète (trois largeurs, deux langues) dépasse dix minutes. Un filtre de diagnostic rend la suite non probante.
  const filtre=process.env.SH_RECETTE_FILTRE;if(filtre)rapport.filtre=filtre;
  r=spawnSync(process.execPath,['--test','--test-isolation=none',...(filtre?[`--test-name-pattern=${filtre}`]:[]),fichier],{cwd:racine,env:envTest,encoding:'utf8',timeout:suite==='hopital'?2700000:600000,maxBuffer:64*1024*1024});
  const contenu=(r.stdout||'')+(r.stderr||'');
  const nettoye=masquer(contenu,[base.href,u.href]);
  fs.writeFileSync(path.join(dossier,`${suite}.log`),nettoye,{mode:0o600});console.log(nettoye);
  rapport.suites.push({suite,base:nom,reussi:r.status===0,statut:r.status,erreur:r.error?.code||null});
  fs.writeFileSync(path.join(dossier,'rapport.json'),JSON.stringify(rapport,null,2)+'\n',{mode:0o600});
  if(r.status!==0){process.exitCode=1;break;}
}
if(rapport.sources_sha256!==empreinteSources()){rapport.sources_modifiees=true;throw new Error('Sources modifiées pendant la recette : résultats non attribuables à une candidate figée.');}
rapport.statut=rapport.filtre?'diagnostic_filtre':rapport.suites.length===suites.length&&rapport.suites.every(s=>s.reussi)?'valide':'echec_tests';
}catch(e){rapport.statut='bloque_preparation';rapport.erreur=masquer(String(e.message),[base.href]);process.exitCode=2;}
fs.writeFileSync(path.join(dossier,'rapport.json'),JSON.stringify(rapport,null,2)+'\n',{mode:0o600});
console.log('Rapport : '+path.join(dossier,'rapport.json'));
}
main().catch(e=>{console.error(e.code||'ERREUR_CONFIGURATION_RECETTE');process.exitCode=2;});
