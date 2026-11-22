/* Accueil universel (cahier directeur, 21-22 nov. 2026) : UN moteur d'affichage pour tous les établissements et rôles.
   Zones : A identité (bandeau) · B situation compacte + 4 à 6 indicateurs cliquables · C Arrimo Flux | Bourse des places
   · D Chrono (hôpital, module actif) · E Préalertes et priorités · F Mes tâches · G Prévisions compactes.
   Chaque zone n'apparaît que si elle est pertinente (type, rôle, modules, données) ; aucune donnée inventée ; détails dans les modules. */
(() => {
  const TXT = {
    fr: { situation: 'Situation :', niveau: { vert: 'Niveau vert', jaune: 'Niveau jaune', orange: 'Niveau orange', rouge: 'Niveau rouge' }, pourquoi: 'Pourquoi ce niveau ? (OG)', calcule: 'Calculé à {h}',
      vue: 'Vue d’ensemble', chrono: 'Chrono · ambulances à la porte', a_porte: 'À la porte', attente_max: 'Attente la plus longue', moyen: 'Délai moyen aujourd’hui (H11→H14)', depasse: 'Au-delà du seuil ({s} min)', en_route: 'Annoncées en route',
      ouvrir_chrono: 'Ouvrir Chrono', min: '{n} min', aucune_porte: 'Aucune ambulance à la porte.', priorites: 'Préalertes et priorités', voir_tout: 'Tout voir', aucune_priorite: 'Aucune priorité en attente.',
      taches: 'Mes tâches', ouvrir_taches: 'Ouvrir Mes tâches', a_faire: 'à faire', en_cours: 'en cours', retard: 'en retard', aucune_tache: 'Aucune tâche ouverte pour vous.', attribuer: 'Attribuer', file: 'File du rôle (non attribuée)', non_attr: 'Non attribuées : {n}', attribuee: 'Tâche attribuée.', a_qui: 'Attribuer à', previsions: 'Prévisions',
      prev_ligne: 'Dans {h} h : ~{n} lits libres (± {m})', prev_risque: 'risque de saturation : {u}', prev_note: 'Estimation sur {s} semaines d’historique : une projection, pas une certitude.', details: 'Analyse détaillée d’OG (recommandations, plans, réseau, capacités)', donnees: 'Données lues à {h}', supervision: 'Mode supervision', quitter_supervision: 'Quitter la supervision' },
    en: { situation: 'Status:', niveau: { vert: 'Green level', jaune: 'Yellow level', orange: 'Orange level', rouge: 'Red level' }, pourquoi: 'Why this level? (OG)', calcule: 'Computed at {h}',
      vue: 'Overview', chrono: 'Chrono · ambulances at the door', a_porte: 'At the door', attente_max: 'Longest wait', moyen: 'Average time today (H11→H14)', depasse: 'Over threshold ({s} min)', en_route: 'Announced on the way',
      ouvrir_chrono: 'Open Chrono', min: '{n} min', aucune_porte: 'No ambulance at the door.', priorites: 'Pre-alerts and priorities', voir_tout: 'See all', aucune_priorite: 'No pending priority.',
      taches: 'My tasks', ouvrir_taches: 'Open My tasks', a_faire: 'to do', en_cours: 'in progress', retard: 'overdue', aucune_tache: 'No open task for you.', attribuer: 'Assign', file: 'Role queue (unassigned)', non_attr: 'Unassigned: {n}', attribuee: 'Task assigned.', a_qui: 'Assign to', previsions: 'Forecasts',
      prev_ligne: 'In {h} h: ~{n} free beds (± {m})', prev_risque: 'saturation risk: {u}', prev_note: 'Estimate based on {s} weeks of history: a projection, not a certainty.', details: 'OG detailed analysis (recommendations, plans, network, capacity)', donnees: 'Data read at {h}', supervision: 'Wall display mode', quitter_supervision: 'Leave wall display' },
  };
  const e = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = () => ((document.documentElement.lang || '').startsWith('en') ? 'en' : 'fr');
  const X = () => TXT[L()]; const T = (k, v = {}) => e(String(k.split('.').reduce((o, x) => o?.[x], X()) ?? k).replace(/\{(\w+)\}/g, (m, y) => v[y] ?? m));
  const h = (d) => new Date(d).toLocaleTimeString(L() === 'en' ? 'en-CA' : 'fr-CA', { hour: '2-digit', minute: '2-digit' });

  /** Zone B : situation (niveau) compacte et 4 à 6 indicateurs ; un clic ouvre l'écran (ou les détails du niveau). */
  function vueEnsemble(o) {
    const n = o.niveau; const kpis = (o.kpis || []).filter((k) => k && k.val != null).slice(0, 6);
    return `<section class="acc-vue" aria-label="${T('vue')}"><div class="acc-vue-tete"><h3>${T('vue')}</h3>
      <div class="ligne">${n ? `<button type="button" class="acc-niveau n-${e(n.code)}" data-acc-niveau aria-expanded="false"><span class="pastille-niveau" aria-hidden="true"></span>${T('situation')} <b>${T(`niveau.${n.code}`)}</b></button>` : ''}
      <button type="button" class="btn" data-acc-supervision aria-pressed="${document.body.classList.contains('supervision')}">🖥 ${T(document.body.classList.contains('supervision') ? 'quitter_supervision' : 'supervision')}</button></div></div>
      ${n ? `<div class="acc-niveau-details" hidden>${n.details || ''}<p class="note">${n.le ? T('calcule', { h: h(n.le) }) : ''}</p><button type="button" class="btn" data-acc-og="${e(n.question)}">${T('pourquoi')}</button></div>` : ''}
      <div class="acc-kpis">${kpis.map((k) => `<${k.aller ? `button type="button" data-acc-aller="${e(k.aller)}"` : 'div'} class="acc-kpi${k.ton ? ` ${k.ton}` : ''}"><span class="v num">${e(k.val)}</span><span class="lbl">${e(k.lib)}</span>${k.note ? `<span class="note">${e(k.note)}</span>` : ''}</${k.aller ? 'button' : 'div'}>`).join('')}</div></section>`;
  }
  /** Zone D : Chrono compact, d'après le moteur Chrono existant (passages réels, seuils configurés). */
  async function chrono(zone, o) {
    let c; try { c = await o.api('GET', `/chrono?etablissement_id=${o.etablissement_id}`); } catch { zone.remove(); return; }
    const seuil = c.cibles?.porte || 20; const porte = c.a_la_porte || [];
    const attente = porte.map((p) => p.a_la_porte_min).filter((x) => x != null);
    const auj = (c.termines || []).filter((p) => p.durees?.porte != null);
    const moyen = auj.length ? Math.round(auj.reduce((s, p) => s + p.durees.porte, 0) / auj.length) : null;
    const dep = attente.filter((m) => m > seuil).length;
    zone.innerHTML = `<section class="panneau-c acc-chrono"><div class="ligne" style="justify-content:space-between"><h3>⏱ ${T('chrono')}</h3><button class="btn" type="button" data-acc-aller="chrono">${T('ouvrir_chrono')}</button></div>
      <div class="acc-mini">${[[T('a_porte'), porte.length, porte.length ? 'alerte' : ''], [T('attente_max'), attente.length ? T('min', { n: Math.max(...attente) }) : '—', dep ? 'alerte' : ''], [T('depasse', { s: seuil }), dep, dep ? 'alerte' : ''],
        [T('moyen'), moyen != null ? T('min', { n: moyen }) : '—'], [T('en_route'), (c.en_route || []).length]].map(([l, v, ton]) => `<div class="acc-mini-k${ton ? ` ${ton}` : ''}"><b class="num">${e(v)}</b><span>${l}</span></div>`).join('')}</div>
      ${porte.length ? `<ul class="liste-simple">${porte.slice(0, 3).map((p) => `<li><b>${e(p.unite || p.unite_numero || p.numero)}</b> · ${T('min', { n: p.a_la_porte_min ?? '—' })}${p.a_la_porte_min > seuil ? ' ⚠' : ''}</li>`).join('')}</ul>` : `<p class="note">${T('aucune_porte')}</p>`}</section>`;
    lier(zone, o);
  }
  /** Zone F : Mes tâches (moteur unique des tâches : celles de mon rôle ou à mon nom). */
  async function taches(zone, o) {
    let l; try { l = await o.api('GET', `/taches/miennes?etablissement_id=${o.etablissement_id}`); } catch { zone.remove(); return; }
    const ouvertes = l.taches || []; const now = Date.now();
    const n = (f) => ouvertes.filter(f).length;
    zone.innerHTML = `<section class="panneau-c acc-taches"><div class="ligne" style="justify-content:space-between"><h3>✔ ${T('taches')}</h3><button class="btn" type="button" data-acc-aller="mes-taches">${T('ouvrir_taches')}</button></div>
      ${ouvertes.length ? `<p class="note">${n((x) => x.statut === 'a_faire')} ${T('a_faire')} · ${n((x) => x.statut === 'en_cours')} ${T('en_cours')} · <b>${n((x) => x.echeance && new Date(x.echeance).getTime() < now)} ${T('retard')}</b></p>
        ${l.non_attribuees ? `<p class="note">${T('non_attr', { n: l.non_attribuees })}</p>` : ''}
        <ul class="liste-simple">${ouvertes.slice(0, l.personnel ? 8 : 4).map((x) => `<li><b>${e(x.lieu || '')}</b> ${e(x.titre)}${x.echeance ? ` · ${h(x.echeance)}` : ''}${x.assigne_nom ? ` · <span class="note">${e(x.assigne_nom)}</span>` : ''}
          ${l.personnel && x.source === 'tache' ? `<span class="ligne acc-attrib"><label class="sr-only" for="acc-at-${x.id}">${T('a_qui')}</label><select id="acc-at-${x.id}"><option value="">${T('file')}</option>${l.personnel.filter((p) => !x.assigne_role || p.role === x.assigne_role || ['coordonnateur', 'admin_etab', 'gestionnaire'].includes(p.role)).map((p) => `<option value="${p.id}"${p.id === x.assigne_a ? ' selected' : ''}>${e(p.nom)}</option>`).join('')}</select><button class="btn" type="button" data-acc-attribuer="${x.id}">${T('attribuer')}</button></span>` : ''}</li>`).join('')}</ul>` : `<p class="note">${T('aucune_tache')}</p>`}</section>`;
    zone.querySelectorAll('[data-acc-attribuer]').forEach((bt) => { bt.onclick = async () => {
      const id = bt.dataset.accAttribuer; const val = zone.querySelector(`#acc-at-${id}`).value;
      try { await o.api('POST', `/taches/${id}/attribuer`, { utilisateur_id: val ? Number(val) : null }); o.toast?.(T('attribuee')); taches(zone, o); } catch (err) { o.toast?.(err.message, true); }
    }; });
    lier(zone, o);
  }
  /** Zone G : prévisions compactes (moteur de prévision existant ; horizon et marge affichés). */
  function previsions(p) {
    if (!p || !p.horizons?.length) return '';
    const lignes = p.horizons.slice(0, 3).map((hh) => { const tot = p.unites.reduce((s, u) => s + (u.horizons[hh]?.libres_prevus || 0), 0); const m = p.unites.reduce((s, u) => s + (u.horizons[hh]?.marge || 0), 0); return `<li>${T('prev_ligne', { h: hh, n: Math.round(tot), m: Math.round(m) })}</li>`; });
    const risques = p.unites.filter((u) => p.horizons.some((hh) => u.horizons[hh]?.sature || u.horizons[hh]?.risque)).map((u) => u.type_nom);
    return `<section class="panneau-c acc-prev"><h3>📈 ${T('previsions')}</h3><ul class="liste-simple">${lignes.join('')}</ul>${risques.length ? `<p><b>${T('prev_risque', { u: risques.join(', ') })}</b></p>` : ''}<p class="note">${T('prev_note', { s: p.semaines })}</p></section>`;
  }
  function lier(zone, o) {
    zone.querySelectorAll('[data-acc-aller]').forEach((b) => { b.onclick = () => o.ouvrir?.(b.dataset.accAller); });
  }
  /**
   * Construit l'Accueil dans v. o = { api, etablissement_id, ouvrir, toast, modale, bourse, bandeau (html), niveau, kpis, chrono (bool),
   *   priorites ([{ texte, aller }]), previsions (objet du moteur), taches (bool), details (Node : ancien contenu, replié) }.
   */
  async function construire(v, o) {
    const details = o.details;
    v.innerHTML = `${o.bandeau || ''}${vueEnsemble(o)}<div id="acc-flux"></div>
      <div class="acc-grille">${o.chrono ? '<div id="acc-chrono"></div>' : ''}<section class="panneau-c acc-priorites"><div class="ligne" style="justify-content:space-between"><h3>📣 ${T('priorites')}</h3></div><div id="acc-prealertes"></div>
        ${(o.priorites || []).length ? `<ul class="liste-simple">${o.priorites.slice(0, 3).map((p) => `<li>${p.aller ? `<button type="button" class="lien" data-acc-aller="${e(p.aller)}">${e(p.texte)}</button>` : e(p.texte)}</li>`).join('')}</ul>` : ''}</section>
        ${o.taches ? '<div id="acc-taches"></div>' : ''}${previsions(o.previsions)}</div>`;
    if (details) { const d = document.createElement('details'); d.className = 'panneau-c acc-details'; d.innerHTML = `<summary><b>${T('details')}</b></summary>`; d.appendChild(details); v.appendChild(d);
      // L'analyse détaillée garde son état (ouverte ou repliée) d'une actualisation à l'autre
      d.open = window.__accDetailsOuvert === true; d.addEventListener('toggle', () => { window.__accDetailsOuvert = d.open; }); }
    lier(v, o);
    // Mode supervision (écran mural) : plein écran, gros caractères, actualisation chaque minute ; rien de personnel (bandeau, tâches, détails masqués)
    v.querySelector('[data-acc-supervision]')?.addEventListener('click', () => {
      const actif = document.body.classList.toggle('supervision');
      if (actif) { document.documentElement.requestFullscreen?.().catch(() => {}); window.__supervision = setInterval(() => { if (document.visibilityState === 'visible') o.rafraichir?.(); }, 60000); }
      else { clearInterval(window.__supervision); if (document.fullscreenElement) document.exitFullscreen?.(); }
      o.rafraichir?.();
    });
    const nb = v.querySelector('[data-acc-niveau]');
    if (nb) nb.onclick = () => { const p = v.querySelector('.acc-niveau-details'); p.hidden = !p.hidden; nb.setAttribute('aria-expanded', String(!p.hidden)); };
    v.querySelector('[data-acc-og]')?.addEventListener('click', (ev) => { const q = ev.currentTarget.dataset.accOg; document.querySelector('#og-open')?.click(); setTimeout(() => { const i = document.querySelector('#og-question'); if (i) { i.value = q; i.form?.requestSubmit(); } }, 400); });
    // Zones alimentées par les modules (en parallèle, chacune se retire proprement si son module est absent)
    const travaux = [];
    if (window.ArrimoFluxVue) travaux.push(window.ArrimoFluxVue.panneau(v.querySelector('#acc-flux'), { ...o, prealertesDans: v.querySelector('#acc-prealertes') }));
    if (o.chrono) travaux.push(chrono(v.querySelector('#acc-chrono'), o));
    if (o.taches) travaux.push(taches(v.querySelector('#acc-taches'), o));
    await Promise.all(travaux.map((p) => p.catch(() => {})));
  }
  window.ArrimoAccueil = { construire };
})();
