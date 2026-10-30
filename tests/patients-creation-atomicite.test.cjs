'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const patients=require('../src/patients');
const user={id:18,etabs:[7],gestionnaire:false};
function fixture({doublons=[]}={}){const appels=[];const db={async query(sql,args){appels.push({sql,args});
  if(sql.includes('SELECT id, reference, prenom'))return {rows:doublons};
  if(sql.includes('INSERT INTO patients'))return {rows:[{id:77,reference:'P-00077',prenom:'Awa',nom:'Diallo',date_naissance:'1980-01-02',parcours:'enregistre'}]};
  return {rows:[]};}};return {db,appels};}
test('création patient : verrou transactionnel avant détection du doublon et insertion',async()=>{
  const avant=process.env.ARRIMO_ENV;process.env.ARRIMO_ENV='demo';const f=fixture();
  try{const p=await patients.creerPatient(f.db,user,7,{prenom:'Awa',nom:'Diallo',date_naissance:'1980-01-02'});
    assert.equal(p.reference,'P-00077');const verrou=f.appels.findIndex(x=>x.sql.includes('pg_advisory_xact_lock'));const doublons=f.appels.findIndex(x=>x.sql.includes('SELECT id, reference, prenom'));const insertion=f.appels.findIndex(x=>x.sql.includes('INSERT INTO patients'));
    assert.ok(verrou>=0&&verrou<doublons&&doublons<insertion);assert.doesNotMatch(f.appels[verrou].args[0],/Awa|Diallo|1980-01-02/);
  }finally{if(avant===undefined)delete process.env.ARRIMO_ENV;else process.env.ARRIMO_ENV=avant;}
});
test('création patient : doublon découvert sous verrou bloque l’insertion sans confirmation',async()=>{
  const avant=process.env.ARRIMO_ENV;process.env.ARRIMO_ENV='demo';const f=fixture({doublons:[{reference:'P-00123'}]});
  try{await assert.rejects(()=>patients.creerPatient(f.db,user,7,{prenom:'Awa',nom:'Diallo',date_naissance:'1980-01-02'}),e=>e.status===409||e.statut===409);
    assert.equal(f.appels.some(x=>x.sql.includes('INSERT INTO patients')),false);
  }finally{if(avant===undefined)delete process.env.ARRIMO_ENV;else process.env.ARRIMO_ENV=avant;}
});
