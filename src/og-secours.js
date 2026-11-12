'use strict';
/**
 * OG dans le module hospitalier Liaison Secours : mêmes droits que l'interface (src/prealertes.js).
 * Réponses construites uniquement à partir des préalertes et de leurs étapes enregistrées : unité, entreprise, heure prévue,
 * priorité déclarée par l'équipe, dernière confirmation. OG ne décide ni de la destination, ni d'un service, ni d'une priorité.
 */
const pa = require('./prealertes');
const { ErreurHttp } = require('./db');
const norm = (q) => String(q || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const T = (L, fr, en) => (L === 'en' ? en : fr);
const PRIO = { fr: { immediate: 'immédiate', urgente: 'urgente', non_urgente: 'non urgente' }, en: { immediate: 'immediate', urgente: 'urgent', non_urgente: 'non-urgent' } };
const ETAT = {
  fr: { envoyee: 'non encore reçue par l’écran', recue: 'reçue, non consultée', consultee: 'consultée, prise en compte à confirmer', prise_en_compte: 'prise en compte',
    preparation: 'préparation en cours', preparation_terminee: 'préparation terminée', arrivee: 'arrivée confirmée', cloturee: 'clôturée', annulee: 'annulée', remplacee: 'remplacée (destination modifiée)' },
  en: { envoyee: 'not yet received by the screen', recue: 'received, not viewed', consultee: 'viewed, acknowledgement to confirm', prise_en_compte: 'acknowledged',
    preparation: 'preparation in progress', preparation_terminee: 'preparation complete', arrivee: 'arrival confirmed', cloturee: 'closed', annulee: 'cancelled', remplacee: 'replaced (destination changed)' },
};
const lang = (L) => (L === 'en' ? 'en' : 'fr');

/** Question qui relève de la Liaison Secours ? (ambulance, préalerte, paramédic, numéro PA-000000) */
function concerne(qn, q) {
  // Transferts interhospitaliers (TR-…) : ils relèvent des réponses de transfert, sauf mention explicite d'une préalerte
  if ((/\bTR-\d/i.test(q) || /transferts?|transfers?/.test(qn)) && !/pre-?\s?alert|\bPA[\s-]?\d/i.test(qn)) return false;
  // « Quel service est potentiellement concerné ? » (cahier, section 2.1) : formulation propre aux préalertes
  if (/\b(services?|departements?|departments?)\b.*\b(potentiel\w*|potential\w*)/.test(qn)) return true;
  return /\b(ambulances?|prealertes?|pre alertes?|pre-alertes?|pre-alerts?|prealerts?|paramedic\w*|liaison secours)\b/.test(qn) || /\bPA[\s-]?\d{1,6}\b/i.test(q);
}
function minutes(d) { return d ? Math.round((new Date(d).getTime() - Date.now()) / 60000) : null; }
function ligne(L, p) {
  const m = minutes(p.heure_prevue);
  const eta = m == null ? T(L, 'heure non transmise', 'time not provided') : m > 0 ? T(L, `dans ${m} min`, `in ${m} min`) : T(L, 'heure prévue dépassée', 'expected time passed');
  const arrivee = p.arrivee_signalee_le && p.statut !== 'arrivee' ? T(L, ' ; arrivée signalée, véhicule à confirmer', '; arrival reported, vehicle to confirm') : '';
  return `• ${p.numero} · ${p.unite} (${p.organisation}) · ${T(L, 'priorité', 'priority')} ${PRIO[lang(L)][p.priorite]} · ${eta} · ${ETAT[lang(L)][p.statut] || p.statut}${arrivee}`;
}

async function repondre(pool, u, etabId, q, L) {
  const qn = norm(q);
  if (!concerne(qn, q)) return null;
  const local = (reponse) => ({ mode: 'local', reponse, sources: ['arrimo'], intentions: ['liaison_secours'], ouvrir: 'secours' });
  if (/(quel(le)? (hopital|destination|service)|which (hospital|destination|service)).*(choisir|envoyer|diriger|choose|send)|priorit\w* clinique|clinical priority|diagnosti/.test(qn)) {
    return local(T(L, 'Je ne décide ni de la destination, ni du service, ni d’une priorité clinique : ce sont les professionnels et les protocoles qui en décident. Je peux afficher les préalertes et leurs étapes.',
      'I do not decide the destination, the department or a clinical priority: professionals and protocols do. I can show pre-alerts and their steps.'));
  }
  let d;
  try { d = await pa.liste(pool, u, { etablissement_id: etabId }); } catch (e) {
    // Module non activé : la question est laissée aux autres réponses d'OG (transferts, urgence…)
    if (e.code === 'module_desactive' || e.code === 'role_insuffisant') return null;
    throw e;
  }
  const ouvertes = d.prealertes.filter((p) => pa.OUVERTES.includes(p.statut));
  const m = q.match(/\bPA[\s-]?(\d{1,6})\b/i);
  if (m) {
    const num = `PA-${m[1].padStart(6, '0')}`;
    const p = d.prealertes.find((x) => x.numero === num);
    if (!p) return local(T(L, `Aucune préalerte ${num} n’est visible pour cet hôpital.`, `No pre-alert ${num} is visible for this hospital.`));
    return local(ligne(L, p).slice(2));
  }
  // « Quel service est potentiellement concerné ? » : proposition d'OG d'après les règles de l'établissement, et décision de l'équipe
  if (/(services?|departements?|departments?)\b.*(concern|propos|potenti)|(concern|propos)\w*.*(services?|departements?|departments?)\b/.test(qn)) {
    if (!ouvertes.length) return local(T(L, 'Aucune ambulance n’est annoncée pour le moment.', 'No ambulance is announced at the moment.'));
    const lignes = ouvertes.map((p) => `• ${p.numero} (${p.unite}) : ${p.service_statut === 'confirme' || p.service_statut === 'modifie' ? T(L, `service retenu par l’équipe : ${p.service_confirme}`, `department set by the team: ${p.service_confirme}`)
      : p.service_statut === 'a_confirmer' ? T(L, `proposition : ${p.service_propose} (règle de l’établissement), à confirmer par l’équipe`, `proposal: ${p.service_propose} (hospital rule), to be confirmed by the team`)
        : T(L, 'aucune règle de service pour cette catégorie : à indiquer par l’équipe', 'no department rule for this category: to be set by the team')}`);
    return local(`${lignes.join('\n')}\n${T(L, 'Je propose d’après les règles de l’établissement ; je ne pose aucun diagnostic et n’affecte pas le patient.', 'I propose from the hospital’s rules; I make no diagnosis and do not assign the patient.')}`);
  }
  if (/(non (prise|confirme)|pas (encore )?(prise|confirme)|attente|a confirmer|not (yet )?acknowledged|awaiting|pending)/.test(qn)) {
    const a = ouvertes.filter((p) => !p.prise_en_compte_le);
    if (!a.length) return local(T(L, 'Toutes les préalertes ouvertes ont été prises en compte.', 'All open pre-alerts have been acknowledged.'));
    const titre = a.length > 1 ? T(L, `${a.length} préalertes à prendre en compte :`, `${a.length} pre-alerts to acknowledge:`) : T(L, '1 préalerte à prendre en compte :', '1 pre-alert to acknowledge:');
    return local(`${titre}\n${a.map((p) => ligne(L, p)).join('\n')}`);
  }
  if (!ouvertes.length) return local(T(L, 'Aucune ambulance n’est annoncée pour le moment.', 'No ambulance is announced at the moment.'));
  const n = ouvertes.length;
  return local(`${T(L, n > 1 ? `${n} ambulances annoncées :` : '1 ambulance annoncée :', n > 1 ? `${n} ambulances announced:` : '1 ambulance announced:')}\n${ouvertes.map((p) => ligne(L, p)).join('\n')}`);
}

/**
 * OG sur l'écran des ambulances et des CCS : mêmes droits que l'écran (préalertes de l'organisation ou de la région,
 * urgences de la région). Exemples du cahier (section 2.1) : ambulance en route, réception confirmée, heure prévue,
 * informations manquantes, état des urgences. Aucune destination, aucun service ni aucune priorité n'est décidé.
 */
const NIVEAU = { fr: { vert: 'fluide', jaune: 'chargée', orange: 'très chargée', rouge: 'saturée' }, en: { vert: 'flowing', jaune: 'busy', orange: 'very busy', rouge: 'saturated' } };
async function repondreSecours(pool, u, question, L) {
  if (!pa.ROLES_SECOURS.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const q = String(question || '').slice(0, 500); const qn = norm(q);
  const local = (reponse, intention) => ({ mode: 'local', reponse, sources: ['arrimo'], intentions: [intention] });
  if (/(quel(le)? (hopital|destination|service)|which (hospital|destination|service)|ou (aller|l.?amener|transporter)|where (to go|should))|priorit\w* clinique|clinical priority|diagnosti|triage/.test(qn)) {
    return local(T(L, 'Je ne décide ni de la destination, ni du service, ni d’une priorité clinique : ce sont l’équipe et les protocoles applicables qui en décident. Je peux afficher l’état des urgences de la région et le suivi des préalertes.',
      'I do not decide the destination, the department or a clinical priority: the crew and applicable protocols do. I can show the regional emergency status and pre-alert tracking.'), 'refus_decision');
  }
  // Demandes de transport des établissements (cahier 3) : référence et étapes seulement
  if (/(transports?|demandes? (des|d.)? ?etablissements?|requests? from facilit|chsld|rpa|residence|ressource)/.test(qn)) {
    const tr = await require('./transports').liste(pool, u, {});
    const ouv = tr.filter((x) => require('./transports').OUVERTES.includes(x.statut));
    if (!ouv.length) return local(T(L, 'Aucune demande de transport en cours.', 'No transport request in progress.'), 'transports');
    const ST = { fr: { demandee: 'à accepter', acceptee: 'acceptée', en_route: 'en route', pris_en_charge: 'résident pris en charge' }, en: { demandee: 'to accept', acceptee: 'accepted', en_route: 'on the way', pris_en_charge: 'resident picked up' } };
    return local(ouv.map((x) => `• ${x.numero} · ${x.resident_ref} : ${x.origine} → ${x.destination} · ${ST[lang(L)][x.statut]}${x.unite ? ` (${x.unite})` : ''}`).join('\n'), 'transports');
  }
  const d = await pa.liste(pool, u, {});
  const ouvertes = d.prealertes.filter((p) => pa.OUVERTES.includes(p.statut));
  const m = q.match(/\bPA[\s-]?(\d{1,6})\b/i);
  const cible = m ? d.prealertes.filter((x) => x.numero === `PA-${m[1].padStart(6, '0')}`) : ouvertes;
  if (m && !cible.length) return local(T(L, `Aucune préalerte ${m[0].toUpperCase()} n’est visible pour vous.`, `No pre-alert ${m[0].toUpperCase()} is visible to you.`), 'suivi');
  if (/(urgences?|emergenc|civieres?|stretchers?|satur|deborde|overcrowd|capacit|proches?|nearby|disponib|availab)/.test(qn)) {
    const h = await pa.destinations(pool, u, {});
    if (!h.length) return local(T(L, 'Aucun hôpital de la région ne reçoit encore de préalertes par Arrimo.', 'No hospital in the region receives pre-alerts through Arrimo yet.'), 'disponibilites');
    const STAT = { fr: { ouvert: 'ouverte', capacite_limitee: 'capacité limitée', saturation: 'saturation déclarée', delestage: 'délestage déclaré' }, en: { ouvert: 'open', capacite_limitee: 'limited capacity', saturation: 'saturation declared', delestage: 'diversion declared' } };
    const decl = (x) => (x.statut_declare ? ` ; ${T(L, 'statut déclaré', 'declared status')} : ${STAT[lang(L)][x.statut_declare.statut]} (${x.statut_declare.perime ? T(L, `il y a ${x.statut_declare.age_min} min, donnée ancienne`, `${x.statut_declare.age_min} min ago, stale`) : T(L, `il y a ${x.statut_declare.age_min} min`, `${x.statut_declare.age_min} min ago`)})` : '');
    const lignes = h.map((x) => `• ${x.nom}${decl(x)} — ${x.urgence ? `${T(L, 'urgence', 'emergency')} ${NIVEAU[lang(L)][x.urgence.niveau] || x.urgence.niveau}, ${x.urgence.civieres_libres} ${T(L, x.urgence.civieres_libres > 1 ? 'civières libres' : 'civière libre', x.urgence.civieres_libres > 1 ? 'free stretchers' : 'free stretcher')}` : T(L, 'aucune donnée d’urgence', 'no emergency data')}`);
    return local(`${T(L, 'État déclaré dans Arrimo maintenant (une aide à la lecture, pas un choix de destination) :', 'Status declared in Arrimo now (a reading aid, not a destination choice):')}\n${lignes.join('\n')}`, 'disponibilites');
  }
  if (!cible.length) return local(T(L, 'Aucune préalerte en cours.', 'No pre-alert in progress.'), 'suivi');
  if (/(manqu|missing|incomplet|incomplete|complet)/.test(qn)) {
    const lignes = cible.map((p) => {
      const manque = [];
      if (!p.heure_prevue) manque.push(T(L, 'heure d’arrivée prévue', 'expected arrival time'));
      if (!p.equipage || !p.equipage.length) manque.push(T(L, 'équipage', 'crew'));
      if (!p.position) manque.push(T(L, 'position de l’unité (facultative)', 'unit position (optional)'));
      return `• ${p.numero} : ${manque.length ? `${T(L, 'à compléter', 'to complete')} — ${manque.join(', ')}` : T(L, 'rien ne manque', 'nothing missing')}`;
    });
    return local(lignes.join('\n'), 'informations_manquantes');
  }
  if (/(recu|reception|received|receipt|confirm|accus|acknowledg|pris en compte|vu|seen|consult)/.test(qn)) {
    const lignes = cible.map((p) => `• ${p.numero} → ${p.destination} : ${p.prise_en_compte_le ? T(L, `prise en compte confirmée par une personne à ${new Date(p.prise_en_compte_le).toLocaleTimeString(L === 'en' ? 'en-CA' : 'fr-CA', { hour: '2-digit', minute: '2-digit' })}`, 'acknowledged by a person')
      : p.consultee_le ? T(L, 'consultée, prise en compte pas encore confirmée', 'viewed, acknowledgement not yet confirmed')
        : p.recue_le ? T(L, 'reçue par l’écran de l’hôpital, personne ne l’a encore ouverte', 'received by the hospital screen, nobody has opened it yet')
          : T(L, 'réception non confirmée : prévenez l’hôpital par vos moyens habituels si nécessaire', 'receipt not confirmed: alert the hospital through your usual means if needed')}`);
    return local(lignes.join('\n'), 'reception');
  }
  const n = cible.length;
  return local(`${n > 1 ? T(L, `${n} préalertes en cours :`, `${n} pre-alerts in progress:`) : T(L, '1 préalerte en cours :', '1 pre-alert in progress:')}\n${cible.map((p) => `${ligne(L, p)} → ${p.destination}`).join('\n')}`, 'suivi');
}
module.exports = { repondre, repondreSecours, concerne };
