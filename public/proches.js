/* Portail des proches (pilote) : invitation, connexion, messages et demandes de rappel dans les catégories autorisées.
   Aucune chambre, localisation ni donnée clinique n'est affichée : le serveur ne les transmet pas. */
(() => {
  const TXT = {
    fr: { s_transfert_preparation: 'Transfert en préparation vers {hopital} (demande du {date}). Le départ n’est pas encore confirmé.', s_transfert_entre_hopitaux: 'En transfert vers {hopital} — départ confirmé le {date}.', s_retour_en_route: 'En route vers l’établissement — départ confirmé le {date}.', s_arrivee_confirmee: 'Arrivé(e) à l’établissement le {date}. Réintégration dans la chambre à confirmer.', s_reintegre: 'De retour dans sa chambre depuis le {date}.',
      parcours: 'Étapes confirmées', e_transfert_preparation: 'Transfert en préparation', e_depart_confirme: 'Départ confirmé', e_hospitalisation_en_cours: 'Hospitalisation en cours', e_retour_prevu: 'Retour prévu', e_arrivee_confirmee: 'Arrivée confirmée', e_reintegre: 'Réintégration dans sa chambre', a_venir: 'à venir',
      nouveau_dispo: 'De nouvelles informations sont disponibles.', actualiser: 'Actualiser', notif_titre: 'Notifications', notif_aide: 'Une notification discrète vous invite à ouvrir le portail. Elle ne contient ni nom ni renseignement.', notif_activer: 'Activer les notifications', notif_retirer: 'Retirer les notifications', notif_refus: 'Le téléphone a refusé les notifications.', notif_iphone: 'Sur iPhone : ajoutez d’abord le portail à l’écran d’accueil.', notif_ok: 'Notifications activées.', notif_non: 'Notifications retirées.', activites: 'Activités de l’établissement', visites: 'Mes visites', visite_date: 'Date souhaitée', visite_demander: 'Demander une visite', visite_ok: 'Demande de visite transmise.', v_demandee: 'demandée', v_acceptee: 'acceptée', v_refusee: 'refusée', v_annulee: 'annulée', titre: 'Portail des proches', connexion: 'Connexion', courriel: 'Courriel', mdp: 'Mot de passe', entrer: 'Se connecter', invitation: 'Bienvenue',
      invitation_aide: 'Choisissez votre mot de passe : au moins 12 caractères, avec des lettres et des chiffres.', choisir: 'Enregistrer mon mot de passe', invitation_ok: 'Votre accès est prêt. Connectez-vous.',
      bonjour: 'Bonjour {prenom}', resident: 'Vous êtes associé(e) à {resident}, {etab}.', categories: 'Vous pouvez échanger sur : {liste}.', messages: 'Vos échanges avec l’établissement',
      aucun: 'Aucun message pour l’instant.', ecrire: 'Écrire à l’établissement', categorie: 'Sujet', texte: 'Votre message', envoyer: 'Envoyer', rappel: 'Demander qu’on me rappelle',
      envoye: 'Message envoyé à l’établissement.', rappel_ok: 'Demande de rappel transmise.', deconnexion: 'Se déconnecter', vous: 'Vous', etab: 'L’établissement',
      expire: 'Accès valable jusqu’au {date}.', situation: 'Situation de {resident}', maj: 'Mis à jour le {date}.', nouveaux: '{n} nouveau(x) message(s) de l’établissement.',
      s_present: 'Présent(e) à l’établissement.', s_absence_temporaire: 'En absence temporaire.', s_absent_etablissement: 'Absent(e) de l’établissement pour le moment.',
      s_hospitalise_confirme: 'Hospitalisé(e) à {hopital} — arrivée confirmée par l’hôpital le {date}.', s_hospitalise_depart_confirme: 'Parti(e) vers {hopital} le {date} — arrivée non encore confirmée par l’hôpital.',
      retour: 'Retour prévu le {date}.', s_autre: 'Situation en cours de mise à jour.', pas_temps_reel: 'Ces informations reprennent les dernières étapes confirmées ; ce n’est pas une position en temps réel.', confidentialite: 'Ce portail ne contient aucune information médicale. Pour une urgence, appelez le 911.',
      cat: { administratif: 'Questions administratives', hebergement: 'Hébergement', rendez_vous: 'Rendez-vous et visites', mouvements: 'Hospitalisation et retour' } },
    en: { s_transfert_preparation: 'Transfer being prepared to {hopital} (requested on {date}). Departure not yet confirmed.', s_transfert_entre_hopitaux: 'Being transferred to {hopital} — departure confirmed on {date}.', s_retour_en_route: 'On the way to the facility — departure confirmed on {date}.', s_arrivee_confirmee: 'Arrived at the facility on {date}. Return to the room still to be confirmed.', s_reintegre: 'Back in their room since {date}.',
      parcours: 'Confirmed steps', e_transfert_preparation: 'Transfer being prepared', e_depart_confirme: 'Departure confirmed', e_hospitalisation_en_cours: 'Hospital stay in progress', e_retour_prevu: 'Return planned', e_arrivee_confirmee: 'Arrival confirmed', e_reintegre: 'Back in their room', a_venir: 'to come',
      nouveau_dispo: 'New information is available.', actualiser: 'Refresh', notif_titre: 'Notifications', notif_aide: 'A discreet notification invites you to open the portal. It contains no name or details.', notif_activer: 'Turn on notifications', notif_retirer: 'Turn off notifications', notif_refus: 'The phone refused notifications.', notif_iphone: 'On iPhone: first add the portal to the home screen.', notif_ok: 'Notifications on.', notif_non: 'Notifications off.', activites: 'Facility activities', visites: 'My visits', visite_date: 'Preferred date', visite_demander: 'Request a visit', visite_ok: 'Visit request sent.', v_demandee: 'requested', v_acceptee: 'accepted', v_refusee: 'refused', v_annulee: 'cancelled', titre: 'Family portal', connexion: 'Sign in', courriel: 'Email', mdp: 'Password', entrer: 'Sign in', invitation: 'Welcome',
      invitation_aide: 'Choose your password: at least 12 characters, with letters and numbers.', choisir: 'Save my password', invitation_ok: 'Your access is ready. Sign in.',
      bonjour: 'Hello {prenom}', resident: 'You are linked to {resident}, {etab}.', categories: 'You can exchange about: {liste}.', messages: 'Your exchanges with the facility',
      aucun: 'No message yet.', ecrire: 'Write to the facility', categorie: 'Subject', texte: 'Your message', envoyer: 'Send', rappel: 'Ask to be called back',
      envoye: 'Message sent to the facility.', rappel_ok: 'Callback request sent.', deconnexion: 'Sign out', vous: 'You', etab: 'The facility',
      expire: 'Access valid until {date}.', situation: '{resident}’s situation', maj: 'Updated on {date}.', nouveaux: '{n} new message(s) from the facility.',
      s_present: 'At the facility.', s_absence_temporaire: 'Temporarily away.', s_absent_etablissement: 'Away from the facility for now.',
      s_hospitalise_confirme: 'In hospital at {hopital} — arrival confirmed by the hospital on {date}.', s_hospitalise_depart_confirme: 'Left for {hopital} on {date} — arrival not yet confirmed by the hospital.',
      retour: 'Return planned on {date}.', s_autre: 'Situation being updated.', pas_temps_reel: 'This reflects the latest confirmed steps; it is not a real-time location.', confidentialite: 'This portal contains no medical information. In an emergency, call 911.',
      cat: { administratif: 'Administrative questions', hebergement: 'Accommodation', rendez_vous: 'Appointments and visits', mouvements: 'Hospital stay and return' } },
  };
  let langue = (() => { try { return localStorage.getItem('arrimo-langue') === 'en' ? 'en' : 'fr'; } catch { return 'fr'; } })();
  let jeton = null; try { jeton = sessionStorage.getItem('arrimo-proche'); } catch { /* */ }
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = (k, v) => { let s = k.split('.').reduce((o, x) => o?.[x], TXT[langue]) ?? k; if (v) s = s.replace(/\{(\w+)\}/g, (m, x) => v[x] ?? m); return s; };
  async function api(m, chemin, corps) {
    const r = await fetch(`/api${chemin}`, { method: m, headers: { 'Content-Type': 'application/json', 'X-Langue': langue, ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
    const d = await r.json().catch(() => null);
    if (r.status === 401 && jeton) { jeton = null; try { sessionStorage.removeItem('arrimo-proche'); } catch { /* */ } }
    if (!r.ok) throw new Error((d && d.erreur) || `Erreur ${r.status}`);
    return d;
  }
  const z = () => $('#contenu');
  const message = (cls, texte) => `<p class="${cls}" role="${cls === 'erreur' ? 'alert' : 'status'}">${esc(texte)}</p>`;
  function ecranConnexion(info) {
    z().innerHTML = `<form id="f" class="panneau-c"><h2>${esc(T('connexion'))}</h2>${info ? message('succes-msg', info) : ''}
      <label class="lbl" for="c">${esc(T('courriel'))}</label><input id="c" type="email" autocomplete="username" required>
      <label class="lbl" for="m">${esc(T('mdp'))}</label><input id="m" type="password" autocomplete="current-password" required>
      <div id="e"></div><button class="btn pri" type="submit">${esc(T('entrer'))}</button><p class="note">${esc(T('confidentialite'))}</p></form>`;
    $('#f').onsubmit = async (ev) => { ev.preventDefault(); try { const r = await api('POST', '/proches/connexion', { courriel: $('#c').value, mot_de_passe: $('#m').value });
      jeton = r.token; try { sessionStorage.setItem('arrimo-proche', jeton); } catch { /* */ } ecranAccueil(); } catch (e) { $('#e').innerHTML = message('erreur', e.message); } };
  }
  function ecranInvitation(cle) {
    z().innerHTML = `<form id="f" class="panneau-c"><h2>${esc(T('invitation'))}</h2><p>${esc(T('invitation_aide'))}</p>
      <label class="lbl" for="m">${esc(T('mdp'))}</label><input id="m" type="password" autocomplete="new-password" required>
      <div id="e"></div><button class="btn pri" type="submit">${esc(T('choisir'))}</button></form>`;
    $('#f').onsubmit = async (ev) => { ev.preventDefault(); try { await api('POST', '/proches/invitation', { jeton: cle, mot_de_passe: $('#m').value });
      history.replaceState(null, '', '/proches'); ecranConnexion(T('invitation_ok')); } catch (e) { $('#e').innerHTML = message('erreur', e.message); } };
  }
  const dt = (iso) => (iso ? new Date(iso).toLocaleString(langue === 'en' ? 'en-CA' : 'fr-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '');
  /* Actualisation automatique : page visible seulement, sans marquer les messages comme lus et sans effacer une saisie en cours. */
  let empreinte = null;
  async function verifierNouveautes() {
    if (!jeton || document.hidden || !$('#dec')) return;
    let e; try { e = await api('GET', '/proches/etat'); } catch { return; }
    if (!empreinte || e.empreinte === empreinte) return;
    const saisie = $('#txt')?.value || $('#vis')?.value;
    if (!saisie) { ecranAccueil(); return; }
    if (!$('#nouveau-dispo')) { $('#contenu').insertAdjacentHTML('afterbegin', `<p id="nouveau-dispo" class="panneau-c" role="status">${esc(T('nouveau_dispo'))} <button class="btn" id="b-actualiser">${esc(T('actualiser'))}</button></p>`); $('#b-actualiser').onclick = () => ecranAccueil(); }
  }
  setInterval(verifierNouveautes, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) verifierNouveautes(); });
  /* Notifications : demandées par le proche, sans contenu. */
  const cleOctets = (c) => Uint8Array.from(atob(c.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(c.length / 4) * 4, '=')), (x) => x.charCodeAt(0));
  async function panneauNotifications() {
    const z = $('#notifications'); if (!z) return;
    const n = await api('GET', '/proches/notifications').catch(() => null);
    if (!n?.disponible) return;
    const pris = 'serviceWorker' in navigator && 'PushManager' in window;
    z.hidden = false;
    z.innerHTML = `<h2>${esc(T('notif_titre'))}</h2><p class="note">${esc(T(pris ? 'notif_aide' : 'notif_iphone'))}</p>${pris ? `<button class="btn" id="b-notif">${esc(T(n.abonne ? 'notif_retirer' : 'notif_activer'))}</button>` : ''}<div id="notif-msg"></div>`;
    if (!pris) return;
    $('#b-notif').onclick = async () => { try {
      const reg = await navigator.serviceWorker.ready; const ab = await reg.pushManager.getSubscription();
      if (n.abonne) { await ab?.unsubscribe(); await api('DELETE', '/proches/notifications'); ecranAccueil(T('notif_non')); return; }
      if (await Notification.requestPermission() !== 'granted') { $('#notif-msg').innerHTML = message('erreur', T('notif_refus')); return; }
      const s = ab || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleOctets(n.cle) });
      await api('POST', '/proches/notifications', { endpoint: s.endpoint }); ecranAccueil(T('notif_ok'));
    } catch (e) { $('#notif-msg').innerHTML = message('erreur', e.message); } };
  }
  async function ecranAccueil(info) {
    let d; try { d = await api('GET', '/proches/moi'); } catch (e) { ecranConnexion(); $('#contenu').insertAdjacentHTML('afterbegin', message('erreur', e.message)); return; }
    const cats = d.autorisations;
    z().innerHTML = `<section class="panneau-c"><h2>${esc(T('bonjour', { prenom: d.proche.prenom }))}</h2>
        <p>${esc(T('resident', { resident: `${d.resident.prenom} ${d.resident.initiale}`, etab: d.etablissement.nom }))}</p>
        <p class="note">${esc(T('categories', { liste: cats.map((c) => T(`cat.${c}`)).join(', ') }))}</p>${d.expire_le ? `<p class="note">${esc(T('expire', { date: new Date(d.expire_le).toLocaleDateString(langue === 'en' ? 'en-CA' : 'fr-CA') }))}</p>` : ''}
        ${info ? message('succes-msg', info) : ''}${d.nouveaux_messages ? message('succes-msg', T('nouveaux', { n: d.nouveaux_messages })) : ''}</section>
      ${d.situation ? `<section class="panneau-c"><h2>${esc(T('situation', { resident: `${d.resident.prenom} ${d.resident.initiale}` }))}</h2>
        <p><b>${esc(T(`s_${d.situation.statut}`, { hopital: d.situation.hopital || '', date: dt(d.situation.depuis) }))}</b></p>
        ${d.situation.retour_prevu_le ? `<p>${esc(T('retour', { date: dt(d.situation.retour_prevu_le) }))}</p>` : ''}
        ${d.situation.parcours ? `<h3>${esc(T('parcours'))}</h3><ol id="parcours">${d.situation.parcours.map((x) => `<li${x.fait ? ' data-fait="1"' : ''}>${x.fait ? '<b>' : ''}${esc(T(`e_${x.code}`))}${x.fait ? '</b>' : ''} · ${esc(x.fait ? dt(x.date) : T('a_venir'))}</li>`).join('')}</ol>` : ''}
        ${d.situation.mis_a_jour_le ? `<p class="note">${esc(T('maj', { date: dt(d.situation.mis_a_jour_le) }))}</p>` : ''}<p class="note">${esc(T('pas_temps_reel'))}</p></section>` : ''}
      <section class="panneau-c"><h2>${esc(T('ecrire'))}</h2><label class="lbl" for="cat">${esc(T('categorie'))}</label>
        <select id="cat">${cats.map((c) => `<option value="${c}">${esc(T(`cat.${c}`))}</option>`).join('')}</select>
        <label class="lbl" for="txt">${esc(T('texte'))}</label><textarea id="txt" maxlength="2000"></textarea><div id="e"></div>
        <div class="ligne"><button class="btn pri" id="env">${esc(T('envoyer'))}</button><button class="btn" id="rap">${esc(T('rappel'))}</button></div></section>
      <section class="panneau-c"><h2>${esc(T('messages'))}</h2><div class="fil">${d.messages.length ? d.messages.map((m) => `<div class="message ${m.sens}"><b>${esc(T(m.sens === 'proche' ? 'vous' : 'etab'))}</b> · <span class="note">${esc(T(`cat.${m.categorie}`))} · ${esc(new Date(m.cree_le).toLocaleString(langue === 'en' ? 'en-CA' : 'fr-CA', { dateStyle: 'medium', timeStyle: 'short' }))}</span><p>${esc(m.texte)}</p></div>`).join('') : `<p class="note">${esc(T('aucun'))}</p>`}</div></section>
      ${d.activites?.length ? `<section class="panneau-c" id="activites"><h2>${esc(T('activites'))}</h2>${d.activites.map((x) => `<p><b>${esc(x.titre)}</b> · ${esc(dt(x.debut_le))}${x.description ? `<br>${esc(x.description)}` : ''}</p>`).join('')}</section>` : ''}
      ${d.visites ? `<section class="panneau-c" id="visites"><h2>${esc(T('visites'))}</h2>${d.visites.map((x) => `<p>${esc(dt(x.souhaitee_le))} · ${esc(T(`v_${x.statut}`))}</p>`).join('')}<label class="lbl" for="vis">${esc(T('visite_date'))}</label><input id="vis" type="datetime-local"><div id="ev"></div><button class="btn pri" id="vis-ok">${esc(T('visite_demander'))}</button></section>` : ''}
      <section class="panneau-c" id="notifications" hidden></section>
      <button class="btn" id="dec">${esc(T('deconnexion'))}</button><p class="note">${esc(T('confidentialite'))}</p>`;
    const envoyer = async (rappel) => { try { await api('POST', '/proches/messages', { categorie: $('#cat').value, texte: $('#txt').value || (rappel ? T('rappel') : ''), rappel });
      ecranAccueil(T(rappel ? 'rappel_ok' : 'envoye')); } catch (e) { $('#e').innerHTML = message('erreur', e.message); } };
    if ($('#vis-ok')) $('#vis-ok').onclick = async () => { try { await api('POST', '/proches/visites', { souhaitee_le: new Date($('#vis').value).toISOString() }); ecranAccueil(T('visite_ok')); } catch (e) { $('#ev').innerHTML = message('erreur', e.message); } };
    empreinte = (await api('GET', '/proches/etat').catch(() => ({}))).empreinte || null; panneauNotifications();
    $('#env').onclick = () => envoyer(false); $('#rap').onclick = () => envoyer(true);
    $('#dec').onclick = async () => { await api('POST', '/proches/deconnexion').catch(() => {}); jeton = null; try { sessionStorage.removeItem('arrimo-proche'); } catch { /* */ } ecranConnexion(); };
  }
  function demarrer() {
    document.documentElement.lang = langue === 'en' ? 'en-CA' : 'fr-CA'; $('#titre').textContent = T('titre');
    document.querySelectorAll('[data-langue]').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.langue === langue)); b.onclick = () => { langue = b.dataset.langue; try { localStorage.setItem('arrimo-langue', langue); } catch { /* */ } demarrer(); }; });
    const inv = (location.hash.match(/invitation=([a-f0-9]{64})/) || [])[1];
    if (inv) ecranInvitation(inv); else if (jeton) ecranAccueil(); else ecranConnexion();
  }
  demarrer();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw-proches.js', { scope: '/proches' }).catch(() => {});
})();
