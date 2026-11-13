'use strict';
/**
 * Recherche globale de la console : seulement les types de données que le rôle peut consulter, et seulement
 * les lignes de son périmètre (sécurité par ligne PostgreSQL). Filtres enregistrables propres à chaque utilisateur.
 */
const {autoriser}=require('./permissions');
const erreur=(statut,message)=>Object.assign(new Error(message),{statut});
const LIMITE=8;
const motif=q=>`%${q.replace(/[\\%_]/g,m=>'\\'+m)}%`;
// [type, route de consultation qui donne le droit, requête, vue de la console]
const SOURCES=[
  ['hopital','GET /hopitaux',`SELECT id,nom libelle,ville detail FROM hopitaux WHERE statut <> 'retire' AND (nom ILIKE $1 OR ville ILIKE $1 OR code_etab ILIKE $1) ORDER BY nom LIMIT ${LIMITE}`,'hopitaux'],
  ['organisation','GET /crm/organisations',`SELECT id,nom libelle,ville detail FROM sh_crm_organisations WHERE nom ILIKE $1 ORDER BY nom LIMIT ${LIMITE}`,'crm'],
  ['projet','GET /projets',`SELECT id,nom libelle,'PRJ-'||lpad(id::text,6,'0') detail FROM sh_projets WHERE archive_le IS NULL AND (nom ILIKE $1 OR 'PRJ-'||lpad(id::text,6,'0') ILIKE $1) ORDER BY nom LIMIT ${LIMITE}`,'projets'],
  ['tache','GET /taches',`SELECT t.id,t.titre libelle,p.nom detail FROM sh_taches t JOIN sh_projets p ON p.id=t.projet_id WHERE t.titre ILIKE $1 AND ($2::int IS NULL OR t.responsable_id=$2) ORDER BY t.modifie_le DESC NULLS LAST LIMIT ${LIMITE}`,'taches'],
  ['ticket','GET /support/tickets',`SELECT id,titre libelle,statut detail FROM sh_support_tickets WHERE titre ILIKE $1 ORDER BY cree_le DESC LIMIT ${LIMITE}`,'support'],
  ['contrat','GET /crm/contrats',`SELECT id,reference libelle,statut detail FROM sh_contrats WHERE reference ILIKE $1 ORDER BY id DESC LIMIT ${LIMITE}`,'contrats'],
  ['facture','GET /facturation/factures',`SELECT id,numero libelle,statut detail FROM sh_factures WHERE numero ILIKE $1 ORDER BY id DESC LIMIT ${LIMITE}`,'facturation'],
];
function brancher(api,pool,route){
  api.get('/recherche',route(async req=>{
    const q=String(req.query.q||'').trim().slice(0,80);
    if(q.length<2)throw erreur(400,'Saisissez au moins deux caractères.');
    const gestion=['administration','implantation'].includes(req.u.role);
    const resultats=[];
    for(const [type,droit,sql,vue] of SOURCES){
      const [methode,chemin]=droit.split(' ');
      if(!autoriser(req.u,{method:methode,path:chemin,body:{}}))continue;
      const params=type==='tache'?[motif(q),gestion?null:req.u.id]:[motif(q)];
      for(const r of (await pool.query(sql,params)).rows)resultats.push({type,id:r.id,libelle:r.libelle,detail:r.detail,vue});
    }
    return {q,resultats};
  }));
  api.get('/moi/filtres',route(async req=>(await pool.query('SELECT id,vue,nom,filtres FROM sh_filtres WHERE utilisateur_id=$1 AND ($2::text IS NULL OR vue=$2) ORDER BY vue,nom',
    [req.u.id,req.query.vue?String(req.query.vue):null])).rows));
  api.post('/moi/filtres',route(async req=>{
    const vue=String(req.body.vue||''),nom=String(req.body.nom||'').trim().slice(0,80),filtres=req.body.filtres;
    if(!/^[a-z_]{2,40}$/.test(vue)||nom.length<2)throw erreur(400,'Vue et nom du filtre requis.');
    if(!filtres||typeof filtres!=='object'||Array.isArray(filtres)||JSON.stringify(filtres).length>2000)throw erreur(400,'Filtre invalide.');
    if((await pool.query('SELECT count(*)::int n FROM sh_filtres WHERE utilisateur_id=$1',[req.u.id])).rows[0].n>=50)throw erreur(409,'Cinquante filtres enregistrés au plus.');
    return (await pool.query(`INSERT INTO sh_filtres(utilisateur_id,vue,nom,filtres) VALUES($1,$2,$3,$4)
      ON CONFLICT(utilisateur_id,vue,nom) DO UPDATE SET filtres=EXCLUDED.filtres RETURNING id,vue,nom,filtres`,[req.u.id,vue,nom,JSON.stringify(filtres)])).rows[0];
  }));
  api.delete('/moi/filtres/:id',route(async req=>{
    const id=Number(req.params.id);
    if(!(await pool.query('DELETE FROM sh_filtres WHERE id=$1 AND utilisateur_id=$2',[id,req.u.id])).rowCount)throw erreur(404,'Filtre introuvable.');
    return {ok:true};
  }));
}
module.exports={brancher};
