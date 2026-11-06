/* Administration des accès : seules les routes autorisées font foi. Aucun jeton de session n'est affiché. */
void api('GET','/connexion/configuration').then(p=>{
  if(p.validation_fictive)$('#bandeau-libelle').textContent='Validation SH · données fictives · courriels simulés';
}).catch(()=>{});
async function afficherSessions(v,id,administration) {
  const prefixe=administration?`/equipe/${id}`:'/moi';
  const sessions=await api('GET',`${prefixe}/sessions`);
  const section=document.createElement('section');section.className='panneau-c';
  section.innerHTML=`<h3>Sessions actives</h3><p>Une session ouverte n’indique pas une activité professionnelle en cours.</p>
    ${sessions.length?`<div class="tableau"><table><thead><tr><th>Session</th><th>Ouverte</th><th>Expiration</th><th>Action</th></tr></thead><tbody>${sessions.map(s=>`<tr><td>${esc(s.id)}${s.courante?' · cet appareil':''}</td><td>${esc(quand(s.cree_le))}</td><td>${esc(quand(s.expire_le))}</td><td><button class="btn" data-session="${s.id}" data-courante="${s.courante}">Révoquer</button></td></tr>`).join('')}</tbody></table></div>`:'<p>Aucune session active.</p>'}
    <button class="btn" type="button" id="acces-fermer">${administration?'Déconnecter toutes les sessions':'Déconnecter mes autres sessions'}</button>`;
  v.append(section);
  section.querySelectorAll('[data-session]').forEach(b=>{b.onclick=async()=>{
    try{await api('POST',`${prefixe}/sessions/${b.dataset.session}/revoquer`);
      if(b.dataset.courante==='true'){deconnecter();$('#modale').hidden=true;return;}
      section.remove();await afficherSessions(v,id,administration);toast('Session révoquée.');
    }catch(e){toast(e.message,true);}
  };});
  section.querySelector('#acces-fermer').onclick=async()=>{
    try{await api('POST',`${prefixe}/sessions/fermer`);
      if(administration&&id===etat.moi.utilisateur.id){$('#modale').hidden=true;deconnecter();return;}
      section.remove();await afficherSessions(v,id,administration);toast('Sessions révoquées.');
    }catch(e){toast(e.message,true);}
  };
}
async function aiderConnexion(m,invitations){
  const attente=invitations.filter(i=>i.email.toLowerCase()===m.email.toLowerCase());
  modale(`Accès · ${m.nom}`,`<p>Compte : <b>${m.archive_le?'Archivé':m.actif?'Actif':'Désactivé'}</b> · MFA ${m.totp_actif?'active':'à activer'}.</p>
    <p>${attente.length?attente.map(i=>`Invitation ${new Date(i.expire_le)<new Date()?'expirée':'en attente'} · ${esc(quand(i.expire_le))}`).join('<br>'):'Aucune invitation en attente.'}</p>
    <form id="acces-profil"><div class="champ"><label for="ap-nom">Nom professionnel</label><input id="ap-nom" value="${esc(m.nom)}" required maxlength="120"></div>
    <div class="champ"><label for="ap-email">Courriel</label><input id="ap-email" type="email" value="${esc(m.email)}" required></div>
    <div class="champ"><label for="ap-fonction">Fonction</label><input id="ap-fonction" value="${esc(m.fonction||'')}" maxlength="160"></div>
    <button class="btn" type="submit">Enregistrer le profil</button></form>
    <p>La récupération du mot de passe conserve la MFA. Modifier le courriel révoque les sessions et les liens précédents.</p>
    <button class="btn" id="acces-recuperer"${!m.actif||m.archive_le?' disabled':''}>Envoyer un lien de récupération</button>
    <button class="btn" id="acces-perimetres">Rôle personnalisé et périmètres</button>
    ${m.id!==etat.moi.utilisateur.id&&!m.supprime_le?`<button class="btn" id="acces-archive">${m.archive_le?'Restaurer le compte':'Archiver le compte'}</button>`:''}
    ${m.supprime_le?'<p class="note">Compte supprimé : données personnelles retirées, historique conservé.</p>':m.archive_le&&m.id!==etat.moi.utilisateur.id?(m.suppression_demandee_le
      ?`<div class="champ"><label class="lbl" for="acces-confirmation">Pour supprimer définitivement, saisissez SUPPRIMER suivi du courriel</label><input id="acces-confirmation" autocomplete="off"></div><button class="btn dan" id="acces-supprimer">Supprimer définitivement</button>`
      :`<div class="champ"><label class="lbl" for="acces-motif">Motif de la demande de suppression</label><input id="acces-motif" maxlength="500"></div><button class="btn dan" id="acces-demander">Demander la suppression définitive</button>`):''}
    <div id="acces-sessions"></div>`,[{label:'Fermer'}]);
  const contenu=$('#acces-sessions');
  $('#acces-profil').onsubmit=async e=>{e.preventDefault();try{
    const r=await api('PUT',`/equipe/${m.id}/profil`,{nom:$('#ap-nom').value,email:$('#ap-email').value,fonction:$('#ap-fonction').value});
    Object.assign(m,r);toast('Profil enregistré.');
  }catch(err){toast(err.message,true);}};
  $('#acces-recuperer').onclick=async()=>{try{const r=await api('POST',`/equipe/${m.id}/recuperer`);toast(r.message);}catch(e){toast(e.message,true);}};
  $('#acces-perimetres').onclick=()=>gererPerimetres(m);
  const demander=$('#acces-demander'),supprimer=$('#acces-supprimer');
  if(demander)demander.onclick=async()=>{try{await api('POST',`/equipe/${m.id}/demander-suppression`,{motif:$('#acces-motif').value});$('#modale').hidden=true;await afficher();toast('Demande de suppression enregistrée.');}catch(e){toast(e.message,true);}};
  if(supprimer)supprimer.onclick=async()=>{try{await api('POST',`/equipe/${m.id}/supprimer`,{confirmation:$('#acces-confirmation').value.trim()});$('#modale').hidden=true;await afficher();toast('Compte supprimé. Historique conservé.');}catch(e){toast(e.message,true);}};
  const archiver=$('#acces-archive');
  if(archiver)archiver.onclick=async()=>{try{await api('POST',`/equipe/${m.id}/${m.archive_le?'restaurer':'archiver'}`);$('#modale').hidden=true;await afficher();toast('Historique conservé. Le compte est désactivé.');}catch(e){toast(e.message,true);}};
  try{await afficherSessions(contenu,m.id,true);}catch(e){toast(e.message,true);}
}
async function vueParametres(v){
  const p=await api('GET','/parametres');
  const types=await api('GET','/types-locaux');
  const oui=x=>x?'Configuré':'Non configuré';
  v.innerHTML=`<div class="entete"><div><h2>Paramètres</h2><p>Configuration effective de la console SH</p></div></div>
    <form class="panneau-c" id="f-parametres"><h3>Général, sécurité et conservation</h3><p class="note">La valeur enregistrée ici remplace celle de la configuration du déploiement. Chaque modification est validée et journalisée.</p>
      ${[['emetteur_nom','Nom de l’émetteur des documents','text'],['emetteur_adresse','Adresse de l’émetteur','text'],['emetteur_courriel','Courriel de l’émetteur','email'],['emetteur_taxes','Numéros de taxes de l’émetteur','text'],['session_heures','Durée de session (heures, 1 à 12)','number'],['employes_conservation_jours','Conservation avant suppression d’un compte archivé (jours)','number']]
        .map(([cle,lib,type])=>{const x=p.modifiables[cle];return `<div class="champ"><label class="lbl" for="pa-${cle}">${lib}</label><input id="pa-${cle}" data-parametre="${cle}" type="${type}" value="${esc(x.valeur??'')}"${type==='number'?' min="0" step="1"':''}><span class="note">${{base:'Enregistré dans la console',configuration:'Configuration du déploiement',defaut:'Valeur par défaut'}[x.source]}</span></div>`;}).join('')}
      <p>Fuseau de référence : ${esc(p.general.fuseau)}</p><div><button class="btn pri" type="submit">Enregistrer les paramètres</button></div></form>
    <section class="panneau-c"><h3>Sécurité et courriels</h3><p>Double authentification obligatoire · Session : ${esc(p.securite.session_heures)} heures · Lien : ${esc(p.securite.recuperation_minutes)} minutes</p>
    <p><span>Transport courriel</span> : <span>${oui(p.courriels.transport_configure)}</span> · <span>Récupération</span> : <span>${p.courriels.recuperation_disponible?'Disponible':'Indisponible'}</span></p><p>Documents : <span>${oui(p.documents.stockage_configure)}</span></p></section>
    <section class="panneau-c"><h3>Apparence</h3><p class="note">Appliquée tout de suite et enregistrée sur votre compte.</p><fieldset class="choix-apparence"><legend class="lbl">Mode d’affichage</legend>${[['clair','Clair'],['sombre','Sombre'],['automatique','Automatique (système)'],['soleil','Selon le soleil']].map(([c,l])=>`<label class="case"><input type="radio" name="pa-apparence" value="${c}"${(etat.moi.utilisateur.apparence||'automatique')===c?' checked':''}> ${l}</label>`).join('')}</fieldset></section>
    <section class="panneau-c" id="types-locaux"><h3>Types d’établissement par pays</h3><p class="note">Le nom s’affiche pour le pays choisi. Le comportement et les modules restent ceux du modèle : Hôpital ou CHSLD.</p>
      <div class="tableau"><table><thead><tr><th>Pays</th><th>Code</th><th>Nom</th><th>Nom anglais</th><th>Modèle</th><th>Établissements</th><th>État</th><th></th></tr></thead><tbody>${types.map(t=>`<tr><td>${esc(t.pays_code)}</td><td><code class="donnee">${esc(t.code)}</code></td><td>${esc(t.nom)}</td><td>${esc(t.nom_en||'')}</td><td>${t.modele==='chsld'?'CHSLD':'Hôpital'}</td><td>${esc(t.utilisations)}</td><td>${t.actif?'Actif':'Désactivé'}</td><td><button class="btn" type="button" data-type-local="${esc(t.id)}" data-actif="${t.actif?'0':'1'}">${t.actif?'Désactiver':'Réactiver'}</button></td></tr>`).join('')||'<tr><td colspan="8">Aucun type propre à un pays.</td></tr>'}</tbody></table></div>
      <form id="f-type-local"><div class="ligne"><div class="champ"><label class="lbl" for="tl-pays">Pays (ISO)</label><input id="tl-pays" maxlength="2" required></div><div class="champ"><label class="lbl" for="tl-code">Code</label><input id="tl-code" required pattern="[a-z][a-z0-9_]{1,39}" placeholder="clinique_district"></div><div class="champ"><label class="lbl" for="tl-nom">Nom</label><input id="tl-nom" required minlength="2" maxlength="80"></div><div class="champ"><label class="lbl" for="tl-nom-en">Nom anglais</label><input id="tl-nom-en" maxlength="80"></div><div class="champ"><label class="lbl" for="tl-modele">Modèle</label><select id="tl-modele"><option value="hopital">Hôpital</option><option value="chsld">CHSLD</option></select></div></div><button class="btn pri" type="submit">Ajouter ce type</button></form></section>
    <section class="panneau-c"><h3>Utilisateurs et accès</h3><button class="btn" id="param-utilisateurs">Gérer les utilisateurs et leurs sessions</button></section>
    <section class="panneau-c"><h3>Rôles personnalisés</h3><button class="btn" id="param-roles">Configurer les permissions</button></section>
    <p class="note">${esc(p.gestion)}</p>`;
  $('#f-type-local').onsubmit=e=>{e.preventDefault();agir(e.submitter,()=>api('POST','/types-locaux',{pays_code:$('#tl-pays').value,code:$('#tl-code').value,nom:$('#tl-nom').value,nom_en:$('#tl-nom-en').value,modele:$('#tl-modele').value}),'Type ajouté.');};
  v.querySelectorAll('[data-type-local]').forEach(b=>{b.onclick=()=>agir(b,()=>api('PUT',`/types-locaux/${b.dataset.typeLocal}`,{actif:b.dataset.actif==='1'}),'Type mis à jour.');});
  $('#f-parametres').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;
    try{let n=0;for(const inp of v.querySelectorAll('[data-parametre]')){const x=p.modifiables[inp.dataset.parametre];if(String(x.valeur??'')===inp.value.trim())continue;
      await api('PUT',`/parametres/${inp.dataset.parametre}`,{valeur:inp.value.trim()});n+=1;}
      toast(n?'Paramètres enregistrés.':'Aucune modification.');await afficher();}catch(err){toast(err.message,true);}finally{b.disabled=false;}};
  v.querySelectorAll('input[name=pa-apparence]').forEach(r=>{r.onchange=()=>choisirApparence(r.value);});
  $('#param-utilisateurs').onclick=()=>{etat.vue='equipe';afficher();};
  $('#param-roles').onclick=()=>gererRolesPersonnalises();
}
