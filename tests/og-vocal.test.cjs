'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {creer}=require('../public/og-vocal-moteur');
function fixture(){
  const etats=[],textes=[],lectures=[];let instance,creations=0,annulations=0;
  class Recognition{constructor(){creations++;instance=this;}start(){this.onstart?.();}abort(){this.abandonnee=true;}}
  class Utterance{constructor(texte){this.text=texte;}}
  const synthese={getVoices:()=>[{lang:'en-CA',localService:true},{lang:'fr-CA',localService:true}],cancel(){annulations++;},speak(u){lectures.push(u);}};
  const m=creer({Recognition,synthese,Utterance,langue:()=> 'en-CA',etat:s=>etats.push(s),transcription:s=>textes.push(s)});
  return {m,etats,textes,lectures,synthese,get instance(){return instance},get creations(){return creations},get annulations(){return annulations}};
}
test('vocal : aucune capture au chargement, consentement et politique obligatoires',()=>{
  const f=fixture();assert.equal(f.creations,0);
  assert.equal(f.m.ecouter({autorise:true,consentement:false}),false);assert.equal(f.creations,0);
  assert.equal(f.m.ecouter({autorise:false,consentement:true}),false);assert.equal(f.creations,0);
});
test('vocal : texte reconnu modifiable, aucun envoi automatique et langue choisie',()=>{
  const f=fixture();try{
    assert.equal(f.m.ecouter({autorise:true,consentement:true}),true);assert.equal(f.instance.lang,'en-CA');
    f.instance.onresult({results:[[{transcript:'Where is patient P-43267?'}]]});
    assert.deepEqual(f.textes,['Where is patient P-43267?']);assert.equal(f.lectures.length,0);
    assert.equal(f.etats.at(-1),'ecoute');f.instance.onend();assert.equal(f.etats.at(-1),'verifier');
  }finally{f.m.reinitialiser();}
});
test('vocal : conversation continue ne soumet que les segments finaux et peut reprendre après lecture',()=>{
  const f=fixture(),phrases=[];
  assert.equal(f.m.ecouterConversation({autorise:true,consentement:true,phrase:x=>phrases.push(x)}),true);
  const r=f.instance;assert.equal(r.continuous,true);assert.equal(r.interimResults,true);
  const interim=Object.assign([{transcript:'unfinished'}],{isFinal:false});
  const final=Object.assign([{transcript:'Where is patient P-43267?'}],{isFinal:true});
  r.onresult({resultIndex:0,results:[interim,final]});assert.deepEqual(phrases,['Where is patient P-43267?']);
  let reprise=0;assert.equal(f.m.parler('The patient is admitted.','en-CA',{autorise:true,consentement:true,apresLecture:()=>reprise++}),true);
  f.lectures.at(-1).onend();assert.equal(reprise,1);f.m.reinitialiser();
});
test('vocal : la conversation continue exige le consentement et une session autorisée',()=>{
  const f=fixture();assert.equal(f.m.ecouterConversation({autorise:true,consentement:false}),false);assert.equal(f.creations,0);
  assert.equal(f.m.ecouterConversation({autorise:false,consentement:true}),false);assert.equal(f.creations,0);
});
test('vocal : arrêt et changement de contexte ignorent les transcriptions tardives',()=>{
  const f=fixture();f.m.ecouter({autorise:true,consentement:true});const r=f.instance;
  f.m.reinitialiser();r.onresult({results:[[{transcript:'ancienne question'}]]});assert.deepEqual(f.textes,[]);assert.equal(r.abandonnee,true);
});
test('vocal : refus du microphone conservé même après onend',()=>{
  const f=fixture();f.m.ecouter({autorise:true,consentement:true});const r=f.instance;
  r.onerror({error:'not-allowed'});r.onend();assert.equal(f.etats.at(-1),'refuse');f.m.reinitialiser();
});
test('vocal : réponse parlée dans sa langue, voix locale préférée et interruption',()=>{
  const f=fixture();assert.equal(f.m.parler('Patient P-43267, room 108, bed SI-108.','en-CA',{autorise:true,consentement:true}),true);
  assert.ok(f.lectures.every(u=>u.lang==='en-CA'&&u.voice.localService));assert.match(f.lectures.map(u=>u.text).join(''),/SI-108/);
  const n=f.annulations;f.m.interrompre();assert.equal(f.annulations,n+1);
  assert.equal(f.m.parler('Texte','fr-CA',{autorise:false,consentement:true}),false);
});
test('vocal : absence de moteur ou de voix signalée sans masquer le texte',()=>{
  const etats=[];const m=creer({etat:s=>etats.push(s)});
  assert.equal(m.ecouter({autorise:true,consentement:true}),false);assert.equal(etats.at(-1),'micro_indisponible');
  assert.equal(m.parler('Text','en-CA',{autorise:true,consentement:true}),false);assert.equal(etats.at(-1),'audio_indisponible');
  const f=fixture();f.synthese.getVoices=()=>[];assert.equal(f.m.parler('Text','en-CA',{autorise:true,consentement:true}),false);assert.equal(f.etats.at(-1),'voix_indisponible');
});
