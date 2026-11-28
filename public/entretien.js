/* Entretien (cahier du 28 nov. 2026) : Accueil de l'agent et cartes d'intervention communes (Accueil et Nettoyage).
   Organisation de la maquette de référence (indicateurs, interventions en cours, prochaines interventions, notifications), intégrée
   à Arrimo : vraies données, charte et thèmes, FR/EN. Les compteurs Chrono partent des heures du SERVEUR (jamais de l'appareil) :
   une actualisation, une déconnexion ou un changement de compte ne remet jamais un compteur à zéro. Libéré ≠ disponible. */
(() => {
  const TXT = {
    fr: { bonjour: 'Bonjour, {nom}', role: { entretien: 'Agent d’entretien', coordonnateur: 'Coordination', admin_etab: 'Administration', gestionnaire: 'Gestion du réseau', equipe_soins: 'Équipe de soins' },
      k_a_nettoyer: 'À nettoyer', k_en_cours: 'Nettoyages en cours', k_a_verifier: 'En attente de vérification', k_prioritaires: 'Tâches prioritaires', k_terminees: 'Terminées aujourd’hui', k_messages: 'Messages non lus',
      en_cours: 'Interventions en cours', prochaines: 'Prochaines interventions', aucune: 'Aucune intervention à faire pour le moment.', terminees: 'Terminées aujourd’hui', taches: 'Mes tâches', aucune_tache: 'Aucune tâche ouverte.',
      lit: 'Lit', civiere: 'Civière', chambre: 'Chambre', departement: 'Département', service: 'Service', unite: 'Unité', etage: 'Étage', liberation: 'Libéré le',
      ph: { attente: 'En attente de nettoyage', nettoyage: 'Nettoyage en cours', verification: 'En attente de vérification', disponible: 'Disponible' },
      d_occupation: 'Occupation', d_attente: 'Attente avant nettoyage', d_nettoyage: 'Nettoyage', d_verification: 'Vérification', d_total: 'Remise en disponibilité', d_disponible: 'Disponible depuis',
      depuis_liberation: 'depuis la libération', protocole: 'Protocole', standard: 'Nettoyage standard', isolement: 'Après isolement', precautions: 'Consignes de protection',
      commencer: 'Commencer le nettoyage', terminer: 'Terminer le nettoyage', pret: 'Nettoyé, prêt', signaler: 'Signaler un problème', ouvrir: 'Ouvrir Nettoyage',
      sync: 'Synchronisé à {h}', hors_ligne: 'Connexion interrompue : compteurs figés à la dernière synchronisation ({h}).', inconnue: '—', formations: 'Habilitations', libere_dispo: 'Une ressource libérée n’est disponible qu’après le nettoyage et, si le protocole l’exige, la vérification.' },
    en: { bonjour: 'Hello, {nom}', role: { entretien: 'Housekeeping agent', coordonnateur: 'Coordination', admin_etab: 'Administration', gestionnaire: 'Network management', equipe_soins: 'Care team' },
      k_a_nettoyer: 'To clean', k_en_cours: 'Cleaning in progress', k_a_verifier: 'Awaiting check', k_prioritaires: 'Priority tasks', k_terminees: 'Done today', k_messages: 'Unread messages',
      en_cours: 'Interventions in progress', prochaines: 'Next interventions', aucune: 'No intervention to do right now.', terminees: 'Done today', taches: 'My tasks', aucune_tache: 'No open task.',
      lit: 'Bed', civiere: 'Stretcher', chambre: 'Room', departement: 'Department', service: 'Service', unite: 'Unit', etage: 'Floor', liberation: 'Released at',
      ph: { attente: 'Waiting for cleaning', nettoyage: 'Cleaning in progress', verification: 'Awaiting check', disponible: 'Available' },
      d_occupation: 'Occupancy', d_attente: 'Wait before cleaning', d_nettoyage: 'Cleaning', d_verification: 'Check', d_total: 'Back to available', d_disponible: 'Available for',
      depuis_liberation: 'since release', protocole: 'Protocol', standard: 'Standard cleaning', isolement: 'After isolation', precautions: 'Protective measures',
      commencer: 'Start cleaning', terminer: 'Finish cleaning', pret: 'Cleaned, ready', signaler: 'Report a problem', ouvrir: 'Open Cleaning',
      sync: 'Synchronized at {h}', hors_ligne: 'Connection interrupted: counters frozen at the last synchronization ({h}).', inconnue: '—', formations: 'Authorizations', libere_dispo: 'A released resource is available only after cleaning and, when the protocol requires it, the check.' },
  };
  const e = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = () => ((document.documentElement.lang || '').startsWith('en') ? 'en' : 'fr');
  const X = () => TXT[L()]; const T = (k, v = {}) => e(String(k.split('.').reduce((o, p) => o?.[p], X()) ?? k).replace(/\{(\w+)\}/g, (m, y) => v[y] ?? m));
  const loc = () => (L() === 'en' ? 'en-CA' : 'fr-CA');
  const ic = (n) => `<svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-${n}"/></svg>`;
  // Heure de l'établissement (même fuseau que le reste d'Arrimo), jamais celle de l'appareil
  const tz = () => { try { return typeof fuseau === 'function' ? fuseau() : undefined; } catch { return undefined; } };
  const heure = (d) => (d ? new Date(d).toLocaleString(loc(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz() }) : '—');
  /** Durée lisible : secondes, minutes, heures, jours (les jours à part pour ne jamais déborder du cercle). */
  function duree(ms) {
    if (ms == null || Number.isNaN(ms)) return { gros: '—', jours: '' };
    const s = Math.max(0, Math.floor(ms / 1000)); const j = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return { gros: h || j ? `${p(h)}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`, jours: j ? (L() === 'en' ? `${j} d` : `${j} j`) : '' };
  }
  const dm = (m) => (m == null ? '—' : m >= 1440 ? `${Math.floor(m / 1440)} ${L() === 'en' ? 'd' : 'j'} ${Math.floor((m % 1440) / 60)} h` : m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`);
  // Décalage entre l'horloge du serveur et celle de l'appareil : tous les compteurs utilisent l'heure du serveur
  let decalage = 0; let derniereSync = null;
  const maintenantServeur = () => Date.now() + decalage;
  const debutPhase = (r) => (r.phase === 'verification' ? r.verification_debut : r.phase === 'nettoyage' ? r.nettoyage_debut : r.liberation_le);

  /** Carte d'intervention (même composant sur l'Accueil et dans Nettoyage). */
  function carte(r, o = {}) {
    const lieu = [[T('departement'), r.departement], [T('service'), r.service], [T('unite'), r.unite], [T('etage'), r.etage], [T('chambre'), r.chambre]].filter(([, v]) => v);
    const protocole = r.protocole || (r.isolement ? T('isolement') : T('standard'));
    const action = r.genre === 'civiere'
      ? (r.phase === 'attente' ? `<button class="btn pri" type="button" data-en-debut-civ="${r.id}">${T('commencer')}</button><button class="btn" type="button" data-fini="${r.id}" data-genre="civiere" data-version="${r.version}" data-code="${e(r.code)}">${T('pret')}</button>` : `<button class="btn pri" type="button" data-fini="${r.id}" data-genre="civiere" data-version="${r.version}" data-code="${e(r.code)}">${T('pret')}</button>`)
      : r.intervention === 'en_cours' ? `<button class="btn pri" type="button" data-terminer="${r.id}">${T('terminer')}</button>`
        : r.intervention === 'controle_requis' ? ''
          : r.phase === 'attente' ? `<button class="btn pri" type="button" data-debut="${r.id}">${T('commencer')}</button><button class="btn" type="button" data-fini="${r.id}" data-genre="lit" data-version="${r.version}" data-code="${e(r.code)}">${T('pret')}</button>`
            : `<button class="btn pri" type="button" data-fini="${r.id}" data-genre="lit" data-version="${r.version}" data-code="${e(r.code)}">${T('pret')}</button>`;
    const ligne = (lib, val, actif) => `<div class="en-l${actif ? ' actif' : ''}"><span>${lib}</span><b class="num">${val}</b></div>`;
    return `<article class="en-carte net-item ph-${e(r.phase)}" data-en-res="${e(r.genre)}:${r.id}">
      <header class="en-tete"><div><h3>${r.genre === 'civiere' ? T('civiere') : T('lit')} ${e(r.code)}</h3><p class="note">${lieu.map(([k, v]) => `${k} ${e(v)}`).join(' · ') || '—'}</p></div>
        <span class="en-statut">${T(`ph.${r.phase}`)}</span></header>
      <p class="en-lib">${ic('clock')} ${T('liberation')} <b>${heure(r.liberation_le)}</b></p>
      <div class="en-ring" data-en-depuis="${e(debutPhase(r) || '')}" data-en-total="${e(r.liberation_le || '')}" role="timer" aria-label="${T(`ph.${r.phase}`)}">
        <span class="en-ring-j"></span><span class="en-ring-v">—</span><span class="en-ring-l">${T(`ph.${r.phase}`)}</span></div>
      <div class="en-phases">${ligne(T('d_attente'), r.phase === 'attente' ? `<span data-en-vivant="${e(r.liberation_le)}">—</span>` : dm(r.attente_min), r.phase === 'attente')}
        ${ligne(T('d_nettoyage'), r.phase === 'nettoyage' ? `<span data-en-vivant="${e(r.nettoyage_debut)}">—</span>` : dm(r.nettoyage_min), r.phase === 'nettoyage')}
        ${r.verification_debut || r.phase === 'verification' ? ligne(T('d_verification'), r.phase === 'verification' ? `<span data-en-vivant="${e(r.verification_debut)}">—</span>` : dm(r.verification_min), r.phase === 'verification') : ''}
        ${ligne(T('d_total'), `<span data-en-vivant="${e(r.liberation_le)}">—</span>`, false)}${r.occupation_min != null ? ligne(T('d_occupation'), dm(r.occupation_min), false) : ''}</div>
      <p class="note">${T('protocole')} : <b>${e(protocole)}</b>${(r.precautions || []).length ? ` · ${T('precautions')} : ${e(r.precautions.join(', '))}` : ''}</p>
      ${o.actions === false ? '' : `<div class="en-actions">${action}<button class="btn" type="button" data-connect-ouvrir="contacter">${T('signaler')}</button></div>`}</article>`;
  }
  /** Carte d'une ressource remise en disponibilité aujourd'hui : durées figées de chaque phase. */
  const carteFaite = (r) => `<li class="en-faite"><b>${r.genre === 'civiere' ? T('civiere') : T('lit')} ${e(r.code)}</b> · ${T('liberation')} ${heure(r.liberation_le)} · ${T('d_attente')} ${dm(r.attente_min)} · ${T('d_nettoyage')} ${dm(r.nettoyage_min)}${r.verification_min != null ? ` · ${T('d_verification')} ${dm(r.verification_min)}` : ''} · <b>${T('d_total')} ${dm(r.total_min)}</b>${r.disponible_min != null ? ` · ${T('d_disponible')} ${dm(r.disponible_min)}` : ''}</li>`;

  /** Compteurs en direct (heure du serveur) : la phase en cours avance ; les phases closes restent figées. */
  function animer(racine) {
    const tic = () => {
      if (!racine.isConnected) return clearInterval(id);
      const now = maintenantServeur();
      racine.querySelectorAll('.en-ring').forEach((r) => { const d = duree(r.dataset.enDepuis ? now - new Date(r.dataset.enDepuis).getTime() : null); r.querySelector('.en-ring-v').textContent = d.gros; r.querySelector('.en-ring-j').textContent = d.jours; });
      racine.querySelectorAll('[data-en-vivant]').forEach((x) => { x.textContent = x.dataset.enVivant ? dm(Math.floor((now - new Date(x.dataset.enVivant).getTime()) / 60000)) : '—'; });
    };
    const id = setInterval(tic, 1000); tic();
  }
  const synchro = (d) => { decalage = new Date(d.maintenant).getTime() - Date.now(); derniereSync = new Date(d.maintenant); };
  const etatSync = () => (navigator.onLine === false && derniereSync ? `<p class="erreur" role="status">${T('hors_ligne', { h: derniereSync.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit', timeZone: tz() }) })}</p>`
    : derniereSync ? `<p class="note" role="status">${T('sync', { h: derniereSync.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: tz() }) })}</p>` : '');

  /** Accueil de l'agent d'entretien. o = { api, etablissement_id, ouvrir, toast, brancher(v) } */
  async function accueil(v, o) {
    const d = await o.api('GET', `/entretien/accueil?etablissement_id=${o.etablissement_id}`); synchro(d);
    const id = d.identite; const initiales = String(id.nom || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
    const k = (cle, n, ton, aller) => `<button type="button" class="en-kpi${ton && n ? ` ${ton}` : ''}" data-en-aller="${aller}"><span class="v num">${n}</span><span class="lbl">${T(cle)}</span></button>`;
    const enCours = d.en_cours.filter((r) => r.phase !== 'attente'); const prochaines = d.en_cours.filter((r) => r.phase === 'attente');
    v.innerHTML = `<section class="panneau-c en-identite"><div class="en-avatar" aria-hidden="true">${e(initiales)}</div><div><h2>${T('bonjour', { nom: id.nom })}</h2>
        <p class="note">${e(X().role[id.role] || id.role)} · ${e(id.etablissement)}${id.formations?.length ? ` · ${T('formations')} : ${e(id.formations.map((f) => f.formation).join(', '))}` : ''}</p></div>
        <div class="en-sync">${etatSync()}</div></section>
      <div class="en-kpis">${k('k_a_nettoyer', d.kpis.a_nettoyer, 'alerte', 'nettoyage')}${k('k_en_cours', d.kpis.en_cours, '', 'nettoyage')}${k('k_a_verifier', d.kpis.a_verifier, '', 'nettoyage')}
        ${k('k_prioritaires', d.kpis.prioritaires, 'alerte', 'mes-taches')}${k('k_terminees', d.kpis.terminees, 'ok', 'nettoyage')}${k('k_messages', d.kpis.messages_non_lus, '', 'messages')}</div>
      <div class="en-layout"><div>
        <section class="panneau-c"><h3>${T('en_cours')}</h3>${enCours.length ? `<div class="en-grille">${enCours.map((r) => carte(r)).join('')}</div>` : `<p class="note">${T('aucune')}</p>`}</section>
        <section class="panneau-c"><h3>${T('prochaines')}</h3>${prochaines.length ? `<div class="en-grille">${prochaines.map((r) => carte(r)).join('')}</div>` : `<p class="note">${T('aucune')}</p>`}
          <p class="note">${T('libere_dispo')}</p></section></div>
        <aside><section class="panneau-c"><h3>${T('taches')}</h3>${d.taches.length ? `<ul class="liste-simple">${d.taches.map((x) => `<li><b>${e(x.lieu || '')}</b> ${e(x.titre)}${x.prioritaire ? ` · <b class="crit">${ic('triangle-alert')}</b>` : ''}</li>`).join('')}</ul>` : `<p class="note">${T('aucune_tache')}</p>`}
          <button class="btn" type="button" data-en-aller="mes-taches">${T('taches')}</button></section>
          <section class="panneau-c"><h3>${T('terminees')} (${d.terminees.length})</h3>${d.terminees.length ? `<ul class="liste-simple en-faites">${d.terminees.slice(0, 8).map(carteFaite).join('')}</ul>` : `<p class="note">—</p>`}</section></aside></div>`;
    v.querySelectorAll('[data-en-aller]').forEach((b) => { b.onclick = () => (b.dataset.enAller === 'messages' ? window.ArrimoConnectInterne?.ouvrir('mes') : o.ouvrir?.(b.dataset.enAller)); });
    o.brancher?.(v); brancherCivieres(v, o); animer(v);
  }
  function brancherCivieres(v, o) {
    v.querySelectorAll('[data-en-debut-civ]').forEach((b) => { b.onclick = async () => { b.disabled = true; try { await o.api('POST', `/nettoyage/civieres/${b.dataset.enDebutCiv}/debut`); } catch (err) { o.toast?.(err.message, true); } o.rafraichir?.(); }; });
  }
  /** Nettoyage : même composant de carte, en grille (tous les rôles autorisés). */
  async function grille(zone, o) {
    const d = await o.api('GET', `/entretien/cycle?etablissement_id=${o.etablissement_id}`); synchro(d);
    zone.innerHTML = `${etatSync()}${d.en_cours.length ? `<div class="en-grille">${d.en_cours.map((r) => carte(r)).join('')}</div>` : `<p class="note">${T('aucune')}</p>`}
      ${d.terminees.length ? `<details class="panneau-c"><summary><b>${T('terminees')} (${d.terminees.length})</b></summary><ul class="liste-simple en-faites">${d.terminees.map(carteFaite).join('')}</ul></details>` : ''}`;
    o.brancher?.(zone); brancherCivieres(zone, o); animer(zone);
    return d;
  }
  window.ArrimoEntretien = { accueil, grille, carte, duree };
})();
