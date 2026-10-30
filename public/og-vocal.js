/* Voix d'OG. Le navigateur gère le microphone et la synthèse ; aucun audio n'est envoyé à l'API Arrimo.
   Les réglages (autorisation, langue, lecture automatique) sont personnels et se règlent dans Paramètres → OG ;
   le panneau OG ne garde que deux boutons (dictée, conversation), l'état, « Lire la réponse » et « Arrêter ». */
(()=>{
  const panneau=document.querySelector('#og-panel'),section=document.querySelector('#og-vocal'),champ=document.querySelector('#og-question');
  if(!section||!window.ArrimoOgVocal)return;
  const FR={titre:'Voix · données fictives',consentement:'J’autorise le traitement vocal par mon navigateur et son fournisseur, pour des données fictives uniquement.',
    information:'Votre navigateur peut transmettre la voix à son fournisseur. Arrimo ne conserve aucun enregistrement audio. Vérifiez les références reconnues avant d’envoyer la question.',
    automatique:'Lire les réponses à voix haute après une dictée',micro:'Dictée ponctuelle : parler une question, puis la vérifier',conversation:'Conversation vocale continue',
    conversation_stop:'Terminer la conversation vocale',stop:'Arrêter',lire:'Lire la réponse',langue:'Langue du microphone',
    pret:'Clavier disponible. Aucun enregistrement en cours.',ecoute:'Écoute en cours…',verifier:'Vérifiez et corrigez le texte, puis utilisez Envoyer.',
    refuse:'Microphone refusé. Vous pouvez continuer au clavier.',sans_voix:'Aucune voix détectée. Réessayez ou utilisez le clavier.',
    erreur_micro:'Transcription indisponible. Le clavier reste disponible.',micro_indisponible:'Reconnaissance vocale non disponible dans ce navigateur.',
    audio_indisponible:'Lecture vocale non disponible dans ce navigateur.',voix_indisponible:'Aucune voix installée pour cette langue. La réponse écrite reste disponible.',
    lecture:'OG répond… Parlez pour l’interrompre.',conversation_ecoute:'Je vous écoute. Dites « c’est fini » pour terminer.',conversation_terminee:'La conversation vocale est terminée.',
    erreur_audio:'Lecture interrompue par le navigateur. La réponse écrite est disponible.',consentement_requis:'La voix n’est pas encore autorisée.',
    activer:'Pour parler à OG, autorisez la voix dans Paramètres → OG.',ouvrir_parametres:'Ouvrir Paramètres → OG',
    occupe:'OG prépare la réponse précédente…',sensible:'Réponse avec une référence patient : lisez-la à l’écran, ou utilisez « Lire la réponse ».',
    au_revoir:'Très bien, je termine la conversation. À bientôt.',enregistre:'Préférences vocales enregistrées.',
    perso:'Ces réglages sont personnels et propres à cet appareil.'};
  const EN={titre:'Voice · fictitious data',consentement:'I authorize voice processing by my browser and its provider, for fictitious data only.',
    information:'Your browser may send audio to its provider. Arrimo does not retain audio recordings. Check recognized references before sending your question.',
    automatique:'Read answers aloud after dictation',micro:'Dictation: speak a question, then check it',conversation:'Continuous voice conversation',
    conversation_stop:'End the voice conversation',stop:'Stop',lire:'Read answer',langue:'Microphone language',
    pret:'Keyboard available. No recording in progress.',ecoute:'Listening…',verifier:'Check and edit the text, then use Send.',
    refuse:'Microphone permission denied. You can continue typing.',sans_voix:'No speech detected. Try again or use the keyboard.',
    erreur_micro:'Transcription unavailable. You can still type.',micro_indisponible:'Speech recognition is not available in this browser.',
    audio_indisponible:'Speech playback is not available in this browser.',voix_indisponible:'No voice is installed for this language. The written answer remains available.',
    lecture:'OG is answering… Speak to interrupt.',conversation_ecoute:'I’m listening. Say “that’s all” to finish.',conversation_terminee:'Voice conversation ended.',
    erreur_audio:'Playback interrupted by the browser. The written answer is available.',consentement_requis:'Voice is not authorized yet.',
    activer:'To talk to OG, authorize voice in Settings → OG.',ouvrir_parametres:'Open Settings → OG',
    occupe:'OG is preparing the previous answer…',sensible:'Answer with a patient reference: read it on screen, or use “Read answer”.',
    au_revoir:'All right, I’m ending the conversation. Goodbye.',enregistre:'Voice preferences saved.',
    perso:'These settings are personal and specific to this device.'};
  let demo=false,fictif=true,derniere=null,conversationActive=false;const L=()=>typeof langue!=='undefined'&&langue==='en'?'en':'fr';
  // Hors démonstration : même voix, avec un avertissement explicite sur les renseignements de santé réels.
  const REEL={fr:{titre:'Voix',consentement:'J’autorise le traitement vocal par mon navigateur et son fournisseur. Je ne dicterai aucun renseignement de santé réel tant que le fournisseur vocal n’est pas approuvé par l’établissement.'},
    en:{titre:'Voice',consentement:'I authorize voice processing by my browser and its provider. I will not dictate real health information until the voice provider is approved by the facility.'}};
  const lib=k=>(!fictif&&REEL[L()][k])||(L()==='en'?EN:FR)[k];const $=s=>document.querySelector(s);

  /* ---- Préférences personnelles (par utilisateur, sur cet appareil) ---- */
  const cle=()=>`arrimo-og-voix-${(typeof etat!=='undefined'&&etat.moi?.utilisateur?.id)||'anonyme'}`;
  function lirePrefs(){let p=null;try{p=JSON.parse(localStorage.getItem(cle())||'null');}catch{p=null;}
    return {consentement:p?.consentement===true,langue:p?.langue==='en-CA'?'en-CA':p?.langue==='fr-CA'?'fr-CA':(L()==='en'?'en-CA':'fr-CA'),automatique:p?.automatique===true};}
  function ecrirePrefs(changement){const p={...lirePrefs(),...changement,modifie_le:new Date().toISOString()};
    try{localStorage.setItem(cle(),JSON.stringify(p));}catch{}if(!p.consentement)arreterConversation();majActivation();return p;}
  window.ArrimoOgVoixPrefs={lire:lirePrefs,ecrire:ecrirePrefs,texte:lib,disponible:()=>demo};

  section.innerHTML='<div class="ov-barre"><p id="ov-etat" role="status" aria-live="polite"></p><div class="ligne serre"><button type="button" class="btn" id="ov-lire" disabled></button><button type="button" class="btn" id="ov-stop"></button></div></div>'
    +'<p class="ov-activer" id="ov-activer" hidden><span id="ov-activer-texte"></span> <button type="button" class="btn" id="ov-parametres"></button></p>';
  function traduire(){
    $('#ov-lire').textContent=lib('lire');$('#ov-stop').textContent=lib('stop');$('#ov-activer-texte').textContent=lib('activer');$('#ov-parametres').textContent=lib('ouvrir_parametres');
    $('#ov-etat').textContent=lib('pret');etiqueter();
  }
  const ecrireEtat=k=>{$('#ov-etat').textContent=lib(k==='consentement'?'consentement_requis':k);};
  const autorise=()=>demo&&window.isSecureContext&&panneau.open&&!champ.disabled&&typeof etat!=='undefined'&&!!etat.token;
  const consentement=()=>lirePrefs().consentement;
  const moteur=window.ArrimoOgVocal.creer({Recognition:window.SpeechRecognition||window.webkitSpeechRecognition,synthese:window.speechSynthesis,Utterance:window.SpeechSynthesisUtterance,
    langue:()=>lirePrefs().langue,transcription:texte=>{if(autorise())champ.value=texte;},
    etat:k=>{ecrireEtat(conversationActive&&k==='pret'?'conversation_ecoute':k);if(['refuse','erreur_micro','conversation_terminee'].includes(k)&&conversationActive){conversationActive=false;etiqueter();}}});

  // Fin de conversation à la voix (français ou anglais).
  const FIN=/\b(c['’ ]?est (fini|tout|termin[eé])|j['’ ]?ai (plus|pas d['’ ]?autres?) (de )?questions?|plus de questions?|fin de (la )?conversation|on (a )?termin[eé]|au revoir|arr[eê]te(r)? la conversation|that['’ ]?s (all|it)|no (more|other) questions?|end (the )?conversation|goodbye|bye)\b/i;
  const sansAccents=t=>t.normalize('NFD').replace(/[̀-ͯ]/g,'');
  function terminerConversation(direAuRevoir){
    if(!conversationActive)return;conversationActive=false;moteur.arreter();etiqueter();
    if(direAuRevoir&&moteur.parler(lib('au_revoir'),lirePrefs().langue,{autorise:autorise(),consentement:consentement()}))return;
    ecrireEtat('conversation_terminee');
  }
  const demarrerConversation=()=>{
    if(!autorise())return false;
    return moteur.ecouterConversation({autorise:autorise(),consentement:consentement(),
      phrase:texte=>{
        if(!conversationActive||!autorise())return;
        if(FIN.test(texte)||FIN.test(sansAccents(texte))){terminerConversation(true);return;}
        if($('#og-envoyer')?.disabled){ecrireEtat('occupe');return;}
        champ.value=texte;$('#og-form')?.requestSubmit();
      }});
  };
  function arreterConversation(){if(conversationActive){conversationActive=false;moteur.reinitialiser();etiqueter();}}
  function exigerConsentement(){if(consentement())return true;majActivation(true);ecrireEtat('consentement');return false;}
  function dicter(){if(!exigerConsentement())return;arreterConversation();moteur.ecouter({autorise:autorise(),consentement:true});}
  function basculerConversation(){
    if(conversationActive){terminerConversation(false);return;}
    if(!exigerConsentement())return;
    conversationActive=true;etiqueter();if(!demarrerConversation()){conversationActive=false;etiqueter();}
  }
  $('#ov-stop').onclick=()=>{arreterConversation();moteur.reinitialiser();};
  $('#ov-lire').onclick=()=>{if(derniere)moteur.parler(derniere.texte,derniere.langue,{autorise:autorise(),consentement:consentement()});};
  $('#ov-parametres').onclick=()=>{panneau.close?.();window.dispatchEvent(new CustomEvent('arrimo:ouvrir-parametres',{detail:'params:og'}));};
  // Saisie au clavier : le soignant reprend la main, la conversation s'arrête.
  champ.addEventListener('keydown',e=>{if(e.isTrusted&&e.key.length===1)arreterConversation();});
  function reinitialiser(){arreterConversation();moteur.reinitialiser();derniere=null;$('#ov-lire').disabled=true;traduire();}
  panneau.addEventListener('close',reinitialiser);window.addEventListener('arrimo:session-reset',reinitialiser);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)arreterConversation();});
  window.addEventListener('arrimo:og-interaction-manuelle',arreterConversation);
  window.addEventListener('arrimo:og-reponse',e=>{
    if(!autorise())return;derniere={texte:e.detail.texte,langue:e.detail.langue==='en'?'en-CA':'fr-CA',sensible:!!e.detail.sensible};$('#ov-lire').disabled=false;
    if(conversationActive){
      // Le micro reste ouvert pendant la lecture : parler interrompt OG.
      if(derniere.sensible)ecrireEtat('sensible');else moteur.parler(derniere.texte,derniere.langue,{autorise:autorise(),consentement:consentement()});
    } else if(lirePrefs().automatique&&!derniere.sensible)moteur.parler(derniere.texte,derniere.langue,{autorise:autorise(),consentement:consentement()});
  });

  // Deux boutons à icône à côté du champ (cahier OG §4) : dictée et conversation. Le libellé complet est dans l'infobulle.
  const rangee=document.querySelector('#og-form .ligne'),envoi=document.querySelector('#og-envoyer');
  const raccourci=(id,icone,action)=>{const b=document.createElement('button');b.type='button';b.id=id;b.className='btn og-vocal-bouton';b.hidden=true;
    b.innerHTML=`<svg class="ic" aria-hidden="true" focusable="false"><use href="icones.svg#${icone}"/></svg>`;b.onclick=action;rangee?.insertBefore(b,envoi);return b;};
  const boutons=[raccourci('og-dicter','i-mic',dicter),raccourci('og-converser','i-audio-lines',basculerConversation)];
  function etiqueter(){
    const [d,c]=boutons;d.setAttribute('aria-label',lib('micro'));d.title=lib('micro');
    const conv=lib(conversationActive?'conversation_stop':'conversation');c.setAttribute('aria-label',conv);c.title=conv;c.setAttribute('aria-pressed',String(conversationActive));
    c.classList.toggle('actif',conversationActive);
  }
  function majActivation(montrer){const sans=!consentement();$('#ov-activer').hidden=!(sans&&(montrer||!$('#ov-activer').hidden));}
  const afficherBoutons=()=>{const visible=!section.hidden;boutons.forEach(b=>{b.hidden=!visible;});etiqueter();};
  new MutationObserver(afficherBoutons).observe(section,{attributes:true,attributeFilter:['hidden']});
  traduire();void fetch('/api/public').then(r=>r.json()).then(p=>{demo=p.og_vocal===true||p.og_vocal_fictif===true||p.demo===true;fictif=p.og_vocal_fictif===true||p.demo===true;section.hidden=!demo;traduire();afficherBoutons();}).catch(()=>{});
  window.addEventListener('arrimo:langue',traduire);
})();
