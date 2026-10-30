'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {creerPool}=require('../src/db');
const {demarrerServeur}=require('./serveur-test.cjs');
test('Suivi OG interhospitalier : quatorze validations PostgreSQL et API', {timeout:240000},async t=>{
  const url=new URL(process.env.OG_SUIVI_TEST_DATABASE_URL);
  assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/arrimo_og_suivi_test_[a-f0-9]+$/);
  const db=creerPool(url.href);t.after(()=>db.end());
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0);
  process.env.ARRIMO_ENV='demo';process.env.ARRIMO_DEMO='1';process.env.DEMO_MOT_DE_PASSE='Fixture-Suivi-OG-2026';
  delete process.env.COPILOTE_IA_CLE;
  const restaurer=require('./routeur-fictif.cjs').activer();t.after(restaurer);
  await require('../db/demo-trio').preparerDemoTrio(db,{silencieux:true});
  const serveur=await demarrerServeur(require('../src/app').creerApp(db));t.after(()=>new Promise(r=>serveur.close(r)));
  const base='http://127.0.0.1:'+serveur.address().port,tokens={},ids={};
  const api=async(nom,methode,chemin,corps,statut=200)=>{
    const r=await fetch(base+'/api'+chemin,{method:methode,headers:{'Content-Type':'application/json',...(tokens[nom]?{Authorization:'Bearer '+tokens[nom]}:{})},body:corps?JSON.stringify(corps):undefined});
    const j=await r.json();assert.equal(r.status,statut,JSON.stringify(j));return j;
  };
  for(const [n,c] of [['a','HX'],['b','HY'],['c','HC'],['reseau','HX']]){
    const j=await api(null,'POST','/connexion',{email:n==='reseau'?'reseau@demo.arrimo':`hopital.${n}@demo.arrimo`,mot_de_passe:process.env.DEMO_MOT_DE_PASSE});
    tokens[n]=j.token;assert.ok(j.token);ids[n]=(await db.query('SELECT id FROM etablissements WHERE code=$1',[c])).rows[0].id;
  }
  const q=(nom,question)=>api(nom,'POST','/copilote/question',{etablissement_id:ids[nom],question});
  // Préparation réservée à cette base neuve. Les étapes métier suivantes utilisent les API.
  const cv=(await db.query("SELECT id,version FROM civieres WHERE etablissement_id=$1 AND code='URG-02'",[ids.c])).rows[0];assert.ok(cv);
  await db.query("UPDATE civieres SET etat='libre',patient_ref=NULL,arrivee_le=NULL WHERE id=$1",[cv.id]);
  const l=(await db.query("SELECT id,version,type_id FROM lits WHERE etablissement_id=$1 AND code='SI-108'",[ids.a])).rows[0];assert.ok(l);
  await db.query("UPDATE lits SET etat='libre',patient_ref=NULL,transfert_id=NULL,disponibilite_confirmee_le=now(),groupe_age='tous',isolement=false,pression_negative=false,ventilation=false,telemetrie=false WHERE id=$1",[l.id]);
  await api('c','POST',`/civieres/${cv.id}/action`,{action:'placer',version:cv.version,patient_ref:'P-43267'});
  const demande=await api('c','POST','/admissions',{etablissement_id:ids.c,civiere_id:cv.id,type_id:l.type_id,patient_ref:'P-43267'});
  const transfert=await api('c','POST',`/admissions/${demande.id}/transferer`,{destination_id:ids.a,lit_id:l.id,version:l.version});
  assert.ok(transfert.id);
  const numer=transfert.numero;
  await t.test('réservation : pas de patient annoncé admis ou arrivé',async()=>{
    const r=await q('c',`Suivi du transfert ${numer}`);assert.match(r.reponse,/Lit réservé à destination : SI-108/);assert.match(r.reponse,/ne signifie pas.*admis/);assert.match(r.reponse,/occupe encore la civière URG-02/);
  });
  await api('a','POST',`/transferts/${transfert.id}/accepter`,{});
  await api('c','POST',`/transferts/${transfert.id}/transport`,{});
  await api('c','POST',`/transferts/${transfert.id}/depart`,{});
  await t.test('départ confirmé : transport sans réception inventée',async()=>{
    const r=await q('c','Où est P-43267 ?');assert.match(r.reponse,/en transport/);assert.match(r.reponse,/réception non confirmée/);assert.match(r.reponse,/n’occupe plus la civière URG-02/);
  });
  await api('a','POST',`/transferts/${transfert.id}/reception`,{});
  await t.test('1 — A retrouve le patient, son admission et l’heure d’occupation après transfert',async()=>{const r=await q('a','P-43267');assert.match(r.reponse,/admis ; établissement Hôpital A/);assert.match(r.reponse,/SI-108/);assert.match(r.reponse,/Lit occupé depuis : /);});
  await t.test('2 — C conserve le suivi de son patient transféré',async()=>{const r=await q('c','Où se trouve actuellement le patient P-43267 ?');assert.match(r.reponse,/Hôpital C.*→ Hôpital A/);assert.match(r.reponse,/admis ; établissement Hôpital A/);assert.match(r.reponse,/n’occupe plus la civière URG-02/);});
  await t.test('3 — lit SI-108 occupé, service et chambre exacts',async()=>{const r=await q('a','Quel lit occupe P-43267 ?');assert.match(r.reponse,/service Soins intensifs ; chambre 108 ; lit SI-108/);assert.match(r.reponse,/Statut du lit : occupé/);});
  await t.test('4 — C suit directement le numéro du transfert',async()=>{const r=await q('c',`Suivi du transfert ${numer}`);assert.match(r.reponse,/Statut du transfert : Reçu/);assert.match(r.reponse,/Acceptation|Départ confirmé|Réception/);});
  await t.test('5 — B ne voit aucun dossier ni détail du transfert',async()=>{for(const question of ['P-43267',`Suivi du transfert ${numer}`]){const r=await q('b',question);assert.doesNotMatch(r.reponse,/SI-108|URG-02|Sainte-Aurore|Val-des-Pins|Statut du transfert/);}await api('b','POST','/copilote/question',{etablissement_id:ids.a,question:'P-43267'},403);});
  await t.test('6 — coordination régionale : suivi autorisé',async()=>{const r=await q('reseau',`Suivi du transfert ${numer}`);assert.match(r.reponse,/SI-108/);assert.match(r.reponse,/Reçu/);});
  await t.test('bilingue : questions FR/EN, réponses choisies FR/EN et mêmes permissions A/B/C',async()=>{
    const questions=['OG, where is patient P-43267 currently located? Which hospital, department, room and bed is the patient assigned to?','Où se trouve le patient P-43267 ?'];
    for(const n of ['a','b','c'])for(const langue of ['fr','en'])for(const question of questions){
      const r=await api(n,'POST','/copilote/question',{etablissement_id:ids[n],question,langue});
      if(n==='b'){assert.doesNotMatch(r.reponse,/SI-108|URG-02|Val-des-Pins|Sainte-Aurore/);assert.match(r.reponse,langue==='en'?/No accessible active record/:/Aucune situation active/);}
      else{assert.match(r.reponse,/SI-108/);assert.match(r.reponse,langue==='en'?/Room 108/:/chambre 108/);assert.match(r.reponse,langue==='en'?/Intensive care/i:/Soins intensifs/);assert.match(r.reponse,langue==='en'?/Transfer status: Received/:/Statut du transfert : Reçu/);}
    }
    const en=await api('c','POST','/copilote/question',{etablissement_id:ids.c,langue:'fr',question:'Réponds en anglais : où se trouve P-43267 ?'});assert.match(en.reponse,/Verified current location/);
    const fr=await api('c','POST','/copilote/question',{etablissement_id:ids.c,langue:'en',question:'Answer in French: where is patient P-43267?'});assert.match(fr.reponse,/Situation actuelle vérifiée/);
    await api('b','POST','/copilote/question',{etablissement_id:ids.a,langue:'en',question:'P-43267'},403);
  });
  await t.test('mode vocal : contrôles navigateur simulés, réponse issue de la vraie API OG',async()=>{
    const browser=await require('playwright').chromium.launch({headless:true});
    try{
      const context=await browser.newContext({viewport:{width:390,height:844}});
      await context.addInitScript(({token,id})=>{
        localStorage.setItem('arrimo-token',token);localStorage.setItem('arrimo-ctx',String(id));localStorage.setItem('arrimo-langue','en');
        window.__paroles=[];window.__mic=0;window.__annulations=0;
        class Recognition{constructor(){window.__reco=this;}start(){window.__mic++;this.onstart?.();}abort(){this.abandonnee=true;}}
        class Utterance{constructor(text){this.text=text;}}
        Object.defineProperty(window,'SpeechRecognition',{value:Recognition,configurable:true});
        Object.defineProperty(window,'SpeechSynthesisUtterance',{value:Utterance,configurable:true});
        Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{lang:'en-CA',localService:true},{lang:'fr-CA',localService:true}],cancel(){window.__annulations++;},speak(u){window.__paroles.push({text:u.text,lang:u.lang});u.onstart?.();}},configurable:true});
      },{token:tokens.c,id:ids.c});
      const page=await context.newPage();const erreurs=[];page.on('pageerror',e=>erreurs.push(e.message));await page.goto(base);
      await page.waitForSelector('body[data-pret="1"]');if(await page.locator('#b-premiers-pas-ok').isVisible())await page.locator('#b-premiers-pas-ok').click();
      await page.locator('#og-open').click();await page.waitForSelector('#og-vocal:not([hidden])');assert.ok(await page.locator('#og-dicter').isVisible()&&await page.locator('#og-converser').isVisible(),'deux boutons vocaux visibles près du champ');await page.locator('#og-dicter').click();assert.equal(await page.locator('#og-vocal details').evaluate(d=>d.open),true,'sans consentement, le volet s’ouvre sur la case');assert.equal(await page.evaluate(()=>window.__mic),0,'aucune écoute sans consentement');
      assert.equal(await page.evaluate(()=>window.__mic),0);await page.locator('#ov-micro').click();assert.equal(await page.evaluate(()=>window.__mic),0);
      await page.locator('#ov-consentement').check();await page.locator('#ov-automatique').check();await page.locator('#ov-micro').click();
      await page.evaluate(()=>{window.__reco.onresult({results:[[{transcript:'Where is patient P-43267 currently located?'}]]});window.__reco.onend();});
      assert.equal(await page.locator('#og-question').inputValue(),'Where is patient P-43267 currently located?');assert.equal(await page.evaluate(()=>window.__paroles.length),0);
      const response=page.waitForResponse(r=>r.url().endsWith('/api/copilote/question'));await page.locator('#og-envoyer').click();assert.match((await (await response).json()).reponse,/Room 108/);
      await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.__paroles.length),0,'réponse sensible : aucune lecture automatique (cahier OG, sécurité)');await page.locator('#ov-lire').click();await page.waitForFunction(()=>window.__paroles.length>0);const audio=await page.evaluate(()=>window.__paroles);assert.ok(audio.every(x=>x.lang==='en-CA'));assert.match(audio.map(x=>x.text).join(''),/SI-108/);
      await page.locator('#ov-stop').click();await page.locator('#ov-micro').click();await page.evaluate(()=>window.__reco.onerror({error:'not-allowed'}));assert.match(await page.locator('#ov-etat').textContent(),/permission denied/);
      assert.equal(await page.locator('#og-question').isEnabled(),true);assert.deepEqual(erreurs,[]);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    }finally{await browser.close();}
  });
  await t.test('7 — questions composées et identifiants croisés',async()=>{const r=await q('c','Patient P-43267 : établissement, service, chambre, lit, admission et transfert ?');assert.match(r.reponse,/chambre 108/);assert.match((await q('c','Dans quel service est-il ?')).reponse,/Soins intensifs/);const faux=await q('c',`Patient P-999999999999 suivi ${numer}`);assert.doesNotMatch(faux.reponse,/SI-108/);});
  await t.test('8 — patient enregistré sans admission',async()=>{const p=await api('b','POST','/patients',{etablissement_id:ids.b,prenom:'Fictif',nom:'SansAdmission',date_naissance:'2000-01-01'});const r=await q('b',p.reference);assert.match(r.reponse,/Aucune demande d’admission/);assert.doesNotMatch(r.reponse,/Statut : admis/);const interne=await q('b',`Patient interne ${p.id}`);assert.match(interne.reponse,/Aucune demande d’admission/);});
  await t.test('9 — patient encore sur civière, pas confondu avec un lit',async()=>{await db.query("INSERT INTO civieres(etablissement_id,code,etat,patient_ref,arrivee_le) VALUES($1,'TEST-CV','occupee','P-76543',now())",[ids.b]);const r=await q('b','P-76543');assert.match(r.reponse,/Civière TEST-CV/);assert.match(r.reponse,/Aucun lit occupé/);});
  await t.test('10 — ancien lit réattribué ne prouve pas une admission actuelle',async()=>{await db.query("UPDATE lits SET patient_ref='P-88888',transfert_id=NULL WHERE id=$1",[l.id]);const r=await q('c','P-43267');assert.match(r.reponse,/Dernière situation connue/);assert.doesNotMatch(r.reponse,/Situation actuelle vérifiée : admis/);await db.query("UPDATE lits SET patient_ref='P-43267',transfert_id=$2 WHERE id=$1",[l.id,transfert.id]);});
  await t.test('11 — capacité interhospitalière sans réservation automatique',async()=>{const avant=(await db.query('SELECT count(*)::int AS n FROM transferts')).rows[0].n;const r=await q('c','Cherche un lit disponible de soins intensifs pour P-43267');assert.ok(r.intentions.includes('pourquoi'));assert.match(r.reponse,/confirmation|confirmé/);assert.match(r.reponse,/ne réserve aucun lit/);assert.equal((await db.query('SELECT count(*)::int AS n FROM transferts')).rows[0].n,avant);});
  await t.test('12 — estimation, âge et durée réelle sont distincts',async()=>{const r=await q('c',`Suivi du transfert ${numer}`);assert.match(r.reponse,/Trajet estimé à la demande/);assert.match(r.reponse,/Temps écoulé depuis la création/);assert.match(r.reponse,/Durée réelle du transport/);const donnees=(await db.query('SELECT minutes_route,distance_km FROM transferts WHERE id=$1',[transfert.id])).rows[0];assert.ok(r.reponse.includes(String(donnees.minutes_route)));});
  await t.test('écran de transfert : trois durées explicitement nommées',async()=>{
    const browser=await require('playwright').chromium.launch({headless:true});
    try {
      const page=await browser.newPage();
      await page.addInitScript(p=>{localStorage.setItem('arrimo-token',p.token);localStorage.setItem('arrimo-ctx',String(p.ctx));localStorage.setItem('arrimo-langue','fr');},{token:tokens.c,ctx:ids.c});
      await page.goto(base);await page.waitForSelector('body[data-pret="1"]');
      if(await page.locator('#b-premiers-pas-ok').isVisible())await page.click('#b-premiers-pas-ok');
      await page.click('#onglets button[data-v="transferts"]');
      const fiche=page.locator('#v-transferts .fiche').filter({hasText:numer});await fiche.waitFor();
      const texte=await fiche.textContent();assert.match(texte,/Trajet routier estimé/);assert.match(texte,/Temps écoulé depuis la création/);assert.match(texte,/Durée réelle du transport/);
    } finally {await browser.close();}
  });
  await t.test('13 — référence identique : précision exigée, transfert explicite utilisable',async()=>{await db.query("INSERT INTO patients(etablissement_id,reference,prenom,nom,date_naissance) VALUES($1,'P-43267','Fictif','Homonyme','2000-01-01')",[ids.c]);const r=await q('c','P-43267');assert.match(r.reponse,/ambiguë/);assert.doesNotMatch(r.reponse,/Situation actuelle vérifiée/);const exact=await q('c',`Suivi du transfert ${numer}`);assert.match(exact.reponse,/SI-108/);});
  await t.test('14 — lectures sans écriture et garde-fous hors périmètre',async()=>{const suivi=require('../src/og-suivi');const ro={query:(sql,args)=>{assert.match(sql.trim(),/^SELECT/i);return db.query(sql,args);}};await suivi.repondreSuivi(ro,{id:1,etabs:[ids.c]},ids.c,`Suivi du transfert ${numer}`);await assert.rejects(suivi.repondreSuivi(ro,{id:1,etabs:[ids.b]},ids.c,'P-43267'),{statut:403});});
  await t.test('module désactivé : le suivi ne contourne pas le verrou existant',async()=>{
    await db.query('UPDATE etablissements SET module_actif=false WHERE id=$1',[ids.c]);
    try {await api('c','POST','/copilote/question',{etablissement_id:ids.c,question:`Suivi du transfert ${numer}`},403);}
    finally {await db.query('UPDATE etablissements SET module_actif=true WHERE id=$1',[ids.c]);}
  });
});
