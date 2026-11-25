'use strict';
/**
 * Plan de coordination d'OG (chantier coordination, lot 3 « Solutions », 26 nov. 2026 ; cahier final §13, cahier nº 2 §3-4,
 * cahier « optimisation transversale » §13). Pour chaque groupe de blocages détectés par Vigilance, une fiche en 7 points :
 *   1 situation observée · 2 données utilisées (source, heure) · 3 contraintes applicables · 4 actions possibles ·
 *   5 acteurs concernés · 6 incertitudes · 7 validations humaines nécessaires.
 * Une synthèse anticipative réunit capacité réelle, sorties prévues, nettoyages, ambulances annoncées, transports et placements.
 * OG n'invente ni disponibilité, ni quota, ni cause, ni règle clinique ; une prévision n'est jamais une capacité ; rien n'est exécuté.
 * Quand les données sont insuffisantes (contrôle périodique en retard, connecteur silencieux), il le dit.
 */
const vig = require('./vigilance');

const L = (en, fr, eng) => (en ? eng : fr);

/** Contraintes et validations par type de blocage (textes fixes, bilingues). */
const REGLES = {
  ambulance_immobilisee: {
    contraintes: ['Une urgence clinique suit les protocoles médicaux, indépendamment du chronomètre.', 'Clinical emergencies follow medical protocols regardless of the timer.'],
    validation: ['Le transfert de responsabilité est confirmé par l’équipe de l’urgence (H14).', 'The handover is confirmed by the emergency team (H14).'],
  },
  ambulances_attendues: {
    contraintes: ['La destination reste décidée par le CCS ; Arrimo ne redirige aucune ambulance.', 'The destination remains the dispatch centre’s decision; Arrimo redirects no ambulance.'],
    validation: ['Le responsable de l’urgence confirme les civières réellement prêtes.', 'The emergency lead confirms the stretchers actually ready.'],
  },
  transport_en_retard: {
    contraintes: ['Seuls des transporteurs autorisés de la région peuvent être sollicités ; aucun n’est engagé automatiquement.', 'Only authorized carriers in the region can be asked; none is engaged automatically.'],
    validation: ['L’établissement d’origine choisit de reprogrammer ou de solliciter un autre transporteur.', 'The originating facility decides to reschedule or ask another carrier.'],
  },
  transport_non_confirme: {
    contraintes: ['Une demande non acceptée n’est pas un transport planifié.', 'An unaccepted request is not a scheduled transport.'],
    validation: ['Le transporteur accepte ou refuse la demande.', 'The carrier accepts or refuses the request.'],
  },
  placement_non_realise: {
    contraintes: ['Aucune décision de placement n’est automatisée ; la date de départ est confirmée par les équipes.', 'No placement decision is automated; the departure date is confirmed by the teams.'],
    validation: ['La coordination des sorties confirme l’obstacle et la nouvelle date.', 'Discharge coordination confirms the obstacle and the new date.'],
  },
  transfert_sans_reponse: {
    contraintes: ['Seul l’établissement d’accueil accepte ou refuse un transfert.', 'Only the receiving facility accepts or refuses a transfer.'],
    validation: ['La coordination choisit de relancer ou d’explorer une solution de rechange.', 'Coordination decides to follow up or explore an alternative.'],
  },
  connecteur_silencieux: {
    contraintes: ['Une disponibilité non confirmée ne doit pas être tenue pour certaine.', 'Unconfirmed availability must not be treated as certain.'],
    validation: ['L’équipe informatique confirme le rétablissement de la liaison.', 'The IT team confirms the link is restored.'],
  },
  quote_part_contradiction: {
    contraintes: ['Une quote-part ne remplace ni un critère clinique ni la décision du répartiteur ; aucune marge n’est calculée.', 'A quota replaces neither a clinical criterion nor the dispatcher’s decision; no margin is calculated.'],
    validation: ['Le CCS décide de la destination en connaissant les deux informations.', 'The dispatch centre decides the destination knowing both pieces of information.'],
  },
  _defaut: {
    contraintes: ['Rien n’est libéré, annulé ni réservé automatiquement.', 'Nothing is freed, cancelled or reserved automatically.'],
    validation: ['Une personne habilitée décide et enregistre l’action.', 'An authorized person decides and records the action.'],
  },
};
const SOURCES = {
  ambulance_immobilisee: ['Chrono (heures H11 à H14)', 'Chrono (times H11 to H14)'],
  ambulances_attendues: ['Préalertes de Liaison Secours, état des civières', 'Liaison Secours pre-alerts, stretcher status'],
  transport_en_retard: ['Demandes de transport', 'Transport requests'],
  transport_non_confirme: ['Demandes de transport', 'Transport requests'],
  placement_non_realise: ['Liaison CHSLD (demandes d’hébergement)', 'Liaison CHSLD (housing requests)'],
  transfert_sans_reponse: ['Transferts', 'Transfers'],
  connecteur_silencieux: ['Arrimo Connect (messages reçus)', 'Arrimo Connect (received messages)'],
  quote_part_contradiction: ['Quotes-parts saisies, préalertes, civières', 'Entered quotas, pre-alerts, stretchers'],
  _defaut: ['Lits, civières, demandes d’admission et journal', 'Beds, stretchers, admission requests and log'],
};

/** Transporteurs autorisés de la même région que le transporteur en retard, avec leurs unités déclarées disponibles. */
async function alternativesTransport(pool, transportIds) {
  if (!transportIds.length) return new Map();
  const rows = (await pool.query(`SELECT d.id AS transport_id, o2.nom, count(un.id) FILTER (WHERE ev.etat = 'disponible')::int AS disponibles
      FROM demandes_transport d JOIN organisations_secours o ON o.id = d.organisation_id
      JOIN organisations_secours o2 ON o2.config_id = o.config_id AND o2.id <> o.id AND o2.actif AND 'ambulance' = ANY(o2.profils)
      LEFT JOIN unites_secours un ON un.organisation_id = o2.id AND un.actif LEFT JOIN etats_vehicules ev ON ev.unite_id = un.id
     WHERE d.id = ANY($1) GROUP BY d.id, o2.id, o2.nom ORDER BY disponibles DESC, o2.nom`, [transportIds])).rows;
  const m = new Map();
  for (const r of rows) { if (!m.has(r.transport_id)) m.set(r.transport_id, []); m.get(r.transport_id).push({ nom: r.nom, unites_disponibles: r.disponibles }); }
  return m;
}

async function plan(pool, u, etabId) {
  const en = u.langue === 'en';
  const v = await vig.blocages(pool, u, etabId);   // contrôle d'accès et traduction inclus
  const lues = v.donnees_lues_le;
  const controleRetard = Boolean(v.controle_periodique?.en_retard);
  const silencieux = v.alertes.filter((a) => a.type === 'connecteur_silencieux');
  const groupes = new Map();
  for (const a of v.alertes) { if (!groupes.has(a.type)) groupes.set(a.type, []); groupes.get(a.type).push(a); }
  const alt = await alternativesTransport(pool, (groupes.get('transport_en_retard') || []).map((a) => a.ressource_id));
  const rang = { eleve: 0, modere: 1, faible: 2 };
  const fiches = [...groupes.entries()].map(([type, as]) => {
    const r = REGLES[type] || REGLES._defaut; const src = SOURCES[type] || SOURCES._defaut;
    const niveau = as.reduce((m, a) => (rang[a.niveau] < rang[m] ? a.niveau : m), 'faible');
    const actions = [...new Set(as.map((a) => a.action))];
    if (type === 'transport_en_retard') {
      for (const a of as) {
        const x = alt.get(a.ressource_id) || [];
        actions.push(x.length
          ? L(en, `Solutions de rechange autorisées pour ${a.ressource} : ${x.map((o) => `${o.nom} (${o.unites_disponibles} unité(s) déclarée(s) disponible(s))`).join(', ')}.`,
            `Authorized alternatives for ${a.ressource}: ${x.map((o) => `${o.nom} (${o.unites_disponibles} unit(s) reported available)`).join(', ')}.`)
          : L(en, `Aucun autre transporteur autorisé connu dans la région pour ${a.ressource}.`, `No other authorized carrier known in the region for ${a.ressource}.`));
      }
    }
    const hypotheses = as.filter((a) => a.cause?.nature === 'hypothese').length;
    return {
      type, niveau, nombre: as.length,
      situation: as.slice(0, 5).map((a) => a.titre),
      donnees: { sources: [L(en, src[0], src[1])], lues_le: lues, objets: as.map((a) => a.objet || { genre: a.genre, id: a.ressource_id, ressource: a.ressource }) },
      contraintes: [L(en, r.contraintes[0], r.contraintes[1]), ...[...new Set(as.map((a) => a.seuil?.regle).filter(Boolean))]],
      actions,
      acteurs: [...new Set(as.map((a) => a.suivi?.responsable_role || null).filter(Boolean))].map((role) => ({ role, source: 'suivi' }))
        .concat([...new Set(as.map((a) => a.responsable))].map((nom) => ({ nom, source: 'grille_proposee' }))),
      incertitudes: [
        ...(hypotheses ? [L(en, `${hypotheses} cause(s) non documentée(s) : hypothèse à vérifier, jamais un fait.`, `${hypotheses} undocumented cause(s): hypothesis to check, never a fact.`)] : []),
        ...(silencieux.length && type !== 'connecteur_silencieux' ? [L(en, 'Un connecteur est silencieux : certaines données peuvent être périmées.', 'A connector is silent: some data may be outdated.')] : []),
        ...(controleRetard ? [L(en, 'Le contrôle périodique est en retard.', 'The periodic check is late.')] : []),
      ],
      validations: [L(en, r.validation[0], r.validation[1]), L(en, 'OG propose ; aucune action n’est exécutée sans décision humaine.', 'OG proposes; no action is carried out without a human decision.')],
      suivis: as.map((a) => a.suivi).filter(Boolean).map((s) => ({ id: s.id, statut: s.statut, responsable_role: s.responsable_role, echeance: s.echeance })),
    };
  }).sort((a, b) => rang[a.niveau] - rang[b.niveau] || b.nombre - a.nombre);

  // Synthèse anticipative : confirmé, prévisionnel et inconnu séparés ; aucune prévision présentée comme une capacité
  const c = v.capacite;
  const transportsBloquants = (groupes.get('transport_en_retard') || []).length + (groupes.get('transport_non_confirme') || []).length;
  const placementsBloques = (groupes.get('placement_non_realise') || []).length;
  const saturation = c.lits.operationnels === 0 || (c.ambulances_attendues > 0 && c.ambulances_attendues > c.civieres.libres);
  const donneesInsuffisantes = controleRetard || silencieux.length > 0;
  const synthese = {
    risque_saturation: saturation,
    confirme: { lits_operationnels: c.lits.operationnels, civieres_libres: c.civieres.libres },
    previsionnel: { sorties_prevues_24h: c.lits.sorties_prevues_24h, lits_en_nettoyage: c.lits.nettoyage,
      note: L(en, 'Peuvent se libérer après départ réel, nettoyage et confirmation : ce ne sont pas des lits disponibles.', 'May become free after actual departure, cleaning and confirmation: these are not available beds.') },
    inconnu: { lits_vides_non_confirmes: c.lits.non_confirmes },
    demande: { ambulances_annoncees: c.ambulances_attendues, transports_bloquants: transportsBloquants, placements_bloques: placementsBloques },
    texte: saturation
      ? L(en, `Risque de saturation : ${c.lits.operationnels} lit(s) opérationnel(s), ${c.civieres.libres} civière(s) libre(s) pour ${c.ambulances_attendues} ambulance(s) annoncée(s). ${placementsBloques} placement(s) accepté(s) bloqué(s) et ${transportsBloquants} transport(s) non confirmé(s) ou en retard. ${c.lits.sorties_prevues_24h} sortie(s) prévue(s) et ${c.lits.nettoyage} nettoyage(s) pourraient libérer des lits après validation.`,
        `Saturation risk: ${c.lits.operationnels} operational bed(s), ${c.civieres.libres} free stretcher(s) for ${c.ambulances_attendues} announced ambulance(s). ${placementsBloques} accepted placement(s) blocked and ${transportsBloquants} transport(s) unconfirmed or late. ${c.lits.sorties_prevues_24h} planned discharge(s) and ${c.lits.nettoyage} cleaning(s) could free beds after validation.`)
      : L(en, `Pas de risque de saturation établi : ${c.lits.operationnels} lit(s) opérationnel(s), ${c.civieres.libres} civière(s) libre(s).`, `No established saturation risk: ${c.lits.operationnels} operational bed(s), ${c.civieres.libres} free stretcher(s).`),
    donnees_insuffisantes: donneesInsuffisantes,
    limite: donneesInsuffisantes ? L(en, 'Recommandation limitée : données possiblement périmées (connecteur silencieux ou contrôle en retard). Confirmer sur place avant d’agir.',
      'Limited recommendation: data possibly outdated (silent connector or late check). Confirm on site before acting.') : null,
  };
  return { etablissement: v.etablissement, lues_le: lues, synthese, fiches,
    regle: L(en, 'OG propose, un humain décide. Une recommandation n’est jamais une action exécutée.', 'OG proposes, a human decides. A recommendation is never an action carried out.') };
}

/** Réponse courte d'OG à « que faire ? », « pourquoi saturé ? », « plan de coordination » (même source que l'écran). */
async function repondre(pool, u, etabId) {
  const p = await plan(pool, u, etabId); const en = u.langue === 'en';
  const lignes = [p.synthese.texte, ...(p.synthese.limite ? [p.synthese.limite] : []),
    ...p.fiches.slice(0, 3).map((f, i) => `${i + 1}. ${f.situation[0]} → ${f.actions[0]}`), p.regle];
  return { texte: lignes.join('\n'), sources: [en ? 'Vigilance, coordination plan' : 'Vigilance, plan de coordination'], plan: p };
}

module.exports = { plan, repondre };
