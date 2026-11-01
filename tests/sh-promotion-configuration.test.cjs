'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {configurationPromouvable,lireConfiguration,promouvoirConfiguration}=require('../src/sh/promotion-configuration');
const source={modules:{nsa:false,national:false},vocation:'pediatrique'};
test('promotion : conserver les modules désactivés et la vocation, sans donnée opérationnelle ni secret',()=>{
  const r=configurationPromouvable({...source,patients:['fictif'],referentiel_priorites:{categories:['test']},secret:'secret-fictif'});
  assert.deepEqual(r,{vocation:'pediatrique',modules:{urgence:true,nsa:false,nettoyage:true,national:false}});
  assert.equal(JSON.stringify(r).includes('secret'),false);assert.equal(JSON.stringify(r).includes('patients'),false);
});
test('promotion : bloquer les paramètres non pris en charge au lieu de les perdre silencieusement',()=>{
  for(const invalide of [null,{...source,modules:[]},{...source,modules:{inconnu:false}},{...source,modules:{nsa:'false'}},{...source,vocation:'inconnue'}])assert.throws(()=>configurationPromouvable(invalide),{statut:409});
});
test('lecture de préparation : lecture seule et code établissement encodé',async()=>{
  const appels=[];
  await lireConfiguration(async(...args)=>{appels.push(args);return source;},{code:'recette'},'A/B');
  assert.deepEqual(appels,[[{code:'recette'},'GET','/sh/etablissements/A%2FB/configuration-operationnelle']]);
});
test('promotion : mise à jour avec la version cible et seulement les paramètres autorisés',async()=>{
  const appels=[];const cible={code:'production'};
  const r=await promouvoirConfiguration(async(...args)=>{
    appels.push(args);return args[1]==='GET'?{modules:{extension_cible:{a:1}},vocation:'general',version:'version-cible'}:{ok:true};
  },cible,'TEST',source,'admin@example.invalid');
  assert.equal(r.modifie,true);assert.equal(appels.length,2);
  assert.deepEqual(appels[1],[cible,'PUT','/sh/etablissements/TEST/configuration-operationnelle',{
    vocation:'pediatrique',modules:{urgence:true,nsa:false,nettoyage:true,national:false},version:'version-cible',par:'admin@example.invalid'}]);
});
test('reprise : aucune écriture lorsque les paramètres cible correspondent déjà',async()=>{
  const appels=[];
  const r=await promouvoirConfiguration(async(...args)=>{appels.push(args);return {...source,modules:{...source.modules,extension_cible:false}};},{code:'production'},'TEST',source,'admin');
  assert.equal(r.modifie,false);assert.equal(appels.length,1);
});
test('promotion : une version absente ou un conflit cible arrête sans nouvelle tentative aveugle',async()=>{
  const appels=[];
  await assert.rejects(promouvoirConfiguration(async(...args)=>{appels.push(args);return {modules:{},vocation:'general'};},{},'TEST',source,'admin'),{statut:409});
  assert.equal(appels.length,1);
  let tentatives=0;
  await assert.rejects(promouvoirConfiguration(async(c,m)=>{tentatives++;if(m==='GET')return {modules:{},vocation:'general',version:'avant'};throw Object.assign(new Error('conflit'),{statut:409});},{},'TEST',source,'admin'),{statut:409});
  assert.equal(tentatives,2);
});
test('Liaison CHSLD : transportée si la source la déclare, jamais vers une cible plus ancienne qui ne la connaît pas',async()=>{
  const recente={modules:{nsa:false,liaison_chsld:false},vocation:'general',modules_modifiables:['urgence','nsa','nettoyage','national','liaison_chsld']};
  const lue=configurationPromouvable(recente);
  assert.deepEqual(lue.modules,{urgence:true,nsa:false,nettoyage:true,national:true,liaison_chsld:false});
  assert.deepEqual(configurationPromouvable({modules:{},vocation:'general'}).modules,{urgence:true,nsa:true,nettoyage:true,national:true},'source ancienne : quatre drapeaux');
  for(const [cible,attendu] of [[{modules:{},vocation:'general',version:'v'},['urgence','nsa','nettoyage','national']],
    [{modules:{},vocation:'general',version:'v',modules_modifiables:recente.modules_modifiables},['urgence','nsa','nettoyage','national','liaison_chsld']]]){
    const appels=[];await promouvoirConfiguration(async(...a)=>{appels.push(a);return a[1]==='GET'?cible:{ok:true};},{},'T',lue,'admin');
    assert.deepEqual(Object.keys(appels[1][3].modules),attendu);
  }
});
