'use strict';
/** Détection des demandes d'action dans une phrase (FR/EN). Les données extraites restent à vérifier dans la carte. */
const norm = (q) => String(q || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const INTERDIT = /\b(liber\w* (?:le |ce |un )?lit|discharge|free (?:the |this )?bed|fusionn\w*|merge (?:the |these )?(?:records|files)|supprim\w* (?:le |les |ce |ces )?(?:dossier|patient|donnees)|delete (?:the )?(?:record|patient|data)|diagnosti\w*|prescri\w*|posolog\w*|change\w* (?:les |ses )?droits|grant (?:access|rights)|priorit\w* clinique)/;
function detecter(question) {
  const q = norm(question);
  if (INTERDIT.test(q) && /\b(og|fais|faire|peux-tu|pourrais|please|can you|could you|do|vas-y|lance)\b|^(?:libere|fusionne|supprime|liberer|fusionner|supprimer|merge|delete|discharge)/.test(q)) return { refus: true };
  const ref = (String(question).match(/\b[A-Z]{1,3}-\d{3,12}\b/) || [])[0] || null;
  if (/(prepar\w*|cree\w*|faire|fais|ouvr\w*|prepare|create|open|start)\b.*\b(admission|admettre|admit)/.test(q) || /\b(admission|admit)\b.*\b(prepar\w*|prepare)\b/.test(q))
    return { outil: 'preparer_admission', entree: { patient_ref: ref, type_texte: String(question).slice(0, 300) } };
  if (/\b(relance\w*|remind\w*|follow up|nudge)\b/.test(q) && /\btr-\d{3,12}\b/.test(q))
    return { outil: 'relancer_transfert', entree: { numero: (String(question).match(/\bTR-\d{3,12}\b/i) || [''])[0].toUpperCase() } };
  if (/(prepar\w*|cree\w*|faire|fais|lance\w*|prepare|create|start|request)\b.*\btransf(?:ert|er)\w*/.test(q) && !/\b(ou en est|statut|status|where is|suivi)\b/.test(q))
    return { outil: 'preparer_transfert', entree: { patient_ref: ref, type_texte: String(question).slice(0, 300) } };
  if (/(cree\w*|ouvr\w*|signal\w*|create|open|file|log)\b.*\b(ticket|incident|demande de support|support request)/.test(q))
    return { outil: 'ticket_support', entree: { titre: '', description: '' } };
  return null;
}
module.exports = { detecter };
