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

  /* Chronomètres circulaires et sons (cahier 11, maquette validée) : anneau = temps à la porte / référence MSSS, repère de l'objectif Arrimo ;
     orange : un son bref ; rouge : pulsation lente + son prioritaire répété tant qu'il n'est pas acquitté. Couleur jamais seule (minutes et mot écrits). */
  const ls = { lire: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, ecrire: (k, v) => { try { localStorage.setItem(k, v); } catch { /* indisponible */ } } };
  const sonActif = () => ls.lire('arrimo-chrono-son') !== '0';
  const sons = { vus: new Map(), acquittes: new Set() };
  function ton(freq, duree, debut = 0) {
    try {
      const ac = sons.ac || (sons.ac = new (window.AudioContext || window.webkitAudioContext)()); const o = ac.createOscillator(); const g = ac.createGain();
      o.frequency.value = freq; g.gain.value = 0.12; o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + debut); o.stop(ac.currentTime + debut + duree);
    } catch { /* son indisponible */ }
  }
  function alertesSonores(passages) {
    if (!sonActif()) return;
    let orange = false; let rouge = false;
    for (const p of passages) {
      const avant = sons.vus.get(p.id); sons.vus.set(p.id, p.niveau);
      if (p.niveau === 'orange' && avant !== 'orange' && avant !== 'rouge') orange = true;
      if (p.niveau === 'rouge' && !sons.acquittes.has(p.id)) rouge = true;
    }
    if (rouge) { ton(988, 0.25); ton(740, 0.25, 0.3); ton(988, 0.25, 0.6); } else if (orange) ton(660, 0.2);
  }
  function anneau(p) {
    if (p.a_la_porte_min == null) return '';
    const ref = p.cibles.porte; const obj = p.arrimo?.remise?.cible_min;
    const r = 26; const tour = 2 * Math.PI * r; const frac = Math.min(1, p.a_la_porte_min / ref);
    const coul = { vert: '#16A34A', orange: '#F59E0B', rouge: '#DC2626' }[p.niveau] || '#94A3B8';
    const repere = obj ? (obj / ref) * 360 - 90 : null;
    const pulse = p.niveau === 'rouge' && !sons.acquittes.has(p.id) ? ' pulse' : '';
    return `<span class="ch-anneau${pulse}" data-h11="${esc(p.heures.H11?.heure || '')}" data-ref="${ref}" role="img" aria-label="${K('anneau_label', { n: p.a_la_porte_min, ref, obj: obj ?? '—' })}">
      <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" focusable="false"><circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--bordure)" stroke-width="6"/>
        <circle class="arc" cx="32" cy="32" r="${r}" fill="none" stroke="${coul}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(frac * tour).toFixed(1)} ${tour.toFixed(1)}" transform="rotate(-90 32 32)"/>
        ${repere != null && obj < ref ? `<line x1="32" y1="3" x2="32" y2="10" stroke="var(--texte)" stroke-width="2" transform="rotate(${(repere + 90).toFixed(1)} 32 32)"/>` : ''}
        <text x="32" y="36" text-anchor="middle" font-size="15" font-weight="700" fill="var(--texte)" class="min">${p.a_la_porte_min}</text></svg>
      <span class="note">${K('anneau_obj', { obj: obj ?? '—', ref })}</span></span>`;
  }
  function lignePorte(p) {
    const n = p.palier === 'critique' ? 'critique' : p.niveau || '';
    return `<article class="ch-porte niveau-${p.niveau || ''}${n === 'critique' ? ' palier-critique' : ''}" data-passage="${p.id}">
      <div class="ch-tete"><strong>${esc(p.unite)}</strong> <span class="note">${esc(p.organisation)}${p.prealerte ? ` · ${esc(p.prealerte)}` : ` · ${K('sans_prealerte')}`}</span>
        ${anneau(p)}${p.niveau === 'rouge' && !sons.acquittes.has(p.id) ? `<button class="btn" type="button" data-ch-acquitter="${p.id}">${K('acquitter')}</button>` : ''}
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
        <label class="ch-son"><input type="checkbox" id="ch-son"${sonActif() ? ' checked' : ''}> ${K('son')}</label>
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
    alertesSonores(d.a_la_porte);
    $('#ch-son').onchange = (e) => ls.ecrire('arrimo-chrono-son', e.target.checked ? '1' : '0');
    v.querySelectorAll('[data-ch-acquitter]').forEach((b) => { b.onclick = () => { sons.acquittes.add(Number(b.dataset.chAcquitter)); toast(t('chrono.alerte_acquittee')); vueChrono(); }; });
    // Les anneaux avancent entre deux actualisations (toutes les 15 s, sans appel au serveur)
    clearInterval(etatC.tic);
    etatC.tic = setInterval(() => {
      if (etat.vue !== 'chrono') return clearInterval(etatC.tic);
      v.querySelectorAll('.ch-anneau[data-h11]').forEach((a) => {
        if (!a.dataset.h11) return;
        const n = Math.max(0, Math.floor((Date.now() - new Date(a.dataset.h11).getTime()) / 60000)); const ref = Number(a.dataset.ref);
        const arc = a.querySelector('.arc'); const tour = 2 * Math.PI * 26;
        arc.setAttribute('stroke-dasharray', `${(Math.min(1, n / ref) * tour).toFixed(1)} ${tour.toFixed(1)}`); a.querySelector('.min').textContent = n;
      });
    }, 15000);
    // Le chrono avance seul : la vue se redessine chaque minute tant qu'elle est affichée
    clearTimeout(etatC.minuteur);
    etatC.minuteur = setTimeout(() => { if (etat.vue === 'chrono' && $('#modale').hidden && !document.activeElement?.closest('#ch-filtres, [data-chrono-retard]')) vueChrono(); }, 60000);
  }

  async function rapport() {
    const z = $('#ch-rapport-corps'); if (!z) return;
    const r = await api('GET', `/chrono/rapport?etablissement_id=${etat.ctx}&mois=${etatC.mois}&${paramsFiltres()}`).catch((e) => { z.innerHTML = `<p class="note">${esc(e.message)}</p>`; return null; });
    if (!r) return;
    // Avant / après (cahier 11) : même rapport pour le mois précédent, mesures seulement
    const [a, m] = etatC.mois.split('-').map(Number); const prec = new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 7);
    const rp = await api('GET', `/chrono/rapport?etablissement_id=${etat.ctx}&mois=${prec}&${paramsFiltres()}`).catch(() => null);
    const barre = (lbl, v, vp) => `<div class="ch-barre"><span class="lbl">${lbl}</span>
      <span class="piste" role="img" aria-label="${K('obj_aria', { lbl, v: v ?? '—', vp: vp ?? '—' })}"><span class="val" style="width:${v ?? 0}%"></span>${vp != null ? `<span class="prec" style="left:${vp}%"></span>` : ''}</span>
      <b class="num">${v == null ? '—' : `${v} %`}</b><span class="note">${K('obj_prec', { v: vp == null ? '—' : `${vp} %` })}</span></div>`;
    const oa = r.objectifs_arrimo; const op = rp?.objectifs_arrimo;
    const objectifs = oa ? `<div class="ch-objectifs"><h4>${K('obj_titre')}</h4>
      ${barre(K('obj_remise', { n: oa.remise.n }), oa.remise.respecte_pct, op?.remise.respecte_pct)}
      ${barre(K('obj_remise_exc'), oa.remise.excellence_pct, op?.remise.excellence_pct)}
      ${barre(K('obj_liberation', { n: oa.liberation.n }), oa.liberation.respecte_pct, op?.liberation.respecte_pct)}
      ${barre(K('obj_liberation_exc'), oa.liberation.excellence_pct, op?.liberation.excellence_pct)}
      <p class="note">${K('obj_heures', { h: oa.liberation.heures_vehicules_au_dela ?? '—', hp: op?.liberation.heures_vehicules_au_dela ?? '—' })}</p></div>` : '';
    const ligne = (k) => `<tr><th>${K(k)}</th><td>${r[k].n}</td><td>${r[k].moyenne_min ?? '—'}</td><td>${r[k].mediane_min ?? '—'}</td><td>${r[k].p90_min ?? '—'}</td><td>${r[k].cible_min ?? '—'}</td><td>${r[k].hors_cible_pct ?? '—'}</td></tr>`;
    z.innerHTML = `<p>${K('rapport_resume', { n: r.passages, completude: r.completude_pct ?? '—', corrections: r.corrections })}</p>${objectifs}
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
