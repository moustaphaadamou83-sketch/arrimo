'use strict';
/**
 * OG dans un CHSLD : copilote connecté aux données réelles de l'établissement, avec les mêmes droits que l'interface.
 * - Résolveur de références : résident (R-00001, RES-0024), lit (ERA-117A, era117a), chambre, coordination (CO-00012),
 *   demande d'hébergement (DH-00003). Casse, espaces et tirets normalisés ; jamais de type ni de résultat inventé.
 * - Noms et prénoms avec fautes de frappe raisonnables ; en cas d'ambiguïté, OG demande de choisir (jamais de fusion).
 * - Contexte de conversation limité : le dernier résident ou la dernière place évoqués, par utilisateur et établissement.
 * - Outils métier ciblés (registre OUTILS) : chaque réponse vient d'une lecture autorisée, avec la date du dernier statut confirmé.
 * - OG propose ; une personne confirme. Il ne confirme jamais une arrivée physique, ne décide ni d'admissibilité, ni de
 *   priorité clinique, ni de l'attribution définitive d'une place.
 * Les noms de résidents ne sont affichés qu'aux personnes de l'établissement (démonstration et recette).
 */
const ch = require('./chsld');
const TE = require('./types-etablissement');
const { environnement } = require('./environnement');

const norm = (q) => String(q || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, ' ');
const fictifs = () => ['demo', 'recette'].includes(environnement()) || process.env.ARRIMO_PATIENTS_FICTIFS === '1';
const T = (L, fr, en) => (L === 'en' ? en : fr);
const nomResident = (r) => (fictifs() ? `${r.prenom} ${r.nom} (${r.reference})` : r.reference);
const normRef = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const GERER = ['coordonnateur', 'admin_etab', 'gestionnaire'];

/* ------------------------------------------------------------------ mémoire de conversation (sans persistance) */
const CONTEXTE = new Map();
const DUREE_CONTEXTE = 30 * 60 * 1000;
const cle = (u, e) => `${u.id}:${e}`;
function lireContexte(u, e) { const c = CONTEXTE.get(cle(u, e)); return c && Date.now() - c.t < DUREE_CONTEXTE ? c : {}; }
function ecrireContexte(u, e, v) {
  const k = cle(u, e); const avant = lireContexte(u, e);
  CONTEXTE.delete(k); CONTEXTE.set(k, { ...avant, ...v, t: Date.now() });
  if (CONTEXTE.size > 2000) CONTEXTE.delete(CONTEXTE.keys().next().value); // mémoire bornée
}

/* ------------------------------------------------------------------ compréhension tolérante aux fautes */
function distance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let avant = null; let prec = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i]; let min = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prec[j] + 1, cur[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (avant && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], avant[j - 2] + 1); // inversion de deux lettres
      min = Math.min(min, cur[j]);
    }
    if (min > max) return max + 1;
    avant = prec; prec = cur;
  }
  return prec[b.length];
}
/** Un mot de la question correspond-il à une racine ? (préfixe, ou une faute de frappe pour les racines de 6 lettres et plus) */
function racine(mot, r) {
  if (r.length <= 4) return mot === r || mot === `${r}s` || mot === `${r}e` || mot === `${r}es`;
  if (mot.startsWith(r)) return true;
  if (r.length < 6 || mot.length < r.length - 1) return false;
  return distance(mot.slice(0, r.length), r, 1) <= 1 || distance(mot.slice(0, r.length + 1), r, 1) <= 1 || distance(mot.slice(0, r.length - 1), r, 1) <= 1;
}
const LEXIQUE = {
  hospit: ['hospitali', 'hopital', 'hospital', 'urgence'],
  retour: ['retour', 'revien', 'reveni', 'revenir', 'return', 'back', 'coming'],
  chambre: ['chambre', 'room', 'lit', 'lits', 'bed', 'place', 'logement'],
  dispo: ['disponib', 'dispo', 'libre', 'available', 'free', 'vacant', 'vide'],
  nettoy: ['nettoy', 'propre', 'menage', 'clean', 'housekeep', 'entretien'],
  bloque: ['bloqu', 'indisponib', 'blocked', 'unavailable', 'hors service', 'ferme'],
  conserv: ['conserv', 'gardee', 'garde', 'held', 'kept', 'hold', 'reserve pour'],
  occupe: ['occup', 'occupied'],
  pret: ['pret', 'prete', 'ready', 'prepare'],
  ou: ['ou est', 'ou se trouve', 'il est ou', 'elle est ou', 'where', 'localis', 'situe', 'trouve'],
  quand: ['quand', 'when', 'date', 'heure', 'what time'],
  confirm: ['confirm'],
  depart: ['depart', 'parti', 'left', 'departure', 'leave'],
  arrive: ['arriv', 'recu', 'recue', 'reception', 'received', 'reached'],
  contact: ['contact', 'proche', 'famille', 'family', 'prevenir', 'repondant'],
  autoris: ['autoris', 'allowed', 'permission', 'qui peut recevoir', 'who can receive', 'authorized', 'authorised'],
  rappel: ['rappel', 'callback', 'call back', 'message', 'ecrire', 'rappeler'],
  tache: ['tache', 'task', 'travail', 'job', 'todo'],
  demande: ['demande', 'request', 'requete'],
  transfert: ['transfer', 'transfert', 'mouvement', 'movement', 'deplacement'],
  mouvement: ['mouvement', 'movement', 'evenement', 'event', 'historique', 'history'],
  admission: ['admission', 'admis', 'accueil', 'arrivee prevue', 'nouveaux residents', 'new resident', 'intake'],
  pourquoi: ['pourquoi', 'why', 'raison', 'reason', 'cause'],
  qui: ['qui', 'who', 'par qui', 'by whom'],
  notif: ['notification', 'alerte', 'alert'],
  module: ['module', 'fonctionnalit', 'feature', 'active', 'activated', 'enabled'],
  retard: ['retard', 'late', 'overdue', 'echeance depassee'],
};
function a(qn, mots, groupe) {
  return LEXIQUE[groupe].some((r) => (r.includes(' ') ? qn.includes(r) : mots.some((m) => racine(m, r))));
}
const LISTE = /\b(quel|quels|quelle|quelles|combien|liste|lister|montre|affiche|tous|toutes|which|how many|list|show|all|any|y a t il|est ce qu il y a)\b/;
const SUITE = /\b(il|elle|lui|sa|son|ses|leur|he|she|his|her|him|their|this resident|ce resident|cette residente|ce meme|celui ci|celle ci|cette chambre|ce lit|that room|this room|this bed)\b/;

/* ------------------------------------------------------------------ résolution des références et des noms */
// Jetons qui ressemblent à une référence : lettres puis chiffres (ERA117A, ERA-117A, R-00001, RES 24, CO-00012, DH-00003, P-71001)
const MOTIF_REF = /\b([A-Za-z]{1,6})[\s_-]?(\d{1,6})([A-Za-z]?)\b/g;
function referencesDe(q) {
  const out = [];
  for (const m of String(q).matchAll(MOTIF_REF)) {
    const [brut, pre, num, suf] = m;
    if (m.index > 1 && q[m.index - 1] === '-' && /\p{L}/u.test(q[m.index - 2])) continue; // fin d'un nom composé (Bouchard-Era12)
    if (/^(le|la|les|de|du|des|a|au|en|et|un|une|lit|bed|room|chambre|n|no|num|the|of|at|on|in|is|it)$/i.test(pre) && !suf) continue; // « chambre 117 » : numéro, pas une référence
    out.push({ brut: brut.trim(), pre: pre.toUpperCase(), num, suf: suf.toUpperCase(), norm: normRef(brut) });
  }
  return out;
}
async function resoudreReference(pool, etabId, ref) {
  // Résident : R-00001, R1, RES-0024
  if (/^(R|RES)$/.test(ref.pre) && !ref.suf) {
    const r = (await pool.query(`SELECT id FROM residents WHERE etablissement_id = $1 AND reference = $2`, [etabId, `R-${ref.num.padStart(5, '0')}`])).rows[0];
    if (r) return { type: 'resident', id: r.id };
  }
  const n = ref.norm;
  const res = (await pool.query(`SELECT id FROM residents WHERE etablissement_id = $1 AND upper(regexp_replace(reference, '[^A-Za-z0-9]', '', 'g')) = $2`, [etabId, n])).rows[0];
  if (res) return { type: 'resident', id: res.id };
  const lit = (await pool.query(`SELECT l.id, r.id AS resident_id FROM lits l LEFT JOIN residents r ON r.lit_id = l.id AND r.statut NOT IN ('sorti', 'transfere')
    WHERE l.etablissement_id = $1 AND upper(regexp_replace(l.code, '[^A-Za-z0-9]', '', 'g')) = $2`, [etabId, n])).rows[0];
  if (lit) return lit.resident_id ? { type: 'resident', id: lit.resident_id, via_lit: lit.id } : { type: 'lit', id: lit.id };
  const co = (await pool.query(`SELECT id FROM coordinations WHERE (origine_id = $1 OR destination_id = $1) AND upper(regexp_replace(numero, '[^A-Za-z0-9]', '', 'g')) = $2`, [etabId, n])).rows[0];
  if (co) return { type: 'coordination', id: co.id };
  const dh = (await pool.query(`SELECT id FROM demandes_hebergement WHERE etablissement_id = $1 AND upper(regexp_replace(numero, '[^A-Za-z0-9]', '', 'g')) = $2`, [etabId, n])).rows[0];
  if (dh) return { type: 'demande', id: dh.id };
  return null;
}
/** Résidents nommés dans la question : prénom et nom, nom seul (s'il est unique), fautes de frappe d'une lettre tolérées. */
function residentsNommes(liste, qn) {
  const mots = qn.split(/[^a-z0-9]+/).filter((m) => m.length > 1);
  const proche = (m, x) => m === x || (x.length >= 5 && distance(m, x, 1) <= 1);
  const score = (r) => {
    const nom = norm(r.nom), prenom = norm(r.prenom);
    const parties = nom.split(/[^a-z0-9]+/).filter(Boolean);
    const n = mots.some((m) => proche(m, nom)) || (parties.length > 1 && parties.every((x) => mots.some((m) => proche(m, x)))), p = mots.some((m) => m === prenom || (prenom.length >= 5 && distance(m, prenom, 1) <= 1));
    return n && p ? 3 : n ? 2 : p ? 1 : 0;
  };
  const notes = liste.map((r) => [r, score(r)]).filter(([, s]) => s > 0);
  // Prénom et nom, sinon nom seul, sinon prénom seul : jamais de fusion, plusieurs résultats = choix demandé
  for (const niveau of [3, 2, 1]) { const x = notes.filter(([, s]) => s === niveau).map(([r]) => r); if (x.length) return Object.assign(x, { niveau }); }
  return Object.assign([], { niveau: 0 });
}

/* ------------------------------------------------------------------ mise en forme */
function formateur(L, fuseau) {
  return (d) => (d ? new Date(d).toLocaleString(L === 'en' ? 'en-CA' : 'fr-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: fuseau }) : '—');
}
const OCC = {
  fr: { occupee: 'occupée', conservee_hospitalisation: 'place conservée — hospitalisation', disponible: 'disponible', bloquee: 'bloquée', reservee: 'réservée', preparation: 'en préparation' },
  en: { occupee: 'occupied', conservee_hospitalisation: 'place held — hospital stay', disponible: 'available', bloquee: 'blocked', reservee: 'reserved', preparation: 'being prepared' },
};
const ENT = {
  fr: { propre: 'propre', a_nettoyer: 'à nettoyer', en_cours: 'nettoyage en cours', termine: 'nettoyage terminé, à valider' },
  en: { propre: 'clean', a_nettoyer: 'to clean', en_cours: 'cleaning in progress', termine: 'cleaning done, to validate' },
};
const STATUT = {
  fr: { present: 'présent au CHSLD', hospitalise: 'hospitalisé', retour_a_reintegrer: 'arrivé au CHSLD, réintégration à confirmer', absent: 'en absence temporaire', preadmission: 'accueil prévu', sorti: 'sorti', transfere: 'transféré', transfert_en_cours: 'transfert en cours' },
  en: { present: 'present at the CHSLD', hospitalise: 'in hospital', retour_a_reintegrer: 'arrived at the CHSLD, reinstatement to confirm', absent: 'temporarily absent', preadmission: 'admission planned', sorti: 'discharged', transfere: 'transferred', transfert_en_cours: 'transfer in progress' },
};
const RAISON = {
  fr: { aucune_place_attribuee: 'aucune place n’est plus attribuée au résident', place_bloquee: 'sa place est bloquée', place_reattribuee: 'sa place est attribuée à un autre résident',
    place_hors_service: 'sa place est hors service', place_non_reservee: 'sa place n’est plus réservée pour lui', preparation_en_cours: 'la préparation ou le nettoyage n’est pas terminé' },
  en: { aucune_place_attribuee: 'no place is assigned to the resident anymore', place_bloquee: 'the place is blocked', place_reattribuee: 'the place is assigned to another resident',
    place_hors_service: 'the place is out of service', place_non_reservee: 'the place is no longer reserved for them', preparation_en_cours: 'preparation or cleaning is not finished' },
};
const lng = (L) => (L === 'en' ? 'en' : 'fr');

/* ------------------------------------------------------------------ outils métier (lectures autorisées, résultats structurés) */
async function contexteResident(pool, u, etabId, id) {
  const f = await ch.ficheResident(pool, u, id);
  const co = (await ch.listeCoordinations(pool, u, etabId, { toutes: true })).filter((c) => c.resident_ref === f.resident.reference);
  const hosp = co.find((c) => c.type === 'hospitalisation') || null;
  const retour = co.find((c) => c.type === 'retour' && c.entrante && (['envoyee', 'acceptee', 'en_cours'].includes(c.statut) || c.a_reintegrer)) || null;
  const dernierRetour = co.find((c) => c.type === 'retour') || null;
  return { f, r: f.resident, hosp, retour, dernierRetour, ri: f.reintegration || (f.resident.lit_id ? await ch.etatReintegration(pool, f.resident.id) : null) };
}
const derniereEtape = (c) => (c?.etapes || []).at(-1) || null;
const etape = (c, s) => (c?.etapes || []).filter((e) => e.statut === s).at(-1) || null;
const etapeHosp = (h) => h?.etape || null; // calculée par le serveur : même étape pour le CHSLD et l'hôpital
const ETAPE_HOSP = {
  fr: { transmise: 'transmise, réception non encore confirmée par l’hôpital', recue_hopital: 'reçue par l’hôpital', acceptee: 'acceptée par l’hôpital', refusee: 'refusée par l’hôpital', annulee: 'annulée', expiree: 'expirée',
    depart_confirme: 'départ confirmé, arrivée non encore confirmée par l’hôpital', arrivee_confirmee: 'arrivée confirmée par l’hôpital', admission: 'arrivée confirmée, admission préparée', urgence: 'arrivée confirmée, accueil à l’urgence', retour_preparation: 'arrivée confirmée, retour en préparation', retour_arrive: 'arrivé au CHSLD, réintégration à confirmer', cloturee: 'parcours clos, retour reçu' },
  en: { transmise: 'sent, receipt not yet confirmed by the hospital', recue_hopital: 'received by the hospital', acceptee: 'accepted by the hospital', refusee: 'declined by the hospital', annulee: 'cancelled', expiree: 'expired',
    depart_confirme: 'departure confirmed, arrival not yet confirmed by the hospital', arrivee_confirmee: 'arrival confirmed by the hospital', admission: 'arrival confirmed, admission prepared', urgence: 'arrival confirmed, emergency reception', retour_preparation: 'arrival confirmed, return being prepared', retour_arrive: 'arrived at the CHSLD, reinstatement to confirm', cloturee: 'pathway closed, return received' },
};
const RETOUR_TXT = {
  fr: { envoyee: 'proposé par l’hôpital, en attente de votre acceptation', acceptee: 'accepté ; l’hôpital doit confirmer le départ', en_cours: 'départ confirmé par l’hôpital ; réception physique à confirmer par votre équipe', recue: 'arrivé au CHSLD ; réintégration à confirmer par votre équipe', refusee: 'refusé', annulee: 'annulé par l’hôpital', expiree: 'expiré' },
  en: { envoyee: 'proposed by the hospital, awaiting your acceptance', acceptee: 'accepted; the hospital must confirm departure', en_cours: 'departure confirmed by the hospital; physical arrival to be confirmed by your team', recue: 'arrived at the CHSLD; reinstatement to be confirmed by your team', refusee: 'declined', annulee: 'cancelled by the hospital', expiree: 'expired' },
};

/* ------------------------------------------------------------------ réponses sur un résident */
async function repondreResident(pool, u, etabId, e, x, qn, mots, L, fmt, local) {
  const { f, r, hosp, retour, dernierRetour, ri } = x;
  const n = nomResident(r); const l = lng(L);
  const lit = f.lit;
  const placeTxt = lit ? T(L, `${lit.unite}, chambre ${lit.chambre}, lit ${lit.code}`, `${lit.unite}, room ${lit.chambre}, bed ${lit.code}`) : T(L, 'aucune place attribuée', 'no place assigned');
  const dernierMvt = f.mouvements.find((m) => m.type !== 'modification');
  const has = (g) => a(qn, mots, g);

  // Contacts, autorisations, rappel (droits de communication respectés)
  const contacts = f.contacts;
  if (has('contact') && !has('autoris') && !has('rappel')) {
    const p = contacts.slice(0, /(deux|two|2)/.test(qn) ? 2 : /(principal|main|primary)/.test(qn) ? 1 : contacts.length);
    return local(p.length ? T(L, `Contacts de ${n} :\n${p.map((k) => `• ${k.prenom} ${k.nom} (${k.relation})${k.principal ? ', principal' : `, rang ${k.rang}`} · ${[k.telephone, k.courriel].filter(Boolean).join(' · ')}`).join('\n')}\nÊtre à prévenir ne donne pas accès aux informations : seules les autorisations comptent.`,
      `Contacts for ${n}:\n${p.map((k) => `• ${k.prenom} ${k.nom} (${k.relation})${k.principal ? ', primary' : `, rank ${k.rang}`} · ${[k.telephone, k.courriel].filter(Boolean).join(' · ')}`).join('\n')}\nBeing a contact to notify does not grant access to information: only permissions do.`)
      : T(L, `Aucun contact enregistré pour ${n}.`, `No contact recorded for ${n}.`), { intentions: ['contacts'] });
  }
  if (has('autoris')) {
    const au = contacts.filter((k) => k.autorisations.length);
    return local(au.length ? T(L, `Personnes autorisées à recevoir des informations sur ${n} :\n${au.map((k) => `• ${k.prenom} ${k.nom} (${k.relation}) : ${k.autorisations.join(', ')}${k.representant_legal ? ` · représentant légal ${k.representant_verifie_le ? '(mandat vérifié)' : '(mandat à vérifier)'}` : ''}`).join('\n')}`,
      `People authorized to receive information about ${n}:\n${au.map((k) => `• ${k.prenom} ${k.nom} (${k.relation}): ${k.autorisations.join(', ')}${k.representant_legal ? ` · legal representative ${k.representant_verifie_le ? '(mandate verified)' : '(mandate to verify)'}` : ''}`).join('\n')}`)
      : T(L, `Aucun proche n’est autorisé à recevoir des informations sur ${n}.`, `No family member is authorized to receive information about ${n}.`), { intentions: ['autorisations'] });
  }
  if (has('rappel') && !has('nettoy')) {
    const REL = { fille: 'fille', fils: 'fils', conjoint: 'conjoint', soeur: 'soeur', frere: 'frere', daughter: 'fille', son: 'fils', spouse: 'conjoint', sister: 'soeur', brother: 'frere' };
    const rel = Object.keys(REL).find((x) => mots.includes(x) && (x !== 'son' || L === 'en')); const relation = rel ? REL[rel] : null;
    const k = contacts.find((c) => (!relation || c.relation === relation) && c.autorisations.includes('administratif'));
    if (!k) return local(T(L, `Aucun proche${relation ? ` (${relation})` : ''} n’est autorisé pour les échanges administratifs : je ne prépare rien.`, `No family member${relation ? ` (${relation})` : ''} is authorized for administrative exchanges: I am not preparing anything.`), { intentions: ['communication'] });
    return local(T(L, `Voici une demande de rappel à confirmer pour ${k.prenom} ${k.nom} (${k.relation}). Rien n’est envoyé par courriel ou SMS.`, `Here is a callback request to confirm for ${k.prenom} ${k.nom} (${k.relation}). Nothing is sent by email or SMS.`),
      { intentions: ['communication'], proposition_chsld: { type: 'communication', resident_id: r.id, corps: { contact_id: k.id, type: 'rappel_demande', categorie: 'administratif', sujet: T(L, 'Demande de rappel de l’établissement', 'Callback request from the facility') } } });
  }
  // Tâche de nettoyage pour la chambre du résident : proposition à confirmer
  if (has('tache') || (/(lance|cree|creer|prepare|planifie|demande|start|create|schedule)/.test(qn) && has('nettoy'))) {
    if (!lit) return local(T(L, `${n} n’a aucune place attribuée : précisez la chambre.`, `${n} has no assigned place: specify the room.`), { intentions: ['tache'] });
    return local(T(L, `Voici une tâche de nettoyage à confirmer pour la chambre ${lit.chambre} (${lit.code}). Rien n’est créé avant votre confirmation ; l’attribution de la place ne change pas.`,
      `Here is a cleaning task to confirm for room ${lit.chambre} (${lit.code}). Nothing is created before you confirm; the place assignment does not change.`),
    { intentions: ['tache'], proposition_chsld: { type: 'tache', corps: { type: 'entretien', titre: T(L, `Nettoyage de la chambre ${lit.chambre}`, `Cleaning, room ${lit.chambre}`), lit_id: lit.id, assigne_role: 'entretien' } } });
  }
  // Statut de la demande vers l'hôpital (dernière étape confirmée et son horodatage)
  if ((/(ou en est|statut|status|suivi|progress|dernier statut|latest status)/.test(qn) && (has('demande') || has('transfert') || has('hospit'))) || (/(est il arrive|est elle arrivee|is he at|is she at|arrived|arrive a l|arrivee a l|reached)/.test(qn) && has('hospit'))) {
    if (!hosp) return local(T(L, `Aucune demande vers un hôpital n’est enregistrée pour ${n}.`, `No hospital request is recorded for ${n}.`), { intentions: ['liaison'] });
    const et = etapeHosp(hosp); const d = derniereEtape(hosp);
    const arrive = hosp.statut === 'recue';
    const prefixe = /(est il arrive|est elle arrivee|arrived|arrive a l|arrivee a l|reached|is he at|is she at)/.test(qn) ? (arrive ? T(L, 'Oui. ', 'Yes. ') : T(L, 'Pas encore confirmé. ', 'Not confirmed yet. ')) : '';
    return local(T(L, `${prefixe}Demande ${hosp.numero} de ${n} vers ${hosp.destination} : ${ETAPE_HOSP.fr[et] || et}. Dernière confirmation enregistrée le ${fmt(d?.date || hosp.modifie_le)}.${retour ? ` Retour en préparation (${retour.numero}, ${RETOUR_TXT.fr[retour.statut]}).` : ''}`,
      `${prefixe}Request ${hosp.numero} for ${n} to ${hosp.destination}: ${ETAPE_HOSP.en[et] || et}. Last confirmation recorded on ${fmt(d?.date || hosp.modifie_le)}.${retour ? ` Return being prepared (${retour.numero}, ${RETOUR_TXT.en[retour.statut]}).` : ''}`), { intentions: ['liaison'], ouvrir: 'c-mouvements' });
  }
  // Quand le départ a-t-il été confirmé ?
  if (has('depart') && (has('quand') || has('confirm'))) {
    const d = etape(hosp, 'en_cours');
    return local(d ? T(L, `Départ de ${n} vers ${hosp.destination} confirmé le ${fmt(d.date)}${d.par ? ` par ${d.par}` : ''}.`, `Departure of ${n} to ${hosp.destination} confirmed on ${fmt(d.date)}${d.par ? ` by ${d.par}` : ''}.`)
      : T(L, `Aucun départ confirmé n’est enregistré pour ${n}${hosp ? ` (demande ${hosp.numero} : ${ETAPE_HOSP.fr[etapeHosp(hosp)]})` : ''}.`, `No confirmed departure is recorded for ${n}${hosp ? ` (request ${hosp.numero}: ${ETAPE_HOSP.en[etapeHosp(hosp)]})` : ''}.`), { intentions: ['depart'] });
  }
  // Qui a confirmé sa réception ?
  if (has('qui') && (has('arrive') || has('confirm')) && !has('nettoy')) {
    const rr = dernierRetour && etape(dernierRetour, 'recue');
    if (rr) return local(T(L, `Le retour de ${n} au CHSLD a été confirmé le ${fmt(rr.date)}${rr.par ? ` par ${rr.par}` : ''}.`, `${n}’s return to the CHSLD was confirmed on ${fmt(rr.date)}${rr.par ? ` by ${rr.par}` : ''}.`), { intentions: ['retour'] });
    const ar = hosp && (etape(hosp, 'arrivee') || etape(hosp, 'recue'));
    if (ar) return local(T(L, `L’arrivée de ${n} a été confirmée par ${hosp.destination} le ${fmt(ar.date)} (nom de la personne non communiqué entre établissements).`, `${n}’s arrival was confirmed by ${hosp.destination} on ${fmt(ar.date)} (the person’s name is not shared between facilities).`), { intentions: ['liaison'] });
    return local(T(L, `Aucune réception confirmée n’est enregistrée pour ${n}.`, `No confirmed reception is recorded for ${n}.`), { intentions: ['retour'] });
  }
  // Pourquoi le retour / la réintégration est-il bloqué ?
  if (has('pourquoi') && (has('retour') || /(reintegr|bloqu|blocked|reinstat)/.test(qn))) {
    if (!ri) return local(T(L, `Aucune réintégration n’est en cours pour ${n}.`, `No reinstatement is in progress for ${n}.`), { intentions: ['retour'] });
    return local(ri.raisons.length ? T(L, `Réintégration de ${n} non prête : ${ri.raisons.map((x) => RAISON.fr[x]).join(' ; ')}.${ri.bloquante ? ' Aucune autre place n’est attribuée automatiquement : un responsable doit valider une solution (Transferts et hospitalisations → résoudre).' : ' Terminez la préparation, puis confirmez la réception physique.'}`,
      `${n}’s reinstatement is not ready: ${ri.raisons.map((x) => RAISON.en[x]).join('; ')}.${ri.bloquante ? ' No other place is assigned automatically: a manager must approve a solution (Transfers and hospital stays → resolve).' : ' Finish the preparation, then confirm the physical arrival.'}`)
      : T(L, `Rien ne bloque : la place ${ri.lit.code} (chambre ${ri.lit.chambre}) est attribuée, libre et prête. Le retour sera confirmé par votre équipe à l’arrivée physique.`, `Nothing is blocking: place ${ri.lit.code} (room ${ri.lit.chambre}) is assigned, free and ready. Your team confirms the return at physical arrival.`), { intentions: ['retour'] });
  }
  // Nettoyage de sa chambre ; qui l'a terminé
  if (has('nettoy')) {
    if (!lit) return local(T(L, `${n} n’a aucune place attribuée.`, `${n} has no assigned place.`), { intentions: ['nettoyage'] });
    const p = (await ch.places(pool, u, etabId)).find((x) => x.id === lit.id);
    const taches = ri?.taches || [];
    const ent = ENT[l][p.entretien] || p.entretien;
    return local(T(L, `Chambre ${lit.chambre} (${lit.code}) de ${n} : ${ent}${p.entretien === 'propre' && p.entretien_le ? `, nettoyage confirmé le ${fmt(p.entretien_le)}${p.entretien_par ? ` par ${p.entretien_par}` : ''}` : ''}. Occupation : ${OCC.fr[p.occupation] || p.occupation}.${taches.length ? `\nTâches ouvertes : ${taches.map((t) => `${t.titre} (${t.statut === 'en_cours' ? 'en cours' : 'à faire'})`).join(' ; ')}.` : ''}`,
      `Room ${lit.chambre} (${lit.code}) of ${n}: ${ent}${p.entretien === 'propre' && p.entretien_le ? `, cleaning confirmed on ${fmt(p.entretien_le)}${p.entretien_par ? ` by ${p.entretien_par}` : ''}` : ''}. Occupancy: ${OCC.en[p.occupation] || p.occupation}.${taches.length ? `\nOpen tasks: ${taches.map((t) => `${t.titre} (${t.statut === 'en_cours' ? 'in progress' : 'to do'})`).join('; ')}.` : ''}`), { intentions: ['nettoyage'] });
  }
  // Préparer la réinstallation / le retour (OG ne confirme jamais une arrivée physique)
  if (/(prepar|prepare|organis|reinstall|reintegr|reinstat)/.test(qn) && (has('retour') || /(reinstall|reintegr|reinstat)/.test(qn))) {
    if (retour?.statut === 'envoyee') {
      return local(T(L, `L’hôpital propose le retour de ${n} (${retour.numero}${retour.retour_prevu_le ? `, prévu le ${fmt(retour.retour_prevu_le)}` : ''}). Place habituelle : ${placeTxt}. Voici l’acceptation à confirmer ; une tâche de préparation sera créée.`,
        `The hospital proposes ${n}’s return (${retour.numero}${retour.retour_prevu_le ? `, planned ${fmt(retour.retour_prevu_le)}` : ''}). Usual place: ${placeTxt}. Here is the acceptance to confirm; a preparation task will be created.`),
      { intentions: ['retour'], proposition_chsld: { type: 'coordination', coordination_id: retour.id, version: retour.version, action: 'accepter', resident_ref: r.reference } });
    }
    if (retour) {
      return local(T(L, `Retour de ${n} : ${RETOUR_TXT.fr[retour.statut]}. Place habituelle : ${placeTxt}${ri ? ` — ${ri.pret ? 'retour prêt à confirmer' : `non prête (${ri.raisons.map((x) => RAISON.fr[x]).join(' ; ')})`}` : ''}. Je ne confirme pas l’arrivée physique à votre place.`,
        `${n}’s return: ${RETOUR_TXT.en[retour.statut]}. Usual place: ${placeTxt}${ri ? ` — ${ri.pret ? 'return ready to confirm' : `not ready (${ri.raisons.map((x) => RAISON.en[x]).join('; ')})`}` : ''}. I do not confirm the physical arrival for you.`), { intentions: ['retour'], ouvrir: 'c-mouvements' });
    }
    return local(T(L, `Le retour est préparé par l’hôpital qui a reçu ${n}. Aucune demande de retour n’est enregistrée pour l’instant ; ${r.statut === 'hospitalise' && ri?.conservee ? `sa place ${lit.code} reste conservée` : 'aucune place n’est conservée'}.`,
      `The return is prepared by the hospital that received ${n}. No return request is recorded yet; ${r.statut === 'hospitalise' && ri?.conservee ? `place ${lit.code} remains held` : 'no place is held'}.`), { intentions: ['retour'] });
  }
  // Place conservée ? Chambre toujours attribuée / disponible pour lui ? Prête ?
  if (has('conserv') || /(toujours attribu|still assigned|toujours disponible|still available|encore a lui|still his|still hers|retrouver sa chambre|get his room back|get her room back|keep (his|her) room)/.test(qn) || (has('pret') && has('chambre'))) {
    if (!ri || !ri.lit) return local(T(L, `${n} n’a aucune place attribuée : rien n’est conservé.`, `${n} has no assigned place: nothing is held.`), { intentions: ['conservation'] });
    const etat = ri.conservee ? T(L, 'Oui, sa place est conservée pendant l’hospitalisation et n’est jamais proposée à une nouvelle admission', 'Yes, the place is held during the hospital stay and is never offered for a new admission')
      : ri.attribuee ? T(L, 'Sa place lui est attribuée', 'The place is assigned to them') : T(L, 'Sa place n’est plus attribuée', 'The place is no longer assigned');
    const pretTxt = ri.pret ? T(L, 'Chambre prête pour le retour.', 'Room ready for the return.') : T(L, `Non prête : ${ri.raisons.map((x) => RAISON.fr[x]).join(' ; ')}.`, `Not ready: ${ri.raisons.map((x) => RAISON.en[x]).join('; ')}.`);
    return local(`${etat} : ${T(L, `chambre ${ri.lit.chambre}, lit ${ri.lit.code}`, `room ${ri.lit.chambre}, bed ${ri.lit.code}`)} (${ENT[l][ri.lit.entretien]}). ${pretTxt}`, { intentions: ['conservation'] });
  }
  // Quand revient-il ?
  if (has('retour') || /(revient|reviendra|come back|coming back)/.test(qn)) {
    if (retour) return local(T(L, `Retour de ${n} : ${RETOUR_TXT.fr[retour.statut]}${retour.retour_prevu_le ? `, prévu le ${fmt(retour.retour_prevu_le)}` : ''} (${retour.numero}).${ri ? ` Place habituelle ${ri.lit?.code || '—'} : ${ri.pret ? 'prête' : `non prête (${ri.raisons.map((x) => RAISON.fr[x]).join(' ; ')})`}.` : ''}`,
      `${n}’s return: ${RETOUR_TXT.en[retour.statut]}${retour.retour_prevu_le ? `, planned ${fmt(retour.retour_prevu_le)}` : ''} (${retour.numero}).${ri ? ` Usual place ${ri.lit?.code || '—'}: ${ri.pret ? 'ready' : `not ready (${ri.raisons.map((x) => RAISON.en[x]).join('; ')})`}.` : ''}`), { intentions: ['retour'] });
    if (r.statut !== 'hospitalise') return local(T(L, `${n} est ${STATUT.fr[r.statut] || r.statut} : aucun retour n’est attendu.`, `${n} is ${STATUT.en[r.statut] || r.statut}: no return is expected.`), { intentions: ['retour'] });
    return local(T(L, `Aucun retour n’est encore annoncé par ${hosp?.destination || 'l’hôpital'} pour ${n}.${ri?.conservee ? ` Sa place ${ri.lit.code} reste conservée.` : ''}`, `No return has been announced yet by ${hosp?.destination || 'the hospital'} for ${n}.${ri?.conservee ? ` Place ${ri.lit.code} remains held.` : ''}`), { intentions: ['retour'] });
  }
  // Chambre habituelle / où est-il hébergé
  if (has('chambre') && !has('ou')) {
    return local(lit ? T(L, `Chambre habituelle de ${n} : ${placeTxt} — ${r.statut === 'hospitalise' ? (ri?.conservee ? 'place conservée — hospitalisation' : 'place à vérifier') : STATUT.fr[r.statut]}.`,
      `${n}’s usual room: ${placeTxt} — ${r.statut === 'hospitalise' ? (ri?.conservee ? 'place held — hospital stay' : 'place to check') : STATUT.en[r.statut]}.`)
      : T(L, `${n} n’a aucune chambre attribuée (${STATUT.fr[r.statut] || r.statut}).`, `${n} has no assigned room (${STATUT.en[r.statut] || r.statut}).`), { intentions: ['chambre'] });
  }
  // Dernier mouvement confirmé
  if (has('mouvement') && !has('ou')) {
    return local(dernierMvt ? T(L, `Dernier mouvement confirmé de ${n} : ${MVT.fr[dernierMvt.type] || dernierMvt.type}, le ${fmt(dernierMvt.date)}${dernierMvt.autre_etablissement ? ` (${dernierMvt.autre_etablissement})` : ''}${dernierMvt.detail ? ` · ${dernierMvt.detail}` : ''}.`,
      `Latest confirmed movement for ${n}: ${MVT.en[dernierMvt.type] || dernierMvt.type}, on ${fmt(dernierMvt.date)}${dernierMvt.autre_etablissement ? ` (${dernierMvt.autre_etablissement})` : ''}${dernierMvt.detail ? ` · ${dernierMvt.detail}` : ''}.`)
      : T(L, `Aucun mouvement enregistré pour ${n}.`, `No movement recorded for ${n}.`), { intentions: ['mouvements'] });
  }
  // Localisation (par défaut) : uniquement d'après les événements confirmés
  return local(localisation(L, n, r, e, hosp, ri, placeTxt, dernierMvt, fmt) + (/(ouvre|ouvrir|open|fiche|record)/.test(qn) ? T(L, '\nOuvrez « Résidents » pour la fiche complète.', '\nOpen “Residents” for the full record.') : ''),
    { intentions: ['resident', 'localisation'], ouvrir: 'c-residents', resident_id: r.id });
}
const MVT = {
  fr: { preadmission: 'préadmission', admission: 'admission', changement_chambre: 'changement de chambre', depart_hopital: 'départ vers l’hôpital', hospitalisation_confirmee: 'hospitalisation confirmée', retour_prevu: 'retour prévu', retour: 'arrivée au CHSLD', reintegration: 'réintégration',
    transfert_prepare: 'transfert demandé', transfert_sortant: 'transfert sortant', transfert_entrant: 'transfert entrant', absence: 'absence', fin_absence: 'fin d’absence', sortie: 'fin d’hébergement', annulation: 'annulation' },
  en: { preadmission: 'pre-admission', admission: 'admission', changement_chambre: 'room change', depart_hopital: 'departure to hospital', hospitalisation_confirmee: 'hospital stay confirmed', retour_prevu: 'return planned', retour: 'arrival at the CHSLD', reintegration: 'reinstatement',
    transfert_prepare: 'transfer requested', transfert_sortant: 'outgoing transfer', transfert_entrant: 'incoming transfer', absence: 'absence', fin_absence: 'end of absence', sortie: 'discharge', annulation: 'cancellation' },
};
function localisation(L, n, r, e, hosp, ri, placeTxt, dernierMvt, fmt) {
  const maj = T(L, `Dernière mise à jour : ${fmt(dernierMvt?.date || r.modifie_le)}.`, `Last update: ${fmt(dernierMvt?.date || r.modifie_le)}.`);
  if (r.statut === 'retour_a_reintegrer') {
    return T(L, `${n} est arrivé au CHSLD (arrivée confirmée) ; sa réintégration dans ${placeTxt} reste à confirmer par le personnel. ${maj}`, `${n} has arrived at the CHSLD (arrival confirmed); reinstatement in ${placeTxt} remains to be confirmed by staff. ${maj}`);
  }
  if (r.statut === 'hospitalise' && hosp?.statut === 'recue' && !hosp.cloturee_le) {
    const ar = etape(hosp, 'arrivee') || etape(hosp, 'recue');
    return T(L, `Selon le dernier événement confirmé, ${n} a été reçu à ${hosp.destination} le ${fmt(hosp.arrivee_le || ar?.date)}. Son CHSLD de rattachement est ${e.nom}.${ri?.conservee ? ` Place conservée : ${ri.lit.code} (chambre ${ri.lit.chambre}).` : ''}`,
      `According to the latest confirmed event, ${n} was received at ${hosp.destination} on ${fmt(hosp.arrivee_le || ar?.date)}. Home CHSLD: ${e.nom}.${ri?.conservee ? ` Place held: ${ri.lit.code} (room ${ri.lit.chambre}).` : ''}`);
  }
  if (r.statut === 'hospitalise' && hosp?.statut === 'en_cours') {
    const d = etape(hosp, 'en_cours');
    return T(L, `Le départ de ${n} vers ${hosp.destination} a été confirmé le ${fmt(d?.date)}, mais son arrivée n’est pas encore confirmée par l’hôpital. CHSLD de rattachement : ${e.nom}.`,
      `${n}’s departure to ${hosp.destination} was confirmed on ${fmt(d?.date)}, but arrival is not yet confirmed by the hospital. Home CHSLD: ${e.nom}.`);
  }
  if (r.statut === 'hospitalise') return T(L, `${n} est enregistré comme hospitalisé, sans hospitalisation confirmée lisible ici : je ne peux pas indiquer d’hôpital. ${maj}`, `${n} is recorded as in hospital, without a readable confirmed stay: I cannot name a hospital. ${maj}`);
  const ouverte = hosp && ['envoyee', 'acceptee'].includes(hosp.statut) ? hosp : null;
  const base = T(L, `${n} est ${STATUT.fr[r.statut] || r.statut}${r.lit_id ? ` (${placeTxt})` : ''}.`, `${n} is ${STATUT.en[r.statut] || r.statut}${r.lit_id ? ` (${placeTxt})` : ''}.`);
  const dem = ouverte ? T(L, ` Une demande de transfert vers ${ouverte.destination} a été envoyée le ${fmt(ouverte.cree_le)} (${ouverte.numero}), mais son départ n’est pas confirmé.`, ` A transfer request to ${ouverte.destination} was sent on ${fmt(ouverte.cree_le)} (${ouverte.numero}), but departure is not confirmed.`) : '';
  return `${base}${dem} ${maj}`;
}

/* ------------------------------------------------------------------ questions générales sur l'établissement */
async function repondreGeneral(pool, u, etabId, e, qn, mots, L, fmt, local) {
  const has = (g) => a(qn, mots, g); const l = lng(L);
  const places = async () => ch.places(pool, u, etabId);
  // Chambre numérotée : « pourquoi la chambre 117 est-elle indisponible ? », « chambre 204 »
  const num = (qn.match(/\b(?:chambre|room|ch)\s*(\d{1,4})\b/) || [])[1];
  if (num && !has('tache')) {
    const p = (await places()).filter((x) => String(x.chambre) === num);
    if (!p.length) return local(T(L, `Aucune chambre ${num} dans cet établissement.`, `No room ${num} in this facility.`), { intentions: ['chambre'] });
    return local(T(L, `Chambre ${num} (${p[0].unite}) :\n${p.map((x) => `• ${x.code} : ${OCC.fr[x.occupation] || x.occupation}${x.resident_nom ? ` · ${x.resident_nom} (${x.resident_ref})` : x.resident_ref ? ` · ${x.resident_ref}` : ''}${x.occupation === 'bloquee' ? ` · motif : ${x.motif_blocage || 'non précisé'}` : ''} · entretien : ${ENT.fr[x.entretien]}${x.entretien_par && x.entretien === 'propre' && x.entretien_le ? ` (par ${x.entretien_par}, ${fmt(x.entretien_le)})` : ''}`).join('\n')}`,
      `Room ${num} (${p[0].unite}):\n${p.map((x) => `• ${x.code}: ${OCC.en[x.occupation] || x.occupation}${x.resident_nom ? ` · ${x.resident_nom} (${x.resident_ref})` : x.resident_ref ? ` · ${x.resident_ref}` : ''}${x.occupation === 'bloquee' ? ` · reason: ${x.motif_blocage || 'not specified'}` : ''} · housekeeping: ${ENT.en[x.entretien]}${x.entretien_par && x.entretien === 'propre' && x.entretien_le ? ` (by ${x.entretien_par}, ${fmt(x.entretien_le)})` : ''}`).join('\n')}`), { intentions: ['chambre'] });
  }
  // Tâches (entretien, en retard)
  if (has('tache')) {
    let t = await ch.listeTaches(pool, u, etabId);
    if (has('nettoy')) t = t.filter((x) => ['entretien', 'preparation_chambre'].includes(x.type));
    if (has('retard')) t = t.filter((x) => x.echeance && new Date(x.echeance) < new Date());
    return local(t.length ? T(L, `${t.length} tâche(s) ouverte(s)${has('retard') ? ' en retard' : ''} :\n${t.slice(0, 15).map((x) => `• ${x.titre}${x.lit ? ` (${x.lit})` : ''} · ${x.statut === 'en_cours' ? 'en cours' : 'à faire'}${x.echeance ? ` · échéance ${fmt(x.echeance)}` : ''}`).join('\n')}`,
      `${t.length} open task(s)${has('retard') ? ' overdue' : ''}:\n${t.slice(0, 15).map((x) => `• ${x.titre}${x.lit ? ` (${x.lit})` : ''} · ${x.statut === 'en_cours' ? 'in progress' : 'to do'}${x.echeance ? ` · due ${fmt(x.echeance)}` : ''}`).join('\n')}`)
      : T(L, `Aucune tâche ouverte${has('retard') ? ' en retard' : ''}.`, `No open task${has('retard') ? ' overdue' : ''}.`), { intentions: ['taches'], ouvrir: 'c-taches' });
  }
  // Taux d'occupation / capacité
  if (/(\btaux\b|occupation rate|occupancy|capacit|capacity)/.test(qn)) {
    const i = await ch.indicateurs(pool, u, etabId, 30);
    return local(T(L, `Taux d’occupation : ${i.occupation ?? '—'} % (places occupées, conservées et réservées sur ${i.places.dotees} places en service). ${i.places.libres} place(s) libre(s).`, `Occupancy rate: ${i.occupation ?? '—'}% (occupied, held and reserved places out of ${i.places.dotees} in service). ${i.places.libres} available place(s).`), { intentions: ['indicateurs'] });
  }
  // Places conservées (à nettoyer)
  if (has('conserv')) {
    let p = (await places()).filter((x) => x.occupation === 'conservee_hospitalisation');
    const aNettoyer = has('nettoy');
    if (aNettoyer) p = p.filter((x) => ['a_nettoyer', 'en_cours'].includes(x.entretien));
    return local(p.length ? T(L, `${p.length} place(s) conservée(s)${aNettoyer ? ' à nettoyer' : ' pour des résidents hospitalisés'} :\n${p.map((x) => `• ${x.code} (chambre ${x.chambre}) · ${x.resident_nom || x.resident_ref} · entretien : ${ENT.fr[x.entretien]}`).join('\n')}\nUne place conservée n’est jamais proposée à une nouvelle admission.`,
      `${p.length} held place(s)${aNettoyer ? ' to clean' : ' for residents in hospital'}:\n${p.map((x) => `• ${x.code} (room ${x.chambre}) · ${x.resident_nom || x.resident_ref} · housekeeping: ${ENT.en[x.entretien]}`).join('\n')}\nA held place is never offered for a new admission.`)
      : T(L, aNettoyer ? 'Aucune place conservée n’est à nettoyer.' : 'Aucune place n’est conservée actuellement.', aNettoyer ? 'No held place needs cleaning.' : 'No place is currently held.'), { intentions: ['conservation'], ouvrir: 'c-chambres' });
  }
  // Places disponibles
  if (has('dispo') && (has('chambre') || /(combien|how many)/.test(qn))) {
    const p = await places(); const libres = p.filter((x) => x.occupation === 'disponible');
    const parUnite = [...new Set(libres.map((x) => x.unite))].map((un) => `• ${un} : ${libres.filter((x) => x.unite === un).map((x) => x.code).join(', ')}`);
    return local(T(L, `${libres.length} place(s) libre(s) sur ${p.filter((x) => x.occupation !== 'bloquee').length} en service.${parUnite.length ? `\n${parUnite.join('\n')}` : ''}\nUne place libre n’est pas une admission : l’attribution suit les étapes habituelles. Les places conservées pour des résidents hospitalisés ne sont jamais comptées.`,
      `${libres.length} available place(s) out of ${p.filter((x) => x.occupation !== 'bloquee').length} in service.${parUnite.length ? `\n${parUnite.join('\n')}` : ''}\nAn available place is not an admission: assignment follows the usual steps. Places held for residents in hospital are never counted.`), { intentions: ['places'], ouvrir: 'c-chambres' });
  }
  // Places bloquées
  if (has('bloque') && (has('chambre') || LISTE.test(qn))) {
    const p = (await places()).filter((x) => x.occupation === 'bloquee');
    return local(p.length ? T(L, `${p.length} place(s) bloquée(s) :\n${p.map((x) => `• ${x.code} (chambre ${x.chambre}, ${x.unite}) · motif : ${x.motif_blocage || 'non précisé'}`).join('\n')}`, `${p.length} blocked place(s):\n${p.map((x) => `• ${x.code} (room ${x.chambre}, ${x.unite}) · reason: ${x.motif_blocage || 'not specified'}`).join('\n')}`)
      : T(L, 'Aucune place bloquée.', 'No blocked place.'), { intentions: ['places'], ouvrir: 'c-chambres' });
  }
  // Nettoyage et entretien
  if (has('nettoy') && !/(prepare une tache|prepare a task|tache d entretien|lance)/.test(qn)) {
    const p = await places();
    const etat = p.filter((x) => x.occupation === 'preparation');
    const ent = p.filter((x) => ['a_nettoyer', 'en_cours'].includes(x.entretien) && x.occupation !== 'preparation');
    const lignes = [...etat.map((x) => T(L, `• ${x.code} (${x.unite}, chambre ${x.chambre}) · en préparation`, `• ${x.code} (${x.unite}, room ${x.chambre}) · being prepared`)),
      ...ent.map((x) => T(L, `• ${x.code} (chambre ${x.chambre}) · ${ENT.fr[x.entretien]} · ${OCC.fr[x.occupation] || x.occupation}`, `• ${x.code} (room ${x.chambre}) · ${ENT.en[x.entretien]} · ${OCC.en[x.occupation] || x.occupation}`))];
    return local(lignes.length ? T(L, `${lignes.length} chambre(s) à nettoyer ou en préparation :\n${lignes.join('\n')}`, `${lignes.length} room(s) to clean or being prepared:\n${lignes.join('\n')}`)
      : T(L, 'Aucune chambre en nettoyage actuellement.', 'No room is being cleaned right now.'), { intentions: ['nettoyage'], ouvrir: 'nettoyage' });
  }
  // Places occupées
  if (has('occupe') && (has('chambre') || LISTE.test(qn))) {
    const p = await places(); const occ = p.filter((x) => x.occupation === 'occupee'); const cons = p.filter((x) => x.occupation === 'conservee_hospitalisation');
    return local(T(L, `${occ.length} place(s) occupée(s) par des résidents présents, et ${cons.length} conservée(s) pour des résidents hospitalisés, sur ${p.length} places.`, `${occ.length} place(s) occupied by present residents, and ${cons.length} held for residents in hospital, out of ${p.length} places.`), { intentions: ['places'] });
  }
  // Retours attendus, retours en attente de confirmation
  if (has('retour') || /(doivent revenir|revenir de l|come back from)/.test(qn)) {
    const co = (await ch.listeCoordinations(pool, u, etabId, {})).filter((c) => c.type === 'retour' && c.entrante && (['envoyee', 'acceptee', 'en_cours'].includes(c.statut) || c.a_reintegrer));
    const auj = /(aujourd|today)/.test(qn);
    let l2 = auj ? co.filter((c) => c.retour_prevu_le && new Date(c.retour_prevu_le).toDateString() === new Date().toDateString()) : co;
    if (has('confirm') || /(attend|waiting|awaiting|pending)/.test(qn)) l2 = l2.filter((c) => ['envoyee', 'en_cours'].includes(c.statut) || c.a_reintegrer);
    const ligne = (c) => `• ${c.resident_ref} depuis ${c.origine}${c.retour_prevu_le ? ` · ${fmt(c.retour_prevu_le)}` : ''} · ${RETOUR_TXT.fr[c.statut]}${c.reintegration ? ` · place ${c.reintegration.lit?.code || '—'} : ${c.reintegration.pret ? 'prête' : 'non prête'}` : ''}`;
    const ligneEn = (c) => `• ${c.resident_ref} from ${c.origine}${c.retour_prevu_le ? ` · ${fmt(c.retour_prevu_le)}` : ''} · ${RETOUR_TXT.en[c.statut]}${c.reintegration ? ` · place ${c.reintegration.lit?.code || '—'}: ${c.reintegration.pret ? 'ready' : 'not ready'}` : ''}`;
    return local(l2.length ? T(L, `${l2.length} retour(s) ${auj ? 'prévu(s) aujourd’hui' : 'annoncé(s)'} :\n${l2.map(ligne).join('\n')}`, `${l2.length} return(s) ${auj ? 'planned today' : 'announced'}:\n${l2.map(ligneEn).join('\n')}`)
      : T(L, `Aucun retour d’hospitalisation ${auj ? 'n’est prévu aujourd’hui' : 'n’est annoncé'}.`, `No return from hospital is ${auj ? 'planned today' : 'announced'}.`), { intentions: ['retours'], ouvrir: 'c-mouvements' });
  }
  // Résidents hospitalisés
  if (has('hospit') && !has('demande')) {
    const liste = await ch.listeResidents(pool, u, etabId, { statut: 'hospitalise' });
    const co = await ch.listeCoordinations(pool, u, etabId, { toutes: true });
    const ligne = (r, en) => { const c = co.find((x) => x.type === 'hospitalisation' && x.resident_ref === r.reference && ['en_cours', 'recue'].includes(x.statut) && !x.cloturee_le); const d = derniereEtape(c);
      return `• ${nomResident(r)}${c ? ` · ${c.destination} · ${en ? ETAPE_HOSP.en[etapeHosp(c)] : ETAPE_HOSP.fr[etapeHosp(c)]} (${fmt(d?.date)})` : ''}${r.lit ? ` · ${en ? 'place held' : 'place conservée'} ${r.lit}` : ''}`; };
    return local(liste.length ? T(L, `${liste.length} résident(s) hospitalisé(s), place conservée :\n${liste.map((r) => ligne(r, false)).join('\n')}`, `${liste.length} resident(s) in hospital, place held:\n${liste.map((r) => ligne(r, true)).join('\n')}`)
      : T(L, 'Aucun résident n’est hospitalisé actuellement.', 'No resident is currently in hospital.'), { intentions: ['hospitalisations'], ouvrir: 'c-mouvements' });
  }
  // Demandes d'hébergement
  if (/(demande|request)s?( d)? ?(hebergement|placement)|(hebergement|placement) request|attend\w* (une )?confirmation|awaiting confirmation/.test(qn)) {
    const d = await ch.listeDemandes(pool, u, etabId);
    const attente = d.filter((x) => ['place_proposee', 'en_verification', 'documents_manquants', 'recue'].includes(x.statut));
    return local(attente.length ? T(L, `${attente.length} demande(s) d’hébergement ouverte(s) :\n${attente.map((x) => `• ${x.numero} · ${x.statut.replace('_', ' ')}${x.statut === 'documents_manquants' ? ` (manque : ${x.documents.filter((y) => !y.recu).map((y) => y.code).join(', ')})` : ''}`).join('\n')}`,
      `${attente.length} open placement request(s):\n${attente.map((x) => `• ${x.numero} · ${x.statut.replace('_', ' ')}${x.statut === 'documents_manquants' ? ` (missing: ${x.documents.filter((y) => !y.recu).map((y) => y.code).join(', ')})` : ''}`).join('\n')}`)
      : T(L, 'Aucune demande d’hébergement ouverte.', 'No open placement request.'), { intentions: ['demandes'], ouvrir: 'c-demandes' });
  }
  // Échanges entre CHSLD
  if (/(echange|demande|transfert|exchange|request|transfer).*(chsld|entre les|between)|(chsld).*(echange|attente|pending|en cours)/.test(qn)) {
    const co = (await ch.listeCoordinations(pool, u, etabId, {})).filter((c) => c.type === 'transfert_chsld' && ['envoyee', 'acceptee', 'en_cours'].includes(c.statut));
    return local(co.length ? T(L, `${co.length} échange(s) en cours avec le réseau CHSLD :\n${co.map((c) => `• ${c.numero} · ${c.resident_ref} · ${c.origine} → ${c.destination} · ${c.statut}`).join('\n')}`,
      `${co.length} exchange(s) in progress with the CHSLD network:\n${co.map((c) => `• ${c.numero} · ${c.resident_ref} · ${c.origine} → ${c.destination} · ${c.statut}`).join('\n')}`)
      : T(L, 'Aucun échange en cours entre CHSLD.', 'No exchange in progress between CHSLDs.'), { intentions: ['reseau_chsld'], ouvrir: 'c-reseau' });
  }
  // Demandes vers l'hôpital en attente de réponse
  if (has('demande') && (has('hospit') || /(attend|reponse|response|pending)/.test(qn))) {
    const co = (await ch.listeCoordinations(pool, u, etabId, {})).filter((c) => c.type === 'hospitalisation' && !c.entrante && ['envoyee', 'acceptee'].includes(c.statut));
    return local(co.length ? T(L, `${co.length} demande(s) vers un hôpital en attente :\n${co.map((c) => `• ${c.numero} · ${c.resident_ref} → ${c.destination} · ${ETAPE_HOSP.fr[etapeHosp(c)]} (${fmt(derniereEtape(c)?.date)})`).join('\n')}`,
      `${co.length} hospital request(s) pending:\n${co.map((c) => `• ${c.numero} · ${c.resident_ref} → ${c.destination} · ${ETAPE_HOSP.en[etapeHosp(c)]} (${fmt(derniereEtape(c)?.date)})`).join('\n')}`)
      : T(L, 'Aucune demande vers un hôpital n’attend de réponse.', 'No hospital request is awaiting a response.'), { intentions: ['liaison'] });
  }
  // Accueils et admissions prévus
  if (has('admission') && !has('demande')) {
    const pre = await ch.listeResidents(pool, u, etabId, { statut: 'preadmission' });
    return local(pre.length ? T(L, `${pre.length} accueil(s) prévu(s) :\n${pre.map((r) => `• ${nomResident(r)}${r.arrivee_prevue ? ` · ${fmt(r.arrivee_prevue)}` : ''}${r.lit ? ` · place ${r.lit}` : ''}`).join('\n')}`, `${pre.length} planned admission(s):\n${pre.map((r) => `• ${nomResident(r)}${r.arrivee_prevue ? ` · ${fmt(r.arrivee_prevue)}` : ''}${r.lit ? ` · place ${r.lit}` : ''}`).join('\n')}`)
      : T(L, 'Aucun accueil prévu.', 'No planned admission.'), { intentions: ['admissions'], ouvrir: 'c-admissions' });
  }
  // Messages et communications en attente
  if (/(message|rappel|callback|communication)/.test(qn) && /(attente|pending|waiting|non lu|unread|a faire|y a t il|any)/.test(qn)) {
    const com = (await pool.query(`SELECT count(*)::int n FROM communications_proches cp JOIN residents r ON r.id = cp.resident_id WHERE r.etablissement_id = $1 AND cp.statut = 'a_faire'`, [etabId])).rows[0].n;
    const msg = (await pool.query(`SELECT count(*)::int n FROM messages_proches m JOIN residents r ON r.id = m.resident_id WHERE r.etablissement_id = $1 AND m.sens = 'proche' AND m.lu_le IS NULL`, [etabId])).rows[0].n;
    return local(T(L, `${com} communication(s) à faire et ${msg} message(s) de proches non lu(s).`, `${com} communication(s) to do and ${msg} unread message(s) from family.`), { intentions: ['communications'] });
  }
  if (has('notif')) {
    const n = (await pool.query('SELECT count(*)::int n FROM notifications WHERE etablissement_id = $1 AND NOT lu', [etabId])).rows[0].n;
    return local(T(L, `${n} notification(s) non lue(s).`, `${n} unread notification(s).`), { intentions: ['notifications'] });
  }
  if (has('module') && /(module|fonctionnalit|feature)/.test(qn)) {
    const m = TE.catalogue('chsld').filter((x) => TE.moduleActif(e, x.code)).map((x) => (L === 'en' ? x.nom_en : x.nom));
    return local(T(L, `Modules actifs dans ${e.nom} : ${m.join(', ')}.`, `Active modules in ${e.nom}: ${m.join(', ')}.`), { intentions: ['modules'] });
  }
  return null;
}

/* ------------------------------------------------------------------ point d'entrée */
async function repondre(pool, u, etabId, q, L) {
  const qn = norm(q).replace(/-/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(ok |dis |hey |bonjour |salut |hello |hi |euh |ody |og |o g )+/, '').replace(/^og[, ]+/, '');
  const mots = qn.split(/[^a-z0-9-]+/).filter(Boolean);
  const e = await ch.etabChsld(pool, u, etabId, { roles: ['coordonnateur', 'admin_etab', 'gestionnaire', 'equipe_soins', 'entretien'] });
  const fuseau = (await pool.query('SELECT c.fuseau FROM config_pays c WHERE c.id = $1', [e.config_id])).rows[0]?.fuseau || 'America/Toronto';
  const fmt = formateur(L, fuseau);
  const local = (reponse, extra = {}) => ({ mode: 'local', reponse, sources: ['arrimo'], ...extra });
  const ctx = lireContexte(u, etabId);

  // Ce qu'OG peut faire : seulement sur demande explicite
  if (/(que peux tu faire|qu est ce que tu (peux|sais) faire|what can you do|how can you help|tes fonctions|aide moi a utiliser|help me use)/.test(qn)) {
    return local(T(L, 'Je peux consulter et expliquer : un résident (nom, référence R-00001, lit ERA-117A, demande DH-…, coordination CO-…), sa chambre, sa place conservée, ses mouvements, ses hospitalisations et retours ; les places libres, bloquées, conservées, en nettoyage ; les demandes d’hébergement, les accueils prévus, les tâches, les contacts et autorisations. Je prépare une tâche, une demande de rappel à un proche autorisé ou l’acceptation d’un retour : rien n’est enregistré sans votre confirmation.',
      'I can look up and explain: a resident (name, reference R-00001, bed ERA-117A, request DH-…, coordination CO-…), their room, held place, movements, hospital stays and returns; available, blocked, held and cleaning places; placement requests, planned admissions, tasks, contacts and permissions. I prepare a task, a callback request to an authorized family member or the acceptance of a return: nothing is recorded without your confirmation.'), { intentions: ['aide'] });
  }
  // Coordination Famille : messages, demandes, confirmations, visites des proches (chiffres et listes réels, mêmes droits que l'écran)
  // Seulement les questions de coordination avec les familles en général (pas « les proches de ce résident », qui restent à la fiche)
  if (/(message|demande|request|confirmation|visite|visit|besoin|need)s? (des |de |from |of )?(la |the )?(familles?|families|proches)\b|(familles?|families|proches) (en attente|waiting|non lus|unread)|coordination (famille|des familles)|family coordination/.test(qn)) {
    if (u.role === 'entretien') return local(T(L, 'La coordination avec les familles ne fait pas partie de votre rôle.', 'Family coordination is not part of your role.'), { intentions: ['famille'] });
    const q1 = (sql) => pool.query(sql, [etabId]).then((r) => r.rows);
    const [msgs, dem, conf, vis] = await Promise.all([
      q1(`SELECT k.prenom, k.nom, r.reference, m.texte FROM messages_proches m JOIN residents r ON r.id = m.resident_id JOIN resident_contacts k ON k.id = m.contact_id WHERE r.etablissement_id = $1 AND m.sens = 'proche' AND m.lu_le IS NULL ORDER BY m.cree_le LIMIT 10`),
      q1(`SELECT d.id, d.categorie, d.statut, r.reference, (d.echeance < now()) AS retard FROM demandes_famille d JOIN residents r ON r.id = d.resident_id WHERE d.etablissement_id = $1 AND d.statut NOT IN ('resolue', 'refusee', 'annulee', 'cloturee') ORDER BY d.echeance LIMIT 10`),
      q1(`SELECT c.sujet, c.statut, r.reference FROM confirmations_famille c JOIN residents r ON r.id = c.resident_id WHERE c.etablissement_id = $1 AND (c.statut = 'en_attente' OR c.repondu_le > now() - interval '2 days') ORDER BY c.cree_le DESC LIMIT 10`),
      q1(`SELECT v.souhaitee_le, v.statut, r.reference FROM demandes_visite v JOIN residents r ON r.id = v.resident_id WHERE v.etablissement_id = $1 AND (v.statut = 'demandee' OR (v.statut = 'acceptee' AND v.souhaitee_le::date = now()::date)) ORDER BY v.souhaitee_le LIMIT 10`)]);
    const ligne = (x) => `• ${x}`;
    const fr = [`Messages de familles non lus : ${msgs.length}${msgs.length ? `\n${msgs.map((m) => ligne(`${m.prenom} ${m.nom} (${m.reference}) : « ${String(m.texte).slice(0, 80)} »`)).join('\n')}` : ''}`,
      `Demandes ouvertes : ${dem.length}${dem.filter((d) => d.retard).length ? `, dont ${dem.filter((d) => d.retard).length} en retard` : ''}${dem.length ? `\n${dem.map((d) => ligne(`n° ${d.id} · ${d.categorie} · ${d.statut} (${d.reference})${d.retard ? ' · en retard' : ''}`)).join('\n')}` : ''}`,
      `Confirmations : ${conf.filter((c) => c.statut === 'en_attente').length} en attente${conf.filter((c) => c.statut !== 'en_attente').length ? `, ${conf.filter((c) => c.statut !== 'en_attente').length} réponse(s) récente(s)` : ''}`,
      `Visites à traiter ou du jour : ${vis.length}`].join('\n\n');
    const en = [`Unread family messages: ${msgs.length}${msgs.length ? `\n${msgs.map((m) => ligne(`${m.prenom} ${m.nom} (${m.reference}): “${String(m.texte).slice(0, 80)}”`)).join('\n')}` : ''}`,
      `Open requests: ${dem.length}${dem.filter((d) => d.retard).length ? `, ${dem.filter((d) => d.retard).length} overdue` : ''}${dem.length ? `\n${dem.map((d) => ligne(`#${d.id} · ${d.categorie} · ${d.statut} (${d.reference})${d.retard ? ' · overdue' : ''}`)).join('\n')}` : ''}`,
      `Confirmations: ${conf.filter((c) => c.statut === 'en_attente').length} pending${conf.filter((c) => c.statut !== 'en_attente').length ? `, ${conf.filter((c) => c.statut !== 'en_attente').length} recent answer(s)` : ''}`,
      `Visits to handle or today: ${vis.length}`].join('\n\n');
    return local(T(L, fr, en), { intentions: ['famille'], ouvrir: 'c-accueil' });
  }
  // Décisions qui ne relèvent pas d'OG
  if (/(admissib|eligib|priorit\w* clinique|clinical priority|decide|decider|choisis qui|who should get|attribue definitivement|assign permanently|transfert medical|medical transfer|medicament|medication|dosage|diagnostic|diagnos)/.test(qn)) {
    return local(T(L, 'Je ne décide pas de l’admissibilité, d’une priorité clinique, d’un transfert médical, d’une médication ni de l’attribution définitive d’une place : ces décisions reviennent aux personnes et aux mécanismes habilités. Je peux afficher les informations enregistrées et préparer une étape à confirmer.',
      'I do not decide eligibility, clinical priority, medical transfers, medication or the final assignment of a place: those decisions belong to authorized people and mechanisms. I can show recorded information and prepare a step for confirmation.'), { intentions: ['decision_humaine'] });
  }
  // Confirmer une arrivée à la place du personnel : refus explicite
  if (/(confirme|confirm|valide)\w* (son |sa |la |le |l |the |his |her )?(arrivee|retour|reception|arrival|return)/.test(qn) && !/\b(qui|who|quand|when|est ce|has|is|a t il|a t elle)\b/.test(qn)) {
    return local(T(L, 'Je ne confirme pas une arrivée physique à votre place : la réception est confirmée par une personne habilitée, dans « Transferts et hospitalisations ». Je peux vérifier que la place est prête.', 'I do not confirm a physical arrival for you: reception is confirmed by an authorized person in “Transfers and hospital stays”. I can check that the place is ready.'), { intentions: ['decision_humaine'], ouvrir: 'c-mouvements' });
  }
  if (/^(reintegre|reintegrer|reinstate)\b/.test(qn)) {
    return local(T(L, 'Je ne réintègre pas un résident à votre place : l’action « Réintégrer dans sa chambre » revient au personnel autorisé, dans « Transferts et hospitalisations ». Je peux vérifier que la place est prête.', 'I do not reinstate a resident for you: “Reinstate in their room” belongs to authorized staff in “Transfers and hospital stays”. I can check that the place is ready.'), { intentions: ['decision_humaine'], ouvrir: 'c-mouvements' });
  }
  // Enregistrer un nouveau résident : formulaire guidé
  if (/(enregistr|nouveau resident|nouvelle residente|new resident|register a resident|register a new|admettre un nouveau|accueil d.un nouveau)/.test(qn) && !/demande/.test(qn)) {
    return local(T(L, 'J’ouvre le formulaire d’enregistrement. Vérifiez chaque champ ; je vérifie les doublons et vos droits avant l’enregistrement.', 'I am opening the registration form. Check each field; I check duplicates and your permissions before saving.'), { intentions: ['formulaire'], formulaire: 'nouveau_resident', ouvrir: 'c-residents' });
  }
  // Tâche d'entretien pour une chambre numérotée (« Prépare une tâche d'entretien pour la chambre 101 »)
  const tacheChambre = qn.match(/(?:tache|task|nettoyage|cleaning)[^0-9]*(?:chambre|room)\s*([a-z0-9-]+)/);
  if (tacheChambre && /(prepar|lance|cree|creer|planifie|create|start|schedule|demande)/.test(qn)) {
    const p = (await ch.places(pool, u, etabId)).filter((x) => norm(x.chambre) === tacheChambre[1] || normRef(x.code) === normRef(tacheChambre[1]));
    if (!p.length) return local(T(L, `Je ne trouve pas la chambre ${tacheChambre[1]} dans cet établissement.`, `I cannot find room ${tacheChambre[1]} in this facility.`), { intentions: ['tache'] });
    ecrireContexte(u, etabId, { litId: p[0].id });
    return local(T(L, `Voici une tâche d’entretien à confirmer pour la chambre ${p[0].chambre}. Rien n’est créé avant votre confirmation.`, `Here is a housekeeping task to confirm for room ${p[0].chambre}. Nothing is created before you confirm.`),
      { intentions: ['tache'], proposition_chsld: { type: 'tache', corps: { type: 'entretien', titre: T(L, `Entretien de la chambre ${p[0].chambre}`, `Housekeeping, room ${p[0].chambre}`), lit_id: p[0].id, assigne_role: 'entretien' } } });
  }

  // 1. Références explicites (une référence seule déclenche une recherche contextuelle)
  const refs = referencesDe(q);
  let sujet = null;
  for (const ref of refs) {
    const trouve = await resoudreReference(pool, etabId, ref);
    if (trouve) { sujet = trouve; break; }
  }
  if (!sujet && refs.length && !/(chambre|room)\s*\d/.test(qn)) {
    return local(T(L, `Aucun résultat autorisé pour « ${refs.map((x) => x.brut).join(', ')} » dans ${e.nom}. Vérifiez la référence (résident R-00001, lit ${e.code.replace('CHSLD-', '')}-117A, demande DH-…, coordination CO-…) ; je n’affiche que les données de votre établissement.`,
      `No authorized result for “${refs.map((x) => x.brut).join(', ')}” in ${e.nom}. Check the reference (resident R-00001, bed ${e.code.replace('CHSLD-', '')}-117A, request DH-…, coordination CO-…); I only show your facility’s data.`), { intentions: ['recherche'] });
  }
  // 2. Noms (fautes tolérées) ; un prénom seul désigne le résident de la conversation s'il en fait partie
  let sansDroitResidents = false;
  if (!sujet) {
    const tous = await ch.listeResidents(pool, u, etabId, { statut: 'tous' }).catch((err) => { if (err.statut === 403) sansDroitResidents = true; return []; });
    let nommes = residentsNommes(tous.filter((r) => !['sorti', 'transfere'].includes(r.statut) || /(sorti|transfere|discharged|ancien)/.test(qn)), qn);
    if (nommes.niveau === 1 && ctx.residentId && nommes.some((r) => r.id === ctx.residentId)) nommes = tous.filter((r) => r.id === ctx.residentId);
    if (nommes.length > 1) {
      return local(T(L, `Plusieurs résidents correspondent : ${nommes.slice(0, 8).map((r) => `${nomResident(r)} · ${r.lit ? `chambre ${r.chambre}` : STATUT.fr[r.statut]}`).join(' ; ')}. Précisez la référence.`,
        `Several residents match: ${nommes.slice(0, 8).map((r) => `${nomResident(r)} · ${r.lit ? `room ${r.chambre}` : STATUT.en[r.statut]}`).join('; ')}. Specify the reference.`), { intentions: ['resident'], choix: nommes.slice(0, 8).map((r) => ({ id: r.id, reference: r.reference })) });
    }
    if (nommes.length === 1) sujet = { type: 'resident', id: nommes[0].id };
  }
  // 3. Contexte : « il », « sa chambre », « il revient quand ? », seulement sans demande de liste générale
  if (!sujet && sansDroitResidents && /(ou est|where is|retrouve|recherche|find|search|fiche|il est ou)/.test(qn)) {
    return local(T(L, 'Votre rôle ne permet pas de consulter les dossiers des résidents. Je peux vous indiquer les chambres à nettoyer et vos tâches.', 'Your role does not allow access to resident records. I can show rooms to clean and your tasks.'), { intentions: ['permissions'] });
  }
  const qPronoms = qn.replace(/\b(fait|faut|y a t|s agit|semble|pleut) il\b/g, '');
  const pronom = SUITE.test(qPronoms);
  const general = LISTE.test(qn) && !pronom;
  const suiteImplicite = ctx.residentId && ((/\b(le retour|la reintegration|sa reintegration|the return|reinstatement|le transfert|the transfer)\b/.test(qn) && !LISTE.test(qn))
    || a(qn, mots, 'contact') || a(qn, mots, 'autoris') || (a(qn, mots, 'rappel') && !/(attente|pending|waiting|non lu|unread)/.test(qn))
    || (a(qn, mots, 'nettoy') && /(qui a termine|who finished|who cleaned|ete nettoy|been cleaned|est propre|is clean)/.test(qn)));
  const chambreNum = /\b(chambre|room)\s*\d/.test(qn);
  const personneImplicite = ctx.residentId && (a(qn, mots, 'contact') || a(qn, mots, 'autoris') || (a(qn, mots, 'rappel') && !/(attente|pending|waiting|non lu|unread)/.test(qn)));
  if (!sujet && !chambreNum && ((!general && (pronom || suiteImplicite)) || personneImplicite) && (ctx.residentId || ctx.litId)) {
    sujet = ctx.residentId ? { type: 'resident', id: ctx.residentId } : { type: 'lit', id: ctx.litId };
  }

  if (sujet?.type === 'resident') {
    let x;
    try { x = await contexteResident(pool, u, etabId, sujet.id); } catch (err) {
      if (err.statut === 403 || err.status === 403) return local(T(L, 'Votre rôle ne permet pas de consulter les dossiers des résidents. Je peux vous indiquer les chambres à nettoyer et vos tâches.', 'Your role does not allow access to resident records. I can show rooms to clean and your tasks.'), { intentions: ['permissions'] });
      throw err;
    }
    ecrireContexte(u, etabId, { residentId: sujet.id, litId: x.r.lit_id, ref: x.r.reference });
    return repondreResident(pool, u, etabId, e, x, qn, mots, L, fmt, local);
  }
  if (sujet?.type === 'lit') {
    const p = (await ch.places(pool, u, etabId)).find((x) => x.id === sujet.id);
    ecrireContexte(u, etabId, { litId: p.id, residentId: null });
    if (a(qn, mots, 'tache') || /(lance|cree|creer|prepare)/.test(qn)) {
      return local(T(L, `Voici une tâche de nettoyage à confirmer pour ${p.code} (chambre ${p.chambre}). Rien n’est créé avant votre confirmation.`, `Here is a cleaning task to confirm for ${p.code} (room ${p.chambre}). Nothing is created before you confirm.`),
        { intentions: ['tache'], proposition_chsld: { type: 'tache', corps: { type: 'entretien', titre: T(L, `Nettoyage de ${p.code}`, `Cleaning ${p.code}`), lit_id: p.id, assigne_role: 'entretien' } } });
    }
    return local(T(L, `${p.code} (chambre ${p.chambre}, ${p.unite}) : ${OCC.fr[p.occupation] || p.occupation}${p.occupation === 'bloquee' ? `, motif : ${p.motif_blocage || 'non précisé'}` : ''} ; entretien : ${ENT.fr[p.entretien]}${p.entretien === 'propre' && p.entretien_le ? ` (confirmé le ${fmt(p.entretien_le)}${p.entretien_par ? ` par ${p.entretien_par}` : ''})` : ''}. Aucun résident n’y est attribué.`,
      `${p.code} (room ${p.chambre}, ${p.unite}): ${OCC.en[p.occupation] || p.occupation}${p.occupation === 'bloquee' ? `, reason: ${p.motif_blocage || 'not specified'}` : ''}; housekeeping: ${ENT.en[p.entretien]}${p.entretien === 'propre' && p.entretien_le ? ` (confirmed on ${fmt(p.entretien_le)}${p.entretien_par ? ` by ${p.entretien_par}` : ''})` : ''}. No resident is assigned to it.`), { intentions: ['chambre'], ouvrir: 'c-chambres' });
  }
  if (sujet?.type === 'coordination') {
    const c = (await ch.listeCoordinations(pool, u, etabId, { toutes: true })).find((x) => x.id === sujet.id);
    const d = derniereEtape(c);
    const et = c.type === 'hospitalisation' ? (L === 'en' ? ETAPE_HOSP.en : ETAPE_HOSP.fr)[etapeHosp(c)] : c.type === 'retour' ? (c.reintegree_le || (c.statut === 'recue' && !c.arrivee_le) ? T(L, 'retour terminé', 'return completed') : RETOUR_TXT[lng(L)][c.statut]) : c.statut;
    return local(T(L, `${c.numero} (${c.type === 'hospitalisation' ? 'hospitalisation' : c.type === 'retour' ? 'retour d’hôpital' : 'transfert inter-CHSLD'}) · ${c.resident_ref} · ${c.origine} → ${c.destination} : ${et}. Dernière confirmation le ${fmt(d?.date || c.modifie_le)}.`,
      `${c.numero} (${c.type === 'hospitalisation' ? 'hospital stay' : c.type === 'retour' ? 'return from hospital' : 'inter-CHSLD transfer'}) · ${c.resident_ref} · ${c.origine} → ${c.destination}: ${et}. Last confirmation on ${fmt(d?.date || c.modifie_le)}.`), { intentions: ['coordination'], ouvrir: 'c-mouvements' });
  }
  if (sujet?.type === 'demande') {
    const d = (await ch.listeDemandes(pool, u, etabId, { toutes: true })).find((x) => x.id === sujet.id);
    const manque = (d.documents || []).filter((y) => !y.recu).map((y) => y.code);
    return local(T(L, `Demande d’hébergement ${d.numero} : ${d.statut.replace(/_/g, ' ')}${manque.length ? ` (documents manquants : ${manque.join(', ')})` : ''}. Mise à jour le ${fmt(d.modifie_le)}.`,
      `Placement request ${d.numero}: ${d.statut.replace(/_/g, ' ')}${manque.length ? ` (missing documents: ${manque.join(', ')})` : ''}. Updated on ${fmt(d.modifie_le)}.`), { intentions: ['demandes'], ouvrir: 'c-demandes' });
  }

  // Pronom sans résident connu : demander de qui il s'agit (avant toute réponse générale)
  if (pronom && !general && !ctx.residentId && !ctx.litId) return local(T(L, 'De quel résident parlez-vous ? Donnez son nom ou sa référence (R-00001 ou son lit, par exemple ERA-117A).', 'Which resident do you mean? Give their name or reference (R-00001 or their bed, for example ERA-117A).'), { intentions: ['resident'] });
  const g = await repondreGeneral(pool, u, etabId, e, qn, mots, L, fmt, local);
  if (g) return g;
  if (/(retrouve|trouve|cherche|recherche|find|search|ou est|where is|ouvre la fiche|open the record)/.test(qn)) return local(T(L, 'Je ne trouve aucun résident correspondant dans cet établissement.', 'I cannot find a matching resident in this facility.'), { intentions: ['resident'] });
  if (pronom && !ctx.residentId) return local(T(L, 'De quel résident parlez-vous ? Donnez son nom ou sa référence (R-00001 ou son lit, par exemple ERA-117A).', 'Which resident do you mean? Give their name or reference (R-00001 or their bed, for example ERA-117A).'), { intentions: ['resident'] });
  // Inconnu : le dire précisément, proposer une démarche, sans liste systématique des fonctions
  return local(T(L, 'Je n’ai pas trouvé à quoi cette question se rapporte dans les données de l’établissement. Reformulez avec un résident (nom ou référence), une chambre, ou un sujet (places, retours, hospitalisations, tâches) ; « Que peux-tu faire ? » donne la liste complète.',
    'I could not find what this question refers to in the facility’s data. Rephrase with a resident (name or reference), a room, or a topic (places, returns, hospital stays, tasks); “What can you do?” gives the full list.'), { intentions: ['inconnu'] });
}
module.exports = { repondre, referencesDe, normRef, residentsNommes, distance };
