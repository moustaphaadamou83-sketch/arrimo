'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
async function main(){
  const url='https://demo.arrimo.senseafri.com';
  const comptes=JSON.parse(fs.readFileSync('/root/.local/arrimo-publication-acces.json','utf8')).demo;
  const dossier=path.resolve('.local/preuves-sh-lot1','navigateur-public-'+Date.now());fs.mkdirSync(dossier,{recursive:true,mode:0o700});
  const browser=await chromium.launch({headless:true});const resultats=[],sessions=[];
  try{for(const nom of ['a','b','c']){
    const compte=comptes.find(x=>x.nom===nom);const context=await browser.newContext({locale:'en-CA',viewport:{width:1440,height:1000}});
    const bloquees=[];
    // Préserver les données : seuls l'authentification et les questions OG sont autorisées en POST.
    await context.route('**/api/**',route=>{
      const r=route.request(),p=new URL(r.url()).pathname;
      if(!['GET','HEAD'].includes(r.method())&&!['/api/connexion','/api/connexion/2fa','/api/deconnexion','/api/copilote/question'].includes(p)){
        bloquees.push(p);return route.abort();
      }
      return route.continue();
    });
    const page=await context.newPage();const erreurs=[];page.on('pageerror',e=>erreurs.push(e.message));
    await page.goto(url);await page.selectOption('#langue-connexion','en');
    await page.fill('#c-email',compte.email);await page.fill('#c-mdp',compte.password);await page.click('#f-connexion button[type=submit]');
    await page.waitForSelector('#ecran-app:not([hidden])');await page.waitForSelector('body[data-pret="1"]');sessions.push(await page.evaluate(()=>localStorage.getItem('arrimo-token')));
    if(await page.locator('#b-premiers-pas-ok').isVisible())await page.locator('#b-premiers-pas-ok').click();
    assert.equal(await page.locator('html').getAttribute('lang'),'en-CA');
    const visibles=await page.locator('#onglets button').evaluateAll(bs=>bs.filter(b=>!b.hidden).map(b=>b.dataset.v));
    const vues=[];
    for(const v of visibles){
      await page.locator(`#onglets [data-v="${v}"]`).click();
      await page.waitForFunction(v=>{const el=document.querySelector('#v-'+v);return el&&!el.hidden&&el.children.length>0;},v);
      const label=await page.locator(`#onglets [data-v="${v}"] [data-i18n]`).textContent();
      const cle=await page.locator(`#onglets [data-v="${v}"] [data-i18n]`).getAttribute('data-i18n');
      const attendu=await page.evaluate(cle=>cle.split('.').reduce((val,k)=>val?.[k],window.ARRIMO_I18N.en),cle);assert.equal(typeof attendu,'string',`Traduction manquante : ${cle}`);assert.equal(label,attendu);vues.push(v);
    }
    for(const langue of ['en','fr']){
      await page.locator('#b-menu').click();await page.selectOption('#langue-barre',langue);
      await page.locator('#b-menu').click();
      await page.locator('#og-open').click();await page.fill('#og-question','OG, where is patient P-43267 currently located? Which hospital, department, room and bed is the patient assigned to?');
      const attente=page.waitForResponse(r=>r.url().endsWith('/api/copilote/question')&&r.request().method()==='POST');
      await page.locator('#og-envoyer').click();const reponse=await (await attente).json();
      if(nom==='b'){assert.doesNotMatch(reponse.reponse,/SI-108|TR-00067|Val-des-Pins/);assert.match(reponse.reponse,langue==='en'?/No accessible active record/:/Aucune situation active/);}
      else{assert.match(reponse.reponse,/SI-108/);assert.match(reponse.reponse,langue==='en'?/Room 108/:/chambre 108/);}
      await page.waitForFunction(()=>document.querySelectorAll('#og-messages .og-source').length>0);
      await page.screenshot({path:path.join(dossier,`og-${nom}-${langue}.png`)});await page.locator('#og-close').click();
    }
    assert.deepEqual(erreurs,[]);
    await page.locator('#b-menu').click();await page.locator('#b-deconnexion').click();await context.close();
    resultats.push({compte:nom,vues_anglaises:vues,og_fr_en:true,permissions_verifiees:true,ecritures_metier_bloquees:bloquees});
  }}finally{for(const token of sessions)if(token)await fetch(url+'/api/deconnexion',{method:'POST',headers:{Authorization:'Bearer '+token}}).catch(()=>{});await browser.close();}
  const rapport={date:new Date().toISOString(),url,resultats,valide:true};fs.writeFileSync(path.join(dossier,'rapport.json'),JSON.stringify(rapport,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({dossier,...rapport},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
