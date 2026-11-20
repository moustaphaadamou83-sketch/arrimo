/* 🎓 Ma formation (22 nov. 2026, lot 1) : mon parcours, ma progression, capsules courtes (scènes + sous-titres + voix si fournie),
   « À vous de jouer » (bac à sable, lot 2), mini-test noté et chronométré par le serveur. FR/EN, clavier, mode sombre, téléphone. */
(() => {
  const TXT = {
    fr: { titre_barre: '🎓 Ma formation', evitement: 'Aller au contenu', bonjour: 'Ma formation', reussies: 'Capsules réussies : {r} sur {t}', aucune: 'Bravo : toutes vos capsules sont réussies.',
      continuer: 'Continuer : {t} · {d} min', commencer: 'Commencer : {t} · {d} min', mes_parcours: 'Mes parcours', ajouter: 'Choisissez vos parcours (selon votre rôle) :',
      etat: { a_faire: 'À faire', en_cours: 'En cours', reussi: 'Réussi', preparation: 'En préparation' }, min: '{d} min', score: '{s} %',
      inactif: 'La formation n’est pas encore activée pour votre établissement. Votre administrateur peut l’activer depuis Arrimo SH.', retour: '← Ma formation',
      etapes: ['1. Regarder', '2. À vous de jouer', '3. Mini-test'], precedent: 'Précédent', suivant: 'Suivant', lecture: 'Lecture', pause: 'Pause', fictif: 'Données fictives',
      fin_scenes: 'Vous avez vu la capsule. Passez à la pratique.', exercice_titre: 'À vous de jouer', exercice_bientot: 'L’exercice guidé dans le bac à sable arrive bientôt : il se fera sur des données fictives, avec des bulles « cliquez ici ».',
      test_titre: 'Mini-test', test_intro: '3 questions. Il faut 2 bonnes réponses sur 3.', test_chrono: 'Test chronométré : {s} secondes.', demarrer: 'Commencer le test', valider: 'Valider mes réponses',
      reussi: 'Capsule réussie !', rate: 'Pas encore : {s} %. Revoyez la capsule et recommencez.', hors_temps: 'Temps dépassé : recommencez quand vous êtes prêt.', recommencer: 'Recommencer', suivante: 'Capsule suivante', capsule_vue: 'Revoir la capsule',
      reponse_manquante: 'Répondez aux trois questions.', erreur: 'Une erreur est survenue. Réessayez.', voix: 'Voix' },
    en: { titre_barre: '🎓 My training', evitement: 'Skip to content', bonjour: 'My training', reussies: 'Lessons passed: {r} of {t}', aucune: 'Well done: all your lessons are passed.',
      continuer: 'Continue: {t} · {d} min', commencer: 'Start: {t} · {d} min', mes_parcours: 'My paths', ajouter: 'Choose your paths (based on your role):',
      etat: { a_faire: 'To do', en_cours: 'In progress', reussi: 'Passed', preparation: 'Coming soon' }, min: '{d} min', score: '{s}%',
      inactif: 'Training is not turned on for your facility yet. Your administrator can turn it on from Arrimo SH.', retour: '← My training',
      etapes: ['1. Watch', '2. Your turn', '3. Quick test'], precedent: 'Previous', suivant: 'Next', lecture: 'Play', pause: 'Pause', fictif: 'Fictitious data',
      fin_scenes: 'You have watched the lesson. Time to practise.', exercice_titre: 'Your turn', exercice_bientot: 'The guided exercise in the sandbox is coming soon: it will use fictitious data, with “click here” bubbles.',
      test_titre: 'Quick test', test_intro: '3 questions. You need 2 correct answers out of 3.', test_chrono: 'Timed test: {s} seconds.', demarrer: 'Start the test', valider: 'Submit my answers',
      reussi: 'Lesson passed!', rate: 'Not yet: {s}%. Review the lesson and try again.', hors_temps: 'Time is up: try again when you are ready.', recommencer: 'Try again', suivante: 'Next lesson', capsule_vue: 'Watch the lesson again',
      reponse_manquante: 'Answer all three questions.', erreur: 'Something went wrong. Please try again.', voix: 'Voice' },
  };
  window.ArrimoFormation = { TXT };
  const lire = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const ecrire = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };
  let L = lire('arrimo-langue') === 'en' ? 'en' : 'fr';
  const jeton = lire('arrimo-token');
  const X = () => TXT[L];
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
  const main = document.getElementById('principal');
  let donnees = null; let minuterie = null; let lecture = null;

  async function api(methode, chemin, corps) {
    const r = await fetch(`/api${chemin}`, { method: methode, headers: { Authorization: `Bearer ${jeton}`, 'X-Langue': L, 'Content-Type': 'application/json' }, body: corps ? JSON.stringify(corps) : undefined });
    if (r.status === 401) { location.replace('/'); throw new Error('session'); }
    const d = await r.json().catch(() => null);
    if (!r.ok || d === null) throw new Error((d && d.erreur) || X().erreur);
    return d;
  }
  function entete() {
    document.documentElement.lang = L === 'en' ? 'en-CA' : 'fr-CA';
    document.getElementById('fo-titre-barre').textContent = X().titre_barre;
    document.getElementById('lien-evitement').textContent = X().evitement;
    document.title = `Arrimo · ${X().titre_barre.replace('🎓 ', '')}`;
    document.querySelectorAll('[data-fo-langue]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.foLangue === L)));
  }
  const anneau = (pct) => {
    const r = 54; const c = 2 * Math.PI * r;
    return `<div class="fo-anneau" role="img" aria-label="${pct} %"><svg viewBox="0 0 132 132" aria-hidden="true"><defs><linearGradient id="fo-degrade" x1="0" x2="1"><stop offset="0" stop-color="#159895"/><stop offset="1" stop-color="#57C5B6"/></linearGradient></defs>
      <circle class="fond" cx="66" cy="66" r="${r}"/><circle class="barre" cx="66" cy="66" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"/></svg><span class="pct">${pct} %</span></div>`;
  };
  const carte = (c) => `<button type="button" class="fo-carte" data-capsule="${esc(c.code)}"${c.etat === 'preparation' ? ' disabled' : ''}>
      ${c.etat === 'reussi' ? '<span class="fo-badge" aria-hidden="true">✓</span>' : ''}<span class="em" aria-hidden="true">${c.emoji}</span><h3>${esc(c.titre)}</h3>
      <span class="meta"><span class="fo-etat ${c.etat}">${esc(X().etat[c.etat])}</span><span>⏱ ${esc(f(X().min, { d: Math.max(1, Math.round(c.duree / 60)) }))}</span>${c.score != null && c.etat !== 'reussi' ? `<span>${esc(f(X().score, { s: c.score }))}</span>` : ''}</span></button>`;

  async function accueil() {
    arreter();
    try { donnees = await api('GET', '/formation/moi'); } catch (e) { main.innerHTML = `<p class="fo-note" role="alert">${esc(e.message)}</p>`; return; }
    if (!donnees.actif) { main.innerHTML = `<div class="fo-heros" style="grid-template-columns:1fr"><div><h1>${esc(X().bonjour)}</h1><p>${esc(X().inactif)}</p></div></div>`; return; }
    const p = donnees.prochaine;
    main.innerHTML = `<section class="fo-heros">${anneau(donnees.progression)}<div><h1>${esc(X().bonjour)}</h1><p>${esc(donnees.total ? f(X().reussies, { r: donnees.reussies, t: donnees.total }) : '')}</p>
        ${p ? `<button class="fo-bouton" data-capsule="${esc(p.code)}">${p.emoji} ${esc(f(donnees.reussies ? X().continuer : X().commencer, { t: p.titre, d: Math.max(1, Math.round(p.duree / 60)) }))}</button>` : `<p>${esc(X().aucune)}</p>`}</div></section>
      <div class="fo-puces" role="group" aria-label="${esc(X().mes_parcours)}"><span class="fo-note">${esc(X().ajouter)}</span>${donnees.eligibles.map((e) => `<button type="button" class="fo-puce" data-parcours="${esc(e.code)}" aria-pressed="${e.choisi}">${e.emoji} ${esc(e.nom)}</button>`).join('')}</div>
      ${donnees.parcours.map((pc) => `<section class="fo-section"><div class="fo-section-tete"><h2>${pc.emoji} ${esc(pc.nom)}</h2><span>${pc.reussies}/${pc.total}</span></div><div class="fo-grille">${pc.capsules.map(carte).join('')}</div></section>`).join('')}`;
  }

  // ---------------------------------------------------------------- capsule
  function arreter() { clearInterval(minuterie); minuterie = null; clearTimeout(lecture?.t); lecture?.audio?.pause(); lecture = null; }
  async function capsule(code) {
    arreter();
    let c; try { c = await api('GET', `/formation/capsules/${encodeURIComponent(code)}`); } catch (e) { main.innerHTML = `<button class="fo-retour" data-accueil>${esc(X().retour)}</button><p role="alert">${esc(e.message)}</p>`; return; }
    api('POST', `/formation/capsules/${c.code}/vue`).catch(() => {});
    lecture = { c, i: 0, joue: true, t: null, audio: null, etape: 0 };
    main.innerHTML = `<button class="fo-retour" data-accueil>${esc(X().retour)}</button>
      <div class="fo-capsule-tete"><span class="em" aria-hidden="true">${c.emoji}</span><div><h1>${esc(c.titre)}</h1></div></div><p class="fo-objectif">${esc(c.objectif)}</p>
      <ol class="fo-etapes" aria-label="Étapes">${X().etapes.map((e, i) => `<li class="fo-etape" data-etape="${i}"${i === 0 ? ' aria-current="step"' : ''}>${esc(e)}</li>`).join('')}</ol>
      <div class="fo-scene" id="fo-scene"></div><p class="fo-sous-titre" id="fo-st" aria-live="polite"></p>
      <div class="fo-commandes"><button class="fo-bouton ligne" data-scene="-1">← ${esc(X().precedent)}</button><button class="fo-bouton" id="fo-joue" data-joue>${esc(X().pause)}</button><button class="fo-bouton ligne" data-scene="1">${esc(X().suivant)} →</button>
        <span class="fo-points" aria-hidden="true">${c.scenes.map(() => '<span></span>').join('')}</span></div>
      <div id="fo-suite"></div>`;
    afficherScene();
    main.focus();
  }
  function afficherScene() {
    const { c, i } = lecture; const s = c.scenes[i];
    const z = s.zone ? `<span class="zone" style="left:${s.zone.x}%;top:${s.zone.y}%;width:${s.zone.w}%;height:${s.zone.h}%"></span>` : '';
    document.getElementById('fo-scene').innerHTML = s.image ? `<img src="${esc(s.image)}" alt="${esc(s.sous_titre)}">${z}<span class="fo-etiquette">${esc(X().fictif)}</span>` : `<div class="vide" aria-hidden="true">${c.emoji}</div>`;
    document.getElementById('fo-st').textContent = s.sous_titre;
    document.querySelectorAll('.fo-points span').forEach((p, k) => p.classList.toggle('actif', k === i));
    clearTimeout(lecture.t); lecture.audio?.pause(); lecture.audio = null;
    if (!lecture.joue) return;
    const suite = () => { if (!lecture) return; if (lecture.i < c.scenes.length - 1) { lecture.i += 1; afficherScene(); } else finScenes(); };
    if (s.voix) { lecture.audio = new Audio(s.voix); lecture.audio.onended = suite; lecture.audio.play().catch(() => { lecture.t = setTimeout(suite, duree(s)); }); }
    else lecture.t = setTimeout(suite, duree(s));
  }
  const duree = (s) => Math.max(4200, s.sous_titre.length * 62);
  function etape(n) { document.querySelectorAll('.fo-etape').forEach((e) => { const k = Number(e.dataset.etape); e.toggleAttribute('aria-current', k === n); if (k === n) e.setAttribute('aria-current', 'step'); e.classList.toggle('fait', k < n); }); }
  function finScenes() {
    if (!lecture) return; lecture.joue = false; const b = document.getElementById('fo-joue'); if (b) b.textContent = X().lecture;
    etape(1);
    document.getElementById('fo-suite').innerHTML = `<section class="fo-panneau"><p>${esc(X().fin_scenes)}</p></section>
      <section class="fo-panneau"><h2>${esc(X().exercice_titre)}</h2><div class="fo-exercice"><span class="em" aria-hidden="true">🧪</span><p class="fo-note">${esc(X().exercice_bientot)}</p></div></section>
      <section class="fo-panneau" id="fo-test"><h2>${esc(X().test_titre)}</h2><p class="fo-note">${esc(X().test_intro)} ${lecture.c.chrono_test_s ? esc(f(X().test_chrono, { s: lecture.c.chrono_test_s })) : ''}</p>
        <button class="fo-bouton" data-test-debut>${esc(X().demarrer)}</button></section>`;
  }
  async function debutTest() {
    const c = lecture.c; etape(2);
    try { await api('POST', `/formation/capsules/${c.code}/quiz/debut`); } catch (e) { return alerte(e.message); }
    const zone = document.getElementById('fo-test');
    zone.innerHTML = `<h2>${esc(X().test_titre)} ${c.chrono_test_s ? `<span class="fo-minuteur" id="fo-minuteur" aria-live="off">⏱ ${c.chrono_test_s} s</span>` : ''}</h2>
      <form id="fo-quiz">${c.quiz.map((q, i) => `<div class="fo-question"><fieldset><legend>${i + 1}. ${esc(q.question)}</legend>${q.choix.map((x, k) => `<label class="fo-choix" data-q="${i}" data-k="${k}"><input type="radio" name="q${i}" value="${k}"><span>${esc(x)}</span></label>`).join('')}</fieldset></div>`).join('')}
        <button class="fo-bouton" type="submit">${esc(X().valider)}</button><p id="fo-retour-test" class="fo-note" aria-live="polite"></p></form>`;
    if (c.chrono_test_s) {
      const fin = Date.now() + c.chrono_test_s * 1000;
      minuterie = setInterval(() => { const r = Math.max(0, Math.ceil((fin - Date.now()) / 1000)); const m = document.getElementById('fo-minuteur'); if (m) m.textContent = `⏱ ${r} s`; if (!r) clearInterval(minuterie); }, 250);
    }
    zone.querySelector('input')?.focus();
  }
  async function valider(form) {
    const c = lecture.c;
    const reps = c.quiz.map((_, i) => form.querySelector(`input[name="q${i}"]:checked`)?.value);
    if (reps.some((r) => r == null)) { document.getElementById('fo-retour-test').textContent = X().reponse_manquante; return; }
    clearInterval(minuterie);
    let r; try { r = await api('POST', `/formation/capsules/${c.code}/quiz`, { reponses: reps.map(Number) }); } catch (e) { return alerte(e.message); }
    r.corrections.forEach((x, i) => { form.querySelectorAll(`.fo-choix[data-q="${i}"]`).forEach((l) => { const k = Number(l.dataset.k); if (k === x.bonne) l.classList.add('juste'); else if (l.querySelector('input').checked) l.classList.add('faux'); }); });
    form.querySelectorAll('input, button[type="submit"]').forEach((x) => { x.disabled = true; });
    const suivante = r.reussi ? prochaineApres(c.code) : null;
    form.insertAdjacentHTML('beforeend', `<div class="fo-resultat ${r.reussi ? 'ok' : 'ko'}" role="status">${r.reussi ? `<span class="fo-confettis" aria-hidden="true">🎉</span>${esc(X().reussi)} (${r.score} %)` : esc(r.hors_temps ? X().hors_temps : f(X().rate, { s: r.score }))}
      <div class="fo-commandes">${r.reussi ? '' : `<button type="button" class="fo-bouton" data-test-debut>${esc(X().recommencer)}</button><button type="button" class="fo-bouton ligne" data-revoir>${esc(X().capsule_vue)}</button>`}
        ${suivante ? `<button type="button" class="fo-bouton" data-capsule="${esc(suivante)}">${esc(X().suivante)} →</button>` : ''}<button type="button" class="fo-bouton ligne" data-accueil>${esc(X().retour)}</button></div></div>`);
    etape(r.reussi ? 3 : 2);
  }
  function prochaineApres(code) {
    const liste = (donnees?.parcours || []).flatMap((p) => p.capsules).filter((c) => c.etat !== 'preparation' && c.etat !== 'reussi' && c.code !== code);
    return liste[0]?.code || null;
  }
  const alerte = (m) => { const z = document.getElementById('fo-retour-test') || document.getElementById('fo-st'); if (z) z.textContent = m; };

  // ---------------------------------------------------------------- navigation
  function router() {
    const h = location.hash.slice(1);
    if (h.startsWith('capsule/')) capsule(h.slice(8)); else accueil();
  }
  document.addEventListener('click', async (ev) => {
    const lg = ev.target.closest('[data-fo-langue]'); if (lg) { L = lg.dataset.foLangue; ecrire('arrimo-langue', L); entete(); router(); return; }
    const cap = ev.target.closest('[data-capsule]'); if (cap && !cap.disabled) { location.hash = `capsule/${cap.dataset.capsule}`; return; }
    if (ev.target.closest('[data-accueil]')) { location.hash = ''; return; }
    const p = ev.target.closest('[data-parcours]');
    if (p) {
      const choisis = [...document.querySelectorAll('[data-parcours][aria-pressed="true"]')].map((b) => b.dataset.parcours);
      const suivant = p.getAttribute('aria-pressed') === 'true' ? choisis.filter((c) => c !== p.dataset.parcours) : [...choisis, p.dataset.parcours];
      if (!suivant.length) return;
      try { await api('PUT', '/formation/parcours', { parcours: suivant }); } catch { return; }
      accueil(); return;
    }
    const sc = ev.target.closest('[data-scene]');
    if (sc && lecture) { const n = lecture.i + Number(sc.dataset.scene); if (n >= 0 && n < lecture.c.scenes.length) { lecture.i = n; afficherScene(); } else if (n >= lecture.c.scenes.length) finScenes(); return; }
    if (ev.target.closest('[data-joue]') && lecture) { lecture.joue = !lecture.joue; ev.target.closest('[data-joue]').textContent = lecture.joue ? X().pause : X().lecture; afficherScene(); return; }
    if (ev.target.closest('[data-test-debut]') && lecture) { debutTest(); return; }
    if (ev.target.closest('[data-revoir]') && lecture) { lecture.i = 0; lecture.joue = true; etape(0); document.getElementById('fo-suite').innerHTML = ''; afficherScene(); window.scrollTo(0, 0); }
  });
  document.addEventListener('submit', (ev) => { if (ev.target.id === 'fo-quiz') { ev.preventDefault(); valider(ev.target); } });
  document.addEventListener('keydown', (ev) => {
    if (!lecture || ev.target.closest('input, textarea, select')) return;
    if (ev.key === 'ArrowRight') document.querySelector('[data-scene="1"]')?.click();
    if (ev.key === 'ArrowLeft') document.querySelector('[data-scene="-1"]')?.click();
  });
  window.addEventListener('hashchange', router);
  if (!jeton) { location.replace('/'); return; }
  // Retour vers l'écran de la personne (secours, intervenant, direction régionale ou application)
  api('GET', '/moi').then((m) => { const r = m.utilisateur?.role; const lien = ['paramedic', 'superviseur_secours', 'repartiteur'].includes(r) ? '/secours' : r === 'intervenant' ? '/intervenant' : r === 'direction_regionale' ? '/direction' : '/'; document.getElementById('fo-retour').href = lien; }).catch(() => {});
  entete(); router();
})();
