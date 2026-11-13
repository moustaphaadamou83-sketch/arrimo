/* Écran « Demandes » : boîte d'arrivée du formulaire du site (à traiter), archives (traitées, rejetées), vue compacte,
   filtres, recherche, pagination, actions groupées et réponse signée « L'équipe Arrimo ». Tout est affiché en texte. */
const STATUT_DEMANDE={a_traiter:'À traiter',traitee:'Traitée',rejetee:'Rejetée'};
const TYPE_DEMANDE={demo:'Démonstration',devis:'Devis',contact:'Contact'};
const PAYS_DEMANDE={canada:'Canada',europe:'Europe',afrique:'Afrique',autre:'Autre'};
const LANGUE_CONTACT={fr:'français',en:'anglais',es:'espagnol',pt:'portugais',ar:'arabe',de:'allemand',it:'italien',zh:'chinois',ht:'créole haïtien',autre:'autre langue'};
const MOTIF_REJET={pourriel:'Pourriel',hors_cible:'Hors cible',doublon:'Doublon',autre:'Autre'};
const MODULE_INTERET={lits_urgence:'Lits et urgence',hebergement:'Hébergement',secours:'Secours',transferts:'Transferts',reseau:'Réseau et pilotage',integration:'Intégration',indecis:'Pas encore décidé'};
const ETAPE_CRM={prospect:'Prospect',contacte:'Contacté',demo_planifiee:'Démo planifiée',devis_envoye:'Devis envoyé',gagne:'Gagné',perdu:'Perdu'};
const ENVOI_DEMANDE={en_attente:'en file',envoi:'envoi en cours',envoye:'envoyé',abandonne:'non distribué'};
const nomPaysDemande=(c)=>{try{return new Intl.DisplayNames(['fr'],{type:'region'}).of(c)||c;}catch{return c;}};
const PAYS_ISO_SH='AD,AE,AF,AG,AI,AL,AM,AO,AQ,AR,AS,AT,AU,AW,AX,AZ,BA,BB,BD,BE,BF,BG,BH,BI,BJ,BL,BM,BN,BO,BQ,BR,BS,BT,BV,BW,BY,BZ,CA,CC,CD,CF,CG,CH,CI,CK,CL,CM,CN,CO,CR,CU,CV,CW,CX,CY,CZ,DE,DJ,DK,DM,DO,DZ,EC,EE,EG,EH,ER,ES,ET,FI,FJ,FK,FM,FO,FR,GA,GB,GD,GE,GF,GG,GH,GI,GL,GM,GN,GP,GQ,GR,GS,GT,GU,GW,GY,HK,HM,HN,HR,HT,HU,ID,IE,IL,IM,IN,IO,IQ,IR,IS,IT,JE,JM,JO,JP,KE,KG,KH,KI,KM,KN,KP,KR,KW,KY,KZ,LA,LB,LC,LI,LK,LR,LS,LT,LU,LV,LY,MA,MC,MD,ME,MF,MG,MH,MK,ML,MM,MN,MO,MP,MQ,MR,MS,MT,MU,MV,MW,MX,MY,MZ,NA,NC,NE,NF,NG,NI,NL,NO,NP,NR,NU,NZ,OM,PA,PE,PF,PG,PH,PK,PL,PM,PN,PR,PS,PT,PW,PY,QA,RE,RO,RS,RU,RW,SA,SB,SC,SD,SE,SG,SH,SI,SJ,SK,SL,SM,SN,SO,SR,SS,ST,SV,SX,SY,SZ,TC,TD,TF,TG,TH,TJ,TK,TL,TM,TN,TO,TR,TT,TV,TW,TZ,UA,UG,UM,US,UY,UZ,VA,VC,VE,VG,VI,VN,VU,WF,WS,YE,YT,ZA,ZM,ZW'.split(',');
const refDemande=(id)=>`D-${String(id).padStart(6,'0')}`;

/** Compteur « À traiter » sur l'onglet Demandes (rafraîchi à chaque affichage). */
async function majCompteurDemandes(){
  const onglet=document.querySelector('#onglets [data-v="demandes"]');if(!onglet)return;
  let n=0;try{n=(await api('GET','/demandes-site/compteur')).a_traiter;}catch{return;}
  let b=onglet.querySelector('.compteur-onglet');
  if(!n){b?.remove();return;}
  if(!b){b=document.createElement('span');b.className='compteur-onglet';onglet.appendChild(b);}
  b.textContent=String(n);b.setAttribute('aria-label',`${n} à traiter`);
}

async function vueDemandes(v){
  const f=etat.filtresDemandes||(etat.filtresDemandes={vue:'a_traiter',page:1});
  const q=new URLSearchParams(Object.entries(f).filter(([,x])=>x!==''&&x!=null));
  const r=await api('GET',`/demandes-site?${q}`);
  const admin=etat.moi.utilisateur.role==='administration';
  const paysTries=PAYS_ISO_SH.map(c=>[c,nomPaysDemande(c)]).sort((a,b)=>a[1].localeCompare(b[1],'fr'));
  const choix=(id,lib,opts,val,tous='Tous')=>`<div class="champ"><label class="lbl" for="${id}">${esc(lib)}</label><select id="${id}"><option value="">${esc(tous)}</option>${opts.map(([c,n])=>`<option value="${esc(c)}"${String(c)===String(val||'')?' selected':''}>${esc(n)}</option>`).join('')}</select></div>`;
  const pages=Math.max(1,Math.ceil(r.total/r.par_page));
  const ligne=(lib,val)=>val?`<div><b>${esc(lib)} :</b> <span class="donnee">${esc(val)}</span></div>`:'';
  const lieu=d=>`${d.pays_code?nomPaysDemande(d.pays_code):(PAYS_DEMANDE[d.pays]||d.pays||'')}${d.ville?` · ${d.ville}`:''}`;
  const detail=d=>`<tr class="demande-detail" data-detail="${esc(d.id)}" hidden><td colspan="8"><article class="panneau-c" data-demande="${esc(d.id)}">
      <p class="note">${esc(refDemande(d.id))} · reçue le ${esc(new Date(d.recu_le).toLocaleString('fr-CA'))} · ${esc(lieu(d))} · contact en ${esc(LANGUE_CONTACT[d.langue_contact||d.langue]||d.langue)}${d.profil_pays_nom?` · profil de pays : ${esc(d.profil_pays_nom)}`:''}${d.consentement_le?' · consentement enregistré':''}</p>
      ${ligne('Nom',d.nom)}${ligne('Fonction',d.fonction)}${ligne('Courriel',d.courriel)}
      ${d.telephone?`<div><b>Téléphone ou WhatsApp :</b> <a class="donnee" href="tel:${esc(d.telephone)}">${esc(d.telephone)}</a>${d.telephone_a_verifier?' <span class="badge">numéro à vérifier</span>':''}</div>`:''}
      ${ligne('Type d’organisation',d.type_organisation)}${ligne('Module qui l’intéresse',MODULE_INTERET[d.module_interet])}${ligne('Format',d.format)}${ligne('Établissements',d.nb_etablissements)}${ligne('Offre',d.offre)}${ligne('Sujet',d.sujet)}
      ${d.organisation_crm?`<div><b>CRM :</b> <span class="donnee">${esc(d.organisation_crm)}</span> · ${esc(ETAPE_CRM[d.etape_crm]||d.etape_crm)}</div>`:''}
      <p class="donnee demande-message" style="white-space:pre-wrap;overflow-wrap:anywhere;margin-top:10px">${esc(d.message)}</p>
      ${(d.courriels||[]).length?`<h4>Courriels</h4><ul class="note">${d.courriels.map(m=>`<li>${m.genre==='accuse'?'Accusé de réception':'Réponse'} · ${esc(m.sujet)} · ${esc(ENVOI_DEMANDE[m.etat]||m.etat)}${m.genre==='reponse'?`<details><summary>Texte envoyé</summary><p class="donnee" style="white-space:pre-wrap">${esc(m.texte)}</p></details>`:''}</li>`).join('')}</ul>`:''}
      ${d.statut==='rejetee'?`<p class="note">Rejetée : ${esc(MOTIF_REJET[d.rejet_motif]||d.rejet_motif)}${d.rejet_note?` · ${esc(d.rejet_note)}`:''}</p>`:''}
      <div class="ligne serre">${bouton('Répondre','dm-repondre','btn pri',d.id)}${d.statut==='a_traiter'?bouton('Marquer traitée','dm-traiter','btn',d.id)+bouton('Rejeter','dm-rejeter','btn',d.id):bouton('Remettre à traiter','dm-rouvrir','btn',d.id)}${bouton('Attribuer','dm-attribuer','btn',d.id)}${admin&&d.statut==='rejetee'&&d.rejet_motif==='pourriel'?bouton('Supprimer (pourriel)','dm-supprimer','btn dan',d.id):''}</div>
    </article></td></tr>`;
  const lignes=r.demandes.map(d=>`<tr data-ligne="${esc(d.id)}"><td><input type="checkbox" data-choix="${esc(d.id)}" aria-label="Choisir la demande ${esc(refDemande(d.id))}"></td>
      <td><button class="lien-ligne" type="button" data-ouvrir="${esc(d.id)}" aria-expanded="false">${esc(refDemande(d.id))}</button></td><td>${esc(new Date(d.recu_le).toLocaleDateString('fr-CA'))}</td>
      <td>${esc(TYPE_DEMANDE[d.type]||d.type)}</td><td><span class="donnee">${esc(d.organisation)}</span><div class="note">${esc(d.nom)}</div></td><td>${esc(lieu(d))}</td>
      <td>${esc(LANGUE_CONTACT[d.langue_contact||d.langue]||'')}</td><td>${esc(STATUT_DEMANDE[d.statut]||d.statut)}${d.attribue_nom?`<div class="note">${esc(d.attribue_nom)}</div>`:''}</td></tr>${detail(d)}`).join('');
  v.innerHTML=`<div class="entete"><div><h2>Demandes</h2><p>Boîte d’arrivée du formulaire du site. Chaque demande crée ou complète un prospect dans le CRM et reçoit un accusé de réception. Supprimées automatiquement après 24 mois.</p></div></div>
    <div class="onglets-demandes ligne serre" role="tablist"><button class="btn${f.vue==='a_traiter'?' pri':''}" type="button" role="tab" aria-selected="${f.vue==='a_traiter'}" data-vue-demandes="a_traiter">À traiter</button><button class="btn${f.vue==='archives'?' pri':''}" type="button" role="tab" aria-selected="${f.vue==='archives'}" data-vue-demandes="archives">Archives</button></div>
    <div class="filtres-demandes ligne">
      <div class="champ"><label class="lbl" for="dm-recherche">Recherche</label><input id="dm-recherche" type="search" value="${esc(f.recherche||'')}" placeholder="Nom, organisation, courriel, message…"></div>
      ${choix('dm-pays','Pays',paysTries,f.pays)}<div class="champ"><label class="lbl" for="dm-ville">Ville</label><input id="dm-ville" value="${esc(f.ville||'')}" placeholder="Contient…"></div>
      ${choix('dm-langue','Langue',Object.entries(LANGUE_CONTACT),f.langue,'Toutes')}${choix('dm-type','Type d’organisation',r.types_organisation.map(t=>[t,t]),f.type_organisation)}${choix('dm-module','Module',Object.entries(MODULE_INTERET),f.module)}
    </div>
    <div class="ligne serre actions-groupees"><span class="note" id="dm-choisies">Aucune demande choisie</span>${f.vue==='a_traiter'?bouton('Marquer traitées','dm-lot-traiter')+bouton('Rejeter','dm-lot-rejeter'):''}${bouton('Attribuer','dm-lot-attribuer')}</div>
    ${tableSH(['','Demande','Reçue','Type','Organisation','Pays et ville','Langue','Statut'],lignes,f.vue==='a_traiter'?'Aucune demande à traiter.':'Aucune demande archivée.')}
    <div class="ligne serre pagination"><span class="note">${esc(pl('{n|aucune demande|# demande|# demandes}',{n:r.total}))} · page ${esc(r.page)} sur ${esc(pages)}</span>${r.page>1?bouton('Page précédente','dm-prec'):''}${r.page<pages?bouton('Page suivante','dm-suiv'):''}</div>`;
  majCompteurDemandes();
  const recharger=(maj)=>{Object.assign(f,maj,maj.page?{}:{page:1});afficher();};
  v.querySelectorAll('[data-vue-demandes]').forEach(b=>{b.onclick=()=>recharger({vue:b.dataset.vueDemandes});});
  for(const [id,cle] of [['dm-pays','pays'],['dm-langue','langue'],['dm-type','type_organisation'],['dm-module','module']])$(`#${id}`).onchange=e=>recharger({[cle]:e.target.value});
  for(const [id,cle] of [['dm-recherche','recherche'],['dm-ville','ville']])$(`#${id}`).onchange=e=>recharger({[cle]:e.target.value.trim()});
  surAction(v,'dm-prec',()=>recharger({page:r.page-1}));surAction(v,'dm-suiv',()=>recharger({page:r.page+1}));
  v.querySelectorAll('[data-ouvrir]').forEach(b=>{b.onclick=()=>{const d=v.querySelector(`[data-detail="${b.dataset.ouvrir}"]`);d.hidden=!d.hidden;b.setAttribute('aria-expanded',String(!d.hidden));};});
  const choisies=()=>[...v.querySelectorAll('[data-choix]:checked')].map(c=>Number(c.dataset.choix));
  v.querySelectorAll('[data-choix]').forEach(c=>{c.onchange=()=>{const n=choisies().length;$('#dm-choisies').textContent=pl('{n|Aucune demande choisie|# demande choisie|# demandes choisies}',{n});};});
  const exiger=()=>{const ids=choisies();if(!ids.length){toast('Choisissez au moins une demande.',true);return null;}return ids;};
  const motifRejet=(run)=>modale('Rejeter',`<div class="champ"><label class="lbl" for="dm-motif">Motif</label><select id="dm-motif">${Object.entries(MOTIF_REJET).map(([c,n])=>`<option value="${c}">${esc(n)}</option>`).join('')}</select></div><div class="champ"><label class="lbl" for="dm-note">Précision (facultatif)</label><input id="dm-note" maxlength="500"></div><p class="note">La demande passe aux archives. Seul un pourriel rejeté peut ensuite être supprimé.</p>`,
    [{label:'Annuler'},{label:'Rejeter',dan:true,run:enregistrer(()=>run(valeur('#dm-motif'),valeur('#dm-note')),'Demande rejetée.')}]);
  const attribution=async(run)=>modale('Attribuer',await choixPersonne('dm-personne','','Personne responsable'),[{label:'Annuler'},{label:'Attribuer',pri:true,run:enregistrer(()=>run(valeur('#dm-personne')),'Attribution enregistrée.')}]);
  surAction(v,'dm-lot-traiter',(_,b)=>{const ids=exiger();if(ids)agir(b,()=>api('POST','/demandes-site/lot',{ids,action:'traiter'}),x=>pl('{n|Aucune demande traitée|# demande traitée|# demandes traitées}',{n:x.modifiees}));});
  surAction(v,'dm-lot-rejeter',()=>{const ids=exiger();if(ids)motifRejet((m,n)=>api('POST','/demandes-site/lot',{ids,action:'rejeter',rejet_motif:m,rejet_note:n}));});
  surAction(v,'dm-lot-attribuer',()=>{const ids=exiger();if(ids)attribution(u=>api('POST','/demandes-site/lot',{ids,action:'attribuer',utilisateur_id:u||null}));});
  surAction(v,'dm-traiter',(id,b)=>agir(b,()=>api('PUT',`/demandes-site/${id}`,{statut:'traitee'}),'Demande traitée : elle passe aux archives.'));
  surAction(v,'dm-rouvrir',(id,b)=>agir(b,()=>api('PUT',`/demandes-site/${id}`,{statut:'a_traiter'}),'Demande remise à traiter.'));
  surAction(v,'dm-rejeter',id=>motifRejet((m,n)=>api('PUT',`/demandes-site/${id}`,{statut:'rejetee',rejet_motif:m,rejet_note:n})));
  surAction(v,'dm-attribuer',id=>attribution(u=>api('PUT',`/demandes-site/${id}`,{attribue_a:u||null})));
  surAction(v,'dm-supprimer',id=>modale('Supprimer ce pourriel ?','<p>Ses renseignements sont effacés ; le journal garde seulement le numéro.</p>',[{label:'Annuler'},{label:'Supprimer',dan:true,run:enregistrer(()=>api('DELETE',`/demandes-site/${id}`),'Pourriel supprimé.')}]));
  surAction(v,'dm-repondre',id=>{
    const d=r.demandes.find(x=>String(x.id)===String(id));const en=(d.langue_contact||d.langue)==='en';
    const sujet=en?`Arrimo · Your request ${refDemande(d.id)}`:`Arrimo · Votre demande ${refDemande(d.id)}`;
    const texte=en?`Hello ${d.nom},\n\nThank you for your request on behalf of ${d.organisation}.\n\n\n\nWe remain at your disposal.\n\nThe Arrimo team\nSenseAfri Group`
      :`Bonjour ${d.nom},\n\nMerci pour votre demande au nom de ${d.organisation}.\n\n\n\nNous restons à votre disposition.\n\nL’équipe Arrimo\nSenseAfri Group`;
    modale(`Répondre à ${d.nom}`,`<div class="form-modale"><p class="note">À : ${esc(d.courriel)} · en ${en?'anglais':'français'}. Modifiez le texte avant l’envoi ; il est conservé dans l’historique du contact.</p>${champ('rp-sujet','Sujet',sujet)}
      <div class="champ"><label class="lbl" for="rp-texte">Message</label><textarea id="rp-texte" rows="12" maxlength="8000">${esc(texte)}</textarea></div>
      <label class="case"><input type="checkbox" id="rp-traitee"${d.statut==='a_traiter'?' checked':''}> Marquer la demande comme traitée</label></div>`,
    [{label:'Annuler'},{label:'Envoyer',pri:true,run:enregistrer(()=>api('POST',`/demandes-site/${id}/repondre`,{sujet:valeur('#rp-sujet'),texte:valeur('#rp-texte'),marquer_traitee:$('#rp-traitee').checked}),'Réponse en file d’envoi.')}]);
    $('#modale .boite').classList.add('large');
  });
}
