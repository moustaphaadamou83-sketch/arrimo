'use strict';
const {MODULES,normaliser}=require('../configuration-operationnelle');
const erreur=()=>Object.assign(new Error('La configuration hospitalière ne peut pas être promue sans validation.'),{statut:409,code:'configuration_promotion_invalide'});

// Ne transporter que les paramètres pris en charge. Les patients, états des lits,
// habilitations et référentiels cliniques ne font pas partie de cette promotion.
function configurationPromouvable(source,{stricte=true}={}){
  if(!source||!source.modules||typeof source.modules!=='object'||Array.isArray(source.modules))throw erreur();
  if(stricte&&Object.keys(source.modules).some(k=>!MODULES.includes(k)))throw erreur();
  if(MODULES.some(k=>source.modules[k]!==undefined&&typeof source.modules[k]!=='boolean'))throw erreur();
  try{return normaliser({vocation:source.vocation,modules:Object.fromEntries(MODULES.map(k=>[k,source.modules[k]!==false]))});}
  catch{throw erreur();}
}
async function lireConfiguration(appeler,cible,code){
  return configurationPromouvable(await appeler(cible,'GET',`/sh/etablissements/${encodeURIComponent(code)}/configuration-operationnelle`));
}
async function promouvoirConfiguration(appeler,cible,code,configuration,par){
  const souhaitee=configurationPromouvable(configuration);
  const chemin=`/sh/etablissements/${encodeURIComponent(code)}/configuration-operationnelle`;
  const avant=await appeler(cible,'GET',chemin);
  const actuelle=configurationPromouvable(avant,{stricte:false});
  if(JSON.stringify(actuelle)===JSON.stringify(souhaitee))return {modifie:false,...souhaitee};
  if(typeof avant.version!=='string'||!avant.version)throw erreur();
  // Le serveur cible vérifie cette version sous verrou. Un conflit arrête le Go Live.
  await appeler(cible,'PUT',chemin,{...souhaitee,version:avant.version,par});
  return {modifie:true,...souhaitee};
}
module.exports={configurationPromouvable,lireConfiguration,promouvoirConfiguration};
