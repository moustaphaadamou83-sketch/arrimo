(function(root){
  function creer({Recognition,synthese,Utterance,langue=()=> 'fr-CA',transcription=()=>{},etat=()=>{}}){
    let reconnaissance=null,generation=0,minuteur=null,lecture=0;
    function arreter(){
      generation++;clearTimeout(minuteur);const r=reconnaissance;reconnaissance=null;
      if(r)try{r.abort();}catch{}etat('pret');
    }
    function interrompre(){lecture++;if(synthese)synthese.cancel();etat('pret');}
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
    function ecouterConversation({autorise,consentement,phrase=()=>{}}){
      if(!autorise||!consentement){etat('consentement');return false;}
      if(!Recognition){etat('micro_indisponible');return false;}
      arreter();interrompre();const revision=++generation;
      const r=new Recognition();reconnaissance=r;
      r.lang=langue();r.continuous=true;r.interimResults=true;r.maxAlternatives=1;
      r.onstart=()=>{if(revision===generation)etat('conversation_ecoute');};
      r.onresult=e=>{
        if(revision!==generation)return;
        const phrases=[];
        for(let i=e.resultIndex||0;i<e.results.length;i++)if(e.results[i].isFinal){
          const texte=String(e.results[i][0]?.transcript||'').trim();if(texte)phrases.push(texte.slice(0,500));
        }
        if(phrases.length)phrase(phrases.join(' ').slice(0,500));
      };
      r.onerror=e=>{if(revision!==generation)return;generation++;clearTimeout(minuteur);reconnaissance=null;
        etat(['not-allowed','service-not-allowed'].includes(e.error)?'refuse':e.error==='no-speech'?'sans_voix':'erreur_micro');};
      r.onend=()=>{if(revision!==generation)return;clearTimeout(minuteur);reconnaissance=null;etat('conversation_terminee');};
      try{r.start();minuteur=setTimeout(()=>{arreter();etat('conversation_terminee');},300000);return true;}catch{reconnaissance=null;etat('erreur_micro');return false;}
    }
    function parler(texte,langueReponse,{autorise,consentement,apresLecture=()=>{}}){
      if(!autorise||!consentement){etat('consentement');return false;}
      if(!synthese||!Utterance){etat('audio_indisponible');return false;}
      interrompre();const revision=lecture;
      const voix=synthese.getVoices().filter(v=>v.lang?.slice(0,2)===langueReponse.slice(0,2));
      if(!voix.length){etat('voix_indisponible');return false;}
      const voixChoisie=voix.find(v=>v.localService)||voix[0];
      const morceaux=String(texte).match(/.{1,240}(?:\s|$)|\S{1,240}/g)||[];
      morceaux.forEach((texte,i)=>{
        const u=new Utterance(texte);u.lang=langueReponse;u.voice=voixChoisie;
        u.onstart=()=>{if(revision===lecture)etat('lecture');};
        u.onend=()=>{if(revision===lecture&&i===morceaux.length-1){etat('pret');apresLecture();}};
        u.onerror=()=>{if(revision===lecture){interrompre();etat('erreur_audio');apresLecture();}};
        synthese.speak(u);
      });
      return true;
    }
    return {ecouter,ecouterConversation,arreter,interrompre,parler,reinitialiser(){arreter();interrompre();}};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={creer};else root.ArrimoOgVocal={creer};
})(typeof window==='undefined'?globalThis:window);
