'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {creerPool}=require('../src/db'),{empreinte}=require('../src/sh/security'),{demarrerServeur}=require('./serveur-test.cjs');
test('notifications : droits du destinataire, ressources et révocation',{timeout:120000},async t=>{
  const url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/arrimo_sh_lot1_test_[a-z0-9_]+$/);
  const pool=creerPool(url.href);t.after(()=>pool.end());assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0);
  await pool.query(fs.readFileSync(require.resolve('../db/sh-schema.sql'),'utf8'));
  const env={SH_MFA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
  assert.equal((await require('../src/sh/migrations').migrerSh(pool,env)).version,46);
  const users={};
  for(const [nom,role]of Object.entries({admin:'administration',commercial:'commercial',formation:'formation',support:'support',membre:'implantation',voisin:'implantation'})){
    const u=(await pool.query("INSERT INTO sh_utilisateurs(email,nom,role,mot_de_passe_hash,mdp_temporaire,totp_actif) VALUES($1,$2,$3,'fixture-sans-connexion',false,true) RETURNING id,role",[nom+'@example.invalid',nom,role])).rows[0];
    const token=crypto.randomBytes(32).toString('hex');await pool.query("INSERT INTO sh_sessions(token,token_hache,utilisateur_id,expire_le) VALUES($1,true,$2,now()+interval '1 hour')",[empreinte(token),u.id]);users[nom]={...u,token};
  }
  const clients=[],hopitaux=[],projets=[];
  for(const pays of ['CA','TG']){
    const o=(await pool.query('INSERT INTO sh_crm_organisations(nom,pays_code) VALUES($1,$2) RETURNING id',['Client Fictif '+pays,pays])).rows[0];clients.push(o.id);
    const h=(await pool.query("INSERT INTO hopitaux(nom,pays_code,organisation_id,environnement,code_etab) VALUES($1,$2,$3,'recette',$4) RETURNING id",['Hôpital Fictif '+pays,pays,o.id,'NOTIF-'+pays])).rows[0];hopitaux.push(h.id);
    projets.push((await pool.query('INSERT INTO sh_projets(nom,hopital_id,organisation_id) VALUES($1,$2,$3) RETURNING id',['Projet '+pays,h.id,o.id])).rows[0].id);
  }
  const frere=(await pool.query("INSERT INTO sh_projets(nom,hopital_id,organisation_id) VALUES('Projet frère',$1,$2) RETURNING id",[hopitaux[0],clients[0]])).rows[0].id;
  for(const nom of ['commercial','formation','support'])await pool.query("INSERT INTO sh_affectations(utilisateur_id,type,pays_code) VALUES($1,'pays','CA')",[users[nom].id]);
  await pool.query('INSERT INTO sh_projet_membres(projet_id,utilisateur_id) VALUES($1,$2)',[projets[0],users.membre.id]);
  await pool.query("INSERT INTO sh_affectations(utilisateur_id,type,projet_id) VALUES($1,'projet',$2)",[users.voisin.id,projets[1]]);
  const serveur=await demarrerServeur(require('../src/sh/app').creerAppSh(pool,{env}));t.after(()=>new Promise(r=>serveur.close(r)));
  const base=`http://127.0.0.1:${serveur.address().port}/api`;
  async function api(nom,methode,path,body,statut=200){const r=await fetch(base+path,{method:methode,headers:{'Content-Type':'application/json',Authorization:'Bearer '+users[nom].token},body:body?JSON.stringify(body):undefined});const j=await r.json();assert.equal(r.status,statut,`${methode} ${path} : ${JSON.stringify(j)}`);return j;}
  const notifications=nom=>api(nom,'GET','/notifications');
  const eligible=async(nom,type,nature,id)=> (await pool.query('SELECT sh_notification_eligible($1,$2,$3,$4,NULL) ok',[users[nom].id,type,nature,id])).rows[0].ok;
  let opp,tache;
  await t.test('affectations CRM : pays autorisé, refus hors périmètre et aucun objet créé',async()=>{
    const avant=(await pool.query('SELECT count(*)::int n FROM sh_opportunites')).rows[0].n;
    await api('admin','POST','/crm/opportunites',{organisation_id:clients[1],titre:'Secret TG',responsable_id:users.commercial.id},400);
    assert.equal((await pool.query('SELECT count(*)::int n FROM sh_opportunites')).rows[0].n,avant);
    opp=await api('admin','POST','/crm/opportunites',{organisation_id:clients[0],titre:'Dossier CA',responsable_id:users.commercial.id});
    await api('admin','PUT',`/crm/opportunites/${opp.id}`,{responsable_id:users.support.id},400);
    await api('admin','POST',`/crm/organisations/${clients[1]}/activites`,{type:'relance',titre:'Secret TG',responsable_id:users.commercial.id},400);
    await api('admin','POST',`/crm/organisations/${clients[0]}/activites`,{type:'relance',titre:'Relance CA',responsable_id:users.commercial.id});
    assert.equal((await notifications('commercial')).notifications.length,2);
  });
  await t.test('tâche : membre admis, projet voisin refusé, commentaire et rappel quotidien unique',async()=>{
    await api('admin','POST',`/projets/${frere}/taches`,{titre:'Secret frère',responsable_id:users.membre.id},400);
    await api('admin','POST',`/projets/${projets[0]}/taches`,{titre:'Secret voisin',responsable_id:users.voisin.id},400);
    tache=await api('admin','POST',`/projets/${projets[0]}/taches`,{titre:'Livrable CA',responsable_id:users.membre.id,echeance:'2020-01-01'});
    await api('admin','PUT',`/taches/${tache.id}`,{responsable_id:users.voisin.id},400);
    await api('admin','POST',`/taches/${tache.id}/commentaires`,{commentaire:'Suite fictive'});
    let n=await notifications('membre');assert.equal(n.notifications.length,3);assert.equal(n.notifications.filter(x=>x.type==='rappel').length,1);
    n=await notifications('membre');assert.equal(n.notifications.length,3);assert.equal(n.non_lues,3);
    assert.equal(await eligible('membre','tache','projet',frere),false);
    assert.equal(await eligible('membre','tache','projet',projets[0]),true);
  });
  await t.test('formation et support : notifications rattachées à un établissement autorisé',async()=>{
    const corps={role:'coordination',debut:'2030-10-29T12:00:00Z',titre:'Formation CA',formateur_id:users.formation.id};
    await api('admin','POST',`/hopitaux/${hopitaux[1]}/formation/sessions`,corps,400);
    await api('admin','POST',`/hopitaux/${hopitaux[0]}/formation/sessions`,corps);
    await api('admin','POST','/support/tickets',{hopital_id:hopitaux[0],titre:'Incident CA',responsable_id:users.support.id});
    assert.equal((await notifications('formation')).notifications.length,1);
    assert.equal((await notifications('support')).notifications.length,1);
    assert.equal(await eligible('membre','support','hopital',hopitaux[0]),true);
    assert.equal(await eligible('membre','support','hopital',hopitaux[1]),false);
  });
  await t.test('rôle personnalisé : retrait de permission masque l’historique et les compteurs',async()=>{
    const permissions=['GET /moi','GET /notifications','POST /notifications/lues','GET /crm/opportunites','GET /crm/activites'];
    const r=(await pool.query("INSERT INTO sh_roles_personnalises(nom,base_role,permissions) VALUES('Commercial limité','commercial',$1) RETURNING id",[permissions])).rows[0];
    await pool.query('UPDATE sh_utilisateurs SET role_personnalise_id=$2 WHERE id=$1',[users.commercial.id,r.id]);
    assert.equal((await notifications('commercial')).notifications.length,2);
    await pool.query('UPDATE sh_roles_personnalises SET permissions=$2 WHERE id=$1',[r.id,permissions.filter(p=>!p.startsWith('GET /crm/'))]);
    assert.deepEqual(await notifications('commercial'),{non_lues:0,notifications:[]});
    await pool.query('UPDATE sh_roles_personnalises SET permissions=$2 WHERE id=$1',[r.id,permissions]);
    assert.equal((await notifications('commercial')).notifications.length,2);
  });
  await t.test('droits révoqués : historique, rappel et acquittement disparaissent immédiatement',async()=>{
    const ids=(await notifications('membre')).notifications.map(n=>n.id);
    await pool.query('DELETE FROM sh_projet_membres WHERE projet_id=$1 AND utilisateur_id=$2',[projets[0],users.membre.id]);
    assert.deepEqual(await notifications('membre'),{non_lues:0,notifications:[]});
    const ack=await api('membre','POST','/notifications/lues',{ids});assert.equal(ack.marquees,0);
    assert.equal((await pool.query('SELECT count(*)::int n FROM sh_notifications WHERE id=ANY($1::bigint[]) AND lu_le IS NULL',[ids])).rows[0].n,ids.length);
    for(const nom of ['commercial','formation','support']){await pool.query('DELETE FROM sh_affectations WHERE utilisateur_id=$1',[users[nom].id]);assert.deepEqual(await notifications(nom),{non_lues:0,notifications:[]});}
  });
  await t.test('anciennes notifications sans rattachement : masquées aux employés, conservées en base',async()=>{
    for(const nom of ['support','admin'])await pool.query("INSERT INTO sh_notifications(utilisateur_id,type,titre) VALUES($1,'support','Ancien titre sans périmètre')",[users[nom].id]);
    assert.equal((await notifications('support')).notifications.length,0);
    assert.ok((await notifications('admin')).notifications.some(n=>n.titre==='Ancien titre sans périmètre'));
  });
  await t.test('fonction privilégiée : portée de l’émetteur, contexte lecture et supervision globale',async()=>{
    const restreint=require('../src/sh/perimetre-pool').creerPoolPerimetre(pool),notifier=require('../src/sh/automatisations').notifier;
    await restreint.executer({...users.voisin,methode:'POST'},async()=>{
      await assert.rejects(notifier(restreint,users.admin.id,{type:'tache',titre:'Injection hors projet',ressourceType:'tache',ressourceId:tache.id}),{code:'42501'});
    });
    await restreint.executer({...users.voisin,methode:'GET'},async()=>{
      await assert.rejects(notifier(restreint,users.admin.id,{type:'tache',titre:'Injection GET',ressourceType:'projet',ressourceId:projets[1]}),{code:'42501'});
    });
    assert.equal(await eligible('support','hebergement','global',null),false);
    await pool.query("INSERT INTO sh_affectations(utilisateur_id,type) VALUES($1,'global')",[users.support.id]);
    assert.equal(await eligible('support','hebergement','global',null),true);
    await notifier(pool,users.support.id,{type:'hebergement',titre:'Supervision fictive',ressourceType:'global'});
    assert.equal((await notifications('support')).notifications.filter(n=>n.type==='hebergement').length,1);
    await pool.query('UPDATE sh_utilisateurs SET actif=false WHERE id=$1',[users.support.id]);
    assert.equal(await eligible('support','hebergement','global',null),false);
  });
});
