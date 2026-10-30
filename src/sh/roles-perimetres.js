'use strict';
const {transaction}=require('../db');
const {PERMISSIONS}=require('./permissions');
const {revoquer}=require('./acces');
const erreur=(statut,message)=>Object.assign(new Error(message),{statut});
const id=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw erreur(400,'Identifiant invalide.');return n;};
const BASES=['commercial','implantation','formation','support','finance'];
function brancher(api,pool,route,journal){
  api.get('/perimetres/references',route(async()=>({
    clients:(await pool.query('SELECT id,nom,pays_code FROM sh_crm_organisations ORDER BY nom')).rows,
    hopitaux:(await pool.query('SELECT id,nom,pays_code FROM hopitaux ORDER BY nom')).rows,
    projets:(await pool.query('SELECT id,nom FROM sh_projets ORDER BY nom')).rows
  })));
  api.get('/roles-personnalises',route(async()=>({roles:(await pool.query('SELECT * FROM sh_roles_personnalises ORDER BY nom')).rows,
    bases:BASES,actions:Object.entries(PERMISSIONS).map(([cle,roles])=>({cle,bases:roles.filter(r=>r!=='administration')}))})));
  async function enregistrer(req,identifiant){
    const b=req.body,nom=String(b.nom||'').trim(),base=b.base_role;
    if(!nom||nom.length>100||!BASES.includes(base)||!Array.isArray(b.permissions)||b.permissions.some(p=>typeof p!=='string'||!Object.hasOwn(PERMISSIONS,p)||!PERMISSIONS[p].includes(base))||(b.actif!==undefined&&typeof b.actif!=='boolean'))throw erreur(400,'Nom, rôle de base ou permissions invalides.');
    const permissions=[...new Set(b.permissions)];
    return transaction(pool,async c=>{
      let r;
      if(identifiant)r=await c.query('UPDATE sh_roles_personnalises SET nom=$2,base_role=$3,permissions=$4,actif=$5 WHERE id=$1 RETURNING *',[identifiant,nom,base,permissions,b.actif!==false]);
      else r=await c.query('INSERT INTO sh_roles_personnalises(nom,base_role,permissions,actif) VALUES($1,$2,$3,$4) RETURNING *',[nom,base,permissions,b.actif!==false]);
      if(!r.rowCount)throw erreur(404,'Rôle introuvable.');
      if(identifiant){
        const users=(await c.query('SELECT id FROM sh_utilisateurs WHERE role_personnalise_id=$1',[identifiant])).rows;
        await c.query('UPDATE sh_utilisateurs SET role=$2 WHERE role_personnalise_id=$1',[identifiant,base]);
        for(const u of users)await revoquer(c,u.id);
      }
      await journal(c,req.u,'Rôle personnalisé enregistré',nom,`${permissions.length} permissions explicites`);return r.rows[0];
    });
  }
  api.post('/roles-personnalises',route(req=>enregistrer(req,null)));
  api.put('/roles-personnalises/:id',route(req=>enregistrer(req,id(req.params.id))));
  api.put('/equipe/:id/role-personnalise',route(req=>transaction(pool,async c=>{
    const utilisateur=id(req.params.id);if(utilisateur===req.u.id)throw erreur(409,'Utilisez un autre administrateur pour modifier vos propres droits.');
    const r=(await c.query('SELECT * FROM sh_roles_personnalises WHERE id=$1 AND actif',[id(req.body.role_id)])).rows[0];
    if(!r)throw erreur(404,'Rôle introuvable.');
    if(!(await c.query('UPDATE sh_utilisateurs SET role=$2,role_personnalise_id=$3 WHERE id=$1 RETURNING id',[utilisateur,r.base_role,r.id])).rowCount)throw erreur(404,'Compte introuvable.');
    await revoquer(c,utilisateur);
    await c.query('UPDATE sh_invitations SET revoquee_le=now() WHERE utilisateur_id=$1 AND utilise_le IS NULL',[utilisateur]);
    await journal(c,req.u,'Rôle personnalisé attribué',`membre ${utilisateur}`,r.nom);return {ok:true};
  })));
  api.get('/equipe/:id/affectations',route(async req=>(await pool.query('SELECT * FROM sh_affectations WHERE utilisateur_id=$1 ORDER BY cree_le,id',[id(req.params.id)])).rows));
  api.post('/equipe/:id/affectations',route(req=>transaction(pool,async c=>{
    const utilisateur=id(req.params.id),b=req.body,type=b.type;
    if(!['global','pays','client','hopital','projet'].includes(type))throw erreur(400,'Type de périmètre invalide.');
    if(!(await c.query('SELECT id FROM sh_utilisateurs WHERE id=$1',[utilisateur])).rowCount)throw erreur(404,'Compte introuvable.');
    const pays=type==='pays'?String(b.pays_code||'').toUpperCase():null;
    if(type==='pays'&&!/^[A-Z]{2}$/.test(pays))throw erreur(400,'Code pays invalide.');
    const org=type==='client'?id(b.organisation_id):null,h=type==='hopital'?id(b.hopital_id):null,p=type==='projet'?id(b.projet_id):null;
    const r=await c.query(`INSERT INTO sh_affectations(utilisateur_id,type,pays_code,organisation_id,hopital_id,projet_id,cree_par)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[utilisateur,type,pays,org,h,p,req.u.id]);
    await journal(c,req.u,'Périmètre SH attribué',`membre ${utilisateur}`,`${type} ${pays||org||h||p||'explicite'}`);return r.rows[0];
  })));
  api.post('/equipe/:id/affectations/:affectation/retirer',route(req=>transaction(pool,async c=>{
    const utilisateur=id(req.params.id);
    const r=await c.query('DELETE FROM sh_affectations WHERE id=$1 AND utilisateur_id=$2 RETURNING id',[id(req.params.affectation),utilisateur]);
    if(!r.rowCount)throw erreur(404,'Affectation introuvable.');
    await revoquer(c,utilisateur);await journal(c,req.u,'Périmètre SH retiré',`membre ${utilisateur}`,String(r.rows[0].id));return {ok:true};
  })));
}
module.exports={brancher};
