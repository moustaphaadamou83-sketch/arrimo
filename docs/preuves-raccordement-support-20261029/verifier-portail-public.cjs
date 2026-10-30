'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
async function main(){
 const base='https://demo.arrimo.senseafri.com',dir=path.resolve('.local/raccordement-support-20261029/preuves-publiques');fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const comptes=JSON.parse(fs.readFileSync('/root/.local/arrimo-publication-acces.json','utf8')).demo;
 const browser=await require('playwright').chromium.launch({headless:true}),sessions=[],resultats=[];
 async function api(token,suffix,status=200){const r=await fetch(base+'/api'+suffix,{headers:{Authorization:'Bearer '+token}});const j=await r.json();assert.equal(r.status,status,suffix+' : '+JSON.stringify(j));return j;}
 try{
  for(const nom of ['a','b','c']){
   const c=comptes.find(c=>c.nom===nom);assert.ok(c);const ctx=await browser.newContext({viewport:{width:390,height:844}});const page=await ctx.newPage(),erreurs=[],bloquees=[];
   page.on('pageerror',e=>erreurs.push(e.message));
   await ctx.route('**/api/**',r=>{const q=r.request(),p=new URL(q.url()).pathname;if(!['GET','HEAD'].includes(q.method())&&!['/api/connexion','/api/connexion/2fa','/api/deconnexion'].includes(p)){bloquees.push(p);return r.abort();}return r.continue();});
   await page.goto(base);await page.selectOption('#langue-connexion','fr');await page.fill('#c-email',c.email);await page.fill('#c-mdp',c.password);await page.click('#f-connexion button[type=submit]');await page.waitForSelector('body[data-pret="1"]');
   const token=await page.evaluate(()=>localStorage.getItem('arrimo-token'));assert.ok(token);sessions.push(token);
   const moi=await api(token,'/moi');assert.equal(moi.etablissements.length,1);const etab=moi.etablissements[0];assert.equal(etab.code,{a:'HX',b:'HY',c:'HC'}[nom]);
   assert.deepEqual(await api(token,'/support/configuration?etablissement_id='+etab.id),{disponible:true});
   await page.click('[data-v="support"]');await page.waitForSelector('#support-creer',{state:'attached'});
   assert.equal(await page.locator('#v-support').getByText('Le portail de support n’est pas configuré pour cet environnement.',{exact:true}).count(),0);
   const details=page.locator('#v-support details');if(!await details.evaluate(d=>d.open))await page.click('#v-support summary');
   assert.equal(await page.locator('#sc-titre').isVisible(),true);await page.screenshot({path:path.join(dir,'portail-'+nom+'-fr.png'),fullPage:true});
   await page.click('#b-menu');await page.selectOption('#langue-barre','en');await page.click('#b-menu');await page.waitForFunction(()=>document.querySelector('#v-support').textContent.includes('Client support'));
   assert.equal(await page.locator('#support-creer').count(),1);await page.screenshot({path:path.join(dir,'portail-'+nom+'-en.png'),fullPage:true});
   const tickets=await api(token,'/support/tickets?etablissement_id='+etab.id);assert.ok(Array.isArray(tickets.tickets));assert.deepEqual(erreurs,[]);assert.deepEqual(bloquees,[]);
   resultats.push({compte:nom,etablissement_id:etab.id,connexion_normale:true,portail_fr_en:true,formulaire_visible:true,lecture_tickets:true,erreurs_javascript:0,aucune_ecriture_metier:true});await ctx.close();
  }
  for(let i=0;i<resultats.length;i++)await api(sessions[i],'/support/tickets?etablissement_id='+resultats[(i+1)%resultats.length].etablissement_id,403);
 }finally{
  for(const token of sessions){const r=await fetch(base+'/api/deconnexion',{method:'POST',headers:{Authorization:'Bearer '+token}});assert.equal(r.status,200);}
  await browser.close();
 }
 const rapport={valide:true,resultats,isolation_verifiee:true,tickets_publics_crees:0};fs.writeFileSync(path.join(dir,'rapport.json'),JSON.stringify(rapport,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({valide:true,comptes:resultats.length,rapport:path.join(dir,'rapport.json')}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
