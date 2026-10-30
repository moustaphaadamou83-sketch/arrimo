'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const CIBLES=[
 {nom:'principal',root:'/opt/arrimo',url:'https://arrimo.senseafri.com'},
 {nom:'demo',root:'/opt/arrimo-demo',url:'https://demo.arrimo.senseafri.com'},
 {nom:'recette',root:'/opt/arrimo-recette',url:'https://recette.arrimo.senseafri.com'},
 {nom:'validation',root:'/opt/arrimo-validation',url:'http://127.0.0.1:30444'},
];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function validerManifest(manifest){
 if(!manifest||Array.isArray(manifest)||typeof manifest!=='object'||!Object.keys(manifest).length)throw new Error('Manifest applicatif requis.');
 for(const [file,digest]of Object.entries(manifest))if(!/^(?:(?:src|public|public-sh|db)\/[a-zA-Z0-9_./-]+|scripts\/sh-validation\.cjs|package(?:-lock)?\.json)$/.test(file)||file.split('/').includes('..')||!/^\w{64}$/.test(digest)||!/^[a-f0-9]+$/.test(digest))throw new Error('Entrée de manifest invalide.');
 for(const file of ['src/app.js','public/app.js','public/og.js','package-lock.json'])if(!manifest[file])throw new Error('Manifest incomplet : '+file);
 return manifest;
}
function empreinteManifest(manifest){validerManifest(manifest);return sha('{'+Object.keys(manifest).sort().map(k=>JSON.stringify(k)+': '+JSON.stringify(manifest[k])).join(', ')+'}');}
async function verifierCibles(cibles,manifest,{requete=fetch,lire=fs.readFileSync,resoudre=fs.realpathSync}={}){
 validerManifest(manifest);const empreinte=empreinteManifest(manifest),resultats=[];
 for(const cible of cibles){
  const root=resoudre(path.join(cible.root,'current'));const erreurs=[];
  if(path.dirname(root)!==path.join(cible.root,'releases'))throw new Error('Release hors périmètre : '+cible.nom);
  for(const [file,digest]of Object.entries(manifest)){
   try{if(sha(lire(path.join(root,file)))!==digest)erreurs.push('Fichier divergent : '+file);}catch{erreurs.push('Fichier absent ou illisible : '+file);}
  }
  const get=async suffix=>{const r=await requete(cible.url+suffix,{signal:AbortSignal.timeout(15000),headers:{'Cache-Control':'no-cache'}});if(!r.ok)throw new Error('HTTP '+r.status+' : '+cible.nom+suffix);return r;};
  const version=await(await get('/version.json')).json();
  if(version.application_sha256!==empreinte)erreurs.push('Manifest public divergent');
  const sante=await(await get('/api/sante')).json();if(sante.etat!=='ok'||sante.base!=='ok')erreurs.push('Santé dégradée');
  for(const file of ['app.js','og.js','og-vocal.js','og-vocal-moteur.js','support-client.js'])if(manifest['public/'+file]){
   if(sha(Buffer.from(await(await get('/'+file)).arrayBuffer()))!==manifest['public/'+file])erreurs.push('Asset public divergent : '+file);
  }
  resultats.push({cible:cible.nom,release:root,application_sha256:version.application_sha256,valide:!erreurs.length,erreurs});
 }
 return {valide:resultats.length>0&&resultats.every(r=>r.valide),application_sha256:empreinte,cibles:resultats};
}
if(require.main===module){
 const input=process.argv[2];if(!input)throw new Error('Usage : node scripts/verifier-coherence-applicative.cjs MANIFEST.json');
 verifierCibles(CIBLES,JSON.parse(fs.readFileSync(input,'utf8'))).then(r=>{console.log(JSON.stringify(r,null,2));if(!r.valide)process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={validerManifest,empreinteManifest,verifierCibles};
