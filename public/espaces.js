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
    ['urgences', 'siren', 'Urgences', 'Emergency', ['urgence', 'secours', 'chrono', 'eviter', 'crise']],
    ['operations', 'spray-can', 'Opérations', 'Operations', ['mes-taches', 'nettoyage', 'c-taches', 'visites']],
    ['pilotage', 'chart-column', 'Pilotage', 'Steering', ['continuite', 'vigilance', 'indicateurs', 'c-indicateurs', 'donnees']],
    ['reseau', 'network', 'Réseau', 'Network', ['reseau', 'c-reseau']],
    ['national', 'map-pin', 'National', 'National', ['national']],
    ['administration', 'settings', 'Administration', 'Administration', ['params', 'admin', 'journal', 'support']],
  ];
  const en = () => (document.documentElement.lang || '').startsWith('en');
  const espaceDe = (v) => ESPACES.find((x) => x[4].includes(v))?.[0] || null;
  let actif = 'accueil'; let construit = ''; let dernierSel = null;
  const boutons = () => [...nav.querySelectorAll('button[role="tab"][data-v]')];
  const visible = (b) => !b.hidden && b.style.display !== 'none';
  function appliquer(force) {
    const vus = boutons().filter(visible);
    const presents = ESPACES.filter((x) => vus.some((b) => x[4].includes(b.dataset.v)));
    const sig = presents.map((x) => x[0]).join(',') + (en() ? ':en' : ':fr');
    if (sig !== construit) {
      nav.querySelectorAll('.espace-btn, .espace-saut').forEach((x) => x.remove());
      const frag = document.createDocumentFragment();
      for (const [cle, ic, fr, an] of presents) { const b = document.createElement('button'); b.type = 'button'; b.className = 'espace-btn'; b.dataset.espace = cle; b.innerHTML = `<svg class="ic" aria-hidden="true" focusable="false"><use href="/icones.svg#i-${ic}"/></svg> ${en() ? an : fr}`; frag.appendChild(b); }
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
    actif = b.dataset.espace; appliquer(true);
    const premier = boutons().find((x) => visible(x) && !x.classList.contains('hors-espace'));
    if (premier && premier.getAttribute('aria-selected') !== 'true') premier.click();
  });
  new MutationObserver(() => { clearTimeout(appliquer.t); appliquer.t = setTimeout(appliquer, 30); }).observe(nav, { subtree: true, attributes: true, attributeFilter: ['aria-selected', 'hidden'] });
  window.ArrimoEspaces = { reveler, espaceDe, ESPACES, appliquer };
  setTimeout(appliquer, 0);
})();
