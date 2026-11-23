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
  function rendre(lignes, { actions, heure, cellules = {}, sections = false } = {}) {
    const x = dico();
    const texte = (v) => echapper(v ?? '—');
    const h = heure || ((d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    const col = [...(cellules.sens ? ['sens'] : []), 'ref', 'type', 'origine', 'destination', 'vehicule', 'priorite', 'prevue', 'eta', 'statut', 'prealerte', ...(cellules.prep ? ['prep'] : []), ...(actions ? ['suite'] : [])];
    const detail = (l) => [l.retard ? x.retard : null, l.incident ? x.incident : null].filter(Boolean).map(texte).join(' · ');
    const ligne = (l) => {
      const champs = {
        sens: cellules.sens?.(l),
        ref: `<strong>${texte(l.reference)}</strong>${l.personne ? `<div class="note">${texte(l.personne)}</div>` : ''}`,
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
    if (!sections) return tableau(lignes);
    const actifs = lignes.filter((l) => !l.clos);
    const clos = lignes.filter((l) => l.clos);
    return `<section><h3>${texte(x.actif)}</h3>${tableau(actifs)}</section><section><h3>${texte(x.clos)}</h3>${tableau(clos)}</section>`;
  }
  window.ArrimoVueTransferts = { rendre, depuisTransport };
})();
