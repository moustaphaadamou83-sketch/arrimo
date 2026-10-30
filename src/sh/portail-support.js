'use strict';
const express=require('express'),crypto=require('node:crypto');
const {ErreurHttp,transaction}=require('../db');
const {notifier}=require('./automatisations');
const {NOMS}=require('./cibles');
const documents=require('./documents');
const PRIORITES={basse:168,normale:72,haute:24,urgente:4};
const CATEGORIES=['bug','amelioration','assistance','formation','acces','autre'];
const COLONNES='id,reference,titre,description,statut,priorite,type,categorie,projet_id,cree_le,echeance,resolu_le,resolution,prise_en_charge_le,prise_en_charge_echeance,resolution_echeance,CASE WHEN sla_id IS NULL THEN \'standard\' ELSE \'contractuel\' END sla_nature';
const invalide=nom=>new ErreurHttp(400,'parametre_invalide',{nom});
function texte(v,max,nom,{requis=false}={}){
  if(v!==undefined&&typeof v!=='string')throw invalide(nom);
  const s=(v||'').trim();if(s.length>max||(requis&&!s))throw invalide(nom);return s||null;
}
function brancher(api,pool,env){
  const router=express.Router();
  const route=fn=>(req,res,next)=>Promise.resolve().then(async()=>{
    if(!Object.hasOwn(NOMS,req.params.environnement))throw new ErreurHttp(401,'cle_sh_invalide');
    const cle=env[`SH_SUPPORT_${req.params.environnement.toUpperCase()}_CLE`];
    if(typeof cle==='string'&&Object.entries(env).some(([nom,valeur])=>/^SH_SUPPORT_(DEMO|DEMO_ABC|RECETTE|PILOTE|PRODUCTION)_CLE$/.test(nom)&&nom!==`SH_SUPPORT_${req.params.environnement.toUpperCase()}_CLE`&&valeur===cle))throw new ErreurHttp(401,'cle_sh_invalide');
    const fournie=req.get('x-support-key')||'';
    if(typeof cle!=='string'||cle.length<32||Buffer.byteLength(cle)!==Buffer.byteLength(fournie)||!crypto.timingSafeEqual(Buffer.from(cle),Buffer.from(fournie)))throw new ErreurHttp(401,'cle_sh_invalide');
    const code=String(req.params.code||'');if(!/^[A-Z0-9-]{2,12}$/.test(code))throw invalide('code');
    const h=(await pool.query('SELECT id,code_etab,environnement FROM hopitaux WHERE environnement=$1 AND code_etab=$2 AND relie',[req.params.environnement,code])).rows[0];
    if(!h)throw new ErreurHttp(404,'etab_introuvable');
    return fn(req,h,res);
  }).then(r=>{if(r&&r.__fichier){res.set({'Content-Type':r.mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(r.nom)}`,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}).send(r.contenu);}else res.json(r);}).catch(next);
  const base='/:environnement/:code';
  async function notifierAdministration(c,titre){
    const ids=(await c.query("SELECT id FROM sh_utilisateurs WHERE role='administration' AND role_personnalise_id IS NULL AND actif AND archive_le IS NULL")).rows.map(u=>u.id);
    await notifier(c,ids,{type:'support',titre,lien:'support'});
  }
  async function notifierParCourriel(c,h,ticketId,evenement,adresses=[]){
    const support=require('./support-courriels'),internes=await support.destinatairesInternes(c,h.id);
    await support.ajouter(c,ticketId,evenement,[...internes,...adresses]);
  }
  async function ticket(c,h,identifiant,{verrou=false}={}){
    const id=Number(identifiant);if(!Number.isSafeInteger(id)||id<1)throw invalide('ticket');
    const t=(await c.query(`SELECT ${COLONNES} FROM sh_support_tickets WHERE id=$1 AND hopital_id=$2 AND client_visible${verrou?' FOR UPDATE':''}`,[id,h.id])).rows[0];
    if(!t)throw new ErreurHttp(404,'support_ticket_introuvable');return t;
  }
  router.get(base+'/configuration',route(()=>({disponible:true})));
  router.get(base+'/tickets',route(async(req,h)=>{
    const avant=require('../support-pagination').curseur(req.query.avant);
    const rows=(await pool.query(`SELECT ${COLONNES} FROM sh_support_tickets WHERE hopital_id=$1 AND client_visible AND($2::bigint IS NULL OR id<$2)
      ORDER BY id DESC LIMIT 201`,[h.id,avant])).rows;
    return {tickets:rows.slice(0,200),avant_suivant:rows.length>200?rows[199].id:null};
  }));
  router.get(base+'/projets',route(async(req,h)=>(await pool.query('SELECT id,nom FROM sh_projets WHERE hopital_id=$1 AND archive_le IS NULL ORDER BY nom',[h.id])).rows));
  router.get(base+'/tickets/:id',route(async(req,h)=>{
    const t=await ticket(pool,h,req.params.id);
    const messages=(await pool.query(`SELECT id,message,cree_le,CASE WHEN auteur_id IS NULL THEN COALESCE(auteur_client,'Client') ELSE 'Support' END auteur
      FROM sh_support_messages WHERE ticket_id=$1 AND NOT interne ORDER BY cree_le,id`,[t.id])).rows;
    const pieces=(await pool.query(`SELECT id,nom,type_mime,taille,cree_le FROM sh_documents WHERE ticket_id=$1 AND hopital_id=$2 AND archive_le IS NULL ORDER BY cree_le,id`,[t.id,h.id])).rows;
    return {...t,messages,pieces_jointes:pieces};
  }));
  router.post(base+'/tickets/:id/pieces-jointes',route(async(req,h)=>transaction(pool,async c=>{
    const t=await ticket(c,h,req.params.id,{verrou:true});
    if(t.statut==='ferme')throw new ErreurHttp(409,'support_ticket_ferme');
    let f;try{f=documents.valider(req.body?.nom,req.body?.contenu_base64);}catch{throw invalide('fichier');}
    const stocke=await documents.ecrire(f.octets,env);
    const d=(await c.query(`INSERT INTO sh_documents(nom,categorie,stockage_ref,version,depose_par,type_mime,taille,empreinte,confidentiel,groupe,hopital_id,ticket_id)
      VALUES($1,'support',$2,1,NULL,$3,$4,$5,false,$6,$7,$8) RETURNING id,nom,type_mime,taille,cree_le`,[f.nom,stocke.stockage_ref,f.mime,f.octets.length,stocke.empreinte,'support-'+crypto.randomUUID(),h.id,t.id])).rows[0];
    await c.query("INSERT INTO sh_journal(hopital_id,action,cible,detail) VALUES($1,'Pièce jointe ajoutée au ticket',$2,$3)",[h.id,t.reference,`${d.nom} · ${d.taille} octets`]);
    await notifierAdministration(c,`Pièce jointe ajoutée : ${t.reference}`);await notifierParCourriel(c,h,t.id,'piece_jointe');return d;
  })));
  router.get(base+'/tickets/:id/pieces-jointes/:document_id/fichier',route(async(req,h)=>{
    const t=await ticket(pool,h,req.params.id);
    const documentId=Number(req.params.document_id);if(!Number.isSafeInteger(documentId)||documentId<1)throw invalide('document');
    const d=(await pool.query('SELECT * FROM sh_documents WHERE id=$1 AND ticket_id=$2 AND hopital_id=$3 AND categorie=\'support\' AND archive_le IS NULL',[documentId,t.id,h.id])).rows[0];
    if(!d)throw new ErreurHttp(404,'support_document_introuvable');
    const contenu=await documents.lire(d,env);
    await pool.query("INSERT INTO sh_journal(hopital_id,action,cible,detail) VALUES($1,'Pièce jointe ticket téléchargée',$2,$3)",[h.id,t.reference,d.nom]);
    return {__fichier:true,nom:d.nom,mime:d.type_mime||'application/octet-stream',contenu};
  }));
  router.post(base+'/tickets',route((req,h)=>transaction(pool,async c=>{
    const b=req.body||{};
    const titre=texte(b.titre,180,'titre',{requis:true}),description=texte(b.description,4000,'description',{requis:true});
    const demandeur=texte(b.demandeur,200,'demandeur',{requis:true});
    const priorite=b.priorite||'normale',type=b.type||'demande',categorie=b.categorie||'autre';
    if(!Object.hasOwn(PRIORITES,priorite)||!['demande','incident','question'].includes(type)||!CATEGORIES.includes(categorie))throw invalide('ticket');
    const projet=b.projet_id==null?null:Number(b.projet_id);
    if(projet!==null&&(!Number.isSafeInteger(projet)||projet<1||!(await c.query('SELECT id FROM sh_projets WHERE id=$1 AND hopital_id=$2 AND archive_le IS NULL FOR SHARE',[projet,h.id])).rowCount))throw invalide('projet');
    const t=(await c.query(`INSERT INTO sh_support_tickets(hopital_id,titre,description,priorite,type,categorie,projet_id,demandeur_client,client_visible,echeance)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,now()+make_interval(hours=>$9)) RETURNING ${COLONNES}`,[h.id,titre,description,priorite,type,categorie,projet,demandeur,PRIORITES[priorite]])).rows[0];
    await c.query("INSERT INTO sh_journal(hopital_id,action,cible,detail) VALUES($1,'Ticket client créé',$2,$3)",[h.id,t.reference,'Portail client ; '+demandeur]);
    await notifierAdministration(c,`Nouvelle demande client : ${t.reference}`);
    await notifierParCourriel(c,h,t.id,'ticket_cree',[demandeur]);
    return t;
  })));
  router.post(base+'/tickets/:id/messages',route((req,h)=>transaction(pool,async c=>{
    const t=await ticket(c,h,req.params.id,{verrou:true});
    if(t.statut==='ferme')throw new ErreurHttp(409,'support_ticket_ferme');
    const message=texte(req.body?.message,8000,'message',{requis:true}),auteur=texte(req.body?.demandeur,200,'demandeur',{requis:true});
    await c.query('INSERT INTO sh_support_messages(ticket_id,message,interne,auteur_client) VALUES($1,$2,false,$3)',[t.id,message,auteur]);
    await c.query("INSERT INTO sh_journal(hopital_id,action,cible,detail) VALUES($1,'Message client ajouté',$2,'Portail client')",[h.id,t.reference]);
    await notifierAdministration(c,`Nouveau message client : ${t.reference}`);
    await notifierParCourriel(c,h,t.id,'message_client');
    return {ok:true};
  })));
  api.use('/portail-support',router);
}
module.exports={brancher};
