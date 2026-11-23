/* Arrimo Connect — messagerie interne (addendum du 21 nov. 2026) : icône ✉ avec non-lus, panneau latéral (le travail en cours reste
   à l'écran) : mes communications, contacter l'administration, nouveau message (annuaire), annonces. Droits vérifiés par le serveur. */
(() => {
  const TXT = {
    fr: { titre: 'Arrimo Connect', fermer: 'Fermer', mes: 'Mes communications', contacter: 'Contacter l’administration', nouveau: 'Nouveau message', annonces: 'Annonces',
      aucun: 'Aucune communication pour le moment.', sujet: 'Sujet', categorie: 'Catégorie', priorite: 'Priorité', message: 'Message', envoyer: 'Envoyer', destinataire: 'Destinataire', groupe_aide: 'Plusieurs destinataires (Ctrl ou Cmd) : conversation de groupe.', groupe: 'Groupe de {n}',
      normale: 'Normale', haute: 'Haute', envoye: 'Message envoyé.', repondre: 'Répondre', retour: '← Retour', administration: 'Administration', non_lus: 'non lus : {n}',
      st: { ouverte: 'Ouverte', en_cours: 'En cours', resolue: 'Résolue' }, marquer: 'Marquer', publier: 'Publier une annonce', titre_a: 'Titre', publie: 'Annonce publiée.', aucune_a: 'Aucune annonce.',
      urgence: 'Pour une urgence médicale, utilisez les canaux d’urgence officiels : Arrimo Connect ne les remplace pas.',
      cat: { message: 'Message', materiel: 'Demande de matériel', technique: 'Problème technique', administratif: 'Question administrative', planning: 'Problème de planning', soutien: 'Demande de soutien', signalement: 'Signalement opérationnel', autre: 'Autre demande' } },
    en: { titre: 'Arrimo Connect', fermer: 'Close', mes: 'My communications', contacter: 'Contact the administration', nouveau: 'New message', annonces: 'Announcements',
      aucun: 'No communication yet.', sujet: 'Subject', categorie: 'Category', priorite: 'Priority', message: 'Message', envoyer: 'Send', destinataire: 'Recipient', groupe_aide: 'Several recipients (Ctrl or Cmd): group conversation.', groupe: 'Group of {n}',
      normale: 'Normal', haute: 'High', envoye: 'Message sent.', repondre: 'Reply', retour: '← Back', administration: 'Administration', non_lus: '{n} unread',
      st: { ouverte: 'Open', en_cours: 'In progress', resolue: 'Resolved' }, marquer: 'Set', publier: 'Publish an announcement', titre_a: 'Title', publie: 'Announcement published.', aucune_a: 'No announcement.',
      urgence: 'For a medical emergency, use the official emergency channels: Arrimo Connect does not replace them.',
      cat: { message: 'Message', materiel: 'Equipment request', technique: 'Technical issue', administratif: 'Administrative question', planning: 'Scheduling issue', soutien: 'Support request', signalement: 'Operational report', autre: 'Other request' } },
  };
  const e = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = () => ((document.documentElement.lang || '').startsWith('en') ? 'en' : 'fr');
  const X = () => TXT[L()]; const T = (k, v = {}) => e(String(X()[k]).replace(/\{(\w+)\}/g, (m, y) => v[y] ?? m));
  const quand = (d) => new Date(d).toLocaleString(L() === 'en' ? 'en-CA' : 'fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const ctx = () => window.etat?.ctx || (typeof etat !== 'undefined' ? etat.ctx : null);
  const appel = (...a) => window.api(...a);
  const P = () => document.getElementById('messagerie-panneau');
  let onglet = 'mes'; let filOuvert = null; let dernierFocus = null;

  async function badge() {
    if (!ctx()) return;
    const d = await appel('GET', `/messagerie/fils?etablissement_id=${ctx()}`).catch(() => null); if (!d) return;
    const n = document.getElementById('n-messagerie'); if (n) { n.hidden = !d.non_lus; n.textContent = String(d.non_lus); }
    window.ArrimoSon?.compter(`msg:${ctx()}`, d.non_lus, 'message');   // son : chaque nouveau message
    return d;
  }
  function entete() {
    return `<div class="msg-tete"><h2 id="msg-titre"><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-mail"/></svg> ${T('titre')}</h2><button class="btn" type="button" data-msg-fermer>${T('fermer')}</button></div>
      <div class="msg-onglets" role="tablist">${['mes', 'contacter', 'nouveau', 'annonces'].map((k) => `<button type="button" role="tab" aria-selected="${onglet === k}" data-msg-onglet="${k}">${T(k)}</button>`).join('')}</div>`;
  }
  async function rendre() {
    const p = P(); const c = ctx(); if (!c) return;
    let corps = '';
    if (filOuvert) {
      const f = await appel('GET', `/messagerie/fils/${filOuvert}`);
      corps = `<button class="btn" type="button" data-msg-retour>${T('retour')}</button><h3>${e(f.fil.sujet || '')}</h3>${f.fil.statut ? `<p class="note">${e(X().st[f.fil.statut])}</p>` : ''}
        <div class="msg-fil">${f.messages.map((m) => `<div class="msg-bulle"><div class="note"><b>${e(m.expediteur)}</b> · ${quand(m.cree_le)}</div><p>${e(m.corps)}</p></div>`).join('')}</div>
        <form data-msg-repondre><label class="lbl" for="msg-rep">${T('repondre')}</label><textarea id="msg-rep" rows="3" maxlength="4000" required></textarea><p><button class="btn pri" type="submit">${T('envoyer')}</button></p></form>
        ${f.peut_traiter ? `<div class="ligne"><select id="msg-st">${Object.entries(X().st).map(([k, v]) => `<option value="${k}"${k === f.fil.statut ? ' selected' : ''}>${e(v)}</option>`).join('')}</select><button class="btn" type="button" data-msg-statut>${T('marquer')}</button></div>` : ''}`;
    } else if (onglet === 'mes') {
      const d = await badge();
      corps = d?.fils.length ? `<ul class="msg-liste">${d.fils.map((f) => `<li><button type="button" data-msg-fil="${f.id}" class="msg-ligne${f.non_lus ? ' non-lu' : ''}"><b>${e(f.sujet || '—')}</b>
        <span class="note">${f.membres ? T('groupe', { n: f.membres }) : f.boite ? T('administration') : e(f.expediteur_id === window.etat?.moi?.utilisateur?.id ? f.destinataire : f.expediteur)} · ${quand(f.dernier_le)}${f.statut ? ` · ${e(X().st[f.statut])}` : ''}${f.non_lus ? ` · <b>${T('non_lus', { n: f.non_lus })}</b>` : ''}</span></button></li>`).join('')}</ul>` : `<p class="note">${T('aucun')}</p>`;
    } else if (onglet === 'contacter' || onglet === 'nouveau') {
      const annu = onglet === 'nouveau' ? await appel('GET', `/messagerie/annuaire?etablissement_id=${c}`).catch(() => []) : [];
      corps = `<form data-msg-envoyer><p class="note">${T('urgence')}</p>
        ${onglet === 'nouveau' ? `<div class="champ"><label class="lbl" for="msg-dest">${T('destinataire')}</label><select id="msg-dest" required multiple size="5" aria-describedby="msg-dest-aide">${annu.map((x) => `<option value="${x.id}">${e(x.nom)} · ${e(typeof t === 'function' ? t(`roles.${x.role}`) : x.role)}</option>`).join('')}</select><p class="note" id="msg-dest-aide">${T('groupe_aide')}</p></div>`
          : `<div class="champ"><label class="lbl" for="msg-cat">${T('categorie')}</label><select id="msg-cat">${Object.entries(X().cat).filter(([k]) => k !== 'message').map(([k, v]) => `<option value="${k}">${e(v)}</option>`).join('')}</select></div>
          <div class="champ"><label class="lbl" for="msg-prio">${T('priorite')}</label><select id="msg-prio"><option value="normale">${T('normale')}</option><option value="haute">${T('haute')}</option></select></div>`}
        <div class="champ"><label class="lbl" for="msg-sujet">${T('sujet')}</label><input id="msg-sujet" maxlength="120" required></div>
        <div class="champ"><label class="lbl" for="msg-corps">${T('message')}</label><textarea id="msg-corps" rows="5" maxlength="4000" required></textarea></div>
        <p><button class="btn pri" type="submit">${T('envoyer')}</button></p></form>`;
    } else {
      const a = await appel('GET', `/messagerie/annonces?etablissement_id=${c}`).catch(() => []);
      const admin = window.etat?.moi?.utilisateur?.role === 'admin_etab';
      corps = `${a.length ? `<ul class="msg-liste">${a.map((x) => `<li class="msg-bulle"><b>${e(x.titre)}</b><div class="note">${e(x.auteur)} · ${quand(x.cree_le)}</div><p>${e(x.corps)}</p></li>`).join('')}</ul>` : `<p class="note">${T('aucune_a')}</p>`}
        ${admin ? `<form data-msg-annonce><h3>${T('publier')}</h3><div class="champ"><label class="lbl" for="ann-t">${T('titre_a')}</label><input id="ann-t" maxlength="120" required></div><div class="champ"><label class="lbl" for="ann-c">${T('message')}</label><textarea id="ann-c" rows="4" required></textarea></div><p><button class="btn pri" type="submit">${T('publier')}</button></p></form>` : ''}`;
    }
    p.innerHTML = entete() + `<div class="msg-corps">${corps}</div>`;
    lier(p);
  }
  function lier(p) {
    p.querySelector('[data-msg-fermer]').onclick = fermer;
    p.querySelectorAll('[data-msg-onglet]').forEach((b) => { b.onclick = () => { onglet = b.dataset.msgOnglet; filOuvert = null; rendre(); }; });
    p.querySelectorAll('[data-msg-fil]').forEach((b) => { b.onclick = () => { filOuvert = Number(b.dataset.msgFil); rendre().then(badge); }; });
    p.querySelector('[data-msg-retour]')?.addEventListener('click', () => { filOuvert = null; rendre(); });
    p.querySelector('[data-msg-repondre]')?.addEventListener('submit', async (ev) => { ev.preventDefault(); try { await appel('POST', '/messagerie/messages', { etablissement_id: ctx(), fil_id: filOuvert, corps: p.querySelector('#msg-rep').value }); window.toast?.(X().envoye); } catch (err) { window.toast?.(err.message, true); } rendre(); });
    p.querySelector('[data-msg-statut]')?.addEventListener('click', async () => { try { await appel('POST', `/messagerie/fils/${filOuvert}/statut`, { statut: p.querySelector('#msg-st').value }); } catch (err) { window.toast?.(err.message, true); } rendre(); });
    p.querySelector('[data-msg-envoyer]')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const choisis = onglet === 'nouveau' ? [...p.querySelector('#msg-dest').selectedOptions].map((o) => Number(o.value)) : [];
      const corps = onglet === 'nouveau' ? (choisis.length > 1 ? { destinataires: choisis } : { destinataire_id: choisis[0] }) : { boite: 'administration', categorie: p.querySelector('#msg-cat').value, priorite: p.querySelector('#msg-prio').value };
      try { await appel('POST', '/messagerie/messages', { etablissement_id: ctx(), ...corps, sujet: p.querySelector('#msg-sujet').value, corps: p.querySelector('#msg-corps').value }); window.toast?.(X().envoye); onglet = 'mes'; } catch (err) { window.toast?.(err.message, true); }
      rendre();
    });
    p.querySelector('[data-msg-annonce]')?.addEventListener('submit', async (ev) => { ev.preventDefault(); try { await appel('POST', '/messagerie/annonces', { etablissement_id: ctx(), titre: p.querySelector('#ann-t').value, corps: p.querySelector('#ann-c').value }); window.toast?.(X().publie); } catch (err) { window.toast?.(err.message, true); } rendre(); });
  }
  function ouvrir(o = 'mes') { dernierFocus = document.activeElement; onglet = o; filOuvert = null; P().hidden = false; rendre().then(() => P().querySelector('[data-msg-fermer]')?.focus()); }
  function fermer() { P().hidden = true; dernierFocus?.focus?.(); }
  document.addEventListener('click', (ev) => { if (ev.target.closest('#b-messagerie')) ouvrir(); const c = ev.target.closest('[data-connect-ouvrir]'); if (c) ouvrir(c.dataset.connectOuvrir || 'mes'); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && P() && !P().hidden) fermer(); });
  setInterval(() => { if (document.visibilityState === 'visible') badge(); }, 60000);
  setTimeout(badge, 2500);
  window.ArrimoConnectInterne = { ouvrir, badge };
})();
