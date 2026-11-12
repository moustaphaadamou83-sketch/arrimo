/* Liaison Établissements (cahier 3) : demande de transport ambulancier sur une coordination (hospitalisation, retour),
   suivie par l'établissement d'origine et l'établissement de destination. Parcours distinct des préalertes.
   Seule la référence du résident et les informations de transport (listes fermées) sont transmises à l'ambulance. */
(() => {
  const T = (k, v) => esc(t(`transports.${k}`, v));
  const OUVERTES = ['demandee', 'acceptee', 'en_route', 'pris_en_charge'];
  /** Emplacement réservé dans une carte de coordination (rempli après l'affichage). */
  const bloc = (c) => (['hospitalisation', 'retour'].includes(c.type) ? `<div class="tr-bloc" data-tr-co="${c.id}" data-tr-origine="${c.origine_id ?? ''}" data-tr-statut="${esc(c.statut)}"></div>` : '');
  async function brancher(zone) {
    const places = [...zone.querySelectorAll('[data-tr-co]')]; if (!places.length || !etat.ctx) return;
    let liste;
    try { liste = await api('GET', `/transports?etablissement_id=${etat.ctx}`); } catch { return; }
    const gerer = ['coordonnateur', 'admin_etab', 'gestionnaire', 'equipe_soins'].includes(etat.moi.utilisateur.role);
    for (const p of places) {
      const coId = Number(p.dataset.trCo);
      const d = liste.filter((x) => x.coordination_id === coId).sort((a, b) => b.id - a.id)[0];
      const origine = Number(p.dataset.trOrigine) === etat.ctx;
      const peutDemander = gerer && origine && ['envoyee', 'acceptee'].includes(p.dataset.trStatut) && !(d && OUVERTES.includes(d.statut));
      p.innerHTML = `${d ? `<div class="note tr-suivi"><svg class="ic" aria-hidden="true" focusable="false"><use href="icones.svg#i-ambulance"/></svg> ${T('suivi', { numero: d.numero, org: d.organisation, statut: t(`transports.s_${d.statut}`) })}${d.unite ? ` · ${T('unite', { unite: d.unite })}` : ''}${d.heure_souhaitee ? ` · ${T('heure', { heure: heure(d.heure_souhaitee) })}` : ''}
          ${d.actions.includes('annuler') ? ` <button class="btn discret" type="button" data-tr-annuler="${d.id}" data-version="${d.version}">${T('annuler')}</button>` : ''}</div>` : ''}
        ${peutDemander ? `<div class="actions"><button class="btn" type="button" data-tr-demander="${coId}">${T('demander')}</button></div>` : ''}`;
    }
    zone.querySelectorAll('[data-tr-demander]').forEach((b) => { b.onclick = async () => {
      const orgs = await api('GET', `/transports/organisations?etablissement_id=${etat.ctx}`);
      if (!orgs.length) return toast(t('transports.aucune_org'), true);
      modale(t('transports.titre'), `<p class="note">${T('aide')}</p>
        <div class="champ"><label class="lbl" for="tr-org">${T('organisation')}</label><select id="tr-org">${orgs.map((o) => `<option value="${o.id}">${esc(o.nom)}</option>`).join('')}</select></div>
        <div class="champ"><label class="lbl" for="tr-heure">${T('heure_souhaitee')}</label><input id="tr-heure" type="datetime-local"></div>`,
      [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => {
        const h = $('#tr-heure').value; const cle = `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        return (await agir(null, () => api('POST', `/coordinations/${b.dataset.trDemander}/transport`, { organisation_id: Number($('#tr-org').value), heure_souhaitee: h ? new Date(h).toISOString() : null, cle }), t('transports.ok'))) !== null;
      } }]);
    }; });
    zone.querySelectorAll('[data-tr-annuler]').forEach((b) => { b.onclick = () => modale(t('transports.annuler'), `<p>${T('confirmer_annuler')}</p>`,
      [{ label: t('general.retour') }, { label: t('transports.annuler'), pri: true, run: async () => (await agir(null, () => api('POST', `/transports/${b.dataset.trAnnuler}/action`, { etablissement_id: etat.ctx, action: 'annuler', version: Number(b.dataset.version) }), t('transports.ok'))) !== null }]); });
  }
  window.ArrimoTransports = { bloc, brancher };
})();
