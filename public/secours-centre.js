/* Centre de commandement CCS, gestionnaire ambulancier et accueil embarqué (cahiers du 27 nov. 2026).
   Relié aux services réels : /secours/flotte (statuts harmonisés + conditions), fiche et chronologie unique, messagerie opérationnelle,
   transmission envoyée/reçue/consultée, plans A/B/C d'OG, historique paginé. Les longues listes de passages terminés sont remplacées
   par des synthèses ; le détail reste entier dans Historique. Arrimo transmet, le CCS et les protocoles décident. */
(() => {
  const TX = {
    fr: {
      o_accueil: 'Accueil', o_flotte: 'Flotte', o_bourse: 'Bourse des places', o_alertes: 'Alertes', o_pilotage: 'Pilotage', o_equipes: 'Équipes', o_administration: 'Administration',
      k_dispo: 'Ambulances disponibles', k_mission: 'Ambulances en mission', k_immo: 'Ambulances immobilisées', k_attente: 'Missions en attente', k_capacites: 'Civières libres (urgences)', k_alertes: 'Alertes prioritaires',
      total: '{n} véhicules supervisés', s_disponible: 'Disponible', s_mission_affectee: 'Mission affectée', s_mission_acceptee: 'Mission acceptée', s_en_route: 'En route vers le patient', s_sur_place: 'Sur place',
      s_patient_pris_en_charge: 'Patient pris en charge', s_en_transport: 'En transport', s_arrive_destination: 'Arrivé à destination', s_patient_receptionne: 'Patient réceptionné',
      s_remise_en_service: 'En remise en service', s_hors_service: 'Hors service', s_en_attente: 'En attente de mission',
      c_immobilisation: 'Immobilisation', c_retard: 'Retard', c_vigilance: 'Vigilance', c_escalade: 'Escalade', c_perte_connexion: 'Perte de connexion', c_position_obsolete: 'Position obsolète',
      chrono_flotte: 'Chrono de la flotte', tri_priorite: 'Situations prioritaires d’abord', tri_numero: 'Par numéro', vue_tableau: 'Vue tableau', vue_cartes: 'Vue cartes',
      immobilisations: 'Immobilisations', aucune: 'Aucune.', a_intervenir: 'Missions nécessitant une intervention', carte: 'Carte opérationnelle', dispos: 'Disponibilités hospitalières',
      og: 'Recommandations OG', sync: 'synchronisé {h}', jamais: 'jamais synchronisé', position: 'position {h}', sans_position: 'position non partagée', fiche: 'Fiche',
      mission: 'Mission', origine: 'Origine', destination: 'Destination', depuis_statut: 'depuis le début du statut', rechercher: 'Rechercher (véhicule, entreprise, mission)', tous_statuts: 'Tous les statuts',
      page: 'Page {p} / {n}', prec: 'Précédente', suiv: 'Suivante', fermer: 'Fermer', chronologie: 'Chronologie de la mission', phases: 'Temps de la mission', messages: 'Communication',
      envoyer: 'Envoyer', texte: 'Message court (sans donnée clinique)', lu: 'lu {h}', non_lu: 'non lu', marquer_lu: 'Confirmer la lecture', plans: 'Destinations compatibles proposées par OG',
      choisir_plan: 'Transmettre cette destination', instructions: 'Instructions opérationnelles', transmettre: 'Transmettre', transmis: 'Transmis à l’équipage : confirmation attendue.',
      envoyee: 'Envoyée {h}', recue: 'reçue {h}', consultee: 'consultée {h}', non_recue: 'non reçue', p_acceptation: 'Depuis l’acceptation', p_deplacement: 'Déplacement vers le patient', p_sur_place: 'Sur place',
      p_transport: 'Transport avec le patient', p_attente_destination: 'Attente à destination', p_remise_en_service: 'Remise en disponibilité', en_cours: 'en cours',
      seuils: 'Seuils indicatifs : vigilance {v} min, escalade {e} min (réglés dans SH). Jamais une réorientation automatique.',
      h_titre: 'Historique', h_type: 'Type', h_tous: 'Tous', h_mission: 'Mission CCS', h_prealerte: 'Préalerte', h_transport: 'Transport', h_jours: 'Période', h_j: '{n} jours', h_rech: 'Numéro',
      h_numero: 'Numéro', h_unite: 'Véhicule', h_statut: 'Statut', h_debut: 'Début', h_fin: 'Fin', h_duree: 'Durée', h_aucun: 'Aucun passage terminé sur cette période.',
      syn_titre: 'Synthèse des missions terminées', syn_n: 'Missions terminées', syn_moy: 'Durée moyenne', syn_med: 'Durée médiane', syn_der: 'Dernier passage', syn_voir: 'Voir l’historique complet',
      pil_titre: 'Pilotage', pil_note: 'Indicateurs d’organisation, jamais un mécanisme automatique de sanction du personnel.', pil_par_jour: 'Missions terminées par jour', pil_type: 'Par type de mission', pil_etab: 'Par établissement',
      al_titre: 'Alertes de la flotte', al_aucune: 'Aucune alerte de flotte.', ouvrir: 'Ouvrir la fiche',
      eq_titre: 'Équipes et véhicules', eq_note: 'Les comptes des équipes sont gérés par l’administration de l’organisation.', adm_titre: 'Administration', adm_modules: 'Modules actifs (réglés dans SH)', adm_org: 'Organisation',
      e_mission: 'Mission actuelle', e_aucune: 'Aucune mission en cours.', e_prochaine: 'Prochaine action', e_accepter: 'Accepter la mission', e_sur_place: 'Arrivés sur place', e_terminer: 'Terminer sans transport',
      e_ouvrir: 'Ouvrir la mission', e_conduite: 'Manipulations à l’arrêt ou par le membre de l’équipe qui ne conduit pas.', e_ccs: 'Instructions du CCS', e_appeler: 'Appeler le CCS',
      e_retard: 'Signaler un retard', e_incident: 'Signaler un incident', e_assistance: 'Demander de l’assistance', e_progression: 'Progression', e_preparation: 'Préparation à destination',
      e_carte: 'Carte et itinéraire', e_carte_indispo: 'Position ou calcul d’itinéraire indisponible : aucune estimation n’est inventée.', e_nav: 'Navigation externe', simule: 'donnée simulée (démonstration)',
      r_bien_recu: 'Bien reçu', r_en_route: 'En route', r_retard_trafic: 'Retard (circulation)', r_attente_civiere: 'Attente de civière', r_besoin_assistance: 'Besoin d’assistance', r_incident_vehicule: 'Incident véhicule',
      r_disponible: 'De nouveau disponible', r_appelez_ccs: 'Appelez le CCS', r_nouvelle_destination: 'Nouvelle destination transmise', r_attendre_instructions: 'Attendez les instructions', r_retour_base: 'Retour à la base', r_priorite_modifiee: 'Priorité modifiée', r_accueil_pret: 'Accueil prêt', r_resident_pret: 'Résident prêt', r_preparation_en_cours: 'Préparation en cours', r_retard_preparation: 'Préparation retardée', r_appelez_nous: 'Appelez-nous',
      g_message: 'Message', g_instruction: 'Instruction', g_destination: 'Destination', g_retard: 'Retard', g_incident: 'Incident', g_assistance: 'Assistance', g_reception: 'Réception', g_remise_dispo: 'Remise en disponibilité', g_etape: 'Étape',
      ccs: 'CCS', equipage: 'Équipage', envoye: 'Envoyé.',
      og_titre: 'OG · copilote du CCS', og_maj: 'Recommandations actualisées par OG.', og_reco: 'Recommandations par mission', og_aucune_reco: 'Aucune mission en attente de destination.',
      og_dispo: 'Nouvelles disponibilités', og_prev: 'Disponibilités prévisionnelles', og_prio: 'Situations prioritaires', og_details: 'Détails', og_pos_inconnue: 'position du véhicule inconnue : temps de trajet non calculé',
      og_maint: 'maintenant', og_conf: 'confirmée à venir', og_prevu: 'prévisionnelle', og_inconnue: 'inconnue', og_civ: '{n} civ.', og_min: '{n} min', og_km: '{n} km', og_dispo_vers: 'vers {h}',
      og_frais: 'déclaré {h}', og_perime: 'donnée périmée', m_capacite_et_trajet: 'capacité confirmée et trajet le plus court', m_capacite_trajet_inconnu: 'capacité confirmée, trajet inconnu',
      m_prochaine_liberation: 'prochaine libération prévue', m_capacite_inconnue: 'capacité inconnue', r_saturation: 'saturation', r_delestage: 'délestage', r_capacite_limitee: 'capacité limitée',
      og_regle: 'OG recommande ; le CCS décide. Une prévision n’est ni une réservation ni une acceptation.',
    },
    en: {
      o_accueil: 'Home', o_flotte: 'Fleet', o_bourse: 'Placement exchange', o_alertes: 'Alerts', o_pilotage: 'Steering', o_equipes: 'Crews', o_administration: 'Administration',
      k_dispo: 'Ambulances available', k_mission: 'Ambulances on a mission', k_immo: 'Ambulances held up', k_attente: 'Missions waiting', k_capacites: 'Free stretchers (EDs)', k_alertes: 'Priority alerts',
      total: '{n} vehicles supervised', s_disponible: 'Available', s_mission_affectee: 'Mission assigned', s_mission_acceptee: 'Mission accepted', s_en_route: 'En route to patient', s_sur_place: 'On site',
      s_patient_pris_en_charge: 'Patient picked up', s_en_transport: 'Transporting', s_arrive_destination: 'Arrived at destination', s_patient_receptionne: 'Patient handed over',
      s_remise_en_service: 'Returning to service', s_hors_service: 'Out of service', s_en_attente: 'Waiting for a mission',
      c_immobilisation: 'Held up', c_retard: 'Delay', c_vigilance: 'Watch', c_escalade: 'Escalation', c_perte_connexion: 'Connection lost', c_position_obsolete: 'Outdated position',
      chrono_flotte: 'Fleet Chrono', tri_priorite: 'Priority situations first', tri_numero: 'By number', vue_tableau: 'Table view', vue_cartes: 'Card view',
      immobilisations: 'Hold-ups', aucune: 'None.', a_intervenir: 'Missions needing action', carte: 'Operational map', dispos: 'Hospital availability',
      og: 'OG recommendations', sync: 'synchronised {h}', jamais: 'never synchronised', position: 'position {h}', sans_position: 'position not shared', fiche: 'Record',
      mission: 'Mission', origine: 'Origin', destination: 'Destination', depuis_statut: 'since the status began', rechercher: 'Search (vehicle, company, mission)', tous_statuts: 'All statuses',
      page: 'Page {p} / {n}', prec: 'Previous', suiv: 'Next', fermer: 'Close', chronologie: 'Mission timeline', phases: 'Mission times', messages: 'Communication',
      envoyer: 'Send', texte: 'Short message (no clinical data)', lu: 'read {h}', non_lu: 'unread', marquer_lu: 'Confirm reading', plans: 'Compatible destinations proposed by OG',
      choisir_plan: 'Send this destination', instructions: 'Operational instructions', transmettre: 'Send', transmis: 'Sent to the crew: confirmation expected.',
      envoyee: 'Sent {h}', recue: 'received {h}', consultee: 'viewed {h}', non_recue: 'not received', p_acceptation: 'Since acceptance', p_deplacement: 'Travel to patient', p_sur_place: 'On site',
      p_transport: 'Transport with patient', p_attente_destination: 'Waiting at destination', p_remise_en_service: 'Return to availability', en_cours: 'ongoing',
      seuils: 'Indicative thresholds: watch {v} min, escalation {e} min (set in SH). Never an automatic redirection.',
      h_titre: 'History', h_type: 'Type', h_tous: 'All', h_mission: 'CCS mission', h_prealerte: 'Pre-alert', h_transport: 'Transport', h_jours: 'Period', h_j: '{n} days', h_rech: 'Number',
      h_numero: 'Number', h_unite: 'Vehicle', h_statut: 'Status', h_debut: 'Start', h_fin: 'End', h_duree: 'Duration', h_aucun: 'No completed run in this period.',
      syn_titre: 'Completed missions summary', syn_n: 'Completed missions', syn_moy: 'Average duration', syn_med: 'Median duration', syn_der: 'Last run', syn_voir: 'See the full history',
      pil_titre: 'Steering', pil_note: 'Organisational indicators, never an automatic staff penalty mechanism.', pil_par_jour: 'Completed missions per day', pil_type: 'By mission type', pil_etab: 'By facility',
      al_titre: 'Fleet alerts', al_aucune: 'No fleet alert.', ouvrir: 'Open the record',
      eq_titre: 'Crews and vehicles', eq_note: 'Crew accounts are managed by the organisation’s administration.', adm_titre: 'Administration', adm_modules: 'Active modules (set in SH)', adm_org: 'Organisation',
      e_mission: 'Current mission', e_aucune: 'No mission in progress.', e_prochaine: 'Next action', e_accepter: 'Accept the mission', e_sur_place: 'Arrived on site', e_terminer: 'Finish without transport',
      e_ouvrir: 'Open the mission', e_conduite: 'Use when stopped, or by the crew member who is not driving.', e_ccs: 'CCS instructions', e_appeler: 'Call the CCS',
      e_retard: 'Report a delay', e_incident: 'Report an incident', e_assistance: 'Request assistance', e_progression: 'Progress', e_preparation: 'Preparation at destination',
      e_carte: 'Map and route', e_carte_indispo: 'Position or route calculation unavailable: no estimate is invented.', e_nav: 'External navigation', simule: 'simulated data (demo)',
      r_bien_recu: 'Received', r_en_route: 'On the way', r_retard_trafic: 'Delayed (traffic)', r_attente_civiere: 'Waiting for a stretcher', r_besoin_assistance: 'Need assistance', r_incident_vehicule: 'Vehicle incident',
      r_disponible: 'Available again', r_appelez_ccs: 'Call the CCS', r_nouvelle_destination: 'New destination sent', r_attendre_instructions: 'Wait for instructions', r_retour_base: 'Return to base', r_priorite_modifiee: 'Priority changed', r_accueil_pret: 'Reception ready', r_resident_pret: 'Resident ready', r_preparation_en_cours: 'Preparation under way', r_retard_preparation: 'Preparation delayed', r_appelez_nous: 'Call us',
      g_message: 'Message', g_instruction: 'Instruction', g_destination: 'Destination', g_retard: 'Delay', g_incident: 'Incident', g_assistance: 'Assistance', g_reception: 'Reception', g_remise_dispo: 'Back in service', g_etape: 'Step',
      ccs: 'CCS', equipage: 'Crew', envoye: 'Sent.',
      og_titre: 'OG · CCS copilot', og_maj: 'Recommendations updated by OG.', og_reco: 'Recommendations per mission', og_aucune_reco: 'No mission waiting for a destination.',
      og_dispo: 'New availability', og_prev: 'Expected availability', og_prio: 'Priority situations', og_details: 'Details', og_pos_inconnue: 'vehicle position unknown: travel time not calculated',
      og_maint: 'now', og_conf: 'confirmed upcoming', og_prevu: 'forecast', og_inconnue: 'unknown', og_civ: '{n} str.', og_min: '{n} min', og_km: '{n} km', og_dispo_vers: 'around {h}',
      og_frais: 'declared {h}', og_perime: 'outdated data', m_capacite_et_trajet: 'confirmed capacity and shortest trip', m_capacite_trajet_inconnu: 'confirmed capacity, trip unknown',
      m_prochaine_liberation: 'next expected release', m_capacite_inconnue: 'capacity unknown', r_saturation: 'saturation', r_delestage: 'diversion', r_capacite_limitee: 'limited capacity',
      og_regle: 'OG recommends; the CCS decides. A forecast is neither a reservation nor an acceptance.',
    },
  };
  const L = () => ((document.documentElement.lang || 'fr').startsWith('en') ? 'en' : 'fr');
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = (k, v = {}) => esc(String(TX[L()][k] ?? TX.fr[k] ?? k).replace(/\{(\w+)\}/g, (m, x) => (v[x] ?? '')));
  const hh = (iso) => (iso ? new Date(iso).toLocaleTimeString(L() === 'en' ? 'en-CA' : 'fr-CA', { hour: '2-digit', minute: '2-digit' }) : '—');
  const jh = (iso) => (iso ? new Date(iso).toLocaleString(L() === 'en' ? 'en-CA' : 'fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const duree = (min) => (min == null ? '—' : window.ArrimoDuree ? window.ArrimoDuree.hhmmss(min * 60000) : `${min} min`);
  const C = { api: null, etat: null, rendre: null, flotte: null, hist: null, histQ: { page: 1, jours: 30, type: '', q: '' }, fiche: null, ficheId: null, plans: null, tri: 'priorite', vue: 'cartes', q: '', statut: '', page: 1, alertes: null };
  const profil = (role) => ({ repartiteur: 'ccs', superviseur_secours: 'ambulance', paramedic: 'embarque' }[role] || null);
  const ONGLETS = { ccs: ['accueil', 'missions', 'flotte', 'bourse', 'chrono', 'alertes', 'pilotage', 'historique', 'administration', 'og'],
    ambulance: ['accueil', 'missions', 'flotte', 'equipes', 'chrono', 'alertes', 'pilotage', 'historique', 'administration', 'og'],
    embarque: ['accueil', 'mission', 'chrono', 'historique', 'og'] };
  /** Onglets du profil, filtrés par les modules activés dans SH pour les organisations de l'utilisateur (OG reste l'assistant commun). */
  function onglets(moi) {
    const p = profil(moi?.utilisateur?.role); if (!p) return null;
    const actifs = window.ArrimoRegistre?.modulesSecours?.(p, moi.organisations) || ONGLETS[p];
    return ONGLETS[p].filter((o) => o === 'og' || actifs.includes(o) || (p === 'embarque' && o === 'mission' && actifs.includes('mission')));
  }

  async function charger(api, etat, rendre, uniteCourante) {
    C.api = api; C.etat = etat; C.rendre = rendre;
    if (!profil(etat.moi?.utilisateur?.role)) return;
    C.flotte = await api('GET', '/secours/flotte?tri=priorite').catch(() => C.flotte);
    if (profil(etat.moi.utilisateur.role) === 'ccs') {
      const og = await api('GET', '/secours/og-ccs').catch(() => null);
      if (og) { if (C.og && C.og.signature !== og.signature) { etat.message = TX[L()].og_maj; window.ArrimoSon?.jouer?.('notification'); } C.og = og; }
    }
    if (['alertes', 'accueil'].includes(etat.onglet)) C.alertes = await api('GET', '/secours/flotte/alertes').catch(() => C.alertes);
    if (['historique', 'pilotage', 'chrono'].includes(etat.onglet) || !C.hist) await chargerHist();
    if (C.ficheId) await chargerFiche(C.ficheId);
    // Transmission : une mission proposée à cette unité est marquée « reçue » par l'appareil (jamais déduite de l'envoi)
    // Embarqué : fiche (messages, instructions) du véhicule de l'équipe, relue à chaque signal en direct
    if (profil(etat.moi.utilisateur.role) === 'embarque') { const u = uniteCourante?.(); C.ficheEmb = u ? await api('GET', `/secours/flotte/${u.id}`).catch(() => C.ficheEmb) : null; }
    if (profil(etat.moi.utilisateur.role) === 'embarque') {
      for (const v of C.flotte?.vehicules || []) {
        const m = v.mission; if (m?.type === 'mission' && m.statut === 'proposee' && !m.transmission?.recue_le) api('POST', `/secours/missions/${m.id}/recue`, {}).catch(() => {});
      }
    }
  }
  async function chargerHist() {
    const q = new URLSearchParams({ page: C.histQ.page, jours: C.histQ.jours, ...(C.histQ.type ? { type: C.histQ.type } : {}), ...(C.histQ.q ? { q: C.histQ.q } : {}), ...(C.histQ.unite ? { unite_id: C.histQ.unite } : {}) });
    C.hist = await C.api('GET', `/secours/flotte/historique?${q}`).catch(() => C.hist);
  }
  async function chargerFiche(id) {
    C.fiche = await C.api('GET', `/secours/flotte/${id}`).catch(() => null);
    if (C.fiche && profil(C.etat.moi.utilisateur.role) === 'ccs' && !C.plans) C.plans = await C.api('GET', `/secours/flotte/${id}/plans`).catch(() => null);
  }

  /* ---------------- éléments communs ---------------- */
  const statutLib = (v) => (v.statut === 'disponible' && !v.mission ? T('s_disponible') : T(`s_${v.statut}`));
  const conditions = (v) => v.conditions.filter((c) => !['vigilance', 'escalade'].includes(c)).map((c) => `<span class="puce cond-${c}">${T(`c_${c}`)}</span>`).join(' ');
  function anneau(v, petit = true) {
    return `<div class="anneau-grand${petit ? ' petit' : ''} niveau-${esc(v.niveau)}"${v.depuis ? ` data-depuis="${esc(v.depuis)}"` : ''}>
      <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="ag-fond" cx="60" cy="60" r="50"/><circle class="ag-arc" cx="60" cy="60" r="50" pathLength="100" stroke-dasharray="${v.niveau === 'rouge' ? 100 : v.niveau === 'orange' ? 66 : 33} 100"/></svg>
      <div class="ag-centre"><span class="ag-val num">--:--:--</span><span class="ag-lib">${T('depuis_statut')}</span></div></div>`;
  }
  function carteVehicule(v) {
    const m = v.mission;
    return `<article class="carte-flotte niveau-${esc(v.niveau)}" data-fiche-v="${v.id}" tabindex="0" role="button" aria-label="${esc(v.numero)} · ${statutLib(v)}">
      <header><b class="num">${esc(v.numero)}</b><span class="note">${esc(v.organisation)}</span></header>
      <div class="cf-corps">${anneau(v)}<div><p><b>${statutLib(v)}</b></p>${m ? `<p class="note">${T('mission')} <span class="num">${esc(m.numero)}</span></p><p class="note">${esc(m.origine || '—')} → ${esc(m.destination || '—')}</p>` : ''}
        <p class="note">${v.derniere_sync ? T('sync', { h: hh(v.derniere_sync) }) : T('jamais')}</p>${conditions(v)}${v.messages_non_lus ? ` <span class="pastille-n">${v.messages_non_lus}</span>` : ''}</div></div></article>`;
  }
  function filtres(vs) {
    let l = vs; if (C.statut) l = l.filter((v) => v.statut === C.statut || v.conditions.includes(C.statut));
    if (C.q) { const q = C.q.toLowerCase(); l = l.filter((v) => [v.numero, v.organisation, v.mission?.numero].some((x) => String(x || '').toLowerCase().includes(q))); }
    if (C.tri === 'numero') l = [...l].sort((a, b) => String(a.numero).localeCompare(String(b.numero), undefined, { numeric: true }));
    return l;
  }
  function barreFlotte(f) {
    return `<div class="ligne barre-flotte"><input type="search" id="fl-q" value="${esc(C.q)}" placeholder="${T('rechercher')}" aria-label="${T('rechercher')}">
      <select id="fl-statut" aria-label="${T('tous_statuts')}"><option value="">${T('tous_statuts')}</option>${[...f.statuts, 'immobilisation', 'perte_connexion', 'position_obsolete'].map((s) => `<option value="${s}"${C.statut === s ? ' selected' : ''}>${f.statuts.includes(s) ? T(`s_${s}`) : T(`c_${s}`)}</option>`).join('')}</select>
      <button type="button" class="btn" data-fl-tri>${C.tri === 'priorite' ? T('tri_numero') : T('tri_priorite')}</button>
      <button type="button" class="btn" data-fl-vue>${C.vue === 'cartes' ? T('vue_tableau') : T('vue_cartes')}</button><b class="num">${T('total', { n: f.total })}</b></div>`;
  }
  function grilleFlotte(f, limite) {
    const l = filtres(f.vehicules); const taille = 48; const pages = Math.max(1, Math.ceil(l.length / taille)); C.page = Math.min(C.page, pages);
    const vus = limite ? l.slice(0, limite) : l.slice((C.page - 1) * taille, C.page * taille);
    const corps = C.vue === 'tableau' && !limite
      ? `<div class="tableau"><table><thead><tr><th>${T('h_unite')}</th><th>${T('h_statut')}</th><th>${T('depuis_statut')}</th><th>${T('mission')}</th><th>${T('origine')} → ${T('destination')}</th><th>${T('sync', { h: '' })}</th><th></th></tr></thead><tbody>
        ${vus.map((v) => `<tr class="niveau-${esc(v.niveau)}"><th scope="row" class="num">${esc(v.numero)}<div class="note">${esc(v.organisation)}</div></th><td>${statutLib(v)} ${conditions(v)}</td>
          <td>${v.depuis ? `<b class="num duree-seule" data-depuis="${esc(v.depuis)}">--:--:--</b>` : '—'}</td><td class="num">${esc(v.mission?.numero || '—')}</td>
          <td>${esc(v.mission?.origine || '—')} → ${esc(v.mission?.destination || '—')}</td><td class="note">${v.derniere_sync ? esc(hh(v.derniere_sync)) : T('jamais')}</td>
          <td><button type="button" class="btn" data-fiche-v="${v.id}">${T('fiche')}</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="grille-flotte">${vus.map(carteVehicule).join('')}</div>`;
    const pagin = limite ? (l.length > limite ? `<p><button type="button" class="lien" data-onglet="flotte">${T('total', { n: f.total })} · ${T('vue_tableau')}</button></p>` : '')
      : pages > 1 ? `<div class="ligne"><button type="button" class="btn" data-fl-page="${C.page - 1}"${C.page <= 1 ? ' disabled' : ''}>${T('prec')}</button><span>${T('page', { p: C.page, n: pages })}</span><button type="button" class="btn" data-fl-page="${C.page + 1}"${C.page >= pages ? ' disabled' : ''}>${T('suiv')}</button></div>` : '';
    return `${corps}${pagin}`;
  }

  /* ---------------- OG proactif : carte permanente et compacte ---------------- */
  function carteOgCcs() {
    const o = C.og; if (!o) return '';
    const val = (n, k) => (n == null ? `<span class="note">${T('og_inconnue')}</span>` : T(k, { n }));
    const plan = (p) => `<li><b>${esc(p.plan)}</b> · ${esc(p.etablissement)} · ${p.disponible_maintenant != null ? T('og_civ', { n: p.disponible_maintenant }) : T('og_inconnue')}
      · ${p.temps_min != null ? T('og_min', { n: p.temps_min }) : p.distance_km != null ? T('og_km', { n: p.distance_km }) : T('og_inconnue')}
      ${p.heure_estimee_disponibilite && !p.disponible_maintenant ? ` · ${T('og_dispo_vers', { h: hh(p.heure_estimee_disponibilite) })}` : ''}
      ${p.restrictions.length ? ` · <span class="puce cond-retard">${p.restrictions.map((r) => T(`r_${r}`) === `r_${r}` ? esc(r) : T(`r_${r}`)).join(', ')}</span>` : ''}
      <div class="note">${T(`m_${p.motif}`)} · ${p.fraicheur.declare_le ? T('og_frais', { h: hh(p.fraicheur.declare_le) }) : p.fraicheur.perime ? T('og_perime') : ''}</div></li>`;
    const nouvelles = o.disponibilites.filter((d) => d.maintenant > 0);
    const prev = o.disponibilites.filter((d) => d.horizons && o.horizons.some((h) => d.horizons[h].confirmee_a_venir || d.horizons[h].previsionnelle)).slice(0, 5);
    return `<section class="carte-s carte-og-ccs"><h2>${T('og_titre')}</h2><p class="note">${T('og_regle')}</p>
      <h3>${T('og_reco')}</h3>${o.recommandations.map((r) => `<div class="og-mission"><p><button type="button" class="lien" data-fiche-v="${r.unite_id}"><b class="num">${esc(r.unite)}</b></button> · <span class="num">${esc(r.mission)}</span>${r.destination_actuelle ? ` → ${esc(r.destination_actuelle)}` : ''}</p>
        ${r.position_connue ? '' : `<p class="note">${T('og_pos_inconnue')}</p>`}<ol class="og-plans">${r.plans.map(plan).join('')}</ol></div>`).join('') || `<p class="note">${T('og_aucune_reco')}</p>`}
      <details><summary>${T('og_details')}</summary>
        <h3>${T('og_dispo')}</h3><p>${nouvelles.map((d) => `${esc(d.etablissement)} · ${T('og_civ', { n: d.maintenant })}`).join(' · ') || `<span class="note">${T('aucune')}</span>`}</p>
        <h3>${T('og_prev')}</h3>${prev.length ? `<div class="tableau"><table><thead><tr><th></th>${o.horizons.map((h) => `<th class="num">+${h} min</th>`).join('')}</tr></thead><tbody>
          ${prev.map((d) => `<tr><th scope="row">${esc(d.etablissement)}</th>${o.horizons.map((h) => `<td class="num" title="${T('og_conf')} / ${T('og_prevu')}">${d.horizons[h].confirmee_a_venir} / ${d.horizons[h].previsionnelle}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
          <p class="note">${T('og_conf')} / ${T('og_prevu')}</p>` : `<p class="note">${T('aucune')}</p>`}
        <h3>${T('og_prio')}</h3><p>${o.prioritaires.map((p) => `<button type="button" class="lien" data-fiche-v="${p.unite_id}">${esc(p.unite)}</button>`).join(' · ') || `<span class="note">${T('aucune')}</span>`}</p></details></section>`;
  }

  /* ---------------- CCS et gestionnaire : accueil territorial ---------------- */
  function accueilSupervision(ctx) {
    const f = C.flotte; if (!f) return `<section class="carte-s"><p class="note">…</p></section>`;
    const c = f.compteurs; const enMission = f.total - c.disponible - c.hors_service - c.remise_en_service;
    const civ = (ctx.classees?.urgences || []).reduce((s, h) => s + (h.urgence?.civieres_libres || 0), 0);
    const prioritaires = f.vehicules.filter((v) => v.niveau === 'rouge').length;
    const kpi = (lib, n, onglet, alerte) => `<button type="button" class="tuile-c ds-kpi${alerte && n ? ' alerte' : ''}" data-onglet="${onglet}"><b class="gros num">${n}</b><span class="ds-kpi-lib">${lib}</span></button>`;
    const immo = f.vehicules.filter((v) => v.conditions.includes('immobilisation'));
    const aIntervenir = f.vehicules.filter((v) => v.mission?.type === 'mission' && (v.mission.statut === 'proposee' && !v.mission.transmission?.recue_le || v.conditions.includes('perte_connexion')));
    const comptes = Object.entries(c).filter(([, n]) => n).map(([k, n]) => `<span class="puce">${T(`s_${k}`)} <b class="num">${n}</b></span>`).join(' ')
      + Object.entries(f.conditions).filter(([k, n]) => n && !['vigilance', 'escalade'].includes(k)).map(([k, n]) => ` <span class="puce cond-${k}">${T(`c_${k}`)} <b class="num">${n}</b></span>`).join('');
    return `<div class="tuiles-chrono tuiles-ccs">${kpi(T('k_dispo'), c.disponible, 'flotte')}${kpi(T('k_mission'), enMission, 'flotte')}${kpi(T('k_immo'), immo.length, 'alertes', true)}
        ${kpi(T('k_attente'), f.missions_en_attente, 'missions', true)}${kpi(T('k_capacites'), civ, 'bourse')}${kpi(T('k_alertes'), prioritaires, 'alertes', true)}</div>
      <p class="note">${T('total', { n: f.total })} · ${comptes} <span class="aide-i" title="${T('seuils', { v: f.seuils.vigilance_min, e: f.seuils.escalade_min })}" aria-label="${T('seuils', { v: f.seuils.vigilance_min, e: f.seuils.escalade_min })}">?</span></p>
      <div class="deux-colonnes-ccs"><div class="col">
          <section class="carte-s"><h2>${T('chrono_flotte')}</h2>${barreFlotte(f)}${grilleFlotte(f, 24)}</section>
          <section class="carte-s"><h2>${T('immobilisations')} <span class="num">${immo.length}</span></h2>${immo.map((v) => `<p><button type="button" class="lien" data-fiche-v="${v.id}"><b class="num">${esc(v.numero)}</b></button> · ${esc(v.mission?.destination || '—')} · <b class="num duree-seule" data-depuis="${esc(v.depuis)}">--:--:--</b> · ${T(`c_${v.niveau === 'rouge' ? 'escalade' : 'vigilance'}`)}</p>`).join('') || `<p class="note">${T('aucune')}</p>`}</section>
          <section class="carte-s"><h2>${T('a_intervenir')}</h2>${aIntervenir.map((v) => `<p><button type="button" class="lien" data-fiche-v="${v.id}"><b class="num">${esc(v.numero)}</b></button> · <span class="num">${esc(v.mission.numero)}</span> · ${v.mission.transmission?.recue_le ? T('recue', { h: hh(v.mission.transmission.recue_le) }) : T('non_recue')} ${conditions(v)}</p>`).join('') || `<p class="note">${T('aucune')}</p>`}</section>
        </div><div class="col">
          ${carteOgCcs()}
          <section class="carte-s"><h2>${T('carte')}</h2><div id="carte-region" style="height:min(52vh,380px)"></div>${ctx.demo ? `<p class="note">${T('simule')}</p>` : ''}</section>
          <section class="carte-s"><h2>${T('dispos')}</h2>${ctx.tableauClasse ? ctx.tableauClasse() : ''}</section>
        </div></div>${panneauFiche()}`;
  }
  function vueFlotte() { const f = C.flotte; if (!f) return ''; return `<section class="carte-s"><h2>${T('o_flotte')}</h2>${barreFlotte(f)}${grilleFlotte(f, 0)}</section>${panneauFiche()}`; }
  function vueAlertes() {
    const a = C.alertes || (C.flotte?.vehicules || []).filter((v) => v.niveau !== 'vert' || v.conditions.includes('perte_connexion')).map((v) => ({ unite_id: v.id, unite: v.numero, niveau: v.niveau, conditions: v.conditions, depuis: v.depuis, mission: v.mission?.numero, destination: v.mission?.destination }));
    return `<section class="carte-s"><h2>${T('al_titre')} <span class="num">${a.length}</span></h2>${C.flotte ? `<p class="note">${T('seuils', { v: C.flotte.seuils.vigilance_min, e: C.flotte.seuils.escalade_min })}</p>` : ''}
      ${a.map((x) => `<article class="carte-alerte niveau-${esc(x.niveau)}"><header><h4 class="num">${esc(x.unite)}</h4><span>${x.conditions.map((c) => T(`c_${c}`)).join(' · ')}</span></header>
        <p>${x.depuis ? `<b class="num duree-seule" data-depuis="${esc(x.depuis)}">--:--:--</b> · ` : ''}${esc(x.mission || '—')} · ${esc(x.destination || '—')}</p>
        <p><button type="button" class="btn pri" data-fiche-v="${x.unite_id}">${T('ouvrir')}</button></p></article>`).join('') || `<p class="note">${T('al_aucune')}</p>`}</section>${panneauFiche()}`;
  }
  function synthese() {
    const s = C.hist?.synthese; if (!s) return '';
    return `<section class="carte-s"><h2>${T('syn_titre')}</h2><div class="tuiles-chrono">
      <div class="tuile-c ds-kpi"><b class="gros num">${s.terminees}</b><span class="ds-kpi-lib">${T('syn_n')}</span></div>
      <div class="tuile-c ds-kpi"><b class="gros num">${esc(duree(s.moyenne_min))}</b><span class="ds-kpi-lib">${T('syn_moy')}</span></div>
      <div class="tuile-c ds-kpi"><b class="gros num">${esc(duree(s.mediane_min))}</b><span class="ds-kpi-lib">${T('syn_med')}</span></div>
      <div class="tuile-c ds-kpi"><b class="gros num">${s.dernier ? esc(duree(s.dernier.duree_min)) : '—'}</b><span class="ds-kpi-lib">${T('syn_der')}${s.dernier ? ` · <span class="num">${esc(s.dernier.numero)}</span>` : ''}</span></div></div>
      <p><button type="button" class="lien" data-onglet="historique">${T('syn_voir')}</button></p></section>`;
  }
  function vuePilotage() {
    const s = C.hist?.synthese; const max = Math.max(1, ...(s?.par_jour || []).map((x) => x.n));
    const periode = `<div class="ligne" role="group" aria-label="${T('h_jours')}">${[7, 30, 90, 365].map((n) => `<button type="button" class="chip" data-pil-jours="${n}" aria-pressed="${Number(C.histQ.jours) === n}">${T('h_j', { n })}</button>`).join('')}</div>`;
    return `${periode}${synthese()}<section class="carte-s"><h2>${T('pil_par_jour')}</h2><div class="barres-jour">${(s?.par_jour || []).map((x) => `<div title="${esc(x.jour)} : ${x.n}"><span style="height:${Math.round(x.n / max * 100)}%"></span><small class="num">${esc(x.jour.slice(5))}</small></div>`).join('') || `<p class="note">${T('h_aucun')}</p>`}</div>
      <p class="note">${T('pil_note')}</p></section>${tablePil(T('pil_type'), s?.par_type, (k) => T(`h_${k}`))}${tablePil(T('pil_etab'), s?.par_etablissement, esc)}`;
  }
  function tablePil(titre, l, lib) {
    if (!l?.length) return '';
    return `<section class="carte-s"><h2>${titre}</h2><div class="tableau"><table><thead><tr><th></th><th>${T('syn_n')}</th><th>${T('syn_moy')}</th><th>${T('syn_med')}</th></tr></thead><tbody>
      ${l.map((g) => `<tr><th scope="row">${lib(g.cle)}</th><td class="num">${g.nombre}</td><td class="num">${esc(duree(g.moyenne_min))}</td><td class="num">${esc(duree(g.mediane_min))}</td></tr>`).join('')}</tbody></table></div></section>`;
  }
  function vueHistorique() {
    const h = C.hist; const q = C.histQ;
    return `<section class="carte-s"><h2>${T('h_titre')}</h2><form id="fl-hist" class="ligne" role="search">
        <label>${T('h_type')}<select name="type"><option value="">${T('h_tous')}</option>${['mission', 'prealerte', 'transport'].map((x) => `<option value="${x}"${q.type === x ? ' selected' : ''}>${T(`h_${x}`)}</option>`).join('')}</select></label>
        <label>${T('h_jours')}<select name="jours">${[1, 7, 30, 90, 365].map((n) => `<option value="${n}"${Number(q.jours) === n ? ' selected' : ''}>${T('h_j', { n })}</option>`).join('')}</select></label>
        <label>${T('h_rech')}<input type="search" name="q" value="${esc(q.q)}" maxlength="40"></label><button type="submit" class="btn">${T('envoyer') === 'Send' ? 'Filter' : 'Filtrer'}</button></form>
      ${h?.lignes?.length ? `<div class="tableau"><table><thead><tr><th>${T('h_numero')}</th><th>${T('h_type')}</th><th>${T('h_unite')}</th><th>${T('h_statut')}</th><th>${T('origine')} → ${T('destination')}</th><th>${T('h_debut')}</th><th>${T('h_fin')}</th><th>${T('h_duree')}</th></tr></thead><tbody>
        ${h.lignes.map((x) => `<tr><th scope="row" class="num">${esc(x.numero)} ${x.type !== 'mission' ? window.ArrimoSillage?.bouton(x.type === 'transport' ? 'demande_transport' : 'prealerte', x.id) || '' : ''}</th><td>${T(`h_${x.type}`)}</td><td class="num">${esc(x.unite)}</td><td>${esc(x.statut)}</td>
          <td>${esc(x.origine || '—')} → ${esc(x.destination || '—')}</td><td class="num">${esc(jh(x.debut))}</td><td class="num">${esc(jh(x.fin))}</td><td class="num">${esc(duree(Math.round((new Date(x.fin) - new Date(x.debut)) / 60000)))}</td></tr>`).join('')}</tbody></table></div>
        <div class="ligne"><button type="button" class="btn" data-h-page="${h.page - 1}"${h.page <= 1 ? ' disabled' : ''}>${T('prec')}</button><span>${T('page', { p: h.page, n: h.pages })} · ${h.total}</span><button type="button" class="btn" data-h-page="${h.page + 1}"${h.page >= h.pages ? ' disabled' : ''}>${T('suiv')}</button></div>`
        : `<p class="note">${T('h_aucun')}</p>`}</section>`;
  }
  function vueEquipes() {
    const f = C.flotte; return `<section class="carte-s"><h2>${T('eq_titre')}</h2><p class="note">${T('eq_note')}</p>${f ? `<div class="tableau"><table><thead><tr><th>${T('h_unite')}</th><th>${T('adm_org')}</th><th>${T('h_statut')}</th></tr></thead><tbody>
      ${f.vehicules.map((v) => `<tr><th scope="row" class="num">${esc(v.numero)}${v.plaque ? ` <span class="note">${esc(v.plaque)}</span>` : ''}</th><td>${esc(v.organisation)}</td><td>${statutLib(v)}</td></tr>`).join('')}</tbody></table></div>` : ''}</section>`;
  }
  function vueAdministration(moi) {
    const p = profil(moi.utilisateur.role); const actifs = window.ArrimoRegistre?.modulesSecours?.(p, moi.organisations) || [];
    return `<section class="carte-s"><h2>${T('adm_titre')}</h2><p><b>${T('adm_org')}</b> : ${(moi.organisations || []).map((o) => esc(o.nom)).join(', ')}</p>
      <p><b>${T('adm_modules')}</b> : ${actifs.map((m) => T(`o_${m}`) === `o_${m}` ? esc(m) : T(`o_${m}`)).join(' · ')}</p>
      ${C.flotte ? `<p class="note">${T('seuils', { v: C.flotte.seuils.vigilance_min, e: C.flotte.seuils.escalade_min })}</p>` : ''}</section>`;
  }

  /* ---------------- Fiche véhicule : chronologie unique, phases, communication, plans A/B/C, destination ---------------- */
  function fil(messages, uniteId, cote) {
    const rapides = C.flotte?.rapides || [];
    return `<div class="fil-msg">${(messages || []).slice(0, 12).map((m) => `<p class="msg msg-${esc(m.sens)}"><b>${m.sens === 'ccs' ? T('ccs') : m.sens === 'etablissement' ? esc(m.etablissement || '') : T('equipage')}</b> · ${T(`g_${m.genre}`)} · ${m.code_rapide ? T(`r_${m.code_rapide}`) : ''}${m.texte ? ` ${esc(m.texte)}` : ''}
        <span class="note num">${esc(hh(m.cree_le))} · ${m.lu_le ? T('lu', { h: hh(m.lu_le) }) : m.sens !== cote ? `<button type="button" class="lien" data-msg-lu="${m.id}">${T('marquer_lu')}</button>` : T('non_lu')}</span></p>`).join('')}</div>
      <div class="rapides">${rapides.map((r) => `<button type="button" class="btn" data-rapide="${r}" data-unite="${uniteId}">${T(`r_${r}`)}</button>`).join('')}</div>
      <form class="ligne" data-msg-form="${uniteId}"><input name="texte" maxlength="200" placeholder="${T('texte')}" aria-label="${T('texte')}" autocomplete="off"><button class="btn pri" type="submit">${T('envoyer')}</button></form>`;
  }
  function panneauFiche() {
    const d = C.fiche; if (!d || !C.ficheId) return '';
    const v = d.vehicule; const m = v.mission; const ccs = profil(C.etat.moi.utilisateur.role) === 'ccs';
    const tr = m?.transmission;
    return `<section class="carte-s fiche-vehicule" id="fiche-vehicule" aria-label="${T('fiche')} ${esc(v.numero)}"><div class="ligne"><h2>${T('fiche')} · <span class="num">${esc(v.numero)}</span> · ${esc(v.organisation)}</h2><button type="button" class="btn" data-fiche-fermer>${T('fermer')}</button></div>
      <div class="cf-corps">${anneau(v, false)}<div><p><b>${statutLib(v)}</b> ${conditions(v)}</p>${m ? `<p>${T('mission')} <b class="num">${esc(m.numero)}</b> · ${esc(m.origine || '—')} → ${esc(m.destination || '—')}</p>` : ''}
        ${tr ? `<p class="note">${T('envoyee', { h: hh(tr.envoyee_le) })} · ${tr.recue_le ? T('recue', { h: hh(tr.recue_le) }) : T('non_recue')}${tr.consultee_le ? ` · ${T('consultee', { h: hh(tr.consultee_le) })}` : ''}</p>` : ''}
        <p class="note">${v.position ? `${T('position', { h: hh(v.position.le) })}` : T('sans_position')} · ${v.derniere_sync ? T('sync', { h: hh(v.derniere_sync) }) : T('jamais')}</p></div></div>
      <h3>${T('phases')}</h3><ol class="phases-mission">${d.phases.map((p) => `<li><span>${T(`p_${p.phase}`)}</span> <b class="num${p.en_cours ? ' duree-seule' : ''}"${p.en_cours ? ` data-depuis="${esc(p.debut)}"` : ''}>${p.en_cours ? '--:--:--' : esc(duree(Math.round((new Date(p.fin) - new Date(p.debut)) / 60000)))}</b>${p.en_cours ? ` <span class="note">${T('en_cours')}</span>` : ''}</li>`).join('') || `<li class="note">${T('aucune')}</li>`}</ol>
      <h3>${T('messages')}</h3>${fil(d.messages, v.id, ccs ? 'ccs' : 'ambulance')}
      ${ccs && m?.type === 'mission' ? `<h3>${T('plans')}</h3>${(C.plans?.plans || []).map((p) => `<p><b>${esc(p.plan)}</b> · ${esc(p.nom)} · ${p.temps_min != null ? `${p.temps_min} min` : p.distance_km != null ? `${p.distance_km} km` : '—'} · ${p.civieres_libres ?? '—'} <button type="button" class="btn" data-plan-dest="${p.id}" data-mission="${m.id}" data-version="${m.version}">${T('choisir_plan')}</button></p>`).join('') || `<p class="note">${T('aucune')}</p>`}
        <p class="note">${esc(C.plans?.note || '')}</p>
        <form class="ligne" data-instr="${m.id}" data-version="${m.version}"><label>${T('instructions')}<input name="instructions" maxlength="280" value="${esc(m.instructions || '')}"></label><button class="btn pri" type="submit">${T('transmettre')}</button></form>` : ''}
      <h3>${T('chronologie')}</h3><ol class="chronologie-mission">${d.chronologie.slice(-30).map((e) => `<li><span class="num">${esc(hh(e.le))}</span> · ${esc(e.type === 'message' ? `${T(`g_${e.code}`)}${e.rapide ? ` · ${T(`r_${e.rapide}`)}` : ''}` : e.code)}</li>`).join('')}</ol></section>`;
  }

  /* ---------------- Ambulancier embarqué : accueil ---------------- */
  function accueilEmbarque(ctx) {
    const u = ctx.unite; const v = (C.flotte?.vehicules || []).find((x) => x.id === u?.id);
    if (!u) return '';
    const m = v?.mission;
    // Une seule action principale, selon l'étape réelle de la mission CCS ; sinon l'écran Mission porte les actions de la préalerte ou du transport
    const action = m?.type === 'mission' ? { proposee: ['accepter', T('e_accepter')], acceptee: ['sur_place', T('e_sur_place')], sur_place: ['terminer', T('e_terminer')] }[m.statut] : null;
    const prochaine = action ? `<button type="button" class="btn pri btn-geant" data-mi-action="${action[0]}" data-mission="${m.id}" data-version="${m.version}">${action[1]}</button>`
      : m ? `<button type="button" class="btn pri btn-geant" data-onglet="mission">${T('e_ouvrir')}</button>` : '';
    if (m?.type === 'mission' && !m.transmission?.consultee_le) C.api?.('POST', `/secours/missions/${m.id}/consultee`, {}).catch(() => {});
    const instr = (C.ficheEmb?.messages || []).filter((x) => x.sens !== 'ambulance' && !x.lu_le).slice(0, 4);
    return `<section class="carte-s accueil-embarque"><h2>${m ? `${T('e_mission')} · <span class="num">${esc(m.numero)}</span>` : (v && v.statut === 'disponible' ? T('s_disponible') : v ? statutLib(v) : T('s_en_attente'))}</h2>
        ${m ? `<p class="grand-trajet">${esc(m.origine || '—')} → <b>${esc(m.destination || '—')}</b></p>` : `<p class="note">${T('e_aucune')}</p>`}
        ${v ? `<p><b>${statutLib(v)}</b> ${conditions(v)}</p>` : ''}
        ${m?.instructions ? `<p class="instructions-ccs"><b>${T('e_ccs')}</b> : ${esc(m.instructions)}</p>` : ''}
        <div class="e-prochaine"><h3>${T('e_prochaine')}</h3>${prochaine || `<p class="note">${T('e_aucune')}</p>`}</div></section>
      ${ctx.compteur || ''}
      <section class="carte-s"><h2>${T('e_carte')}</h2><div id="carte-amb" style="height:min(48vh,340px)"></div>${v?.position ? `<p class="note">${T('position', { h: hh(v.position.le) })}${ctx.demo ? ` · ${T('simule')}` : ''}</p>` : `<p class="note">${T('e_carte_indispo')}</p>`}
        ${m?.destination && v?.position ? `<p><a class="btn" rel="noopener" target="_blank" href="https://www.openstreetmap.org/directions?from=${v.position.latitude}%2C${v.position.longitude}&to=${encodeURIComponent(m.destination)}">${T('e_nav')}</a></p>` : ''}</section>
      <section class="carte-s"><h2>${T('messages')}</h2><p class="note">${T('e_conduite')}</p>
        ${instr.map((x) => `<p class="instructions-ccs">${x.sens === 'etablissement' ? esc(x.etablissement || '') : T('ccs')} · ${T(`g_${x.genre}`)} · ${x.code_rapide ? T(`r_${x.code_rapide}`) : ''} ${esc(x.texte || '')} <span class="note num">${esc(hh(x.cree_le))}</span>${!x.lu_le ? ` <button type="button" class="btn" data-msg-lu="${x.id}">${T('marquer_lu')}</button>` : ''}</p>`).join('')}
        <div class="rapides grands">${[['retard', 'retard_trafic', T('e_retard')], ['incident', 'incident_vehicule', T('e_incident')], ['assistance', 'besoin_assistance', T('e_assistance')]].map(([g, r, lib]) => `<button type="button" class="btn btn-geant" data-signal="${g}" data-rapide-code="${r}" data-unite="${u.id}">${lib}</button>`).join('')}</div>
        ${v ? fil(C.ficheEmb?.messages, u.id, 'ambulance') : ''}</section>`;
  }

  /** Branchement des gestes (délégation sur le contenu, redessiné à chaque mise à jour). */
  function brancher(racine) {
    racine.querySelectorAll('[data-fiche-v]').forEach((b) => { const ouvrir = async () => { C.ficheId = Number(b.dataset.ficheV); C.plans = null; await chargerFiche(C.ficheId); C.rendre(); document.getElementById('fiche-vehicule')?.scrollIntoView({ block: 'start' }); };
      b.onclick = ouvrir; b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrir(); } }; });
    racine.querySelector('[data-fiche-fermer]')?.addEventListener('click', () => { C.ficheId = null; C.fiche = null; C.rendre(); });
    racine.querySelector('[data-fl-tri]')?.addEventListener('click', () => { C.tri = C.tri === 'priorite' ? 'numero' : 'priorite'; C.rendre(); });
    racine.querySelector('[data-fl-vue]')?.addEventListener('click', () => { C.vue = C.vue === 'cartes' ? 'tableau' : 'cartes'; C.rendre(); });
    const fq = racine.querySelector('#fl-q'); if (fq) fq.onchange = () => { C.q = fq.value; C.page = 1; C.rendre(); };
    const fs = racine.querySelector('#fl-statut'); if (fs) fs.onchange = () => { C.statut = fs.value; C.page = 1; C.rendre(); };
    racine.querySelectorAll('[data-fl-page]').forEach((b) => { b.onclick = () => { C.page = Number(b.dataset.flPage); C.rendre(); }; });
    racine.querySelectorAll('[data-h-page]').forEach((b) => { b.onclick = async () => { C.histQ.page = Number(b.dataset.hPage); await chargerHist(); C.rendre(); }; });
    racine.querySelectorAll('[data-pil-jours]').forEach((b) => { b.onclick = async () => { C.histQ = { ...C.histQ, page: 1, jours: Number(b.dataset.pilJours) }; await chargerHist(); C.rendre(); }; });
    const fh = racine.querySelector('#fl-hist'); if (fh) fh.onsubmit = async (e) => { e.preventDefault(); const d = new FormData(fh); C.histQ = { ...C.histQ, page: 1, type: d.get('type'), jours: d.get('jours'), q: d.get('q') }; await chargerHist(); C.rendre(); };
    const cle = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const poster = async (corps) => { try { await C.api('POST', '/secours/messages', { ...corps, cle: cle() }); if (C.ficheId) await chargerFiche(C.ficheId); C.etat.message = TX[L()].envoye; } catch (e) { C.etat.erreur = e.message; } C.rendre(); };
    racine.querySelectorAll('[data-rapide]').forEach((b) => { b.onclick = () => poster({ unite_id: Number(b.dataset.unite), genre: 'message', code_rapide: b.dataset.rapide }); });
    racine.querySelectorAll('[data-signal]').forEach((b) => { b.onclick = () => poster({ unite_id: Number(b.dataset.unite), genre: b.dataset.signal, code_rapide: b.dataset.rapideCode }); });
    racine.querySelectorAll('[data-msg-form]').forEach((f) => { f.onsubmit = (e) => { e.preventDefault(); const tx = f.texte.value.trim(); if (tx) poster({ unite_id: Number(f.dataset.msgForm), genre: 'message', texte: tx }); }; });
    racine.querySelectorAll('[data-msg-lu]').forEach((b) => { b.onclick = async () => { await C.api('POST', `/secours/messages/${b.dataset.msgLu}/lu`, {}).catch((e) => { C.etat.erreur = e.message; }); if (C.ficheId) await chargerFiche(C.ficheId); C.rendre(); }; });
    racine.querySelectorAll('[data-plan-dest]').forEach((b) => { b.onclick = async () => { try { await C.api('POST', `/secours/missions/${b.dataset.mission}/modifier`, { destination_id: Number(b.dataset.planDest), version: Number(b.dataset.version) }); C.etat.message = TX[L()].transmis; await chargerFiche(C.ficheId); } catch (e) { C.etat.erreur = e.message; } C.rendre(); }; });
    racine.querySelectorAll('[data-instr]').forEach((f) => { f.onsubmit = async (e) => { e.preventDefault(); try { await C.api('POST', `/secours/missions/${f.dataset.instr}/modifier`, { instructions: f.instructions.value, version: Number(f.dataset.version) }); C.etat.message = TX[L()].transmis; await chargerFiche(C.ficheId); } catch (er) { C.etat.erreur = er.message; } C.rendre(); }; });
    racine.querySelectorAll('[data-mi-action]').forEach((b) => { b.onclick = async () => { try { await C.api('POST', `/secours/missions/${b.dataset.mission}/action`, { action: b.dataset.miAction, version: Number(b.dataset.version) }); } catch (e) { C.etat.erreur = e.message; } C.flotte = await C.api('GET', '/secours/flotte?tri=priorite').catch(() => C.flotte); C.rendre(); }; });
  }

  /** Contenu d'un onglet géré ici (null : l'onglet reste celui de secours.js). */
  function section(o, ctx) {
    const p = profil(ctx.moi?.utilisateur?.role); if (!p) return null;
    if (o === 'accueil') return p === 'embarque' ? accueilEmbarque(ctx) : accueilSupervision(ctx);
    if (o === 'flotte' && p !== 'embarque') return vueFlotte();
    if (o === 'alertes') return vueAlertes();
    if (o === 'pilotage') return vuePilotage();
    if (o === 'historique') return `${p !== 'embarque' ? synthese() : ''}${vueHistorique()}`;
    if (o === 'equipes') return vueEquipes();
    if (o === 'administration') return vueAdministration(ctx.moi);
    return null;
  }
  /** Synthèse des passages terminés (remplace la longue liste de Chrono). */
  const syntheseChrono = () => synthese();
  window.ArrimoCentre = { TX, ONGLETS, onglets, profil, charger, section, brancher, syntheseChrono, etat: C };
})();
