/* Message vocal pour l'assistant : enregistrer, réécouter, supprimer ou recommencer, puis envoyer.
   L'audio reste dans la mémoire du navigateur (jamais envoyé à Arrimo, effacé après l'envoi ou la suppression) ;
   la transcription est faite pendant l'enregistrement par la reconnaissance vocale du navigateur, puis affichée,
   corrigeable, et envoyée comme une question écrite (mêmes droits, même moteur). */
(()=>{
  const UI=window.ArrimoOgVocalUI,zone=document.querySelector('#ov-message'),champ=document.querySelector('#og-question');
  if(!UI||!zone)return;
  const FR={libelle:'Message vocal : enregistrer, réécouter, puis envoyer',enregistrer:'Enregistrer',arreter:'Arrêter l’enregistrement',recommencer:'Recommencer',supprimer:'Supprimer',
    envoyer:'Envoyer le message',ecoute:'Réécouter',demande:'Autorisation du micro…',enregistrement:'Enregistrement en cours',pret:'Message enregistré. Réécoutez, corrigez la transcription si besoin, puis envoyez.',
    transcription:'Transcription (modifiable)',transcription_vide:'Aucune transcription : la reconnaissance n’a rien compris ou n’est pas disponible. Écrivez la question, ou recommencez.',
    transcription_indispo:'Transcription non disponible dans ce navigateur : écrivez votre question sous l’enregistrement.',
    silence:'Aucun son capté : vérifiez le micro choisi par le navigateur, puis recommencez.',faible:'Volume faible : parlez plus près du micro pour une meilleure transcription.',
    envoi:'Envoi en cours…',envoye:'Message envoyé : la réponse est affichée.',echec:'Le message n’a pas pu être envoyé. Il est conservé : réessayez.',
    refuse:'Microphone refusé. Autorisez-le dans les réglages du navigateur, ou écrivez votre question.',introuvable:'Aucun micro détecté sur cet appareil.',occupe:'Le micro est utilisé par une autre application.',
    indisponible:'Enregistrement audio non disponible dans ce navigateur.',max:'Durée maximale atteinte (1 minute) : enregistrement arrêté.',niveau:'Niveau du micro',duree:'Durée'};
  const EN={libelle:'Voice message: record, play back, then send',enregistrer:'Record',arreter:'Stop recording',recommencer:'Record again',supprimer:'Delete',
    envoyer:'Send message',ecoute:'Play back',demande:'Requesting microphone access…',enregistrement:'Recording',pret:'Message recorded. Play it back, correct the transcript if needed, then send.',
    transcription:'Transcript (editable)',transcription_vide:'No transcript: speech was not understood or recognition is unavailable. Type the question, or record again.',
    transcription_indispo:'Transcription is not available in this browser: type your question below the recording.',
    silence:'No sound captured: check the microphone selected by the browser, then record again.',faible:'Low volume: speak closer to the microphone for a better transcript.',
    envoi:'Sending…',envoye:'Message sent: the answer is displayed.',echec:'The message could not be sent. It is kept: try again.',
    refuse:'Microphone permission denied. Allow it in your browser settings, or type your question.',introuvable:'No microphone detected on this device.',occupe:'The microphone is used by another application.',
    indisponible:'Audio recording is not available in this browser.',max:'Maximum length reached (1 minute): recording stopped.',niveau:'Microphone level',duree:'Duration'};
  const lib=k=>{const s=(typeof langue!=='undefined'&&langue==='en'?EN:FR)[k]||k;return window.ArrimoNomOg?window.ArrimoNomOg.appliquer(s):s;};
  const MAX_MS=60000;
  const disponible=()=>!!(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder);
  // Un seul enregistrement à la fois ; `revision` invalide tout rappel tardif après annulation.
  let s=null,revision=0;
  const duree=ms=>{const t=Math.floor(ms/1000);return `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;};
  function liberer(){
    if(!s)return;clearInterval(s.minuteur);clearTimeout(s.limite);cancelAnimationFrame(s.anim);
    try{if(s.recorder&&s.recorder.state!=='inactive')s.recorder.stop();}catch{}
    s.flux?.getTracks().forEach(t=>t.stop());s.flux=null;          // micro réellement libéré
    try{s.contexte?.close();}catch{}s.contexte=null;
    try{s.reco?.abort();}catch{}s.reco=null;
  }
  function annuler(){revision++;liberer();if(s?.url)URL.revokeObjectURL(s.url);s=null;zone.hidden=true;zone.replaceChildren();}
  function rendre(){
    if(!s){zone.hidden=true;zone.replaceChildren();return;}
    zone.hidden=false;const en=s.etape;
    const etat=document.createElement('p');etat.className='ovm-etat';etat.setAttribute('role','status');etat.setAttribute('aria-live','polite');
    zone.replaceChildren(etat);
    if(en==='demande'){etat.textContent=lib('demande');return;}
    if(en==='enregistrement'){
      etat.innerHTML=`<span class="ovm-rec" aria-hidden="true"></span> ${lib('enregistrement')} · <span class="num" id="ovm-duree" aria-label="${lib('duree')}">0:00</span>`;
      const niveau=document.createElement('div');niveau.className='ovm-niveau';niveau.setAttribute('role','meter');niveau.setAttribute('aria-label',lib('niveau'));niveau.setAttribute('aria-valuemin','0');niveau.setAttribute('aria-valuemax','100');
      niveau.innerHTML='<i id="ovm-barre"></i>';
      const direct=document.createElement('p');direct.className='ovm-direct';direct.id='ovm-direct';direct.textContent=s.texte;
      const b=bouton(lib('arreter'),'pri',arreter);zone.append(niveau,direct,ligne(b));b.focus();return;
    }
    if(en==='pret'||en==='envoi'||en==='echec'){
      etat.textContent=lib(en==='envoi'?'envoi':en==='echec'?'echec':'pret');
      const audio=document.createElement('audio');audio.controls=true;audio.src=s.url;audio.preload='auto';audio.setAttribute('aria-label',lib('ecoute'));
      const lab=document.createElement('label');lab.className='lbl';lab.htmlFor='ovm-texte';lab.textContent=lib('transcription');
      const texte=document.createElement('textarea');texte.id='ovm-texte';texte.rows=2;texte.maxLength=500;texte.value=s.texte;
      texte.oninput=()=>{s.texte=texte.value;envoi.disabled=!texte.value.trim()||s.etape==='envoi';};
      const notes=[];if(s.avertissement)notes.push(lib(s.avertissement));if(!s.texte.trim())notes.push(lib(s.recoDispo?'transcription_vide':'transcription_indispo'));
      const note=document.createElement('p');note.className='note';note.textContent=notes.join(' ');
      const envoi=bouton(lib('envoyer'),'pri',envoyer);envoi.disabled=!s.texte.trim()||en==='envoi';
      const rec=bouton(lib('recommencer'),'',()=>{annuler();demarrer();});const sup=bouton(lib('supprimer'),'',annuler);
      if(en==='envoi'){rec.disabled=true;sup.disabled=true;texte.disabled=true;}
      zone.append(audio,lab,texte,note,ligne(sup,rec,envoi));
    }
  }
  const bouton=(t,cls,fn)=>{const b=document.createElement('button');b.type='button';b.className=`btn ${cls}`.trim();b.textContent=t;b.onclick=fn;return b;};
  const ligne=(...b)=>{const d=document.createElement('div');d.className='ligne serre';d.append(...b);return d;};

  async function demarrer(){
    if(!UI.autorise()||!UI.exigerConsentement())return;
    if(!disponible()){zone.hidden=false;zone.replaceChildren(Object.assign(document.createElement('p'),{className:'ovm-etat',textContent:lib('indisponible')}));return;}
    annuler();const rev=++revision;s={etape:'demande',texte:'',chunks:[],pic:0,recoDispo:false};rendre();
    let flux;
    try{flux=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});}
    catch(e){if(rev!==revision)return;const k=e?.name==='NotAllowedError'||e?.name==='SecurityError'?'refuse':e?.name==='NotFoundError'?'introuvable':e?.name==='NotReadableError'?'occupe':'indisponible';
      s=null;zone.hidden=false;zone.replaceChildren(Object.assign(document.createElement('p'),{className:'ovm-etat',textContent:lib(k)}));return;}
    if(rev!==revision||!s){flux.getTracks().forEach(t=>t.stop());return;}
    s.flux=flux;
    // Format pris en charge par le navigateur : Opus/WebM (Chrome, Edge, Firefox) ou AAC/MP4 (Safari).
    const type=['audio/webm;codecs=opus','audio/webm','audio/mp4;codecs=mp4a.40.2','audio/mp4'].find(x=>MediaRecorder.isTypeSupported?.(x))||'';
    const rec=new MediaRecorder(flux,type?{mimeType:type,audioBitsPerSecond:64000}:undefined);s.recorder=rec;s.type=rec.mimeType||type||'audio/webm';
    rec.ondataavailable=e=>{if(e.data?.size&&rev===revision&&s)s.chunks.push(e.data);};
    rec.onstop=()=>{if(rev!==revision||!s)return;s.recorderFini=true;finir(rev);};
    // Niveau du micro : affiché en direct, et sert à repérer un enregistrement silencieux ou trop faible.
    try{const C=window.AudioContext||window.webkitAudioContext;if(C){const ctx=new C();s.contexte=ctx;const an=ctx.createAnalyser();an.fftSize=1024;ctx.createMediaStreamSource(flux).connect(an);
      const buf=new Float32Array(an.fftSize);const boucle=()=>{if(rev!==revision||!s||s.etape!=='enregistrement')return;an.getFloatTimeDomainData(buf);let m=0;for(const v of buf)m=Math.max(m,Math.abs(v));
        s.pic=Math.max(s.pic,m);const b=document.querySelector('#ovm-barre');if(b)b.style.width=`${Math.min(100,Math.round(m*140))}%`;s.anim=requestAnimationFrame(boucle);};s.boucle=boucle;}}catch{s.contexte=null;}
    // Transcription en parallèle, dans la langue de conversation.
    const R=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(R){try{const r=new R();s.reco=r;s.recoDispo=true;r.lang=window.ArrimoOgVoixPrefs?.codeMicro?.()||'fr-CA';r.continuous=true;r.interimResults=true;
      const finals=[];r.onresult=e=>{if(rev!==revision||!s)return;let interim='';for(let i=e.resultIndex||0;i<e.results.length;i++){const t=String(e.results[i][0]?.transcript||'').trim();if(!t)continue;if(e.results[i].isFinal)finals.push(t);else interim+=' '+t;}
        s.texte=(finals.join(' ')+interim).replace(/\s+/g,' ').trim().slice(0,500);const d=document.querySelector('#ovm-direct');if(d)d.textContent=s.texte;};
      r.onerror=e=>{if(['not-allowed','service-not-allowed','audio-capture'].includes(e.error)&&s)s.recoDispo=false;};
      r.onend=()=>{if(rev!==revision||!s)return;if(s.etape==='enregistrement'){try{r.start();}catch{}}else{s.recoFinie=true;finir(rev);}};
      r.start();}catch{s.reco=null;s.recoDispo=false;}}
    rec.start(250);s.debut=Date.now();s.etape='enregistrement';rendre();s.boucle?.();
    s.minuteur=setInterval(()=>{const d=document.querySelector('#ovm-duree');if(d&&s)d.textContent=duree(Date.now()-s.debut);},250);
    s.limite=setTimeout(()=>{if(s?.etape==='enregistrement'){s.avertissement='max';arreter();}},MAX_MS);
  }
  function arreter(){
    if(!s||s.etape!=='enregistrement')return;const rev=revision;
    s.etape='fin';s.duree=Date.now()-s.debut;clearInterval(s.minuteur);clearTimeout(s.limite);cancelAnimationFrame(s.anim);
    try{s.recorder.stop();}catch{s.recorderFini=true;}
    s.flux?.getTracks().forEach(t=>t.stop());               // le micro s'éteint dès l'arrêt
    try{s.contexte?.close();}catch{}s.contexte=null;
    // stop() (et non abort()) : la reconnaissance livre la fin de la phrase en cours ; 2,5 s au plus.
    if(s.reco){try{(s.reco.stop||s.reco.abort).call(s.reco);}catch{s.recoFinie=true;}setTimeout(()=>{if(rev===revision&&s&&!s.recoFinie){s.recoFinie=true;finir(rev);}},2500);}else s.recoFinie=true;
    finir(rev);
  }
  function finir(rev){
    if(rev!==revision||!s||s.etape!=='fin'||!s.recorderFini||!s.recoFinie)return;
    try{s.reco?.abort();}catch{}s.reco=null;
    const blob=new Blob(s.chunks,{type:s.type});s.chunks=[];
    s.url=URL.createObjectURL(blob);
    if(!s.avertissement)s.avertissement=s.pic<0.015?'silence':s.pic<0.08?'faible':null;
    s.etape='pret';rendre();document.querySelector('#ovm-texte')?.focus();
  }
  function envoyer(){
    if(!s||!s.texte.trim()||document.querySelector('#og-envoyer')?.disabled)return;
    const rev=revision;s.etape='envoi';rendre();
    // « Envoyé » seulement après la réponse du serveur ; en cas d'échec, le message et sa transcription sont conservés.
    const ok=()=>{nettoyer();if(rev!==revision)return;const url=s?.url;s=null;if(url)URL.revokeObjectURL(url);zone.hidden=false;
      zone.replaceChildren(Object.assign(document.createElement('p'),{className:'ovm-etat',textContent:lib('envoye')}));setTimeout(()=>{if(!s&&rev===revision){zone.hidden=true;zone.replaceChildren();}},4000);};
    const ko=()=>{nettoyer();if(rev!==revision||!s)return;s.etape='echec';rendre();};
    const nettoyer=()=>{window.removeEventListener('arrimo:og-reponse',ok);window.removeEventListener('arrimo:og-echec',ko);};
    window.addEventListener('arrimo:og-reponse',ok,{once:true});window.addEventListener('arrimo:og-echec',ko,{once:true});
    champ.value=s.texte.trim();champ.dataset.source='message_vocal';document.querySelector('#og-form')?.requestSubmit();
  }
  function basculer(){if(s?.etape==='enregistrement'){arreter();return;}if(s&&s.etape!=='envoi'){annuler();return;}demarrer();}
  document.querySelector('#og-panel')?.addEventListener('close',annuler);window.addEventListener('arrimo:session-reset',annuler);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&s?.etape==='enregistrement')arreter();});
  window.addEventListener('arrimo:langue',()=>{if(s&&s.etape!=='enregistrement')rendre();});
  window.ArrimoOgMessageVocal={basculer,annuler,disponible,libelle:()=>lib('libelle'),etat:()=>s?.etape||'inactif'};
  window.dispatchEvent(new Event('arrimo:og-message-pret'));
})();
