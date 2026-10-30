'use strict';
const {transaction}=require('../db');
const erreur=(statut,message)=>Object.assign(new Error(message),{statut});
const reference=id=>`PRJ-${String(id).padStart(6,'0')}`;
function brancher(api,pool,route,journal,env){
  async function verrouiller(c,req){
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<1)throw erreur(400,'Projet invalide.');
    const p=(await c.query('SELECT * FROM sh_projets WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!p)throw erreur(404,'Projet introuvable.');return p;
  }
  for(const action of ['archiver','restaurer','demander-suppression']){
    api.post(`/projets/:id/${action}`,route(req=>transaction(pool,async c=>{
      const p=await verrouiller(c,req);
      if(action==='archiver'){
        if(!['termine','annule'].includes(p.statut))throw erreur(409,'Terminez ou annulez le projet avant archivage.');
        if(!p.archive_le)await c.query('UPDATE sh_projets SET archive_le=now(),archive_par=$2,modifie_le=now() WHERE id=$1',[p.id,req.u.id]);
      }else if(action==='restaurer'){
        await c.query('UPDATE sh_projets SET archive_le=NULL,archive_par=NULL,suppression_demandee_le=NULL,suppression_demandee_par=NULL,motif_suppression=NULL,modifie_le=now() WHERE id=$1',[p.id]);
      }else{
        if(!p.archive_le)throw erreur(409,'Archivez le projet avant de demander sa suppression.');
        const motif=String(req.body.motif||'').trim();
        if(motif.length<10||motif.length>2000)throw erreur(400,'Décrivez le motif de suppression (10 à 2000 caractères).');
        await c.query('UPDATE sh_projets SET suppression_demandee_le=now(),suppression_demandee_par=$2,motif_suppression=$3,modifie_le=now() WHERE id=$1',[p.id,req.u.id,motif]);
      }
      await journal(c,req.u,action==='archiver'?'Projet archivé':action==='restaurer'?'Projet restauré':'Suppression de projet demandée',reference(p.id),p.nom,p.hopital_id);
      return (await c.query('SELECT * FROM sh_projets WHERE id=$1',[p.id])).rows[0];
    })));
  }
  api.post('/projets/:id/supprimer',route(req=>transaction(pool,async c=>{
    const p=await verrouiller(c,req);
    if(!p.archive_le||!p.suppression_demandee_le)throw erreur(409,'Une demande de suppression d’un projet archivé est requise.');
    if(req.body.confirmation!==`SUPPRIMER ${reference(p.id)}`)throw erreur(400,'Confirmation de suppression invalide.');
    const jours=String(env.SH_PROJETS_CONSERVATION_JOURS??'');
    if(!/^\d{1,5}$/.test(jours))throw erreur(409,'La politique de conservation des projets doit être configurée avant suppression.');
    if(Date.now()<new Date(p.archive_le).getTime()+Number(jours)*86400000)throw erreur(409,'Le délai de conservation du projet n’est pas écoulé.');
    const h=(await c.query('SELECT environnement,statut FROM hopitaux WHERE id=$1 FOR UPDATE',[p.hopital_id])).rows[0];
    if(h?.environnement==='production')throw erreur(409,'La suppression d’un projet de production exige une procédure de conservation et de restitution dédiée.');
    if(p.contrat_id||(await c.query('SELECT 1 FROM sh_documents WHERE projet_id=$1 LIMIT 1',[p.id])).rowCount)throw erreur(409,'Des contrats ou documents liés empêchent la suppression du projet.');
    if((await c.query('SELECT 1 FROM sh_support_tickets WHERE projet_id=$1 LIMIT 1',[p.id])).rowCount)throw erreur(409,'Des tickets liés empêchent la suppression du projet.');
    // Les clés étrangères des dépendances prennent KEY SHARE sur les tâches.
    // Verrouiller ces lignes avant de contrôler les liens évite une dépendance
    // voisine insérée entre le contrôle et la suppression en cascade.
    await c.query('SELECT id FROM sh_taches WHERE projet_id=$1 ORDER BY id FOR UPDATE',[p.id]);
    if((await c.query("SELECT 1 FROM sh_taches WHERE projet_id=$1 AND statut NOT IN ('terminee','annulee') LIMIT 1",[p.id])).rowCount)throw erreur(409,'Des tâches sont encore ouvertes : terminez-les avant suppression.');
    const dependances=await c.query(`SELECT 1 FROM sh_taches_dependances d JOIN sh_taches t ON t.id=d.tache_id JOIN sh_taches x ON x.id=d.depend_de
      WHERE (t.projet_id=$1 OR x.projet_id=$1) AND t.projet_id<>x.projet_id
      UNION ALL SELECT 1 FROM sh_taches t JOIN sh_taches x ON x.id=t.parent_id WHERE (t.projet_id=$1 OR x.projet_id=$1) AND t.projet_id<>x.projet_id LIMIT 1`,[p.id]);
    if(dependances.rowCount)throw erreur(409,'Une dépendance avec un autre projet empêche la suppression.');
    const affectations=(await c.query("DELETE FROM sh_affectations WHERE type='projet' AND projet_id=$1 RETURNING utilisateur_id",[p.id])).rows;
    for(const utilisateur of new Set(affectations.map(a=>a.utilisateur_id)))await c.query('DELETE FROM sh_sessions WHERE utilisateur_id=$1',[utilisateur]);
    await c.query("SELECT set_config('app.sh_suppression_projet',$1,true)",[String(p.id)]);
    await c.query('DELETE FROM sh_projet_membres WHERE projet_id=$1',[p.id]);
    await c.query('UPDATE sh_taches SET parent_id=NULL WHERE projet_id=$1',[p.id]);
    await journal(c,req.u,'Projet supprimé',reference(p.id),`${p.nom} ; motif : ${p.motif_suppression} ; affectations révoquées : ${affectations.length}`,p.hopital_id);
    await c.query('DELETE FROM sh_projets WHERE id=$1',[p.id]);
    return {ok:true,reference:reference(p.id)};
  })));
}
module.exports={brancher};
