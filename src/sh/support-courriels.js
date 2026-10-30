'use strict';
const crypto=require('node:crypto');
const {transaction}=require('../db');
const courriel=require('../courriel');
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function ajouter(c,ticketId,evenement,adresses){
 const propres=[...new Set((Array.isArray(adresses)?adresses:[adresses]).map(x=>String(x||'').trim().toLowerCase()).filter(x=>x.length<=254&&EMAIL.test(x)))];
 for(const adresse of propres)await c.query('INSERT INTO sh_support_courriels(ticket_id,destinataire,evenement,cle) VALUES($1,$2,$3,$4) ON CONFLICT(cle) DO NOTHING',[ticketId,adresse,evenement,crypto.randomUUID()]);
 return propres.length;
}
async function destinatairesInternes(c,hopitalId){
 return (await c.query(`SELECT DISTINCT u.email FROM sh_utilisateurs u WHERE u.actif AND u.archive_le IS NULL AND u.role_personnalise_id IS NULL
  AND (u.role='administration' OR(u.role IN('support','implantation') AND EXISTS(SELECT 1 FROM sh_affectations a WHERE a.utilisateur_id=u.id AND a.type='hopital' AND a.hopital_id=$1)))`,[hopitalId])).rows.map(x=>x.email);
}
async function executer(pool,{env=process.env,limite=30}={}){
 if(!courriel.actif(env.SH_PUBLIC_URL,env))return {actif:false,envoyes:0,echecs:0};
 const lignes=await transaction(pool,async c=>{
  const rows=(await c.query(`SELECT m.id,m.ticket_id,m.destinataire,m.evenement,t.reference,t.statut FROM sh_support_courriels m
   JOIN sh_support_tickets t ON t.id=m.ticket_id WHERE (m.etat='en_attente' AND m.prochaine_tentative<=now()) OR(m.etat='envoi' AND m.verrou_jusqua<now())
   ORDER BY m.id FOR UPDATE OF m SKIP LOCKED LIMIT $1`,[Math.max(1,Math.min(100,limite))])).rows;
  for(const x of rows)await c.query("UPDATE sh_support_courriels SET etat='envoi',tentatives=tentatives+1,verrou_jusqua=now()+interval '2 minutes' WHERE id=$1",[x.id]);
  return rows;
 });
 let envoyes=0,echecs=0;
 for(const x of lignes){
  try{
   const label={ticket_cree:'Un ticket de support a été créé.',message_client:'Un nouveau message client attend votre réponse.',reponse_support:'Une réponse du support est disponible.',statut:'Le statut de votre ticket a été mis à jour.',piece_jointe:'Une pièce jointe a été ajoutée à votre ticket.',ticket_attribue:'Un ticket de support vous a été attribué.'}[x.evenement];
   await courriel.envoyer({a:x.destinataire,sujet:`Arrimo Support · ${x.reference}`,texte:`${label}\nRéférence : ${x.reference}\nStatut : ${x.statut}.\nConnectez-vous à Arrimo pour consulter le suivi. Aucun détail du ticket n’est inclus dans ce courriel.`},env);
   await pool.query("UPDATE sh_support_courriels SET etat='envoye',envoye_le=now(),verrou_jusqua=NULL,dernier_code=NULL WHERE id=$1",[x.id]);envoyes++;
  }catch(e){
   const tentatives=(await pool.query('SELECT tentatives FROM sh_support_courriels WHERE id=$1',[x.id])).rows[0]?.tentatives||1;
   const code=String(e.code||e.name||'ERREUR').replace(/[^A-Za-z0-9_-]/g,'').slice(0,40)||'ERREUR';
   await pool.query("UPDATE sh_support_courriels SET etat=$2,verrou_jusqua=NULL,prochaine_tentative=now()+make_interval(secs=>$3),dernier_code=$4 WHERE id=$1",[x.id,tentatives>=8?'abandonne':'en_attente',Math.min(21600,30*2**Math.min(tentatives-1,10)),code]);echecs++;
  }
 }
 return {actif:true,envoyes,echecs};
}
module.exports={ajouter,destinatairesInternes,executer};
