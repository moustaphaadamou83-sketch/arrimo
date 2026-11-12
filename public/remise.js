/* Récupération unique d'un accès de connexion (contact technique du client). Le jeton reste dans le fragment de l'adresse
   (jamais envoyé dans les journaux du serveur web) ; l'accès n'est affiché qu'ici, une seule fois, puis effacé du serveur. */
(() => {
  const en = /^en\b/i.test(navigator.language || '');
  const T = en ? { titre: 'Arrimo connection access', aide: 'This link works only once. Keep the values below in your secret manager: they will never be shown again.', bouton: 'Show the access (once)',
    cle: 'Key', secret: 'Signing secret', fini: 'Retrieved. The link no longer works.', invalide: 'Invalid, already used or expired link. Ask your Arrimo contact for a new access.' }
    : { titre: 'Accès de connexion Arrimo', aide: 'Ce lien ne fonctionne qu’une fois. Rangez les valeurs ci-dessous dans votre gestionnaire de secrets : elles ne seront plus jamais affichées.', bouton: 'Afficher l’accès (une seule fois)',
      cle: 'Clé', secret: 'Secret de signature', fini: 'Accès récupéré. Le lien ne fonctionne plus.', invalide: 'Lien invalide, déjà utilisé ou expiré. Demandez un nouvel accès à votre contact Arrimo.' };
  const z = document.getElementById('contenu');
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const jeton = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);   // le jeton quitte la barre d'adresse et l'historique
  z.innerHTML = `<h1>${T.titre}</h1><p>${T.aide}</p><button class="btn pri" id="b">${T.bouton}</button>`;
  document.getElementById('b').onclick = async () => {
    const r = await fetch('/api/remise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jeton }) });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d) { z.innerHTML = `<h1>${T.titre}</h1><p>${T.invalide}</p>`; return; }
    z.innerHTML = `<h1>${T.titre}</h1><p>${T.fini}</p><p><b>${T.cle}</b></p><code>${esc(d.cle)}</code>${d.secret ? `<p><b>${T.secret}</b></p><code>${esc(d.secret)}</code>` : ''}`;
  };
})();
