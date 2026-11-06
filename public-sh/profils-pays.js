async function choixProfilProduction(h,cible){
  const profils=await api('GET',`/hopitaux/${h.id}/golive/profils-pays${cible?`?cible=${encodeURIComponent(cible)}`:''}`);
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

/** Plusieurs productions reliées : le choix du pays est toujours explicite. */
function choisirProduction(productions){
  return new Promise((resoudre)=>{
    modale('Production visée',`<label for="production-visee">Dans quelle production passer cet établissement ?</label><select id="production-visee"><option value="">Choisir</option>${productions.map(p=>`<option value="${esc(p.code)}">${esc(p.nom)}</option>`).join('')}</select>`,
      [{label:'Annuler',run:()=>{resoudre(null);return true;}},{label:'Continuer',pri:true,run:()=>{const v=$('#production-visee').value;if(!v){toast('Choisissez la production.',true);return false;}resoudre(v);return true;}}]);
  });
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
