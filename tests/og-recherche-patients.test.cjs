'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const og=require('../src/og-recherche-patients');

function patient(id,prenom,nom,reference,dn='1980-01-02') {
  return {id,prenom,nom,reference,reference_locale:null,date_naissance:dn,parcours:'hospitalise',unite:'Médecine',chambre:'204',lit:'MED-204A',civiere:null};
}
function fauxPool(lignes=[]) {
  const appels=[];
  return {appels,async query(sql,args){appels.push({sql,args});
    if(sql.startsWith('SELECT e.*')) return {rows:[{id:args[0],nom:'Hôpital test',actif:true,module_actif:true}]};
    if(sql.startsWith('SELECT p.id')) return {rows:lignes};
    if(sql.startsWith('SELECT id,reference,reference_locale')) return {rows:lignes.filter(x=>x.id===args[0]&&args[1]===7)};
    if(sql.startsWith('INSERT INTO journal')) return {rows:[]};
    if(sql.startsWith('SELECT l.code')) return {rows:[]};
    if(sql.startsWith('SELECT code,etat')) return {rows:[]};
    if(sql.startsWith('SELECT id,statut,cree_le,priorite')) return {rows:[]};
    if(sql.startsWith('SELECT id,numero,statut,patient_ref')) return {rows:[]};
    if(sql.startsWith('SELECT date,message,lu FROM notifications')) return {rows:[]};
    if(sql.startsWith('SELECT date,action')) return {rows:[]};
    throw new Error(`requête non prévue: ${sql}`);
  }};
}
const u={id:9,etabs:[7],role:'infirmier'};
test('recherche OG : accents, faute de frappe, nom partiel et référence exacte',async()=>{
  process.env.ARRIMO_ENV='demo';
  const pool=fauxPool([patient(1,'Jean','Dupont','P-01001'),patient(2,'Jeanne','Dubois','P-01002')]);
  assert.equal((await og.rechercher(pool,u,7,'Jéan Duppont')).resultats[0].reference,'P-01001');
  assert.equal((await og.rechercher(pool,u,7,'Dupo')).resultats[0].reference,'P-01001');
  assert.equal((await og.rechercher(pool,u,7,'P-01002')).resultats[0].reference,'P-01002');
  assert.ok(pool.appels.filter(x=>x.sql.startsWith('SELECT p.id')).every(x=>x.sql.includes('p.etablissement_id=$1')));
  assert.ok(pool.appels.some(x=>x.sql.startsWith('INSERT INTO journal')&&x.args[3]==='Recherche patient OG'));
});
test('recherche OG : homonymes présentés ensemble sans sélection automatique; date en filtre secondaire',async()=>{
  process.env.ARRIMO_ENV='demo';
  const pool=fauxPool([patient(1,'Jean','Dupont','P-01001'),patient(2,'Jean','Dupont','P-01009','1970-05-06')]);
  const homonymes=await og.rechercher(pool,u,7,'Jean Dupont');
  assert.equal(homonymes.resultats.length,2);assert.equal(homonymes.ambigue,true);
  assert.ok(homonymes.resultats.every(x=>!('date_naissance'in x)));
  assert.deepEqual((await og.rechercher(pool,u,7,'1970-05-06')).resultats.map(x=>x.id),[2]);
  assert.deepEqual((await og.rechercher(pool,u,7,'Jean Dupont 1970-05-06')).resultats.map(x=>x.id),[2]);
});
test('recherche OG : identifiants proches ne sont pas rapprochés et le contexte doit être accessible',async()=>{
  process.env.ARRIMO_ENV='demo';
  assert.equal((await og.rechercher(fauxPool([patient(1,'Jean','Dupont','P-43267')]),u,7,'P-43266')).resultats.length,0);
  let appelle=false;const p={query:async()=>{appelle=true;return {rows:[]};}};
  await assert.rejects(og.rechercher(p,{id:9,etabs:[8]},7,'Jean Dupont'),e=>e.statut===403);
  assert.equal(appelle,false);
});
test('fiche OG : relecture limitée à l’hôpital autorisé et absence de dossier ailleurs',async()=>{
  process.env.ARRIMO_ENV='demo';
  const pool=fauxPool([patient(1,'Jean','Dupont','P-01001')]);
  const fiche=await og.consulter(pool,u,7,1);
  assert.equal(fiche.patient.reference,'P-01001');
  assert.ok(pool.appels.every(x=>!x.args || !x.args.includes(8)));
  await assert.rejects(og.consulter(pool,u,8,1),e=>e.statut===403);
  const autre=fauxPool([patient(1,'Jean','Dupont','P-01001')]);
  await assert.rejects(og.consulter(autre,u,7,2),e=>e.statut===404);
});
