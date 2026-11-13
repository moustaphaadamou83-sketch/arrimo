/* Carte Arrimo commune (CCS, ambulance, hôpital, hébergement) — simple, claire, légère (demande de Moustafa, 13 nov. 2026).
   - Fond clair et épuré (routes principales, noms de villes) ; symboles peu nombreux et constants :
     rond coloré à lettre par hôpital (vert / orange / rouge selon l'urgence), petit carré numéroté par ambulance,
     carré bleu par établissement d'hébergement (CHSLD, RPA…).
   - Un seul trajet par ambulance : pointillé vers son hôpital, avec « X min ».
   - Étiquette courte à côté de chaque symbole ; détails seulement au clic, dans une petite fiche.
   - Légende d'une seule ligne sous la carte. Aucune donnée de patient. */
(() => {
  const COUL = { vert: '#16A34A', jaune: '#F59E0B', orange: '#F59E0B', rouge: '#DC2626', inconnu: '#94A3B8' };
  const AMB = { mission: '#0E5E6F', libre: '#64748B' };
  const HEB = '#164B61';
  const TXT = {
    fr: { dispo: 'Disponible', limitee: 'Capacité limitée', saturee: 'Saturation / délestage', ambulance: 'Ambulance', hebergement: 'Hébergement', vous: 'Vous', min: '{n} min' },
    en: { dispo: 'Available', limitee: 'Limited capacity', saturee: 'Saturation / diversion', ambulance: 'Ambulance', hebergement: 'Residential care', vous: 'You', min: '{n} min' },
  };
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let chargement = null;
  function leaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (!chargement) chargement = new Promise((ok, ko) => {
      if (!document.querySelector('link[href="vendor/leaflet/leaflet.css"]')) { const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet/leaflet.css'; document.head.appendChild(css); }
      const js = document.createElement('script'); js.src = 'vendor/leaflet/leaflet.js'; js.onload = () => ok(window.L); js.onerror = ko; document.head.appendChild(js);
    });
    return chargement;
  }
  // Styles de la carte : injectés une fois, pour toutes les pages
  function styles() {
    if (document.getElementById('carte-arrimo-css')) return;
    const s = document.createElement('style'); s.id = 'carte-arrimo-css';
    s.textContent = `.ca-fond{filter:grayscale(1) contrast(.72) brightness(1.13)}.ca-zone .leaflet-tile-pane{opacity:.8}
      .ca-zone{border-radius:12px;overflow:hidden;background:#EEF3F5;border:1px solid var(--bordure,#E2E8F0)}
      .ca-hop{width:34px;height:34px;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 4px rgba(15,23,42,.35);color:#fff;font:700 15px/28px system-ui,sans-serif;text-align:center}
      .ca-hop.moi{outline:3px solid #0E5E6F;outline-offset:1px}
      .ca-amb{min-width:30px;height:22px;padding:0 4px;border-radius:5px;border:2px solid #fff;box-shadow:0 1px 3px rgba(15,23,42,.35);color:#fff;font:700 11px/18px system-ui,sans-serif;text-align:center;box-sizing:border-box}
      .ca-heb{width:16px;height:16px;border:2px solid #fff;box-shadow:0 1px 3px rgba(15,23,42,.3);background:${HEB}}
      .leaflet-tooltip.ca-etiq{background:transparent;border:0;box-shadow:none;padding:0 2px;font:600 13px/1.2 system-ui,sans-serif;color:#1F2937;white-space:nowrap;
        text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 4px #fff,0 0 5px #fff}
      .leaflet-tooltip.ca-etiq::before{display:none}
      .leaflet-tooltip.ca-etiq.amb{color:#0E5E6F;font-size:12px}.leaflet-tooltip.ca-etiq.heb{color:${HEB};font-size:12px}
      .leaflet-tooltip.ca-duree{background:#fff;border:1px solid #CBD5E1;border-radius:10px;padding:1px 7px;font:700 12px/1.4 system-ui,sans-serif;color:#0E5E6F;box-shadow:none}
      .leaflet-tooltip.ca-duree::before{display:none}
      .ca-fiche{font:14px/1.4 system-ui,sans-serif;color:#1F2937;min-width:170px}.ca-fiche b{display:block;margin-bottom:2px}.ca-fiche span{color:#64748B;display:block}
      .ca-legende{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;font-size:13px;color:#64748B;margin:8px 2px 0}
      .ca-legende i{display:inline-block;vertical-align:-2px;margin-right:5px}
      .leaflet-container{font-family:system-ui,sans-serif}.leaflet-control-attribution{font-size:10px}
      @media (max-width:600px){.leaflet-tooltip.ca-etiq{font-size:12px}}`;
    document.head.appendChild(s);
  }
  /** Lettre d'un hôpital : « Hôpital B — Mont-Clair » → B ; sinon l'initiale du nom. */
  function lettre(nom) {
    const m = /^(?:Hôpital|Hopital|Hospital)\s+([A-Z0-9])(?:\s|$|—|-)/.exec(nom || '');
    if (m) return m[1];
    const mots = String(nom || '?').replace(/^(Hôpital|Centre hospitalier|CHU|Hospital)\s+(du |de la |de l’|des |de |d’)?/i, '').trim();
    return (mots[0] || '?').toUpperCase();
  }
  /** Nom court : la partie avant « — ». */
  const court = (nom) => {
    const m = /^(CHSLD|RPA|RI|RTF|Maison des aînés)\s+\d+\s+—\s+(.+)$/.exec(String(nom || ''));
    return m ? `${m[1]} ${m[2]}` : String(nom || '').split(/\s+—\s+/)[0];
  };
  const fiche = (titre, lignes) => `<div class="ca-fiche"><b>${esc(titre)}</b>${lignes.filter(Boolean).map((l) => `<span>${esc(l)}</span>`).join('')}</div>`;

  /**
   * Dessine la carte dans `zone`. Options :
   * hopitaux [{ id, nom, latitude, longitude, niveau ('vert'|'orange'|'rouge'|null), etiquette, details[], moi }]
   * ambulances [{ numero, latitude, longitude, mission, etiquette, details[], vers: { latitude, longitude }, minutes }]
   * hebergements [{ nom, latitude, longitude, details[] }], langue ('fr'|'en'), legende (bool)
   */
  async function dessiner(zone, o) {
    if (!zone) return null;
    styles();
    const L = await leaflet();
    const T = TXT[o.langue === 'en' ? 'en' : 'fr'];
    if (zone._carteArrimo) { zone._carteArrimo.remove(); zone._carteArrimo = null; }
    zone.classList.add('ca-zone');
    const carte = L.map(zone, { scrollWheelZoom: false, zoomControl: true, attributionControl: true, tap: true });
    zone._carteArrimo = carte;
    // Fond clair et épuré : routes principales et noms de villes seulement
    // Fond OpenStreetMap éclairci et désaturé (classe ca-fond) : routes et villes lisibles, détails effacés, symboles mis en avant
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 16, attribution: '&copy; OpenStreetMap', className: 'ca-fond' }).addTo(carte);
    const pts = [];
    const etiquette = (m, texte, classe = '', direction = 'right') => texte && m.bindTooltip(esc(texte), { permanent: true, direction,
      offset: direction === 'right' ? [16, 0] : direction === 'bottom' ? [0, 8] : [0, -12], className: `ca-etiq ${classe}` });
    for (const h of (o.hebergements || []).filter((x) => x.latitude != null)) {
      const p = [h.latitude, h.longitude]; pts.push(p);
      const m = L.marker(p, { icon: L.divIcon({ className: '', html: '<div class="ca-heb"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), keyboard: true, title: h.nom }).addTo(carte);
      etiquette(m, court(h.nom), 'heb prio-3', 'bottom'); m.bindPopup(fiche(h.nom, h.details || []));
    }
    for (const h of (o.hopitaux || []).filter((x) => x.latitude != null)) {
      const p = [h.latitude, h.longitude]; pts.push(p);
      const html = `<div class="ca-hop${h.moi ? ' moi' : ''}" style="background:${COUL[h.niveau] || COUL.inconnu};color:${h.niveau === 'orange' || h.niveau === 'jaune' ? '#1F2937' : '#fff'}">${esc(lettre(h.nom))}</div>`;
      const m = L.marker(p, { icon: L.divIcon({ className: '', html, iconSize: [34, 34], iconAnchor: [17, 17] }), keyboard: true, title: h.nom, zIndexOffset: 500 }).addTo(carte);
      etiquette(m, h.etiquette || court(h.nom), `prio-${h.prio || 1}`); m.bindPopup(fiche(h.nom, h.details || []));
    }
    for (const a of (o.ambulances || []).filter((x) => x.latitude != null)) {
      const p = [a.latitude, a.longitude]; pts.push(p);
      if (a.vers?.latitude != null) {
        const ligne = L.polyline([p, [a.vers.latitude, a.vers.longitude]], { color: '#B45309', weight: 3, dashArray: '6 7', opacity: 0.9, interactive: false }).addTo(carte);
        if (a.minutes != null) ligne.bindTooltip(T.min.replace('{n}', a.minutes), { permanent: true, direction: 'center', className: 'ca-duree' });
      }
      const html = `<div class="ca-amb" style="background:${a.mission ? AMB.mission : AMB.libre}">${esc(String(a.numero).replace(/^[A-Z]+-/, ''))}</div>`;
      const m = L.marker(p, { icon: L.divIcon({ className: '', html, iconSize: [34, 22], iconAnchor: [17, 11] }), keyboard: true, title: a.numero, zIndexOffset: 1000 }).addTo(carte);
      etiquette(m, a.etiquette || a.numero, `amb ${a.mission ? 'prio-2' : 'prio-3'}`, 'top'); m.bindPopup(fiche(a.numero, a.details || []));
    }
    // Étiquettes lisibles : une étiquette moins importante qui en chevauche une autre (ou un symbole) est masquée ; le détail reste au clic
    const desencombrer = () => {
      const gardees = [...zone.querySelectorAll('.ca-hop, .ca-amb, .ca-heb')].map((x) => x.getBoundingClientRect());
      for (const prio of ['prio-1', 'prio-2', 'prio-3']) {
        for (const e of zone.querySelectorAll(`.ca-etiq.${prio}`)) {
          e.style.visibility = '';
          const r = e.getBoundingClientRect(); const marge = 2;
          const chevauche = gardees.some((g) => !(r.right < g.left + marge || r.left > g.right - marge || r.bottom < g.top + marge || r.top > g.bottom - marge));
          if (chevauche && prio !== 'prio-1') e.style.visibility = 'hidden'; else gardees.push(r);
        }
      }
    };
    carte.on('zoomend moveend', desencombrer);
    // Cadrage : les symboles prioritaires (o.cadrer) si fournis, sinon tous
    const cadre = o.cadrer?.length ? o.cadrer : pts;
    if (cadre.length > 1) carte.fitBounds(cadre, { padding: [46, 46], maxZoom: 13 }); else if (cadre.length) carte.setView(cadre[0], 12); else carte.setView([46.8, -71.2], 7);
    // Légende d'une seule ligne
    if (o.legende !== false) {
      let leg = zone.nextElementSibling;
      if (!leg || !leg.classList.contains('ca-legende')) { leg = document.createElement('div'); leg.className = 'ca-legende'; zone.after(leg); }
      const rond = (c) => `<i style="width:11px;height:11px;border-radius:50%;background:${c}"></i>`;
      leg.innerHTML = [`${rond(COUL.vert)}${esc(T.dispo)}`, `${rond(COUL.orange)}${esc(T.limitee)}`, `${rond(COUL.rouge)}${esc(T.saturee)}`,
        `<i style="width:16px;height:11px;border-radius:3px;background:${AMB.mission}"></i>${esc(T.ambulance)}`,
        ...((o.hebergements || []).length ? [`<i style="width:11px;height:11px;background:${HEB}"></i>${esc(T.hebergement)}`] : [])].map((x) => `<span>${x}</span>`).join('');
    }
    setTimeout(desencombrer, 50);
    return carte;
  }
  /** Niveau affiché d'un hôpital : la déclaration de saturation ou de délestage prime ; sinon le niveau mesuré des civières. */
  function niveau(h) {
    const d = h.statut_declare && !h.statut_declare.perime ? h.statut_declare.statut : null;
    if (d === 'saturation' || d === 'delestage') return 'rouge';
    if (d === 'capacite_limitee') return 'orange';
    const n = h.urgence?.niveau;
    return n === 'jaune' ? 'orange' : n || null;
  }
  window.ArrimoCarte = { dessiner, niveau, lettre, court };
})();
