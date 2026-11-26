/* Tableau commun des mouvements autorisés. Chaque écran conserve ses actions métier. */
(() => {
  const TXT = {
    fr: { sens: 'Mouvement', ref: 'Référence', type: 'Type', origine: 'Origine', destination: 'Destination', vehicule: 'Véhicule', prevue: 'Heure prévue', eta: 'ETA', statut: 'Statut', suite: 'Action', prep: 'Préparation', prealerte: 'Préalerte', accusee: 'Acquittée', retard: 'En retard', incident: 'Incident', actif: 'Transferts actifs', clos: 'Transferts clos', aucun: 'Aucun transfert.', priorite: 'Priorité', priorites: { immediate: 'Immédiate', urgente: 'Urgente', non_urgente: 'Non urgente' },
      types: { transport: 'Transport', transfert: 'Transfert', hebergement: 'Hébergement', prealerte: 'Préalerte' },
      statuts: { a_valider: 'À valider', demande: 'Demandé', accepte: 'Accepté', en_route_depart: 'En route vers la prise en charge', en_transport: 'En transport', arrive: 'Arrivé', remis: 'Patient remis', termine: 'Terminé', refuse: 'Refusé', annule: 'Annulé', prevu: 'Prévu' } },
    en: { sens: 'Movement', ref: 'Reference', type: 'Type', origine: 'Origin', destination: 'Destination', vehicule: 'Vehicle', prevue: 'Scheduled', eta: 'ETA', statut: 'Status', suite: 'Action', prep: 'Preparation', prealerte: 'Pre-alert', accusee: 'Acknowledged', retard: 'Late', incident: 'Incident', actif: 'Active transfers', clos: 'Closed transfers', aucun: 'No transfers.', priorite: 'Priority', priorites: { immediate: 'Immediate', urgente: 'Urgent', non_urgente: 'Non-urgent' },
      types: { transport: 'Transport', transfert: 'Transfer', hebergement: 'Residential care', prealerte: 'Pre-alert' },
      statuts: { a_valider: 'To validate', demande: 'Requested', accepte: 'Accepted', en_route_depart: 'On the way to pick-up', en_transport: 'In transport', arrive: 'Arrived', remis: 'Patient handed over', termine: 'Complete', refuse: 'Declined', annule: 'Cancelled', prevu: 'Scheduled' } },
  };
  const dico = () => TXT[(document.documentElement.lang || '').startsWith('en') ? 'en' : 'fr'];
  const echapper = (valeur) => String(valeur ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const codes = { demandee: 'demande', acceptee: 'accepte', en_route: 'en_route_depart', pris_en_charge: 'en_transport', arrivee: 'arrive', refusee: 'refuse', annulee: 'annule' };
  function depuisTransport(d) {
    const statut = d.terminee_le ? 'termine' : d.remis_le ? 'remis' : codes[d.statut] || d.statut;
    const prealerte = d.prealerte || (d.prealerte_le ? { recue_le: d.prealerte_recue_le } : null);
    const eta = d.prealerte?.eta_minutes;
    return { id: d.id, reference: d.numero, personne: d.resident_ref, type: 'transport', origine: d.origine,
      destination: d.prealerte?.destination || d.destination, vehicule: d.unite, statut,
      clos: ['refuse', 'annule', 'termine'].includes(statut) || (statut === 'arrive' && !d.motif_transport),
      prevue: d.plage_confirmee_debut || d.plage_debut || d.heure_souhaitee,
      eta_min: eta, prealerte, priorite: d.prealerte?.priorite,
      retard: ['demande', 'accepte'].includes(statut) && new Date(d.plage_confirmee_fin || d.plage_fin || Infinity).getTime() < Date.now(),
      incident: d.incident_le && !d.terminee_le };
  }
  function rendre(lignes, { actions, heure, cellules = {}, sections = false, seulement = null } = {}) {
    const x = dico();
    const texte = (v) => echapper(v ?? '—');
    const h = heure || ((d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    const col = [...(cellules.sens ? ['sens'] : []), 'ref', 'type', 'origine', 'destination', 'vehicule', 'priorite', 'prevue', 'eta', 'statut', 'prealerte', ...(cellules.prep ? ['prep'] : []), ...(actions ? ['suite'] : [])];
    const detail = (l) => [l.retard ? x.retard : null, l.incident ? x.incident : null].filter(Boolean).map(texte).join(' · ');
    const ligne = (l) => {
      const champs = {
        sens: cellules.sens?.(l),
        ref: `<strong>${texte(l.reference)}</strong>${l.categorie ? `<div><span class="cat-mvt" data-forme="${texte(l.categorie.forme)}" style="--cat-couleur:${texte(l.categorie.couleur)};--cat-texte:${texte(l.categorie.texte)};--cat-fond:${texte(l.categorie.fond)}">${texte(l.categorie.libelle)}${l.categorie.certain ? '' : ' ?'}</span></div>` : ''}${l.personne ? `<div class="note">${texte(l.personne)}</div>` : ''}`,
        type: texte(x.types[l.type] || l.type), origine: texte(l.origine), destination: texte(l.destination), vehicule: texte(l.vehicule),
        priorite: texte(x.priorites[l.priorite] || l.priorite),
        prevue: cellules.prevue ? cellules.prevue(l) : l.prevue ? texte(h(l.prevue)) : '—',
        eta: cellules.eta ? cellules.eta(l) : l.eta_min != null ? `${texte(l.eta_min)} min` : '—',
        statut: `<span class="badge-flux ${l.retard || l.incident ? 'retard' : ['arrive', 'remis', 'termine'].includes(l.statut) ? 'ok' : 'cours'}">${texte(x.statuts[l.statut] || l.statut)}</span>${detail(l) ? `<div class="note">${detail(l)}</div>` : ''}`,
        prealerte: l.prealerte ? texte(l.prealerte.recue_le || ['recue', 'consultee', 'prise_en_compte', 'arrivee', 'cloturee'].includes(l.prealerte.statut) ? x.accusee : x.prealerte) : '—',
        prep: cellules.prep?.(l), suite: actions?.(l),
      };
      return `<tr>${col.map((cle) => `<td${cle === 'prevue' && l.prevue ? ` data-erp-valeur="${texte(new Date(l.prevue).getTime())}"` : ''}>${champs[cle] ?? '—'}</td>`).join('')}</tr>`;
    };
    const tableau = (liste) => liste.length ? `<div class="tableau flux-tableau"><table data-transferts-commun><thead><tr>${col.map((n) => `<th scope="col">${texte(x[n])}</th>`).join('')}</tr></thead>
      <tbody>${liste.map(ligne).join('')}</tbody></table></div>` : `<p class="note">${texte(x.aucun)}</p>`;
    // Une seule partie (26 nov. 2026) : actifs sur le tableau de bord, clos dans l'Historique — jamais répétés aux deux endroits
    if (seulement === 'actifs') return tableau(lignes.filter((l) => !l.clos));
    if (seulement === 'clos') return tableau(lignes.filter((l) => l.clos));
    if (!sections) return tableau(lignes);
    const actifs = lignes.filter((l) => !l.clos);
    const clos = lignes.filter((l) => l.clos);
    return `<section><h3>${texte(x.actif)}</h3>${tableau(actifs)}</section><section><h3>${texte(x.clos)}</h3>${tableau(clos)}</section>`;
  }
  /**
   * Colonnes communes (26 nov. 2026), reprises de la vue des transferts interhospitaliers (référence graphique) :
   * Demandés → Validés → Transport organisé → En transfert → Reçus → Refusés, mêmes couleurs de statut.
   * Seule la PRÉSENTATION est commune : chaque parcours garde ses règles, ses validations et ses actions (carte fournie par l'écran).
   */
  const COLONNES = [['demande', 'var(--attention)'], ['validee', 'var(--secondaire)'], ['transport', 'var(--info)'], ['en_route', 'var(--principal)'], ['recu', 'var(--succes)'], ['refuse', 'var(--critique)']];
  // Mêmes libellés que la vue de référence (i18n « statuts ») : une seule formulation partout
  const TITRES = { fr: { demande: 'Demande', validee: 'Validée', transport: 'Transport organisé', en_route: 'En transfert', recu: 'Reçu', refuse: 'Refusé', plus: '{n} plus anciens dans l’historique', aucun: 'Aucun' },
    en: { demande: 'Requested', validee: 'Accepted', transport: 'Transport arranged', en_route: 'In transit', recu: 'Received', refuse: 'Declined', plus: '{n} older in history', aucun: 'None' } };
  /** Colonne d'un transport (statuts de demandes_transport). */
  function colonneTransport(d) {
    if (['refusee', 'annulee'].includes(d.statut)) return 'refuse';
    if (d.statut === 'arrivee' || d.terminee_le || d.remis_le) return 'recu';
    if (['en_route', 'pris_en_charge'].includes(d.statut)) return 'en_route';
    if (d.statut === 'acceptee') return d.unite_id || d.unite ? 'transport' : 'validee';
    return 'demande';   // a_valider, demandee
  }
  function kanban(elements, { colonne, carte, couleur, maxClos = 8 } = {}) {
    const x = TITRES[(document.documentElement.lang || '').startsWith('en') ? 'en' : 'fr'];
    return `<div class="kanban" data-kanban-commun>${COLONNES.map(([k, c]) => {
      const tous = elements.filter((e) => colonne(e) === k);
      const vus = ['recu', 'refuse'].includes(k) ? tous.slice(0, maxClos) : tous;
      return `<div class="col" style="--c:${c}"><h3>${echapper(x[k])} <span class="num">${tous.length}</span></h3>
        ${vus.map((e) => `<div class="fiche" style="--c:${couleur ? echapper(couleur(e) || c) : c}">${carte(e)}</div>`).join('') || `<div class="vide">${echapper(x.aucun)}</div>`}
        ${tous.length > vus.length ? `<p class="note">${echapper(x.plus.replace('{n}', tous.length - vus.length))}</p>` : ''}</div>`;
    }).join('')}</div>`;
  }
  /* Chrono T−5 (27 nov. 2026) : état de préparation du patient (origine) et de l'accueil (destination), distincts de l'ambulance.
     Objectif organisationnel (T−5 par défaut), jamais clinique ; compte à rebours seulement si l'arrivée estimée est connue. */
  const PREP = {
    fr: { patient: 'Patient', accueil: 'Accueil', pret: 'Patient prêt au transfert', accueil_pret: 'Accueil prêt', inconnu: 'non confirmé', t5: 'Objectif T−5', t5_atteint: 'objectif T−5 dépassé', eta_inconnue: 'arrivée estimée inconnue',
      e: { non_commence: 'Préparation non commencée', en_cours: 'Préparation en cours', pret: 'Patient prêt au transfert', retarde: 'Préparation retardée', indisponible: 'Patient temporairement indisponible', a_renouveler: 'Confirmation à renouveler' },
      m: { soins_en_cours: 'soins en cours', documents: 'documents manquants', personnel: 'personnel indisponible', examen: 'examen en cours', etat_clinique: 'état clinique', autre: 'autre motif' } },
    en: { patient: 'Patient', accueil: 'Reception', pret: 'Patient ready for transfer', accueil_pret: 'Reception ready', inconnu: 'not confirmed', t5: 'T−5 target', t5_atteint: 'T−5 target passed', eta_inconnue: 'estimated arrival unknown',
      e: { non_commence: 'Preparation not started', en_cours: 'Preparation in progress', pret: 'Patient ready for transfer', retarde: 'Preparation delayed', indisponible: 'Patient temporarily unavailable', a_renouveler: 'Confirmation to renew' },
      m: { soins_en_cours: 'care in progress', documents: 'missing documents', personnel: 'staff unavailable', examen: 'test in progress', etat_clinique: 'clinical condition', autre: 'other reason' } },
  };
  const prepTxt = () => PREP[(document.documentElement.lang || '').startsWith('en') ? 'en' : 'fr'];
  /** Heure d'arrivée estimée (préalerte de l'équipage) ; null si inconnue. */
  const arriveeEstimee = (d) => (d.prealerte_eta_min != null && d.prealerte_eta_le ? new Date(new Date(d.prealerte_eta_le).getTime() + d.prealerte_eta_min * 60000) : null);
  /** Badges de préparation (+ compte à rebours T−5 mis à jour par ArrimoDuree.tic). Vert = prêt ; orange = retard ; gris = inconnu. */
  function preparation(d, { heure, objectifMin = 5 } = {}) {
    const x = prepTxt(); const h = heure || ((v) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    const ton = (e) => (e === 'pret' ? 'ok' : ['retarde', 'indisponible', 'a_renouveler'].includes(e) ? 'retard' : '');
    const patient = d.patient_etat
      ? `<span class="badge-flux prep-badge ${ton(d.patient_etat)}">${echapper(x.e[d.patient_etat])}${d.patient_etat === 'pret' && d.patient_pret_le ? ` · ${echapper(h(d.patient_pret_le))}` : ''}${d.patient_etat_motif ? ` · ${echapper(x.m[d.patient_etat_motif])}` : ''}</span>`
      : `<span class="badge-flux prep-badge">${echapper(x.patient)} : ${echapper(x.inconnu)}</span>`;
    const accueil = d.destination_id ? `<span class="badge-flux prep-badge ${d.accueil_pret_le ? 'ok' : ''}">${d.accueil_pret_le ? `${echapper(x.accueil_pret)} · ${echapper(h(d.accueil_pret_le))}` : `${echapper(x.accueil)} : ${echapper(x.inconnu)}`}</span>` : '';
    const eta = arriveeEstimee(d);
    const t5 = eta ? `<span class="note prep-t5">${echapper(x.t5)} : <b class="num" data-decompte="${echapper(new Date(eta.getTime() - objectifMin * 60000).toISOString())}" data-decompte-fin="${echapper(x.t5_atteint)}">--:--:--</b></span>` : '';
    return `<div class="prep-etats">${patient}${accueil}${t5}</div>`;
  }
  window.ArrimoVueTransferts = { rendre, depuisTransport, kanban, colonneTransport, COLONNES, preparation, PREP, arriveeEstimee };
  /* Format des durées (cahier Chrono ultime, 20) : HH:MM:SS, jours au-delà de 24 h ; inconnu → « --:--:-- », jamais 0. */
  function hhmmss(ms) {
    if (!Number.isFinite(ms)) return '--:--:--';
    const tot = Math.floor(Math.abs(ms) / 1000); const j = Math.floor(tot / 86400); const hh = Math.floor((tot % 86400) / 3600);
    const p = (n) => String(n).padStart(2, '0'); const fr = !(document.documentElement.lang || '').startsWith('en');
    return `${j ? `${j} ${fr ? (j > 1 ? 'jours' : 'jour') : (j > 1 ? 'days' : 'day')} ` : ''}${p(hh)}:${p(Math.floor((tot % 3600) / 60))}:${p(tot % 60)}`;
  }
  /** Comptes à rebours [data-decompte] (échéance ISO) : chaque seconde ; une fois l'échéance passée, le libellé de fin. */
  function tic() {
    document.querySelectorAll('[data-decompte]').forEach((el) => {
      const ms = new Date(el.dataset.decompte).getTime() - Date.now();
      el.textContent = ms >= 0 ? hhmmss(ms) : `${el.dataset.decompteFin || ''} (+${hhmmss(ms)})`;
      el.classList.toggle('depasse', ms < 0);
    });
    // Durées écoulées [data-depuis] : HH:MM:SS ; l'anneau ne montre une proportion que s'il existe un objectif (sinon vide, jamais arbitraire)
    document.querySelectorAll('[data-depuis]').forEach((el) => {
      const ms = Date.now() - new Date(el.dataset.depuis).getTime(); const val = el.querySelector('.ac-val') || (el.classList.contains('duree-seule') ? el : null);
      if (val) { const txt = hhmmss(ms); const m = val.classList.contains('ag-val') && txt.match(/^(.+?) (\d\d:\d\d:\d\d)$/);
        if (m) { if (val.dataset.txt !== txt) { val.dataset.txt = txt; val.innerHTML = `<span class="ag-jours">${m[1]}</span>${m[2]}`; } } else val.textContent = txt; }
      const obj = Number(el.dataset.objectifMin); const arc = el.querySelector('.ac-arc');
      if (arc && obj > 0 && Number.isFinite(ms)) arc.setAttribute('stroke-dasharray', `${Math.min(100, Math.max(0, (ms / 60000 / obj) * 100)).toFixed(1)} 100`);
    });
  }
  window.ArrimoDuree = { hhmmss, tic };
  if (typeof setInterval === 'function' && typeof document.querySelectorAll === 'function') setInterval(tic, 1000);
})();
