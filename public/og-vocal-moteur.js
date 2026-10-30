(function(root){
  // Mots significatifs d'une phrase (minuscules, sans accents ni ponctuation) : sert à reconnaître l'écho de la voix d'OG.
  const mots=t=>String(t||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]+/g,' ').split(/\s+/).filter(m=>m.length>2);
  const INACTIVITE_MS=180000;   // conversation close after 3 minutes without speech
  function creer({Recognition,synthese,Utterance,langue=()=> 'fr-CA',transcription=()=>{},etat=()=>{}}){
    let reconnaissance=null,generation=0,minuteur=null,lecture=0,texteLu='',finLecture=0,derniereActivite=0;
    const enLecture=()=>!!(synthese&&synthese.speaking)||Date.now()-finLecture<1200;
    /** Vrai si la phrase entendue reprend surtout ce qu'OG est en train de lire (haut-parleur capté par le micro). */
    function estEcho(texte){
      const m=mots(texte);if(!m.length)return true;if(!texteLu)return false;
      const ref=new Set(mots(texteLu));return m.filter(x=>ref.has(x)).length/m.length>=0.6;
    }
    function arreter(){
      generation++;clearTimeout(minuteur);const r=reconnaissance;reconnaissance=null;
      if(r)try{r.abort();}catch{}etat('pret');
    }
    function interrompre(){lecture++;texteLu='';if(synthese)synthese.cancel();etat('pret');}
    function ecouter({autorise,consentement}){
      if(!autorise||!consentement){etat('consentement');return false;}
      if(!Recognition){etat('micro_indisponible');return false;}
      arreter();interrompre();const revision=++generation;
      const r=new Recognition();reconnaissance=r;
      r.lang=langue();r.continuous=false;r.interimResults=true;r.maxAlternatives=1;
      r.onstart=()=>{if(revision===generation)etat('ecoute');};
      r.onresult=e=>{
        if(revision!==generation)return;
        const texte=Array.from(e.results).map(x=>x[0]?.transcript||'').join(' ').trim();
        transcription(texte.slice(0,500));
      };
      r.onerror=e=>{if(revision!==generation)return;generation++;clearTimeout(minuteur);reconnaissance=null;
        etat(['not-allowed','service-not-allowed'].includes(e.error)?'refuse':e.error==='no-speech'?'sans_voix':'erreur_micro');};
      r.onend=()=>{if(revision!==generation)return;clearTimeout(minuteur);reconnaissance=null;etat('verifier');};
      try{r.start();minuteur=setTimeout(arreter,30000);return true;}catch{reconnaissance=null;etat('erreur_micro');return false;}
    }
    /**
     * Conversation continue : le micro reste ouvert et redémarre seul (les navigateurs le coupent après un silence),
     * jusqu'à l'arrêt explicite ou trois minutes sans parole. Pendant qu'OG parle, une vraie prise de parole
     * (pas l'écho de sa propre voix) interrompt la lecture. Seuls les segments finaux sont transmis à `phrase`.
     */
    function ecouterConversation({autorise,consentement,phrase=()=>{},interruption=()=>{}}){
      if(!autorise||!consentement){etat('consentement');return false;}
      if(!Recognition){etat('micro_indisponible');return false;}
      arreter();interrompre();const revision=++generation;derniereActivite=Date.now();
      const demarrer=()=>{
        if(revision!==generation)return;
        const r=new Recognition();reconnaissance=r;
        r.lang=langue();r.continuous=true;r.interimResults=true;r.maxAlternatives=1;
        r.onstart=()=>{if(revision===generation&&!enLecture())etat('conversation_ecoute');};
        r.onresult=e=>{
          if(revision!==generation)return;
          const phrases=[];
          for(let i=e.resultIndex||0;i<e.results.length;i++){
            const texte=String(e.results[i][0]?.transcript||'').trim();
            if(!texte||(enLecture()&&estEcho(texte)))continue;
            derniereActivite=Date.now();
            if(!e.results[i].isFinal){
              // Le soignant reprend la parole pendant la lecture : OG se tait et écoute.
              if(synthese&&synthese.speaking&&mots(texte).length>=2){interrompre();etat('conversation_ecoute');interruption();}
              continue;
            }
            phrases.push(texte.slice(0,500));
          }
          if(phrases.length)phrase(phrases.join(' ').slice(0,500));
        };
        r.onerror=e=>{
          if(revision!==generation)return;
          if(['not-allowed','service-not-allowed','audio-capture'].includes(e.error)){
            generation++;clearTimeout(minuteur);reconnaissance=null;etat(e.error==='audio-capture'?'erreur_micro':'refuse');
          }
          // « no-speech », « aborted », « network » : onend relance l'écoute.
        };
        r.onend=()=>{
          if(revision!==generation)return;reconnaissance=null;
          if(Date.now()-derniereActivite>INACTIVITE_MS){generation++;clearTimeout(minuteur);etat('conversation_terminee');return;}
          setTimeout(demarrer,250);
        };
        try{r.start();}catch{reconnaissance=null;setTimeout(demarrer,500);}
      };
      demarrer();
      return true;
    }
    function parler(texte,langueReponse,{autorise,consentement,apresLecture=()=>{}}){
      if(!autorise||!consentement){etat('consentement');return false;}
      if(!synthese||!Utterance){etat('audio_indisponible');return false;}
      interrompre();const revision=lecture;
      const voix=synthese.getVoices().filter(v=>v.lang?.slice(0,2)===langueReponse.slice(0,2));
      if(!voix.length){etat('voix_indisponible');return false;}
      // Voix choisie dans Paramètres → OG : les navigateurs n'exposent pas le genre, le nom de la voix sert d'indice.
      const genre=(typeof window!=='undefined'&&window.ArrimoOgVoix)||null;
      const motif=genre==='masculine'?/male|homme|thomas|daniel|paul|nicolas|alex|antoine|jean/i:genre==='feminine'?/female|femme|amelie|amélie|marie|julie|samantha|karen|hortense|audrey|aurelie/i:null;
      const voixChoisie=(motif&&(voix.find(v=>motif.test(v.name)&&v.localService)||voix.find(v=>motif.test(v.name))))||voix.find(v=>v.localService)||voix[0];
      const morceaux=String(texte).match(/.{1,240}(?:\s|$)|\S{1,240}/g)||[];
      texteLu=String(texte);derniereActivite=Date.now();
      morceaux.forEach((texte,i)=>{
        const u=new Utterance(texte);u.lang=langueReponse;u.voice=voixChoisie;
        u.onstart=()=>{if(revision===lecture)etat('lecture');};
        u.onend=()=>{if(revision===lecture&&i===morceaux.length-1){finLecture=Date.now();derniereActivite=finLecture;etat('pret');apresLecture();}};
        u.onerror=()=>{if(revision===lecture){interrompre();etat('erreur_audio');apresLecture();}};
        synthese.speak(u);
      });
      return true;
    }
    return {ecouter,ecouterConversation,arreter,interrompre,parler,enLecture,estEcho,reinitialiser(){arreter();interrompre();}};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={creer};else root.ArrimoOgVocal={creer};
})(typeof window==='undefined'?globalThis:window);
