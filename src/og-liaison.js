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
// Bornée : 30 minutes et 2000 conversations au plus ; les droits sont relus à chaque question.
const CONTEXTE = new Map();
const DUREE_CONTEXTE = 30 * 60 * 1000;
const lireContexte = (k) => { const c = CONTEXTE.get(k); return c && Date.now() - c.t < DUREE_CONTEXTE ? c.ref : null; };
const ecrireContexte = (k, ref) => { CONTEXTE.delete(k); CONTEXTE.set(k, { ref, t: Date.now() }); if (CONTEXTE.size > 2000) CONTEXTE.delete(CONTEXTE.keys().next().value); };

const ETAPES = {
  fr: { transmise: 'transmise, réception non confirmée', recue_hopital: 'reçue par l’hôpital', acceptee: 'acceptée', refusee: 'refusée', depart_confirme: 'départ confirmé par le CHSLD',
    arrivee_confirmee: 'arrivée confirmée, accueil à préparer', admission: 'admission préparée', urgence: 'accueil à l’urgence', retour_preparation: 'retour en préparation', cloturee: 'clôturée',
    annulee: 'annulée', expiree: 'expirée', retour_propose: 'retour proposé, en attente du CHSLD', retour_accepte: 'retour accepté par le CHSLD', retour_chambre_verifiee: 'chambre vérifiée par le CHSLD', retour_en_route: 'départ vers le CHSLD confirmé', retour_arrive: 'arrivé au CHSLD, réintégration à confirmer', retour_reintegre: 'réintégré au CHSLD', retour_recu: 'retour reçu' },
  en: { transmise: 'sent, receipt not confirmed', recue_hopital: 'received by the hospital', acceptee: 'accepted', refusee: 'declined', depart_confirme: 'departure confirmed by the CHSLD',
    arrivee_confirmee: 'arrival confirmed, reception to prepare', admission: 'admission prepared', urgence: 'emergency reception', retour_preparation: 'return being prepared', cloturee: 'closed',
    annulee: 'cancelled', expiree: 'expired', retour_propose: 'return proposed, awaiting the CHSLD', retour_accepte: 'return accepted by the CHSLD', retour_chambre_verifiee: 'room checked by the CHSLD', retour_en_route: 'departure to the CHSLD confirmed', retour_arrive: 'arrived at the CHSLD, reinstatement to confirm', retour_reintegre: 'reinstated at the CHSLD', retour_recu: 'return received' },
};
const JOURNAL = {
  fr: { envoyee: 'demande transmise', recue_hopital: 'réception confirmée', acceptee: 'acceptée', refusee: 'refusée', en_cours: 'départ confirmé', arrivee: 'arrivée confirmée', recue: 'arrivée confirmée',
    'orientation:admission': 'admission préparée', 'orientation:urgence': 'orientation vers l’urgence', annulee: 'annulée', cloturee: 'parcours clôturé' },
  en: { envoyee: 'request sent', recue_hopital: 'receipt confirmed', acceptee: 'accepted', refusee: 'declined', en_cours: 'departure confirmed', arrivee: 'arrival confirmed', recue: 'arrival confirmed',
    'orientation:admission': 'admission prepared', 'orientation:urgence': 'directed to emergency', annulee: 'cancelled', cloturee: 'pathway closed' },
};
// Fuseau du profil de l'établissement, propre à chaque requête (aucun état partagé entre deux questions simultanées)
const { AsyncLocalStorage } = require('node:async_hooks');
const fuseauRequete = new AsyncLocalStorage();
const heure = (L, d) => new Date(d).toLocaleString(L === 'en' ? 'en-CA' : 'fr-CA', { dateStyle: 'short', timeStyle: 'short', timeZone: fuseauRequete.getStore() || 'America/Toronto' });
const etapeTxt = (L, e) => ETAPES[L === 'en' ? 'en' : 'fr'][e] || e;
const confirmation = (L, c) => { const d = c.derniere; const k = d.statut.startsWith('incident:') ? T(L, 'incident signalé', 'incident reported') : (JOURNAL[L === 'en' ? 'en' : 'fr'][d.statut] || d.statut); return T(L, `dernière confirmation : ${k}, ${heure(L, d.date)}`, `last confirmation: ${k}, ${heure(L, d.date)}`); };
const ligne = (L, c) => `• ${c.resident_ref} · ${c.origine} · ${etapeTxt(L, c.etape)} (${c.numero}) — ${confirmation(L, c)}`;

/** Question qui relève de la Liaison CHSLD ? (mentions CHSLD, résident, référence R-00000, retour vers un CHSLD) */
function concerne(qn, q) {
  // « Demandes de transfert » sans mention d'un CHSLD : ce sont les transferts de l'hôpital, pas la Liaison
  if (/(demande|request)s?\b.*(reponse|response|repondre|respond)/.test(qn) && !/transfert|transfer/.test(qn)) return true;
  if (/\bchslds?\b|residents?\b|residente?s?\b|liaison/.test(qn) || /\b(?:R|RES)[\s-]?\d{1,5}\b/i.test(q) || /\bCO[\s-]?\d{1,5}\b/i.test(q)) return true;
  // « Où en est le transfert de Jean Dupont ? » : sans référence hospitalière (P-, TR-), la question peut viser un résident de CHSLD
  return /(ou en est|where is|status of).*(transfert|transfer) (de|of) [a-z]/.test(qn) && !/\b(?:P|TR)-\d/i.test(q);
}

async function traiter(pool, u, etabId, q, L) {
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
  const tous = [...d.arrivees, ...d.a_accueillir, ...d.hospitalisations, ...d.retours_en_cours, ...d.historique];
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
    || (/\b(ce resident|cette residente|this resident|son chsld|his chsld|her chsld|their chsld|ce transfert|this transfer|cette demande|this request|il|elle|he|she|origine|provenance|vient)\b/.test(qn.replace(/\b(y a t|fait|faut|s agit) il\b/g, '')) ? lireContexte(cle) : null);
  // Quel CHSLD est à l'origine (d'après la référence ou le contexte)
  if (ref && /(origine|provenance|vient|from which|\borigin\b|comes? from which)/.test(qn)) {
    const c = tous.find((x) => x.resident_ref === ref);
    if (c) { ecrireContexte(cle, ref); return local(T(L, `${ref} (${c.numero}) vient de ${c.origine} ; ${confirmation(L, c)}.`, `${ref} (${c.numero}) comes from ${c.origine}; ${confirmation(L, c)}.`)); }
  }
  // Préparer le retour : carte à confirmer (date choisie par la personne), jamais d'écriture directe
  if (/(prepare|preparer|prepare\b).*(retour|return)/.test(qn)) {
    if (!ref) return local(T(L, 'Précisez la référence du résident (R-00000) : je ne vois que les références des résidents de CHSLD.', 'Specify the resident reference (R-00000): I only see CHSLD resident references.'));
    const c = d.hospitalisations.concat(d.a_accueillir, d.retours_en_cours).find((x) => x.resident_ref === ref);
    if (!c) return local(T(L, `Aucune hospitalisation confirmée ici pour ${ref} : je ne peux pas préparer de retour.`, `No confirmed hospital stay here for ${ref}: I cannot prepare a return.`));
    ecrireContexte(cle, ref);
    if (!c.actions.includes('retour')) return local(T(L, `${ref} : ${etapeTxt(L, c.etape)}. Le retour ne peut pas être préparé à cette étape ou par votre rôle.`, `${ref}: ${etapeTxt(L, c.etape)}. The return cannot be prepared at this step or with your role.`));
    return local(T(L, `Voici le retour de ${ref} vers ${c.origine} à confirmer. Choisissez la date prévue ; rien n’est enregistré avant votre confirmation, puis le CHSLD devra l’accepter.`,
      `Here is the return of ${ref} to ${c.origine} to confirm. Choose the planned date; nothing is recorded before you confirm, then the CHSLD must accept it.`),
    { proposition_chsld: { type: 'retour', coordination_id: c.id, resident_ref: ref, chsld: c.origine, corps: {} } });
  }
  // Où en est le transfert / la demande d'un résident
  if (ref) {
    const c = tous.find((x) => x.resident_ref === ref);
    if (!c) return local(T(L, `Aucune demande de CHSLD n’est enregistrée ici pour ${ref}.`, `No CHSLD request is recorded here for ${ref}.`));
    ecrireContexte(cle, ref);
    return local(T(L, `${ref}, depuis ${c.origine} (${c.numero}) : ${etapeTxt(L, c.etape)} ; ${confirmation(L, c)}.${c.retour ? `\nRetour : ${etapeTxt(L, c.retour.etape)} (${c.retour.numero}).` : ''}${['transmise', 'recue_hopital', 'acceptee'].includes(c.etape) ? '\nLe départ n’est pas encore confirmé : le résident n’est pas réputé parti.' : ''}`,
      `${ref}, from ${c.origine} (${c.numero}): ${etapeTxt(L, c.etape)}; ${confirmation(L, c)}.${c.retour ? `\nReturn: ${etapeTxt(L, c.retour.etape)} (${c.retour.numero}).` : ''}${['transmise', 'recue_hopital', 'acceptee'].includes(c.etape) ? '\nDeparture is not confirmed yet: the resident is not considered to have left.' : ''}`));
  }
  // Nom d'un résident : l'hôpital ne voit que les références
  if (/(ou en est|where is|status of|statut de|transfert de|transfer of)/.test(qn)) {
    return local(T(L, 'Je ne vois que les références des résidents de CHSLD (R-00000), jamais leur nom. Donnez la référence pour connaître la dernière étape confirmée. Pour un transfert interhospitalier, indiquez son numéro (TR-…) ou la référence du patient (P-…).',
      'I only see CHSLD resident references (R-00000), never their names. Give the reference to get the last confirmed step. For an inter-hospital transfer, give its number (TR-…) or the patient reference (P-…).'));
  }
  // Transferts vers un autre hôpital : numéro cité ou liste de ce qui demande une action. Dans le périmètre de cet hôpital seulement.
  const numero = (q.match(/\bCO[\s-]?(\d{1,5})\b/i) || [])[1];
  if (numero) {
    const t = [...d.transferts, ...d.historique].find((c) => c.type === 'transfert_hopital' && c.numero === `CO-${numero.padStart(5, '0')}`);
    if (t) return local(T(L, `${t.numero} : transfert de ${t.resident_ref}, ${t.origine} → ${t.destination}. ${t.statut === 'recue' ? 'Arrivée confirmée.' : `Étape : ${t.etape}.`}`, `${t.numero}: transfer of ${t.resident_ref}, ${t.origine} → ${t.destination}. ${t.statut === 'recue' ? 'Arrival confirmed.' : `Step: ${t.etape}.`}`));
  }
  if (/(transfert|transfer)/.test(qn) && /(action|attend|autre hopital|another hospital|waiting|hopital a|d hopital)/.test(qn) && /(chsld|resident|liaison)/.test(qn)) {
    const a = d.transferts.filter((c) => c.actions.length);
    return local(a.length ? T(L, `${a.length} transfert(s) d’hôpital demandent une action :\n${a.map((c) => `• ${c.numero} · ${c.resident_ref} · ${c.origine} → ${c.destination}`).join('\n')}`, `${a.length} hospital transfer(s) need action:\n${a.map((c) => `• ${c.numero} · ${c.resident_ref} · ${c.origine} → ${c.destination}`).join('\n')}`)
      : T(L, 'Aucun transfert d’hôpital ne demande d’action.', 'No hospital transfer needs action.'));
  }
  // Retours vers les CHSLD en préparation
  if (/(retour|return)/.test(qn)) {
    const r = d.retours_en_cours;
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
async function repondre(pool, u, etabId, q, L) {
  const fuseau = (await pool.query('SELECT c.fuseau FROM etablissements e JOIN config_pays c ON c.id = e.config_id WHERE e.id = $1', [etabId])).rows[0]?.fuseau;
  return fuseauRequete.run(fuseau || 'America/Toronto', () => traiter(pool, u, etabId, q, L));
}
module.exports = { repondre, concerne };
