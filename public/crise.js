/* Mode crise (20 nov. 2026, cahier v2, C.7) : déclencher une évacuation, places libres de la région en un écran, un lieu proposé par
   résident (à confirmer), départ, arrivée, retour planifié, familles avisées, levée. Textes FR/EN propres à ce fichier (aussi utilisé
   par la page de la direction régionale). */
(() => {
  const TXT = {
    fr: { titre: 'Mode crise · évacuation', intro: 'Arrimo propose un lieu par résident (proximité d’abord) ; une personne confirme. La place est réservée par les règles des lits ; les familles sont avisées sans détail.',
      declencher: 'Déclencher une évacuation', motif: 'Motif', aucune: 'Aucune évacuation en cours.', en_cours: 'Évacuation {numero} en cours ({motif})', lever: 'Lever l’évacuation', levee_ok: 'Évacuation levée.',
      resume: '{total} résidents · {a_placer} à placer · {confirmes} confirmés · {partis} en route · {arrives} arrivés · {familles} familles avisées', places: 'Places libres de la région',
      resident: 'Résident', propose: 'Lieu proposé', aucun_lieu: 'aucune place libre', confirmer: 'Confirmer', depart: 'Départ', arrivee: 'Arrivé', retour: 'Planifier le retour', revenu: 'Revenu',
      statut: 'Étape', lit: 'lit {lit}', mode: 'Transport', confirme_lieu: 'Confirmer {lieu} ?', retour_date: 'Retour prévu le', fait: 'Étape enregistrée.', etablissement: 'Établissement',
      m: { incendie: 'Incendie', inondation: 'Inondation', panne_electrique: 'Panne électrique', panne_chauffage: 'Panne de chauffage', contamination: 'Contamination', autre: 'Autre' },
      s: { a_placer: 'En attente', confirme: 'Lieu affecté', parti: 'Parti', arrive: 'Arrivé', accueilli: 'Accueilli', retour_planifie: 'Retour planifié', revenu: 'Revenu' },
      t: { ambulance: 'Ambulance', transport_adapte: 'Transport adapté', famille: 'Famille', autre: 'Autre' },
      gravite: 'Gravité', g: { moderee: 'Modérée', elevee: 'Élevée', critique: 'Critique' }, unites: 'Unités touchées', point: 'Point de rassemblement', simulation: 'Simulation (aucune alerte, réservation ni notification réelle)',
      apercu: 'Voir les lieux proposés', recap: 'Récapitulatif avant déclenchement', recap_txt: '{n} résidents · {p} places libres dans la région · {s} sans lieu proposé', alertes_prevues: 'Acteurs qui seront alertés', modifier: 'Modifier',
      confirmer_final: 'Confirmer et déclencher l’évacuation', confirmer_final_sim: 'Confirmer et lancer la simulation', aucune_alerte: 'Aucun service de secours connecté : prévenez-les directement.', urgence_911: 'Danger immédiat : appelez d’abord le 911. Arrimo ne remplace pas les appels d’urgence.',
      bandeau_sim: 'SIMULATION — aucune alerte, réservation ni notification réelle', alertes: 'Alertes aux secours', a_st: { envoyee: 'Alerte envoyée', recue: 'Alerte reçue', acceptee: 'Mission acceptée', vehicule_affecte: 'Véhicule affecté', refusee: 'Refusée', escaladee: 'Sans réponse : escaladée', cloturee: 'Close' },
      accueilli: 'Accueil confirmé', changer: 'Changer de destination', nouvelle_dest: 'Nouvelle destination', annuler_depart: 'Transport annulé', rapport: 'Rapport post-incident', rapport_txt: 'Résidents : {n} · accueil confirmé : {a} · sans accueil confirmé : {s} · changements de destination : {c} · transports annulés : {t} · familles avisées : {f}', rapport_durees: 'Déclenchement → premier départ : {p} min · → dernier accueil confirmé : {d} min', lever_confirmer: 'Confirmer la levée', coordination: 'Coordination', transport: 'Transport', unite: 'unité {u}', eta: 'arrivée dans {n} min' },
    en: { titre: 'Crisis mode · evacuation', intro: 'Arrimo proposes a place per resident (nearest first); a person confirms. The place is reserved by the bed rules; families are notified without details.',
      declencher: 'Start an evacuation', motif: 'Reason', aucune: 'No evacuation in progress.', en_cours: 'Evacuation {numero} in progress ({motif})', lever: 'Lift the evacuation', levee_ok: 'Evacuation lifted.',
      resume: '{total} residents · {a_placer} to place · {confirmes} confirmed · {partis} on the way · {arrives} arrived · {familles} families notified', places: 'Free places in the region',
      resident: 'Resident', propose: 'Proposed place', aucun_lieu: 'no free place', confirmer: 'Confirm', depart: 'Departure', arrivee: 'Arrived', retour: 'Plan the return', revenu: 'Returned',
      statut: 'Step', lit: 'bed {lit}', mode: 'Transport', confirme_lieu: 'Confirm {lieu}?', retour_date: 'Expected return on', fait: 'Step recorded.', etablissement: 'Facility',
      m: { incendie: 'Fire', inondation: 'Flood', panne_electrique: 'Power outage', panne_chauffage: 'Heating failure', contamination: 'Contamination', autre: 'Other' },
      s: { a_placer: 'Waiting', confirme: 'Place assigned', parti: 'Left', arrive: 'Arrived', accueilli: 'Received', retour_planifie: 'Return planned', revenu: 'Returned' },
      t: { ambulance: 'Ambulance', transport_adapte: 'Adapted transport', famille: 'Family', autre: 'Other' },
      gravite: 'Severity', g: { moderee: 'Moderate', elevee: 'High', critique: 'Critical' }, unites: 'Units affected', point: 'Assembly point', simulation: 'Simulation (no real alert, reservation or notification)',
      apercu: 'See the suggested places', recap: 'Summary before starting', recap_txt: '{n} residents · {p} free places in the region · {s} with no suggested place', alertes_prevues: 'Services that will be alerted', modifier: 'Edit',
      confirmer_final: 'Confirm and start the evacuation', confirmer_final_sim: 'Confirm and start the simulation', aucune_alerte: 'No emergency service connected: contact them directly.', urgence_911: 'Immediate danger: call 911 first. Arrimo does not replace emergency calls.',
      bandeau_sim: 'SIMULATION — no real alert, reservation or notification', alertes: 'Alerts to emergency services', a_st: { envoyee: 'Alert sent', recue: 'Alert received', acceptee: 'Mission accepted', vehicule_affecte: 'Vehicle assigned', refusee: 'Declined', escaladee: 'No answer: escalated', cloturee: 'Closed' },
      accueilli: 'Reception confirmed', changer: 'Change destination', nouvelle_dest: 'New destination', annuler_depart: 'Transport cancelled', rapport: 'Post-incident report', rapport_txt: 'Residents: {n} · reception confirmed: {a} · without confirmed reception: {s} · destination changes: {c} · cancelled transports: {t} · families notified: {f}', rapport_durees: 'Start → first departure: {p} min · → last confirmed reception: {d} min', lever_confirmer: 'Confirm lifting', coordination: 'Coordination', transport: 'Transport', unite: 'unit {u}', eta: 'arriving in {n} min' },
  };
  const e = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** Affiche l'évacuation en cours de l'établissement (ou de la région) dans v. o = { api, langue, etablissement_id, etablissements (direction) }. */
  async function afficher(v, o) {
    const L = o.langue === 'en' ? 'en' : 'fr'; const X = TXT[L]; const T = (k, x = {}) => e(String(X[k]).replace(/\{(\w+)\}/g, (m, y) => x[y] ?? m));
    const liste = await o.api('GET', `/crise/evacuations${o.etablissement_id ? `?etablissement_id=${o.etablissement_id}` : ''}`);
    const active = liste.find((x) => x.statut === 'active');
    const choixEtab = o.etablissements?.length ? `<select id="cr-etab" aria-label="${T('etablissement')}">${o.etablissements.map((x) => `<option value="${x.id}">${e(x.nom)}</option>`).join('')}</select>` : '';
    if (!active) {
      const formulaire = (prec = {}) => {
        v.innerHTML = `<h2>${T('titre')}</h2><p class="note">${T('intro')}</p><p class="bandeau" role="note"><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-triangle-alert"/></svg> ${T('urgence_911')}</p><p>${T('aucune')}</p>
          <form id="cr-form" class="panneau-c"><div class="ligne">${choixEtab}</div>
            <div class="champ"><label class="lbl" for="cr-motif">${T('motif')}</label><select id="cr-motif">${Object.entries(X.m).map(([k, l]) => `<option value="${k}"${prec.motif === k ? ' selected' : ''}>${e(l)}</option>`).join('')}</select></div>
            <div class="champ"><label class="lbl" for="cr-gravite">${T('gravite')}</label><select id="cr-gravite">${Object.entries(X.g).map(([k, l]) => `<option value="${k}"${(prec.gravite || 'elevee') === k ? ' selected' : ''}>${e(l)}</option>`).join('')}</select></div>
            <div class="champ"><label class="lbl" for="cr-unites">${T('unites')}</label><input id="cr-unites" maxlength="300" value="${e(prec.unites_touchees || '')}"></div>
            <div class="champ"><label class="lbl" for="cr-point">${T('point')}</label><input id="cr-point" maxlength="200" value="${e(prec.point_rassemblement || '')}"></div>
            <label class="case"><input type="checkbox" id="cr-sim"${prec.simulation !== false ? ' checked' : ''}> ${T('simulation')}</label>
            <p><button class="btn pri" type="submit">${T('apercu')}</button></p></form><div id="cr-recap"></div>`;
        v.querySelector('#cr-form').onsubmit = async (ev) => {
          ev.preventDefault();
          const corps = { etablissement_id: Number(v.querySelector('#cr-etab')?.value || o.etablissement_id), motif: v.querySelector('#cr-motif').value, gravite: v.querySelector('#cr-gravite').value,
            unites_touchees: v.querySelector('#cr-unites').value, point_rassemblement: v.querySelector('#cr-point').value, simulation: v.querySelector('#cr-sim').checked };
          let a; try { a = await o.api('POST', '/crise/apercu', corps); } catch (err) { v.querySelector('#cr-recap').innerHTML = `<p class="alerte" role="alert">${e(err.message)}</p>`; return; }
          v.querySelector('#cr-recap').innerHTML = `<section class="panneau-c" aria-live="polite"><h3>${T('recap')}</h3>${corps.simulation ? `<p class="bandeau">${T('bandeau_sim')}</p>` : ''}
            <p><b>${e(X.m[corps.motif])} · ${e(X.g[corps.gravite])}</b>${corps.unites_touchees ? ` · ${e(corps.unites_touchees)}` : ''}${corps.point_rassemblement ? ` · ${T('point')} : ${e(corps.point_rassemblement)}` : ''}</p>
            <p>${T('recap_txt', { n: a.residents, p: a.places_libres, s: a.sans_lieu })}</p>
            <div class="tableau"><table><thead><tr><th>${T('resident')}</th><th>${T('propose')}</th></tr></thead><tbody>${a.propositions.map((x) => `<tr><td>${e(x.resident_ref)}</td><td>${x.lieu ? `${e(x.lieu.nom)} · ${x.lieu.distance_km ?? '—'} km` : T('aucun_lieu')}</td></tr>`).join('')}</tbody></table></div>
            <h3>${T('alertes_prevues')}</h3>${a.alertes.length ? `<ul class="liste-simple">${a.alertes.map((x) => `<li>${e(x.organisation)} · ${T(x.role)}</li>`).join('')}</ul>` : `<p class="alerte">${T('aucune_alerte')}</p>`}
            <div class="ligne"><button class="btn" id="cr-modifier" type="button">${T('modifier')}</button><button class="btn dan" id="cr-go" type="button">${T(corps.simulation ? 'confirmer_final_sim' : 'confirmer_final')}</button></div></section>`;
          v.querySelector('#cr-modifier').onclick = () => formulaire(corps);
          v.querySelector('#cr-go').onclick = async () => { try { await o.api('POST', '/crise/evacuations', corps); } catch (err) { alert(err.message); return; } afficher(v, o); };
        };
      };
      formulaire();
      return;
    }
    const d = await o.api('GET', `/crise/evacuations/${active.id}`);
    const btn = (r, a, lib, extra = '') => `<button class="btn${a === 'confirmer' ? ' pri' : ''}" data-cr="${a}" data-r="${r.id}"${extra}>${T(lib)}</button>`;
    // Complémentaire nº 3 : changement de destination (avant l'arrivée) et transport annulé, sans perdre ni doubler le résident
    const changer = (r) => (['confirme', 'parti'].includes(r.statut) && d.places.some((p) => p.id !== r.destination_id)
      ? `<select data-nd="${r.id}" aria-label="${T('nouvelle_dest')}">${d.places.filter((p) => p.id !== r.destination_id).map((p) => `<option value="${p.id}">${e(p.nom)}</option>`).join('')}</select>${btn(r, 'changer_destination', 'changer')}` : '')
      + (r.statut === 'parti' ? btn(r, 'annuler_depart', 'annuler_depart') : '');
    const actions = (r) => changer(r) + (r.statut === 'a_placer' ? (r.proposition ? btn(r, 'confirmer', 'confirmer', ` data-dest="${r.proposition.id}" data-lieu="${e(r.proposition.nom)}"`) : '')
      : r.statut === 'confirme' ? `<select data-mode="${r.id}" aria-label="${T('mode')}">${Object.entries(X.t).map(([k, l]) => `<option value="${k}">${e(l)}</option>`).join('')}</select>${btn(r, 'depart', 'depart')}`
        : r.statut === 'parti' ? btn(r, 'arrivee', 'arrivee') : r.statut === 'arrive' ? `${btn(r, 'accueilli', 'accueilli')}${btn(r, 'planifier_retour', 'retour')}` : r.statut === 'accueilli' ? btn(r, 'planifier_retour', 'retour') : r.statut === 'retour_planifie' ? btn(r, 'revenu', 'revenu') : '');
    const alertes = (d.alertes || []).map((x) => `<li>${e(x.organisation)} · ${T(x.role)} · <b>${e(X.a_st[x.statut])}</b>${x.unite ? ` · ${T('unite', { u: x.unite })}` : ''}${x.eta_min != null ? ` · ${T('eta', { n: x.eta_min })}` : ''}</li>`).join('');
    v.innerHTML = `<h2>${T('titre')}</h2>${d.evacuation.simulation ? `<p class="bandeau" role="note"><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-flask-conical"/></svg> ${T('bandeau_sim')}</p>` : ''}<p class="bandeau" role="status">${T('en_cours', { numero: d.evacuation.numero, motif: X.m[d.evacuation.motif] })} · ${e(d.evacuation.etablissement)}${d.evacuation.gravite ? ` · ${e(X.g[d.evacuation.gravite])}` : ''}</p>
      <section class="panneau-c"><h3>${T('alertes')}</h3>${alertes ? `<ul class="liste-simple">${alertes}</ul>` : `<p class="alerte">${T('aucune_alerte')}</p>`}</section>
      <p>${T('resume', { ...d.resume, familles: d.resume.familles_avisees })}</p>
      <div class="tableau"><table><thead><tr><th>${T('resident')}</th><th>${T('statut')}</th><th>${T('propose')}</th><th></th></tr></thead><tbody>
        ${d.residents.map((r) => `<tr><td>${e(r.resident_ref)}${r.prenom ? ` · <span class="donnee">${e(r.prenom)} ${e(r.nom)}</span>` : ''}</td><td>${e(X.s[r.statut])}${r.destination ? ` · ${e(r.destination)}${r.lit ? ` (${T('lit', { lit: r.lit })})` : ''}` : ''}</td>
          <td>${r.statut === 'a_placer' ? (r.proposition ? `${e(r.proposition.nom)} · ${r.proposition.distance_km ?? '—'} km` : T('aucun_lieu')) : ''}</td><td>${actions(r)}</td></tr>`).join('')}</tbody></table></div>
      <h3>${T('places')}</h3><ul class="liste-simple">${d.places.map((p) => `<li>${e(p.nom)} · ${p.libres} · ${p.distance_km ?? '—'} km</li>`).join('')}</ul>
      <div class="ligne"><button class="btn" id="cr-rapport" type="button">${T('rapport')}</button><button class="btn" id="cr-lever">${T('lever')}</button></div><div id="cr-rapport-zone"></div>`;
    v.querySelector('#cr-rapport').onclick = async () => {
      const r = await o.api('GET', `/crise/evacuations/${active.id}/rapport`).catch((err) => { alert(err.message); return null; }); if (!r) return;
      v.querySelector('#cr-rapport-zone').innerHTML = `<section class="panneau-c"><h3>${T('rapport')} · ${e(r.numero)}</h3>
        <p>${T('rapport_txt', { n: r.residents, a: r.accueil_confirme, s: r.sans_accueil_confirme.length, c: r.changements_destination, t: r.departs_annules, f: r.familles_avisees })}</p>
        <p>${T('rapport_durees', { p: r.durees_min.jusqu_au_premier_depart ?? '—', d: r.durees_min.jusqu_au_dernier_accueil ?? '—' })}</p>
        ${r.sans_accueil_confirme.length ? `<ul class="liste-simple">${r.sans_accueil_confirme.map((x) => `<li>${e(x.resident_ref)} · ${e(X.s[x.statut])}</li>`).join('')}</ul>` : ''}
        <p class="note">${e(r.regle)}</p></section>`;
    };
    v.querySelectorAll('[data-cr]').forEach((b) => { b.onclick = async () => {
      const a = b.dataset.cr; const corps = { action: a };
      if (a === 'confirmer') corps.destination_id = Number(b.dataset.dest);
      if (a === 'changer_destination') corps.destination_id = Number(v.querySelector(`[data-nd="${b.dataset.r}"]`).value);
      if (a === 'depart') corps.transport_mode = v.querySelector(`[data-mode="${b.dataset.r}"]`).value;
      if (a === 'planifier_retour') { const j = prompt(X.retour_date, new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)); if (!j) return; corps.retour_prevu_le = new Date(`${j}T12:00:00`).toISOString(); }
      try { await o.api('POST', `/crise/evacuations/${active.id}/residents/${b.dataset.r}`, corps); } catch (err) { alert(err.message); }
      afficher(v, o);
    }; });
    v.querySelector('#cr-lever').onclick = (ev) => {
      const b = ev.currentTarget;
      if (!b.dataset.arme) { b.dataset.arme = '1'; b.textContent = X.lever_confirmer; b.classList.add('dan'); return; }   // deuxième clic : confirmation explicite
      o.api('POST', `/crise/evacuations/${active.id}/lever`).catch((err) => alert(err.message)).then(() => afficher(v, o));
    };
  }
  window.ArrimoCrise = { afficher, TXT };
})();
