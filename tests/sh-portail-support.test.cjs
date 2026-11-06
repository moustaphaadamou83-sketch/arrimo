'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const { allerOnglet } = require('./aide-navigation.cjs');
const {creerPool}=require('../src/db'),{hacherAsync}=require('../src/auth'),{empreinte}=require('../src/sh/security');
const courriel=require('../src/courriel');
const {demarrerServeur}=require('./serveur-test.cjs');
test('portail client : serveurs hospitalier et SH, isolation, messages publics et navigateur',{timeout:180000},async t=>{
  const url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/arrimo_sh_lot1_test_[a-z0-9_]+$/);
  const pool=creerPool(url.href);t.after(()=>pool.end());assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0);
  const vars=['ARRIMO_ENV','ARRIMO_SUPPORT_SH_URL','ARRIMO_SUPPORT_CLE','ARRIMO_DEMO'];const avant=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
  t.after(()=>{for(const k of vars){if(avant[k]===undefined)delete process.env[k];else process.env[k]=avant[k];}});
  process.env.ARRIMO_ENV='pilote';delete process.env.ARRIMO_DEMO;
  await pool.query(fs.readFileSync(require.resolve('../db/schema.sql'),'utf8'));await require('../db/configuration-base').configurationBase(pool);
  await pool.query(fs.readFileSync(require.resolve('../db/sh-schema.sql'),'utf8'));
  const cle=crypto.randomBytes(32).toString('hex'),env={SH_SUPPORT_PILOTE_CLE:cle,SH_MFA_ENCRYPTION_KEY:Buffer.alloc(32,6).toString('base64'),SH_DOCUMENTS_DIR:require('node:os').tmpdir()+'/arrimo-pj-'+crypto.randomUUID()};
  t.after(()=>fs.promises.rm(env.SH_DOCUMENTS_DIR,{recursive:true,force:true}));
  assert.equal((await require('../src/sh/migrations').migrerSh(pool,env)).version,41);
  const us=(await pool.query("INSERT INTO sh_utilisateurs(email,nom,role,mot_de_passe_hash,mdp_temporaire,totp_actif) VALUES('support.admin@example.invalid','Support Test','administration','sans-connexion',false,true) RETURNING id")).rows[0];
  const jetonSH=crypto.randomBytes(32).toString('hex');await pool.query("INSERT INTO sh_sessions(token,token_hache,utilisateur_id,expire_le) VALUES($1,true,$2,now()+interval '1 hour')",[empreinte(jetonSH),us.id]);
  const sh=await demarrerServeur(require('../src/sh/app').creerAppSh(pool,{env}));t.after(()=>new Promise(r=>sh.close(r)));
  const baseSH=`http://127.0.0.1:${sh.address().port}`;process.env.ARRIMO_SUPPORT_SH_URL=baseSH;process.env.ARRIMO_SUPPORT_CLE=cle;
  const hop=await demarrerServeur(require('../src/app').creerApp(pool));t.after(()=>new Promise(r=>hop.close(r)));
  const base=`http://127.0.0.1:${hop.address().port}`,hs=[],es=[],tokens=[];const mdp='Portail-Fictif-2026';
  async function appel(baseUrl,token,method,path,body,status=200){const r=await fetch(baseUrl+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>null);assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(j)}`);return j;}
  for(const suffixe of ['A','B']){
    hs.push((await pool.query("INSERT INTO hopitaux(nom,code_etab,environnement,relie) VALUES($1,$2,'pilote',true) RETURNING id",['Hôpital Support '+suffixe,'SUP-'+suffixe])).rows[0]);
    es.push((await pool.query("INSERT INTO etablissements(code,nom,config_id,module_actif,latitude,longitude) SELECT $1,$2,id,true,46,-71 FROM config_pays WHERE code='QC' RETURNING id",['SUP-'+suffixe,'Hôpital Support '+suffixe])).rows[0]);
    const u=(await pool.query("INSERT INTO utilisateurs(email,nom,role,mot_de_passe_hash,mdp_temporaire) VALUES($1,$2,'coordonnateur',$3,false) RETURNING id",['portail.'+suffixe.toLowerCase()+'@example.invalid','Client '+suffixe,await hacherAsync(mdp)])).rows[0];
    await pool.query('INSERT INTO utilisateur_etablissements(utilisateur_id,etablissement_id) VALUES($1,$2)',[u.id,es.at(-1).id]);
    tokens.push((await appel(base,null,'POST','/connexion',{email:'portail.'+suffixe.toLowerCase()+'@example.invalid',mot_de_passe:mdp})).token);
  }
  const projets=[];for(let i=0;i<2;i++)projets.push((await pool.query('INSERT INTO sh_projets(hopital_id,nom) VALUES($1,$2) RETURNING id',[hs[i].id,'Projet Support '+i])).rows[0]);
  const prive=await appel(baseSH,jetonSH,'POST','/support/tickets',{hopital_id:hs[0].id,titre:'Dossier SH interne secret'});assert.match(prive.reference,/^TICK-\d{4}-0001$/);
  const employes=[];
  for(let i=0;i<2;i++){
    const u=(await pool.query("INSERT INTO sh_utilisateurs(email,nom,role,mot_de_passe_hash,mdp_temporaire,totp_actif) VALUES($1,$2,'support','sans-connexion',false,true) RETURNING id",[`support.${i}@example.invalid`,`Support ${i}`])).rows[0];
    const token=crypto.randomBytes(32).toString('hex');await pool.query("INSERT INTO sh_sessions(token,token_hache,utilisateur_id,expire_le) VALUES($1,true,$2,now()+interval '1 hour')",[empreinte(token),u.id]);
    await pool.query("INSERT INTO sh_affectations(utilisateur_id,type,hopital_id) VALUES($1,'hopital',$2)",[u.id,hs[i].id]);employes.push({...u,token});
  }
  await t.test('clé de service, environnement et session obligatoires',async()=>{
    await appel(base,null,'GET',`/support/tickets?etablissement_id=${es[0].id}`,null,401);
    const r=await fetch(baseSH+'/api/portail-support/pilote/SUP-A/tickets',{headers:{'X-Support-Key':'incorrecte'}});assert.equal(r.status,401);
    assert.equal((await fetch(baseSH+'/api/portail-support/production/SUP-A/tickets',{headers:{'X-Support-Key':cle}})).status,401);
    env.SH_SUPPORT_PRODUCTION_CLE=cle;assert.equal((await fetch(baseSH+'/api/portail-support/pilote/SUP-A/tickets',{headers:{'X-Support-Key':cle}})).status,401);delete env.SH_SUPPORT_PRODUCTION_CLE;
    assert.deepEqual(await appel(base,tokens[0],'GET',`/support/tickets?etablissement_id=${es[0].id}`),{tickets:[],avant_suivant:null});
  });
  let ticket;
  await t.test('création rattachée au bon établissement et auteur imposé côté serveur',async()=>{
    await appel(base,tokens[0],'POST','/support/tickets',{etablissement_id:es[1].id,titre:'Interdit',description:'Interdit'},403);
    await appel(base,tokens[0],'POST','/support/tickets',{etablissement_id:es[0].id,titre:'Projet étranger',description:'Refus attendu',projet_id:projets[1].id},400);
    ticket=await appel(base,tokens[0],'POST','/support/tickets',{etablissement_id:es[0].id,titre:'Connexion indisponible Test',description:'Demande fictive sans donnée clinique',categorie:'acces',demandeur:'identite.fausse@example.invalid',hopital_id:hs[1].id,projet_id:projets[0].id});
    assert.match(ticket.reference,/^TICK-\d{4}-0002$/);
    const stocke=(await pool.query('SELECT hopital_id,demandeur_client,client_visible FROM sh_support_tickets WHERE id=$1',[ticket.id])).rows[0];
    assert.equal(stocke.hopital_id,hs[0].id);assert.equal(stocke.demandeur_client,'portail.a@example.invalid');assert.equal(stocke.client_visible,true);
    await appel(base,tokens[1],'GET',`/support/tickets/${ticket.id}?etablissement_id=${es[1].id}`,null,404);
    await appel(base,tokens[0],'GET',`/support/tickets/${prive.id}?etablissement_id=${es[0].id}`,null,404);
  });
  await t.test('OG recherche locale, résumés factuels et isolation des établissements',async()=>{
    await pool.query("UPDATE sh_support_tickets SET description='OG fixture phrase confidentielle' WHERE id=$1",[ticket.id]);
    const etranger=await appel(baseSH,jetonSH,'POST','/support/tickets',{hopital_id:hs[1].id,titre:'OG fixture phrase établissement B'});
    const resultat=await appel(baseSH,employes[0].token,'POST','/support/og/recherche',{recherche:'OG fixture phrase'});
    assert.equal(resultat.mode,'recherche_locale_factuelle');
    assert.ok(resultat.tickets.some(x=>x.id===ticket.id));
    assert.ok(!resultat.tickets.some(x=>x.id===etranger.id));
    assert.ok(!JSON.stringify(resultat).includes('confidentielle'));
    assert.ok(resultat.tickets.every(x=>x.resume.includes(x.reference)&&x.resume.includes(x.statut)));
    await appel(baseSH,employes[0].token,'POST','/support/og/recherche',{recherche:'x'},400);
    await appel(base,tokens[0],'POST','/support/og/recherche',{recherche:'OG fixture'},404);
  });
  await t.test('pièces jointes chiffrées, téléchargeables et isolées par établissement',async()=>{
    const signature=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
    const pj=await appel(base,tokens[0],'POST',`/support/tickets/${ticket.id}/pieces-jointes`,{etablissement_id:es[0].id,nom:'capture.png',contenu_base64:signature.toString('base64')});
    const detail=await appel(base,tokens[0],'GET',`/support/tickets/${ticket.id}?etablissement_id=${es[0].id}`);
    assert.equal(detail.pieces_jointes[0].id,pj.id);assert.equal(detail.pieces_jointes[0].nom,'capture.png');
    await appel(base,tokens[1],'GET',`/support/tickets/${ticket.id}/pieces-jointes/${pj.id}/fichier?etablissement_id=${es[1].id}`,null,404);
    const r=await fetch(`${base}/api/support/tickets/${ticket.id}/pieces-jointes/${pj.id}/fichier?etablissement_id=${es[0].id}`,{headers:{Authorization:'Bearer '+tokens[0]}});
    assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),signature);
    await appel(base,tokens[0],'POST',`/support/tickets/${ticket.id}/pieces-jointes`,{etablissement_id:es[0].id,nom:'faux.png',contenu_base64:Buffer.from('pas une image').toString('base64')},400);
  });
  await t.test('courriels de support : contenu minimal, transport simulé et reprise après erreur',async()=>{
    const envoyes=[],mock=async m=>envoyes.push(m);courriel.definirTransport(mock);
    const envMail={...env,SH_PUBLIC_URL:'https://sh.test.invalid'};
    try{
      const resultat=await require('../src/sh/support-courriels').executer(pool,{env:envMail,limite:50});
      assert.equal(resultat.actif,true);assert.ok(resultat.envoyes>=3);
      assert.ok(envoyes.some(m=>m.a==='portail.a@example.invalid'));
      assert.ok(envoyes.every(m=>m.sujet.includes(ticket.reference)&&!m.texte.includes(ticket.titre)&&!m.texte.includes('Demande fictive sans donnée clinique')));
      const envois=(await pool.query("SELECT count(*)::int n FROM sh_support_courriels WHERE ticket_id=$1 AND etat='envoye'",[ticket.id])).rows[0].n;assert.ok(envois>=3);
      await pool.query("INSERT INTO sh_support_courriels(ticket_id,destinataire,evenement,cle) VALUES($1,'retry@example.invalid','statut','retry-email-fixture')",[ticket.id]);
      courriel.definirTransport(async()=>{throw Object.assign(new Error('secret SMTP fixture'),{code:'SMTP_TEMP'});});
      const echec=await require('../src/sh/support-courriels').executer(pool,{env:envMail,limite:1});assert.equal(echec.echecs,1);
      const ligne=(await pool.query("SELECT etat,tentatives,dernier_code FROM sh_support_courriels WHERE cle='retry-email-fixture'")).rows[0];assert.deepEqual(ligne,{etat:'en_attente',tentatives:1,dernier_code:'SMTP_TEMP'});
    }finally{courriel.definirTransport(null);}
  });
  await t.test('échanges internes masqués, réponses publiques et résolution visibles',async()=>{
    await appel(baseSH,jetonSH,'POST',`/support/tickets/${ticket.id}/messages`,{message:'SECRET INTERNE',interne:true});
    await appel(baseSH,jetonSH,'POST',`/support/tickets/${ticket.id}/messages`,{message:'Réponse publique Test',interne:false});
    await appel(base,tokens[0],'POST',`/support/tickets/${ticket.id}/messages`,{etablissement_id:es[0].id,message:'Précision du client',interne:true});
    const detail=await appel(base,tokens[0],'GET',`/support/tickets/${ticket.id}?etablissement_id=${es[0].id}`);
    assert.deepEqual(detail.messages.map(m=>m.message),['Réponse publique Test','Précision du client']);assert.ok(!JSON.stringify(detail).includes('SECRET INTERNE'));assert.equal(detail.evenements,undefined);
    await appel(baseSH,jetonSH,'PUT',`/support/tickets/${ticket.id}`,{statut:'resolu',resolution:'Accès rétabli Test'});
    assert.equal((await appel(base,tokens[0],'GET',`/support/tickets/${ticket.id}?etablissement_id=${es[0].id}`)).resolution,'Accès rétabli Test');
    await appel(baseSH,jetonSH,'PUT',`/support/tickets/${ticket.id}`,{statut:'ferme'});
    await appel(base,tokens[0],'POST',`/support/tickets/${ticket.id}/messages`,{etablissement_id:es[0].id,message:'Refus après fermeture'},409);
    await appel(baseSH,jetonSH,'PUT',`/support/tickets/${ticket.id}`,{statut:'ouvert'});
  });
  await t.test('publication explicite d’un ticket interne et masquage immédiat',async()=>{
    await appel(baseSH,jetonSH,'PUT',`/support/tickets/${prive.id}`,{client_visible:true});
    await appel(base,tokens[0],'GET',`/support/tickets/${prive.id}?etablissement_id=${es[0].id}`);
    await appel(baseSH,jetonSH,'PUT',`/support/tickets/${prive.id}`,{client_visible:false});
    await appel(base,tokens[0],'GET',`/support/tickets/${prive.id}?etablissement_id=${es[0].id}`,null,404);
  });
  await t.test('numéros concurrents uniques et au-delà de 9999',async()=>{
    const body={etablissement_id:es[0].id,titre:'Parallèle',description:'Fixture concurrente'};
    const tickets=await Promise.all(Array.from({length:5},()=>appel(base,tokens[0],'POST','/support/tickets',body)));assert.equal(new Set(tickets.map(t=>t.reference)).size,5);
    const cle=(await pool.query("SELECT cle FROM sh_compteurs WHERE cle LIKE 'TICK-%'")).rows[0].cle;await pool.query('UPDATE sh_compteurs SET valeur=9999 WHERE cle=$1',[cle]);
    assert.match((await appel(base,tokens[0],'POST','/support/tickets',body)).reference,/-10000$/);
  });
  await t.test('affectations et notifications employés : aucun titre de ticket reçu hors périmètre',async()=>{
    const cree=await appel(baseSH,jetonSH,'POST','/support/tickets',{hopital_id:hs[0].id,titre:'Titre confidentiel établissement A'});
    assert.ok((await appel(baseSH,employes[0].token,'GET','/notifications')).notifications.some(n=>n.titre.includes('Titre confidentiel établissement A')));
    assert.ok(!(await appel(baseSH,employes[1].token,'GET','/notifications')).notifications.some(n=>n.titre.includes('Titre confidentiel établissement A')));
    await appel(baseSH,employes[0].token,'PUT',`/support/tickets/${cree.id}`,{responsable_id:employes[1].id},400);
    await appel(baseSH,employes[0].token,'PUT',`/support/tickets/${cree.id}`,{responsable_id:employes[0].id});
    const restreint=require('../src/sh/perimetre-pool').creerPoolPerimetre(pool);
    await restreint.executer({id:employes[0].id,role:'support',methode:'GET'},async()=>{
      assert.deepEqual((await restreint.query('SELECT * FROM sh_support_destinataires($1)',[hs[1].id])).rows,[],'La fonction ne divulgue aucun destinataire hors périmètre.');
    });
  });
  await t.test('pagination : tous les tickets visibles une fois, aucun ticket voisin, curseurs stricts',async()=>{
    await pool.query("INSERT INTO sh_support_tickets(hopital_id,titre,description,client_visible) SELECT $1,'Page Test '||n,'Fixture de pagination',true FROM generate_series(1,211) n",[hs[0].id]);
    await pool.query("INSERT INTO sh_support_tickets(hopital_id,titre,description,client_visible) SELECT $1,'SECRET VOISIN '||n,'Fixture voisine',true FROM generate_series(1,5) n",[hs[1].id]);
    for(const avant of ['0','-1','01','abc','9223372036854775808','1%26etablissement_id%3D2','1&avant=2'])await appel(base,tokens[0],'GET',`/support/tickets?etablissement_id=${es[0].id}&avant=${avant}`,null,400);
    const ids=[];let avant=null,pages=0;
    do{
      const p=await appel(base,tokens[0],'GET',`/support/tickets?etablissement_id=${es[0].id}${avant?'&avant='+avant:''}`);
      assert.ok(p.tickets.length<=200);assert.ok(!JSON.stringify(p).includes('SECRET VOISIN'));
      ids.push(...p.tickets.map(t=>t.id));avant=p.avant_suivant;pages++;assert.ok(pages<5);
    }while(avant);
    assert.equal(pages,2);assert.equal(new Set(ids).size,ids.length);
    assert.deepEqual(ids,(await pool.query('SELECT id FROM sh_support_tickets WHERE hopital_id=$1 AND client_visible ORDER BY id DESC',[hs[0].id])).rows.map(t=>t.id));
    const malforme=await fetch(base+'/api/support/tickets?etablissement_id='+es[0].id,{method:'POST',headers:{Authorization:'Bearer '+tokens[0],'Content-Type':'text/plain'},body:'non-json'});assert.equal(malforme.status,400);
  });
  await t.test('navigateur mobile : création, lecture et réponse FR/EN sans erreur',async()=>{
    const browser=await require('playwright').chromium.launch();try{
      const page=await browser.newPage({viewport:{width:390,height:844}});const erreurs=[];page.on('pageerror',e=>erreurs.push(e.message));page.on('console',m=>{if(m.type()==='error')erreurs.push(m.text());});
      await page.addInitScript(({token,id})=>{localStorage.setItem('arrimo-token',token);localStorage.setItem('arrimo-ctx',String(id));localStorage.setItem('arrimo-langue','fr');},{token:tokens[0],id:es[0].id});
      await page.goto(base);await page.waitForSelector('body[data-pret="1"]');if(await page.locator('#b-premiers-pas-ok').isVisible())await page.click('#b-premiers-pas-ok');
      // Support client : dans Paramètres depuis la refonte de la navigation (plus d'onglet dans la barre principale).
      await allerOnglet(page,'params');await page.click('#v-params [data-param-nav="support"]');await page.waitForSelector('#support-creer',{state:'attached'});await page.click('#v-support summary');
      await page.fill('#sc-titre','Demande créée au navigateur');await page.fill('#sc-description','Description Test du portail');
      await page.waitForFunction(()=>!enCours);await page.evaluate(()=>rafraichir());assert.equal(await page.inputValue('#sc-titre'),'Demande créée au navigateur');
      await page.locator('#support-creer').evaluate(f=>f.requestSubmit());
      const entree=page.locator('[data-support-ticket]',{hasText:'Demande créée au navigateur'});await entree.waitFor();await entree.click();
      await page.fill('#sc-message','Message client au navigateur');await page.waitForFunction(()=>!enCours);await page.evaluate(()=>rafraichir());assert.equal(await page.inputValue('#sc-message'),'Message client au navigateur');
      await page.locator('#sc-repondre').evaluate(f=>f.requestSubmit());await page.waitForFunction(()=>document.querySelector('#v-support').textContent.includes('Message client au navigateur'));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      const captures=require('node:path').resolve('.local','portail-support-captures');fs.mkdirSync(captures,{recursive:true});await page.screenshot({path:require('node:path').join(captures,'portail-fr.png'),fullPage:true});
      await page.click('#sc-retour');await page.waitForSelector('#sc-anciens');
      await page.click('#sc-anciens');await page.waitForSelector('#sc-recents');
      const anciennePage=await page.locator('[data-support-ticket]').first().getAttribute('data-support-ticket');
      await page.waitForFunction(()=>!enCours);await page.evaluate(()=>rafraichir());assert.equal(await page.locator('[data-support-ticket]').first().getAttribute('data-support-ticket'),anciennePage);
      await page.click('#sc-recents');await page.waitForSelector('#sc-anciens');
      await page.click('#b-menu');await page.selectOption('#langue-barre','en');await page.click('#b-menu');
      await page.waitForFunction(()=>document.querySelector('#v-support').textContent.includes('Client support'));assert.match(await page.textContent('#v-support'),/Client support/);
      await page.screenshot({path:require('node:path').join(captures,'portail-en.png'),fullPage:true});
      let liberer,signaler;const attente=new Promise(r=>{liberer=r;}),demarre=new Promise(r=>{signaler=r;});
      await page.route('**/api/support/tickets?*',async route=>{const response=await route.fetch();signaler();await attente;await route.fulfill({response});});
      await page.evaluate(()=>{void vueSupportClient({avant:null,historique:[]});});
      await demarre;await page.click('#b-menu');await page.click('#b-deconnexion');
      const reponseRetardee=page.waitForResponse(r=>r.url().includes('/api/support/tickets?'));liberer();await(await reponseRetardee).finished();
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      assert.equal(await page.locator('#v-support').innerHTML(),'');
      assert.equal(await page.evaluate(()=>Object.keys(etat.supportBrouillons).length),0,'Les brouillons sont effacés à la déconnexion.');
      assert.deepEqual(erreurs,[]);
    }finally{await browser.close();}
  });
});
