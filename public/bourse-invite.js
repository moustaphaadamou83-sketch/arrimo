/* Bourse des places, accès invité (20 nov. 2026) : lien nominatif de 7 jours ; la bourse (même classement, même ordre que pour un
   abonné) et l'envoi d'une demande, rien d'autre. Le jeton reste dans l'ancre de l'adresse (jamais envoyé dans les journaux du serveur web). */
(() => {
  const TXT = {
    fr: { titre: 'Bourse des places', intro: 'Accès invité, valable jusqu’au {d}. Classement : besoins couverts et proximité seulement ; aucun abonnement ni paiement n’entre dans le calcul.',
      invalide: 'Ce lien n’est plus valide (expiré ou révoqué). Demandez un nouveau lien à l’établissement qui vous a invité.', ressource: 'Ressource', libres: 'Places libres', a_venir: 'À venir (14 jours)',
      distance: 'Distance (km)', score: 'Score', aucune: 'Aucune place disponible.', demander: 'Envoyer une demande', reference: 'Votre référence (dossier, sans nom)', envoyee: 'Demande {n} envoyée.',
      erreur: 'Envoi impossible : vérifiez la référence.' },
    en: { titre: 'Placement exchange', intro: 'Guest access, valid until {d}. Ranking: needs covered and proximity only; no subscription or payment enters the calculation.',
      invalide: 'This link is no longer valid (expired or revoked). Ask the facility that invited you for a new link.', ressource: 'Resource', libres: 'Free places', a_venir: 'Upcoming (14 days)',
      distance: 'Distance (km)', score: 'Score', aucune: 'No place available.', demander: 'Send a request', reference: 'Your reference (file, no name)', envoyee: 'Request {n} sent.',
      erreur: 'Could not send: check the reference.' },
  };
  let L = (() => { try { return localStorage.getItem('arrimo-langue') === 'en' ? 'en' : 'fr'; } catch { return 'fr'; } })();
  const jeton = decodeURIComponent(location.hash.slice(1));
  const t = (k, v = {}) => String(TXT[L][k]).replace(/\{(\w+)\}/g, (m, x) => (v[x] ?? m));
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let d = null; let message = '';
  async function charger() {
    const r = await fetch('/api/invite/bourse', { headers: { 'X-Invitation': jeton, 'X-Langue': L } });
    d = r.ok ? await r.json() : null; rendre();
  }
  function rendre() {
    document.documentElement.lang = L === 'en' ? 'en-CA' : 'fr-CA';
    document.getElementById('bi-titre').textContent = t('titre');
    if (!d) { document.getElementById('bi-intro').textContent = t('invalide'); document.getElementById('bi-corps').innerHTML = ''; return; }
    document.getElementById('bi-intro').textContent = t('intro', { d: new Date(d.invite.expire_le).toLocaleDateString(L === 'en' ? 'en-CA' : 'fr-CA') });
    document.getElementById('bi-corps').innerHTML = `${message ? `<p class="bandeau" role="status">${esc(message)}</p>` : ''}${d.places.length ? `<div class="tableau"><table><thead><tr><th>${t('ressource')}</th><th>${t('libres')}</th><th>${t('a_venir')}</th><th>${t('distance')}</th><th>${t('score')}</th><th></th></tr></thead><tbody>
      ${d.places.map((p) => `<tr><td>${esc(p.nom)}</td><td>${p.libres}</td><td>${p.a_venir}</td><td>${p.distance_km ?? '—'}</td><td>${p.score}/100</td>
        <td><input aria-label="${esc(t('reference'))}" placeholder="${esc(t('reference'))}" data-ref="${p.id}" maxlength="20"> <button class="btn" data-demander="${p.id}">${t('demander')}</button></td></tr>`).join('')}</tbody></table></div>` : `<p class="note">${t('aucune')}</p>`}`;
  }
  document.addEventListener('click', async (e) => {
    const l = e.target.closest('[data-bi-langue]'); if (l) { L = l.dataset.biLangue; try { localStorage.setItem('arrimo-langue', L); } catch { /* */ } rendre(); return; }
    const b = e.target.closest('[data-demander]'); if (!b) return;
    const ref = document.querySelector(`[data-ref="${b.dataset.demander}"]`).value.trim();
    const r = await fetch('/api/invite/bourse/demandes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Invitation': jeton }, body: JSON.stringify({ etablissement_id: Number(b.dataset.demander), reference: ref }) });
    message = r.ok ? t('envoyee', { n: (await r.json()).numero }) : t('erreur'); rendre();
  });
  charger();
})();
