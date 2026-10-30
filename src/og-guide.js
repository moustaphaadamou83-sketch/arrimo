'use strict';
/**
 * Guide d'utilisation par OG (cahier OG §13) : étapes courtes et écran à ouvrir, fondés sur les écrans réels
 * d'Arrimo. Un module désactivé pour l'établissement n'est jamais proposé.
 */
const norm = (q) => String(q || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const SUJETS = [
  { cle: 'transfert', re: /(transfert|transfer)/, vue: 'transferts', module: null,
    fr: ['Ouvrez « Transferts » ou utilisez la recherche par proximité dans « Réseau ».', 'Choisissez l’unité demandée, puis une destination qui a un lit confirmé.', 'Indiquez la référence du patient et envoyez : la destination accepte ou refuse.', 'Suivez ensuite les étapes : transport, départ, réception.', 'Avec OG : « Prépare un transfert de P-… » prépare la demande à confirmer.'],
    en: ['Open “Transfers” or use the proximity search in “Network”.', 'Choose the requested unit, then a destination with a confirmed bed.', 'Enter the patient reference and send: the destination accepts or declines.', 'Then follow the steps: transport, departure, receipt.', 'With OG: “Prepare a transfer for P-…” prepares a request for you to confirm.'] },
  { cle: 'bloque', re: /(lit\w* bloque|bloque\w*|hors service|blocked bed|out of service)/, vue: 'lits', module: null,
    fr: ['Ouvrez « Lits » : les lits hors service ou en attente apparaissent avec leur durée.', 'Le tableau de bord « Vigilance » signale les blocages anciens.'], en: ['Open “Beds”: out-of-service or pending beds show their duration.', 'The “Watch” dashboard flags long-standing blockages.'] },
  { cle: 'statut', re: /(modifier|changer|change|update)\b.*\b(statut|etat|status)/, vue: 'lits', module: null,
    fr: ['Ouvrez « Lits », choisissez le lit, puis l’action proposée (réserver, occuper, libérer, nettoyage).', 'Seules les actions permises par votre rôle et l’état actuel du lit sont affichées ; chaque changement est journalisé.'],
    en: ['Open “Beds”, select the bed, then the available action (reserve, occupy, release, cleaning).', 'Only actions allowed by your role and the bed’s current state are shown; every change is logged.'] },
  { cle: 'nettoyage', re: /(nettoy|entretien|clean)/, vue: 'nettoyage', module: 'nettoyage',
    fr: ['Ouvrez « Nettoyage » : la file montre les lits à nettoyer par priorité.', 'L’équipe d’entretien démarre puis confirme le nettoyage ; seule cette confirmation rend le lit libre.'],
    en: ['Open “Cleaning”: the queue lists beds to clean by priority.', 'The housekeeping team starts and then confirms cleaning; only that confirmation makes the bed available.'] },
  { cle: 'admission', re: /(admission|admettre|admit)/, vue: 'admissions', module: null,
    fr: ['Ouvrez « Admissions » et créez une demande avec la référence du patient et l’unité.', 'La coordination attribue ensuite un lit ; OG peut préparer la demande (« Prépare l’admission de P-… »).'],
    en: ['Open “Admissions” and create a request with the patient reference and unit.', 'Coordination then assigns a bed; OG can prepare the request (“Prepare an admission for P-…”).'] },
  { cle: 'civiere', re: /(civiere|stretcher|urgence|emergency)/, vue: 'urgence', module: 'urgence',
    fr: ['Ouvrez « Urgence » : chaque civière affiche son patient, sa durée et son état.', 'Les séjours de plus de 24 h et 48 h sont signalés.'], en: ['Open “Emergency”: each stretcher shows its patient, duration and status.', 'Stays over 24 h and 48 h are flagged.'] },
  { cle: 'rapport', re: /(rapport|report|indicateur|statisti)/, vue: 'indicateurs', module: null,
    fr: ['Ouvrez « Indicateurs » : chiffres calculés depuis les données d’Arrimo, avec la période indiquée.'], en: ['Open “Indicators”: figures computed from Arrimo data, with the period shown.'] },
];
function guider(question, langue, modules = {}) {
  const q = norm(question);
  if (/\b[a-z]{1,3}-\d{2,}\b/.test(q)) return null; // une référence relève du suivi, pas du guide
  if (!/^(comment|ou (trouver|est|sont|voir)|how (do|can|to)|where (do|can|is|are)|explique|explain|aide|help)\b/.test(q)) return null;
  const s = SUJETS.find((x) => x.re.test(q)); if (!s) return null;
  const en = langue === 'en';
  if (s.module && modules[s.module] === false) return { mode: 'local', intentions: ['guide'], sources: [], reponse: en ? 'This module is not enabled for your facility. Contact your administrator.' : 'Ce module n’est pas activé pour votre établissement. Adressez-vous à votre administrateur.' };
  const etapes = en ? s.en : s.fr;
  return { mode: 'local', intentions: ['guide'], sources: [], ouvrir: s.vue, reponse: etapes.map((e, i) => `${i + 1}. ${e}`).join('\n') };
}
module.exports = { guider, SUJETS };
