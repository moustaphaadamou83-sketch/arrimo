'use strict';
const {empreinte}=require('./security');
const STATUTS=['en_ligne','occupe','en_reunion','en_pause','absent','hors_ligne'];
function expression(alias='u'){
  if(!/^[a-z]+$/.test(alias))throw new Error('Alias SQL interne invalide');
  return `CASE WHEN NOT ${alias}.actif OR ${alias}.archive_le IS NOT NULL OR NOT EXISTS(
    SELECT 1 FROM sh_sessions sp WHERE sp.utilisateur_id=${alias}.id AND sp.expire_le>now()
      AND sp.presence_le>now()-interval '90 seconds') THEN 'hors_ligne' ELSE ${alias}.presence_manuelle END`;
}
function brancher(api,pool,route,journal){
  api.get('/presence',route(async()=>({
    delai_hors_ligne_secondes:90,
    employes:(await pool.query(`SELECT u.id,${expression()} statut FROM sh_utilisateurs u WHERE u.actif AND u.archive_le IS NULL ORDER BY u.id`)).rows,
    information:'La présence indique une connexion récente et un statut déclaré, pas une activité professionnelle.'
  })));
  api.post('/moi/presence',route(async req=>{
    const r=await pool.query('UPDATE sh_sessions SET presence_le=now() WHERE utilisateur_id=$1 AND token=$2 RETURNING id',[req.u.id,empreinte(req.u.token)]);
    if(!r.rowCount)throw Object.assign(new Error('Session expirée. Reconnectez-vous.'),{statut:401});
    return {ok:true};
  }));
  api.put('/moi/presence',route(async req=>{
    if(!STATUTS.includes(req.body.statut)||Object.keys(req.body).some(k=>k!=='statut'))throw Object.assign(new Error('Statut de présence invalide.'),{statut:400});
    await pool.query('UPDATE sh_utilisateurs SET presence_manuelle=$2 WHERE id=$1',[req.u.id,req.body.statut]);
    await journal(pool,req.u,'Disponibilité SH modifiée',req.u.email,req.body.statut);
    return {statut:req.body.statut};
  }));
}
module.exports={STATUTS,expression,brancher};
