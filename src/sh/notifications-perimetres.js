'use strict';
async function verifierDestinataire(db,id,type,ressourceType,ressourceId){
  if(!id)return;
  const r=await db.query('SELECT sh_notification_eligible($1,$2,$3,$4,NULL) AS autorise',[id,type,ressourceType,ressourceId]);
  if(r.rows[0]?.autorise!==true)throw Object.assign(new Error('Le responsable doit avoir accès à cet élément.'),{statut:400});
}
module.exports={verifierDestinataire};
