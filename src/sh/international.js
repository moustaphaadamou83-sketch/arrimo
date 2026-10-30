'use strict';
const donnees=require('./donnees-internationales.json');
const unites=require('../../public-sh/devises-unites');
const devises=[...new Set(Object.values(donnees.pays).flat())].sort();
const erreur=message=>Object.assign(new Error(message),{statut:400});
function normaliserPays(valeur){
  const code=String(valeur??'').trim().toUpperCase();
  if(!Object.hasOwn(donnees.pays,code))throw erreur('Pays invalide (code ISO à deux lettres).');
  return code;
}
function normaliserDevise(valeur){
  const code=String(valeur??'').trim().toUpperCase();
  if(!devises.includes(code))throw erreur('Devise inconnue dans le référentiel international.');
  return code;
}
function choisirDevise(pays,valeur){
  const code=normaliserPays(pays);
  if(valeur!=null&&String(valeur).trim())return normaliserDevise(valeur);
  const choix=donnees.pays[code];
  if(choix.length!==1)throw erreur('Choisissez explicitement la devise du contrat pour ce pays.');
  return choix[0];
}
function decimalesDevise(devise){
  const code=normaliserDevise(devise),unite=unites[code];
  return unite?.base===10?unite.exposant:null;
}
function references(langue='fr'){
  const locale=langue==='en'?'en-CA':'fr-CA';
  const nomsPays=new Intl.DisplayNames([locale],{type:'region'}),nomsDevises=new Intl.DisplayNames([locale],{type:'currency'});
  return {source:donnees.source,pays:Object.entries(donnees.pays).map(([code,monnaies])=>({code,nom:nomsPays.of(code),devises:monnaies,
    devise_defaut:monnaies.length===1?monnaies[0]:null})).sort((a,b)=>a.nom.localeCompare(b.nom,locale)),
    devises:devises.map(code=>({code,nom:nomsDevises.of(code),symbole:new Intl.NumberFormat(locale,{style:'currency',currency:code}).formatToParts(0).find(p=>p.type==='currency').value,decimales:decimalesDevise(code),...unites[code]})),
    change_disponible:false,taxes_validees:false};
}
module.exports={normaliserPays,normaliserDevise,choisirDevise,decimalesDevise,references};
