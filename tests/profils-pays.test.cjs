'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {paysDuProfil,profilsAvecPays,choisirProfil,verifierEtablissementPays,verifierChangementPays,lireProfilCible,lireProfilsCibles}=require('../src/profils-pays');
const {creerEtablissement}=require('../src/admin');
const profils=[{id:1,code:'QC',nom:'Québec',pays_code:'CA'},{id:2,code:'TG',nom:'Togo',pays_code:'TG'},{id:3,code:'NE',nom:'Niger',pays_code:'NE'}];
const options={env:{ARRIMO_PROFILS_PAYS:'{"TG":"TG","NE":"NE"}'}};
test('production : choix explicite parmi plusieurs profils et profil existant immuable',()=>{
  const {choisirProfilProduction}=require('../src/profils-pays');
  const disponibles=[profils[0],{id:4,code:'CA-TEST',nom:'Autre profil',pays_code:'CA'},profils[1]];
  const h={code_etab:'TEST-CA',nom:'Test Canada',pays_code:'CA'};
  assert.throws(()=>choisirProfilProduction(disponibles,h),{code:'profil_pays_ambigu'});
  assert.equal(choisirProfilProduction(disponibles,h,null,4).id,4);
  assert.throws(()=>choisirProfilProduction(disponibles,h,null,2),{code:'profil_pays_absent'});
  const existant={code:h.code_etab,nom:h.nom,pays_code:'CA',config_id:1};
  assert.equal(choisirProfilProduction(disponibles,h,existant).id,1);
  assert.throws(()=>choisirProfilProduction(disponibles,h,{...existant,config_id:undefined}),{code:'profil_pays_incompatible'});
  assert.throws(()=>choisirProfilProduction(disponibles,h,existant,4),{code:'profil_pays_incompatible'});
});
test('formulaire Go Live : choix requis, identifiant transmis et profils inconnus refusés',async()=>{
  for(const disponibles of [[profils[0]],[profils[0],{id:4,code:'CA-TEST',nom:'Autre profil'}],[]]){
    const select={value:''};
    const ctx={api:async(m,p)=>{assert.equal(m,'GET');assert.match(p,/\/golive\/profils-pays$/);return disponibles;},esc:x=>String(x),$:()=>select};
    vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../public-sh/profils-pays.js'),'utf8'),ctx);
    if(!disponibles.length){await assert.rejects(ctx.choixProfilProduction({id:5}));continue;}
    const formulaire=await ctx.choixProfilProduction({id:5});
    assert.equal(formulaire.html.includes('<option value="">'),disponibles.length>1);
    assert.throws(()=>formulaire.lire());select.value='999';assert.throws(()=>formulaire.lire());
    select.value=String(disponibles.at(-1).id);assert.equal(formulaire.lire().config_id,disponibles.at(-1).id);
  }
});
test('profil pays : sélectionner le pays demandé, même si le profil canadien vient en premier',()=>{
  assert.equal(paysDuProfil(profils[0]),'CA');assert.equal(paysDuProfil({code:'QC-NORD'}),null);
  assert.equal(paysDuProfil({code:'NE'}),null);
  assert.equal(choisirProfil(profils,{pays_code:'TG'}).id,2);
  assert.equal(choisirProfil(profils,{pays_code:' ne '}).id,3);
  assert.equal(choisirProfil([profils[0]],{}).id,1);
});
test('profil pays : refuser absence, ambiguïté, identifiant étranger et pays non renseigné',()=>{
  assert.throws(()=>choisirProfil(profils,{pays_code:'FR'}),{code:'profil_pays_absent',statut:409});
  assert.throws(()=>choisirProfil(profils,{}),{code:'profil_pays_ambigu'});
  assert.throws(()=>choisirProfil(profils,{pays_code:'TG',config_id:1}),{code:'profil_pays_absent'});
  assert.throws(()=>choisirProfil(profils,{pays_code:'ZZ'}),{code:'profil_pays_invalide'});
  assert.throws(()=>choisirProfil(profils,{}, {exigerPays:true}),{code:'profil_pays_requis'});
  const memePays=[profils[0],{id:4,code:'CA',nom:'Canada',pays_code:'CA'}];
  assert.throws(()=>choisirProfil(memePays,{pays_code:'CA'}),{code:'profil_pays_ambigu'});
  assert.equal(choisirProfil(memePays,{pays_code:'CA',config_id:4}).id,4);
});
test('correspondance : ne pas deviner un pays d’après un code de profil, seule une affectation explicite est utilisée',()=>{
  const internes=[{id:1,code:'QC'},{id:2,code:'NE'},{id:3,code:'REGION-NORD'}];
  assert.deepEqual(profilsAvecPays(internes,{}).map(p=>p.pays_code),['CA',null,null]);
  assert.deepEqual(profilsAvecPays(internes,{ARRIMO_PROFILS_PAYS:'{"NE":"US","REGION-NORD":"TG"}'}).map(p=>p.pays_code),['CA','US','TG']);
});
test('correspondance mal formée : refus sans afficher le contenu de la configuration',()=>{
  for(const valeur of ['secret-fictif','[]','{"QC":"TG"}','{"NE":"ZZ"}']){
    assert.throws(()=>profilsAvecPays(profils,{ARRIMO_PROFILS_PAYS:valeur}),e=>e.code==='profil_pays_correspondance_invalide'&&!e.message.includes(valeur));
  }
});
function fixture(){
  const appels=[];let connexions=0;
  const query=async(sql,args)=>{
    appels.push({sql,args});
    // Lecture des profils (la requête exclut aussi les configurations dérivées « -CHSLD ») : la forme exacte du SQL n'est pas l'objet du test
    if(/^SELECT .* FROM config_pays\b/.test(sql))return {rows:profils};
    if(sql.startsWith('INSERT INTO etablissements'))return {rows:[{id:42,code:args[0],nom:args[1]}]};
    return {rows:[]};
  };
  return {appels,get connexions(){return connexions;},pool:{query,connect:async()=>{connexions++;return {query,release(){}};}}};
}
const hopital={code:'TEST-TG',nom:'Hôpital Test',pays_code:'TG',latitude:6.1,longitude:1.2};
test('fonction de création : config_id choisi et journal transmis (base simulée)',async()=>{
  const f=fixture();let journal=0;
  const r=await creerEtablissement(f.pool,hopital,async()=>{journal++;},options);
  assert.equal(r.config_id,2);assert.equal(r.configuration_code,'TG');
  assert.equal(f.appels.find(a=>a.sql.startsWith('INSERT INTO etablissements')).args[6],2);
  assert.equal(journal,1);assert.ok(f.appels.some(a=>a.sql==='COMMIT'));
});
test('profil incompatible : aucun INSERT ni transaction de création',async()=>{
  const f=fixture();await assert.rejects(creerEtablissement(f.pool,{...hopital,config_id:1},async()=>{},options),{statut:409});
  assert.equal(f.connexions,0);assert.ok(f.appels.every(a=>a.sql.startsWith('SELECT')));
});
test('création : une panne de journal arrête la transaction',async()=>{
  const f=fixture();await assert.rejects(creerEtablissement(f.pool,hopital,async()=>{throw new Error('journal fictif indisponible');},options),/journal fictif/);
  assert.ok(f.appels.some(a=>a.sql==='ROLLBACK'));assert.ok(!f.appels.some(a=>a.sql==='COMMIT'));
});
test('établissement existant : vérifier identité et pays avant de le relier',()=>{
  verifierEtablissementPays({code:'TEST-TG',nom:hopital.nom,configuration_code:'TG',pays_code:'TG'},{...hopital,code_etab:'TEST-TG'});
  assert.throws(()=>verifierEtablissementPays({code:'TEST-TG',nom:hopital.nom,configuration_code:'QC'},{...hopital,code_etab:'TEST-TG'}),{code:'profil_pays_incompatible'});
  assert.throws(()=>verifierEtablissementPays({code:'TEST-TG',nom:'Autre établissement',configuration_code:'TG'},{...hopital,code_etab:'TEST-TG'}),{code:'profil_etablissement_incompatible'});
  verifierEtablissementPays({code:'TEST-TG',nom:'Ancien nom',configuration_code:'TG',pays_code:'TG'},{...hopital,code_etab:'TEST-TG',relie:true});
});
test('pays d’un dossier relié : pas de réaffectation silencieuse, édition avant liaison conservée',()=>{
  assert.throws(()=>verifierChangementPays({relie:true,pays_code:'CA'},{pays_code:'TG'}),{code:'profil_pays_changement_interdit'});
  assert.throws(()=>verifierChangementPays({relie:false,organisation_id:7,pays_code:'CA'},{pays_code:'TG'}),{code:'profil_pays_changement_interdit'});
  verifierChangementPays({relie:true,pays_code:'CA'},{pays_code:'CA'});
  verifierChangementPays({relie:false,pays_code:'CA'},{pays_code:'TG'});
});
test('cible : une ancienne API sans sélection de pays est refusée, les profils des autres pays sont filtrés',async()=>{
  const calls=[];const appeler=async(...args)=>{calls.push(args);return {selectionPays:true,profilsPays:profils};};
  assert.deepEqual(await lireProfilsCibles(appeler,{},hopital),[profils[1]]);
  assert.equal((await lireProfilCible(appeler,{},hopital)).id,2);
  assert.ok(calls.every(c=>c[1]==='GET'));
  await assert.rejects(lireProfilCible(async()=>({}),{},hopital),{code:'profil_pays_verification_indisponible'});
});
test('interface de liaison : aucun choix implicite parmi plusieurs profils, choix transmis à l’API',async()=>{
  const posts=[],erreurs=[],choix={value:''};let modal;
  const contexte={api:async(m,p,b)=>{if(m==='GET')return [profils[0],{id:4,code:'CA',nom:'Canada'}];posts.push(b);return {cree:true};},
    agir:async(b,fn)=>fn(),modale:(titre,html,actions)=>{modal={html,actions};},esc:x=>String(x),$:()=>choix,toast:(s,e)=>{if(e)erreurs.push(s);}};
  vm.createContext(contexte);vm.runInContext(fs.readFileSync(require.resolve('../public-sh/profils-pays.js'),'utf8'),contexte);
  await contexte.relierHopitalAvecProfil({id:5},{isConnected:true});assert.equal(posts.length,0);
  const action=modal.actions.find(a=>a.pri);assert.equal(await action.run(),false);assert.equal(posts.length,0);
  choix.value='4';assert.equal(await action.run(),true);assert.equal(posts[0].config_id,4);assert.equal(erreurs.length,1);
});
test('formulaire Arrimo : profil explicite si plusieurs choix, conservation du parcours à profil unique',async()=>{
  const source=fs.readFileSync(require.resolve('../public/app.js'),'utf8');
  const fonctions=source.slice(source.indexOf('function formNouvelEtab()'),source.indexOf('const TYPES_IMPORT =',source.indexOf('function formNouvelEtab()')));
  for(const disponibles of [[profils[0]],[profils[0],profils[1]]]){
    const elements=new Map(),posts=[];
    const element=s=>{if(!elements.has(s))elements.set(s,{value:s==='#ne-lat'?'6.1':s==='#ne-lon'?'1.2':'',disabled:false});return elements.get(s);};
    const contexte={$:element,esc:x=>String(x),t:x=>x,nb:x=>String(x),etat:{ctx:10},ecrire:()=>{},majSelecteurCtx:()=>{},toast:()=>{},agir:async(b,fn)=>fn(),
      api:async(m,p,b)=>{if(p==='/admin/config')return disponibles;if(m==='POST'){posts.push(b);return {id:42};}return {};}};
    vm.createContext(contexte);vm.runInContext(fonctions,contexte);
    assert.match(contexte.formNouvelEtab(),/ne-profil/);await contexte.brancherNouvelEtab();
    if(disponibles.length>1){assert.equal(element('#ne-profil').value,'');await assert.rejects(element('#b-ne-creer').onclick());assert.equal(posts.length,0);element('#ne-profil').value='2';}
    else assert.equal(element('#ne-profil').value,'1');
    await element('#b-ne-creer').onclick();assert.equal(posts[0].config_id,disponibles.at(-1).id);
  }
});
test('API de service : clé obligatoire et pays obligatoire avant toute requête de création',async()=>{
  const avant=process.env.SH_API_KEY;process.env.SH_API_KEY='cle-profils-fictive';
  try{
    const routes=new Map(),api=Object.fromEntries(['get','post','put'].map(m=>[m,(p,fn)=>routes.set(`${m} ${p}`,fn)]));
    let lectures=0;require('../src/sh-api').brancherSh(api,{query:async()=>{lectures++;throw new Error('Aucun SQL attendu');}},fn=>fn);
    await assert.rejects(routes.get('post /sh/etablissements')({get:()=> 'incorrecte',body:hopital}),{statut:401});
    await assert.rejects(routes.get('post /sh/etablissements')({get:()=>process.env.SH_API_KEY,body:{code:'TEST'}}),{code:'profil_pays_requis'});
    assert.equal(lectures,0);
  }finally{if(avant===undefined)delete process.env.SH_API_KEY;else process.env.SH_API_KEY=avant;}
});
