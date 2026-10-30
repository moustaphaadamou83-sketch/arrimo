'use strict';
const {transaction}=require('../db'),{notifier}=require('./automatisations'),{verifierDestinataire}=require('./notifications-perimetres');
const {CALENDRIER_CONTINU}=require('./support-calendrier-migrations');
const erreur=(statut,message)=>Object.assign(new Error(message),{statut});
const PRIORITES=['basse','normale','haute','urgente'];
function reglesPropres(regles){
 if(!regles||Array.isArray(regles)||typeof regles!=='object'||Object.keys(regles).length!==4)throw erreur(400,'Règles SLA invalides.');
 const propre={};for(const p of PRIORITES){const r=regles[p];if(!r||Array.isArray(r)||typeof r!=='object'||Object.keys(r).length!==3)throw erreur(400,'Règles SLA invalides.');
  for(const [k,max,min]of [['prise_en_charge_minutes',525600,1],['resolution_minutes',525600,1],['escalade_apres_minutes',43200,0]])if(!Number.isInteger(r[k])||r[k]<min||r[k]>max)throw erreur(400,'Règles SLA invalides.');
  if(r.resolution_minutes<r.prise_en_charge_minutes)throw erreur(400,'La résolution doit suivre la prise en charge.');propre[p]={prise_en_charge_minutes:r.prise_en_charge_minutes,resolution_minutes:r.resolution_minutes,escalade_apres_minutes:r.escalade_apres_minutes};
 }return propre;
}
function calendrierPropre(v){
 if(v===undefined||v===null)return CALENDRIER_CONTINU;
 if(!v||Array.isArray(v)||typeof v!=='object'||!['continu','ouvrable'].includes(v.mode))throw erreur(400,'Calendrier SLA invalide.');
 if(v.mode==='continu')return CALENDRIER_CONTINU;
 const jours=v.jours,feries=v.jours_feries;
 if(!Array.isArray(jours)||!jours.length||jours.length>7||jours.some(x=>!Number.isInteger(x)||x<1||x>7)||new Set(jours).size!==jours.length||!Array.isArray(feries)||feries.length>366||
   feries.some(x=>typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x)||!Number.isFinite(Date.parse(x+'T00:00:00Z'))||new Date(x+'T00:00:00Z').toISOString().slice(0,10)!==x)||
   typeof v.debut!=='string'||typeof v.fin!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.debut)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.fin)||v.debut>=v.fin)throw erreur(400,'Calendrier SLA invalide.');
 return {mode:'ouvrable',jours:[...jours].sort(),debut:v.debut,fin:v.fin,jours_feries:[...new Set(feries)].sort()};
}
const id=v=>(typeof v==='number'||typeof v==='string'&&/^[1-9][0-9]*$/.test(v))&&Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
async function executerEscalades(pool,{maintenant}={}){
 const date=maintenant?new Date(maintenant):(await pool.query('SELECT now() date')).rows[0].date;if(Number.isNaN(+date))throw new Error('Date invalide');
 return transaction(pool,async c=>{
  const tickets=(await c.query(`SELECT * FROM sh_support_tickets WHERE sla_snapshot IS NOT NULL AND statut NOT IN('resolu','ferme')
   AND((prise_en_charge_le IS NULL AND prise_en_charge_echeance+make_interval(mins=>(sla_snapshot->'regles'->priorite->>'escalade_apres_minutes')::int)<=$1 AND NOT EXISTS(SELECT 1 FROM sh_support_escalades e WHERE e.ticket_id=sh_support_tickets.id AND e.generation=sla_generation AND e.phase='prise_en_charge')) OR(resolution_echeance+make_interval(mins=>(sla_snapshot->'regles'->priorite->>'escalade_apres_minutes')::int)<=$1 AND NOT EXISTS(SELECT 1 FROM sh_support_escalades e WHERE e.ticket_id=sh_support_tickets.id AND e.generation=sla_generation AND e.phase='resolution'))) AND EXISTS(SELECT 1 FROM sh_utilisateurs u WHERE (u.id=(sla_snapshot->>'destinataire_id')::int OR(u.role='administration' AND u.role_personnalise_id IS NULL)) AND sh_notification_eligible(u.id,'support','ticket',sh_support_tickets.id,NULL)) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100`,[date])).rows;
  let creees=0;for(const t of tickets){
   const delai=t.sla_snapshot.regles[t.priorite].escalade_apres_minutes*60000;
   const phases=[...(!t.prise_en_charge_le&&t.prise_en_charge_echeance&&+new Date(t.prise_en_charge_echeance)+delai<=+date?['prise_en_charge']:[]),...(t.resolution_echeance&&+new Date(t.resolution_echeance)+delai<=+date?['resolution']:[])];
   if(!phases.length)continue;
   const cible=id(t.sla_snapshot.destinataire_id);
   let destinataires=cible?(await c.query("SELECT id FROM sh_utilisateurs WHERE id=$1 AND sh_notification_eligible(id,'support','ticket',$2,NULL)",[cible,t.id])).rows.map(u=>u.id):[];
   if(!destinataires.length)destinataires=(await c.query("SELECT id FROM sh_utilisateurs WHERE role='administration' AND role_personnalise_id IS NULL AND sh_notification_eligible(id,'support','ticket',$1,NULL)",[t.id])).rows.map(u=>u.id);
   if(!destinataires.length)continue;
   for(const phase of phases){
    const n=await c.query('INSERT INTO sh_support_escalades(ticket_id,generation,phase,destinataires) VALUES($1,$2,$3,$4) ON CONFLICT(ticket_id,generation,phase) DO NOTHING RETURNING id',[t.id,t.sla_generation,phase,destinataires]);if(!n.rowCount)continue;
    await notifier(c,destinataires,{type:'support',ressourceType:'ticket',ressourceId:t.id,titre:`Délai support dépassé : ${t.reference} · ${phase==='prise_en_charge'?'prise en charge':'résolution'}`,lien:'support',cle:`sla-${t.id}-${t.sla_generation}-${phase}`});
    await c.query("INSERT INTO sh_support_evenements(ticket_id,champ,apres,par) VALUES($1,'escalade',$2,'service SLA')",[t.id,phase]);creees++;
   }
  }return {escalades_creees:creees,tickets_examines:tickets.length};
 });
}
function brancher(api,pool,route,journal){
 const CONTRATS=`SELECT c.id,c.reference FROM sh_contrats c JOIN sh_opportunites o ON o.id=c.opportunite_id JOIN hopitaux h ON h.id=$1
  WHERE c.statut='signe' AND (c.hopital_id=h.id OR(c.hopital_id IS NULL AND h.organisation_id=o.organisation_id))
  AND(h.organisation_id IS NULL OR h.organisation_id=o.organisation_id) AND (now() AT TIME ZONE h.fuseau_horaire)::date BETWEEN c.date_debut AND c.date_fin`;
 api.get('/hopitaux/:id/support-sla',route(async req=>{
  const h=id(req.params.id);if(!(await pool.query('SELECT 1 FROM hopitaux WHERE id=$1',[h])).rowCount)throw erreur(404,'Établissement introuvable.');
  const politiques=(await pool.query('SELECT id,contrat_id,nom,regles,calendrier,actif,destinataire_id,cree_le FROM sh_support_sla WHERE hopital_id=$1 ORDER BY id DESC',[h])).rows;
  return {active:politiques.find(p=>p.actif)||null,historique:politiques,contrats: req.u.role==='administration'?(await pool.query(CONTRATS+' ORDER BY c.id',[h])).rows:[]};
 }));
 api.post('/hopitaux/:id/support-sla',route(async req=>{
  const h=id(req.params.id),b=req.body;if(!b||!Object.hasOwn(b,'version_attendue')||!(b.version_attendue===null||id(b.version_attendue)))throw erreur(400,'Version SLA requise.');
  const nom=typeof b.nom==='string'?b.nom.trim():'';if(!nom||nom.length>120||!id(b.contrat_id))throw erreur(400,'Nom et contrat SLA requis.');const regles=reglesPropres(b.regles),calendrier=calendrierPropre(b.calendrier);
  const destinataire=b.destinataire_id==null||b.destinataire_id===''?null:id(b.destinataire_id);if(b.destinataire_id!==null&&b.destinataire_id!==undefined&&b.destinataire_id!==''&&destinataire===null)throw erreur(400,'Destinataire SLA invalide.');
  return transaction(pool,async c=>{
   if(!(await c.query('SELECT id FROM hopitaux WHERE id=$1 FOR UPDATE',[h])).rowCount)throw erreur(404,'Établissement introuvable.');
   const actuelle=(await c.query('SELECT id FROM sh_support_sla WHERE hopital_id=$1 AND actif',[h])).rows[0]?.id||null;if(String(actuelle)!==String(b.version_attendue))throw erreur(409,'Les SLA ont changé : rechargez la fiche.');
   if(!(await c.query(CONTRATS+' AND c.id=$2 FOR SHARE OF c',[h,id(b.contrat_id)])).rowCount)throw erreur(409,'Un contrat signé en vigueur lié à cet établissement est requis.');
   if(destinataire)await verifierDestinataire(c,destinataire,'support','hopital',h);
   await c.query('UPDATE sh_support_sla SET actif=false WHERE hopital_id=$1 AND actif',[h]);
   const r=(await c.query('INSERT INTO sh_support_sla(hopital_id,contrat_id,nom,regles,calendrier,destinataire_id,cree_par) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[h,id(b.contrat_id),nom,regles,calendrier,destinataire,req.u.id])).rows[0];
   await journal(c,req.u,'SLA configurés',nom,'Nouvelle version ; tickets existants préservés',h);return r;
  });
 }));
 api.post('/hopitaux/:id/support-sla/desactiver',route(async req=>transaction(pool,async c=>{
  const h=id(req.params.id);if(!(await c.query('SELECT id FROM hopitaux WHERE id=$1 FOR UPDATE',[h])).rowCount)throw erreur(404,'Établissement introuvable.');
  const r=await c.query('UPDATE sh_support_sla SET actif=false WHERE hopital_id=$1 AND actif AND id=$2 RETURNING id',[h,id(req.body?.version_attendue)]);if(!r.rowCount)throw erreur(409,'Les SLA ont changé : rechargez la fiche.');await journal(c,req.u,'SLA désactivés',String(r.rows[0].id),'Tickets existants préservés',h);return {desactive:true};
 })));
 api.post('/support/tickets/:id/prise-en-charge',route(async req=>transaction(pool,async c=>{
  const r=await c.query("UPDATE sh_support_tickets SET prise_en_charge_le=COALESCE(prise_en_charge_le,now()),statut=CASE WHEN statut='ouvert' THEN 'en_cours' ELSE statut END WHERE id=$1 AND statut NOT IN('resolu','ferme') RETURNING *",[id(req.params.id)]);if(!r.rowCount)throw erreur(404,'Ticket ouvert introuvable.');await journal(c,req.u,'Ticket pris en charge',r.rows[0].reference,'Prise en charge explicite',r.rows[0].hopital_id);return r.rows[0];
 })));
 api.post('/support/escalades/executer',route(()=>executerEscalades(pool)));
}
module.exports={reglesPropres,calendrierPropre,executerEscalades,brancher};
