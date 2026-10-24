/* OG réutilise les API et les autorisations existantes. Conversation en mémoire uniquement. */
(() => {
  const panneau = document.querySelector('#og-panel');
  const ouvrir = document.querySelector('#og-open');
  const log = document.querySelector('#og-messages');
  const champ = document.querySelector('#og-question');
  const envoyer = document.querySelector('#og-envoyer');
  let sequence = 0;
  let occupe = false;
  const O = (cle, vars) => t(`og.${cle}`, vars);
  const heureOg = () => new Date().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', timeZone: fuseau() });
  function message(texte, utilisateur = false, mode = null) {
    const el = document.createElement('div');
    el.className = `og-message${utilisateur ? ' utilisateur' : ''}`;
    const nom = document.createElement('span'); nom.className = 'og-auteur'; nom.textContent = utilisateur ? O('vous') : 'OG';
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
  function reinitialiser() {
    sequence++; fermer(); log.replaceChildren(); champ.value = ''; occupe = false; envoyer.disabled = false;
  }
  function action(libelle, fn) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = libelle;
    b.onclick = fn; document.querySelector('#og-actions').append(b);
  }
  function naviguer(vue) { fermer(); allerA(vue); }
  async function question(q) {
    if (occupe || !etat.token || !panneau.open || !etat.moi || !etabCtx()?.module_actif) return;
    const contexte = etat.ctx; const token = etat.token; const revision = sequence;
    const entretien = estEntretien();
    const valide = () => panneau.open && revision === sequence && contexte === etat.ctx && token === etat.token;
    occupe = true; envoyer.disabled = true;
    message(q, true); champ.value = '';
    const attente = message(O('attente'));
    try {
      let reponse;
      if (/(posolog|dosage|\bdose\b|traitement|diagnos|prescri|medicament|treatment|medication)/i.test(q.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) {
        reponse = { reponse: O('hors_perimetre'), mode: 'local' };
      } else if (entretien) {
        if (/(nettoy|entretien|clean|priorit|tache|task)/i.test(q)) {
          const file = await api('GET', `/nettoyage?etablissement_id=${contexte}`);
          reponse = { reponse: O('nettoyage', { n: file.length }) + (file.length ? '\n' + O('nettoyage_codes', { codes: file.slice(0, 5).map(x => x.code).join(', ') }) : ''), mode: 'local' };
        } else reponse = { reponse: O('entretien_limite'), mode: 'local' };
      } else {
        reponse = await api('POST', '/copilote/question', { etablissement_id: contexte, question: q, langue });
      }
      if (valide()) { attente.remove(); message(reponse.reponse, false, reponse.mode); }
    } catch {
      if (valide()) { attente.remove(); message(O('erreur')); }
    } finally {
      if (revision === sequence) { occupe = false; envoyer.disabled = false; }
    }
  }
  ouvrir.onclick = () => {
    if (!etat.token || !etat.moi || etat.moi.utilisateur.mdp_temporaire) return;
    reinitialiser();
    const u = etat.moi.utilisateur; const etab = etabCtx(); const entretien = estEntretien();
    document.querySelector('#og-contexte').textContent = O('contexte', { etab: etab?.nom || 'Arrimo', role: t(`roles.${u.role}`) });
    document.querySelector('#og-actions').replaceChildren();
    message(O(entretien ? 'bienvenue_entretien' : 'bienvenue', { nom: u.nom }));
    const actif = !!etab?.module_actif;
    champ.disabled = !actif; envoyer.disabled = !actif;
    if (!actif) message(O('sans_etab'));
    if (actif && entretien) {
      action(O('priorites'), () => question(langue === 'en' ? 'Cleaning priorities' : 'Priorités de nettoyage'));
      action(t('onglets.nettoyage'), () => naviguer('nettoyage'));
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
  document.querySelector('#og-form').onsubmit = ev => { ev.preventDefault(); const q = champ.value.trim(); if (q) question(q); };
  window.addEventListener('arrimo:session-reset', reinitialiser);
})();
