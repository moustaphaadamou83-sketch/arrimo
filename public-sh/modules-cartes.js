/* Console SH : écran d'activation des modules en cartes (cahier v2, C.10, 19 nov. 2026).
   Remplace la lecture des cases à cocher ; la même route PUT /hopitaux/:id/modules enregistre (journal avec auteur, transmission à
   l'environnement). Modules « Bientôt » : carte grisée, interrupteur désactivé, refus aussi côté serveur. FR/EN, clavier, téléphone. */
(function (racine) {
  const CARTES = [
    { id: 'hopital', emoji: '🏥', codes: ['lits', 'admissions_hopital', 'transferts', 'urgence', 'nsa', 'nettoyage', 'national', 'liaison_chsld'], fr: ['Hôpital', 'Lits, admissions, urgence, NSA, nettoyage'], en: ['Hospital', 'Beds, admissions, emergency, ALC, cleaning'] },
    { id: 'hebergement', emoji: '🏡', codes: ['residents', 'chambres', 'demandes_hebergement', 'entretien_chsld', 'taches', 'hospitalisations', 'reseau_chsld'], fr: ['Hébergement', 'Résidents, chambres, demandes, entretien'], en: ['Residential care', 'Residents, rooms, requests, housekeeping'] },
    { id: 'secours', emoji: '🚑', codes: ['liaison_secours', 'transport_ambulancier', 'profil_ccs', 'profil_ambulance', 'profil_visites'], fr: ['Secours', 'Préalertes, transports ambulanciers, CCS'], en: ['Emergency services', 'Pre-alerts, ambulance transport, CCS'] },
    { id: 'famille', emoji: '👨‍👩‍👧', codes: ['proches', 'portail_proches', 'messagerie_securisee', 'appels_video'], fr: ['Famille', 'Proches, portail, messagerie sécurisée'], en: ['Family', 'Relatives, portal, secure messaging'] },
    { id: 'og', emoji: '✨', codes: ['og'], fr: ['OG', 'Assistant : propose, un humain décide'], en: ['OG', 'Assistant: suggests, a person decides'] },
    { id: 'sillage', emoji: '🧭', codes: [], inclus: true, fr: ['Sillage', 'Fil du patient ou du résident entre établissements'], en: ['Trail', 'Patient or resident thread across facilities'] },
    { id: 'connect', emoji: '🔌', codes: [], inclus: true, fr: ['Arrimo Connect', 'Branchement HL7, FHIR et API signée'], en: ['Arrimo Connect', 'HL7, FHIR and signed API connection'] },
    { id: 'formation', emoji: '🎓', codes: ['formation'], fr: ['Formation', 'Parcours de formation des équipes'], en: ['Training', 'Team training path'] },
    { id: 'chrono', emoji: '⏱️', codes: ['chrono'], fr: ['Chrono', 'Temps à la porte de l’urgence, H11 à H15'], en: ['Chrono', 'Emergency door times, H11 to H15'] },
    { id: 'urgences_direct', emoji: '🚨', codes: ['urgences_direct'], fr: ['Urgences en direct', 'État des urgences et fermetures planifiées'], en: ['Live emergency status', 'Emergency status and planned closures'] },
    { id: 'transferts_suivi', emoji: '🔁', codes: ['transferts_suivi'], fr: ['Transferts', 'Centrale régionale et rapatriements'], en: ['Transfers', 'Regional hub and repatriation'] },
    { id: 'transport_planifie', emoji: '🚐', codes: ['transport_planifie'], fr: ['Transport', 'Transport non urgent réservé'], en: ['Transport', 'Booked non-urgent transport'] },
    { id: 'bourse_places', emoji: '🛏️', codes: ['bourse_places'], fr: ['Bourse des places', 'Places libres et à venir, classement expliqué'], en: ['Placement exchange', 'Free and upcoming places, explained ranking'] },
    { id: 'donnees_regionales', emoji: '📊', codes: ['donnees_regionales'], fr: ['Données', 'Tableaux régionaux et listes d’attente'], en: ['Data', 'Regional dashboards and waiting lists'] },
    { id: 'mode_crise', emoji: '🆘', codes: ['mode_crise'], fr: ['Mode crise', 'Évacuation et places de la région'], en: ['Crisis mode', 'Evacuation and regional places'] },
    { id: 'visites_confirmees', emoji: '✅', codes: ['visites_confirmees'], fr: ['Visites confirmées', 'Visites du CLSC ou du prestataire'], en: ['Confirmed visits', 'CLSC or provider visits'] },
    { id: 'eviter_transferts', emoji: '🛡️', codes: ['eviter_transferts'], fr: ['Éviter les transferts inutiles', 'Alternatives avant l’appel'], en: ['Avoid unnecessary transfers', 'Alternatives before the call'] },
  ];
  const T = {
    fr: { tous: 'Tous', actives: 'Activés', bientot: 'Bientôt', active: 'Activé', desactive: 'Désactivé', inclus: 'Inclus', filtre: 'Filtrer les modules',
      exige: '{a} exige {b}', activer_aussi: 'Activer {b} aussi', confirmer: 'Désactiver {a} ?', perte: 'Les utilisateurs de cet établissement perdront l’accès à {a}.',
      perte_dep: 'Les utilisateurs de cet établissement perdront l’accès à {a} et à {b}, qui en dépend.', annuler: 'Annuler', desactiver: 'Désactiver',
      enregistre: 'Modules enregistrés.', voir: 'Ouvrir', aucun: 'Aucun module dans ce filtre.', avance: 'Licences et paramètres (avancé)' },
    en: { tous: 'All', actives: 'On', bientot: 'Coming soon', active: 'On', desactive: 'Off', inclus: 'Included', filtre: 'Filter modules',
      exige: '{a} requires {b}', activer_aussi: 'Turn on {b} too', confirmer: 'Turn off {a}?', perte: 'Users of this facility will lose access to {a}.',
      perte_dep: 'Users of this facility will lose access to {a} and to {b}, which depends on it.', annuler: 'Cancel', desactiver: 'Turn off',
      enregistre: 'Modules saved.', voir: 'Open', aucun: 'No module in this filter.', avance: 'Licences and settings (advanced)' },
  };
  const langue = () => (String(document.documentElement.lang || '').startsWith('en') ? 'en' : 'fr');
  const t = (k, v = {}) => T[langue()][k].replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
  const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nomModule = (m) => (langue() === 'en' && m.nom_en ? m.nom_en : m.nom);
  // Modules de base disponibles (hôpital, hébergement) : actifs par défaut, réglés par la configuration de l'établissement, pas par la licence
  const deBase = (m) => m.statut === 'disponible' && ['hopital', 'chsld', 'commun'].includes(m.categorie);
  const verrouille = (m) => m.statut === 'inclus' || deBase(m);
  const actif = (m) => verrouille(m) || m.licence === 'souscrit';
  const bientot = (m) => ['a_venir', 'etude'].includes(m.statut);

  /** Cartes applicables au type : au moins un module du catalogue de ce type (les cartes « incluses » s'affichent pour tous). */
  function cartesDuType(modules) {
    const parCode = new Map(modules.map((m) => [m.code, m]));
    return CARTES.map((c) => ({ ...c, modules: c.codes.map((x) => parCode.get(x)).filter(Boolean) })).filter((c) => c.inclus || c.modules.length);
  }
  function etatCarte(c) {
    if (c.inclus) return 'inclus';
    if (c.modules.every(bientot)) return 'bientot';
    if (c.modules.every(verrouille)) return 'inclus';
    return c.modules.some(actif) ? 'active' : 'desactive';
  }
  function interrupteur(m) {
    const on = actif(m); const bloque = bientot(m) || verrouille(m);
    const mot = bientot(m) ? t('bientot') : verrouille(m) ? t('inclus') : on ? t('active') : t('desactive');
    return `<div class="sous-module"><span class="sous-nom">${e(nomModule(m))}</span>
      <button type="button" class="interrupteur${on ? ' on' : ''}" role="switch" aria-checked="${on}" data-carte-module="${e(m.code)}"${bloque ? ' disabled aria-disabled="true"' : ''}
        aria-label="${e(nomModule(m))}"><span class="piste" aria-hidden="true"><span class="bouton"></span></span><span class="mot">${e(mot)}</span></button></div>`;
  }
  function rendre(h, filtre) {
    const cartes = cartesDuType(h.modules || []).filter((c) => filtre === 'tous' || (filtre === 'actives' ? ['active', 'inclus'].includes(etatCarte(c)) : etatCarte(c) === 'bientot'));
    if (!cartes.length) return `<p class="note">${e(t('aucun'))}</p>`;
    return cartes.map((c) => {
      const [nom, desc] = c[langue()]; const etat = etatCarte(c);
      return `<article class="carte-module etat-${etat}" data-carte="${c.id}">
        <div class="carte-tete"><span class="carte-emoji" aria-hidden="true">${c.emoji}</span><div><h4>${e(nom)}</h4><p class="note">${e(desc)}</p></div>
        ${etat === 'bientot' ? `<span class="etiquette-bientot">${e(t('bientot'))}</span>` : etat === 'inclus' ? `<span class="etiquette-inclus">${e(t('inclus'))}</span>` : ''}</div>
        ${c.modules.map(interrupteur).join('')}
        ${c.lien ? `<a class="btn lien-carte" href="${c.lien}">${e(t('voir'))}</a>` : ''}
        <p class="carte-raison note" hidden></p></article>`;
    }).join('');
  }
  /** Bloc complet : filtre + grille. `enregistrer(liste)` envoie [{code, licence, parametres}] et rafraîchit la fiche. */
  function bloc(h) {
    return `<div class="filtre-modules" role="group" aria-label="${e(t('filtre'))}">${['tous', 'actives', 'bientot'].map((f, i) => `<button type="button" class="btn${i ? '' : ' pri'}" data-filtre-modules="${f}" aria-pressed="${!i}">${e(t(f))}</button>`).join('')}</div>
      <div class="grille-modules" id="grille-modules">${rendre(h, 'tous')}</div>`;
  }
  function brancher(h, zone, { enregistrer, modale }) {
    const parCode = new Map((h.modules || []).map((m) => [m.code, m]));
    const ligne = (m, licence) => ({ code: m.code, licence, parametres: m.parametres || {} });
    // Dépendants actifs d'un module (pour la confirmation de désactivation)
    const dependants = (code) => (h.modules || []).filter((m) => actif(m) && !verrouille(m) && (m.dependances || []).includes(code));
    const lier = () => {
      zone.querySelectorAll('[data-filtre-modules]').forEach((b) => { b.onclick = () => {
        zone.querySelectorAll('[data-filtre-modules]').forEach((x) => { x.classList.toggle('pri', x === b); x.setAttribute('aria-pressed', String(x === b)); });
        zone.querySelector('#grille-modules').innerHTML = rendre(h, b.dataset.filtreModules); lier();
      }; });
      zone.querySelectorAll('[data-carte-module]').forEach((b) => { b.onclick = () => {
        const m = parCode.get(b.dataset.carteModule); if (!m || bientot(m) || verrouille(m)) return;
        const raison = b.closest('.carte-module').querySelector('.carte-raison');
        if (!actif(m)) {
          const manque = (m.dependances || []).map((d) => parCode.get(d)).filter((d) => d && !actif(d));
          if (manque.length) {
            const noms = manque.map(nomModule).join(', ');
            raison.hidden = false;
            raison.innerHTML = `${e(t('exige', { a: nomModule(m), b: noms }))} <button type="button" class="btn" data-activer-aussi>${e(t('activer_aussi', { b: noms }))}</button>`;
            raison.querySelector('[data-activer-aussi]').onclick = () => enregistrer([...manque.map((d) => ligne(d, 'souscrit')), ligne(m, 'souscrit')]);
            return;
          }
          return enregistrer([ligne(m, 'souscrit')]);
        }
        const deps = dependants(m.code);
        const texte = deps.length ? t('perte_dep', { a: nomModule(m), b: deps.map(nomModule).join(', ') }) : t('perte', { a: nomModule(m) });
        modale(t('confirmer', { a: nomModule(m) }), `<p>${e(texte)}</p>`, [{ label: t('annuler') },
          { label: t('desactiver'), dan: true, run: async () => (await enregistrer([...deps.map((d) => ligne(d, 'non_selectionne')), ligne(m, 'non_selectionne')])) !== null || false }]);
      }; });
    };
    lier();
  }
  const api = { CARTES, T, bloc, brancher, cartesDuType, etatCarte };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else racine.ArrimoModulesCartes = api;
})(typeof window === 'undefined' ? globalThis : window);
