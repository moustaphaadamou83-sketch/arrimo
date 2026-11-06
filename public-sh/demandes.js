/* Écran « Demandes » : ce que les visiteurs envoient par le formulaire du site. Tout est affiché en texte. */
const STATUT_DEMANDE={nouvelle:'Nouvelle',en_cours:'En cours',traitee:'Traitée',rejetee:'Rejetée'};
const TYPE_DEMANDE={demo:'Démonstration',devis:'Devis',contact:'Contact'};
const PAYS_DEMANDE={canada:'Canada',europe:'Europe',afrique:'Afrique',autre:'Autre'};
async function vueDemandes(v){
  const filtre=etat.filtreDemandes||'';
  const liste=await api('GET',`/demandes-site${filtre?`?statut=${encodeURIComponent(filtre)}`:''}`);
  const admin=etat.moi.utilisateur.role==='administration';
  const ligne=(lib,val)=>val?`<div><b>${esc(lib)} :</b> <span class="donnee">${esc(val)}</span></div>`:'';
  v.innerHTML=`<div class="entete"><div><h2>Demandes</h2><p>Reçues par le formulaire du site. Supprimées automatiquement après 24 mois.</p></div>
    <div class="champ"><label class="lbl" for="demandes-filtre">Statut</label><select id="demandes-filtre"><option value="">Tous</option>${Object.entries(STATUT_DEMANDE).map(([c,n])=>`<option value="${c}"${c===filtre?' selected':''}>${n}</option>`).join('')}</select></div></div>
    ${liste.length?liste.map(d=>`<article class="panneau-c" data-demande="${esc(d.id)}"><h3>${esc(TYPE_DEMANDE[d.type]||d.type)} · <span class="donnee">${esc(d.organisation)}</span> <span class="badge">${esc(STATUT_DEMANDE[d.statut]||d.statut)}</span></h3>
      <p class="note">Demande n° ${esc(d.id)} · ${esc(new Date(d.recu_le).toLocaleString('fr-CA'))} · ${esc(PAYS_DEMANDE[d.pays]||d.pays)} · ${esc(d.langue.toUpperCase())}</p>
      ${ligne('Nom',d.nom)}${ligne('Fonction',d.fonction)}${ligne('Courriel',d.courriel)}${ligne('Téléphone ou WhatsApp',d.telephone)}${ligne('Type d’organisation',d.type_organisation)}${ligne('Format',d.format)}${ligne('Établissements',d.nb_etablissements)}${ligne('Offre',d.offre)}${ligne('Sujet',d.sujet)}
      <p class="donnee demande-message" style="white-space:pre-wrap;overflow-wrap:anywhere;margin-top:10px">${esc(d.message)}</p>
      <div class="actions"><div class="champ"><label class="lbl" for="demande-statut-${esc(d.id)}">Changer le statut</label><select id="demande-statut-${esc(d.id)}" data-statut-demande="${esc(d.id)}">${Object.entries(STATUT_DEMANDE).map(([c,n])=>`<option value="${c}"${c===d.statut?' selected':''}>${n}</option>`).join('')}</select></div>
      ${admin?`<button class="btn" type="button" data-supprimer-demande="${esc(d.id)}">Supprimer</button>`:''}</div></article>`).join(''):'<div class="panneau-c"><p>Aucune demande.</p></div>'}`;
  $('#demandes-filtre').onchange=e=>{etat.filtreDemandes=e.target.value;afficher();};
  v.querySelectorAll('[data-statut-demande]').forEach(s=>{s.onchange=()=>agir(s,()=>api('PUT',`/demandes-site/${s.dataset.statutDemande}`,{statut:s.value}),'Statut enregistré.');});
  v.querySelectorAll('[data-supprimer-demande]').forEach(b=>{b.onclick=()=>modale('Supprimer cette demande ?','<p>Tous ses renseignements seront effacés. Cette action est définitive.</p>',[{label:'Annuler'},{label:'Supprimer',dan:true,run:async()=>{try{await api('DELETE',`/demandes-site/${b.dataset.supprimerDemande}`);toast('Demande supprimée.');afficher();return true;}catch(e){toast(e.message,true);return false;}}}]);});
}
