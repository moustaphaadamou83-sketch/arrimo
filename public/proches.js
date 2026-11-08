/* Portail des proches (pilote) : invitation, connexion, messages et demandes de rappel dans les catégories autorisées.
   Aucune chambre, localisation ni donnée clinique n'est affichée : le serveur ne les transmet pas. */
(() => {
  const TXT = {
    fr: { nav_accueil: "Accueil", nav_suivi: "Suivi", nav_messages: "Messages", nav_visites: "Visites", nav_demandes: "Demandes", nav_plus: "Plus", bonjour_court: "Bonjour {prenom}", intro: "Voici les dernières informations autorisées concernant votre proche.", derniere_conf: "Dernière confirmation : {date}", attente_conf: "En attente de confirmation", maj_il_y_a: "Mis à jour à {heure}", hors_ligne: "Hors ligne : ces informations peuvent ne plus être à jour.", act_suivi: "Voir le suivi", act_message: "Envoyer un message", act_visite: "Organiser une visite", act_besoin: "Signaler un besoin", act_og: "Poser une question à OG", prochaine_visite: "Prochaine visite", aucune_visite_prevue: "Aucune visite prévue.", demandes_ouvertes: "Demandes ouvertes", actions_attendues: "Vous avez {n} confirmation(s) à donner.", besoin_titre: "Signaler un besoin", besoin_aide: "Pour les besoins pratiques non urgents. Pour une urgence médicale, appelez le 911.", categorie_besoin: "Catégorie", envoyer_demande: "Envoyer la demande", demande_ok: "Demande transmise à l’établissement.", annuler: "Annuler", aucune_demande: "Aucune demande.", reponse_etab: "Réponse : {texte}", confirmations: "Confirmations demandées", je_confirme: "Je confirme", pas_dispo: "Je ne suis pas disponible", precisions: "J’ai besoin de précisions", reponse_ok: "Réponse enregistrée.", creneaux: "Créneaux disponibles", places: "{n} place(s)", participants: "Participants", reserver: "Réserver", aucun_creneau: "Aucun créneau proposé. Vous pouvez demander une date.", visite_annulee: "Visite annulée.", journal: "Journal de vie", og_titre: "OG, votre assistant", og_aide: "OG répond à partir de vos demandes et de vos visites. Il ne donne aucune information de santé.", og_question: "Votre question", demander: "Demander", parametres: "Paramètres", theme: "Apparence", theme_clair: "Clair", theme_sombre: "Sombre", theme_auto: "Automatique", langue: "Langue", profil: "Proche suivi", notif_prefs: "Me prévenir pour", fiabilite: "Seules les étapes confirmées par l’établissement ou l’hôpital sont affichées.", b_vetements: "Vêtements", b_lunettes: "Lunettes", b_effets_personnels: "Effets personnels", b_objet_oublie: "Objet oublié", b_rencontre: "Demande de rencontre", b_administratif: "Question administrative", b_autre: "Autre", d_nouvelle: "Nouvelle", d_recue: "Reçue", d_attribuee: "Attribuée", d_en_cours: "En cours", d_attente_information: "En attente d’information", d_attente_proche: "En attente de votre réponse", d_resolue: "Résolue", d_refusee: "Refusée", d_annulee: "Annulée", d_cloturee: "Clôturée", c_en_attente: "À répondre", c_confirmee: "Confirmée", c_indisponible: "Pas disponible", c_precisions: "Précisions demandées",
      s_transfert_preparation: 'Transfert en préparation vers {hopital} (demande du {date}). Le départ n’est pas encore confirmé.', s_transfert_entre_hopitaux: 'En transfert vers {hopital} — départ confirmé le {date}.', s_retour_en_route: 'En route vers l’établissement — départ confirmé le {date}.', s_arrivee_confirmee: 'Arrivé(e) à l’établissement le {date}. Réintégration dans la chambre à confirmer.', s_reintegre: 'De retour dans sa chambre depuis le {date}.',
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
    en: { nav_accueil: "Home", nav_suivi: "Updates", nav_messages: "Messages", nav_visites: "Visits", nav_demandes: "Requests", nav_plus: "More", bonjour_court: "Hello {prenom}", intro: "Here is the latest authorized information about your loved one.", derniere_conf: "Last confirmed: {date}", attente_conf: "Awaiting confirmation", maj_il_y_a: "Updated at {heure}", hors_ligne: "Offline: this information may be out of date.", act_suivi: "See updates", act_message: "Send a message", act_visite: "Arrange a visit", act_besoin: "Report a need", act_og: "Ask OG", prochaine_visite: "Next visit", aucune_visite_prevue: "No visit planned.", demandes_ouvertes: "Open requests", actions_attendues: "You have {n} confirmation(s) to give.", besoin_titre: "Report a need", besoin_aide: "For non-urgent practical needs. For a medical emergency, call 911.", categorie_besoin: "Category", envoyer_demande: "Send request", demande_ok: "Request sent to the facility.", annuler: "Cancel", aucune_demande: "No request.", reponse_etab: "Answer: {texte}", confirmations: "Confirmations requested", je_confirme: "I confirm", pas_dispo: "I am not available", precisions: "I need more details", reponse_ok: "Answer saved.", creneaux: "Available time slots", places: "{n} spot(s)", participants: "Visitors", reserver: "Book", aucun_creneau: "No time slot offered. You can request a date.", visite_annulee: "Visit cancelled.", journal: "Life journal", og_titre: "OG, your assistant", og_aide: "OG answers using your requests and visits. It gives no health information.", og_question: "Your question", demander: "Ask", parametres: "Settings", theme: "Appearance", theme_clair: "Light", theme_sombre: "Dark", theme_auto: "Automatic", langue: "Language", profil: "Person followed", notif_prefs: "Notify me about", fiabilite: "Only steps confirmed by the facility or the hospital are shown.", b_vetements: "Clothing", b_lunettes: "Glasses", b_effets_personnels: "Personal belongings", b_objet_oublie: "Forgotten item", b_rencontre: "Meeting request", b_administratif: "Administrative question", b_autre: "Other", d_nouvelle: "New", d_recue: "Received", d_attribuee: "Assigned", d_en_cours: "In progress", d_attente_information: "Waiting for information", d_attente_proche: "Waiting for your answer", d_resolue: "Resolved", d_refusee: "Refused", d_annulee: "Cancelled", d_cloturee: "Closed", c_en_attente: "To answer", c_confirmee: "Confirmed", c_indisponible: "Not available", c_precisions: "Details requested",
      s_transfert_preparation: 'Transfer being prepared to {hopital} (requested on {date}). Departure not yet confirmed.', s_transfert_entre_hopitaux: 'Being transferred to {hopital} — departure confirmed on {date}.', s_retour_en_route: 'On the way to the facility — departure confirmed on {date}.', s_arrivee_confirmee: 'Arrived at the facility on {date}. Return to the room still to be confirmed.', s_reintegre: 'Back in their room since {date}.',
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
      jeton = r.token; try { sessionStorage.setItem('arrimo-proche', jeton); sessionStorage.setItem('arrimo-proche-profils', JSON.stringify(r.profils || [])); } catch { /* */ } ecranAccueil(); } catch (e) { $('#e').innerHTML = message('erreur', e.message); } };
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
    if (!jeton || document.hidden || !charge) return;
    let e; try { e = await api('GET', '/proches/etat'); } catch { return; }
    if (!empreinte || e.empreinte === empreinte) return;
    const saisie = $('#txt')?.value || $('#vis')?.value || $('#b-txt')?.value || $('#og-q')?.value;
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
    const cats = charge?.d?.autorisations || [];
    z.innerHTML = `<h2>${esc(T('notif_titre'))}</h2><p class="note">${esc(T(pris ? 'notif_aide' : 'notif_iphone'))}</p>${pris ? `<button class="btn" id="b-notif">${esc(T(n.abonne ? 'notif_retirer' : 'notif_activer'))}</button>` : ''}
      ${n.abonne ? `<fieldset><legend class="lbl">${esc(T('notif_prefs'))}</legend>${cats.map((c) => `<label class="case"><input type="checkbox" data-pref="${c}"${n.preferences?.[c] === false ? '' : ' checked'}> ${esc(T(`cat.${c}`))}</label>`).join('')}</fieldset>` : ''}<div id="notif-msg"></div>`;
    z.querySelectorAll('[data-pref]').forEach((x) => { x.onchange = () => api('PUT', '/proches/notifications/preferences', { [x.dataset.pref]: x.checked }).catch((e) => { $('#notif-msg').innerHTML = message('erreur', e.message); }); });
    if (!pris) return;
    $('#b-notif').onclick = async () => { try {
      const reg = await navigator.serviceWorker.ready; const ab = await reg.pushManager.getSubscription();
      if (n.abonne) { await ab?.unsubscribe(); await api('DELETE', '/proches/notifications'); ecranAccueil(T('notif_non')); return; }
      if (await Notification.requestPermission() !== 'granted') { $('#notif-msg').innerHTML = message('erreur', T('notif_refus')); return; }
      const s = ab || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleOctets(n.cle) });
      await api('POST', '/proches/notifications', { endpoint: s.endpoint }); ecranAccueil(T('notif_ok'));
    } catch (e) { $('#notif-msg').innerHTML = message('erreur', e.message); } };
  }
  /* ------------------------------------------------------------ application : tableau de bord et onglets */
  let onglet = 'accueil'; let charge = null;
  const profils = () => { try { return JSON.parse(sessionStorage.getItem('arrimo-proche-profils') || '[]'); } catch { return []; } };
  const changerProfil = (tok) => { jeton = tok; try { sessionStorage.setItem('arrimo-proche', tok); } catch { /* */ } onglet = 'accueil'; ecranAccueil(); };
  const heure = (iso) => (iso ? new Date(iso).toLocaleTimeString(langue === 'en' ? 'en-CA' : 'fr-CA', { hour: '2-digit', minute: '2-digit' }) : '');
  const carte = (titre, corps, id = '') => `<section class="panneau-c carte-f"${id ? ` id="${id}"` : ''}>${titre ? `<h2>${esc(titre)}</h2>` : ''}${corps}</section>`;
  async function ecranAccueil(info) {
    let d; try { d = await api('GET', '/proches/moi'); } catch (e) { ecranConnexion(); $('#contenu').insertAdjacentHTML('afterbegin', message('erreur', e.message)); return; }
    const opt = (p) => p.catch(() => null);
    const [demandes, confirmations, creneaux, journal] = await Promise.all([opt(api('GET', '/proches/demandes')), opt(api('GET', '/proches/confirmations')), opt(api('GET', '/proches/creneaux')), opt(api('GET', '/proches/journal-vie')).then((j) => (j?.actif ? j.publications : null))]);
    charge = { d, demandes: demandes || [], confirmations: confirmations || [], creneaux: creneaux || [], journal, le: new Date() };
    empreinte = (await api('GET', '/proches/etat').catch(() => ({}))).empreinte || null;
    rendre(info);
  }
  function rendre(info) {
    const { d, demandes, confirmations, creneaux, journal } = charge; const cats = d.autorisations;
    const nom = `${d.resident.prenom} ${d.resident.initiale}`;
    const sit = d.situation;
    const statut = sit ? `<p class="statut-f"><b>${esc(T(`s_${sit.statut}`, { hopital: sit.hopital || '', date: dt(sit.depuis) }))}</b></p><p class="note">${sit.depuis ? esc(T('derniere_conf', { date: dt(sit.depuis) })) : sit.mis_a_jour_le ? esc(T('maj', { date: dt(sit.mis_a_jour_le) })) : ''}</p>` : '';
    const prochaine = (d.visites || []).filter((v) => ['demandee', 'acceptee'].includes(v.statut) && new Date(v.souhaitee_le) > new Date()).sort((a, b) => new Date(a.souhaitee_le) - new Date(b.souhaitee_le))[0];
    const ouvertes = demandes.filter((x) => !['resolue', 'refusee', 'annulee', 'cloturee'].includes(x.statut));
    const attendues = confirmations.filter((x) => x.statut === 'en_attente');
    const onglets = [['accueil', 'nav_accueil'], ...(cats.includes('mouvements') || cats.includes('hebergement') ? [['suivi', 'nav_suivi']] : []), ['messages', 'nav_messages'],
      ...(cats.includes('rendez_vous') ? [['visites', 'nav_visites']] : []), ...(cats.includes('administratif') ? [['demandes', 'nav_demandes']] : []), ['plus', 'nav_plus']];
    if (!onglets.some(([o]) => o === onglet)) onglet = 'accueil';
    const vues = {
      accueil: () => `${carte('', `<h2>${esc(T('bonjour_court', { prenom: d.proche.prenom }))}</h2><p class="note">${esc(T('intro'))}</p>`)}
        ${carte(nom, `<p class="note">${esc(d.etablissement.nom)}</p>${statut}`, 'carte-resident')}
        ${attendues.length ? carte('', `<p><b>${esc(T('actions_attendues', { n: attendues.length }))}</b></p><button class="btn pri" data-aller="demandes">${esc(T('confirmations'))}</button>`) : ''}
        <nav class="actions-f">${[['suivi', 'act_suivi'], ['messages', 'act_message'], ['visites', 'act_visite'], ['demandes', 'act_besoin'], ['plus', 'act_og']].filter(([o]) => onglets.some(([x]) => x === o)).map(([o, k]) => `<button class="btn" data-aller="${o}">${esc(T(k))}</button>`).join('')}</nav>
        ${cats.includes('rendez_vous') ? carte(T('prochaine_visite'), `<p>${prochaine ? `${esc(dt(prochaine.souhaitee_le))} · ${esc(T(`v_${prochaine.statut}`))}` : esc(T('aucune_visite_prevue'))}</p>`) : ''}
        ${ouvertes.length ? carte(T('demandes_ouvertes'), ouvertes.slice(0, 3).map((x) => `<p>${esc(T(`b_${x.categorie}`))} · <b>${esc(T(`d_${x.statut}`))}</b></p>`).join('')) : ''}
        ${d.messages.length ? carte(T('messages'), d.messages.slice(-2).map((m) => `<div class="message ${m.sens}"><b>${esc(T(m.sens === 'proche' ? 'vous' : 'etablissement'))}</b> · <span class="note">${esc(dt(m.cree_le))}</span><p>${esc(m.texte)}</p></div>`).join('')) : ''}
        ${d.activites?.length ? carte(T('activites'), d.activites.slice(0, 3).map((x) => `<p><b>${esc(x.titre)}</b> · ${esc(dt(x.debut_le))}</p>`).join(''), 'activites') : ''}`,
      suivi: () => carte(nom, `${statut}${sit?.retour_prevu_le ? `<p>${esc(T('retour', { date: dt(sit.retour_prevu_le) }))}</p>` : ''}
        ${sit?.parcours ? `<ol class="frise" id="parcours">${sit.parcours.map((x) => `<li class="${x.fait ? 'fait' : 'attente'}"><span class="point" aria-hidden="true"></span><div><b>${esc(T(`e_${x.code}`))}</b><div class="note">${x.fait ? esc(dt(x.date)) : esc(T('attente_conf'))}</div></div></li>`).join('')}</ol>` : ''}
        <p class="note">${esc(T('fiabilite'))} ${esc(T('pas_temps_reel'))}</p>`, 'suivi'),
      messages: () => `${carte(T('ecrire'), `<label class="lbl" for="cat">${esc(T('categorie'))}</label><select id="cat">${cats.map((c) => `<option value="${c}">${esc(T(`cat.${c}`))}</option>`).join('')}</select>
          <label class="lbl" for="txt">${esc(T('texte'))}</label><textarea id="txt" maxlength="2000"></textarea><div id="e"></div>
          <div class="ligne"><button class="btn pri" id="env">${esc(T('envoyer'))}</button><button class="btn" id="rap">${esc(T('rappel'))}</button></div>`)}
        ${carte(T('messages'), `<div class="fil">${d.messages.length ? d.messages.slice().reverse().map((m) => `<div class="message ${m.sens}"><b>${esc(T(m.sens === 'proche' ? 'vous' : 'etablissement'))}</b> · <span class="note">${esc(T(`cat.${m.categorie}`))} · ${esc(dt(m.cree_le))}</span><p>${esc(m.texte)}</p></div>`).join('') : `<p class="note">${esc(T('aucun'))}</p>`}</div>`)}`,
      visites: () => `${creneaux.length ? carte(T('creneaux'), `<div class="champ"><label class="lbl" for="vis-part">${esc(T('participants'))}</label><input id="vis-part" type="number" min="1" max="6" value="1"></div>${creneaux.map((c) => `<div class="ligne-f"><span>${esc(dt(c.debut))} · ${esc(T('places', { n: c.places }))}</span>${c.places > 0 ? `<button class="btn" data-creneau="${c.id}">${esc(T('reserver'))}</button>` : ''}</div>`).join('')}`) : carte(T('creneaux'), `<p class="note">${esc(T('aucun_creneau'))}</p>`)}
        ${carte(T('visites'), `${(d.visites || []).map((x) => `<div class="ligne-f"><span>${esc(dt(x.souhaitee_le))} · <b>${esc(T(`v_${x.statut}`))}</b></span>${['demandee', 'acceptee'].includes(x.statut) && new Date(x.souhaitee_le) > new Date() ? `<button class="btn" data-annuler-visite="${x.id}">${esc(T('annuler'))}</button>` : ''}</div>`).join('')}
          <label class="lbl" for="vis">${esc(T('visite_date'))}</label><input id="vis" type="datetime-local"><div id="ev"></div><button class="btn pri" id="vis-ok">${esc(T('visite_demander'))}</button>`, 'visites')}`,
      demandes: () => `${attendues.length || confirmations.length ? carte(T('confirmations'), confirmations.map((c) => `<div class="confirmation-f"><b>${esc(c.sujet)}</b>${c.explication ? `<p>${esc(c.explication)}</p>` : ''}<p class="note">${esc(T(`c_${c.statut}`))}${c.echeance ? ` · ${esc(dt(c.echeance))}` : ''}</p>
          ${c.statut === 'en_attente' ? `<div class="actions-f"><button class="btn pri" data-conf="${c.id}" data-rep="confirmee">${esc(T('je_confirme'))}</button><button class="btn" data-conf="${c.id}" data-rep="indisponible">${esc(T('pas_dispo'))}</button><button class="btn" data-conf="${c.id}" data-rep="precisions">${esc(T('precisions'))}</button></div>` : ''}</div>`).join(''), 'confirmations') : ''}
        ${carte(T('besoin_titre'), `<p class="note">${esc(T('besoin_aide'))}</p><label class="lbl" for="b-cat">${esc(T('categorie_besoin'))}</label><select id="b-cat">${['vetements', 'lunettes', 'effets_personnels', 'objet_oublie', 'rencontre', 'administratif', 'autre'].map((c) => `<option value="${c}">${esc(T(`b_${c}`))}</option>`).join('')}</select>
          <label class="lbl" for="b-txt">${esc(T('texte'))}</label><textarea id="b-txt" maxlength="1000"></textarea><div id="eb"></div><button class="btn pri" id="b-ok">${esc(T('envoyer_demande'))}</button>`)}
        ${carte(T('demandes_ouvertes'), demandes.length ? demandes.map((x) => `<div class="ligne-f"><span>${esc(T(`b_${x.categorie}`))} · <b>${esc(T(`d_${x.statut}`))}</b><br><span class="note">${esc(x.texte)}</span>${x.reponse ? `<br>${esc(T('reponse_etab', { texte: x.reponse }))}` : ''}</span>${['resolue', 'refusee', 'annulee', 'cloturee'].includes(x.statut) ? '' : `<button class="btn" data-annuler-demande="${x.id}">${esc(T('annuler'))}</button>`}</div>`).join('') : `<p class="note">${esc(T('aucune_demande'))}</p>`, 'demandes')}`,
      plus: () => `${journal ? carte(T('journal'), journal.length ? journal.map((j) => `<p><b>${esc(j.titre)}</b> · <span class="note">${esc(dt(j.publie_le))}</span><br>${esc(j.texte)}</p>`).join('') : `<p class="note">${esc(T('aucun'))}</p>`, 'journal') : ''}
        ${carte(T('og_titre'), `<p class="note">${esc(T('og_aide'))}</p><label class="lbl" for="og-q">${esc(T('og_question'))}</label><input id="og-q" maxlength="500"><button class="btn pri" id="og-ok">${esc(T('demander'))}</button><div id="og-r" aria-live="polite"></div>`, 'og')}
        <section class="panneau-c carte-f" id="notifications" hidden></section>
        ${carte(T('parametres'), `${profils().length > 1 ? `<label class="lbl" for="profil">${esc(T('profil'))}</label><select id="profil">${profils().map((x) => `<option value="${esc(x.token)}"${x.token === jeton ? ' selected' : ''}>${esc(x.resident)} · ${esc(x.etablissement)}</option>`).join('')}</select>` : ''}
          <fieldset><legend class="lbl">${esc(T('theme'))}</legend>${[['clair', 'theme_clair'], ['sombre', 'theme_sombre'], ['automatique', 'theme_auto']].map(([v, k]) => `<label class="case"><input type="radio" name="theme" value="${v}"${(localStorage.getItem('arrimo-proche-theme') || 'automatique') === v ? ' checked' : ''}> ${esc(T(k))}</label>`).join(' ')}</fieldset>
          <button class="btn" id="dec">${esc(T('deconnexion'))}</button><p class="note">${esc(T('confidentialite'))}</p>`, 'parametres')}`,
    };
    z().innerHTML = `${info ? message('succes-msg', info) : ''}<p class="note fraicheur" id="fraicheur">${navigator.onLine ? esc(T('maj_il_y_a', { heure: heure(charge.le) })) : esc(T('hors_ligne'))}</p>${vues[onglet]()}
      <nav class="barre-f" aria-label="${esc(T('nav_plus'))}">${onglets.map(([o, k]) => `<button type="button" data-onglet="${o}"${o === onglet ? ' aria-current="page"' : ''}>${esc(T(k))}${o === 'demandes' && attendues.length ? ` <span class="pastille-f">${attendues.length}</span>` : ''}${o === 'messages' && d.nouveaux_messages ? ` <span class="pastille-f">${d.nouveaux_messages}</span>` : ''}</button>`).join('')}</nav>`;
    brancher();
  }
  const agir = async (fn, ok, zone) => { try { await fn(); await ecranAccueil(T(ok)); } catch (e) { const el = zone && $(zone); if (el) el.innerHTML = message('erreur', e.message); else z().insertAdjacentHTML('afterbegin', message('erreur', e.message)); } };
  function brancher() {
    document.querySelectorAll('[data-onglet]').forEach((b) => { b.onclick = () => { onglet = b.dataset.onglet; rendre(); window.scrollTo(0, 0); }; });
    document.querySelectorAll('[data-aller]').forEach((b) => { b.onclick = () => { onglet = b.dataset.aller; rendre(); window.scrollTo(0, 0); }; });
    const envoyer = (rappel) => agir(() => api('POST', '/proches/messages', { categorie: $('#cat').value, texte: $('#txt').value || (rappel ? T('rappel') : ''), rappel }), rappel ? 'rappel_ok' : 'envoye', '#e');
    if ($('#env')) { $('#env').onclick = () => envoyer(false); $('#rap').onclick = () => envoyer(true); }
    if ($('#vis-ok')) $('#vis-ok').onclick = () => agir(() => api('POST', '/proches/visites', { souhaitee_le: new Date($('#vis').value).toISOString() }), 'visite_ok', '#ev');
    document.querySelectorAll('[data-creneau]').forEach((b) => { b.onclick = () => agir(() => api('POST', '/proches/visites/creneau', { creneau_id: Number(b.dataset.creneau), participants: Number($('#vis-part').value) }), 'visite_ok', '#ev'); });
    document.querySelectorAll('[data-annuler-visite]').forEach((b) => { b.onclick = () => agir(() => api('POST', `/proches/visites/${b.dataset.annulerVisite}/annuler`), 'visite_annulee'); });
    if ($('#b-ok')) $('#b-ok').onclick = () => agir(() => api('POST', '/proches/demandes', { categorie: $('#b-cat').value, texte: $('#b-txt').value }), 'demande_ok', '#eb');
    document.querySelectorAll('[data-annuler-demande]').forEach((b) => { b.onclick = () => agir(() => api('POST', `/proches/demandes/${b.dataset.annulerDemande}/annuler`), 'reponse_ok'); });
    document.querySelectorAll('[data-conf]').forEach((b) => { b.onclick = () => agir(() => api('POST', `/proches/confirmations/${b.dataset.conf}/repondre`, { reponse: b.dataset.rep }), 'reponse_ok'); });
    if ($('#og-ok')) $('#og-ok').onclick = async () => { try { const r = await api('POST', '/proches/og', { question: $('#og-q').value, langue }); $('#og-r').innerHTML = `<p style="white-space:pre-wrap">${esc(r.reponse)}</p>`; } catch (e) { $('#og-r').innerHTML = message('erreur', e.message); } };
    if ($('#profil')) $('#profil').onchange = (e) => changerProfil(e.target.value);
    document.querySelectorAll('input[name="theme"]').forEach((r) => { r.onchange = () => { try { localStorage.setItem('arrimo-proche-theme', r.value); } catch { /* */ } appliquerTheme(); }; });
    if ($('#dec')) $('#dec').onclick = async () => { for (const p of profils()) { jeton = p.token; await api('POST', '/proches/deconnexion').catch(() => {}); } await api('POST', '/proches/deconnexion').catch(() => {}); jeton = null; try { sessionStorage.removeItem('arrimo-proche'); sessionStorage.removeItem('arrimo-proche-profils'); } catch { /* */ } ecranConnexion(); };
    panneauNotifications();
  }
  function appliquerTheme() {
    let v = 'automatique'; try { v = localStorage.getItem('arrimo-proche-theme') || 'automatique'; } catch { /* */ }
    const sombre = v === 'sombre' || (v === 'automatique' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = sombre ? 'sombre' : 'clair';
  }
  appliquerTheme(); matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', appliquerTheme);
  window.addEventListener('online', () => verifierNouveautes()); window.addEventListener('offline', () => { const f = $('#fraicheur'); if (f) f.textContent = T('hors_ligne'); });
  function demarrer() {
    document.documentElement.lang = langue === 'en' ? 'en-CA' : 'fr-CA'; $('#titre').textContent = T('titre');
    document.querySelectorAll('[data-langue]').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.langue === langue)); b.onclick = () => { langue = b.dataset.langue; try { localStorage.setItem('arrimo-langue', langue); } catch { /* */ } demarrer(); }; });
    const inv = (location.hash.match(/invitation=([a-f0-9]{64})/) || [])[1];
    if (inv) ecranInvitation(inv); else if (jeton) ecranAccueil(); else ecranConnexion();
  }
  demarrer();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw-proches.js', { scope: '/proches' }).catch(() => {});
})();
