'use strict';
const {ErreurHttp}=require('./db');
const {exigerEtablissement}=require('./auth');
const environnement=require('./environnement');
const CIBLES=['demo','demo_abc','recette','pilote','production'];
function configuration(env=process.env){
  const url=env.ARRIMO_SUPPORT_SH_URL,cle=env.ARRIMO_SUPPORT_CLE;
  const mode=environnement.environnement(),cible=env.ARRIMO_SUPPORT_CIBLE||mode;
  if(!url||typeof cle!=='string'||cle.length<32||!CIBLES.includes(cible)||(cible!==mode&&!(mode==='demo'&&cible==='demo_abc')))return null;
  try{const u=new URL(url);if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))return null;return {url:u.href.replace(/\/$/,''),cle,cible};}catch{return null;}
}
// Appel du portail support de SH au nom de l'utilisateur connecté (interface ou action OG confirmée).
async function envoyerAvec(pool,env,req,method,suffixe,body){
    const id=Number(req.query.etablissement_id??req.body?.etablissement_id);
    if(!Number.isSafeInteger(id)||id<1)throw new ErreurHttp(400,'parametre_invalide',{nom:'etablissement_id'});
    exigerEtablissement(req.utilisateur,id);
    const e=(await pool.query('SELECT code FROM etablissements WHERE id=$1',[id])).rows[0];
    if(!e)throw new ErreurHttp(404,'etab_introuvable');
    const cfg=configuration(env);if(!cfg)throw new ErreurHttp(503,'support_indisponible');
    let r;
    try{r=await fetch(`${cfg.url}/api/portail-support/${cfg.cible}/${encodeURIComponent(e.code)}${suffixe}`,{method,headers:{'Content-Type':'application/json','X-Support-Key':cfg.cle},body:body?JSON.stringify({...body,demandeur:req.utilisateur.email}):undefined,signal:AbortSignal.timeout(8000)});}catch{throw new ErreurHttp(502,'support_indisponible');}
    const data=await r.json().catch(()=>null);
    if(!r.ok){if([400,404,409].includes(r.status)&&['support_ticket_introuvable','support_ticket_ferme','parametre_invalide','etab_introuvable'].includes(data?.code))throw new ErreurHttp(r.status,data.code,data.vars);throw new ErreurHttp(502,'support_indisponible');}
    return data;
}
/** Ticket créé par une action OG confirmée : même canal, mêmes contrôles que l'interface. */
function creerTicket(pool,u,etab,ticket,env=process.env){
  return envoyerAvec(pool,env,{query:{etablissement_id:etab},body:{etablissement_id:etab},utilisateur:u},'POST','/tickets',ticket);
}
function brancher(api,pool,route,{env=process.env}={}){
  const envoyer=(req,method,suffixe,body)=>envoyerAvec(pool,env,req,method,suffixe,body);
  async function envoyerFichier(req,res){
    const id=Number(req.query.etablissement_id);if(!Number.isSafeInteger(id)||id<1)throw new ErreurHttp(400,'parametre_invalide',{nom:'etablissement_id'});
    exigerEtablissement(req.utilisateur,id);const e=(await pool.query('SELECT code FROM etablissements WHERE id=$1',[id])).rows[0];if(!e)throw new ErreurHttp(404,'etab_introuvable');
    const cfg=configuration(env);if(!cfg)throw new ErreurHttp(503,'support_indisponible');
    let r;try{r=await fetch(`${cfg.url}/api/portail-support/${cfg.cible}/${encodeURIComponent(e.code)}/tickets/${idPositifRoute(req.params.id)}/pieces-jointes/${idPositifRoute(req.params.document_id)}/fichier`,{headers:{'X-Support-Key':cfg.cle},signal:AbortSignal.timeout(8000)});}catch{throw new ErreurHttp(502,'support_indisponible');}
    if(!r.ok)throw new ErreurHttp(r.status===404?404:502,r.status===404?'support_ticket_introuvable':'support_indisponible');
    res.set({'Content-Type':r.headers.get('content-type')||'application/octet-stream','Content-Disposition':r.headers.get('content-disposition')||'attachment','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}).send(Buffer.from(await r.arrayBuffer()));
  }
  api.get('/support/configuration',route(async req=>{
    if(!configuration(env))return {disponible:false};
    // Compatibilité des anciens clients : aucun renseignement d'établissement sans identifiant autorisé.
    if(req.query.etablissement_id===undefined)return {disponible:true};
    try{return await envoyer(req,'GET','/configuration');}
    catch(e){
      if(e.code==='etab_introuvable')return {disponible:false,motif:'non_raccorde'};
      if(e.statut>=500)return {disponible:false,motif:'indisponible'};
      throw e;
    }
  }));
  const corps=req=>{if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw new ErreurHttp(400,'parametre_invalide',{nom:'ticket'});return req.body;};
  const id=req=>{const n=Number(req.params.id);if(!Number.isSafeInteger(n)||n<1)throw new ErreurHttp(400,'parametre_invalide',{nom:'ticket'});return n;};
  api.get('/support/tickets',route(req=>{const avant=require('./support-pagination').curseur(req.query.avant);return envoyer(req,'GET','/tickets'+(avant?'?avant='+avant:''));}));
  api.get('/support/projets',route(req=>envoyer(req,'GET','/projets')));
  api.get('/support/tickets/:id',route(req=>envoyer(req,'GET',`/tickets/${id(req)}`)));
  api.post('/support/tickets',route(req=>envoyer(req,'POST','/tickets',Object.fromEntries(['titre','description','type','categorie','priorite','projet_id'].filter(k=>corps(req)[k]!==undefined).map(k=>[k,corps(req)[k]])))));
  api.post('/support/tickets/:id/messages',route(req=>envoyer(req,'POST',`/tickets/${id(req)}/messages`,{message:corps(req).message})));
  api.post('/support/tickets/:id/pieces-jointes',route(req=>envoyer(req,'POST',`/tickets/${id(req)}/pieces-jointes`,{nom:corps(req).nom,contenu_base64:corps(req).contenu_base64})));
  api.get('/support/tickets/:id/pieces-jointes/:document_id/fichier',(req,res,next)=>envoyerFichier(req,res).catch(next));
}
function idPositifRoute(v){const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw new ErreurHttp(400,'parametre_invalide',{nom:'ticket'});return n;}
module.exports={brancher,configuration,creerTicket};
