/* Icônes professionnelles (directive du 23 nov. 2026) : aucun emoji décoratif dans l'interface. Les données historiques (catalogue de
   formation, cartes de modules SH) gardent un code emoji ; il est traduit ici en icône SVG Lucide (jeu unique : /icones.svg). */
(() => {
  const M = { '🖥': 'monitor', '⏱': 'timer', '⚠': 'triangle-alert', '✔': 'check', '✓': 'check', '📈': 'trending-up', '📣': 'megaphone', '↘': 'arrow-down-right',
    '↗': 'arrow-up-right', '⇄': 'arrow-right-left', '↔': 'arrow-left-right', '🛏': 'bed-double', '✉': 'mail', '🧪': 'flask-conical', '✍': 'pen-line', '🩺': 'stethoscope',
    '🏠': 'house', '🚨': 'siren', '🧽': 'spray-can', '📊': 'chart-column', '⚙': 'settings', '🎓': 'graduation-cap', '🏅': 'award', '📄': 'file-text', '★': 'star',
    '💬': 'message-square', '📋': 'clipboard-list', '👆': 'pointer', '🎯': 'target', '🎉': 'party-popper', '🆘': 'life-buoy', '✕': 'x', '🏥': 'hospital', '🏡': 'house',
    '🚑': 'ambulance', '👨': 'users', '👩': 'users', '👧': 'users', '✨': 'sparkles', '🧭': 'compass', '🔌': 'plug', '🔁': 'repeat', '🚐': 'truck', '✅': 'circle-check',
    '🛡': 'shield-check', '🌡': 'thermometer', '☀': 'sun', '🌙': 'moon', '🌤': 'cloud-sun', '☁': 'cloud', '🌫': 'cloud-fog', '🌦': 'cloud-sun-rain', '🌧': 'cloud-rain',
    '❄': 'snowflake', '⛈': 'cloud-lightning', '🏘': 'building', '📡': 'radio-tower', '👁': 'eye', '🧩': 'puzzle', '📞': 'message-square', '🤝': 'heart-handshake',
    '🧠': 'puzzle', '📦': 'clipboard-list', '🧾': 'file-text', '🗺': 'map-pin', '📍': 'map-pin', '🕒': 'clock', '⏰': 'clock', '🔔': 'bell', '🔒': 'shield-check', '🔍': 'search',
    '🗓': 'clock', '📅': 'clock', '🛠': 'settings', '🔧': 'settings', '🏢': 'building-2', '🏨': 'building-2', '👥': 'users', '👤': 'user', '🧑': 'user', '🤖': 'sparkles',
    '🎙': 'mic', '🔊': 'audio-lines', '📝': 'pen-line', '📚': 'graduation-cap', '🚦': 'gauge', '⚡': 'activity', '❤': 'heart-handshake', '💊': 'flask-conical' };
  const nom = (e) => M[String(e || '').replace(/️/g, '').trim()] || (/[^\x00-\x7F]/.test(String(e || '')) ? 'info' : String(e || 'info'));
  /** Icône SVG pour un code emoji (ou un nom d'icône) ; décorative (aria-hidden), le texte voisin porte le sens. */
  window.icone = window.icone || ((n, cls = 'ic') => `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="/icones.svg#i-${n}"/></svg>`);
  window.icoEmoji = (e, cls = 'ic') => `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="/icones.svg#i-${nom(e)}"/></svg>`;
})();
