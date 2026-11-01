'use strict';
/**
 * OG dans le module hospitalier Liaison CHSLD : mêmes droits que l'interface (src/liaison-chsld.js).
 * Réponses construites uniquement à partir des étapes enregistrées : OG cite la dernière confirmation et son
 * horodatage, et n'invente jamais une localisation physique. Il prépare le retour vers le CHSLD (carte à confirmer) ;
 * il ne décide ni d'une orientation clinique ni d'une priorité. L'hôpital ne voit que la référence du résident.
 */
const lia = require('./liaison-chsld');
const norm = (q) => String(q || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const T = (L, fr, en) => (L === 'en' ? en : fr);
// Dernier résident évoqué, par utilisateur et établissement (mémoire de conversation, sans persistance)
const CONTEXTE = new Map();

const ETAPES = {
  fr: { transmise: 'transmise, réception non confirmée', recue_hopital: 'reçue par l’hôpital', acceptee: 'acceptée', refusee: 'refusée', depart_confirme: 'départ confirmé par le CHSLD',
    arrivee_confirmee: 'arrivée confirmée, accueil à préparer', admission: 'admission préparée', urgence: 'accueil à l’urgence', retour_preparation: 'retour en préparation', cloturee: 'clôturée',
    annulee: 'annulée', expiree: 'expirée', retour_propose: 'retour proposé, en attente du CHSLD', retour_accepte: 'retour accepté par le CHSLD', retour_en_route: 'départ vers le CHSLD confirmé', retour_recu: 'retour reçu' },
  en: { transmise: 'sent, receipt not confirmed', recue_hopital: 'received by the hospital', acceptee: 'accepted', refusee: 'declined', depart_confirme: 'departure confirmed by the CHSLD',
    arrivee_confirmee: 'arrival confirmed, reception to prepare', admission: 'admission prepared', urgence: 'emergency reception', retour_preparation: 'return being prepared', cloturee: 'closed',
    annulee: 'cancelled', expiree: 'expired', retour_propose: 'return proposed, awaiting the CHSLD', retour_accepte: 'return accepted by the CHSLD', retour_en_route: 'departure to the CHSLD confirmed', retour_recu: 'return received' },
};
const JOURNAL = {
  fr: { envoyee: 'demande transmise', recue_hopital: 'réception confirmée', acceptee: 'acceptée', refusee: 'refusée', en_cours: 'départ confirmé', arrivee: 'arrivée confirmée', recue: 'arrivée confirmée',
    'orientation:admission': 'admission préparée', 'orientation:urgence': 'orientation vers l’urgence', annulee: 'annulée', cloturee: 'parcours clôturé' },
  en: { envoyee: 'request sent', recue_hopital: 'receipt confirmed', acceptee: 'accepted', refusee: 'declined', en_cours: 'departure confirmed', arrivee: 'arrival confirmed', recue: 'arrival confirmed',
    'orientation:admission': 'admission prepared', 'orientation:urgence': 'directed to emergency', annulee: 'cancelled', cloturee: 'pathway closed' },
};
let fuseau = 'America/Toronto'; // remplacé par le fuseau du profil de l'établissement à chaque question
const heure = (L, d) => new Date(d).toLocaleString(L === 'en' ? 'en-CA' : 'fr-CA', { dateStyle: 'short', timeStyle: 'short', timeZone: fuseau });
const etapeTxt = (L, e) => ETAPES[L === 'en' ? 'en' : 'fr'][e] || e;
const confirmation = (L, c) => { const d = c.derniere; const k = d.statut.startsWith('incident:') ? T(L, 'incident signalé', 'incident reported') : (JOURNAL[L === 'en' ? 'en' : 'fr'][d.statut] || d.statut); return T(L, `dernière confirmation : ${k}, ${heure(L, d.date)}`, `last confirmation: ${k}, ${heure(L, d.date)}`); };
const ligne = (L, c) => `• ${c.resident_ref} · ${c.origine} · ${etapeTxt(L, c.etape)} (${c.numero}) — ${confirmation(L, c)}`;

/** Question qui relève de la Liaison CHSLD ? (mentions CHSLD, résident, référence R-00000, retour vers un CHSLD) */
function concerne(qn, q) {
  if (/(demande|request)s?\b.*(reponse|response|repondre|respond)/.test(qn)) return true;
  if (/\bchslds?\b|residents?\b|residente?s?\b|liaison/.test(qn) || /\b(?:R|RES)[\s-]?\d{1,5}\b/i.test(q) || /\bCO[\s-]?\d{1,5}\b/i.test(q)) return true;
  // « Où en est le transfert de Jean Dupont ? » : sans référence hospitalière (P-, TR-), la question peut viser un résident de CHSLD
  return /(ou en est|where is|status of).*(transfert|transfer) (de|of) [a-z]/.test(qn) && !/\b(?:P|TR)-\d/i.test(q);
}

async function repondre(pool, u, etabId, q, L) {
  const qn = norm(q).replace(/-/g, ' ');
  if (!concerne(qn, q)) {
    // Nom d'un CHSLD cité sans le mot « CHSLD » (« demandes provenant des Érables »)
    const noms = (await pool.query("SELECT nom FROM etablissements WHERE type_etablissement = 'chsld' AND actif")).rows.map((x) => norm(x.nom));
    if (!noms.some((n) => n.split(/[^a-z0-9]+/).filter((m) => m.length > 5 && m !== 'chsld').some((m) => qn.includes(m)))) return null;
  }
  const local = (reponse, extra = {}) => ({ mode: 'local', reponse, sources: ['arrimo'], intentions: ['liaison_chsld'], ouvrir: 'liaison', ...extra });
  let d;
  try { d = await lia.vue(pool, u, etabId); } catch (e) {
    if (e.code === 'module_desactive') return { mode: 'local', reponse: T(L, 'La Liaison CHSLD n’est pas activée dans cet hôpital : je n’ai accès à aucune demande de CHSLD.', 'CHSLD liaison is not enabled in this hospital: I have no access to CHSLD requests.'), sources: [], intentions: ['liaison_chsld'] };
    throw e;
  }
  fuseau = (await pool.query('SELECT c.fuseau FROM etablissements e JOIN config_pays c ON c.id = e.config_id WHERE e.id = $1', [etabId])).rows[0]?.fuseau || 'America/Toronto';
  const tous = [...d.arrivees, ...d.a_accueillir, ...d.hospitalisations, ...d.historique];
  const cle = `${u.id}:${etabId}`;
  // Décisions qui ne relèvent pas d'OG
  if (/(priorit\w* clinique|clinical priority|qui envoyer aux urgences|who should go|decide|decider|orientation clinique|clinical orientation)/.test(qn)) {
    return local(T(L, 'Je ne décide ni de l’orientation clinique ni d’une priorité : l’admission ou l’accueil à l’urgence est décidé par le personnel habilité. Je peux afficher les demandes et préparer une étape à confirmer.',
      'I do not decide clinical orientation or priority: admission or emergency reception is decided by authorized staff. I can show requests and prepare a step for confirmation.'));
  }
  // Résident désigné : référence explicite, ou mémorisée pour « ce résident »
  // Références tolérantes : R-00001, r00001, R 1, RES-0001 ; numéro de coordination CO-00012
  const mRef = q.match(/\b(?:R|RES)[\s-]?(\d{1,5})\b/i);
  const mCo = q.match(/\bCO[\s-]?(\d{1,5})\b/i);
  const parCo = mCo ? tous.find((c) => c.numero === `CO-${mCo[1].padStart(5, '0')}` || c.retour?.numero === `CO-${mCo[1].padStart(5, '0')}`) : null;
  if (mCo && !parCo) return local(T(L, `Aucune coordination ${mCo[0].toUpperCase()} n’est visible pour cet hôpital.`, `No coordination ${mCo[0].toUpperCase()} is visible for this hospital.`));
  const ref = parCo?.resident_ref || (mRef ? `R-${mRef[1].padStart(5, '0')}` : null)
    || (/\b(ce resident|cette residente|this resident|son chsld|his chsld|her chsld|their chsld|ce transfert|this transfer|cette demande|this request|il|elle|he|she|origine|provenance|vient)\b/.test(qn.replace(/\b(y a t|fait|faut|s agit) il\b/g, '')) ? CONTEXTE.get(cle) : null);
  // Quel CHSLD est à l'origine (d'après la référence ou le contexte)
  if (ref && /(origine|provenance|vient|from which|\borigin\b|comes? from which)/.test(qn)) {
    const c = tous.find((x) => x.resident_ref === ref);
    if (c) { CONTEXTE.set(cle, ref); return local(T(L, `${ref} (${c.numero}) vient de ${c.origine} ; ${confirmation(L, c)}.`, `${ref} (${c.numero}) comes from ${c.origine}; ${confirmation(L, c)}.`)); }
  }
  // Préparer le retour : carte à confirmer (date choisie par la personne), jamais d'écriture directe
  if (/(prepare|preparer|prepare\b).*(retour|return)/.test(qn)) {
    if (!ref) return local(T(L, 'Précisez la référence du résident (R-00000) : je ne vois que les références des résidents de CHSLD.', 'Specify the resident reference (R-00000): I only see CHSLD resident references.'));
    const c = d.hospitalisations.concat(d.a_accueillir).find((x) => x.resident_ref === ref);
    if (!c) return local(T(L, `Aucune hospitalisation confirmée ici pour ${ref} : je ne peux pas préparer de retour.`, `No confirmed hospital stay here for ${ref}: I cannot prepare a return.`));
    CONTEXTE.set(cle, ref);
    if (!c.actions.includes('retour')) return local(T(L, `${ref} : ${etapeTxt(L, c.etape)}. Le retour ne peut pas être préparé à cette étape ou par votre rôle.`, `${ref}: ${etapeTxt(L, c.etape)}. The return cannot be prepared at this step or with your role.`));
    return local(T(L, `Voici le retour de ${ref} vers ${c.origine} à confirmer. Choisissez la date prévue ; rien n’est enregistré avant votre confirmation, puis le CHSLD devra l’accepter.`,
      `Here is the return of ${ref} to ${c.origine} to confirm. Choose the planned date; nothing is recorded before you confirm, then the CHSLD must accept it.`),
    { proposition_chsld: { type: 'retour', coordination_id: c.id, resident_ref: ref, chsld: c.origine, corps: {} } });
  }
  // Où en est le transfert / la demande d'un résident
  if (ref) {
    const c = tous.find((x) => x.resident_ref === ref);
    if (!c) return local(T(L, `Aucune demande de CHSLD n’est enregistrée ici pour ${ref}.`, `No CHSLD request is recorded here for ${ref}.`));
    CONTEXTE.set(cle, ref);
    return local(T(L, `${ref}, depuis ${c.origine} (${c.numero}) : ${etapeTxt(L, c.etape)} ; ${confirmation(L, c)}.${c.retour ? `\nRetour : ${etapeTxt(L, c.retour.etape)} (${c.retour.numero}).` : ''}${['transmise', 'recue_hopital', 'acceptee'].includes(c.etape) ? '\nLe départ n’est pas encore confirmé : le résident n’est pas réputé parti.' : ''}`,
      `${ref}, from ${c.origine} (${c.numero}): ${etapeTxt(L, c.etape)}; ${confirmation(L, c)}.${c.retour ? `\nReturn: ${etapeTxt(L, c.retour.etape)} (${c.retour.numero}).` : ''}${['transmise', 'recue_hopital', 'acceptee'].includes(c.etape) ? '\nDeparture is not confirmed yet: the resident is not considered to have left.' : ''}`));
  }
  // Nom d'un résident : l'hôpital ne voit que les références
  if (/(ou en est|where is|status of|statut de|transfert de|transfer of)/.test(qn)) {
    return local(T(L, 'Je ne vois que les références des résidents de CHSLD (R-00000), jamais leur nom. Donnez la référence pour connaître la dernière étape confirmée. Pour un transfert interhospitalier, indiquez son numéro (TR-…) ou la référence du patient (P-…).',
      'I only see CHSLD resident references (R-00000), never their names. Give the reference to get the last confirmed step. For an inter-hospital transfer, give its number (TR-…) or the patient reference (P-…).'));
  }
  // Retours vers les CHSLD en préparation
  if (/(retour|return)/.test(qn)) {
    const r = d.hospitalisations.filter((c) => c.retour && ['retour_propose', 'retour_accepte', 'retour_en_route'].includes(c.retour.etape));
    return local(r.length ? T(L, `${r.length} retour(s) vers les CHSLD en préparation :\n${r.map((c) => `• ${c.resident_ref} → ${c.origine} · ${etapeTxt(L, c.retour.etape)} (${c.retour.numero})${c.retour.retour_prevu_le ? ` · prévu ${heure(L, c.retour.retour_prevu_le)}` : ''}`).join('\n')}`,
      `${r.length} return(s) to CHSLDs being prepared:\n${r.map((c) => `• ${c.resident_ref} → ${c.origine} · ${etapeTxt(L, c.retour.etape)} (${c.retour.numero})${c.retour.retour_prevu_le ? ` · planned ${heure(L, c.retour.retour_prevu_le)}` : ''}`).join('\n')}`)
      : T(L, 'Aucun retour vers un CHSLD n’est en préparation.', 'No return to a CHSLD is being prepared.'));
  }
  // Demandes qui attendent une réponse de l'hôpital (réception, acceptation ou refus)
  if (/(demande|request)/.test(qn) && /(reponse|repondre|response|respond|pending|en attente|attendent)/.test(qn)) {
    const l = d.arrivees.filter((c) => ['transmise', 'recue_hopital'].includes(c.etape));
    return local(l.length ? T(L, `${l.length} demande(s) de CHSLD en attente de votre réponse :\n${l.map((c) => ligne(L, c)).join('\n')}`, `${l.length} CHSLD request(s) awaiting your response:\n${l.map((c) => ligne(L, c)).join('\n')}`)
      : T(L, 'Aucune demande de CHSLD n’attend votre réponse.', 'No CHSLD request is awaiting your response.'));
  }
  // Demandes d'un CHSLD nommé
  const chsldNomme = [...new Set(tous.map((c) => c.origine))].find((nom) => norm(nom).split(/[^a-z0-9]+/).filter((m) => m.length > 4 && !['chsld'].includes(m)).some((m) => qn.includes(m)));
  if (chsldNomme) {
    const l = tous.filter((c) => c.origine === chsldNomme && !['cloturee', 'refusee', 'annulee', 'expiree'].includes(c.etape));
    return local(l.length ? T(L, `${l.length} demande(s) ouverte(s) de ${chsldNomme} :\n${l.map((c) => ligne(L, c)).join('\n')}`, `${l.length} open request(s) from ${chsldNomme}:\n${l.map((c) => ligne(L, c)).join('\n')}`)
      : T(L, `Aucune demande ouverte de ${chsldNomme}.`, `No open request from ${chsldNomme}.`));
  }
  // Arrivés, en attente d'accueil / de confirmation d'accueil
  if (/(sont arrive|arrived|accueil|confirmation|attendent|waiting|awaiting|to receive|to be received)/.test(qn) && !/(attendu|expected)/.test(qn)) {
    const arrives = d.a_accueillir.filter((c) => c.etape === 'arrivee_confirmee');
    const aConfirmer = d.a_accueillir.filter((c) => c.etape === 'depart_confirme');
    const parts = [];
    if (aConfirmer.length) parts.push(T(L, `Départ confirmé, arrivée à confirmer (${aConfirmer.length}) :`, `Departure confirmed, arrival to confirm (${aConfirmer.length}):`), ...aConfirmer.map((c) => ligne(L, c)));
    if (arrives.length) parts.push(T(L, `Arrivés, accueil à préparer (${arrives.length}) :`, `Arrived, reception to prepare (${arrives.length}):`), ...arrives.map((c) => ligne(L, c)));
    return local(parts.length ? parts.join('\n') : T(L, 'Aucun résident de CHSLD n’attend un accueil.', 'No CHSLD resident is awaiting reception.'));
  }
  // Résidents attendus (aujourd'hui) : demandes transmises ou acceptées, départs confirmés
  if (/(attendu|expected|arrivee|arrival|demande|request|aujourd|today)/.test(qn)) {
    const attendus = [...d.arrivees, ...d.a_accueillir.filter((c) => c.etape === 'depart_confirme')];
    const auj = /(aujourd|today)/.test(qn) ? attendus.filter((c) => new Date(c.cree_le).toDateString() === new Date().toDateString() || new Date(c.modifie_le).toDateString() === new Date().toDateString()) : attendus;
    return local(auj.length ? T(L, `${auj.length} résident(s) de CHSLD attendu(s)${/(aujourd|today)/.test(qn) ? ' aujourd’hui' : ''} :\n${auj.map((c) => ligne(L, c)).join('\n')}\nUne demande transmise n’est pas une arrivée.`,
      `${auj.length} CHSLD resident(s) expected${/(aujourd|today)/.test(qn) ? ' today' : ''}:\n${auj.map((c) => ligne(L, c)).join('\n')}\nA sent request is not an arrival.`)
      : T(L, 'Aucun résident de CHSLD n’est attendu.', 'No CHSLD resident is expected.'));
  }
  return local(T(L, `Liaison CHSLD : ${d.compteurs.arrivees} demande(s) en attente, ${d.compteurs.a_accueillir} à accueillir, ${d.compteurs.hospitalisations} hospitalisation(s) en cours, dont ${d.compteurs.retours} avec un retour.`,
    `CHSLD liaison: ${d.compteurs.arrivees} pending request(s), ${d.compteurs.a_accueillir} to receive, ${d.compteurs.hospitalisations} hospital stay(s), ${d.compteurs.retours} with a return.`));
}
module.exports = { repondre, concerne };
