'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {creer,choisirVoix,intentionFin,reponseConfirmation}=require('../public/og-vocal-moteur');
const OgLangue=require('../public/og-langue');
function fixture(){
  const etats=[],textes=[],lectures=[];let instance,creations=0,annulations=0;
  class Recognition{constructor(){creations++;instance=this;}start(){this.onstart?.();}abort(){this.abandonnee=true;}}
  class Utterance{constructor(texte){this.text=texte;}}
  const synthese={getVoices:()=>[{lang:'en-CA',localService:true},{lang:'fr-CA',localService:true}],cancel(){annulations++;},speak(u){lectures.push(u);}};
  const m=creer({Recognition,synthese,Utterance,langue:()=> 'en-CA',finTourMs:0,etat:s=>etats.push(s),transcription:s=>textes.push(s)});
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
  r.onresult({resultIndex:0,results:[interim]});assert.deepEqual(phrases,[],'un résultat provisoire ne part jamais');
  r.onresult({resultIndex:0,results:[final]});assert.deepEqual(phrases,['Where is patient P-43267?']);
  let reprise=0;assert.ok(f.m.parler('The patient is admitted.','en-CA',{autorise:true,consentement:true,apresLecture:()=>reprise++}));
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
  const f=fixture();assert.ok(f.m.parler('Patient P-43267, room 108, bed SI-108.','en-CA',{autorise:true,consentement:true}));
  assert.ok(f.lectures.every(u=>u.lang==='en-CA'&&u.voice.localService));assert.match(f.lectures.map(u=>u.text).join(''),/SI-108/);
  const n=f.annulations;f.m.interrompre();assert.equal(f.annulations,n+1);
  assert.equal(f.m.parler('Texte','fr-CA',{autorise:false,consentement:true}),false);
});
test('vocal : absence de moteur ou de voix signalée sans masquer le texte',()=>{
  const etats=[];const m=creer({etat:s=>etats.push(s)});
  assert.equal(m.ecouter({autorise:true,consentement:true}),false);assert.equal(etats.at(-1),'micro_indisponible');
  assert.equal(m.parler('Text','en-CA',{autorise:true,consentement:true}),false);assert.equal(etats.at(-1),'audio_indisponible');
  const f=fixture();f.synthese.getVoices=()=>[];assert.equal(f.m.parler('Text','en-CA',{autorise:true,consentement:true}),false);assert.equal(f.etats.at(-1),'voix_indisponible_en');
});
test('vocal : conversation continue — le micro redémarre seul après un silence, jusqu’à l’arrêt', async () => {
  const f=fixture(),phrases=[];
  f.m.ecouterConversation({autorise:true,consentement:true,phrase:x=>phrases.push(x)});
  const premier=f.instance;premier.onerror({error:'no-speech'});premier.onend();
  await new Promise(r=>setTimeout(r,300));
  assert.notEqual(f.instance,premier,'nouvelle écoute après la coupure du navigateur');assert.equal(f.creations,2);
  f.instance.onresult({resultIndex:0,results:[Object.assign([{transcript:'Et en soins intensifs ?'}],{isFinal:true})]});
  assert.deepEqual(phrases,['Et en soins intensifs ?']);
  f.m.reinitialiser();const apres=f.creations;f.instance.onend?.();await new Promise(r=>setTimeout(r,300));
  assert.equal(f.creations,apres,'aucun redémarrage après l’arrêt');
});
test('vocal : conversation — la voix d’OG captée par le micro est ignorée, une vraie prise de parole l’interrompt', () => {
  const f=fixture(),phrases=[];let interruptions=0;
  f.synthese.speaking=false;
  f.m.ecouterConversation({autorise:true,consentement:true,phrase:x=>phrases.push(x),interruption:()=>interruptions++});
  f.m.parler('Il reste douze lits libres en médecine et trois en soins intensifs.','fr-CA',{autorise:true,consentement:true});
  f.synthese.speaking=true;const r=f.instance;const avant=f.annulations;
  r.onresult({resultIndex:0,results:[Object.assign([{transcript:'douze lits libres en médecine'}],{isFinal:true})]});
  assert.deepEqual(phrases,[],'écho ignoré');assert.equal(f.annulations,avant,'la lecture continue');
  r.onresult({resultIndex:0,results:[Object.assign([{transcript:'attends combien en chirurgie'}],{isFinal:false})]});
  assert.equal(f.annulations,avant+1,'OG se tait');assert.equal(interruptions,1);
  f.synthese.speaking=false;
  r.onresult({resultIndex:0,results:[Object.assign([{transcript:'Combien en chirurgie ?'}],{isFinal:true})]});
  assert.deepEqual(phrases,['Combien en chirurgie ?']);f.m.reinitialiser();
});
test('vocal : conversation — un micro refusé arrête l’écoute sans relance', async () => {
  const f=fixture();f.m.ecouterConversation({autorise:true,consentement:true});
  const r=f.instance;r.onerror({error:'not-allowed'});r.onend();await new Promise(x=>setTimeout(x,300));
  assert.equal(f.creations,1);assert.equal(f.etats.at(-1),'refuse');
});

test('langue : la réponse suit la langue de la question, la demande explicite, puis la préférence',()=>{
  assert.equal(OgLangue.langueReponse('How many beds are available?','fr'),'en');
  assert.equal(OgLangue.langueReponse('Combien de lits sont disponibles ?','en'),'fr');
  assert.equal(OgLangue.langueReponse('Réponds en anglais : combien de lits ?','fr'),'en');
  assert.equal(OgLangue.langueReponse('Answer in French: how many beds?','en'),'fr');
  assert.equal(OgLangue.langueReponse('P-43267','en'),'en','référence seule : préférence de conversation');
  assert.equal(OgLangue.langueReponse('P-43267','fr'),'fr');
  for(const q of ['Which beds are free?','What should I do first?','And in the ICU?','Show me the stretchers'])assert.equal(OgLangue.detecter(q),'en',q);
  for(const q of ['Quels lits sont libres ?','Que faire en priorité ?','Et en soins intensifs ?','Montre-moi les civières','Y a-t-il un lit en pédiatrie ?'])assert.equal(OgLangue.detecter(q),'fr',q);
});
test('voix : jamais une voix d’une autre langue, genre respecté quand il existe',()=>{
  const voix=[{name:'Amélie',lang:'fr-CA',localService:true},{name:'Thomas',lang:'fr-FR',localService:true},{name:'Samantha',lang:'en-US',localService:true},{name:'Daniel',lang:'en_GB',localService:true},{name:'Grandpa (English (US))',lang:'en-US',localService:true}];
  assert.equal(choisirVoix(voix,'en-CA','masculine').voix.name,'Daniel');assert.equal(choisirVoix(voix,'en-CA','feminine').voix.name,'Samantha');
  assert.equal(choisirVoix(voix,'fr-CA','masculine').voix.name,'Thomas');assert.equal(choisirVoix(voix,'fr-CA','feminine').voix.name,'Amélie');
  assert.equal(choisirVoix(voix.filter(v=>!v.lang.startsWith('en')),'en-CA','feminine').voix,null,'aucune voix française pour un texte anglais');
  const seule=choisirVoix([{name:'Amélie',lang:'fr-CA'}],'fr-CA','masculine');assert.equal(seule.voix.name,'Amélie');assert.equal(seule.genreRespecte,false);
});
test('voix : la réponse anglaise est lue avec une voix anglaise, même juste après une réponse française',()=>{
  const lectures=[];let annulations=0;
  const synthese={getVoices:()=>[{name:'Amélie',lang:'fr-CA'},{name:'Samantha',lang:'en-US'}],cancel(){annulations++;},speak(u){lectures.push(u);}};
  const m=creer({synthese,Utterance:class{constructor(t){this.text=t;}},genre:()=> 'feminine'});
  m.parler('Il reste douze lits.','fr-CA',{autorise:true,consentement:true});const avant=annulations;
  m.parler('Twelve beds are available.','en-CA',{autorise:true,consentement:true});
  assert.equal(annulations,avant+1,'lecture précédente annulée');
  const derniere=lectures.at(-1);assert.equal(derniere.voice.name,'Samantha');assert.match(derniere.lang,/^en/);
});
test('fin de conversation : claire, ambiguë (confirmation) ou simple politesse',()=>{
  for(const q of ['Termine la conversation.','On a fini.','Arrête la conversation','End the conversation.','Stop the voice chat.','Je n’ai plus de questions'])assert.equal(intentionFin(q),'fin',q);
  for(const q of ['merci','Merci beaucoup','Thanks','OK'])assert.equal(intentionFin(q),'politesse',q);
  for(const q of ['au revoir','Goodbye','stop'])assert.equal(intentionFin(q),'ambigu',q);
  for(const q of ['J’ai fini de remplir le formulaire','that’s all the beds?','We’re done with the transfer','Combien de lits libres ?'])assert.equal(intentionFin(q),null,q);
  assert.equal(reponseConfirmation('Oui'),'oui');assert.equal(reponseConfirmation('non, continue'),'non');assert.equal(reponseConfirmation('combien de lits'),null);
});
test('conversation : micro coupé = reconnaissance fermée et jamais relancée ; réactivation = nouvelle écoute',async()=>{
  const f=fixture();f.m.ecouterConversation({autorise:true,consentement:true});const r=f.instance;
  assert.equal(f.m.couperMicro(true),true);assert.equal(r.abandonnee,true);assert.equal(f.etats.at(-1),'micro_coupe');
  r.onend?.();await new Promise(x=>setTimeout(x,300));assert.equal(f.creations,1,'aucune relance micro coupé');
  f.m.couperMicro(false);assert.equal(f.creations,2);assert.equal(f.m.microCoupe(),false);f.m.reinitialiser();
});
test('conversation : coupures rapides en boucle → relances espacées puis état de reconnexion (pas de boucle serrée)',async()=>{
  const f=fixture();f.m.ecouterConversation({autorise:true,consentement:true});
  for(let i=0;i<4;i++){const r=f.instance;r.onend();await new Promise(x=>setTimeout(x,(250*2**(i+1))+50));}
  assert.equal(f.etats.includes('reconnexion'),true);
  const n=f.creations;f.instance.onend();await new Promise(x=>setTimeout(x,300));assert.equal(f.creations,n,'pas de relance immédiate après des échecs répétés');
  f.m.reinitialiser();
});
test('conversation : un tour réunit les segments successifs et part après la fin de parole',async()=>{
  const phrases=[];let instance;class R{constructor(){instance=this;}start(){this.onstart?.();}abort(){}}
  const m=creer({Recognition:R,finTourMs:80,etat:()=>{}});m.ecouterConversation({autorise:true,consentement:true,phrase:x=>phrases.push(x)});
  instance.onresult({resultIndex:0,results:[Object.assign([{transcript:'Combien de lits'}],{isFinal:true})]});
  await new Promise(x=>setTimeout(x,30));
  instance.onresult({resultIndex:1,results:[null,Object.assign([{transcript:'en médecine ?'}],{isFinal:true})]});
  assert.deepEqual(phrases,[]);await new Promise(x=>setTimeout(x,150));
  assert.deepEqual(phrases,['Combien de lits en médecine ?']);m.reinitialiser();
});
test('conversation : fin = micro fermé, aucune relance, transcriptions tardives ignorées',async()=>{
  const f=fixture(),phrases=[];f.m.ecouterConversation({autorise:true,consentement:true,phrase:x=>phrases.push(x)});const r=f.instance;
  f.m.terminerConversation('conversation_terminee');assert.equal(r.abandonnee,true);assert.equal(f.m.conversationActive(),false);
  r.onresult({resultIndex:0,results:[Object.assign([{transcript:'trop tard'}],{isFinal:true})]});r.onend();
  await new Promise(x=>setTimeout(x,300));assert.deepEqual(phrases,[]);assert.equal(f.creations,1);
});
