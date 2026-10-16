/**
 * Textes produits par le serveur (Copilote, recommandations, notifications, blocages), en français et en anglais.
 * La langue vient de l'en-tête X-Langue ou du paramètre `langue` (fr par défaut) et suit l'utilisateur
 * (utilisateur.langue) dans les fonctions de service.
 */
const LANGUES = ['fr', 'en'];

const TEXTES = {
  fr: {
    locale: 'fr-CA',
    niveau: { vert: 'vert', jaune: 'jaune', orange: 'orange', rouge: 'rouge' },
    niveau_maj: { vert: 'Vert', jaune: 'Jaune', orange: 'Orange', rouge: 'Rouge' },
    provenance: { urgence: 'urgence', bloc: 'bloc opératoire', externe: 'externe', autre: 'autre' },
    orientation: { chsld: 'CHSLD', ri: 'ressource intermédiaire', readaptation: 'réadaptation', domicile: 'retour à domicile', palliatif: 'soins palliatifs', autre: 'autre' },
    // recherche d'un lit ailleurs
    route: '≈ {min} min de route ({km} km)',
    dispo_libres: '{n} lit(s) adapté(s) libre(s)',
    dispo_prevus: 'aucun lit libre, {n} prévu(s) d’ici {h} h',
    tension_vert: 'niveau vert',
    tension: 'niveau {niveau}, pression {p} %',
    pourquoi_proche: 'Recommandé : le plus proche avec un lit adapté',
    pourquoi_un: 'Recommandé : {noms} est plus proche mais en {niveaux}',
    pourquoi_plusieurs: 'Recommandé : {noms} sont plus proches mais en {niveaux}',
    // nettoyage
    net_attente: '{n} patient(s) attendent un lit en {type}',
    net_long: 'En attente depuis plus de {min} min',
    net_ordre: 'Ordre d’arrivée',
    // blocages
    blocage: {
      nettoyage_long: 'Nettoyage depuis {min} min (cible {cible} min)',
      reserve_long: 'Réservé depuis {min} min sans admission',
      conge_depasse: 'Congé prévu dépassé de {h} h (attente d’hébergement ?)',
      hors_service_long: 'Hors service depuis {h} h',
    },
    // notifications
    notif: {
      transfert_demande: 'Nouvelle demande {numero}{urgent} : {type}, lit {lit} réservé, depuis {origine}.',
      transfert_accepte: '{dest} accepte le transfert {numero} (lit {lit}).',
      transfert_refuse: '{dest} refuse le transfert {numero}. Cherchez un autre lit.',
      transfert_depart: 'Le patient {ref} du transfert {numero} est en route.',
      transfert_recu: 'Patient {ref} reçu à {dest}.',
    },
    // Copilote : recommandations
    r_assigner: 'Assigner le lit {lit} à {ref}',
    r_assigner_raison: 'Attend un lit en {type} depuis {min} min ({prio}, {prov}). Ce lit libre respecte ses besoins.',
    r_assigner_action: 'Assigner ce lit',
    r_nettoyer: 'Prioriser le nettoyage du lit {lit}',
    r_nettoyer_raison: '{ref} attend un lit en {type} depuis {min} min et aucun lit adapté n’est libre. Ce lit sera le premier disponible.',
    r_nettoyer_action: 'Lancer le nettoyage',
    r_transferer: 'Transférer {ref} vers {etab}',
    r_transferer_raison: 'Aucun lit adapté ici. {etab} : {raison}.{pourquoi}',
    r_transferer_action: 'Demander le transfert à {etab}',
    r_aucun: 'Aucun lit pour {ref}',
    r_aucun_raison: 'Aucun lit adapté ici ni dans le rayon de {km} km. Escaladez à la coordination régionale.',
    r_repondre: 'Répondre à la demande {numero}',
    r_repondre_raison: '{origine} attend votre réponse depuis {min} min{urgent}. Lit {lit} déjà bloqué pour ce patient.',
    r_urgent: ' (urgent)',
    r_repondre_action: 'Accepter',
    r_transport: 'Organiser le transport de {numero}',
    r_transport_raison: '{dest} a accepté. Le lit est réservé.',
    r_transport_action: 'Organiser le transport',
    r_reservation: 'Libérer la réservation du lit {lit}',
    r_reservation_action: 'Annuler la réservation',
    r_net_retard: 'Nettoyage en retard : {lit}',
    r_net_retard_raison: 'En attente depuis {min} min (cible {cible} min).',
    r_net_retard_action: 'Confirmer le nettoyage',
    r_conge: 'Confirmer le congé du lit {lit}',
    r_conge_raison: 'Congé prévu à {heure}. Le confirmer permet de planifier le nettoyage et l’admission suivante.',
    r_conge_action: 'Confirmer le congé',
    r_depasses: '{n} congé(s) prévu(s) dépassé(s)',
    r_depasses_raison: 'Lits {lits}. Vérifiez ce qui bloque la sortie (transport, hébergement, résultats) ou mettez à jour la date.',
    r_nsa: 'NSA : {taux} % des lits occupés (cible {cible} %)',
    r_nsa_raison: '{n} patient(s) n’ont plus besoin de soins aigus{longs}. Orientations : {orient}. Relancez le mécanisme d’accès à l’hébergement.',
    r_nsa_longs: ', dont {n} depuis plus de 30 jours',
    r_sature: '{type} : saturé, aucun lit prévu d’ici {h} h',
    r_sature_option: 'Préparez des transferts sortants. Meilleure option : {etab} ({raison}).',
    r_sature_aucun: 'Aucune place dans le rayon. Escaladez à la coordination régionale.',
    r_fermes: '{n} lit(s) fermé(s) faute de personnel',
    r_fermes_raison: 'Capacité perdue. À signaler à la direction des soins infirmiers si du personnel peut être redéployé.',
    resume: 'Niveau {niveau} (pression {p} %). {libres} lit(s) libre(s), {prevus} prévu(s) d’ici {h} h, {attente} patient(s) en attente d’un lit{longue}. {net} lit(s) à nettoyer, {nsa} patient(s) NSA ({taux} %).',
    resume_longue: ', dont {n} depuis plus de {h} h',
    delestage: '{de} est au niveau {niveau} ; {vers}, le plus proche avec de la place, a {n} lit(s) libre(s) en {type}.',
    // Copilote : questions
    q_nsa: '{n} patient(s) NSA, soit {taux} % des lits occupés (cible {cible} %), pour {jl} jours-lits.',
    q_ligne: '• {a} : {b}',
    q_attente: '{n} patient(s) attendent un lit :',
    q_attente_ligne: '• {ref} · {type} · {prio} · {min} min',
    q_attente_lit: ' · lit {lit} disponible',
    q_attente_aucun_lit: ' · aucun lit adapté ici',
    q_attente_vide: 'Aucun patient en attente d’un lit.',
    q_nettoyage: 'Ordre de nettoyage recommandé :',
    q_nettoyage_vide: 'Aucun lit à nettoyer.',
    q_reseau_ligne: '• {nom} : niveau {niveau} (pression {p} %), {libres} lit(s) libre(s)',
    q_delestages: 'Délestages possibles :',
    q_blocages: '{n} blocage(s) à {etab} :',
    q_blocages_vide: 'Aucun blocage détecté à {etab}.',
    q_prevus: 'Lits qui devraient se libérer d’ici {h} h à {etab} :',
    q_prevus_note: 'Prévision basée sur les congés prévus et les nettoyages en cours.',
    q_ou_aucun: 'Aucun lit {type} libre dans le rayon de {km} km.',
    q_ou: 'Meilleure option en {type} : {etab} ({ville}, {km} km), {libres} lit(s) libre(s), {prevus} prévu(s).\nUtilisez « Chercher un lit ailleurs » pour réserver. La réservation demande toujours une validation.',
    q_combien: '• {type} : {ici} libre(s) ici, {reseau} dans le réseau',
    q_combien_sans: '• {type} : pas d’unité ici, {reseau} dans le réseau',
    q_aide: 'Je peux répondre à des questions comme :\n• Combien de lits libres en soins intensifs ?\n• Où trouver un lit de chirurgie le plus proche ?\n• Quels lits bloquent chez nous ?\n• Combien de lits vont se libérer d’ici ce soir ?',
    ia_langue: 'Réponds en français',
    courriel_sujet: 'Arrimo · Réinitialiser votre mot de passe',
    courriel_texte: 'Bonjour {nom},\n\nVous avez demandé à réinitialiser votre mot de passe Arrimo. Ouvrez ce lien pour en choisir un nouveau ; il est valable {min} minutes et ne sert qu’une fois :\n\n{lien}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce courriel : votre mot de passe ne change pas.\n\nArrimo',
  },
  en: {
    locale: 'en-CA',
    niveau: { vert: 'green', jaune: 'yellow', orange: 'orange', rouge: 'red' },
    niveau_maj: { vert: 'Green', jaune: 'Yellow', orange: 'Orange', rouge: 'Red' },
    provenance: { urgence: 'emergency', bloc: 'operating room', externe: 'external', autre: 'other' },
    orientation: { chsld: 'long-term care (CHSLD)', ri: 'intermediate resource', readaptation: 'rehabilitation', domicile: 'home with support', palliatif: 'palliative care', autre: 'other' },
    route: '≈ {min} min drive ({km} km)',
    dispo_libres: '{n} suitable bed(s) free',
    dispo_prevus: 'no free bed, {n} expected within {h} h',
    tension_vert: 'green level',
    tension: '{niveau} level, pressure {p}%',
    pourquoi_proche: 'Recommended: the closest with a suitable bed',
    pourquoi_un: 'Recommended: {noms} is closer but at {niveaux} level',
    pourquoi_plusieurs: 'Recommended: {noms} are closer but at {niveaux} level',
    net_attente: '{n} patient(s) waiting for a bed in {type}',
    net_long: 'Waiting for more than {min} min',
    net_ordre: 'Order of arrival',
    blocage: {
      nettoyage_long: 'Cleaning for {min} min (target {cible} min)',
      reserve_long: 'Reserved for {min} min without admission',
      conge_depasse: 'Planned discharge overdue by {h} h (waiting for placement?)',
      hors_service_long: 'Out of service for {h} h',
    },
    notif: {
      transfert_demande: 'New request {numero}{urgent}: {type}, bed {lit} reserved, from {origine}.',
      transfert_accepte: '{dest} accepted transfer {numero} (bed {lit}).',
      transfert_refuse: '{dest} declined transfer {numero}. Look for another bed.',
      transfert_depart: 'Patient {ref} from transfer {numero} is on the way.',
      transfert_recu: 'Patient {ref} received at {dest}.',
    },
    r_assigner: 'Assign bed {lit} to {ref}',
    r_assigner_raison: 'Waiting for a bed in {type} for {min} min ({prio}, {prov}). This free bed meets their needs.',
    r_assigner_action: 'Assign this bed',
    r_nettoyer: 'Prioritize cleaning of bed {lit}',
    r_nettoyer_raison: '{ref} has been waiting for a bed in {type} for {min} min and no suitable bed is free. This bed will be the first available.',
    r_nettoyer_action: 'Start cleaning',
    r_transferer: 'Transfer {ref} to {etab}',
    r_transferer_raison: 'No suitable bed here. {etab}: {raison}.{pourquoi}',
    r_transferer_action: 'Request transfer to {etab}',
    r_aucun: 'No bed for {ref}',
    r_aucun_raison: 'No suitable bed here or within {km} km. Escalate to regional coordination.',
    r_repondre: 'Respond to request {numero}',
    r_repondre_raison: '{origine} has been waiting for your answer for {min} min{urgent}. Bed {lit} is already held for this patient.',
    r_urgent: ' (urgent)',
    r_repondre_action: 'Accept',
    r_transport: 'Arrange transport for {numero}',
    r_transport_raison: '{dest} accepted. The bed is reserved.',
    r_transport_action: 'Arrange transport',
    r_reservation: 'Release the reservation on bed {lit}',
    r_reservation_action: 'Cancel reservation',
    r_net_retard: 'Cleaning overdue: {lit}',
    r_net_retard_raison: 'Waiting for {min} min (target {cible} min).',
    r_net_retard_action: 'Confirm cleaning',
    r_conge: 'Confirm discharge for bed {lit}',
    r_conge_raison: 'Discharge planned at {heure}. Confirming it helps plan cleaning and the next admission.',
    r_conge_action: 'Confirm discharge',
    r_depasses: '{n} planned discharge(s) overdue',
    r_depasses_raison: 'Beds {lits}. Check what is holding up the discharge (transport, placement, results) or update the date.',
    r_nsa: 'ALC: {taux}% of occupied beds (target {cible}%)',
    r_nsa_raison: '{n} patient(s) no longer need acute care{longs}. Destinations: {orient}. Follow up with the placement access process.',
    r_nsa_longs: ', including {n} for more than 30 days',
    r_sature: '{type}: full, no bed expected within {h} h',
    r_sature_option: 'Prepare outgoing transfers. Best option: {etab} ({raison}).',
    r_sature_aucun: 'No room within range. Escalate to regional coordination.',
    r_fermes: '{n} bed(s) closed for lack of staff',
    r_fermes_raison: 'Lost capacity. Report to nursing management if staff can be redeployed.',
    resume: '{niveau} level (pressure {p}%). {libres} free bed(s), {prevus} expected within {h} h, {attente} patient(s) waiting for a bed{longue}. {net} bed(s) to clean, {nsa} ALC patient(s) ({taux}%).',
    resume_longue: ', including {n} for more than {h} h',
    delestage: '{de} is at {niveau} level; {vers}, the closest with room, has {n} free bed(s) in {type}.',
    q_nsa: '{n} ALC patient(s), i.e. {taux}% of occupied beds (target {cible}%), for {jl} bed-days.',
    q_ligne: '• {a}: {b}',
    q_attente: '{n} patient(s) waiting for a bed:',
    q_attente_ligne: '• {ref} · {type} · {prio} · {min} min',
    q_attente_lit: ' · bed {lit} available',
    q_attente_aucun_lit: ' · no suitable bed here',
    q_attente_vide: 'No patient waiting for a bed.',
    q_nettoyage: 'Recommended cleaning order:',
    q_nettoyage_vide: 'No bed to clean.',
    q_reseau_ligne: '• {nom}: {niveau} level (pressure {p}%), {libres} free bed(s)',
    q_delestages: 'Possible offloading:',
    q_blocages: '{n} blockage(s) at {etab}:',
    q_blocages_vide: 'No blockage detected at {etab}.',
    q_prevus: 'Beds expected to free up within {h} h at {etab}:',
    q_prevus_note: 'Forecast based on planned discharges and cleanings in progress.',
    q_ou_aucun: 'No free {type} bed within {km} km.',
    q_ou: 'Best option for {type}: {etab} ({ville}, {km} km), {libres} free bed(s), {prevus} expected.\nUse “Find a bed elsewhere” to reserve. A reservation always requires confirmation.',
    q_combien: '• {type}: {ici} free here, {reseau} in the network',
    q_combien_sans: '• {type}: no unit here, {reseau} in the network',
    q_aide: 'I can answer questions such as:\n• How many free intensive care beds?\n• Where is the closest surgery bed?\n• Which beds are blocked here?\n• How many beds will free up by tonight?',
    ia_langue: 'Answer in English',
    courriel_sujet: 'Arrimo · Reset your password',
    courriel_texte: 'Hello {nom},\n\nYou asked to reset your Arrimo password. Open this link to choose a new one; it is valid for {min} minutes and can be used only once:\n\n{lien}\n\nIf you did not make this request, ignore this email: your password does not change.\n\nArrimo',
  },
};

const langueDe = (v) => (LANGUES.includes(v) ? v : 'fr');

/** Texte `cle` dans la langue, avec ses variables {nom}. Les clés imbriquées s'écrivent « blocage.reserve_long ». */
function tr(langue, cle, vars = {}) {
  const chercher = (l) => cle.split('.').reduce((o, k) => (o == null ? o : o[k]), TEXTES[l]);
  const modele = chercher(langueDe(langue)) ?? chercher('fr') ?? cle;
  return String(modele).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
}
const dico = (langue, nom) => TEXTES[langueDe(langue)][nom];

/* Noms des types d'unité dans la langue (types_unite.nom_en), avec un petit cache. */
let cacheTypes = { quand: 0, carte: new Map() };
async function chargerTypes(db) {
  if (Date.now() - cacheTypes.quand > 30000) {
    const { rows } = await db.query('SELECT nom, nom_en FROM types_unite');
    cacheTypes = { quand: Date.now(), carte: new Map(rows.map((r) => [r.nom, r.nom_en || r.nom])) };
  }
  return cacheTypes.carte;
}
function viderCacheTypes() { cacheTypes = { quand: 0, carte: new Map() }; }
/** Fonction de traduction d'un nom de type pour la langue donnée (identité en français). */
async function traducteurTypes(db, langue) {
  if (langueDe(langue) === 'fr') return (n) => n;
  const carte = await chargerTypes(db);
  return (n) => (n == null ? n : carte.get(n) || n);
}

/** Remplace en place les champs type_nom d'une réponse (objets et tableaux imbriqués). */
function traduireTypes(valeur, nomType) {
  if (Array.isArray(valeur)) valeur.forEach((v) => traduireTypes(v, nomType));
  else if (valeur && typeof valeur === 'object' && !(valeur instanceof Date)) {
    for (const [k, v] of Object.entries(valeur)) {
      if (k === 'type_nom' && typeof v === 'string') valeur[k] = nomType(v);
      else if (v && typeof v === 'object') traduireTypes(v, nomType);
    }
  }
  return valeur;
}

module.exports = { LANGUES, TEXTES, langueDe, tr, dico, traducteurTypes, traduireTypes, viderCacheTypes };
