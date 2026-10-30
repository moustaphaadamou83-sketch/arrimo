/* Une présence n'est jamais une mesure d'activité. Aucun rendez-vous ou contenu privé n'est lu. */
const PRESENCES_SH={en_ligne:'En ligne',occupe:'Occupé',en_reunion:'En réunion',en_pause:'En pause',absent:'Absent',hors_ligne:'Hors ligne'};
let presencesSH=new Map(),presenceEnCours=false,dernierSignalSH=0;
const libellePresence=statut=>traduireTexte(PRESENCES_SH[statut]||PRESENCES_SH.hors_ligne);
const presenceHTML=id=>`<span class="sh-presence hors_ligne" data-presence-user="${Number(id)}"><i aria-hidden="true"></i><span>${esc(libellePresence(presencesSH.get(Number(id))))}</span></span>`;
const responsablePresenceHTML=(id,nom)=>esc(nom||'—')+(id?presenceHTML(id):'');
function filtrerDisponibles(){
  document.querySelectorAll('[data-disponibles-pour]').forEach(f=>{
    const s=document.getElementById(f.dataset.disponiblesPour);if(!s)return;
    s.querySelectorAll('[data-presence-option]').forEach(o=>{o.hidden=f.checked&&presencesSH.get(Number(o.dataset.presenceOption))!=='en_ligne'&&!o.selected;});
  });
}
document.addEventListener('change',e=>{if(e.target.matches('[data-disponibles-pour]'))filtrerDisponibles();});
async function rafraichirPresence(){
  const u=etat.moi?.utilisateur;
  if(presenceEnCours||!etat.token||!u?.totp_actif||u.mdp_temporaire||document.hidden)return;
  presenceEnCours=true;
  const token=etat.token;
  try{
    if(Date.now()-dernierSignalSH>30000){await api('POST','/moi/presence',{});dernierSignalSH=Date.now();}
    const r=u.role_personnalise_id&&!u.droits_personnalises?.includes('GET /presence')?{employes:[{id:u.id,statut:u.presence_manuelle}]}:await api('GET','/presence');
    if(etat.token!==token||etat.moi?.utilisateur?.id!==u.id)return;
    presencesSH=new Map(r.employes.map(u=>[u.id,u.statut]));
    if(personnelCache)personnelCache=personnelCache.map(p=>({...p,presence:presencesSH.get(p.id)||'hors_ligne'}));
    document.querySelectorAll('[data-presence-user]').forEach(el=>{
      const statut=presencesSH.get(Number(el.dataset.presenceUser))||'hors_ligne';
      el.className='sh-presence '+statut;el.querySelector('span').textContent=libellePresence(statut);
    });
    document.querySelectorAll('[data-presence-option]').forEach(o=>{o.textContent=`${o.dataset.nom} · ${traduireTexte(o.dataset.role)} · ${libellePresence(presencesSH.get(Number(o.dataset.presenceOption)))}`;});
    filtrerDisponibles();
    const profil=$('#sh-profil-presence');
    if(!profil.querySelector('#sh-mon-statut')){
      profil.innerHTML=`<span id="sh-identite-presence"></span><label for="sh-mon-statut">${esc(traduireTexte('Ma disponibilité'))}</label><select id="sh-mon-statut">${Object.entries(PRESENCES_SH).map(([k,v])=>`<option value="${k}">${esc(traduireTexte(v))}</option>`).join('')}</select><span class="note">${esc(traduireTexte('Connexion récente et statut déclaré ; aucune mesure de travail.'))}</span>`;
      $('#sh-mon-statut').onchange=async e=>{const statut=e.target.value;try{await api('PUT','/moi/presence',{statut});u.presence_manuelle=statut;await rafraichirPresence();}catch(err){toast(err.message,true);}};
    }
    profil.hidden=false;$('#sh-identite-presence').textContent=[u.nom,u.fonction].filter(Boolean).join(' · ');
    const select=$('#sh-mon-statut');if(document.activeElement!==select)select.value=u.presence_manuelle||'en_ligne';
    select.querySelectorAll('option').forEach(o=>{o.textContent=libellePresence(o.value);});
  }catch{/* Une panne de présence ne bloque jamais le clavier ni le travail métier. */}
  finally{presenceEnCours=false;}
}
document.addEventListener('sh:session-reset',()=>{presencesSH.clear();dernierSignalSH=0;$('#sh-profil-presence').hidden=true;$('#sh-profil-presence').replaceChildren();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void rafraichirPresence();});
setInterval(()=>void rafraichirPresence(),10000);
