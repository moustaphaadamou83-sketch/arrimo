/* Modules Congés, Alertes et Départs (cahier « architecture fonctionnelle et suppression des redondances », 27 nov. 2026).
   - Congés (hôpital, §5) : préparation des sorties ; séparé des alertes. Un congé prévu ne rend jamais un lit disponible.
   - Alertes (hôpital et hébergement, §6) : UN espace pour les alertes opérationnelles, techniques, prédictives et de synchronisation.
     Même source que Chrono · Alertes et escalades et que la barre supérieure : Vigilance (faits détectés et expliqués) + suivis_alertes
     (accusé, action, escalade, résolution). Aucune seconde gestion des alertes.
   - Départs (hébergement, §7) : sorties et fins d'hébergement ; une hospitalisation temporaire n'est pas un départ (place conservée).
   Durées : [data-depuis] sur l'horloge commune (vue-transferts.js), donc identiques à Chrono à un même instant. */
(() => {
  const TX = {
    fr: {
      c_titre: 'Congés · {etab}', c_intro: 'Préparation des sorties hospitalières : heure prévue, destination, transport, obstacles au départ.',
      c_regle: 'Un congé prévu n’est jamais un lit libre. Le lit devient disponible après le départ effectif et sa remise en service (nettoyage, vérification).',
      k_aujourdhui: 'Prévus aujourd’hui', k_demain: 'Prévus demain', k_a_venir: 'À venir', k_confirmes: 'Confirmés', k_en_preparation: 'En préparation', k_retardes: 'Retardés',
      k_domicile: 'Retour à domicile', k_hebergement: 'Vers un hébergement', k_transport_necessaire: 'Transport nécessaire', k_transport_confirme: 'Transport confirmé', k_obstacles: 'Avec obstacle',
      tous: 'Tous', filtre: 'Filtre : {f}', effacer: 'Tout afficher',
      th_lit: 'Lit', th_prevu: 'Prévu', th_etape: 'Étape', th_dest: 'Destination', th_transport: 'Transport', th_obstacles: 'Obstacles', th_chrono: 'Chrono', th_dispo: 'Disponibilité prévisionnelle',
      e_confirme: 'Confirmé', e_en_preparation: 'En préparation', e_retarde: 'Retardé', e_realise: 'Départ réalisé', e_annule: 'Annulé',
      d_domicile: 'Domicile', d_hebergement: 'Hébergement', d_hopital: 'Autre hôpital', d_autre: 'Autre', d_a_preciser: 'À préciser',
      ch_retard: 'retard', ch_preparation: 'en préparation', sans_transport: 'aucun', non_calculable: 'non calculable', estimation: 'après départ et nettoyage',
      ob_heure_depassee: 'Heure dépassée sans départ', ob_transport_non_confirme: 'Transport non confirmé', ob_transport_en_attente: 'Transport en attente de l’entreprise',
      ob_place_hebergement_a_confirmer: 'Place d’hébergement à confirmer', ob_destination_a_preciser: 'Destination à préciser', ob_conge_reporte: 'Congé reporté',
      tr_s_a_valider: 'à valider', tr_s_demandee: 'demandé', tr_s_acceptee: 'accepté', tr_s_en_route: 'en route', tr_s_pris_en_charge: 'pris en charge', tr_s_arrivee: 'arrivé',
      aucun: 'Aucun congé dans cette sélection.', prev_titre: 'Disponibilités prévisionnelles après les départs', prev_aucune: 'Aucune disponibilité calculable (heure confirmée nécessaire).',
      prev_lit: '{lit} · {unite} : vers {h}', hist_titre: 'Départs réalisés et congés annulés (24 h)', aller_lits: 'Voir les lits', aller_nsa: 'Voir la NSA', aller_tp: 'Transports planifiés',
      a_titre: 'Alertes · {etab}', a_intro: 'Alertes opérationnelles, techniques, prédictives et de synchronisation : une seule liste, la même que Chrono et que la cloche.',
      o_actives: 'Actives', o_vigilance: 'Vigilance', o_escalades: 'Escalades', o_prises: 'Prises en charge', o_resolues: 'Résolues', o_historique: 'Historique',
      cat_operationnelle: 'Opérationnelle', cat_technique: 'Technique', cat_predictive: 'Prédictive', cat_synchronisation: 'Synchronisation',
      st_ouverte: 'Ouverte', st_accusee: 'Accusée', st_en_action: 'Action engagée', st_resolue: 'Résolue (confirmée)', st_levee: 'Levée (fait disparu)',
      n_eleve: 'Escalade', n_modere: 'Vigilance', n_faible: 'Information', depuis: 'Depuis la détection', duree_res: 'Durée jusqu’à la fin', cause: 'Cause identifiée', hypothese: 'Hypothèse',
      action: 'Action recommandée', responsable: 'Responsable autorisé', escalade: 'Escalade niveau {n}', aucune: 'Aucune alerte dans cette catégorie.', journal: 'Voir l’historique de l’alerte',
      journal_vide: 'Aucun événement.', resolue_par: 'Résolue par {nom} à {h}', levee_a: 'Levée à {h}', detectee: 'Détectée à {h}', fiche: 'Fiche',
      dep_titre: 'Départs · {etab}', dep_intro: 'Sorties et fins d’hébergement. Une hospitalisation temporaire n’est pas un départ : la place est conservée et n’est jamais comptée comme disponible.',
      dep_definitifs: 'Fins d’hébergement', dep_en_cours: 'Départs en cours (vers un autre hébergement)', dep_hospitalises: 'Hospitalisations temporaires · place conservée',
      dep_absents: 'Absences temporaires · place conservée', dep_aucun: 'Aucun.', dep_conservee: 'place conservée, non disponible', dep_ouvrir: 'Ouvrir le dossier', dep_hh: 'Suivre dans Hôpital et hébergement',
      st_sorti: 'Fin d’hébergement', st_transfere: 'Transféré', st_transfert_en_cours: 'Transfert en cours', st_hospitalise: 'Hospitalisé', st_absent: 'Absence temporaire',
    },
    en: {
      c_titre: 'Discharges · {etab}', c_intro: 'Preparing hospital discharges: planned time, destination, transport, obstacles to departure.',
      c_regle: 'A planned discharge is never a free bed. The bed becomes available after the actual departure and its return to service (cleaning, check).',
      k_aujourdhui: 'Planned today', k_demain: 'Planned tomorrow', k_a_venir: 'Upcoming', k_confirmes: 'Confirmed', k_en_preparation: 'In preparation', k_retardes: 'Delayed',
      k_domicile: 'Return home', k_hebergement: 'To residential care', k_transport_necessaire: 'Transport needed', k_transport_confirme: 'Transport confirmed', k_obstacles: 'With an obstacle',
      tous: 'All', filtre: 'Filter: {f}', effacer: 'Show all',
      th_lit: 'Bed', th_prevu: 'Planned', th_etape: 'Stage', th_dest: 'Destination', th_transport: 'Transport', th_obstacles: 'Obstacles', th_chrono: 'Chrono', th_dispo: 'Expected availability',
      e_confirme: 'Confirmed', e_en_preparation: 'In preparation', e_retarde: 'Delayed', e_realise: 'Departed', e_annule: 'Cancelled',
      d_domicile: 'Home', d_hebergement: 'Residential care', d_hopital: 'Other hospital', d_autre: 'Other', d_a_preciser: 'To be specified',
      ch_retard: 'delay', ch_preparation: 'in preparation', sans_transport: 'none', non_calculable: 'cannot be calculated', estimation: 'after departure and cleaning',
      ob_heure_depassee: 'Time passed without departure', ob_transport_non_confirme: 'Transport not confirmed', ob_transport_en_attente: 'Transport awaiting the company',
      ob_place_hebergement_a_confirmer: 'Residential place to be confirmed', ob_destination_a_preciser: 'Destination to be specified', ob_conge_reporte: 'Discharge postponed',
      tr_s_a_valider: 'to validate', tr_s_demandee: 'requested', tr_s_acceptee: 'accepted', tr_s_en_route: 'en route', tr_s_pris_en_charge: 'picked up', tr_s_arrivee: 'arrived',
      aucun: 'No discharge in this selection.', prev_titre: 'Expected availability after departures', prev_aucune: 'No availability can be calculated (confirmed time needed).',
      prev_lit: '{lit} · {unite}: around {h}', hist_titre: 'Completed departures and cancelled discharges (24 h)', aller_lits: 'See beds', aller_nsa: 'See ALC', aller_tp: 'Scheduled transports',
      a_titre: 'Alerts · {etab}', a_intro: 'Operational, technical, predictive and synchronisation alerts: one list, the same as Chrono and the bell.',
      o_actives: 'Active', o_vigilance: 'Watch', o_escalades: 'Escalations', o_prises: 'Being handled', o_resolues: 'Resolved', o_historique: 'History',
      cat_operationnelle: 'Operational', cat_technique: 'Technical', cat_predictive: 'Predictive', cat_synchronisation: 'Synchronisation',
      st_ouverte: 'Open', st_accusee: 'Acknowledged', st_en_action: 'Action under way', st_resolue: 'Resolved (confirmed)', st_levee: 'Cleared (fact gone)',
      n_eleve: 'Escalation', n_modere: 'Watch', n_faible: 'Information', depuis: 'Since detection', duree_res: 'Duration until the end', cause: 'Identified cause', hypothese: 'Hypothesis',
      action: 'Recommended action', responsable: 'Authorised owner', escalade: 'Escalation level {n}', aucune: 'No alert in this category.', journal: 'See the alert history',
      journal_vide: 'No event.', resolue_par: 'Resolved by {nom} at {h}', levee_a: 'Cleared at {h}', detectee: 'Detected at {h}', fiche: 'Record',
      dep_titre: 'Departures · {etab}', dep_intro: 'Exits and end of stay. A temporary hospital stay is not a departure: the place is kept and is never counted as available.',
      dep_definitifs: 'End of stay', dep_en_cours: 'Departures under way (to another residence)', dep_hospitalises: 'Temporary hospital stays · place kept',
      dep_absents: 'Temporary absences · place kept', dep_aucun: 'None.', dep_conservee: 'place kept, not available', dep_ouvrir: 'Open the record', dep_hh: 'Follow in Hospital and residence',
      st_sorti: 'End of stay', st_transfere: 'Transferred', st_transfert_en_cours: 'Transfer under way', st_hospitalise: 'In hospital', st_absent: 'Temporary absence',
    },
  };
  const L = () => ((document.documentElement.lang || 'fr').startsWith('en') ? 'en' : 'fr');
  const T = (k, v = {}) => esc(String(TX[L()][k] ?? TX.fr[k] ?? k).replace(/\{(\w+)\}/g, (m, x) => (v[x] ?? '')));
  const hh = (iso) => (iso ? new Date(iso).toLocaleTimeString(L() === 'en' ? 'en-CA' : 'fr-CA', { hour: '2-digit', minute: '2-digit' }) : '—');
  const jh = (iso) => (iso ? (typeof jourHeure === 'function' ? jourHeure(iso) : new Date(iso).toLocaleString()) : '—');
  const chrono = (depuis) => (depuis ? `<b class="num duree-seule" data-depuis="${esc(depuis)}">--:--:--</b>` : '—');
  const aller = (v) => { if (typeof allerA === 'function') allerA(v); else document.querySelector(`#onglets button[data-v="${v}"]`)?.click(); };
  const visible = (v) => !!document.querySelector(`#onglets button[data-v="${v}"]:not([hidden])`);

  /* ------------------------------------------------------------------ Congés (hôpital) */
  const fC = { k: '' };
  const FILTRES = {
    aujourdhui: (x) => x.quand === 'aujourdhui', demain: (x) => x.quand === 'demain', a_venir: (x) => ['a_venir', 'sans_heure'].includes(x.quand),
    confirmes: (x) => x.etape === 'confirme', en_preparation: (x) => x.etape === 'en_preparation', retardes: (x) => x.etape === 'retarde',
    domicile: (x) => x.destination === 'domicile', hebergement: (x) => x.destination === 'hebergement', transport_necessaire: (x) => x.transport_necessaire,
    transport_confirme: (x) => x.transport_confirme, obstacles: (x) => x.obstacles.length > 0,
  };
  async function vueConges() {
    const v = document.getElementById('v-conges');
    const d = await api('GET', `/conges/module?etablissement_id=${etat.ctx}`);
    const ouverts = d.lignes.filter((x) => ['confirme', 'en_preparation', 'retarde'].includes(x.etape));
    const vus = ouverts.filter((x) => !fC.k || FILTRES[fC.k](x));
    const passes = d.lignes.filter((x) => ['realise', 'annule'].includes(x.etape));
    const tuile = (k) => `<button type="button" class="tuile-c ds-kpi${['retardes', 'obstacles'].includes(k) && d.compteurs[k] ? ' ton-orange' : ''}" data-cg="${k}" aria-pressed="${fC.k === k}">
      <span class="gros num">${d.compteurs[k]}</span><span class="ds-kpi-lib">${T(`k_${k}`)}</span></button>`;
    const tr = (x) => (x.transport ? `<span class="num">${esc(x.transport.numero)}</span> · ${T(`tr_s_${x.transport.statut}`)}${x.transport.plage_debut ? `<div class="note">${esc(hh(x.transport.plage_debut))}</div>` : ''}` : `<span class="note">${T('sans_transport')}</span>`);
    const ligne = (x) => `<tr class="${x.etape === 'retarde' ? 'retard' : ''}"><td><b class="num">${esc(x.lit)}</b><div class="note">${esc(x.unite)} · ${esc(x.chambre)}</div><div class="note num">${esc(x.patient_ref || '')}</div></td>
      <td>${esc(jh(x.sortie_prevue))}</td><td><span class="badge${x.etape === 'confirme' ? ' fort' : ''}">${T(`e_${x.etape}`)}</span></td>
      <td>${T(`d_${x.destination}`)}${x.transport?.destination ? `<div class="note">${esc(x.transport.destination)}</div>` : ''}</td><td>${tr(x)}</td>
      <td>${x.obstacles.length ? `<ul class="liste-simple">${x.obstacles.map((o) => `<li>${T(`ob_${o}`)}</li>`).join('')}</ul>` : '—'}</td>
      <td>${chrono(x.chrono_depuis)}${x.chrono_nature ? `<div class="note">${T(`ch_${x.chrono_nature}`)}</div>` : ''}</td>
      <td>${x.disponibilite_estimee ? `${esc(hh(x.disponibilite_estimee))}<div class="note">${T('estimation')}</div>` : `<span class="note">${T('non_calculable')}</span>`}</td></tr>`;
    const tete = ['th_lit', 'th_prevu', 'th_etape', 'th_dest', 'th_transport', 'th_obstacles', 'th_chrono', 'th_dispo'].map((k) => `<th>${T(k)}</th>`).join('');
    const liens = [visible('lits') ? `<button class="btn" data-cg-aller="lits">${T('aller_lits')}</button>` : '', visible('nsa') ? `<button class="btn" data-cg-aller="nsa">${T('aller_nsa')}</button>` : '',
      visible('transports-planifies') ? `<button class="btn" data-cg-aller="transports-planifies">${T('aller_tp')}</button>` : ''].join('');
    v.innerHTML = `<div class="entete"><div><h2>${T('c_titre', { etab: etabCtx().nom })}</h2><p>${T('c_intro')}</p><p class="note"><b>${T('c_regle')}</b></p></div><div class="ligne">${liens}</div></div>
      <div class="tuiles-chrono tuiles-sejours" role="group">${Object.keys(FILTRES).map(tuile).join('')}</div>
      ${fC.k ? `<p class="note">${T('filtre', { f: TX[L()][`k_${fC.k}`] })} · <button type="button" class="lien" data-cg="">${T('effacer')}</button></p>` : ''}
      <div class="panneau-c">${vus.length ? `<div class="tableau"><table><thead><tr>${tete}</tr></thead><tbody>${vus.map(ligne).join('')}</tbody></table></div>` : `<p class="vide">${T('aucun')}</p>`}</div>
      <div class="panneau-c"><h3>${T('prev_titre')}</h3>${d.previsionnelles.length ? `<ul class="liste-simple">${d.previsionnelles.map((p) => `<li>${T('prev_lit', { lit: p.lit, unite: p.unite, h: hh(p.disponible_vers) })}</li>`).join('')}</ul>` : `<p class="note">${T('prev_aucune')}</p>`}
        <p class="note">${esc(d.regles.deterministe)} ${esc(d.regles.retard)}</p></div>
      ${passes.length ? `<details class="panneau-c"><summary><b>${T('hist_titre')}</b> <span class="num">${passes.length}</span></summary><div class="tableau"><table><thead><tr>${tete}</tr></thead><tbody>${passes.map(ligne).join('')}</tbody></table></div></details>` : ''}`;
    v.querySelectorAll('[data-cg]').forEach((b) => { b.onclick = () => { fC.k = fC.k === b.dataset.cg ? '' : b.dataset.cg; vueConges(); }; });
    v.querySelectorAll('[data-cg-aller]').forEach((b) => { b.onclick = () => aller(b.dataset.cgAller); });
    const n = document.getElementById('n-conges'); if (n) { const k = d.compteurs.retardes; n.hidden = !k; n.textContent = k; }
  }

  /* ------------------------------------------------------------------ Alertes (une seule source) */
  const fA = { o: 'actives', cible: null };
  const categorie = (type) => (['connecteur_silencieux'].includes(type) ? 'synchronisation' : ['incoherence', 'quote_part_contradiction'].includes(type) ? 'technique'
    : /prevision|saturation_prevue|risque/.test(type || '') ? 'predictive' : 'operationnelle');
  const OUVERTS = ['ouverte', 'accusee', 'en_action'];
  const ONGLETS = {
    actives: (a) => OUVERTS.includes(a.statut), vigilance: (a) => OUVERTS.includes(a.statut) && a.niveau === 'modere',
    escalades: (a) => OUVERTS.includes(a.statut) && (a.escalade_niveau > 0 || a.niveau === 'eleve'), prises: (a) => ['accusee', 'en_action'].includes(a.statut),
    resolues: (a) => ['resolue', 'levee'].includes(a.statut), historique: () => true,
  };
  /** Liste unifiée : un suivi par fait (suivis_alertes) + son explication Vigilance quand le fait est encore détecté. */
  async function charger(etabId, avecVigilance) {
    const [suivis, vig] = await Promise.all([api('GET', `/coordination/alertes?etablissement_id=${etabId}`).catch(() => []), avecVigilance ? api('GET', `/vigilance?etablissement_id=${etabId}`).catch(() => null) : null]);
    const expl = new Map((vig?.alertes || []).filter((a) => a.suivi?.id).map((a) => [Number(a.suivi.id), a]));
    return { vig, alertes: suivis.map((s) => ({ ...s, explication: expl.get(Number(s.id)) || null, categorie: categorie(s.type) })) };
  }
  async function vueAlertes(v, opts = {}) {
    const { vig, alertes } = await charger(etat.ctx, opts.vigilance !== false);
    const F = (k, x) => esc(t(`fin.${k}`, x));
    const n = (o) => alertes.filter(ONGLETS[o]).length;
    if (fA.cible && !alertes.some((a) => a.cle === fA.cible && ONGLETS[fA.o](a))) { const a = alertes.find((x) => x.cle === fA.cible); if (a) fA.o = OUVERTS.includes(a.statut) ? 'actives' : 'resolues'; }
    const vus = alertes.filter(ONGLETS[fA.o]).sort((a, b) => ({ eleve: 2, modere: 1, faible: 0 }[b.niveau] ?? 0) - ({ eleve: 2, modere: 1, faible: 0 }[a.niveau] ?? 0) || new Date(b.cree_le) - new Date(a.cree_le));
    const couleur = { eleve: 'critique', modere: 'attention', faible: 'info' };
    const carte = (a) => { const x = a.explication; const fin = a.resolue_le || a.levee_le; const ouvert = OUVERTS.includes(a.statut);
      return `<article class="fiche alerte-vig${a.cle === fA.cible ? ' cible' : ''}" data-cle="${esc(a.cle)}" style="--c:var(--${couleur[a.niveau] || 'info'})">
        <div class="t"><b>${esc(a.titre)}</b><span class="risque ${esc(a.niveau)}">${T(`n_${a.niveau}`)}</span></div>
        <div class="note">${T(`cat_${a.categorie}`)} · ${T(`st_${a.statut}`)}${a.escalade_niveau ? ` · ${T('escalade', { n: a.escalade_niveau })}` : ''} · ${T('detectee', { h: hh(a.cree_le) })}</div>
        <p>${ouvert ? `${T('depuis')} : ${chrono(a.cree_le)}` : `${T('duree_res')} : <b class="num">${fin ? window.ArrimoDuree?.hhmmss?.(new Date(fin) - new Date(a.cree_le)) ?? '—' : '—'}</b>`}</p>
        <dl class="explication">${x ? `<dt>${x.cause?.nature === 'fait' ? T('cause') : T('hypothese')}</dt><dd>${esc(x.cause?.texte || '')}</dd><dt>${T('action')}</dt><dd>${esc(x.action || '')}</dd>` : ''}
          <dt>${T('responsable')}</dt><dd>${esc(t(`roles.${a.responsable_role}`) || a.responsable_role || '—')}</dd></dl>
        ${a.resolue_le ? `<p class="note">${T('resolue_par', { nom: a.resolue_nom || '—', h: hh(a.resolue_le) })}</p>` : a.levee_le ? `<p class="note">${T('levee_a', { h: hh(a.levee_le) })}</p>` : ''}
        ${ouvert && typeof suiviAlerteHTML === 'function' ? suiviAlerteHTML(a, F) : ''}
        <details data-journal="${a.id}"><summary>${T('journal')}</summary><div class="note">…</div></details></article>`; };
    const barre = Object.keys(ONGLETS).map((o) => `<button type="button" role="tab" data-ao="${o}" aria-selected="${fA.o === o}" tabindex="${fA.o === o ? 0 : -1}">${T(`o_${o}`)} <span class="num">${n(o)}</span></button>`).join('');
    v.innerHTML = `<div class="entete"><div><h2>${T('a_titre', { etab: etabCtx().nom })}</h2><p>${T('a_intro')}</p></div></div>
      <div class="module-sous-onglets" role="tablist">${barre}</div>
      <div class="pile" data-alertes-liste>${vus.map(carte).join('') || `<p class="vide">${T('aucune')}</p>`}</div>`;
    if (vig && opts.complements) opts.complements(v, vig);
    v.querySelectorAll('[data-ao]').forEach((b) => { b.onclick = () => { fA.o = b.dataset.ao; fA.cible = null; vueAlertes(v, opts); }; });
    v.querySelectorAll('[data-suivi-op]').forEach((b) => { b.onclick = async () => {
      const corps = { version: Number(b.dataset.version) };
      if (b.dataset.suiviOp === 'action') { const s = v.querySelector(`[data-suivi-action="${b.dataset.id}"]`); if (!s?.value) return; corps.action = s.value; }
      try { await api('POST', `/coordination/alertes/${b.dataset.id}/${b.dataset.suiviOp}`, corps); toast(F(`suivi_fait_${b.dataset.suiviOp}`)); } catch (e) { toast(e.message); }
      vueAlertes(v, opts);
    }; });
    v.querySelectorAll('[data-journal]').forEach((d) => { d.addEventListener('toggle', async () => {
      if (!d.open || d.dataset.lu) return; d.dataset.lu = '1';
      const j = await api('GET', `/coordination/alertes/${d.dataset.journal}/journal`).catch(() => []);
      d.querySelector('div').innerHTML = (j || []).length ? `<ul class="liste-simple">${j.map((e) => `<li><span class="num">${esc(hh(e.le || e.cree_le))}</span> · ${esc(e.action)}${e.auteur_nom ? ` · ${esc(e.auteur_nom)}` : ''}</li>`).join('')}</ul>` : T('journal_vide');
    }); });
    v.querySelector('.alerte-vig.cible')?.scrollIntoView({ block: 'center' });
    const actives = alertes.filter((a) => OUVERTS.includes(a.statut) && a.niveau === 'eleve').length;
    for (const id of ['n-vig', 'n-c-alertes']) { const b = document.getElementById(id); if (b) { b.hidden = !actives; b.textContent = actives; } }
  }
  /** Ouvre la fiche d'une alerte (depuis Chrono, la cloche, l'Accueil) : même fiche, même source. */
  function ouvrir(cle) {
    fA.cible = cle || null; fA.o = 'actives';
    aller(visible('vigilance') ? 'vigilance' : 'c-alertes');
  }

  /* ------------------------------------------------------------------ Départs (hébergement) */
  async function vueDeparts() {
    const v = document.getElementById('v-c-departs'); const id = etat.ctx;
    const lire = (st) => api('GET', `/chsld/residents?etablissement_id=${id}&statut=${st}`).catch(() => []);
    const [sortis, transferes, enCours, hosp, absents] = await Promise.all(['sorti', 'transfere', 'transfert_en_cours', 'hospitalise', 'absent'].map(lire));
    const ligne = (r, conservee) => `<div class="item"><div><button class="lien" data-dep-res="${r.id}">${esc(r.prenom)} ${esc(r.nom)}</button> <span class="note num">${esc(r.reference)}</span>
      <div class="note">${T(`st_${r.statut}`)}${r.lit ? ` · ${esc(r.unite || '')} ${esc(r.lit)}` : ''}${conservee ? ` · <b>${T('dep_conservee')}</b>` : ''}</div></div></div>`;
    const bloc = (titre, l, conservee, lien) => `<div class="panneau-c"><h3>${T(titre)} <span class="num">${l.length}</span></h3><div class="liste">${l.slice(0, 80).map((r) => ligne(r, conservee)).join('') || `<p class="note">${T('dep_aucun')}</p>`}</div>
      ${lien && visible('c-mouvements') ? `<p><button class="btn" data-dep-aller="c-mouvements">${T('dep_hh')}</button></p>` : ''}</div>`;
    v.innerHTML = `<div class="entete"><div><h2>${T('dep_titre', { etab: etabCtx().nom })}</h2><p>${T('dep_intro')}</p></div></div>
      <div class="deux">${bloc('dep_en_cours', enCours)}${bloc('dep_definitifs', [...sortis, ...transferes])}</div>
      <div class="deux">${bloc('dep_hospitalises', hosp, true, true)}${bloc('dep_absents', absents, true)}</div>`;
    v.querySelectorAll('[data-dep-res]').forEach((b) => { b.onclick = () => { etat.chResident = Number(b.dataset.depRes); aller('c-residents'); }; });
    v.querySelectorAll('[data-dep-aller]').forEach((b) => { b.onclick = () => aller(b.dataset.depAller); });
  }

  window.ArrimoCongesAlertes = { vueConges, vueAlertes, ouvrir, vueDeparts, categorie, TX,
    vues: { conges: vueConges, 'c-departs': vueDeparts, 'c-alertes': () => vueAlertes(document.getElementById('v-c-alertes'), { vigilance: false }) } };
})();
