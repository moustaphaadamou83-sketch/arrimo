'use strict';
/** Pilotage de projet : étape Kanban (14 étapes du cahier) et registre des risques et décisions. */
const {transaction}=require('../db');
const {ETAPES_PROJET}=require('./projets-pilotage-migrations');
const erreur=(statut,message)=>Object.assign(new Error(message),{statut});
const id=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw erreur(400,'Identifiant invalide.');return n;};
const NIVEAUX=['faible','moderee','elevee'];
const jourOuNull=v=>{if(v==null||v==='')return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v)))throw erreur(400,'Date invalide (AAAA-MM-JJ).');return String(v);};
function brancher(api,pool,route,journal){
  async function projet(db,req){
    const p=(await db.query('SELECT id,nom,hopital_id,etape,archive_le FROM sh_projets WHERE id=$1 FOR UPDATE',[id(req.params.id)])).rows[0];
    if(!p)throw erreur(404,'Projet introuvable.');return p;
  }
  api.put('/projets/:id/etape',route(req=>transaction(pool,async c=>{
    const p=await projet(c,req),etape=String(req.body.etape||'');
    if(!ETAPES_PROJET.includes(etape))throw erreur(400,'Étape de projet invalide.');
    if(p.etape===etape)return {etape};
    await c.query('UPDATE sh_projets SET etape=$2,etape_le=now() WHERE id=$1',[p.id,etape]);
    await journal(c,req.u,'Étape de projet modifiée',p.nom,`${p.etape||'à classer'} → ${etape}`,p.hopital_id);
    return {etape};
  })));
  api.get('/projets/:id/registre',route(async req=>{
    const pid=id(req.params.id);
    if(!(await pool.query('SELECT 1 FROM sh_projets WHERE id=$1',[pid])).rowCount)throw erreur(404,'Projet introuvable.');
    return (await pool.query(`SELECT r.*,u.nom responsable FROM sh_projet_registre r LEFT JOIN sh_utilisateurs u ON u.id=r.responsable_id
      WHERE projet_id=$1 ORDER BY (r.statut='clos'),r.type,r.cree_le DESC`,[pid])).rows;
  }));
  function lire(b,type){
    const titre=String(b.titre||'').trim().slice(0,200);if(titre.length<3)throw erreur(400,'Titre requis (3 caractères au moins).');
    const r={titre,description:String(b.description||'').trim().slice(0,4000)||null,echeance:jourOuNull(b.echeance),
      responsable_id:b.responsable_id?id(b.responsable_id):null,statut:['ouvert','en_traitement','clos'].includes(b.statut)?b.statut:'ouvert'};
    if(type==='risque'){if(!NIVEAUX.includes(b.gravite)||!NIVEAUX.includes(b.probabilite))throw erreur(400,'Gravité et probabilité requises pour un risque.');r.gravite=b.gravite;r.probabilite=b.probabilite;}
    if(type==='decision'){const par=String(b.decide_par||'').trim().slice(0,160);if(par.length<2)throw erreur(400,'Auteur de la décision requis.');r.decide_par=par;r.decide_le=jourOuNull(b.decide_le);if(!r.decide_le)throw erreur(400,'Date de la décision requise.');}
    return r;
  }
  api.post('/projets/:id/registre',route(req=>transaction(pool,async c=>{
    const p=await projet(c,req),type=String(req.body.type||'');
    if(!['risque','decision'].includes(type))throw erreur(400,'Type risque ou décision requis.');
    const r=lire(req.body,type);
    const ligne=(await c.query(`INSERT INTO sh_projet_registre(projet_id,type,titre,description,gravite,probabilite,statut,responsable_id,echeance,decide_par,decide_le,cree_par)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[p.id,type,r.titre,r.description,r.gravite||null,r.probabilite||null,r.statut,r.responsable_id,r.echeance,r.decide_par||null,r.decide_le||null,req.u.id])).rows[0];
    await journal(c,req.u,type==='risque'?'Risque de projet ajouté':'Décision de projet enregistrée',p.nom,r.titre,p.hopital_id);
    return ligne;
  })));
  api.put('/projets/:id/registre/:ligne',route(req=>transaction(pool,async c=>{
    const p=await projet(c,req);
    const avant=(await c.query('SELECT * FROM sh_projet_registre WHERE id=$1 AND projet_id=$2 FOR UPDATE',[id(req.params.ligne),p.id])).rows[0];
    if(!avant)throw erreur(404,'Élément du registre introuvable.');
    const r=lire({...avant,decide_le:avant.decide_le&&new Date(avant.decide_le).toISOString().slice(0,10),echeance:avant.echeance&&new Date(avant.echeance).toISOString().slice(0,10),...req.body},avant.type);
    const ligne=(await c.query(`UPDATE sh_projet_registre SET titre=$2,description=$3,gravite=$4,probabilite=$5,statut=$6,responsable_id=$7,echeance=$8,decide_par=$9,decide_le=$10,modifie_le=now()
      WHERE id=$1 RETURNING *`,[avant.id,r.titre,r.description,r.gravite||null,r.probabilite||null,r.statut,r.responsable_id,r.echeance,r.decide_par||null,r.decide_le||null])).rows[0];
    await journal(c,req.u,'Registre de projet modifié',p.nom,`${r.titre} · ${r.statut}`,p.hopital_id);
    return ligne;
  })));
}
module.exports={brancher};
