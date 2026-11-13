/* Écran « Demandes » : ce que les visiteurs envoient par le formulaire du site. Tout est affiché en texte. */
const STATUT_DEMANDE={nouvelle:'Nouvelle',en_cours:'En cours',traitee:'Traitée',rejetee:'Rejetée'};
const TYPE_DEMANDE={demo:'Démonstration',devis:'Devis',contact:'Contact'};
const PAYS_DEMANDE={canada:'Canada',europe:'Europe',afrique:'Afrique',autre:'Autre'};
const LANGUE_CONTACT={fr:'français',en:'anglais',es:'espagnol',pt:'portugais',ar:'arabe',de:'allemand',it:'italien',zh:'chinois',ht:'créole haïtien',autre:'autre langue'};
const nomPaysDemande=(c)=>{try{return new Intl.DisplayNames(['fr'],{type:'region'}).of(c)||c;}catch{return c;}};
const PAYS_ISO_SH='AD,AE,AF,AG,AI,AL,AM,AO,AQ,AR,AS,AT,AU,AW,AX,AZ,BA,BB,BD,BE,BF,BG,BH,BI,BJ,BL,BM,BN,BO,BQ,BR,BS,BT,BV,BW,BY,BZ,CA,CC,CD,CF,CG,CH,CI,CK,CL,CM,CN,CO,CR,CU,CV,CW,CX,CY,CZ,DE,DJ,DK,DM,DO,DZ,EC,EE,EG,EH,ER,ES,ET,FI,FJ,FK,FM,FO,FR,GA,GB,GD,GE,GF,GG,GH,GI,GL,GM,GN,GP,GQ,GR,GS,GT,GU,GW,GY,HK,HM,HN,HR,HT,HU,ID,IE,IL,IM,IN,IO,IQ,IR,IS,IT,JE,JM,JO,JP,KE,KG,KH,KI,KM,KN,KP,KR,KW,KY,KZ,LA,LB,LC,LI,LK,LR,LS,LT,LU,LV,LY,MA,MC,MD,ME,MF,MG,MH,MK,ML,MM,MN,MO,MP,MQ,MR,MS,MT,MU,MV,MW,MX,MY,MZ,NA,NC,NE,NF,NG,NI,NL,NO,NP,NR,NU,NZ,OM,PA,PE,PF,PG,PH,PK,PL,PM,PN,PR,PS,PT,PW,PY,QA,RE,RO,RS,RU,RW,SA,SB,SC,SD,SE,SG,SH,SI,SJ,SK,SL,SM,SN,SO,SR,SS,ST,SV,SX,SY,SZ,TC,TD,TF,TG,TH,TJ,TK,TL,TM,TN,TO,TR,TT,TV,TW,TZ,UA,UG,UM,US,UY,UZ,VA,VC,VE,VG,VI,VN,VU,WF,WS,YE,YT,ZA,ZM,ZW'.split(',');
async function vueDemandes(v){
  const filtre=etat.filtreDemandes||'';const fp=etat.filtreDemandesPays||'',fl=etat.filtreDemandesLangue||'',fv=etat.filtreDemandesVille||'';
  const q=new URLSearchParams(Object.entries({statut:filtre,pays:fp,langue:fl,ville:fv}).filter(([,x])=>x));
  const liste=await api('GET',`/demandes-site${q.toString()?`?${q}`:''}`);
  const paysTries=PAYS_ISO_SH.map(c=>[c,nomPaysDemande(c)]).sort((a,b)=>a[1].localeCompare(b[1],'fr'));
  const admin=etat.moi.utilisateur.role==='administration';
  const ligne=(lib,val)=>val?`<div><b>${esc(lib)} :</b> <span class="donnee">${esc(val)}</span></div>`:'';
  v.innerHTML=`<div class="entete"><div><h2>Demandes</h2><p>Reçues par le formulaire du site. Supprimées automatiquement après 24 mois.</p></div>
    <div class="champ"><label class="lbl" for="demandes-filtre">Statut</label><select id="demandes-filtre"><option value="">Tous</option>${Object.entries(STATUT_DEMANDE).map(([c,n])=>`<option value="${c}"${c===filtre?' selected':''}>${n}</option>`).join('')}</select></div>
    <div class="champ"><label class="lbl" for="demandes-pays">Pays</label><select id="demandes-pays"><option value="">Tous</option>${paysTries.map(([c,n])=>`<option value="${c}"${c===fp?' selected':''}>${esc(n)}</option>`).join('')}</select></div>
    <div class="champ"><label class="lbl" for="demandes-ville">Ville</label><input id="demandes-ville" value="${esc(fv)}" placeholder="Contient…"></div>
    <div class="champ"><label class="lbl" for="demandes-langue">Langue</label><select id="demandes-langue"><option value="">Toutes</option>${Object.entries(LANGUE_CONTACT).map(([c,n])=>`<option value="${c}"${c===fl?' selected':''}>${esc(n)}</option>`).join('')}</select></div></div>
    ${liste.length?liste.map(d=>`<article class="panneau-c" data-demande="${esc(d.id)}"><h3>${esc(TYPE_DEMANDE[d.type]||d.type)} · <span class="donnee">${esc(d.organisation)}</span> <span class="badge">${esc(STATUT_DEMANDE[d.statut]||d.statut)}</span></h3>
      <p class="note">Demande n° ${esc(d.id)} · ${esc(new Date(d.recu_le).toLocaleString('fr-CA'))} · ${esc(d.pays_code?nomPaysDemande(d.pays_code):(PAYS_DEMANDE[d.pays]||d.pays))}${d.ville?` · ${esc(d.ville)}`:''} · contact en ${esc(LANGUE_CONTACT[d.langue_contact||d.langue]||d.langue)}${d.profil_pays_nom?` · profil de pays : ${esc(d.profil_pays_nom)}`:''}</p>
      ${ligne('Nom',d.nom)}${ligne('Fonction',d.fonction)}${ligne('Courriel',d.courriel)}${d.telephone?`<div><b>Téléphone ou WhatsApp :</b> <a class="donnee" href="tel:${esc(d.telephone)}">${esc(d.telephone)}</a>${d.telephone_a_verifier?' <span class="badge">numéro à vérifier</span>':''}</div>`:''}${ligne('Type d’organisation',d.type_organisation)}${ligne('Format',d.format)}${ligne('Établissements',d.nb_etablissements)}${ligne('Offre',d.offre)}${ligne('Sujet',d.sujet)}
      <p class="donnee demande-message" style="white-space:pre-wrap;overflow-wrap:anywhere;margin-top:10px">${esc(d.message)}</p>
      <div class="actions"><div class="champ"><label class="lbl" for="demande-statut-${esc(d.id)}">Changer le statut</label><select id="demande-statut-${esc(d.id)}" data-statut-demande="${esc(d.id)}">${Object.entries(STATUT_DEMANDE).map(([c,n])=>`<option value="${c}"${c===d.statut?' selected':''}>${n}</option>`).join('')}</select></div>
      ${admin?`<button class="btn" type="button" data-supprimer-demande="${esc(d.id)}">Supprimer</button>`:''}</div></article>`).join(''):'<div class="panneau-c"><p>Aucune demande.</p></div>'}`;
  $('#demandes-filtre').onchange=e=>{etat.filtreDemandes=e.target.value;afficher();};
  $('#demandes-pays').onchange=e=>{etat.filtreDemandesPays=e.target.value;afficher();};
  $('#demandes-langue').onchange=e=>{etat.filtreDemandesLangue=e.target.value;afficher();};
  $('#demandes-ville').onchange=e=>{etat.filtreDemandesVille=e.target.value.trim();afficher();};
  v.querySelectorAll('[data-statut-demande]').forEach(s=>{s.onchange=()=>agir(s,()=>api('PUT',`/demandes-site/${s.dataset.statutDemande}`,{statut:s.value}),'Statut enregistré.');});
  v.querySelectorAll('[data-supprimer-demande]').forEach(b=>{b.onclick=()=>modale('Supprimer cette demande ?','<p>Tous ses renseignements seront effacés. Cette action est définitive.</p>',[{label:'Annuler'},{label:'Supprimer',dan:true,run:async()=>{try{await api('DELETE',`/demandes-site/${b.dataset.supprimerDemande}`);toast('Demande supprimée.');afficher();return true;}catch(e){toast(e.message,true);return false;}}}]);});
}
