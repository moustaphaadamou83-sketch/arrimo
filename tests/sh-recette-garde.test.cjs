'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {environnementTest,environnementAdministration,masquer}=require('../scripts/recette-sh-garde.cjs');
const {viderBaseSh}=require('../db/sh-vider');
const {lireRestrictions}=require('../scripts/diagnostic-recette-sh.cjs');
test('la recette navigateur ne peut pas hériter d’une URL de base externe',()=>{
  const original={PATH:'/usr/bin',DATABASE_URL:'postgres://externe/reelle',INTERFACE_DATABASE_URL:'postgres://externe/reelle',TEST_DATABASE_URL:'postgres://externe/reelle',SH_ACCES_TEST_DATABASE_URL:'postgres://externe/reelle'};
  const url='postgres://arrimo_sh@127.0.0.1/arrimo_sh_lot1_test_20261029_interface';
  const env=environnementTest(original,'TEST_DATABASE_URL',url);
  assert.deepEqual(env,{PATH:'/usr/bin',TEST_DATABASE_URL:url});
  assert.equal(original.INTERFACE_DATABASE_URL,'postgres://externe/reelle');
});
test('les noms de bases réelles et les serveurs distants sont refusés',()=>{
  for(const url of ['postgres://arrimo_sh@127.0.0.1/arrimo_sh','postgres://arrimo_sh@127.0.0.1/arrimo','postgres://arrimo_sh@externe/arrimo_sh_lot1_test_abc']){
    assert.throws(()=>environnementTest({},'TEST_DATABASE_URL',url),/Base fictive/);
  }
  assert.throws(()=>environnementTest({},'DATABASE_URL','postgres://arrimo_sh@127.0.0.1/arrimo_sh_lot1_test_abc'),/Variable/);
});
test('recette élargie : chaque suite reçoit seulement sa base dédiée, sans URL ni options PostgreSQL héritées',()=>{
  const {PREFIXES_BASE}=require('../scripts/recette-sh-garde.cjs');
  const original=Object.fromEntries(['DATABASE_URL',...Object.keys(PREFIXES_BASE)].map(k=>[k,'postgres://externe/reelle']));
  Object.assign(original,{PGHOST:'externe',PGSERVICE:'production',PGOPTIONS:'-c search_path=externe'});
  for(const [variable,prefixe]of Object.entries(PREFIXES_BASE)){
    const url=`postgres://arrimo_sh@127.0.0.1:55439/${prefixe}abc123`;
    assert.deepEqual(environnementTest(original,variable,url),{[variable]:url});
    assert.throws(()=>environnementTest(original,variable,url+'?host=externe'),/Base fictive/);
    assert.throws(()=>environnementTest(original,variable,'postgres://arrimo_sh@127.0.0.1/arrimo_demo_trio'),/Base fictive/);
  }
});
test('les journaux masquent le mot de passe encodé et décodé sans altérer les connexions sans mot de passe',()=>{
  const url='postgres://arrimo_sh:secret%21fictif@127.0.0.1/arrimo_sh_lot1_test_abc';
  const r=masquer(`Erreur ${url} secret!fictif secret%21fictif`,[url]);
  assert.ok(!r.includes('secret!fictif'));assert.ok(!r.includes('secret%21fictif'));assert.ok(!r.includes('postgres://'));
  assert.equal(masquer('texte normal',['postgres://arrimo_sh@127.0.0.1/arrimo_sh_lot1_test_abc']),'texte normal');
});
test('diagnostic Linux : rapporte les capacités nulles et les protections sans les modifier',()=>{
  assert.deepEqual(lireRestrictions('Name:\tnode\nCapEff:\t0000000000000000\nCapBnd:\t0000000000000000\nNoNewPrivs:\t1\nSeccomp:\t2\n'),{CapEff:'0000000000000000',CapBnd:'0000000000000000',NoNewPrivs:'1',Seccomp:'2'});
});
test('création de fixtures : les paramètres PostgreSQL hérités ne peuvent pas détourner createdb',()=>{
  const original={PATH:'/usr/bin',PGHOST:'serveur-externe',PGHOSTADDR:'203.0.113.10',PGDATABASE:'arrimo',PGSERVICE:'production',PGSERVICEFILE:'/privé/service',PGOPTIONS:'-c search_path=externe',PGPASSWORD:'fictif'};
  assert.deepEqual(environnementAdministration(original,'55439'),{PATH:'/usr/bin',PGHOST:'/var/run/postgresql',PGPORT:'55439',PGUSER:'postgres'});
  assert.equal(original.PGHOST,'serveur-externe');
  assert.throws(()=>environnementAdministration({},'5432 commande'),/Port/);
});
test('nettoyage SH : aucune suppression n’est envoyée pour une base réelle ou non identifiée',async()=>{
  for(const base of ['arrimo','arrimo_sh','arrimo_recette','postgres',null]){
    const appels=[];const db={query:async sql=>{appels.push(sql);return {rows:[{base}]};}};
    await assert.rejects(viderBaseSh(db),/Nettoyage SH refusé/);
    assert.deepEqual(appels,['SELECT current_database() AS base']);
  }
});
test('nettoyage SH : les noms des fixtures dédiées sont acceptés',async()=>{
  for(const base of ['arrimo_test','arrimo_dev_test','arrimo_sh_lot1_test_20261029_interface','arrimo_sh_ui_test_20261029']){
    let appels=0;await viderBaseSh({query:async()=>{appels++;return {rows:[{base}]};}});assert.equal(appels,2);
  }
});
