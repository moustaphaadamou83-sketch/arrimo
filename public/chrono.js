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

  async function vueAmbulancesChrono() {
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
  /* Chrono unifié (27 nov. 2026) : un seul module, huit sous-menus, une seule source (GET /chrono/universel, lecture seule).
     Les ambulances (H11 à H15) gardent leur écran existant ; aucun second moteur. Durées HH:MM:SS ; inconnu en gris, jamais 0. */
  const SOUS = ['generale', 'patients', 'ambulances', 'capacites', 'previsions', 'qualite', 'alertes', 'historique'];
  const ENTRETIEN_SOUS = ['capacites'];
  const sousPermis = () => (etat.moi?.utilisateur?.role === 'entretien' ? ENTRETIEN_SOUS : SOUS);
  const hebergementC = () => (document.documentElement.dataset.typeEtab || 'hopital') !== 'hopital';
  const nomSous = (k) => (k === 'patients' && hebergementC() ? K('u_residents') : K(`u_${k}`));
  const nav = (cur) => `<nav class="sous-chrono" aria-label="${K('u_nav')}">${sousPermis().map((k) => `<button type="button" data-sous-chrono="${k}" aria-current="${k === cur}">${nomSous(k)}</button>`).join('')}</nav>`;
  /* Compteurs circulaires (audit du 27 nov. 2026) : grand anneau, durée HH:MM:SS AU CENTRE ; l'anneau se remplit jusqu'au seuil
     d'escalade, un repère marque le seuil de vigilance ; la couleur est recalculée chaque seconde (une durée qui franchit son seuil
     ne reste jamais verte). Sans seuil : bleu « en cours » ; sans horodatage : gris « inconnu ». La couleur n'est jamais seule. */
  const NIVEAUX = ['vert', 'orange', 'rouge', 'gris', 'bleu'];
  const RANG = { rouge: 4, orange: 3, gris: 2, vert: 1, bleu: 0 };
  const motNiveau = (n) => K(`n_${NIVEAUX.includes(n) ? n : 'gris'}`);
  const seuilsAttr = (s, depuis) => (s && depuis ? ` data-seuil-v="${esc(s.vigilance)}" data-seuil-e="${esc(s.escalade)}" data-objectif-min="${esc(s.escalade)}"` : '');
  function anneauGrand({ depuis, seuils, echeance, marge, niveau, etiquette, petit = false }) {
    const repere = seuils ? Math.max(1, Math.min(99, (seuils.vigilance / seuils.escalade) * 100)) : null;
    const val = echeance && new Date(echeance).getTime() > Date.now()
      ? `<b class="num ag-val" data-decompte="${esc(echeance)}" data-decompte-fin="${K('s_depassee')}">--:--:--</b>`
      : `<b class="ac-val num ag-val">--:--:--</b>`;
    return `<div class="anneau-grand${petit ? ' petit' : ''} niveau-${esc(niveau || 'gris')}"${depuis && !(echeance && new Date(echeance).getTime() > Date.now()) ? ` data-depuis="${esc(echeance && new Date(echeance).getTime() <= Date.now() ? echeance : depuis)}"` : ''}${echeance ? '' : seuilsAttr(seuils, depuis)}${echeance ? ` data-echeance="${esc(echeance)}" data-marge-min="${esc(marge || 0)}"` : ''}>
      <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="ag-fond" cx="60" cy="60" r="52"/><circle class="ac-arc ag-arc" cx="60" cy="60" r="52" pathLength="100" stroke-dasharray="${echeance ? '100 100' : '0 100'}"/>
        ${repere ? `<circle class="ag-repere" cx="60" cy="60" r="52" pathLength="100" stroke-dasharray="1 99" stroke-dashoffset="${(-(repere - 0.5)).toFixed(1)}"/>` : ''}</svg>
      <div class="ag-centre">${depuis || echeance ? val : `<b class="num ag-val">--:--:--</b>`}<span class="ag-lib">${esc(etiquette || '')}</span></div></div>`;
  }
  /** Carte commune (patients, capacités, alertes) : anneau + titre + lignes + mot du niveau ; cliquable si `cle`. */
  const carteChrono = (x, { titre, lignes = [], etiquette, cle, petit } = {}) => `<article class="carte-chrono niveau-${esc(x.niveau || 'gris')}" data-niveau-carte data-niveau-serveur="${esc(x.niveau || 'gris')}"${cle ? ` data-sejour="${esc(cle)}" tabindex="0" role="button" aria-label="${K('s_ouvrir', { r: cle })}"` : ''}>
      ${anneauGrand({ depuis: x.depuis, seuils: x.seuils_min, echeance: x.echeance, marge: x.marge_min, niveau: x.niveau, etiquette, petit })}
      <div class="cc-corps"><h4>${titre}</h4>${lignes.filter(Boolean).map((l) => `<p>${l}</p>`).join('')}<p class="cc-niveau"><span class="pastille-chrono"></span><span class="cc-mot">${motNiveau(x.niveau)}</span></p></div></article>`;
  const anneauDuree = (x, { libelle, sous } = {}) => carteChrono(x, { titre: esc(libelle || ''), lignes: [sous ? `<span class="note">${esc(sous)}</span>` : ''], etiquette: x.seuils_min ? K('s_seuil_court', { v: dureeCourte(x.seuils_min.vigilance) }) : '', petit: true });
  /** Durée lisible d'un seuil en minutes : « 4 h », « 7 j », « 45 min ». */
  function dureeCourte(m) { const n = Number(m); if (!Number.isFinite(n)) return '—'; if (n >= 1440 && n % 1440 === 0) return `${n / 1440} ${K('u_j')}`; if (n >= 60 && n % 60 === 0) return `${n / 60} h`; return `${n} min`; }
  /** Recoloration à la seconde : chaque élément à seuil calcule son niveau ; la carte prend le pire (rouge > orange > gris > vert > bleu). */
  function recolorer(racine = document) {
    racine.querySelectorAll('[data-seuil-v][data-depuis]').forEach((el) => {
      const m = (Date.now() - new Date(el.dataset.depuis).getTime()) / 60000;
      el.dataset.niv = m >= Number(el.dataset.seuilE) ? 'rouge' : m >= Number(el.dataset.seuilV) ? 'orange' : 'vert';
    });
    racine.querySelectorAll('[data-echeance]').forEach((el) => {
      const m = (Date.now() - new Date(el.dataset.echeance).getTime()) / 60000;
      el.dataset.niv = m >= Number(el.dataset.margeMin || 0) ? 'rouge' : m >= 0 ? 'orange' : 'vert';
    });
    racine.querySelectorAll('.anneau-grand[data-niv]').forEach((a) => {
      if (a.classList.contains(`niveau-${a.dataset.niv}`)) return;
      NIVEAUX.forEach((k) => a.classList.remove(`niveau-${k}`)); a.classList.add(`niveau-${a.dataset.niv}`);
    });
    racine.querySelectorAll('[data-niveau-carte]').forEach((c) => {
      const nivs = [...c.querySelectorAll('[data-niv]')].map((e) => e.dataset.niv);
      // Niveaux fixes (gris : horodatage manquant ; bleu : sans seuil) des anneaux sans seuil
      c.querySelectorAll('.anneau-grand:not([data-seuil-v]):not([data-echeance])').forEach((a) => { const f = NIVEAUX.find((k) => a.classList.contains(`niveau-${k}`)); if (f) nivs.push(f); });
      if (!nivs.length) return;
      const n = nivs.sort((a, b) => RANG[b] - RANG[a])[0];
      c.dataset.niveau = n;
      if (c.classList.contains(`niveau-${n}`)) return;
      NIVEAUX.forEach((k) => c.classList.remove(`niveau-${k}`)); c.classList.add(`niveau-${n}`);
      const mot = c.querySelector('.cc-mot'); if (mot) mot.textContent = t(`chrono.n_${n}`);
    });
  }
  const phase = (k) => K(`ph_${k}`);
  const liste = (items, rendu, vide) => (items.length ? `<div class="grille-chrono">${items.map(rendu).join('')}</div>` : `<p class="note">${vide}</p>`);
  /** Indicateurs T−5 (30 jours) : taux sur les confirmations mesurées ; « inconnu » sans données. Exportables (Imprimer, PDF, CSV, Excel). */
  const tableT5 = (p) => (!p ? '' : `<section><h3>${K('t5_titre')}</h3><div class="tableau"><table><thead><tr><th>${K('t5_indicateur')}</th><th>${K('t5_valeur')}</th><th>${K('t5_base')}</th></tr></thead><tbody>
      ${[['t5_patients', p.patients_prets_t5_pct, p.patients_mesures], ['t5_accueils', p.accueils_prets_t5_pct, p.accueils_mesures], ['t5_avant', p.prets_avant_arrivee_pct, p.arrivees_mesurees]]
        .map(([k, v, n]) => `<tr><th>${K(k)}</th><td>${v == null ? K('u_inconnu') : `${v} %`}</td><td>${n}</td></tr>`).join('')}
      ${p.motifs_non_preparation.map((m) => `<tr><th>${K('t5_motif')} · ${esc(window.ArrimoVueTransferts.PREP[langue === 'en' ? 'en' : 'fr'].m[m.motif] || m.motif)}</th><td>${m.n}</td><td>—</td></tr>`).join('')}
    </tbody></table></div><p class="note">${K('t5_note')}</p></section>`);
  async function vueChrono() {
    const v = $('#v-chrono');
    const cur = sousPermis().includes(etatC.sous) ? etatC.sous : sousPermis()[0];
    if (cur === 'ambulances') { await vueAmbulancesChrono(); v.insertAdjacentHTML('afterbegin', nav(cur)); return; }
    const d = await api('GET', `/chrono/universel?etablissement_id=${etat.ctx}`); if (!d) return;
    const r = d.resume; const tuileN = (k, x) => `<button type="button" class="tuile-c ds-kpi${x.rouge ? ' alerte' : ''}" data-sous-chrono="${k}"><span class="gros ds-kpi-val num">${x.total}</span><span class="note ds-kpi-lib">${K(`u_${k}`)}${x.rouge ? ` · ${K('u_rouge', { n: x.rouge })}` : ''}${x.orange ? ` · ${K('u_orange', { n: x.orange })}` : ''}</span></button>`;
    const patient = (x) => carteSejour(x);
    const ressource = (x) => anneauDuree(x, { libelle: `${x.ressource}${x.unite ? ` · ${x.unite}` : ''}`, sous: `${phase(x.phase)}${x.attente_avant_nettoyage_min != null ? ` · ${K('u_attente_avant', { n: x.attente_avant_nettoyage_min })}` : ''}` });
    const ambulance = (x) => `<div class="anneau-chrono niveau-${esc(x.niveau)}"${x.depuis ? ` data-depuis="${esc(x.depuis)}"` : ''}>
        <svg viewBox="0 0 44 44" aria-hidden="true"><circle class="ac-fond" cx="22" cy="22" r="19"/><circle class="ac-arc" cx="22" cy="22" r="19" pathLength="100" stroke-dasharray="0 100"/></svg>
        <div><b class="${x.depuis ? 'ac-val ' : ''}num">${x.depuis ? '--:--:--' : x.arrivee_estimee ? `<span data-decompte="${esc(x.arrivee_estimee)}" data-decompte-fin="${K('u_eta_passee')}">--:--:--</span>` : K('u_eta_inconnue')}</b>
        <span>${esc(x.unite || '—')} · ${esc(x.numero)}</span><small class="note">${phase(x.phase)}${x.objet === 'prealerte' && !x.depuis && !x.estimation_fiable ? ` · ${K('u_estimation_non_fiable')}` : ''}</small>
        ${x.objet === 'transport' ? window.ArrimoVueTransferts.preparation({ ...x, destination_id: x.sens === 'arrivee' ? 1 : null }, { heure: heureCourte }) : ''}</div></div>`;
    const alerte = (x) => anneauDuree(x, { libelle: x.titre, sous: `${K(`u_statut_${x.statut}`)}${x.escalade_niveau ? ` · ${K('u_escalade', { n: x.escalade_niveau })}` : ''}${x.reaction_min != null ? ` · ${K('u_reaction', { n: x.reaction_min })}` : ''}` });
    const q = d.qualite;
    const corps = {
      generale: () => vueGenerale(d, { patient, ressource, ambulance, alerte }),
      patients: () => vuePatients(d),
      capacites: () => liste(d.capacites, ressource, K('u_aucun')),
      previsions: () => d.previsions ? `<p class="note">${K('u_prev_note')}</p><div class="tableau"><table><thead><tr><th>${K('u_type')}</th><th>${K('u_libres')}</th><th>${K('u_nettoyage')}</th>${(d.previsions.horizons || []).map((h) => `<th>${K('u_dans', { h })}</th>`).join('')}</tr></thead><tbody>
        ${(d.previsions.unites || []).map((u) => `<tr><th>${esc(u.type_nom)}</th><td>${u.libres}</td><td>${u.horizons?.[d.previsions.horizons?.[0]]?.liberations ?? '—'}</td>${(d.previsions.horizons || []).map((h) => { const x = u.horizons?.[h]; return `<td>${x ? `${esc(x.libres_prevus)} <span class="note">± ${esc(x.marge)}</span>${x.risque ? ` <span class="badge-flux retard">${K('u_risque')}</span>` : ''}` : '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="note">${K('u_prev_indispo')}</p>`,
      qualite: () => q ? `<p class="note">${K('u_qualite_note')}</p><dl class="qualite-chrono">
        <div><dt>${K('u_q_sync')}</dt><dd>${q.synchronisation_ms?.p50 != null ? `${q.synchronisation_ms.p50} ms (p95 ${q.synchronisation_ms.p95} ms)` : K('u_inconnu')}</dd></div>
        <div><dt>${K('u_q_notifs')}</dt><dd>${q.notifications_non_lues_15min ?? K('u_inconnu')}</dd></div>
        <div><dt>${K('u_q_pa')}</dt><dd>${q.prealertes_non_recues ?? K('u_inconnu')}</dd></div>
        <div><dt>${K('u_q_gps')}</dt><dd>${q.gps_obsoletes}</dd></div>
        <div><dt>${K('u_q_eta')}</dt><dd>${q.eta_transport_obsoletes ?? K('u_inconnu')}</dd></div></dl>` : `<p class="note">${K('u_inconnu')}</p>`,
      alertes: () => liste(d.alertes, alerte, K('u_aucun')),
      historique: () => `<p class="note">${K('u_hist_note')}</p><p><button type="button" class="btn" id="ch-u-recherche">${K('u_hist_chercher')}</button></p>`,
    };
    const amb = '';  // Vue générale : les ambulances sont résumées par leurs cartes ; la liste complète reste dans « Ambulances »
    v.innerHTML = `${nav(cur)}<div class="entete"><div><h2>${K('u_titre')} · ${nomSous(cur)}</h2><p class="note">${K('u_seuils')}</p></div></div><section class="panneau-c">${corps[cur]()}${amb}</section>`;
    $('#ch-u-recherche')?.addEventListener('click', () => $('#b-recherche')?.click());
    if (cur === 'patients') brancherPatients(d);
    brancherFiches(v);
    window.ArrimoDuree?.tic(); recolorer(v);
    clearInterval(etatC.recolore);
    etatC.recolore = setInterval(() => { if (etat.vue !== 'chrono') return clearInterval(etatC.recolore); recolorer($('#v-chrono')); }, 1000);
  }

  /* ---------- Vue générale : centre de supervision (27 nov. 2026) ----------
     Lit seulement la réponse commune (/chrono/universel) : aucun moteur propre. Chaque carte = une situation, un grand anneau
     (la plus longue durée en cours de la situation), le nombre, la ressource la plus ancienne ; clic → sous-menu filtré.
     Une disponibilité PRÉVUE est marquée « estimé » et n'est jamais confondue avec une disponibilité confirmée. */
  function vueGenerale(d, rendus) {
    const heb = hebergementC(); const P = d.patients || []; const C = d.capacites || []; const A = d.ambulances || []; const AL = d.alertes || [];
    const pire = (l) => l.map((x) => x.niveau).sort((a, b) => RANG[b] - RANG[a])[0] || 'vert';
    const plusAncien = (l) => l.filter((x) => x.depuis).sort((a, b) => new Date(a.depuis) - new Date(b.depuis))[0] || null;
    const carte = (cle, lib, items, aller, { sous, estime, val } = {}) => {
      const x = plusAncien(items); const n = val ?? items.length;
      const niveau = items.length ? pire(items) : 'vert';
      const ident = x ? (x.reference || x.ressource || x.numero || x.titre || '') : '';
      const ou = x ? [x.departement, x.unite].filter(Boolean).map(esc).join(' · ') : '';
      return `<button type="button" class="carte-supervision niveau-${esc(niveau)}" data-niveau-carte data-aller-chrono="${esc(aller.sous)}"${aller.etape ? ` data-aller-etape="${esc(aller.etape)}"` : ''}${aller.niveau ? ` data-aller-niveau="${esc(aller.niveau)}"` : ''} data-cle="${esc(cle)}">
        ${anneauGrand({ depuis: x?.depuis, seuils: x?.seuils_min, niveau: x ? x.niveau : (n ? 'bleu' : 'vert'), etiquette: x ? K('s_plus_ancien') : '' })}
        <span class="sv-corps"><span class="sv-nombre num">${esc(n)}</span><span class="sv-lib">${lib}${estime ? ` <span class="badge-flux">${K('g_estime')}</span>` : ''}</span>
          ${x ? `<span class="sv-ident">${esc(ident)}${ou ? ` · ${ou}` : ''}</span>` : ''}${sous ? `<span class="note">${sous}</span>` : ''}
          <span class="cc-niveau"><span class="pastille-chrono"></span><span class="cc-mot">${items.length ? motNiveau(niveau) : motNiveau('vert')}</span></span></span></button>`;
    };
    const etapes = (l) => P.filter((x) => l.includes(x.etape));
    const prev = d.previsions?.unites?.reduce((t, u) => t + (Number(u.horizons?.[d.previsions.horizons?.[0]]?.liberations) || 0), 0);
    const cartes = heb ? [
      carte('suivis', K('g_suivis_res'), P, { sous: 'patients' }),
      carte('admission', K('e_attente_admission_heb'), etapes(['attente_admission_heb']), { sous: 'patients', etape: 'attente_admission_heb' }),
      carte('conservees', K('g_conservees'), etapes(['hospitalise_externe', 'absent', 'retour_a_reintegrer']), { sous: 'patients', etape: 'hospitalise_externe' }),
      carte('transferts', K('e_transfert_en_cours'), etapes(['transfert_en_cours']), { sous: 'patients', etape: 'transfert_en_cours' }),
      carte('amb', K('g_amb_route'), A.filter((a) => a.objet === 'transport'), { sous: 'ambulances' }),
      carte('nettoyage', K('g_nettoyage'), C.filter((c) => String(c.type).startsWith('nettoyage')), { sous: 'capacites' }),
      carte('alertes', K('g_alertes'), AL, { sous: 'alertes' }),
    ] : [
      carte('suivis', K('g_suivis'), P, { sous: 'patients' }),
      carte('admission', K('g_attente_admission'), etapes(['attente_lit', 'lit_assigne']), { sous: 'patients', etape: 'attente_lit' }),
      carte('nsa', K('g_nsa'), etapes(['nsa']), { sous: 'patients', etape: 'nsa' }),
      carte('transferts', K('g_transferts'), P.filter((x) => (x.paralleles || []).length), { sous: 'patients', etape: 'attente_transfert' }),
      carte('route', K('g_amb_route'), A.filter((a) => (a.objet === 'prealerte' && a.phase !== 'sur_place') || a.objet === 'transport'), { sous: 'ambulances' }),
      carte('immob', K('g_amb_immob'), A.filter((a) => a.objet === 'prealerte' && a.phase === 'sur_place'), { sous: 'ambulances' }),
      carte('nettoyage', K('g_nettoyage'), C.filter((c) => String(c.type).startsWith('nettoyage')), { sous: 'capacites' }),
      carte('reserve', K('g_reserve'), C.filter((c) => c.type === 'reserve'), { sous: 'capacites' }),
      ...(prev != null ? [carte('prev', K('g_prev'), [], { sous: 'previsions' }, { val: prev, estime: true })] : []),
      carte('alertes', K('g_alertes'), AL, { sous: 'alertes' }),
    ];
    // Situations prioritaires : escalade d'abord, puis vigilance ; 6 au plus (« Voir tout » ouvre le sous-menu)
    const toutes = [...P.map((x) => ['patients', x]), ...C.map((x) => ['capacites', x]), ...AL.map((x) => ['alertes', x])].filter(([, x]) => ['rouge', 'orange'].includes(x.niveau))
      .sort((a, b) => RANG[b[1].niveau] - RANG[a[1].niveau] || new Date(a[1].depuis || 0) - new Date(b[1].depuis || 0));
    const prio = toutes.slice(0, 6).map(([k, x]) => (k === 'patients' ? carteSejour(x) : k === 'capacites' ? rendus.ressource(x) : rendus.alerte(x))).join('');
    // OG — Priorités : les propositions explicites déjà calculées par séjour (aucune action automatique)
    const og = P.filter((x) => x.recommandation).sort((a, b) => RANG[b.niveau] - RANG[a.niveau]).slice(0, 5);
    const nett = C.filter((c) => c.type === 'nettoyage_attente' && ['orange', 'rouge'].includes(c.niveau)).length;
    const ogHtml = `<ol class="og-priorites">${og.map((x) => `<li class="niveau-${esc(x.niveau)}"><button type="button" class="lien" data-sejour="${esc(x.reference)}"><b>${esc(x.reference)}</b></button> · ${etape(x.etape)} · ${reco(x.recommandation)}
        <span class="note">(${motNiveau(x.niveau)}${x.depuis ? ` · <span class="duree-seule num" data-depuis="${esc(x.depuis)}">--:--:--</span>` : ''})</span></li>`).join('')}
      ${nett ? `<li class="niveau-orange">${K('g_nettoyage')} : ${nett} · <button type="button" class="lien" data-aller-chrono="capacites">${K('g_voir', { n: nett })}</button></li>` : ''}</ol>`;
    return `<div class="grille-supervision">${cartes.join('')}</div>
      <div class="grille-2-chrono">
        <section class="bloc-c"><header class="bloc-tete"><h3>${K('g_prioritaires')}</h3>${toutes.length > 6 ? `<button type="button" class="lien" data-aller-chrono="patients" data-aller-niveau="rouge">${K('g_voir', { n: toutes.length })}</button>` : ''}</header>
          ${prio ? `<div class="grille-sejours compacte">${prio}</div>` : `<p class="note">${K('g_aucune')}</p>`}</section>
        <section class="bloc-c"><header class="bloc-tete"><h3>${K('g_og')}</h3></header><p class="note">${K('g_og_note')}</p>${og.length || nett ? ogHtml : `<p class="note">${K('g_og_vide')}</p>`}</section>
      </div>${tableT5(d.performance_t5)}`;
  }

  /* ---------- Patients et séjours ---------- */
  const ETAPES_SEJOUR = ['urgence_civiere', 'attente_lit', 'lit_assigne', 'hospitalise', 'nsa', 'conge_prevu'];
  const etape = (k) => K(`e_${k}`);
  const lieu = (x) => [...new Set([x.departement ? esc(x.departement) : x.objet === 'civiere' ? K('s_urgence') : x.objet === 'admission' ? K(`s_prov_${['urgence', 'bloc', 'externe'].includes(x.provenance) ? x.provenance : 'autre'}`) : '',
    x.service ? esc(x.service) : '', x.unite ? esc(x.unite) : ''].filter(Boolean))].join(' · ');
  const emplacement = (x) => (x.objet === 'lit' ? `${x.chambre ? `${K('s_chambre')} ${esc(x.chambre)} · ` : ''}${K('s_lit')} ${esc(x.ressource)}`
    : x.objet === 'civiere' ? `${K('s_civiere')} ${esc(x.ressource)}${x.corridor ? ` · ${K('s_corridor')}` : ''}` : K('s_sans_lit'));
  const quandCourt = (v) => (v ? esc(new Date(v).toLocaleString(langue === 'en' ? 'en-CA' : 'fr-CA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })) : '—');
  const motif = (m) => (!m ? '' : m.code.startsWith('nsa_') ? K('m_nsa', { o: orientation(m.code.slice(4)) }) : ['attente_lit', 'attente_deplacement', 'attente_transport', 'reintegration', 'conge_depasse'].includes(m.code) ? K(`m_${m.code}`) : K('m_autre', { s: K(`src_${['patients', 'urgences', 'admissions', 'capacites', 'nsa', 'conges', 'transferts', 'transports', 'dsn', 'residents'].includes(m.source) ? m.source : 'patients'}`) }));
  const ORIENT = ['chsld', 'ri', 'readaptation', 'domicile', 'palliatif', 'autre'];
  const orientation = (o) => (ORIENT.includes(o) ? K(`o_${o}`) : esc(o));
  const destination = (d) => (!d ? '' : d === 'admission' ? K('e_attente_lit') : d.startsWith('lit ') ? `${K('s_lit')} ${esc(d.slice(4))}` : d.startsWith('nsa:') ? orientation(d.slice(4)) : esc(d));
  const paralleles = (l = []) => l.map((p) => K(`p_${['transfert', 'transport', 'hebergement'].includes(p.type) ? p.type : 'transport'}`, { n: p.numero, s: p.statut })).join(' · ');
  const RECO = ['organiser_transport_transfert', 'suivre_hebergement', 'evaluer_orientation', 'chercher_lit', 'confirmer_deplacement', 'relancer_placement_nsa', 'organiser_transport_conge', 'confirmer_conge', 'suivre_admission_heb', 'verifier_retour', 'preparer_reintegration'];
  const reco = (r) => (r && RECO.includes(r) ? K(`r_${r}`) : '');
  const ETAPES_ACTIVES = () => (hebergementC() ? ['attente_admission_heb', 'resident_present', 'hospitalise_externe', 'absent', 'retour_a_reintegrer', 'transfert_en_cours'] : ETAPES_SEJOUR);
  function carteSejour(x) {
    const seuil = x.seuils_min ? K('s_seuils', { v: dureeCourte(x.seuils_min.vigilance), e: dureeCourte(x.seuils_min.escalade) })
      : x.etape === 'conge_prevu' && x.echeance ? K('s_sortie_prevue', { h: heureCourte(x.echeance) }) : K('s_sans_seuil');
    const total = anneauGrand({ depuis: x.sejour_depuis, seuils: x.sejour_seuils_min, niveau: x.niveau_sejour || (x.sejour_depuis ? 'bleu' : 'gris'), etiquette: K('s_total') });
    const et = anneauGrand({ depuis: x.depuis, seuils: x.seuils_min, echeance: x.echeance, marge: x.marge_min, niveau: x.niveau_etape || x.niveau, petit: true,
      etiquette: x.etape === 'conge_prevu' && x.echeance && new Date(x.echeance) > new Date() ? K('s_avant_sortie') : K('s_etape_actuelle') });
    const info = [
      lieu(x), `<b>${emplacement(x)}</b>${x.place_conservee ? ` · <span class="badge-flux">${K('s_place_conservee')}</span>` : ''}`,
      x.arrivee_le ? K('s_arrivee', { h: quandCourt(x.arrivee_le) }) : '',
      x.destination_prevue ? K('s_destination', { d: destination(x.destination_prevue) }) : '',
      x.motif_attente ? K('s_motif', { m: motif(x.motif_attente) }) : '',
      x.paralleles?.length ? K('s_parallele', { p: paralleles(x.paralleles) }) : '',
    ].filter(Boolean);
    return `<article class="carte-chrono carte-sejour niveau-${esc(x.niveau || 'gris')}" data-niveau-carte data-sejour="${esc(x.reference)}" tabindex="0" role="button" aria-label="${K('s_ouvrir', { r: x.reference })}">
      <header class="cs-tete"><h4><span class="ref-patient">${esc(x.reference)}</span></h4><span class="etape-badge">${etape(x.etape)}</span></header>
      <div class="cs-anneaux">${total}${et}</div>
      <div class="cc-corps">${info.map((l) => `<p>${l}</p>`).join('')}<p class="note">${seuil}</p>
        ${reco(x.recommandation) ? `<p class="cs-og"><b>OG</b> ${K('s_og', { r: reco(x.recommandation) })}</p>` : ''}
        <p class="cc-niveau"><span class="pastille-chrono"></span><span class="cc-mot">${motNiveau(x.niveau)}</span></p></div></article>`;
  }
  /** Vue compacte : une ligne par patient, mêmes compteurs (étape, séjour), même clic vers le parcours. */
  function ligneSejour(x) {
    const d = (depuis, s) => (depuis ? `<b class="num duree-seule" data-depuis="${esc(depuis)}"${seuilsAttr(s, depuis)}>--:--:--</b>` : `<span class="note">${K('u_inconnu')}</span>`);
    return `<tr class="niveau-${esc(x.niveau || 'gris')}" data-niveau-carte data-sejour="${esc(x.reference)}" tabindex="0" role="button" aria-label="${K('s_ouvrir', { r: x.reference })}">
      <th><span class="pastille-chrono"></span> ${esc(x.reference)}</th><td>${etape(x.etape)}</td><td>${lieu(x) || '—'}</td><td>${emplacement(x)}</td>
      <td>${d(x.depuis, x.seuils_min)}</td><td>${d(x.sejour_depuis, x.sejour_seuils_min)}</td><td><span class="cc-mot">${motNiveau(x.niveau)}</span></td></tr>`;
  }
  const filtreP = () => (etatC.fp || (etatC.fp = {}));
  function filtrer(liste) {
    const f = filtreP(); const q = (f.patient || '').trim().toLowerCase();
    return liste.filter((x) => (!f.departement || (f.departement === 'aucun' ? !x.departement_id : String(x.departement_id) === f.departement))
      && (!f.service || String(x.service_id) === f.service) && (!f.unite || String(x.unite_id) === f.unite)
      && (!f.etape || (f.etape === 'attente_transfert' ? (x.paralleles || []).length > 0 : x.etape === f.etape)) && (!f.niveau || x.niveau === f.niveau)
      && (!q || String(x.reference).toLowerCase().includes(q)));
  }
  const ms = (v) => (v ? Date.now() - new Date(v).getTime() : -1);
  function trier(l) {
    const t0 = filtreP().tri || 'niveau'; const c = [...l];
    if (t0 === 'sejour') c.sort((a, b) => ms(b.sejour_depuis) - ms(a.sejour_depuis));
    else if (t0 === 'etape') c.sort((a, b) => ms(b.depuis) - ms(a.depuis));
    else if (t0 === 'ref') c.sort((a, b) => String(a.reference).localeCompare(String(b.reference)));
    else if (t0 === 'dep') c.sort((a, b) => String(a.departement || '~').localeCompare(String(b.departement || '~')) || ms(b.depuis) - ms(a.depuis));
    return c; // « niveau » : ordre du serveur (niveau, puis durée de l'étape)
  }
  function indicateurs(tous, vus) {
    const n = (l, k) => l.filter((x) => x.niveau === k).length; const f = filtreP();
    const tuile = (cle, val, lib, cls = '', filtre = null) => `<button type="button" class="tuile-c ds-kpi ${cls}"${filtre ? ` data-filtre-niveau="${filtre}" aria-pressed="${f.niveau === filtre}"` : ' data-filtre-niveau=""'}><span class="gros ds-kpi-val num">${val}</span><span class="ds-kpi-lib">${lib}</span>${vus.length !== tous.length ? `<span class="note">${K('s_sur_total', { n: cle(tous) })}</span>` : ''}</button>`;
    const c = (k) => (l) => n(l, k);
    return `<div class="tuiles-chrono tuiles-sejours">
      ${tuile((l) => l.length, vus.length, hebergementC() ? K('s_presents_res') : K('s_presents'))}
      ${tuile(c('orange'), n(vus, 'orange'), K('s_vigilance'), 'ton-orange', 'orange')}
      ${tuile(c('rouge'), n(vus, 'rouge'), K('s_escalade'), 'ton-rouge', 'rouge')}
      ${tuile(c('gris'), n(vus, 'gris'), K('s_inconnus'), 'ton-gris', 'gris')}</div>
      <div class="etapes-compte" role="group" aria-label="${K('s_par_etape')}">${ETAPES_ACTIVES().map((k) => `<button type="button" class="puce-etape" data-filtre-etape="${k}" aria-pressed="${f.etape === k}">${etape(k)} <b class="num">${vus.filter((x) => x.etape === k).length}</b></button>`).join('')}
        ${hebergementC() ? '' : `<button type="button" class="puce-etape" data-filtre-etape="attente_transfert" aria-pressed="${f.etape === 'attente_transfert'}">${K('s_attente_transfert')} <b class="num">${vus.filter((x) => (x.paralleles || []).length).length}</b></button>`}</div>`;
  }
  function vuePatients(d) {
    const o = d.organisation || { departements: [], services: [], unites: [] }; const f = filtreP();
    const opt = (l, cle, nom = (x) => x.nom) => l.map((x) => `<option value="${esc(x.id)}"${String(f[cle] || '') === String(x.id) ? ' selected' : ''}>${esc(nom(x))}</option>`).join('');
    const services = o.services.filter((x) => !f.departement || String(x.departement_id) === f.departement);
    const unites = o.unites.filter((x) => (!f.departement || String(x.departement_id) === f.departement) && (!f.service || String(x.service_id) === f.service));
    const sansDep = d.patients.some((x) => !x.departement_id);
    return `<form class="filtres-chrono" id="chp-filtres" role="search" aria-label="${K('s_filtres')}">
        <label${o.departements.length ? '' : ' hidden'}>${K('s_departement')}<select name="departement"><option value="">${K('s_tous')}</option>${opt(o.departements, 'departement')}${sansDep ? `<option value="aucun"${f.departement === 'aucun' ? ' selected' : ''}>${K('s_sans_departement')}</option>` : ''}</select></label>
        <label${o.services.length ? '' : ' hidden'}>${K('s_service')}<select name="service"><option value="">${K('s_tous')}</option>${opt(services, 'service')}</select></label>
        <label>${K('s_unite')}<select name="unite"><option value="">${K('s_toutes')}</option>${opt(unites, 'unite')}</select></label>
        <label>${K('s_patient')}<input type="search" name="patient" value="${esc(f.patient || '')}" placeholder="P-00000" autocomplete="off" spellcheck="false"></label>
        <label>${K('s_etape')}<select name="etape"><option value="">${K('s_toutes')}</option>${ETAPES_ACTIVES().map((k) => `<option value="${k}"${f.etape === k ? ' selected' : ''}>${etape(k)}</option>`).join('')}${hebergementC() ? '' : `<option value="attente_transfert"${f.etape === 'attente_transfert' ? ' selected' : ''}>${K('s_attente_transfert')}</option>`}</select></label>
        <label>${K('s_niveau')}<select name="niveau"><option value="">${K('s_tous')}</option>${NIVEAUX.map((k) => `<option value="${k}"${f.niveau === k ? ' selected' : ''}>${motNiveau(k)}</option>`).join('')}</select></label>
        <label>${K('s_tri')}<select name="tri">${[['niveau', 's_tri_niveau'], ['sejour', 's_tri_sejour'], ['etape', 's_tri_etape'], ['dep', 's_tri_dep'], ['ref', 's_tri_ref']].map(([v, k]) => `<option value="${v}"${(f.tri || 'niveau') === v ? ' selected' : ''}>${K(k)}</option>`).join('')}</select></label>
        <div class="bascule-vue" role="group" aria-label="${K('s_vue')}"><button type="button" data-vue-sejours="cartes" aria-pressed="${f.vue !== 'compacte'}">${K('s_vue_cartes')}</button><button type="button" data-vue-sejours="compacte" aria-pressed="${f.vue === 'compacte'}">${K('s_vue_compacte')}</button></div>
        <button type="button" class="btn" id="chp-raz">${K('s_reinitialiser')}</button></form>
      <div id="chp-zone">${zonePatients(d)}</div>
      <p class="note">${K('s_note')}</p>`;
  }
  function zonePatients(d) {
    const vus = trier(filtrer(d.patients));
    const liste = filtreP().vue === 'compacte'
      ? `<div class="tableau"><table class="table-sejours"><thead><tr><th>${K('s_patient')}</th><th>${K('s_etape')}</th><th>${K('s_departement')}</th><th>${K('s_lit')}</th><th>${K('s_etape_actuelle')}</th><th>${K('s_total')}</th><th>${K('s_niveau')}</th></tr></thead><tbody>${vus.map(ligneSejour).join('')}</tbody></table></div>`
      : `<div class="grille-sejours">${vus.map(carteSejour).join('')}</div>`;
    return `${indicateurs(d.patients, vus)}${vus.length ? liste : `<p class="note vide-chrono">${d.patients.length ? K('s_aucun_filtre') : K('s_aucun')}</p>`}`;
  }
  function brancherPatients(d) {
    const form = $('#chp-filtres'); if (!form) return;
    const majZone = () => { $('#chp-zone').innerHTML = zonePatients(d); brancherFiches($('#chp-zone')); window.ArrimoDuree?.tic(); recolorer($('#chp-zone')); brancherTuiles(); };
    const brancherTuiles = () => {
      $('#chp-zone').querySelectorAll('[data-filtre-niveau]').forEach((b) => { b.onclick = () => { filtreP().niveau = filtreP().niveau === b.dataset.filtreNiveau ? '' : b.dataset.filtreNiveau; form.niveau.value = filtreP().niveau; majZone(); }; });
      $('#chp-zone').querySelectorAll('[data-filtre-etape]').forEach((b) => { b.onclick = () => { filtreP().etape = filtreP().etape === b.dataset.filtreEtape ? '' : b.dataset.filtreEtape; form.etape.value = filtreP().etape; majZone(); }; });
    };
    form.onsubmit = (e) => e.preventDefault();
    form.oninput = form.onchange = (e) => {
      const f = filtreP(); const n = e.target.name; if (!n) return;
      f[n] = e.target.value;
      // Cascade : un département change les services et unités proposés ; on redessine les filtres sans perdre la saisie
      if (n === 'departement' || n === 'service') { if (n === 'departement') { f.service = ''; f.unite = ''; } else f.unite = ''; vueChrono(); return; }
      majZone();
    };
    $('#chp-raz').onclick = () => { etatC.fp = {}; vueChrono(); };
    form.querySelectorAll('[data-vue-sejours]').forEach((b) => { b.onclick = () => { filtreP().vue = b.dataset.vueSejours; form.querySelectorAll('[data-vue-sejours]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); majZone(); }; });
    brancherTuiles();
  }
  function brancherFiches(racine) {
    racine.querySelectorAll('[data-sejour]').forEach((c) => {
      c.onclick = () => ouvrirSejour(c.dataset.sejour);
      c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrirSejour(c.dataset.sejour); } };
    });
  }
  /** Décomposition complète du séjour : chaque étape (ouverte ou close), début, fin, durée, seuil, niveau, source ; frise proportionnelle. */
  async function ouvrirSejour(ref) {
    const r = await api('GET', `/chrono/sejour?etablissement_id=${etat.ctx}&reference=${encodeURIComponent(ref)}`).catch((e) => { toast(e.message, true); return null; });
    if (!r) return;
    const hh = window.ArrimoDuree.hhmmss; const now = Date.now();
    const debutFrise = Math.min(...r.etapes.filter((e) => e.debut).map((e) => new Date(e.debut).getTime()), now);
    const span = Math.max(60000, now - debutFrise);
    const pos = (e) => { const a = (new Date(e.debut).getTime() - debutFrise) / span * 100; const b = ((e.fin ? new Date(e.fin).getTime() : now) - debutFrise) / span * 100; return `left:${a.toFixed(2)}%;width:${Math.max(0.8, b - a).toFixed(2)}%`; };
    const parDep = (r.par_departement || []).length ? `<div class="par-dep"><h4>${K('s_par_dep')}</h4><ul class="puces-dep">${r.par_departement.map((x) => `<li><span>${x.departement ? esc(x.departement) : K('s_sans_departement')}</span> <b class="num">${hh(x.duree_min * 60000)}</b>${x.en_cours ? ` <span class="note">${K('s_en_cours')}</span>` : ''}</li>`).join('')}</ul>
      ${r.etape_plus_longue ? `<p class="note">${K('s_plus_long')} : <b>${etape(r.etape_plus_longue)}</b></p>` : ''}</div>` : '';
    const libEtape = (e) => (e.etape.startsWith('passage_') ? K(`e_passage_${['urgence', 'consultation', 'admission'].includes(e.etape.slice(8)) ? e.etape.slice(8) : 'urgence'}`) : etape(e.etape));
    const a = r.actif;
    const tete = a ? `<div class="sejour-tete">${anneauGrand({ depuis: a.depuis, seuils: a.seuils_min, echeance: a.echeance, marge: a.marge_min, niveau: a.niveau, etiquette: etape(a.etape) })}
        <div><p class="gros-ref">${esc(r.reference)}</p><p>${lieu(a)}</p><p><b>${emplacement(a)}</b></p>
        <p>${K('s_sejour')} <b class="num duree-seule" data-depuis="${esc(r.sejour_depuis)}">--:--:--</b></p><p class="cc-niveau niveau-${esc(a.niveau)}"><span class="pastille-chrono"></span>${motNiveau(a.niveau)}</p></div></div>`
      : `<p class="gros-ref">${esc(r.reference)}</p><p class="note">${K('s_clos')}</p>`;
    const frise = `<div class="frise-sejour" role="img" aria-label="${K('s_frise', { n: r.etapes.length })}">${r.etapes.filter((e) => e.debut).map((e) => `<div class="frise-ligne"><span class="frise-lib">${libEtape(e)}</span><span class="frise-piste"><span class="frise-seg niveau-${esc(e.niveau)}" style="${pos(e)}"></span></span></div>`).join('')}
      <div class="frise-axe note"><span>${esc(new Date(debutFrise).toLocaleString(langue === 'en' ? 'en-CA' : 'fr-CA', { dateStyle: 'short', timeStyle: 'short' }))}</span><span>${K('s_maintenant')}</span></div></div>`;
    const quand = (v) => (v ? esc(new Date(v).toLocaleString(langue === 'en' ? 'en-CA' : 'fr-CA', { dateStyle: 'short', timeStyle: 'medium' })) : '—');
    const table = `<div class="tableau"><table class="table-sejour"><thead><tr><th>${K('s_etape')}</th><th>${K('s_debut')}</th><th>${K('s_fin')}</th><th>${K('s_duree')}</th><th>${K('s_seuil')}</th><th>${K('s_niveau')}</th><th>${K('s_source')}</th></tr></thead><tbody>
      ${r.etapes.map((e) => `<tr${e.rang_delai ? ` class="rang-delai"` : ''}><th>${libEtape(e)}${e.rang_delai ? ` <span class="badge-flux">${K('s_rang', { n: e.rang_delai })}</span>` : ''}${e.departement ? ` <span class="note">${esc(e.departement)}</span>` : ''}${e.numero ? ` <span class="note">${esc(e.numero)}</span>` : ''}${e.ressource ? ` <span class="note">${esc(e.ressource)}</span>` : ''}</th><td>${quand(e.debut)}</td><td>${e.en_cours ? `<b>${K('s_en_cours')}</b>` : quand(e.fin)}</td>
        <td class="num">${e.en_cours && e.debut ? `<span class="duree-seule" data-depuis="${esc(e.debut)}">--:--:--</span>` : e.duree_min != null ? hh(e.duree_min * 60000) : '—'}</td>
        <td>${e.seuils_min ? `${dureeCourte(e.seuils_min.vigilance)} / ${dureeCourte(e.seuils_min.escalade)}` : e.echeance ? K('s_sortie_prevue', { h: heureCourte(e.echeance) }) : '—'}</td>
        <td><span class="cc-niveau niveau-${esc(e.niveau)}"><span class="pastille-chrono"></span>${motNiveau(e.niveau)}</span></td><td>${K(`src_${['patients', 'urgences', 'admissions', 'capacites', 'nsa', 'conges', 'transferts', 'transports', 'dsn', 'residents'].includes(e.source) ? e.source : 'patients'}`)}</td></tr>`).join('')}
      </tbody></table></div>`;
    const ouvrir = [['urgence', 'urgences'], ['admissions', 'admissions'], ['lits', 'capacites'], ['nsa', 'nsa'], ['patients', 'patients'], ['c-residents', 'residents']]
      .filter(([vue, src]) => r.etapes.some((e) => e.source === src) && document.querySelector(`#onglets button[data-v="${vue}"]`));
    modale(K('s_detail_titre', { r: r.reference }), `<div class="sejour-detail">${tete}<h4>${K('s_decomposition')}</h4>${frise}${parDep}${table}
      <p class="note">${K('s_note_detail')}</p>${ouvrir.length ? `<p class="actions-sejour">${ouvrir.map(([vue]) => `<button type="button" class="btn" data-ouvrir-vue="${vue}">${vue === 'c-residents' ? K('s_ouvrir_residents') : K(`s_ouvrir_${vue}`)}</button>`).join('')}</p>` : ''}</div>`,
    [{ label: t('general.fermer') }]);
    const m = $('#modale'); m.querySelector('.boite')?.classList.add('large');
    m.querySelectorAll('[data-ouvrir-vue]').forEach((b) => { b.onclick = () => { m.hidden = true; allerA(b.dataset.ouvrirVue); }; });
    window.ArrimoDuree?.tic(); recolorer(m);
  }
  document.addEventListener('click', (ev) => {
    const g = ev.target.closest('[data-aller-chrono]'); if (!g || !document.getElementById('v-chrono')?.contains(g)) return;
    etatC.sous = g.dataset.allerChrono;
    if (etatC.sous === 'patients') etatC.fp = { etape: g.dataset.allerEtape || '', niveau: g.dataset.allerNiveau || '' };
    vueChrono();
  });
  document.addEventListener('click', (ev) => { const b = ev.target.closest('[data-sous-chrono]'); if (!b || !document.getElementById('v-chrono')?.contains(b)) return; etatC.sous = b.dataset.sousChrono; vueChrono(); });
  window.ArrimoChrono = { vues: { chrono: vueChrono } };
})();
