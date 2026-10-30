'use strict';
/**
 * Parcours d'implantation détaillé (cahier §11) : 17 étapes avec responsable, livrables, dépendances, statut et preuves.
 * Avancement réel = étapes terminées ou non applicables ; aucune étape terminée sans preuve ni avant ses dépendances.
 */
const {transaction}=require('../db');
const erreur=(statut,message)=>Object.assign(new Error(message),{statut});
const ETAPES=[
  ['cadrage','Cadrage du projet',[]],['etablissements','Recensement des établissements',['cadrage']],
  ['collecte','Collecte des services, chambres, lits et civières',['etablissements']],['modules','Configuration des modules',['cadrage']],
  ['utilisateurs','Création des utilisateurs',['etablissements']],['permissions','Configuration des permissions',['utilisateurs']],
  ['connexions','Connexion aux systèmes existants (si prévue)',['cadrage']],['import','Importation et validation des données',['collecte']],
  ['formation','Formation',['utilisateurs','permissions']],['tests','Tests de bout en bout',['import','modules','permissions']],
  ['uat','Recette utilisateur (UAT)',['tests','formation']],['securite','Validation de sécurité et de confidentialité',['tests']],
  ['sauvegarde','Sauvegarde',['import']],['autorisation','Autorisation de mise en service',['uat','securite','sauvegarde','connexions']],
  ['golive','Go Live',['autorisation']],['stabilisation','Surveillance et stabilisation',['golive']],['support','Support continu',['stabilisation']],
].map(([code,nom,dependances])=>({code,nom,dependances}));
const PAR_CODE=new Map(ETAPES.map(e=>[e.code,e]));
const FAITES=new Set(['terminee','non_applicable']);
const id=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw erreur(400,'Identifiant invalide.');return n;};
const texte=(v,max)=>String(v??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max);
async function parcours(db,hopitalId){
  const lignes=new Map((await db.query(`SELECT d.*,u.nom responsable FROM sh_deploiement_etapes d LEFT JOIN sh_utilisateurs u ON u.id=d.responsable_id WHERE hopital_id=$1`,[hopitalId])).rows.map(r=>[r.code,r]));
  const etapes=ETAPES.map((e,i)=>{const l=lignes.get(e.code)||{};return {rang:i+1,code:e.code,nom:e.nom,dependances:e.dependances,statut:l.statut||'a_faire',responsable_id:l.responsable_id||null,
    responsable:l.responsable||null,livrables:l.livrables||null,notes:l.notes||null,motif:l.motif||null,preuves:l.preuves||[],modifie_le:l.modifie_le||null};});
  const statut=new Map(etapes.map(e=>[e.code,e.statut]));
  for(const e of etapes){e.manque=e.dependances.filter(d=>!FAITES.has(statut.get(d)));e.prete=!FAITES.has(e.statut)&&!e.manque.length;}
  const faites=etapes.filter(e=>FAITES.has(e.statut)).length;
  return {etapes,avancement:Math.round(100*faites/ETAPES.length),
    actions_bloquantes:etapes.filter(e=>e.statut==='bloquee'||(e.prete&&!e.responsable_id)).map(e=>({code:e.code,nom:e.nom,raison:e.statut==='bloquee'?'bloquee':'sans_responsable'})),
    prochaines:etapes.filter(e=>e.prete&&e.statut!=='bloquee').map(e=>e.code)};
}
function brancher(api,pool,route,journal){
  async function hopital(db,req){const h=(await db.query('SELECT id,nom,code_etab FROM hopitaux WHERE id=$1',[id(req.params.id)])).rows[0];if(!h)throw erreur(404,'Hôpital introuvable.');return h;}
  api.get('/hopitaux/:id/deploiement',route(async req=>parcours(pool,(await hopital(pool,req)).id)));
  api.put('/hopitaux/:id/deploiement/:code',route(req=>transaction(pool,async c=>{
    const h=await hopital(c,req),e=PAR_CODE.get(String(req.params.code));if(!e)throw erreur(404,'Étape de déploiement inconnue.');
    await c.query("SELECT pg_advisory_xact_lock(hashtext('sh-deploiement'),$1)",[h.id]);
    const avant=(await parcours(c,h.id)).etapes.find(x=>x.code===e.code),b=req.body||{};
    const statut=b.statut===undefined?avant.statut:String(b.statut);
    if(!['a_faire','en_cours','bloquee','terminee','non_applicable'].includes(statut))throw erreur(400,'Statut d’étape invalide.');
    if(statut==='non_applicable'&&(e.code!=='connexions'||texte(b.motif,500).length<10))throw erreur(400,'Seule la connexion aux systèmes existants peut être non applicable, avec un motif.');
    if(statut==='terminee'&&avant.statut!=='terminee'){
      if(avant.manque.length)throw erreur(409,`Étapes préalables à terminer : ${avant.manque.map(d=>PAR_CODE.get(d).nom).join(', ')}.`);
      if(!avant.preuves.length)throw erreur(409,'Ajoutez au moins une preuve avant de terminer l’étape.');
    }
    const responsable=b.responsable_id===undefined?avant.responsable_id:(b.responsable_id?id(b.responsable_id):null);
    if(responsable&&!(await c.query('SELECT 1 FROM sh_utilisateurs WHERE id=$1 AND actif AND supprime_le IS NULL',[responsable])).rowCount)throw erreur(400,'Responsable inconnu ou inactif.');
    await c.query(`INSERT INTO sh_deploiement_etapes(hopital_id,code,statut,responsable_id,livrables,notes,motif,modifie_par) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(hopital_id,code) DO UPDATE SET statut=EXCLUDED.statut,responsable_id=EXCLUDED.responsable_id,livrables=EXCLUDED.livrables,notes=EXCLUDED.notes,motif=EXCLUDED.motif,modifie_par=EXCLUDED.modifie_par,modifie_le=now()`,
      [h.id,e.code,statut,responsable,b.livrables===undefined?avant.livrables:texte(b.livrables,2000)||null,b.notes===undefined?avant.notes:texte(b.notes,2000)||null,statut==='non_applicable'?texte(b.motif,500):null,req.u.id]);
    await journal(c,req.u,'Étape de déploiement modifiée',`${h.code_etab} · ${e.nom}`,statut,h.id);
    return parcours(c,h.id);
  })));
  api.post('/hopitaux/:id/deploiement/:code/preuves',route(req=>transaction(pool,async c=>{
    const h=await hopital(c,req),e=PAR_CODE.get(String(req.params.code));if(!e)throw erreur(404,'Étape de déploiement inconnue.');
    const type=String(req.body.type||''),valeur=texte(req.body.valeur,500);
    if(!['lien','note','document'].includes(type)||valeur.length<3)throw erreur(400,'Preuve invalide : lien HTTPS, note ou document.');
    if(type==='lien'&&!/^https:\/\/\S+$/i.test(valeur))throw erreur(400,'Un lien de preuve doit être en HTTPS.');
    if(type==='document'&&!(await c.query('SELECT 1 FROM sh_documents WHERE id=$1 AND hopital_id=$2',[id(valeur),h.id])).rowCount)throw erreur(400,'Document introuvable pour cet hôpital.');
    const preuve={type,valeur,ajoute_par:req.u.nom,ajoute_le:new Date().toISOString()};
    await c.query(`INSERT INTO sh_deploiement_etapes(hopital_id,code,preuves,modifie_par) VALUES($1,$2,$3::jsonb,$4)
      ON CONFLICT(hopital_id,code) DO UPDATE SET preuves=sh_deploiement_etapes.preuves||$3::jsonb,modifie_par=EXCLUDED.modifie_par,modifie_le=now()`,[h.id,e.code,JSON.stringify([preuve]),req.u.id]);
    await journal(c,req.u,'Preuve de déploiement ajoutée',`${h.code_etab} · ${e.nom}`,type,h.id);
    return parcours(c,h.id);
  })));
}
module.exports={brancher,parcours,ETAPES};
