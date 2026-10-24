/** Parcours navigateur isolé de configuration structurelle et visibilité A/B/C. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const {creerPool}=require('../src/db');
const {creerApp}=require('../src/app');
const {viderBase}=require('../db/vider');
const {preparerDemoTrio,urlDemoLocale}=require('../db/demo-trio');
const totp=require('../src/totp');

const URL=process.env.STRUCTURE_DATABASE_URL;
const MDP=process.env.DEMO_MOT_DE_PASSE||'Demo-Arrimo-2026';
let pool,server,browser,base;
const captures=path.join(__dirname,'..','docs','captures-structure');

test('formulaires de structure et dashboards A/B/C isolés', {timeout:180000}, async()=>{
  assert.ok(URL,'STRUCTURE_DATABASE_URL requis; le test refuse toute base partagée ou non dédiée');
  assert.ok(urlDemoLocale(URL),'le test exige une base locale arrimo_demo_trio* et refuse tout serveur distant');
  fs.mkdirSync(captures,{recursive:true});
  process.env.ARRIMO_DEMO='1';process.env.ARRIMO_2FA_ADMIN='1';
  pool=creerPool(URL); await viderBase(pool);
  await pool.query(fs.readFileSync(path.join(__dirname,'..','db','schema.sql'),'utf8'));
  await preparerDemoTrio(pool,{silencieux:true,fichierAcces:path.join('/tmp','arrimo-test-acces.txt')});
  const {hacher}=require('../src/auth');const secrets={A:totp.nouveauSecret(),B:totp.nouveauSecret(),C:totp.nouveauSecret()},motsDePasse={};
  for(const [letter,code] of Object.entries({A:'HX',B:'HY',C:'HC'})){
    const etab=(await pool.query('SELECT id FROM etablissements WHERE code=$1',[code])).rows[0];
    motsDePasse[letter]=crypto.randomBytes(24).toString('base64url');
    const u=(await pool.query(`INSERT INTO utilisateurs(email,nom,mot_de_passe_hash,role,totp_secret,totp_actif)
      VALUES($1,$2,$3,'admin_etab',$4,true) RETURNING id`,[`admin.${letter.toLowerCase()}@demo.arrimo`,`Administrateur fictif ${letter}`,hacher(motsDePasse[letter]),secrets[letter]])).rows[0];
    await pool.query('INSERT INTO utilisateur_etablissements(utilisateur_id,etablissement_id) VALUES($1,$2)',[u.id,etab.id]);
  }
  server=creerApp(pool).listen(0);base=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch();
  const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});const page=await ctx.newPage();
  page.setDefaultTimeout(6000);
  const errs=[];page.on('pageerror',e=>errs.push(String(e)));page.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  const ouvrirEditeurStructure=async()=>page.locator('#admin-corps > details.panneau-c:not(.nouvel-etab)').evaluate(x=>{x.open=true});
  await page.goto(base);await page.fill('#c-email','admin.a@demo.arrimo');await page.fill('#c-mdp',motsDePasse.A);await page.click('#f-connexion button[type=submit]');await page.waitForSelector('#f-2fa:not([hidden])');
  await page.fill('#c-code',totp.codePourPas(secrets.A,totp.pasActuel()));await page.click('#f-2fa button[type=submit]');await page.waitForSelector('body[data-pret="1"]');
  const premiersPas=page.locator('#b-premiers-pas-ok');if(await premiersPas.isVisible().catch(()=>false))await premiersPas.click();
  const token=await page.evaluate(()=>localStorage.getItem('arrimo-token'));
  const horsScope=await fetch(`${base}/api/admin/structure/detaillee?etablissement_id=${(await pool.query("SELECT id FROM etablissements WHERE code='HY'")).rows[0].id}`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(horsScope.status,403,'administrateur A isolé des ressources B');
  await page.locator('#onglets button[data-v="admin"]').click();await page.waitForTimeout(700);
  await page.waitForFunction(()=>document.querySelector('#v-admin').hidden===false,{timeout:10000}).catch(async()=>{throw new Error(`admin non visible; utilisateur=${await page.locator('#nom-utilisateur').innerText().catch(()=>'?')}; tabs=${await page.locator('#onglets').innerText().catch(()=>'?')}; statut=${await page.locator('#onglets button[data-v="admin"]').getAttribute('hidden')}`)});
  await page.waitForSelector('[data-ao="structure"]',{timeout:6000});
  await page.click('[data-ao="structure"]');await page.locator('#admin-corps > details.panneau-c:not(.nouvel-etab)').evaluate(x=>{x.open=true});await page.waitForSelector('#b-dept');
  await page.fill('#s-dept-code','DEMO-UNIT');await page.fill('#s-dept-nom','Département Démonstration');await page.click('#b-dept');await page.waitForTimeout(250);await ouvrirEditeurStructure();
  await page.fill('#s-serv-code','DEMO-SVC');await page.fill('#s-serv-nom','Service Démonstration');await page.selectOption('#s-serv-dept',{label:'Département Démonstration'});await page.click('#b-service');await page.waitForTimeout(250);await ouvrirEditeurStructure();
  await page.fill('#s-nom','Unité Démonstration');await page.selectOption('#s-unite-dept',{label:'Département Démonstration'});await page.selectOption('#s-unite-service',{label:'Service Démonstration'});await page.click('#b-unite');await page.waitForTimeout(250);await ouvrirEditeurStructure();
  await page.selectOption('#s-floor-unit',{label:'Unité Démonstration'});await page.fill('#s-floor-code','D1');await page.fill('#s-floor-nom','Étage Démonstration');await page.fill('#s-floor-aile','Nord');await page.click('#b-floor');await page.waitForTimeout(250);await ouvrirEditeurStructure();
  const floorCheck=await pool.query(`select id,unite_id from etages where nom='Étage Démonstration'`);assert.equal(floorCheck.rowCount,1,`étage créé depuis le formulaire; toast=${await page.locator('.toast').allTextContents()}`);
  const uniteId=Number((await pool.query(`select id from unites where nom='Unité Démonstration'`)).rows[0].id);
  assert.equal(floorCheck.rows[0].unite_id,uniteId,`rattachement étage ${JSON.stringify(floorCheck.rows[0])} / unité ${uniteId}`);
  const rang=page.locator(`[data-chnum="${uniteId}"]`);await rang.fill('D-101');assert.ok(await page.locator(`[data-chfloor="${uniteId}"] option`).filter({hasText:'Étage Démonstration'}).count(),`étage absent des options: ${await page.locator(`[data-chfloor="${uniteId}"]`).innerText()}`);await page.locator(`[data-chfloor="${uniteId}"]`).selectOption(String(floorCheck.rows[0].id));await page.locator(`[data-chtype="${uniteId}"]`).fill('double');await page.locator(`[data-chcapacity="${uniteId}"]`).fill('2');await page.locator(`[data-chattributes="${uniteId}"]`).fill('{"oxygene":true}');await page.locator(`[data-chrestrictions="${uniteId}"]`).fill('{"isolement_possible":true}');await page.locator(`[data-ch="${uniteId}"]`).click();await page.waitForTimeout(250);
  const ch=await pool.query(`select id from chambres where numero='D-101'`);assert.equal(ch.rowCount,1);
  for(const code of ['DEMO-101A','DEMO-101B']){await page.locator(`[data-litcode="${ch.rows[0].id}"]`).fill(code);await page.locator(`[data-litcat="${ch.rows[0].id}"]`).fill(code.endsWith('A')?'standard':'renforce');await page.locator(`[data-litattrs="${ch.rows[0].id}"]`).fill('{"reglable":true}');await page.locator(`[data-lit-ch="${ch.rows[0].id}"]`).click();await page.waitForTimeout(220);}
  await page.locator('#v-admin .item').filter({hasText:'Chambre D-101'}).locator('[data-modifier="chambre"]').click();await page.waitForSelector('#modale:not([hidden]) #ms-type_chambre');await page.fill('#ms-type_chambre','double modifiée');await page.click('#modale .actions button.pri');await page.waitForTimeout(300);
  const litA=await pool.query(`select id from lits where code='DEMO-101A'`);assert.equal(litA.rowCount,1);
  const tokenAdmin=await page.evaluate(()=>localStorage.getItem('arrimo-token'));
  const hors=await fetch(`${base}/api/lits/${litA.rows[0].id}/action`,{method:'POST',headers:{Authorization:`Bearer ${tokenAdmin}`,'Content-Type':'application/json'},body:JSON.stringify({action:'hors_service',motif:'autre'})});assert.equal(hors.status,200,'le lit fictif est déclaré hors service avant sa désactivation administrative');
  await page.locator('#v-admin .ligne').filter({hasText:'DEMO-101A'}).locator('[data-modifier="lit"]').click();await page.waitForSelector('#modale:not([hidden]) #ms-actif');await page.locator('#ms-actif').uncheck();await page.click('#modale .actions button.pri');await page.waitForTimeout(300);
  const verify=await pool.query(`select ch.type_chambre,ch.capacite_declaree,ch.attributs,u.etablissement_id,
    (select count(*)::int from lits l where l.chambre_id=ch.id and l.actif) n from chambres ch join unites u on u.id=ch.unite_id where ch.id=$1`,[ch.rows[0].id]);
  assert.deepEqual([verify.rows[0].type_chambre,verify.rows[0].capacite_declaree,verify.rows[0].n],['double modifiée',2,1]);
  assert.equal((await pool.query(`select actif from lits where id=$1`,[litA.rows[0].id])).rows[0].actif,false,'un lit indisponible peut être désactivé depuis l’interface');
  await page.locator('#admin-corps > details.panneau-c:not(.nouvel-etab)').evaluate(x=>{x.open=true});
  await page.locator('#v-admin .panneau-c h3').filter({hasText:'Unité Démonstration'}).evaluate(h=>h.closest('.panneau-c').scrollIntoView());
  await page.evaluate(()=>document.querySelectorAll('.toast').forEach(x=>x.remove()));
  await page.screenshot({path:path.join(captures,'arrimo-structure-admin.png')});

  // Chaque compte A/B/C ouvre son propre établissement et ne voit pas la ressource de l'autre.
  for(const [letter,email,code] of [['A','hopital.a@demo.arrimo','HX'],['B','hopital.b@demo.arrimo','HY'],['C','hopital.c@demo.arrimo','HC']]){
    const c=await browser.newContext({viewport:{width:1365,height:900}});const p=await c.newPage();await p.goto(base);await p.fill('#c-email',email);await p.fill('#c-mdp',MDP);await p.click('#f-connexion button[type=submit]');await p.waitForSelector('body[data-pret="1"]');const premier=p.locator('#b-premiers-pas-ok');if(await premier.isVisible().catch(()=>false))await premier.click();
    await p.click('#onglets button[data-v="lits"]');await p.waitForFunction(()=>document.querySelector('#v-lits').hidden===false);await p.waitForSelector('#v-lits .structure-resume',{state:'attached'});
    await p.locator('#v-lits > details.panneau-c').evaluate(x=>{x.open=true});
    const cible=code==='HX'?p.locator('#v-lits .structure-resume').filter({hasText:'Unité Démonstration'}):p.locator('#v-lits .structure-resume').first();
    await cible.evaluate(x=>{x.open=true;x.scrollIntoView()});
    const structure=await p.locator('#v-lits').innerText();
    if(code==='HX')assert.match(structure,/Unité Démonstration/);else assert.doesNotMatch(structure,/Unité Démonstration/);
    assert.match(structure,new RegExp(code==='HX'?'Médecine|Unité Démonstration':code==='HY'?'Médecine':'Médecine'));
    assert.equal(await p.locator('#v-lits [data-structure-admin]').count(),0,'les coordonnateurs ne voient pas la commande de modification');
    if(letter==='A')await p.screenshot({path:path.join(captures,'dashboard-hopital-a.png')});
    if(letter==='B')await p.screenshot({path:path.join(captures,'dashboard-hopital-b.png')});
    if(letter==='C')await p.screenshot({path:path.join(captures,'dashboard-hopital-c.png')});
    await c.close();
  }
  assert.deepEqual(errs,[],'aucune erreur JS sur l’interface admin');await ctx.close();
});

test.after(async()=>{await browser?.close();server?.close();await pool?.end();});
