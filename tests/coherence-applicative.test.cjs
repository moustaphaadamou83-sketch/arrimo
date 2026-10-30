'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {validerManifest,empreinteManifest,verifierCibles}=require('../scripts/verifier-coherence-applicative.cjs');
const files=Object.fromEntries(['src/app.js','public/app.js','public/og.js','public/og-vocal.js','package-lock.json'].map(k=>[k,Buffer.from('Candidate vérifiée : '+k)]));
const manifest=Object.fromEntries(Object.entries(files).map(([k,v])=>[k,crypto.createHash('sha256').update(v).digest('hex')]));
function options({localDivergent=false,publicDivergent=false,versionDivergente=false,httpErreur=false,rootHorsPerimetre=false}={}){
 return {resoudre:()=>rootHorsPerimetre?'/autre/release':'/app/releases/v1',lire:p=>localDivergent&&p.endsWith('/src/app.js')?Buffer.from('ancien'):files[p.slice('/app/releases/v1/'.length)],requete:async url=>{
  const p=new URL(url).pathname;
  return {ok:!httpErreur,status:httpErreur?503:200,json:async()=>p==='/version.json'?{application_sha256:versionDivergente?'ancien':empreinteManifest(manifest)}:{etat:'ok',base:'ok'},arrayBuffer:async()=>publicDivergent&&p==='/og.js'?Buffer.from('ancien'):files['public'+p]};
 }};
}
const cibles=[{nom:'test',root:'/app',url:'https://app.example.invalid'}];
test('manifest : configuration privée, traversée et inventaire incomplet refusés',()=>{
 for(const value of [{...manifest,'.env':'a'.repeat(64)},{...manifest,'src/../secret':'a'.repeat(64)},{'src/app.js':'a'.repeat(64)},[]])assert.throws(()=>validerManifest(value));
});
test('empreinte indépendante de l’ordre des fichiers',()=>assert.equal(empreinteManifest(manifest),empreinteManifest(Object.fromEntries(Object.entries(manifest).reverse()))));
test('release et assets publics concordants : candidate reconnue',async()=>assert.equal((await verifierCibles(cibles,manifest,options())).valide,true));
test('versions divergentes : refus même si la santé est verte',async()=>{
 for(const changes of [{localDivergent:true},{publicDivergent:true},{versionDivergente:true}]){const r=await verifierCibles(cibles,manifest,options(changes));assert.equal(r.valide,false);assert.ok(r.cibles[0].erreurs.length);}
});
test('cible hors périmètre ou requête échouée : contrôle en échec',async()=>{
 for(const changes of [{rootHorsPerimetre:true},{httpErreur:true}])await assert.rejects(verifierCibles(cibles,manifest,options(changes)));
 assert.equal((await verifierCibles([],manifest,options())).valide,false);
});
