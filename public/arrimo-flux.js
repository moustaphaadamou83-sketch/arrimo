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
      categories: 'Catégories de mouvements (cliquer pour filtrer)', resume: '{a} arrivées · {d} départs · {r} en retard · {p} préparations en cours', historique: 'Historique', hist_intro: 'Mouvements clos des {n} derniers jours (arrivés, terminés, refusés, annulés).', debut: 'Début', fin: 'Fin', type: 'Type', ensemble: 'Vue d’ensemble par statut',
      gr: { attente: 'En attente', acceptes: 'Acceptés', preparation: 'En préparation', transport: 'En transport', arrives: 'Arrivés', termines: 'Terminés', annules: 'Annulés' }, ty: { transport: 'Transport', transfert: 'Transfert' }, tout_statut: 'Tous les statuts', fiche: 'Fiche', fermer: 'Fermer', chronologie: 'Chronologie du parcours',
      et: { demande: 'Demande', demande_transmise: 'Demande transmise', acceptation: 'Acceptation', refus: 'Refus', en_route: 'En route vers le départ', sur_place: 'Sur place', depart: 'Prise en charge du patient', depart_confirme: 'Départ confirmé', prealerte: 'Préalerte envoyée', prealerte_recue: 'Préalerte reçue', arrivee: 'Arrivée du véhicule', reception: 'Patient remis', cloture: 'Mission terminée', incident: 'Incident', annulation: 'Annulation', preparation: 'Chambre prête' },
      st: { a_valider: 'À valider', demande: 'Demandé', accepte: 'Accepté', en_route_depart: 'En route vers le départ', en_transport: 'En transport', arrive: 'Arrivé', refuse: 'Refusé', annule: 'Annulé', prevu: 'Prévu', termine: 'Terminé' },
      ind_titre: 'Préparation de l’accueil : {p} %', ind_inconnu: 'Préparation de l’accueil : inconnue', ind_pret: 'accueil prêt', ind_reste: 'reste : {c}',
      cond: { capacite_prete: 'capacité prête', acceptation: 'acceptation', prealerte_recue: 'préalerte reçue' },
      mg: { marge: 'marge de préparation : {m} min', marge_faible: 'marge faible : {m} min', risque_retard: 'risque de retard de préparation', inconnu: 'marge de préparation inconnue' },
      pr: { a_faire: 'À préparer', en_cours: 'En cours', prete: 'Prête', a_verifier: 'À vérifier' } },
    en: { titre: 'Arrimo Flow', intro: 'Facility arrivals and departures: transports, transfers, housing and ambulances, live.', tous: 'All', arrivees: 'Arrivals', departs: 'Departures',
      aujourdhui: 'Today', demain: 'Tomorrow', actualise: 'Updated at {h}', mvt: 'Movement', ref: 'Reference', origine: 'Origin', destination: 'Destination', prevue: 'Scheduled', estimee: 'Estimated',
      vehicule: 'Vehicle', statut: 'Status', prep: 'Preparation', action: 'Action', arr: 'Arrival', dep: 'Departure', eta_ind: 'ETA unavailable', creneau: 'slot {d}–{f}', reelle: 'actual {h}',
      aucun: 'No movement planned for this period.', retard: 'Delayed', ouvrir: 'Open', accuser: 'Acknowledge', prealertes: 'Received pre-alerts', prochains: 'Next movements',
      voir_flux: 'See all of Arrimo Flow', recue: 'received', a_acquitter: 'to acknowledge', eta: 'estimated arrival {h}', aucune_pa: 'No pending pre-alert.', fait: 'Acknowledgement recorded.',
      bourse: 'Placement exchange', voir_bourse: 'Open the exchange', lits_libres: 'free beds: {n}', declarees: 'declared places: {n}', a_venir: '{n} upcoming', aucune_place: 'No free place in the region right now.', bourse_note: 'A place is never shown as available if it is occupied, reserved or blocked.',
      categories: 'Movement categories (click to filter)', resume: '{a} arrivals · {d} departures · {r} delayed · {p} preparations in progress', historique: 'History', hist_intro: 'Closed movements of the last {n} days (arrived, done, declined, cancelled).', debut: 'Start', fin: 'End', type: 'Type', ensemble: 'Overview by status',
      gr: { attente: 'Waiting', acceptes: 'Accepted', preparation: 'In preparation', transport: 'In transport', arrives: 'Arrived', termines: 'Done', annules: 'Cancelled' }, ty: { transport: 'Transport', transfert: 'Transfer' }, tout_statut: 'All statuses', fiche: 'Record', fermer: 'Close', chronologie: 'Path timeline',
      et: { demande: 'Request', demande_transmise: 'Request sent', acceptation: 'Acceptance', refus: 'Declined', en_route: 'On the way to pick-up', sur_place: 'On site', depart: 'Patient picked up', depart_confirme: 'Departure confirmed', prealerte: 'Pre-alert sent', prealerte_recue: 'Pre-alert received', arrivee: 'Vehicle arrival', reception: 'Patient handed over', cloture: 'Mission complete', incident: 'Incident', annulation: 'Cancellation', preparation: 'Room ready' },
      st: { a_valider: 'To validate', demande: 'Requested', accepte: 'Accepted', en_route_depart: 'On the way to pick-up', en_transport: 'In transport', arrive: 'Arrived', refuse: 'Declined', annule: 'Cancelled', prevu: 'Planned', termine: 'Done' },
      ind_titre: 'Reception readiness: {p} %', ind_inconnu: 'Reception readiness: unknown', ind_pret: 'reception ready', ind_reste: 'remaining: {c}',
      cond: { capacite_prete: 'capacity ready', acceptation: 'acceptance', prealerte_recue: 'pre-alert received' },
      mg: { marge: 'preparation margin: {m} min', marge_faible: 'low margin: {m} min', risque_retard: 'preparation delay risk', inconnu: 'preparation margin unknown' },
      pr: { a_faire: 'To prepare', en_cours: 'In progress', prete: 'Ready', a_verifier: 'To check' } },
  };
  const e = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = () => (typeof langue === 'string' && langue === 'en' ? 'en' : (document.documentElement.lang || '').startsWith('en') ? 'en' : 'fr');
  const X = () => TXT[L()]; const T = (k, v = {}) => e(String(X()[k]).replace(/\{(\w+)\}/g, (m, y) => v[y] ?? m));
  const h = (d) => (d ? new Date(d).toLocaleTimeString(L() === 'en' ? 'en-CA' : 'fr-CA', { hour: '2-digit', minute: '2-digit' }) : '');
  const jour = (d) => (d ? new Date(d).toLocaleDateString(L() === 'en' ? 'en-CA' : 'fr-CA', { day: 'numeric', month: 'short' }) : '');
  const etat = { sens: '', jour: 'aujourdhui', groupe: '' };
  // Vue d'ensemble des transferts (cahier directeur, 8.1) : statut regroupé
  const groupe = (l) => (['refuse', 'annule'].includes(l.statut) ? 'annules' : l.statut === 'termine' ? 'termines' : l.statut === 'arrive' ? 'arrives' : ['en_route_depart', 'en_transport'].includes(l.statut) ? 'transport'
    : l.preparation && ['a_faire', 'en_cours'].includes(l.preparation.etat) ? 'preparation' : l.statut === 'accepte' ? 'acceptes' : 'attente');
  const badge = (st, retard) => `<span class="badge-flux ${['arrive', 'termine'].includes(st) ? 'ok' : ['refuse', 'annule'].includes(st) ? 'ko' : retard ? 'retard' : 'cours'}">${e(X().st[st] || st)}${retard ? ` · ${T('retard')}` : ''}</span>`;
  const prep = (p) => (p ? `<span class="badge-flux ${p.etat === 'prete' ? 'ok' : p.retard ? 'retard' : p.etat === 'a_verifier' ? '' : 'cours'}">${e(X().pr[p.etat] || p.etat)}${p.chambre ? ` · ${e(p.chambre)}` : ''}${p.retard ? ` · ${T('retard')}` : ''}</span>` : '—');
  /** Indice de préparation de l'accueil (cahier 15) : anneau + conditions obligatoires restantes ; un % élevé ne remplace pas une condition. */
  const accueil = (l) => {
    const a = l.preparation_accueil; const m = l.marge_preparation; let html = '';
    if (a) {
      const reste = a.manquantes.map((c) => e(X().cond[c] || c)).join(', ');
      const ton = a.pret ? 'ok' : a.risque ? 'retard' : 'cours';
      html += `<span class="indice-accueil ${ton}" title="${a.pct == null ? T('ind_inconnu') : T('ind_titre', { p: a.pct })}">`
        + `<span class="anneau" style="--pct:${a.pct ?? 0}" role="img" aria-label="${a.pct == null ? T('ind_inconnu') : T('ind_titre', { p: a.pct })}"><span class="num">${a.pct == null ? '?' : a.pct}</span></span>`
        + `<span class="note">${a.pret ? T('ind_pret') : T('ind_reste', { c: reste })}</span></span>`;
    }
    if (m) html += `<div class="note marge-${e(m.verdict)}">${e(String(X().mg[m.verdict]).replace('{m}', m.marge_min ?? '—'))}</div>`;
    return html;
  };
  const quand = (l) => {
    const prevue = l.prevue ? `${jour(l.prevue)} ${h(l.prevue)}` : '—';
    const cr = l.creneau ? `<div class="note">${T('creneau', { d: h(l.creneau.debut), f: h(l.creneau.fin) })}</div>` : '';
    const reel = l.mouvement === 'arrivee' ? l.arrivee_reelle : l.depart_reel;
    return `${prevue}${cr}${reel ? `<div class="note">${T('reelle', { h: h(reel) })}</div>` : ''}`;
  };
  const estimee = (l) => (l.mouvement !== 'arrivee' ? '—' : l.arrivee_reelle ? `<svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-check"/></svg> ${h(l.arrivee_reelle)}` : l.eta ? `${h(l.eta)}<div class="note">${e(l.eta_source || '')}</div>` : `<span class="note">${T('eta_ind')}</span>`);

  async function charger(o) {
    const d = await o.api('GET', `/arrimo-flux?etablissement_id=${o.etablissement_id}${etat.sens ? `&sens=${etat.sens}` : ''}${etat.jour === 'demain' ? '&jour=demain' : ''}`);
    window.ArrimoSon?.compter(`pa:${o.etablissement_id}`, d?.resume?.prealertes_a_acquitter, 'prealerte');   // son : chaque nouvelle préalerte
    return d;
  }
  async function accuser(o, l) { await o.api('POST', `/transports/${l.transport_id}/action`, { etablissement_id: o.etablissement_id, action: 'accuser_prealerte' }); }

  /** Vue complète (onglet Flux). */
  async function afficher(v, o) {
    const filtre = (k, val, lib) => `<button type="button" class="btn${etat[k] === val ? ' pri' : ''}" data-flux-${k}="${val}" aria-pressed="${etat[k] === val}">${T(lib)}</button>`;
    const barre = `<div class="ligne flux-filtres" role="group">${filtre('sens', '', 'tous')}${filtre('sens', 'arrivees', 'arrivees')}${filtre('sens', 'departs', 'departs')}<span class="sep"></span>${filtre('jour', 'aujourdhui', 'aujourdhui')}${filtre('jour', 'demain', 'demain')}${filtre('jour', 'historique', 'historique')}</div>`;
    const lierFiltres = () => {
      v.querySelectorAll('[data-flux-sens]').forEach((b) => { b.onclick = () => { etat.sens = b.dataset.fluxSens; afficher(v, o); }; });
      v.querySelectorAll('[data-flux-jour]').forEach((b) => { b.onclick = () => { etat.jour = b.dataset.fluxJour; etat.groupe = ''; afficher(v, o); }; });
      v.querySelectorAll('[data-flux-groupe]').forEach((b) => { b.onclick = () => { etat.groupe = etat.groupe === b.dataset.fluxGroupe ? '' : b.dataset.fluxGroupe; afficher(v, o); }; });
    };
    if (etat.jour === 'historique') {
      const hs = await o.api('GET', `/arrimo-flux/historique?etablissement_id=${o.etablissement_id}`);
      const l = hs.mouvements.filter((x) => !etat.sens || x.mouvement === (etat.sens === 'arrivees' ? 'arrivee' : 'depart'));
      v.innerHTML = `<div class="entete"><div><h2>${T('titre')} · ${T('historique')}</h2><p class="note">${T('hist_intro', { n: hs.jours })}</p></div></div>${barre}
        ${l.length ? `<div class="tableau flux-tableau"><table><thead><tr><th>${T('mvt')}</th><th>${T('type')}</th><th>${T('ref')}</th><th>${T('origine')}</th><th>${T('destination')}</th><th>${T('debut')}</th><th>${T('fin')}</th><th>${T('vehicule')}</th><th>${T('statut')}</th></tr></thead><tbody>
          ${l.map((x) => `<tr><td><b>${x.mouvement === 'arrivee' ? `<svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-arrow-down-right"/></svg> ${T('arr')}` : `<svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-arrow-up-right"/></svg> ${T('dep')}`}</b></td><td>${e(X().ty[x.type] || x.type)}</td><td><b>${e(x.reference)}</b>${x.personne ? `<div class="note">${e(x.personne)}</div>` : ''}</td><td>${e(x.origine)}</td><td>${e(x.destination || '—')}</td>
            <td>${jour(x.debut)} ${h(x.debut)}</td><td>${jour(x.fin)} ${h(x.fin)}</td><td>${e(x.vehicule || '—')}</td><td>${badge(x.statut)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="note">${T('aucun')}</p>`}`;
      lierFiltres(); return;
    }
    const d0 = await charger(o);
    const cpt = {}; for (const l of d0.mouvements) cpt[groupe(l)] = (cpt[groupe(l)] || 0) + 1;
    const d = { ...d0, mouvements: d0.mouvements.filter((l) => (!etat.groupe || groupe(l) === etat.groupe) && (!etat.categorie || l.categorie?.code === etat.categorie)) };
    // Légende commune des catégories de mouvements : cliquer filtre (et un second clic retire le filtre)
    const vues = new Map(); for (const l of d0.mouvements) if (l.categorie) vues.set(l.categorie.code, l.categorie);
    const legende = vues.size ? `<div class="flux-groupes" role="group" aria-label="${T('categories')}">${[...vues.values()].map((c) => `<button type="button" class="cat-mvt${etat.categorie === c.code ? ' actif' : ''}" aria-pressed="${etat.categorie === c.code}" data-flux-cat="${e(c.code)}" data-forme="${e(c.forme)}" style="--cat-couleur:${e(c.couleur)};--cat-texte:${e(c.texte)};--cat-fond:${e(c.fond)};border:2px solid ${etat.categorie === c.code ? e(c.couleur) : 'transparent'};cursor:pointer">${e(c.libelle)} · ${d0.resume.par_categorie?.[c.code] ?? 0}</button>`).join('')}</div>` : '';
    const ensemble = `<div class="flux-groupes" role="group" aria-label="${T('ensemble')}">${Object.keys(X().gr).map((k) => `<button type="button" class="acc-mini-k flux-groupe${etat.groupe === k ? ' actif' : ''}" data-flux-groupe="${k}" aria-pressed="${etat.groupe === k}"><b>${cpt[k] || 0}</b><span>${e(X().gr[k])}</span></button>`).join('')}</div>`;
    v.innerHTML = `<div class="entete"><div><h2>${T('titre')}</h2><p class="note">${T('intro')}</p></div><p class="note" aria-live="polite">${T('actualise', { h: h(d.genere_le) })}</p></div>
      ${barre}${ensemble}${legende}
      <p class="note">${T('resume', { a: d.resume.arrivees, d: d.resume.departs, r: d.resume.retards, p: d.resume.preparations })}</p>
      ${window.ArrimoVueTransferts.rendre(d.mouvements.map((l, i) => ({ ...l, statut: l.statut_detail || l.statut, ligne: i })), {
        cellules: { sens: (l) => T(l.mouvement === 'arrivee' ? 'arr' : 'dep'), prevue: quand, eta: estimee, prep: (l) => `${prep(l.preparation)}${accueil(l)}` },
        actions: (l) => `${l.transfert ? o.boutonsTransfert?.(l.transfert) || '' : ''}${l.actions.includes('accuser_prealerte') ? `<button class="btn pri" data-flux-accuser="${l.ligne}">${T('accuser')}</button>` : ''}
          ${l.fiche ? `<button class="btn" data-flux-fiche="${l.ligne}">${T('fiche')}</button>` : ''}<button class="btn" data-flux-ouvrir="${e(l.ecran)}">${T('ouvrir')}</button>`,
      })}`;
    lierFiltres();
    v.querySelectorAll('[data-flux-cat]').forEach((b) => { b.onclick = () => { etat.categorie = etat.categorie === b.dataset.fluxCat ? null : b.dataset.fluxCat; afficher(v, o); }; });
    o.lierActionsTransfert?.(v);
    v.querySelectorAll('[data-flux-ouvrir]').forEach((b) => { b.onclick = () => o.ouvrir?.(b.dataset.fluxOuvrir); });
    v.querySelectorAll('[data-flux-fiche]').forEach((b) => { b.onclick = () => ouvrirFiche(o, d.mouvements[Number(b.dataset.fluxFiche)].fiche); });
    v.querySelectorAll('[data-flux-accuser]').forEach((b) => { b.onclick = async () => { try { await accuser(o, d.mouvements[Number(b.dataset.fluxAccuser)]); o.toast?.(T('fait')); } catch (err) { o.toast?.(err.message, true); } afficher(v, o); }; });
  }
  /** Fiche opérationnelle interactive : en-tête, créneau, véhicule, incident, chronologie avec acteur et heure. */
  async function ouvrirFiche(o, f) {
    let x; try { x = await o.api('GET', `/arrimo-flux/fiche?type=${f.type}&id=${f.id}`); } catch (err) { o.toast?.(err.message, true); return; }
    const corps = `<dl class="fiche-flux"><dt>${T('origine')}</dt><dd>${e(x.origine)}</dd><dt>${T('destination')}</dt><dd>${e(x.destination || '—')}</dd>
      <dt>${T('statut')}</dt><dd>${e(x.statut)}</dd><dt>${T('vehicule')}</dt><dd>${e(x.vehicule || '—')}</dd>${x.creneau ? `<dt>${T('prevue')}</dt><dd>${T('creneau', { d: `${jour(x.creneau.debut)} ${h(x.creneau.debut)}`, f: h(x.creneau.fin) })}</dd>` : ''}</dl>
      ${x.incident ? `<p class="erreur"><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-triangle-alert"/></svg> ${e(x.incident.motif)} (${h(x.incident.le)})</p>` : ''}
      <h3>${T('chronologie')}</h3><ol class="chrono-flux">${x.chronologie.map((c) => `<li><b>${e(X().et[c.etape === 'depart' && x.type === 'transfert' ? 'depart_confirme' : c.etape] || c.etape)}</b> · ${jour(c.quand)} ${h(c.quand)}${c.acteur ? ` · ${e(c.acteur)}` : ''}</li>`).join('') || `<li class="note">—</li>`}</ol>`;
    if (o.modale) o.modale(`${x.reference}${x.personne ? ` · ${x.personne}` : ''}`, corps, [{ label: T('fermer'), pri: true }]);
  }
  /** Panneau compact de l'Accueil : préalertes reçues (à acquitter) et prochains mouvements. */
  async function panneau(zone, o) {
    let d; try { d = await o.api('GET', `/arrimo-flux?etablissement_id=${o.etablissement_id}`); } catch { zone.innerHTML = ''; return; }
    // Bourse des places (si le module est activé) : à droite des mouvements ; lits réellement libres distingués des places déclarées
    const b = o.bourse ? await o.api('GET', `/bourse?etablissement_id=${o.etablissement_id}`).catch(() => null) : null;
    const pa = d.mouvements.filter((l) => l.prealerte || l.type === 'prealerte').filter((l) => !['arrive', 'termine', 'annule'].includes(l.statut));
    const proch = d.mouvements.filter((l) => !['arrive', 'termine', 'annule', 'refuse'].includes(l.statut)).slice(0, 6);
    // Préalertes : dans la zone « Préalertes et priorités » de l'Accueil universel si elle existe, sinon en tête du panneau
    const htmlPa = `<section class="panneau-c flux-pleine"><div class="ligne" style="justify-content:space-between"><h3><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-megaphone"/></svg> ${T('prealertes')}</h3><span class="note">${T('actualise', { h: h(d.genere_le) })}</span></div>
        ${pa.length ? `<ul class="liste-simple">${pa.map((l) => `<li><b>${e(l.reference)}</b> · ${e(l.origine)} → ${e(l.destination || '')}${l.vehicule ? ` · ${e(l.vehicule)}` : ''} · ${l.eta ? T('eta', { h: h(l.eta) }) : T('eta_ind')}${l.preparation ? ` · ${prep(l.preparation)}` : ''}
          ${l.actions.includes('accuser_prealerte') ? ` <button class="btn pri" data-pa-accuser="${e(l.cle)}">${T('accuser')}</button>` : l.prealerte?.recue_le ? ` · <svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-check"/></svg> ${T('recue')}` : ''}</li>`).join('')}</ul>` : `<p class="note">${T('aucune_pa')}</p>`}</section>`;
    const dansZone = o.prealertesDans;
    if (dansZone) dansZone.innerHTML = htmlPa.replace('<section class="panneau-c flux-pleine">', '<div class="acc-pa">').replace(/<\/section>\s*$/, '</div>');
    zone.innerHTML = `<div class="flux-accueil">
      ${dansZone ? '' : htmlPa}
      <section class="panneau-c"><div class="ligne" style="justify-content:space-between"><h3><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-arrow-right-left"/></svg> ${T('prochains')}</h3><button class="btn" data-flux-tout>${T('voir_flux')}</button></div>
        ${proch.length ? `<ul class="liste-simple">${proch.map((l) => `<li>${l.mouvement === 'arrivee' ? '<svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-arrow-down-right"/></svg>' : '<svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-arrow-up-right"/></svg>'} <b>${e(l.reference)}</b> · ${e(l.mouvement === 'arrivee' ? l.origine : l.destination || '')} · ${l.prevue ? h(l.prevue) : '—'} · ${badge(l.statut, l.retard)}</li>`).join('')}</ul>` : `<p class="note">${T('aucun')}</p>`}</section>
      ${b && b.places ? `<section class="panneau-c"><div class="ligne" style="justify-content:space-between"><h3><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-bed-double"/></svg> ${T('bourse')}</h3><button class="btn" data-flux-bourse>${T('voir_bourse')}</button></div>
        ${b.places.length ? `<ul class="liste-simple">${b.places.slice(0, 6).map((p) => `<li><b>${e(p.nom)}</b>${p.type ? ` · ${e(p.type)}` : ''} · ${T('lits_libres', { n: p.lits_libres ?? 0 })}${p.libres !== p.lits_libres ? ` · ${T('declarees', { n: p.libres })}` : ''}${p.a_venir ? ` · ${T('a_venir', { n: p.a_venir })}` : ''}${p.distance_km != null ? ` · ${p.distance_km} km` : ''}</li>`).join('')}</ul>` : `<p class="note">${T('aucune_place')}</p>`}
        <p class="note">${T('bourse_note')}</p></section>` : ''}</div>`;
    zone.querySelector('[data-flux-bourse]')?.addEventListener('click', () => o.ouvrir?.('bourse'));
    zone.querySelector('[data-flux-tout]')?.addEventListener('click', () => o.ouvrir?.('flux'));
    [...zone.querySelectorAll('[data-pa-accuser]'), ...(dansZone ? dansZone.querySelectorAll('[data-pa-accuser]') : [])].forEach((b) => { b.onclick = async () => { const l = d.mouvements.find((x) => x.cle === b.dataset.paAccuser); try { await accuser(o, l); o.toast?.(T('fait')); } catch (err) { o.toast?.(err.message, true); } panneau(zone, o); }; });
  }
  window.ArrimoFluxVue = { afficher, panneau };
})();
