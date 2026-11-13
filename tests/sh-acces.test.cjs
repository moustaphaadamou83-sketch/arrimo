'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {creerPool}=require('../src/db');
const {hacherAsync,verifierAsync}=require('../src/auth');
const {migrerSh}=require('../src/sh/migrations');
const {creerAppSh}=require('../src/sh/app');
const {empreinte,chiffrerSecret}=require('../src/sh/security');
const totp=require('../src/totp');
const courriel=require('../src/courriel');
const {demarrerServeur}=require('./serveur-test.cjs');

test('SH lot accès : PostgreSQL isolé, API et navigateur', {timeout:180000},async t=>{
  const url=new URL(process.env.SH_ACCES_TEST_DATABASE_URL);
  assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/arrimo_sh_lot1_test_[a-z0-9_]+$/);
  const pool=creerPool(url.href);t.after(()=>pool.end());
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0,'Une base NEUVE est obligatoire');
  await pool.query(fs.readFileSync(require.resolve('../db/sh-schema.sql'),'utf8'));
  const env={SH_PUBLIC_URL:'https://sh.example.invalid',SH_MFA_ENCRYPTION_KEY:Buffer.alloc(32,3).toString('base64')};
  const mails=[];courriel.definirTransport(async m=>mails.push(m));t.after(()=>courriel.definirTransport(null));
  await migrerSh(pool,env);
  const users={},tokens={};const mdp='Fixture-Acces-2026';
  for(const role of ['administration','support','implantation','finance']){
    const secret=totp.nouveauSecret();
    const u=(await pool.query(`INSERT INTO sh_utilisateurs(email,nom,role,mot_de_passe_hash,mdp_temporaire,totp_actif,totp_secret)
      VALUES($1,$2,$3,$4,false,true,$5) RETURNING id,email`,[`${role}@example.invalid`,role,role,await hacherAsync(mdp),chiffrerSecret(secret,env)])).rows[0];
    users[role]={...u,secret};
    if(role!=='administration')await pool.query("INSERT INTO sh_affectations(utilisateur_id,type) VALUES($1,'global')",[u.id]);
  }
  const app=creerAppSh(pool,{env});const wrapper=require('express')();wrapper.use('/sh-validation',app);wrapper.use(app);
  const serveur=await demarrerServeur(wrapper);t.after(()=>new Promise(r=>serveur.close(r)));
  const base=`http://127.0.0.1:${serveur.address().port}`;
  async function api(token,method,path,body,status=200){
    const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
    const j=await r.json();assert.equal(r.status,status,`${method} ${path} ${JSON.stringify(j)}`);return j;
  }
  async function login(role,password=mdp){
    const u=users[role];
    // Horloge MFA de cette fixture uniquement, pour créer plusieurs sessions avec le code valide courant.
    await pool.query('UPDATE sh_utilisateurs SET totp_dernier_pas=0 WHERE id=$1',[u.id]);
    const a=await api(null,'POST','/connexion',{email:u.email,mot_de_passe:password});assert.equal(a.etape,'2fa');
    return (await api(null,'POST','/connexion/2fa',{jeton:a.jeton,code:totp.codePourPas(u.secret,totp.pasActuel())})).token;
  }
  for(const role of Object.keys(users))tokens[role]=await login(role);
  const admin=()=>tokens.administration;
  const lien=()=>mails.at(-1).texte.match(/#recuperation=([a-f0-9]{64})/)[1];
  async function attendreMail(n){for(let i=0;i<100&&mails.length<n;i++)await new Promise(r=>setTimeout(r,5));assert.equal(mails.length,n);}

  await t.test('migrations additives rejouables, versions 7 à 23 et données préservées',async()=>{
    assert.deepEqual(await migrerSh(pool,env),{version:47,appliquee:false});
    assert.equal((await pool.query('SELECT count(*)::int n FROM sh_utilisateurs')).rows[0].n,4);
  });
  await t.test('rôle créé désactivé et entrées de périmètre invalides refusées',async()=>{
    const corps={nom:'Rôle inactif de recette',base_role:'support',permissions:['GET /projets'],actif:false};
    const role=await api(admin(),'POST','/roles-personnalises',corps);
    assert.equal(role.actif,false);
    await api(admin(),'PUT',`/equipe/${users.support.id}/role-personnalise`,{role_id:role.id},404);
    await api(admin(),'POST','/roles-personnalises',{...corps,nom:'Booléen invalide',actif:'false'},400);
    await api(admin(),'POST','/roles-personnalises',{...corps,nom:'Permission invalide',permissions:['toString']},400);
    for(const pays_code of ['',null,'CAN','1A'])await api(admin(),'POST',`/equipe/${users.support.id}/affectations`,{type:'pays',pays_code},400);
  });
  await t.test('contrats, PDF et paramètres refusés aux rôles non autorisés',async()=>{
    for(const role of ['support','implantation'])for(const p of ['/crm/contrats','/crm/contrats/1','/crm/contrats/1/pdf','/parametres'])await api(tokens[role],'GET',p,null,403);
    for(const role of ['support','implantation','finance'])await api(tokens[role],'POST',`/equipe/${users.support.id}/sessions/fermer`,{},403);
    await api(null,'GET','/parametres',null,401);
  });
  await t.test('configuration publique et paramètres effectifs sans secret',async()=>{
    assert.equal((await api(null,'GET','/connexion/configuration')).recuperation_disponible,true);
    const p=await api(admin(),'GET','/parametres');assert.equal(p.securite.mfa_obligatoire,true);
    assert.ok(!JSON.stringify(p).includes(env.SH_MFA_ENCRYPTION_KEY));
  });
  await t.test('journal opérationnel : aucune fuite des devis ou paiements par les traces',async()=>{
    await pool.query("INSERT INTO sh_journal(action,cible,detail) VALUES('Devis créé','confidentiel','total 987654 CAD'),('Tâche créée','opérationnel','test')");
    const support=await api(tokens.support,'GET','/journal');assert.ok(support.some(j=>j.action==='Tâche créée'));assert.ok(!JSON.stringify(support).includes('987654'));
    assert.ok(JSON.stringify(await api(admin(),'GET','/journal')).includes('987654'));
  });
  await t.test('langue validée, persistée et journalisée',async()=>{
    await api(tokens.support,'PUT','/moi/langue',{langue:'en'});
    assert.equal((await api(tokens.support,'GET','/moi')).utilisateur.langue,'en');
    await api(tokens.support,'PUT','/moi/langue',{langue:'zz'},400);
  });
  await t.test('fuseau horaire individuel validé, persisté, isolé et journalisé',async()=>{
    await api(tokens.support,'PUT','/moi/fuseau-horaire',{fuseau_horaire:'Africa/Lome'});
    assert.equal((await api(tokens.support,'GET','/moi')).utilisateur.fuseau_horaire,'Africa/Lome');
    assert.equal((await api(admin(),'GET','/moi')).utilisateur.fuseau_horaire,'America/Toronto');
    await api(tokens.support,'PUT','/moi/fuseau-horaire',{fuseau_horaire:'Mars/Olympus'},400);
  });
  await t.test('erreurs et notifications SH rendues en anglais côté serveur',async()=>{
    const r=await fetch(base+'/api/parametres',{headers:{'X-Langue':'en'}});assert.equal(r.status,401);assert.equal((await r.json()).erreur,'Sign-in required.');
    const projet=(await pool.query("INSERT INTO sh_projets(nom) VALUES('Notification bilingue') RETURNING id")).rows[0];
    const tache=(await pool.query("INSERT INTO sh_taches(projet_id,titre) VALUES($1,'Notification bilingue') RETURNING id",[projet.id])).rows[0];
    await pool.query("INSERT INTO sh_notifications(utilisateur_id,type,titre,lien,ressource_type,ressource_id) VALUES($1,'tache','Tâche attribuée : Pilote Québec','taches','tache',$2)",[users.support.id,tache.id]);
    const n=await api(tokens.support,'GET','/notifications');assert.ok(n.notifications.some(n=>n.titre==='Task assigned: Pilote Québec'));
  });
  await t.test('présence : six statuts, plusieurs appareils, expiration et aucune activité privée',async()=>{
    const id=users.support.id;
    const statut=async()=>{const r=await api(tokens.support,'GET','/presence');assert.ok(r.employes.every(u=>Object.keys(u).sort().join(',')==='id,statut'));return r.employes.find(u=>u.id===id).statut;};
    await api(null,'GET','/presence',null,401);assert.equal(await statut(),'en_ligne');
    await api(tokens.support,'PUT','/moi/presence',{statut:'occupe'});await api(tokens.support,'POST','/moi/presence',{});
    const autre=await login('support');assert.equal(await statut(),'occupe','Une nouvelle connexion ne doit pas effacer le statut volontaire');
    await api(tokens.support,'PUT','/moi/presence',{statut:'en_ligne',utilisateur_id:users.administration.id},400);
    await pool.query("UPDATE sh_sessions SET presence_le=now()-interval '91 seconds' WHERE token=$1",[empreinte(tokens.support)]);
    assert.equal(await statut(),'occupe','Le deuxième appareil maintient la présence');
    const autreId=(await pool.query('SELECT id FROM sh_sessions WHERE token=$1',[empreinte(autre)])).rows[0].id;
    await api(tokens.support,'POST',`/moi/sessions/${autreId}/revoquer`,{});assert.equal(await statut(),'hors_ligne');
    await api(tokens.support,'POST','/moi/presence',{});
    for(const s of ['en_ligne','occupe','en_reunion','en_pause','absent','hors_ligne']){
      await api(tokens.support,'PUT','/moi/presence',{statut:s});assert.equal(await statut(),s);
    }
    await api(tokens.support,'PUT','/moi/presence',{statut:'en_ligne'});
  });
  await t.test('sessions : aucune empreinte divulguée, session étrangère protégée',async()=>{
    const s=await api(tokens.support,'GET','/moi/sessions');assert.ok(s.length&&s[0].courante);
    assert.ok(!('token'in s[0]));assert.ok(!('token_hache'in s[0]));
    const a=(await api(admin(),'GET','/moi/sessions'))[0];
    await api(tokens.support,'POST',`/moi/sessions/${a.id}/revoquer`,{},404);
  });
  await t.test('révocation ciblée effective sur un autre appareil',async()=>{
    const autre=await login('support');const toutes=await api(admin(),'GET',`/equipe/${users.support.id}/sessions`);
    const id=(await pool.query('SELECT id FROM sh_sessions WHERE token=$1',[empreinte(autre)])).rows[0].id;
    assert.ok(toutes.some(s=>s.id===id));
    await api(admin(),'POST',`/equipe/${users.support.id}/sessions/${id}/revoquer`,{});
    await api(autre,'GET','/moi',null,401);await api(tokens.support,'GET','/moi');
  });
  await t.test('changement du mot de passe conserve la session courante et ferme les autres',async()=>{
    const autre=await login('support');
    await api(tokens.support,'PUT','/moi/mot-de-passe',{actuel:mdp,nouveau:'Fixture-Nouveau-2026'});
    await api(tokens.support,'GET','/moi');await api(autre,'GET','/moi',null,401);
    await api(tokens.support,'PUT','/moi/mot-de-passe',{actuel:'Fixture-Nouveau-2026',nouveau:mdp});
  });
  await t.test('désactivation, réactivation et révocation totale',async()=>{
    await api(admin(),'PUT',`/equipe/${users.support.id}`,{actif:'false'},400);
    await api(admin(),'PUT',`/equipe/${users.support.id}`,{actif:false});
    await api(tokens.support,'GET','/moi',null,401);
    await api(admin(),'PUT',`/equipe/${users.support.id}`,{actif:true});tokens.support=await login('support');
    await api(admin(),'POST',`/equipe/${users.support.id}/sessions/fermer`,{});
    await api(tokens.support,'GET','/moi',null,401);tokens.support=await login('support');
  });
  await t.test('récupération : réponse identique, empreinte seulement et MFA inchangée',async()=>{
    const a=await api(null,'POST','/mot-de-passe/demander',{email:users.support.email});await attendreMail(1);
    const b=await api(null,'POST','/mot-de-passe/demander',{email:'inexistant@example.invalid'});assert.deepEqual(a,b);
    const jeton=lien();const r=(await pool.query('SELECT * FROM sh_recuperations WHERE jeton_hache=$1',[empreinte(jeton)])).rows[0];assert.ok(r);assert.ok(!JSON.stringify(r).includes(jeton));
    await api(null,'POST','/mot-de-passe/reinitialiser',{jeton,nouveau:'Fixture-Recuperee-2026'});
    await api(tokens.support,'GET','/moi',null,401);
    const u=(await pool.query('SELECT * FROM sh_utilisateurs WHERE id=$1',[users.support.id])).rows[0];assert.equal(u.totp_actif,true);assert.ok(await verifierAsync('Fixture-Recuperee-2026',u.mot_de_passe_hash));
    await api(null,'POST','/mot-de-passe/reinitialiser',{jeton,nouveau:mdp},400);
    tokens.support=await login('support','Fixture-Recuperee-2026');
  });
  await t.test('jeton expiré refusé et limite de trois liens par heure',async()=>{
    await api(admin(),'POST',`/equipe/${users.support.id}/recuperer`,{});await attendreMail(2);const jeton=lien();
    await pool.query("UPDATE sh_recuperations SET expire_le=now()-interval '1 minute' WHERE jeton_hache=$1",[empreinte(jeton)]);
    await api(null,'POST','/mot-de-passe/reinitialiser',{jeton,nouveau:mdp},400);
    await api(null,'POST','/mot-de-passe/demander',{email:users.support.email});await attendreMail(3);
    await api(null,'POST','/mot-de-passe/demander',{email:users.support.email});await new Promise(r=>setTimeout(r,20));assert.equal(mails.length,3);
  });
  await t.test('double consommation concurrente : une seule réussite',async()=>{
    const n=mails.length;
    await api(null,'POST','/mot-de-passe/demander',{email:users.finance.email});await attendreMail(n+1);const jeton=lien();
    const resultats=await Promise.all([1,2].map(async()=>{
      const r=await fetch(base+'/api/mot-de-passe/reinitialiser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jeton,nouveau:'Finance-Recuperee-2026'})});return r.status;
    }));assert.deepEqual(resultats.sort(),[200,400]);
  });
  await t.test('échec du courriel : jeton révoqué, erreur journalisée sans secret',async()=>{
    courriel.definirTransport(async()=>{throw new Error('secret-transport-ne-doit-pas-apparaitre');});
    await api(null,'POST','/mot-de-passe/demander',{email:users.finance.email});
    let erreur=false;
    for(let i=0;i<100&&!erreur;i++){
      erreur=(await pool.query("SELECT 1 FROM sh_journal WHERE action='Échec envoi récupération SH'")).rowCount>0;
      if(!erreur)await new Promise(r=>setTimeout(r,5));
    }
    assert.equal(erreur,true);
    assert.equal((await pool.query('SELECT count(*)::int n FROM sh_recuperations WHERE utilisateur_id=$1 AND utilise_le IS NULL AND revoque_le IS NULL',[users.finance.id])).rows[0].n,0);
    courriel.definirTransport(async m=>mails.push(m));
  });
  await t.test('sans fournisseur : disponibilité false et refus explicite de l’envoi',async()=>{
    const ancien=process.env.SMTP_URL;delete process.env.SMTP_URL;courriel.definirTransport(null);
    try{assert.equal((await api(null,'GET','/connexion/configuration')).recuperation_disponible,false);
      await api(null,'POST','/mot-de-passe/demander',{email:users.finance.email},503);
    }finally{if(ancien!==undefined)process.env.SMTP_URL=ancien;courriel.definirTransport(async m=>mails.push(m));}
  });
  await t.test('invitation expirée visible en diagnostic et refusée à la consommation',async()=>{
    const jeton='a'.repeat(64);
    await pool.query(`INSERT INTO sh_invitations(jeton_hache,email,nom,role,expire_le) VALUES($1,'expire@example.invalid','Expiré','support',now()-interval '1 hour')`,[empreinte(jeton)]);
    assert.ok((await api(admin(),'GET','/invitations')).some(i=>i.email==='expire@example.invalid'));
    await api(null,'POST','/invitations/consommer',{jeton,nouveau:mdp},400);
  });
  await t.test('archivage garde les auteurs, interdit réactivation directe et restaure sans ouvrir les accès',async()=>{
    const id=users.support.id;
    await api(admin(),'POST',`/equipe/${id}/archiver`,{});
    await api(tokens.support,'GET','/moi',null,401);await api(admin(),'PUT',`/equipe/${id}`,{actif:true},409);
    assert.ok((await pool.query('SELECT count(*)::int n FROM sh_journal WHERE utilisateur_id=$1',[id])).rows[0].n>0);
    await api(admin(),'POST',`/equipe/${id}/restaurer`,{});
    const u=(await pool.query('SELECT actif,archive_le FROM sh_utilisateurs WHERE id=$1',[id])).rows[0];assert.equal(u.actif,false);assert.equal(u.archive_le,null);
    await api(admin(),'PUT',`/equipe/${id}`,{actif:true});tokens.support=await login('support','Fixture-Recuperee-2026');
  });
  await t.test('profil et rôle : validation serveur et révocation immédiate',async()=>{
    const id=users.support.id;
    await api(admin(),'PUT',`/equipe/${id}/profil`,{nom:'Consultant fictif',fonction:'Support technique'});
    await api(admin(),'PUT',`/equipe/${id}/profil`,{email:users.administration.email},409);
    await api(admin(),'PUT',`/equipe/${id}/role`,{role:'finance'});
    await api(tokens.support,'GET','/moi',null,401);
    assert.equal((await pool.query('SELECT role FROM sh_utilisateurs WHERE id=$1',[id])).rows[0].role,'finance');
  });
  await t.test('pilotes simultanés, chef et équipe, tâches critiques et séparation des sous-tâches',async()=>{
    const h=await api(admin(),'POST','/hopitaux',{nom:'Pilote Hôpital Test',environnement:'recette',code_etab:'PTEST',pays_code:'TG'});
    const id=h.id;
    await api(admin(),'POST','/projets',{hopital_id:id,nom:'Pilote sans équipe',type_projet:'pilote'},400);
    const body={hopital_id:id,nom:'Pilote Hôpital Test',type_projet:'pilote',responsable_id:users.administration.id,membres:[users.implantation.id]};
    const p=await api(admin(),'POST','/projets',body);const autre=await api(admin(),'POST','/projets',{...body,nom:'Deuxième pilote fictif'});
    assert.notEqual(p.id,autre.id);
    const detail=await api(admin(),'GET',`/projets/${p.id}`);assert.equal(detail.membres.length,2);assert.match(detail.reference,/^PRJ-/);
    await api(admin(),'PUT',`/projets/${p.id}`,{nom:'Pilote Hôpital Test validé',membres:[users.administration.id,users.implantation.id]});
    await api(admin(),'PUT',`/projets/${p.id}`,{membres:[]},400);
    const ta=await api(admin(),'POST',`/projets/${p.id}/taches`,{titre:'Valider la sécurité du pilote',critique_golive:true,criteres_acceptation:'Recette de sécurité approuvée'});
    await api(admin(),'POST',`/projets/${autre.id}/taches`,{titre:'Sous-tâche croisée',parent_id:ta.id},400);
    const avant=await api(admin(),'POST',`/hopitaux/${id}/golive/preflight`,{});
    assert.ok(avant.bloqueurs.some(b=>b.startsWith('taches_critiques_non_terminees:')));
    // Même si les anciennes cases sont cochées, l'activation directe ne doit pas
    // contourner le blocage par tâches critiques du préflight.
    await pool.query('UPDATE hopitaux SET relie=true WHERE id=$1',[id]);
    await pool.query('UPDATE verifications v SET faite=true FROM etapes e WHERE e.id=v.etape_id AND e.hopital_id=$1 AND e.rang<6',[id]);
    const bloque=await api(admin(),'POST',`/hopitaux/${id}/activation`,{},409);
    assert.match(bloque.erreur,/tâches critiques/);
    await pool.query('UPDATE hopitaux SET relie=false WHERE id=$1',[id]);
    await pool.query('UPDATE verifications v SET faite=false FROM etapes e WHERE e.id=v.etape_id AND e.hopital_id=$1 AND e.rang<6',[id]);
    await api(admin(),'PUT',`/taches/${ta.id}`,{statut:'terminee'});
    const apres=await api(admin(),'POST',`/hopitaux/${id}/golive/preflight`,{});
    assert.ok(!apres.bloqueurs.some(b=>b.startsWith('taches_critiques_non_terminees:')));
    assert.equal(apres.possible,false,'Aucun Go Live sans environnement configuré et vérifications');
  });
  await t.test('isolation RLS : pays, clients, deux projets d’un même hôpital, rôles et exports',async()=>{
    const secret=totp.nouveauSecret();
    const u=(await pool.query(`INSERT INTO sh_utilisateurs(email,nom,role,mot_de_passe_hash,mdp_temporaire,totp_actif,totp_secret)
      VALUES('limite@example.invalid','Consultant limité','implantation',$1,false,true,$2) RETURNING id,email`,[await hacherAsync(mdp),chiffrerSecret(secret,env)])).rows[0];
    users.limite={...u,secret};let token=await login('limite');
    assert.deepEqual(await api(token,'GET','/projets'),[]);assert.deepEqual(await api(token,'GET','/hopitaux'),[]);
    const orgs=[],hs=[],ps=[];
    for(const [nom,pays,code]of [['Client Canada','CA','PCAN'],['Client Togo','TG','PTOG']]){
      const o=await api(admin(),'POST','/crm/organisations',{nom,pays_code:pays});orgs.push(o.id);
      const h=await api(admin(),'POST',`/crm/organisations/${o.id}/hopital`,{environnement:'recette',code_etab:code});hs.push(h.id);
      ps.push(await api(admin(),'POST','/projets',{hopital_id:h.id,nom:'Projet '+pays}));
    }
    const voisin=await api(admin(),'POST','/projets',{hopital_id:hs[0],nom:'Autre projet même hôpital'});
    await api(admin(),'POST',`/equipe/${u.id}/affectations`,{type:'projet',projet_id:ps[0].id});
    assert.deepEqual((await api(token,'GET','/projets')).map(p=>p.id),[ps[0].id]);
    await api(token,'GET',`/projets/${voisin.id}`,null,404);await api(token,'GET',`/projets/${ps[1].id}`,null,404);
    await api(token,'GET',`/hopitaux/${hs[1]}`,null,404);
    const propre=await api(admin(),'POST',`/projets/${ps[0].id}/taches`,{titre:'Tâche autorisée'});
    await api(admin(),'POST',`/projets/${ps[1].id}/taches`,{titre:'Tâche autre pays'});
    assert.deepEqual((await api(token,'GET','/taches')).map(t=>t.id),[propre.id]);
    const cree=await api(admin(),'POST','/roles-personnalises',{nom:'Consultant lecture',base_role:'support',permissions:['GET /projets','GET /projets/:id','GET /taches']});
    await api(admin(),'POST','/roles-personnalises',{nom:'Escalade interdite',base_role:'support',permissions:['POST /equipe']},400);
    await api(admin(),'PUT',`/equipe/${u.id}/role-personnalise`,{role_id:cree.id});await api(token,'GET','/moi',null,401);token=await login('limite');
    await api(token,'GET','/projets');await api(token,'PUT',`/taches/${propre.id}`,{statut:'terminee'},403);await api(token,'GET','/rapports/export?section=support',null,403);
    const restreint=require('../src/sh/perimetre-pool').creerPoolPerimetre(pool);
    await restreint.executer({id:u.id,role:'support',methode:'GET'},async()=>{
      const r=await restreint.query('SELECT id FROM sh_projets ORDER BY id');assert.deepEqual(r.rows.map(p=>p.id),[ps[0].id]);
      assert.equal((await restreint.query("UPDATE sh_taches SET titre='Ne doit pas changer' WHERE id=$1",[propre.id])).rowCount,0);
    });
    await restreint.executer({id:u.id,role:'support',methode:'POST'},async()=>{
      assert.equal((await restreint.query('UPDATE sh_projets SET nom=$2 WHERE id=$1',[ps[1].id,'Interdit'])).rowCount,0);
      await assert.rejects(restreint.query("INSERT INTO sh_affectations(utilisateur_id,type) VALUES($1,'global')",[u.id]),e=>e.code==='42501');
    });
    const aff=await api(admin(),'GET',`/equipe/${u.id}/affectations`);
    await api(admin(),'POST',`/equipe/${u.id}/affectations/${aff[0].id}/retirer`,{});await api(token,'GET','/moi',null,401);
    token=await login('limite');assert.deepEqual(await api(token,'GET','/projets'),[]);
  });
  await t.test('affectations pays, client et hôpital : lectures et mutations négatives entre pays et clients',async()=>{
    const hs=[],ps=[],orgs=[];
    for(const [suffixe,pays]of [['CA1','CA'],['CA2','CA'],['TG1','TG']]){
      const o=await api(admin(),'POST','/crm/organisations',{nom:'Client Isolation '+suffixe,pays_code:pays});orgs.push(o);
      const h=await api(admin(),'POST',`/crm/organisations/${o.id}/hopital`,{code_etab:'ISO-'+suffixe,environnement:'pilote'});hs.push(h);
      ps.push(await api(admin(),'POST','/projets',{hopital_id:h.id,nom:'Projet Isolation '+suffixe}));
      await api(admin(),'POST',`/projets/${ps.at(-1).id}/taches`,{titre:'Tâche Isolation '+suffixe});
    }
    const memeHopital=await api(admin(),'POST','/projets',{hopital_id:hs[0].id,nom:'Second projet Isolation CA1'});
    assert.equal((await pool.query('SELECT organisation_id FROM hopitaux WHERE id=$1',[hs[0].id])).rows[0].organisation_id,orgs[0].id);
    await api(admin(),'PUT',`/hopitaux/${hs[0].id}`,{pays_code:'TG'},409);
    await api(admin(),'PUT',`/crm/organisations/${orgs[0].id}`,{pays_code:'TG'},409);
    // Simuler les données de la version 13 : le client CRM existe, le lien inverse manque.
    await pool.query('UPDATE hopitaux SET organisation_id=NULL WHERE id=$1',[hs[0].id]);
    await pool.query('DELETE FROM sh_migrations WHERE version=14');
    assert.deepEqual(await migrerSh(pool,env),{version:47,appliquee:true});
    assert.equal((await pool.query('SELECT organisation_id FROM hopitaux WHERE id=$1',[hs[0].id])).rows[0].organisation_id,orgs[0].id);
    await pool.query('UPDATE hopitaux SET organisation_id=$2 WHERE id=$1',[hs[1].id,orgs[0].id]);
    await pool.query('DELETE FROM sh_migrations WHERE version=14');
    await assert.rejects(migrerSh(pool,env),/Association client\/hôpital contradictoire/);
    assert.equal((await pool.query('SELECT organisation_id FROM hopitaux WHERE id=$1',[hs[1].id])).rows[0].organisation_id,orgs[0].id,'La migration ne remplace pas une association contradictoire.');
    await pool.query('UPDATE hopitaux SET organisation_id=$2 WHERE id=$1',[hs[1].id,orgs[1].id]);await migrerSh(pool,env);
    const attendusPays=(await pool.query("SELECT p.id FROM sh_projets p JOIN hopitaux h ON h.id=p.hopital_id WHERE h.pays_code='CA'")).rows.map(x=>x.id).sort();
    const {JOURNAL_OPERATIONNEL}=require('../src/sh/permissions');
    const action=JOURNAL_OPERATIONNEL[0];
    await pool.query('INSERT INTO sh_journal(hopital_id,action,cible) VALUES($1,$2,$3)',[hs[2].id,action,'Marqueur confidentiel TG1']);
    for(const type of ['pays','client','hopital']){
      const secret=totp.nouveauSecret(),cle='sonde_'+type;
      const u=(await pool.query(`INSERT INTO sh_utilisateurs(email,nom,role,mot_de_passe_hash,mdp_temporaire,totp_actif,totp_secret)
        VALUES($1,$2,'implantation',$3,false,true,$4) RETURNING id,email`,[cle+'@example.invalid',cle,await hacherAsync(mdp),chiffrerSecret(secret,env)])).rows[0];
      users[cle]={...u,secret};const token=await login(cle);
      const aff=await api(admin(),'POST',`/equipe/${u.id}/affectations`,{type,...(type==='pays'?{pays_code:'CA'}:type==='client'?{organisation_id:orgs[0].id}:{hopital_id:hs[0].id})});
      assert.deepEqual((await api(token,'GET','/projets')).map(p=>p.id).sort(),type==='pays'?attendusPays:[ps[0].id,memeHopital.id].sort());
      await api(token,'GET',`/projets/${ps[2].id}`,null,404);
      await api(token,'PUT',`/projets/${ps[2].id}`,{nom:'Renommage hors pays interdit'},404);
      await api(token,'POST',`/projets/${ps[2].id}/taches`,{titre:'Insertion hors pays interdite'},404);
      await api(token,'GET',`/hopitaux/${hs[2].id}/rapport.pdf`,null,404);
      if(type!=='pays')await api(token,'GET',`/projets/${ps[1].id}`,null,404);
      assert.ok(!(await api(token,'GET','/journal')).some(j=>j.cible==='Marqueur confidentiel TG1'));
      await api(admin(),'POST',`/equipe/${u.id}/affectations/${aff.id}/retirer`,{});await api(token,'GET','/moi',null,401);
    }
    assert.equal((await api(admin(),'GET',`/projets/${ps[2].id}`)).nom,'Projet Isolation TG1');
    assert.equal((await pool.query("SELECT count(*)::int n FROM sh_taches WHERE titre='Insertion hors pays interdite'")).rows[0].n,0);
  });
  await t.test('navigateur : récupération et paramètres, retour connexion, absence du menu contrats pour implantation',async()=>{
    const {chromium}=require('playwright');const browser=await chromium.launch({headless:true});
    try{
      const page=await browser.newPage();await page.goto(base);await page.locator('#b-oubli').click();
      await page.locator('#o-email').fill('inexistant@example.invalid');await page.locator('#f-oubli button[type=submit]').click();
      await page.waitForFunction(()=>document.querySelector('#o-message').textContent.includes('Si un compte actif'));
      await page.locator('#b-oubli-retour').click();assert.ok(await page.locator('#f-connexion').isVisible());
      await page.evaluate(token=>sessionStorage.setItem('sh-token',token),admin());await page.reload();
      await page.locator('[data-v=parametres]').click();await page.waitForSelector('#param-utilisateurs');
      await page.locator('#param-utilisateurs').click();await page.waitForSelector('[data-aide]');
      await page.locator(`[data-aide="${users.administration.id}"]`).click();await page.waitForSelector('#acces-sessions table');
      await page.locator('#modale .actions button').last().click();
      await page.locator('#sh-mon-statut').selectOption('en_reunion');
      await page.waitForFunction(id=>document.querySelector(`[data-presence-user="${id}"] span`)?.textContent==='En réunion',users.administration.id);
      await page.locator('#sh-mon-statut').selectOption('en_ligne');
      await page.selectOption('#sh-langue','en');await page.waitForFunction(()=>document.documentElement.lang==='en-CA');
      for(const [vue,titre]of [['crm','CRM'],['contrats','Quotes and contracts'],['facturation','Billing'],['projets','Projects'],['taches','Tasks'],['calendrier','Calendar'],['support','Support'],['documents','Documents'],['hebergement','Hosting'],['rapports','Reports'],['equipe','SH team'],['compte','My account'],['parametres','Settings']]){
        await page.locator(`[data-v="${vue}"]`).click();await page.waitForFunction(t=>document.querySelector('#contenu h2')?.textContent===t,titre);
      }
      await page.selectOption('#sh-langue','fr');await page.waitForFunction(()=>document.querySelector('#contenu h2')?.textContent==='Paramètres');
      await page.evaluate(token=>sessionStorage.setItem('sh-token',token),tokens.implantation);await page.reload();
      await page.waitForFunction(()=>!document.querySelector('#ecran-app').hidden);assert.equal(await page.locator('[data-v=contrats]').isVisible(),false);
      await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      await page.goto(base+'/sh-validation/');
      await page.evaluate(token=>sessionStorage.setItem('sh-token:/sh-validation',token),admin());await page.reload();
      await page.locator('[data-v=parametres]').click();await page.waitForSelector('#param-utilisateurs');
      assert.ok(await page.locator('#ecran-app').isVisible(),'Les routes et sessions restent isolées sous le chemin de validation');
    }finally{await browser.close();}
  });
  await t.test('journal sans mot de passe ni jeton de récupération',async()=>{
    const j=JSON.stringify((await pool.query('SELECT action,cible,detail FROM sh_journal')).rows);
    assert.ok(!j.includes('Fixture-'));for(const m of mails)assert.ok(!j.includes(m.texte.match(/#recuperation=([a-f0-9]{64})/)?.[1]||'secret_absent'));
  });
  await t.test('réinitialisation de fixture SH : trois migrations successives sans fonction RLS résiduelle',async()=>{
    for(let n=0;n<3;n++){
      await require('../db/sh-vider').viderBaseSh(pool);
      await pool.query(fs.readFileSync(require.resolve('../db/sh-schema.sql'),'utf8'));
      assert.equal((await migrerSh(pool,env)).version,47);
      assert.equal((await migrerSh(pool,env)).appliquee,false);
    }
  });
});
