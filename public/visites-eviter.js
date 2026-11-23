/* Résidences (21 nov. 2026) : « Visites » (visites confirmées du CLSC ou du prestataire) et « Avant l'appel » (éviter les transferts
   inutiles : liste et alternatives de l'établissement, décision de l'équipe comptée ; jamais bloquant, jamais une recommandation clinique). */
(() => {
  const V = (k, v) => esc(t(`visites.${k}`, v)); const A = (k, v) => esc(t(`eviter.${k}`, v));
  const TYPES = ['aide_hygiene', 'soins_infirmiers', 'medication', 'readaptation', 'autre'];
  const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const etatV = { mois: new Date().toISOString().slice(0, 7) };
  async function vueVisites() {
    const v = $('#v-visites');
    const [liste, rap] = await Promise.all([api('GET', `/visites?etablissement_id=${etat.ctx}&jours=7`), api('GET', `/visites/rapport?etablissement_id=${etat.ctx}&mois=${etatV.mois}`)]);
    if (!liste || !rap) return;
    v.innerHTML = `<div class="entete"><div><h2>${V('titre')}</h2><p class="note">${V('intro')}</p></div><button class="btn pri" id="vi-planifier">${V('planifier')}</button></div>
      <section class="panneau-c">${liste.length ? `<div class="tableau"><table><thead><tr><th>${V('quand')}</th><th>${V('resident')}</th><th>${V('type')}</th><th>${V('prestataire')}</th><th>${V('statut')}</th><th></th></tr></thead><tbody>
        ${liste.map((x) => `<tr><td>${esc(heure(x.debut_prevu))} → ${esc(heureCourte(x.fin_prevue))}</td><td><span class="donnee">${esc(x.prenom || '')} ${esc(x.nom || '')}</span> ${esc(x.resident_ref)}</td>
          <td>${V(`t_${x.type_visite}`)}</td><td>${esc(x.prestataire)}${x.intervenant ? ` · ${esc(x.intervenant)}` : ''}</td>
          <td>${V(`s_${x.statut}`)}${x.arrivee_le ? ` · ${V('arrivee', { h: heureCourte(x.arrivee_le), s: t(`visites.src_${x.arrivee_source}`) })}` : ''}${x.depart_le ? ` · ${V('depart', { h: heureCourte(x.depart_le) })}` : ''}${x.soin_rpa ? ` · ${V('soin_fait', { t: t(`visites.t_${x.soin_rpa}`) })}` : ''}</td>
          <td>${(window.ArrimoSillage?.bouton('visite', x.id) || '')}${x.statut === 'prevue' ? `<button class="btn discret" data-vi-annuler="${x.id}">${V('annuler')}</button>` : ''}${x.statut === 'manquee' && !x.soin_rpa ? `<select data-vi-soin="${x.id}" aria-label="${V('soin_choix')}"><option value="">${V('soin_choix')}</option>${TYPES.map((y) => `<option value="${y}">${V(`t_${y}`)}</option>`).join('')}</select>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<p class="note">${V('aucune')}</p>`}</section>
      <section class="panneau-c"><h3>${V('rapport')}</h3><div class="ligne"><input type="month" id="vi-mois" value="${esc(etatV.mois)}" aria-label="${V('mois')}"><button class="btn" id="vi-csv">${V('csv')}</button></div>
        <p>${V('total', rap.total)}</p></section>`;
    $('#vi-planifier').onclick = planifier;
    $('#vi-mois').onchange = (e) => { etatV.mois = e.target.value; vueVisites(); };
    $('#vi-csv').onclick = async () => { const r = await fetch(`/api/visites/rapport.csv?etablissement_id=${etat.ctx}&mois=${etatV.mois}`, { headers: { Authorization: `Bearer ${etat.token}`, 'X-Langue': langue } }); if (!r.ok) return; const u = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = u; a.download = `visites-${etatV.mois}.csv`; document.body.appendChild(a); a.click(); a.remove(); };
    v.querySelectorAll('[data-vi-annuler]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/visites/${b.dataset.viAnnuler}/residence`, { action: 'annuler' }), t('visites.fait')); });
    v.querySelectorAll('[data-vi-soin]').forEach((s) => { s.onchange = () => s.value && agir(null, () => api('POST', `/visites/${s.dataset.viSoin}/residence`, { action: 'soin_rpa', soin: s.value }), t('visites.fait')); });
  }
  async function planifier() {
    const [res, pres] = await Promise.all([api('GET', `/chsld/residents?etablissement_id=${etat.ctx}`), api('GET', `/visites/prestataires?etablissement_id=${etat.ctx}`)]);
    const residents = Array.isArray(res) ? res : res.residents || [];
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    modale(t('visites.planifier'), `<div class="champ"><label class="lbl" for="vi-res">${V('resident')}</label><select id="vi-res">${residents.map((r) => `<option value="${r.id}">${esc(r.reference)} · ${esc(r.prenom || '')} ${esc(r.nom || '')}</option>`).join('')}</select></div>
      <div class="champ"><label class="lbl" for="vi-type">${V('type')}</label><select id="vi-type">${TYPES.map((y) => `<option value="${y}">${V(`t_${y}`)}</option>`).join('')}</select></div>
      <div class="champ"><label class="lbl" for="vi-pres">${V('prestataire')}</label><select id="vi-pres">${pres.map((p) => `<option value="${p.id}">${esc(p.nom)}</option>`).join('')}</select></div>
      <div class="champ"><label class="lbl" for="vi-debut">${V('debut')}</label><input type="datetime-local" id="vi-debut" value="${local(d)}"></div>
      <div class="champ"><label class="lbl" for="vi-fin">${V('fin')}</label><input type="datetime-local" id="vi-fin" value="${local(new Date(d.getTime() + 3600000))}"></div>
      <div class="champ"><label class="lbl" for="vi-rec">${V('recurrence')}</label><select id="vi-rec">${['aucune', 'quotidienne', 'hebdomadaire'].map((r) => `<option value="${r}">${V(`r_${r}`)}</option>`).join('')}</select></div>
      <div class="champ"><label class="lbl" for="vi-n">${V('occurrences')}</label><input type="number" id="vi-n" min="1" max="56" value="4"></div>`,
    [{ label: t('general.annuler') }, { label: t('visites.planifier'), pri: true, run: async () => (await agir(null, () => api('POST', '/visites', { etablissement_id: etat.ctx, resident_id: Number($('#vi-res').value),
      type_visite: $('#vi-type').value, prestataire_id: Number($('#vi-pres').value), debut_prevu: new Date($('#vi-debut').value).toISOString(), fin_prevue: new Date($('#vi-fin').value).toISOString(),
      recurrence: $('#vi-rec').value, occurrences: Number($('#vi-n').value) }), t('visites.planifiee'))) !== null || false }]);
  }
  async function vueEviter() {
    const v = $('#v-eviter');
    const d = await api('GET', `/eviter?etablissement_id=${etat.ctx}`);
    if (!d) return;
    v.innerHTML = `<div class="entete"><div><h2>${A('titre')}</h2><p class="note">${A('intro')}</p></div></div>
      <section class="panneau-c"><h3>${A('verifications')}</h3>${d.verifications.length ? `<div class="pile">${d.verifications.map((x, i) => `<label class="case"><input type="checkbox" id="ev-v${i}"> ${esc(x)}</label>`).join('')}</div>` : `<p class="note">${A('vide')}</p>`}
        <h3>${A('alternatives')}</h3>${d.alternatives.length ? `<ul class="liste-simple">${d.alternatives.map((a) => `<li><strong>${A(`a_${a.code}`)}</strong>${a.contact ? ` · ${esc(a.contact)}` : ''} <button class="btn" data-ev-evite="${a.code}">${A('evite_grace')}</button></li>`).join('')}</ul>` : `<p class="note">${A('vide_alt')}</p>`}
        <p class="note">${A('jamais_bloquant')}</p><div class="ligne"><label class="lbl" for="ev-ref">${A('ref_resident')}</label><input id="ev-ref" maxlength="12" autocomplete="off" style="max-width:140px"><button class="btn" id="ev-fait">${A('transfert_fait')}</button></div>
        <div id="ev-suite"></div></section>
      <section class="panneau-c"><h3>${A('decisions_titre')}</h3>${(d.decisions || []).length ? `<div class="tableau"><table><thead><tr><th>${A('d_quand')}</th><th>${A('d_decision')}</th><th>${A('d_demande')}</th><th>${A('d_accuse')}</th><th>${A('d_vehicule')}</th></tr></thead><tbody>
        ${d.decisions.map((x) => { const f = x.decision === 'transfert_fait'; const oui = (b) => (b ? '<svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-check"/></svg>' : '—');
          return `<tr><td class="note">${esc(heure(x.cree_le))}</td><td>${f ? A('dec_transfert') : `${A('dec_evite')} · ${A(`a_${x.alternative}`)}`}${x.resident_ref ? ` · <span class="donnee">${esc(x.resident_ref)}</span>` : ''}</td>
            <td>${f ? (x.transport ? `<svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-check"/></svg> ${esc(x.transport)}` : `<b>${A('pas_de_demande')}</b>`) : ''}</td><td>${f ? oui(x.accuse) : ''}</td><td>${f ? oui(x.vehicule_affecte) : ''}</td></tr>`; }).join('')}</tbody></table></div>` : `<p class="note">${A('aucune_decision')}</p>`}</section>
      <section class="panneau-c"><h3>${A('mois_titre')}</h3><p>${A('mois', { e: d.mois.evites, f: d.mois.faits })}</p></section>
      ${d.peut_regler ? `<section class="panneau-c"><h3>${A('regler')}</h3><p class="note">${A('regler_aide')}</p>
        <div class="champ"><label class="lbl" for="ev-verifs">${A('verifications')}</label><textarea id="ev-verifs" rows="5">${esc(d.verifications.join('\n'))}</textarea></div>
        ${d.alternatives_possibles.map((c) => { const a = d.alternatives.find((x) => x.code === c); return `<div class="ligne"><label class="case"><input type="checkbox" data-ev-alt="${c}"${a ? ' checked' : ''}> ${A(`a_${c}`)}</label><input data-ev-contact="${c}" value="${esc(a?.contact || '')}" placeholder="${A('contact')}" aria-label="${A('contact')}" maxlength="120"></div>`; }).join('')}
        <div class="ligne"><button class="btn pri" id="ev-enregistrer">${A('enregistrer')}</button></div></section>` : ''}`;
    v.querySelectorAll('[data-ev-evite]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', '/eviter/decisions', { etablissement_id: etat.ctx, decision: 'transfert_evite', alternative: b.dataset.evEvite }), t('eviter.note')); });
    // COR-002 : la décision est enregistrée seule ; aucune ambulance n'est demandée tant que la demande de transport n'est pas faite
    $('#ev-fait').onclick = async () => {
      const ref = $('#ev-ref').value.trim().toUpperCase();
      try { await api('POST', '/eviter/decisions', { etablissement_id: etat.ctx, decision: 'transfert_fait', ...(ref ? { resident_ref: ref } : {}) }); } catch (e) { toast(e.message, true); return; }
      await vueEviter();
      $('#ev-suite').innerHTML = `<p class="bandeau" role="status">${A('decision_seule')}</p><button class="btn pri" id="ev-demander">${A('demander_transport')}</button>`;
      $('#ev-demander').onclick = () => document.querySelector('#onglets button[data-v="c-urgences"]')?.click();
    };
    if ($('#ev-enregistrer')) $('#ev-enregistrer').onclick = (e) => agir(e.currentTarget, () => api('PUT', '/eviter', { etablissement_id: etat.ctx, version: d.version,
      verifications: $('#ev-verifs').value.split('\n').map((x) => x.trim()).filter(Boolean),
      alternatives: [...v.querySelectorAll('[data-ev-alt]:checked')].map((c) => ({ code: c.dataset.evAlt, contact: v.querySelector(`[data-ev-contact="${c.dataset.evAlt}"]`).value })) }), t('eviter.enregistre'));
  }
  window.ArrimoVisitesEviter = { vues: { visites: vueVisites, eviter: vueEviter } };
})();
