'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {configuration}=require('../src/support-client'),{cibles}=require('../src/sh/cibles');
const valide={ARRIMO_SUPPORT_SH_URL:'https://sh.example.invalid',ARRIMO_SUPPORT_CLE:'fixture-'.repeat(6)};
function enMode(mode,fn){const avant=process.env.ARRIMO_ENV;process.env.ARRIMO_ENV=mode;try{fn();}finally{avant===undefined?delete process.env.ARRIMO_ENV:process.env.ARRIMO_ENV=avant;}}
test('support : seules les deux cibles de démonstration partagent le mode demo',()=>enMode('demo',()=>{
 assert.equal(configuration(valide).cible,'demo');assert.equal(configuration({...valide,ARRIMO_SUPPORT_CIBLE:'demo_abc'}).cible,'demo_abc');
 for(const cible of ['production','recette','pilote','toString','__proto__'])assert.equal(configuration({...valide,ARRIMO_SUPPORT_CIBLE:cible}),null);
}));
test('support : aucune cible de démonstration utilisable depuis la production ou la recette',()=>{
 for(const mode of ['production','recette','pilote'])enMode(mode,()=>{
  assert.equal(configuration(valide).cible,mode);
  for(const cible of ['demo','demo_abc'])assert.equal(configuration({...valide,ARRIMO_SUPPORT_CIBLE:cible}),null);
 });
});
test('support : clé absente et adresse ambiguë ou non sécurisée refusées',()=>enMode('demo',()=>{
 assert.equal(configuration({...valide,ARRIMO_SUPPORT_CLE:''}),null);
 for(const url of ['http://sh.example.invalid','https://user:password@sh.example.invalid','https://sh.example.invalid?cle=test','https://sh.example.invalid#test','javascript:alert(1)'])assert.equal(configuration({...valide,ARRIMO_SUPPORT_SH_URL:url}),null);
 assert.ok(configuration({...valide,ARRIMO_SUPPORT_SH_URL:'http://127.0.0.1:3012'}));
}));
test('cibles SH : Démo ABC explicite, non confondue avec la démonstration principale',()=>{
 const env={SH_ENV_DEMO_URL:'http://127.0.0.1:3010',SH_ENV_DEMO_CLE:'main',SH_ENV_DEMO_ABC_URL:'http://127.0.0.1:3016',SH_ENV_DEMO_ABC_CLE:'abc'};
 assert.deepEqual(cibles(env).map(c=>c.code),['demo','demo_abc']);
 assert.throws(()=>cibles({...env,SH_ENV_DEMO_ABC_URL:env.SH_ENV_DEMO_URL+'/'}),e=>e.code==='demo_abc_non_isolee');
 assert.deepEqual(cibles({SH_ENV_DEMO_URL:env.SH_ENV_DEMO_URL,SH_ENV_DEMO_CLE:'main'}).map(c=>c.code),['demo']);
});
