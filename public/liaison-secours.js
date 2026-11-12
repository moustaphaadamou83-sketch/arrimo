/* Arrimo Hôpital — Liaison Secours : ambulances annoncées par préalerte (carte et liste), accusé, préparation,
   confirmation du bon véhicule à l'arrivée, remise. Un autre véhicule ne ferme jamais la préalerte.
   Aucune identité : numéro temporaire, priorité déclarée, catégorie. OG répond d'après les mêmes étapes. */
(() => {
  const S = (k, v) => esc(t(`liaison_secours.${k}`, v));
  const OUVERTES = ['envoyee', 'recue', 'consultee', 'prise_en_compte', 'preparation', 'preparation_terminee', 'arrivee'];
  const COUL_PRIO = { immediate: '#DC2626', urgente: '#F59E0B', non_urgente: '#94A3B8' };
  const ls = { lire: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, ecrire: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* indisponible */ } } };
  const etatS = { donnees: null, vues: new Set(), carte: null, couche: null, affichage: ls.lire('arrimo-secours-affichage') === 'carte' ? 'carte' : 'liste' };
  const son = () => ls.lire('arrimo-secours-son') === '1';
  function bip() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(); const g = ac.createGain();
      o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.35);
    } catch { /* son indisponible */ }
  }
  const delai = (p) => {
    if (!p.heure_prevue) return S('eta_inconnue');
    const m = Math.round((new Date(p.heure_prevue).getTime() - Date.now()) / 60000);
    return S('eta', { heure: heureCourte(p.heure_prevue), delai: m > 0 ? t('liaison_secours.dans', { n: m }) : t('liaison_secours.depassee') });
  };
  const pastillePrio = (p) => `<span class="ch-etat" style="background:${COUL_PRIO[p.priorite]};color:#fff">${S(`prio_${p.priorite}`)}</span>`;
  function carteP(p) {
    const a = p.actions || [];
    const boutons = a.filter((x) => x !== 'signaler_probleme').map((x) => `<button class="btn${['prendre_en_compte', 'confirmer_vehicule', 'confirmer_service'].includes(x) ? ' pri' : ''}" type="button" data-ls="${x}" data-id="${p.id}">${S(`act_${x}`)}</button>`).join('');
    return `<article class="item" style="border-left:6px solid ${COUL_PRIO[p.priorite]}" data-prealerte="${p.id}"><div>
      <div><b class="num">${esc(p.numero)}</b> ${pastillePrio(p)} <span class="ch-etat">${S(`s_${p.statut}`)}</span></div>
      <div><b>${esc(p.organisation)}</b> · ${S('unite', { numero: p.unite })}${p.plaque ? ` · ${S('plaque', { plaque: p.plaque })}` : ''}</div>
      <div class="note">${S('categorie', { cat: t(`liaison_secours.cat_${p.categorie}`) })}${(p.equipage_noms || []).length ? ` · ${S('equipage', { noms: p.equipage_noms.join(', ') })}` : ''}</div>
      ${OUVERTES.includes(p.statut) && p.statut !== 'arrivee' ? `<div><b>${delai(p)}</b> · <span class="note">${p.position ? S('position_le', { heure: heureCourte(p.position.le) }) : S('sans_position')}</span></div>` : ''}
      ${OUVERTES.includes(p.statut) ? `<div class="note">${S('prep', { etat: t(`liaison_secours.prep_${p.etat_preparation}`) })}</div>` : ''}
      ${blocService(p)}
      ${(p.synthese || []).length ? `<div class="og-synthese" style="margin:8px 0;padding:8px 12px;border-left:4px solid var(--principal);background:var(--doux, #EEF6F7);border-radius:8px">
        <div class="note"><img src="og-robot.svg" alt="" width="18" height="18" style="vertical-align:middle;margin-right:6px"><b>${S('syn_titre')}</b></div>
        <ul style="margin:4px 0 0;padding-left:18px">${p.synthese.map((x) => `<li>${S(`syn_${x.code}`, { ...x, n: x.civieres_libres, niveau: x.niveau ? t(`liaison_secours.niv_${x.niveau}`) : '' })}</li>`).join('')}</ul></div>` : ''}
      ${p.arrivee_signalee_le && p.statut !== 'arrivee' && OUVERTES.includes(p.statut) ? `<div class="bandeau" role="status">${S('arrivee_signalee', { heure: heureCourte(p.arrivee_signalee_le) })}</div>` : ''}
      <div class="actions">${boutons}${a.includes('signaler_probleme') ? `<button class="btn discret" type="button" data-ls="signaler_probleme" data-id="${p.id}">${S('act_signaler_probleme')}</button>` : ''}
        <button class="btn discret" type="button" data-ls="details" data-id="${p.id}">${S('act_details')}</button></div>
    </div></article>`;
  }
  function panneauUrgence(u) {
    const d = u.declaration; const gerer = ['coordonnateur', 'gestionnaire', 'admin_etab'].includes(etat.moi.utilisateur.role);
    return `<div class="panneau-c" style="margin:8px 0"><h3 style="margin:0 0 4px">${S('urg_titre')}</h3>
      <p class="note">${d ? S('urg_actuel', { statut: t(`liaison_secours.st_${d.statut}`), age: d.age_min, par: u.par ? ` · ${u.par}` : '' }) : S('urg_aucun')}</p>
      ${d && d.perime ? `<p class="bandeau" role="status">${S('urg_perime')}</p>` : ''}
      ${gerer ? `<div class="chips" role="group">${u.statuts.map((x) => `<button class="chip" type="button" data-ls-urg="${x}" aria-pressed="${d?.statut === x}">${S(`st_${x}`)}</button>`).join('')}</div>` : ''}
      <p class="note">${S('urg_aide', { seuil: u.seuil_min })}</p></div>`;
  }
  function blocService(p) {
    if (!OUVERTES.includes(p.statut) && !p.service_confirme) return '';
    const j = p.service_justification || {}; const cat = t(`liaison_secours.cat_${p.categorie}`);
    if (p.service_statut === 'confirme') return `<div class="note">${S('service_confirme', { service: p.service_confirme })}</div>`;
    if (p.service_statut === 'modifie') return `<div class="note">${S('service_modifie', { service: p.service_confirme })}</div>`;
    if (p.service_statut === 'refuse') return `<div class="note">${S('service_refuse')}</div>`;
    if (p.service_statut === 'sans_proposition') return `<div class="note">${S('service_aucun')}</div>`;
    if (p.service_statut !== 'a_confirmer') return '';
    return `<div><b>${S('service_propose', { service: p.service_propose })}</b> · <span class="note">${S(`justif_${j.regle}`, { cat })}${(j.autres || []).length ? ` · ${S('justif_autres', { liste: j.autres.join(', ') })}` : ''}</span>
      <div class="note">${S('og_ne_decide_pas')}</div></div>`;
  }
  async function dessinerCarte(v, ouvertes) {
    const zone = v.querySelector('#ls-carte'); if (!zone) return;
    const L = await chargerLeaflet();
    if (etatS.carte) { etatS.carte.remove(); etatS.carte = null; }
    etatS.carte = L.map(zone, { scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 15, attribution: '&copy; OpenStreetMap' }).addTo(etatS.carte);
    const e = etabCtx(); const pts = [];
    if (e?.latitude != null) { const h = [e.latitude, e.longitude]; pts.push(h); L.circleMarker(h, { radius: 11, color: '#0E5E6F', weight: 3, fillColor: '#0E5E6F', fillOpacity: 0.9 }).addTo(etatS.carte).bindTooltip(esc(e.nom)); }
    for (const p of ouvertes.filter((x) => x.position)) {
      const pos = [p.position.latitude, p.position.longitude]; pts.push(pos);
      L.circleMarker(pos, { radius: 9, color: '#fff', weight: 2, fillColor: COUL_PRIO[p.priorite], fillOpacity: 1 }).addTo(etatS.carte)
        .bindTooltip(`${esc(p.numero)} · ${esc(p.unite)} · ${delai(p)}`, { permanent: true, direction: 'right' });
    }
    if (pts.length > 1) etatS.carte.fitBounds(pts, { padding: [40, 40], maxZoom: 13 }); else if (pts.length) etatS.carte.setView(pts[0], 12);
  }
  async function vueSecours() {
    const v = $('#v-secours'); if (!v) return;
    let d; let urg = null;
    try { [d, urg] = await Promise.all([api('GET', `/secours/prealertes?etablissement_id=${etat.ctx}`), api('GET', `/secours/urgence?etablissement_id=${etat.ctx}`).catch(() => null)]); }
    catch (e) { v.innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
    const ouvertes = d.prealertes.filter((p) => OUVERTES.includes(p.statut)); const closes = d.prealertes.filter((p) => !OUVERTES.includes(p.statut));
    // Nouvelle préalerte depuis le dernier affichage : son (si activé sur ce poste)
    const nouvelles = ouvertes.filter((p) => !etatS.vues.has(p.id));
    if (etatS.donnees && nouvelles.length && son()) bip();
    ouvertes.forEach((p) => etatS.vues.add(p.id));
    etatS.donnees = d;
    const e = etabCtx();
    v.innerHTML = `<div class="entete"><div><h2>${S('titre', { etab: e?.nom || '' })}</h2><p>${S('intro')}</p></div>
        <div class="actions"><button class="btn" type="button" id="ls-og"><img src="og-robot.svg" alt="" width="20" height="20" style="vertical-align:middle;margin-right:6px">${S('og')}</button></div></div>
      <p class="note">${S('regle')}</p>
      ${urg ? panneauUrgence(urg) : ''}
      <div class="chips" role="group"><button class="chip" type="button" data-ls-vue="liste" aria-pressed="${etatS.affichage === 'liste'}">${S('liste')}</button><button class="chip" type="button" data-ls-vue="carte" aria-pressed="${etatS.affichage === 'carte'}">${S('carte')}</button>
        <label class="case" style="margin-left:12px"><input type="checkbox" id="ls-son"${son() ? ' checked' : ''}> ${S('son')}</label></div>
      ${etatS.affichage === 'carte' ? '<div id="ls-carte" style="height:420px;border-radius:12px;margin:12px 0"></div>' : ''}
      <div class="liste">${ouvertes.map(carteP).join('') || `<p class="note">${S('aucune')}</p>`}</div>
      ${closes.length ? `<details><summary class="note">${S('historique')} (${closes.length})</summary><div class="liste">${closes.map(carteP).join('')}</div></details>` : ''}`;
    if (etatS.affichage === 'carte') dessinerCarte(v, ouvertes).catch(() => {});
    const compteur = $('#n-secours'); if (compteur) { const n = ouvertes.filter((p) => !p.prise_en_compte_le).length; compteur.textContent = n; compteur.hidden = !n; }
    brancher(v);
  }
  function brancher(v) {
    v.querySelectorAll('[data-ls-urg]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', '/secours/urgence', { etablissement_id: etat.ctx, statut: b.dataset.lsUrg }), t('liaison_secours.ok')); });
    v.querySelectorAll('[data-ls-vue]').forEach((b) => { b.onclick = () => { etatS.affichage = b.dataset.lsVue; ls.ecrire('arrimo-secours-affichage', etatS.affichage); vueSecours(); }; });
    const caseSon = v.querySelector('#ls-son'); if (caseSon) caseSon.onchange = () => { ls.ecrire('arrimo-secours-son', caseSon.checked ? '1' : null); if (caseSon.checked) bip(); };
    const og = v.querySelector('#ls-og');
    if (og) og.onclick = () => {
      $('#og-open')?.click();
      const champ = $('#og-question'); if (!champ) return;
      champ.value = t('liaison_secours.og_question');
      $('#og-form')?.requestSubmit();
    };
    v.querySelectorAll('[data-ls]').forEach((b) => { b.onclick = async () => {
      const p = etatS.donnees.prealertes.find((x) => String(x.id) === b.dataset.id); if (!p) return;
      const a = b.dataset.ls;
      const action = (corps = {}) => api('POST', `/secours/prealertes/${p.id}/action`, { etablissement_id: etat.ctx, version: p.version, action: a, ...corps });
      if (a === 'details') {
        const f = await api('GET', `/secours/prealertes/${p.id}?etablissement_id=${etat.ctx}`);
        modale(p.numero, `<ol class="ch-historique">${f.evenements.map((ev) => `<li><span class="note num">${esc(heure(ev.cree_le))}</span> ${S(`ev_${ev.type}`)}${ev.par ? ` · ${esc(ev.par)}` : ''}${ev.detail?.unite_vue ? ` · ${esc(ev.detail.unite_vue)}` : ''}</li>`).join('')}</ol>`, [{ label: t('general.fermer') }]);
        return vueSecours();
      }
      if (a === 'confirmer_vehicule') {
        return modale(t('liaison_secours.vehicule_titre'), `<p class="note">${S('vehicule_aide', { numero: p.unite, plaque: p.plaque || '—' })}</p><div class="champ"><label class="lbl" for="ls-unite">${S('vehicule_champ')}</label><input id="ls-unite" maxlength="40" autocomplete="off"></div>`,
          [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => {
            const r = await agir(null, () => action({ unite_numero: $('#ls-unite').value }));
            if (r && r.correspond === false) toast(t('liaison_secours.vehicule_non', { numero: r.unite_attendue }), true); else if (r) toast(t('liaison_secours.vehicule_ok'));
            return r !== null;
          } }]);
      }
      if (a === 'modifier_service') {
        const services = await api('GET', `/secours/services?etablissement_id=${etat.ctx}`);
        return modale(t('liaison_secours.modifier_titre'), `<div class="champ"><label class="lbl" for="ls-sv">${S('service_champ')}</label><select id="ls-sv">${services.map((x) => `<option value="${x.id}"${x.id === (p.service_confirme_id || p.service_propose_id) ? ' selected' : ''}>${esc(x.nom)}</option>`).join('')}</select></div>`,
          [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => (await agir(null, () => action({ service_id: Number($('#ls-sv').value) }), t('liaison_secours.ok'))) !== null }]);
      }
      if (a === 'signaler_probleme') {
        return modale(t('liaison_secours.probleme_titre'), `<div class="champ"><label class="lbl" for="ls-pb">${S('probleme_champ')}</label><select id="ls-pb">${['information_manquante', 'capacite_limitee', 'autre'].map((x) => `<option value="${x}">${S(`probleme_${x}`)}</option>`).join('')}</select></div>`,
          [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => { const r = await agir(null, () => action({ probleme: $('#ls-pb').value }), t('liaison_secours.ok')); return r !== null; } }]);
      }
      await agir(b, () => action(), t('liaison_secours.ok'));
    }; });
  }
  // Rafraîchissement de l'écran ouvert (toutes les 15 s, jamais pendant une saisie dans une fenêtre)
  setInterval(() => { if (etat.vue === 'secours' && etat.token && $('#modale')?.hidden !== false && document.visibilityState === 'visible') vueSecours(); }, 15000);
  window.ArrimoSecours = { vues: { secours: vueSecours } };
})();
