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
  /* Planche 3 de la proposition visuelle validée : une carte par ambulance, double anneau (extérieur : remise du patient, objectif Arrimo ;
     intérieur : libération du véhicule), palier écrit (Normal, Vigilance, Escalade, Critique), chronologie H11 à H15, motif du retard.
     La couleur n'est jamais seule : minutes, objectifs et mot du palier sont écrits. Les actions restent celles du moteur Chrono. */
  const TX = {
    fr: { titre: 'Ambulances à la porte · {n} en cours', objectifs: 'Objectifs', cibles: 'Cibles configurées : porte {p} · sortie {s} · total {t} min', arrimo: 'Arrimo {r}/{l} · excellence {er}/{el} (internes, configurables)',
      acquitter_son: 'Acquitter le son', son_acquitte: 'Son acquitté', remise: 'Remise du patient', liberation: 'Libération du véhicule', avant: '{n} min avant l’objectif', depasse: 'objectif {o} min dépassé de {n} min',
      motif: 'Motif : {m}', aucun_motif: 'aucun consigné', paliers: { normal: 'Normal', vigilance: 'Vigilance', escalade: 'Escalade', critique: 'Critique' }, min_porte: 'min à la porte',
      aria: '{n} minutes à la porte, palier {p}', tendance: 'Porte → remise, médiane par semaine (min)', source: 'source : Chrono H11 → H14 · {n} semaines · objectif Arrimo {o}',
      respect: 'Objectif {o} respecté', passages: '{n} passages mesurés', p90: '90e percentile', porte_remise: 'porte → remise', heures: 'Heures-véhicules au-delà de {o} min',
      recuperables: 'potentiellement récupérables (indicatif) · récupérées : non mesurées', simultanes: 'Simultanées à la porte', max_mois: 'maximum du mois',
      pied: 'Orange : son bref et notification. Rouge : pulsation lente (désactivée si l’utilisateur réduit les animations) et son prioritaire. L’acquittement coupe le son, pas le chrono ni l’alerte. Une urgence clinique suit toujours les protocoles médicaux, quel que soit le chrono.',
      aucune: 'Aucune ambulance à la porte.', tendance_vide: 'Pas encore de mesure H11 → H14 sur la période.', semaine: 'sem. du {d}' },
    en: { titre: 'Ambulances at the door · {n} in progress', objectifs: 'Targets', cibles: 'Configured targets: door {p} · exit {s} · total {t} min', arrimo: 'Arrimo {r}/{l} · excellence {er}/{el} (internal, configurable)',
      acquitter_son: 'Acknowledge sound', son_acquitte: 'Sound acknowledged', remise: 'Patient handover', liberation: 'Vehicle release', avant: '{n} min before target', depasse: '{o} min target exceeded by {n} min',
      motif: 'Reason: {m}', aucun_motif: 'none recorded', paliers: { normal: 'Normal', vigilance: 'Watch', escalade: 'Escalation', critique: 'Critical' }, min_porte: 'min at the door',
      aria: '{n} minutes at the door, level {p}', tendance: 'Door → handover, weekly median (min)', source: 'source: Chrono H11 → H14 · {n} weeks · Arrimo target {o}',
      respect: '{o}-minute target met', passages: '{n} measured visits', p90: '90th percentile', porte_remise: 'door → handover', heures: 'Vehicle-hours beyond {o} min',
      recuperables: 'potentially recoverable (indicative) · recovered: not measured', simultanes: 'Simultaneous at the door', max_mois: 'monthly maximum',
      pied: 'Orange: short sound and notification. Red: slow pulse (off when the user reduces motion) and priority sound. Acknowledging stops the sound, not the timer or the alert. A clinical emergency always follows medical protocols, whatever the timer shows.',
      aucune: 'No ambulance at the door.', tendance_vide: 'No H11 → H14 measurement yet for this period.', semaine: 'wk of {d}' },
  };
  const X = (k, v = {}) => { const d = TX[typeof langue === 'string' && langue === 'en' ? 'en' : 'fr']; const val = k.split('.').reduce((o, x) => o?.[x], d) ?? k; return esc(String(val).replace(/\{(\w+)\}/g, (m, y) => v[y] ?? m)); };
  const PALIER = (p) => (p.palier === 'critique' ? 'critique' : p.niveau === 'rouge' ? 'escalade' : p.niveau === 'orange' ? 'vigilance' : 'normal');
  const etatMin = (m, obj, rouge) => (m == null ? 'gris' : m >= rouge ? 'rouge' : m >= obj ? 'orange' : 'vert');
  function lignePorte(p) {
    const DS = window.ArrimoDS; const m = p.a_la_porte_min; const pal = PALIER(p);
    const rem = p.arrimo?.remise?.cible_min ?? 15; const lib = p.arrimo?.liberation?.cible_min ?? 30; const esc2 = p.arrimo?.escalade_majeure_min ?? 45;
    const cR = DS.etat(etatMin(m, rem, rem * 2)); const cL = DS.etat(etatMin(m, lib, esc2));
    const texte = (obj) => (m == null ? '—' : m >= obj ? X('depasse', { o: obj, n: m - obj }) : X('avant', { n: obj - m }));
    const fond = { normal: 'ok', vigilance: 'vigilance', escalade: 'escalade', critique: 'critique' }[pal];
    const n = p.palier === 'critique' ? 'critique' : p.niveau || '';
    return `<article class="ds-porte ch-porte niveau-${p.niveau || ''} p-${pal}" data-passage="${p.id}" data-h11="${esc(p.heures.H11?.heure || '')}" data-rem="${rem}" data-lib="${lib}" data-esc="${esc2}">
      <div class="ds-porte-tete"><strong>${esc(p.unite)}</strong>${window.ArrimoDS.pastille(fond, X(`paliers.${pal}`))}</div>
      <div class="ds-porte-corps">${DS.doubleAnneau({ minutes: m, remise: rem, liberation: lib, couleurRemise: cR, couleurLib: cL, aria: X('aria', { n: m ?? '—', p: X(`paliers.${pal}`) }), legende: X('min_porte') })}
        <div class="ds-porte-infos">${m != null ? `<span class="ch-minutes" role="timer" aria-label="${K('a_la_porte_depuis', { n: m })}">${K('minutes', { n: m })} · ${K(`niveau_${n}`)}</span>` : ''}<span class="trait"><i style="background:${cR}"></i>${X('remise')} : ${texte(rem)}</span><span class="trait"><i style="background:${cL}"></i>${X('liberation')} : ${texte(lib)}</span>
          <span class="note">${esc(p.organisation)}${p.prealerte ? ` · ${esc(p.prealerte)}` : ` · ${K('sans_prealerte')}`}</span>
          <span class="note">${X('motif', { m: p.motif_retard ? (window.ArrimoChronoRetards?.libelle(p.motif_retard) || p.motif_retard) : X('aucun_motif') })}</span></div></div>
      <ol class="ds-h">${ETAPES.map((e) => `<li class="${p.heures[e] ? 'fait' : ''}"><i></i><span><strong>${e}</strong> ${p.heures[e] ? heureCourte(p.heures[e].heure) : '—'}</span></li>`).join('')}</ol>
      <div class="ds-porte-actions">${p.prochaine ? `<button class="btn pri" data-ch-etape="${p.prochaine}" data-id="${p.id}">${K(`bouton_${p.prochaine}`)}</button>` : ''}
        <button class="btn" data-ch-corriger="${p.id}">${K('corriger')}</button>${(window.ArrimoSillage?.bouton('passage_chrono', p.id) || '')}</div>${window.ArrimoChronoRetards?.champ(p, true) || ''}</article>`;
  }
  /** Partie basse de la planche 3 : courbe hebdomadaire (H11 → H14) et quatre mesures du mois (réelles, indicatives). */
  async function basChrono() {
    const z = $('#ch-bas'); if (!z) return;
    const [td, r] = await Promise.all([api('GET', `/chrono/tendance?etablissement_id=${etat.ctx}&semaines=8&${paramsFiltres()}`).catch(() => null),
      api('GET', `/chrono/rapport?etablissement_id=${etat.ctx}&mois=${new Date().toISOString().slice(0, 7)}&${paramsFiltres()}`).catch(() => null)]);
    if (!z.isConnected) return;
    const obj = td?.objectif_remise_min ?? r?.lignes?.[0]?.arrimo?.remise?.cible_min ?? 15;
    const libObj = r?.lignes?.[0]?.arrimo?.liberation?.cible_min ?? 30;
    const pts = (td?.semaines || []).map((x) => ({ etiquette: x.debut.slice(5).split('-').reverse().join('/'), valeur: x.mediane_min }));
    const courbe = pts.some((x) => x.valeur != null) ? window.ArrimoDS.courbe(pts, { objectif: obj, couleur: window.ArrimoDS.module('urgences'), aria: X('tendance') }) : `<p class="ds-vide">${X('tendance_vide')}</p>`;
    const oa = r?.objectifs_arrimo; const val = (v, suf = '') => (v == null ? '—' : `${String(v).replace('.', langue === 'en' ? '.' : ',')}${suf}`);
    z.innerHTML = `<section class="ds-carte"><div class="ds-carte-tete"><h3>${X('tendance')}</h3><span class="note">${X('source', { n: td?.semaines?.length ?? 8, o: obj })}</span></div>${courbe}</section>
      <section class="ds-carte ds-stats">
        <div><span class="ds-lbl">${X('respect', { o: obj })}</span><strong>${val(oa?.remise?.respecte_pct, ' %')}</strong><span class="note">${X('passages', { n: oa?.remise?.n ?? 0 })}</span></div>
        <div><span class="ds-lbl">${X('p90')}</span><strong>${val(r?.porte?.p90_min, ' min')}</strong><span class="note">${X('porte_remise')}</span></div>
        <div><span class="ds-lbl">${X('heures', { o: libObj })}</span><strong>${val(oa?.liberation?.heures_vehicules_au_dela, ' h')}</strong><span class="note">${X('recuperables')}</span></div>
        <div><span class="ds-lbl">${X('simultanes')}</span><strong>${val(r?.pilote?.simultanes_max)}</strong><span class="note">${X('max_mois')}</span></div></section>`;
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
    const ar = d.a_la_porte.find((p) => p.arrimo)?.arrimo; const sonCoupe = !sonActif() || (d.a_la_porte.filter((p) => p.niveau === 'rouge').length > 0 && d.a_la_porte.filter((p) => p.niveau === 'rouge').every((p) => sons.acquittes.has(p.id)));
    v.innerHTML = `<div class="entete ds-chrono-tete"><div><h2>${X('titre', { n: d.a_la_porte.length })}</h2><p class="note">${K('indicatif')}${d.actualise_le ? ` · ${K('actualise', { h: heureCourte(d.actualise_le) })}` : ''}</p></div>
        <div class="ds-objectifs"><strong>${X('objectifs')}</strong><span class="note">${X('cibles', { p: c.porte, s: c.sortie, t: c.total })}</span><span class="sep"></span><span class="note">${X('arrimo', { r: ar?.remise?.cible_min ?? 15, l: ar?.liberation?.cible_min ?? 30, er: ar?.remise?.excellence_min ?? 5, el: ar?.liberation?.excellence_min ?? 10 })}</span></div>
        <button type="button" class="ds-son" id="ch-acquitter-son" aria-pressed="${sonCoupe}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="${sonCoupe ? 'M16 9l6 6M22 9l-6 6' : 'M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14'}"/></svg>${X(sonCoupe ? 'son_acquitte' : 'acquitter_son')}</button></div>
      <details class="panneau-c ch-filtres-zone"${Object.keys(etatC.filtres).length ? ' open' : ''}><summary><b>${K('filtrer')}</b> · <span class="note">${tuilesAttente ? '' : ''}${t('chrono.en_route')} : ${nb(d.en_route.length)}</span></summary><form id="ch-filtres" class="ligne">
        <label>${K('filtre_vehicule')} <input name="vehicule" type="search" maxlength="100" value="${esc(etatC.filtres.vehicule || '')}"></label>
        <label>${K('filtre_organisation')} <input name="organisation" type="search" maxlength="100" value="${esc(etatC.filtres.organisation || '')}"></label>
        <label>${K('filtre_periode')} <select name="heures_historique">${[12, 24, 48, 168].map((h) => `<option value="${h}"${h === d.heures_historique ? ' selected' : ''}>${K('periode_heures', { n: h })}</option>`).join('')}</select></label>
        <button type="submit" class="btn">${K('filtrer')}</button>
        <label class="ch-son"><input type="checkbox" id="ch-son"${sonActif() ? ' checked' : ''}> ${K('son')}</label>
      </form><div class="tuiles">${tuile({ lbl: t('chrono.en_route'), val: nb(d.en_route.length) })}${tuile({ lbl: t('chrono.a_la_porte'), val: nb(d.a_la_porte.length),
        etat: d.a_la_porte.some((p) => p.niveau === 'rouge') ? 'critique' : null })}${tuilesAttente}</div></details>
      <section class="ds-portes" aria-label="${K('a_la_porte')}">${d.a_la_porte.length ? d.a_la_porte.map(lignePorte).join('') : `<p class="ds-vide">${X('aucune')}</p>`}</section>
      <div class="ds-chrono-bas" id="ch-bas"></div>
      <section class="panneau-c"><h3>${K('en_route')}</h3>${d.en_route.length ? `<ul class="liste-simple">${d.en_route.map((p) => `<li><strong>${esc(p.unite)}</strong> · ${esc(p.organisation)} · ${esc(p.numero)}
        · ${p.eta_min != null ? K('arrive_dans', { n: p.eta_min, km: p.eta_km ?? '—' }) : p.heure_prevue ? K('prevue', { heure: heureCourte(p.heure_prevue) }) : K('heure_inconnue')}</li>`).join('')}</ul>` : `<p class="note">${K('aucune_route')}</p>`}</section>
      <section class="panneau-c"><h3>${K('termines')}</h3>${d.termines.length ? `<div class="tableau"><table><thead><tr><th>${K('unite')}</th>${ETAPES.map((e) => `<th>${e}</th>`).join('')}<th>${K('porte')}</th><th>${K('sortie')}</th><th>${K('total')}</th></tr></thead>
        <tbody>${d.termines.map((p) => `<tr><td>${esc(p.unite)}</td>${ETAPES.map((e) => `<td>${heureEtape(p.heures[e])}</td>`).join('')}<td>${p.durees.porte ?? '—'}</td><td>${p.durees.sortie ?? '—'}</td><td>${p.durees.total ?? '—'}</td></tr>`).join('')}</tbody></table></div>` : `<p class="note">${K('aucun_termine')}</p>`}</section>
      <section class="panneau-c" id="ch-rapport"><h3>${K('rapport')}</h3><div class="ligne"><label class="lbl" for="ch-mois">${K('mois')}</label>
        <input type="month" id="ch-mois" value="${esc(etatC.mois)}"><button class="btn" id="ch-csv">${K('csv')}</button></div><div id="ch-rapport-corps"><p class="note">${K('chargement')}</p></div></section>
      <section class="panneau-c"><h3>${K('ecarts')}</h3><div id="ch-ecarts"></div></section>
      <p class="note ds-chrono-pied">${X('pied')}</p>`;
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
    rapport(); ecarts(); basChrono();
    alertesSonores(d.a_la_porte);
    // Planche 3 : l'acquittement coupe le son (toutes les alertes rouges présentes), jamais le chrono ni l'alerte
    $('#ch-acquitter-son').onclick = () => { d.a_la_porte.filter((p) => p.niveau === 'rouge').forEach((p) => sons.acquittes.add(p.id)); toast(t('chrono.alerte_acquittee')); vueChrono(); };
    $('#ch-son').onchange = (e) => ls.ecrire('arrimo-chrono-son', e.target.checked ? '1' : '0');
    v.querySelectorAll('[data-ch-acquitter]').forEach((b) => { b.onclick = () => { sons.acquittes.add(Number(b.dataset.chAcquitter)); toast(t('chrono.alerte_acquittee')); vueChrono(); }; });
    // Les anneaux avancent entre deux actualisations (toutes les 15 s, sans appel au serveur)
    clearInterval(etatC.tic);
    etatC.tic = setInterval(() => {
      if (etat.vue !== 'chrono') return clearInterval(etatC.tic);
      v.querySelectorAll('.ds-porte[data-h11]').forEach((a) => {
        if (!a.dataset.h11) return;
        const n = Math.max(0, Math.floor((Date.now() - new Date(a.dataset.h11).getTime()) / 60000));
        const R1 = 2 * Math.PI * 56; const R2 = 2 * Math.PI * 40; const rem = Number(a.dataset.rem); const lib = Number(a.dataset.lib);
        a.querySelector('.arc-remise')?.setAttribute('stroke-dasharray', `${(Math.min(1, n / rem) * R1).toFixed(1)} ${R1.toFixed(1)}`);
        a.querySelector('.arc-lib')?.setAttribute('stroke-dasharray', `${(Math.min(1, n / lib) * R2).toFixed(1)} ${R2.toFixed(1)}`);
        const t2 = a.querySelector('.min'); if (t2) t2.textContent = n;
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
    const barre = (lbl, v, vp) => `<div class="ch-barre"><span class="ds-lbl">${lbl}</span>
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
