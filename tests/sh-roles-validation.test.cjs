'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {brancher}=require('../src/sh/roles-perimetres');
const {exigerTachesCritiquesTerminees}=require('../src/sh/projets');

test('activation : une tâche critique ouverte bloque, un projet sans tâche critique ouverte passe ce contrôle',async()=>{
  for(const n of [0,1,3]){
    const c={query:async(sql,args)=>{assert.deepEqual(args,[42]);return {rows:[{n}]};}};
    if(n)await assert.rejects(exigerTachesCritiquesTerminees(c,42),{statut:409});
    else await exigerTachesCritiquesTerminees(c,42);
  }
});

function fixture(){
  const routes=new Map(),requetes=[];
  const api=Object.fromEntries(['get','post','put'].map(m=>[m,(p,fn)=>routes.set(`${m} ${p}`,fn)]));
  const query=async(sql,args)=>{
    requetes.push({sql,args});
    if(sql.startsWith('SELECT id FROM sh_utilisateurs'))return {rows:[{id:2}],rowCount:1};
    if(sql.startsWith('INSERT INTO sh_roles_personnalises'))return {rows:[{id:3,nom:args[0],base_role:args[1],permissions:args[2],actif:args[3]}],rowCount:1};
    return {rows:[],rowCount:0};
  };
  brancher(api,{query,connect:async()=>({query,release(){}})},fn=>fn,async()=>{});
  return {routes,requetes,req:body=>({body,u:{id:1},params:{id:'2'}})};
}
test('rôle créé désactivé : la réponse conserve le choix explicite',async()=>{
  const f=fixture();
  const role=await f.routes.get('post /roles-personnalises')(f.req({nom:'Support limité',base_role:'support',permissions:['GET /projets'],actif:false}));
  assert.equal(role.actif,false);
  assert.ok(f.requetes.some(q=>q.sql==='COMMIT'));
});
test('rôle invalide : booléen texte, permission héritée ou permission administrative refusés sans écriture',async()=>{
  for(const invalide of [{actif:'false'},{permissions:['toString']},{permissions:['__proto__']},{permissions:['POST /equipe']},{permissions:[null]}]){
    const f=fixture();
    await assert.rejects(f.routes.get('post /roles-personnalises')(f.req({nom:'Support limité',base_role:'support',permissions:[],...invalide})),{statut:400});
    assert.equal(f.requetes.length,0);
  }
});
test('périmètre pays absent ou invalide : refus contrôlé et annulation sans insertion',async()=>{
  for(const pays_code of [undefined,null,'','CAN','1A']){
    const f=fixture();
    await assert.rejects(f.routes.get('post /equipe/:id/affectations')(f.req({type:'pays',pays_code})),{statut:400});
    assert.ok(f.requetes.some(q=>q.sql==='ROLLBACK'));
    assert.ok(!f.requetes.some(q=>q.sql.startsWith('INSERT')));
  }
});
