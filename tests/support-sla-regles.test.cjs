'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{reglesPropres}=require('../src/sh/support-sla');
const regles=()=>Object.fromEntries(['basse','normale','haute','urgente'].map(p=>[p,{prise_en_charge_minutes:30,resolution_minutes:120,escalade_apres_minutes:0}]));
test('SLA : quatre priorités explicites, copie indépendante et limites inclusives',()=>{const r=regles();const p=reglesPropres(r);assert.deepEqual(p,r);assert.notEqual(p.normale,r.normale);r.normale.prise_en_charge_minutes=1;r.normale.resolution_minutes=525600;r.normale.escalade_apres_minutes=43200;assert.doesNotThrow(()=>reglesPropres(r));});
test('SLA : pas de conversion silencieuse de chaînes, décimales, booléens ou valeurs hors limites',()=>{
 for(const v of ['30',1.5,true,-1,0,525601,null,undefined]){const r=regles();r.normale.prise_en_charge_minutes=v;assert.throws(()=>reglesPropres(r),e=>e.statut===400);}
});
test('SLA : résolution avant prise en charge, règle absente ou clé inconnue refusées',()=>{
 for(const modifier of [r=>r.normale.resolution_minutes=5,r=>delete r.basse,r=>r.inconnue=r.basse,r=>r.normale.secret=1]){const r=regles();modifier(r);assert.throws(()=>reglesPropres(r),e=>e.statut===400);}
});
