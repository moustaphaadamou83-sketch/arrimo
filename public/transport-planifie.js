/* Transport non urgent (20 nov. 2026, cahier v2, C.4) : « Réserver un transport » (hôpital, résidence) : date et plage, type de véhicule,
   accessibilité, accompagnateur, lit à libérer ; suivi en direct ; le transporteur confirme la plage ou refuse avec un motif fermé.
   Le transporteur ne voit que la référence et les lieux. */
(() => {
  const P = (k, v) => esc(t(`transport_planifie.${k}`, v));
  const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  let historique = false;
  async function vue() {
    const v = $('#v-transports-planifies');
    const [liste, orgs] = await Promise.all([api('GET', `/transports?etablissement_id=${etat.ctx}${historique ? '&historique=1' : ''}`), api('GET', `/transports/organisations?etablissement_id=${etat.ctx}`).catch(() => [])]);
    if (!liste) return;
    const planifies = liste.filter((d) => d.motif_transport);
    v.innerHTML = `<div class="entete"><div><h2>${P('titre')}</h2><p class="note">${P('intro')}</p></div><div class="actions"><button type="button" class="btn" id="tp-historique" aria-pressed="${historique}">${P(historique ? 'activite' : 'historique')}</button>
      <button class="btn pri" id="tp-reserver">${P('reserver')}</button></div></div>
      <section class="panneau-c">${planifies.length ? `<div class="tableau"><table><thead><tr><th>${P('numero')}</th><th>${P('motif')}</th><th>${P('patient')}</th><th>${P('destination')}</th><th>${P('plage')}</th><th>${P('statut')}</th><th></th></tr></thead><tbody>
        ${planifies.map((d) => `<tr><td>${esc(d.numero)}</td><td>${P(`m_${d.motif_transport}`)}</td><td><span class="donnee">${esc(d.resident_ref)}</span>${d.lit_code ? ` · ${P('lit', { lit: d.lit_code })}` : ''}</td>
          <td>${esc(d.destination || '')}</td><td>${d.plage_confirmee_debut ? `<strong>${P('confirmee', { debut: heureCourte(d.plage_confirmee_debut), fin: heureCourte(d.plage_confirmee_fin) })}</strong>` : P('demandee', { jour: heure(d.plage_debut), fin: heureCourte(d.plage_fin) })}</td>
          <td>${P(`s_${d.statut}`)}${d.unite ? ` · ${esc(d.unite)}` : ''}</td><td>${d.statut === 'a_valider' && d.origine_id === etat.ctx ? `<button class="btn pri" data-tp-transmettre="${d.id}">${P('transmettre')}</button>` : ''}${d.statut !== 'a_valider' && d.actions.includes('annuler') ? `<button class="btn discret" data-tp-annuler="${d.id}" data-v="${d.version}">${P('annuler')}</button>` : ''}${d.actions.map((action) => action === 'annuler' && d.statut === 'a_valider' ? 'retirer_brouillon' : action).filter((action) => ['retirer_brouillon', 'archiver'].includes(action)).map((action) =>
            `<button type="button" class="btn discret" data-tp-action="${action}" data-id="${d.id}" data-v="${d.version}">${P(action)}</button>`).join('')}${d.archivee ? `<span class="note">${P('archive')}</span>` : ''}${(window.ArrimoSillage?.bouton('demande_transport', d.id) || '')}</td></tr>`).join('')}</tbody></table></div>` : `<p class="note">${P('aucun')}</p>`}</section>`;
    $('#tp-reserver').onclick = () => reserver(orgs);
    $('#tp-historique').onclick = () => { historique = !historique; rafraichir(); };
    v.querySelectorAll('[data-tp-action]').forEach((b) => { b.onclick = () => agir(b,
      () => api('POST', `/transports/${b.dataset.id}/action`, { etablissement_id: etat.ctx, action: b.dataset.tpAction, version: Number(b.dataset.v) }),
      t(`transport_planifie.${b.dataset.tpAction}_ok`)); });
    // COR-001 : vérification humaine avant transmission (plage, véhicule, transporteur autorisé) ; aucune ambulance affectée ici
    v.querySelectorAll('[data-tp-transmettre]').forEach((b) => { b.onclick = () => {
      const d = planifies.find((x) => x.id === Number(b.dataset.tpTransmettre)); if (!d) return;
      const opt = (liste, cur) => liste.map(([val, l]) => `<option value="${esc(val)}"${String(val) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`).join('');
      modale(t('transport_planifie.transmettre_titre'), `<p class="note">${P('transmettre_intro')}</p>
        <p><b>${esc(d.numero)}</b> · <span class="donnee">${esc(d.resident_ref)}</span> → ${esc(d.destination || '')}</p>
        <div class="champ"><label class="lbl" for="tx-debut">${P('plage_debut')}</label><input type="datetime-local" id="tx-debut" value="${local(new Date(d.plage_debut))}"></div>
        <div class="champ"><label class="lbl" for="tx-fin">${P('plage_fin')}</label><input type="datetime-local" id="tx-fin" value="${local(new Date(d.plage_fin))}"></div>
        <div class="champ"><label class="lbl" for="tx-veh">${P('vehicule')}</label><select id="tx-veh">${opt(['ambulance', 'transport_adapte', 'autre'].map((m) => [m, t(`transport_planifie.v_${m}`)]), d.type_vehicule)}</select></div>
        <div class="champ"><label class="lbl" for="tx-org">${P('transporteur')}</label><select id="tx-org">${opt(orgs.map((o) => [o.id, o.nom]), d.organisation_id)}</select></div>`,
      [{ label: t('general.annuler') }, { label: t('transport_planifie.transmettre'), pri: true, run: async () => (await agir(null, () => api('POST', `/transports/${d.id}/action`, { etablissement_id: etat.ctx, action: 'transmettre', version: d.version,
        plage_debut: new Date($('#tx-debut').value).toISOString(), plage_fin: new Date($('#tx-fin').value).toISOString(), type_vehicule: $('#tx-veh').value, organisation_id: Number($('#tx-org').value) }), t('transport_planifie.transmis_ok'))) !== null }]);
    }; });
    v.querySelectorAll('[data-tp-annuler]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/transports/${b.dataset.tpAnnuler}/action`, { etablissement_id: etat.ctx, action: 'annuler', version: Number(b.dataset.v) }), t('transport_planifie.annule')); });
  }
  async function reserver(orgs) {
    const lits = (await api('GET', `/lits?etablissement_id=${etat.ctx}`).catch(() => null)) || {};
    const occupes = (Array.isArray(lits) ? lits : lits.lits || []).filter((l) => l.etat === 'occupe' && l.patient_ref);
    const etabs = (await api('GET', `/transports/destinations?etablissement_id=${etat.ctx}`).catch(() => null)) || (etat.moi.etablissements || []).filter((e) => e.id !== etat.ctx);
    const demain = new Date(); demain.setDate(demain.getDate() + 1); demain.setHours(9, 0, 0, 0);
    const opt = (liste) => liste.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    modale(t('transport_planifie.reserver'), `<p class="note">${P('veille')}</p>
      <div class="champ"><label class="lbl" for="tp-lit">${P('lit_ou_ref')}</label><select id="tp-lit"><option value="">${P('saisir_ref')}</option>${opt(occupes.map((l) => [l.id, `${l.code} · ${l.patient_ref}`]))}</select></div>
      <div class="champ"><label class="lbl" for="tp-ref">${P('reference')}</label><input id="tp-ref" maxlength="12" autocomplete="off"></div>
      <div class="champ"><label class="lbl" for="tp-motif">${P('motif')}</label><select id="tp-motif">${opt(['retour_domicile', 'transfert_stable', 'depart_nsa', 'retour_chsld'].map((m) => [m, t(`transport_planifie.m_${m}`)]))}</select></div>
      <div class="champ"><label class="lbl" for="tp-dest-recherche">${P('destination_recherche')}</label><input id="tp-dest-recherche" list="tp-dest-liste" maxlength="120" autocomplete="off">
        <datalist id="tp-dest-liste">${etabs.map((e) => `<option value="${esc(e.nom)}">${esc(e.ville || '')}</option>`).join('')}</datalist><span class="note">${P('destination_aide')}</span></div>
      <div class="champ"><label class="lbl" for="tp-debut">${P('plage_debut')}</label><input type="datetime-local" id="tp-debut" value="${local(demain)}"></div>
      <div class="champ"><label class="lbl" for="tp-fin">${P('plage_fin')}</label><input type="datetime-local" id="tp-fin" value="${local(new Date(demain.getTime() + 3600000))}"></div>
      <div class="champ"><label class="lbl" for="tp-vehicule">${P('vehicule')}</label><select id="tp-vehicule">${opt(['ambulance', 'transport_adapte', 'autre'].map((m) => [m, t(`transport_planifie.v_${m}`)]))}</select></div>
      <div class="champ"><label class="lbl" for="tp-access">${P('accessibilite')}</label><select id="tp-access"><option value="">${P('a_aucune')}</option>${opt(['fauteuil', 'deambulateur', 'leve_personne', 'lit_electrique', 'malentendant', 'malvoyant'].map((m) => [m, t(`transport_planifie.a_${m}`)]))}</select></div>
      <div class="champ"><label class="lbl" for="tp-accomp">${P('accompagnateur')}</label><select id="tp-accomp">${opt([['non', t('transport_planifie.c_non')], ['oui', t('transport_planifie.c_oui')]])}</select></div>
      <div class="champ"><label class="lbl" for="tp-org">${P('transporteur')}</label><select id="tp-org">${opt(orgs.map((o) => [o.id, o.nom]))}</select></div>`,
    [{ label: t('general.annuler') }, ...[true, false].map((brouillon) => ({
      label: t(brouillon ? 'transport_planifie.brouillon' : 'transport_planifie.reserver'), pri: !brouillon, run: async () => {
      const lit = $('#tp-lit').value; const saisie = $('#tp-dest-recherche').value.trim(); const dest = etabs.find((e) => e.nom === saisie)?.id || '';
      const r = await agir(null, () => api('POST', '/transports-planifies', { etablissement_id: etat.ctx, ...(lit ? { lit_id: Number(lit) } : { reference: $('#tp-ref').value.trim() }),
        brouillon, motif_transport: $('#tp-motif').value, ...(dest ? { destination_id: Number(dest) } : { destination_libelle: saisie }),
        plage_debut: new Date($('#tp-debut').value).toISOString(), plage_fin: new Date($('#tp-fin').value).toISOString(), type_vehicule: $('#tp-vehicule').value,
        infos: { accessibilite: $('#tp-access').value ? [$('#tp-access').value] : [], accompagnateur: $('#tp-accomp').value === 'oui' }, organisation_id: Number($('#tp-org').value) }),
      (x) => (brouillon ? t('transport_planifie.brouillon_ok') : x.avertissement ? t('transport_planifie.tardive') : t('transport_planifie.reserve_ok', { numero: x.numero })));
      return r !== null || false;
    } }))]);
  }
  window.ArrimoTransportPlanifie = { vues: { 'transports-planifies': vue } };
})();
