async function gererRolesPersonnalises(){
  try{
    const donnees=await api('GET','/roles-personnalises');
    modale('Rôles personnalisés',`<p>Les permissions sont vérifiées par les API ; les périmètres sont appliqués dans PostgreSQL. Les comptes internes restent administrés uniquement par l’administration.</p>
      <label for="rp-existant">Rôle</label><select id="rp-existant"><option value="">Nouveau rôle</option>${donnees.roles.map(r=>`<option value="${r.id}">${esc(r.nom)}</option>`).join('')}</select>
      <label for="rp-nom">Nom</label><input id="rp-nom" maxlength="100">
      <label for="rp-base">Fonction de base</label><select id="rp-base">${donnees.bases.map(b=>`<option value="${b}">${esc(traduireTexte(LIB.role[b]||b))}</option>`).join('')}</select>
      <label class="case"><input id="rp-actif" type="checkbox" checked>Actif</label><div id="rp-permissions"></div>`,[
        {label:'Fermer'},{label:'Enregistrer',pri:true,run:async()=>{try{
          const id=$('#rp-existant').value;
          await api(id?'PUT':'POST',id?`/roles-personnalises/${id}`:'/roles-personnalises',{nom:$('#rp-nom').value,base_role:$('#rp-base').value,actif:$('#rp-actif').checked,permissions:[...$('#rp-permissions').querySelectorAll('input:checked')].map(x=>x.value)});
          toast('Rôle enregistré. Les sessions des personnes concernées sont révoquées.');return true;
        }catch(e){toast(e.message,true);return false;}}}
      ]);
    const afficher=(selection=[])=>{
      const base=$('#rp-base').value,groupes=new Map();
      for(const a of donnees.actions.filter(a=>a.bases.includes(base))){const g=a.cle.split('/')[1]||'compte';if(!groupes.has(g))groupes.set(g,[]);groupes.get(g).push(a);}
      $('#rp-permissions').innerHTML=[...groupes].map(([g,actions])=>`<details><summary>${esc(g)}</summary>${actions.map(a=>`<label class="case"><input type="checkbox" value="${esc(a.cle)}"${selection.includes(a.cle)?' checked':''}>${esc(a.cle)}</label>`).join('')}</details>`).join('');
    };
    $('#rp-base').onchange=()=>afficher();$('#rp-existant').onchange=()=>{
      const r=donnees.roles.find(r=>String(r.id)===$('#rp-existant').value);$('#rp-nom').value=r?.nom||'';$('#rp-base').value=r?.base_role||donnees.bases[0];$('#rp-actif').checked=r?.actif!==false;afficher(r?.permissions||[]);
    };afficher();
  }catch(e){toast(e.message,true);}
}
async function gererPerimetres(m){
  try{
    const [aff,refs,roles]=await Promise.all([api('GET',`/equipe/${m.id}/affectations`),api('GET','/perimetres/references'),api('GET','/roles-personnalises')]);
    const nom=a=>a.type==='global'?'Global explicite':a.type==='pays'?a.pays_code:(a.type==='client'?refs.clients:a.type==='hopital'?refs.hopitaux:refs.projets).find(x=>String(x.id)===String(a.organisation_id||a.hopital_id||a.projet_id))?.nom||'Périmètre';
    modale(`Périmètres · ${m.nom}`,`<p>Sans affectation, les données métier ne sont pas accessibles. Une affectation à un projet ne donne pas accès aux autres projets du même hôpital.</p>
      <label for="pm-role">Rôle personnalisé</label><select id="pm-role"><option value="">Choisir un rôle</option>${roles.roles.filter(r=>r.actif).map(r=>`<option value="${r.id}">${esc(r.nom)}</option>`).join('')}</select><button class="btn" id="pm-attribuer">Attribuer le rôle</button>
      <ul>${aff.map(a=>`<li>${esc(a.type)} · ${esc(nom(a))} <button class="btn" data-retirer-aff="${a.id}">Retirer</button></li>`).join('')||'<li>Aucune affectation.</li>'}</ul>
      <label for="pm-type">Nouveau périmètre</label><select id="pm-type"><option value="projet">Projet</option><option value="hopital">Établissement</option><option value="client">Client</option><option value="pays">Pays</option><option value="global">Global explicite</option></select><div id="pm-cible"></div><button class="btn" id="pm-ajouter">Ajouter l’affectation</button>`,[{label:'Fermer'}]);
    const cible=()=>{
      const t=$('#pm-type').value;
      $('#pm-cible').innerHTML=t==='global'?'<p>Autorise tous les périmètres métier dans les limites des permissions du rôle. Cette autorisation est journalisée.</p>':t==='pays'?'<label for="pm-valeur">Code pays ISO</label><input id="pm-valeur" maxlength="2">':`<label for="pm-valeur">${esc(traduireTexte(t==='projet'?'Projet':t==='hopital'?'Établissement':'Client'))}</label><select id="pm-valeur"><option value="">Choisir</option>${(t==='projet'?refs.projets:t==='hopital'?refs.hopitaux:refs.clients).map(x=>`<option value="${x.id}">${esc(x.nom)}</option>`).join('')}</select>`;
    };
    $('#pm-type').onchange=cible;cible();
    $('#pm-attribuer').onclick=async()=>{try{await api('PUT',`/equipe/${m.id}/role-personnalise`,{role_id:Number($('#pm-role').value)});toast('Rôle attribué ; sessions révoquées.');}catch(e){toast(e.message,true);}};
    $('#pm-ajouter').onclick=async()=>{try{const t=$('#pm-type').value,key={pays:'pays_code',client:'organisation_id',hopital:'hopital_id',projet:'projet_id'}[t],b={type:t};if(key)b[key]=$('#pm-valeur').value;await api('POST',`/equipe/${m.id}/affectations`,b);await gererPerimetres(m);}catch(e){toast(e.message,true);}};
    document.querySelectorAll('[data-retirer-aff]').forEach(b=>{b.onclick=async()=>{try{await api('POST',`/equipe/${m.id}/affectations/${b.dataset.retirerAff}/retirer`,{});await gererPerimetres(m);}catch(e){toast(e.message,true);}};});
  }catch(e){toast(e.message,true);}
}
