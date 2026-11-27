/* Navigation par espaces (cahier directeur, 22 nov. 2026) : des espaces métier au lieu de 20 onglets. Les boutons de module existants
   restent en place (mêmes data-v, mêmes routes, mêmes favoris) : un espace montre seulement ses modules, sur une seconde ligne.
   Un espace n'apparaît que s'il contient au moins un module visible pour ce rôle, cet établissement et ses modules activés. */
(() => {
  const nav = document.getElementById('onglets'); if (!nav) return;
  const ESPACES = [
    ['accueil', 'house', 'Accueil', 'Home', ['copilote', 'c-accueil']],
    ['patients', 'stethoscope', 'Patients & DSN', 'Patients & EHR', ['patients', 'dsn', 'admissions', 'c-residents', 'c-admissions', 'nsa']],
    ['transferts', 'arrow-right-left', 'Transferts', 'Transfers', ['flux', 'transferts', 'liaison', 'c-demandes', 'c-mouvements', 'transports-planifies']],
    ['capacites', 'bed-double', 'Capacités', 'Capacity', ['lits', 'c-chambres', 'bourse', 'c-urgences']],
    // Chrono : module principal (cahier V4 3.1, 27 nov. 2026), sorti d'Urgences ; un seul moteur, plusieurs vues
    ['chrono', 'timer', 'Chrono', 'Chrono', ['chrono']],
    ['urgences', 'siren', 'Urgences', 'Emergency', ['urgence', 'secours', 'eviter', 'crise']],
    ['operations', 'spray-can', 'Opérations', 'Operations', ['mes-taches', 'nettoyage', 'c-taches', 'visites']],
    ['pilotage', 'chart-column', 'Pilotage', 'Steering', ['continuite', 'vigilance', 'indicateurs', 'c-indicateurs', 'donnees']],
    ['reseau', 'network', 'Réseau', 'Network', ['reseau', 'c-reseau']],
    ['national', 'map-pin', 'National', 'National', ['national']],
    ['administration', 'settings', 'Administration', 'Administration', ['params', 'admin', 'journal', 'support']],
  ];
  const en = () => (document.documentElement.lang || '').startsWith('en');
  // Comptes Hébergement (cahier 2) : même socle, navigation métier Accueil, Résidents, Capacités, Transferts, Urgences, Opérations,
  // Coordination, Pilotage, Administration (mêmes modules, mêmes routes ; seuls le libellé et l'ordre changent)
  const hebergement = () => document.documentElement.dataset.typeEtab === 'chsld';
  const LIB_HEB = { patients: ['Résidents', 'Residents'], reseau: ['Coordination réseau', 'Network coordination'] };
  const ORDRE_HEB = ['accueil', 'patients', 'capacites', 'chrono', 'transferts', 'urgences', 'operations', 'reseau', 'pilotage', 'national', 'administration'];
  const ordonnes = (liste) => (hebergement() ? [...liste].sort((a, b) => ORDRE_HEB.indexOf(a[0]) - ORDRE_HEB.indexOf(b[0])) : liste);
  const espaceDe = (v) => ESPACES.find((x) => x[4].includes(v))?.[0] || null;
  let actif = 'accueil'; let construit = ''; let dernierSel = null;
  const boutons = () => [...nav.querySelectorAll('button[role="tab"][data-v]')];
  const visible = (b) => !b.hidden && b.style.display !== 'none';
  function appliquer(force) {
    const vus = boutons().filter(visible);
    const presents = ESPACES.filter((x) => vus.some((b) => x[4].includes(b.dataset.v)));
    // DSN réservé aux hôpitaux (27 nov. 2026) : sans module DSN visible, l'espace s'appelle « Patients », jamais « Patients & DSN »
    const avecDsn = vus.some((b) => b.dataset.v === 'dsn');
    const sig = presents.map((x) => x[0]).join(',') + (en() ? ':en' : ':fr') + (hebergement() ? ':heb' : '') + (avecDsn ? ':dsn' : '');
    if (sig !== construit) {
      nav.querySelectorAll('.espace-btn, .espace-saut').forEach((x) => x.remove());
      const frag = document.createDocumentFragment();
      for (const [cle, ic, fr0, an0] of ordonnes(presents)) { const [fr, an] = hebergement() && LIB_HEB[cle] ? LIB_HEB[cle] : cle === 'patients' && !avecDsn ? ['Patients', 'Patients'] : [fr0, an0]; const b = document.createElement('button'); b.type = 'button'; b.className = 'espace-btn'; b.dataset.espace = cle;
        // Planche 2 : point de couleur du module, libellé, compteur, chevron (barre latérale) ; icône en navigation horizontale et barre repliée
        b.innerHTML = `<svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-${ic}"/></svg><span class="esp-point" aria-hidden="true"></span><span class="esp-nom">${en() ? an : fr}</span><span class="esp-compte"></span><span class="esp-chevron" aria-hidden="true"></span>`; frag.appendChild(b); }
      const saut = document.createElement('span'); saut.className = 'espace-saut'; saut.setAttribute('aria-hidden', 'true'); frag.appendChild(saut);
      nav.prepend(frag); construit = sig;
    }
    nav.classList.add('avec-espaces');
    const sel = boutons().find((b) => b.getAttribute('aria-selected') === 'true');
    // L'espace suit l'onglet ouvert seulement quand l'onglet ouvert change (un choix d'espace n'est pas écrasé par un simple rafraîchissement)
    if (sel && sel.dataset.v !== dernierSel) { dernierSel = sel.dataset.v; if (!force && espaceDe(sel.dataset.v)) actif = espaceDe(sel.dataset.v); }
    const membres = ESPACES.find((x) => x[0] === actif)?.[4] || [];
    for (const b of boutons()) b.classList.toggle('hors-espace', !membres.includes(b.dataset.v) && !!espaceDe(b.dataset.v));
    nav.querySelectorAll('.espace-btn').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.espace === actif)); b.classList.toggle('actif', b.dataset.espace === actif); });
    // Paramètres propres au module (cahier directeur, 13.2 et 17) : accès depuis l'espace, responsables seulement ; ouvre la section
    // existante (aucune copie des réglages). Opérations : paramètres de Personnel & Tâches et du Nettoyage, en bas de « Mes tâches ».
    nav.querySelector('.espace-params')?.remove();
    const role = window.etat?.moi?.utilisateur?.role;
    const cible = { transferts: 'params:etablissement', capacites: 'params:etablissement', urgences: 'params:etablissement', pilotage: 'params:etablissement', patients: 'params:etablissement', operations: 'mes-taches' }[actif];
    if (cible && ['admin_etab', 'coordonnateur', 'gestionnaire'].includes(role)) {
      const pb = document.createElement('button'); pb.type = 'button'; pb.className = 'espace-params'; pb.dataset.cible = cible;
      pb.innerHTML = `<svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-settings"/></svg> ${en() ? 'Module settings' : 'Paramètres du module'}`;
      nav.appendChild(pb);
    }
    // Un espace d'un seul module n'a pas besoin de seconde ligne
    const seuls = boutons().filter((b) => visible(b) && !b.classList.contains('hors-espace')); if (nav.querySelector('.espace-params')) seuls.push(null);
    nav.classList.toggle('espace-unique', seuls.length <= 1);
    lateral(presents);
    document.documentElement.dataset.espace = actif;
    surtitre();
  }
  /* Barre latérale (planche 2 de la proposition visuelle validée) : chaque module est un accordéon ; ses sous-onglets autorisés
     apparaissent dessous, indentés, au filet de sa couleur. Plusieurs modules peuvent rester ouverts ; le module actif l'est toujours.
     Les boutons existants ne bougent pas dans le document (mêmes routes, mêmes droits, même parité avec la navigation horizontale) :
     seul l'ordre d'affichage (propriété CSS order) les range sous leur module. */
  const CLE_OUVERTS = 'arrimo-nav-ouverts';
  const lireOuverts = () => { try { return new Set(JSON.parse(localStorage.getItem(CLE_OUVERTS) || '[]')); } catch { return new Set(); } };
  const ecrireOuverts = (s) => { try { localStorage.setItem(CLE_OUVERTS, JSON.stringify([...s])); } catch { /* stockage indisponible */ } };
  const accordeon = () => document.body.classList.contains('nav-verticale') || window.matchMedia('(max-width: 600px)').matches;
  function lateral(presents) {
    if (!nav.querySelector('.nav-marque')) { const m = document.createElement('div'); m.className = 'nav-marque'; m.innerHTML = '<img src="/logo.svg" alt="" width="30" height="30"><strong>Arrimo</strong>'; nav.prepend(m); }
    const modeAcc = accordeon(); const ouverts = lireOuverts();
    // Le module qui devient actif s'ouvre (une fois) ; l'utilisateur peut ensuite le replier
    if (lateral.dernier !== actif) { lateral.dernier = actif; if (!ouverts.has(actif)) { ouverts.add(actif); ecrireOuverts(ouverts); } }
    const ordre = ordonnes(presents).map((x) => x[0]);
    nav.classList.toggle('nav-accordeon', modeAcc);
    for (const b of nav.querySelectorAll('.espace-btn')) {
      const cle = b.dataset.espace; const i = ordre.indexOf(cle); const membres = ESPACES.find((x) => x[0] === cle)?.[4] || [];
      const vis = boutons().filter((x) => visible(x) && membres.includes(x.dataset.v));
      const ouvert = modeAcc && ouverts.has(cle);
      b.style.order = modeAcc ? String(i * 100) : '';
      b.classList.toggle('ouvert', ouvert); b.setAttribute('aria-expanded', String(modeAcc ? ouvert : cle === actif));
      b.style.setProperty('--m-espace', `var(--m-${cle})`);
      const ch = b.querySelector('.esp-chevron'); const chv = vis.length > 1 ? (ouvert ? '▾' : '▸') : ''; if (ch && ch.textContent !== chv) ch.textContent = chv;
      // Compteur du module : somme des compteurs visibles de ses sous-onglets (jamais inventé)
      const total = vis.reduce((s, x) => { const n = x.querySelector('.n'); return s + (n && !n.hidden && /^\d+$/.test(n.textContent.trim()) ? Number(n.textContent.trim()) : 0); }, 0);
      const cpt = b.querySelector('.esp-compte'); const cv = total ? String(total) : ''; if (cpt && cpt.textContent !== cv) cpt.textContent = cv;
      // Module d'un seul écran : le module lui-même ouvre l'écran (pas de sous-onglet en double)
      b.classList.toggle('unique', vis.length === 1);
      membres.forEach((v, j) => { for (const x of nav.querySelectorAll(`button[role="tab"][data-v="${v}"]`)) {
        x.style.order = modeAcc ? String(i * 100 + 1 + j) : ''; x.style.setProperty('--m-sous', `var(--m-${cle})`);
        x.classList.toggle('ferme-lateral', modeAcc && !ouvert);
      } });
    }
    const pr = nav.querySelector('.espace-params'); if (pr) pr.style.order = modeAcc ? String(ordre.indexOf(actif) * 100 + 99) : '';
  }
  /** Surtitre de module en capitales au-dessus du titre de chaque écran (planches 2 à 4) : « Transferts · Flux ». */
  function surtitre() {
    const sel = boutons().find((b) => b.getAttribute('aria-selected') === 'true'); if (!sel) return;
    const v = document.getElementById(`v-${sel.dataset.v}`); const h = v?.querySelector(':scope > .entete h2'); if (!h) return;
    const esp = nav.querySelector(`.espace-btn[data-espace="${espaceDe(sel.dataset.v) || actif}"] .esp-nom`)?.textContent || '';
    const mod = sel.querySelector('span:not(.n)')?.textContent?.trim() || '';
    const texte = esp && mod && esp !== mod ? `${esp} · ${mod}` : (esp || mod);
    let s = h.previousElementSibling; if (!s || !s.classList.contains('surtitre-module')) { s = document.createElement('span'); s.className = 'surtitre-module'; h.before(s); }
    if (s.textContent !== texte) s.textContent = texte;
  }
  /** Ouvre l'espace d'un module (utilisé aussi par les tests et les raccourcis : le bouton du module devient visible). */
  function reveler(v) { const x = espaceDe(v); if (x) { actif = x; appliquer(true); } }
  nav.addEventListener('click', (ev) => {
    const pr = ev.target.closest('.espace-params');
    if (pr) {
      if (pr.dataset.cible === 'mes-taches') { document.querySelector('#onglets button[data-v="mes-taches"]')?.click(); setTimeout(() => { const d = document.querySelector('#mt-params details'); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); } }, 900); }
      else window.dispatchEvent(new CustomEvent('arrimo:ouvrir-parametres', { detail: pr.dataset.cible }));
      return;
    }
    const b = ev.target.closest('.espace-btn'); if (!b) return;
    // Barre latérale : un clic déplie ou replie le module ; un module d'un seul écran l'ouvre directement
    if (accordeon() && !document.body.classList.contains('nav-repliee')) {
      const cle = b.dataset.espace; const membres = ESPACES.find((x) => x[0] === cle)?.[4] || [];
      const vis = boutons().filter((x) => visible(x) && membres.includes(x.dataset.v));
      if (vis.length > 1) {
        // Le chevron replie ou déplie le module ; un clic sur son nom l'ouvre (jamais ne le referme) et en fait le module courant
        const o = lireOuverts(); const surChevron = !!ev.target.closest('.esp-chevron');
        if (surChevron && o.has(cle)) o.delete(cle); else { o.add(cle); if (!surChevron) actif = cle; }
        ecrireOuverts(o); lateral.dernier = actif; appliquer(true); return;
      }
    }
    actif = b.dataset.espace; appliquer(true);
    const premier = boutons().find((x) => visible(x) && !x.classList.contains('hors-espace'));
    if (premier && premier.getAttribute('aria-selected') !== 'true') premier.click();
  });
  new MutationObserver(() => { clearTimeout(appliquer.t); appliquer.t = setTimeout(appliquer, 30); }).observe(nav, { subtree: true, attributes: true, attributeFilter: ['aria-selected', 'hidden'], characterData: true, childList: true });
  // Le surtitre suit chaque nouveau rendu d'écran ; la disposition (horizontale, verticale, téléphone) réordonne la barre
  const contenu = document.querySelector('.contenu'); if (contenu) new MutationObserver(() => { clearTimeout(surtitre.t); surtitre.t = setTimeout(surtitre, 40); }).observe(contenu, { childList: true, subtree: true });
  new MutationObserver(() => { clearTimeout(appliquer.t); appliquer.t = setTimeout(appliquer, 30); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.ArrimoEspaces = { reveler, espaceDe, ESPACES, appliquer };
  setTimeout(appliquer, 0);
})();
