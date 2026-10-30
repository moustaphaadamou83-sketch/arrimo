'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

test('OG navigateur : résultats sélectionnables, fiche rechargée, contexte vocal sensible', {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent(`<button id="og-open"></button><dialog id="og-panel"><div id="og-contexte"></div><div id="og-messages"></div><div id="og-actions"></div><form id="og-form"><input id="og-question"><button id="og-envoyer"></button></form><button id="og-close"></button></dialog>`);
    await page.evaluate(()=>{
      window.langue='fr';window.etat={token:'session-test',ctx:1,moi:{utilisateur:{id:5,nom:'Test',role:'infirmier',mdp_temporaire:false}}};
      window.t=(k,v)=>k==='og.attente'?'…':k;window.locale=()=> 'fr-CA';window.fuseau=()=> 'UTC';
      window.etabCtx=()=>({id:1,nom:'Hôpital A',module_actif:true});window.estEntretien=()=>false;window.allerA=()=>{};
      window.__questions=[];window.__contexts=[];window.__sensibles=[];
      window.addEventListener('arrimo:og-reponse',e=>window.__sensibles.push(e.detail.sensible));
      window.api=async(method,url,body)=>{
        if(method==='POST'&&url==='/copilote/question'){
          if(/cherche|find|search/i.test(body.question))return {reponse:'Several records match. Select the correct file.',mode:'local',patients:[{id:10,prenom:'Jean',nom:'Dupont',reference:'P-101'},{id:11,prenom:'Jean',nom:'Dupont',reference:'P-102'}],limite:false};
          window.__questions.push(body.question);window.__contexts.push(body.patient_id_context);return {reponse:'Situation actuelle vérifiée.',mode:'local'};
        }
        if(method==='POST'&&url==='/copilote/patients/brouillons'){window.__draft=body;return {id:'draft-1',patient:body,doublons_possibles:[],necessite_confirmation_doublons:false};}
        if(method==='POST'&&url==='/copilote/patients/brouillons/draft-1/confirmer')return {id:'draft-1',cree:true,resultat:{reference:'P-00501'}};
        if(method==='DELETE'&&url==='/copilote/patients/brouillons/draft-1')return {annule:true};
        if(url.startsWith('/copilote/patients/10'))return {patient:{id:10,prenom:'Jean',nom:'Dupont',reference:'P-101',reference_locale:null,date_naissance:'1980-01-02',parcours:'hospitalise'},etablissement:{nom:'Hôpital A'},lits:[{lit:'MED-204A',etat:'occupe',unite:'Médecine',chambre:'204',etat_depuis:'2026-10-29T12:00:00Z'}],civieres:[],admissions:[{id:3,statut:'admise',cree_le:'2026-10-29T10:00:00Z'}],transferts:[],alertes:[],historique:[]};
        throw new Error('API non prévue '+url);
      };
    });
    await page.addScriptTag({path:path.join(__dirname,'../public/og.js')});
    await page.locator('#og-open').click();
    await page.locator('#og-question').fill('OG, cherche Jean Dupont');await page.locator('#og-form').evaluate(el=>el.requestSubmit());
    await page.getByRole('button',{name:/Voir la fiche patient Jean Dupont, référence P-101/}).waitFor();
    assert.equal(await page.getByRole('button',{name:/Voir la fiche patient/}).count(),2);
    assert.deepEqual(await page.evaluate(()=>window.__sensibles),[true]);
    await page.getByRole('button',{name:/référence P-101/}).click();
    await page.getByText(/Hôpital A/).last().waitFor();
    assert.match(await page.locator('#og-messages').innerText(),/MED-204A/);
    assert.deepEqual(await page.evaluate(()=>window.__sensibles),[true,true]);
    await page.locator('#og-question').fill('Dans quelle chambre est-il ?');await page.locator('#og-form').evaluate(el=>el.requestSubmit());
    await page.waitForFunction(()=>window.__questions.length===1);
    assert.equal(await page.evaluate(()=>window.__questions[0]),'Dans quelle chambre est-il ?');
    assert.equal(await page.evaluate(()=>window.__contexts[0]),10);
    await page.locator('#og-question').fill('OG, aide-moi à créer un nouveau patient');await page.locator('#og-form').evaluate(el=>el.requestSubmit());
    await page.locator('.og-patient-form').waitFor();
    await page.locator('[name="prenom"]').fill('Awa');await page.locator('[name="nom"]').fill('Diallo');await page.locator('[name="date_naissance"]').fill('1980-01-02');
    await page.locator('.og-patient-form button[type="submit"]').click();await page.getByText('Vérifier le brouillon patient').waitFor();
    await page.getByRole('button',{name:'Confirmer la création'}).click();await page.getByText(/Dossier patient fictif créé : P-00501/).waitFor();
    assert.equal(await page.evaluate(()=>window.__draft.etablissement_id),1);
  }finally{await browser.close();}
});
