/* Son de notification (demande de Moustafa, 23 nov. 2026) : chaque message, chaque alerte, chaque préalerte et chaque nouvelle tâche
   sont signalés par un son, en plus du visuel. Trois sons distincts, synthétisés (aucun fichier) ; activé par défaut ; bouton de l'en-tête
   pour couper ou réactiver (mémorisé sur cet appareil). Le navigateur n'autorise le son qu'après une première action de l'utilisateur :
   le contexte audio est donc préparé au premier clic ou à la première touche. Un même événement ne sonne qu'une fois. */
(() => {
  const CLE = 'arrimo-son';
  const lire = () => { try { return localStorage.getItem(CLE) !== '0'; } catch { return true; } };
  const ecrire = (v) => { try { localStorage.setItem(CLE, v ? '1' : '0'); } catch { /* stockage indisponible */ } };
  let ac = null; let dernier = 0;
  const contexte = () => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch { ac = null; } return ac; };
  ['pointerdown', 'keydown'].forEach((t) => document.addEventListener(t, () => contexte(), { once: true, capture: true }));
  /** Notes : [fréquence Hz, début s, durée s] ; enveloppe douce pour éviter les clics. */
  function notes(seq, volume = 0.18) {
    const c = contexte(); if (!c) return;
    const t0 = c.currentTime + 0.02;
    for (const [f, d, l] of seq) {
      const o = c.createOscillator(); const g = c.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(volume, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + l);
      o.connect(g); g.connect(c.destination); o.start(t0 + d); o.stop(t0 + d + l + 0.05);
    }
  }
  const SONS = {
    message: [[660, 0, 0.18], [880, 0.2, 0.25]],                                            // deux notes douces
    notification: [[740, 0, 0.2], [988, 0.22, 0.28]],
    tache: [[587, 0, 0.18], [784, 0.2, 0.18], [988, 0.4, 0.25]],
    alerte: [[880, 0, 0.16], [880, 0.24, 0.16], [880, 0.48, 0.22]],                       // trois bips
    prealerte: [[960, 0, 0.28], [720, 0.32, 0.28], [960, 0.64, 0.28], [720, 0.96, 0.32]],   // deux tons, comme une sirène douce
  };
  /** Joue un son (message | notification | tache | alerte | prealerte). Jamais deux sons à moins de 1,5 s : le plus important d'abord. */
  function jouer(type = 'notification') {
    if (!lire()) return;
    const now = Date.now(); if (now - dernier < 1500) return; dernier = now;
    notes(SONS[type] || SONS.notification, type === 'prealerte' || type === 'alerte' ? 0.24 : 0.18);
  }
  /** Code d'une notification → type de son. */
  const typeDe = (code = '') => (/prealerte|ambulance|eta/.test(code) ? 'prealerte'
    : /niveau|saturation|blocage|retard|alerte|urgence|crise|refus|annul|incident|depasse|chrono_seuil/.test(code) ? 'alerte'
      : /tache/.test(code) ? 'tache' : /message|connect|famille/.test(code) ? 'message' : 'notification');

  // Bouton de l'en-tête : couper / réactiver le son
  function bouton() {
    const ancre = document.getElementById('b-messagerie') || document.getElementById('b-notif') || document.querySelector('.tete #theme');
    if (!ancre || document.getElementById('b-son')) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'b-son'; b.className = ancre.className || 'btn';
    const maj = () => {
      const on = lire(); const en = (document.documentElement.lang || '').startsWith('en');
      const lib = on ? (en ? 'Sound on: click to mute' : 'Son activé : cliquer pour couper') : (en ? 'Sound off: click to turn on' : 'Son coupé : cliquer pour activer');
      b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', lib); b.title = lib;
      b.innerHTML = `<svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-${on ? 'audio-lines' : 'minus'}"/></svg>`;
    };
    b.onclick = () => { ecrire(!lire()); maj(); if (lire()) jouer('notification'); };
    maj(); ancre.after(b);
  }

  // Suivi des compteurs : un son quand une valeur augmente (jamais au premier chargement)
  const vus = {};
  function compter(cle, n, type) {
    if (n == null) return;
    if (vus[cle] != null && n > vus[cle]) jouer(type);
    vus[cle] = n;
  }
  // Une alerte Chrono par passage pendant la session, même si la liste se réordonne ou si le passage repasse sous le seuil.
  const passagesChrono = new Map();
  window.addEventListener('arrimo:session-reset', () => passagesChrono.clear());
  function chrono(cle, passages) {
    if (!Array.isArray(passages)) return;
    const ids = passages.filter((p) => p.niveau === 'rouge').map((p) => p.id);
    const precedent = passagesChrono.get(cle);
    if (precedent && ids.some((id) => !precedent.has(id))) jouer('alerte');
    const vus = precedent || new Set();
    ids.forEach((id) => vus.add(id));
    passagesChrono.set(cle, vus);
  }
  const notifsVues = new Set(); let premier = true;
  /** Nouvelles notifications (liste du serveur) : un son par lot, du type le plus important. */
  function notifications(liste) {
    if (!Array.isArray(liste)) return;
    const nouvelles = liste.filter((n) => !n.lu && !notifsVues.has(n.id));
    liste.forEach((n) => notifsVues.add(n.id));
    if (premier) { premier = false; return; }
    if (!nouvelles.length) return;
    const ordre = ['prealerte', 'alerte', 'tache', 'message', 'notification'];
    const t = nouvelles.map((n) => typeDe(n.code)).sort((a, b) => ordre.indexOf(a) - ordre.indexOf(b))[0];
    jouer(t);
  }
  // Entretien : nouvelles tâches (Mes tâches), toutes les 60 s
  setInterval(async () => {
    const u = window.etat?.moi?.utilisateur; const ctx = window.etat?.ctx;
    if (!u || !ctx || u.role !== 'entretien' || document.visibilityState !== 'visible' || !window.api) return;
    const d = await window.api('GET', `/taches/miennes?etablissement_id=${ctx}`).catch(() => null);
    if (d) compter(`taches:${ctx}`, d.taches.length, 'tache');
  }, 60000);
  setInterval(bouton, 2000); setTimeout(bouton, 500);
  window.ArrimoSon = { jouer, compter, chrono, notifications, typeDe, actif: lire };
})();
