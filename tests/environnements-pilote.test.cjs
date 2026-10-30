'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const env=require('../src/environnement');
test('pilote : domaine distinct, cible explicite et aucun repli automatique vers la recette ou la production',()=>{
  const variables=['ARRIMO_ENV','ARRIMO_DOMAINE','ARRIMO_URL','ARRIMO_PATIENTS_FICTIFS','ARRIMO_OG_VOCAL_FICTIF'];
  const avant=Object.fromEntries(variables.map(k=>[k,process.env[k]]));
  try{
    process.env.ARRIMO_ENV='pilote';process.env.ARRIMO_DOMAINE='example.invalid';delete process.env.ARRIMO_URL;
    assert.equal(env.environnement(),'pilote');assert.equal(env.urlPublique(),'https://pilote.example.invalid');assert.equal(env.estDemo(),false);assert.equal(env.estProduction(),false);
    const {cibles}=require('../src/sh/cibles');
    assert.deepEqual(cibles({SH_ENV_RECETTE_URL:'http://127.0.0.1:1',SH_ENV_RECETTE_CLE:'fixture'}).map(c=>c.code),['recette']);
    assert.equal(cibles({SH_ENV_PILOTE_URL:'http://127.0.0.1:2',SH_ENV_PILOTE_CLE:'fixture'})[0].code,'pilote');
    assert.throws(()=>cibles({SH_ENV_PILOTE_URL:'http://127.0.0.1:2/',SH_ENV_PILOTE_CLE:'fixture',SH_ENV_PRODUCTION_URL:'http://127.0.0.1:2',SH_ENV_PRODUCTION_CLE:'fixture'}),e=>e.code==='pilote_non_isole');
    for(const mode of ['pilote','recette','production'])for(const fictif of ['0','1'])for(const vocal of ['0','1']){
      process.env.ARRIMO_ENV=mode;process.env.ARRIMO_PATIENTS_FICTIFS=fictif;process.env.ARRIMO_OG_VOCAL_FICTIF=vocal;
      assert.equal(env.vocalFictifAutorise(),mode!=='production'&&fictif==='1'&&vocal==='1',`${mode}/${fictif}/${vocal}`);
    }
    process.env.ARRIMO_ENV='pilote';delete process.env.ARRIMO_PATIENTS_FICTIFS;
    assert.throws(()=>require('../src/formation').exigerRecette(),e=>e.code==='formation_recette_seulement');
    process.env.ARRIMO_PATIENTS_FICTIFS='1';require('../src/formation').exigerRecette();
    process.env.ARRIMO_ENV='production';assert.throws(()=>require('../src/formation').exigerRecette(),e=>e.code==='formation_recette_seulement');
  }finally{for(const k of variables){if(avant[k]===undefined)delete process.env[k];else process.env[k]=avant[k];}}
});
