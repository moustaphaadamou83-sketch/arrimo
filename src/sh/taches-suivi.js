'use strict';
/**
 * Suivi détaillé des tâches : checklist, temps estimé et temps réalisé (saisies datées par personne).
 * Mêmes règles d'accès que la tâche : implantation et administration gèrent ; les autres rôles agissent
 * seulement sur les tâches qui leur sont attribuées.
 */
const {transaction}=require('../db');
const erreur=(statut,message)=>Object.assign(new Error(message),{statut});
const id=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw erreur(400,'Identifiant invalide.');return n;};
const gestionnaire=u=>['administration','implantation'].includes(u.role);

function brancher(api,pool,route,journal){
  async function tache(db,req,{modifier=false}={}){
    const t=(await db.query('SELECT * FROM sh_taches WHERE id=$1',[id(req.params.id)])).rows[0];
    if(!t)throw erreur(404,'Tâche introuvable.');
    if(modifier&&!gestionnaire(req.u)&&t.responsable_id!==req.u.id&&!(await db.query('SELECT 1 FROM sh_taches_collaborateurs WHERE tache_id=$1 AND utilisateur_id=$2',[t.id,req.u.id])).rowCount)
      throw erreur(403,'Vous ne pouvez modifier que les tâches qui vous sont attribuées.');
    if(modifier&&['terminee','annulee'].includes(t.statut))throw erreur(409,'Tâche close : rouvrez-la avant de la modifier.');
    return t;
  }
  api.get('/taches/:id/suivi',route(async req=>{
    const t=await tache(pool,req);
    const [checklist,temps]=await Promise.all([
      pool.query('SELECT c.*,u.nom faite_par_nom FROM sh_taches_checklist c LEFT JOIN sh_utilisateurs u ON u.id=c.faite_par WHERE tache_id=$1 ORDER BY ordre,id',[t.id]),
      pool.query('SELECT x.*,u.nom utilisateur FROM sh_taches_temps x JOIN sh_utilisateurs u ON u.id=x.utilisateur_id WHERE tache_id=$1 ORDER BY jour DESC,id DESC',[t.id])]);
    const realise=temps.rows.reduce((n,x)=>n+x.minutes,0);
    const collaborateurs=(await pool.query('SELECT c.utilisateur_id id,u.nom FROM sh_taches_collaborateurs c JOIN sh_utilisateurs u ON u.id=c.utilisateur_id WHERE tache_id=$1 ORDER BY u.nom',[t.id])).rows;
    return {collaborateurs,checklist:checklist.rows,temps:temps.rows,temps_estime_minutes:t.temps_estime_minutes,temps_realise_minutes:realise,
      ecart_minutes:t.temps_estime_minutes==null?null:realise-t.temps_estime_minutes,checklist_ouverte:checklist.rows.filter(c=>!c.faite).length};
  }));
  api.put('/taches/:id/estimation',route(async req=>{
    if(!gestionnaire(req.u))throw erreur(403,'Seules l’implantation et l’administration estiment les tâches.');
    const t=await tache(pool,req,{modifier:true}),m=req.body.minutes==null||req.body.minutes===''?null:Number(req.body.minutes);
    if(m!==null&&(!Number.isInteger(m)||m<0||m>100000))throw erreur(400,'Estimation en minutes entières, de 0 à 100 000.');
    await pool.query('UPDATE sh_taches SET temps_estime_minutes=$2,modifie_le=now() WHERE id=$1',[t.id,m]);
    await journal(pool,req.u,'Estimation de tâche modifiée',t.titre,m==null?'aucune':`${m} min`);
    return {temps_estime_minutes:m};
  }));
  // Collaborateurs en plus du responsable : chacun est notifié et peut faire avancer la tâche.
  api.put('/taches/:id/collaborateurs',route(req=>transaction(pool,async c=>{
    const t=await tache(c,req,{modifier:true}),{verifierDestinataire}=require('./notifications-perimetres'),{notifier}=require('./automatisations');
    const ids=[...new Set((Array.isArray(req.body.utilisateurs)?req.body.utilisateurs:[]).map(Number))];
    if(ids.length>20||ids.some(x=>!Number.isSafeInteger(x)||x<1))throw erreur(400,'Vingt collaborateurs au plus, identifiants valides.');
    const avant=new Set((await c.query('SELECT utilisateur_id FROM sh_taches_collaborateurs WHERE tache_id=$1',[t.id])).rows.map(r=>r.utilisateur_id));
    for(const u of ids)if(!avant.has(u))await verifierDestinataire(c,u,'tache','tache',t.id);
    await c.query('DELETE FROM sh_taches_collaborateurs WHERE tache_id=$1 AND NOT (utilisateur_id = ANY($2::int[]))',[t.id,ids]);
    for(const u of ids)if(!avant.has(u)){
      await c.query('INSERT INTO sh_taches_collaborateurs(tache_id,utilisateur_id,ajoute_par) VALUES($1,$2,$3)',[t.id,u,req.u.id]);
      if(u!==req.u.id)await notifier(c,u,{ressourceType:'tache',ressourceId:t.id,type:'tache',titre:`Collaboration demandée : ${t.titre}`,lien:'taches'});
    }
    await journal(c,req.u,'Collaborateurs de tâche modifiés',t.titre,`${ids.length} collaborateur(s)`);
    return {collaborateurs:ids};
  })));
  api.post('/taches/:id/checklist',route(async req=>{
    const t=await tache(pool,req,{modifier:true}),libelle=String(req.body.libelle||'').trim().slice(0,200);
    if(libelle.length<2)throw erreur(400,'Libellé de checklist requis.');
    const ordre=Number((await pool.query('SELECT COALESCE(max(ordre),0)+1 n FROM sh_taches_checklist WHERE tache_id=$1',[t.id])).rows[0].n);
    return (await pool.query('INSERT INTO sh_taches_checklist(tache_id,libelle,ordre) VALUES($1,$2,$3) RETURNING *',[t.id,libelle,ordre])).rows[0];
  }));
  api.put('/taches/:id/checklist/:element',route(async req=>{
    const t=await tache(pool,req,{modifier:true}),faite=req.body.faite===true;
    const r=(await pool.query(`UPDATE sh_taches_checklist SET faite=$3,faite_par=CASE WHEN $3 THEN $4::int END,faite_le=CASE WHEN $3 THEN now() END
      WHERE id=$1 AND tache_id=$2 RETURNING *`,[id(req.params.element),t.id,faite,req.u.id])).rows[0];
    if(!r)throw erreur(404,'Élément de checklist introuvable.');
    await journal(pool,req.u,'Checklist de tâche modifiée',t.titre,`${r.libelle} : ${faite?'fait':'à faire'}`);
    return r;
  }));
  api.delete('/taches/:id/checklist/:element',route(async req=>{
    const t=await tache(pool,req,{modifier:true});
    if(!(await pool.query('DELETE FROM sh_taches_checklist WHERE id=$1 AND tache_id=$2',[id(req.params.element),t.id])).rowCount)throw erreur(404,'Élément de checklist introuvable.');
    return {ok:true};
  }));
  api.post('/taches/:id/temps',route(async req=>{
    const t=await tache(pool,req,{modifier:true}),minutes=Number(req.body.minutes),jour=String(req.body.jour||'');
    if(!Number.isInteger(minutes)||minutes<1||minutes>1440)throw erreur(400,'Durée en minutes entières, de 1 à 1 440 par saisie.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(jour)||jour>require('./commercial').aujourdhui())throw erreur(400,'Date de travail valide et non future requise.');
    const r=(await pool.query('INSERT INTO sh_taches_temps(tache_id,utilisateur_id,jour,minutes,note) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [t.id,req.u.id,jour,minutes,String(req.body.note||'').trim().slice(0,300)||null])).rows[0];
    await journal(pool,req.u,'Temps de tâche saisi',t.titre,`${minutes} min · ${jour}`);
    return r;
  }));
  api.delete('/taches/:id/temps/:saisie',route(async req=>transaction(pool,async c=>{
    const t=await tache(c,req,{modifier:true});
    const s=(await c.query('SELECT * FROM sh_taches_temps WHERE id=$1 AND tache_id=$2 FOR UPDATE',[id(req.params.saisie),t.id])).rows[0];
    if(!s)throw erreur(404,'Saisie de temps introuvable.');
    if(s.utilisateur_id!==req.u.id&&req.u.role!=='administration')throw erreur(403,'Seul l’auteur ou l’administration retire une saisie de temps.');
    await c.query('DELETE FROM sh_taches_temps WHERE id=$1',[s.id]);
    await journal(c,req.u,'Temps de tâche retiré',t.titre,`${s.minutes} min · ${new Date(s.jour).toISOString().slice(0,10)}`);
    return {ok:true};
  })));
}
module.exports={brancher};
