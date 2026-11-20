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
      s: { a_placer: 'À placer', confirme: 'Lieu confirmé', parti: 'En route', arrive: 'Arrivé', retour_planifie: 'Retour planifié', revenu: 'Revenu' },
      t: { ambulance: 'Ambulance', transport_adapte: 'Transport adapté', famille: 'Famille', autre: 'Autre' } },
    en: { titre: 'Crisis mode · evacuation', intro: 'Arrimo proposes a place per resident (nearest first); a person confirms. The place is reserved by the bed rules; families are notified without details.',
      declencher: 'Start an evacuation', motif: 'Reason', aucune: 'No evacuation in progress.', en_cours: 'Evacuation {numero} in progress ({motif})', lever: 'Lift the evacuation', levee_ok: 'Evacuation lifted.',
      resume: '{total} residents · {a_placer} to place · {confirmes} confirmed · {partis} on the way · {arrives} arrived · {familles} families notified', places: 'Free places in the region',
      resident: 'Resident', propose: 'Proposed place', aucun_lieu: 'no free place', confirmer: 'Confirm', depart: 'Departure', arrivee: 'Arrived', retour: 'Plan the return', revenu: 'Returned',
      statut: 'Step', lit: 'bed {lit}', mode: 'Transport', confirme_lieu: 'Confirm {lieu}?', retour_date: 'Expected return on', fait: 'Step recorded.', etablissement: 'Facility',
      m: { incendie: 'Fire', inondation: 'Flood', panne_electrique: 'Power outage', panne_chauffage: 'Heating failure', contamination: 'Contamination', autre: 'Other' },
      s: { a_placer: 'To place', confirme: 'Place confirmed', parti: 'On the way', arrive: 'Arrived', retour_planifie: 'Return planned', revenu: 'Returned' },
      t: { ambulance: 'Ambulance', transport_adapte: 'Adapted transport', famille: 'Family', autre: 'Other' } },
  };
  const e = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** Affiche l'évacuation en cours de l'établissement (ou de la région) dans v. o = { api, langue, etablissement_id, etablissements (direction) }. */
  async function afficher(v, o) {
    const L = o.langue === 'en' ? 'en' : 'fr'; const X = TXT[L]; const T = (k, x = {}) => e(String(X[k]).replace(/\{(\w+)\}/g, (m, y) => x[y] ?? m));
    const liste = await o.api('GET', `/crise/evacuations${o.etablissement_id ? `?etablissement_id=${o.etablissement_id}` : ''}`);
    const active = liste.find((x) => x.statut === 'active');
    const choixEtab = o.etablissements?.length ? `<select id="cr-etab" aria-label="${T('etablissement')}">${o.etablissements.map((x) => `<option value="${x.id}">${e(x.nom)}</option>`).join('')}</select>` : '';
    if (!active) {
      v.innerHTML = `<h2>${T('titre')}</h2><p class="note">${T('intro')}</p><p>${T('aucune')}</p>
        <div class="ligne">${choixEtab}<label class="lbl" for="cr-motif">${T('motif')}</label><select id="cr-motif">${Object.entries(X.m).map(([k, l]) => `<option value="${k}">${e(l)}</option>`).join('')}</select>
        <button class="btn dan" id="cr-declencher">${T('declencher')}</button></div>`;
      v.querySelector('#cr-declencher').onclick = async () => {
        if (!confirm(X.declencher)) return;
        try { await o.api('POST', '/crise/evacuations', { etablissement_id: Number(v.querySelector('#cr-etab')?.value || o.etablissement_id), motif: v.querySelector('#cr-motif').value }); } catch (err) { alert(err.message); }
        afficher(v, o);
      };
      return;
    }
    const d = await o.api('GET', `/crise/evacuations/${active.id}`);
    const btn = (r, a, lib, extra = '') => `<button class="btn${a === 'confirmer' ? ' pri' : ''}" data-cr="${a}" data-r="${r.id}"${extra}>${T(lib)}</button>`;
    const actions = (r) => (r.statut === 'a_placer' ? (r.proposition ? btn(r, 'confirmer', 'confirmer', ` data-dest="${r.proposition.id}" data-lieu="${e(r.proposition.nom)}"`) : '')
      : r.statut === 'confirme' ? `<select data-mode="${r.id}" aria-label="${T('mode')}">${Object.entries(X.t).map(([k, l]) => `<option value="${k}">${e(l)}</option>`).join('')}</select>${btn(r, 'depart', 'depart')}`
        : r.statut === 'parti' ? btn(r, 'arrivee', 'arrivee') : r.statut === 'arrive' ? btn(r, 'planifier_retour', 'retour') : r.statut === 'retour_planifie' ? btn(r, 'revenu', 'revenu') : '');
    v.innerHTML = `<h2>${T('titre')}</h2><p class="bandeau" role="status">${T('en_cours', { numero: d.evacuation.numero, motif: X.m[d.evacuation.motif] })} · ${e(d.evacuation.etablissement)}</p>
      <p>${T('resume', { ...d.resume, familles: d.resume.familles_avisees })}</p>
      <div class="tableau"><table><thead><tr><th>${T('resident')}</th><th>${T('statut')}</th><th>${T('propose')}</th><th></th></tr></thead><tbody>
        ${d.residents.map((r) => `<tr><td>${e(r.resident_ref)}${r.prenom ? ` · <span class="donnee">${e(r.prenom)} ${e(r.nom)}</span>` : ''}</td><td>${e(X.s[r.statut])}${r.destination ? ` · ${e(r.destination)}${r.lit ? ` (${T('lit', { lit: r.lit })})` : ''}` : ''}</td>
          <td>${r.statut === 'a_placer' ? (r.proposition ? `${e(r.proposition.nom)} · ${r.proposition.distance_km ?? '—'} km` : T('aucun_lieu')) : ''}</td><td>${actions(r)}</td></tr>`).join('')}</tbody></table></div>
      <h3>${T('places')}</h3><ul class="liste-simple">${d.places.map((p) => `<li>${e(p.nom)} · ${p.libres} · ${p.distance_km ?? '—'} km</li>`).join('')}</ul>
      <button class="btn" id="cr-lever">${T('lever')}</button>`;
    v.querySelectorAll('[data-cr]').forEach((b) => { b.onclick = async () => {
      const a = b.dataset.cr; const corps = { action: a };
      if (a === 'confirmer') { if (!confirm(X.confirme_lieu.replace('{lieu}', b.dataset.lieu))) return; corps.destination_id = Number(b.dataset.dest); }
      if (a === 'depart') corps.transport_mode = v.querySelector(`[data-mode="${b.dataset.r}"]`).value;
      if (a === 'planifier_retour') { const j = prompt(X.retour_date, new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)); if (!j) return; corps.retour_prevu_le = new Date(`${j}T12:00:00`).toISOString(); }
      try { await o.api('POST', `/crise/evacuations/${active.id}/residents/${b.dataset.r}`, corps); } catch (err) { alert(err.message); }
      afficher(v, o);
    }; });
    v.querySelector('#cr-lever').onclick = async () => { if (!confirm(X.lever)) return; try { await o.api('POST', `/crise/evacuations/${active.id}/lever`); } catch (err) { alert(err.message); } afficher(v, o); };
  }
  window.ArrimoCrise = { afficher, TXT };
})();
