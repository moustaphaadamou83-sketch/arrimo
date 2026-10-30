'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const patients=require('../src/patients');const brouillons=require('../src/og-brouillons-patients');
const db={};const user={id:91,etabs:[7],gestionnaire:false};
function donnees(){return {prenom:'Awa',nom:'Diallo',date_naissance:'1980-01-02',reference_locale:''};}
test('OG brouillons patients : brouillon temporaire puis création après confirmation, rejouable sans doublon',async()=>{
  const avant=process.env.ARRIMO_ENV,ancienChercher=patients.semblables,ancienCreer=patients.creerPatient;process.env.ARRIMO_ENV='demo';brouillons._brouillons.clear();
  let creations=0;patients.semblables=async()=>[];patients.creerPatient=async(_db,_u,_etab,d)=>{creations++;return {id:501,reference:'P-00501',prenom:d.prenom,nom:d.nom};};
  try{const draft=await brouillons.creerBrouillon(db,user,7,donnees());assert.ok(draft.id);assert.equal(draft.cree,undefined);assert.equal(creations,0);
    const resultat=await brouillons.confirmerBrouillon(db,user,7,draft.id);assert.equal(resultat.cree,true);assert.equal(resultat.resultat.reference,'P-00501');
    const rejoue=await brouillons.confirmerBrouillon(db,user,7,draft.id);assert.equal(rejoue.resultat.reference,'P-00501');assert.equal(creations,1);
  }finally{patients.semblables=ancienChercher;patients.creerPatient=ancienCreer;brouillons._brouillons.clear();if(avant===undefined)delete process.env.ARRIMO_ENV;else process.env.ARRIMO_ENV=avant;}
});
test('OG brouillons patients : doublons exigent une deuxième confirmation explicite',async()=>{
  const avant=process.env.ARRIMO_ENV,ancienChercher=patients.semblables,ancienCreer=patients.creerPatient;process.env.ARRIMO_ENV='demo';brouillons._brouillons.clear();let creations=0;
  patients.semblables=async()=>[{reference:'P-00123'}];patients.creerPatient=async()=>{creations++;return {reference:'P-00502'};};
  try{const d=await brouillons.creerBrouillon(db,user,7,donnees());assert.deepEqual(d.doublons_possibles,['P-00123']);
    const stop=await brouillons.confirmerBrouillon(db,user,7,d.id);assert.equal(stop.confirmation_requise,true);assert.equal(creations,0);
    const ok=await brouillons.confirmerBrouillon(db,user,7,d.id,true);assert.equal(ok.cree,true);assert.equal(creations,1);
  }finally{patients.semblables=ancienChercher;patients.creerPatient=ancienCreer;brouillons._brouillons.clear();if(avant===undefined)delete process.env.ARRIMO_ENV;else process.env.ARRIMO_ENV=avant;}
});
test('OG brouillons patients : périmètre utilisateur, annulation et expiration',async()=>{
  const avant=process.env.ARRIMO_ENV,ancienChercher=patients.semblables;process.env.ARRIMO_ENV='demo';brouillons._brouillons.clear();patients.semblables=async()=>[];
  try{const d=await brouillons.creerBrouillon(db,user,7,donnees());await assert.rejects(()=>brouillons.confirmerBrouillon(db,user,8,d.id),e=>e.statut===403);
    assert.deepEqual(brouillons.annulerBrouillon(user,7,d.id),{annule:true});await assert.rejects(()=>brouillons.confirmerBrouillon(db,user,7,d.id),e=>e.statut===404);
    const d2=await brouillons.creerBrouillon(db,user,7,donnees());brouillons._brouillons.get(d2.id).expire=Date.now()-1;
    await assert.rejects(()=>brouillons.confirmerBrouillon(db,user,7,d2.id),e=>e.statut===410);
  }finally{patients.semblables=ancienChercher;brouillons._brouillons.clear();if(avant===undefined)delete process.env.ARRIMO_ENV;else process.env.ARRIMO_ENV=avant;}
});

test('OG brouillons patients : doublons apparus ou modifiés exigent une nouvelle revue',async()=>{
  const avant=process.env.ARRIMO_ENV,ancienChercher=patients.semblables,ancienCreer=patients.creerPatient;process.env.ARRIMO_ENV='demo';brouillons._brouillons.clear();let appels=0,creations=0;
  patients.semblables=async()=>[{reference:++appels===1?'P-01001':'P-01002'}];patients.creerPatient=async()=>{creations++;return {reference:'P-00503'};};
  try{const d=await brouillons.creerBrouillon(db,user,7,donnees());
    const actualise=await brouillons.confirmerBrouillon(db,user,7,d.id);assert.equal(actualise.confirmation_requise,true);assert.deepEqual(actualise.doublons_possibles,['P-01002']);assert.equal(creations,0);
    const confirme=await brouillons.confirmerBrouillon(db,user,7,d.id,true);assert.equal(confirme.cree,true);assert.equal(creations,1);
  }finally{patients.semblables=ancienChercher;patients.creerPatient=ancienCreer;brouillons._brouillons.clear();if(avant===undefined)delete process.env.ARRIMO_ENV;else process.env.ARRIMO_ENV=avant;}
});
test('OG brouillons patients : limite concurrente par personne et établissement',async()=>{
  const avant=process.env.ARRIMO_ENV,ancienChercher=patients.semblables;process.env.ARRIMO_ENV='demo';brouillons._brouillons.clear();patients.semblables=async()=>new Promise(r=>setTimeout(()=>r([]),10));
  try{const resultats=await Promise.allSettled(Array.from({length:11},()=>brouillons.creerBrouillon(db,user,7,donnees())));
    assert.equal(resultats.filter(x=>x.status==='fulfilled').length,10);assert.equal(resultats.filter(x=>x.status==='rejected'&&x.reason.statut===429).length,1);
  }finally{patients.semblables=ancienChercher;brouillons._brouillons.clear();if(avant===undefined)delete process.env.ARRIMO_ENV;else process.env.ARRIMO_ENV=avant;}
});
