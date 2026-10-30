'use strict';
/** La fonction vérifie d'abord le périmètre de l'appelant puis celui des destinataires. */
async function destinataires(db,hopital){
  return (await db.query('SELECT utilisateur_id AS id FROM sh_support_destinataires($1)',[hopital])).rows.map(u=>u.id);
}
module.exports={destinataires};
