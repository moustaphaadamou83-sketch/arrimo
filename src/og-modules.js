'use strict';
/**
 * OG dans les modules du chantier (cahier v2, « OG et Sillage ») : répond aux questions de chaque module à partir des mêmes fonctions
 * et des mêmes droits que l'interface ; propose, n'agit jamais. Rend null si la question ne relève d'aucun de ces modules.
 *   Urgences en direct (fermetures), Transferts (alertes, rapatriements), Transport non urgent, Bourse des places, Données (listes
 *   d'attente), Mode crise (évacuation). Le Chrono répond dans src/og-secours.js.
 */
const norm = (q) => String(q || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const T = (L, fr, en) => (L === 'en' ? en : fr);
const reponse = (texte, intention, ouvrir) => ({ mode: 'local', reponse: texte, sources: ['arrimo'], intentions: [intention], ...(ouvrir ? { ouvrir } : {}) });
const inactif = (L, e) => (e && e.code === 'module_desactive' ? T(L, 'Ce module n’est pas activé pour cet établissement.', 'This module is not enabled for this facility.') : null);
const heure = (L, d) => new Date(d).toLocaleString(L === 'en' ? 'en-CA' : 'fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const INTENTIONS = [
  ['crise', /\b(evacu\w*|mode crise|crisis)\b/],
  ['urgences_direct', /\b(fermetures?|fermee?s?|closures?|closed)\b.*\b(urgences?|emergenc\w*)\b|\b(urgences?|emergenc\w*)\b.*\b(fermetures?|fermee?s?|closures?|closed)\b/],
  ['rapatriement', /\b(rapatri\w*|repatri\w*|stable pour retour|stable for return)\b/],
  ['transferts_alertes', /\b(transferts?|transfers?)\b.*\b(bloque\w*|alertes?|en retard|blocked|alerts?|overdue)\b/],
  ['transport_planifie', /\b(transports?)\b.*\b(prevus?|planifies?|reserves?|non urgents?|planned|booked|non-urgent|demain|tomorrow)\b/],
  ['listes_attente', /\b(listes? d.?attente|waiting lists?|en attente d.?hebergement)\b/],
  ['bourse', /\b(bourse|placement exchange)\b/],
];

async function repondre(pool, u, etabId, question, langue) {
  const qn = norm(question); const intention = INTENTIONS.find(([, re]) => re.test(qn))?.[0];
  if (!intention) return null;
  const L = require('./og-localisation').langueDemandee(question, langue);
  try {
    if (intention === 'urgences_direct') {
      const v = await require('./urgences-direct').vueHopital(pool, u, etabId);
      const tous = [...v.fermetures, ...v.voisins];
      if (!tous.length) return reponse(T(L, 'Aucune fermeture d’urgence planifiée ou en cours, ici ni chez les urgences voisines.', 'No planned or ongoing emergency closure here or at nearby emergency departments.'), intention, 'secours');
      return reponse(tous.map((f) => `• ${f.hopital} · ${f.services.join(', ')} · ${heure(L, f.debut_le)} → ${heure(L, f.fin_prevue_le)} (${f.statut})`).join('\n'), intention, 'secours');
    }
    if (intention === 'transferts_alertes' || intention === 'rapatriement') {
      const ts = require('./transferts-suivi');
      const ids = (await pool.query("SELECT id FROM transferts WHERE (origine_id = $1 OR destination_id = $1) AND (statut NOT IN ('recu', 'refuse') OR stable_retour_le IS NOT NULL) ORDER BY date_demande DESC LIMIT 30", [etabId])).rows;
      const fiches = []; for (const { id } of ids) fiches.push(await ts.fiche(pool, u, id));
      if (intention === 'rapatriement') {
        const r = fiches.filter((f) => f.rapatriement?.statut === 'propose');
        return reponse(r.length ? r.map((f) => T(L, `• ${f.numero} : rapatriement proposé vers ${f.rapatriement.vers}, à confirmer par l’équipe`, `• ${f.numero}: repatriation proposed to ${f.rapatriement.vers}, to be confirmed by the team`)).join('\n')
          : T(L, 'Aucun rapatriement proposé en attente de décision.', 'No proposed repatriation awaiting a decision.'), intention, 'transferts');
      }
      const a = fiches.filter((f) => f.alertes.length);
      return reponse(a.length ? a.map((f) => `• ${f.numero} · ${f.origine} → ${f.destination} · ${f.alertes.map((x) => x.code.replaceAll('_', ' ')).join(', ')}`).join('\n')
        : T(L, 'Aucun transfert bloqué : chaque transfert en cours suit son échéance.', 'No blocked transfer: each ongoing transfer is on schedule.'), intention, 'transferts');
    }
    if (intention === 'transport_planifie') {
      const l = (await require('./transports').liste(pool, u, { etablissement_id: etabId })).filter((d) => d.motif_transport && ['demandee', 'acceptee', 'en_route', 'pris_en_charge'].includes(d.statut));
      return reponse(l.length ? l.map((d) => `• ${d.numero} · ${d.resident_ref} → ${d.destination} · ${heure(L, d.plage_confirmee_debut || d.plage_debut)} · ${d.statut}`).join('\n')
        : T(L, 'Aucun transport non urgent prévu.', 'No non-urgent transport planned.'), intention, 'transports-planifies');
    }
    if (intention === 'bourse') {
      const b = await require('./bourse').places(pool, u, { etablissement_id: etabId });
      const top = b.places.slice(0, 3);
      return reponse(top.length ? `${T(L, 'Les 3 premières places (besoins couverts et proximité ; aucun abonnement dans le calcul) :', 'Top 3 places (needs covered and proximity; no subscription in the calculation):')}\n${top.map((p) => `• ${p.nom} · ${p.libres} · ${p.distance_km ?? '—'} km · ${p.score}/100`).join('\n')}`
        : T(L, 'Aucune place libre ou à venir dans la bourse.', 'No free or upcoming place in the exchange.'), intention, 'bourse');
    }
    if (intention === 'listes_attente') {
      const d = await require('./donnees').tableau(pool, u, { etablissement_id: etabId });
      const n = (x) => (x && x.masque ? '< 5' : x);
      return reponse(d.listes_attente.length ? d.listes_attente.map((a) => `• ${a.genre} : ${n(a.personnes)} ${T(L, 'en attente', 'waiting')} · ${T(L, 'places libres', 'free places')} ${a.places_libres}`).join('\n')
        : T(L, 'Aucune personne en attente d’hébergement.', 'Nobody waiting for placement.'), intention, 'donnees');
    }
    if (intention === 'crise') {
      const l = await require('./crise').liste(pool, u, { etablissement_id: etabId });
      const a = l.find((x) => x.statut === 'active');
      if (!a) return reponse(T(L, 'Aucune évacuation en cours. Le déclenchement reste une décision humaine.', 'No evacuation in progress. Starting one remains a human decision.'), intention, 'crise');
      const v = await require('./crise').vue(pool, u, a.id);
      return reponse(T(L, `Évacuation ${a.numero} en cours : ${v.resume.total} résidents, ${v.resume.a_placer} à placer, ${v.resume.partis} en route, ${v.resume.arrives} arrivés.`,
        `Evacuation ${a.numero} in progress: ${v.resume.total} residents, ${v.resume.a_placer} to place, ${v.resume.partis} on the way, ${v.resume.arrives} arrived.`), intention, 'crise');
    }
  } catch (e) {
    // Module non activé : réponse explicite seulement si la question nomme le module ; sinon les autres réponses d'OG s'appliquent
    const explicite = /\b(bourse|placement exchange|evacu\w*|mode crise|crisis|listes? d.?attente|waiting lists?)\b/.test(qn);
    const m = inactif(L, e); if (m) return explicite ? reponse(m, intention) : null;
    if (e.statut === 403 || e.statut === 404) return null;
    throw e;
  }
  return null;
}
module.exports = { repondre, INTENTIONS };
