'use strict';
/* Réponse d'un participant à une invitation de formation : lien personnel à usage unique (#jeton=…), sans session. */
(function () {
  const jeton = new URLSearchParams(location.hash.slice(1)).get('jeton') || '';
  history.replaceState(null, '', location.pathname);   // le jeton ne reste ni dans l'adresse ni dans l'historique
  const etat = document.getElementById('fr-etat'); const form = document.getElementById('fr-form');
  const p = (texte, classe) => { const e = document.createElement('p'); e.textContent = texte; if (classe) e.className = classe; return e; };
  const afficher = (...noeuds) => { etat.replaceChildren(...noeuds); };
  const appel = async (chemin, corps) => {
    const r = await fetch(`api/${chemin}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
    const c = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(c.erreur || 'Erreur. Réessayez plus tard.');
    return c;
  };
  if (!jeton) { afficher(p('Lien incomplet. Ouvrez le lien reçu par courriel.', 'erreur')); return; }
  appel('formation-reponse/lire', { jeton }).then((s) => {
    const dl = document.createElement('dl');
    for (const [k, v] of [['Séance', s.titre], ['Établissement', s.etablissement], ['Date', s.quand], ['Durée', `${s.duree_minutes} minutes`], ['Lieu', s.lieu], ['Visio', s.visio_url]]) {
      if (!v) continue;
      const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd);
    }
    afficher(p(`Bonjour ${s.nom},`), dl);
    form.hidden = false;
  }).catch((e) => afficher(p(e.message, 'erreur')));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const reponse = form.querySelector('input[name="reponse"]:checked').value;
    const bouton = form.querySelector('button'); bouton.disabled = true;
    try {
      await appel('formation-reponse/repondre', { jeton, reponse, note: document.getElementById('fr-note').value });
      form.hidden = true;
      afficher(p({ confirme: 'Merci : votre présence est confirmée. Votre formateur est prévenu.', autre_moment: 'Merci : votre proposition est transmise à votre formateur, qui vous recontactera.', decline: 'Merci : votre absence est notée. Votre formateur est prévenu.' }[reponse]));
    } catch (e) { bouton.disabled = false; afficher(p(e.message, 'erreur')); }
  });
}());
