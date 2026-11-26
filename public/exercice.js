/* Exercice de formation isolé (complémentaire nº 3, §9) : bandeau en tête de Vigilance pendant un exercice, en démo et recette seulement.
   Le formateur ouvre l'exercice, injecte des événements d'une liste fermée et le termine ; chacun répond par une action.
   Messages d'exercice seulement : aucun lit, civière, transfert ni connecteur réel n'est modifié. FR/EN. */
(() => {
  const TXT = {
    fr: { titre: 'Exercice de formation', bandeau: 'EXERCICE EN COURS : ces événements sont simulés, aucune donnée réelle n’est modifiée.', ouvrir: 'Ouvrir un exercice', terminer: 'Terminer l’exercice',
      injecter: 'Injecter un événement', repondre: 'Répondre', reponse: 'Action choisie', aucun: 'Aucun événement injecté pour l’instant.', sans_reponse: 'sans réponse',
      delai: 'première réponse après {n} min', rapport: 'Dernier exercice : événements {e} · avec réponse {r} · sans réponse {s} · délai médian {m} min', intro: 'Préparez les équipes sans toucher aux opérations : injectez des situations, mesurez les délais de réponse.',
      t: { afflux_ambulances: 'Afflux d’ambulances annoncé', lit_bloque: 'Lit bloqué par un incident', connecteur_silencieux: 'Connecteur silencieux', evacuation_partielle: 'Évacuation partielle d’une unité',
        transfert_sans_reponse: 'Transfert sans réponse du receveur', penurie_personnel: 'Pénurie de personnel au prochain quart' },
      a: { escalader: 'Escalader', reaffecter: 'Réaffecter une ressource', demander_transfert: 'Demander un transfert', activer_crise: 'Activer le mode crise', informer_reseau: 'Informer le réseau',
        suspendre_connecteur: 'Suspendre le connecteur', rappeler_personnel: 'Rappeler du personnel', aucune_action: 'Aucune action requise' } },
    en: { titre: 'Training exercise', bandeau: 'EXERCISE IN PROGRESS: these events are simulated, no real data is changed.', ouvrir: 'Start an exercise', terminer: 'End the exercise',
      injecter: 'Inject an event', repondre: 'Respond', reponse: 'Chosen action', aucun: 'No event injected yet.', sans_reponse: 'no response',
      delai: 'first response after {n} min', rapport: 'Last exercise: events {e} · answered {r} · unanswered {s} · median delay {m} min', intro: 'Prepare teams without touching operations: inject situations, measure response times.',
      t: { afflux_ambulances: 'Ambulance surge announced', lit_bloque: 'Bed blocked by an incident', connecteur_silencieux: 'Silent connector', evacuation_partielle: 'Partial evacuation of a unit',
        transfert_sans_reponse: 'Transfer with no response from receiver', penurie_personnel: 'Staff shortage on the next shift' },
      a: { escalader: 'Escalate', reaffecter: 'Reassign a resource', demander_transfert: 'Request a transfer', activer_crise: 'Activate crisis mode', informer_reseau: 'Inform the network',
        suspendre_connecteur: 'Suspend the connector', rappeler_personnel: 'Call in staff', aucune_action: 'No action required' } },
  };
  const lire = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const L = () => (lire('arrimo-langue') === 'en' ? 'en' : 'fr'); const X = () => TXT[L()];
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] ?? m));
  async function api(methode, chemin, corps) {
    const r = await fetch(`/api${chemin}`, { method: methode, headers: { Authorization: `Bearer ${lire('arrimo-token')}`, 'X-Langue': L(), ...(corps ? { 'Content-Type': 'application/json' } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
    const d = await r.json().catch(() => null); if (!r.ok) { const e = new Error((d && d.erreur) || r.statusText); e.status = r.status; throw e; } return d;
  }
  const h = (d) => new Date(d).toLocaleTimeString(L() === 'en' ? 'en-CA' : 'fr-CA', { hour: '2-digit', minute: '2-digit' });

  async function panneau(conteneur, etabId) {
    if (!conteneur || !etabId) return;
    let d; try { d = await api('GET', `/formation/exercices?etablissement_id=${Number(etabId)}`); } catch { return; }   // 403 hors démo et recette : rien n'est affiché
    const x = X(); conteneur.querySelector('#exercice-panneau')?.remove();
    const s = document.createElement('section'); s.id = 'exercice-panneau'; s.className = 'panneau-c exercice';
    const ec = d.en_cours; const dernier = d.recents[0];
    if (!ec && !d.formateur) return;
    s.innerHTML = `<h3>${esc(x.titre)}${ec ? ` · ${esc(ec.titre)}` : ''}</h3>
      ${ec ? `<p class="bandeau exercice-bandeau" role="status"><b>${esc(x.bandeau)}</b></p>
        ${ec.evenements.length ? `<ol class="liste-simple">${ec.evenements.map((e) => `<li><b>${esc(x.t[e.type])}</b> · ${esc(h(e.injecte_le))} · ${e.premiere_reponse_min != null ? esc(f(x.delai, { n: e.premiere_reponse_min })) : `<span class="note">${esc(x.sans_reponse)}</span>`}
          ${e.reponses.map((r) => `<div class="note">${esc(x.a[r.action])} · ${esc(r.par)} · ${esc(h(r.le))}</div>`).join('')}
          <form class="ligne" data-exo-repondre="${e.id}"><label class="lbl" for="exo-r-${e.id}">${esc(x.reponse)}</label><select id="exo-r-${e.id}" name="action">${d.actions.map((a) => `<option value="${a}">${esc(x.a[a])}</option>`).join('')}</select>
            <button class="btn pri" type="submit">${esc(x.repondre)}</button></form></li>`).join('')}</ol>` : `<p class="note">${esc(x.aucun)}</p>`}
        ${d.formateur ? `<form class="ligne" data-exo-injecter><label class="lbl" for="exo-type">${esc(x.injecter)}</label><select id="exo-type" name="type">${d.types.map((t) => `<option value="${t}">${esc(x.t[t])}</option>`).join('')}</select>
          <button class="btn" type="submit">${esc(x.injecter)}</button><button class="btn" type="button" data-exo-terminer>${esc(x.terminer)}</button></form>` : ''}`
        : `<p class="note">${esc(x.intro)}</p><button class="btn" type="button" data-exo-ouvrir>${esc(x.ouvrir)}</button>`}
      ${!ec && dernier ? `<p class="note">${esc(f(x.rapport, { e: dernier.synthese.evenements, r: dernier.synthese.avec_reponse, s: dernier.synthese.sans_reponse, m: dernier.synthese.delai_median_min ?? '—' }))}</p>` : ''}`;
    const titre = conteneur.querySelector('.entete'); if (titre) titre.after(s); else conteneur.prepend(s);
    const recharger = () => panneau(conteneur, etabId);
    const erreur = (e) => window.toast?.(e.message, true);
    s.querySelector('[data-exo-ouvrir]')?.addEventListener('click', () => api('POST', '/formation/exercices', { etablissement_id: Number(etabId) }).then(recharger, erreur));
    s.querySelector('[data-exo-terminer]')?.addEventListener('click', () => api('POST', `/formation/exercices/${ec.id}/terminer`).then(recharger, erreur));
    s.querySelector('[data-exo-injecter]')?.addEventListener('submit', (ev) => { ev.preventDefault(); api('POST', `/formation/exercices/${ec.id}/injecter`, { type: new FormData(ev.currentTarget).get('type') }).then(recharger, erreur); });
    s.querySelectorAll('[data-exo-repondre]').forEach((fm) => fm.addEventListener('submit', (ev) => { ev.preventDefault();
      api('POST', `/formation/exercices/${ec.id}/evenements/${fm.dataset.exoRepondre}/repondre`, { action: new FormData(fm).get('action') }).then(recharger, erreur); }));
  }
  window.ArrimoExercice = { panneau, TXT };
})();
