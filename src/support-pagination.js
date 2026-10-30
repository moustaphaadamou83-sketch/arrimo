'use strict';
const {ErreurHttp}=require('./db');
function curseur(valeur){
  if(valeur===undefined)return null;
  if(typeof valeur!=='string'||!/^[1-9][0-9]{0,18}$/.test(valeur)||BigInt(valeur)>9223372036854775807n)throw new ErreurHttp(400,'parametre_invalide',{nom:'avant'});
  return valeur;
}
module.exports={curseur};
