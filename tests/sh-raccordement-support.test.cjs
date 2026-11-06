'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const { allerOnglet } = require('./aide-navigation.cjs');
const {Pool}=require('pg'),{creerPool}=require('../src/db'),{demarrerServeur}=require('./serveur-test.cjs');
const {hacherAsync}=require('../src/auth'),{premierCompteSh}=require('../db/sh-premier-compte');
const courriel=require('../src/courriel'),totp=require('../src/totp');
test('raccordement support : même code dans deux bases, liens SH et parcours client réel',{timeout:180000},async t=>{
 const url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/arrimo_sh_lot1_test_[a-z0-9_]+$/);
 const pool=creerPool(url.href);t.after(()=>pool.end());assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0);
 const original=Object.fromEntries(['ARRIMO_ENV','ARRIMO_DEMO','SH_API_KEY','SH_MFA_ENCRYPTION_KEY','SH_INITIAL_ADMIN_EMAIL','SH_PUBLIC_URL'].map(k=>[k,process.env[k]]));
 Object.assign(process.env,{ARRIMO_ENV:'demo',SH_API_KEY:crypto.randomBytes(32).toString('hex'),SH_MFA_ENCRYPTION_KEY:Buffer.alloc(32,3).toString('base64'),SH_INITIAL_ADMIN_EMAIL:'raccordement.sh@example.invalid',SH_PUBLIC_URL:'https://sh.example.invalid'});delete process.env.ARRIMO_DEMO;
 t.after(()=>{for(const [k,v]of Object.entries(original))v===undefined?delete process.env[k]:process.env[k]=v;courriel.definirTransport(null);});
 const mails=[];courriel.definirTransport(async m=>{mails.push(m);});
 await pool.query(fs.readFileSync(require.resolve('../db/sh-schema.sql'),'utf8'));
 const env={SH_MFA_ENCRYPTION_KEY:process.env.SH_MFA_ENCRYPTION_KEY,SH_SUPPORT_DEMO_CLE:crypto.randomBytes(32).toString('hex'),SH_SUPPORT_DEMO_ABC_CLE:crypto.randomBytes(32).toString('hex')};
 assert.equal((await require('../src/sh/migrations').migrerSh(pool,env)).version,39);
 const mdp='Raccordement-Fictif-2026';await premierCompteSh(pool,'raccordement.sh@example.invalid','Administration fictive');
 const invitation=mails.at(-1).texte.match(/#invitation=([a-f0-9]{64})/)[1];await require('../src/sh/invitations').consommer(pool,{jeton:invitation,nouveau:mdp},env);
 const sh=await demarrerServeur(require('../src/sh/app').creerAppSh(pool,{env}));t.after(()=>new Promise(r=>sh.close(r)));const baseSh=`http://127.0.0.1:${sh.address().port}`;
 async function api(base,token,method,p,body,status=200){const r=await fetch(base+'/api'+p,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const j=await r.json();assert.equal(r.status,status,`${method} ${p} : ${JSON.stringify(j)}`);return j;}
 let session=await api(baseSh,null,'POST','/connexion',{email:'raccordement.sh@example.invalid',mot_de_passe:mdp});
 const secret=(await api(baseSh,session.token,'POST','/moi/2fa/preparer')).secret;await api(baseSh,session.token,'POST','/moi/2fa/activer',{code:totp.codePourPas(secret,totp.pasActuel())});
 session=await api(baseSh,null,'POST','/connexion',{email:'raccordement.sh@example.invalid',mot_de_passe:mdp});
 const tokenSh=(await api(baseSh,null,'POST','/connexion/2fa',{jeton:session.jeton,code:totp.codePourPas(secret,totp.pasActuel()+1)})).token;
 const sources=[];
 for(const cible of ['demo','demo_abc']){
  const schema='support_'+cible;await pool.query(`CREATE SCHEMA ${schema}`);const p=new Pool({connectionString:url.href,options:'-c search_path='+schema});t.after(()=>p.end());
  await p.query(fs.readFileSync(require.resolve('../db/schema.sql'),'utf8'));await require('../db/configuration-base').configurationBase(p);
  const e=(await p.query("INSERT INTO etablissements(code,nom,config_id,module_actif,latitude,longitude) SELECT 'HY',$1,id,true,46,-71 FROM config_pays WHERE code='QC' RETURNING id",['Hôpital HY '+cible])).rows[0];
  const u=(await p.query("INSERT INTO utilisateurs(email,nom,role,mot_de_passe_hash,mdp_temporaire) VALUES($1,'Coordination fictive','coordonnateur',$2,false) RETURNING id",['hy.'+cible+'@example.invalid',await hacherAsync(mdp)])).rows[0];
  await p.query('INSERT INTO utilisateur_etablissements(utilisateur_id,etablissement_id) VALUES($1,$2)',[u.id,e.id]);
  const supportEnv={ARRIMO_SUPPORT_SH_URL:baseSh,ARRIMO_SUPPORT_CIBLE:cible,ARRIMO_SUPPORT_CLE:env['SH_SUPPORT_'+cible.toUpperCase()+'_CLE']};
  const serveur=await demarrerServeur(require('../src/app').creerApp(p,{supportEnv}));t.after(()=>new Promise(r=>serveur.close(r)));const base=`http://127.0.0.1:${serveur.address().port}`;
  Object.assign(env,{['SH_ENV_'+cible.toUpperCase()+'_URL']:base,['SH_ENV_'+cible.toUpperCase()+'_CLE']:process.env.SH_API_KEY,['SH_ENV_'+cible.toUpperCase()+'_PUBLIC']:'https://'+cible+'.example.invalid'});
  const token=(await api(base,null,'POST','/connexion',{email:'hy.'+cible+'@example.invalid',mot_de_passe:mdp})).token;
  sources.push({cible,p,e,base,token,supportEnv});
 }
 let ids=[],tickets=[];
 await t.test('un établissement sans liaison est annoncé indisponible, puis relié via SH sans création hospitalière',async()=>{
  for(const s of sources){
   assert.deepEqual(await api(s.base,s.token,'GET','/support/configuration?etablissement_id='+s.e.id),{disponible:false,motif:'non_raccorde'});
   const avant=(await s.p.query('SELECT count(*)::int n FROM etablissements')).rows[0].n;
   const h=await api(baseSh,tokenSh,'POST','/hopitaux',{nom:'Hôpital HY '+s.cible,code_etab:'HY',environnement:s.cible,pays_code:'CA'});ids.push(h.id);
   const lien=await api(baseSh,tokenSh,'POST',`/hopitaux/${h.id}/relier`,{});assert.equal(lien.cree,false);assert.equal((await s.p.query('SELECT count(*)::int n FROM etablissements')).rows[0].n,avant);
   assert.deepEqual(await api(s.base,s.token,'GET','/support/configuration?etablissement_id='+s.e.id),{disponible:true});
  }
  assert.notEqual(ids[0],ids[1]);
  assert.deepEqual((await pool.query("SELECT environnement FROM hopitaux WHERE code_etab='HY' ORDER BY environnement")).rows.map(h=>h.environnement),['demo','demo_abc']);
 });
 await t.test('tickets homonymes séparés par cible, identité client imposée, aucun accès croisé',async()=>{
  for(const s of sources)tickets.push(await api(s.base,s.token,'POST','/support/tickets',{etablissement_id:s.e.id,titre:'Demande '+s.cible,description:'Test de raccordement fictif',demandeur:'faux@example.invalid',environnement:s.cible==='demo'?'demo_abc':'demo'}));
  for(let i=0;i<sources.length;i++){
   const s=sources[i],liste=await api(s.base,s.token,'GET','/support/tickets?etablissement_id='+s.e.id);assert.deepEqual(liste.tickets.map(t=>t.id),[tickets[i].id]);
   await api(s.base,s.token,'GET',`/support/tickets/${tickets[1-i].id}?etablissement_id=${s.e.id}`,null,404);
   const row=(await pool.query('SELECT hopital_id,demandeur_client FROM sh_support_tickets WHERE id=$1',[tickets[i].id])).rows[0];assert.equal(row.hopital_id,ids[i]);assert.equal(row.demandeur_client,'hy.'+s.cible+'@example.invalid');
  }
 });
 await t.test('clés échangées ou réutilisées refusées, cible invalide non activable',async()=>{
  const wrong=await fetch(baseSh+'/api/portail-support/demo_abc/HY/tickets',{headers:{'X-Support-Key':env.SH_SUPPORT_DEMO_CLE}});assert.equal(wrong.status,401);
  const ancienne=env.SH_SUPPORT_DEMO_ABC_CLE;env.SH_SUPPORT_DEMO_ABC_CLE=env.SH_SUPPORT_DEMO_CLE;
  try{assert.equal((await fetch(baseSh+'/api/portail-support/demo/HY/tickets',{headers:{'X-Support-Key':env.SH_SUPPORT_DEMO_CLE}})).status,401);}finally{env.SH_SUPPORT_DEMO_ABC_CLE=ancienne;}
  const cfg=sources[0].supportEnv;cfg.ARRIMO_SUPPORT_CIBLE='production';try{assert.deepEqual(await api(sources[0].base,sources[0].token,'GET','/support/configuration?etablissement_id='+sources[0].e.id),{disponible:false});}finally{cfg.ARRIMO_SUPPORT_CIBLE='demo';}
  await api(sources[0].base,sources[0].token,'GET','/support/configuration?etablissement_id=999999',null,403);
 });
 await t.test('révocation du lien et panne du service affichées sans accès résiduel',async()=>{
  const s=sources[1];await pool.query('UPDATE hopitaux SET relie=false WHERE id=$1',[ids[1]]);
  assert.deepEqual(await api(s.base,s.token,'GET','/support/configuration?etablissement_id='+s.e.id),{disponible:false,motif:'non_raccorde'});
  await api(s.base,s.token,'GET',`/support/tickets/${tickets[1].id}?etablissement_id=${s.e.id}`,null,404);await pool.query('UPDATE hopitaux SET relie=true WHERE id=$1',[ids[1]]);
  const old=s.supportEnv.ARRIMO_SUPPORT_SH_URL;s.supportEnv.ARRIMO_SUPPORT_SH_URL='http://127.0.0.1:1';try{assert.deepEqual(await api(s.base,s.token,'GET','/support/configuration?etablissement_id='+s.e.id),{disponible:false,motif:'indisponible'});}finally{s.supportEnv.ARRIMO_SUPPORT_SH_URL=old;}
 });
 await t.test('navigateur connecté : création, réponse publique et traduction FR/EN',async()=>{
  const browser=await require('playwright').chromium.launch({headless:true});try{
   const s=sources[1],page=await browser.newPage({viewport:{width:390,height:844}}),erreurs=[];page.on('pageerror',e=>erreurs.push(e.message));
   await page.goto(s.base);await page.fill('#c-email','hy.demo_abc@example.invalid');await page.fill('#c-mdp',mdp);await page.click('#f-connexion button[type=submit]');await page.waitForSelector('body[data-pret="1"]');
   if(await page.locator('#b-premiers-pas-ok').isVisible())await page.click('#b-premiers-pas-ok');await allerOnglet(page,'params');await page.click('#v-params [data-param-nav="support"]');await page.waitForSelector('#support-creer',{state:'attached'});await page.click('#v-support summary');
   await page.fill('#sc-titre','Raccordement navigateur');await page.fill('#sc-description','Demande fictive du navigateur');await page.locator('#support-creer').evaluate(f=>f.requestSubmit());
   await page.locator('[data-support-ticket]',{hasText:'Raccordement navigateur'}).click();await page.waitForSelector('#sc-repondre');
   const created=(await pool.query("SELECT id,hopital_id FROM sh_support_tickets WHERE titre='Raccordement navigateur'")).rows[0];assert.equal(created.hopital_id,ids[1]);
   await api(baseSh,tokenSh,'POST',`/support/tickets/${created.id}/messages`,{message:'Réponse support publique',interne:false});
   await page.waitForFunction(()=>!enCours);await page.evaluate(()=>rafraichir());await page.waitForFunction(()=>document.querySelector('#v-support').textContent.includes('Réponse support publique'));
   await page.click('#b-menu');await page.selectOption('#langue-barre','en');await page.click('#b-menu');await page.waitForFunction(()=>document.querySelector('#v-support').textContent.includes('Support conversation'));
   assert.deepEqual(erreurs,[]);const out=path.resolve('.local/raccordement-support');fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'portail-abc-en.png'),fullPage:true});
  }finally{await browser.close();}
 });
});
