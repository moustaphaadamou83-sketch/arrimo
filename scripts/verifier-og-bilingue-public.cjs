'use strict';
const fs=require('node:fs'),path=require('node:path');
async function main(){
  const url=process.env.OG_BILINGUE_URL||'https://demo.arrimo.senseafri.com';
  if(new URL(url).hostname!=='demo.arrimo.senseafri.com')throw new Error('Cette vérification est réservée à la Démo ABC.');
  const comptes=JSON.parse(fs.readFileSync(process.env.OG_BILINGUE_ACCES||'/root/.local/arrimo-publication-acces.json','utf8')).demo;
  const questions={en:'OG, where is patient P-43267 currently located? Which hospital, department, room and bed is the patient assigned to?',fr:'OG, où se trouve actuellement le patient P-43267 ? Dans quel hôpital, service, chambre et lit est-il admis ?'};
  const resultats=[];
  for(const nom of ['a','b','c']){
    const compte=comptes.find(c=>c.nom===nom);if(!compte)throw new Error('Compte Démo manquant : '+nom);
    let token;
    async function appel(method,p,body){const r=await fetch(url+'/api'+p,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw new Error(`Compte ${nom} : ${method} ${p}, HTTP ${r.status}`);return j;}
    try{
      const login=await appel('POST','/connexion',{email:compte.email,mot_de_passe:compte.password});
      if(!login.token)throw new Error('Connexion normale incomplète : MFA requise.');token=login.token;
      const moi=await appel('GET','/moi');if(moi.utilisateur.mdp_temporaire)throw new Error('Le compte exige un changement de mot de passe ; aucune modification effectuée.');
      const e=moi.etablissements.find(e=>e.code===({a:'HX',b:'HY',c:'HC'})[nom]);if(!e)throw new Error('Affectation ABC inattendue.');
      for(const langue of ['fr','en'])for(const langueQuestion of ['fr','en']){
        const r=await appel('POST','/copilote/question',{etablissement_id:e.id,question:questions[langueQuestion],langue});
        const texte=r.reponse||'';const autorise=nom!=='b';
        const donnees=autorise?/SI-108/.test(texte)&&/108/.test(texte)&&/TR-00067/.test(texte):!/SI-108|TR-00067|Val-des-Pins/.test(texte);
        const localisation=langue==='en'?/current|accessible|received|admitted|recorded|available|patient.*elsewhere/i.test(texte)&&!/Situation actuelle|Aucune situation|Statut du transfert/.test(texte):/Situation actuelle|Aucune situation|Aucun transfert/.test(texte);
        resultats.push({compte:nom,langue_interface:langue,langue_question:langueQuestion,donnees_correctes:donnees,langue_correcte:localisation,reponse:texte});
      }
    }finally{if(token)await appel('POST','/deconnexion',{}).catch(()=>{});}
  }
  const rapport={date:new Date().toISOString(),url,connexion_normale:true,configuration_comptes_modifiee:false,resultats,valide:resultats.every(r=>r.donnees_correctes&&r.langue_correcte)};
  const dossier=path.resolve('.local/preuves-sh-lot1');fs.mkdirSync(dossier,{recursive:true,mode:0o700});
  const fichier=path.join(dossier,'bilingue-public-'+Date.now()+'.json');fs.writeFileSync(fichier,JSON.stringify(rapport,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({rapport:fichier,valide:rapport.valide,resultats:resultats.map(({reponse,...r})=>({...r,extrait:reponse.slice(0,260)}))},null,2));
  if(!rapport.valide&&!process.argv.includes('--observer'))process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
