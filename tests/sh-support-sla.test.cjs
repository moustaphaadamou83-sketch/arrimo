'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {creerPool}=require('../src/db'),{hacherAsync}=require('../src/auth'),{empreinte}=require('../src/sh/security');
const {demarrerServeur}=require('./serveur-test.cjs');
test('SLA contractuels : versions, échéances, escalades et droits réels',{timeout:180000},async t=>{
  const url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/arrimo_sh_lot1_test_[a-z0-9_]+$/);
  const pool=creerPool(url.href);t.after(()=>pool.end());assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0);
  const vars=['ARRIMO_ENV','ARRIMO_SUPPORT_SH_URL','ARRIMO_SUPPORT_CLE','ARRIMO_DEMO'];const avant=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
  t.after(()=>{for(const k of vars){if(avant[k]===undefined)delete process.env[k];else process.env[k]=avant[k];}});
  process.env.ARRIMO_ENV='pilote';delete process.env.ARRIMO_DEMO;
  await pool.query(fs.readFileSync(require.resolve('../db/schema.sql'),'utf8'));await require('../db/configuration-base').configurationBase(pool);
  await pool.query(fs.readFileSync(require.resolve('../db/sh-schema.sql'),'utf8'));
  const cle=crypto.randomBytes(32).toString('hex'),env={SH_SUPPORT_PILOTE_CLE:cle,SH_MFA_ENCRYPTION_KEY:Buffer.alloc(32,6).toString('base64')};
  assert.equal((await require(require('node:path').join(process.env.SH_SLA_BASELINE_RELEASE||'/opt/arrimo-sh/releases/support-20261029t1755','src/sh/migrations')).migrerSh(pool,env)).version,20);
  const histHop=(await pool.query("INSERT INTO hopitaux(nom,code_etab,environnement) VALUES('Historique','HIST','pilote') RETURNING id")).rows[0];
  const historique=(await pool.query("INSERT INTO sh_support_tickets(hopital_id,titre,echeance) VALUES($1,'Ancien ticket',now()-interval '1 day') RETURNING *",[histHop.id])).rows[0];
  assert.equal((await require('../src/sh/migrations').migrerSh(pool,env)).version,40);
  const calendrier={mode:'ouvrable',jours:[1,2,3,4,5],debut:'09:00',fin:'17:00',jours_feries:[]};
  const echeance=async joursFeries=>(await pool.query('SELECT sh_sla_echeance($1::timestamptz,120,$2::jsonb,$3) d',[new Date('2026-01-05T16:00:00Z'),JSON.stringify({...calendrier,jours_feries:joursFeries}),'UTC'])).rows[0].d;
  assert.equal((await echeance([])).toISOString(),'2026-01-06T10:00:00.000Z','les minutes restantes reprennent au prochain jour ouvré');
  assert.equal((await echeance(['2026-01-06'])).toISOString(),'2026-01-07T10:00:00.000Z','un jour férié est exclu du calcul');
  assert.throws(()=>require('../src/sh/support-sla').calendrierPropre({...calendrier,jours:[]}),e=>e.statut===400);
  const apres=(await pool.query('SELECT * FROM sh_support_tickets WHERE id=$1',[historique.id])).rows[0];
  for(const k of Object.keys(historique))assert.deepEqual(apres[k],historique[k]);assert.equal(apres.sla_snapshot,null);
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
  const comptes=[];
  for(let i=0;i<2;i++){
    const u=(await pool.query("INSERT INTO sh_utilisateurs(email,nom,role,mot_de_passe_hash,mdp_temporaire,totp_actif) VALUES($1,$2,'support','sans-connexion',false,true) RETURNING id",[`sla.${i}@example.invalid`,`Support SLA ${i}`])).rows[0];
    const token=crypto.randomBytes(32).toString('hex');await pool.query("INSERT INTO sh_sessions(token,token_hache,utilisateur_id,expire_le) VALUES($1,true,$2,now()+interval '1 hour')",[empreinte(token),u.id]);
    await pool.query("INSERT INTO sh_affectations(utilisateur_id,type,hopital_id) VALUES($1,'hopital',$2)",[u.id,hs[i].id]);comptes.push({...u,token});
  }
  const contrats=[];
  for(let i=0;i<2;i++){
    const o=(await pool.query("INSERT INTO sh_crm_organisations(nom,pays_code,hopital_id) VALUES($1,'CA',$2) RETURNING id",['Client SLA '+i,hs[i].id])).rows[0];await pool.query('UPDATE hopitaux SET organisation_id=$2 WHERE id=$1',[hs[i].id,o.id]);
    const opp=(await pool.query("INSERT INTO sh_opportunites(organisation_id,titre) VALUES($1,'Fixture SLA') RETURNING id",[o.id])).rows[0];
    contrats.push((await pool.query("INSERT INTO sh_contrats(opportunite_id,hopital_id,reference,statut,date_debut,date_fin,signe_le) VALUES($1,$2,$3,'signe',current_date-1,current_date+30,now()) RETURNING id",[opp.id,hs[i].id,'SLA-TEST-'+i])).rows[0].id);
  }
  const regler=(prise=5,resolution=30)=>Object.fromEntries(['basse','normale','haute','urgente'].map((p,i)=>[p,{prise_en_charge_minutes:prise+i,resolution_minutes:resolution+i,escalade_apres_minutes:1}]));
  let politique,ticket,second;
  const body=(versions,regles=regler())=>({version_attendue:versions,contrat_id:contrats[0],nom:'Engagement Test',regles,destinataire_id:comptes[0].id});
  await t.test('contrat de l’autre établissement, règle invalide, rôle non autorisé et destinataire voisin refusés',async()=>{
    await appel(baseSH,jetonSH,'POST',`/hopitaux/${hs[0].id}/support-sla`,{...body(null),contrat_id:contrats[1]},409);
    await appel(baseSH,comptes[0].token,'POST',`/hopitaux/${hs[0].id}/support-sla`,body(null),403);
    await appel(baseSH,jetonSH,'POST',`/hopitaux/${hs[0].id}/support-sla`,{...body(null),destinataire_id:comptes[1].id},400);
    await appel(baseSH,jetonSH,'POST',`/hopitaux/${hs[0].id}/support-sla`,body(null,regler(100,20)),400);
    await pool.query("UPDATE sh_contrats SET statut='negociation' WHERE id=$1",[contrats[0]]);
    await appel(baseSH,jetonSH,'POST',`/hopitaux/${hs[0].id}/support-sla`,body(null),409);await pool.query("UPDATE sh_contrats SET statut='signe' WHERE id=$1",[contrats[0]]);
    politique=await appel(baseSH,jetonSH,'POST',`/hopitaux/${hs[0].id}/support-sla`,body(null));
    await appel(baseSH,jetonSH,'POST',`/hopitaux/${hs[0].id}/support-sla`,body(null),409);
    await appel(baseSH,comptes[1].token,'GET',`/hopitaux/${hs[0].id}/support-sla`,null,404);
  });
  await t.test('tickets interne et client : même SLA figé et aucune donnée financière exposée',async()=>{
    ticket=await appel(baseSH,jetonSH,'POST','/support/tickets',{hopital_id:hs[0].id,titre:'SLA interne',priorite:'normale'});
    assert.equal(ticket.sla_snapshot.nature,'contractuel');assert.equal(ticket.sla_id,politique.id);
    assert.equal(+new Date(ticket.prise_en_charge_echeance)-+new Date(ticket.cree_le),6*60000);assert.equal(+new Date(ticket.resolution_echeance)-+new Date(ticket.cree_le),31*60000);
    const client=await appel(base,tokens[0],'POST','/support/tickets',{etablissement_id:es[0].id,titre:'Client SLA',description:'Fixture SLA'});assert.equal(client.sla_nature,'contractuel');assert.ok(client.resolution_echeance);assert.equal(client.sla_snapshot,undefined);assert.equal(client.contrat_id,undefined);
    const standard=await appel(baseSH,jetonSH,'POST','/support/tickets',{hopital_id:hs[1].id,titre:'Délai technique'});assert.equal(standard.sla_snapshot.nature,'standard');assert.equal(standard.resolution_echeance,null);
  });
  await t.test('nouvelle version et priorité : anciens engagements conservés, écritures directes contrôlées',async()=>{
    second=await appel(baseSH,jetonSH,'POST',`/hopitaux/${hs[0].id}/support-sla`,body(politique.id,regler(15,60)));
    let ancien=await appel(baseSH,jetonSH,'GET',`/support/tickets/${ticket.id}`);assert.deepEqual(ancien.sla_snapshot,ticket.sla_snapshot);assert.equal(ancien.resolution_echeance,ticket.resolution_echeance);
    const neuf=await appel(baseSH,jetonSH,'POST','/support/tickets',{hopital_id:hs[0].id,titre:'Nouvelle version',priorite:'normale'});assert.equal(neuf.sla_id,second.id);
    ancien=await appel(baseSH,jetonSH,'PUT',`/support/tickets/${ticket.id}`,{priorite:'haute'});assert.equal(+new Date(ancien.prise_en_charge_echeance)-+new Date(ancien.cree_le),7*60000);assert.equal(ancien.sla_id,politique.id);
    await assert.rejects(pool.query('UPDATE sh_support_sla SET nom=$2 WHERE id=$1',[politique.id,'Altération']),{code:'23514'});
    await pool.query("UPDATE sh_support_tickets SET sla_snapshot='{}' WHERE id=$1",[ticket.id]);assert.deepEqual((await pool.query('SELECT sla_snapshot FROM sh_support_tickets WHERE id=$1',[ticket.id])).rows[0].sla_snapshot,ticket.sla_snapshot);
  });
  const executer=require('../src/sh/support-sla').executerEscalades;
  await t.test('escalades réelles PostgreSQL avec horloge contrôlée : concurrence, unicité et isolation des notifications',async()=>{
    const date=new Date(Date.now()+20*60000);await Promise.all([executer(pool,{maintenant:date}),executer(pool,{maintenant:date})]);
    let rows=(await pool.query('SELECT phase,count(*)::int n FROM sh_support_escalades WHERE ticket_id=$1 GROUP BY phase',[ticket.id])).rows;assert.deepEqual(rows,[{phase:'prise_en_charge',n:1}]);
    assert.equal((await appel(baseSH,comptes[1].token,'GET','/notifications')).notifications.filter(n=>n.cle?.startsWith('sla-')).length,0);
    const n=(await pool.query('SELECT count(*)::int n FROM sh_support_escalades')).rows[0].n;await executer(pool,{maintenant:date});assert.equal((await pool.query('SELECT count(*)::int n FROM sh_support_escalades')).rows[0].n,n);
    await executer(pool,{maintenant:new Date(Date.now()+90*60000)});assert.equal((await pool.query("SELECT count(*)::int n FROM sh_support_escalades WHERE ticket_id=$1 AND phase='resolution'",[ticket.id])).rows[0].n,1);
    assert.equal((await pool.query('SELECT count(*)::int n FROM sh_support_escalades WHERE ticket_id=$1',[historique.id])).rows[0].n,0);
  });
  await t.test('prise en charge, résolution et réouverture : nouvelle génération sans effacer l’historique',async()=>{
    let r=await appel(baseSH,comptes[0].token,'POST',`/support/tickets/${ticket.id}/prise-en-charge`,{});assert.ok(r.prise_en_charge_le);
    const prise=r.prise_en_charge_le;await appel(baseSH,comptes[0].token,'POST',`/support/tickets/${ticket.id}/prise-en-charge`,{});r=await appel(baseSH,jetonSH,'GET',`/support/tickets/${ticket.id}`);assert.equal(r.prise_en_charge_le,prise);
    await appel(baseSH,jetonSH,'PUT',`/support/tickets/${ticket.id}`,{statut:'resolu',resolution:'Résolution Test'});await appel(baseSH,jetonSH,'PUT',`/support/tickets/${ticket.id}`,{statut:'ferme'});
    const n=(await pool.query('SELECT count(*)::int n FROM sh_support_escalades WHERE ticket_id=$1',[ticket.id])).rows[0].n;
    r=await appel(baseSH,jetonSH,'PUT',`/support/tickets/${ticket.id}`,{statut:'ouvert'});assert.equal(r.prise_en_charge_le,null);assert.equal(r.sla_id,politique.id);assert.ok(r.sla_generation>ticket.sla_generation);
    await executer(pool,{maintenant:new Date(Date.now()+10*60000)});assert.equal((await pool.query('SELECT count(*)::int n FROM sh_support_escalades WHERE ticket_id=$1',[ticket.id])).rows[0].n,n+1);
  });
  await t.test('révocation du destinataire et lot de plus de cent tickets : repli administratif et absence de famine',async()=>{
    await pool.query('DELETE FROM sh_affectations WHERE utilisateur_id=$1',[comptes[0].id]);
    await pool.query("INSERT INTO sh_support_tickets(hopital_id,titre,priorite) SELECT $1,'Lot SLA '||n,'urgente' FROM generate_series(1,105) n",[hs[0].id]);
    for(let i=0;i<3;i++)await executer(pool,{maintenant:new Date(Date.now()+20*60000)});
    const r=(await pool.query("SELECT count(*)::int n FROM sh_support_escalades e JOIN sh_support_tickets t ON t.id=e.ticket_id WHERE t.titre LIKE 'Lot SLA %' AND phase='prise_en_charge' AND destinataires=ARRAY[$1::int]",[us.id])).rows[0];assert.equal(r.n,105);
    const restreint=require('../src/sh/perimetre-pool').creerPoolPerimetre(pool);await restreint.executer({id:comptes[1].id,role:'support',methode:'GET'},async()=>assert.equal((await restreint.query('SELECT * FROM sh_support_escalades')).rowCount,0));
  });
  await t.test('interface SH : formulaire SLA, versionnement et traduction anglaise',async()=>{
    const browser=await require('playwright').chromium.launch({headless:true});try{
      const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(token=>sessionStorage.setItem('sh-token',token),jetonSH);
      await page.goto(baseSH);await page.waitForSelector('#ecran-app:not([hidden])');
      if(!await page.locator('[data-v="support"]').isVisible())await page.click('#b-menu');await page.click('[data-v="support"]');await page.click('[data-action="sla-configurer"]');await page.selectOption('#sla-hopital',String(hs[0].id));await page.getByRole('button',{name:'Continuer',exact:true}).click();await page.waitForSelector('#sla-nom');
      assert.ok(await page.locator('#sla-cal-mode').isVisible(),'le calendrier SLA est configurable dans le formulaire');
      await page.selectOption('#sla-cal-mode','ouvrable');await page.fill('#sla-cal-jours','1,2,3,4,5');await page.fill('#sla-cal-debut','09:00');await page.fill('#sla-cal-fin','17:00');await page.fill('#sla-cal-feries','2026-12-25');
      await page.fill('#sla-nom','Version navigateur');await page.selectOption('#sla-destinataire','');await page.getByRole('button',{name:'Enregistrer la version',exact:true}).click();await page.waitForSelector('#sla-nom',{state:'hidden'});
      assert.equal((await appel(baseSH,jetonSH,'GET',`/hopitaux/${hs[0].id}/support-sla`)).active.calendrier.mode,'ouvrable');
      await page.selectOption('#sh-langue','en');await page.waitForFunction(()=>document.querySelector('[data-action="sla-configurer"]')?.textContent==='Contractual SLAs');
      assert.deepEqual(errors,[]);fs.mkdirSync(require('node:path').resolve('.local/sla-support'),{recursive:true});await page.screenshot({path:require('node:path').resolve('.local/sla-support/sla-sh-en.png'),fullPage:true});
    }finally{await browser.close();}
  });
});
