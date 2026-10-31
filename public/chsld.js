/* Arrimo CHSLD — interface : accueil, résidents, chambres, demandes d'hébergement, admissions et sorties, tâches,
   réseau, transferts et hospitalisations, indicateurs. Toutes les règles sont appliquées par le serveur (src/chsld.js).
   Réutilise le socle de l'application (api, agir, modale, toast, t, esc, etat). */
(() => {
  const C = (k, v) => esc(t(`chsld.${k}`, v));
  const jour = (iso) => (iso ? new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
  const dateHeure = (iso) => (iso ? heure(iso) : '');
  const pastille = (cls, texte) => `<span class="ch-etat ch-${cls}">${esc(texte)}</span>`;
  const statutResident = (s) => pastille(s, t(`chsld.statut.${s}`));
  const gerer = () => ['coordonnateur', 'admin_etab', 'gestionnaire'].includes(etat.moi?.utilisateur?.role);
  const role = () => etat.moi?.utilisateur?.role;
  const tuile = (lib, val, cls = '') => `<div class="tuile ${cls}"><span class="lbl">${lib}</span><span class="v num">${esc(String(val ?? 0))}</span></div>`;
  const ctx = () => etat.ctx;
  const sel = (id, lib, options, choisi = '') => `<div class="champ"><label class="lbl" for="${id}">${lib}</label><select id="${id}">${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(choisi) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
  const champ = (id, lib, val = '', attrs = '') => `<div class="champ"><label class="lbl" for="${id}">${lib}</label><input id="${id}" value="${esc(val ?? '')}" ${attrs}></div>`;

  /* ------------------------------------------------------------------ Accueil */
  async function vueAccueil() {
    const v = $('#v-c-accueil');
    const a = await api('GET', `/chsld/accueil?etablissement_id=${ctx()}`);
    const p = a.places, r = a.residents;
    v.innerHTML = `<div class="entete"><div><h2>${C('accueil.titre', { etab: a.etablissement.nom })}</h2><p>${C('accueil.intro')}</p></div></div>
      ${a.alertes.length ? `<div class="panneau-c ch-alertes"><h3>${C('accueil.alertes')}</h3><ul>${a.alertes.map((x) => `<li>${C(`accueil.alerte_${x.code}`, { n: x.n })}</li>`).join('')}</ul></div>` : ''}
      <h3 class="titre-section">${C('accueil.places')}</h3>
      <div class="tuiles">${tuile(C('accueil.dotees'), p.dotees)}${tuile(C('accueil.libres'), p.libres, 'ch-t-libre')}${tuile(C('accueil.reservees'), p.reservees)}
        ${tuile(C('accueil.occupees'), p.occupees)}${tuile(C('accueil.conservees'), p.conservees)}${tuile(C('accueil.preparation'), p.preparation)}${tuile(C('accueil.bloquees'), p.bloquees)}</div>
      <h3 class="titre-section">${C('accueil.residents')}</h3>
      <div class="tuiles">${['present', 'hospitalise', 'absent', 'preadmission', 'transfert_en_cours'].map((s) => tuile(C(`accueil.${s}`), r[s] || 0)).join('')}</div>
      <div class="deux"><div class="pile">
        <div class="panneau-c"><h3>${C('accueil.retours')}</h3>${a.retours.length ? `<ul class="liste-simple">${a.retours.map((x) => `<li><b>${esc(x.resident_ref)}</b> · ${esc(x.hopital)} · ${x.retour_prevu_le ? esc(dateHeure(x.retour_prevu_le)) : ''} · ${esc(t(`chsld.coord_statut.${x.statut}`))}</li>`).join('')}</ul>` : `<p class="note">${C('accueil.aucun_retour')}</p>`}</div>
        <div class="panneau-c"><h3>${C('accueil.demandes')}</h3>${Object.keys(a.demandes).length ? `<ul class="liste-simple">${Object.entries(a.demandes).map(([s, n]) => `<li>${esc(t(`chsld.demande_statut.${s}`))} : <b class="num">${n}</b></li>`).join('')}</ul>` : `<p class="note">${C('demandes.aucune')}</p>`}</div>
      </div><div class="pile">
        <div class="panneau-c"><h3>${C('accueil.coordinations')}</h3>${a.coordinations.length ? `<ul class="liste-simple">${a.coordinations.map((x) => `<li>${esc(t(`chsld.coord.type_${x.type}`))} · ${esc(t(x.entrante ? 'chsld.coord.entrantes' : 'chsld.coord.sortantes'))} · ${esc(t(`chsld.coord_statut.${x.statut}`))} : <b class="num">${x.n}</b></li>`).join('')}</ul>` : `<p class="note">${C('accueil.aucune_coordination')}</p>`}</div>
        <div class="panneau-c"><h3>${C('accueil.aujourdhui')}</h3>${a.aujourdhui.length ? `<ul class="liste-simple">${a.aujourdhui.map((x) => `<li>${esc(t(`chsld.mvt.${x.type}`))} : <b class="num">${x.n}</b></li>`).join('')}</ul>` : `<p class="note">${C('accueil.aucun_mouvement')}</p>`}
          <p class="note">${C('accueil.taches', { n: a.taches.ouvertes })} · ${C('accueil.en_retard', { n: a.taches.en_retard })}</p></div>
      </div></div>`;
  }

  /* ------------------------------------------------------------------ Résidents */
  async function vueResidents() {
    if (etat.chResident) return ficheResident(etat.chResident);
    const v = $('#v-c-residents');
    const q = etat.chRecherche || ''; const statut = etat.chStatut || 'actifs';
    const liste = await api('GET', `/chsld/residents?etablissement_id=${ctx()}&statut=${statut}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    v.innerHTML = `<div class="entete"><div><h2>${C('residents.titre')}</h2><p>${C('residents.intro')}</p></div>${gerer() ? `<button class="btn pri" id="ch-nouveau">${icone('plus')}${C('residents.nouveau')}</button>` : ''}</div>
      <div class="ligne filtres-acl">${champ('ch-q', C('residents.rechercher'), q, 'type="search" autocomplete="off"')}${sel('ch-statut', C('residents.statut'), [['actifs', t('chsld.residents.tous_statuts')], ['tous', t('chsld.residents.tous')]], statut)}</div>
      ${liste.length ? `<div class="tableau"><table><thead><tr><th>${C('residents.ref')}</th><th>${C('residents.nom')}</th><th>${C('residents.statut')}</th><th>${C('residents.place')}</th><th>${C('residents.contacts')}</th></tr></thead><tbody>
        ${liste.map((r) => `<tr><td class="num">${esc(r.reference)}</td><td><button class="lien" data-res="${r.id}">${esc(r.prenom)} ${esc(r.nom)}</button>${r.nom_usage ? `<div class="note">« ${esc(r.nom_usage)} »</div>` : ''}<div class="note">${C('residents.ne_le', { date: jour(r.date_naissance) })}</div></td>
          <td>${statutResident(r.statut)}</td><td>${r.lit ? `${esc(r.unite)} · ${esc(r.lit)}` : '—'}</td><td class="num">${r.contacts}</td></tr>`).join('')}</tbody></table></div>` : `<p class="vide">${C('residents.aucun')}</p>`}`;
    let minuteur;
    $('#ch-q').oninput = (e) => { clearTimeout(minuteur); minuteur = setTimeout(() => { etat.chRecherche = e.target.value.trim(); rafraichir(); }, 350); };
    $('#ch-statut').onchange = (e) => { etat.chStatut = e.target.value; rafraichir(); };
    v.querySelectorAll('[data-res]').forEach((b) => { b.onclick = () => { etat.chResident = Number(b.dataset.res); rafraichir(); }; });
    if ($('#ch-nouveau')) $('#ch-nouveau').onclick = () => formulaireNouveauResident();
  }
  const optionsRelation = () => ['fille', 'fils', 'conjoint', 'soeur', 'frere', 'parent', 'petit_enfant', 'ami', 'voisin', 'tuteur', 'autre'].map((r) => [r, t(`chsld.relation.${r}`)]);
  const CATS = ['administratif', 'hebergement', 'rendez_vous', 'mouvements'];
  function blocContact(i, k = {}) {
    return `<fieldset class="ch-contact" data-contact="${i}"><legend>${C('contact.secondaire', { n: i + 1 })}</legend><div class="ligne">
      ${champ(`k-prenom-${i}`, C('contact.prenom'), k.prenom)}${champ(`k-nom-${i}`, C('contact.nom'), k.nom)}${sel(`k-relation-${i}`, C('contact.relation'), optionsRelation(), k.relation || 'fille')}</div>
      <div class="ligne">${champ(`k-tel-${i}`, C('fiche.telephone'), k.telephone, 'inputmode="tel"')}${champ(`k-courriel-${i}`, C('fiche.courriel'), k.courriel, 'type="email"')}${champ(`k-rang-${i}`, C('contact.rang'), k.rang || i + 1, 'type="number" min="1" max="20"')}</div>
      <div class="cases"><label class="case"><input type="checkbox" id="k-principal-${i}"${k.principal || (!k.id && i === 0) ? ' checked' : ''}> ${C('contact.principal')}</label>
        <label class="case"><input type="checkbox" id="k-urgence-${i}"${k.contact_urgence !== false ? ' checked' : ''}> ${C('contact.urgence')}</label>
        <label class="case"><input type="checkbox" id="k-aidant-${i}"${k.proche_aidant ? ' checked' : ''}> ${C('contact.aidant')}</label>
        <label class="case"><input type="checkbox" id="k-rep-${i}"${k.representant_legal ? ' checked' : ''}> ${C('contact.representant')}</label></div>
      <p class="lbl">${C('contact.autorisations')}</p><div class="cases">${CATS.map((c) => `<label class="case"><input type="checkbox" data-k-auto="${i}" value="${c}"${(k.autorisations || []).includes(c) ? ' checked' : ''}> ${C(`categorie.${c}`)}</label>`).join('')}</div>
      ${champ(`k-dispo-${i}`, C('contact.disponibilites'), k.disponibilites)}</fieldset>`;
  }
  const lireContact = (i) => ({ prenom: $(`#k-prenom-${i}`).value, nom: $(`#k-nom-${i}`).value, relation: $(`#k-relation-${i}`).value, telephone: $(`#k-tel-${i}`).value || null,
    courriel: $(`#k-courriel-${i}`).value || null, rang: Number($(`#k-rang-${i}`).value) || i + 1, principal: $(`#k-principal-${i}`).checked, contact_urgence: $(`#k-urgence-${i}`).checked,
    proche_aidant: $(`#k-aidant-${i}`).checked, representant_legal: $(`#k-rep-${i}`).checked, autorisations: [...document.querySelectorAll(`[data-k-auto="${i}"]:checked`)].map((x) => x.value),
    disponibilites: $(`#k-dispo-${i}`).value || null });
  /** Enregistrer un nouveau résident : identité, accueil, contacts multiples ; doublon signalé, confirmation explicite pour un dossier distinct. */
  function formulaireNouveauResident(prefill = {}) {
    let n = Math.max(1, (prefill.contacts || []).length);
    const corps = `<p class="note">${C('nouveau.verifier')}</p><h4>${C('nouveau.identite')}</h4>
      <div class="ligne">${champ('n-prenom', C('nouveau.prenom'), prefill.prenom)}${champ('n-nom', C('nouveau.nom'), prefill.nom)}${champ('n-dn', C('nouveau.date_naissance'), prefill.date_naissance, 'type="date"')}</div>
      <div class="ligne">${champ('n-usage', C('fiche.nom_usage'))}${champ('n-dossier', C('fiche.dossier_officiel'))}${sel('n-langue', C('fiche.langue'), ['fr', 'en', 'autre'].map((l) => [l, t(`chsld.langue.${l}`)]))}</div>
      <h4>${C('nouveau.accueil')}</h4><div class="ligne">${champ('n-arrivee', C('fiche.arrivee_prevue'), '', 'type="date"')}</div>
      <p class="lbl">${C('fiche.accessibilite')}</p><div class="cases">${['fauteuil', 'deambulateur', 'leve_personne', 'lit_electrique', 'malentendant', 'malvoyant'].map((a) => `<label class="case"><input type="checkbox" data-n-acces value="${a}"> ${C(`acces.${a}`)}</label>`).join('')}</div>
      <h4>${C('nouveau.contacts')}</h4><p class="note">${C('contact.note')}</p><div id="n-contacts">${Array.from({ length: n }, (_, i) => blocContact(i, (prefill.contacts || [])[i])).join('')}</div>
      <button type="button" class="btn" id="n-ajouter">${icone('plus')}${C('nouveau.ajouter_contact')}</button>
      <label class="case" id="n-doublon-zone" hidden><input type="checkbox" id="n-doublon"> ${C('nouveau.confirmer_doublon')}</label>`;
    modale(t('chsld.nouveau.titre'), corps, [{ label: t('general.annuler') }, { label: t('chsld.nouveau.creer'), pri: true, run: async () => {
      const contacts = []; for (let i = 0; i < n; i += 1) { const k = lireContact(i); if (k.prenom || k.nom) contacts.push(k); }
      try {
        const r = await api('POST', '/chsld/residents', { etablissement_id: ctx(), prenom: $('#n-prenom').value, nom: $('#n-nom').value, date_naissance: $('#n-dn').value,
          nom_usage: $('#n-usage').value, dossier_officiel: $('#n-dossier').value, langue: $('#n-langue').value, arrivee_prevue: $('#n-arrivee').value || null,
          accessibilite: [...document.querySelectorAll('[data-n-acces]:checked')].map((x) => x.value), contacts, confirmer_doublon: $('#n-doublon').checked });
        toast(t('chsld.nouveau.cree', { ref: r.reference })); etat.chResident = r.id; rafraichir(); return true;
      } catch (e) { toast(e.message, true); if (e.code === 'resident_doublon_possible') $('#n-doublon-zone').hidden = false; return false; }
    } }]);
    $('#modale .boite').classList.add('large');
    $('#n-ajouter').onclick = () => { $('#n-contacts').insertAdjacentHTML('beforeend', blocContact(n)); n += 1; };
  }
  window.ArrimoChsldNouveauResident = formulaireNouveauResident;

  async function ficheResident(id) {
    const v = $('#v-c-residents');
    let f; try { f = await api('GET', `/chsld/residents/${id}`); } catch (e) { etat.chResident = null; throw e; }
    const r = f.resident; const g = gerer();
    const portail = await api('GET', `/chsld/residents/${id}/portail`).catch(() => null);
    const ligneId = (k, val) => (val ? `<dt>${C(`fiche.${k}`)}</dt><dd>${esc(val)}</dd>` : '');
    const loc = f.localisation ? `<p class="ch-loc">${C('fiche.localisation', { etat: t(f.localisation.confirmee ? 'chsld.fiche.loc_confirmee' : 'chsld.fiche.loc_envoyee'), hopital: f.localisation.hopital, numero: f.localisation.numero })}</p>` : '';
    const actions = [];
    if (g && r.statut === 'preadmission' && !r.lit_id) actions.push(['reserver', 'reserver-place']);
    if (g && r.statut === 'preadmission' && r.lit_id) actions.push(['arrivee', 'arrivee']);
    if (g && r.statut === 'present') actions.push(['changer', 'changer-chambre'], ['transfert', 'transfert-chsld']);
    if ((g || role() === 'equipe_soins') && ['present', 'absent'].includes(r.statut)) actions.push(['hospitalisation', 'hospitalisation']);
    if ((g || role() === 'equipe_soins') && r.statut === 'present') actions.push(['absence', 'absence']);
    if ((g || role() === 'equipe_soins') && r.statut === 'absent') actions.push(['fin_absence', 'fin-absence']);
    if (g && ['present', 'absent', 'hospitalise', 'preadmission'].includes(r.statut)) actions.push(['sortie', 'sortie']);
    v.innerHTML = `<div class="entete"><div><button class="btn discret" id="ch-retour">← ${C('fiche.retour')}</button>
        <h2>${esc(r.prenom)} ${esc(r.nom)} <span class="note num">${esc(r.reference)}</span></h2><p>${statutResident(r.statut)} · ${C('residents.ne_le', { date: jour(r.date_naissance) })}</p>${loc}</div>
        <div class="actions">${actions.map(([k, a]) => `<button class="btn${['arrivee', 'reserver'].includes(k) ? ' pri' : ''}" data-ch-action="${a}">${C(`actions.${k}`)}</button>`).join('')}</div></div>
      <div class="deux"><div class="pile">
        <div class="panneau-c"><h3>${C('fiche.hebergement')}</h3>${f.lit ? `<p><b>${esc(f.lit.unite)}</b> · ${C('residents.chambre')} ${esc(f.lit.chambre)} · ${esc(f.lit.code)} ${pastille(f.lit.etat, t(`chsld.chambres.${f.lit.etat === 'occupe' && r.statut !== 'present' ? 'conservee' : f.lit.etat}`))}</p>` : `<p class="note">${C('fiche.aucune_place')}</p>`}
          ${r.admis_le ? `<p class="note">${C('fiche.admis_le')} ${esc(dateHeure(r.admis_le))}</p>` : r.arrivee_prevue ? `<p class="note">${C('fiche.arrivee_prevue')} : ${esc(jour(r.arrivee_prevue))}</p>` : ''}</div>
        <div class="panneau-c"><div class="entete-panneau"><h3>${C('fiche.identite')}</h3>${g ? `<button class="btn" id="ch-modifier">${C('fiche.modifier')}</button>` : ''}</div>
          <dl class="ch-dl">${ligneId('reference', r.reference)}${ligneId('nom_usage', r.nom_usage)}${ligneId('dossier_officiel', r.dossier_officiel)}${ligneId('langue', t(`chsld.langue.${r.langue}`))}
            ${ligneId('telephone', r.telephone)}${ligneId('courriel', r.courriel)}${ligneId('adresse_precedente', r.adresse_precedente)}
            ${r.accessibilite?.length ? `<dt>${C('fiche.accessibilite')}</dt><dd>${r.accessibilite.map((a) => C(`acces.${a}`)).join(', ')}</dd>` : ''}</dl></div>
        <div class="panneau-c"><div class="entete-panneau"><h3>${C('fiche.contacts')}</h3>${g ? `<button class="btn" id="ch-ajout-contact">${icone('plus')}${C('contact.ajouter')}</button>` : ''}</div><p class="note">${C('contact.note')}</p>
          ${f.contacts.length ? f.contacts.map((k) => `<div class="item ch-contact-item"><div><b>${esc(k.prenom)} ${esc(k.nom)}</b> · ${C(`relation.${k.relation}`)} ${k.principal ? `<span class="badge fort">${C('contact.principal')}</span>` : `<span class="badge">${C('contact.secondaire', { n: k.rang })}</span>`}
            <div class="note">${[k.telephone, k.courriel].filter(Boolean).map(esc).join(' · ')}${k.disponibilites ? ` · ${esc(k.disponibilites)}` : ''}</div>
            <div class="note">${[k.contact_urgence ? t('chsld.contact.urgence') : null, k.proche_aidant ? t('chsld.contact.aidant') : null, k.representant_legal ? `${t('chsld.contact.representant')} (${t(k.representant_verifie_le ? 'chsld.contact.verifie' : 'chsld.contact.a_verifier')})` : null].filter(Boolean).map(esc).join(' · ')}</div>
            <div class="note">${C('contact.autorisations')} : ${k.autorisations.length ? k.autorisations.map((c) => C(`categorie.${c}`)).join(', ') : C('contact.aucune_autorisation')}</div></div>
            ${g ? `<div class="actions">${k.representant_legal && !k.representant_verifie_le ? `<button class="btn" data-verif="${k.id}">${C('contact.verifier')}</button>` : ''}<button class="btn" data-modif-contact="${k.id}">${C('contact.modifier')}</button><button class="btn dan" data-retirer="${k.id}" data-version="${k.version}">${C('contact.retirer')}</button></div>` : ''}</div>`).join('') : `<p class="note">${C('fiche.aucun')}</p>`}</div>
      </div><div class="pile">
        <div class="panneau-c"><h3>${C('fiche.coordinations')}</h3>${f.coordinations.length ? `<ul class="liste-simple">${f.coordinations.map((c) => `<li><b class="num">${esc(c.numero)}</b> · ${C(`coord.type_${c.type}`)} · ${esc(c.origine)} → ${esc(c.destination)} · ${esc(t(`chsld.coord_statut.${c.statut}`))}${c.incident ? ` · ${C(`coord.incident_${c.incident}`)}` : ''}</li>`).join('')}</ul>` : `<p class="note">${C('fiche.aucun')}</p>`}</div>
        <div class="panneau-c"><div class="entete-panneau"><h3>${C('fiche.communications')}</h3>${f.contacts.length ? `<button class="btn" id="ch-com">${C('communication.nouvelle')}</button>` : ''}</div>
          ${f.communications.length ? `<ul class="liste-simple">${f.communications.map((c) => `<li>${C(`com_type.${c.type}`)} · ${esc(c.contact)} (${C(`relation.${c.relation}`)}) · ${C(`categorie.${c.categorie}`)} — ${esc(c.sujet)} · ${esc(t(`chsld.tache_statut.${c.statut === 'fait' ? 'faite' : c.statut === 'annule' ? 'annulee' : 'a_faire'}`))}${c.statut === 'a_faire' ? ` <button class="btn" data-com-fait="${c.id}">${C('communication.marquer_fait')}</button>` : ''}</li>`).join('')}</ul>` : `<p class="note">${C('fiche.aucun')}</p>`}</div>
        ${portail?.module_actif ? panneauPortail(f, portail, g) : ''}
        <div class="panneau-c"><h3>${C('fiche.taches')}</h3>${f.taches.length ? `<ul class="liste-simple">${f.taches.map((x) => `<li>${C(`tache_type.${x.type}`)} · ${esc(x.titre)} · ${esc(t(`chsld.tache_statut.${x.statut}`))}</li>`).join('')}</ul>` : `<p class="note">${C('fiche.aucun')}</p>`}</div>
        <div class="panneau-c"><h3>${C('fiche.mouvements')}</h3>${f.mouvements.length ? `<ol class="ch-historique">${f.mouvements.map((m) => `<li><span class="note num">${esc(dateHeure(m.date))}</span> <b>${C(`mvt.${m.type}`)}</b>${m.de_lit || m.vers_lit ? ` · ${esc([m.de_lit, m.vers_lit].filter(Boolean).join(' → '))}` : ''}${m.autre_etablissement ? ` · ${esc(m.autre_etablissement)}` : ''}${m.detail ? `<div class="note">${esc(m.detail)}</div>` : ''}</li>`).join('')}</ol>` : `<p class="note">${C('fiche.aucun')}</p>`}</div>
      </div></div>`;
    $('#ch-retour').onclick = () => { etat.chResident = null; rafraichir(); };
    v.querySelectorAll('[data-ch-action]').forEach((b) => { b.onclick = () => actionResident(b.dataset.chAction, r, f); });
    if ($('#ch-modifier')) $('#ch-modifier').onclick = () => modifierIdentite(r);
    if ($('#ch-ajout-contact')) $('#ch-ajout-contact').onclick = () => editerContact(r, null, f.contacts.length);
    v.querySelectorAll('[data-modif-contact]').forEach((b) => { b.onclick = () => editerContact(r, f.contacts.find((k) => k.id === Number(b.dataset.modifContact)), 0); });
    v.querySelectorAll('[data-retirer]').forEach((b) => { b.onclick = () => { if (window.confirm(t('chsld.contact.confirmer_retrait'))) agir(b, () => api('PUT', `/chsld/contacts/${b.dataset.retirer}`, { actif: false, version: Number(b.dataset.version) }), t('chsld.contact.retire')); }; });
    v.querySelectorAll('[data-verif]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/chsld/contacts/${b.dataset.verif}/verifier-representant`), t('chsld.actions.ok')); });
    v.querySelectorAll('[data-com-fait]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/chsld/communications/${b.dataset.comFait}/statut`, { statut: 'fait' }), t('chsld.actions.ok')); });
    if ($('#ch-com')) $('#ch-com').onclick = () => nouvelleCommunication(r, f.contacts);
    v.querySelectorAll('[data-inviter]').forEach((b) => { b.onclick = async () => { b.disabled = true; try { const a = await api('POST', `/chsld/contacts/${b.dataset.inviter}/acces-portail`, {});
      modale(t('chsld.portail.inviter'), `<p>${C('portail.lien')}</p><p><code class="ch-lien">${esc(location.origin + a.lien)}</code></p>`, [{ label: t('general.fermer'), pri: true }]); rafraichir(); } catch (e) { toast(e.message, true); b.disabled = false; } }; });
    v.querySelectorAll('[data-revoquer]').forEach((b) => { b.onclick = () => { if (window.confirm(t('chsld.portail.confirmer_revocation'))) agir(b, () => api('POST', `/chsld/acces-portail/${b.dataset.revoquer}/revoquer`), t('chsld.actions.ok')); }; });
    v.querySelectorAll('[data-repondre]').forEach((b) => { b.onclick = () => { const k = f.contacts.find((x) => x.id === Number(b.dataset.repondre));
      modale(t('chsld.portail.repondre'), `${sel('pm-cat', C('communication.categorie'), k.autorisations.map((c) => [c, t(`chsld.categorie.${c}`)]))}<div class="champ"><label class="lbl" for="pm-txt">${C('communication.sujet')}</label><textarea id="pm-txt" maxlength="2000"></textarea></div>`,
        [{ label: t('general.annuler') }, { label: t('general.enregistrer'), pri: true, run: async () => (await agir(null, () => api('POST', `/chsld/residents/${r.id}/messages`, { contact_id: k.id, categorie: $('#pm-cat').value, texte: $('#pm-txt').value }), t('chsld.portail.envoye'))) !== null || false }]); }; });
  }
  /** Portail des proches : accès par contact (inviter, révoquer) et fil des messages. */
  function panneauPortail(f, p, g) {
    const etatAcces = (a) => (a.revoque_le ? C('portail.revoque') : a.actif ? `${C('portail.actif')}${a.expire_le ? ` · ${C('portail.expire_le', { date: jour(a.expire_le) })}` : ''}` : C('portail.attente'));
    return `<div class="panneau-c"><h3>${C('portail.titre')}</h3><p class="note">${C('portail.intro')}</p>
      ${f.contacts.map((k) => { const a = p.acces.find((x) => x.contact_id === k.id && !x.revoque_le); const fil = p.messages.filter((m) => m.contact_id === k.id);
        return `<div class="item"><div><b>${esc(k.prenom)} ${esc(k.nom)}</b> · ${C(`relation.${k.relation}`)} <span class="note">${a ? etatAcces(a) : ''}</span>
          ${fil.length ? `<ul class="liste-simple">${fil.slice(-5).map((m) => `<li><span class="note">${esc(dateHeure(m.cree_le))} · ${C(`categorie.${m.categorie}`)}</span> ${m.sens === 'proche' ? '←' : '→'} ${esc(m.texte)}</li>`).join('')}</ul>` : ''}</div>
          <div class="actions">${g && !a && k.courriel && k.autorisations.length ? `<button class="btn" data-inviter="${k.id}">${C('portail.inviter')}</button>` : ''}${g && a ? `<button class="btn dan" data-revoquer="${a.id}">${C('portail.revoquer')}</button>` : ''}
            ${k.autorisations.length ? `<button class="btn" data-repondre="${k.id}">${C('portail.repondre')}</button>` : ''}</div></div>`; }).join('')}
      <p class="note">${C('portail.conditions')}</p></div>`;
  }
  function modifierIdentite(r) {
    const d = (x) => (x ? String(x).slice(0, 10) : '');
    modale(t('chsld.fiche.identite'), `<div class="ligne">${champ('m-prenom', C('nouveau.prenom'), r.prenom)}${champ('m-nom', C('nouveau.nom'), r.nom)}${champ('m-dn', C('nouveau.date_naissance'), d(r.date_naissance), 'type="date"')}</div>
      <div class="ligne">${champ('m-usage', C('fiche.nom_usage'), r.nom_usage)}${champ('m-dossier', C('fiche.dossier_officiel'), r.dossier_officiel)}${sel('m-langue', C('fiche.langue'), ['fr', 'en', 'autre'].map((l) => [l, t(`chsld.langue.${l}`)]), r.langue)}</div>
      <div class="ligne">${champ('m-tel', C('fiche.telephone'), r.telephone)}${champ('m-courriel', C('fiche.courriel'), r.courriel)}${champ('m-arrivee', C('fiche.arrivee_prevue'), d(r.arrivee_prevue), 'type="date"')}</div>
      ${champ('m-adresse', C('fiche.adresse_precedente'), r.adresse_precedente)}
      <p class="lbl">${C('fiche.accessibilite')}</p><div class="cases">${['fauteuil', 'deambulateur', 'leve_personne', 'lit_electrique', 'malentendant', 'malvoyant'].map((a) => `<label class="case"><input type="checkbox" data-m-acces value="${a}"${(r.accessibilite || []).includes(a) ? ' checked' : ''}> ${C(`acces.${a}`)}</label>`).join('')}</div>`,
    [{ label: t('general.annuler') }, { label: t('chsld.fiche.enregistrer'), pri: true, run: async () => (await agir(null, () => api('PUT', `/chsld/residents/${r.id}`, { version: r.version, prenom: $('#m-prenom').value, nom: $('#m-nom').value,
      date_naissance: $('#m-dn').value, nom_usage: $('#m-usage').value, dossier_officiel: $('#m-dossier').value, langue: $('#m-langue').value, telephone: $('#m-tel').value, courriel: $('#m-courriel').value,
      arrivee_prevue: $('#m-arrivee').value || null, adresse_precedente: $('#m-adresse').value, accessibilite: [...document.querySelectorAll('[data-m-acces]:checked')].map((x) => x.value) }), t('chsld.fiche.identite_maj'))) !== null || false }]);
    $('#modale .boite').classList.add('large');
  }
  function editerContact(r, k, i) {
    modale(t(k ? 'chsld.contact.modifier' : 'chsld.contact.ajouter'), `<p class="note">${C('contact.note')}</p>${blocContact(i, k || {})}`,
      [{ label: t('general.annuler') }, { label: t('chsld.fiche.enregistrer'), pri: true, run: async () => {
        const corps = lireContact(i);
        return (await agir(null, () => (k ? api('PUT', `/chsld/contacts/${k.id}`, { ...corps, version: k.version }) : api('POST', `/chsld/residents/${r.id}/contacts`, corps)), t('chsld.contact.enregistre'))) !== null || false;
      } }]);
    $('#modale .boite').classList.add('large');
  }
  function nouvelleCommunication(r, contacts) {
    const majContacts = () => { const c = $('#cm-cat').value; const ok = contacts.filter((k) => k.autorisations.includes(c));
      $('#cm-contact').innerHTML = ok.map((k) => `<option value="${k.id}">${esc(k.prenom)} ${esc(k.nom)} · ${esc(t(`chsld.relation.${k.relation}`))}</option>`).join('');
      $('#cm-aucun').hidden = ok.length > 0; };
    modale(t('chsld.communication.nouvelle'), `<p class="note">${C('communication.note')}</p><div class="ligne">${sel('cm-cat', C('communication.categorie'), CATS.map((c) => [c, t(`chsld.categorie.${c}`)]))}
        ${sel('cm-type', C('communication.type'), ['rappel_demande', 'appel', 'message', 'rendez_vous'].map((x) => [x, t(`chsld.com_type.${x}`)]))}</div>
      <div class="champ"><label class="lbl" for="cm-contact">${C('communication.contact')}</label><select id="cm-contact"></select></div><p class="note" id="cm-aucun" hidden>${C('communication.aucun_autorise')}</p>
      ${champ('cm-sujet', C('communication.sujet'), '', 'maxlength="200"')}<div class="ligne">${champ('cm-prevu', C('communication.prevu'), '', 'type="datetime-local"')}<label class="case"><input type="checkbox" id="cm-fait"> ${C('communication.fait')}</label></div>`,
    [{ label: t('general.annuler') }, { label: t('chsld.fiche.enregistrer'), pri: true, run: async () => (await agir(null, () => api('POST', `/chsld/residents/${r.id}/communications`, { contact_id: Number($('#cm-contact').value),
      categorie: $('#cm-cat').value, type: $('#cm-type').value, sujet: $('#cm-sujet').value, prevu_le: $('#cm-prevu').value || null, fait: $('#cm-fait').checked }), t('chsld.communication.enregistree'))) !== null || false }]);
    $('#cm-cat').onchange = majContacts; majContacts();
  }
  async function placesLibres() { return (await api('GET', `/chsld/places?etablissement_id=${ctx()}`)).filter((p) => p.etat === 'libre'); }
  async function actionResident(a, r, f) {
    const ok = t('chsld.actions.ok');
    if (a === 'arrivee') return agir(null, () => api('POST', `/chsld/residents/${r.id}/arrivee`, { version: r.version }), ok);
    if (a === 'fin-absence') return agir(null, () => api('POST', `/chsld/residents/${r.id}/absence`, { version: r.version, fin: true }), ok);
    if (a === 'reserver-place' || a === 'changer-chambre') {
      const libres = await placesLibres();
      return modale(t(a === 'reserver-place' ? 'chsld.actions.reserver' : 'chsld.actions.changer'), libres.length ? sel('pl-lit', C('actions.choisir_place'), libres.map((p) => [p.id, `${p.unite} · ${t('chsld.residents.chambre')} ${p.chambre} · ${p.code}`])) : `<p>${C('actions.aucune_place')}</p>`,
        [{ label: t('general.annuler') }, ...(libres.length ? [{ label: t('general.confirmer'), pri: true, run: async () => { const p = libres.find((x) => x.id === Number($('#pl-lit').value));
          return (await agir(null, () => api('POST', `/chsld/residents/${r.id}/${a}`, { lit_id: p.id, version: p.version, version_resident: r.version }), ok)) !== null || false; } }] : [])]);
    }
    if (a === 'absence') return modale(t('chsld.actions.absence'), champ('ab-retour', C('actions.retour_prevu'), '', 'type="date"'), [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true,
      run: async () => (await agir(null, () => api('POST', `/chsld/residents/${r.id}/absence`, { version: r.version, retour_prevu: $('#ab-retour').value || null }), ok)) !== null || false }]);
    if (a === 'sortie') return modale(t('chsld.actions.sortie'), sel('so-motif', C('actions.motif'), ['domicile', 'autre_milieu', 'deces', 'autre'].map((m) => [m, t(`chsld.actions.motif_${m}`)])),
      [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => (await agir(null, () => api('POST', `/chsld/residents/${r.id}/sortie`, { version: r.version, motif: $('#so-motif').value }), ok)) !== null || false }]);
    if (a === 'hospitalisation' || a === 'transfert-chsld') {
      const res = await api('GET', `/chsld/reseau?etablissement_id=${ctx()}`).catch(() => ({ chsld: [], hopitaux: [] }));
      const hosp = a === 'hospitalisation';
      const choix = hosp ? res.hopitaux.map((h) => [h.id, h.nom]) : [...new Map(res.chsld.map((x) => [x.id, [x.id, `${x.nom} · ${t('chsld.reseau.libres', { n: res.chsld.filter((y) => y.id === x.id).reduce((s, y) => s + y.libres, 0) })}`]])).values()];
      return modale(t(hosp ? 'chsld.actions.hospitalisation' : 'chsld.actions.transfert'), `${sel('co-dest', C(hosp ? 'actions.hopital' : 'actions.destination'), choix)}${champ('co-motif', C('actions.motif_admin'), '', 'maxlength="200"')}
        ${hosp ? `<label class="case"><input type="checkbox" id="co-id"> ${C('actions.identite_verifiee')}</label>` : `<p class="note">${C('actions.non_garantie')}</p>`}`,
      [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => (await agir(null, () => api('POST', `/chsld/residents/${r.id}/${a}`, hosp
        ? { hopital_id: Number($('#co-dest').value), motif_admin: $('#co-motif').value, identite_verifiee: $('#co-id').checked, version: r.version }
        : { destination_id: Number($('#co-dest').value), motif_admin: $('#co-motif').value, version: r.version }), ok)) !== null || false }]);
    }
    return null;
  }

  /* ------------------------------------------------------------------ Chambres et lits */
  async function vueChambres() {
    const v = $('#v-c-chambres');
    const places = await api('GET', `/chsld/places?etablissement_id=${ctx()}`);
    const unites = [...new Set(places.map((p) => p.unite))];
    const cle = (p) => (p.etat === 'occupe' && p.resident_statut && p.resident_statut !== 'present' ? 'conservee' : p.etat);
    v.innerHTML = `<div class="entete"><div><h2>${C('chambres.titre')}</h2><p>${C('chambres.intro')}</p></div></div>
      <div class="ch-legende">${['libre', 'reserve', 'occupe', 'conservee', 'nettoyage', 'indispo'].map((k) => `${pastille(k, t(`chsld.chambres.${k}`))} <b class="num">${places.filter((p) => cle(p) === k).length}</b>`).join(' ')}</div>
      ${unites.map((u) => { const ps = places.filter((p) => p.unite === u); return `<h3 class="titre-section">${esc(u)} <span class="note">${esc(ps[0].type_unite)}</span></h3>
        <div class="ch-places">${ps.map((p) => `<div class="ch-place ch-p-${cle(p)}"><div class="ch-place-tete"><b class="num">${esc(p.code)}</b>${pastille(cle(p), t(`chsld.chambres.${cle(p)}`))}</div>
          <div class="note">${C('residents.chambre')} ${esc(p.chambre)}${p.type_chambre ? ` · ${esc(p.type_chambre)}` : ''} · ${C('chambres.depuis', { duree: depuis(p.etat_depuis) })}</div>
          ${p.resident_ref ? `<div>${p.resident_nom ? `<button class="lien" data-res="${p.resident_id}">${esc(p.resident_nom)}</button> ` : ''}<span class="note num">${esc(p.resident_ref)}</span></div>` : ''}
          ${gerer() && p.etat === 'libre' ? `<div class="actions"><button class="btn" data-conf="${p.id}">${C('chambres.confirmer')}</button></div>` : ''}</div>`).join('')}</div>`; }).join('')}`;
    v.querySelectorAll('[data-res]').forEach((b) => { b.onclick = () => { etat.chResident = Number(b.dataset.res); allerA('c-residents'); }; });
    v.querySelectorAll('[data-conf]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/lits/${b.dataset.conf}/confirmer-disponibilite`), t('chsld.actions.ok')); });
  }

  /* ------------------------------------------------------------------ Demandes d'hébergement */
  async function vueDemandes() {
    const v = $('#v-c-demandes');
    const [liste, cfg] = [await api('GET', `/chsld/demandes?etablissement_id=${ctx()}`), configCtx()];
    v.innerHTML = `<div class="entete"><div><h2>${C('demandes.titre')}</h2><p>${C('demandes.intro')}</p></div>${gerer() ? `<button class="btn pri" id="dh-nouvelle">${icone('plus')}${C('demandes.nouvelle')}</button>` : ''}</div>
      ${liste.length ? `<div class="liste">${liste.map((d) => `<div class="item"><div><b class="num">${esc(d.numero)}</b> · ${esc(d.prenom)} ${esc(d.nom)} · ${C(`provenance.${d.provenance}`)}${d.reference_externe ? ` · ${esc(d.reference_externe)}` : ''}
          <div>${pastille(d.statut, t(`chsld.demande_statut.${d.statut}`))} ${d.type_nom ? `· ${esc(d.type_nom)}` : ''} ${d.arrivee_souhaitee ? `· ${C('demandes.arrivee')} ${esc(jour(d.arrivee_souhaitee))}` : ''} ${d.lit_propose ? `· ${esc(d.lit_propose)}` : ''} ${d.resident_ref ? `· ${esc(d.resident_ref)}` : ''}</div>
          <div class="cases">${d.documents.map((x) => gerer() ? `<label class="case"><input type="checkbox" data-doc="${d.id}" data-code="${x.code}" data-version="${d.version}"${x.recu ? ' checked' : ''}> ${C(`document.${x.code}`)}</label>` : `<span class="note">${C(`document.${x.code}`)} : ${C(x.recu ? 'demandes.recu' : 'demandes.manquant')}</span>`).join('')}</div></div>
          ${gerer() ? `<div class="actions">${d.statut === 'recue' ? `<button class="btn" data-dh="verifier" data-id="${d.id}" data-version="${d.version}">${C('demandes.verifier')}</button>` : ''}
            ${d.statut === 'en_verification' ? `<button class="btn pri" data-dh="proposer_place" data-id="${d.id}" data-version="${d.version}">${C('demandes.proposer')}</button>` : ''}
            ${d.statut === 'place_proposee' ? `<button class="btn pri" data-dh="accepter" data-id="${d.id}" data-version="${d.version}">${C('demandes.accepter')}</button>` : ''}
            <button class="btn dan" data-dh="refuser" data-id="${d.id}" data-version="${d.version}">${C('demandes.refuser')}</button></div>` : ''}</div>`).join('')}</div>` : `<p class="vide">${C('demandes.aucune')}</p>`}`;
    if ($('#dh-nouvelle')) $('#dh-nouvelle').onclick = () => modale(t('chsld.demandes.nouvelle'), `<div class="ligne">${sel('dh-prov', C('demandes.provenance'), ['mecanisme_acces', 'hopital', 'autre_chsld', 'domicile'].map((x) => [x, t(`chsld.provenance.${x}`)]))}${champ('dh-ref', C('demandes.reference_externe'))}</div>
      <div class="ligne">${champ('dh-prenom', C('nouveau.prenom'))}${champ('dh-nom', C('nouveau.nom'))}${champ('dh-dn', C('nouveau.date_naissance'), '', 'type="date"')}</div>
      <div class="ligne">${sel('dh-type', C('demandes.type'), [['', '—'], ...cfg.types.map((x) => [x.id, nomType(x)])])}${champ('dh-arrivee', C('demandes.arrivee'), '', 'type="date"')}</div>
      <p class="lbl">${C('demandes.documents')}</p><div class="cases">${['formulaire_mecanisme', 'identite', 'carte_assurance_maladie', 'mandat_representant', 'consentement_hebergement'].map((x) => `<label class="case"><input type="checkbox" data-dh-doc value="${x}"> ${C(`document.${x}`)}</label>`).join('')}</div>`,
    [{ label: t('general.annuler') }, { label: t('general.enregistrer'), pri: true, run: async () => (await agir(null, () => api('POST', '/chsld/demandes', { etablissement_id: ctx(), provenance: $('#dh-prov').value,
      reference_externe: $('#dh-ref').value, prenom: $('#dh-prenom').value, nom: $('#dh-nom').value, date_naissance: $('#dh-dn').value, type_id: Number($('#dh-type').value) || null,
      arrivee_souhaitee: $('#dh-arrivee').value || null, documents_recus: [...document.querySelectorAll('[data-dh-doc]:checked')].map((x) => x.value) }), (d) => t('chsld.demandes.cree', { numero: d.numero }))) !== null || false }]);
    v.querySelectorAll('[data-doc]').forEach((c) => { c.onchange = () => agir(null, () => api('POST', `/chsld/demandes/${c.dataset.doc}/action`, { action: 'document', code: c.dataset.code, recu: c.checked, version: Number(c.dataset.version) })); });
    v.querySelectorAll('[data-dh]').forEach((b) => { b.onclick = async () => {
      const corps = { action: b.dataset.dh, version: Number(b.dataset.version) };
      if (b.dataset.dh === 'proposer_place') {
        const libres = await placesLibres();
        return modale(t('chsld.demandes.proposer'), libres.length ? sel('dh-lit', C('actions.choisir_place'), libres.map((p) => [p.id, `${p.unite} · ${p.code}`])) : `<p>${C('actions.aucune_place')}</p>`,
          [{ label: t('general.annuler') }, ...(libres.length ? [{ label: t('general.confirmer'), pri: true, run: async () => { const p = libres.find((x) => x.id === Number($('#dh-lit').value));
            return (await agir(null, () => api('POST', `/chsld/demandes/${b.dataset.id}/action`, { ...corps, lit_id: p.id, version_lit: p.version }), t('chsld.actions.ok'))) !== null || false; } }] : [])]);
      }
      return agir(b, () => api('POST', `/chsld/demandes/${b.dataset.id}/action`, corps), t('chsld.actions.ok'));
    }; });
  }

  /* ------------------------------------------------------------------ Admissions et sorties */
  async function vueAdmissions() {
    const v = $('#v-c-admissions');
    const [prevus, presents] = await Promise.all([api('GET', `/chsld/residents?etablissement_id=${ctx()}&statut=preadmission`), api('GET', `/chsld/residents?etablissement_id=${ctx()}&statut=present`)]);
    const ligne = (r) => `<div class="item"><div><button class="lien" data-res="${r.id}">${esc(r.prenom)} ${esc(r.nom)}</button> <span class="note num">${esc(r.reference)}</span>
      <div class="note">${r.lit ? `${esc(r.unite)} · ${esc(r.lit)}` : '—'}${r.arrivee_prevue ? ` · ${C('fiche.arrivee_prevue')} ${esc(jour(r.arrivee_prevue))}` : ''}</div></div>
      ${gerer() && r.statut === 'preadmission' && r.lit ? `<div class="actions"><button class="btn pri" data-arrivee="${r.id}" data-version="${r.version}">${C('actions.arrivee')}</button></div>` : ''}</div>`;
    v.innerHTML = `<div class="entete"><div><h2>${C('admissions.titre')}</h2><p>${C('admissions.intro')}</p></div>${gerer() ? `<button class="btn pri" id="ad-nouveau">${icone('plus')}${C('residents.nouveau')}</button>` : ''}</div>
      <div class="deux"><div class="panneau-c"><h3>${C('admissions.prevus')} <span class="num">${prevus.length}</span></h3><div class="liste">${prevus.map(ligne).join('') || `<p class="note">${C('admissions.aucun')}</p>`}</div></div>
      <div class="panneau-c"><h3>${C('admissions.presents')} <span class="num">${presents.length}</span></h3><div class="liste">${presents.slice(0, 60).map(ligne).join('')}</div></div></div>`;
    v.querySelectorAll('[data-res]').forEach((b) => { b.onclick = () => { etat.chResident = Number(b.dataset.res); allerA('c-residents'); }; });
    v.querySelectorAll('[data-arrivee]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/chsld/residents/${b.dataset.arrivee}/arrivee`, { version: Number(b.dataset.version) }), t('chsld.actions.ok')); });
    if ($('#ad-nouveau')) $('#ad-nouveau').onclick = () => formulaireNouveauResident();
  }

  /* ------------------------------------------------------------------ Personnel et tâches */
  async function vueTaches() {
    const v = $('#v-c-taches');
    const liste = await api('GET', `/chsld/taches?etablissement_id=${ctx()}`);
    const peutCreer = role() !== 'entretien';
    v.innerHTML = `<div class="entete"><div><h2>${C('taches.titre')}</h2><p>${C('taches.intro')}</p></div>${peutCreer ? `<button class="btn pri" id="ta-nouvelle">${icone('plus')}${C('taches.nouvelle')}</button>` : ''}</div>
      ${liste.length ? `<div class="liste">${liste.map((x) => `<div class="item"><div><b>${esc(x.titre)}</b> · ${C(`tache_type.${x.type}`)} ${pastille(x.statut, t(`chsld.tache_statut.${x.statut}`))}
        <div class="note">${[x.lit, x.resident_ref, x.assigne_role ? t(`roles.${x.assigne_role}`) : null, x.echeance ? `${t('chsld.taches.echeance')} ${dateHeure(x.echeance)}` : null].filter(Boolean).map(esc).join(' · ')}${x.echeance && new Date(x.echeance) < new Date() ? ` · <b class="duree-24">${C('taches.en_retard')}</b>` : ''}</div>${x.detail ? `<div class="note">${esc(x.detail)}</div>` : ''}</div>
        <div class="actions">${x.statut === 'a_faire' ? `<button class="btn" data-ta="en_cours" data-id="${x.id}" data-version="${x.version}">${C('taches.commencer')}</button>` : ''}<button class="btn pri" data-ta="faite" data-id="${x.id}" data-version="${x.version}">${C('taches.faite')}</button>
          ${peutCreer ? `<button class="btn dan" data-ta="annulee" data-id="${x.id}" data-version="${x.version}">${C('taches.annuler')}</button>` : ''}</div></div>`).join('')}</div>` : `<p class="vide">${C('taches.aucune')}</p>`}`;
    v.querySelectorAll('[data-ta]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/chsld/taches/${b.dataset.id}/statut`, { statut: b.dataset.ta, version: Number(b.dataset.version) }), t('chsld.actions.ok')); });
    if ($('#ta-nouvelle')) $('#ta-nouvelle').onclick = async () => {
      const places = await api('GET', `/chsld/places?etablissement_id=${ctx()}`);
      modale(t('chsld.taches.nouvelle'), `<div class="ligne">${sel('ta-type', C('taches.type'), ['entretien', 'preparation_chambre', 'administratif', 'transmission', 'relance'].map((x) => [x, t(`chsld.tache_type.${x}`)]))}
          ${sel('ta-role', C('taches.assigne'), [['', '—'], ...['entretien', 'equipe_soins', 'coordonnateur', 'admin_etab'].map((x) => [x, t(`roles.${x}`)])])}</div>${champ('ta-titre', C('taches.titre_champ'), '', 'maxlength="160"')}
        <div class="champ"><label class="lbl" for="ta-detail">${C('taches.detail')}</label><textarea id="ta-detail" maxlength="1000"></textarea></div>
        <div class="ligne">${sel('ta-lit', C('residents.place'), [['', '—'], ...places.map((p) => [p.id, `${p.unite} · ${p.code}`])])}${champ('ta-echeance', C('taches.echeance'), '', 'type="datetime-local"')}</div>`,
      [{ label: t('general.annuler') }, { label: t('general.enregistrer'), pri: true, run: async () => (await agir(null, () => api('POST', '/chsld/taches', { etablissement_id: ctx(), type: $('#ta-type').value,
        assigne_role: $('#ta-role').value || null, titre: $('#ta-titre').value, detail: $('#ta-detail').value, lit_id: Number($('#ta-lit').value) || null, echeance: $('#ta-echeance').value || null }), t('chsld.taches.creee'))) !== null || false }]);
    };
  }

  /* ------------------------------------------------------------------ Coordinations (CHSLD et hôpital) */
  const ACTIONS_CO = {
    hospitalisation: { origine: { envoyee: ['confirmer_depart', 'annuler'], en_cours: ['incident'] }, destination: { en_cours: ['confirmer_reception', 'retour'], recue: ['retour', 'incident'] } },
    retour: { origine: { acceptee: ['confirmer_depart'], envoyee: ['incident'] }, destination: { envoyee: ['accepter', 'refuser'], acceptee: ['incident'], en_cours: ['confirmer_arrivee'] } },
    transfert_chsld: { origine: { envoyee: ['annuler'], acceptee: ['confirmer_depart', 'annuler'] }, destination: { envoyee: ['accepter', 'refuser'], en_cours: ['confirmer_arrivee'] } },
  };
  function carteCoordination(c) {
    const cote = c.entrante ? 'destination' : 'origine';
    const actions = (ACTIONS_CO[c.type]?.[cote]?.[c.statut] || []).filter((a) => a !== 'retour' || gererCo());
    return `<div class="item ch-coord"><div><b class="num">${esc(c.numero)}</b> · ${C(`coord.type_${c.type}`)} · <span class="num">${esc(c.resident_ref)}</span> ${pastille(c.statut, t(`chsld.coord_statut.${c.statut}`))}
      <div class="note">${esc(c.origine)} → ${esc(c.destination)}${c.lit ? ` · ${esc(c.lit)}` : ''}${c.retour_prevu_le ? ` · ${C('coord.retour_le', { date: dateHeure(c.retour_prevu_le) })}` : ''}${c.incident ? ` · <b>${C(`coord.incident_${c.incident}`)}</b>` : ''}</div>
      ${c.etapes?.length ? `<details><summary class="note">${C('coord.etapes')}</summary><ol class="ch-historique">${c.etapes.map((e) => `<li><span class="note num">${esc(dateHeure(e.date))}</span> ${esc(e.statut.startsWith('incident:') ? t(`chsld.coord.incident_${e.statut.slice(9)}`) : t(`chsld.coord_statut.${e.statut}`))}${e.detail ? ` · ${esc(e.detail)}` : ''}</li>`).join('')}</ol></details>` : ''}</div>
      ${actions.length ? `<div class="actions">${actions.map((a) => `<button class="btn${['confirmer_depart', 'confirmer_reception', 'confirmer_arrivee', 'accepter'].includes(a) ? ' pri' : a === 'refuser' || a === 'annuler' ? ' dan' : ''}" data-co="${a}" data-id="${c.id}" data-version="${c.version}" data-type="${c.type}">${C(`coord.${a === 'retour' ? 'preparer_retour' : a}`)}</button>`).join('')}</div>` : ''}</div>`;
  }
  const gererCo = () => ['coordonnateur', 'admin_etab', 'gestionnaire'].includes(role());
  function brancherCoordinations(zone) {
    zone.querySelectorAll('[data-co]').forEach((b) => { b.onclick = async () => {
      const id = b.dataset.id, version = Number(b.dataset.version), a = b.dataset.co, ok = t('chsld.actions.ok');
      if (a === 'retour') return modale(t('chsld.coord.preparer_retour'), `${champ('rt-date', C('actions.retour_prevu'), '', 'type="datetime-local"')}${champ('rt-motif', C('actions.motif_admin'), '', 'maxlength="200"')}`,
        [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => (await agir(null, () => api('POST', `/coordinations/${id}/retour`, { retour_prevu_le: $('#rt-date').value, motif_admin: $('#rt-motif').value }), ok)) !== null || false }]);
      if (a === 'incident') return modale(t('chsld.coord.incident'), `${sel('in-code', C('coord.incident'), ['retour_retarde', 'hospitalisation_prolongee', 'informations_manquantes', 'chambre_indisponible'].map((x) => [x, t(`chsld.coord.incident_${x}`)]))}${champ('in-date', C('actions.retour_prevu'), '', 'type="datetime-local"')}`,
        [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => (await agir(null, () => api('POST', `/coordinations/${id}/action`, { etablissement_id: ctx(), version, action: 'incident', incident: $('#in-code').value, retour_prevu_le: $('#in-date').value || null }), ok)) !== null || false }]);
      if (a === 'accepter' && b.dataset.type === 'transfert_chsld') {
        const libres = await placesLibres();
        return modale(t('chsld.coord.place_accueil'), libres.length ? sel('ac-lit', C('actions.choisir_place'), libres.map((p) => [p.id, `${p.unite} · ${p.code}`])) : `<p>${C('actions.aucune_place')}</p>`,
          [{ label: t('general.annuler') }, ...(libres.length ? [{ label: t('general.confirmer'), pri: true, run: async () => { const p = libres.find((x) => x.id === Number($('#ac-lit').value));
            return (await agir(null, () => api('POST', `/coordinations/${id}/action`, { etablissement_id: ctx(), version, action: 'accepter', lit_id: p.id, version_lit: p.version }), ok)) !== null || false; } }] : [])]);
      }
      return agir(b, () => api('POST', `/coordinations/${id}/action`, { etablissement_id: ctx(), version, action: a }), ok);
    }; });
  }
  async function vueMouvements() {
    const v = $('#v-c-mouvements');
    const liste = await api('GET', `/coordinations?etablissement_id=${ctx()}`);
    const entrantes = liste.filter((c) => c.entrante), sortantes = liste.filter((c) => !c.entrante);
    v.innerHTML = `<div class="entete"><div><h2>${C('coord.titre')}</h2><p>${C('coord.intro')}</p></div></div>
      <div class="deux"><div class="panneau-c"><h3>${C('coord.sortantes')}</h3><div class="liste">${sortantes.map(carteCoordination).join('') || `<p class="note">${C('coord.aucune')}</p>`}</div></div>
      <div class="panneau-c"><h3>${C('coord.entrantes')}</h3><div class="liste">${entrantes.map(carteCoordination).join('') || `<p class="note">${C('coord.aucune')}</p>`}</div></div></div>`;
    brancherCoordinations(v);
  }
  /** Côté hôpital : résidents de CHSLD hospitalisés ici et leurs retours (référence seulement). */
  async function panneauHopital(zone) {
    if (!zone) return;
    let liste = [];
    try { liste = (await api('GET', `/coordinations?etablissement_id=${ctx()}`)).filter((c) => (c.type === 'hospitalisation' && c.entrante) || (c.type === 'retour' && !c.entrante)); } catch { return; }
    if (!liste.length) { zone.innerHTML = ''; return; }
    zone.innerHTML = `<div class="panneau-c ch-hopital"><h3>${C('coord.residents_chsld')}</h3><p class="note">${C('coord.residents_chsld_intro')}</p><div class="liste">${liste.map(carteCoordination).join('')}</div></div>`;
    brancherCoordinations(zone);
  }

  /* ------------------------------------------------------------------ Réseau CHSLD */
  async function vueReseau() {
    const v = $('#v-c-reseau');
    const [r, co] = await Promise.all([api('GET', `/chsld/reseau?etablissement_id=${ctx()}`), api('GET', `/coordinations?etablissement_id=${ctx()}`)]);
    const etabs = [...new Map(r.chsld.map((x) => [x.id, x])).values()];
    v.innerHTML = `<div class="entete"><div><h2>${C('reseau.titre')}</h2><p>${C('reseau.intro')}</p></div></div><p class="note">${C('reseau.non_garantie')}</p>
      <div class="panneau-c"><h3>${C('reseau.capacites')}</h3>${etabs.length ? etabs.map((e) => `<div class="item"><div><b>${esc(e.nom)}</b> <span class="note">${esc(e.ville || '')}</span>
        <ul class="liste-simple">${r.chsld.filter((x) => x.id === e.id).map((x) => `<li>${esc(x.unite)} : ${C('reseau.libres', { n: x.libres })} · ${C('reseau.confirmees', { n: x.confirmees })}</li>`).join('')}</ul></div></div>`).join('') : `<p class="note">${C('reseau.aucun')}</p>`}</div>
      <div class="panneau-c"><h3>${C('coord.type_transfert_chsld')}</h3><div class="liste">${co.filter((c) => c.type === 'transfert_chsld').map(carteCoordination).join('') || `<p class="note">${C('coord.aucune')}</p>`}</div></div>`;
    brancherCoordinations(v);
  }

  /* ------------------------------------------------------------------ Indicateurs */
  async function vueIndicateurs() {
    const v = $('#v-c-indicateurs');
    const i = await api('GET', `/chsld/indicateurs?etablissement_id=${ctx()}&jours=${etat.jours || 30}`);
    v.innerHTML = `<div class="entete"><div><h2>${C('indicateurs.titre')}</h2><p>${C('indicateurs.intro')}</p></div></div>
      <div class="tuiles">${tuile(C('indicateurs.occupation'), i.occupation == null ? '—' : pct(i.occupation))}${tuile(C('accueil.libres'), i.places.libres)}${tuile(C('accueil.preparation'), i.places.preparation)}
        ${tuile(C('indicateurs.delai'), i.delai_demande_jours == null ? '—' : t('chsld.indicateurs.jours', { n: nb(i.delai_demande_jours) }))}${tuile(C('indicateurs.preparation'), i.preparation_minutes == null ? '—' : t('chsld.indicateurs.minutes', { n: i.preparation_minutes }))}
        ${tuile(C('indicateurs.taches'), `${i.taches.faites} / ${i.taches.ouvertes} / ${i.taches.en_retard}`)}</div>
      <div class="panneau-c"><h3>${C('indicateurs.mouvements')}</h3>${Object.keys(i.mouvements).length ? `<ul class="liste-simple">${Object.entries(i.mouvements).filter(([k]) => k !== 'modification').map(([k, n]) => `<li>${C(`mvt.${k}`)} : <b class="num">${n}</b></li>`).join('')}</ul>` : `<p class="note">${C('fiche.aucun')}</p>`}</div>`;
  }

  window.ArrimoChsld = { vues: { 'c-accueil': vueAccueil, 'c-residents': vueResidents, 'c-chambres': vueChambres, 'c-demandes': vueDemandes, 'c-admissions': vueAdmissions,
    'c-taches': vueTaches, 'c-reseau': vueReseau, 'c-mouvements': vueMouvements, 'c-indicateurs': vueIndicateurs }, panneauHopital };
})();
