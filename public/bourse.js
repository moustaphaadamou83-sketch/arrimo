/* Bourse des places (20 nov. 2026, cahier v2, C.5) : places libres et à venir, filtres (type, besoins, distance), classement expliqué
   (besoins couverts 60 + proximité 40 ; aucun abonnement ni paiement dans le calcul), fiche d'une page imprimable sans diagnostic,
   liens invités nominatifs (7 jours, révocables). */
(() => {
  const B = (k, v) => esc(t(`bourse.${k}`, v));
  const F = { genre: '', besoins: [], distance_max: '' };
  async function vue() {
    const v = $('#v-bourse');
    const q = new URLSearchParams({ etablissement_id: etat.ctx, ...(F.genre ? { genre: F.genre } : {}), ...(F.besoins.length ? { besoins: F.besoins.join(',') } : {}), ...(F.distance_max ? { distance_max: F.distance_max } : {}) });
    const [d, inv] = await Promise.all([api('GET', `/bourse?${q}`), api('GET', `/bourse/invitations?etablissement_id=${etat.ctx}`).catch(() => [])]);
    if (!d) return;
    const hopital = (etabCtx().type_etablissement || 'hopital') === 'hopital';
    const lits = hopital ? ((await api('GET', `/lits?etablissement_id=${etat.ctx}`).catch(() => [])) || []).filter((l) => l.nsa_depuis) : [];
    const raison = (p) => B('raison', { couverts: p.raison.besoins_couverts, demandes: p.raison.besoins_demandes, pb: p.raison.points_besoins, km: p.raison.km ?? '—', pp: p.raison.points_proximite });
    v.innerHTML = `<div class="entete"><div><h2>${B('titre')}</h2><p class="note">${B('intro', { besoins: d.formule.besoins, proximite: d.formule.proximite })}</p></div></div>
      <section class="panneau-c"><div class="ligne">
        <div class="champ"><label class="lbl" for="bo-genre">${B('type')}</label><select id="bo-genre"><option value="">${B('tous')}</option>${d.genres.map((g) => `<option value="${g}"${F.genre === g ? ' selected' : ''}>${B(`g_${g}`)}</option>`).join('')}</select></div>
        <div class="champ"><label class="lbl" for="bo-dist">${B('distance')}</label><select id="bo-dist">${['', '10', '25', '50', '100'].map((x) => `<option value="${x}"${F.distance_max === x ? ' selected' : ''}>${x ? B('km', { n: x }) : B('toute_distance')}</option>`).join('')}</select></div></div>
        <fieldset class="cases"><legend class="lbl">${B('besoins')}</legend>${['marchette', 'fauteuil', 'leve_personne', 'unite_securisee', 'oxygene', 'soins_particuliers'].map((c) => `<label class="case"><input type="checkbox" data-bo-besoin="${c}"${F.besoins.includes(c) ? ' checked' : ''}> ${B(`b_${c}`)}</label>`).join('')}</fieldset></section>
      <section class="panneau-c">${d.places.length ? `<div class="tableau"><table><thead><tr><th>${B('ressource')}</th><th>${B('type')}</th><th>${B('libres')}</th><th>${B('a_venir')}</th><th>${B('distance')}</th><th>${B('score')}</th><th>${B('pourquoi')}</th></tr></thead><tbody>
        ${d.places.map((p) => `<tr><td><strong>${esc(p.nom)}</strong>${p.groupe ? ` <span class="note">${B('groupe', { g: p.groupe })}</span>` : ''}</td><td>${B(`g_${p.genre}`)}</td><td>${p.libres}</td><td>${p.a_venir}${p.prochaine ? ` · ${esc(p.prochaine)}` : ''}</td>
          <td>${p.distance_km ?? '—'}</td><td><strong>${p.score}</strong>/100</td><td class="note">${raison(p)}${p.raison.manquants.length ? ` · ${B('manque', { liste: p.raison.manquants.map((m) => t(`bourse.b_${m}`)).join(', ') })}` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<p class="note">${B('aucune')}</p>`}
        <p class="note">${B('neutralite')}</p></section>
      ${hopital ? `<section class="panneau-c"><h3>${B('fiche_titre')}</h3>${lits.length ? `<div class="ligne"><select id="bo-lit">${lits.map((l) => `<option value="${l.id}">${esc(l.code)} · ${esc(l.patient_ref)}</option>`).join('')}</select><button class="btn" id="bo-fiche">${B('imprimer')}</button></div>` : `<p class="note">${B('aucun_nsa')}</p>`}</section>` : ''}
      <section class="panneau-c"><h3>${B('invites')}</h3><p class="note">${B('invites_aide')}</p><button class="btn" id="bo-inviter">${B('inviter')}</button>
        ${inv.length ? `<ul class="liste-simple">${inv.map((i) => `<li>${esc(i.nom)} · ${esc(i.organisation)} · ${esc(i.courriel)} · ${i.active ? B('expire', { d: heure(i.expire_le) }) : B('inactive')}${i.active ? ` <button class="btn discret" data-bo-revoquer="${i.id}">${B('revoquer')}</button>` : ''}</li>`).join('')}</ul>` : ''}</section>`;
    $('#bo-genre').onchange = (e) => { F.genre = e.target.value; vue(); };
    $('#bo-dist').onchange = (e) => { F.distance_max = e.target.value; vue(); };
    v.querySelectorAll('[data-bo-besoin]').forEach((c) => { c.onchange = () => { F.besoins = [...v.querySelectorAll('[data-bo-besoin]:checked')].map((x) => x.dataset.boBesoin); vue(); }; });
    if ($('#bo-fiche')) $('#bo-fiche').onclick = () => imprimer($('#bo-lit').value);
    $('#bo-inviter').onclick = inviter;
    v.querySelectorAll('[data-bo-revoquer]').forEach((b) => { b.onclick = () => agir(b, () => api('POST', `/bourse/invitations/${b.dataset.boRevoquer}/revoquer`), t('bourse.revoque_ok')); });
  }
  async function imprimer(litId) {
    const f = await api('GET', `/bourse/fiche/${litId}`).catch((e) => { toast(e.message, true); return null; });
    if (!f) return;
    const w = window.open('', '_blank'); if (!w) { toast(t('bourse.popup'), true); return; }
    const ligne = (k, val) => `<tr><th style="text-align:left;padding:4px 12px 4px 0">${esc(t(`bourse.f_${k}`))}</th><td>${esc(val)}</td></tr>`;
    w.document.write(`<!doctype html><html lang="${langue === 'en' ? 'en-CA' : 'fr-CA'}"><head><meta charset="utf-8"><title>${B('fiche_titre')}</title></head><body style="font:14px system-ui;margin:24px;color:#1F2937">
      <h1 style="font-size:20px;color:#0E5E6F">${B('fiche_titre')}</h1><table>${ligne('reference', f.reference)}${ligne('hopital', `${f.hopital}${f.ville ? `, ${f.ville}` : ''}`)}${ligne('lit', f.lit)}
      ${ligne('orientation', t(`orientations.${f.orientation}`) || f.orientation || '—')}${ligne('jours_nsa', String(f.jours_nsa))}${ligne('tranche_age', f.tranche_age ? t(`bourse.age_${f.tranche_age}`) : '—')}
      ${ligne('besoins', f.besoins.length ? f.besoins.map((b) => t(`bourse.b_${b}`)).join(', ') : t('bourse.aucun_besoin'))}${ligne('langue', f.langue ? f.langue.toUpperCase() : '—')}${ligne('date', f.date_souhaitee)}</table>
      <p style="margin-top:16px;color:#64748B">${B('sans_diagnostic')}</p></body></html>`);
    w.document.close(); w.focus(); w.print();
  }
  function inviter() {
    modale(t('bourse.inviter'), `<p class="note">${B('invites_aide')}</p>
      <div class="champ"><label class="lbl" for="bo-i-nom">${B('i_nom')}</label><input id="bo-i-nom" maxlength="120"></div>
      <div class="champ"><label class="lbl" for="bo-i-org">${B('i_org')}</label><input id="bo-i-org" maxlength="120"></div>
      <div class="champ"><label class="lbl" for="bo-i-courriel">${B('i_courriel')}</label><input id="bo-i-courriel" type="email" maxlength="160"></div>`,
    [{ label: t('general.annuler') }, { label: t('bourse.inviter'), pri: true, run: async () => {
      const r = await agir(null, () => api('POST', '/bourse/invitations', { etablissement_id: etat.ctx, nom: $('#bo-i-nom').value, organisation: $('#bo-i-org').value, courriel: $('#bo-i-courriel').value }));
      if (!r) return false;
      modale(t('bourse.lien_titre'), `<p>${B('lien_aide')}</p><p class="secret donnee">${esc(`${location.origin}${r.lien}`)}</p>`, [{ label: t('general.fermer') }]);
      return false;
    } }]);
  }
  window.ArrimoBourse = { vues: { bourse: vue } };
})();
