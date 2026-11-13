'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {creerPool}=require('../src/db');
const {migrerSh}=require('../src/sh/migrations');
const {empreinte}=require('../src/sh/security');
const {demarrerServeur}=require('./serveur-test.cjs');
test('cycle des projets : PostgreSQL isolé, archivage, restauration et suppression ciblée',{timeout:120000},async t=>{
  const url=new URL(process.env.TEST_DATABASE_URL);
  assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/arrimo_sh_lot1_test_[a-z0-9_]+$/);
  const pool=creerPool(url.href);t.after(()=>pool.end());
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0);
  await pool.query(fs.readFileSync(require.resolve('../db/sh-schema.sql'),'utf8'));
  const env={SH_PUBLIC_URL:'https://sh.example.invalid',SH_MFA_ENCRYPTION_KEY:Buffer.alloc(32,4).toString('base64')};
 assert.equal((await migrerSh(pool,env)).version,46);assert.deepEqual(await migrerSh(pool,env),{version:46,appliquee:false});
  // Sessions de fixture explicites : l'authentification complète est couverte par la suite accès.
  const users={},tokens={};
  for(const role of ['administration','implantation','support']){
    users[role]=(await pool.query(`INSERT INTO sh_utilisateurs(email,nom,role,mot_de_passe_hash,mdp_temporaire,totp_actif)
      VALUES($1,$2,$2,'fixture-sans-connexion',false,true) RETURNING id`,[role+'@example.invalid',role])).rows[0];
    tokens[role]=crypto.randomBytes(32).toString('hex');
    await pool.query("INSERT INTO sh_sessions(token,token_hache,utilisateur_id,expire_le) VALUES($1,true,$2,now()+interval '1 hour')",[empreinte(tokens[role]),users[role].id]);
    if(role==='implantation')await pool.query("INSERT INTO sh_affectations(utilisateur_id,type) VALUES($1,'global')",[users[role].id]);
  }
  const server=await demarrerServeur(require('../src/sh/app').creerAppSh(pool,{env}));t.after(()=>new Promise(r=>server.close(r)));
  async function api(role,method,path,body,status=200){
    const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{Authorization:'Bearer '+tokens[role],'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const j=await r.json();assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(j)}`);return j;
  }
  const h=await api('administration','POST','/hopitaux',{nom:'Hôpital Test Cycle',code_etab:'TEST-CYCLE',environnement:'recette'});
  const p=await api('administration','POST','/projets',{hopital_id:h.id,nom:'Projet Cycle Test'});
  const voisin=await api('administration','POST','/projets',{hopital_id:h.id,nom:'Projet voisin à préserver'});
  const tache=await api('administration','POST',`/projets/${p.id}/taches`,{titre:'Tâche Cycle Test'});
  const cible=`/projets/${p.id}`;
  await t.test('rôles, clôture et périmètre contrôlés avant archivage',async()=>{
    await api('support','POST',cible+'/archiver',{},403);
    await api('implantation','POST',cible+'/archiver',{},409);
    await api('administration','PUT',`/taches/${tache.id}`,{statut:'terminee'});
    await api('administration','PUT',cible,{statut:'termine'});
    await api('implantation','POST',cible+'/archiver');
    assert.ok((await api('administration','GET',cible)).archive_le);
    assert.ok(!(await api('administration','GET','/projets')).some(x=>x.id===p.id));
    assert.ok((await api('administration','GET','/projets?archives=1')).some(x=>x.id===p.id));
    await api('support','GET',cible,null,404);
  });
  await t.test('archive en lecture seule jusque dans PostgreSQL, puis restauration sans perte',async()=>{
    await api('administration','PUT',cible,{nom:'Renommage interdit'},409);
    await api('administration','PUT',`/taches/${tache.id}`,{statut:'en_cours'},409);
    await api('administration','POST',`/taches/${tache.id}/commentaires`,{commentaire:'Commentaire interdit'},409);
    await api('administration','POST',cible+'/jalons',{nom:'Jalon interdit'},409);
    await assert.rejects(pool.query('UPDATE sh_taches SET titre=$2 WHERE id=$1',[tache.id,'Mutation directe interdite']),e=>e.code==='P0A01');
    await api('implantation','POST',cible+'/restaurer');
    await api('administration','PUT',cible,{nom:'Projet restauré'});
    assert.equal((await api('administration','GET',cible)).taches[0].titre,'Tâche Cycle Test');
    await api('implantation','POST',cible+'/archiver');
  });
  await t.test('demande motivée, confirmation, politique et durée de conservation obligatoires',async()=>{
    await api('implantation','POST',cible+'/demander-suppression',{motif:'court'},400);
    await api('implantation','POST',cible+'/demander-suppression',{motif:'Nettoyage de la fixture fictive de recette.'});
    await api('implantation','POST',cible+'/supprimer',{},403);
    const body={confirmation:`SUPPRIMER PRJ-${String(p.id).padStart(6,'0')}`};
    await api('administration','POST',cible+'/supprimer',{confirmation:'SUPPRIMER AUTRE'},400);
    await api('administration','POST',cible+'/supprimer',body,409);
    env.SH_PROJETS_CONSERVATION_JOURS='365';await api('administration','POST',cible+'/supprimer',body,409);
    env.SH_PROJETS_CONSERVATION_JOURS='0';
  });
  await t.test('production et dépendances interprojets refusées sans toucher au voisin',async()=>{
    const body={confirmation:`SUPPRIMER PRJ-${String(p.id).padStart(6,'0')}`};
    await pool.query("UPDATE hopitaux SET environnement='production' WHERE id=$1",[h.id]);
    await api('administration','POST',cible+'/supprimer',body,409);
    await pool.query("UPDATE hopitaux SET environnement='recette' WHERE id=$1",[h.id]);
    const autre=await api('administration','POST',`/projets/${voisin.id}/taches`,{titre:'Dépendance voisine'});
    await pool.query('INSERT INTO sh_taches_dependances(tache_id,depend_de) VALUES($1,$2)',[autre.id,tache.id]);
    await api('administration','POST',cible+'/supprimer',body,409);
    await pool.query('DELETE FROM sh_taches_dependances WHERE tache_id=$1',[autre.id]);
  });
  await t.test('suppression ciblée, accès révoqués, établissement et historique conservés',async()=>{
    await api('administration','POST',`/equipe/${users.support.id}/affectations`,{type:'projet',projet_id:p.id});
    await api('administration','POST',cible+'/supprimer',{confirmation:`SUPPRIMER PRJ-${String(p.id).padStart(6,'0')}`});
    await api('administration','GET',cible,null,404);await api('support','GET','/moi',null,401);
    assert.equal((await api('administration','GET',`/projets/${voisin.id}`)).nom,'Projet voisin à préserver');
    assert.equal((await api('administration','GET',`/hopitaux/${h.id}`)).nom,'Hôpital Test Cycle');
    assert.equal((await pool.query('SELECT count(*)::int n FROM sh_taches WHERE projet_id=$1',[p.id])).rows[0].n,0);
    assert.equal((await pool.query("SELECT count(*)::int n FROM sh_journal WHERE action='Projet supprimé'")).rows[0].n,1);
  });
  await t.test('projet créé par erreur : suppression directe si vide, administration seulement, refus dès qu’il a du contenu',async()=>{
    const erreur=await api('administration','POST','/projets',{hopital_id:h.id,nom:'Projet créé par erreur'});
    const ref=`SUPPRIMER PRJ-${String(erreur.id).padStart(6,'0')}`, motif='Projet créé par erreur lors de la démonstration.';
    await api('implantation','POST',`/projets/${erreur.id}/supprimer-erreur`,{confirmation:ref,motif},403);
    await api('administration','POST',`/projets/${erreur.id}/supprimer-erreur`,{confirmation:'SUPPRIMER AUTRE',motif},400);
    await api('administration','POST',`/projets/${erreur.id}/supprimer-erreur`,{confirmation:ref,motif:'court'},400);
    // Un projet qui a du contenu suit le parcours normal (archivage, demande, conservation)
    const plein=await api('administration','POST','/projets',{hopital_id:h.id,nom:'Projet avec contenu'});
    await api('administration','POST',`/projets/${plein.id}/taches`,{titre:'Tâche réelle'});
    const refus=await api('administration','POST',`/projets/${plein.id}/supprimer-erreur`,{confirmation:`SUPPRIMER PRJ-${String(plein.id).padStart(6,'0')}`,motif},409);
    assert.match(refus.erreur,/n’est plus vide \(1 taches\)/);
    await api('administration','POST',`/projets/${erreur.id}/supprimer-erreur`,{confirmation:ref,motif});
    await api('administration','GET',`/projets/${erreur.id}`,null,404);
    assert.equal((await api('administration','GET',`/projets/${plein.id}`)).nom,'Projet avec contenu');
    assert.equal((await api('administration','GET',`/projets/${voisin.id}`)).nom,'Projet voisin à préserver');
    const j=(await pool.query("SELECT detail FROM sh_journal WHERE action='Projet supprimé (créé par erreur)'")).rows;
    assert.equal(j.length,1);assert.match(j[0].detail,/Projet créé par erreur ; motif : Projet créé par erreur lors/);
  });
});
