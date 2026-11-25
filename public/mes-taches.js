/* Personnel & Tâches — vue universelle « Mes tâches » (cahier du 22 nov. 2026, sections 4, 8, 17, 18, 19).
   Une seule vue par employé : à faire, en cours, en retard, prioritaires, terminées aujourd'hui. Chaque carte dit quoi, où, quand,
   la priorité et l'action disponible. Les actions passent par les routes existantes (mêmes règles : la chambre propre est confirmée
   par l'entretien). Responsable : file non attribuée, filtres, attribution, et Paramètres du module (visibles seulement pour lui). */
(() => {
  const TXT = {
    fr: { releve: 'Relève entre équipes', releve_intro: 'Transmettre à l’équipe suivante ce qui reste ouvert (numéros et compteurs seulement).', releve_cpt: '{t} tâche(s) ouverte(s), dont {r} en retard · {n} nettoyage(s) · {a} alerte(s) suivie(s), dont {e} élevée(s)', releve_transmettre: 'Transmettre la relève', releve_quart: 'Quart', q_jour: 'Jour', q_soir: 'Soir', q_nuit: 'Nuit', releve_derniere: 'Dernière relève ({q}) transmise par {par} à {h}', releve_accusee: 'accusée par {par} à {h}', releve_non_accusee: 'non accusée', releve_accuser: 'Accuser la relève', releve_ok: 'Relève enregistrée.',
      titre: 'Mes tâches', intro: 'Toutes vos tâches, quelle que soit leur origine : préparation, nettoyage, administratif, relances.', a_faire: 'À faire', en_cours: 'En cours', retard: 'En retard',
      prioritaires: 'Prioritaires', terminees: 'Terminées aujourd’hui', non_attr: 'Non attribuées', aucune: 'Aucune tâche dans cette catégorie.', ou: 'Où', quand: 'Échéance', priorite: 'Priorité',
      haute: 'Haute', normale: 'Normale', commencer: 'Commencer', terminer: 'Terminer', suspendre: 'Suspendre', signaler: 'Signaler un problème', ouvrir_nett: 'Ouvrir Nettoyage', fait: 'Tâche mise à jour.', par: 'par {n}', a: 'à {h}',
      tous_types: 'Tous les types', toutes: 'Toutes', filtre_type: 'Type', filtre_vue: 'Afficher', attribuer: 'Attribuer', file: 'File du rôle (non attribuée)', attribuee: 'Tâche attribuée.', a_qui: 'Attribuer à',
      ty: { entretien: 'Entretien', preparation_chambre: 'Préparation de chambre', administratif: 'Administratif', transmission: 'Transmission', relance: 'Relance', nettoyage: 'Nettoyage' },
      params: 'Paramètres du module', params_intro: 'Propres à cet établissement ; distincts des paramètres généraux de la plateforme.', p_taches: 'Personnel et tâches', p_nett: 'Nettoyage',
      echeance_defaut_min: 'Échéance par défaut d’une nouvelle tâche (minutes, 0 = aucune)', prioritaire_avant_min: 'Tâche prioritaire quand l’échéance est à moins de (minutes)',
      notifier_attribution: 'Notifier la personne à qui une tâche est attribuée', attribution_auto: 'Attribution automatique', auto_aucune: 'Aucune : file du rôle, attribuée par un responsable', auto_seul: 'À la seule personne active du rôle, s’il n’y en a qu’une', delai_nettoyage_min: 'Délai cible d’un nettoyage (minutes) ; au-delà, il est en retard',
      types_intervention: 'Types d’intervention applicables', enregistrer: 'Enregistrer', enregistre: 'Paramètres enregistrés.', lecture: 'Lecture seule : seuls l’administration et la coordination modifient.',
      ti: { courant: 'Nettoyage courant', apres_depart: 'Nettoyage après départ', desinfection: 'Désinfection', preparation_chambre: 'Préparation de chambre', preparation_materielle: 'Préparation matérielle', verification: 'Vérification de remise en état' } },
    en: { releve: 'Shift handover', releve_intro: 'Hand over to the next team what remains open (numbers and counts only).', releve_cpt: '{t} open task(s), {r} overdue · {n} cleaning(s) · {a} tracked alert(s), {e} high', releve_transmettre: 'Send handover', releve_quart: 'Shift', q_jour: 'Day', q_soir: 'Evening', q_nuit: 'Night', releve_derniere: 'Last handover ({q}) sent by {par} at {h}', releve_accusee: 'acknowledged by {par} at {h}', releve_non_accusee: 'not acknowledged', releve_accuser: 'Acknowledge handover', releve_ok: 'Handover recorded.',
      titre: 'My tasks', intro: 'All your tasks, whatever their origin: preparation, cleaning, administrative, follow-ups.', a_faire: 'To do', en_cours: 'In progress', retard: 'Overdue',
      prioritaires: 'Priority', terminees: 'Done today', non_attr: 'Unassigned', aucune: 'No task in this category.', ou: 'Where', quand: 'Due', priorite: 'Priority',
      haute: 'High', normale: 'Normal', commencer: 'Start', terminer: 'Finish', suspendre: 'Pause', signaler: 'Report a problem', ouvrir_nett: 'Open Cleaning', fait: 'Task updated.', par: 'by {n}', a: 'at {h}',
      tous_types: 'All types', toutes: 'All', filtre_type: 'Type', filtre_vue: 'Show', attribuer: 'Assign', file: 'Role queue (unassigned)', attribuee: 'Task assigned.', a_qui: 'Assign to',
      ty: { entretien: 'Housekeeping', preparation_chambre: 'Room preparation', administratif: 'Administrative', transmission: 'Handover', relance: 'Follow-up', nettoyage: 'Cleaning' },
      params: 'Module settings', params_intro: 'Specific to this facility; separate from the platform’s general settings.', p_taches: 'Staff and tasks', p_nett: 'Cleaning',
      echeance_defaut_min: 'Default due time of a new task (minutes, 0 = none)', prioritaire_avant_min: 'A task is priority when due in less than (minutes)',
      notifier_attribution: 'Notify the person a task is assigned to', attribution_auto: 'Automatic assignment', auto_aucune: 'None: role queue, assigned by a manager', auto_seul: 'To the only active person in the role, if there is just one', delai_nettoyage_min: 'Target cleaning time (minutes); beyond it, it is overdue',
      types_intervention: 'Applicable intervention types', enregistrer: 'Save', enregistre: 'Settings saved.', lecture: 'Read only: only administration and coordination can change them.',
      ti: { courant: 'Routine cleaning', apres_depart: 'Cleaning after departure', desinfection: 'Disinfection', preparation_chambre: 'Room preparation', preparation_materielle: 'Equipment preparation', verification: 'Restoration check' } },
  };
  const e = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = () => ((document.documentElement.lang || '').startsWith('en') ? 'en' : 'fr');
  const X = () => TXT[L()]; const T = (k, v = {}) => e(String(X()[k]).replace(/\{(\w+)\}/g, (m, y) => v[y] ?? m));
  const h = (d) => (d ? new Date(d).toLocaleString(L() === 'en' ? 'en-CA' : 'fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const RESP = ['coordonnateur', 'admin_etab', 'gestionnaire'];
  const etat = { vue: 'ouvertes', type: '' };

  function carte(x, d, o) {
    const actions = [];
    if (x.source === 'nettoyage') actions.push(`<button class="btn" type="button" data-mt-aller="nettoyage">${T('ouvrir_nett')}</button>`);
    else if (d.chsld && x.statut === 'a_faire') actions.push(`<button class="btn pri" type="button" data-mt-statut="en_cours" data-id="${x.id}" data-version="${x.version}">${T('commencer')}</button>`);
    else if (d.chsld && x.statut === 'en_cours') actions.push(`<button class="btn pri" type="button" data-mt-statut="faite" data-id="${x.id}" data-version="${x.version}">${T('terminer')}</button>`, `<button class="btn" type="button" data-mt-statut="a_faire" data-id="${x.id}" data-version="${x.version}">${T('suspendre')}</button>`);
    // Signaler un problème : message au responsable par Arrimo Connect, sans quitter l'écran
    if (x.statut !== 'faite') actions.push(`<button class="btn" type="button" data-connect-ouvrir="contacter">${T('signaler')}</button>`);
    if (d.personnel && x.source === 'tache' && x.statut !== 'faite') actions.push(`<span class="ligne acc-attrib"><label class="sr-only" for="mt-at-${x.id}">${T('a_qui')}</label><select id="mt-at-${x.id}"><option value="">${T('file')}</option>${d.personnel.filter((p) => !x.assigne_role || p.role === x.assigne_role || RESP.includes(p.role)).map((p) => `<option value="${p.id}"${p.id === x.assigne_a ? ' selected' : ''}>${e(p.nom)}</option>`).join('')}</select><button class="btn" type="button" data-mt-attribuer="${x.id}">${T('attribuer')}</button></span>`);
    return `<li class="mt-carte${x.en_retard ? ' retard' : ''}"><div class="mt-tete"><b>${e(x.titre)}</b><span class="badge-flux ${x.statut === 'faite' ? 'ok' : x.en_retard ? 'retard' : 'cours'}">${e(x.statut === 'faite' ? T('terminees') : x.statut === 'en_cours' ? T('en_cours') : T('a_faire'))}${x.en_retard ? ` · ${T('retard')}` : ''}</span></div>
      <dl class="mt-dl"><dt>${T('ou')}</dt><dd>${e(x.lieu || '—')}</dd><dt>${T('quand')}</dt><dd>${x.statut === 'faite' ? `${h(x.fait_le)}${x.fait_par_nom ? ` · ${T('par', { n: x.fait_par_nom })}` : ''}` : h(x.echeance)}</dd>
      <dt>${T('priorite')}</dt><dd>${x.prioritaire ? `<b>${T('haute')}</b>` : T('normale')}</dd><dt>${T('filtre_type')}</dt><dd>${e(X().ty[x.type] || x.type)}${x.assigne_nom ? ` · ${e(x.assigne_nom)}` : ''}</dd></dl>
      ${actions.length ? `<div class="ligne">${actions.join('')}</div>` : ''}</li>`;
  }

  async function panneauParametres(zone, o, admin) {
    let pt, pn; try { [pt, pn] = await Promise.all([o.api('GET', `/parametres-modules/taches?etablissement_id=${o.etablissement_id}`), o.api('GET', `/parametres-modules/nettoyage?etablissement_id=${o.etablissement_id}`)]); } catch { zone.remove(); return; }
    const dis = admin ? '' : ' disabled';
    const num = (id, v, min, max) => `<div class="champ"><label class="lbl" for="mp-${id}">${T(id)}</label><input id="mp-${id}" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" value="${v}"${dis}></div>`;
    zone.innerHTML = `<details class="panneau-c mt-params"><summary><b><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-settings"/></svg> ${T('params')}</b></summary><p class="note">${T('params_intro')}${admin ? '' : ` ${T('lecture')}`}</p>
      <form data-mp="taches"><h3>${T('p_taches')}</h3>${num('echeance_defaut_min', pt.valeurs.echeance_defaut_min, 0, 2880)}${num('prioritaire_avant_min', pt.valeurs.prioritaire_avant_min, 0, 1440)}
        <label class="case"><input type="checkbox" id="mp-notifier_attribution"${pt.valeurs.notifier_attribution ? ' checked' : ''}${dis}> ${T('notifier_attribution')}</label>
        <div class="champ"><label class="lbl" for="mp-attribution_auto">${T('attribution_auto')}</label><select id="mp-attribution_auto"${dis}><option value="aucune">${T('auto_aucune')}</option><option value="seul_agent"${pt.valeurs.attribution_auto === 'seul_agent' ? ' selected' : ''}>${T('auto_seul')}</option></select></div>${admin ? `<p><button class="btn pri" type="submit">${T('enregistrer')}</button></p>` : ''}</form>
      <form data-mp="nettoyage"><h3>${T('p_nett')}</h3>${num('delai_nettoyage_min', pn.valeurs.delai_nettoyage_min, 5, 1440)}
        <fieldset><legend class="lbl">${T('types_intervention')}</legend>${pn.types_possibles.map((k) => `<label class="case"><input type="checkbox" name="mp-ti" value="${k}"${pn.valeurs.types_intervention.includes(k) ? ' checked' : ''}${dis}> ${e(X().ti[k])}</label>`).join('')}</fieldset>
        ${admin ? `<p><button class="btn pri" type="submit">${T('enregistrer')}</button></p>` : ''}</form></details>`;
    zone.querySelectorAll('form[data-mp]').forEach((f) => { f.onsubmit = async (ev) => {
      ev.preventDefault(); const m = f.dataset.mp; const q = (id) => zone.querySelector(`#mp-${id}`);
      const valeurs = m === 'taches' ? { echeance_defaut_min: Number(q('echeance_defaut_min').value), prioritaire_avant_min: Number(q('prioritaire_avant_min').value), notifier_attribution: q('notifier_attribution').checked, attribution_auto: q('attribution_auto').value }
        : { delai_nettoyage_min: Number(q('delai_nettoyage_min').value), types_intervention: [...zone.querySelectorAll('input[name="mp-ti"]:checked')].map((x) => x.value) };
      try { await o.api('PUT', `/parametres-modules/${m}`, { etablissement_id: o.etablissement_id, valeurs }); o.toast?.(T('enregistre')); } catch (err) { o.toast?.(err.message, true); }
    }; });
  }

  async function afficher(v, o) {
    const d = await o.api('GET', `/taches/miennes?etablissement_id=${o.etablissement_id}`);
    const role = window.etat?.moi?.utilisateur?.role; const resp = RESP.includes(role);
    const ouvertes = d.taches.filter((x) => !etat.type || x.type === etat.type);
    const groupes = { ouvertes: ouvertes, a_faire: ouvertes.filter((x) => x.statut === 'a_faire'), en_cours: ouvertes.filter((x) => x.statut === 'en_cours'), retard: ouvertes.filter((x) => x.en_retard),
      prioritaires: ouvertes.filter((x) => x.prioritaire), terminees: (d.terminees || []).filter((x) => !etat.type || x.type === etat.type), ...(resp ? { non_attr: ouvertes.filter((x) => x.source === 'tache' && !x.assigne_a) } : {}) };
    const lib = (k) => (k === 'ouvertes' ? T('toutes') : T(k));
    const types = [...new Set([...d.taches, ...(d.terminees || [])].map((x) => x.type))];
    const liste = groupes[etat.vue] || ouvertes;
    v.innerHTML = `<div class="entete"><div><h2><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-check"/></svg> ${T('titre')}</h2><p class="note">${T('intro')}</p></div></div>
      <div class="flux-groupes" role="group" aria-label="${T('filtre_vue')}">${Object.keys(groupes).map((k) => `<button type="button" class="acc-mini-k flux-groupe${etat.vue === k ? ' actif' : ''}${k === 'retard' && groupes[k].length ? ' alerte' : ''}" data-mt-vue="${k}" aria-pressed="${etat.vue === k}"><b>${groupes[k].length}</b><span>${lib(k)}</span></button>`).join('')}</div>
      ${types.length > 1 ? `<div class="ligne"><label class="lbl" for="mt-type">${T('filtre_type')}</label><select id="mt-type"><option value="">${T('tous_types')}</option>${types.map((k) => `<option value="${k}"${etat.type === k ? ' selected' : ''}>${e(X().ty[k] || k)}</option>`).join('')}</select></div>` : ''}
      ${liste.length ? `<ul class="mt-liste">${liste.map((x) => carte(x, d, o)).join('')}</ul>` : `<p class="note">${T('aucune')}</p>`}
      <div id="mt-releve"></div>${resp ? '<div id="mt-params"></div>' : ''}`;
    releve(v.querySelector('#mt-releve'), o);
    v.querySelectorAll('[data-mt-vue]').forEach((b) => { b.onclick = () => { etat.vue = b.dataset.mtVue; afficher(v, o); }; });
    v.querySelector('#mt-type')?.addEventListener('change', (ev) => { etat.type = ev.target.value; afficher(v, o); });
    v.querySelectorAll('[data-mt-aller]').forEach((b) => { b.onclick = () => o.ouvrir?.(b.dataset.mtAller); });
    v.querySelectorAll('[data-mt-statut]').forEach((b) => { b.onclick = async () => {
      try { await o.api('POST', `/chsld/taches/${b.dataset.id}/statut`, { statut: b.dataset.mtStatut, version: Number(b.dataset.version) }); o.toast?.(T('fait')); } catch (err) { o.toast?.(err.message, true); }
      afficher(v, o);
    }; });
    v.querySelectorAll('[data-mt-attribuer]').forEach((b) => { b.onclick = async () => {
      const id = b.dataset.mtAttribuer; const val = v.querySelector(`#mt-at-${id}`).value;
      try { await o.api('POST', `/taches/${id}/attribuer`, { utilisateur_id: val ? Number(val) : null }); o.toast?.(T('attribuee')); } catch (err) { o.toast?.(err.message, true); }
      afficher(v, o);
    }; });
    if (resp) panneauParametres(v.querySelector('#mt-params'), o, ['admin_etab', 'coordonnateur'].includes(role));
  }
  /** Relève entre équipes (complémentaire nº 3, §6) : transmission horodatée, accusée par l'équipe entrante. */
  async function releve(zone, o) {
    if (!zone) return;
    const r = await o.api('GET', `/taches/releve?etablissement_id=${o.etablissement_id}`).catch(() => null); if (!r) return;
    const c = r.maintenant.compteurs; const d = r.derniere; const h = (x) => new Date(x).toLocaleTimeString(L() === 'en' ? 'en-CA' : 'fr-CA', { hour: '2-digit', minute: '2-digit' });
    zone.innerHTML = `<section class="panneau-c"><h3>${T('releve')}</h3><p class="note">${T('releve_intro')}</p>
      <p>${T('releve_cpt', { t: c.taches, r: c.en_retard, n: c.nettoyages, a: c.alertes, e: c.alertes_elevees })}</p>
      <div class="ligne"><label class="lbl" for="mt-quart">${T('releve_quart')}</label><select id="mt-quart">${['jour', 'soir', 'nuit'].map((q) => `<option value="${q}">${T(`q_${q}`)}</option>`).join('')}</select>
        <button class="btn" id="mt-releve-go" type="button">${T('releve_transmettre')}</button></div>
      ${d ? `<p class="note">${T('releve_derniere', { q: T(`q_${d.quart}`), par: d.transmis_par_nom, h: h(d.transmis_le) })} · ${d.accuse_le ? T('releve_accusee', { par: d.accuse_par_nom, h: h(d.accuse_le) }) : T('releve_non_accusee')}</p>
        ${d.accuse_le ? '' : `<button class="btn pri" id="mt-releve-ok" type="button" data-id="${d.id}">${T('releve_accuser')}</button>`}` : ''}</section>`;
    zone.querySelector('#mt-releve-go').onclick = async () => { try { await o.api('POST', '/taches/releve', { etablissement_id: o.etablissement_id, quart: zone.querySelector('#mt-quart').value }); o.toast?.(T('releve_ok')); } catch (err) { o.toast?.(err.message, true); } releve(zone, o); };
    const ok = zone.querySelector('#mt-releve-ok');
    if (ok) ok.onclick = async () => { try { await o.api('POST', `/taches/releve/${ok.dataset.id}/accuser`); o.toast?.(T('releve_ok')); } catch (err) { o.toast?.(err.message, true); } releve(zone, o); };
  }
  window.ArrimoMesTaches = { afficher };
})();
