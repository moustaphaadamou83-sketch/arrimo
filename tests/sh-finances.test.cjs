'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {pipelineParDevise}=require('../public-sh/finances');
const fs=require('node:fs'),vm=require('node:vm');
test('pipeline : deux montants du même statut dans deux devises restent distincts',()=>{
  const source=[{statut:'qualification',devise:'USD',n:2,valeur:'100.00',ponderee:'50.00'},{statut:'qualification',devise:'CAD',n:1,valeur:'200.00',ponderee:'100.00'}];
  const result=pipelineParDevise(source,['qualification','gagnee']);
  assert.deepEqual(result.map(g=>g.devise),['CAD','USD']);
  assert.equal(result[0].lignes[0].valeur,'200.00');assert.equal(result[1].lignes[0].valeur,'100.00');
  assert.equal(result[0].lignes[1].devise,'CAD');assert.equal(result[1].lignes[1].valeur,0);
  assert.equal(source.length,2);
});
test('pipeline : aucun montant ou CAD inventé en l’absence de données ou de devise',()=>{
  assert.deepEqual(pipelineParDevise([],['qualification']),[]);
  for(const devise of [null,undefined,'','CA'])assert.throws(()=>pipelineParDevise([{statut:'qualification',devise,valeur:100}],['qualification']),/Devise/);
});
test('écran rapports : affiche les deux devises et ne perd pas le deuxième montant du même statut',async()=>{
  const contexte={Intl,L:'en-CA',window:{ArrimoShFinances:require('../public-sh/finances')},etat:{moi:{utilisateur:{role:'administration'}}},
    $:()=>({}),esc:x=>String(x??''),quand:()=>'',setInterval:()=>{},
    api:async()=>({pipeline:[{statut:'qualification',devise:'CAD',n:1,valeur:200},{statut:'qualification',devise:'USD',n:1,valeur:100}],contrats:{actifs:0,en_cours:0,a_renouveler:0},relances_en_retard:0,taux_conversion:null})};
  vm.createContext(contexte);vm.runInContext(fs.readFileSync(require.resolve('../public-sh/erp.js'),'utf8'),contexte);
  const v={innerHTML:'',querySelectorAll:()=>[]};await contexte.vueRapports(v);
  assert.match(v.innerHTML,/<h4>CAD<\/h4>/);assert.match(v.innerHTML,/<h4>USD<\/h4>/);
  assert.ok(v.innerHTML.includes(new Intl.NumberFormat('en-CA',{style:'currency',currency:'USD'}).format(100)));
  assert.ok(v.innerHTML.includes(new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(200)));
});
test('affichage financier : les préférences CLDR ne masquent pas les subdivisions monétaires',()=>{
  const contexte={Intl,L:'en-CA',window:{ArrimoShFinances:require('../public-sh/finances')},$:()=>({}),setInterval:()=>{}};
  vm.createContext(contexte);vm.runInContext(fs.readFileSync(require.resolve('../public-sh/erp.js'),'utf8'),contexte);
  assert.match(vm.runInContext("argent(1.25,'COP')",contexte),/1\.25/);
  assert.doesNotMatch(vm.runInContext("argent(125,'XOF')",contexte),/\.00/);
  assert.match(require('../src/sh/pdf-erp').argent(1.25,'COP'),/1,25/);
});
