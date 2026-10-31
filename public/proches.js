/* Portail des proches (pilote) : invitation, connexion, messages et demandes de rappel dans les catégories autorisées.
   Aucune chambre, localisation ni donnée clinique n'est affichée : le serveur ne les transmet pas. */
(() => {
  const TXT = {
    fr: { titre: 'Portail des proches', connexion: 'Connexion', courriel: 'Courriel', mdp: 'Mot de passe', entrer: 'Se connecter', invitation: 'Bienvenue',
      invitation_aide: 'Choisissez votre mot de passe : au moins 12 caractères, avec des lettres et des chiffres.', choisir: 'Enregistrer mon mot de passe', invitation_ok: 'Votre accès est prêt. Connectez-vous.',
      bonjour: 'Bonjour {prenom}', resident: 'Vous êtes associé(e) à {resident}, {etab}.', categories: 'Vous pouvez échanger sur : {liste}.', messages: 'Vos échanges avec l’établissement',
      aucun: 'Aucun message pour l’instant.', ecrire: 'Écrire à l’établissement', categorie: 'Sujet', texte: 'Votre message', envoyer: 'Envoyer', rappel: 'Demander qu’on me rappelle',
      envoye: 'Message envoyé à l’établissement.', rappel_ok: 'Demande de rappel transmise.', deconnexion: 'Se déconnecter', vous: 'Vous', etab: 'L’établissement',
      expire: 'Accès valable jusqu’au {date}.', confidentialite: 'Ce portail ne contient aucune information médicale. Pour une urgence, appelez le 911.',
      cat: { administratif: 'Questions administratives', hebergement: 'Hébergement', rendez_vous: 'Rendez-vous et visites', mouvements: 'Hospitalisation et retour' } },
    en: { titre: 'Family portal', connexion: 'Sign in', courriel: 'Email', mdp: 'Password', entrer: 'Sign in', invitation: 'Welcome',
      invitation_aide: 'Choose your password: at least 12 characters, with letters and numbers.', choisir: 'Save my password', invitation_ok: 'Your access is ready. Sign in.',
      bonjour: 'Hello {prenom}', resident: 'You are linked to {resident}, {etab}.', categories: 'You can exchange about: {liste}.', messages: 'Your exchanges with the facility',
      aucun: 'No message yet.', ecrire: 'Write to the facility', categorie: 'Subject', texte: 'Your message', envoyer: 'Send', rappel: 'Ask to be called back',
      envoye: 'Message sent to the facility.', rappel_ok: 'Callback request sent.', deconnexion: 'Sign out', vous: 'You', etab: 'The facility',
      expire: 'Access valid until {date}.', confidentialite: 'This portal contains no medical information. In an emergency, call 911.',
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
  async function ecranAccueil(info) {
    let d; try { d = await api('GET', '/proches/moi'); } catch (e) { ecranConnexion(); $('#contenu').insertAdjacentHTML('afterbegin', message('erreur', e.message)); return; }
    const cats = d.autorisations;
    z().innerHTML = `<section class="panneau-c"><h2>${esc(T('bonjour', { prenom: d.proche.prenom }))}</h2>
        <p>${esc(T('resident', { resident: `${d.resident.prenom} ${d.resident.initiale}`, etab: d.etablissement.nom }))}</p>
        <p class="note">${esc(T('categories', { liste: cats.map((c) => T(`cat.${c}`)).join(', ') }))}</p>${d.expire_le ? `<p class="note">${esc(T('expire', { date: new Date(d.expire_le).toLocaleDateString(langue === 'en' ? 'en-CA' : 'fr-CA') }))}</p>` : ''}
        ${info ? message('succes-msg', info) : ''}</section>
      <section class="panneau-c"><h2>${esc(T('ecrire'))}</h2><label class="lbl" for="cat">${esc(T('categorie'))}</label>
        <select id="cat">${cats.map((c) => `<option value="${c}">${esc(T(`cat.${c}`))}</option>`).join('')}</select>
        <label class="lbl" for="txt">${esc(T('texte'))}</label><textarea id="txt" maxlength="2000"></textarea><div id="e"></div>
        <div class="ligne"><button class="btn pri" id="env">${esc(T('envoyer'))}</button><button class="btn" id="rap">${esc(T('rappel'))}</button></div></section>
      <section class="panneau-c"><h2>${esc(T('messages'))}</h2><div class="fil">${d.messages.length ? d.messages.map((m) => `<div class="message ${m.sens}"><b>${esc(T(m.sens === 'proche' ? 'vous' : 'etab'))}</b> · <span class="note">${esc(T(`cat.${m.categorie}`))} · ${esc(new Date(m.cree_le).toLocaleString(langue === 'en' ? 'en-CA' : 'fr-CA', { dateStyle: 'medium', timeStyle: 'short' }))}</span><p>${esc(m.texte)}</p></div>`).join('') : `<p class="note">${esc(T('aucun'))}</p>`}</div></section>
      <button class="btn" id="dec">${esc(T('deconnexion'))}</button><p class="note">${esc(T('confidentialite'))}</p>`;
    const envoyer = async (rappel) => { try { await api('POST', '/proches/messages', { categorie: $('#cat').value, texte: $('#txt').value || (rappel ? T('rappel') : ''), rappel });
      ecranAccueil(T(rappel ? 'rappel_ok' : 'envoye')); } catch (e) { $('#e').innerHTML = message('erreur', e.message); } };
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
})();
