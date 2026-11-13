/* Liaison Établissements (cahier 3) : demande de transport ambulancier sur une coordination (hospitalisation, retour),
   suivie par l'établissement d'origine et l'établissement de destination. Parcours distinct des préalertes.
   Seule la référence du résident et les informations de transport (listes fermées) sont transmises à l'ambulance. */
(() => {
  const T = (k, v) => esc(t(`transports.${k}`, v));
  const OUVERTES = ['demandee', 'acceptee', 'en_route', 'pris_en_charge'];
  /** Emplacement réservé dans une carte de coordination (rempli après l'affichage). */
  const bloc = (c) => (['hospitalisation', 'retour'].includes(c.type) ? `<div class="tr-bloc" data-tr-co="${c.id}" data-tr-origine="${c.origine_id ?? ''}" data-tr-statut="${esc(c.statut)}"></div>` : '');
  /** Suivi du transport d'un résident : véhicule, état, hôpital (décidé par l'équipage), heure prévue, arrivée confirmée. */
  function suivi(d) {
    const x = [];
    if (d.unite) x.push(T('vehicule', { unite: d.unite, plaque: d.plaque ? t('transports.plaque', { plaque: d.plaque }) : '', etat: d.etat_vehicule ? t(`transports.ev.${d.etat_vehicule}`) : '—' }));
    const pa = d.prealerte;
    if (pa) {
      x.push(T('vers', { dest: pa.destination }));
      if (pa.arrivee_confirmee_le) x.push(T('arrivee_confirmee', { heure: heure(pa.arrivee_confirmee_le) }));
      else if (pa.eta_minutes != null && pa.statut !== 'arrivee') x.push(`<b>${T('arrive_dans', { n: pa.eta_minutes, km: pa.eta_km })}</b>`);
      else if (pa.heure_prevue) x.push(T('eta', { heure: heure(pa.heure_prevue) }));
    }
    if (d.categorie_urgence) x.push(T('cat_info', { cat: t(`transports.cat.${d.categorie_urgence}`) }));
    if (d.hopital_prefere) x.push(T('pref_info', { h: d.hopital_prefere }));
    const autre = pa && pa.destination_id !== d.destination_id ? `<br><b>${T('autre_dest', { dest: pa.destination, coord: d.destination })}</b>` : '';
    return x.length ? `<br>${x.join(' · ')}${autre}` : '';
  }
  async function brancher(zone) {
    const places = [...zone.querySelectorAll('[data-tr-co]')]; if (!places.length || !etat.ctx) return;
    let liste;
    try { liste = await api('GET', `/transports?etablissement_id=${etat.ctx}`); } catch { return; }
    const gerer = ['coordonnateur', 'admin_etab', 'gestionnaire', 'equipe_soins'].includes(etat.moi.utilisateur.role);
    for (const p of places) {
      const coId = Number(p.dataset.trCo);
      const d = liste.filter((x) => x.coordination_id === coId).sort((a, b) => b.id - a.id)[0];
      const origine = Number(p.dataset.trOrigine) === etat.ctx;
      const moduleActif = (etat.moi.etablissements.find((e) => e.id === etat.ctx)?.modules || {}).transport_ambulancier === true;
      const peutDemander = moduleActif && gerer && origine && ['envoyee', 'acceptee'].includes(p.dataset.trStatut) && !(d && OUVERTES.includes(d.statut));
      p.innerHTML = `${d ? `<div class="note tr-suivi"><svg class="ic" aria-hidden="true" focusable="false"><use href="icones.svg#i-ambulance"/></svg> ${T('suivi', { numero: d.numero, org: d.organisation, statut: t(`transports.s_${d.statut}`) })}${d.heure_souhaitee ? ` · ${T('heure', { heure: heure(d.heure_souhaitee) })}` : ''}${suivi(d)}
          ${d.actions.includes('annuler') ? ` <button class="btn discret" type="button" data-tr-annuler="${d.id}" data-version="${d.version}">${T('annuler')}</button>` : ''}</div>` : ''}
        ${peutDemander ? `<div class="actions"><button class="btn" type="button" data-tr-demander="${coId}">${T('demander')}</button></div>` : ''}`;
    }
    zone.querySelectorAll('[data-tr-demander]').forEach((b) => { b.onclick = async () => {
      const orgs = await api('GET', `/transports/organisations?etablissement_id=${etat.ctx}`);
      if (!orgs.length) return toast(t('transports.aucune_org'), true);
      // Établissement d'hébergement : type d'urgence et hôpital souhaité, à titre d'information
      const hebergement = (etat.moi.etablissements.find((e) => e.id === etat.ctx)?.type_etablissement || 'hopital') !== 'hopital';
      const hops = hebergement ? await api('GET', `/urgences-proches?etablissement_id=${etat.ctx}`).catch(() => []) : [];
      const CATS = ['medicale', 'cardiaque', 'neurologique', 'traumatologie', 'respiratoire', 'sante_mentale', 'autre'];
      modale(t('transports.titre'), `<p class="note">${T('aide')}</p>
        <div class="champ"><label class="lbl" for="tr-org">${T('organisation')}</label><select id="tr-org">${orgs.map((o) => `<option value="${o.id}">${esc(o.nom)}</option>`).join('')}</select></div>
        <div class="champ"><label class="lbl" for="tr-heure">${T('heure_souhaitee')}</label><input id="tr-heure" type="datetime-local"></div>
        ${hebergement ? `<div class="champ"><label class="lbl" for="tr-cat">${T('categorie')}</label><select id="tr-cat"><option value="">—</option>${CATS.map((c) => `<option value="${c}">${T(`cat.${c}`)}</option>`).join('')}</select></div>
        <div class="champ"><label class="lbl" for="tr-pref">${T('prefere')}</label><select id="tr-pref"><option value="">${T('sans_preference')}</option>${hops.map((h) => `<option value="${h.id}">${esc(h.nom)}${h.distance_km != null ? ` (${h.distance_km} km)` : ''}</option>`).join('')}</select></div>
        <p class="note">${T('decision')}</p>` : ''}`,
      [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => {
        const h = $('#tr-heure').value; const cle = `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        return (await agir(null, () => api('POST', `/coordinations/${b.dataset.trDemander}/transport`, { organisation_id: Number($('#tr-org').value), heure_souhaitee: h ? new Date(h).toISOString() : null, cle,
          ...(hebergement ? { categorie: $('#tr-cat').value || null, hopital_prefere_id: $('#tr-pref').value ? Number($('#tr-pref').value) : null } : {}) }), t('transports.ok'))) !== null;
      } }]);
    }; });
    zone.querySelectorAll('[data-tr-annuler]').forEach((b) => { b.onclick = () => modale(t('transports.annuler'), `<p>${T('confirmer_annuler')}</p>`,
      [{ label: t('general.retour') }, { label: t('transports.annuler'), pri: true, run: async () => (await agir(null, () => api('POST', `/transports/${b.dataset.trAnnuler}/action`, { etablissement_id: etat.ctx, action: 'annuler', version: Number(b.dataset.version) }), t('transports.ok'))) !== null }]); });
  }
  /* Urgences proches (établissement d'hébergement) : capacités globales en carte et en liste, et suivi des transports de SES résidents. */
  async function vueUrgences() {
    const v = $('#v-c-urgences');
    const [hops, trs] = await Promise.all([api('GET', `/urgences-proches?etablissement_id=${etat.ctx}`), api('GET', `/transports?etablissement_id=${etat.ctx}`)]);
    const COUL_RANG = ['#16A34A', '#F59E0B', '#DC2626', '#94A3B8'];
    const RANG = [T('up_rang_0'), T('up_rang_1'), T('up_rang_2'), T('up_rang_3')];
    const classees = hops.filter((h) => h.temps_min != null || h.source_distance === 'osrm').slice(0, 8);
    const liste = classees.length ? classees : hops.slice(0, 8);
    const meilleur = liste.find((h) => h.rang < 2);
    const ligne = (h) => {
      const st = h.statut_declare && !h.statut_declare.perime ? T(`up_st.${h.statut_declare.statut}`) : RANG[h.rang ?? 3];
      return `<tr data-urgence="${h.id}" class="${meilleur && meilleur.id === h.id ? 'meilleur' : ''}"><td data-l="${T('c_urgence')}"><b>${esc(ArrimoCarte.court(h.nom))}</b>${meilleur && meilleur.id === h.id ? ` <span class="badge-og">${T('og_meilleur')}</span>` : ''}</td>
        <td data-l="${T('c_temps')}" class="num">${h.temps_min != null ? `<b>${h.temps_min} min</b>` : '—'}</td><td data-l="${T('c_dist')}" class="num">${h.distance_km != null ? `${h.distance_km} km` : '—'}</td>
        <td data-l="${T('c_civ')}" class="num">${h.urgence ? `<b>${h.urgence.civieres_libres}</b>` : '—'}</td>
        <td data-l="${T('c_statut')}"><span class="pastille-r" style="background:${COUL_RANG[h.rang ?? 3]};color:${h.rang === 1 ? '#1F2937' : '#fff'}">${st}</span></td>
        <td data-l="${T('c_services')}">${h.services_ouverts?.length ? h.services_ouverts.map((c) => `<span class="puce">${T(`up_sv.${c}`)}</span>`).join(' ') : '—'}${h.soins_intensifs ? `<div class="note">${T('up_si', h.soins_intensifs)}</div>` : ''}</td></tr>`;
    };
    const lignesTr = trs.filter((d) => d.origine_id === etat.ctx).map((d) => `<article class="item" data-transport="${d.id}"><div><div><b class="num">${esc(d.numero)}</b> · ${esc(d.resident_ref)} · ${esc(d.coordination)}</div>
      <div class="note">${T('suivi', { numero: d.numero, org: d.organisation, statut: t(`transports.s_${d.statut}`) })}${suivi(d)}</div></div></article>`).join('');
    v.innerHTML = `<div class="entete"><div><h2>${T('up_titre')}</h2><p>${T('up_intro')}</p></div></div>
      <div class="panneau-c"><h3>${T('up_suivi')}</h3><div class="liste">${lignesTr || `<p class="note">${T('up_suivi_aucun')}</p>`}</div></div>
      <div class="panneau-c"><h3>${T('up_classees')}</h3>
        ${meilleur ? `<p class="og-phrase">${T('up_og', { nom: ArrimoCarte.court(meilleur.nom), temps: meilleur.temps_min != null ? `${meilleur.temps_min} min` : `${meilleur.distance_km} km`, civ: meilleur.urgence?.civieres_libres ?? '—' })}</p>` : ''}
        <table class="classe"><thead><tr><th>${T('c_urgence')}</th><th>${T('c_temps')}</th><th>${T('c_dist')}</th><th>${T('c_civ')}</th><th>${T('c_statut')}</th><th>${T('c_services')}</th></tr></thead><tbody>${liste.map(ligne).join('') || `<tr><td colspan="6">${T('up_aucune')}</td></tr>`}</tbody></table>
        <details class="voir-carte"><summary class="btn">${T('voir_carte')}</summary><div id="carte-urgences" style="height:min(55vh,380px);margin-top:10px"></div></details></div>`;
    const det = v.querySelector('.voir-carte');
    det.addEventListener('toggle', async () => {
      if (!det.open) return;
      try {
        const ici = etat.moi.etablissements.find((e) => e.id === etat.ctx);
        const etiq = (h) => `${ArrimoCarte.court(h.nom)} · ${h.urgence ? t('transports.up_civieres', { n: h.urgence.civieres_libres }) : t('transports.up_sans')}`;
        await ArrimoCarte.dessiner(document.getElementById('carte-urgences'), { langue: locale().slice(0, 2),
          hebergements: ici ? [{ nom: ici.nom, latitude: ici.latitude, longitude: ici.longitude, details: [ici.ville] }] : [],
          cadrer: [...(ici?.latitude != null ? [[ici.latitude, ici.longitude]] : []), ...liste.slice(0, 3).filter((h) => h.latitude != null).map((h) => [h.latitude, h.longitude])],
          hopitaux: liste.map((h, i) => ({ ...h, prio: i < 3 ? 1 : 3, niveau: ArrimoCarte.niveau(h), etiquette: etiq(h),
            details: [h.ville, h.temps_min != null ? `${h.temps_min} min · ${h.distance_km} km` : null] })) });
      } catch { /* carte indisponible : le tableau suffit */ }
    });
  }
  window.ArrimoTransports = { bloc, brancher, vueUrgences };
})();
