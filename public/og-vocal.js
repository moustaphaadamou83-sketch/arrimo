/* Voix de l'assistant (nom « OG » par défaut, nom de l'établissement à l'affichage).
   Trois usages distincts : dictée dans le champ, message vocal (public/og-message-vocal.js) et conversation continue.
   Le navigateur gère le micro, la transcription et la synthèse ; aucun audio n'est envoyé à l'API Arrimo, seul le texte
   de la question suit le même chemin (mêmes droits, même moteur) qu'une question écrite.
   Trois langues distinctes : interface (en-tête FR | EN), conversation (préférence personnelle : automatique = langue de
   l'interface, ou français, ou anglais ; sert au micro et aux questions ambiguës), lecture (langue de la réponse reçue). */
(()=>{
  const panneau=document.querySelector('#og-panel'),section=document.querySelector('#og-vocal'),champ=document.querySelector('#og-question');
  if(!section||!window.ArrimoOgVocal)return;
  const FR={titre:'Voix · données fictives',consentement:'J’autorise le traitement vocal par mon navigateur et son fournisseur, pour des données fictives uniquement.',
    information:'Votre navigateur peut transmettre la voix à son fournisseur pour la transcrire. Arrimo ne conserve aucun enregistrement audio. Vérifiez les références reconnues avant d’envoyer une question.',
    automatique:'Lire les réponses à voix haute après une dictée ou un message vocal',micro:'Dictée : parler, puis vérifier le texte dans le champ',conversation:'Conversation vocale continue',
    conversation_stop:'Terminer la conversation vocale',stop:'Arrêter',lire:'Lire la réponse',langue:'Langue de conversation',langue_auto:'Automatique (langue de l’interface)',
    langue_aide:'Langue du micro et des réponses quand la question est ambiguë. OG répond toujours dans la langue de votre question.',
    volume:'Volume de la voix',pret:'Clavier disponible. Aucun enregistrement en cours.',ecoute:'Dictée : je vous écoute…',verifier:'Vérifiez et corrigez le texte, puis utilisez Envoyer.',
    refuse:'Microphone refusé. Autorisez-le dans les réglages du navigateur, ou continuez au clavier.',sans_voix:'Aucune voix détectée. Réessayez ou utilisez le clavier.',
    erreur_micro:'Micro indisponible (aucun périphérique ou déjà utilisé). Le clavier reste disponible.',micro_indisponible:'Reconnaissance vocale non disponible dans ce navigateur (utilisez Chrome, Edge ou Safari).',
    audio_indisponible:'Lecture vocale non disponible dans ce navigateur.',voix_indisponible:'Aucune voix de synthèse disponible dans ce navigateur. La réponse écrite reste affichée.',
    voix_indisponible_fr:'Aucune voix française installée : la réponse n’est pas lue (jamais avec une voix d’une autre langue). Ajoutez une voix française dans les réglages du système, ou utilisez Chrome.',
    voix_indisponible_en:'Aucune voix anglaise installée : la réponse n’est pas lue (jamais avec une voix française). Ajoutez une voix anglaise dans les réglages du système, ou utilisez Chrome.',
    voix_genre:'Voix du genre choisi indisponible pour cette langue : une autre voix compatible est utilisée.',
    connexion:'Ouverture du micro…',conversation_ecoute:'Je vous écoute. Parlez quand vous voulez.',parole:'Vous parlez…',traitement:'OG prépare la réponse…',
    lecture:'OG répond… Parlez pour l’interrompre.',interrompu:'Interrompu. Je vous écoute.',micro_coupe:'Micro coupé. OG n’écoute plus ; réactivez le micro pour parler.',
    reconnexion:'Reconnexion du micro…',reseau:'Transcription interrompue (réseau). Réessayez.',hors_ligne:'Connexion perdue. L’écoute reprendra au retour du réseau.',
    conversation_terminee:'La conversation vocale est terminée. Vous pouvez continuer à l’écrit.',
    erreur_audio:'Lecture interrompue par le navigateur. La réponse écrite est affichée.',consentement_requis:'La voix n’est pas encore autorisée.',
    activer:'Pour parler à OG, autorisez la voix dans Paramètres → OG.',ouvrir_parametres:'Ouvrir Paramètres → OG',
    occupe:'OG prépare la réponse précédente… Reposez votre question ensuite.',sensible:'Réponse avec une référence patient : lisez-la à l’écran, ou utilisez « Lire la réponse ».',
    bonjour:'Je vous écoute.',au_revoir:'Très bien, je termine la conversation. À bientôt.',confirmer_fin:'Voulez-vous terminer la conversation ? Dites oui ou non.',
    confirmation:'Terminer la conversation ? Dites « oui » ou « non ».',on_continue:'D’accord, je vous écoute.',de_rien:'Avec plaisir. Autre chose ?',
    enregistre:'Préférences vocales enregistrées.',enregistre_erreur:'Préférences gardées sur cet appareil ; l’enregistrement sur le compte a échoué.',
    perso:'Autorisation, langue et lecture automatique sont enregistrées sur votre compte ; le volume est propre à cet appareil.',
    couper:'Couper le micro',reactiver:'Réactiver le micro',terminer:'Terminer',direct:'Transcription en direct',latence:'Délai entre la fin de votre phrase et le début de la réponse : {s} s',
    langue_conv:'Langue de la conversation',langue_changee_fr:'Conversation en français.',langue_changee_en:'Conversation en anglais.'};
  const EN={titre:'Voice · fictitious data',consentement:'I authorize voice processing by my browser and its provider, for fictitious data only.',
    information:'Your browser may send audio to its provider for transcription. Arrimo does not retain audio recordings. Check recognized references before sending a question.',
    automatique:'Read answers aloud after dictation or a voice message',micro:'Dictation: speak, then check the text in the field',conversation:'Continuous voice conversation',
    conversation_stop:'End the voice conversation',stop:'Stop',lire:'Read answer',langue:'Conversation language',langue_auto:'Automatic (interface language)',
    langue_aide:'Language of the microphone and of answers when a question is ambiguous. OG always answers in the language of your question.',
    volume:'Voice volume',pret:'Keyboard available. No recording in progress.',ecoute:'Dictation: listening…',verifier:'Check and edit the text, then use Send.',
    refuse:'Microphone permission denied. Allow it in your browser settings, or continue typing.',sans_voix:'No speech detected. Try again or use the keyboard.',
    erreur_micro:'Microphone unavailable (no device, or already in use). You can still type.',micro_indisponible:'Speech recognition is not available in this browser (use Chrome, Edge or Safari).',
    audio_indisponible:'Speech playback is not available in this browser.',voix_indisponible:'No speech synthesis voice is available in this browser. The written answer remains displayed.',
    voix_indisponible_fr:'No French voice is installed: the answer is not read aloud (never with a voice in another language). Add a French voice in your system settings, or use Chrome.',
    voix_indisponible_en:'No English voice is installed: the answer is not read aloud (never with a French voice). Add an English voice in your system settings, or use Chrome.',
    voix_genre:'The chosen voice gender is not available for this language: another compatible voice is used.',
    connexion:'Opening the microphone…',conversation_ecoute:'I’m listening. Speak whenever you like.',parole:'You are speaking…',traitement:'OG is preparing the answer…',
    lecture:'OG is answering… Speak to interrupt.',interrompu:'Interrupted. I’m listening.',micro_coupe:'Microphone muted. OG is not listening; unmute to speak.',
    reconnexion:'Reconnecting the microphone…',reseau:'Transcription interrupted (network). Try again.',hors_ligne:'Connection lost. Listening will resume when the network is back.',
    conversation_terminee:'The voice conversation has ended. You can continue in writing.',
    erreur_audio:'Playback interrupted by the browser. The written answer is displayed.',consentement_requis:'Voice is not authorized yet.',
    activer:'To talk to OG, authorize voice in Settings → OG.',ouvrir_parametres:'Open Settings → OG',
    occupe:'OG is preparing the previous answer… Ask again afterwards.',sensible:'Answer with a patient reference: read it on screen, or use “Read answer”.',
    bonjour:'I’m listening.',au_revoir:'All right, I’m ending the conversation. Goodbye.',confirmer_fin:'Do you want to end the conversation? Say yes or no.',
    confirmation:'End the conversation? Say “yes” or “no”.',on_continue:'All right, I’m listening.',de_rien:'You’re welcome. Anything else?',
    enregistre:'Voice preferences saved.',enregistre_erreur:'Preferences kept on this device; saving to your account failed.',
    perso:'Authorization, language and automatic reading are saved to your account; volume is specific to this device.',
    couper:'Mute microphone',reactiver:'Unmute microphone',terminer:'End',direct:'Live transcript',latence:'Delay between the end of your sentence and the start of the answer: {s} s',
    langue_conv:'Conversation language',langue_changee_fr:'Conversation in French.',langue_changee_en:'Conversation in English.'};
  let demo=false,fictif=true,derniere=null,conversationActive=false,confirmationFin=false,coupeParMasquage=false,effectif={vocal:true,dictee:true,conversation:true},garde=null;
  const L=()=>typeof langue!=='undefined'&&langue==='en'?'en':'fr';
  const nom=x=>window.ArrimoNomOg?window.ArrimoNomOg.appliquer(x):x;
  // Hors démonstration : même voix, avec un avertissement explicite sur les renseignements de santé réels.
  const REEL={fr:{titre:'Voix',consentement:'J’autorise le traitement vocal par mon navigateur et son fournisseur. Je ne dicterai aucun renseignement de santé réel tant que le fournisseur vocal n’est pas approuvé par l’établissement.'},
    en:{titre:'Voice',consentement:'I authorize voice processing by my browser and its provider. I will not dictate real health information until the voice provider is approved by the facility.'}};
  const libEn=(l,k,v)=>{let s=(!fictif&&REEL[l][k])||(l==='en'?EN:FR)[k]||k;if(v)s=s.replace(/\{(\w+)\}/g,(m,x)=>v[x]??m);return nom(s);};
  const lib=(k,v)=>libEn(L(),k,v);const $=s=>document.querySelector(s);

  /* ---- Préférences personnelles : compte (base) + copie locale ; le volume reste propre à l'appareil ---- */
  const cle=()=>`arrimo-og-voix-${(typeof etat!=='undefined'&&etat.moi?.utilisateur?.id)||'anonyme'}`;
  const langueValide=x=>x==='fr-CA'||x==='fr'?'fr':x==='en-CA'||x==='en'?'en':x==='auto'?'auto':null;
  function lirePrefs(){
    let local=null;try{local=JSON.parse(localStorage.getItem(cle())||'null');}catch{local=null;}
    const compte=typeof etat!=='undefined'?etat.moi?.utilisateur?.preferences_og:null;
    const src=compte&&Object.keys(compte).length?compte:local;
    // Anciennes préférences locales (avant la v2) : la langue y était figée sans choix explicite → « automatique ».
    const lg=src&&(src===compte||src.v===2)?langueValide(src.langue)||'auto':'auto';
    let volume=Number(local?.volume);if(!(volume>=0.2&&volume<=1))volume=1;
    return {consentement:src?.consentement===true,langue:lg,automatique:src?.automatique===true,volume};
  }
  function ecrirePrefs(changement,{silencieux=false}={}){
    const avant=lirePrefs();const c={...changement};if('langue' in c)c.langue=langueValide(c.langue)||avant.langue;
    const p={...avant,...c};
    try{localStorage.setItem(cle(),JSON.stringify({...p,v:2,modifie_le:new Date().toISOString()}));}catch{}
    if(typeof etat!=='undefined'&&etat.moi?.utilisateur){
      const corps={consentement:p.consentement,langue:p.langue,automatique:p.automatique};
      etat.moi.utilisateur.preferences_og={...(etat.moi.utilisateur.preferences_og||{}),...corps};
      if(['consentement','langue','automatique'].some(k=>k in c)&&typeof api==='function'&&etat.token)
        api('PUT','/moi/og-voix',corps).then(r=>{if(etat.moi)etat.moi.utilisateur.preferences_og=r;if(!silencieux)window.dispatchEvent(new CustomEvent('arrimo:og-voix-enregistree',{detail:{ok:true}}));})
          .catch(()=>{if(!silencieux)window.dispatchEvent(new CustomEvent('arrimo:og-voix-enregistree',{detail:{ok:false}}));});
    }
    if(!p.consentement){terminerConversation(false);window.ArrimoOgMessageVocal?.annuler?.();}
    if('langue' in c)changerLangueSession();
    majActivation();majLangueConv();return p;
  }
  /** Langue de conversation effective (fr, en) : préférence, sinon langue de l'interface. */
  const langueConversation=()=>{const p=lirePrefs().langue;return p==='auto'?L():p;};
  const codeMicro=()=>langueConversation()==='en'?'en-CA':'fr-CA';
  window.ArrimoOgVoixPrefs={lire:lirePrefs,ecrire:ecrirePrefs,texte:lib,disponible:()=>demo,langueConversation,codeMicro};

  section.innerHTML='<div class="ov-barre"><span class="ov-pastille" id="ov-pastille" aria-hidden="true"></span><p id="ov-etat" role="status" aria-live="polite"></p><div class="ligne serre"><button type="button" class="btn" id="ov-lire" disabled></button><button type="button" class="btn" id="ov-stop"></button></div></div>'
    +'<div class="ov-conv" id="ov-conv" hidden><p class="ov-direct" id="ov-direct" aria-live="off"></p><div class="ov-commandes"><div class="ov-langue" role="group" id="ov-langue"><button type="button" class="btn" data-ov-langue="fr" lang="fr">FR</button><button type="button" class="btn" data-ov-langue="en" lang="en">EN</button></div>'
    +'<button type="button" class="btn" id="ov-micro" aria-pressed="false"></button><button type="button" class="btn pri" id="ov-terminer"></button></div><p class="note ov-latence" id="ov-latence"></p></div>'
    +'<div id="ov-message" hidden></div>'
    +'<p class="ov-activer" id="ov-activer" hidden><span id="ov-activer-texte"></span> <button type="button" class="btn" id="ov-parametres"></button></p>';
  let dernierEtat='pret';
  const COULEUR={conversation_ecoute:'ecoute',interrompu:'ecoute',parole:'parole',lecture:'parole',connexion:'attente',traitement:'attente',reconnexion:'attente',confirmation:'attente',
    micro_coupe:'coupe',refuse:'erreur',erreur_micro:'erreur',micro_indisponible:'erreur',hors_ligne:'erreur',reseau:'erreur',erreur_audio:'erreur'};
  function ecrireEtat(k){
    dernierEtat=k;const cleTexte=k==='consentement'?'consentement_requis':k;
    $('#ov-etat').textContent=lib(cleTexte);$('#ov-pastille').dataset.etat=COULEUR[k]||'inactif';
  }
  function traduire(){
    $('#ov-lire').textContent=lib('lire');$('#ov-stop').textContent=lib('stop');$('#ov-activer-texte').textContent=lib('activer');$('#ov-parametres').textContent=lib('ouvrir_parametres');
    $('#ov-terminer').textContent=lib('terminer');$('#ov-langue').setAttribute('aria-label',lib('langue_conv'));$('#ov-direct').setAttribute('aria-label',lib('direct'));
    majMicro();ecrireEtat(dernierEtat);etiqueter();majLangueConv();
  }
  const autorise=()=>demo&&window.isSecureContext&&panneau.open&&!champ.disabled&&typeof etat!=='undefined'&&!!etat.token;
  const consentement=()=>lirePrefs().consentement;
  const moteur=window.ArrimoOgVocal.creer({Recognition:window.SpeechRecognition||window.webkitSpeechRecognition,synthese:window.speechSynthesis,Utterance:window.SpeechSynthesisUtterance,
    langue:codeMicro,genre:()=>window.ArrimoOgVoix||null,volume:()=>lirePrefs().volume,
    transcription:texte=>{if(autorise()){champ.value=texte;champ.dataset.source='dictee';}},
    etat:k=>{
      if(conversationActive){
        if(k==='pret')k=confirmationFin?'confirmation':moteur.microCoupe()?'micro_coupe':'conversation_ecoute';
        if(['refuse','erreur_micro','conversation_terminee'].includes(k)){conversationActive=false;confirmationFin=false;etiqueter();majConv();}
      }
      ecrireEtat(k);
    }});
  // Les voix de Chrome arrivent après le chargement : les demander tôt évite un premier essai sans voix.
  try{window.speechSynthesis?.getVoices();}catch{}

  /** Parole d'OG : jamais dans une autre langue que celle du texte ; voix du genre choisi si elle existe. */
  function dire(texte,langueTexte,suite){
    const r=moteur.parler(texte,langueTexte==='en'||String(langueTexte).startsWith('en')?'en-CA':'fr-CA',{autorise:autorise()||!!suite?.forcer,consentement:consentement(),apresLecture:suite?.apres||(()=>{}),
      debutLecture:()=>{const m=moteur.mesures();if(m.derniere_latence_ms!=null){$('#ov-latence').textContent=lib('latence',{s:(m.derniere_latence_ms/1000).toLocaleString(L()==='en'?'en-CA':'fr-CA',{maximumFractionDigits:1})});
        (window.ArrimoOgVocalMesures=window.ArrimoOgVocalMesures||[]).push({date:new Date().toISOString(),latence_ms:m.derniere_latence_ms,premier_son_ms:m.premier_son_ms});if(window.ArrimoOgVocalMesures.length>20)window.ArrimoOgVocalMesures.shift();}}});
    if(r&&r.voix&&r.genreRespecte===false&&window.ArrimoOgVoix)$('#ov-latence').textContent=lib('voix_genre');
    return r;
  }

  /* ---- Conversation continue ---- */
  function majConv(){
    $('#ov-conv').hidden=!conversationActive;if(!conversationActive){$('#ov-direct').textContent='';}
    majMicro();majLangueConv();
  }
  function majMicro(){const coupe=moteur.microCoupe();const b=$('#ov-micro');b.textContent=lib(coupe?'reactiver':'couper');b.setAttribute('aria-pressed',String(coupe));}
  function majLangueConv(){const l=langueConversation();document.querySelectorAll('[data-ov-langue]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.ovLangue===l)));}
  function changerLangueSession(){if(conversationActive)moteur.relancer();}
  function terminerConversation(direAuRevoir){
    if(!conversationActive)return;conversationActive=false;confirmationFin=false;clearTimeout(garde);
    const l=langueConversation();
    moteur.terminerConversation('conversation_terminee');   // micro réellement fermé avant tout
    etiqueter();majConv();
    if(direAuRevoir)dire(lib('au_revoir').replace(/.*/,libEn(l,'au_revoir')),l,{forcer:true});
    ecrireEtat('conversation_terminee');
    if(panneau.open&&!champ.disabled)champ.focus();
  }
  function soumettre(texte){
    if($('#og-envoyer')?.disabled){ecrireEtat('occupe');return;}
    champ.value=texte;champ.dataset.source='voix';$('#ov-direct').textContent='';
    moteur.occuper(true);clearTimeout(garde);
    // Garde-fou : sans réponse après 45 s, l'écoute reprend (la question reste affichée avec son erreur éventuelle).
    garde=setTimeout(()=>{moteur.occuper(false);if(conversationActive)ecrireEtat('conversation_ecoute');},45000);
    $('#og-form')?.requestSubmit();
  }
  function phrase(texte){
    if(!conversationActive||!autorise())return;
    const V=window.ArrimoOgVocal,l=langueConversation();
    if(confirmationFin){
      const r=V.reponseConfirmation(texte);confirmationFin=false;
      if(r==='oui'){terminerConversation(true);return;}
      if(r==='non'){dire(libEn(l,'on_continue'),l);return;}
    }
    const intention=V.intentionFin(texte);
    if(intention==='fin'){terminerConversation(true);return;}
    if(intention==='ambigu'){confirmationFin=true;ecrireEtat('confirmation');dire(libEn(l,'confirmer_fin'),l);return;}
    if(intention==='politesse'){const lq=window.ArrimoOgLangue?.detecter(texte)||l;dire(libEn(lq,'de_rien'),lq);return;}
    // « Parle en anglais » : la conversation passe tout de suite en anglais (micro et réponses), et la préférence est retenue.
    const demandee=window.ArrimoOgLangue?.demandee(texte);
    if(demandee&&demandee!==langueConversation()){ecrirePrefs({langue:demandee},{silencieux:true});$('#ov-latence').textContent=libEn(demandee,`langue_changee_${demandee}`);}
    soumettre(texte);
  }
  function demarrerConversation(){
    if(!autorise())return false;
    // Premier son dans le geste de l'utilisateur : débloque la lecture (Safari, iPhone) et confirme l'ouverture.
    const l=langueConversation();dire(libEn(l,'bonjour'),l);
    return moteur.ecouterConversation({autorise:autorise(),consentement:consentement(),phrase,
      parole:texte=>{$('#ov-direct').textContent=texte;},
      interruption:()=>{$('#ov-direct').textContent='';}});
  }
  function exigerConsentement(){if(consentement())return true;majActivation(true);ecrireEtat('consentement');return false;}
  function dicter(){if(!exigerConsentement())return;terminerConversation(false);window.ArrimoOgMessageVocal?.annuler?.();moteur.ecouter({autorise:autorise(),consentement:true});}
  function basculerConversation(){
    if(conversationActive){terminerConversation(false);return;}
    if(!exigerConsentement())return;
    window.ArrimoOgMessageVocal?.annuler?.();
    conversationActive=true;confirmationFin=false;etiqueter();majConv();
    if(!demarrerConversation()){conversationActive=false;etiqueter();majConv();}
  }
  $('#ov-stop').onclick=()=>{terminerConversation(false);window.ArrimoOgMessageVocal?.annuler?.();moteur.reinitialiser();ecrireEtat('pret');};
  $('#ov-terminer').onclick=()=>terminerConversation(true);
  $('#ov-micro').onclick=()=>{if(!conversationActive)return;moteur.couperMicro(!moteur.microCoupe());majMicro();};
  document.querySelectorAll('[data-ov-langue]').forEach(b=>{b.onclick=()=>{ecrirePrefs({langue:b.dataset.ovLangue});$('#ov-latence').textContent=libEn(b.dataset.ovLangue,`langue_changee_${b.dataset.ovLangue}`);};});
  $('#ov-lire').onclick=()=>{if(derniere)dire(derniere.texte,derniere.langue);};
  $('#ov-parametres').onclick=()=>{panneau.close?.();window.dispatchEvent(new CustomEvent('arrimo:ouvrir-parametres',{detail:'params:og'}));};
  // Saisie au clavier : le soignant reprend la main, la conversation s'arrête.
  champ.addEventListener('keydown',e=>{if(e.isTrusted&&e.key.length===1)terminerConversation(false);});
  function reinitialiser(){terminerConversation(false);window.ArrimoOgMessageVocal?.annuler?.();moteur.reinitialiser();derniere=null;$('#ov-lire').disabled=true;$('#ov-latence').textContent='';dernierEtat='pret';traduire();}
  panneau.addEventListener('close',reinitialiser);window.addEventListener('arrimo:session-reset',reinitialiser);
  // Onglet masqué : le micro est coupé (jamais d'écoute en arrière-plan) ; il reprend au retour si c'était la seule raison.
  document.addEventListener('visibilitychange',()=>{
    if(!conversationActive)return;
    if(document.hidden){if(!moteur.microCoupe()){coupeParMasquage=true;moteur.couperMicro(true);majMicro();}}
    else if(coupeParMasquage){coupeParMasquage=false;moteur.couperMicro(false);majMicro();}
  });
  window.addEventListener('offline',()=>{if(conversationActive)ecrireEtat('hors_ligne');});
  window.addEventListener('online',()=>{if(conversationActive&&!moteur.microCoupe())moteur.relancer();});
  window.addEventListener('arrimo:og-interaction-manuelle',()=>{moteur.occuper(false);terminerConversation(false);});
  window.addEventListener('arrimo:og-echec',()=>{clearTimeout(garde);moteur.occuper(false);if(conversationActive)ecrireEtat('conversation_ecoute');});
  window.addEventListener('arrimo:og-reponse',e=>{
    clearTimeout(garde);moteur.occuper(false);
    if(!autorise())return;derniere={texte:e.detail.texte,langue:e.detail.langue==='en'?'en':'fr',sensible:!!e.detail.sensible};$('#ov-lire').disabled=false;
    if(conversationActive){
      // Le micro reste ouvert pendant la lecture : parler interrompt la réponse.
      if(derniere.sensible)ecrireEtat('sensible');else dire(derniere.texte,derniere.langue);
    } else if(lirePrefs().automatique&&!derniere.sensible&&e.detail.voix)dire(derniere.texte,derniere.langue);
  });
  window.addEventListener('arrimo:og-voix-enregistree',e=>{if(typeof toast==='function')toast(lib(e.detail.ok?'enregistre':'enregistre_erreur'),!e.detail.ok);});

  // Trois boutons à icône à côté du champ : dictée, message vocal, conversation. Le libellé complet est dans l'infobulle.
  const rangee=document.querySelector('#og-form .ligne'),envoi=document.querySelector('#og-envoyer');
  const raccourci=(id,icone,action)=>{const b=document.createElement('button');b.type='button';b.id=id;b.className='btn og-vocal-bouton';b.hidden=true;
    b.innerHTML=`<svg class="ic" aria-hidden="true" focusable="false"><use href="icones.svg#${icone}"/></svg>`;b.onclick=action;rangee?.insertBefore(b,envoi);return b;};
  const boutonDictee=raccourci('og-dicter','i-mic',dicter);
  const boutonMessage=raccourci('og-message','i-voicemail',()=>{if(!exigerConsentement())return;terminerConversation(false);moteur.reinitialiser();window.ArrimoOgMessageVocal?.basculer?.();});
  const boutonConversation=raccourci('og-converser','i-audio-lines',basculerConversation);
  function etiqueter(){
    boutonDictee.setAttribute('aria-label',lib('micro'));boutonDictee.title=lib('micro');
    const m=window.ArrimoOgMessageVocal?.libelle?.()||'';boutonMessage.setAttribute('aria-label',m);boutonMessage.title=m;
    const conv=lib(conversationActive?'conversation_stop':'conversation');boutonConversation.setAttribute('aria-label',conv);boutonConversation.title=conv;
    boutonConversation.setAttribute('aria-pressed',String(conversationActive));boutonConversation.classList.toggle('actif',conversationActive);
  }
  function majActivation(montrer){const sans=!consentement();$('#ov-activer').hidden=!(sans&&(montrer||!$('#ov-activer').hidden));}
  // Fonctions vocales selon la licence SH et les réglages de l'établissement (Paramètres → OG).
  const afficherBoutons=()=>{const visible=!section.hidden;
    boutonDictee.hidden=!visible||effectif.dictee===false;boutonMessage.hidden=!visible||effectif.dictee===false||!window.ArrimoOgMessageVocal?.disponible?.();
    boutonConversation.hidden=!visible||effectif.conversation===false;etiqueter();};
  window.addEventListener('arrimo:og-message-pret',()=>afficherBoutons());
  window.addEventListener('arrimo:og-effectif',e=>{effectif=e.detail||effectif;if(effectif.conversation===false)terminerConversation(false);afficherBoutons();});
  new MutationObserver(afficherBoutons).observe(section,{attributes:true,attributeFilter:['hidden']});
  traduire();void fetch('/api/public').then(r=>r.json()).then(p=>{demo=p.og_vocal===true||p.og_vocal_fictif===true||p.demo===true;fictif=p.og_vocal_fictif===true||p.demo===true;section.hidden=!demo;traduire();afficherBoutons();}).catch(()=>{});
  window.addEventListener('arrimo:langue',()=>{traduire();if(lirePrefs().langue==='auto')changerLangueSession();});
  window.addEventListener('arrimo:og-nom',traduire);
  window.ArrimoOgVocalUI={etat:()=>dernierEtat,conversationActive:()=>conversationActive,dire,lib,libEn,autorise,consentement,exigerConsentement,section};
})();
