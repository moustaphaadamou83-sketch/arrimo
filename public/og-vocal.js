/* Version de démonstration uniquement. Le navigateur gère le microphone ; aucun audio n'est envoyé à l'API Arrimo. */
(()=>{
  const panneau=document.querySelector('#og-panel'),section=document.querySelector('#og-vocal'),champ=document.querySelector('#og-question');
  if(!section||!window.ArrimoOgVocal)return;
  const FR={titre:'Voix · données fictives',consentement:'J’autorise le traitement vocal par mon navigateur et son fournisseur, pour des données fictives uniquement.',
    information:'Votre navigateur peut transmettre la voix à son fournisseur. Arrimo ne conserve aucun enregistrement audio. Vérifiez les références reconnues avant d’envoyer la question.',
    automatique:'Lire les prochaines réponses à voix haute',micro:'Dictée ponctuelle',conversation:'Démarrer la conversation vocale',stop:'Arrêter',lire:'Lire la réponse',langue:'Langue du microphone',
    pret:'Clavier disponible. Aucun enregistrement en cours.',ecoute:'Écoute en cours…',verifier:'Vérifiez et corrigez le texte, puis utilisez Envoyer.',
    refuse:'Microphone refusé. Vous pouvez continuer au clavier.',sans_voix:'Aucune voix détectée. Réessayez ou utilisez le clavier.',
    erreur_micro:'Transcription indisponible. Le clavier reste disponible.',micro_indisponible:'Reconnaissance vocale non disponible dans ce navigateur.',
    audio_indisponible:'Lecture vocale non disponible dans ce navigateur.',voix_indisponible:'Aucune voix installée pour cette langue. La réponse écrite reste disponible.',
    lecture:'Lecture de la réponse…',conversation_ecoute:'Conversation vocale en écoute…',conversation_terminee:'La conversation vocale est terminée.',erreur_audio:'Lecture interrompue par le navigateur. La réponse écrite est disponible.',consentement_requis:'Autorisez le traitement vocal avant de démarrer.'};
  const EN={titre:'Voice · fictitious data',consentement:'I authorize voice processing by my browser and its provider, for fictitious data only.',
    information:'Your browser may send audio to its provider. Arrimo does not retain audio recordings. Check recognized references before sending your question.',
    automatique:'Read upcoming answers aloud',micro:'Dictate a question',conversation:'Start voice conversation',stop:'Stop',lire:'Read answer',langue:'Microphone language',
    pret:'Keyboard available. No recording in progress.',ecoute:'Listening…',verifier:'Check and edit the text, then use Send.',
    refuse:'Microphone permission denied. You can continue typing.',sans_voix:'No speech detected. Try again or use the keyboard.',
    erreur_micro:'Transcription unavailable. You can still type.',micro_indisponible:'Speech recognition is not available in this browser.',
    audio_indisponible:'Speech playback is not available in this browser.',voix_indisponible:'No voice is installed for this language. The written answer remains available.',
    lecture:'Reading the answer…',conversation_ecoute:'Voice conversation listening…',conversation_terminee:'Voice conversation ended.',erreur_audio:'Playback interrupted by the browser. The written answer is available.',consentement_requis:'Authorize voice processing before starting.'};
  let demo=false,fictif=true,derniere=null,conversationActive=false;const L=()=>typeof langue!=='undefined'&&langue==='en'?'en':'fr';
  // Hors démonstration : même voix, avec un avertissement explicite sur les renseignements de santé réels.
  const REEL={fr:{titre:'Voix',consentement:'J’autorise le traitement vocal par mon navigateur et son fournisseur. Je ne dicterai aucun renseignement de santé réel tant que le fournisseur vocal n’est pas approuvé par l’établissement.'},
    en:{titre:'Voice',consentement:'I authorize voice processing by my browser and its provider. I will not dictate real health information until the voice provider is approved by the facility.'}};
  const lib=k=>(!fictif&&REEL[L()][k])||(L()==='en'?EN:FR)[k];const $=s=>section.querySelector(s);
  section.innerHTML='<details><summary id="ov-titre"></summary><p id="ov-information"></p><label class="case"><input type="checkbox" id="ov-consentement"><span id="ov-consentement-texte"></span></label><label for="ov-langue" id="ov-langue-texte"></label><select id="ov-langue"><option value="fr-CA">Français</option><option value="en-CA">English</option></select><label class="case"><input type="checkbox" id="ov-automatique"><span id="ov-automatique-texte"></span></label><div class="ligne"><button type="button" class="btn" id="ov-micro"></button><button type="button" class="btn" id="ov-conversation"></button><button type="button" class="btn" id="ov-stop"></button><button type="button" class="btn" id="ov-lire" disabled></button></div><p id="ov-etat" role="status" aria-live="polite"></p></details>';
  function traduire(){
    for(const [id,k]of Object.entries({'ov-titre':'titre','ov-information':'information','ov-consentement-texte':'consentement','ov-langue-texte':'langue','ov-automatique-texte':'automatique','ov-micro':'micro','ov-conversation':'conversation','ov-stop':'stop','ov-lire':'lire'}))$('#'+id).textContent=lib(k);
    $('#ov-langue').value=L()==='en'?'en-CA':'fr-CA';$('#ov-etat').textContent=lib('pret');
  }
  const autorise=()=>demo&&window.isSecureContext&&panneau.open&&!champ.disabled&&!!etat.token;
  const consentement=()=>$('#ov-consentement').checked;
  const moteur=window.ArrimoOgVocal.creer({Recognition:window.SpeechRecognition||window.webkitSpeechRecognition,synthese:window.speechSynthesis,Utterance:window.SpeechSynthesisUtterance,
    langue:()=>$('#ov-langue').value,transcription:texte=>{if(autorise())champ.value=texte;},
    etat:k=>{$('#ov-etat').textContent=lib(k==='consentement'?'consentement_requis':k);if(['refuse','sans_voix','erreur_micro','conversation_terminee'].includes(k)&&conversationActive){conversationActive=false;$('#ov-conversation').textContent=lib('conversation');}}});
  const demarrerEcouteConversation=()=>{
    if(!conversationActive||!autorise())return;
    return moteur.ecouterConversation({autorise:autorise(),consentement:consentement(),phrase:texte=>{
      if(!conversationActive||!autorise()||document.querySelector('#og-envoyer')?.disabled)return;moteur.arreter();champ.value=texte;document.querySelector('#og-form')?.requestSubmit();
    }});
  };
  const arreterConversation=()=>{conversationActive=false;moteur.reinitialiser();$('#ov-conversation').textContent=lib('conversation');};
  $('#ov-micro').onclick=()=>moteur.ecouter({autorise:autorise(),consentement:consentement()});
  $('#ov-conversation').onclick=()=>{if(conversationActive){arreterConversation();return;}conversationActive=true;$('#ov-conversation').textContent=lib('stop');if(!demarrerEcouteConversation()){conversationActive=false;$('#ov-conversation').textContent=lib('conversation');}};
  $('#ov-stop').onclick=()=>{arreterConversation();moteur.reinitialiser();};
  $('#ov-consentement').onchange=()=>{if(!consentement()){arreterConversation();moteur.reinitialiser();}};
  $('#ov-lire').onclick=()=>{if(derniere)moteur.parler(derniere.texte,derniere.langue,{autorise:autorise(),consentement:consentement()});};
  champ.addEventListener('focus',()=>{arreterConversation();moteur.arreter();});
  function reinitialiser(){arreterConversation();moteur.reinitialiser();derniere=null;$('#ov-consentement').checked=false;$('#ov-automatique').checked=false;$('#ov-lire').disabled=true;traduire();}
  panneau.addEventListener('close',reinitialiser);window.addEventListener('arrimo:session-reset',reinitialiser);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)arreterConversation();});
  window.addEventListener('arrimo:og-echec',()=>{if(conversationActive)demarrerEcouteConversation();});
  window.addEventListener('arrimo:og-interaction-manuelle',arreterConversation);
  window.addEventListener('arrimo:og-reponse',e=>{
    if(!autorise())return;derniere={texte:e.detail.texte,langue:e.detail.langue==='en'?'en-CA':'fr-CA',sensible:!!e.detail.sensible};$('#ov-lire').disabled=false;
    if(conversationActive){if(!derniere.sensible&&moteur.parler(derniere.texte,derniere.langue,{autorise:autorise(),consentement:consentement(),apresLecture:demarrerEcouteConversation}))return;demarrerEcouteConversation();}
    else if($('#ov-automatique').checked&&!derniere.sensible)moteur.parler(derniere.texte,derniere.langue,{autorise:autorise(),consentement:consentement()});
  });
  // Deux boutons visibles à côté du champ (cahier OG §4) ; le consentement reste exigé et s'affiche au premier usage.
  const rangee=document.querySelector('#og-form .ligne'),envoi=document.querySelector('#og-envoyer');
  const raccourci=(id,icone,cible)=>{const b=document.createElement('button');b.type='button';b.id=id;b.className='btn og-vocal-bouton';b.hidden=true;
    b.innerHTML=`<svg class="ic" aria-hidden="true" focusable="false"><use href="icones.svg#${icone}"/></svg><span></span>`;
    b.onclick=()=>{if(!consentement()){section.querySelector('details').open=true;$('#ov-consentement').focus();$('#ov-etat').textContent=lib('consentement_requis');return;}$(cible).click();};
    rangee?.insertBefore(b,envoi);return b;};
  const boutons=[raccourci('og-dicter','i-mic','#ov-micro'),raccourci('og-converser','i-audio-lines','#ov-conversation')];
  const etiqueter=()=>{boutons[0].querySelector('span').textContent=lib('micro');boutons[0].setAttribute('aria-label',lib('micro'));
    const conv=conversationActive?lib('stop'):lib('conversation');boutons[1].querySelector('span').textContent=conv;boutons[1].setAttribute('aria-label',conv);boutons[1].setAttribute('aria-pressed',String(conversationActive));};
  const afficherBoutons=()=>{const visible=!section.hidden;boutons.forEach(b=>{b.hidden=!visible;});etiqueter();};
  new MutationObserver(afficherBoutons).observe(section,{attributes:true,attributeFilter:['hidden']});
  new MutationObserver(etiqueter).observe($('#ov-conversation'),{childList:true,characterData:true,subtree:true});
  traduire();void fetch('/api/public').then(r=>r.json()).then(p=>{demo=p.og_vocal===true||p.og_vocal_fictif===true||p.demo===true;fictif=p.og_vocal_fictif===true||p.demo===true;section.hidden=!demo;traduire();afficherBoutons();}).catch(()=>{});
})();
