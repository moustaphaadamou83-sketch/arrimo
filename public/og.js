/* OG réutilise les API et les autorisations existantes. Conversation en mémoire uniquement. */
(() => {
  const panneau = document.querySelector('#og-panel');
  const ouvrir = document.querySelector('#og-open');
  const log = document.querySelector('#og-messages');
  const champ = document.querySelector('#og-question');
  const envoyer = document.querySelector('#og-envoyer');
  let sequence = 0;
  let occupe = false;
  let patientSelectionne = null;
  const O = (cle, vars) => t(`og.${cle}`, vars);
  // Nom affiché de l'assistant (Paramètres → OG de l'établissement) ; « OG » reste l'identifiant technique.
  const nomOg = () => window.ArrimoNomOg?.nom() || 'OG';
  const avecNom = (x) => (window.ArrimoNomOg ? window.ArrimoNomOg.appliquer(x) : x);
  /** Langue de conversation (préférence vocale personnelle, sinon langue de l'interface) : repli des questions ambiguës. */
  const langueConversation = () => window.ArrimoOgVoixPrefs?.langueConversation?.() || langue;
  /** « Charles, combien de lits ? » : l'appel par le nom de l'assistant n'est pas une partie de la question. */
  function sansAppel(q) {
    const n = nomOg().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const r = new RegExp(`^(?:(?:hey|hé|he|ok|okay|dis|dites|bonjour|salut|hello|hi)[ ,]+)?(?:${n}|OG)\\s*[,:!.]?\\s+(?=\\S)`, 'i');
    return q.replace(r, '').trim() || q;
  }
  const heureOg = () => new Date().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', timeZone: fuseau() });
  function message(texte, utilisateur = false, mode = null) {
    const el = document.createElement('div');
    el.className = `og-message${utilisateur ? ' utilisateur' : ''}`;
    const nom = document.createElement('span'); nom.className = 'og-auteur'; nom.textContent = utilisateur ? O('vous') : nomOg();
    const contenu = document.createElement('span'); contenu.textContent = texte;
    el.append(nom, contenu);
    if (mode) {
      const source = document.createElement('span'); source.className = 'og-source';
      source.textContent = O(mode === 'ia' ? 'source_ia' : 'source_locale', { heure: heureOg() }); el.append(source);
    }
    log.append(el);
    while (log.children.length > 20) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function fermer() { if (panneau.open) panneau.close(); }
  function reinitialiser(effacerPatient = true) {
    sequence++; fermer(); log.replaceChildren(); champ.value = ''; occupe = false;
    if(effacerPatient)patientSelectionne=null;
    envoyer.disabled = false;
  }
  function action(libelle, fn) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = libelle;
    b.onclick = fn; document.querySelector('#og-actions').append(b);
  }
  function naviguer(vue) { fermer(); allerA(vue); }
  function detailsFiche(f) {
    const en=langue==='en',p=f.patient,fmt=x=>new Date(x).toLocaleString(locale()),
      lignes=[`${en?'Patient':'Patient'} ${p.prenom} ${p.nom} — ${f.etablissement.nom} · ${p.reference}${p.reference_locale ? ` · ${en?'record':'dossier'} ${p.reference_locale}` : ''}`,
      `${en?'Date of birth':'Date de naissance'} : ${String(p.date_naissance).slice(0,10)} · ${en?'Pathway':'Parcours'} : ${p.parcours}`,
      ...f.lits.map(x=>`${en?(x.etat==='occupe'?'Occupied bed':'Reserved bed'):(x.etat==='occupe'?'Lit occupé':'Lit réservé')} ${x.lit} · ${x.unite} · ${en?'room':'chambre'} ${x.chambre}${x.etat_depuis?` · ${en?'since':'depuis'} ${fmt(x.etat_depuis)}`:''}`),
      ...f.civieres.map(x=>`${en?'Stretcher':'Civière'} ${x.code} · ${x.etat}${x.arrivee_le?` · ${en?'since':'depuis'} ${fmt(x.arrivee_le)}`:''}`),
      ...f.admissions.map(x=>`${en?'Admission':'Admission'} #${x.id} · ${x.statut} · ${fmt(x.cree_le)}`),
      ...f.transferts.map(x=>`${en?'Transfer':'Transfert'} ${x.numero} · ${x.origine_nom} → ${x.destination_nom} · ${x.statut}`),
      ...f.alertes.map(x=>`${en?'Transfer alert':'Alerte de transfert'} · ${fmt(x.date)} · ${x.message}`),
      ...f.historique.map(x=>`${fmt(x.date)} · ${x.action}${x.ancien_etat||x.nouvel_etat?` · ${x.ancien_etat||''} → ${x.nouvel_etat||''}`:''}`)];
    if (!f.lits.length && !f.civieres.length) lignes.push(en?'No occupied/reserved bed or occupied stretcher is currently recorded.':'Aucun lit occupé/réservé ou civière occupée actuellement enregistré.');
    if (!f.admissions.length) lignes.push(en?'No admission is recorded.':'Aucune admission enregistrée.');
    if (!f.transferts.length) lignes.push(en?'No accessible transfer is recorded.':'Aucun transfert accessible enregistré.');
    return lignes.join('\n');
  }
  /* Carte d'action supervisée : informations utilisées, manques, incertitudes, conséquence, validateur ; Modifier, Annuler, Confirmer. */
  async function carteAction(parent, proposition, etab) {
    const en = langue === 'en', T = (fr, anglais) => (en ? anglais : fr);
    const carte = document.createElement('div'); carte.className = 'og-carte-action'; parent.append(carte);
    const idem = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');
    let a;
    try { a = await api('POST', '/og/actions', { etablissement_id: etab, outil: proposition.outil, entree: proposition.entree, idempotence: idem }); }
    catch (e) { carte.textContent = e.message; return; }
    const titre = { preparer_admission: T('Action proposée : préparer une demande d’admission', 'Proposed action: prepare an admission request'), ticket_support: T('Action proposée : créer un ticket de support', 'Proposed action: create a support ticket'), preparer_transfert: T('Action proposée : préparer une demande de transfert', 'Proposed action: prepare a transfer request'), relancer_transfert: T('Action proposée : relancer un transfert en attente', 'Proposed action: send a transfer reminder') }[a.outil] || a.outil;
    const champ = (id, lib, valeur, attrs = '') => `<label class="lbl" for="${id}">${lib}</label><input id="${id}" value="${String(valeur ?? '').replace(/"/g, '&quot;')}" ${attrs}>`;
    const destinations = (a.options.destinations || []).map((d) => `<option value="${d.id}"${d.id === a.entree.destination_id ? ' selected' : ''}>${d.nom.replace(/</g, '&lt;')} · ${d.libres_confirmes} ${T('lit(s) confirmé(s)', 'confirmed bed(s)')}${d.minutes_route != null ? ` · ~${d.minutes_route} min` : ''}</option>`).join('');
    const champs = a.outil === 'relancer_transfert'
      ? `${champ(`oa-num-${a.id}`, T('Numéro du transfert', 'Transfer number'), a.entree.numero, 'maxlength="30"')}${a.resume?.destination ? `<p>${T('Destination', 'Destination')} : ${a.resume.destination.replace(/</g, '&lt;')} · ${T('relances', 'reminders')} : ${a.resume.relances} · ${T('dernière action il y a', 'last action')} ${a.resume.minutes_depuis_derniere} min</p>` : ''}`
      : a.outil === 'preparer_transfert'
      ? `${champ(`oa-ref-${a.id}`, T('Référence patient', 'Patient reference'), a.entree.patient_ref, 'maxlength="40"')}<label class="lbl" for="oa-type-${a.id}">${T('Unité demandée', 'Requested unit')}</label><select id="oa-type-${a.id}"><option value="">${T('Choisir…', 'Choose…')}</option>${(a.options.types || []).map((t) => `<option value="${t.id}"${t.id === a.entree.type_id ? ' selected' : ''}>${t.nom.replace(/</g, '&lt;')}</option>`).join('')}</select>
        <label class="lbl" for="oa-dest-${a.id}">${T('Destination (proximité d’abord, lits confirmés seulement)', 'Destination (nearest first, confirmed beds only)')}</label><select id="oa-dest-${a.id}"><option value="">${T('Choisir…', 'Choose…')}</option>${destinations}</select>${a.options.types && !destinations ? `<p class="note">${T('Choisissez l’unité, puis préparez de nouveau pour voir les destinations.', 'Choose the unit, then prepare again to see destinations.')}</p>` : ''}`
      : a.outil === 'preparer_admission'
      ? `${champ(`oa-ref-${a.id}`, T('Référence patient', 'Patient reference'), a.entree.patient_ref, 'maxlength="40"')}<label class="lbl" for="oa-type-${a.id}">${T('Unité demandée', 'Requested unit')}</label><select id="oa-type-${a.id}"><option value="">${T('Choisir…', 'Choose…')}</option>${(a.options.types || []).map((t) => `<option value="${t.id}"${t.id === a.entree.type_id ? ' selected' : ''}>${t.nom.replace(/</g, '&lt;')}</option>`).join('')}</select>`
      : `${champ(`oa-titre-${a.id}`, T('Titre', 'Title'), a.entree.titre, 'maxlength="160"')}<label class="lbl" for="oa-desc-${a.id}">${T('Description (sans référence patient)', 'Description (no patient reference)')}</label><textarea id="oa-desc-${a.id}" maxlength="2000"></textarea>`;
    const liste = (l) => (l || []).map((x) => ({ numero: T('numéro du transfert', 'transfer number'), patient_ref: T('référence patient', 'patient reference'), type_id: T('unité', 'unit'), destination_id: T('destination', 'destination'), titre: T('titre', 'title'), description: T('description', 'description') }[x] || x)).join(', ');
    carte.innerHTML = `<b>${titre}</b><p class="note">${T('Niveau', 'Level')} ${a.niveau} · ${T('Validation', 'Validation')} : ${a.validateur}</p>
      ${a.resume?.trajet ? `<p>${T('Trajet', 'Travel')} : ${a.resume.trajet}</p>` : ''}${a.resume?.lits_libres != null ? `<p>${T('Lits libres dans cette unité', 'Available beds in this unit')} : ${a.resume.lits_libres} · ${T('mis à jour', 'updated')} ${new Date(a.resume.mise_a_jour).toLocaleTimeString(en ? 'en-CA' : 'fr-CA')}</p>` : ''}
      <div class="og-carte-champs">${champs}</div>
      ${a.manquants?.length ? `<p class="og-avert">${T('À compléter', 'Missing')} : ${liste(a.manquants)}</p>` : ''}${a.incertains?.length ? `<p class="og-avert">${T('À vérifier', 'To check')} : ${liste(a.incertains)}</p>` : ''}
      <p>${T('Conséquence', 'Consequence')} : ${a.consequence}</p>
      <div class="ligne serre"><button class="btn" type="button" data-oa="annuler">${T('Annuler', 'Cancel')}</button><button class="btn pri" type="button" data-oa="confirmer">${T('Confirmer', 'Confirm')}</button></div><p class="og-resultat" aria-live="polite"></p>`;
    const res = carte.querySelector('.og-resultat');
    const entree = () => (a.outil === 'relancer_transfert' ? { numero: carte.querySelector(`#oa-num-${a.id}`).value.trim() }
      : a.outil === 'preparer_transfert'
      ? { patient_ref: carte.querySelector(`#oa-ref-${a.id}`).value.trim(), type_id: Number(carte.querySelector(`#oa-type-${a.id}`).value) || null, destination_id: Number(carte.querySelector(`#oa-dest-${a.id}`).value) || null }
      : a.outil === 'preparer_admission'
      ? { patient_ref: carte.querySelector(`#oa-ref-${a.id}`).value.trim(), type_id: Number(carte.querySelector(`#oa-type-${a.id}`).value) || null }
      : { titre: carte.querySelector(`#oa-titre-${a.id}`).value, description: carte.querySelector(`#oa-desc-${a.id}`).value });
    const fermer = (texte) => { carte.querySelectorAll('button,input,select,textarea').forEach((x) => { x.disabled = true; }); res.textContent = texte; };
    carte.querySelector('[data-oa="annuler"]').onclick = async () => { try { await api('POST', `/og/actions/${a.id}/annuler`, { etablissement_id: etab }); } catch { /* déjà close */ } fermer(T('Proposition annulée. Rien n’a été fait.', 'Proposal cancelled. Nothing was done.')); };
    carte.querySelector('[data-oa="confirmer"]').onclick = async (ev) => {
      ev.currentTarget.disabled = true;
      try {
        const r = await api('POST', `/og/actions/${a.id}/confirmer`, { etablissement_id: etab, confirmation: true, entree: entree() });
        // Succès affiché seulement d'après la réponse de l'API.
        fermer(r.outil === 'relancer_transfert' ? T(`Relance envoyée pour ${r.resultat.numero} (relance n° ${r.resultat.relances}).`, `Reminder sent for ${r.resultat.numero} (reminder #${r.resultat.relances}).`)
          : r.outil === 'preparer_transfert' ? T(`Demande de transfert ${r.resultat.numero} envoyée pour ${r.resultat.patient_ref} : en attente d’acceptation par la destination.`, `Transfer request ${r.resultat.numero} sent for ${r.resultat.patient_ref}: awaiting acceptance by the destination.`)
          : r.outil === 'preparer_admission' ? T(`Demande d’admission n° ${r.resultat.demande_id} créée pour ${r.resultat.patient_ref} (en attente de décision).`, `Admission request #${r.resultat.demande_id} created for ${r.resultat.patient_ref} (awaiting decision).`)
          : T(`Ticket de support créé${r.resultat.reference ? ` : ${r.resultat.reference}` : ''}.`, `Support ticket created${r.resultat.reference ? `: ${r.resultat.reference}` : ''}.`));
      } catch (e) { ev.currentTarget.disabled = false; res.textContent = e.message; }
    };
  }
  /** Proposition OG en CHSLD (tâche, demande de rappel) : rien n'est écrit avant la confirmation ; même API que l'interface. */
  function carteChsld(parent, p, etab) {
    const en = langue === 'en', carte = document.createElement('div'); carte.className = 'og-carte-action';
    const titre = document.createElement('b'); titre.textContent = p.type === 'tache' ? (en ? 'Proposed task' : 'Tâche proposée') : p.type === 'retour' ? (en ? 'Proposed return to the CHSLD' : 'Retour vers le CHSLD proposé') : (en ? 'Proposed callback request' : 'Demande de rappel proposée');
    const detail = document.createElement('p'); detail.textContent = p.type === 'retour' ? `${p.resident_ref} → ${p.chsld}` : (p.corps.titre || p.corps.sujet);
    // Retour : la date prévue est choisie par la personne (OG ne la fixe pas)
    let date = null;
    if (p.type === 'retour') { date = document.createElement('input'); date.type = 'datetime-local'; date.setAttribute('aria-label', en ? 'Planned return date' : 'Date de retour prévue'); }
    const res = document.createElement('p'); res.className = 'og-resultat'; res.setAttribute('aria-live', 'polite');
    const ligne = document.createElement('div'); ligne.className = 'ligne serre';
    const annuler = document.createElement('button'); annuler.type = 'button'; annuler.className = 'btn'; annuler.textContent = en ? 'Cancel' : 'Annuler';
    const confirmer = document.createElement('button'); confirmer.type = 'button'; confirmer.className = 'btn pri'; confirmer.textContent = en ? 'Confirm' : 'Confirmer';
    const clore = (t2) => { annuler.disabled = true; confirmer.disabled = true; res.textContent = t2; };
    annuler.onclick = () => clore(en ? 'Proposal cancelled. Nothing was done.' : 'Proposition annulée. Rien n’a été fait.');
    confirmer.onclick = async () => {
      confirmer.disabled = true;
      try {
        if (p.type === 'tache') await api('POST', '/chsld/taches', { etablissement_id: etab, ...p.corps });
        else if (p.type === 'retour') await api('POST', `/coordinations/${p.coordination_id}/retour`, { retour_prevu_le: date.value });
        else await api('POST', `/chsld/residents/${p.resident_id}/communications`, p.corps);
        clore(en ? 'Done: recorded and logged.' : 'Fait : enregistré et journalisé.');
      } catch (e) { confirmer.disabled = false; res.textContent = e.message; }
    };
    ligne.append(annuler, confirmer); carte.append(titre, detail, ...(date ? [date] : []), ligne, res); parent.append(carte);
  }
  function cartesPatients(parent, resultats, limite) {
    const box=document.createElement('div');box.className='og-patients';
    if (!resultats.length) {const vide=document.createElement('p');vide.textContent=langue==='en'?'No matching patient in this hospital.':'Aucun patient correspondant dans cet établissement.';box.append(vide);}
    for(const p of resultats){
      const carte=document.createElement('article');carte.className='og-patient-carte';
      const nom=document.createElement('strong');nom.textContent=`${p.prenom} ${p.nom} · ${p.reference}`;
      const etatPatient=document.createElement('span');etatPatient.textContent=langue==='en'?'Select the record to view operational details.':'Sélectionnez le dossier pour consulter les détails opérationnels.';
      const b=document.createElement('button');b.type='button';b.className='btn';
      b.textContent=langue==='en'?'View patient file':'Voir la fiche patient';
      b.setAttribute('aria-label',`${b.textContent} ${p.prenom} ${p.nom}, référence ${p.reference}`);
      b.onclick=async()=>{
        if(!etat.token||!panneau.open)return;
        const ctx=etat.ctx,token=etat.token;
        patientSelectionne=p.id;
        b.disabled=true;
        try{
          const fiche=await api('GET',`/copilote/patients/${encodeURIComponent(p.id)}?etablissement_id=${ctx}`);
          if(ctx!==etat.ctx||token!==etat.token||!panneau.open||patientSelectionne!==p.id)return;
          const el=message(detailsFiche(fiche),false,'local');el.dataset.sensible='1';
          window.dispatchEvent(new CustomEvent('arrimo:og-reponse',{detail:{texte:detailsFiche(fiche),langue, sensible:true}}));
        }catch{if(panneau.open)message(O('erreur'));}
        finally{b.disabled=false;}
      };
      // Historique des passages : ouvert dans l'écran Patients, après la vérification d'identité habituelle.
      const h=document.createElement('button');h.type='button';h.className='btn';h.textContent=O('historique_patient');
      h.setAttribute('aria-label',`${h.textContent} ${p.reference}`);
      h.onclick=()=>{etat.patientsRecherche=p.reference;etat.patientOuvert=null;fermer();allerA('patients');};
      carte.append(nom,etatPatient,b,h);box.append(carte);
    }
    if(limite){const note=document.createElement('p');note.textContent='La liste a été plafonnée; précisez la référence ou la date de naissance.';box.append(note);}
    parent.append(box);
  }
  function demandeCreationPatient(q) {
    const n=q.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    return /(?:creer|enregistrer|ajouter|nouveau|nouvelle|create|register|add)\b.{0,48}\b(?:patient|dossier)|\b(?:patient|dossier)\b.{0,48}\b(?:creer|enregistrer|ajouter|create|register|add)\b/.test(n);
  }
  function formulaireCreationPatient() {
    const host=message(avecNom(langue==='en'?'Prepare a fictitious patient record. Review every field; OG will check for possible duplicates before asking for your confirmation.':'Préparez un dossier patient fictif. Vérifiez chaque champ; OG recherchera les doublons possibles avant de demander votre confirmation.'));
    const form=document.createElement('form');form.className='og-patient-form';
    const champs=[['prenom',langue==='en'?'First name':'Prénom','text'],['nom',langue==='en'?'Last name':'Nom','text'],['date_naissance',langue==='en'?'Date of birth':'Date de naissance','date'],['reference_locale',langue==='en'?'Local ID (optional)':'Identifiant local (facultatif)','text']];
    for(const [name,label,type] of champs){const wrap=document.createElement('label');wrap.className='champ';wrap.textContent=label;const input=document.createElement('input');input.name=name;input.type=type;input.maxLength=type==='date'?undefined:40;input.required=name!=='reference_locale';wrap.append(input);form.append(wrap);}
    // Lecture d'un document fictif (OCR local) : préremplit les champs, qui restent à vérifier avant tout brouillon.
    if(configurationOg?.effectif?.documents){
      const doc=document.createElement('div');doc.className='og-document';
      const typeDoc=document.createElement('select');typeDoc.setAttribute('aria-label',langue==='en'?'Document type':'Type de document');
      for(const [v,fr,en] of [['carte_assurance_maladie','Carte d’assurance maladie (fictive)','Health insurance card (fictitious)'],['piece_identite','Pièce d’identité (fictive)','ID document (fictitious)'],['formulaire_admission','Formulaire d’admission (fictif)','Admission form (fictitious)']]){const o=document.createElement('option');o.value=v;o.textContent=langue==='en'?en:fr;typeDoc.append(o);}
      const fichier=document.createElement('input');fichier.type='file';fichier.accept='image/png,image/jpeg';fichier.setAttribute('capture','environment');fichier.setAttribute('aria-label',langue==='en'?'Read a document':'Lire un document');
      const etatDoc=document.createElement('p');etatDoc.className='note';etatDoc.textContent=langue==='en'?'Photo or scan of a fictitious document. Read locally, never kept. A photo does not prove identity.':'Photo ou numérisation d’un document fictif. Lecture locale, rien n’est conservé. Une photo ne prouve pas l’identité.';
      fichier.onchange=async()=>{const f=fichier.files[0];if(!f)return;if(f.size>5*1024*1024){etatDoc.textContent=langue==='en'?'File too large (5 MB maximum).':'Fichier trop lourd (5 Mo au plus).';return;}
        etatDoc.textContent=langue==='en'?'Reading…':'Lecture en cours…';
        try{const b64=await new Promise((ok,ko)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]);r.onerror=ko;r.readAsDataURL(f);});
          const r=await api('POST','/og/documents/lire',{etablissement_id:etat.ctx,type_document:typeDoc.value,image_base64:b64});
          for(const [k,v] of Object.entries(r.champs)){if(v&&form.elements[k])form.elements[k].value=v;if(form.elements[k])form.elements[k].classList.toggle('a-verifier',r.incertains.includes(k));}
          etatDoc.textContent=r.incertains.length?(langue==='en'?'Check the highlighted fields; unreadable fields stay empty.':'Vérifiez les champs signalés ; ceux qui sont illisibles restent vides.'):(langue==='en'?'Fields prefilled: check them before preparing the draft.':'Champs préremplis : vérifiez-les avant de préparer le brouillon.');
        }catch(e){etatDoc.textContent=e.message;}finally{fichier.value='';}};
      doc.append(typeDoc,fichier,etatDoc);form.append(doc);
    }
    const actions=document.createElement('div');actions.className='ligne';const verifier=document.createElement('button');verifier.type='submit';verifier.className='btn pri';verifier.textContent=langue==='en'?'Check and prepare':'Vérifier et préparer';const annuler=document.createElement('button');annuler.type='button';annuler.className='btn';annuler.textContent=langue==='en'?'Cancel':'Annuler';actions.append(verifier,annuler);form.append(actions);host.append(form);
    let brouillonId=null;const ctx=etat.ctx,token=etat.token;
    const annulerDraft=async()=>{if(brouillonId&&etat.token===token)await api('DELETE',`/copilote/patients/brouillons/${encodeURIComponent(brouillonId)}`,{etablissement_id:ctx}).catch(()=>{});brouillonId=null;};
    annuler.onclick=async()=>{verifier.disabled=true;annuler.disabled=true;await annulerDraft();host.remove();};
    form.onsubmit=async ev=>{
      ev.preventDefault();if(verifier.disabled||ctx!==etat.ctx||token!==etat.token)return;
      verifier.disabled=true;annuler.disabled=true;
      try{
        const data=Object.fromEntries(new FormData(form));data.etablissement_id=ctx;
        const d=await api('POST','/copilote/patients/brouillons',data);brouillonId=d.id;if(ctx!==etat.ctx||token!==etat.token||!panneau.open){await annulerDraft();return;}form.remove();
        const resume=document.createElement('div');resume.className='og-patient-draft';
        const title=document.createElement('strong');title.textContent=langue==='en'?'Review patient draft':'Vérifier le brouillon patient';resume.append(title);
        const fields=[`${d.patient.prenom} ${d.patient.nom}`,`${langue==='en'?'Date of birth':'Date de naissance'}: ${d.patient.date_naissance}`,d.patient.reference_locale?`${langue==='en'?'Local ID':'Identifiant local'}: ${d.patient.reference_locale}`:''].filter(Boolean);
        const list=document.createElement('ul');for(const value of fields){const li=document.createElement('li');li.textContent=value;list.append(li);}resume.append(list);
        let noteDoublons=null;if(d.doublons_possibles.length){noteDoublons=document.createElement('p');noteDoublons.textContent=(langue==='en'?'Possible existing records: ':'Dossiers possiblement existants : ')+d.doublons_possibles.join(', ')+'. '+avecNom(langue==='en'?'Review them; OG will not merge records.':'Vérifiez-les; OG ne fusionnera aucun dossier.');resume.append(noteDoublons);}
        const ops=document.createElement('div');ops.className='ligne';const modifier=document.createElement('button');modifier.type='button';modifier.className='btn';modifier.textContent=langue==='en'?'Edit':'Modifier';const confirmer=document.createElement('button');confirmer.type='button';confirmer.className='btn pri';confirmer.textContent=langue==='en'?'Confirm record creation':'Confirmer la création';const annuler2=document.createElement('button');annuler2.type='button';annuler2.className='btn';annuler2.textContent=langue==='en'?'Cancel':'Annuler';ops.append(modifier,confirmer,annuler2);resume.append(ops);host.append(resume);
        modifier.onclick=async()=>{modifier.disabled=true;confirmer.disabled=true;annuler2.disabled=true;await annulerDraft();resume.remove();for(const [k,v] of Object.entries(d.patient)){if(form.elements[k])form.elements[k].value=v||'';}host.append(form);verifier.disabled=false;annuler.disabled=false;};
        let accepteDoublons=false,consentDoublons=null,caseDoublons=null;
        const finaliser=async()=>{confirmer.disabled=true;annuler2.disabled=true;try{const result=await api('POST',`/copilote/patients/brouillons/${encodeURIComponent(d.id)}/confirmer`,{etablissement_id:ctx,accepter_doublons:accepteDoublons});if(ctx!==etat.ctx||token!==etat.token||!panneau.open)return;
          if(result.confirmation_requise){
            if(result.doublons_possibles.length){
              const texte=(langue==='en'?'Possible existing records: ':'Dossiers possiblement existants : ')+result.doublons_possibles.join(', ')+'. '+avecNom(langue==='en'?'Review them; OG will not merge records.':'Vérifiez-les; OG ne fusionnera aucun dossier.');
              if(noteDoublons)noteDoublons.textContent=texte;else{noteDoublons=document.createElement('p');noteDoublons.textContent=texte;resume.insertBefore(noteDoublons,ops);}
              if(!consentDoublons){consentDoublons=document.createElement('label');consentDoublons.className='case';caseDoublons=document.createElement('input');caseDoublons.type='checkbox';const text=document.createElement('span');text.textContent=langue==='en'?'I reviewed these possible matches and authorize a separate fictitious record.':'J’ai vérifié ces correspondances et j’autorise la création d’un dossier fictif distinct.';consentDoublons.append(caseDoublons,text);resume.insertBefore(consentDoublons,ops);caseDoublons.onchange=()=>{accepteDoublons=caseDoublons.checked;confirmer.disabled=!accepteDoublons;};}
              caseDoublons.checked=false;accepteDoublons=false;confirmer.disabled=true;confirmer.textContent=langue==='en'?'Confirm separate record':'Confirmer le dossier distinct';
            } else {
              consentDoublons?.remove();consentDoublons=null;caseDoublons=null;accepteDoublons=false;confirmer.disabled=false;confirmer.textContent=langue==='en'?'Confirm record creation':'Confirmer la création';
            }
            annuler2.disabled=false;return;
          }
          const ok=document.createElement('p');ok.setAttribute('role','status');ok.textContent=result.cree?(langue==='en'?`Fictitious patient record created: ${result.resultat.reference}.`:`Dossier patient fictif créé : ${result.resultat.reference}.`):(langue==='en'?'No record was created.':'Aucun dossier n’a été créé.');resume.replaceChildren(title,ok);brouillonId=null;
        }catch{confirmer.disabled=false;annuler2.disabled=false;message(O('erreur'));}};
        confirmer.onclick=()=>void finaliser();annuler2.onclick=async()=>{confirmer.disabled=true;annuler2.disabled=true;await annulerDraft();host.remove();};
      }catch{message(O('erreur'));verifier.disabled=false;annuler.disabled=false;}
    };
  }
  async function question(qBrute, source = null) {
    if (occupe || !etat.token || !panneau.open || !etat.moi || !etabCtx()?.module_actif) return;
    const q = sansAppel(qBrute);
    // Langue de la réponse : demandée, sinon celle de la question, sinon la langue de conversation (le serveur applique la même règle).
    const langueQ = window.ArrimoOgLangue ? window.ArrimoOgLangue.langueReponse(q, langueConversation()) : langue;
    if(demandeCreationPatient(q)){window.dispatchEvent(new CustomEvent('arrimo:og-interaction-manuelle'));message(q,true);champ.value='';formulaireCreationPatient();return;}
    const contexte = etat.ctx; const token = etat.token; const revision = sequence;
    const entretien = estEntretien();
    const valide = () => panneau.open && revision === sequence && contexte === etat.ctx && token === etat.token;
    occupe = true; envoyer.disabled = true;
    const bulle = message(qBrute, true); champ.value = '';
    if (source === 'message_vocal') { const n = document.createElement('span'); n.className = 'og-source'; n.textContent = O('message_vocal'); bulle.append(n); }
    const attente = message(O('attente'));
    try {
      let reponse;
      if (/(posolog|dosage|\bdose\b|traitement|diagnos|prescri|medicament|treatment|medication)/i.test(q.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) {
        reponse = { reponse: tL(langueQ, 'og.hors_perimetre'), mode: 'local', langue: langueQ };
      } else if (entretien) {
        if (/(nettoy|entretien|clean|priorit|tache|task)/i.test(q)) {
          const file = await api('GET', `/nettoyage?etablissement_id=${contexte}`);
          reponse = { reponse: tL(langueQ, 'og.nettoyage', { n: file.length }) + (file.length ? '\n' + tL(langueQ, 'og.nettoyage_codes', { codes: file.slice(0, 5).map(x => x.code).join(', ') }) : ''), mode: 'local', langue: langueQ };
        } else reponse = { reponse: tL(langueQ, 'og.entretien_limite'), mode: 'local', langue: langueQ };
      } else {
        reponse = await api('POST', '/copilote/question', { etablissement_id: contexte, question: q, langue: langueConversation(), patient_id_context:patientSelectionne });
      }
      const texteReponse = avecNom(String(reponse.reponse ?? ''));
      if (valide()) { attente.remove(); message(texteReponse, false, reponse.mode);
        if(Array.isArray(reponse.patients)){patientSelectionne=null;cartesPatients(log.lastElementChild,reponse.patients,reponse.limite);}
        if(reponse.proposition)carteAction(log.lastElementChild,reponse.proposition,contexte);
        if(reponse.formulaire==='nouveau_resident'&&window.ArrimoChsldNouveauResident){const b=document.createElement('button');b.type='button';b.className='btn pri';b.textContent=langue==='en'?'Open the registration form':'Ouvrir le formulaire d’enregistrement';b.onclick=()=>{fermer();window.ArrimoChsldNouveauResident();};log.lastElementChild.append(b);}
        if(reponse.proposition_chsld)carteChsld(log.lastElementChild,reponse.proposition_chsld,contexte);
        if(reponse.ouvrir){const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=langue==='en'?'Open this screen':'Ouvrir cet écran';b.onclick=()=>naviguer(reponse.ouvrir);log.lastElementChild.append(b);}
        // Langue du texte reçue du serveur : la voix lit toujours dans la langue du texte affiché.
        window.dispatchEvent(new CustomEvent('arrimo:og-reponse',{detail:{texte:texteReponse,langue:reponse.langue||langueQ,voix:!!source,sensible:!!reponse.sensible||!!reponse.patients||!!patientSelectionne||/\b(?:P|TR)-\d{1,12}\b|\badmission\s*(?:n[°o]\s*|#\s*)?\d+|\bpatient\s+(?:interne|id)\s*\d+\b/i.test(q)}}));
      }
    } catch {
      // La question n'est pas perdue : elle revient dans le champ pour un nouvel essai.
      if (valide()) { attente.remove(); message(O('erreur')); if (!champ.value) champ.value = qBrute; window.dispatchEvent(new CustomEvent('arrimo:og-echec')); }
    } finally {
      if (revision === sequence) { occupe = false; envoyer.disabled = false; }
    }
  }
  // Nom, avatar, accueil et fonctions propres à l'établissement ; le moteur et les droits restent ceux d'OG.
  let configurationOg = null;
  async function appliquerConfiguration(etabId) {
    if (!etabId) return;
    try { configurationOg = await api('GET', `/og/configuration?etablissement_id=${etabId}`); } catch { return; }
    if (etabId !== etat.ctx) return;
    const p = configurationOg.personnalisation, e = configurationOg.effectif;
    appliquerIdentite(p, e);
    window.dispatchEvent(new CustomEvent('arrimo:og-effectif', { detail: e }));
    const vocal = document.querySelector('#og-vocal'); if (vocal && !e.vocal) vocal.hidden = true;
    if (!e.texte) { champ.disabled = true; envoyer.disabled = true; message(t('ogperso.desactive')); return; }
    if (p.accueil) message(avecNom(p.accueil));
    // Raccourcis du cahier OG (§17), affichés seulement pour les fonctions actives de l'établissement.
    const en = langue === 'en', T = (fr, anglais) => (en ? anglais : fr);
    if (etabCtx()?.type_etablissement === 'chsld') {
      action(T('Places disponibles', 'Available places'), () => question(T('Combien de chambres sont disponibles aujourd’hui ?', 'How many rooms are available today?')));
      action(T('Résidents hospitalisés', 'Residents in hospital'), () => question(T('Quels résidents sont actuellement hospitalisés ?', 'Which residents are currently in hospital?')));
      action(T('Retours prévus', 'Planned returns'), () => question(T('Quels retours sont prévus ?', 'Which returns are planned?')));
      action(T('Nouveau résident', 'New resident'), () => question(T('Aide-moi à enregistrer un nouveau résident', 'Help me register a new resident')));
      return;
    }
    if (e.patients) action(T('Créer un patient', 'Create a patient'), () => { message(T('Créer un patient', 'Create a patient'), true); formulaireCreationPatient(); });
    if (e.actions) action(T('Préparer une admission', 'Prepare an admission'), () => question(T('Prépare une admission', 'Prepare an admission')));
    action(T('Rechercher un lit', 'Find a bed'), () => question(T('Quels lits sont libres ?', 'Which beds are available?')));
    action(T('Consulter les alertes', 'View alerts'), () => question(T('Quelles alertes sont en cours ?', 'Which alerts are active?')));
    if (e.rapports) action(T('Générer un rapport', 'Generate a report'), () => naviguer('indicateurs'));
  }
  /** Nom, avatar et voix d'OG pour cet établissement : appliqués à l'ouverture et dès un enregistrement. */
  function appliquerIdentite(p, e) {
    const titre = document.querySelector('#og-title'); if (titre) titre.textContent = nomOg();
    const image = document.querySelector('.og-entete img, .og-entete .og-avatar');
    if (image && window.ArrimoOgAvatar && e.personnalisation) { const span = document.createElement('span'); span.className = 'og-avatar'; span.innerHTML = window.ArrimoOgAvatar.svg(p.avatar, 55); image.replaceWith(span); }
    window.ArrimoOgVoix = p.voix;
  }
  window.addEventListener('arrimo:og-configuration', async () => {
    configurationOg = null;
    try { const c = await api('GET', `/og/configuration?etablissement_id=${etat.ctx}`); configurationOg = c; appliquerIdentite(c.personnalisation, c.effectif); } catch { /* réappliqué à la prochaine ouverture */ }
  });
  ouvrir.onclick = () => {
    if (!etat.token || !etat.moi || etat.moi.utilisateur.mdp_temporaire) return;
    reinitialiser(false);
    const u = etat.moi.utilisateur; const etab = etabCtx(); const entretien = estEntretien();
    document.querySelector('#og-contexte').textContent = O('contexte', { etab: etab?.nom || 'Arrimo', role: t(`roles.${u.role}`) });
    document.querySelector('#og-actions').replaceChildren();
    message(O(entretien ? 'bienvenue_entretien' : etab?.type_etablissement === 'chsld' ? 'bienvenue_chsld' : 'bienvenue', { nom: u.nom }));
    if(patientSelectionne)message(langue==='en'?'The selected patient context is retained for this authorized session.':'Le contexte du patient sélectionné est conservé pour cette session autorisée.');
    const actif = !!etab?.module_actif;
    champ.disabled = !actif; envoyer.disabled = !actif;
    if (actif && !entretien) appliquerConfiguration(etab.id);
    if (!actif) message(O('sans_etab'));
    if (actif && entretien) {
      action(O('priorites'), () => question(langue === 'en' ? 'Cleaning priorities' : 'Priorités de nettoyage'));
      action(t('onglets.nettoyage'), () => naviguer('nettoyage'));
    } else if (actif && etab?.type_etablissement === 'chsld') {
      for (const vue of ['c-accueil', 'c-residents', 'c-chambres']) action(t(`chsld.nav.${vue.slice(2)}`), () => naviguer(vue));
    } else if (actif) {
      action(O('priorites'), () => question(langue === 'en' ? 'What should I do first?' : 'Que faire en priorité ?'));
      for (const vue of ['copilote', 'urgence', 'lits', 'transferts']) action(t(`onglets.${vue}`), () => naviguer(vue));
    } else action(t('onglets.compte'), () => naviguer('compte'));
    panneau.showModal();
  };
  // Garder Tab et Maj+Tab dans le panneau, y compris au bord de la navigation native.
  panneau.addEventListener('keydown', ev => {
    if (ev.key !== 'Tab') return;
    const controles = [...panneau.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')].filter(el => el.getClientRects().length);
    const premier = controles[0]; const dernier = controles[controles.length - 1];
    if (!premier) { ev.preventDefault(); return; }
    if (ev.shiftKey && document.activeElement === premier) { ev.preventDefault(); dernier.focus(); }
    else if (!ev.shiftKey && document.activeElement === dernier) { ev.preventDefault(); premier.focus(); }
  });
  document.querySelector('#og-close').onclick = fermer;
  panneau.addEventListener('close', () => { sequence++; occupe = false; envoyer.disabled = false; ouvrir.focus(); });
  document.querySelector('#og-form').onsubmit = ev => {
    ev.preventDefault(); const q = champ.value.trim(); const source = champ.dataset.source || null; delete champ.dataset.source;
    if (q) question(q, source);
  };
  champ.addEventListener('input', (e) => { if (e.isTrusted && champ.dataset.source === 'voix') delete champ.dataset.source; });
  window.addEventListener('arrimo:session-reset', reinitialiser);
})();
