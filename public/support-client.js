async function vueSupportClient(navigation){
  const v=document.querySelector('#v-support'),ctx=etat.ctx,session=etat.token;
  if(!session)return;
  if(navigation===undefined&&etat.supportFiche?.ctx===ctx)return detailSupportClient(ctx,etat.supportFiche.id);
  const sequence=etat.supportSequence=(etat.supportSequence||0)+1;
  const valide=()=>etat.ctx===ctx&&etat.token===session&&etat.supportSequence===sequence;
  etat.supportFiche=null;
  const brouillon=(etat.supportBrouillons||(etat.supportBrouillons={}))[ctx]||((etat.supportBrouillons)[ctx]={creation:{},messages:{}});
  const courant=navigation||(etat.supportNavigation?.ctx===ctx?etat.supportNavigation:{avant:null,historique:[]});
  etat.supportNavigation={...courant,ctx};
  const S=(k,vars)=>t('support.'+k,vars);
  const configuration=await api('GET',`/support/configuration?etablissement_id=${ctx}`);
  if(!valide())return;
  if(!configuration.disponible){v.innerHTML=`<h2>${esc(S('titre'))}</h2><p>${esc(S(configuration.motif==='non_raccorde'?'non_raccorde':configuration.motif==='indisponible'?'temporairement_indisponible':'indisponible'))}</p>`;return;}
  const [page,projets]=await Promise.all([api('GET',`/support/tickets?etablissement_id=${ctx}${courant.avant?'&avant='+courant.avant:''}`),api('GET',`/support/projets?etablissement_id=${ctx}`)]);
  if(!valide())return;
  const tickets=page.tickets;
  v.innerHTML=`<div class="entete"><h2>${esc(S('titre'))}</h2></div><p>${esc(S('confidentialite'))}</p>
    <details class="panneau-c"><summary>${esc(S('nouveau'))}</summary><form id="support-creer">
    <div class="champ"><label for="sc-titre">${esc(S('sujet'))}</label><input id="sc-titre" maxlength="180" required></div>
    <div class="champ"><label for="sc-description">${esc(S('description'))}</label><textarea id="sc-description" maxlength="4000" required></textarea></div><div class="champ"><label for="sc-fichier">${esc(S('piece_jointe'))}</label><input type="file" id="sc-fichier" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt"><small>${esc(S('fichier_limite'))}</small></div>
    <div class="ligne"><div class="champ"><label for="sc-type">${esc(S('type'))}</label><select id="sc-type">${['demande','incident','question'].map(k=>`<option value="${k}">${esc(S(k))}</option>`).join('')}</select></div>
    <div class="champ"><label for="sc-categorie">${esc(S('categorie'))}</label><select id="sc-categorie">${['bug','amelioration','assistance','formation','acces','autre'].map(k=>`<option value="${k}">${esc(S(k))}</option>`).join('')}</select></div>
    <div class="champ"><label for="sc-priorite">${esc(S('priorite'))}</label><select id="sc-priorite">${['basse','normale','haute','urgente'].map(k=>`<option value="${k}"${k==='normale'?' selected':''}>${esc(S(k))}</option>`).join('')}</select></div>
    <div class="champ"><label for="sc-projet">${esc(S('projet'))}</label><select id="sc-projet"><option value="">—</option>${projets.map(p=>`<option value="${esc(p.id)}">${esc(p.nom)}</option>`).join('')}</select></div></div>
    <button class="btn pri" type="submit">${esc(S('creer'))}</button></form></details>
    <h3>${esc(S('suivi'))}</h3><div class="liste">${tickets.map(ticket=>`<button type="button" class="btn" data-support-ticket="${esc(ticket.id)}">${esc(ticket.reference)} · ${esc(ticket.titre)} · ${esc(S(ticket.statut))}</button>`).join('')||`<p>${esc(S('vide'))}</p>`}</div><div class="ligne">${courant.avant?`<button class="btn" id="sc-recents" type="button">${esc(S('plus_recents'))}</button>`:''}${page.avant_suivant?`<button class="btn" id="sc-anciens" type="button">${esc(S('plus_anciens'))}</button>`:''}</div>`;
  const champs=['sc-titre','sc-description','sc-type','sc-categorie','sc-priorite','sc-projet'];
  for(const id of champs)if(Object.hasOwn(brouillon.creation,id))v.querySelector('#'+id).value=brouillon.creation[id];
  const details=v.querySelector('details');details.open=!!brouillon.ouvert;details.ontoggle=()=>{brouillon.ouvert=details.open;};
  v.querySelector('#support-creer').oninput=()=>{brouillon.creation=Object.fromEntries(champs.map(id=>[id,v.querySelector('#'+id).value]));};
  const charger=async(b,nav)=>{b.disabled=true;try{if(valide())await vueSupportClient(nav);}catch(e){toast(e.message,true);}finally{if(b.isConnected)b.disabled=false;}};
  const anciens=v.querySelector('#sc-anciens');if(anciens)anciens.onclick=()=>charger(anciens,{avant:page.avant_suivant,historique:[...courant.historique,courant.avant]});
  const recents=v.querySelector('#sc-recents');if(recents)recents.onclick=()=>charger(recents,{avant:courant.historique.at(-1)||null,historique:courant.historique.slice(0,-1)});
  v.querySelector('#support-creer').onsubmit=async ev=>{
    ev.preventDefault();const b=ev.submitter||ev.currentTarget.querySelector('button[type=submit]');b.disabled=true;
    try{
      if(!valide())return;
      const champ=id=>v.querySelector('#'+id).value;
      const ticket=await api('POST','/support/tickets',{etablissement_id:ctx,titre:champ('sc-titre'),description:champ('sc-description'),type:champ('sc-type'),categorie:champ('sc-categorie'),priorite:champ('sc-priorite'),projet_id:champ('sc-projet')||null});
      const fichier=v.querySelector('#sc-fichier').files[0];if(fichier){if(fichier.size>10*1024*1024)throw new Error(S('fichier_trop_gros'));const contenu_base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=()=>reject(new Error(S('fichier_lecture')));r.readAsDataURL(fichier);});await api('POST',`/support/tickets/${ticket.id}/pieces-jointes`,{etablissement_id:ctx,nom:fichier.name,contenu_base64});}
      if(!valide())return;
      brouillon.creation={};brouillon.ouvert=false;toast(S('cree'));await vueSupportClient({avant:null,historique:[]});
    }catch(e){toast(e.message,true);}finally{if(b.isConnected)b.disabled=false;}
  };
  v.querySelectorAll('[data-support-ticket]').forEach(b=>b.onclick=()=>detailSupportClient(ctx,b.dataset.supportTicket));
}
async function detailSupportClient(ctx,id){
  const v=document.querySelector('#v-support'),S=k=>t('support.'+k),session=etat.token;
  if(!session||etat.ctx!==ctx)return;
  const sequence=etat.supportSequence=(etat.supportSequence||0)+1;
  const valide=()=>etat.ctx===ctx&&etat.token===session&&etat.supportSequence===sequence;
  etat.supportFiche={ctx,id};
  const brouillon=(etat.supportBrouillons||(etat.supportBrouillons={}))[ctx]||((etat.supportBrouillons)[ctx]={creation:{},messages:{}});
  try{
    const ticket=await api('GET',`/support/tickets/${id}?etablissement_id=${ctx}`);if(!valide())return;
    v.innerHTML=`<button type="button" class="btn" id="sc-retour">${esc(S('retour'))}</button><h2>${esc(ticket.reference)} · ${esc(ticket.titre)}</h2>
      <p>${esc(S(ticket.statut))} · ${esc(S(ticket.priorite))}</p><p>${esc(ticket.description)}</p>${ticket.prise_en_charge_echeance?`<p>${esc(S(ticket.sla_nature==='contractuel'?'sla_contractuel':'delai_standard'))}<br>${esc(S('prise_charge_avant'))} ${esc(new Date(ticket.prise_en_charge_echeance).toLocaleString(document.documentElement.lang))}${ticket.resolution_echeance?`<br>${esc(S('resolution_avant'))} ${esc(new Date(ticket.resolution_echeance).toLocaleString(document.documentElement.lang))}`:''}</p>`:''}${ticket.resolution?`<h3>${esc(S('resolution'))}</h3><p>${esc(ticket.resolution)}</p>`:''}
      <h3>${esc(S('pieces_jointes'))}</h3><ul>${(ticket.pieces_jointes||[]).map(p=>`<li><a href="#" data-pj="${esc(p.id)}">${esc(p.nom)} · ${esc(p.taille)} octets</a></li>`).join('')||`<li>${esc(S('aucune_piece'))}</li>`}</ul>${ticket.statut==='ferme'?'':`<form id="sc-pj"><label>${esc(S('ajouter_piece'))}<input type="file" id="sc-pj-fichier" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt"></label><button class="btn" type="submit">${esc(S('joindre'))}</button></form>`}
      <h3>${esc(S('messages'))}</h3><div class="liste">${ticket.messages.map(m=>`<article class="carte"><strong>${esc(m.auteur)}</strong><p>${esc(m.message)}</p></article>`).join('')||`<p>${esc(S('vide_messages'))}</p>`}</div>
      ${ticket.statut==='ferme'?'':`<form id="sc-repondre"><div class="champ"><label for="sc-message">${esc(S('message'))}</label><textarea id="sc-message" maxlength="8000" required></textarea></div><button class="btn pri" type="submit">${esc(S('envoyer'))}</button></form>`}`;
    v.querySelector('#sc-retour').onclick=()=>{etat.supportFiche=null;vueSupportClient();};
    v.querySelectorAll('[data-pj]').forEach(a=>a.onclick=async ev=>{ev.preventDefault();try{const r=await fetch(`/api/support/tickets/${id}/pieces-jointes/${a.dataset.pj}/fichier?etablissement_id=${ctx}`,{headers:{Authorization:`Bearer ${session}`}});if(!r.ok)throw new Error('Téléchargement impossible.');const blob=await r.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=a.textContent.split(' · ')[0];link.click();URL.revokeObjectURL(url);}catch(e){toast(e.message,true);}});
    const pj=v.querySelector('#sc-pj');if(pj)pj.onsubmit=async ev=>{ev.preventDefault();const f=v.querySelector('#sc-pj-fichier').files[0];if(!f)return;try{if(f.size>10*1024*1024)throw new Error(S('fichier_trop_gros'));const contenu_base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=()=>reject(new Error(S('fichier_lecture')));r.readAsDataURL(f);});await api('POST',`/support/tickets/${id}/pieces-jointes`,{etablissement_id:ctx,nom:f.name,contenu_base64});await detailSupportClient(ctx,id);}catch(e){toast(e.message,true);}};
    const champMessage=v.querySelector('#sc-message');if(champMessage){champMessage.value=brouillon.messages[id]||'';champMessage.oninput=()=>{brouillon.messages[id]=champMessage.value;};}
    const form=v.querySelector('#sc-repondre');if(form)form.onsubmit=async ev=>{
      ev.preventDefault();const b=ev.submitter||ev.currentTarget.querySelector('button[type=submit]');b.disabled=true;
      try{if(!valide())return;await api('POST',`/support/tickets/${id}/messages`,{etablissement_id:ctx,message:v.querySelector('#sc-message').value});if(!valide())return;delete brouillon.messages[id];await detailSupportClient(ctx,id);}catch(e){toast(e.message,true);}finally{if(b.isConnected)b.disabled=false;}
    };
  }catch(e){toast(e.message,true);}
}
