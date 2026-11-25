/* Arrimo Hôpital — Chrono (19 nov. 2026) : ambulances « En route » et « À la porte » avec chrono (vert, orange à 15 min, rouge à 20 min),
   boutons « Début triage » (H12), « Fin triage » (H13), « Civière libérée » (H14), un clic chacun ; « Corriger l'heure » (motif fermé) ;
   rapport mensuel et CSV ; contrôle des écarts. Mêmes heures que l'ambulance et le CCS. Arrimo mesure : aucune prime ni pénalité.
   La couleur n'est jamais seule : le nombre de minutes et le mot sont toujours écrits. */
(() => {
  const K = (k, v) => esc(t(`chrono.${k}`, v));
  const etatC = { mois: new Date().toISOString().slice(0, 7), minuteur: null, filtres: {} };
  const paramsFiltres = (historique = false) => {
    const { heures_historique, ...filtres } = etatC.filtres;
    if (historique && heures_historique) filtres.heures_historique = heures_historique;
    return new URLSearchParams(filtres).toString();
  };
  const ETAPES = ['H11', 'H12', 'H13', 'H14', 'H15'];
  const heureEtape = (h) => (h ? `${heureCourte(h.heure)}${h.corrigee ? ` <span class="note">${K('corrigee')}</span>` : ''}` : '<span class="note">—</span>');

  function lignePorte(p) {
    const n = p.palier === 'critique' ? 'critique' : p.niveau || '';
    return `<article class="ch-porte niveau-${p.niveau || ''}${n === 'critique' ? ' palier-critique' : ''}" data-passage="${p.id}">
      <div class="ch-tete"><strong>${esc(p.unite)}</strong> <span class="note">${esc(p.organisation)}${p.prealerte ? ` · ${esc(p.prealerte)}` : ` · ${K('sans_prealerte')}`}</span>
        ${p.a_la_porte_min != null ? `<span class="ch-minutes" role="timer" aria-label="${K('a_la_porte_depuis', { n: p.a_la_porte_min })}">${K('minutes', { n: p.a_la_porte_min })} · ${K(`niveau_${n}`)}</span>` : ''}</div>
      <ol class="ch-etapes">${ETAPES.map((e) => `<li><span class="ch-code">${e}</span> ${K(`etape_${e}`)} : ${heureEtape(p.heures[e])}</li>`).join('')}</ol>
      <div class="ligne">${p.prochaine ? `<button class="btn pri" data-ch-etape="${p.prochaine}" data-id="${p.id}">${K(`bouton_${p.prochaine}`)}</button>` : ''}
        <button class="btn" data-ch-corriger="${p.id}">${K('corriger')}</button>${(window.ArrimoSillage?.bouton('passage_chrono', p.id) || '')}</div>${window.ArrimoChronoRetards?.champ(p, true) || ''}</article>`;
  }

  async function vueChrono() {
    const v = $('#v-chrono');
    const d = await api('GET', `/chrono?etablissement_id=${etat.ctx}&${paramsFiltres(true)}`);
    if (!d) return;
    const c = d.cibles;
    const attente = d.attente;
    const minute = (n) => n == null ? '—' : K('minutes', { n });
    const tuilesAttente = attente ? [
      { lbl: K('attente_seuil'), val: nb(attente.seuil_atteint), etat: attente.seuil_atteint ? 'critique' : null },
      { lbl: K('attente_moyenne'), val: minute(attente.moyenne_min) },
      { lbl: K('attente_mediane'), val: minute(attente.mediane_min) },
      { lbl: K('attente_cumulee'), val: minute(attente.minutes_cumulees) },
    ].map((x) => tuile(x)).join('') : '';
    v.innerHTML = `<div class="entete"><div><h2>${K('titre')}</h2><p class="note">${K('intro', { porte: c.porte, sortie: c.sortie, total: c.total })}</p>
        <p class="note">${K('indicatif')}${d.actualise_le ? ` · ${K('actualise', { h: heureCourte(d.actualise_le) })}` : ''}</p></div></div>
      <form id="ch-filtres" class="ligne">
        <label>${K('filtre_vehicule')} <input name="vehicule" type="search" maxlength="100" value="${esc(etatC.filtres.vehicule || '')}"></label>
        <label>${K('filtre_organisation')} <input name="organisation" type="search" maxlength="100" value="${esc(etatC.filtres.organisation || '')}"></label>
        <label>${K('filtre_periode')} <select name="heures_historique">${[12, 24, 48, 168].map((h) => `<option value="${h}"${h === d.heures_historique ? ' selected' : ''}>${K('periode_heures', { n: h })}</option>`).join('')}</select></label>
        <button type="submit" class="btn">${K('filtrer')}</button>
      </form>
      <div class="tuiles">${tuile({ lbl: t('chrono.en_route'), val: nb(d.en_route.length) })}${tuile({ lbl: t('chrono.a_la_porte'), val: nb(d.a_la_porte.length),
        etat: d.a_la_porte.some((p) => p.niveau === 'rouge') ? 'critique' : null })}${tuilesAttente}</div>
      <section class="panneau-c"><h3>${K('a_la_porte')}</h3>${d.a_la_porte.length ? d.a_la_porte.map(lignePorte).join('') : `<p class="note">${K('aucune_porte')}</p>`}</section>
      <section class="panneau-c"><h3>${K('en_route')}</h3>${d.en_route.length ? `<ul class="liste-simple">${d.en_route.map((p) => `<li><strong>${esc(p.unite)}</strong> · ${esc(p.organisation)} · ${esc(p.numero)}
        · ${p.eta_min != null ? K('arrive_dans', { n: p.eta_min, km: p.eta_km ?? '—' }) : p.heure_prevue ? K('prevue', { heure: heureCourte(p.heure_prevue) }) : K('heure_inconnue')}</li>`).join('')}</ul>` : `<p class="note">${K('aucune_route')}</p>`}</section>
      <section class="panneau-c"><h3>${K('termines')}</h3>${d.termines.length ? `<div class="tableau"><table><thead><tr><th>${K('unite')}</th>${ETAPES.map((e) => `<th>${e}</th>`).join('')}<th>${K('porte')}</th><th>${K('sortie')}</th><th>${K('total')}</th></tr></thead>
        <tbody>${d.termines.map((p) => `<tr><td>${esc(p.unite)}</td>${ETAPES.map((e) => `<td>${heureEtape(p.heures[e])}</td>`).join('')}<td>${p.durees.porte ?? '—'}</td><td>${p.durees.sortie ?? '—'}</td><td>${p.durees.total ?? '—'}</td></tr>`).join('')}</tbody></table></div>` : `<p class="note">${K('aucun_termine')}</p>`}</section>
      <section class="panneau-c" id="ch-rapport"><h3>${K('rapport')}</h3><div class="ligne"><label class="lbl" for="ch-mois">${K('mois')}</label>
        <input type="month" id="ch-mois" value="${esc(etatC.mois)}"><button class="btn" id="ch-csv">${K('csv')}</button></div><div id="ch-rapport-corps"><p class="note">${K('chargement')}</p></div></section>
      <section class="panneau-c"><h3>${K('ecarts')}</h3><div id="ch-ecarts"></div></section>`;
    v.querySelector('#ch-filtres').onsubmit = (ev) => {
      ev.preventDefault();
      etatC.filtres = Object.fromEntries(new FormData(ev.currentTarget));
      rafraichir();
    };
    v.querySelectorAll('[data-chrono-retard]').forEach((f) => { f.onsubmit = (ev) => {
      ev.preventDefault();
      const motif = new FormData(f).get('motif');
      agir(ev.submitter, () => api('POST', `/chrono/passages/${f.dataset.chronoRetard}/retard`,
        { etablissement_id: etat.ctx, motif, version: Number(f.dataset.version) }), t('chrono.enregistre'));
    }; });
    v.querySelectorAll('[data-ch-etape]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/chrono/passages/${b.dataset.id}/etape`, { etablissement_id: etat.ctx, etape: b.dataset.chEtape }), t('chrono.enregistre')); });
    v.querySelectorAll('[data-ch-corriger]').forEach((b) => { b.onclick = () => corriger(d.a_la_porte.find((p) => p.id === Number(b.dataset.chCorriger))); });
    $('#ch-mois').onchange = (e) => { etatC.mois = e.target.value; rapport(); };
    $('#ch-csv').onclick = async () => {
      const r = await fetch(`/api/chrono/rapport.csv?etablissement_id=${etat.ctx}&mois=${etatC.mois}&${paramsFiltres()}`, { headers: { Authorization: `Bearer ${etat.token}`, 'X-Langue': langue } });
      if (!r.ok) { toast(t('chrono.csv_echec'), true); return; }
      const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a');
      a.href = url; a.download = `arrimo-chrono-${etatC.mois}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    };
    rapport(); ecarts();
    // Le chrono avance seul : la vue se redessine chaque minute tant qu'elle est affichée
    clearTimeout(etatC.minuteur);
    etatC.minuteur = setTimeout(() => { if (etat.vue === 'chrono' && $('#modale').hidden && !document.activeElement?.closest('#ch-filtres, [data-chrono-retard]')) vueChrono(); }, 60000);
  }

  async function rapport() {
    const z = $('#ch-rapport-corps'); if (!z) return;
    const r = await api('GET', `/chrono/rapport?etablissement_id=${etat.ctx}&mois=${etatC.mois}&${paramsFiltres()}`).catch((e) => { z.innerHTML = `<p class="note">${esc(e.message)}</p>`; return null; });
    if (!r) return;
    const ligne = (k) => `<tr><th>${K(k)}</th><td>${r[k].n}</td><td>${r[k].moyenne_min ?? '—'}</td><td>${r[k].mediane_min ?? '—'}</td><td>${r[k].p90_min ?? '—'}</td><td>${r[k].cible_min ?? '—'}</td><td>${r[k].hors_cible_pct ?? '—'}</td></tr>`;
    z.innerHTML = `<p>${K('rapport_resume', { n: r.passages, completude: r.completude_pct ?? '—', corrections: r.corrections })}</p>
      ${r.pilote ? `<p class="note">${K('pilote_observe', { n: r.pilote.passages_mesures, minutes: r.pilote.immobilisation_min ?? '—', depasses: r.pilote.porte_hors_cible })}<br>${K('pilote_mesures', { h: r.pilote.immobilisation_h ?? '—', au_dela: r.pilote.au_dela_cible_min ?? '—', simultanes: r.pilote.simultanes_max ?? 0 })}</p>` : ''}
      <div class="tableau"><table><thead><tr><th></th><th>${K('n')}</th><th>${K('moyenne')}</th><th>${K('mediane')}</th><th>${K('p90')}</th><th>${K('cible')}</th><th>${K('hors_cible')}</th></tr></thead>
      <tbody>${['porte', 'sortie', 'total'].map(ligne).join('')}</tbody></table></div>
      <p class="note">${K('manquantes')} ${ETAPES.map((e) => `${e} : ${r.etapes_manquantes[e]}`).join(' · ')}</p>
      <ul class="liste-simple">${Object.entries(r.motifs_retard || {}).filter(([, n]) => n > 0)
        .map(([motif, n]) => `<li>${esc(window.ArrimoChronoRetards?.libelle(motif) || motif)} · ${nb(n)}</li>`).join('')}</ul>`;
  }
  async function ecarts() {
    const z = $('#ch-ecarts'); if (!z) return;
    const r = await api('GET', `/chrono/ecarts?etablissement_id=${etat.ctx}`).catch(() => null);
    if (!r) return;
    z.innerHTML = r.length ? `<ul class="liste-simple">${r.map((x) => `<li>${esc(x.passage)} · ${esc(x.unite)} · ${x.etape} : ${heureCourte(x.heure)} / ${K('detectee')} ${heureCourte(x.heure_detectee)}
      (${K('ecart', { n: x.ecart_min })})${x.motif ? ` · ${K(`motif_${x.motif}`)}` : ''}</li>`).join('')}</ul>` : `<p class="note">${K('aucun_ecart')}</p>`;
  }
  function corriger(p) {
    if (!p) return;
    const options = ETAPES.map((e) => `<option value="${e}">${e} · ${K(`etape_${e}`)}</option>`).join('');
    const motifs = ['oubli', 'erreur_saisie', 'position_imprecise', 'panne_reseau', 'autre'].map((m) => `<option value="${m}">${K(`motif_${m}`)}</option>`).join('');
    const maintenant = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    modale(t('chrono.corriger_titre', { unite: p.unite }), `<p class="note">${K('corriger_aide')}</p>
      <div class="champ"><label class="lbl" for="chc-etape">${K('etape')}</label><select id="chc-etape">${options}</select></div>
      <div class="champ"><label class="lbl" for="chc-heure">${K('heure')}</label><input type="datetime-local" id="chc-heure" value="${maintenant}"></div>
      <div class="champ"><label class="lbl" for="chc-motif">${K('motif')}</label><select id="chc-motif">${motifs}</select></div>`,
    [{ label: t('general.annuler') }, { label: t('chrono.corriger'), pri: true, run: async () => (await agir(null, () => api('POST', `/chrono/passages/${p.id}/corriger`, {
      etablissement_id: etat.ctx, etape: $('#chc-etape').value, heure: new Date($('#chc-heure').value).toISOString(), motif: $('#chc-motif').value }), t('chrono.corrigee_ok'))) !== null || false }]);
  }
  window.ArrimoChrono = { vues: { chrono: vueChrono } };
})();
