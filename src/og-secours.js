'use strict';
/**
 * OG dans le module hospitalier Liaison Secours : mêmes droits que l'interface (src/prealertes.js).
 * Réponses construites uniquement à partir des préalertes et de leurs étapes enregistrées : unité, entreprise, heure prévue,
 * priorité déclarée par l'équipe, dernière confirmation. OG ne décide ni de la destination, ni d'un service, ni d'une priorité.
 */
const pa = require('./prealertes');
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
module.exports = { repondre, concerne };
