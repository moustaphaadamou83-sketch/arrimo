/* Annonces vocales Chrono (cahiers V4 3.7 et V5 4.6, 26 nov. 2026).
   Prolonge la veille Liaison Secours existante (appelée sur chaque signal en direct et toutes les 30 s, quel que soit l'onglet) :
   aucun second moteur. Ne prononce QUE le numéro de l'ambulance et des durées — jamais une référence, un nom ou une information médicale.
   - Désactivées par défaut sur chaque poste ; activées par un clic (le navigateur n'autorise la voix qu'après une action de l'utilisateur).
   - Seuils configurables (attendue, en approche, rappel sur place), volume, essai, acquittement des rappels.
   - Une annonce par étape et par préalerte ; un rappel « sur place » par palier, jusqu'à l'acquittement.
   - Arrivée estimée : celle du GPS (calculée par le serveur), sinon l'heure prévue ; jamais inventée.
   - Si la synthèse vocale est indisponible sur le poste, l'indicateur le dit ; l'alerte visuelle et le son restent. */
(() => {
  const CLE = 'arrimo-annonces';
  const DEFAUT = { actif: false, volume: 0.9, attendue: 5, approche: 2, sur_place: 10 };
  const lire = () => { try { return { ...DEFAUT, ...JSON.parse(localStorage.getItem(CLE) || '{}') }; } catch { return { ...DEFAUT }; } };
  const ecrire = (r) => { try { localStorage.setItem(CLE, JSON.stringify(r)); } catch { /* stockage indisponible */ } };
  const en = () => (document.documentElement.lang || '').startsWith('en');
  const TXT = {
    fr: { attendue: 'Ambulance {u} attendue dans {m} minutes.', approche: 'Ambulance {u} en approche. Arrivée estimée dans {m} minutes.', approche1: 'Ambulance {u} en approche. Arrivée imminente.',
      arrivee: 'Ambulance {u} arrivée. Chrono démarré.', sur_place: 'Ambulance {u} sur place depuis {m} minutes. Veuillez vérifier l’état de la prise en charge.',
      titre: 'Annonces vocales', actif: 'Activer les annonces sur ce poste', volume: 'Volume', s_attendue: 'Annoncer « attendue » à (min)', s_approche: 'Annoncer « en approche » à (min)',
      s_sur_place: 'Rappel « sur place » toutes les (min)', essai: 'Essayer', essai_txt: 'Annonces vocales Arrimo activées.', indispo: 'La voix n’est pas disponible sur ce poste : alertes visuelles et sonores seulement.',
      etat_on: 'Annonces vocales activées', etat_off: 'Annonces vocales coupées', acquitter: 'Acquitter', fermer: 'Fermer', note: 'Seul le numéro de l’ambulance est prononcé, jamais une information sur le patient.' },
    en: { attendue: 'Ambulance {u} expected in {m} minutes.', approche: 'Ambulance {u} approaching. Estimated arrival in {m} minutes.', approche1: 'Ambulance {u} approaching. Arrival imminent.',
      arrivee: 'Ambulance {u} has arrived. Chrono started.', sur_place: 'Ambulance {u} on site for {m} minutes. Please check the handover status.',
      titre: 'Voice announcements', actif: 'Turn on announcements on this workstation', volume: 'Volume', s_attendue: 'Announce “expected” at (min)', s_approche: 'Announce “approaching” at (min)',
      s_sur_place: '“On site” reminder every (min)', essai: 'Test', essai_txt: 'Arrimo voice announcements are on.', indispo: 'Voice is not available on this workstation: visual and sound alerts only.',
      etat_on: 'Voice announcements on', etat_off: 'Voice announcements off', acquitter: 'Acknowledge', fermer: 'Close', note: 'Only the ambulance number is spoken, never patient information.' },
  };
  const T = (k, v = {}) => String(TXT[en() ? 'en' : 'fr'][k]).replace(/\{(\w+)\}/g, (x, y) => v[y] ?? x);
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const disponible = () => typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
  // Numéro affiché tel quel (« SIM-01 ») ; prononcé par groupe (« SIM 01 »), jamais d'autre donnée
  const unite = (n) => String(n || '').slice(0, 20);
  const prononcer = (texte, n) => (n ? texte.split(unite(n)).join(unite(n).replace(/[-_]/g, ' ')) : texte);

  const faites = new Set();          // `${id}:${etape}` : une annonce par étape et par préalerte
  const acquittees = new Set();      // préalertes dont le rappel « sur place » est acquitté
  let premier = true;

  function parler(texte) {
    const r = lire(); if (!r.actif || !disponible()) return false;
    try {
      const u = new SpeechSynthesisUtterance(texte); u.lang = en() ? 'en-CA' : 'fr-CA'; u.volume = Math.max(0, Math.min(1, Number(r.volume) || 0));
      window.speechSynthesis.speak(u); return true;
    } catch { return false; }
  }
  /** Minutes restantes avant l'arrivée : ETA GPS du serveur (minutes au moment du calcul) sinon heure prévue ; null si inconnue. */
  function minutesRestantes(p, now) {
    if (p.eta?.minutes != null && p.eta?.le) return Math.round(p.eta.minutes - (now - new Date(p.eta.le).getTime()) / 60000);
    if (p.heure_prevue) return Math.round((new Date(p.heure_prevue).getTime() - now) / 60000);
    return null;
  }
  /** Étapes à annoncer pour une préalerte ouverte (pure : testée sans navigateur). */
  function etapes(p, r, now = Date.now()) {
    const arrivee = p.arrivee_confirmee_le || p.arrivee_signalee_le;
    if (arrivee) {
      const sur = Math.floor((now - new Date(arrivee).getTime()) / 60000);
      const out = [{ cle: 'arrivee', texte: T('arrivee', { u: unite(p.unite) }) }];
      if (r.sur_place > 0 && sur >= r.sur_place && !p.remise_le) { const palier = Math.floor(sur / r.sur_place) * r.sur_place; out.push({ cle: `sur_place_${palier}`, texte: T('sur_place', { u: unite(p.unite), m: palier }), rappel: true }); }
      return out;
    }
    const m = minutesRestantes(p, now); if (m == null) return [];
    if (m <= r.approche) return [{ cle: 'approche', texte: m <= 1 ? T('approche1', { u: unite(p.unite) }) : T('approche', { u: unite(p.unite), m }) }];
    if (m <= r.attendue) return [{ cle: 'attendue', texte: T('attendue', { u: unite(p.unite), m }) }];
    return [];
  }
  /** Appelée par la veille avec les préalertes ouvertes de l'établissement. Au premier passage, rien n'est annoncé (état déjà connu). */
  function traiter(ouvertes) {
    if (!Array.isArray(ouvertes)) return;
    const r = lire(); const now = Date.now(); const aDire = [];
    for (const p of ouvertes) {
      for (const e of etapes(p, r, now)) {
        const k = `${p.id}:${e.cle}`; if (faites.has(k)) continue; faites.add(k);
        // Les étapes précédentes sont réputées faites : « attendue » n'est jamais dite après « en approche »
        if (e.cle === 'approche') faites.add(`${p.id}:attendue`);
        if (e.cle === 'arrivee') { faites.add(`${p.id}:attendue`); faites.add(`${p.id}:approche`); }
        if (e.rappel && acquittees.has(p.id)) continue;
        if (!premier) aDire.push({ ...e, p });
      }
    }
    premier = false;
    if (!aDire.length) return;
    aDire.forEach((e) => parler(prononcer(e.texte, e.p.unite)));
    const rappel = aDire.find((e) => e.rappel);
    bandeau(aDire[aDire.length - 1].texte, rappel?.p.id);
  }
  /** Alerte visuelle (toujours, même sans voix) ; acquittement des rappels « sur place ». */
  function bandeau(texte, rappelId) {
    let b = document.getElementById('annonce-chrono');
    if (!b) { b = document.createElement('div'); b.id = 'annonce-chrono'; b.setAttribute('role', 'status'); document.body.appendChild(b); }
    b.className = 'annonce-chrono';
    b.innerHTML = `<svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-megaphone"/></svg><span>${esc(texte)}</span>
      ${rappelId ? `<button type="button" class="btn" data-acquitter="${esc(rappelId)}">${esc(T('acquitter'))}</button>` : ''}
      <button type="button" class="btn discret" data-fermer-annonce aria-label="${esc(T('fermer'))}"><svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-x"/></svg></button>`;
    b.querySelector('[data-acquitter]')?.addEventListener('click', (ev) => { acquittees.add(Number(ev.currentTarget.dataset.acquitter) || ev.currentTarget.dataset.acquitter); b.remove(); });
    b.querySelector('[data-fermer-annonce]')?.addEventListener('click', () => b.remove());
    clearTimeout(bandeau.m); bandeau.m = setTimeout(() => b.remove(), 30000);
  }
  /** Réglages du poste (bouton de l'en-tête) : activation, volume, seuils, essai ; indicateur si la voix est indisponible. */
  function reglages() {
    const r = lire();
    let d = document.getElementById('reglages-annonces');
    if (!d) { d = document.createElement('dialog'); d.id = 'reglages-annonces'; d.className = 'reglages-annonces'; document.body.appendChild(d); }
    const num = (k, v) => `<label>${esc(T('s_' + k))}<input type="number" min="1" max="60" data-r="${k}" value="${esc(v)}"></label>`;
    d.innerHTML = `<h2>${esc(T('titre'))}</h2>${disponible() ? '' : `<p class="note" role="status">${esc(T('indispo'))}</p>`}
      <label class="ligne"><input type="checkbox" data-r="actif"${r.actif ? ' checked' : ''}${disponible() ? '' : ' disabled'}> ${esc(T('actif'))}</label>
      <label>${esc(T('volume'))}<input type="range" min="0" max="1" step="0.1" data-r="volume" value="${esc(r.volume)}"></label>
      ${num('attendue', r.attendue)}${num('approche', r.approche)}${num('sur_place', r.sur_place)}
      <p class="note">${esc(T('note'))}</p>
      <div class="actions"><button type="button" class="btn" data-essai${disponible() ? '' : ' disabled'}>${esc(T('essai'))}</button><button type="button" class="btn pri" data-fermer>${esc(T('fermer'))}</button></div>`;
    d.addEventListener('change', (ev) => {
      const k = ev.target.dataset.r; if (!k) return; const x = lire();
      x[k] = k === 'actif' ? ev.target.checked : k === 'volume' ? Number(ev.target.value) : Math.max(1, Math.min(60, Math.round(Number(ev.target.value)) || DEFAUT[k]));
      ecrire(x); majBouton();
    });
    d.querySelector('[data-essai]').onclick = () => { const x = lire(); if (!x.actif) { x.actif = true; ecrire(x); d.querySelector('[data-r="actif"]').checked = true; majBouton(); } parler(T('essai_txt')); };
    d.querySelector('[data-fermer]').onclick = () => d.close();
    d.showModal?.() ?? d.setAttribute('open', '');
  }
  function majBouton() {
    const b = document.getElementById('b-voix'); if (!b) return;
    const on = lire().actif && disponible();
    const lib = !disponible() ? T('indispo') : on ? T('etat_on') : T('etat_off');
    b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', lib); b.title = lib;
    b.classList.toggle('voix-indispo', !disponible());
  }
  /** Bouton de l'en-tête, à côté du bouton son, pour les postes des établissements (pas l'écran de l'ambulance). */
  function bouton() {
    const ancre = document.getElementById('b-son'); if (!ancre || document.getElementById('b-voix') || location.pathname.startsWith('/secours')) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'b-voix'; b.className = ancre.className || 'btn';
    b.innerHTML = '<svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-megaphone"/></svg>';
    b.onclick = reglages; ancre.after(b); majBouton();
  }
  window.addEventListener('arrimo:session-reset', () => { faites.clear(); acquittees.clear(); premier = true; });
  setInterval(bouton, 2000); setTimeout(bouton, 700);
  window.ArrimoAnnonces = { traiter, etapes, reglages, lire, disponible };
})();
