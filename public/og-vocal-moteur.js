/* Moteur vocal d'OG : reconnaissance et synthèse du navigateur (Web Speech), sans service externe ajouté par Arrimo.
   États explicites, un seul tour de parole à la fois, interruption (barge-in), écho ignoré, relance mesurée.
   Utilisé par public/og-vocal.js et testé hors navigateur (tests/og-vocal.test.cjs). */
(function(root){
  // Mots significatifs d'une phrase (minuscules, sans accents ni ponctuation) : sert à reconnaître l'écho de la voix d'OG.
  const mots=t=>String(t||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]+/g,' ').split(/\s+/).filter(m=>m.length>2);
  const norm=t=>String(t||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’`]/g,"'").replace(/[^a-z0-9' ]+/g,' ').replace(/\s+/g,' ').trim();
  const INACTIVITE_MS=180000;     // conversation close after 3 minutes without speech
  const RELANCE_MAX_MS=4000;      // relance de la reconnaissance : 250 ms, puis délai croissant si elle échoue en boucle
  // « Stop », « arrête », « silence » pendant que l'assistant parle : il se tait et écoute (sans fermer la conversation).
  const ORDRE_SILENCE=/^(?:stop|stoppe|arrete(?:z)?|silence|tais toi|attends|attendez|wait|hold on|be quiet|pause)\b/;

  /** Langue BCP 47 normalisée (« en_US » sur Android → « en-us »). */
  const codeLangue=l=>String(l||'').replace('_','-').toLowerCase();
  // Les navigateurs n'exposent pas le genre des voix : le nom sert d'indice (voix macOS/iOS, Windows, Google, Android).
  const MASCULIN=/\b(?:male|homme|masculin|man)\b|thomas|daniel|nicolas|paul|antoine|jean|claude|henri|felix|félix|guy|liam|david|mark|alex|aaron|arthur|fred|oliver|james|rishi|tom|eddy|reed|rocko|grandpa|jacques|louis|mathieu|gabriel|remy|rémy|andrew|brian|christopher|eric|roger|steffan|william/i;
  const FEMININ=/\b(?:female|femme|feminin|féminin|woman)\b|amelie|amélie|marie|julie|hortense|denise|sylvie|caroline|chantal|aurelie|aurélie|audrey|virginie|celine|céline|josephine|eloise|samantha|karen|moira|tessa|victoria|allison|ava|susan|zira|aria|jenny|clara|emma|serena|fiona|kate|nicky|joelle|joëlle|sara|zoe|zoé|flo|sandy|shelley|grandma|libby|michelle|natasha|sonia/i;
  // Voix plus naturelles quand le navigateur en propose ; voix « fantaisie » de macOS jamais choisies d'office.
  const NATUREL=/natural|neural|premium|enhanced|améliorée|amelioree|online|google|siri/i;
  const FANTAISIE=/albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley/i;

  /**
   * Voix compatible avec la langue demandée, au genre souhaité si possible.
   * Ne renvoie jamais une voix d'une autre langue : sans voix compatible, `voix` vaut null (message explicite à afficher).
   */
  function choisirVoix(liste,langue,genre){
    const l=codeLangue(langue),base=l.slice(0,2);
    const compatibles=(liste||[]).filter(v=>codeLangue(v.lang).slice(0,2)===base);
    if(!compatibles.length)return{voix:null,genreRespecte:false,compatibles:0};
    const motif=genre==='masculine'?MASCULIN:genre==='feminine'?FEMININ:null,oppose=genre==='masculine'?FEMININ:genre==='feminine'?MASCULIN:null;
    const score=v=>{const n=String(v.name||'');let s=0;
      if(codeLangue(v.lang)===l)s+=3;else if(base==='fr'&&codeLangue(v.lang)==='fr-fr')s+=2;else if(base==='en'&&['en-us','en-gb'].includes(codeLangue(v.lang)))s+=2;
      if(motif&&motif.test(n))s+=6;else if(oppose&&oppose.test(n))s-=4;
      if(NATUREL.test(n))s+=2;if(FANTAISIE.test(n))s-=10;if(v.localService)s+=1;if(v.default)s+=0.5;return s;};
    const voix=compatibles.map((v,i)=>({v,s:score(v),i})).sort((a,b)=>b.s-a.s||a.i-b.i)[0].v;
    return{voix,genreRespecte:!motif||motif.test(String(voix.name||'')),compatibles:compatibles.length};
  }

  function creer({Recognition,synthese,Utterance,langue=()=> 'fr-CA',transcription=()=>{},etat=()=>{},finTourMs=800,genre=()=>null,volume=()=>1}){
    let reconnaissance=null,generation=0,minuteur=null,lecture=0,texteLu='',finLecture=0,derniereActivite=0;
    let conversation=null; // { revision, phrase, interruption, parole, muet, occupe, tampon, minuteurTour, echecs, relance }
    const mesures={fin_parole:null,envoi:null,reponse:null,debut_lecture:null,derniere_latence_ms:null,premier_son_ms:null};
    const enLecture=()=>!!(synthese&&synthese.speaking)||Date.now()-finLecture<1200;
    /** Vrai si la phrase entendue reprend surtout ce qu'OG est en train de lire (haut-parleur capté par le micro). */
    function estEcho(texte){
      const m=mots(texte);if(!m.length)return true;if(!texteLu)return false;
      const ref=new Set(mots(texteLu));return m.filter(x=>ref.has(x)).length/m.length>=0.6;
    }
    function fermerReconnaissance(){const r=reconnaissance;reconnaissance=null;if(r)try{r.abort();}catch{}}
    function arreter(){
      generation++;clearTimeout(minuteur);
      if(conversation){clearTimeout(conversation.minuteurTour);clearTimeout(conversation.relance);conversation=null;}
      fermerReconnaissance();etat('pret');
    }
    function interrompre(){lecture++;texteLu='';if(synthese)try{synthese.cancel();}catch{}}

    /* ---------- Dictée ponctuelle : le texte reconnu va dans le champ, à vérifier avant l'envoi ---------- */
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
        etat(['not-allowed','service-not-allowed'].includes(e.error)?'refuse':e.error==='no-speech'?'sans_voix':e.error==='network'?'reseau':'erreur_micro');};
      r.onend=()=>{if(revision!==generation)return;clearTimeout(minuteur);reconnaissance=null;etat('verifier');};
      try{r.start();minuteur=setTimeout(arreter,30000);return true;}catch{reconnaissance=null;etat('erreur_micro');return false;}
    }

    /* ---------- Conversation continue ----------
       Un tour = des segments finaux successifs, envoyés ensemble après `finTourMs` sans nouvelle parole (fin de tour).
       Le micro reste ouvert pendant la lecture pour permettre l'interruption ; l'écho de la voix d'OG est filtré.
       La reconnaissance du navigateur s'arrête seule après un silence : elle est relancée (délai croissant si elle échoue en boucle). */
    function envoyerTour(c){
      clearTimeout(c.minuteurTour);const texte=c.tampon.join(' ').replace(/\s+/g,' ').trim().slice(0,500);c.tampon=[];
      if(!texte||conversation!==c)return;
      mesures.fin_parole=Date.now();
      c.phrase(texte);
    }
    function demarrerReconnaissance(c){
      if(conversation!==c||c.muet)return;
      const r=new Recognition();reconnaissance=r;const debut=Date.now();let entendu=false,silence=false;
      r.lang=langue();r.continuous=true;r.interimResults=true;r.maxAlternatives=1;
      r.onstart=()=>{if(conversation===c&&reconnaissance===r){if(!enLecture()&&!c.occupe)etat('conversation_ecoute');c.reconnexion=false;}};
      r.onspeechstart=()=>{if(conversation===c&&reconnaissance===r&&!enLecture()&&!c.occupe)etat('parole');};
      r.onresult=e=>{
        if(conversation!==c||reconnaissance!==r)return;
        let interim='';
        for(let i=e.resultIndex||0;i<e.results.length;i++){
          const texte=String(e.results[i][0]?.transcript||'').trim();
          if(!texte||(enLecture()&&estEcho(texte)))continue;
          entendu=true;derniereActivite=Date.now();c.echecs=0;
          if(!e.results[i].isFinal){
            interim+=(interim?' ':'')+texte;
            // Le soignant reprend la parole pendant la lecture (deux mots, ou un ordre « stop ») : OG se tait et écoute.
            if(synthese&&synthese.speaking&&(mots(texte).length>=2||ORDRE_SILENCE.test(norm(texte)))){interrompre();etat('interrompu');c.interruption();}
            continue;
          }
          if(synthese&&synthese.speaking){interrompre();etat('interrompu');c.interruption();}
          if(ORDRE_SILENCE.test(norm(texte))&&mots(texte).length<=2)continue; // simple ordre de silence : rien à envoyer
          c.tampon.push(texte.slice(0,500));
        }
        if(interim){c.parole(interim);if(!c.occupe)etat('parole');clearTimeout(c.minuteurTour);
          if(c.tampon.length)c.minuteurTour=setTimeout(()=>envoyerTour(c),finTourMs+600);}
        else if(c.tampon.length){c.parole(c.tampon.join(' '));clearTimeout(c.minuteurTour);
          if(finTourMs<=0)envoyerTour(c);else c.minuteurTour=setTimeout(()=>envoyerTour(c),finTourMs);}
      };
      r.onerror=e=>{
        if(conversation!==c||reconnaissance!==r)return;
        if(['not-allowed','service-not-allowed','audio-capture'].includes(e.error)){
          const k=e.error==='audio-capture'?'erreur_micro':'refuse';terminerConversation(k);return;
        }
        if(e.error==='network'){c.reconnexion=true;etat('reconnexion');}
        if(e.error==='no-speech')silence=true;   // silence normal : pas un échec
        // « no-speech », « aborted » : onend relance l'écoute.
      };
      r.onend=()=>{
        if(conversation!==c||reconnaissance!==r)return;reconnaissance=null;
        if(c.tampon.length)envoyerTour(c);
        if(Date.now()-derniereActivite>INACTIVITE_MS){terminerConversation('conversation_terminee');return;}
        // Coupure rapide sans parole : le navigateur refuse ou le réseau manque ; on espace les relances (pas de boucle serrée).
        c.echecs=(!entendu&&!silence&&Date.now()-debut<1500)?c.echecs+1:0;
        const delai=c.echecs?Math.min(RELANCE_MAX_MS,250*2**c.echecs):250;
        if(c.echecs>=4){c.reconnexion=true;etat('reconnexion');}
        c.relance=setTimeout(()=>{if(conversation===c&&!c.muet&&!reconnaissance)demarrerReconnaissance(c);},delai);
      };
      try{r.start();}catch{reconnaissance=null;c.echecs++;c.relance=setTimeout(()=>demarrerReconnaissance(c),Math.min(RELANCE_MAX_MS,500*c.echecs));}
    }
    function terminerConversation(k){
      if(!conversation)return;const c=conversation;
      clearTimeout(c.minuteurTour);clearTimeout(c.relance);conversation=null;generation++;fermerReconnaissance();etat(k||'conversation_terminee');
    }
    function ecouterConversation({autorise,consentement,phrase=()=>{},interruption=()=>{},parole=()=>{}}){
      if(!autorise||!consentement){etat('consentement');return false;}
      if(!Recognition){etat('micro_indisponible');return false;}
      arreter();interrompre();generation++;derniereActivite=Date.now();
      conversation={phrase,interruption,parole,muet:false,occupe:false,tampon:[],minuteurTour:null,relance:null,echecs:0,reconnexion:false};
      etat('connexion');demarrerReconnaissance(conversation);
      return true;
    }
    /** Micro coupé : plus aucune écoute (indicateur du navigateur éteint), la conversation reste ouverte. */
    function couperMicro(muet){
      const c=conversation;if(!c)return false;c.muet=!!muet;clearTimeout(c.relance);
      if(c.muet){clearTimeout(c.minuteurTour);c.tampon=[];fermerReconnaissance();etat('micro_coupe');}
      else{derniereActivite=Date.now();etat('connexion');if(!reconnaissance)demarrerReconnaissance(c);}
      return true;
    }
    /** Nouvelle langue ou reprise après une coupure réseau : la reconnaissance repart tout de suite, sans fermer la conversation. */
    function relancer(){const c=conversation;if(!c||c.muet)return false;clearTimeout(c.relance);c.echecs=0;fermerReconnaissance();demarrerReconnaissance(c);return true;}
    /** Pendant le traitement d'une question, les nouvelles phrases ne déclenchent pas de seconde réponse. */
    function occuper(v){if(conversation){conversation.occupe=!!v;if(v){mesures.envoi=Date.now();etat('traitement');}}}
    const conversationActive=()=>!!conversation;
    const microCoupe=()=>!!conversation?.muet;

    function parler(texte,langueReponse,{autorise,consentement,apresLecture=()=>{},debutLecture=()=>{}}){
      if(!autorise||!consentement){etat('consentement');return false;}
      if(!synthese||!Utterance){etat('audio_indisponible');return false;}
      // Toute lecture précédente est annulée avant la nouvelle (jamais l'ancienne voix ni l'ancien texte).
      interrompre();const revision=lecture;
      const liste=synthese.getVoices?.()||[];
      if(!liste.length&&typeof synthese.addEventListener==='function'){
        // Chrome charge ses voix après coup : on attend leur arrivée (au plus 1,5 s) au lieu de lire avec une voix au hasard.
        let fait=false;const reprendre=()=>{if(fait)return;fait=true;synthese.removeEventListener?.('voiceschanged',reprendre);
          if(revision!==lecture)return;if(!(synthese.getVoices?.()||[]).length){etat('voix_indisponible');apresLecture();return;}
          parler(texte,langueReponse,{autorise,consentement,apresLecture,debutLecture});};
        synthese.addEventListener('voiceschanged',reprendre);setTimeout(reprendre,1500);return true;
      }
      const choix=choisirVoix(liste,langueReponse,genre());
      if(!choix.voix){etat(String(langueReponse).startsWith('en')?'voix_indisponible_en':'voix_indisponible_fr');apresLecture();return false;}
      const morceaux=String(texte).match(/[^.!?;\n]{1,220}(?:[.!?;\n]+|$)|\S{1,220}/g)?.map(x=>x.trim()).filter(Boolean)||[];
      texteLu=String(texte);derniereActivite=Date.now();const v=Math.max(0.2,Math.min(1,Number(volume())||1));
      const t0=Date.now();
      morceaux.forEach((m,i)=>{
        const u=new Utterance(m);u.lang=choix.voix.lang||langueReponse;u.voice=choix.voix;u.volume=v;u.rate=1;u.pitch=1;
        u.onstart=()=>{if(revision!==lecture)return;if(i===0){mesures.debut_lecture=Date.now();mesures.premier_son_ms=mesures.debut_lecture-t0;
          if(mesures.fin_parole)mesures.derniere_latence_ms=mesures.debut_lecture-mesures.fin_parole;debutLecture();}etat('lecture');};
        u.onend=()=>{if(revision===lecture&&i===morceaux.length-1){finLecture=Date.now();derniereActivite=finLecture;texteLu='';mesures.fin_parole=null;etat('pret');apresLecture();}};
        u.onerror=e=>{if(revision!==lecture||e?.error==='interrupted'||e?.error==='canceled')return;interrompre();etat('erreur_audio');apresLecture();};
        synthese.speak(u);
      });
      // Safari peut laisser la synthèse en pause après une interruption : on la relance.
      try{if(synthese.paused)synthese.resume();}catch{}
      return{voix:choix.voix,genreRespecte:choix.genreRespecte};
    }
    return {ecouter,ecouterConversation,terminerConversation,couperMicro,relancer,occuper,conversationActive,microCoupe,arreter,interrompre,parler,enLecture,estEcho,
      mesures:()=>({...mesures}),reinitialiser(){terminerConversation('pret');arreter();interrompre();}};
  }

  /* ---------- Fin de conversation à la voix ----------
     « fin » : intention claire (« on a fini », « termine la conversation », « end the conversation », « stop the voice chat ») ;
     « ambigu » : peut vouloir dire autre chose (« au revoir », « c'est tout ? », « bye ») → confirmation demandée ;
     « merci » seul, une pause ou un silence ne ferment jamais la conversation. */
  const FIN_CLAIRE=[
    /^(?:ok |bon |alors |bien )?(?:on a|j ai|nous avons|j ai bien|on a bien) (?:fini|termine)(?: pour (?:aujourd hui|l instant|moi|cette fois))?$/,/^(?:ok |bon |alors )?c est (?:fini|termine)(?: pour (?:aujourd hui|l instant|moi))?$/,
    /\b(?:termine|terminer|termines|terminez|arrete|arreter|arretez|ferme|fermer|fermez|coupe|couper|finis|finir|quitte|quitter|stoppe|stopper)\s+(?:la |cette |notre )?(?:conversation|discussion|session|conversation vocale|session vocale)\b/,
    /\bfin de (?:la |notre )?(?:conversation|discussion|session)\b/,/\bje n ?ai plus (?:de |d autres? )?questions?\b/,/\bj ai plus (?:de |d autres? )?questions?\b/,/\bplus de questions?\b/,
    /\b(?:end|stop|close|finish|quit|terminate)\s+(?:the |this |our )?(?:conversation|voice chat|voice conversation|chat|session|voice session)\b/,
    /^(?:ok |okay |so )?we (?:are|re) (?:done|finished)(?: for (?:now|today))?$/,/^(?:ok |okay |so )?i (?:am|m) (?:done|finished)(?: for (?:now|today))?$/,/\bno (?:more|other|further) questions?\b/,/^that s all(?: for (?:now|today))?$/,/^(?:merci |ok |bon )?c est tout(?: pour (?:moi|aujourd hui|l instant))?(?: merci)?$/,
  ];
  const FIN_AMBIGUE=[/^(?:au revoir|bye|bye bye|goodbye|good bye|a plus|a bientot|salut|ciao|bonne journee|have a good day)$/,/^(?:stop|arrete|fini|termine|c est tout|that s it|ok c est bon|c est bon)$/];
  const POLITESSE=/^(?:merci(?: beaucoup| bien)?|thanks?(?: you)?(?: very much| a lot)?|ok(?:ay)?|d accord|parfait|super|tres bien|great|perfect|alright|all right)$/;
  const OUI=/^(?:oui|ouais|yes|yeah|yep|sure|absolument|exactement|oui merci|yes please|oui termine|oui on a fini|confirm(?:e|er)?|c est ca|tout a fait|correct)\b/;
  const NON=/^(?:non|no|nope|pas encore|not yet|continue|continuons|on continue|keep going|attends|wait)\b/;
  function intentionFin(texte){
    const n=norm(texte).replace(/'/g,' ').replace(/\s+/g,' ').trim();
    if(!n)return null;
    const sansPolitesse=n.replace(/^(?:merci|thanks|thank you|ok|okay|bon|alors|tres bien|parfait)\s+/,'').replace(/\s+(?:merci|thanks|thank you)$/,'').trim();
    if(FIN_CLAIRE.some(r=>r.test(n)||r.test(sansPolitesse)))return'fin';
    if(FIN_AMBIGUE.some(r=>r.test(sansPolitesse)))return'ambigu';
    if(POLITESSE.test(n))return'politesse';
    return null;
  }
  const reponseConfirmation=texte=>{const n=norm(texte).replace(/'/g,' ');return OUI.test(n)?'oui':NON.test(n)?'non':null;};
  const api={creer,choisirVoix,intentionFin,reponseConfirmation};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ArrimoOgVocal=api;
})(typeof window==='undefined'?globalThis:window);
