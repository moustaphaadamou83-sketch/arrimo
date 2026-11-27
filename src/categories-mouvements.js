'use strict';
/**
 * Nomenclature universelle des mouvements (chantier refonte unifiée, cahiers du 26 nov. 2026, §4.2-4.3 du cahier directeur).
 * La catégorie dépend de la NATURE réelle du mouvement, jamais du seul véhicule : une ambulance pour un rendez-vous reste un transport
 * planifié ; seule une intervention d'urgence des secours (préalerte sans transport planifié) est « Secours 911 ».
 * Une même référence garde la même catégorie chez tous les acteurs (calcul déterministe à partir du mouvement, pas du point de vue).
 * Couleur, libellé ET forme : la couleur n'est jamais le seul moyen d'identification. Ces couleurs ne changent pas avec l'ambiance.
 */
const CATEGORIES = {
  interhospitalier: { fr: 'Interhospitalier', en: 'Inter-hospital', couleur: '#2563EB', texte: '#1D4ED8', fond: '#DBE7FE', forme: 'carre', icone: 'hospital' },
  interhebergement: { fr: 'Inter-hébergement', en: 'Between residences', couleur: '#7C3AED', texte: '#6D28D9', fond: '#EDE5FD', forme: 'rond', icone: 'house' },
  hopital_hebergement: { fr: 'Hôpital et hébergement', en: 'Hospital and residence', couleur: '#0D9488', texte: '#0F766E', fond: '#D5F3EF', forme: 'losange', icone: 'arrow-right-left' },
  secours_911: { fr: 'Secours 911', en: '911 emergency', couleur: '#C026D3', texte: '#A21CAF', fond: '#FBE2F7', forme: 'triangle', icone: 'siren' },
  transport_planifie: { fr: 'Transport planifié', en: 'Scheduled transport', couleur: '#0891B2', texte: '#0E7490', fond: '#D6F1F8', forme: 'pilule', icone: 'calendar-clock' },
  domicile: { fr: 'Domicile', en: 'Home', couleur: '#64748B', texte: '#475569', fond: '#E5E9EF', forme: 'contour', icone: 'house' },
  autre: { fr: 'Autres mouvements', en: 'Other movements', couleur: '#4F46E5', texte: '#4338CA', fond: '#E2E3FB', forme: 'anneau', icone: 'route' },
};
const estHopital = (t) => (t || 'hopital') === 'hopital';
const estHebergement = (t) => t != null && !estHopital(t);

/**
 * m = { type: 'transport' | 'transfert' | 'hebergement' | 'prealerte', origine_type, destination_type, destination_libre (bool),
 *       motif_transport, urgence (type d'urgence renseigné par l'établissement), provenance (demandes d'hébergement) }
 * Retourne { code, certain } : `certain` = false quand la nature est déduite faute d'information (à confirmer par une personne).
 */
function classer(m) {
  if (m.type === 'prealerte') return { code: 'secours_911', certain: true };
  if (m.type === 'transfert') return { code: 'interhospitalier', certain: true };
  if (m.type === 'hebergement') {
    if (m.provenance === 'domicile') return { code: 'domicile', certain: true };
    if (m.provenance === 'autre_chsld') return { code: 'interhebergement', certain: true };
    if (m.provenance === 'hopital' || (m.origine_type != null && estHopital(m.origine_type))) return { code: 'hopital_hebergement', certain: true };
    return { code: 'autre', certain: false };
  }
  if (m.type === 'transport') {
    // Demande d'urgence d'un établissement vers les secours (type d'urgence renseigné) : parcours Secours, jamais retardé
    if (m.urgence) return { code: 'secours_911', certain: true };
    if (m.motif_transport === 'retour_domicile' || (m.destination_libre && !m.destination_type)) return { code: 'domicile', certain: m.motif_transport === 'retour_domicile' };
    if (m.motif_transport === 'depart_nsa' || m.motif_transport === 'retour_chsld') return { code: 'hopital_hebergement', certain: true };
    const o = m.origine_type; const d = m.destination_type;
    if (estHebergement(o) && estHebergement(d)) return { code: 'interhebergement', certain: true };
    if ((estHopital(o) && estHebergement(d)) || (estHebergement(o) && estHopital(d) && m.motif_transport)) return { code: 'hopital_hebergement', certain: true };
    if (estHopital(o) && estHopital(d) && m.motif_transport === 'transfert_stable') return { code: 'interhospitalier', certain: true };
    // Rendez-vous, consultation, examen : transport organisé à l'avance, même en ambulance
    return { code: 'transport_planifie', certain: !!m.motif_transport || estHebergement(o) };
  }
  return { code: 'autre', certain: false };
}

function libelle(code, langue = 'fr') { const c = CATEGORIES[code] || CATEGORIES.autre; return langue === 'en' ? c.en : c.fr; }
/** Légende commune (même ordre partout) pour l'interface et les filtres. */
function legende(langue = 'fr') {
  return Object.entries(CATEGORIES).map(([code, c]) => ({ code, libelle: langue === 'en' ? c.en : c.fr, couleur: c.couleur, texte: c.texte, fond: c.fond, forme: c.forme, icone: c.icone }));
}

module.exports = { CATEGORIES, classer, libelle, legende };
