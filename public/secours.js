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
      urgences: 'Urgences de la région', declare: 'Déclaré : {statut}, il y a {age} min', ancien: 'donnée ancienne',
      st: { ouvert: 'ouverte', capacite_limitee: 'capacité limitée', saturation: 'saturation', delestage: 'délestage' }, vol_oiseau: '{km} km à vol d’oiseau', civieres: '{n} civières libres', civiere1: '{n} civière libre', sans_donnee: 'aucune donnée d’urgence',
      position: 'Partager la position de l’unité', position_aide: 'Facultatif : améliore l’heure d’arrivée vue par l’hôpital. Conservée 24 h au plus.', position_on: 'Position partagée',
      position_refus: 'Position non disponible sur cet appareil.', historique: 'Dernières 24 heures', aucune: 'Aucune préalerte.', organisation: 'Préalertes de l’organisation',
      ccs_en_cours: 'Ambulances annoncées dans la région', carte: 'Carte régionale', alertes: 'Alertes de saturation', aucune_alerte: 'Aucune saturation déclarée ou mesurée.',
      alerte_niveau: 'urgence saturée (civières)', alerte_declare: 'déclaration « {statut} » il y a {age} min', ccs_aide: 'Consultation seulement : votre système de répartition reste la référence.',
      gardee: 'Réseau indisponible : préalerte gardée sur l’appareil, elle sera transmise automatiquement.', transmise: 'Préalerte transmise.', fait: 'Enregistré.',
      og_titre: 'OG, votre assistant Arrimo', og_aide: 'OG suit les préalertes et l’état des urgences ; il ne décide ni de la destination ni de la priorité.', og_question: 'Posez une question à OG',
      og_envoyer: 'Demander', og_q_reception: 'L’hôpital a-t-il confirmé la réception ?', og_q_manque: 'Que manque-t-il à ma préalerte ?', og_q_urgences: 'État des urgences de la région',
      og_q_en_cours: 'Préalertes en cours', og_q_ccs_route: 'Quelles ambulances sont en route ?', og_q_ccs_attente: 'Quelles préalertes ne sont pas encore prises en compte ?',
      transports: 'Demandes de transport des établissements', tr_aide: 'Référence du résident et informations de transport seulement ; le départ et l’arrivée restent confirmés par les établissements.',
      tr_de: 'De {origine}', tr_vers: 'vers {dest}', tr_heure: 'souhaité à {heure}', tr_accepter: 'Accepter avec l’unité {unite}', tr_refuser: 'Refuser', tr_en_route: 'En route vers le départ',
      tr_pris_en_charge: 'Résident pris en charge', tr_arrivee: 'Arrivé à destination', tr_confirmer_refus: 'Refuser cette demande ? L’établissement choisira une autre entreprise.', tr_aucune: 'Aucune demande de transport.',
      og_q_transports: 'Demandes des établissements', tr_prealerte: 'Transmettre la préalerte à {dest}', depuis_transport: 'Préalerte du transport {numero} (résident {ref})',
      trs: { demandee: 'à accepter', acceptee: 'acceptée', en_route: 'en route', pris_en_charge: 'résident pris en charge', arrivee: 'arrivée', refusee: 'refusée', annulee: 'annulée par l’établissement' },
      acc: { fauteuil: 'fauteuil roulant', deambulateur: 'déambulateur', leve_personne: 'lève-personne', lit_electrique: 'lit électrique', malentendant: 'malentendant', malvoyant: 'malvoyant' },
      accompagnateur: 'accompagnateur', langue: 'langue : {l}',
      vehicule: 'État du véhicule', vehicule_aide: 'Un geste suffit ; le CCS le voit. Il passe seul à « Transport vers l’hôpital » à l’envoi d’une préalerte et à « À l’hôpital » à l’arrivée confirmée.',
      vehicules: 'Véhicules de la région', vehicules_aide: 'Consultation seulement : aucune attribution ni répartition dans Arrimo ; votre système de répartition reste la référence.',
      aucun_vehicule: 'Aucun véhicule.', non_declare: 'état non déclaré', maj: 'mis à jour à {heure}', maj_auto: 'automatique', sans_position: 'position non partagée',
      ev: { disponible: 'Disponible', en_route: 'En route', sur_place: 'Sur place', transport_hopital: 'Transport vers l’hôpital', a_l_hopital: 'À l’hôpital', hors_service: 'Hors service' },
      tr_cat: 'type d’urgence : {cat}', tr_pref: 'hôpital souhaité : {h} (information, la destination reste votre décision)',
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
      urgences: 'Emergency departments in the region', declare: 'Declared: {statut}, {age} min ago', ancien: 'stale data',
      st: { ouvert: 'open', capacite_limitee: 'limited capacity', saturation: 'saturation', delestage: 'diversion' }, vol_oiseau: '{km} km as the crow flies', civieres: '{n} free stretchers', civiere1: '{n} free stretcher', sans_donnee: 'no emergency data',
      position: 'Share the unit’s position', position_aide: 'Optional: improves the arrival time seen by the hospital. Kept 24 h at most.', position_on: 'Position shared',
      position_refus: 'Position unavailable on this device.', historique: 'Last 24 hours', aucune: 'No pre-alert.', organisation: 'Organization pre-alerts',
      ccs_en_cours: 'Ambulances announced in the region', carte: 'Regional map', alertes: 'Saturation alerts', aucune_alerte: 'No saturation declared or measured.',
      alerte_niveau: 'emergency saturated (stretchers)', alerte_declare: '“{statut}” declared {age} min ago', ccs_aide: 'View only: your dispatch system remains the reference.',
      gardee: 'Network unavailable: pre-alert kept on the device; it will be sent automatically.', transmise: 'Pre-alert sent.', fait: 'Saved.',
      og_titre: 'OG, your Arrimo assistant', og_aide: 'OG tracks pre-alerts and emergency status; it decides neither the destination nor the priority.', og_question: 'Ask OG a question',
      og_envoyer: 'Ask', og_q_reception: 'Has the hospital confirmed receipt?', og_q_manque: 'What is missing from my pre-alert?', og_q_urgences: 'Regional emergency status',
      og_q_en_cours: 'Pre-alerts in progress', og_q_ccs_route: 'Which ambulances are on the way?', og_q_ccs_attente: 'Which pre-alerts are not yet acknowledged?',
      transports: 'Transport requests from facilities', tr_aide: 'Resident reference and transport information only; departure and arrival remain confirmed by the facilities.',
      tr_de: 'From {origine}', tr_vers: 'to {dest}', tr_heure: 'requested at {heure}', tr_accepter: 'Accept with unit {unite}', tr_refuser: 'Decline', tr_en_route: 'On the way to pickup',
      tr_pris_en_charge: 'Resident picked up', tr_arrivee: 'Arrived at destination', tr_confirmer_refus: 'Decline this request? The facility will choose another company.', tr_aucune: 'No transport request.',
      og_q_transports: 'Requests from facilities', tr_prealerte: 'Send the pre-alert to {dest}', depuis_transport: 'Pre-alert for transport {numero} (resident {ref})',
      trs: { demandee: 'to accept', acceptee: 'accepted', en_route: 'on the way', pris_en_charge: 'resident picked up', arrivee: 'arrived', refusee: 'declined', annulee: 'cancelled by the facility' },
      acc: { fauteuil: 'wheelchair', deambulateur: 'walker', leve_personne: 'patient lift', lit_electrique: 'electric bed', malentendant: 'hard of hearing', malvoyant: 'visually impaired' },
      accompagnateur: 'escort', langue: 'language: {l}',
      vehicule: 'Vehicle status', vehicule_aide: 'One tap is enough; the CCS sees it. It switches automatically to “Transport to hospital” when a pre-alert is sent and to “At hospital” when arrival is confirmed.',
      vehicules: 'Vehicles in the region', vehicules_aide: 'View only: no assignment or dispatch in Arrimo; your dispatch system remains the reference.',
      aucun_vehicule: 'No vehicle.', non_declare: 'status not declared', maj: 'updated at {heure}', maj_auto: 'automatic', sans_position: 'position not shared',
      ev: { disponible: 'Available', en_route: 'En route', sur_place: 'On scene', transport_hopital: 'Transport to hospital', a_l_hopital: 'At hospital', hors_service: 'Out of service' },
      tr_cat: 'emergency type: {cat}', tr_pref: 'preferred hospital: {h} (information only, the destination remains your decision)',
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
  const etat = { token: lire('arrimo-token'), moi: null, unites: [], vehicules: [], prealertes: [], transports: [], destinations: [], formulaire: { priorite: null, categorie: null, destination: null, delai: 10 },
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
      etat.transports = await api('GET', '/secours/transports').catch(() => []);
      etat.vehicules = await api('GET', '/secours/vehicules').catch(() => []);
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
    return `<section class="carte-s"><h2>${t('urgences')}</h2>${d.length ? d.map((h) => `<div class="ligne-s"><div><span class="pt-niveau ${esc(h.urgence?.niveau || 'inconnu')}" aria-hidden="true"></span><strong>${esc(h.nom)}</strong> <span class="note">${esc(h.ville || '')}</span>${h.statut_declare ? `<br><span class="note"${h.statut_declare.perime ? '' : ' style="color:var(--texte)"'}>${esc(t('declare', { statut: t('st.' + h.statut_declare.statut), age: h.statut_declare.age_min }))}${h.statut_declare.perime ? ` · ${t('ancien')}` : ''}</span>` : ''}</div>
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
    const tr = f.transport ? etat.transports.find((x) => x.id === f.transport) : null;
    return `<section class="carte-s"><h2>${t('nouvelle')} · ${esc(u.numero)}</h2>${tr ? `<p class="bandeau">${esc(t('depuis_transport', { numero: tr.numero, ref: tr.resident_ref }))}</p>` : ''}
      <label>${t('destination')}</label>${choix('destination', etat.destinations.map((d) => String(d.id)), (v) => { const d = etat.destinations.find((x) => String(x.id) === v); return `${d.nom}${d.distance_km != null ? ` (${d.distance_km} km)` : ''}`; }, f.destination)}
      <label>${t('priorite')}</label>${choix('priorite', ['immediate', 'urgente', 'non_urgente'], (v) => t('prio.' + v), f.priorite)}
      <label>${t('categorie')}</label>${choix('categorie', Object.keys(TXT.fr.cat), (v) => t('cat.' + v), f.categorie)}
      <label for="delai">${t('delai')}</label><div class="grille choix" data-choix="delai">${[5, 10, 15, 20, 30].map((n) => `<button type="button" data-v="${n}" aria-pressed="${f.delai === n}">${n}</button>`).join('')}</div>
      <p><button class="btn pri" data-act="envoyer" style="width:100%">${t('envoyer')}</button></p>
    </section>`;
  }
  /* État du véhicule : couleurs de statut seulement, toujours accompagnées du libellé */
  const ETATS_V = ['disponible', 'en_route', 'sur_place', 'transport_hopital', 'a_l_hopital', 'hors_service'];
  const COUL_V = { disponible: '#16A34A', en_route: '#2563EB', sur_place: '#F59E0B', transport_hopital: '#DC2626', a_l_hopital: '#159895', hors_service: '#94A3B8' };
  const pastilleV = (e) => `<span class="reseau-s" style="background:${COUL_V[e] || '#94A3B8'};color:${['sur_place', 'hors_service'].includes(e) ? '#1F2937' : '#fff'}">${esc(e ? t('ev.' + e) : t('non_declare'))}</span>`;
  function carteVehicule(u) {
    const v = etat.vehicules.find((x) => x.id === u.id) || {};
    return `<section class="carte-s" aria-label="${t('vehicule')}"><h2>${t('vehicule')} · ${esc(u.numero)} ${pastilleV(v.etat)}</h2>
      <div class="grille choix" data-etat-v="${u.id}">${ETATS_V.map((e) => `<button type="button" data-v="${e}" aria-pressed="${v.etat === e}">${esc(t('ev.' + e))}</button>`).join('')}</div>
      <p class="note">${v.modifie_le ? `${esc(t('maj', { heure: heure(v.modifie_le) }))}${v.source && v.source !== 'equipage' ? ` (${t('maj_auto')})` : ''}${v.destination ? ` · ${esc(t('vers', { dest: v.destination }))}` : ''} · ` : ''}${t('vehicule_aide')}</p></section>`;
  }
  function listeVehicules() {
    const l = etat.vehicules;
    return `<section class="carte-s"><h2>${t('vehicules')}</h2><p class="note">${t('vehicules_aide')}</p>${l.length ? l.map((v) => `<div class="ligne-s" data-vehicule="${esc(v.numero)}"><div><strong>${esc(v.numero)}</strong>${v.plaque ? ` · ${esc(v.plaque)}` : ''} <span class="note">${esc(v.organisation)}</span><br>${pastilleV(v.etat)}${v.destination ? ` <span>${esc(t('vers', { dest: v.destination }))}</span>` : ''}</div>
      <div class="note">${v.modifie_le ? esc(t('maj', { heure: heure(v.modifie_le) })) : ''}${v.position ? '' : `${v.modifie_le ? ' · ' : ''}${t('sans_position')}`}</div></div>`).join('') : `<p class="note">${t('aucun_vehicule')}</p>`}</section>`;
  }
  function positionCarte(u) {
    return `<section class="carte-s"><label style="display:flex;gap:12px;align-items:center;margin:0"><input type="checkbox" id="partage" style="width:28px;height:28px"${etat.partage ? ' checked' : ''}> ${t('position')}</label>
      <p class="note">${etat.partage && etat.position ? `${t('position_on')} · ${heure(etat.position.le)}` : t('position_aide')}</p></section>`;
  }
  function carteOg(amb) {
    const qs = amb ? ['og_q_reception', 'og_q_manque', 'og_q_urgences', 'og_q_en_cours', 'og_q_transports'] : ['og_q_ccs_route', 'og_q_ccs_attente', 'og_q_urgences', 'og_q_transports'];
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
  const COUL = { vert: '#16A34A', jaune: '#F59E0B', orange: '#D97706', rouge: '#DC2626' };
  function alertes() {
    const a = etat.destinations.filter((h) => h.urgence?.niveau === 'rouge' || (h.statut_declare && ['saturation', 'delestage'].includes(h.statut_declare.statut)));
    return `<section class="carte-s"><h2>${t('alertes')}</h2>${a.length ? a.map((h) => `<div class="ligne-s"><div><span class="pt-niveau rouge" aria-hidden="true"></span><strong>${esc(h.nom)}</strong></div>
      <div class="note">${esc([h.urgence?.niveau === 'rouge' ? t('alerte_niveau') : null, h.statut_declare && ['saturation', 'delestage'].includes(h.statut_declare.statut) ? `${t('alerte_declare', { statut: t('st.' + h.statut_declare.statut), age: h.statut_declare.age_min })}${h.statut_declare.perime ? ` · ${t('ancien')}` : ''}` : null].filter(Boolean).join(' · '))}</div></div>`).join('') : `<p class="note">${t('aucune_alerte')}</p>`}</section>`;
  }
  let leaflet = null; let carteRegion = null;
  const chargerLeaflet = () => leaflet || (leaflet = new Promise((ok, ko) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet/leaflet.css'; document.head.appendChild(css);
    const js = document.createElement('script'); js.src = 'vendor/leaflet/leaflet.js'; js.onload = () => ok(window.L); js.onerror = ko; document.head.appendChild(js);
  }));
  async function dessinerCarte() {
    const zone = document.getElementById('carte-region'); if (!zone) return;
    const L = await chargerLeaflet();
    if (carteRegion) { carteRegion.remove(); carteRegion = null; }
    carteRegion = L.map(zone, { scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 15, attribution: '&copy; OpenStreetMap' }).addTo(carteRegion);
    const pts = [];
    for (const h of etat.destinations.filter((x) => x.latitude != null)) {
      pts.push([h.latitude, h.longitude]);
      L.circleMarker([h.latitude, h.longitude], { radius: 10, color: '#0E5E6F', weight: 3, fillColor: COUL[h.urgence?.niveau] || '#94A3B8', fillOpacity: 0.95 }).addTo(carteRegion).bindTooltip(esc(h.nom));
    }
    for (const v of etat.vehicules.filter((x) => x.position)) {
      const pos = [v.position.latitude, v.position.longitude]; pts.push(pos);
      const p = etat.prealertes.find((x) => x.unite_id === v.id && OUVERTES.includes(x.statut));
      L.circleMarker(pos, { radius: 8, color: '#fff', weight: 2, fillColor: COUL_V[v.etat] || '#94A3B8', fillOpacity: 1 }).addTo(carteRegion)
        .bindTooltip(`${esc(v.numero)} · ${esc(v.etat ? t('ev.' + v.etat) : t('non_declare'))}${v.destination ? ` → ${esc(v.destination)}` : ''}${p ? ` · ${esc(eta(p))}` : ''}`, { permanent: true, direction: 'right' });
    }
    if (pts.length > 1) carteRegion.fitBounds(pts, { padding: [30, 30], maxZoom: 12 }); else if (pts.length) carteRegion.setView(pts[0], 11);
  }
  function carteTransports(amb) {
    const u = uniteCourante();
    const lignes = etat.transports.map((d) => {
      const infos = [...(d.infos?.accessibilite || []).map((x) => t('acc.' + x)), ...(d.infos?.accompagnateur ? [t('accompagnateur')] : []), ...(d.infos?.langue ? [t('langue', { l: d.infos.langue.toUpperCase() })] : [])];
      const a = amb ? d.actions : [];
      return `<div class="ligne-s"><div><strong>${esc(d.numero)}</strong> · ${esc(d.resident_ref)} · <b>${esc(t('trs.' + d.statut))}</b><br>
        <span class="note">${esc(t('tr_de', { origine: `${d.origine}${d.origine_adresse ? `, ${d.origine_adresse}` : ''}` }))} ${esc(t('tr_vers', { dest: d.destination }))}${d.heure_souhaitee ? ` · ${esc(t('tr_heure', { heure: heure(d.heure_souhaitee) }))}` : ''}${d.unite ? ` · ${esc(d.unite)}` : ''}</span>
        ${infos.length ? `<br><span class="note">${esc(infos.join(' · '))}</span>` : ''}
        ${d.categorie_urgence || d.hopital_prefere ? `<br><span class="note">${esc([d.categorie_urgence ? t('tr_cat', { cat: t('cat.' + d.categorie_urgence) }) : null, d.hopital_prefere ? t('tr_pref', { h: d.hopital_prefere }) : null].filter(Boolean).join(' · '))}</span>` : ''}</div>
        ${a.length ? `<div class="grille" style="min-width:min(100%,320px)">${a.includes('accepter') && u ? `<button class="btn pri" data-tr="accepter" data-id="${d.id}" data-version="${d.version}">${esc(t('tr_accepter', { unite: u.numero }))}</button>` : ''}
          ${a.includes('refuser') ? `<button class="btn" data-tr="refuser" data-id="${d.id}" data-version="${d.version}">${t('tr_refuser')}</button>` : ''}
          ${d.statut === 'pris_en_charge' && amb ? `<button class="btn pri" data-tr-pa="${d.id}">${esc(t('tr_prealerte', { dest: d.hopital_prefere || d.destination }))}</button>` : ''}
          ${['en_route', 'pris_en_charge', 'arrivee'].filter((x) => a.includes(x)).map((x) => `<button class="btn${x === 'arrivee' ? '' : ' pri'}" data-tr="${x}" data-id="${d.id}" data-version="${d.version}">${t('tr_' + x)}</button>`).join('')}</div>` : ''}</div>`;
    });
    return `<section class="carte-s"><h2>${t('transports')}</h2><p class="note">${t('tr_aide')}</p>${lignes.join('') || `<p class="note">${t('tr_aucune')}</p>`}</section>`;
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
      // CCS simplifié (13 nov. 2026) : état des véhicules (carte et liste) et disponibilité des urgences ; aucune attribution
      m.innerHTML = `${msg}<section class="carte-s"><h2>${t('carte')}</h2><div id="carte-region" style="height:380px;border-radius:12px"></div></section>${listeVehicules()}${alertes()}${urgences()}${ouvertes.length ? `<section class="carte-s"><h2>${t('ccs_en_cours')}</h2><p class="note">${t('ccs_aide')}</p>${ouvertes.map(ligneListe).join('')}</section>` : ''}`;
      dessinerCarte().catch(() => {});
      return;
    }
    const u = uniteCourante();
    if (!u) { m.innerHTML = `${msg}<section class="carte-s"><p>${t('aucune_unite')}</p></section>`; return; }
    const enCours = etat.prealertes.find((p) => p.unite_id === u.id && OUVERTES.includes(p.statut));
    const enAttente = lireFile().some((x) => x.chemin === '/secours/prealertes' && Number(x.corps.unite_id) === u.id);
    const recentes = etat.prealertes.filter((p) => p.unite_id === u.id && !OUVERTES.includes(p.statut));
    const superviseur = etat.moi.utilisateur.role === 'superviseur_secours';
    m.innerHTML = `${msg}${carteVehicule(u)}${enCours ? carteEnCours(enCours) : enAttente ? '' : formulaire(u)}${carteOg(true)}${carteTransports(true)}${positionCarte(u)}${urgences()}
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
    if (b.dataset.trPa) {
      // Préalerte qui prolonge le transport : hôpital de destination prérempli ; l'équipe choisit priorité et catégorie
      const d = etat.transports.find((x) => String(x.id) === b.dataset.trPa); if (!d) return;
      const souhaite = d.hopital_prefere_id && etat.destinations.some((x) => x.id === d.hopital_prefere_id) ? d.hopital_prefere_id : d.destination_id;
      etat.formulaire = { ...etat.formulaire, destination: String(souhaite), transport: d.id };
      rendre(); document.querySelector('[data-choix="priorite"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
    }
    if (b.dataset.tr) {
      const a = b.dataset.tr; const u0 = uniteCourante();
      if (a === 'refuser' && !confirm(t('tr_confirmer_refus'))) return;
      etat.erreur = null; etat.message = null;
      try { await api('POST', `/secours/transports/${b.dataset.id}/action`, { action: a, version: Number(b.dataset.version), ...(a === 'accepter' ? { unite_id: u0.id } : {}), ...(a === 'refuser' ? { motif: 'aucune_unite' } : {}) }); etat.message = t('fait'); }
      catch (e) { etat.erreur = estReseau(e) ? t('hors_ligne') : e.message; }
      return charger();
    }
    if (b.id === 'sortir') { try { await api('POST', '/deconnexion'); } catch { /* session déjà close */ } ecrire('arrimo-token', null); location.replace('/'); return; }
    const u = uniteCourante(); const p = u && etat.prealertes.find((x) => x.unite_id === u.id && OUVERTES.includes(x.statut));
    const zoneEtat = b.closest('[data-etat-v]');
    if (zoneEtat) {
      etat.erreur = null; etat.message = null;
      try { const r = await envoyer(`/secours/unites/${zoneEtat.dataset.etatV}/etat`, { etat: b.dataset.v }, { garder: true }); if (r) etat.message = t('fait'); }
      catch (e) { etat.erreur = e.message; }
      return charger();
    }
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
        const r = await envoyer('/secours/prealertes', { unite_id: u.id, destination_id: Number(f.destination), priorite: f.priorite, categorie: f.categorie, delai_min: f.delai, cle: cle(), ...(f.transport ? { demande_transport_id: f.transport } : {}) }, { garder: true });
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
