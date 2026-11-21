/* Sillage transversal (22 nov. 2026) : composant commun à tous les modules. Un bouton « Sillage » (data-sillage="objet:id") ouvre
   le parcours de l'objet : objets liés, heures de l'Horloge (source, auteur, corrections), étapes non confirmées ; « Demander à OG »
   pose la question à OG. Vigilance affiche la liste « Parcours à surveiller » (mêmes faits). FR/EN ; aucun texte en dur dans les modules. */
(() => {
  const TXT = {
    fr: { bouton: 'Sillage', titre: 'Sillage · parcours {p}', fermer: 'Fermer', objets: 'Étapes du parcours', chrono: 'Chronologie (Horloge)', aucun: 'Aucune heure enregistrée pour ce parcours.',
      incompletes: 'Étapes non confirmées', autres: '{n} étape(s) liée(s) chez un autre organisme : non montrées.', og: 'Demander à OG d’expliquer', ouvrir: 'Ouvrir dans le module',
      corrigee: 'corrigée', source: { position: 'position', clic: 'clic', connecteur: 'connecteur', systeme: 'système' }, erreur: 'Parcours indisponible.',
      vig_titre: 'Parcours à surveiller', vig_intro: 'Confirmations manquantes, délais dépassés et étapes non confirmées, tous modules confondus. Une ligne par fait ; elle disparaît quand l’étape est faite.',
      vig_rien: 'Rien à surveiller : aucune confirmation manquante ni étape en retard.', chez_partenaire: 'chez le partenaire', depuis: 'depuis {h}',
      codes: { confirmation_manquante: 'Confirmation manquante (délai dépassé)', civiere_au_dela_cible: 'Ambulance à la porte au-delà de la cible', visite_manquee: 'Visite manquée sans suite', transition_incomplete: 'Étape non confirmée', reception_manquante: 'Arrivée non confirmée' },
      o: { prealerte: 'Préalerte', passage_chrono: 'Passage Chrono', transfert: 'Transfert', demande_transport: 'Transport', demande_hebergement: 'Demande d’hébergement', mission_ccs: 'Mission CCS', coordination: 'Coordination', visite: 'Visite', dsn_transition: 'Transition (DSN)' },
      e: { H11: 'Arrivée à l’urgence (H11)', H12: 'Début du triage (H12)', H13: 'Fin du triage (H13)', H14: 'Civière libérée (H14)', H15: 'Départ (H15)', demande: 'Demande', decision: 'Décision',
        depart: 'Départ', arrivee: 'Arrivée', prise_en_charge: 'Prise en charge', remise: 'Remise', reception: 'Réception' },
      q: 'Explique le parcours {n}' },
    en: { bouton: 'Trail', titre: 'Trail · path {p}', fermer: 'Close', objets: 'Path steps', chrono: 'Timeline (Clock)', aucun: 'No time recorded for this path.',
      incompletes: 'Steps not confirmed', autres: '{n} linked step(s) at another organisation: not shown.', og: 'Ask OG to explain', ouvrir: 'Open in the module',
      corrigee: 'corrected', source: { position: 'position', clic: 'click', connecteur: 'connector', systeme: 'system' }, erreur: 'Path unavailable.',
      vig_titre: 'Paths to watch', vig_intro: 'Missing confirmations, passed deadlines and unconfirmed steps, across all modules. One line per fact; it disappears once the step is done.',
      vig_rien: 'Nothing to watch: no missing confirmation or overdue step.', chez_partenaire: 'at the partner', depuis: 'since {h}',
      codes: { confirmation_manquante: 'Missing confirmation (deadline passed)', civiere_au_dela_cible: 'Ambulance at the door beyond target', visite_manquee: 'Missed visit with no follow-up', transition_incomplete: 'Step not confirmed', reception_manquante: 'Arrival not confirmed' },
      o: { prealerte: 'Pre-alert', passage_chrono: 'Chrono visit', transfert: 'Transfer', demande_transport: 'Transport', demande_hebergement: 'Placement request', mission_ccs: 'CCS mission', coordination: 'Coordination', visite: 'Visit', dsn_transition: 'Transition (EHR)' },
      e: { H11: 'Arrival at the ED (H11)', H12: 'Triage start (H12)', H13: 'Triage end (H13)', H14: 'Stretcher released (H14)', H15: 'Departure (H15)', demande: 'Request', decision: 'Decision',
        depart: 'Departure', arrivee: 'Arrival', prise_en_charge: 'Pick-up', remise: 'Handover', reception: 'Reception' },
      q: 'Explain path {n}' },
  };
  const lire = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const L = () => (lire('arrimo-langue') === 'en' ? 'en' : 'fr');
  const X = () => TXT[L()];
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
  const h = (d) => new Date(d).toLocaleString(L() === 'en' ? 'en-CA' : 'fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const secours = () => location.pathname.startsWith('/secours');
  async function api(chemin) {
    const r = await fetch(`/api${chemin}`, { headers: { Authorization: `Bearer ${lire('arrimo-token')}`, 'X-Langue': L() } });
    const d = await r.json().catch(() => null); if (!r.ok || !d) throw new Error((d && d.erreur) || X().erreur); return d;
  }
  /** Bouton à placer dans une ligne de module. */
  const bouton = (objet, id) => `<button type="button" class="btn lien sillage-btn" data-sillage="${esc(objet)}:${Number(id)}">${esc(X().bouton)}</button>`;
  let dlg;
  function panneau() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog'); dlg.id = 'sillage-panneau'; dlg.className = 'sillage-panneau'; dlg.setAttribute('aria-labelledby', 'sillage-titre');
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-sillage-fermer]')) dlg.close();
      const o = e.target.closest('[data-sillage-ecran]'); if (o) { dlg.close(); document.querySelector(`#onglets button[data-v="${o.dataset.sillageEcran}"]`)?.click(); }
      const q = e.target.closest('[data-sillage-og]'); if (q) { dlg.close(); demanderOg(q.dataset.sillageOg); }
    });
    return dlg;
  }
  function demanderOg(numero) {
    const question = f(X().q, { n: numero });
    const champ = document.getElementById('og-question') || document.getElementById('og-q');
    const ouvrir = document.getElementById('og-open');
    if (ouvrir && champ) { ouvrir.click(); setTimeout(() => { champ.value = question; champ.form?.requestSubmit(); }, 150); return; }
    if (champ) { champ.value = question; champ.focus(); }
  }
  async function ouvrir(objet, id) {
    const d = panneau(); const x = X();
    d.innerHTML = `<div class="sillage-corps"><p class="note">…</p></div>`; if (!d.open) d.showModal();
    try {
      const s = await api(`${secours() ? '/secours' : ''}/sillage?objet=${encodeURIComponent(objet)}&id=${Number(id)}`);
      const aOnglet = (v) => v && document.querySelector(`#onglets button[data-v="${v}"]:not([hidden])`);
      d.innerHTML = `<div class="sillage-corps"><header class="sillage-tete"><h2 id="sillage-titre">${esc(f(x.titre, { p: s.parcours }))}</h2><button type="button" class="btn" data-sillage-fermer>${esc(x.fermer)}</button></header>
        <h3>${esc(x.objets)}</h3><ol class="sillage-objets">${s.objets.map((o) => `<li><span class="badge">${esc(x.o[o.objet] || o.objet)}</span> <b>${esc(o.numero)}</b> · ${esc(String(o.statut).replaceAll('_', ' '))}${o.lieu ? ` · <span class="note">${esc(o.lieu)}</span>` : ''}
          ${aOnglet(o.ecran) && !(o.objet === objet && o.id === Number(id)) ? ` <button type="button" class="btn lien" data-sillage-ecran="${esc(o.ecran)}">${esc(x.ouvrir)}</button>` : ''}</li>`).join('')}</ol>
        <h3>${esc(x.chrono)}</h3>${s.evenements.length ? `<ol class="sillage-fil">${s.evenements.map((e) => `<li><time>${esc(h(e.heure))}</time><div><b>${esc(x.e[e.etape] || e.etape)}</b> · ${esc(e.numero)}
          <div class="note">${esc(x.source[e.source] || e.source)}${e.auteur ? ` · ${esc(e.auteur)}` : ''}${e.lieu ? ` · ${esc(e.lieu)}` : ''}${e.corrigee ? ` · <span class="badge">${esc(x.corrigee)}</span>` : ''}</div></div></li>`).join('')}</ol>` : `<p class="note">${esc(x.aucun)}</p>`}
        ${s.incompletes.length ? `<div class="sillage-manques" role="status"><b>${esc(x.incompletes)}</b> : ${s.incompletes.map((m) => `${esc(m.numero)} · ${esc(x.e[m.etape] || m.etape)}`).join(' ; ')}</div>` : ''}
        ${s.autres_organismes ? `<p class="note">${esc(f(x.autres, { n: s.autres_organismes }))}</p>` : ''}
        <div class="ligne"><button type="button" class="btn pri" data-sillage-og="${esc(s.objets.find((o) => o.objet === objet && o.id === Number(id))?.numero || s.parcours)}">${esc(x.og)}</button></div></div>`;
      d.querySelector('[data-sillage-fermer]')?.focus();
    } catch (err) { d.innerHTML = `<div class="sillage-corps"><p class="note" role="alert">${esc(err.message)}</p><button type="button" class="btn" data-sillage-fermer>${esc(x.fermer)}</button></div>`; }
  }
  /** Vigilance : « Parcours à surveiller », en tête de l'écran. */
  async function vigilance(conteneur, etabId) {
    if (!conteneur || !etabId) return;
    const x = X(); let a;
    try { a = await api(`/sillage/attention?etablissement_id=${Number(etabId)}`); } catch { return; }
    conteneur.querySelector('#sillage-vigilance')?.remove();
    const s = document.createElement('section'); s.id = 'sillage-vigilance'; s.className = 'panneau-c';
    s.innerHTML = `<h3>${esc(x.vig_titre)} <span class="badge">${a.total}</span></h3><p class="note">${esc(x.vig_intro)}</p>
      ${a.items.length ? `<ul class="liste-simple">${a.items.map((i) => `<li><b>${esc(i.numero || '')}</b> · ${esc(x.codes[i.code] || i.code)}${i.etapes ? ` (${i.etapes.map((e) => esc(x.e[e] || e)).join(', ')})` : ''}${i.depuis ? ` · <span class="note">${esc(f(x.depuis, { h: h(i.depuis) }))}</span>` : ''}${i.chez_nous ? '' : ` · <span class="note">${esc(x.chez_partenaire)}</span>`} ${bouton(i.objet, i.id)}</li>`).join('')}</ul>` : `<p class="note">${esc(x.vig_rien)}</p>`}`;
    const titre = conteneur.querySelector('.entete, h2'); if (titre) (titre.closest('.entete') || titre).after(s); else conteneur.prepend(s);
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-sillage]'); if (!b) return; e.preventDefault(); const [o, i] = b.dataset.sillage.split(':'); ouvrir(o, i); });
  window.ArrimoSillage = { ouvrir, bouton, vigilance, TXT };
})();
