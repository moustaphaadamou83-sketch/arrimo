'use strict';
const erreur=(statut,message)=>Object.assign(new Error(message),{statut});
const TYPES_PROJET=['pilote','implantation','extension','integration','migration','maintenance','mise_a_niveau'];
async function equipeValidee(c,responsable,membres,{pilote=false}={}){
  if(!Array.isArray(membres)||membres.length>500)throw erreur(400,'Équipe de projet invalide.');
  if(membres.some(id=>!Number.isSafeInteger(Number(id))||Number(id)<1))throw erreur(400,'Membre de projet invalide.');
  const ids=[...new Set([...membres.map(Number),...(responsable?[Number(responsable)]:[])])];
  if(pilote&&(!responsable||ids.length<2))throw erreur(400,'Un pilote requiert un chef de projet et au moins deux membres actifs.');
  if(responsable&&(!Number.isSafeInteger(Number(responsable))||Number(responsable)<1))throw erreur(400,'Chef de projet invalide.');
  const r=await c.query('SELECT id FROM sh_utilisateurs WHERE id=ANY($1::int[]) AND actif AND archive_le IS NULL',[ids]);
  if(r.rowCount!==ids.length)throw erreur(400,'Les membres du projet doivent être des employés SH actifs.');
  return ids;
}
async function enregistrerEquipe(c,projet,ids){
  await c.query('DELETE FROM sh_projet_membres WHERE projet_id=$1',[projet]);
  for(const id of ids)await c.query('INSERT INTO sh_projet_membres(projet_id,utilisateur_id) VALUES($1,$2)',[projet,id]);
}
async function exigerTachesCritiquesTerminees(c,hopital){
  const {rows}=await c.query(`SELECT count(*)::int n FROM sh_taches t JOIN sh_projets p ON p.id=t.projet_id
    WHERE p.hopital_id=$1 AND p.statut NOT IN ('termine','annule') AND t.critique_golive AND t.statut<>'terminee'`,[hopital]);
  if(rows[0].n)throw erreur(409,'Activation impossible : des tâches critiques du Go Live ne sont pas terminées.');
}
module.exports={TYPES_PROJET,equipeValidee,enregistrerEquipe,exigerTachesCritiquesTerminees};
