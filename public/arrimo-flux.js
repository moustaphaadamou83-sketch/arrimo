/* Arrimo Flux (cahier ultime, 21 nov. 2026) : arrivées et départs, comme un tableau d'aéroport ; panneau compact pour l'Accueil.
   Heures distinctes (créneau, prévue, réelle, estimée), ETA jamais inventée, préparation de la chambre, préalertes à acquitter. FR/EN. */
(() => {
  const TXT = {
    fr: { titre: 'Arrimo Flux', intro: 'Arrivées et départs de l’établissement : transports, transferts, hébergement et ambulances, en direct.', tous: 'Tous', arrivees: 'Arrivées', departs: 'Départs',
      aujourdhui: 'Aujourd’hui', demain: 'Demain', actualise: 'Actualisé à {h}', mvt: 'Mouvement', ref: 'Référence', origine: 'Origine', destination: 'Destination', prevue: 'Prévue', estimee: 'Estimée',
      vehicule: 'Véhicule', statut: 'Statut', prep: 'Préparation', action: 'Action', arr: 'Arrivée', dep: 'Départ', eta_ind: 'ETA indisponible', creneau: 'créneau {d}–{f}', reelle: 'réelle {h}',
      aucun: 'Aucun mouvement prévu pour cette période.', retard: 'En retard', ouvrir: 'Ouvrir', accuser: 'Accuser réception', prealertes: 'Préalertes reçues', prochains: 'Prochains mouvements',
      voir_flux: 'Voir tout Arrimo Flux', recue: 'reçue', a_acquitter: 'à acquitter', eta: 'arrivée estimée {h}', aucune_pa: 'Aucune préalerte en attente.', fait: 'Accusé de réception enregistré.',
      bourse: 'Bourse des places', voir_bourse: 'Ouvrir la Bourse', lits_libres: 'lits libres : {n}', declarees: 'places déclarées : {n}', a_venir: '{n} à venir', aucune_place: 'Aucune place libre dans la région pour le moment.', bourse_note: 'Une place n’est jamais présentée comme disponible si elle est occupée, réservée ou bloquée.',
      resume: '{a} arrivées · {d} départs · {r} en retard · {p} préparations en cours', fiche: 'Fiche', fermer: 'Fermer', chronologie: 'Chronologie du parcours',
      et: { demande: 'Demande', demande_transmise: 'Demande transmise', acceptation: 'Acceptation', refus: 'Refus', en_route: 'En route vers le départ', sur_place: 'Sur place', depart: 'Départ (patient pris en charge)', prealerte: 'Préalerte envoyée', prealerte_recue: 'Préalerte reçue', arrivee: 'Arrivée du véhicule', reception: 'Patient remis', cloture: 'Mission terminée', incident: 'Incident', annulation: 'Annulation', preparation: 'Chambre prête' },
      st: { a_valider: 'À valider', demande: 'Demandé', accepte: 'Accepté', en_route_depart: 'En route vers le départ', en_transport: 'En transport', arrive: 'Arrivé', refuse: 'Refusé', annule: 'Annulé', prevu: 'Prévu', termine: 'Terminé' },
      pr: { a_faire: 'À préparer', en_cours: 'En cours', prete: 'Prête', a_verifier: 'À vérifier' } },
    en: { titre: 'Arrimo Flow', intro: 'Facility arrivals and departures: transports, transfers, housing and ambulances, live.', tous: 'All', arrivees: 'Arrivals', departs: 'Departures',
      aujourdhui: 'Today', demain: 'Tomorrow', actualise: 'Updated at {h}', mvt: 'Movement', ref: 'Reference', origine: 'Origin', destination: 'Destination', prevue: 'Scheduled', estimee: 'Estimated',
      vehicule: 'Vehicle', statut: 'Status', prep: 'Preparation', action: 'Action', arr: 'Arrival', dep: 'Departure', eta_ind: 'ETA unavailable', creneau: 'slot {d}–{f}', reelle: 'actual {h}',
      aucun: 'No movement planned for this period.', retard: 'Delayed', ouvrir: 'Open', accuser: 'Acknowledge', prealertes: 'Received pre-alerts', prochains: 'Next movements',
      voir_flux: 'See all of Arrimo Flow', recue: 'received', a_acquitter: 'to acknowledge', eta: 'estimated arrival {h}', aucune_pa: 'No pending pre-alert.', fait: 'Acknowledgement recorded.',
      bourse: 'Placement exchange', voir_bourse: 'Open the exchange', lits_libres: 'free beds: {n}', declarees: 'declared places: {n}', a_venir: '{n} upcoming', aucune_place: 'No free place in the region right now.', bourse_note: 'A place is never shown as available if it is occupied, reserved or blocked.',
      resume: '{a} arrivals · {d} departures · {r} delayed · {p} preparations in progress', fiche: 'Record', fermer: 'Close', chronologie: 'Path timeline',
      et: { demande: 'Request', demande_transmise: 'Request sent', acceptation: 'Acceptance', refus: 'Declined', en_route: 'On the way to pick-up', sur_place: 'On site', depart: 'Departure (patient picked up)', prealerte: 'Pre-alert sent', prealerte_recue: 'Pre-alert received', arrivee: 'Vehicle arrival', reception: 'Patient handed over', cloture: 'Mission complete', incident: 'Incident', annulation: 'Cancellation', preparation: 'Room ready' },
      st: { a_valider: 'To validate', demande: 'Requested', accepte: 'Accepted', en_route_depart: 'On the way to pick-up', en_transport: 'In transport', arrive: 'Arrived', refuse: 'Declined', annule: 'Cancelled', prevu: 'Planned', termine: 'Done' },
      pr: { a_faire: 'To prepare', en_cours: 'In progress', prete: 'Ready', a_verifier: 'To check' } },
  };
  const e = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = () => (typeof langue === 'string' && langue === 'en' ? 'en' : (document.documentElement.lang || '').startsWith('en') ? 'en' : 'fr');
  const X = () => TXT[L()]; const T = (k, v = {}) => e(String(X()[k]).replace(/\{(\w+)\}/g, (m, y) => v[y] ?? m));
  const h = (d) => (d ? new Date(d).toLocaleTimeString(L() === 'en' ? 'en-CA' : 'fr-CA', { hour: '2-digit', minute: '2-digit' }) : '');
  const jour = (d) => (d ? new Date(d).toLocaleDateString(L() === 'en' ? 'en-CA' : 'fr-CA', { day: 'numeric', month: 'short' }) : '');
  const etat = { sens: '', jour: 'aujourdhui' };
  const badge = (st, retard) => `<span class="badge-flux ${['arrive', 'termine'].includes(st) ? 'ok' : ['refuse', 'annule'].includes(st) ? 'ko' : retard ? 'retard' : 'cours'}">${e(X().st[st] || st)}${retard ? ` · ${T('retard')}` : ''}</span>`;
  const prep = (p) => (p ? `<span class="badge-flux ${p.etat === 'prete' ? 'ok' : p.etat === 'a_verifier' ? '' : 'cours'}">${e(X().pr[p.etat] || p.etat)}${p.chambre ? ` · ${e(p.chambre)}` : ''}</span>` : '—');
  const quand = (l) => {
    const prevue = l.prevue ? `${jour(l.prevue)} ${h(l.prevue)}` : '—';
    const cr = l.creneau ? `<div class="note">${T('creneau', { d: h(l.creneau.debut), f: h(l.creneau.fin) })}</div>` : '';
    const reel = l.mouvement === 'arrivee' ? l.arrivee_reelle : l.depart_reel;
    return `${prevue}${cr}${reel ? `<div class="note">${T('reelle', { h: h(reel) })}</div>` : ''}`;
  };
  const estimee = (l) => (l.mouvement !== 'arrivee' ? '—' : l.arrivee_reelle ? `✓ ${h(l.arrivee_reelle)}` : l.eta ? `${h(l.eta)}<div class="note">${e(l.eta_source || '')}</div>` : `<span class="note">${T('eta_ind')}</span>`);

  async function charger(o) { return o.api('GET', `/arrimo-flux?etablissement_id=${o.etablissement_id}${etat.sens ? `&sens=${etat.sens}` : ''}${etat.jour === 'demain' ? '&jour=demain' : ''}`); }
  async function accuser(o, l) { await o.api('POST', `/transports/${l.transport_id}/action`, { etablissement_id: o.etablissement_id, action: 'accuser_prealerte' }); }

  /** Vue complète (onglet Flux). */
  async function afficher(v, o) {
    const d = await charger(o);
    const filtre = (k, val, lib) => `<button type="button" class="btn${etat[k] === val ? ' pri' : ''}" data-flux-${k}="${val}" aria-pressed="${etat[k] === val}">${T(lib)}</button>`;
    v.innerHTML = `<div class="entete"><div><h2>${T('titre')}</h2><p class="note">${T('intro')}</p></div><p class="note" aria-live="polite">${T('actualise', { h: h(d.genere_le) })}</p></div>
      <div class="ligne flux-filtres" role="group">${filtre('sens', '', 'tous')}${filtre('sens', 'arrivees', 'arrivees')}${filtre('sens', 'departs', 'departs')}<span class="sep"></span>${filtre('jour', 'aujourdhui', 'aujourdhui')}${filtre('jour', 'demain', 'demain')}</div>
      <p class="note">${T('resume', { a: d.resume.arrivees, d: d.resume.departs, r: d.resume.retards, p: d.resume.preparations })}</p>
      ${d.mouvements.length ? `<div class="tableau flux-tableau"><table><thead><tr><th>${T('mvt')}</th><th>${T('ref')}</th><th>${T('origine')}</th><th>${T('destination')}</th><th>${T('prevue')}</th><th>${T('estimee')}</th><th>${T('vehicule')}</th><th>${T('statut')}</th><th>${T('prep')}</th><th>${T('action')}</th></tr></thead><tbody>
        ${d.mouvements.map((l, i) => `<tr class="${l.retard ? 'flux-retard' : ''}"><td><b>${l.mouvement === 'arrivee' ? `↘ ${T('arr')}` : `↗ ${T('dep')}`}</b></td><td><b>${e(l.reference)}</b>${l.personne ? `<div class="note">${e(l.personne)}</div>` : ''}</td>
          <td>${e(l.origine)}</td><td>${e(l.destination || '—')}</td><td>${quand(l)}</td><td>${estimee(l)}</td><td>${e(l.vehicule || '—')}</td><td>${badge(l.statut, l.retard)}${l.prealerte ? `<div class="note">📣 ${h(l.prealerte.le)} · ${l.prealerte.recue_le ? T('recue') : T('a_acquitter')}</div>` : ''}</td>
          <td>${prep(l.preparation)}</td><td>${l.actions.includes('accuser_prealerte') ? `<button class="btn pri" data-flux-accuser="${i}">${T('accuser')}</button>` : ''}${l.fiche ? `<button class="btn" data-flux-fiche="${i}">${T('fiche')}</button>` : ''}<button class="btn" data-flux-ouvrir="${e(l.ecran)}">${T('ouvrir')}</button></td></tr>`).join('')}</tbody></table></div>` : `<p class="vide">${T('aucun')}</p>`}`;
    v.querySelectorAll('[data-flux-sens]').forEach((b) => { b.onclick = () => { etat.sens = b.dataset.fluxSens; afficher(v, o); }; });
    v.querySelectorAll('[data-flux-jour]').forEach((b) => { b.onclick = () => { etat.jour = b.dataset.fluxJour; afficher(v, o); }; });
    v.querySelectorAll('[data-flux-ouvrir]').forEach((b) => { b.onclick = () => o.ouvrir?.(b.dataset.fluxOuvrir); });
    v.querySelectorAll('[data-flux-fiche]').forEach((b) => { b.onclick = () => ouvrirFiche(o, d.mouvements[Number(b.dataset.fluxFiche)].fiche); });
    v.querySelectorAll('[data-flux-accuser]').forEach((b) => { b.onclick = async () => { try { await accuser(o, d.mouvements[Number(b.dataset.fluxAccuser)]); o.toast?.(T('fait')); } catch (err) { o.toast?.(err.message, true); } afficher(v, o); }; });
  }
  /** Fiche opérationnelle interactive : en-tête, créneau, véhicule, incident, chronologie avec acteur et heure. */
  async function ouvrirFiche(o, f) {
    let x; try { x = await o.api('GET', `/arrimo-flux/fiche?type=${f.type}&id=${f.id}`); } catch (err) { o.toast?.(err.message, true); return; }
    const corps = `<dl class="fiche-flux"><dt>${T('origine')}</dt><dd>${e(x.origine)}</dd><dt>${T('destination')}</dt><dd>${e(x.destination || '—')}</dd>
      <dt>${T('statut')}</dt><dd>${e(x.statut)}</dd><dt>${T('vehicule')}</dt><dd>${e(x.vehicule || '—')}</dd>${x.creneau ? `<dt>${T('prevue')}</dt><dd>${T('creneau', { d: `${jour(x.creneau.debut)} ${h(x.creneau.debut)}`, f: h(x.creneau.fin) })}</dd>` : ''}</dl>
      ${x.incident ? `<p class="erreur">⚠ ${e(x.incident.motif)} (${h(x.incident.le)})</p>` : ''}
      <h3>${T('chronologie')}</h3><ol class="chrono-flux">${x.chronologie.map((c) => `<li><b>${e(X().et[c.etape] || c.etape)}</b> · ${jour(c.quand)} ${h(c.quand)}${c.acteur ? ` · ${e(c.acteur)}` : ''}</li>`).join('') || `<li class="note">—</li>`}</ol>`;
    if (o.modale) o.modale(`${x.reference}${x.personne ? ` · ${x.personne}` : ''}`, corps, [{ label: T('fermer'), pri: true }]);
  }
  /** Panneau compact de l'Accueil : préalertes reçues (à acquitter) et prochains mouvements. */
  async function panneau(zone, o) {
    let d; try { d = await o.api('GET', `/arrimo-flux?etablissement_id=${o.etablissement_id}`); } catch { zone.innerHTML = ''; return; }
    // Bourse des places (si le module est activé) : à droite des mouvements ; lits réellement libres distingués des places déclarées
    const b = o.bourse ? await o.api('GET', `/bourse?etablissement_id=${o.etablissement_id}`).catch(() => null) : null;
    const pa = d.mouvements.filter((l) => l.prealerte || l.type === 'prealerte').filter((l) => !['arrive', 'termine', 'annule'].includes(l.statut));
    const proch = d.mouvements.filter((l) => !['arrive', 'termine', 'annule', 'refuse'].includes(l.statut)).slice(0, 6);
    zone.innerHTML = `<div class="flux-accueil">
      <section class="panneau-c flux-pleine"><div class="ligne" style="justify-content:space-between"><h3>📣 ${T('prealertes')}</h3><span class="note">${T('actualise', { h: h(d.genere_le) })}</span></div>
        ${pa.length ? `<ul class="liste-simple">${pa.map((l) => `<li><b>${e(l.reference)}</b> · ${e(l.origine)} → ${e(l.destination || '')}${l.vehicule ? ` · ${e(l.vehicule)}` : ''} · ${l.eta ? T('eta', { h: h(l.eta) }) : T('eta_ind')}${l.preparation ? ` · ${prep(l.preparation)}` : ''}
          ${l.actions.includes('accuser_prealerte') ? ` <button class="btn pri" data-pa-accuser="${e(l.cle)}">${T('accuser')}</button>` : l.prealerte?.recue_le ? ` · ✓ ${T('recue')}` : ''}</li>`).join('')}</ul>` : `<p class="note">${T('aucune_pa')}</p>`}</section>
      <section class="panneau-c"><div class="ligne" style="justify-content:space-between"><h3>⇄ ${T('prochains')}</h3><button class="btn" data-flux-tout>${T('voir_flux')}</button></div>
        ${proch.length ? `<ul class="liste-simple">${proch.map((l) => `<li>${l.mouvement === 'arrivee' ? '↘' : '↗'} <b>${e(l.reference)}</b> · ${e(l.mouvement === 'arrivee' ? l.origine : l.destination || '')} · ${l.prevue ? h(l.prevue) : '—'} · ${badge(l.statut, l.retard)}</li>`).join('')}</ul>` : `<p class="note">${T('aucun')}</p>`}</section>
      ${b && b.places ? `<section class="panneau-c"><div class="ligne" style="justify-content:space-between"><h3>🛏 ${T('bourse')}</h3><button class="btn" data-flux-bourse>${T('voir_bourse')}</button></div>
        ${b.places.length ? `<ul class="liste-simple">${b.places.slice(0, 6).map((p) => `<li><b>${e(p.nom)}</b>${p.type ? ` · ${e(p.type)}` : ''} · ${T('lits_libres', { n: p.lits_libres ?? 0 })}${p.libres !== p.lits_libres ? ` · ${T('declarees', { n: p.libres })}` : ''}${p.a_venir ? ` · ${T('a_venir', { n: p.a_venir })}` : ''}${p.distance_km != null ? ` · ${p.distance_km} km` : ''}</li>`).join('')}</ul>` : `<p class="note">${T('aucune_place')}</p>`}
        <p class="note">${T('bourse_note')}</p></section>` : ''}</div>`;
    zone.querySelector('[data-flux-bourse]')?.addEventListener('click', () => o.ouvrir?.('bourse'));
    zone.querySelector('[data-flux-tout]')?.addEventListener('click', () => o.ouvrir?.('flux'));
    zone.querySelectorAll('[data-pa-accuser]').forEach((b) => { b.onclick = async () => { const l = d.mouvements.find((x) => x.cle === b.dataset.paAccuser); try { await accuser(o, l); o.toast?.(T('fait')); } catch (err) { o.toast?.(err.message, true); } panneau(zone, o); }; });
  }
  window.ArrimoFluxVue = { afficher, panneau };
})();
