/* Communication établissement ↔ ambulances et CCS (cahier « Interconnexion permanente », 28 nov. 2026). Panneau commun de
   Urgences → Secours 911 (hôpital et hébergement) : ambulances liées aux missions en cours de l'établissement, messages rapides,
   accusés de lecture. Mise à jour par le signal en direct existant (aucune actualisation manuelle). Rien ici ne retarde un appel au 911. */
(() => {
  const TX = {
    fr: { titre: 'Ambulances et CCS de vos missions en cours', aucune: 'Aucune ambulance liée à une mission en cours.', unite: 'Ambulance', envoyer: 'Envoyer',
      texte: 'Message court (sans donnée clinique)', lu: 'lu', marquer: 'Confirmer la lecture', ccs: 'CCS', ambulance: 'Équipage', vous: 'Vous', envoye: 'Envoyé.',
      r_bien_recu: 'Bien reçu', r_accueil_pret: 'Accueil prêt', r_resident_pret: 'Résident prêt', r_preparation_en_cours: 'Préparation en cours', r_retard_preparation: 'Préparation retardée', r_appelez_nous: 'Appelez-nous',
      r_en_route: 'En route', r_retard_trafic: 'Retard (circulation)', r_attente_civiere: 'Attente de civière', r_besoin_assistance: 'Besoin d’assistance', r_incident_vehicule: 'Incident véhicule',
      r_disponible: 'De nouveau disponible', r_appelez_ccs: 'Appelez le CCS', r_nouvelle_destination: 'Nouvelle destination transmise', r_attendre_instructions: 'Attendez les instructions', r_retour_base: 'Retour à la base', r_priorite_modifiee: 'Priorité modifiée' },
    en: { titre: 'Ambulances and CCS of your ongoing missions', aucune: 'No ambulance linked to an ongoing mission.', unite: 'Ambulance', envoyer: 'Send',
      texte: 'Short message (no clinical data)', lu: 'read', marquer: 'Confirm reading', ccs: 'CCS', ambulance: 'Crew', vous: 'You', envoye: 'Sent.',
      r_bien_recu: 'Received', r_accueil_pret: 'Reception ready', r_resident_pret: 'Resident ready', r_preparation_en_cours: 'Preparation under way', r_retard_preparation: 'Preparation delayed', r_appelez_nous: 'Call us',
      r_en_route: 'On the way', r_retard_trafic: 'Delayed (traffic)', r_attente_civiere: 'Waiting for a stretcher', r_besoin_assistance: 'Need assistance', r_incident_vehicule: 'Vehicle incident',
      r_disponible: 'Available again', r_appelez_ccs: 'Call the CCS', r_nouvelle_destination: 'New destination sent', r_attendre_instructions: 'Wait for instructions', r_retour_base: 'Return to base', r_priorite_modifiee: 'Priority changed' },
  };
  const L = () => ((document.documentElement.lang || 'fr').startsWith('en') ? 'en' : 'fr');
  const T = (k) => esc(TX[L()][k] ?? TX.fr[k] ?? k);
  async function panneau(v) {
    if (!v || !etat?.ctx) return;
    const d = await api('GET', `/etablissement/flotte?etablissement_id=${etat.ctx}`).catch(() => null);
    if (!d) return;
    v.querySelector(':scope > .comm-flotte')?.remove();
    const z = document.createElement('section'); z.className = 'panneau-c comm-flotte';
    const qui = (m) => (m.sens === 'ccs' ? T('ccs') : m.sens === 'ambulance' ? T('ambulance') : T('vous'));
    z.innerHTML = `<h3>${T('titre')}</h3>${d.unites.length ? d.unites.map((u) => `<div class="item" data-cf-u="${esc(u.numero)}"><div><b class="num">${esc(u.numero)}</b> · <span class="num">${esc(u.mission || '')}</span>${u.etat ? ` · ${esc(t(`transports.ev.${u.etat}`))}` : ''}${u.modifie_le ? ` · <b class="num duree-seule" data-depuis="${esc(u.modifie_le)}">--:--:--</b>` : ''}
        <div class="rapides">${d.rapides.map((r) => `<button type="button" class="btn" data-cf-rapide="${r}" data-cf-unite="${u.id}">${T(`r_${r}`)}</button>`).join('')}</div>
        <form class="ligne" data-cf-form="${u.id}"><input name="texte" maxlength="200" aria-label="${T('texte')}" placeholder="${T('texte')}" autocomplete="off"><button class="btn" type="submit">${T('envoyer')}</button></form></div></div>`).join('') : `<p class="note">${T('aucune')}</p>`}
      ${d.messages.length ? `<div class="fil-msg">${d.messages.slice(0, 15).map((m) => `<p class="msg msg-${esc(m.sens)}"><b>${qui(m)}</b> · <span class="num">${esc(m.unite)}</span> · ${m.code_rapide ? T(`r_${m.code_rapide}`) : ''} ${esc(m.texte || '')}
        <span class="note num">${esc(heure(m.cree_le))}${m.lu_le ? ` · ${T('lu')}` : m.sens !== 'etablissement' ? ` · <button type="button" class="lien" data-cf-lu="${m.id}">${T('marquer')}</button>` : ''}</span></p>`).join('')}</div>` : ''}`;
    v.appendChild(z);
    const cle = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const poster = async (corps) => { try { await api('POST', '/etablissement/flotte/messages', { etablissement_id: etat.ctx, cle: cle(), ...corps }); toast(TX[L()].envoye); } catch (e) { toast(e.message, true); } panneau(v); };
    z.querySelectorAll('[data-cf-rapide]').forEach((b) => { b.onclick = () => poster({ unite_id: Number(b.dataset.cfUnite), code_rapide: b.dataset.cfRapide }); });
    z.querySelectorAll('[data-cf-form]').forEach((f) => { f.onsubmit = (e) => { e.preventDefault(); const t = f.texte.value.trim(); if (t) poster({ unite_id: Number(f.dataset.cfForm), texte: t }); }; });
    z.querySelectorAll('[data-cf-lu]').forEach((b) => { b.onclick = async () => { await api('POST', `/etablissement/flotte/messages/${b.dataset.cfLu}/lu`, {}).catch((e) => toast(e.message, true)); panneau(v); }; });
  }
  window.ArrimoCommFlotte = { panneau, TX };
})();
