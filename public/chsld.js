/* Arrimo CHSLD — interface : accueil, résidents, chambres, demandes d'hébergement, admissions et sorties, tâches,
   réseau, transferts et hospitalisations, indicateurs. Toutes les règles sont appliquées par le serveur (src/chsld.js).
   Réutilise le socle de l'application (api, agir, modale, toast, t, esc, etat). */
(() => {
  const C = (k, v) => esc(t(`chsld.${k}`, v));
  const jour = (iso) => (iso ? new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
  const dateHeure = (iso) => (iso ? heure(iso) : '');
  const pastille = (cls, texte) => `<span class="ch-etat ch-${cls}">${esc(texte)}</span>`;
  const statutResident = (s) => pastille(s, t(`chsld.statut.${s}`));
  const gerer = () => ['coordonnateur', 'admin_etab', 'gestionnaire'].includes(etat.moi?.utilisateur?.role);
  const role = () => etat.moi?.utilisateur?.role;
  const tuile = (lib, val, cls = '') => `<div class="tuile ${cls}"><span class="lbl">${lib}</span><span class="v num">${esc(String(val ?? 0))}</span></div>`;
  const ctx = () => etat.ctx;
  const sel = (id, lib, options, choisi = '') => `<div class="champ"><label class="lbl" for="${id}">${lib}</label><select id="${id}">${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(choisi) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
  const champ = (id, lib, val = '', attrs = '') => `<div class="champ"><label class="lbl" for="${id}">${lib}</label><input id="${id}" value="${esc(val ?? '')}" ${attrs}></div>`;

  /* ------------------------------------------------------------------ Accueil */
  /* Messages des familles, en tête de l'accueil : lire et répondre sans passer par la fiche du résident */
  async function panneauMessagesFamilles(v) {
    if (!['coordonnateur', 'admin_etab', 'gestionnaire', 'equipe_soins'].includes(role())) return;
    const liste = await api('GET', `/famille/messages?etablissement_id=${ctx()}`).catch(() => null);
    if (!liste) return;
    const M = (k, x) => C(`messages_familles.${k}`, x); const nl = liste.filter((x) => x.non_lu).length;
    v.insertAdjacentHTML('afterbegin', `<section class="panneau-c" id="messages-familles"><h3>${M('titre')} ${nl ? `<span class="badge">${M('non_lus', { n: nl })}</span>` : ''}</h3>
      <div class="liste">${liste.slice(0, 15).map((m) => `<div class="item${m.non_lu ? ' non-lu' : ''}"><div><b>${esc(m.prenom)} ${esc(m.nom)}</b> (${esc(m.relation || '')}) · ${M('pour')} <b>${esc(m.r_prenom)} ${esc(m.r_nom)}</b> · <span class="num">${esc(m.resident_ref)}</span>
        <div class="note">${esc(t(`chsld.categorie.${m.categorie}`))} · ${esc(dateHeure(m.cree_le))}${m.non_lu ? ` · <b>${M('nouveau')}</b>` : ''}</div><p style="white-space:pre-wrap;margin:6px 0">${esc(m.texte)}</p></div>
        <div class="actions"><button class="btn pri" type="button" data-mf-rep="${m.id}">${M('repondre')}</button>${m.non_lu ? `<button class="btn" type="button" data-mf-lu="${m.id}">${M('marquer_lu')}</button>` : ''}<button class="btn" type="button" data-res="${m.resident_id}">${M('fiche')}</button></div></div>`).join('') || `<p class="note">${M('aucun')}</p>`}</div></section>`);
    v.querySelectorAll('[data-mf-lu]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/famille/messages/${b.dataset.mfLu}/lu`), t('chsld.actions.ok')); });
    v.querySelectorAll('#messages-familles [data-res]').forEach((b) => { b.onclick = () => { etat.chResident = Number(b.dataset.res); allerA('c-residents'); }; });
    v.querySelectorAll('[data-mf-rep]').forEach((b) => { b.onclick = () => { const m = liste.find((x) => String(x.id) === b.dataset.mfRep); if (!m) return;
      modale(M('repondre_a', { nom: `${m.prenom} ${m.nom}` }), `<p class="note">${esc(m.texte)}</p><div class="champ"><label class="lbl" for="mf-txt">${M('reponse')}</label><textarea id="mf-txt" maxlength="2000"></textarea></div>`,
        [{ label: t('general.annuler') }, { label: M('envoyer'), pri: true, run: async () => (await agir(null, () => api('POST', `/chsld/residents/${m.resident_id}/messages`, { contact_id: m.contact_id, categorie: m.categorie, texte: $('#mf-txt').value }), t('chsld.actions.ok'))) !== null }]); }; });
  }
  async function vueAccueil() {
    const v = $('#v-c-accueil');
    const a = await api('GET', `/chsld/accueil?etablissement_id=${ctx()}`);
    const p = a.places, r = a.residents;
    // Carte d'indicateur : fond légèrement teinté, bordure et icône de la famille (thème CHSLD)
    const kpi = (lib, val, ton, ic) => `<div class="ch-kpi ch-k-${ton}"><span class="ch-kpi-ic">${icone(ic)}</span><span class="lbl">${lib}</span><span class="v num">${esc(String(val ?? 0))}</span></div>`;
    const taux = p.dotees ? Math.round((p.occupees + p.conservees + p.reservees) / p.dotees * 100) : 0;
    const actions = a.alertes.map((x) => C(`accueil.alerte_${x.code}`, { n: x.n }));
    const lignesSup = `<p class="note" id="ch-accueil-sup">${C('accueil.a_nettoyer', { n: a.entretien.a_nettoyer })} · ${C('accueil.nettoyes_jour', { n: a.entretien.termines_jour })} · ${C('accueil.messages_familles', { n: a.familles.messages })} · ${C('accueil.visites_familles', { n: a.familles.visites })}</p>`;
    const raccourci = (vue, ic, lib) => `<button class="ch-raccourci" type="button" data-ch-aller="${vue}">${icone(ic)}<span>${lib}</span></button>`;
    v.innerHTML = `${lignesSup}<section class="ch-situation" aria-labelledby="ch-sit-titre">
        <div class="ch-situation-txt"><span class="ch-surtitre">${C('accueil.situation')}</span><h2 id="ch-sit-titre">${C('accueil.titre', { etab: a.etablissement.nom })}</h2><p>${C('accueil.intro')}</p></div>
        <div class="ch-situation-chiffres">
          <div><span class="v num">${taux} %</span><span class="lbl">${C('accueil.taux')}</span></div>
          <div><span class="v num">${esc(String(p.libres))}</span><span class="lbl">${C('accueil.libres')}</span></div>
          <div><span class="v num">${esc(String(r.present || 0))}</span><span class="lbl">${C('accueil.present')}</span></div>
          <div><span class="v num">${esc(String(r.hospitalise || 0))}</span><span class="lbl">${C('accueil.hospitalise')}</span></div>
        </div></section>
      <section class="panneau-c ch-actions" aria-labelledby="ch-act-titre"><h3 id="ch-act-titre">${icone('clipboard-check')}${C('accueil.alertes')}</h3>
        ${actions.length ? `<ul>${actions.map((x) => `<li>${x}</li>`).join('')}</ul>` : `<p class="note">${C('accueil.aucune_action')}</p>`}
        <p class="note">${C('accueil.taches', { n: a.taches.ouvertes })} · ${C('accueil.en_retard', { n: a.taches.en_retard })}</p></section>
      <h3 class="titre-section">${C('accueil.capacites')}</h3>
      <div class="ch-kpis">${kpi(C('accueil.dotees'), p.dotees, 'petrole', 'bed-double')}${kpi(C('accueil.libres'), p.libres, 'vert', 'check')}${kpi(C('accueil.reservees'), p.reservees, 'turquoise', 'log-in')}
        ${kpi(C('accueil.occupees'), p.occupees, 'bleu', 'house')}${kpi(C('accueil.conservees'), p.conservees, 'violet', 'shield-check')}${kpi(C('accueil.preparation'), p.preparation, 'ambre', 'spray-can')}${kpi(C('accueil.bloquees'), p.bloquees, 'rouge', 'x')}</div>
      <h3 class="titre-section">${C('accueil.residents')}</h3>
      <div class="ch-kpis">${kpi(C('accueil.present'), r.present, 'vert', 'users')}${kpi(C('accueil.hospitalise'), r.hospitalise, 'violet', 'ambulance')}${kpi(C('accueil.absent'), r.absent, 'petrole', 'clock')}
        ${kpi(C('accueil.preadmission'), r.preadmission, 'ambre', 'hourglass')}${kpi(C('accueil.transfert_en_cours'), r.transfert_en_cours, 'turquoise', 'arrow-right-left')}</div>
      <h3 class="titre-section">${C('accueil.mouvements')}</h3>
      <div class="deux"><div class="pile">
        <div class="panneau-c"><h3>${C('accueil.retours')}</h3>${a.retours.length ? `<ul class="liste-simple">${a.retours.map((x) => `<li><b>${esc(x.resident_ref)}</b> · ${esc(x.hopital)} · ${x.retour_prevu_le ? esc(dateHeure(x.retour_prevu_le)) : ''} · ${esc(t(`chsld.coord_statut.${x.statut}`))}</li>`).join('')}</ul>` : `<p class="note">${C('accueil.aucun_retour')}</p>`}</div>
        <div class="panneau-c"><h3>${C('accueil.coordinations')}</h3>${a.coordinations.length ? `<ul class="liste-simple">${a.coordinations.map((x) => `<li>${esc(t(`chsld.coord.type_${x.type}`))} · ${esc(t(x.entrante ? 'chsld.coord.entrantes' : 'chsld.coord.sortantes'))} · ${esc(t(`chsld.coord_statut.${x.statut}`))} : <b class="num">${x.n}</b></li>`).join('')}</ul>` : `<p class="note">${C('accueil.aucune_coordination')}</p>`}</div>
      </div><div class="pile">
        <div class="panneau-c"><h3>${C('accueil.aujourdhui')}</h3>${a.aujourdhui.length ? `<ul class="liste-simple">${a.aujourdhui.map((x) => `<li>${esc(t(`chsld.mvt.${x.type}`))} : <b class="num">${x.n}</b></li>`).join('')}</ul>` : `<p class="note">${C('accueil.aucun_mouvement')}</p>`}</div>
        <div class="panneau-c"><h3>${C('accueil.demandes')}</h3>${Object.keys(a.demandes).length ? `<ul class="liste-simple">${Object.entries(a.demandes).map(([s, n]) => `<li>${esc(t(`chsld.demande_statut.${s}`))} : <b class="num">${n}</b></li>`).join('')}</ul>` : `<p class="note">${C('demandes.aucune')}</p>`}</div>
      </div></div>
      <h3 class="titre-section">${C('accueil.raccourcis')}</h3>
      <div class="ch-raccourcis">${raccourci('c-residents', 'users', t('chsld.nav.residents'))}${raccourci('c-chambres', 'bed-double', t('chsld.nav.chambres'))}${raccourci('c-demandes', 'clipboard-list', t('chsld.nav.demandes'))}
        ${raccourci('c-taches', 'clipboard-check', t('chsld.nav.taches'))}${raccourci('c-mouvements', 'ambulance', t('chsld.nav.mouvements'))}<button class="ch-raccourci" type="button" data-ch-og>${icone('sparkles')}<span>${esc(window.ArrimoNomOg?.nom() || 'OG')}</span></button></div>`;
    panneauMessagesFamilles(v);
    v.querySelectorAll('[data-ch-aller]').forEach((b) => { b.onclick = () => allerA(b.dataset.chAller); });
    const og = v.querySelector('[data-ch-og]'); if (og) og.onclick = () => document.querySelector('#og-open')?.click();
  }

  /* ------------------------------------------------------------------ Résidents */
  async function vueResidents() {
    if (etat.chResident) return ficheResident(etat.chResident);
    const v = $('#v-c-residents');
    const q = etat.chRecherche || ''; const statut = etat.chStatut || 'actifs';
    const liste = await api('GET', `/chsld/residents?etablissement_id=${ctx()}&statut=${statut}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    v.innerHTML = `<div class="entete"><div><h2>${C('residents.titre')}</h2><p>${C('residents.intro')}</p></div>${gerer() ? `<button class="btn pri" id="ch-nouveau">${icone('plus')}${C('residents.nouveau')}</button>` : ''}</div>
      <div class="ligne filtres-acl">${champ('ch-q', C('residents.rechercher'), q, 'type="search" autocomplete="off"')}${sel('ch-statut', C('residents.statut'), [['actifs', t('chsld.residents.tous_statuts')], ['tous', t('chsld.residents.tous')]], statut)}</div>
      ${liste.length ? `<div class="tableau"><table><thead><tr><th>${C('residents.ref')}</th><th>${C('residents.nom')}</th><th>${C('residents.statut')}</th><th>${C('residents.place')}</th><th>${C('residents.contacts')}</th></tr></thead><tbody>
        ${liste.map((r) => `<tr><td class="num">${esc(r.reference)}</td><td><button class="lien" data-res="${r.id}">${esc(r.prenom)} ${esc(r.nom)}</button>${r.nom_usage ? `<div class="note">« ${esc(r.nom_usage)} »</div>` : ''}<div class="note">${C('residents.ne_le', { date: jour(r.date_naissance) })}</div></td>
          <td>${statutResident(r.statut)}</td><td>${r.lit ? `${esc(r.unite)} · ${esc(r.lit)}` : '—'}</td><td class="num">${r.contacts}</td></tr>`).join('')}</tbody></table></div>` : `<p class="vide">${C('residents.aucun')}</p>`}`;
    let minuteur;
    $('#ch-q').oninput = (e) => { clearTimeout(minuteur); minuteur = setTimeout(() => { etat.chRecherche = e.target.value.trim(); rafraichir(); }, 350); };
    $('#ch-statut').onchange = (e) => { etat.chStatut = e.target.value; rafraichir(); };
    v.querySelectorAll('[data-res]').forEach((b) => { b.onclick = () => { etat.chResident = Number(b.dataset.res); rafraichir(); }; });
    if ($('#ch-nouveau')) $('#ch-nouveau').onclick = () => formulaireNouveauResident();
  }
  const optionsRelation = () => ['fille', 'fils', 'conjoint', 'soeur', 'frere', 'parent', 'petit_enfant', 'ami', 'voisin', 'tuteur', 'autre'].map((r) => [r, t(`chsld.relation.${r}`)]);
  const CATS = ['administratif', 'hebergement', 'rendez_vous', 'mouvements'];
  function blocContact(i, k = {}) {
    return `<fieldset class="ch-contact" data-contact="${i}"><legend>${C('contact.secondaire', { n: i + 1 })}</legend><div class="ligne">
      ${champ(`k-prenom-${i}`, C('contact.prenom'), k.prenom)}${champ(`k-nom-${i}`, C('contact.nom'), k.nom)}${sel(`k-relation-${i}`, C('contact.relation'), optionsRelation(), k.relation || 'fille')}</div>
      <div class="ligne">${champ(`k-tel-${i}`, C('fiche.telephone'), k.telephone, 'inputmode="tel"')}${champ(`k-courriel-${i}`, C('fiche.courriel'), k.courriel, 'type="email"')}${champ(`k-rang-${i}`, C('contact.rang'), k.rang || i + 1, 'type="number" min="1" max="20"')}</div>
      <div class="cases"><label class="case"><input type="checkbox" id="k-principal-${i}"${k.principal || (!k.id && i === 0) ? ' checked' : ''}> ${C('contact.principal')}</label>
        <label class="case"><input type="checkbox" id="k-urgence-${i}"${k.contact_urgence !== false ? ' checked' : ''}> ${C('contact.urgence')}</label>
        <label class="case"><input type="checkbox" id="k-aidant-${i}"${k.proche_aidant ? ' checked' : ''}> ${C('contact.aidant')}</label>
        <label class="case"><input type="checkbox" id="k-rep-${i}"${k.representant_legal ? ' checked' : ''}> ${C('contact.representant')}</label></div>
      <p class="lbl">${C('contact.autorisations')}</p><div class="cases">${CATS.map((c) => `<label class="case"><input type="checkbox" data-k-auto="${i}" value="${c}"${(k.autorisations || []).includes(c) ? ' checked' : ''}> ${C(`categorie.${c}`)}</label>`).join('')}</div>
      ${champ(`k-dispo-${i}`, C('contact.disponibilites'), k.disponibilites)}</fieldset>`;
  }
  const lireContact = (i) => ({ prenom: $(`#k-prenom-${i}`).value, nom: $(`#k-nom-${i}`).value, relation: $(`#k-relation-${i}`).value, telephone: $(`#k-tel-${i}`).value || null,
    courriel: $(`#k-courriel-${i}`).value || null, rang: Number($(`#k-rang-${i}`).value) || i + 1, principal: $(`#k-principal-${i}`).checked, contact_urgence: $(`#k-urgence-${i}`).checked,
    proche_aidant: $(`#k-aidant-${i}`).checked, representant_legal: $(`#k-rep-${i}`).checked, autorisations: [...document.querySelectorAll(`[data-k-auto="${i}"]:checked`)].map((x) => x.value),
    disponibilites: $(`#k-dispo-${i}`).value || null });
  /** Enregistrer un nouveau résident : identité, accueil, contacts multiples ; doublon signalé, confirmation explicite pour un dossier distinct. */
  function formulaireNouveauResident(prefill = {}) {
    let n = Math.max(1, (prefill.contacts || []).length);
    const corps = `<p class="note">${C('nouveau.verifier')}</p><h4>${C('nouveau.identite')}</h4>
      <div class="ligne">${champ('n-prenom', C('nouveau.prenom'), prefill.prenom)}${champ('n-nom', C('nouveau.nom'), prefill.nom)}${champ('n-dn', C('nouveau.date_naissance'), prefill.date_naissance, 'type="date"')}</div>
      <div class="ligne">${champ('n-usage', C('fiche.nom_usage'))}${champ('n-dossier', C('fiche.dossier_officiel'))}${sel('n-langue', C('fiche.langue'), ['fr', 'en', 'autre'].map((l) => [l, t(`chsld.langue.${l}`)]))}</div>
      <h4>${C('nouveau.accueil')}</h4><div class="ligne">${champ('n-arrivee', C('fiche.arrivee_prevue'), '', 'type="date"')}</div>
      <p class="lbl">${C('fiche.accessibilite')}</p><div class="cases">${['fauteuil', 'deambulateur', 'leve_personne', 'lit_electrique', 'malentendant', 'malvoyant'].map((a) => `<label class="case"><input type="checkbox" data-n-acces value="${a}"> ${C(`acces.${a}`)}</label>`).join('')}</div>
      <h4>${C('nouveau.contacts')}</h4><p class="note">${C('contact.note')}</p><div id="n-contacts">${Array.from({ length: n }, (_, i) => blocContact(i, (prefill.contacts || [])[i])).join('')}</div>
      <button type="button" class="btn" id="n-ajouter">${icone('plus')}${C('nouveau.ajouter_contact')}</button>
      <label class="case" id="n-doublon-zone" hidden><input type="checkbox" id="n-doublon"> ${C('nouveau.confirmer_doublon')}</label>`;
    modale(t('chsld.nouveau.titre'), corps, [{ label: t('general.annuler') }, { label: t('chsld.nouveau.creer'), pri: true, run: async () => {
      const contacts = []; for (let i = 0; i < n; i += 1) { const k = lireContact(i); if (k.prenom || k.nom) contacts.push(k); }
      try {
        const r = await api('POST', '/chsld/residents', { etablissement_id: ctx(), prenom: $('#n-prenom').value, nom: $('#n-nom').value, date_naissance: $('#n-dn').value,
          nom_usage: $('#n-usage').value, dossier_officiel: $('#n-dossier').value, langue: $('#n-langue').value, arrivee_prevue: $('#n-arrivee').value || null,
          accessibilite: [...document.querySelectorAll('[data-n-acces]:checked')].map((x) => x.value), contacts, confirmer_doublon: $('#n-doublon').checked });
        toast(t('chsld.nouveau.cree', { ref: r.reference })); etat.chResident = r.id; rafraichir(); return true;
      } catch (e) { toast(e.message, true); if (e.code === 'resident_doublon_possible') $('#n-doublon-zone').hidden = false; return false; }
    } }]);
    $('#modale .boite').classList.add('large');
    $('#n-ajouter').onclick = () => { $('#n-contacts').insertAdjacentHTML('beforeend', blocContact(n)); n += 1; };
  }
  window.ArrimoChsldNouveauResident = formulaireNouveauResident;

  /* Évaluations FICTIVES : démonstration seulement, personnel de soins et coordination. */
  const peutEvaluer = () => etat.moi.demo && ['equipe_soins', 'coordonnateur'].includes(role());
  const evalHTML = (e) => `<dl class="ch-eval">${[['pathologies', e.pathologies], ['symptomes', e.symptomes], ['besoins', e.besoins], ['contraintes', e.contraintes_hebergement], ['equipements', e.equipements]].filter(([, x]) => x).map(([k, x]) => `<dt>${C(`evaluation.${k}`)}</dt><dd>${esc(x)}</dd>`).join('')}${e.precautions?.length ? `<dt>${C('evaluation.precautions')}</dt><dd>${e.precautions.map((x) => esc(t(`nettoyage.p_${x}`))).join(', ')}</dd>` : ''}</dl>`;
  async function panneauEvaluations(v, r) {
    if (!peutEvaluer()) return;
    let liste = [];
    try { liste = await api('GET', `/evaluations-fictives?etablissement_id=${ctx()}&reference=${encodeURIComponent(r.reference)}`); } catch (e) {
      if (e.code === 'clinique_inactive' && role() === 'coordonnateur') { v.insertAdjacentHTML('beforeend', `<section class="panneau-c" id="evaluations-fictives"><p class="note">${C('evaluation.aide')}</p><button class="btn" id="eval-activer">${C('evaluation.activer')}</button></section>`); $('#eval-activer').onclick = (ev) => agir(ev.currentTarget, () => api('PUT', '/evaluations-fictives/activation', { etablissement_id: ctx(), actif: true }), t('chsld.actions.ok')); }
      return;
    }
    v.insertAdjacentHTML('beforeend', `<section class="panneau-c" id="evaluations-fictives"><h3>${C('evaluation.titre')}</h3><p class="note">${C('evaluation.aide')}</p>
      <div class="liste">${liste.map((e) => `<div class="item"><div>${pastille(e.statut === 'validee' ? 'recue' : 'envoyee', C(`evaluation.st_${e.statut}`))} <span class="note">${esc(dateHeure(e.cree_le))} · ${esc(e.auteur_nom || '')}</span>${evalHTML(e)}</div>${e.statut === 'a_valider' ? `<button class="btn" data-eval-valider="${e.id}">${C('evaluation.valider')}</button>` : ''}</div>`).join('') || `<p class="note">${C('evaluation.aucune')}</p>`}</div>
      <form id="eval-form"><div class="champ"><label class="lbl" for="ev-pat">${C('evaluation.pathologies')}</label><textarea id="ev-pat" maxlength="1000"></textarea></div><div class="champ"><label class="lbl" for="ev-sym">${C('evaluation.symptomes')}</label><textarea id="ev-sym" maxlength="1000"></textarea></div>
      <div class="champ"><label class="lbl" for="ev-bes">${C('evaluation.besoins')}</label><input id="ev-bes" maxlength="500"></div><div class="champ"><label class="lbl" for="ev-con">${C('evaluation.contraintes')}</label><input id="ev-con" maxlength="500"></div><div class="champ"><label class="lbl" for="ev-equ">${C('evaluation.equipements')}</label><input id="ev-equ" maxlength="500"></div>
      <fieldset><legend class="lbl">${C('evaluation.precautions')}</legend>${['contact', 'gouttelettes', 'aerien'].map((x) => `<label class="case"><input type="checkbox" data-ev-prec="${x}"> ${esc(t(`nettoyage.p_${x}`))}</label>`).join(' ')}</fieldset>
      <button class="btn pri" type="submit">${C('evaluation.ajouter')}</button></form></section>`);
    $('#eval-form').onsubmit = (e) => { e.preventDefault(); agir(e.submitter, () => api('POST', '/evaluations-fictives', { etablissement_id: ctx(), reference: r.reference, pathologies: $('#ev-pat').value, symptomes: $('#ev-sym').value, besoins: $('#ev-bes').value, contraintes_hebergement: $('#ev-con').value, equipements: $('#ev-equ').value, precautions: [...document.querySelectorAll('[data-ev-prec]:checked')].map((x) => x.dataset.evPrec) }), t('chsld.actions.ok')); };
    v.querySelectorAll('[data-eval-valider]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/evaluations-fictives/${b.dataset.evalValider}/valider`), t('chsld.actions.ok')); });
  }
  async function ficheResident(id) {
    const v = $('#v-c-residents');
    let f; try { f = await api('GET', `/chsld/residents/${id}`); } catch (e) { etat.chResident = null; throw e; }
    const r = f.resident; const g = gerer();
    const portail = await api('GET', `/chsld/residents/${id}/portail`).catch(() => null);
    const ligneId = (k, val) => (val ? `<dt>${C(`fiche.${k}`)}</dt><dd>${esc(val)}</dd>` : '');
    const ri = f.reintegration;
    const loc = (f.localisation ? `<p class="ch-loc">${C('fiche.localisation', { etat: t(f.localisation.confirmee ? 'chsld.fiche.loc_confirmee' : 'chsld.fiche.loc_envoyee'), hopital: f.localisation.hopital, numero: f.localisation.numero })}</p>` : '')
      + (ri ? `<p class="ch-loc">${ri.conservee ? C('reint.conservee', { lit: ri.lit.code }) : ''} ${ri.pret ? `<b>${C('reint.pret')}</b>` : ri.raisons.map((x) => C(`reint.r_${x}`)).join(' · ')}</p>` : '');
    const actions = [];
    if (g && r.statut === 'preadmission' && !r.lit_id) actions.push(['reserver', 'reserver-place']);
    if (g && r.statut === 'preadmission' && r.lit_id) actions.push(['arrivee', 'arrivee']);
    if (g && r.statut === 'present') actions.push(['changer', 'changer-chambre'], ['transfert', 'transfert-chsld']);
    if ((g || role() === 'equipe_soins') && ['present', 'absent'].includes(r.statut)) actions.push(['hospitalisation', 'hospitalisation']);
    if ((g || role() === 'equipe_soins') && r.statut === 'present') actions.push(['absence', 'absence']);
    if ((g || role() === 'equipe_soins') && r.statut === 'absent') actions.push(['fin_absence', 'fin-absence']);
    if (g && ['present', 'absent', 'hospitalise', 'preadmission'].includes(r.statut)) actions.push(['sortie', 'sortie']);
    if (g && r.statut === 'hospitalise' && r.lit_id) actions.push(['liberer_place', 'liberer-place']);
    v.innerHTML = `<div class="entete"><div><button class="btn discret" id="ch-retour">← ${C('fiche.retour')}</button>
        <h2>${esc(r.prenom)} ${esc(r.nom)} <span class="note num">${esc(r.reference)}</span></h2><p>${statutResident(r.statut)} · ${C('residents.ne_le', { date: jour(r.date_naissance) })}</p>${loc}</div>
        <div class="actions">${actions.map(([k, a]) => `<button class="btn${['arrivee', 'reserver'].includes(k) ? ' pri' : ''}" data-ch-action="${a}">${C(`actions.${k}`)}</button>`).join('')}</div></div>
      <div class="deux"><div class="pile">
        <div class="panneau-c"><h3>${C('fiche.hebergement')}</h3>${f.lit ? `<p><b>${esc(f.lit.unite)}</b> · ${C('residents.chambre')} ${esc(f.lit.chambre)} · ${esc(f.lit.code)} ${pastille(f.lit.etat, t(`chsld.chambres.${f.lit.etat === 'occupe' && r.statut !== 'present' ? 'conservee' : f.lit.etat}`))}</p>` : `<p class="note">${C('fiche.aucune_place')}</p>`}
          ${r.admis_le ? `<p class="note">${C('fiche.admis_le')} ${esc(dateHeure(r.admis_le))}</p>` : r.arrivee_prevue ? `<p class="note">${C('fiche.arrivee_prevue')} : ${esc(jour(r.arrivee_prevue))}</p>` : ''}</div>
        <div class="panneau-c"><div class="entete-panneau"><h3>${C('fiche.identite')}</h3>${g ? `<button class="btn" id="ch-modifier">${C('fiche.modifier')}</button>` : ''}</div>
          <dl class="ch-dl">${ligneId('reference', r.reference)}${ligneId('nom_usage', r.nom_usage)}${ligneId('dossier_officiel', r.dossier_officiel)}${ligneId('langue', t(`chsld.langue.${r.langue}`))}
            ${ligneId('telephone', r.telephone)}${ligneId('courriel', r.courriel)}${ligneId('adresse_precedente', r.adresse_precedente)}
            ${r.accessibilite?.length ? `<dt>${C('fiche.accessibilite')}</dt><dd>${r.accessibilite.map((a) => C(`acces.${a}`)).join(', ')}</dd>` : ''}</dl></div>
        <div class="panneau-c"><div class="entete-panneau"><h3>${C('fiche.contacts')}</h3>${g ? `<button class="btn" id="ch-ajout-contact">${icone('plus')}${C('contact.ajouter')}</button>` : ''}</div><p class="note">${C('contact.note')}</p>
          ${f.contacts.length ? f.contacts.map((k) => `<div class="item ch-contact-item"><div><b>${esc(k.prenom)} ${esc(k.nom)}</b> · ${C(`relation.${k.relation}`)} ${k.principal ? `<span class="badge fort">${C('contact.principal')}</span>` : `<span class="badge">${C('contact.secondaire', { n: k.rang })}</span>`}
            <div class="note">${[k.telephone, k.courriel].filter(Boolean).map(esc).join(' · ')}${k.disponibilites ? ` · ${esc(k.disponibilites)}` : ''}</div>
            <div class="note">${[k.contact_urgence ? t('chsld.contact.urgence') : null, k.proche_aidant ? t('chsld.contact.aidant') : null, k.representant_legal ? `${t('chsld.contact.representant')} (${t(k.representant_verifie_le ? 'chsld.contact.verifie' : 'chsld.contact.a_verifier')})` : null].filter(Boolean).map(esc).join(' · ')}</div>
            <div class="note">${C('contact.autorisations')} : ${k.autorisations.length ? k.autorisations.map((c) => C(`categorie.${c}`)).join(', ') : C('contact.aucune_autorisation')}</div></div>
            ${g ? `<div class="actions">${k.representant_legal && !k.representant_verifie_le ? `<button class="btn" data-verif="${k.id}">${C('contact.verifier')}</button>` : ''}<button class="btn" data-modif-contact="${k.id}">${C('contact.modifier')}</button><button class="btn dan" data-retirer="${k.id}" data-version="${k.version}">${C('contact.retirer')}</button></div>` : ''}</div>`).join('') : `<p class="note">${C('fiche.aucun')}</p>`}</div>
      </div><div class="pile">
        <div class="panneau-c"><h3>${C('fiche.coordinations')}</h3>${f.coordinations.length ? `<ul class="liste-simple">${f.coordinations.map((c) => `<li><b class="num">${esc(c.numero)}</b> · ${C(`coord.type_${c.type}`)} · ${esc(c.origine)} → ${esc(c.destination)} · ${esc(t(`chsld.coord_statut.${c.statut}`))}${c.incident ? ` · ${C(`coord.incident_${c.incident}`)}` : ''}</li>`).join('')}</ul>` : `<p class="note">${C('fiche.aucun')}</p>`}</div>
        <div class="panneau-c"><div class="entete-panneau"><h3>${C('fiche.communications')}</h3>${f.contacts.length ? `<button class="btn" id="ch-com">${C('communication.nouvelle')}</button>` : ''}</div>
          ${f.communications.length ? `<ul class="liste-simple">${f.communications.map((c) => `<li>${C(`com_type.${c.type}`)} · ${esc(c.contact)} (${C(`relation.${c.relation}`)}) · ${C(`categorie.${c.categorie}`)} — ${esc(c.sujet)} · ${esc(t(`chsld.tache_statut.${c.statut === 'fait' ? 'faite' : c.statut === 'annule' ? 'annulee' : 'a_faire'}`))}${c.statut === 'a_faire' ? ` <button class="btn" data-com-fait="${c.id}">${C('communication.marquer_fait')}</button>` : ''}</li>`).join('')}</ul>` : `<p class="note">${C('fiche.aucun')}</p>`}</div>
        ${portail?.module_actif ? panneauPortail(f, portail, g) : ''}
        <div class="panneau-c"><h3>${C('fiche.taches')}</h3>${f.taches.length ? `<ul class="liste-simple">${f.taches.map((x) => `<li>${C(`tache_type.${x.type}`)} · ${esc(x.titre)} · ${esc(t(`chsld.tache_statut.${x.statut}`))}</li>`).join('')}</ul>` : `<p class="note">${C('fiche.aucun')}</p>`}</div>
        <div class="panneau-c"><h3>${C('fiche.mouvements')}</h3>${f.mouvements.length ? `<ol class="ch-historique">${f.mouvements.map((m) => `<li><span class="note num">${esc(dateHeure(m.date))}</span> <b>${C(`mvt.${m.type}`)}</b>${m.de_lit || m.vers_lit ? ` · ${esc([m.de_lit, m.vers_lit].filter(Boolean).join(' → '))}` : ''}${m.autre_etablissement ? ` · ${esc(m.autre_etablissement)}` : ''}${m.detail ? `<div class="note">${esc(m.detail)}</div>` : ''}</li>`).join('')}</ol>` : `<p class="note">${C('fiche.aucun')}</p>`}</div>
      </div></div>`;
    panneauEvaluations(v, r);
    $('#ch-retour').onclick = () => { etat.chResident = null; rafraichir(); };
    v.querySelectorAll('[data-ch-action]').forEach((b) => { b.onclick = () => actionResident(b.dataset.chAction, r, f); });
    if ($('#ch-modifier')) $('#ch-modifier').onclick = () => modifierIdentite(r);
    if ($('#ch-ajout-contact')) $('#ch-ajout-contact').onclick = () => editerContact(r, null, f.contacts.length);
    v.querySelectorAll('[data-modif-contact]').forEach((b) => { b.onclick = () => editerContact(r, f.contacts.find((k) => k.id === Number(b.dataset.modifContact)), 0); });
    v.querySelectorAll('[data-retirer]').forEach((b) => { b.onclick = () => { if (window.confirm(t('chsld.contact.confirmer_retrait'))) agir(b, () => api('PUT', `/chsld/contacts/${b.dataset.retirer}`, { actif: false, version: Number(b.dataset.version) }), t('chsld.contact.retire')); }; });
    v.querySelectorAll('[data-verif]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/chsld/contacts/${b.dataset.verif}/verifier-representant`), t('chsld.actions.ok')); });
    v.querySelectorAll('[data-com-fait]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/chsld/communications/${b.dataset.comFait}/statut`, { statut: 'fait' }), t('chsld.actions.ok')); });
    if ($('#ch-com')) $('#ch-com').onclick = () => nouvelleCommunication(r, f.contacts);
    v.querySelectorAll('[data-inviter]').forEach((b) => { b.onclick = async () => { b.disabled = true; try { const a = await api('POST', `/chsld/contacts/${b.dataset.inviter}/acces-portail`, {});
      modale(t('chsld.portail.inviter'), `<p>${C('portail.lien')}</p><p><code class="ch-lien">${esc(location.origin + a.lien)}</code></p>`, [{ label: t('general.fermer'), pri: true }]); rafraichir(); } catch (e) { toast(e.message, true); b.disabled = false; } }; });
    v.querySelectorAll('[data-revoquer]').forEach((b) => { b.onclick = () => { if (window.confirm(t('chsld.portail.confirmer_revocation'))) agir(b, () => api('POST', `/chsld/acces-portail/${b.dataset.revoquer}/revoquer`), t('chsld.actions.ok')); }; });
    v.querySelectorAll('[data-repondre]').forEach((b) => { b.onclick = () => { const k = f.contacts.find((x) => x.id === Number(b.dataset.repondre));
      modale(t('chsld.portail.repondre'), `${sel('pm-cat', C('communication.categorie'), k.autorisations.map((c) => [c, t(`chsld.categorie.${c}`)]))}<div class="champ"><label class="lbl" for="pm-txt">${C('communication.sujet')}</label><textarea id="pm-txt" maxlength="2000"></textarea></div>`,
        [{ label: t('general.annuler') }, { label: t('general.enregistrer'), pri: true, run: async () => (await agir(null, () => api('POST', `/chsld/residents/${r.id}/messages`, { contact_id: k.id, categorie: $('#pm-cat').value, texte: $('#pm-txt').value }), t('chsld.portail.envoye'))) !== null || false }]); }; });
  }
  /** Portail des proches : accès par contact (inviter, révoquer) et fil des messages. */
  function panneauPortail(f, p, g) {
    const etatAcces = (a) => (a.revoque_le ? C('portail.revoque') : a.actif ? `${C('portail.actif')}${a.expire_le ? ` · ${C('portail.expire_le', { date: jour(a.expire_le) })}` : ''}` : C('portail.attente'));
    return `<div class="panneau-c"><h3>${C('portail.titre')}</h3><p class="note">${C('portail.intro')}</p>
      ${f.contacts.map((k) => { const a = p.acces.find((x) => x.contact_id === k.id && !x.revoque_le); const fil = p.messages.filter((m) => m.contact_id === k.id);
        return `<div class="item"><div><b>${esc(k.prenom)} ${esc(k.nom)}</b> · ${C(`relation.${k.relation}`)} <span class="note">${a ? etatAcces(a) : ''}</span>
          ${fil.length ? `<ul class="liste-simple">${fil.slice(-5).map((m) => `<li><span class="note">${esc(dateHeure(m.cree_le))} · ${C(`categorie.${m.categorie}`)}</span> ${m.sens === 'proche' ? '←' : '→'} ${esc(m.texte)}</li>`).join('')}</ul>` : ''}</div>
          <div class="actions">${g && !a && k.courriel && k.autorisations.length ? `<button class="btn" data-inviter="${k.id}">${C('portail.inviter')}</button>` : ''}${g && a ? `<button class="btn dan" data-revoquer="${a.id}">${C('portail.revoquer')}</button>` : ''}
            ${k.autorisations.length ? `<button class="btn" data-repondre="${k.id}">${C('portail.repondre')}</button>` : ''}</div></div>`; }).join('')}
      <p class="note">${C('portail.conditions')}</p></div>`;
  }
  function modifierIdentite(r) {
    const d = (x) => (x ? String(x).slice(0, 10) : '');
    modale(t('chsld.fiche.identite'), `<div class="ligne">${champ('m-prenom', C('nouveau.prenom'), r.prenom)}${champ('m-nom', C('nouveau.nom'), r.nom)}${champ('m-dn', C('nouveau.date_naissance'), d(r.date_naissance), 'type="date"')}</div>
      <div class="ligne">${champ('m-usage', C('fiche.nom_usage'), r.nom_usage)}${champ('m-dossier', C('fiche.dossier_officiel'), r.dossier_officiel)}${sel('m-langue', C('fiche.langue'), ['fr', 'en', 'autre'].map((l) => [l, t(`chsld.langue.${l}`)]), r.langue)}</div>
      <div class="ligne">${champ('m-tel', C('fiche.telephone'), r.telephone)}${champ('m-courriel', C('fiche.courriel'), r.courriel)}${champ('m-arrivee', C('fiche.arrivee_prevue'), d(r.arrivee_prevue), 'type="date"')}</div>
      ${champ('m-adresse', C('fiche.adresse_precedente'), r.adresse_precedente)}
      <p class="lbl">${C('fiche.accessibilite')}</p><div class="cases">${['fauteuil', 'deambulateur', 'leve_personne', 'lit_electrique', 'malentendant', 'malvoyant'].map((a) => `<label class="case"><input type="checkbox" data-m-acces value="${a}"${(r.accessibilite || []).includes(a) ? ' checked' : ''}> ${C(`acces.${a}`)}</label>`).join('')}</div>`,
    [{ label: t('general.annuler') }, { label: t('chsld.fiche.enregistrer'), pri: true, run: async () => (await agir(null, () => api('PUT', `/chsld/residents/${r.id}`, { version: r.version, prenom: $('#m-prenom').value, nom: $('#m-nom').value,
      date_naissance: $('#m-dn').value, nom_usage: $('#m-usage').value, dossier_officiel: $('#m-dossier').value, langue: $('#m-langue').value, telephone: $('#m-tel').value, courriel: $('#m-courriel').value,
      arrivee_prevue: $('#m-arrivee').value || null, adresse_precedente: $('#m-adresse').value, accessibilite: [...document.querySelectorAll('[data-m-acces]:checked')].map((x) => x.value) }), t('chsld.fiche.identite_maj'))) !== null || false }]);
    $('#modale .boite').classList.add('large');
  }
  function editerContact(r, k, i) {
    modale(t(k ? 'chsld.contact.modifier' : 'chsld.contact.ajouter'), `<p class="note">${C('contact.note')}</p>${blocContact(i, k || {})}`,
      [{ label: t('general.annuler') }, { label: t('chsld.fiche.enregistrer'), pri: true, run: async () => {
        const corps = lireContact(i);
        return (await agir(null, () => (k ? api('PUT', `/chsld/contacts/${k.id}`, { ...corps, version: k.version }) : api('POST', `/chsld/residents/${r.id}/contacts`, corps)), t('chsld.contact.enregistre'))) !== null || false;
      } }]);
    $('#modale .boite').classList.add('large');
  }
  function nouvelleCommunication(r, contacts) {
    const majContacts = () => { const c = $('#cm-cat').value; const ok = contacts.filter((k) => k.autorisations.includes(c));
      $('#cm-contact').innerHTML = ok.map((k) => `<option value="${k.id}">${esc(k.prenom)} ${esc(k.nom)} · ${esc(t(`chsld.relation.${k.relation}`))}</option>`).join('');
      $('#cm-aucun').hidden = ok.length > 0; };
    modale(t('chsld.communication.nouvelle'), `<p class="note">${C('communication.note')}</p><div class="ligne">${sel('cm-cat', C('communication.categorie'), CATS.map((c) => [c, t(`chsld.categorie.${c}`)]))}
        ${sel('cm-type', C('communication.type'), ['rappel_demande', 'appel', 'message', 'rendez_vous'].map((x) => [x, t(`chsld.com_type.${x}`)]))}</div>
      <div class="champ"><label class="lbl" for="cm-contact">${C('communication.contact')}</label><select id="cm-contact"></select></div><p class="note" id="cm-aucun" hidden>${C('communication.aucun_autorise')}</p>
      ${champ('cm-sujet', C('communication.sujet'), '', 'maxlength="200"')}<div class="ligne">${champ('cm-prevu', C('communication.prevu'), '', 'type="datetime-local"')}<label class="case"><input type="checkbox" id="cm-fait"> ${C('communication.fait')}</label></div>`,
    [{ label: t('general.annuler') }, { label: t('chsld.fiche.enregistrer'), pri: true, run: async () => (await agir(null, () => api('POST', `/chsld/residents/${r.id}/communications`, { contact_id: Number($('#cm-contact').value),
      categorie: $('#cm-cat').value, type: $('#cm-type').value, sujet: $('#cm-sujet').value, prevu_le: $('#cm-prevu').value || null, fait: $('#cm-fait').checked }), t('chsld.communication.enregistree'))) !== null || false }]);
    $('#cm-cat').onchange = majContacts; majContacts();
  }
  async function placesLibres() { return (await api('GET', `/chsld/places?etablissement_id=${ctx()}`)).filter((p) => p.etat === 'libre'); }
  async function actionResident(a, r, f) {
    const ok = t('chsld.actions.ok');
    if (a === 'arrivee') return agir(null, () => api('POST', `/chsld/residents/${r.id}/arrivee`, { version: r.version }), ok);
    if (a === 'fin-absence') return agir(null, () => api('POST', `/chsld/residents/${r.id}/absence`, { version: r.version, fin: true }), ok);
    if (a === 'reserver-place' || a === 'changer-chambre') {
      const libres = await placesLibres();
      return modale(t(a === 'reserver-place' ? 'chsld.actions.reserver' : 'chsld.actions.changer'), libres.length ? sel('pl-lit', C('actions.choisir_place'), libres.map((p) => [p.id, `${p.unite} · ${t('chsld.residents.chambre')} ${p.chambre} · ${p.code}`])) : `<p>${C('actions.aucune_place')}</p>`,
        [{ label: t('general.annuler') }, ...(libres.length ? [{ label: t('general.confirmer'), pri: true, run: async () => { const p = libres.find((x) => x.id === Number($('#pl-lit').value));
          return (await agir(null, () => api('POST', `/chsld/residents/${r.id}/${a}`, { lit_id: p.id, version: p.version, version_resident: r.version }), ok)) !== null || false; } }] : [])]);
    }
    if (a === 'absence') return modale(t('chsld.actions.absence'), champ('ab-retour', C('actions.retour_prevu'), '', 'type="date"'), [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true,
      run: async () => (await agir(null, () => api('POST', `/chsld/residents/${r.id}/absence`, { version: r.version, retour_prevu: $('#ab-retour').value || null }), ok)) !== null || false }]);
    if (a === 'liberer-place') return modale(C('actions.liberer_place'), `<p class="note">${C('reint.liberer_aide')}</p>${champ('lp-motif', C('actions.motif'), '', 'maxlength="200"')}`,
      [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => (await agir(null, () => api('POST', `/chsld/residents/${r.id}/liberer-place`, { version: r.version, motif: $('#lp-motif').value }), ok)) !== null || false }]);
    if (a === 'sortie') return modale(t('chsld.actions.sortie'), sel('so-motif', C('actions.motif'), ['domicile', 'autre_milieu', 'deces', 'autre'].map((m) => [m, t(`chsld.actions.motif_${m}`)])),
      [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => (await agir(null, () => api('POST', `/chsld/residents/${r.id}/sortie`, { version: r.version, motif: $('#so-motif').value }), ok)) !== null || false }]);
    if (a === 'hospitalisation' || a === 'transfert-chsld') {
      const hosp = a === 'hospitalisation';
      const res = hosp ? { chsld: [], hopitaux: await api('GET', `/chsld/hopitaux?etablissement_id=${ctx()}`).catch(() => []) }
        : await api('GET', `/chsld/reseau?etablissement_id=${ctx()}`).catch(() => ({ chsld: [], hopitaux: [] }));
      // Identifiant d'envoi fixé à l'ouverture : un second clic ou un renvoi après coupure réseau rend la même demande.
      const cle = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
      const choix = hosp ? res.hopitaux.map((h) => [h.id, h.nom]) : [...new Map(res.chsld.map((x) => [x.id, [x.id, `${x.nom} · ${t('chsld.reseau.libres', { n: res.chsld.filter((y) => y.id === x.id).reduce((s, y) => s + y.libres, 0) })}`]])).values()];
      const servicesDe = (id) => (res.hopitaux.find((h) => h.id === Number(id))?.services || []).map((x) => [x.id, nomType(x)]);
      const formDepart = hosp ? `<div id="co-service-zone">${sel('co-service', C('depart.service'), [['', C('depart.sans_preference')], ...servicesDe(choix[0]?.[0])])}</div>
        ${sel('co-urgence', C('depart.urgence'), ['courante', 'prioritaire', 'immediate'].map((x) => [x, t(`chsld.depart.urgence_${x}`)]))}<p class="note">${C('depart.urgence_note')}</p>
        ${sel('co-transport', C('depart.transport'), [['', C('depart.sans_preference')], ...['ambulance', 'transport_adapte', 'autre'].map((x) => [x, t(`chsld.depart.transport_${x}`)])])}
        <fieldset class="ch-cases"><legend class="lbl">${C('depart.accessibilite')}</legend>${['fauteuil', 'deambulateur', 'leve_personne', 'lit_electrique', 'malentendant', 'malvoyant'].map((x) => `<label class="case"><input type="checkbox" data-co-acc="${x}"${(r.accessibilite || []).includes(x) ? ' checked' : ''}> ${esc(t(`chsld.acces.${x}`))}</label>`).join('')}</fieldset>
        <label class="case"><input type="checkbox" id="co-accompagnateur"> ${C('depart.accompagnateur')}</label>
        <p class="note">${C('depart.motif_note')}</p>` : '';
      const evaluationsValidees = hosp && peutEvaluer() ? (await api('GET', `/evaluations-fictives?etablissement_id=${ctx()}&reference=${encodeURIComponent(r.reference)}`).catch(() => [])).filter((e) => e.statut === 'validee') : [];
      const ouvrirForm = modale(t(hosp ? 'chsld.actions.hospitalisation' : 'chsld.actions.transfert'), `${sel('co-dest', C(hosp ? 'actions.hopital' : 'actions.destination'), choix)}${champ('co-motif', C('actions.motif_admin'), '', 'maxlength="200"')}${formDepart}
        ${hosp && evaluationsValidees.length ? `<label class="case"><input type="checkbox" id="co-eval" value="${evaluationsValidees[0].id}"> ${C('evaluation.transmettre')}</label>` : ''}
        ${hosp ? `<label class="case"><input type="checkbox" id="co-id"> ${C('actions.identite_verifiee')}</label>` : `<p class="note">${C('actions.non_garantie')}</p>`}`,
      [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => (await agir(null, () => api('POST', `/chsld/residents/${r.id}/${a}`, hosp
        ? { ...($('#co-eval')?.checked ? { evaluation_id: Number($('#co-eval').value) } : {}), hopital_id: Number($('#co-dest').value), motif_admin: $('#co-motif').value, identite_verifiee: $('#co-id').checked, version: r.version, cle, urgence_declaree: $('#co-urgence').value, service_souhaite_id: Number($('#co-service').value) || null,
            infos_operationnelles: { accessibilite: [...document.querySelectorAll('[data-co-acc]:checked')].map((x) => x.dataset.coAcc), transport: $('#co-transport').value || null, accompagnateur: $('#co-accompagnateur').checked, langue: r.langue } }
        : { destination_id: Number($('#co-dest').value), motif_admin: $('#co-motif').value, version: r.version }), ok)) !== null || false }]);
      if (hosp) $('#co-dest').onchange = () => { $('#co-service-zone').innerHTML = sel('co-service', C('depart.service'), [['', C('depart.sans_preference')], ...servicesDe($('#co-dest').value)]); };
      return ouvrirForm;
    }
    return null;
  }

  /* ------------------------------------------------------------------ Chambres et lits */
  async function vueChambres() {
    const v = $('#v-c-chambres');
    const places = await api('GET', `/chsld/places?etablissement_id=${ctx()}`);
    const unites = [...new Set(places.map((p) => p.unite))];
    const cle = (p) => (p.etat === 'occupe' && p.resident_statut && p.resident_statut !== 'present' ? 'conservee' : p.etat);
    const ent = (p) => (p.entretien && p.entretien !== 'propre' ? ` ${pastille('nettoyage', t(`chsld.entretien.${p.entretien}`))}` : '');
    v.innerHTML = `<div class="entete"><div><h2>${C('chambres.titre')}</h2><p>${C('chambres.intro')}</p></div></div>
      <div class="ch-legende">${['libre', 'reserve', 'occupe', 'conservee', 'nettoyage', 'indispo'].map((k) => `${pastille(k, t(`chsld.chambres.${k}`))} <b class="num">${places.filter((p) => cle(p) === k).length}</b>`).join(' ')}</div>
      ${unites.map((u) => { const ps = places.filter((p) => p.unite === u); return `<h3 class="titre-section">${esc(u)} <span class="note">${esc(ps[0].type_unite)}</span></h3>
        <div class="ch-places">${ps.map((p) => `<div class="ch-place ch-p-${cle(p)}"><div class="ch-place-tete"><b class="num">${esc(p.code)}</b>${pastille(cle(p), t(`chsld.chambres.${cle(p)}`))}${ent(p)}</div>
          <div class="note">${C('residents.chambre')} ${esc(p.chambre)}${p.type_chambre ? ` · ${esc(p.type_chambre)}` : ''} · ${C('chambres.depuis', { duree: depuis(p.etat_depuis) })}</div>
          ${p.resident_ref ? `<div>${p.resident_nom ? `<button class="lien" data-res="${p.resident_id}">${esc(p.resident_nom)}</button> ` : ''}<span class="note num">${esc(p.resident_ref)}</span></div>` : ''}
          ${gerer() && p.etat === 'libre' ? `<div class="actions"><button class="btn" data-conf="${p.id}">${C('chambres.confirmer')}</button></div>` : ''}</div>`).join('')}</div>`; }).join('')}`;
    v.querySelectorAll('[data-res]').forEach((b) => { b.onclick = () => { etat.chResident = Number(b.dataset.res); allerA('c-residents'); }; });
    v.querySelectorAll('[data-conf]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/lits/${b.dataset.conf}/confirmer-disponibilite`), t('chsld.actions.ok')); });
  }

  /* ------------------------------------------------------------------ Demandes d'hébergement */
  async function vueDemandes() {
    const v = $('#v-c-demandes');
    const [liste, cfg] = [await api('GET', `/chsld/demandes?etablissement_id=${ctx()}`), configCtx()];
    v.innerHTML = `<div class="entete"><div><h2>${C('demandes.titre')}</h2><p>${C('demandes.intro')}</p></div>${gerer() ? `<button class="btn pri" id="dh-nouvelle">${icone('plus')}${C('demandes.nouvelle')}</button>` : ''}</div>
      ${liste.length ? `<div class="liste">${liste.map((d) => `<div class="item"><div><b class="num">${esc(d.numero)}</b> · ${esc(d.prenom)} ${esc(d.nom)} · ${C(`provenance.${d.provenance}`)}${d.reference_externe ? ` · ${esc(d.reference_externe)}` : ''}
          <div>${pastille(d.statut, t(`chsld.demande_statut.${d.statut}`))} ${d.type_nom ? `· ${esc(d.type_nom)}` : ''} ${d.arrivee_souhaitee ? `· ${C('demandes.arrivee')} ${esc(jour(d.arrivee_souhaitee))}` : ''} ${d.lit_propose ? `· ${esc(d.lit_propose)}` : ''} ${d.resident_ref ? `· ${esc(d.resident_ref)}` : ''}</div>
          <div class="cases">${d.documents.map((x) => gerer() ? `<label class="case"><input type="checkbox" data-doc="${d.id}" data-code="${x.code}" data-version="${d.version}"${x.recu ? ' checked' : ''}> ${C(`document.${x.code}`)}</label>` : `<span class="note">${C(`document.${x.code}`)} : ${C(x.recu ? 'demandes.recu' : 'demandes.manquant')}</span>`).join('')}</div></div>
          ${gerer() ? `<div class="actions">${d.statut === 'recue' ? `<button class="btn" data-dh="verifier" data-id="${d.id}" data-version="${d.version}">${C('demandes.verifier')}</button>` : ''}
            ${d.statut === 'en_verification' ? `<button class="btn pri" data-dh="proposer_place" data-id="${d.id}" data-version="${d.version}">${C('demandes.proposer')}</button>` : ''}
            ${d.statut === 'place_proposee' ? `<button class="btn pri" data-dh="accepter" data-id="${d.id}" data-version="${d.version}">${C('demandes.accepter')}</button>` : ''}
            <button class="btn dan" data-dh="refuser" data-id="${d.id}" data-version="${d.version}">${C('demandes.refuser')}</button></div>` : ''}</div>`).join('')}</div>` : `<p class="vide">${C('demandes.aucune')}</p>`}`;
    if ($('#dh-nouvelle')) $('#dh-nouvelle').onclick = () => modale(t('chsld.demandes.nouvelle'), `<div class="ligne">${sel('dh-prov', C('demandes.provenance'), ['mecanisme_acces', 'hopital', 'autre_chsld', 'domicile'].map((x) => [x, t(`chsld.provenance.${x}`)]))}${champ('dh-ref', C('demandes.reference_externe'))}</div>
      <div class="ligne">${champ('dh-prenom', C('nouveau.prenom'))}${champ('dh-nom', C('nouveau.nom'))}${champ('dh-dn', C('nouveau.date_naissance'), '', 'type="date"')}</div>
      <div class="ligne">${sel('dh-type', C('demandes.type'), [['', '—'], ...cfg.types.map((x) => [x.id, nomType(x)])])}${champ('dh-arrivee', C('demandes.arrivee'), '', 'type="date"')}</div>
      <p class="lbl">${C('demandes.documents')}</p><div class="cases">${['formulaire_mecanisme', 'identite', 'carte_assurance_maladie', 'mandat_representant', 'consentement_hebergement'].map((x) => `<label class="case"><input type="checkbox" data-dh-doc value="${x}"> ${C(`document.${x}`)}</label>`).join('')}</div>`,
    [{ label: t('general.annuler') }, { label: t('general.enregistrer'), pri: true, run: async () => (await agir(null, () => api('POST', '/chsld/demandes', { etablissement_id: ctx(), provenance: $('#dh-prov').value,
      reference_externe: $('#dh-ref').value, prenom: $('#dh-prenom').value, nom: $('#dh-nom').value, date_naissance: $('#dh-dn').value, type_id: Number($('#dh-type').value) || null,
      arrivee_souhaitee: $('#dh-arrivee').value || null, documents_recus: [...document.querySelectorAll('[data-dh-doc]:checked')].map((x) => x.value) }), (d) => t('chsld.demandes.cree', { numero: d.numero }))) !== null || false }]);
    v.querySelectorAll('[data-doc]').forEach((c) => { c.onchange = () => agir(null, () => api('POST', `/chsld/demandes/${c.dataset.doc}/action`, { action: 'document', code: c.dataset.code, recu: c.checked, version: Number(c.dataset.version) })); });
    v.querySelectorAll('[data-dh]').forEach((b) => { b.onclick = async () => {
      const corps = { action: b.dataset.dh, version: Number(b.dataset.version) };
      if (b.dataset.dh === 'proposer_place') {
        const libres = await placesLibres();
        return modale(t('chsld.demandes.proposer'), libres.length ? sel('dh-lit', C('actions.choisir_place'), libres.map((p) => [p.id, `${p.unite} · ${p.code}`])) : `<p>${C('actions.aucune_place')}</p>`,
          [{ label: t('general.annuler') }, ...(libres.length ? [{ label: t('general.confirmer'), pri: true, run: async () => { const p = libres.find((x) => x.id === Number($('#dh-lit').value));
            return (await agir(null, () => api('POST', `/chsld/demandes/${b.dataset.id}/action`, { ...corps, lit_id: p.id, version_lit: p.version }), t('chsld.actions.ok'))) !== null || false; } }] : [])]);
      }
      return agir(b, () => api('POST', `/chsld/demandes/${b.dataset.id}/action`, corps), t('chsld.actions.ok'));
    }; });
  }

  /* ------------------------------------------------------------------ Admissions et sorties */
  async function vueAdmissions() {
    const v = $('#v-c-admissions');
    const [prevus, presents] = await Promise.all([api('GET', `/chsld/residents?etablissement_id=${ctx()}&statut=preadmission`), api('GET', `/chsld/residents?etablissement_id=${ctx()}&statut=present`)]);
    const ligne = (r) => `<div class="item"><div><button class="lien" data-res="${r.id}">${esc(r.prenom)} ${esc(r.nom)}</button> <span class="note num">${esc(r.reference)}</span>
      <div class="note">${r.lit ? `${esc(r.unite)} · ${esc(r.lit)}` : '—'}${r.arrivee_prevue ? ` · ${C('fiche.arrivee_prevue')} ${esc(jour(r.arrivee_prevue))}` : ''}</div></div>
      ${gerer() && r.statut === 'preadmission' && r.lit ? `<div class="actions"><button class="btn pri" data-arrivee="${r.id}" data-version="${r.version}">${C('actions.arrivee')}</button></div>` : ''}</div>`;
    v.innerHTML = `<div class="entete"><div><h2>${C('admissions.titre')}</h2><p>${C('admissions.intro')}</p></div>${gerer() ? `<button class="btn pri" id="ad-nouveau">${icone('plus')}${C('residents.nouveau')}</button>` : ''}</div>
      <div class="deux"><div class="panneau-c"><h3>${C('admissions.prevus')} <span class="num">${prevus.length}</span></h3><div class="liste">${prevus.map(ligne).join('') || `<p class="note">${C('admissions.aucun')}</p>`}</div></div>
      <div class="panneau-c"><h3>${C('admissions.presents')} <span class="num">${presents.length}</span></h3><div class="liste">${presents.slice(0, 60).map(ligne).join('')}</div></div></div>`;
    v.querySelectorAll('[data-res]').forEach((b) => { b.onclick = () => { etat.chResident = Number(b.dataset.res); allerA('c-residents'); }; });
    v.querySelectorAll('[data-arrivee]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/chsld/residents/${b.dataset.arrivee}/arrivee`, { version: Number(b.dataset.version) }), t('chsld.actions.ok')); });
    if ($('#ad-nouveau')) $('#ad-nouveau').onclick = () => formulaireNouveauResident();
  }

  /* ------------------------------------------------------------------ Personnel et tâches */
  /* Registre (fax, cahiers, appels), import vérifié, visites et activités */
  async function panneauxCoordination(v) {
    const E = (k, x) => C(`registre.${k}`, x); const TYPES_EV = ['demande_transfert', 'admission_retour', 'absence', 'communication', 'confirmation', 'tache_preparation', 'information'];
    const [ev, visites, activites] = await Promise.all([api('GET', `/evenements?etablissement_id=${ctx()}`), api('GET', `/chsld/visites?etablissement_id=${ctx()}`).catch(() => []), api('GET', `/chsld/activites?etablissement_id=${ctx()}`).catch(() => [])]);
    v.insertAdjacentHTML('beforeend', `<section class="panneau-c" id="registre"><h3>${E('titre')}</h3><p class="note">${E('aide')}</p>
      <form id="ev-form"><div class="ligne">${sel('ev-type', E('type'), TYPES_EV.map((x) => [x, E(`t_${x}`)]))}${champ('ev-ref', E('reference'), '', 'maxlength="40"')}</div><div class="champ"><label class="lbl" for="ev-txt">${E('contenu')}</label><textarea id="ev-txt" maxlength="1000" required></textarea></div><button class="btn pri" type="submit">${E('ajouter')}</button></form>
      <div class="liste">${ev.map((x) => `<div class="item"><div><b>${esc(E(`t_${x.type}`))}</b>${x.reference ? ` · <span class="num">${esc(x.reference)}</span>` : ''} · ${esc(E(`s_${x.statut}`))}<div>${esc(x.contenu)}</div><div class="note">${esc(x.auteur_nom || '')} · ${esc(dateHeure(x.cree_le))} · ${esc(E(`src_${x.source}`))}</div></div>${x.statut === 'ouvert' ? `<div class="actions"><button class="btn" type="button" data-ev="${x.id}" data-v="${x.version}" data-st="traite">${E('traiter')}</button></div>` : ''}</div>`).join('')}</div>
      <details><summary>${E('import')}</summary><p class="note">${E('import_aide')}</p><input type="file" id="ev-fichier" accept=".csv,text/csv"><div id="ev-apercu"></div></details></section>
      <section class="panneau-c" id="visites"><h3>${E('visites')}</h3><div class="liste">${visites.map((x) => `<div class="item"><div><span class="num">${esc(x.resident_ref)}</span> · ${esc(x.prenom)} ${esc(x.nom)} · ${esc(dateHeure(x.souhaitee_le))} · ${esc(E(`v_${x.statut}`))}</div>${x.statut === 'demandee' ? `<div class="actions"><button class="btn pri" type="button" data-vis="${x.id}" data-st="acceptee">${E('accepter')}</button><button class="btn" type="button" data-vis="${x.id}" data-st="refusee">${E('refuser')}</button></div>` : ''}</div>`).join('') || `<p class="note">${E('aucune_visite')}</p>`}</div></section>
      <section class="panneau-c" id="activites"><h3>${E('activites')}</h3><form id="ac-form"><div class="ligne">${champ('ac-titre', E('ac_titre'), '', 'maxlength="120" required')}${champ('ac-date', E('ac_date'), '', 'type="datetime-local" required')}</div><button class="btn pri" type="submit">${E('publier')}</button></form><div class="liste">${activites.map((x) => `<div class="item"><div><b>${esc(x.titre)}</b> · ${esc(dateHeure(x.debut_le))}</div><button class="btn" type="button" data-ac="${x.id}">${E('retirer')}</button></div>`).join('')}</div></section>`);
    const ok = t('chsld.actions.ok');
    $('#ev-form').onsubmit = (e) => { e.preventDefault(); agir(e.submitter, () => api('POST', '/evenements', { etablissement_id: ctx(), type: $('#ev-type').value, reference: $('#ev-ref').value, contenu: $('#ev-txt').value }), ok); };
    v.querySelectorAll('[data-ev]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/evenements/${b.dataset.ev}/statut`, { statut: b.dataset.st, version: Number(b.dataset.v) }), ok); });
    v.querySelectorAll('[data-vis]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/chsld/visites/${b.dataset.vis}/reponse`, { statut: b.dataset.st }), ok); });
    v.querySelectorAll('[data-ac]').forEach((b) => { b.onclick = () => agir(b, () => api('DELETE', `/chsld/activites/${b.dataset.ac}`), ok); });
    $('#ac-form').onsubmit = (e) => { e.preventDefault(); agir(e.submitter, () => api('POST', '/chsld/activites', { etablissement_id: ctx(), titre: $('#ac-titre').value, debut_le: new Date($('#ac-date').value).toISOString() }), ok); };
    $('#ev-fichier').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const contenu = await f.text();
      try { const a = await api('POST', '/evenements/import/verifier', { etablissement_id: ctx(), contenu });
        $('#ev-apercu').innerHTML = `<p>${E('apercu', { n: a.apercu.length, e: a.erreurs.length })}</p><ul>${a.apercu.slice(0, 20).map((x) => `<li>${esc(E(`t_${x.type}`))} · ${esc(x.reference || '')} · ${esc(x.contenu)}</li>`).join('')}</ul>${a.erreurs.map((x) => `<p class="erreur">${E('ligne', { n: x.ligne })}</p>`).join('')}${a.erreurs.length ? '' : `<button class="btn pri" type="button" id="ev-confirmer">${E('confirmer')}</button>`}`;
        if (!a.erreurs.length) $('#ev-confirmer').onclick = (x) => agir(x.currentTarget, () => api('POST', '/evenements/import', { etablissement_id: ctx(), contenu, empreinte: a.empreinte, confirme: true }), ok);
      } catch (x) { $('#ev-apercu').innerHTML = `<p class="erreur">${esc(x.message)}</p>`; } };
  }
  /* Coordination Famille, côté établissement : indicateurs mesurés, demandes, confirmations, créneaux, journal de vie */
  async function panneauFamille(v) {
    const F = (k, x) => C(`famille.${k}`, x); const ok = t('chsld.actions.ok');
    let tb, dem, confs, residents, journal, regl;
    try { [tb, dem, confs, residents, journal, regl] = await Promise.all([api('GET', `/famille/tableau?etablissement_id=${ctx()}`), api('GET', `/famille/demandes?etablissement_id=${ctx()}`), api('GET', `/famille/confirmations?etablissement_id=${ctx()}`), api('GET', `/chsld/residents?etablissement_id=${ctx()}`), api('GET', `/famille/journal-vie?etablissement_id=${ctx()}`), api('GET', `/famille/reglages?etablissement_id=${ctx()}`)]); } catch { return; }
    const STATUTS = ['recue', 'attribuee', 'en_cours', 'attente_information', 'attente_proche', 'resolue', 'refusee', 'cloturee'];
    const min = (x) => (x == null ? '—' : `${Math.round(x)} min`);
    v.insertAdjacentHTML('beforeend', `<section class="panneau-c" id="famille"><h3>${F('titre')}</h3>
      <div class="ch-kpis">${[['ouvertes', tb.demandes.ouvertes], ['en_retard', tb.demandes.en_retard], ['messages', tb.messages.non_traites], ['premiere_reponse', min(tb.messages.premiere_reponse_mediane_min)], ['resolution', min(tb.demandes.resolution_mediane_min)], ['confirmations', tb.confirmations.en_attente], ['visites_jour', tb.visites.du_jour], ['retours', tb.retours.planifies], ['echecs', tb.notifications_echouees]].map(([k, n]) => `<div class="ch-kpi"><span class="lbl">${F(`k_${k}`)}</span><span class="v num">${esc(String(n))}</span></div>`).join('')}</div>
      <p class="note">${esc(tb.mesure)}</p>
      <h4>${F('demandes')}</h4><div class="liste">${dem.map((d) => `<div class="item${d.en_retard ? ' en-retard' : ''}"><div><b>n° ${d.id}</b> · ${F(`c_${d.categorie}`)} · <span class="num">${esc(d.resident_ref)}</span> · ${esc(d.prenom)} ${esc(d.nom)} · <b>${F(`s_${d.statut}`)}</b>${d.en_retard ? ` · <b>${F('retard')}</b>` : ''}<div>${esc(d.texte)}</div>${d.reponse ? `<div class="note">${F('reponse')} : ${esc(d.reponse)}</div>` : ''}</div>
        ${['resolue', 'refusee', 'annulee', 'cloturee'].includes(d.statut) ? '' : `<div class="actions"><select data-dem-statut="${d.id}" aria-label="${F('statut')}">${STATUTS.map((x) => `<option value="${x}"${x === d.statut ? ' selected' : ''}>${F(`s_${x}`)}</option>`).join('')}</select><input data-dem-rep="${d.id}" maxlength="500" placeholder="${F('reponse_famille')}" value="${esc(d.reponse || '')}"><button class="btn pri" type="button" data-dem-ok="${d.id}">${F('enregistrer')}</button></div>`}</div>`).join('') || `<p class="note">${F('aucune')}</p>`}</div>
      <h4>${F('confirmations')}</h4><form id="fc-form"><div class="ligne">${sel('fc-res', F('resident'), residents.map((r) => [r.id, `${r.reference} · ${r.prenom} ${r.nom}`]))}<div class="champ"><label class="lbl" for="fc-contact">${F('proche')}</label><select id="fc-contact"></select></div></div>${champ('fc-sujet', F('sujet'), '', 'maxlength="160" required')}${champ('fc-echeance', F('echeance'), '', 'type="datetime-local"')}<button class="btn pri" type="submit">${F('demander')}</button></form>
      <div class="liste">${confs.slice(0, 20).map((c) => `<div class="item"><div><b>${esc(c.sujet)}</b> · <span class="num">${esc(c.resident_ref)}</span> · ${esc(c.prenom)} · ${F(`r_${c.statut}`)}${c.repondu_le ? ` · ${esc(dateHeure(c.repondu_le))}` : ''}</div></div>`).join('')}</div>
      <h4>${F('creneaux')}</h4><form id="cr-form"><div class="ligne">${champ('cr-debut', F('debut'), '', 'type="datetime-local" required')}${champ('cr-fin', F('fin'), '', 'type="datetime-local" required')}${champ('cr-cap', F('capacite'), '2', 'type="number" min="1" max="50" required')}</div><button class="btn pri" type="submit">${F('ajouter_creneau')}</button></form>
      <h4>${F('journal')}</h4><label class="case"><input type="checkbox" id="jv-actif"${regl.journal_vie ? ' checked' : ''}> ${F('journal_actif')}</label>
      <form id="jv-form">${champ('jv-titre', F('titre_pub'), '', 'maxlength="120" required')}<div class="champ"><label class="lbl" for="jv-txt">${F('texte_pub')}</label><textarea id="jv-txt" maxlength="2000" required></textarea></div><p class="note">${F('sans_photo')}</p><button class="btn" type="submit">${F('brouillon')}</button></form>
      <div class="liste">${journal.map((j) => `<div class="item"><div><b>${esc(j.titre)}</b> · ${F(`j_${j.statut}`)} · ${esc(j.auteur_nom || '')}</div><div class="actions">${j.statut !== 'publie' ? `<button class="btn" data-jv="${j.id}" data-a="publier">${F('publier')}</button>` : `<button class="btn" data-jv="${j.id}" data-a="retirer">${F('retirer')}</button>`}</div></div>`).join('')}</div></section>`);
    const contacts = async () => { const f = await api('GET', `/chsld/residents/${$('#fc-res').value}`).catch(() => null); $('#fc-contact').innerHTML = (f?.contacts || []).map((k) => `<option value="${k.id}">${esc(k.prenom)} ${esc(k.nom)}</option>`).join(''); };
    if ($('#fc-res')) { $('#fc-res').onchange = contacts; contacts(); }
    v.querySelectorAll('[data-dem-ok]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/famille/demandes/${b.dataset.demOk}`, { statut: v.querySelector(`[data-dem-statut="${b.dataset.demOk}"]`).value, reponse: v.querySelector(`[data-dem-rep="${b.dataset.demOk}"]`).value }), ok); });
    $('#fc-form').onsubmit = (e) => { e.preventDefault(); agir(e.submitter, () => api('POST', '/famille/confirmations', { resident_id: Number($('#fc-res').value), contact_id: Number($('#fc-contact').value), sujet: $('#fc-sujet').value, echeance: $('#fc-echeance').value ? new Date($('#fc-echeance').value).toISOString() : null }), ok); };
    $('#cr-form').onsubmit = (e) => { e.preventDefault(); agir(e.submitter, () => api('POST', '/famille/creneaux', { etablissement_id: ctx(), debut: new Date($('#cr-debut').value).toISOString(), fin: new Date($('#cr-fin').value).toISOString(), capacite: Number($('#cr-cap').value) }), ok); };
    $('#jv-actif').onchange = (e) => agir(null, () => api('PUT', '/famille/reglages', { etablissement_id: ctx(), journal_vie: e.target.checked }), ok);
    $('#jv-form').onsubmit = (e) => { e.preventDefault(); agir(e.submitter, () => api('POST', '/famille/journal-vie', { etablissement_id: ctx(), titre: $('#jv-titre').value, texte: $('#jv-txt').value }), ok); };
    v.querySelectorAll('[data-jv]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/famille/journal-vie/${b.dataset.jv}/${b.dataset.a}`), ok); });
  }
  async function vueTaches() {
    const v = $('#v-c-taches');
    const liste = await api('GET', `/chsld/taches?etablissement_id=${ctx()}`);
    const peutCreer = role() !== 'entretien';
    const superviseur = ['coordonnateur', 'admin_etab', 'gestionnaire'].includes(role());
    const controles = superviseur ? await api('GET', `/nettoyage/controles?etablissement_id=${ctx()}`) : [];
    v.innerHTML = `<div class="entete"><div><h2>${C('taches.titre')}</h2><p>${C('taches.intro')}</p></div>${peutCreer ? `<button class="btn pri" id="ta-nouvelle">${icone('plus')}${C('taches.nouvelle')}</button>` : ''}</div>
      ${controles.length ? `<div class="panneau-c" id="ta-controles"><h3>${esc(t('nettoyage.st_controle_requis'))}</h3><div class="liste">${controles.map((x) => `<div class="item"><div><b>${esc(x.lit)}</b> · ${esc(x.chambre)}${x.version_changee ? ` · ${esc(t('nettoyage.version_changee'))}` : ''}</div><div class="actions">${x.version_changee ? '' : `<button class="btn pri" data-net-valider="${x.lit_id}">${esc(t('nettoyage.valider'))}</button>`}<button class="btn" data-net-reprendre="${x.lit_id}">${esc(t('nettoyage.reprendre'))}</button></div></div>`).join('')}</div></div>` : ''}
      ${liste.length ? `<div class="liste">${liste.map((x) => `<div class="item"><div><b>${esc(x.titre)}</b> · ${C(`tache_type.${x.type}`)} ${pastille(x.statut, t(`chsld.tache_statut.${x.statut}`))}${x.consignes ? consignesNettoyageHTML(x.consignes) : ''}
        <div class="note">${[x.lit, x.resident_ref, x.assigne_role ? t(`roles.${x.assigne_role}`) : null, x.echeance ? `${t('chsld.taches.echeance')} ${dateHeure(x.echeance)}` : null].filter(Boolean).map(esc).join(' · ')}${x.echeance && new Date(x.echeance) < new Date() ? ` · <b class="duree-24">${C('taches.en_retard')}</b>` : ''}</div>${x.detail ? `<div class="note">${esc(x.detail)}</div>` : ''}</div>
        <div class="actions">${x.statut === 'a_faire' ? `<button class="btn" data-ta="en_cours" data-id="${x.id}" data-version="${x.version}">${C('taches.commencer')}</button>` : ''}<button class="btn pri" data-ta="faite" data-id="${x.id}" data-version="${x.version}">${C(x.type === 'preparation_chambre' ? 'taches.chambre_prete' : 'taches.faite')}</button>
          ${peutCreer ? `<button class="btn dan" data-ta="annulee" data-id="${x.id}" data-version="${x.version}">${C('taches.annuler')}</button>` : ''}</div></div>`).join('')}</div>` : `<p class="vide">${C('taches.aucune')}</p>`}`;
    if (role() !== 'entretien') panneauxCoordination(v);
    if (role() !== 'entretien') panneauFamille(v);
    for (const x of ['valider', 'reprendre']) v.querySelectorAll(`[data-net-${x}]`).forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/nettoyage/${b.dataset[`net${x[0].toUpperCase()}${x.slice(1)}`]}/${x}`), t('nettoyage.ok')); });
    v.querySelectorAll('[data-ta]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/chsld/taches/${b.dataset.id}/statut`, { statut: b.dataset.ta, version: Number(b.dataset.version) }), t('chsld.actions.ok')); });
    if ($('#ta-nouvelle')) $('#ta-nouvelle').onclick = async () => {
      const places = await api('GET', `/chsld/places?etablissement_id=${ctx()}`);
      modale(t('chsld.taches.nouvelle'), `<div class="ligne">${sel('ta-type', C('taches.type'), ['entretien', 'preparation_chambre', 'administratif', 'transmission', 'relance'].map((x) => [x, t(`chsld.tache_type.${x}`)]))}
          ${sel('ta-role', C('taches.assigne'), [['', '—'], ...['entretien', 'equipe_soins', 'coordonnateur', 'admin_etab'].map((x) => [x, t(`roles.${x}`)])])}</div>${champ('ta-titre', C('taches.titre_champ'), '', 'maxlength="160"')}
        <div class="champ"><label class="lbl" for="ta-detail">${C('taches.detail')}</label><textarea id="ta-detail" maxlength="1000"></textarea></div>
        <div class="ligne">${sel('ta-lit', C('residents.place'), [['', '—'], ...places.map((p) => [p.id, `${p.unite} · ${p.code}`])])}${champ('ta-echeance', C('taches.echeance'), '', 'type="datetime-local"')}</div>`,
      [{ label: t('general.annuler') }, { label: t('general.enregistrer'), pri: true, run: async () => (await agir(null, () => api('POST', '/chsld/taches', { etablissement_id: ctx(), type: $('#ta-type').value,
        assigne_role: $('#ta-role').value || null, titre: $('#ta-titre').value, detail: $('#ta-detail').value, lit_id: Number($('#ta-lit').value) || null, echeance: $('#ta-echeance').value || null }), t('chsld.taches.creee'))) !== null || false }]);
    };
  }

  /* ------------------------------------------------------------------ Coordinations (CHSLD et hôpital) */
  const ACTIONS_CO = {
    hospitalisation: { origine: { envoyee: ['confirmer_depart', 'annuler'], acceptee: ['confirmer_depart', 'annuler'], en_cours: ['incident'] }, destination: { en_cours: ['confirmer_reception', 'retour'], recue: ['retour', 'incident'] } },
    retour: { origine: { acceptee: ['confirmer_depart'], envoyee: ['incident'] }, destination: { envoyee: ['accepter', 'refuser', 'incident'], acceptee: ['verifier_chambre', 'incident'], en_cours: ['verifier_chambre', 'confirmer_arrivee'], recue: ['verifier_chambre', 'reintegrer'] } },
    transfert_chsld: { origine: { envoyee: ['annuler'], acceptee: ['confirmer_depart', 'annuler'] }, destination: { envoyee: ['accepter', 'refuser'], en_cours: ['confirmer_arrivee'] } },
  };
  /** Chronologie calculée par le serveur : mêmes étapes et mêmes dates dans le CHSLD et à l'hôpital. */
  const chronoHTML = (ch) => (ch?.length ? `<ol class="ch-chrono">${ch.map((p) => `<li class="${p.fait ? 'fait' : ''}"><span>${C(`chrono.${p.code}`)}</span>${p.date ? `<span class="note num">${esc(dateHeure(p.date))}</span>` : ''}</li>`).join('')}</ol>` : '');
  const libelleEtape = (s) => (s.startsWith('incident:') ? t(`chsld.coord.incident_${s.slice(9)}`) : s.startsWith('orientation:') ? t(`chsld.liaison.etape_${s.slice(12)}`)
    : ['recue_hopital', 'arrivee', 'cloturee', 'envoyee', 'chambre_verifiee', 'transport', 'reintegree'].includes(s) ? t(`chsld.liaison.journal_${s}`) : t(`chsld.coord_statut.${s}`));
  function carteCoordination(c) {
    const cote = c.entrante ? 'destination' : 'origine';
    const actions = (ACTIONS_CO[c.type]?.[cote]?.[c.statut] || []).filter((a) => (a !== 'retour' || gererCo()) && (a !== 'verifier_chambre' || !c.chambre_verifiee_le) && (c.statut !== 'recue' || c.type !== 'retour' || c.a_reintegrer))
      .concat(c.reintegration?.bloquante && gererCo() && (['acceptee', 'en_cours'].includes(c.statut) || c.a_reintegrer) ? ['resoudre'] : []);
    return `<div class="item ch-coord"><div><b class="num">${esc(c.numero)}</b> · ${C(`coord.type_${c.type}`)} · <span class="num">${esc(c.resident_ref)}</span> ${pastille(c.statut, t(['hospitalisation', 'retour'].includes(c.type) ? `chsld.liaison.etape_${c.etape}` : `chsld.coord_statut.${c.statut}`))}
      <div class="note">${esc(c.origine)} → ${esc(c.destination)}${c.lit ? ` · ${esc(c.lit)}` : ''}${c.retour_prevu_le ? ` · ${C('coord.retour_le', { date: dateHeure(c.retour_prevu_le) })}` : ''}${c.incident ? ` · <b>${C(`coord.incident_${c.incident}`)}</b>` : ''}</div>
      ${c.reintegration ? `<div class="note">${c.reintegration.lit ? `${esc(c.reintegration.lit.code)} · ` : ''}${c.reintegration.pret ? `<b>${C('reint.pret')}</b>` : c.reintegration.raisons.map((x) => C(`reint.r_${x}`)).join(' · ')}</div>` : ''}
      ${c.cloturee_le || ['refusee', 'annulee', 'expiree'].includes(c.statut) ? '' : chronoHTML(c.chronologie)}
      ${c.etapes?.length ? `<details><summary class="note">${C('coord.etapes')}</summary><ol class="ch-historique">${c.etapes.map((e) => `<li><span class="note num">${esc(dateHeure(e.date))}</span> ${esc(libelleEtape(e.statut))}${e.detail ? ` · ${esc(e.detail)}` : ''}</li>`).join('')}</ol></details>` : ''}</div>
      ${actions.length ? `<div class="actions">${actions.map((a) => `<button class="btn${['confirmer_depart', 'confirmer_reception', 'confirmer_arrivee', 'accepter', 'reintegrer'].includes(a) ? ' pri' : a === 'refuser' || a === 'annuler' ? ' dan' : ''}" data-co="${a}" data-id="${c.id}" data-version="${c.version}" data-type="${c.type}">${C(`coord.${a === 'retour' ? 'preparer_retour' : a}`)}</button>`).join('')}</div>` : ''}</div>`;
  }
  const gererCo = () => ['coordonnateur', 'admin_etab', 'gestionnaire'].includes(role());
  function brancherCoordinations(zone) {
    zone.querySelectorAll('[data-co]').forEach((b) => { b.onclick = async () => {
      const id = b.dataset.id, version = Number(b.dataset.version), a = b.dataset.co, ok = t('chsld.actions.ok');
      if (a === 'retour') return modale(t('chsld.coord.preparer_retour'), `${champ('rt-date', C('actions.retour_prevu'), '', 'type="datetime-local"')}${champ('rt-motif', C('actions.motif_admin'), '', 'maxlength="200"')}`,
        [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => (await agir(null, () => api('POST', `/coordinations/${id}/retour`, { retour_prevu_le: $('#rt-date').value, motif_admin: $('#rt-motif').value }), ok)) !== null || false }]);
      if (a === 'incident') return modale(t('chsld.coord.incident'), `${sel('in-code', C('coord.incident'), ['retour_retarde', 'hospitalisation_prolongee', 'informations_manquantes', 'chambre_indisponible', 'arrivee_anticipee'].map((x) => [x, t(`chsld.coord.incident_${x}`)]))}${champ('in-date', C('actions.retour_prevu'), '', 'type="datetime-local"')}`,
        [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => (await agir(null, () => api('POST', `/coordinations/${id}/action`, { etablissement_id: ctx(), version, action: 'incident', incident: $('#in-code').value, retour_prevu_le: $('#in-date').value || null }), ok)) !== null || false }]);
      if (a === 'reintegrer') return modale(t('chsld.coord.reintegrer'), `<p class="note">${C('reint.reintegrer_aide')}</p><label class="case"><input type="checkbox" id="ri-id"> ${C('actions.identite_verifiee')}</label><label class="case"><input type="checkbox" id="ri-cond"> ${C('reint.conditions')}</label>`,
        [{ label: t('general.annuler') }, { label: t('chsld.coord.reintegrer'), pri: true, run: async () => (await agir(null, () => api('POST', `/coordinations/${id}/action`, { etablissement_id: ctx(), version, action: 'reintegrer', identite_verifiee: $('#ri-id').checked, conditions_accueil: $('#ri-cond').checked }), ok)) !== null || false }]);
      if (a === 'resoudre') {
        const libres = await placesLibres();
        return modale(t('chsld.reint.resoudre'), `<p class="note">${C('reint.resoudre_aide')}</p>${libres.length ? sel('rs-lit', C('actions.choisir_place'), libres.map((p) => [p.id, `${p.unite} · ${p.code}`])) : `<p>${C('actions.aucune_place')}</p>`}`,
          [{ label: t('general.annuler') }, ...(libres.length ? [{ label: t('general.confirmer'), pri: true, run: async () => { const p = libres.find((x) => x.id === Number($('#rs-lit').value));
            return (await agir(null, () => api('POST', `/coordinations/${id}/action`, { etablissement_id: ctx(), version, action: 'resoudre', lit_id: p.id, version_lit: p.version }), ok)) !== null || false; } }] : [])]);
      }
      if (a === 'accepter' && b.dataset.type === 'transfert_chsld') {
        const libres = await placesLibres();
        return modale(t('chsld.coord.place_accueil'), libres.length ? sel('ac-lit', C('actions.choisir_place'), libres.map((p) => [p.id, `${p.unite} · ${p.code}`])) : `<p>${C('actions.aucune_place')}</p>`,
          [{ label: t('general.annuler') }, ...(libres.length ? [{ label: t('general.confirmer'), pri: true, run: async () => { const p = libres.find((x) => x.id === Number($('#ac-lit').value));
            return (await agir(null, () => api('POST', `/coordinations/${id}/action`, { etablissement_id: ctx(), version, action: 'accepter', lit_id: p.id, version_lit: p.version }), ok)) !== null || false; } }] : [])]);
      }
      return agir(b, () => api('POST', `/coordinations/${id}/action`, { etablissement_id: ctx(), version, action: a }), ok);
    }; });
  }
  async function vueMouvements() {
    const v = $('#v-c-mouvements');
    const liste = await api('GET', `/coordinations?etablissement_id=${ctx()}`);
    const entrantes = liste.filter((c) => c.entrante), sortantes = liste.filter((c) => !c.entrante);
    v.innerHTML = `<div class="entete"><div><h2>${C('coord.titre')}</h2><p>${C('coord.intro')}</p></div></div>
      <div class="deux"><div class="panneau-c"><h3>${C('coord.sortantes')}</h3><div class="liste">${sortantes.map(carteCoordination).join('') || `<p class="note">${C('coord.aucune')}</p>`}</div></div>
      <div class="panneau-c"><h3>${C('coord.entrantes')}</h3><div class="liste">${entrantes.map(carteCoordination).join('') || `<p class="note">${C('coord.aucune')}</p>`}</div></div></div>`;
    brancherCoordinations(v);
  }
  /* ------------------------------------------------------------------ Hôpital : module Liaison CHSLD */
  /* Un seul module commun à tous les hôpitaux. Les arrivées depuis les CHSLD ne sont jamais mêlées aux transferts
     interhospitaliers. L'hôpital ne voit que la référence du résident ; chaque étape est confirmée par une personne. */
  const ONGLETS_LIAISON = ['arrivees', 'a_accueillir', 'hospitalisations', 'transferts', 'retours_en_cours', 'historique'];
  const L = (k, v) => C(`liaison.${k}`, v);
  /** Renseignements transmis par le CHSLD, sans nouvelle saisie. */
  const transmis = (c) => { const i = c.infos_operationnelles || {}; const x = [
    c.urgence_declaree ? `${L('urgence_declaree')} : ${C(`depart.urgence_${c.urgence_declaree}`)}` : '',
    c.service_souhaite ? `${L('service_souhaite')} : ${esc(locale().startsWith('en') ? c.service_souhaite_en || c.service_souhaite : c.service_souhaite)}` : '',
    i.transport ? `${C('depart.transport')} : ${C(`depart.transport_${i.transport}`)}` : '',
    i.accessibilite?.length ? `${C('depart.accessibilite')} : ${i.accessibilite.map((a) => C(`acces.${a}`)).join(', ')}` : '',
    i.accompagnateur ? C('depart.accompagnateur') : ''].filter(Boolean);
  return x.length ? `<div class="note li-transmis">${x.join(' · ')}</div>` : ''; };
  function carteLiaison(c) {
    const act = (a, id = c.id, version = c.version, type = c.type) => `<button class="btn${['accepter', 'confirmer_reception', 'orienter', 'confirmer_depart', 'transport'].includes(a) ? ' pri' : a === 'refuser' ? ' dan' : ''}"
      data-li="${a}" data-id="${id}" data-version="${version}" data-type="${type}" data-num="${esc(c.numero)}">${L(`action_${type === 'transfert_hopital' && ['annuler', 'confirmer_depart'].includes(a) ? `${a}_transfert` : a}`)}</button>`;
    const d = c.derniere;
    const r = c.retour;
    return `<article class="item li-carte" data-coordination="${c.id}"><div>
      <div><b class="num">${esc(c.numero)}</b> · <span class="num">${esc(c.resident_ref)}</span> ${pastille(c.statut, t(`chsld.liaison.etape_${c.etape}`))}</div>
      <div class="note">${L('origine')} : <b>${esc(c.origine)}</b> → ${esc(c.destination)}${c.patient_ref_hopital ? ` · ${L('episode')} <span class="num">${esc(c.patient_ref_hopital)}</span>` : ''}${c.incident ? ` · <b>${C(`coord.incident_${c.incident}`)}</b>` : ''}</div>
      <div class="note">${L('transmise_le', { date: dateHeure(c.cree_le) })} · ${L('derniere', { etape: libelleEtape(d.statut), date: dateHeure(d.date) })}</div>
      ${c.motif_admin ? `<div class="note">${L('motif')} : ${esc(c.motif_admin)}</div>` : ''}
      ${transmis(c)}
      ${c.evaluation_transmise && peutEvaluer() ? `<div><button class="btn" type="button" data-li-eval="${c.id}">${C('evaluation.voir')}</button></div>` : ''}
      ${c.orientation ? `<div class="note">${L(`affiche_${c.orientation}`)}${c.service_retenu ? ` · ${esc(locale().startsWith('en') ? c.service_retenu_en || c.service_retenu : c.service_retenu)}` : ''}${c.admission?.lit ? ` · ${L('lit')} <b class="num">${esc(c.admission.lit)}</b>` : ''}${c.civiere ? ` · ${L('civiere')} <b class="num">${esc(c.civiere)}</b>` : ''}${c.admission ? ` · ${esc(t(`chsld.liaison.admission_${c.admission.statut}`))}` : ''}</div>` : ''}
      ${r ? chronoHTML(r.chronologie) : chronoHTML(c.chronologie)}
      ${r ? `<div class="note li-retour">${L('retour_vers', { chsld: esc(c.origine) })} · <b>${esc(t(`chsld.liaison.etape_${r.etape}`))}</b>${r.retour_prevu_le ? ` · ${C('coord.retour_le', { date: dateHeure(r.retour_prevu_le) })}` : ''} <span class="num">${esc(r.numero)}</span></div>` : ''}
      ${c.etapes?.length ? `<details><summary class="note">${C('coord.etapes')}</summary><ol class="ch-historique">${c.etapes.map((e) => `<li><span class="note num">${esc(dateHeure(e.date))}</span> ${esc(libelleEtape(e.statut))}${e.detail ? ` · ${esc(e.detail)}` : ''}</li>`).join('')}</ol></details>` : ''}</div>
      ${c.actions.length || r?.actions.length ? `<div class="actions">${c.actions.map((a) => act(a)).join('')}${(r?.actions || []).map((a) => act(a, r.id, r.version, 'retour')).join('')}</div>` : ''}</article>`;
  }
  async function vueLiaison() {
    const v = $('#v-liaison'); if (!v) return;
    const onglet = ONGLETS_LIAISON.includes(etat.liaisonOnglet) ? etat.liaisonOnglet : 'arrivees';
    let d;
    try { d = await api('GET', `/liaison-chsld?etablissement_id=${ctx()}`); } catch (e) { v.innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
    const n = Object.fromEntries(ONGLETS_LIAISON.map((o) => [o, d[o].length]));
    const liste = d[onglet];
    etat.liaisonFiches = Object.fromEntries(ONGLETS_LIAISON.flatMap((o) => d[o]).map((x) => [x.id, x]));
    v.innerHTML = `<div class="entete"><div><h2>${L('titre', { etab: etabCtx().nom })}</h2><p>${L('intro')}</p></div></div>
      <p class="note">${L('regle')}</p>
      <div class="li-onglets" role="tablist" aria-label="${L('titre_court')}">${ONGLETS_LIAISON.map((o) => `<button type="button" role="tab" class="li-onglet" data-li-onglet="${o}" aria-selected="${o === onglet}">${L(`onglet_${o}`)} <span class="n num">${n[o]}</span></button>`).join('')}</div>
      <div class="panneau-c"><p class="note">${L(`aide_${onglet}`)}</p><div class="liste">${liste.map(carteLiaison).join('') || `<p class="note">${L(`aucun_${onglet}`)}</p>`}</div></div>`;
    v.querySelectorAll('[data-li-onglet]').forEach((b) => { b.onclick = () => { etat.liaisonOnglet = b.dataset.liOnglet; vueLiaison(); }; });
    brancherLiaison(v);
  }
  function brancherLiaison(v) {
    const ok = t('chsld.actions.ok');
    v.querySelectorAll('[data-li-eval]').forEach((b) => { b.onclick = () => agir(null, async () => { const e = await api('GET', `/coordinations/${b.dataset.liEval}/evaluation?etablissement_id=${ctx()}`); modale(C('evaluation.titre'), `<p class="note">${C('evaluation.aide')}</p>${evalHTML(e)}`, [{ label: t('general.fermer') }]); }); });
    v.querySelectorAll('[data-li]').forEach((b) => { b.onclick = async () => {
      const id = b.dataset.id, version = Number(b.dataset.version), a = b.dataset.li, numero = b.dataset.num;
      const action = (corps) => api('POST', `/coordinations/${id}/action`, { etablissement_id: ctx(), version, action: a, ...corps });
      if (a === 'retour') return modale(L('action_retour'), `<p class="note">${L('retour_aide')}</p>${champ('li-date', C('actions.retour_prevu'), '', 'type="datetime-local"')}${champ('li-motif', C('actions.motif_admin'), '', 'maxlength="200"')}`,
        [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => (await agir(null, () => api('POST', `/coordinations/${id}/retour`, { retour_prevu_le: $('#li-date').value, motif_admin: $('#li-motif').value }), ok)) !== null || false }]);
      if (a === 'transferer') {
        const hopitaux = (await api('GET', `/liaison-chsld/hopitaux?etablissement_id=${ctx()}`)).filter((h) => h.id !== ctx());
        return modale(L('action_transferer'), `<p class="note">${L('transferer_aide')}</p>${sel('li-hopital', L('transferer_vers'), hopitaux.map((h) => [h.id, h.nom]))}${champ('li-motif', C('actions.motif'), '', 'maxlength="200"')}`,
          [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => (await agir(null, () => api('POST', `/coordinations/${id}/transfert-hopital`, { hopital_id: Number($('#li-hopital').value), motif_admin: $('#li-motif').value }), ok)) !== null || false }]);
      }
      if (a === 'refuser') return modale(L('action_refuser'), `<p>${esc(numero)}</p>${champ('li-motif', L('motif_refus'), '', 'maxlength="200"')}`,
        [{ label: t('general.annuler') }, { label: L('action_refuser'), pri: true, run: async () => (await agir(null, () => action({ motif: $('#li-motif').value }), ok)) !== null || false }]);
      if (a === 'incident') return modale(t('chsld.coord.incident'), `${sel('li-inc', C('coord.incident'), ['arrivee_retardee', 'arrivee_anticipee', 'informations_manquantes', 'hospitalisation_prolongee', 'retour_retarde'].map((x) => [x, t(`chsld.coord.incident_${x}`)]))}${champ('li-date', C('actions.retour_prevu'), '', 'type="datetime-local"')}`,
        [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => (await agir(null, () => action({ incident: $('#li-inc').value, retour_prevu_le: $('#li-date').value || null }), ok)) !== null || false }]);
      if (a === 'orienter') {
        const chemin = (q = '') => `/liaison-chsld/${id}/emplacements?etablissement_id=${ctx()}${q}`;
        let em = await api('GET', chemin());
        const fiche = etat.liaisonFiches?.[id];
        const dejaCiviere = fiche?.orientation === 'urgence';
        const BES = ['isolement', 'pression_negative', 'ventilation', 'telemetrie'];
        const optionsLit = () => [['', L('sans_lit')], ...em.lits.map((x) => [x.id, `${x.unite} · ${x.code} · ${C('residents.chambre')} ${x.chambre}${x.compatibilite === 'a_verifier' ? ` · ${L(`justif_${x.justification}`)}` : ''}`])];
        modale(L('action_orienter'), `<p class="note">${L('orienter_aide')}</p>${transmis(fiche || {})}
          ${sel('li-orientation', L('orientation'), [['admission', L('orientation_admission')], ...(em.urgence_active && !dejaCiviere ? [['urgence', L('orientation_urgence')]] : [])])}
          ${dejaCiviere ? `<p class="note">${L('episode')} <span class="num">${esc(fiche.patient_ref_hopital)}</span></p>` : champ('li-ref', L('reference_hopital', { exemple: em.reference_exemple }), '', `maxlength="40" autocomplete="off" placeholder="${esc(em.reference_exemple)}"`)}
          <div id="li-admission">${sel('li-type', L('service_retenu'), em.services.map((ty) => [ty.id, nomType(ty)]), em.type_id)}
            <fieldset class="ch-cases"><legend class="lbl">${L('besoins_lit')}</legend>${BES.map((k) => `<label class="case"><input type="checkbox" data-li-besoin="${k}"> ${esc(t(`besoins.${k}`))}</label>`).join('')}</fieldset>
            <div id="li-lit-zone">${sel('li-lit', L('lit_compatible', { n: em.lits.length }), optionsLit())}</div></div>
          <div id="li-urgence" hidden>${em.civieres.length ? sel('li-civiere', L('civiere_libre'), em.civieres.map((x) => [x.id, x.code])) : `<p class="note">${L('aucune_civiere')}</p>`}</div>`,
        [{ label: t('general.annuler') }, { label: t('general.confirmer'), pri: true, run: async () => {
          const o = $('#li-orientation').value; const lit = em.lits.find((x) => x.id === Number($('#li-lit')?.value)); const cv = em.civieres.find((x) => x.id === Number($('#li-civiere')?.value));
          const besoins = Object.fromEntries([...document.querySelectorAll('[data-li-besoin]')].map((x) => [x.dataset.liBesoin, x.checked]));
          return (await agir(null, () => action({ orientation: o, patient_ref: ($('#li-ref')?.value || '').trim(), type_id: Number($('#li-type').value), besoins, ...(o === 'admission' && lit ? { lit_id: lit.id, version_lit: lit.version } : {}), ...(o === 'urgence' && cv ? { civiere_id: cv.id, version_civiere: cv.version } : {}) }), ok)) !== null || false;
        } }]);
        const maj = () => { const adm = $('#li-orientation').value === 'admission'; $('#li-admission').hidden = !adm; $('#li-urgence').hidden = adm; };
        const relire = async () => { const b2 = [...document.querySelectorAll('[data-li-besoin]:checked')].map((x) => `&${x.dataset.liBesoin}=1`).join('');
          em = await api('GET', chemin(`&type_id=${$('#li-type').value}${b2}`)); $('#li-lit-zone').innerHTML = sel('li-lit', L('lit_compatible', { n: em.lits.length }), optionsLit()); };
        $('#li-orientation').onchange = maj; maj(); $('#li-type').onchange = relire;
        document.querySelectorAll('[data-li-besoin]').forEach((x) => { x.onchange = relire; });
        return;
      }
      return agir(b, () => action({}), ok);
    }; });
  }

  /* ------------------------------------------------------------------ Réseau CHSLD */
  async function vueReseau() {
    const v = $('#v-c-reseau');
    const [r, co] = await Promise.all([api('GET', `/chsld/reseau?etablissement_id=${ctx()}`), api('GET', `/coordinations?etablissement_id=${ctx()}`)]);
    const etabs = [...new Map(r.chsld.map((x) => [x.id, x])).values()];
    v.innerHTML = `<div class="entete"><div><h2>${C('reseau.titre')}</h2><p>${C('reseau.intro')}</p></div></div><p class="note">${C('reseau.non_garantie')}</p>
      <div class="panneau-c"><h3>${C('reseau.capacites')}</h3>${etabs.length ? etabs.map((e) => `<div class="item"><div><b>${esc(e.nom)}</b> <span class="note">${esc(e.ville || '')}</span>
        <ul class="liste-simple">${r.chsld.filter((x) => x.id === e.id).map((x) => `<li>${esc(x.unite)} : ${C('reseau.libres', { n: x.libres })} · ${C('reseau.confirmees', { n: x.confirmees })}</li>`).join('')}</ul></div></div>`).join('') : `<p class="note">${C('reseau.aucun')}</p>`}</div>
      <div class="panneau-c"><h3>${C('coord.type_transfert_chsld')}</h3><div class="liste">${co.filter((c) => c.type === 'transfert_chsld').map(carteCoordination).join('') || `<p class="note">${C('coord.aucune')}</p>`}</div></div>`;
    brancherCoordinations(v);
  }

  /* ------------------------------------------------------------------ Indicateurs */
  async function vueIndicateurs() {
    const v = $('#v-c-indicateurs');
    const i = await api('GET', `/chsld/indicateurs?etablissement_id=${ctx()}&jours=${etat.jours || 30}`);
    v.innerHTML = `<div class="entete"><div><h2>${C('indicateurs.titre')}</h2><p>${C('indicateurs.intro')}</p></div></div>
      <div class="tuiles">${tuile(C('indicateurs.occupation'), i.occupation == null ? '—' : pct(i.occupation))}${tuile(C('accueil.libres'), i.places.libres)}${tuile(C('accueil.preparation'), i.places.preparation)}
        ${tuile(C('indicateurs.delai'), i.delai_demande_jours == null ? '—' : t('chsld.indicateurs.jours', { n: nb(i.delai_demande_jours) }))}${tuile(C('indicateurs.preparation'), i.preparation_minutes == null ? '—' : t('chsld.indicateurs.minutes', { n: i.preparation_minutes }))}
        ${tuile(C('indicateurs.taches'), `${i.taches.faites} / ${i.taches.ouvertes} / ${i.taches.en_retard}`)}</div>
      <div class="panneau-c"><h3>${C('indicateurs.mouvements')}</h3>${Object.keys(i.mouvements).length ? `<ul class="liste-simple">${Object.entries(i.mouvements).filter(([k]) => k !== 'modification').map(([k, n]) => `<li>${C(`mvt.${k}`)} : <b class="num">${n}</b></li>`).join('')}</ul>` : `<p class="note">${C('fiche.aucun')}</p>`}</div>`;
  }

  window.ArrimoChsld = { vues: { 'c-accueil': vueAccueil, 'c-residents': vueResidents, 'c-chambres': vueChambres, 'c-demandes': vueDemandes, 'c-admissions': vueAdmissions,
    'c-taches': vueTaches, 'c-reseau': vueReseau, 'c-mouvements': vueMouvements, 'c-indicateurs': vueIndicateurs, liaison: vueLiaison } };
})();
