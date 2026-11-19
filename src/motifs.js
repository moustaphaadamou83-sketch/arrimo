'use strict';
/**
 * Motifs fermés communs (moteur commun, lot 0) : refus d'une demande, quel que soit le circuit. Jamais de texte libre clinique.
 * Chaque circuit garde sa liste (contrainte de sa table) ; ce fichier donne le libellé FR/EN de tous les codes.
 */
const MOTIFS = {
  pas_de_lit: { fr: 'Aucun lit adapté', en: 'No suitable bed' },
  pas_de_personnel: { fr: 'Personnel insuffisant', en: 'Insufficient staff' },
  plateau_technique: { fr: 'Plateau technique non disponible', en: 'Technical platform unavailable' },
  capacite_insuffisante: { fr: 'Capacité insuffisante', en: 'Insufficient capacity' },
  besoin_non_couvert: { fr: 'Besoin non couvert', en: 'Need not covered' },
  place_plus_disponible: { fr: 'Place plus disponible', en: 'Place no longer available' },
  dossier_incomplet: { fr: 'Dossier incomplet', en: 'Incomplete file' },
  choix_usager: { fr: 'Choix de l’usager ou de la famille', en: 'Patient or family choice' },
  aucune_unite: { fr: 'Aucune unité disponible', en: 'No unit available' },
  hors_territoire: { fr: 'Hors territoire', en: 'Outside service area' },
  hors_secteur: { fr: 'Hors secteur', en: 'Outside sector' },
  deja_en_mission: { fr: 'Déjà en mission', en: 'Already on a mission' },
  equipage_indisponible: { fr: 'Équipage indisponible', en: 'Crew unavailable' },
  autre: { fr: 'Autre', en: 'Other' },
};
const PAR_CIRCUIT = {
  transfert: ['pas_de_lit', 'pas_de_personnel', 'plateau_technique', 'autre'],
  hebergement: ['capacite_insuffisante', 'besoin_non_couvert', 'place_plus_disponible', 'dossier_incomplet', 'choix_usager', 'autre'],
  transport: ['aucune_unite', 'hors_territoire', 'autre'],
  mission_ccs: ['deja_en_mission', 'hors_secteur', 'equipage_indisponible', 'autre'],
  prealerte: [],
};
const libelle = (code, langue = 'fr') => (MOTIFS[code] ? MOTIFS[code][langue === 'en' ? 'en' : 'fr'] : null);
const valide = (circuit, code) => (PAR_CIRCUIT[circuit] || []).includes(code);
const liste = (circuit, langue = 'fr') => (PAR_CIRCUIT[circuit] || []).map((code) => ({ code, libelle: libelle(code, langue) }));
module.exports = { MOTIFS, PAR_CIRCUIT, libelle, valide, liste };
