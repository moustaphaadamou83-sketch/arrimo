/* Accueil universel (cahier directeur, 21-22 nov. 2026) : UN moteur d'affichage pour tous les établissements et rôles.
   Zones : A identité (bandeau) · B situation compacte + 4 à 6 indicateurs cliquables · C Arrimo Flux | Bourse des places
   · D Chrono (hôpital, module actif) · E Préalertes et priorités · F Mes tâches · G Prévisions compactes.
   Chaque zone n'apparaît que si elle est pertinente (type, rôle, modules, données) ; aucune donnée inventée ; détails dans les modules. */
(() => {
  const TXT = {
    fr: { fermer: 'Fermer', personnaliser: 'Personnaliser l’Accueil', perso_titre: 'Zones affichées sur votre Accueil', perso_note: 'Choix enregistré sur cet appareil ; les données et les droits ne changent pas.',
      monter: 'Monter', z: { flux: 'Arrimo Flux et Bourse', chrono: 'Chrono', priorites: 'Préalertes et priorités', taches: 'Mes tâches', previsions: 'Prévisions', syntheses: 'Synthèses des modules' },
      presentation: 'Mode présentation', quitter_presentation: 'Quitter la présentation', presentation_note: 'Démonstration seulement : les écrans défilent toutes les 20 s (Échap pour arrêter).',
      reseau: 'Réseau', national: 'National', ouvrir_reseau: 'Ouvrir Réseau', ouvrir_national: 'Ouvrir National',
      etablissements: 'Établissements visibles', regions: 'Régions représentées', places_libres: 'Places d’hébergement libres', lits_libres: 'Lits libres',
      attentes_visibles: 'Admissions en attente dans les établissements qui partagent ce chiffre',
      transports_locaux: 'Transports en cours depuis ou vers cet établissement', niveaux_eleve: 'Établissements en orange ou rouge',
      niveaux_rouge: 'Établissements en rouge', taux_occupation: 'Lits occupés sur lits dotés', synthese_og: 'OG · Préalertes et priorités',
      situation: 'Situation :', niveau: { vert: 'Niveau vert', jaune: 'Niveau jaune', orange: 'Niveau orange', rouge: 'Niveau rouge' }, pourquoi: 'Pourquoi ce niveau ? (OG)', calcule: 'Calculé à {h}',
      vue: 'Vue d’ensemble', chrono: 'Chrono · ambulances à la porte', a_porte: 'À la porte', attente_max: 'Attente la plus longue', moyen: 'Délai moyen des derniers passages (H11→H14)', depasse: 'Au-delà du seuil ({s} min)', en_route: 'Annoncées en route',
      ouvrir_chrono: 'Ouvrir Chrono', min: '{n} min', aucune_porte: 'Aucune ambulance à la porte.', priorites: 'Préalertes et priorités', voir_tout: 'Tout voir', agir: 'Ouvrir et agir', aucune_priorite: 'Aucune priorité en attente.',
      taches: 'Mes tâches', ouvrir_taches: 'Ouvrir Mes tâches', a_faire: 'à faire', en_cours: 'en cours', retard: 'en retard', aucune_tache: 'Aucune tâche ouverte pour vous.', attribuer: 'Attribuer', file: 'File du rôle (non attribuée)', non_attr: 'Non attribuées : {n}', attribuee: 'Tâche attribuée.', a_qui: 'Attribuer à', previsions: 'Prévisions',
      prev_ligne: 'Dans {h} h : ~{n} lits libres (± {m})', prev_risque: 'risque de saturation : {u}', prev_note: 'Estimation sur {s} semaines d’historique : une projection, pas une certitude.', details: 'Analyse détaillée d’OG (recommandations, plans, réseau, capacités)', donnees: 'Données lues à {h}', supervision: 'Mode supervision', kpi_comment: 'Comment est calculé : {k}', kpi_formule: 'Formule', kpi_source: 'Source', kpi_perimetre: 'Périmètre', kpi_periode: 'Période', kpi_actualisation: 'Actualisation', kpi_exclusions: 'Exclusions', kpi_manquantes: 'Données manquantes', kpi_permissions: 'Qui le voit', kpi_lu: 'Valeur lue à {h}', quitter_supervision: 'Quitter la supervision' },
    en: { fermer: 'Close', personnaliser: 'Customize Home', perso_titre: 'Zones shown on your Home', perso_note: 'Choice saved on this device; data and rights do not change.',
      monter: 'Move up', z: { flux: 'Arrimo Flow and Exchange', chrono: 'Chrono', priorites: 'Pre-alerts and priorities', taches: 'My tasks', previsions: 'Forecasts', syntheses: 'Module summaries' },
      presentation: 'Presentation mode', quitter_presentation: 'Leave presentation', presentation_note: 'Demonstration only: screens rotate every 20 s (Esc to stop).',
      reseau: 'Network', national: 'National', ouvrir_reseau: 'Open Network', ouvrir_national: 'Open National',
      etablissements: 'Visible facilities', regions: 'Regions represented', places_libres: 'Available care home places', lits_libres: 'Available beds',
      attentes_visibles: 'Pending admissions at facilities that share this count',
      transports_locaux: 'Active transport to or from this facility', niveaux_eleve: 'Facilities at orange or red level',
      niveaux_rouge: 'Facilities at red level', taux_occupation: 'Occupied beds as a share of staffed beds', synthese_og: 'OG · Pre-alerts and priorities',
      situation: 'Status:', niveau: { vert: 'Green level', jaune: 'Yellow level', orange: 'Orange level', rouge: 'Red level' }, pourquoi: 'Why this level? (OG)', calcule: 'Computed at {h}',
      vue: 'Overview', chrono: 'Chrono · ambulances at the door', a_porte: 'At the door', attente_max: 'Longest wait', moyen: 'Average time for recent visits (H11→H14)', depasse: 'Over threshold ({s} min)', en_route: 'Announced on the way',
      ouvrir_chrono: 'Open Chrono', min: '{n} min', aucune_porte: 'No ambulance at the door.', priorites: 'Pre-alerts and priorities', voir_tout: 'See all', agir: 'Open and act', aucune_priorite: 'No pending priority.',
      taches: 'My tasks', ouvrir_taches: 'Open My tasks', a_faire: 'to do', en_cours: 'in progress', retard: 'overdue', aucune_tache: 'No open task for you.', attribuer: 'Assign', file: 'Role queue (unassigned)', non_attr: 'Unassigned: {n}', attribuee: 'Task assigned.', a_qui: 'Assign to', previsions: 'Forecasts',
      prev_ligne: 'In {h} h: ~{n} free beds (± {m})', prev_risque: 'saturation risk: {u}', prev_note: 'Estimate based on {s} weeks of history: a projection, not a certainty.', details: 'OG detailed analysis (recommendations, plans, network, capacity)', donnees: 'Data read at {h}', supervision: 'Wall display mode', kpi_comment: 'How it is calculated: {k}', kpi_formule: 'Formula', kpi_source: 'Source', kpi_perimetre: 'Scope', kpi_periode: 'Period', kpi_actualisation: 'Refresh', kpi_exclusions: 'Exclusions', kpi_manquantes: 'Missing data', kpi_permissions: 'Who sees it', kpi_lu: 'Value read at {h}', quitter_supervision: 'Leave wall display' },
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
      <button type="button" class="btn" data-acc-supervision aria-pressed="${document.body.classList.contains('supervision')}"><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-monitor"/></svg> ${T(document.body.classList.contains('supervision') ? 'quitter_supervision' : 'supervision')}</button>
      <button type="button" class="btn" data-acc-perso><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-palette"/></svg> ${T('personnaliser')}</button>
      ${o.presentation ? `<button type="button" class="btn" data-acc-presentation aria-pressed="${!!window.__presentation}" title="${T('presentation_note')}">${T(window.__presentation ? 'quitter_presentation' : 'presentation')}</button>` : ''}</div></div>
      ${n ? `<div class="acc-niveau-details" hidden>${n.details || ''}<p class="note">${n.le ? T('calcule', { h: h(n.le) }) : ''}</p><button type="button" class="btn" data-acc-og="${e(n.question)}">${T('pourquoi')}</button></div>` : ''}
      <div class="acc-kpis">${kpis.map((k) => `<div class="acc-kpi-c">${k.code ? `<button type="button" class="acc-kpi-i" data-acc-kpi="${e(k.code)}" aria-label="${e(T('kpi_comment', { k: k.lib }))}" title="${e(T('kpi_comment', { k: k.lib }))}"><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-info"/></svg></button>` : ''}<${k.aller ? `button type="button" data-acc-aller="${e(k.aller)}"` : 'div'} class="acc-kpi${k.ton ? ` ${k.ton}` : ''}"><span class="v num">${e(k.val)}</span><span class="lbl">${e(k.lib)}</span>${k.note ? `<span class="note">${e(k.note)}</span>` : ''}</${k.aller ? 'button' : 'div'}></div>`).join('')}</div></section>`;
  }
  /** Zone D : Chrono compact, d'après le moteur Chrono existant (passages réels, seuils configurés). */
  async function chrono(zone, o) {
    let c; try { c = await o.api('GET', `/chrono?etablissement_id=${o.etablissement_id}`); } catch { zone.remove(); return; }
    const seuil = c.cibles?.porte || 20; const porte = c.a_la_porte || [];
    const attente = porte.map((p) => p.a_la_porte_min).filter((x) => x != null);
    const auj = (c.termines || []).filter((p) => p.durees?.porte != null);
    const moyen = auj.length ? Math.round(auj.reduce((s, p) => s + p.durees.porte, 0) / auj.length) : null;
    const dep = c.attente?.seuil_atteint || 0;
    zone.innerHTML = `<section class="panneau-c acc-chrono"><div class="ligne" style="justify-content:space-between"><h3><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-timer"/></svg> ${T('chrono')}</h3><button class="btn" type="button" data-acc-aller="chrono">${T('ouvrir_chrono')}</button></div>
      <div class="acc-mini">${[[T('a_porte'), porte.length, porte.length ? 'alerte' : ''], [T('attente_max'), attente.length ? T('min', { n: Math.max(...attente) }) : '—', dep ? 'alerte' : ''], [T('depasse', { s: seuil }), dep, dep ? 'alerte' : ''],
        [T('moyen'), moyen != null ? T('min', { n: moyen }) : '—'], [T('en_route'), (c.en_route || []).length]].map(([l, v, ton]) => `<div class="acc-mini-k${ton ? ` ${ton}` : ''}"><b class="num">${e(v)}</b><span>${l}</span></div>`).join('')}</div>
      ${porte.length ? `<ul class="liste-simple">${porte.slice(0, 3).map((p) => `<li><b>${e(p.unite || p.unite_numero || p.numero)}</b> · ${T('min', { n: p.a_la_porte_min ?? '—' })}${p.niveau === 'rouge' ? ' <svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-triangle-alert"/></svg>' : ''}</li>`).join('')}</ul>` : `<p class="note">${T('aucune_porte')}</p>`}</section>`;
    lier(zone, o);
  }
  /** Zone F : Mes tâches (moteur unique des tâches : celles de mon rôle ou à mon nom). */
  async function taches(zone, o) {
    let l; try { l = await o.api('GET', `/taches/miennes?etablissement_id=${o.etablissement_id}`); } catch { zone.remove(); return; }
    const ouvertes = l.taches || []; const now = Date.now();
    const n = (f) => ouvertes.filter(f).length;
    zone.innerHTML = `<section class="panneau-c acc-taches"><div class="ligne" style="justify-content:space-between"><h3><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-check"/></svg> ${T('taches')}</h3><button class="btn" type="button" data-acc-aller="mes-taches">${T('ouvrir_taches')}</button></div>
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
    return `<section class="panneau-c acc-prev"><h3><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-trending-up"/></svg> ${T('previsions')}</h3><ul class="liste-simple">${lignes.join('')}</ul>${risques.length ? `<p><b>${T('prev_risque', { u: risques.join(', ') })}</b></p>` : ''}<p class="note">${T('prev_note', { s: p.semaines })}</p></section>`;
  }
  async function syntheses(zone, o) {
    const accessible = (vue) => {
      const b = document.querySelector(`#onglets button[data-v="${vue}"]`);
      return b && !b.hidden && !b.closest('[hidden]');
    };
    const domicile = o.etablissement_id;
    const reseauHopital = accessible('reseau');
    const reseauHebergement = accessible('c-reseau');
    const [reseau, national] = await Promise.all([
      reseauHopital ? o.reseau
        : reseauHebergement ? o.api('GET', `/chsld/reseau?etablissement_id=${domicile}`).catch(() => null) : null,
      accessible('national') ? o.api('GET', `/national/synthese?depuis=${domicile}`).catch(() => null) : null,
    ]);
    if (!zone.isConnected) return;
    const total = (lignes, champ) => lignes.reduce((somme, ligne) => somme + (ligne[champ] ?? 0), 0);
    const trafic = o.flux?.mouvements?.filter((m) => m.type === 'transport'
      && ['en_route', 'pris_en_charge'].includes(m.statut_brut)).length;
    const afficher = (nom, icone, vue, lignes) => `<section class="panneau-c"><h3><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-${icone}"/></svg> ${T(nom)}</h3>
      <dl class="acc-kpi-fiche">${lignes.filter(([, val]) => val != null).map(([cle, val]) => `<dt>${T(cle)}</dt><dd class="num">${e(val)}</dd>`).join('')}</dl>
      <button type="button" class="btn" data-acc-aller="${vue}">${T(`ouvrir_${nom}`)}</button></section>`;
    const cartes = [];
    if (reseauHopital && reseau?.etablissements) {
      const lignes = reseau.etablissements;
      const attentes = lignes.filter((x) => x.en_attente != null);
      cartes.push(afficher('reseau', 'network', 'reseau', [
        ['etablissements', lignes.length], ['lits_libres', total(lignes, 'libres')],
        ['attentes_visibles', attentes.length ? total(attentes, 'en_attente') : null],
        ['transports_locaux', trafic], ['niveaux_eleve', lignes.filter((x) => ['orange', 'rouge'].includes(x.niveau)).length],
      ]));
    } else if (reseauHebergement && reseau?.chsld) {
      cartes.push(afficher('reseau', 'network', 'c-reseau', [
        ['etablissements', new Set([...reseau.chsld, ...reseau.hopitaux].map((x) => x.id)).size],
        ['places_libres', total(reseau.chsld, 'libres')], ['transports_locaux', trafic],
      ]));
    }
    if (national) {
      cartes.push(afficher('national', 'map-pin', 'national', [
        ['etablissements', national.etablissements], ['regions', national.regions],
        ['taux_occupation', national.occupation == null ? null : `${national.occupation} %`], ['niveaux_rouge', national.alertes],
      ]));
    }
    zone.innerHTML = cartes.join('');
    zone.hidden = !cartes.length;
    lier(zone, o);
  }
  let catalogueKpi = null;
  function lier(zone, o) {
    zone.querySelectorAll('[data-acc-aller]').forEach((b) => { b.onclick = () => o.ouvrir?.(b.dataset.accAller); });
    // Fiche d'un KPI (catalogue central) : formule, source, période, actualisation ; aucune valeur inventée
    zone.querySelectorAll('[data-acc-kpi]').forEach((b) => { b.onclick = async () => {
      catalogueKpi = catalogueKpi || await o.api('GET', `/kpi/catalogue?langue=${L()}`).catch(() => []);
      const k = catalogueKpi.find((x) => x.code === b.dataset.accKpi); if (!k) return;
      const ligne = (c, v) => `<dt>${T(c)}</dt><dd>${e(v)}</dd>`;
      const html = `<p>${e(k.description)}</p><dl class="acc-kpi-fiche">${ligne('kpi_formule', k.formule)}${ligne('kpi_source', k.source)}${ligne('kpi_perimetre', k.perimetre)}${ligne('kpi_periode', k.periode)}${ligne('kpi_actualisation', k.actualisation)}${ligne('kpi_exclusions', k.exclusions)}${ligne('kpi_manquantes', k.manquantes)}${ligne('kpi_permissions', k.permissions)}</dl><p class="note">${T('kpi_lu', { h: h(new Date()) })}</p>`;
      if (o.modale) o.modale(k.nom, html, [{ label: 'OK', pri: true }]); else alert(`${k.nom}\n${k.formule}`);
    }; });
  }
  /**
   * Construit l'Accueil dans v. o = { api, etablissement_id, ouvrir, toast, modale, bourse, bandeau (html), niveau, kpis, chrono (bool),
   *   priorites ([{ texte, aller }]), previsions (objet du moteur), taches (bool), details (Node : ancien contenu, replié) }.
   */
  async function construire(v, o) {
    const details = o.details;
    v.innerHTML = `${o.bandeau || ''}${vueEnsemble(o)}<div id="acc-flux"></div>
      <div class="acc-grille">${o.chrono ? '<div id="acc-chrono"></div>' : ''}<section class="panneau-c acc-priorites"><div class="ligne" style="justify-content:space-between"><h3><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-megaphone"/></svg> ${T(o.reseau ? 'synthese_og' : 'priorites')}</h3></div><div id="acc-prealertes"></div>
        ${(o.priorites || []).length ? `<ul class="liste-simple">${o.priorites.slice(0, 4).map((p) => `<li class="acc-prio"><div><b>${e(p.texte)}</b>${p.raison ? `<div class="note">${e(p.raison)}</div>` : ''}</div>${p.aller ? `<button type="button" class="btn" data-acc-aller="${e(p.aller)}">${T('agir')}</button>` : ''}</li>`).join('')}</ul>` : ''}</section>
        ${o.taches ? '<div id="acc-taches"></div>' : ''}${previsions(o.previsions)}</div>`;
    const synthesesZone = document.createElement('div');
    synthesesZone.className = 'acc-grille';
    synthesesZone.hidden = true;
    v.appendChild(synthesesZone);
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
    // Tableau de bord personnalisable (cahier 7) : zones masquées et ordre, propres à l'utilisateur sur cet appareil
    const zones = { flux: v.querySelector('#acc-flux'), chrono: v.querySelector('#acc-chrono'), priorites: v.querySelector('.acc-priorites'),
      taches: v.querySelector('#acc-taches'), previsions: v.querySelector('.acc-prev'), syntheses: synthesesZone };
    appliquerPerso(zones);
    v.querySelector('[data-acc-perso]')?.addEventListener('click', () => personnaliser(zones, o));
    v.querySelector('[data-acc-presentation]')?.addEventListener('click', () => presentation(o));
    const travaux = [syntheses(synthesesZone, o)];
    if (window.ArrimoFluxVue) travaux.push(window.ArrimoFluxVue.panneau(v.querySelector('#acc-flux'), { ...o, prealertesDans: v.querySelector('#acc-prealertes') }));
    if (o.chrono) travaux.push(chrono(v.querySelector('#acc-chrono'), o));
    if (o.taches) travaux.push(taches(v.querySelector('#acc-taches'), o));
    await Promise.all(travaux.map((p) => p.catch(() => {})));
  }
  const cle = 'arrimo-accueil-perso';
  const lirePerso = () => { try { return JSON.parse(localStorage.getItem(cle)) || { masquees: [], ordre: [] }; } catch { return { masquees: [], ordre: [] }; } };
  const ecrirePerso = (p) => { try { localStorage.setItem(cle, JSON.stringify(p)); } catch { /* stockage indisponible */ } };
  function appliquerPerso(zones) {
    const p = lirePerso();
    for (const [k, z] of Object.entries(zones)) if (z) { z.classList.toggle('acc-masquee', p.masquees.includes(k)); const i = p.ordre.indexOf(k); z.style.order = i >= 0 ? String(i) : ''; }
  }
  function personnaliser(zones, o) {
    const p = lirePerso(); const presentes = Object.keys(zones).filter((k) => zones[k]);
    const liste = [...p.ordre.filter((k) => presentes.includes(k)), ...presentes.filter((k) => !p.ordre.includes(k))];
    const corps = `<p class="note">${T('perso_note')}</p><ol class="liste-simple acc-perso">${liste.map((k, i) => `<li><label><input type="checkbox" data-perso-z="${k}"${p.masquees.includes(k) ? '' : ' checked'}> ${T(`z.${k}`)}</label>
      ${i ? `<button type="button" class="btn lien" data-perso-monter="${k}">${T('monter')}</button>` : ''}</li>`).join('')}</ol>`;
    o.modale?.(T('perso_titre'), corps, [{ label: T('fermer'), pri: true }]);
    const boite = document.querySelector('#modale');
    boite?.querySelectorAll('[data-perso-z]').forEach((c) => { c.onchange = () => {
      const q = lirePerso(); q.masquees = c.checked ? q.masquees.filter((x) => x !== c.dataset.persoZ) : [...new Set([...q.masquees, c.dataset.persoZ])]; ecrirePerso(q); appliquerPerso(zones); }; });
    boite?.querySelectorAll('[data-perso-monter]').forEach((b) => { b.onclick = () => {
      const q = lirePerso(); const l = [...liste]; const i = l.indexOf(b.dataset.persoMonter); [l[i - 1], l[i]] = [l[i], l[i - 1]]; q.ordre = l; ecrirePerso(q); appliquerPerso(zones); personnaliser(zones, o); }; });
  }
  /** Mode présentation (cahier 7) : démonstration seulement ; les écrans principaux défilent ; Échap arrête. */
  function presentation(o) {
    if (window.__presentation) { clearInterval(window.__presentation); window.__presentation = null; document.body.classList.remove('mode-presentation'); o.rafraichir?.(); return; }
    document.body.classList.add('mode-presentation');
    const ecrans = ['accueil', 'vigilance', 'chrono', 'transferts'].filter((x) => document.querySelector(`#onglets button[data-v="${x}"]`));
    let i = 0;
    window.__presentation = setInterval(() => { i = (i + 1) % ecrans.length; o.ouvrir?.(ecrans[i]); }, 20000);
    const arret = (e) => { if (e.key === 'Escape' && window.__presentation) { clearInterval(window.__presentation); window.__presentation = null; document.body.classList.remove('mode-presentation'); document.removeEventListener('keydown', arret); } };
    document.addEventListener('keydown', arret);
    o.rafraichir?.();
  }
  window.ArrimoAccueil = { construire };
})();
