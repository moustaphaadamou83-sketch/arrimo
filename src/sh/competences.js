'use strict';
/**
 * Compétences, zones d'intervention et charge réelle des employés SH. La charge vient des tâches ouvertes
 * (hors terminées et annulées) et de leurs estimations ; rien n'est saisi à la main.
 */
const {transaction}=require('../db');
const {NIVEAUX_COMPETENCE}=require('./competences-migrations');
const erreur=(statut,message)=>Object.assign(new Error(message),{statut});
function brancher(api,pool,route,journal){
  api.get('/equipe/competences',route(async req=>{
    const q=String(req.query.q||'').trim().toLowerCase().slice(0,80);
    const membres=(await pool.query(`SELECT id,nom,fonction,role,zones FROM sh_utilisateurs WHERE actif AND supprime_le IS NULL ORDER BY nom`)).rows;
    const comp=(await pool.query('SELECT utilisateur_id,competence,niveau FROM sh_competences ORDER BY competence')).rows;
    const charge=(await pool.query(`SELECT t.responsable_id id,count(*)::int taches_ouvertes,
        count(*) FILTER (WHERE t.echeance < now()::date)::int en_retard,count(DISTINCT t.projet_id)::int projets,
        COALESCE(sum(GREATEST(COALESCE(t.temps_estime_minutes,0)-COALESCE(r.realise,0),0)),0)::int minutes_restantes,
        count(*) FILTER (WHERE t.temps_estime_minutes IS NULL)::int sans_estimation
      FROM sh_taches t LEFT JOIN (SELECT tache_id,sum(minutes) realise FROM sh_taches_temps GROUP BY tache_id) r ON r.tache_id=t.id
      WHERE t.responsable_id IS NOT NULL AND t.statut NOT IN ('terminee','annulee') GROUP BY t.responsable_id`)).rows;
    const parId=new Map(charge.map(x=>[x.id,x]));
    return membres.map(m=>({...m,competences:comp.filter(c=>c.utilisateur_id===m.id).map(({competence,niveau})=>({competence,niveau})),
      charge:parId.get(m.id)||{taches_ouvertes:0,en_retard:0,projets:0,minutes_restantes:0,sans_estimation:0}}))
      .filter(m=>!q||m.competences.some(c=>c.competence.toLowerCase().includes(q))||m.zones.some(z=>z.toLowerCase().includes(q)));
  }));
  api.put('/equipe/:id/competences',route(req=>transaction(pool,async c=>{
    const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)throw erreur(400,'Identifiant invalide.');
    const u=(await c.query('SELECT id,nom FROM sh_utilisateurs WHERE id=$1 AND supprime_le IS NULL FOR UPDATE',[id])).rows[0];
    if(!u)throw erreur(404,'Compte introuvable.');
    const liste=Array.isArray(req.body.competences)?req.body.competences:[];
    if(liste.length>40)throw erreur(400,'Quarante compétences au plus.');
    const vues=new Set();
    const propres=liste.map(x=>{const competence=String(x.competence||'').trim().slice(0,80),niveau=String(x.niveau||'');
      if(competence.length<2||!NIVEAUX_COMPETENCE.includes(niveau))throw erreur(400,'Chaque compétence exige un libellé et un niveau (notions, autonome, expert).');
      if(vues.has(competence.toLowerCase()))throw erreur(400,'Compétence en double.');vues.add(competence.toLowerCase());return {competence,niveau};});
    const zones=(Array.isArray(req.body.zones)?req.body.zones:[]).map(z=>String(z).trim().slice(0,60)).filter(Boolean);
    if(zones.length>20)throw erreur(400,'Vingt zones au plus.');
    await c.query('DELETE FROM sh_competences WHERE utilisateur_id=$1',[id]);
    for(const x of propres)await c.query('INSERT INTO sh_competences(utilisateur_id,competence,niveau,modifie_par) VALUES($1,$2,$3,$4)',[id,x.competence,x.niveau,req.u.id]);
    await c.query('UPDATE sh_utilisateurs SET zones=$2 WHERE id=$1',[id,[...new Set(zones)]]);
    await journal(c,req.u,'Compétences modifiées',`membre ${id}`,`${propres.length} compétence(s) · ${zones.length} zone(s)`);
    return {competences:propres,zones:[...new Set(zones)]};
  })));
}
module.exports={brancher};
