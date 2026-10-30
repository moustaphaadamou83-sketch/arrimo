'use strict';
// Diagnostic sans SQL ni modification de comptes, de permissions ou de services.
const fs=require('node:fs');
const net=require('node:net');
const {spawnSync}=require('node:child_process');

function lireRestrictions(texte){
  return Object.fromEntries(texte.split('\n').filter(l=>/^(CapEff|CapBnd|NoNewPrivs|Seccomp):/.test(l)).map(l=>{
    const [cle,...valeur]=l.split(':');return [cle,valeur.join(':').trim()];
  }));
}
function sondeSocket(){
  return new Promise(resolve=>{
    const socket=net.createConnection({path:'/var/run/postgresql/.s.PGSQL.5432'});
    const terminer=resultat=>{socket.destroy();resolve(resultat);};
    socket.once('connect',()=>terminer({accessible:true}));
    socket.once('error',e=>terminer({accessible:false,code:e.code}));
    socket.setTimeout(1500,()=>terminer({accessible:false,code:'ETIMEDOUT'}));
  });
}
function sondeEcoute(){
  return new Promise(resolve=>{
    const server=net.createServer();
    server.once('error',e=>resolve({possible:false,code:e.code}));
    server.listen(0,'127.0.0.1',()=>server.close(()=>resolve({possible:true})));
  });
}
async function diagnostiquer(){
  let restrictions={};try{restrictions=lireRestrictions(fs.readFileSync('/proc/self/status','utf8'));}catch{/* Autres systèmes : les sondes restent la référence. */}
  const r=spawnSync('runuser',['-u','postgres','--','id','-u'],{encoding:'utf8',timeout:5000});
  const changementIdentite={possible:r.status===0,code:r.error?.code||null,
    motif:/cannot set groups: Operation not permitted/.test(r.stderr||'')?'SETGROUPS_REFUSE':r.status===0?null:'RUNUSER_REFUSE'};
  const [socketPostgres,ecouteLocale]=await Promise.all([sondeSocket(),sondeEcoute()]);
  return {date:new Date().toISOString(),uid:process.getuid?.(),restrictions,changementIdentite,socketPostgres,ecouteLocale,
    prerequisSystemeValides:changementIdentite.possible&&socketPostgres.accessible&&ecouteLocale.possible,
    sqlExecute:false,donneesPubliquesModifiees:false,
    limite:'Ces sondes ne valident ni les droits SQL, ni les migrations, ni Chromium. Aucun droit système n’est modifié.'};
}
if(require.main===module)diagnostiquer().then(r=>{console.log(JSON.stringify(r,null,2));if(!r.prerequisSystemeValides)process.exitCode=2;}).catch(e=>{console.error(e.code||e.name);process.exitCode=2;});
module.exports={lireRestrictions,diagnostiquer};
