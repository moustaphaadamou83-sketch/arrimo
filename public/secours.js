/* Arrimo Secours : écran embarqué des ambulances (paramédics, superviseurs) et écran des CCS (répartiteurs).
   L'ambulance informe ; l'hôpital se prépare ; les professionnels décident. Aucune identité, aucun texte libre :
   priorité et catégorie en listes fermées. Coupure réseau : la préalerte est gardée sur l'appareil et renvoyée
   avec la même clé d'envoi (jamais de doublon). La position est facultative et partagée seulement sur demande. */
(() => {
  const TXT = {
    fr: {
      titre_amb: 'Arrimo Ambulance', titre_ccs: 'Arrimo CCS', sortir: 'Se déconnecter', en_ligne: 'En ligne', hors_ligne: 'Hors ligne', attente: 'Envoi en attente : {n}',
      unite: 'Unité', aucune_unite: 'Aucune unité active pour votre organisation.', nouvelle: 'Nouvelle préalerte', destination: 'Hôpital destinataire (décidé par l’équipe et les protocoles)',
      priorite: 'Priorité', categorie: 'Catégorie d’intervention', delai: 'Arrivée prévue dans (minutes)', envoyer: 'Transmettre la préalerte', choisir: 'Choisissez l’hôpital, la priorité et la catégorie.',
      en_cours: 'Préalerte en cours', vers: 'Vers {dest}', arrivee_prevue: 'Arrivée prévue', dans: 'dans {n} min', depassee: 'heure dépassée', non_transmise: 'heure non transmise',
      retard: 'Signaler un retard', plus5: '+5 min', plus10: '+10 min', changer_prio: 'Changer la priorité', changer_dest: 'Changer de destination', arrivee: 'Signaler l’arrivée',
      arrivee_signalee: 'Arrivée signalée : l’hôpital confirme le véhicule.', annuler: 'Annuler la préalerte', confirmer_annuler: 'Annuler cette préalerte ? L’hôpital sera informé.',
      confirmer_dest: 'Transmettre la préalerte à {dest} ? L’ancienne est conservée et l’hôpital précédent est informé.',
      e_envoyee: 'Transmise', e_recue: 'Reçue par l’hôpital', e_consultee: 'Consultée', e_prise_en_compte: 'Prise en compte', e_preparation: 'Préparation', e_preparation_terminee: 'Prête', e_arrivee: 'Arrivée confirmée',
      s_envoyee: 'transmise, réception non confirmée', s_recue: 'reçue par l’écran de l’hôpital', s_consultee: 'consultée', s_prise_en_compte: 'prise en compte', s_preparation: 'préparation en cours',
      s_preparation_terminee: 'préparation terminée', s_arrivee: 'arrivée confirmée', s_cloturee: 'remise confirmée, clôturée', s_annulee: 'annulée', s_remplacee: 'remplacée (destination modifiée)',
      urgences: 'Urgences de la région', vol_oiseau: '{km} km à vol d’oiseau', civieres: '{n} civières libres', civiere1: '{n} civière libre', sans_donnee: 'aucune donnée d’urgence',
      position: 'Partager la position de l’unité', position_aide: 'Facultatif : améliore l’heure d’arrivée vue par l’hôpital. Conservée 24 h au plus.', position_on: 'Position partagée',
      position_refus: 'Position non disponible sur cet appareil.', historique: 'Dernières 24 heures', aucune: 'Aucune préalerte.', organisation: 'Préalertes de l’organisation',
      ccs_en_cours: 'Ambulances annoncées dans la région', ccs_aide: 'Consultation seulement : votre système de répartition reste la référence.',
      gardee: 'Réseau indisponible : préalerte gardée sur l’appareil, elle sera transmise automatiquement.', transmise: 'Préalerte transmise.', fait: 'Enregistré.',
      og_titre: 'OG, votre assistant Arrimo', og_aide: 'OG suit les préalertes et l’état des urgences ; il ne décide ni de la destination ni de la priorité.', og_question: 'Posez une question à OG',
      og_envoyer: 'Demander', og_q_reception: 'L’hôpital a-t-il confirmé la réception ?', og_q_manque: 'Que manque-t-il à ma préalerte ?', og_q_urgences: 'État des urgences de la région',
      og_q_en_cours: 'Préalertes en cours', og_q_ccs_route: 'Quelles ambulances sont en route ?', og_q_ccs_attente: 'Quelles préalertes ne sont pas encore prises en compte ?',
      prio: { immediate: 'Immédiate', urgente: 'Urgente', non_urgente: 'Non urgente' },
      cat: { medicale: 'Médicale', traumatologie: 'Traumatologie', cardiaque: 'Cardiaque', neurologique: 'Neurologique', respiratoire: 'Respiratoire', pediatrique: 'Pédiatrique',
        obstetrique: 'Obstétrique', sante_mentale: 'Santé mentale', autre: 'Autre' },
    },
    en: {
      titre_amb: 'Arrimo Ambulance', titre_ccs: 'Arrimo CCS', sortir: 'Sign out', en_ligne: 'Online', hors_ligne: 'Offline', attente: 'Pending send: {n}',
      unite: 'Unit', aucune_unite: 'No active unit for your organization.', nouvelle: 'New pre-alert', destination: 'Receiving hospital (decided by the crew and protocols)',
      priorite: 'Priority', categorie: 'Call category', delai: 'Expected arrival in (minutes)', envoyer: 'Send the pre-alert', choisir: 'Choose the hospital, the priority and the category.',
      en_cours: 'Pre-alert in progress', vers: 'To {dest}', arrivee_prevue: 'Expected arrival', dans: 'in {n} min', depassee: 'time passed', non_transmise: 'time not provided',
      retard: 'Report a delay', plus5: '+5 min', plus10: '+10 min', changer_prio: 'Change priority', changer_dest: 'Change destination', arrivee: 'Report arrival',
      arrivee_signalee: 'Arrival reported: the hospital confirms the vehicle.', annuler: 'Cancel the pre-alert', confirmer_annuler: 'Cancel this pre-alert? The hospital will be informed.',
      confirmer_dest: 'Send the pre-alert to {dest}? The previous one is kept and the previous hospital is informed.',
      e_envoyee: 'Sent', e_recue: 'Received by hospital', e_consultee: 'Viewed', e_prise_en_compte: 'Acknowledged', e_preparation: 'Preparing', e_preparation_terminee: 'Ready', e_arrivee: 'Arrival confirmed',
      s_envoyee: 'sent, receipt not confirmed', s_recue: 'received by the hospital screen', s_consultee: 'viewed', s_prise_en_compte: 'acknowledged', s_preparation: 'preparation in progress',
      s_preparation_terminee: 'preparation complete', s_arrivee: 'arrival confirmed', s_cloturee: 'handover confirmed, closed', s_annulee: 'cancelled', s_remplacee: 'replaced (destination changed)',
      urgences: 'Emergency departments in the region', vol_oiseau: '{km} km as the crow flies', civieres: '{n} free stretchers', civiere1: '{n} free stretcher', sans_donnee: 'no emergency data',
      position: 'Share the unit’s position', position_aide: 'Optional: improves the arrival time seen by the hospital. Kept 24 h at most.', position_on: 'Position shared',
      position_refus: 'Position unavailable on this device.', historique: 'Last 24 hours', aucune: 'No pre-alert.', organisation: 'Organization pre-alerts',
      ccs_en_cours: 'Ambulances announced in the region', ccs_aide: 'View only: your dispatch system remains the reference.',
      gardee: 'Network unavailable: pre-alert kept on the device; it will be sent automatically.', transmise: 'Pre-alert sent.', fait: 'Saved.',
      og_titre: 'OG, your Arrimo assistant', og_aide: 'OG tracks pre-alerts and emergency status; it decides neither the destination nor the priority.', og_question: 'Ask OG a question',
      og_envoyer: 'Ask', og_q_reception: 'Has the hospital confirmed receipt?', og_q_manque: 'What is missing from my pre-alert?', og_q_urgences: 'Regional emergency status',
      og_q_en_cours: 'Pre-alerts in progress', og_q_ccs_route: 'Which ambulances are on the way?', og_q_ccs_attente: 'Which pre-alerts are not yet acknowledged?',
      prio: { immediate: 'Immediate', urgente: 'Urgent', non_urgente: 'Non-urgent' },
      cat: { medicale: 'Medical', traumatologie: 'Trauma', cardiaque: 'Cardiac', neurologique: 'Neurological', respiratoire: 'Respiratory', pediatrique: 'Pediatric',
        obstetrique: 'Obstetric', sante_mentale: 'Mental health', autre: 'Other' },
    },
  };
  const lire = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const ecrire = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };
  let L = lire('arrimo-langue') === 'en' ? 'en' : 'fr';
  const t = (k, v = {}) => {
    let s = k.split('.').reduce((o, x) => (o == null ? o : o[x]), TXT[L]) ?? k;
    s = String(s).replace(/\{(\w+)\}/g, (m, x) => (v[x] ?? m));
    return s;
  };
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s) => document.querySelector(s);
  const ROLES_AMB = ['paramedic', 'superviseur_secours'];
  const OUVERTES = ['envoyee', 'recue', 'consultee', 'prise_en_compte', 'preparation', 'preparation_terminee', 'arrivee'];
  const ETAPES = ['envoyee', 'recue', 'consultee', 'prise_en_compte', 'preparation', 'preparation_terminee', 'arrivee'];
  const etat = { token: lire('arrimo-token'), moi: null, unites: [], prealertes: [], destinations: [], formulaire: { priorite: null, categorie: null, destination: null, delai: 10 },
    enLigne: navigator.onLine, message: null, erreur: null, position: null, partage: lire('arrimo-secours-position') === '1', dernierEnvoiPos: 0, choixDest: false, og: null };
  const lireFile = () => { try { return JSON.parse(lire('arrimo-secours-file') || '[]'); } catch { return []; } };
  const ecrireFile = (f) => ecrire('arrimo-secours-file', f.length ? JSON.stringify(f) : null);

  async function api(methode, chemin, corps) {
    const r = await fetch(`/api${chemin}`, { method: methode, headers: { 'Content-Type': 'application/json', 'X-Langue': L, Authorization: `Bearer ${etat.token}` },
      body: corps ? JSON.stringify(corps) : undefined });
    let data = null; try { data = await r.json(); } catch { /* réponse vide */ }
    if (r.status === 401) { ecrire('arrimo-token', null); location.replace('/'); throw new Error('session'); }
    if (!r.ok) { const e = new Error((data && data.erreur) || `Erreur ${r.status}`); e.code = data && data.code; e.statut = r.status; throw e; }
    return data;
  }
  const estReseau = (e) => e instanceof TypeError || !navigator.onLine;
  const cle = () => `pa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  /* File d'envoi : seulement la création (clé d'envoi) et les actions sans risque de répétition. */
  async function viderFile() {
    let f = lireFile(); if (!f.length) return;
    for (const x of [...f]) {
      try { await api('POST', x.chemin, x.corps); f = f.filter((y) => y.id !== x.id); }
      catch (e) {
        if (estReseau(e)) break;
        // Refus du serveur (déjà fait, préalerte close…) : l'envoi est retiré et l'erreur affichée
        f = f.filter((y) => y.id !== x.id); if (e.statut !== 409) etat.erreur = e.message;
      }
    }
    ecrireFile(f); await charger();
  }
  async function envoyer(chemin, corps, { garder = false } = {}) {
    try { return await api('POST', chemin, corps); }
    catch (e) {
      if (garder && estReseau(e)) { ecrireFile([...lireFile(), { id: cle(), chemin, corps }]); etat.message = t('gardee'); etat.enLigne = false; rendre(); return null; }
      throw e;
    }
  }

  async function charger() {
    try {
      const [p, d] = await Promise.all([api('GET', '/secours/prealertes'), api('GET', `/secours/destinations${etat.position ? `?latitude=${etat.position.latitude}&longitude=${etat.position.longitude}` : ''}`)]);
      etat.prealertes = p.prealertes; etat.destinations = d; etat.enLigne = true;
      if (ROLES_AMB.includes(etat.moi.utilisateur.role)) etat.unites = await api('GET', '/secours/unites');
    } catch (e) { if (estReseau(e)) etat.enLigne = false; else etat.erreur = e.message; }
    rendre();
  }
  const uniteCourante = () => etat.unites.find((u) => String(u.id) === String(lire('arrimo-secours-unite'))) || etat.unites[0];
  const minutes = (d) => (d ? Math.round((new Date(d).getTime() - Date.now()) / 60000) : null);
  const heure = (d) => new Date(d).toLocaleTimeString(L === 'en' ? 'en-CA' : 'fr-CA', { hour: '2-digit', minute: '2-digit' });
  function eta(p) {
    const m = minutes(p.heure_prevue);
    if (m == null) return t('non_transmise');
    return `${heure(p.heure_prevue)} · ${m > 0 ? t('dans', { n: m }) : t('depassee')}`;
  }

  function enTete() {
    const amb = ROLES_AMB.includes(etat.moi.utilisateur.role);
    $('#titre').textContent = `${amb ? t('titre_amb') : t('titre_ccs')} · ${(etat.moi.organisations || []).map((o) => o.nom).join(', ')}`;
    document.title = `Arrimo · ${amb ? t('titre_amb') : t('titre_ccs')}`;
    const n = lireFile().length; const r = $('#reseau');
    r.className = `reseau-s ${n ? 'attente' : etat.enLigne ? 'en-ligne' : 'hors-ligne'}`;
    r.textContent = n ? t('attente', { n }) : etat.enLigne ? t('en_ligne') : t('hors_ligne');
    $('#sortir').textContent = t('sortir');
    document.querySelectorAll('[data-langue]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.langue === L)));
    const sel = $('#unite'); sel.hidden = !amb || etat.unites.length < 2; sel.setAttribute('aria-label', t('unite'));
    const u = uniteCourante();
    sel.innerHTML = etat.unites.map((x) => `<option value="${x.id}"${u && x.id === u.id ? ' selected' : ''}>${esc(x.numero)}${x.plaque ? ` · ${esc(x.plaque)}` : ''}</option>`).join('');
  }
  const choix = (nom, valeurs, libelle, courant) => `<div class="grille choix" data-choix="${nom}">${valeurs.map((v) => `<button type="button" data-v="${esc(v)}" aria-pressed="${courant === v}">${esc(libelle(v))}</button>`).join('')}</div>`;
  function urgences() {
    const d = etat.destinations;
    return `<section class="carte-s"><h2>${t('urgences')}</h2>${d.length ? d.map((h) => `<div class="ligne-s"><div><span class="pt-niveau ${esc(h.urgence?.niveau || 'inconnu')}" aria-hidden="true"></span><strong>${esc(h.nom)}</strong> <span class="note">${esc(h.ville || '')}</span></div>
      <div class="note">${esc([h.distance_km != null ? t('vol_oiseau', { km: h.distance_km }) : null, h.urgence ? t(h.urgence.civieres_libres > 1 ? 'civieres' : 'civiere1', { n: h.urgence.civieres_libres }) : t('sans_donnee')].filter(Boolean).join(' · '))}</div></div>`).join('') : `<p class="note">${t('aucune')}</p>`}</section>`;
  }
  function carteEnCours(p) {
    const fait = (e) => p[{ envoyee: 'cree_le', recue: 'recue_le', consultee: 'consultee_le', prise_en_compte: 'prise_en_compte_le', preparation: 'preparation_le', preparation_terminee: 'preparation_terminee_le', arrivee: 'arrivee_confirmee_le' }[e]];
    const a = p.actions || [];
    return `<section class="carte-s prio-${esc(p.priorite)}"><h2>${t('en_cours')} · ${esc(p.numero)}</h2>
      <div class="gros">${esc(t('vers', { dest: p.destination }))}</div>
      <p>${t('prio.' + p.priorite)} · ${t('cat.' + p.categorie)} · <strong>${t('s_' + p.statut)}</strong></p>
      <p>${t('arrivee_prevue')} : <strong>${esc(eta(p))}</strong></p>
      <ol class="etapes">${ETAPES.map((e) => `<li class="${fait(e) ? 'fait' : ''}">${t('e_' + e)}${fait(e) ? `<br><span>${heure(fait(e))}</span>` : ''}</li>`).join('')}</ol>
      ${p.arrivee_signalee_le && p.statut !== 'arrivee' ? `<p class="bandeau">${t('arrivee_signalee')}</p>` : ''}
      <div class="grille">
        ${a.includes('mettre_a_jour') ? `<button class="btn" data-act="retard" data-n="5">${t('retard')} ${t('plus5')}</button><button class="btn" data-act="retard" data-n="10">${t('retard')} ${t('plus10')}</button>` : ''}
        ${a.includes('signaler_arrivee') ? `<button class="btn pri" data-act="arrivee">${t('arrivee')}</button>` : ''}
      </div>
      ${a.includes('mettre_a_jour') ? `<label>${t('changer_prio')}</label>${choix('prio-maj', ['immediate', 'urgente', 'non_urgente'], (v) => t('prio.' + v), p.priorite)}` : ''}
      ${a.includes('changer_destination') ? `<label>${t('changer_dest')}</label>${choix('dest-maj', etat.destinations.filter((d) => d.id !== p.destination_id).map((d) => String(d.id)), (v) => etat.destinations.find((d) => String(d.id) === v)?.nom, null)}` : ''}
      ${a.includes('annuler') ? `<p><button class="btn discret" data-act="annuler">${t('annuler')}</button></p>` : ''}
    </section>`;
  }
  function formulaire(u) {
    const f = etat.formulaire;
    return `<section class="carte-s"><h2>${t('nouvelle')} · ${esc(u.numero)}</h2>
      <label>${t('destination')}</label>${choix('destination', etat.destinations.map((d) => String(d.id)), (v) => { const d = etat.destinations.find((x) => String(x.id) === v); return `${d.nom}${d.distance_km != null ? ` (${d.distance_km} km)` : ''}`; }, f.destination)}
      <label>${t('priorite')}</label>${choix('priorite', ['immediate', 'urgente', 'non_urgente'], (v) => t('prio.' + v), f.priorite)}
      <label>${t('categorie')}</label>${choix('categorie', Object.keys(TXT.fr.cat), (v) => t('cat.' + v), f.categorie)}
      <label for="delai">${t('delai')}</label><div class="grille choix" data-choix="delai">${[5, 10, 15, 20, 30].map((n) => `<button type="button" data-v="${n}" aria-pressed="${f.delai === n}">${n}</button>`).join('')}</div>
      <p><button class="btn pri" data-act="envoyer" style="width:100%">${t('envoyer')}</button></p>
    </section>`;
  }
  function positionCarte(u) {
    return `<section class="carte-s"><label style="display:flex;gap:12px;align-items:center;margin:0"><input type="checkbox" id="partage" style="width:28px;height:28px"${etat.partage ? ' checked' : ''}> ${t('position')}</label>
      <p class="note">${etat.partage && etat.position ? `${t('position_on')} · ${heure(etat.position.le)}` : t('position_aide')}</p></section>`;
  }
  function carteOg(amb) {
    const qs = amb ? ['og_q_reception', 'og_q_manque', 'og_q_urgences', 'og_q_en_cours'] : ['og_q_ccs_route', 'og_q_ccs_attente', 'og_q_urgences'];
    return `<section class="carte-s" aria-label="OG"><h2><img src="og-robot.svg" alt="" width="28" height="28" style="vertical-align:middle;margin-right:8px">${t('og_titre')}</h2>
      <p class="note">${t('og_aide')}</p>
      <div class="grille">${qs.map((k) => `<button type="button" class="btn" data-og="${k}">${t(k)}</button>`).join('')}</div>
      <form id="og-form" style="display:flex;gap:8px;margin-top:10px"><input id="og-q" type="text" maxlength="500" aria-label="${t('og_question')}" placeholder="${t('og_question')}" style="flex:1;min-height:56px;font-size:18px">
        <button class="btn pri" type="submit">${t('og_envoyer')}</button></form>
      ${etat.og ? `<div class="bandeau" role="status" style="margin-top:10px;white-space:pre-line;border-color:var(--principal)">${esc(etat.og)}</div>` : ''}</section>`;
  }
  async function demanderOg(question) {
    if (!question) return;
    try { etat.og = (await api('POST', '/secours/og', { question })).reponse; } catch (e) { etat.og = estReseau(e) ? t('hors_ligne') : e.message; }
    rendre();
  }
  const ligneListe = (p) => `<div class="ligne-s prio-${esc(p.priorite)}" style="padding-left:10px"><div><strong>${esc(p.numero)}</strong> · ${esc(p.unite)} → ${esc(p.destination)}</div>
    <div class="note">${t('prio.' + p.priorite)} · ${t('cat.' + p.categorie)} · ${t('s_' + p.statut)}${OUVERTES.includes(p.statut) ? ` · ${esc(eta(p))}` : ''}</div></div>`;

  function rendre() {
    const saisie = document.getElementById('og-q')?.value || ''; const actif = document.activeElement?.id;
    rendreEcran();
    const champ = document.getElementById('og-q');
    if (champ && saisie) champ.value = saisie;
    if (champ && actif === 'og-q') champ.focus();
  }
  function rendreEcran() {
    if (!etat.moi) return;
    enTete();
    const m = $('#contenu'); const amb = ROLES_AMB.includes(etat.moi.utilisateur.role);
    const msg = `${etat.erreur ? `<p class="erreur" role="alert">${esc(etat.erreur)}</p>` : ''}${etat.message ? `<p class="bandeau" role="status">${esc(etat.message)}</p>` : ''}`;
    if (!amb) {
      const ouvertes = etat.prealertes.filter((p) => OUVERTES.includes(p.statut));
      m.innerHTML = `${msg}${carteOg(false)}<section class="carte-s"><h2>${t('ccs_en_cours')}</h2><p class="note">${t('ccs_aide')}</p>${ouvertes.length ? ouvertes.map(ligneListe).join('') : `<p class="note">${t('aucune')}</p>`}</section>${urgences()}`;
      return;
    }
    const u = uniteCourante();
    if (!u) { m.innerHTML = `${msg}<section class="carte-s"><p>${t('aucune_unite')}</p></section>`; return; }
    const enCours = etat.prealertes.find((p) => p.unite_id === u.id && OUVERTES.includes(p.statut));
    const enAttente = lireFile().some((x) => x.chemin === '/secours/prealertes' && Number(x.corps.unite_id) === u.id);
    const recentes = etat.prealertes.filter((p) => p.unite_id === u.id && !OUVERTES.includes(p.statut));
    const superviseur = etat.moi.utilisateur.role === 'superviseur_secours';
    m.innerHTML = `${msg}${enCours ? carteEnCours(enCours) : enAttente ? '' : formulaire(u)}${carteOg(true)}${positionCarte(u)}${urgences()}
      ${superviseur ? `<section class="carte-s"><h2>${t('organisation')}</h2>${etat.prealertes.filter((p) => OUVERTES.includes(p.statut)).map(ligneListe).join('') || `<p class="note">${t('aucune')}</p>`}</section>` : ''}
      <section class="carte-s"><h2>${t('historique')}</h2>${recentes.length ? recentes.map(ligneListe).join('') : `<p class="note">${t('aucune')}</p>`}</section>`;
  }

  async function agir(p, corps) {
    etat.erreur = null; etat.message = null;
    try { const r = await envoyer(`/secours/prealertes/${p.id}/action`, { version: p.version, ...corps }, { garder: ['signaler_arrivee', 'mettre_a_jour'].includes(corps.action) }); if (r) etat.message = t('fait'); }
    catch (e) { etat.erreur = e.message; }
    await charger();
  }
  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.langue) { L = b.dataset.langue; ecrire('arrimo-langue', L); document.documentElement.lang = L === 'en' ? 'en-CA' : 'fr-CA'; rendre(); return; }
    if (b.dataset.og) return demanderOg(t(b.dataset.og));
    if (b.id === 'sortir') { try { await api('POST', '/deconnexion'); } catch { /* session déjà close */ } ecrire('arrimo-token', null); location.replace('/'); return; }
    const u = uniteCourante(); const p = u && etat.prealertes.find((x) => x.unite_id === u.id && OUVERTES.includes(x.statut));
    const groupe = b.closest('[data-choix]')?.dataset.choix;
    if (groupe === 'prio-maj' && p) return agir(p, { action: 'mettre_a_jour', priorite: b.dataset.v });
    if (groupe === 'dest-maj' && p) {
      const d = etat.destinations.find((x) => String(x.id) === b.dataset.v);
      if (d && confirm(t('confirmer_dest', { dest: d.nom }))) return agir(p, { action: 'changer_destination', destination_id: d.id });
      return;
    }
    if (groupe) { etat.formulaire[groupe] = groupe === 'delai' ? Number(b.dataset.v) : b.dataset.v; rendre(); return; }
    const act = b.dataset.act;
    if (act === 'retard' && p) { const base = Math.max(0, minutes(p.heure_prevue) ?? 0); return agir(p, { action: 'mettre_a_jour', delai_min: base + Number(b.dataset.n) }); }
    if (act === 'arrivee' && p) return agir(p, { action: 'signaler_arrivee' });
    if (act === 'annuler' && p) { if (confirm(t('confirmer_annuler'))) return agir(p, { action: 'annuler' }); return; }
    if (act === 'envoyer' && u) {
      const f = etat.formulaire; etat.erreur = null; etat.message = null;
      if (!f.destination || !f.priorite || !f.categorie) { etat.erreur = t('choisir'); rendre(); return; }
      try {
        const r = await envoyer('/secours/prealertes', { unite_id: u.id, destination_id: Number(f.destination), priorite: f.priorite, categorie: f.categorie, delai_min: f.delai, cle: cle() }, { garder: true });
        if (r) { etat.message = t('transmise'); etat.formulaire = { priorite: null, categorie: null, destination: null, delai: 10 }; }
      } catch (e) { etat.erreur = e.message; }
      await charger();
    }
  });
  document.addEventListener('submit', (ev) => { if (ev.target.id === 'og-form') { ev.preventDefault(); demanderOg($('#og-q').value.trim()); } });
  document.addEventListener('change', (ev) => {
    if (ev.target.id === 'unite') { ecrire('arrimo-secours-unite', ev.target.value); rendre(); }
    if (ev.target.id === 'partage') { etat.partage = ev.target.checked; ecrire('arrimo-secours-position', etat.partage ? '1' : null); suivrePosition(); rendre(); }
  });

  /* Position : seulement si l'équipe l'active ; envoyée toutes les 30 s au plus ; la préalerte fonctionne sans. */
  let surveillance = null;
  function suivrePosition() {
    if (surveillance != null) { navigator.geolocation?.clearWatch(surveillance); surveillance = null; }
    if (!etat.partage) return;
    if (!navigator.geolocation) { etat.erreur = t('position_refus'); return; }
    surveillance = navigator.geolocation.watchPosition(async (pos) => {
      etat.position = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, le: Date.now() };
      const u = uniteCourante();
      if (!u || Date.now() - etat.dernierEnvoiPos < 30000) return;
      etat.dernierEnvoiPos = Date.now();
      try { await api('POST', `/secours/unites/${u.id}/position`, { latitude: pos.coords.latitude, longitude: pos.coords.longitude, precision_m: pos.coords.accuracy }); } catch { /* réessai au prochain point */ }
      rendre();
    }, () => { etat.erreur = t('position_refus'); rendre(); }, { enableHighAccuracy: true, maximumAge: 15000 });
  }

  window.addEventListener('online', () => { etat.enLigne = true; viderFile(); });
  window.addEventListener('offline', () => { etat.enLigne = false; rendre(); });
  async function demarrer() {
    if (!etat.token) { location.replace('/'); return; }
    document.documentElement.lang = L === 'en' ? 'en-CA' : 'fr-CA';
    try { etat.moi = await api('GET', '/moi'); } catch (e) { if (!estReseau(e)) { location.replace('/'); return; } }
    if (!etat.moi) { $('#contenu').innerHTML = `<p class="bandeau">${t('hors_ligne')}</p>`; setTimeout(demarrer, 10000); return; }
    if (![...ROLES_AMB, 'repartiteur'].includes(etat.moi.utilisateur.role)) { location.replace('/'); return; }
    window.ArrimoApparence?.definir(etat.moi.utilisateur.apparence || 'automatique');
    suivrePosition();
    await viderFile(); await charger();
    setInterval(() => { if (lireFile().length) viderFile(); else charger(); }, 15000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw-secours.js', { scope: '/secours' }).catch(() => {});
  }
  demarrer();
})();
