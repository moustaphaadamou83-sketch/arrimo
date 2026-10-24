'use strict';

const { transaction } = require('../db');

const STATUTS_OPP = new Set(['qualification', 'analyse', 'proposition', 'negociation', 'gagnee', 'perdue']);
const ROLES_COMMERCIAL = ['administration', 'commercial'];
const ROLES_PROJET = ['administration', 'implantation', 'support'];
const texte = (x, max = 500) => String(x ?? '').trim().slice(0, max) || null;
const idPositif = (x) => Number.isSafeInteger(Number(x)) && Number(x) > 0 ? Number(x) : null;

function brancher(api, pool, route, journal) {
  api.get('/crm/organisations', route(async () => (await pool.query(`SELECT o.*, count(DISTINCT c.id)::int contacts,
    count(DISTINCT p.id)::int opportunites FROM sh_crm_organisations o LEFT JOIN sh_crm_contacts c ON c.organisation_id=o.id
    LEFT JOIN sh_opportunites p ON p.organisation_id=o.id GROUP BY o.id ORDER BY o.nom`)).rows));
  api.post('/crm/organisations', route(async (req) => {
    const nom = texte(req.body.nom, 180);
    if (!nom) throw Object.assign(new Error('Nom de l’organisation requis.'), { statut: 400 });
    const row = await transaction(pool, async (c) => {
      const { rows } = await c.query(`INSERT INTO sh_crm_organisations(nom,type,site_web,notes,cree_par)
        VALUES($1,'prospect',$2,$3,$4) RETURNING *`, [nom, texte(req.body.site_web, 300), texte(req.body.notes, 4000), req.u.id]);
      await journal(c, req.u, 'Organisation CRM créée', nom, 'prospect'); return rows[0];
    });
    return row;
  }));
  api.post('/crm/organisations/:id/contacts', route(async (req) => {
    const org = idPositif(req.params.id); const nom = texte(req.body.nom, 160);
    if (!org || !nom) throw Object.assign(new Error('Organisation et nom du contact requis.'), { statut: 400 });
    return transaction(pool, async (c) => {
      if (!(await c.query('SELECT 1 FROM sh_crm_organisations WHERE id=$1', [org])).rowCount) throw Object.assign(new Error('Organisation introuvable.'), { statut: 404 });
      const { rows } = await c.query(`INSERT INTO sh_crm_contacts(organisation_id,nom,fonction,courriel,telephone,decideur)
        VALUES($1,$2,$3,lower($4),$5,$6) RETURNING *`, [org, nom, texte(req.body.fonction, 120), texte(req.body.courriel, 200), texte(req.body.telephone, 50), req.body.decideur === true]);
      await journal(c, req.u, 'Contact CRM créé', nom, `organisation ${org}`); return rows[0];
    });
  }));
  api.put('/crm/organisations/:id/etablissement', route(async(req)=>{
    const org=idPositif(req.params.id),hopital=idPositif(req.body.hopital_id);if(!org||!hopital)throw Object.assign(new Error('Organisation et établissement requis.'),{statut:400});
    const {rows}=await pool.query(`UPDATE sh_crm_organisations o SET hopital_id=$2,type='client',modifie_le=now() WHERE o.id=$1 AND (o.hopital_id IS NULL OR o.hopital_id=$2)
      AND NOT EXISTS(SELECT 1 FROM sh_crm_organisations x WHERE x.hopital_id=$2 AND x.id<>$1) RETURNING o.*`,[org,hopital]);
    if(!rows[0])throw Object.assign(new Error('Établissement déjà associé à une autre organisation CRM.'),{statut:409});
    await journal(pool,req.u,'Organisation liée à un établissement',rows[0].nom,`hôpital SH ${hopital}`,hopital);return rows[0];
  }));
  api.get('/crm/opportunites', route(async (req) => {
    const statut = STATUTS_OPP.has(req.query.statut) ? req.query.statut : null;
    const { rows } = await pool.query(`SELECT p.*,o.nom organisation,u.nom responsable FROM sh_opportunites p
      JOIN sh_crm_organisations o ON o.id=p.organisation_id LEFT JOIN sh_utilisateurs u ON u.id=p.responsable_id
      WHERE ($1::text IS NULL OR p.statut=$1) ORDER BY p.echeance NULLS LAST,p.modifie_le DESC LIMIT 500`, [statut]);
    return rows;
  }));
  api.get('/crm/opportunites/:id/devis', route(async(req)=>(await pool.query('SELECT * FROM sh_devis WHERE opportunite_id=$1 ORDER BY version DESC',[idPositif(req.params.id)])).rows));
  api.post('/crm/opportunites', route(async (req) => {
    const org = idPositif(req.body.organisation_id); const titre = texte(req.body.titre, 180);
    if (!org || !titre) throw Object.assign(new Error('Organisation et titre requis.'), { statut: 400 });
    const montant = req.body.montant == null || req.body.montant === '' ? null : Number(req.body.montant);
    const proba = req.body.probabilite == null ? 0 : Number(req.body.probabilite);
    if ((montant !== null && (!Number.isFinite(montant) || montant < 0)) || !Number.isInteger(proba) || proba < 0 || proba > 100) throw Object.assign(new Error('Montant ou probabilité invalide.'), { statut: 400 });
    return transaction(pool, async (c) => {
      const { rows } = await c.query(`INSERT INTO sh_opportunites(organisation_id,titre,montant,devise,probabilite,responsable_id,prochaine_action,echeance,cree_par)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [org,titre,montant,String(req.body.devise||'CAD').toUpperCase(),proba,idPositif(req.body.responsable_id),texte(req.body.prochaine_action,300),req.body.echeance||null,req.u.id]);
      await journal(c, req.u, 'Opportunité créée', titre, `organisation ${org}`); return rows[0];
    });
  }));
  api.put('/crm/opportunites/:id', route(async (req) => {
    const id=idPositif(req.params.id); const statut=String(req.body.statut||'');
    if (!STATUTS_OPP.has(statut)) throw Object.assign(new Error('Étape de pipeline invalide.'), { statut: 400 });
    const { rows } = await pool.query(`UPDATE sh_opportunites SET statut=$2,probabilite=$3,prochaine_action=$4,echeance=$5,
      perdue_motif=$6,modifie_le=now() WHERE id=$1 RETURNING *`, [id,statut,Math.min(100,Math.max(0,Number(req.body.probabilite)||0)),texte(req.body.prochaine_action,300),req.body.echeance||null,statut==='perdue'?texte(req.body.perdue_motif,500):null]);
    if (!rows[0]) throw Object.assign(new Error('Opportunité introuvable.'), { statut: 404 });
    await journal(pool, req.u, 'Opportunité modifiée', rows[0].titre, statut); return rows[0];
  }));
  api.post('/crm/opportunites/:id/activites', route(async (req) => {
    const id=idPositif(req.params.id); const type=String(req.body.type||''); const titre=texte(req.body.titre,180);
    if (!['appel','reunion','courriel','relance','note'].includes(type)||!titre) throw Object.assign(new Error('Type et titre d’activité requis.'), { statut: 400 });
    const { rows }=await pool.query(`INSERT INTO sh_activites(opportunite_id,type,titre,contenu,echeance,responsable_id,cree_par)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[id,type,titre,texte(req.body.contenu,4000),req.body.echeance||null,idPositif(req.body.responsable_id)||req.u.id,req.u.id]);
    await journal(pool,req.u,'Activité CRM ajoutée',titre,`${type} · opportunité ${id}`); return rows[0];
  }));
  api.post('/crm/opportunites/:id/devis', route(async (req) => {
    const id=idPositif(req.params.id); const lignes=Array.isArray(req.body.lignes)?req.body.lignes:[];
    if (!lignes.length || lignes.length>100) throw Object.assign(new Error('Le devis doit contenir de 1 à 100 lignes.'), { statut: 400 });
    const propres=lignes.map((l)=>({code:texte(l.code,40),description:texte(l.description,240),quantite:Number(l.quantite),prix_unitaire:Number(l.prix_unitaire)}));
    if (propres.some(l=>!l.description||!Number.isFinite(l.quantite)||l.quantite<=0||!Number.isFinite(l.prix_unitaire)||l.prix_unitaire<0)) throw Object.assign(new Error('Une ligne de devis est invalide.'),{statut:400});
    return transaction(pool,async(c)=>{
      const n=(await c.query('SELECT COALESCE(max(version),0)+1 version FROM sh_devis WHERE opportunite_id=$1',[id])).rows[0].version;
      const r=await c.query(`INSERT INTO sh_devis(opportunite_id,version,lignes,devise,cree_par) VALUES($1,$2,$3,$4,$5) RETURNING *`,[id,n,JSON.stringify(propres),String(req.body.devise||'CAD').toUpperCase(),req.u.id]);
      await journal(c,req.u,'Devis créé',`Opportunité ${id}`,`version ${n}`); return r.rows[0];
    });
  }));
  api.post('/crm/devis/:id/valider', route(async(req)=>{
    const id=idPositif(req.params.id); const {rows}=await pool.query(`UPDATE sh_devis SET statut='approuve',valide_par=$2,valide_le=now() WHERE id=$1 AND statut IN ('brouillon','a_valider') RETURNING *`,[id,req.u.id]);
    if(!rows[0]) throw Object.assign(new Error('Devis introuvable ou statut incompatible.'),{statut:409});
    await journal(pool,req.u,'Devis approuvé',`Devis ${id}`,`version ${rows[0].version}`); return rows[0];
  }));
  api.get('/crm/contrats', route(async()=> (await pool.query(`SELECT c.*,o.nom client,d.version devis_version FROM sh_contrats c JOIN sh_opportunites p ON p.id=c.opportunite_id
    JOIN sh_crm_organisations o ON o.id=p.organisation_id LEFT JOIN sh_devis d ON d.id=c.devis_id ORDER BY c.cree_le DESC`)).rows));
  api.post('/crm/opportunites/:id/contrats', route(async(req)=>{
    const opp=idPositif(req.params.id),devis=idPositif(req.body.devis_id);if(!opp||!devis)throw Object.assign(new Error('Opportunité et devis approuvé requis.'),{statut:400});
    return transaction(pool,async(c)=>{
      const existing=(await c.query('SELECT * FROM sh_contrats WHERE opportunite_id=$1 AND devis_id=$2 FOR UPDATE',[opp,devis])).rows[0];if(existing)return existing;
      const q=(await c.query(`SELECT d.id,d.statut FROM sh_devis d WHERE d.id=$1 AND d.opportunite_id=$2 FOR UPDATE`,[devis,opp])).rows[0];
      if(!q||!['approuve','envoye','accepte'].includes(q.statut))throw Object.assign(new Error('Le devis doit être approuvé avant de créer un contrat.'),{statut:409});
      const reference=`ARR-${opp}-${Date.now().toString(36).toUpperCase()}`;
      const {rows}=await c.query(`INSERT INTO sh_contrats(opportunite_id,devis_id,reference,cree_par) VALUES($1,$2,$3,$4) RETURNING *`,[opp,devis,reference,req.u.id]);
      await journal(c,req.u,'Contrat créé',reference,`opportunité ${opp}; aucune signature électronique déclarée`);return rows[0];
    });
  }));
  api.post('/crm/contrats/:id/signe', route(async(req)=>{
    const id=idPositif(req.params.id),signataire=texte(req.body.signataire,180);if(!signataire||!texte(req.body.document_ref,500))throw Object.assign(new Error('Le signataire et la référence du document de signature sont requis.'),{statut:400});
    return transaction(pool,async(c)=>{
      const old=(await c.query(`SELECT c.*,p.titre,o.nom client,o.hopital_id FROM sh_contrats c JOIN sh_opportunites p ON p.id=c.opportunite_id JOIN sh_crm_organisations o ON o.id=p.organisation_id WHERE c.id=$1 FOR UPDATE OF c`,[id])).rows[0];
      if(!old)throw Object.assign(new Error('Contrat introuvable.'),{statut:404});if(!old.hopital_id)throw Object.assign(new Error('L’organisation doit d’abord être reliée à sa fiche établissement.'),{statut:409});
      if(old.statut!=='signe')await c.query(`UPDATE sh_contrats SET statut='signe',signe_par=$2,document_ref=$3 WHERE id=$1`,[id,signataire,texte(req.body.document_ref,500)]);
      await c.query(`UPDATE sh_crm_organisations SET type='client',modifie_le=now() WHERE id=(SELECT organisation_id FROM sh_opportunites WHERE id=$1)`,[old.opportunite_id]);
      await c.query(`UPDATE sh_opportunites SET statut='gagnee',probabilite=100,modifie_le=now() WHERE id=$1`,[old.opportunite_id]);
      const project=(await c.query(`INSERT INTO sh_projets(hopital_id,contrat_id,nom,statut,cree_par) VALUES($1,$2,$3,'planification',$4)
        ON CONFLICT(contrat_id) WHERE contrat_id IS NOT NULL DO UPDATE SET contrat_id=EXCLUDED.contrat_id RETURNING *`,[old.hopital_id,id,`Implantation · ${old.client}`,req.u.id])).rows[0];
      const modele=['Valider les données administratives','Importer services, unités, chambres et lits','Configurer les modules et les quotas','Inviter les administrateurs de l’établissement','Planifier et réaliser la formation','Exécuter la recette et valider le Go Live'];
      for(const titre of modele)await c.query(`INSERT INTO sh_taches(projet_id,titre,priorite,cree_par) VALUES($1,$2,'normale',$3) ON CONFLICT(projet_id,lower(titre)) DO NOTHING`,[project.id,titre,req.u.id]);
      await journal(c,req.u,'Contrat marqué signé',old.reference,`signataire déclaré : ${signataire}; document : ${req.body.document_ref}; projet ${project.id}`,old.hopital_id);
      return {contrat:(await c.query('SELECT * FROM sh_contrats WHERE id=$1',[id])).rows[0],projet:project,taches_creees:modele.length};
    });
  }));
  api.get('/projets', route(async()=> (await pool.query(`SELECT p.*,h.nom hopital,
    COALESCE(round(100.0*count(t.id) FILTER(WHERE t.statut='terminee')/NULLIF(count(t.id),0)),0)::int avancement,
    count(t.id)::int taches FROM sh_projets p JOIN hopitaux h ON h.id=p.hopital_id LEFT JOIN sh_taches t ON t.projet_id=p.id GROUP BY p.id,h.nom ORDER BY p.echeance NULLS LAST,p.id DESC`)).rows));
  api.post('/projets', route(async(req)=>{
    const h=idPositif(req.body.hopital_id);const nom=texte(req.body.nom,180);if(!h||!nom)throw Object.assign(new Error('Établissement et nom de projet requis.'),{statut:400});
    return transaction(pool,async(c)=>{const r=await c.query(`INSERT INTO sh_projets(hopital_id,contrat_id,nom,debut,echeance,cree_par) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[h,idPositif(req.body.contrat_id),nom,req.body.debut||null,req.body.echeance||null,req.u.id]);await journal(c,req.u,'Projet créé',nom,`hôpital ${h}`,h);return r.rows[0];});
  }));
  api.get('/taches', route(async(req)=>{
    const moi=req.query.moi==='1';return (await pool.query(`SELECT t.*,p.nom projet,h.nom hopital,u.nom responsable FROM sh_taches t JOIN sh_projets p ON p.id=t.projet_id JOIN hopitaux h ON h.id=p.hopital_id LEFT JOIN sh_utilisateurs u ON u.id=t.responsable_id WHERE ($1::boolean=false OR t.responsable_id=$2) ORDER BY t.echeance NULLS LAST,t.id DESC LIMIT 1000`,[moi,req.u.id])).rows;
  }));
  api.post('/projets/:id/taches', route(async(req)=>{
    const p=idPositif(req.params.id);const titre=texte(req.body.titre,180);if(!titre)throw Object.assign(new Error('Titre de tâche requis.'),{statut:400});
    if(req.body.parent_id&&!idPositif(req.body.parent_id))throw Object.assign(new Error('Sous-tâche invalide.'),{statut:400});
    const {rows}=await pool.query(`INSERT INTO sh_taches(projet_id,parent_id,titre,description,priorite,responsable_id,echeance,cree_par) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[p,idPositif(req.body.parent_id),titre,texte(req.body.description,4000),['basse','normale','haute','urgente'].includes(req.body.priorite)?req.body.priorite:'normale',idPositif(req.body.responsable_id),req.body.echeance||null,req.u.id]);await journal(pool,req.u,'Tâche créée',titre,`projet ${p}`);return rows[0];
  }));
  api.put('/taches/:id', route(async(req)=>{
    const id=idPositif(req.params.id);const statut=String(req.body.statut||'');if(!['a_faire','en_cours','bloquee','terminee'].includes(statut))throw Object.assign(new Error('Statut de tâche invalide.'),{statut:400});
    const {rows}=await pool.query(`UPDATE sh_taches SET statut=$2,priorite=$3,responsable_id=$4,echeance=$5,modifie_le=now() WHERE id=$1 RETURNING *`,[id,statut,['basse','normale','haute','urgente'].includes(req.body.priorite)?req.body.priorite:'normale',idPositif(req.body.responsable_id),req.body.echeance||null]);if(!rows[0])throw Object.assign(new Error('Tâche introuvable.'),{statut:404});await journal(pool,req.u,'Tâche modifiée',rows[0].titre,statut);return rows[0];
  }));
  api.post('/taches/:id/commentaires', route(async(req)=>{const id=idPositif(req.params.id);const commentaire=texte(req.body.commentaire,4000);if(!commentaire)throw Object.assign(new Error('Commentaire requis.'),{statut:400});const {rows}=await pool.query(`INSERT INTO sh_taches_commentaires(tache_id,utilisateur_id,commentaire) VALUES($1,$2,$3) RETURNING *`,[id,req.u.id,commentaire]);return rows[0];}));
  api.get('/support/tickets', route(async(req)=> (await pool.query(`SELECT t.*,h.nom hopital,u.nom responsable FROM sh_support_tickets t JOIN hopitaux h ON h.id=t.hopital_id LEFT JOIN sh_utilisateurs u ON u.id=t.responsable_id ORDER BY t.cree_le DESC LIMIT 1000`)).rows));
  api.post('/support/tickets', route(async(req)=>{const h=idPositif(req.body.hopital_id);const titre=texte(req.body.titre,180);if(!h||!titre)throw Object.assign(new Error('Établissement et titre requis.'),{statut:400});const {rows}=await pool.query(`INSERT INTO sh_support_tickets(hopital_id,titre,description,priorite,cree_par) VALUES($1,$2,$3,$4,$5) RETURNING *`,[h,titre,texte(req.body.description,4000),['basse','normale','haute','urgente'].includes(req.body.priorite)?req.body.priorite:'normale',req.u.id]);await journal(pool,req.u,'Ticket créé',titre,`hôpital ${h}`,h);return rows[0];}));
}

module.exports={brancher};
