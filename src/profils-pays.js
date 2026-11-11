'use strict';
const {ErreurHttp}=require('./db');
const pays=require('./sh/donnees-internationales.json').pays;
function paysDuProfil(profil){
  const code=String(profil?.code||'').trim().toUpperCase();
  // Un code interne de profil n'est pas nécessairement un code ISO (ex. NE).
  if(Object.hasOwn(pays,profil?.pays_code))return profil.pays_code;
  return code==='QC'?'CA':null;
}
function profilsAvecPays(profils,env=process.env){
  let valeurs={};
  try{
    valeurs=env.ARRIMO_PROFILS_PAYS?JSON.parse(env.ARRIMO_PROFILS_PAYS):{};
    if(!valeurs||Array.isArray(valeurs)||typeof valeurs!=='object')throw new Error();
    const codes=new Set();
    for(const [code,paysCode]of Object.entries(valeurs)){
      const cle=code.trim().toUpperCase();
      if(!/^[A-Z0-9_-]{1,40}$/.test(cle)||codes.has(cle)||!Object.hasOwn(pays,paysCode)||(cle==='QC'&&paysCode!=='CA'))throw new Error();
      codes.add(cle);
    }
  }catch{throw new ErreurHttp(503,'profil_pays_correspondance_invalide');}
  const correspondances=new Map(Object.entries(valeurs).map(([code,paysCode])=>[code.trim().toUpperCase(),paysCode]));
  // Pays enregistré avec le profil (créé depuis SH) d'abord, puis la correspondance de configuration, puis QC → CA
  return profils.map(p=>({...p,pays_code:(p.pays_code&&Object.hasOwn(pays,String(p.pays_code).trim())?String(p.pays_code).trim():null)||correspondances.get(String(p.code).trim().toUpperCase())||(String(p.code).trim().toUpperCase()==='QC'?'CA':null)}));
}
function choisirProfil(profils,demande={},options={}){
  const fourni=demande.pays_code!==undefined;
  const code=String(demande.pays_code??'').trim().toUpperCase();
  if(options.exigerPays&&!fourni)throw new ErreurHttp(400,'profil_pays_requis');
  if(fourni&&!Object.hasOwn(pays,code))throw new ErreurHttp(400,'profil_pays_invalide');
  const id=demande.config_id===undefined?null:Number(demande.config_id);
  if(id!==null&&(!Number.isSafeInteger(id)||id<1))throw new ErreurHttp(400,'profil_pays_invalide');
  const candidats=profils.filter(p=>(id===null||Number(p.id)===id)&&(!fourni||paysDuProfil(p)===code));
  if(!candidats.length)throw new ErreurHttp(409,'profil_pays_absent');
  if(candidats.length!==1)throw new ErreurHttp(409,'profil_pays_ambigu');
  if(!Number.isSafeInteger(Number(candidats[0].id))||Number(candidats[0].id)<1)throw new ErreurHttp(400,'profil_pays_invalide');
  return candidats[0];
}
function verifierEtablissementPays(etablissement,hopital,{verifierNom=!hopital.relie}={}){
  if(!etablissement||etablissement.code!==hopital.code_etab||(verifierNom&&etablissement.nom!==hopital.nom))throw new ErreurHttp(409,'profil_etablissement_incompatible');
  if(paysDuProfil({code:etablissement.configuration_code,pays_code:etablissement.pays_code})!==hopital.pays_code)throw new ErreurHttp(409,'profil_pays_incompatible');
}
function verifierChangementPays(avant,apres){
  if((avant.relie||avant.organisation_id)&&avant.pays_code!==apres.pays_code)throw new ErreurHttp(409,'profil_pays_changement_interdit');
}
function choisirProfilProduction(profils,hopital,existant,configId){
  if(existant){
    verifierEtablissementPays(existant,hopital,{verifierNom:true});
    if(!Number.isSafeInteger(Number(existant.config_id))||Number(existant.config_id)<1)throw new ErreurHttp(409,'profil_pays_incompatible');
    if(configId!==undefined&&Number(configId)!==Number(existant.config_id))throw new ErreurHttp(409,'profil_pays_incompatible');
  }
  return choisirProfil(profils,{pays_code:hopital.pays_code,config_id:existant?.config_id??configId},{exigerPays:true});
}
async function lireProfilsCibles(appeler,cible,hopital){
  const cap=await appeler(cible,'GET','/sh/capacites');
  if(cap.selectionPays!==true||!Array.isArray(cap.profilsPays))throw new ErreurHttp(409,'profil_pays_verification_indisponible');
  if(!Object.hasOwn(pays,hopital.pays_code))throw new ErreurHttp(400,'profil_pays_invalide');
  return cap.profilsPays.filter(p=>paysDuProfil(p)===hopital.pays_code).map(p=>({id:p.id,code:p.code,nom:p.nom,pays_code:paysDuProfil(p)}));
}
async function lireProfilCible(appeler,cible,hopital,configId){
  return choisirProfil(await lireProfilsCibles(appeler,cible,hopital),{pays_code:hopital.pays_code,...(configId===undefined?{}:{config_id:configId})},{exigerPays:true});
}
module.exports={paysDuProfil,profilsAvecPays,choisirProfil,choisirProfilProduction,verifierEtablissementPays,verifierChangementPays,lireProfilsCibles,lireProfilCible};
