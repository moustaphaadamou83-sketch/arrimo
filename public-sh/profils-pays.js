async function choixProfilProduction(h){
  const profils=await api('GET',`/hopitaux/${h.id}/golive/profils-pays`);
  if(!profils.length)throw new Error('Aucun profil hospitalier compatible avec ce pays n’est configuré.');
  return {
    html:`<label for="profil-production">Profil hospitalier de production</label><select id="profil-production">${profils.length>1?'<option value="">Choisir</option>':''}${profils.map(p=>`<option value="${esc(p.id)}">${esc(p.nom)} (${esc(p.code)})</option>`).join('')}</select>`,
    lire:()=>{
      const id=Number($('#profil-production').value);
      if(!Number.isSafeInteger(id)||!profils.some(p=>Number(p.id)===id))throw new Error('Choisissez un profil hospitalier.');
      return {config_id:id};
    }
  };
}

async function relierHopitalAvecProfil(h,bouton){
  if(bouton)bouton.disabled=true;
  try{
    const profils=await api('GET',`/hopitaux/${h.id}/profils-pays`);
    if(!profils.length)throw new Error('Aucun profil hospitalier compatible avec ce pays n’est configuré.');
    const envoyer=(id,b)=>agir(b,()=>api('POST',`/hopitaux/${h.id}/relier`,{config_id:Number(id)}),r=>r.cree?'Établissement créé dans l’environnement.':'Établissement relié.');
    if(profils.length===1)return await envoyer(profils[0].id,bouton);
    modale('Choisir le profil hospitalier',`<p>Plusieurs profils hospitaliers correspondent : choisissez explicitement le profil.</p>
      <label for="profil-pays-cible">Profil hospitalier</label><select id="profil-pays-cible"><option value="">Choisir</option>${profils.map(p=>`<option value="${esc(p.id)}">${esc(p.nom)} (${esc(p.code)})</option>`).join('')}</select>`,[
      {label:'Annuler'},{label:'Relier',pri:true,run:async b=>{
        const id=$('#profil-pays-cible').value;
        if(!id){toast('Choisissez un profil hospitalier.',true);return false;}
        return !!(await envoyer(id,b));
      }}
    ]);
  }catch(e){toast(e.message,true);}
  finally{if(bouton?.isConnected)bouton.disabled=false;}
}
