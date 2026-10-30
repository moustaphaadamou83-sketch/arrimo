'use strict';
/** Décision du 30 oct. 2026 : identités fictives dans OG en démo et recette seulement ; refus prouvé ailleurs. */
const test=require('node:test');
const assert=require('node:assert/strict');
const recherche=require('../src/og-recherche-patients');
const brouillons=require('../src/og-brouillons-patients');
const patients=require('../src/patients');

const utilisateur={id:5,role:'coordonnateur',langue:'fr',etabs:[1],gestionnaire:false};
const poolInterdit={query:async()=>{throw new Error('Aucune requête ne doit partir hors démo et recette.');}};
function sous(env,fn){return async()=>{const a=process.env.ARRIMO_ENV,f=process.env.ARRIMO_PATIENTS_FICTIFS;process.env.ARRIMO_ENV=env;delete process.env.ARRIMO_PATIENTS_FICTIFS;
  try{await fn();}finally{if(a===undefined)delete process.env.ARRIMO_ENV;else process.env.ARRIMO_ENV=a;if(f===undefined)delete process.env.ARRIMO_PATIENTS_FICTIFS;else process.env.ARRIMO_PATIENTS_FICTIFS=f;}};}

for(const env of ['production','validation']){
  test(`${env} : recherche, fiche et brouillon patient refusés avant toute requête`,sous(env,async()=>{
    await assert.rejects(recherche.rechercher(poolInterdit,utilisateur,1,'jean dupont'),e=>e.statut===403);
    await assert.rejects(recherche.consulter(poolInterdit,utilisateur,1,10),e=>e.statut===403);
    await assert.rejects(brouillons.creerBrouillon(poolInterdit,utilisateur,1,{prenom:'Jean',nom:'Dupont',date_naissance:'1980-01-02'}),e=>e.statut===403);
    assert.throws(()=>patients.exigerFictifs(),e=>e.statut===403);
  }));
  test(`${env} : OG répond sans erreur à « cherche Jean Dupont » et ne cherche pas`,sous(env,async()=>{
    const og=require('../src/og-outils');
    const r=await og.repondre(poolInterdit,utilisateur,1,'OG, cherche Jean Dupont').catch(e=>({erreur:e.message}));
    assert.ok(!r?.erreur,`aucune erreur attendue : ${r?.erreur}`);
    assert.match(r.reponse,/n’est pas disponible dans cet environnement/);
    assert.equal(r.patients,undefined,'aucun dossier renvoyé');
  }));
}
test('démo : le module est actif (le refus ne bloque pas la démonstration)',sous('demo',async()=>{
  assert.doesNotThrow(()=>patients.exigerFictifs());
}));
