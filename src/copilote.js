/**
 * Copilote Arrimo.
 * - Briefing et recommandations : calculés localement, explicables, chacun avec une action proposée.
 * - Questions : réponses locales ; mode IA facultatif (COPILOTE_IA_CLE) qui ne reçoit jamais de référence patient.
 * Le Copilote ne fait rien seul : chaque action passe par un humain et par les mêmes règles que l'interface.
 */
const s = require('./services');
const t = require('./terrain');
const { exigerEtablissement } = require('./auth');
const { tr, dico, traducteurTypes, duree } = require('./langue');
const civ = require('./civieres');

/** Briefing de l'établissement : niveau d'alerte, résumé et recommandations classées, dans la langue de l'utilisateur. */
async function briefing(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const L = utilisateur.langue;
  const etab = await s.etablissement(pool, etabId);
  s.exigerActif(etab);
  const [alerte, reseau, file, nettoyage, nsa, transferts, lits, nomType, urgence] = await Promise.all([
    t.niveauAlerte(pool, etabId, L),
    s.capaciteReseau(pool, utilisateur, etabId),
    t.fileAdmission(pool, utilisateur, etabId),
    t.fileNettoyage(pool, utilisateur, etabId),
    t.listeNsa(pool, utilisateur, etabId),
    s.listeTransferts(pool, utilisateur, etabId),
    s.litsEtablissement(pool, utilisateur, etabId),
    traducteurTypes(pool, L),
    civ.listeCivieres(pool, utilisateur, etabId),
  ]);
  const cfg = etab.config;
  const moi = reseau.etablissements.find((e) => e.moi);
  const recos = [];
  const ajouter = (priorite, titre, raison, action = null) => recos.push({ priorite, titre, raison, action });
  const type = (nom) => nomType(nom).toLowerCase();

  // 1. Patients qui attendent un lit (chaque lit proposé ne l'est qu'à un seul patient)
  const litsProposes = new Set();
  for (const d of file.filter((x) => x.statut === 'attente')) {
    const urgent = d.priorite === 'p1' || d.depasse;
    if (d.lit_suggere && !litsProposes.has(d.lit_suggere.id)) {
      litsProposes.add(d.lit_suggere.id);
      ajouter(urgent ? 1 : 2, tr(L, 'r_assigner', { lit: d.lit_suggere.code, ref: d.patient_ref }),
        tr(L, 'r_assigner_raison', { type: type(d.type_nom), duree: duree(L, d.attente_min), prio: d.priorite.toUpperCase(), prov: dico(L, 'provenance')[d.provenance] }),
        { type: 'assigner', demande_id: d.id, lit_id: d.lit_suggere.id, version: d.lit_suggere.version, libelle: tr(L, 'r_assigner_action') });
    } else {
      const rec = await s.recommander(pool, utilisateur, etabId, d.type_id, t.besoinsDemande(d));
      const sug = rec.suggestions.find((x) => x.libres);
      const netType = nettoyage.find((n) => n.type_nom === d.type_nom && !litsProposes.has(n.id));
      if (netType) litsProposes.add(netType.id);
      if (netType) {
        ajouter(1, tr(L, 'r_nettoyer', { lit: netType.code }),
          tr(L, 'r_nettoyer_raison', { ref: d.patient_ref, type: type(d.type_nom), duree: duree(L, d.attente_min) }),
          netType.nettoyage_debut ? null : { type: 'debut_nettoyage', lit_id: netType.id, libelle: tr(L, 'r_nettoyer_action') });
      }
      if (sug && (urgent || !netType)) {
        ajouter(urgent ? 1 : 2, tr(L, 'r_transferer', { ref: d.patient_ref, etab: sug.nom }),
          tr(L, 'r_transferer_raison', { etab: sug.nom, raison: sug.raison, pourquoi: sug.pourquoi ? ` ${sug.pourquoi}.` : '' }),
          { type: 'transferer', demande_id: d.id, destination_id: sug.etablissement_id, lit_id: sug.lit?.id, version: sug.lit?.version,
            libelle: tr(L, 'r_transferer_action', { etab: sug.nom }) });
      } else if (!sug && !netType) {
        ajouter(1, tr(L, 'r_aucun', { ref: d.patient_ref }), tr(L, 'r_aucun_raison', { km: cfg.rayon_km }));
      }
    }
  }

  // 1 bis. Disponibilité à côté : alertes des 30 dernières minutes, encore valables, pour un patient qui attend ce type de lit
  const alertes = (await pool.query(
    `SELECT DISTINCT ON (n.vars->>'etab_id', n.vars->>'type_id') n.vars, n.date,
            (SELECT count(*)::int FROM lits l WHERE l.etablissement_id = (n.vars->>'etab_id')::int AND l.type_id = (n.vars->>'type_id')::int AND l.etat = 'libre') AS libres
       FROM notifications n WHERE n.etablissement_id = $1 AND n.code = 'dispo_lit' AND n.date > now() - interval '30 minutes'
      ORDER BY n.vars->>'etab_id', n.vars->>'type_id', n.date DESC`, [etabId])).rows;
  const dejaProposees = new Set(recos.filter((r) => r.action?.demande_id).map((r) => r.action.demande_id));
  for (const a of alertes.filter((x) => x.libres > 0)) {
    const d = file.find((x) => x.statut === 'attente' && x.type_id === Number(a.vars.type_id) && !x.lit_suggere && !dejaProposees.has(x.id));
    if (!d) continue;
    dejaProposees.add(d.id);
    ajouter(d.priorite === 'p1' || d.depasse ? 1 : 2, tr(L, 'r_dispo', { type: nomType(a.vars.type_nom), etab: a.vars.etab, km: a.vars.km }),
      tr(L, 'r_dispo_raison', { il_y_a: duree(L, (Date.now() - new Date(a.date)) / 60000), n: a.libres, ref: d.patient_ref, attente: duree(L, d.attente_min), route: duree(L, a.vars.min) }),
      { type: 'transferer', demande_id: d.id, destination_id: Number(a.vars.etab_id), libelle: tr(L, 'r_transferer_action', { etab: a.vars.etab }) });
  }

  // 2. Transferts qui attendent une réponse de notre part
  for (const tr0 of transferts) {
    if (tr0.statut === 'demande' && tr0.destination_id === etabId) {
      ajouter(tr0.urgent ? 1 : 2, tr(L, 'r_repondre', { numero: tr0.numero }),
        tr(L, 'r_repondre_raison', { origine: tr0.origine_nom, duree: duree(L, (Date.now() - new Date(tr0.date_demande)) / 60000),
          urgent: tr0.urgent ? tr(L, 'r_urgent') : '', lit: tr0.lit_code }),
        { type: 'transfert', transfert_id: tr0.id, etape: 'accepter', libelle: tr(L, 'r_repondre_action') });
    }
    // Le receveur ne crée aucun dossier : il prépare la chambre à partir de la référence, des besoins et de l'heure d'arrivée
    if (tr0.destination_id === etabId && ['validee', 'transport', 'en_route'].includes(tr0.statut) && !tr0.date_chambre_prete) {
      const besoins = Object.entries(tr0.besoins || {}).filter(([, v]) => v).map(([k]) => dico(L, 'besoin')[k]);
      const arrivee = tr0.arrivee_prevue
        ? tr(L, 'r_chambre_arrivee', { heure: s.heureLocale(L, tr0.arrivee_prevue, cfg.fuseau), duree: duree(L, (new Date(tr0.arrivee_prevue) - Date.now()) / 60000) })
        : tr(L, 'r_chambre_attente');
      ajouter(tr0.statut === 'en_route' ? 1 : 2, tr(L, 'r_chambre', { lit: tr0.lit_code, numero: tr0.numero }),
        tr(L, 'r_chambre_raison', { origine: tr0.origine_nom, ref: tr0.patient_ref, type: type(tr0.type_nom),
          besoins: besoins.length ? tr(L, 'r_chambre_besoins', { liste: besoins.join(', ') }) : '', arrivee }),
        { type: 'transfert', transfert_id: tr0.id, etape: 'chambre_prete', libelle: tr(L, 'r_chambre_action') });
    }
    if (tr0.statut === 'validee' && tr0.origine_id === etabId) {
      ajouter(2, tr(L, 'r_transport', { numero: tr0.numero }), tr(L, 'r_transport_raison', { dest: tr0.destination_nom }),
        { type: 'transfert', transfert_id: tr0.id, etape: 'transport', libelle: tr(L, 'r_transport_action') });
    }
  }

  // 3. Lits immobilisés sans raison
  for (const l of lits.filter((x) => x.blocage_niveau === 'eleve' && x.etat === 'reserve' && !x.transfert_numero)) {
    ajouter(2, tr(L, 'r_reservation', { lit: l.code }), l.blocage_motif,
      { type: 'lit', lit_id: l.id, action: 'annuler', version: l.version, libelle: tr(L, 'r_reservation_action') });
  }
  for (const n of nettoyage.filter((x) => x.genre === 'lit' && x.priorite !== 'haute' && Number(x.age_min) > 2 * x.nettoyage_cible_min)) {
    ajouter(2, tr(L, 'r_net_retard', { lit: n.code }), tr(L, 'r_net_retard_raison', { duree: duree(L, Number(n.age_min)), cible: duree(L, n.nettoyage_cible_min) }),
      { type: 'lit', lit_id: n.id, action: 'nettoyage_ok', version: n.version, libelle: tr(L, 'r_net_retard_action') });
  }

  // 4. Congés des 12 prochaines heures : les confirmer tôt permet de planifier nettoyage et admissions
  const finJour = new Date(Date.now() + 12 * 3600000);
  const congesJour = lits.filter((l) => l.etat === 'occupe' && l.sortie_prevue && new Date(l.sortie_prevue) <= finJour
    && new Date(l.sortie_prevue) >= Date.now() - 3600000 && l.conge_statut !== 'confirme' && !l.nsa_depuis);
  for (const l of congesJour.slice(0, 6)) {
    const heure = new Date(l.sortie_prevue).toLocaleTimeString(dico(L, 'locale'), { hour: '2-digit', minute: '2-digit', timeZone: cfg.fuseau });
    ajouter(3, tr(L, 'r_conge', { lit: l.code }), tr(L, 'r_conge_raison', { heure }),
      { type: 'conge', lit_id: l.id, statut: 'confirme', libelle: tr(L, 'r_conge_action') });
  }
  const depasses = lits.filter((l) => l.etat === 'occupe' && l.blocage_code === 'conge_depasse');
  if (depasses.length) {
    ajouter(2, tr(L, 'r_depasses', { n: depasses.length }), tr(L, 'r_depasses_raison', { n: depasses.length, lits: depasses.map((l) => l.code).join(', ') }));
  }

  // 4 bis. Urgence : patients sur civière
  const u = urgence.stats;
  if (u) {
    const occupees = urgence.civieres.filter((c) => c.etat === 'occupee');
    // Patients en corridor alors qu'une civière régulière est libre, ou en nettoyage
    const corridor = occupees.filter((c) => c.categorie === 'debordement').sort((a, b) => b.heures - a.heures);
    const libresReg = urgence.civieres.filter((c) => c.categorie === 'reguliere' && c.etat === 'libre');
    corridor.slice(0, libresReg.length).forEach((c, i) => {
      ajouter(2, tr(L, 'r_civ_deplacer', { ref: c.patient_ref, code: libresReg[i].code }),
        tr(L, 'r_civ_deplacer_raison', { de: c.code, duree: duree(L, c.heures * 60), code: libresReg[i].code }),
        { type: 'deplacer', civiere_id: c.id, vers_id: libresReg[i].id, version: libresReg[i].version, libelle: tr(L, 'r_civ_deplacer_action') });
    });
    const enAttenteCorridor = corridor.length - libresReg.length;
    if (enAttenteCorridor > 0) {
      for (const c of nettoyage.filter((x) => x.genre === 'civiere' && x.categorie === 'reguliere').slice(0, enAttenteCorridor)) {
        ajouter(2, tr(L, 'r_civ_nettoyer', { code: c.code }), tr(L, 'r_civ_nettoyer_raison', { n: enAttenteCorridor }),
          { type: 'civiere', civiere_id: c.id, action: 'nettoyage_ok', version: c.version, libelle: tr(L, 'r_civ_nettoyer_action') });
      }
    }
    // Patients sur civière depuis longtemps sans demande de lit
    for (const c of occupees.filter((x) => !x.demande_id && x.heures >= 12).sort((a, b) => b.heures - a.heures).slice(0, 5)) {
      ajouter(c.heures >= 24 ? 1 : 2, tr(L, 'r_civ_demande', { ref: c.patient_ref }), tr(L, 'r_civ_demande_raison', { code: c.code, duree: duree(L, c.heures * 60) }),
        { type: 'aller', vue: 'urgence', libelle: tr(L, 'r_civ_demande_action') });
    }
    if (['orange', 'rouge'].includes(alerte.urgence?.niveau)) {
      ajouter(alerte.urgence.niveau === 'rouge' ? 1 : 2, tr(L, 'r_urgence', { taux: u.taux, occ: u.occupees, fonc: u.fonctionnelles }),
        tr(L, 'r_urgence_raison', { h24: u.plus_24h, h48: u.plus_48h }));
    }
  }

  // 5. NSA
  if (nsa.total && nsa.taux > nsa.cible) {
    const longs = nsa.lits.filter((l) => l.jours >= 30);
    ajouter(2, tr(L, 'r_nsa', { taux: nsa.taux, cible: nsa.cible }),
      tr(L, 'r_nsa_raison', { n: nsa.total, longs: longs.length ? tr(L, 'r_nsa_longs', { n: longs.length }) : '',
        orient: Object.entries(nsa.par_orientation).map(([k, v]) => `${dico(L, 'orientation')[k] || k} ${v}`).join(', ') }));
  }

  // 6. Prévision de saturation et capacité perdue
  for (const u of moi.unites.filter((x) => x.risque === 'eleve')) {
    const rec = await s.recommander(pool, utilisateur, etabId, u.type_id);
    const sug = rec.suggestions.find((x) => x.libres);
    ajouter(2, tr(L, 'r_sature', { type: nomType(u.type_nom), h: cfg.horizon_h }),
      sug ? tr(L, 'r_sature_option', { etab: sug.nom, raison: sug.raison }) : tr(L, 'r_sature_aucun'));
  }
  if (alerte.fermes_personnel) {
    ajouter(3, tr(L, 'r_fermes', { n: alerte.fermes_personnel }), tr(L, 'r_fermes_raison'));
  }

  recos.sort((a, b) => a.priorite - b.priorite);
  const prevus = moi.unites.reduce((a, u) => a + (u.prevus || 0), 0);
  const libres = moi.unites.reduce((a, u) => a + u.libres, 0);
  const enAttente = file.filter((d) => d.statut === 'attente').length;
  const resume = tr(L, 'resume', { niveau: dico(L, L === 'en' ? 'niveau_maj' : 'niveau')[alerte.niveau], p: alerte.pression, libres, prevus,
    h: cfg.horizon_h, attente: enAttente, net: nettoyage.length, nsa: nsa.total, taux: nsa.taux,
    longue: alerte.attente_longue ? tr(L, 'resume_longue', { n: alerte.attente_longue, h: Math.round(cfg.attente_admission_max_min / 60) }) : '' })
    + (u ? tr(L, 'resume_urgence', { occ: u.occupees, fonc: u.fonctionnelles, taux: u.taux, h24: u.plus_24h }) : '');
  return { etablissement: etab.nom, genere_le: new Date().toISOString(), alerte, resume, recommandations: recos };
}

/** Vue réseau : où ça déborde, où il reste de la place, et quels délestages proposer. */
async function briefingReseau(pool, utilisateur, depuisId) {
  const L = utilisateur.langue;
  const reseau = await s.capaciteReseau(pool, utilisateur, depuisId);
  const nomType = await traducteurTypes(pool, L);
  const etabs = [];
  for (const e of reseau.etablissements) {
    etabs.push({ ...e, alerte: await t.niveauAlerte(pool, e.id, L) });
  }
  const tension = etabs.filter((e) => ['orange', 'rouge'].includes(e.alerte.niveau));
  const delestages = [];
  for (const e of tension) {
    for (const u of e.unites.filter((x) => x.risque === 'eleve' || x.libres === 0)) {
      const cible = etabs.filter((x) => x.id !== e.id && ['vert', 'jaune'].includes(x.alerte.niveau))
        .map((x) => ({ x, u2: x.unites.find((v) => v.type_id === u.type_id) }))
        .filter(({ u2 }) => u2 && u2.libres > 0)
        .sort((a, b) => a.x.distance_km - b.x.distance_km || b.u2.libres - a.u2.libres)[0];
      if (cible) {
        delestages.push({ de: e.nom, vers: cible.x.nom, type: nomType(u.type_nom), libres_cible: cible.u2.libres,
          raison: tr(L, 'delestage', { de: e.nom, niveau: dico(L, 'niveau')[e.alerte.niveau], vers: cible.x.nom, n: cible.u2.libres,
            type: nomType(u.type_nom).toLowerCase() }) });
      }
    }
  }
  return {
    etablissements: etabs.map((e) => ({ id: e.id, nom: e.nom, ville: e.ville, moi: e.moi, partage: e.partage, distance_km: e.distance_km,
      niveau: e.alerte.niveau, pression: e.alerte.pression, libres: e.unites.reduce((a, u) => a + u.libres, 0),
      en_attente: e.moi || e.partage === 'complet' ? e.alerte.en_attente : null, urgence: e.urgence })),
    delestages,
  };
}

/* ------------------------------------------------------------------ questions */
function sansPatients(objet) {
  return JSON.parse(JSON.stringify(objet, (k, v) => {
    if (k === 'patient_ref') return undefined;
    if (typeof v === 'string') return v.replace(/P-\d{5}/g, '[patient]');
    return v;
  }));
}

async function questionIa(contexte, question, fetchImpl = fetch, langue = 'fr') {
  const cle = process.env.COPILOTE_IA_CLE;
  const r = await fetchImpl(process.env.COPILOTE_IA_URL || 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cle, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.COPILOTE_IA_MODELE || 'claude-sonnet-5-5',
      max_tokens: 700,
      system: `Tu es le Copilote d’Arrimo, outil de gestion des lits et des transferts entre hôpitaux. ${tr(langue, 'ia_langue')}, `
        + 'brièvement, uniquement à partir des données fournies. Si l’information manque, dis-le. Ne donne jamais d’avis médical. '
        + 'Tu ne peux exécuter aucune action : propose, et rappelle que l’utilisateur valide dans Arrimo.',
      messages: [{ role: 'user', content: `Données actuelles (JSON) :\n${JSON.stringify(contexte)}\n\nQuestion : ${question}` }],
    }),
  });
  if (!r.ok) throw new Error(`IA indisponible (${r.status})`);
  const data = await r.json();
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

async function question(pool, utilisateur, etabId, q, fetchImpl) {
  const L = utilisateur.langue;
  const qn = String(q).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (process.env.COPILOTE_IA_CLE) {
    try {
      const [b, r] = await Promise.all([briefing(pool, utilisateur, etabId), briefingReseau(pool, utilisateur, etabId)]);
      const texte = await questionIa(sansPatients({ briefing: b, reseau: r }), q, fetchImpl, L);
      if (texte) return { reponse: texte, mode: 'ia' };
    } catch (e) {
      console.error('Copilote IA :', e.message);   // repli sur le mode local
    }
  }
  const orient = dico(L, 'orientation');
  if (/(nsa|hebergement|chsld|\balc\b|placement|long-term)/.test(qn)) {
    const n = await t.listeNsa(pool, utilisateur, etabId);
    return { mode: 'local', reponse: `${tr(L, 'q_nsa', { n: n.total, taux: n.taux, cible: n.cible, jl: n.jours_lits })}\n`
      + Object.entries(n.par_orientation).map(([k, v]) => tr(L, 'q_ligne', { a: orient[k] || k, b: v })).join('\n') };
  }
  if (/(civiere|brancard|stretcher|gurney|corridor|hallway|24 ?h|48 ?h)/.test(qn)) {
    const nomType = await traducteurTypes(pool, L);
    const { civieres, stats } = await civ.listeCivieres(pool, utilisateur, etabId);
    const etab = await s.etablissement(pool, etabId);
    if (!stats) return { mode: 'local', reponse: tr(L, 'q_civieres_vide', { etab: etab.nom }) };
    const seuil = /48/.test(qn) ? 48 : /24/.test(qn) ? 24 : 0;
    const liste = civieres.filter((c) => c.etat === 'occupee' && c.heures >= seuil).sort((a, b) => b.heures - a.heures);
    return { mode: 'local', reponse: `${tr(L, 'q_civieres', { etab: etab.nom, occ: stats.occupees, fonc: stats.fonctionnelles, taux: stats.taux,
      corridor: stats.en_corridor, h24: stats.plus_24h, h48: stats.plus_48h, duree: duree(L, (stats.duree_moy_h ?? 0) * 60) })}\n${liste.slice(0, 12).map((c) => tr(L, 'q_civieres_ligne',
      { ref: c.patient_ref, code: c.code, duree: duree(L, c.heures * 60),
        demande: c.demande_id ? tr(L, 'q_civieres_demande', { type: nomType(c.type_nom).toLowerCase() }) : tr(L, 'q_civieres_sans_demande') })).join('\n')}`.trim() };
  }
  if (/(attente|admission|urgence|waiting|emergency|\ber\b)/.test(qn)) {
    const nomType = await traducteurTypes(pool, L);
    const f = (await t.fileAdmission(pool, utilisateur, etabId)).filter((d) => d.statut === 'attente');
    return { mode: 'local', reponse: f.length ? `${tr(L, 'q_attente', { n: f.length })}\n${f.map((d) => tr(L, 'q_attente_ligne',
      { ref: d.patient_ref, type: nomType(d.type_nom), prio: d.priorite.toUpperCase(), duree: duree(L, d.attente_min) })
      + (d.lit_suggere ? tr(L, 'q_attente_lit', { lit: d.lit_suggere.code }) : tr(L, 'q_attente_aucun_lit'))).join('\n')}` : tr(L, 'q_attente_vide') };
  }
  if (/(nettoy|menage|entretien|clean|housekeep)/.test(qn)) {
    const n = await t.fileNettoyage(pool, utilisateur, etabId);
    return { mode: 'local', reponse: n.length ? `${tr(L, 'q_nettoyage')}\n${n.map((x, i) => `${i + 1}. ${x.code} · ${x.raison}`).join('\n')}` : tr(L, 'q_nettoyage_vide') };
  }
  if (/(alerte|niveau|deborde|saturation|surcapacite|reseau|alert|level|overflow|overcapacity|network)/.test(qn)) {
    const r = await briefingReseau(pool, utilisateur, etabId);
    const niv = dico(L, 'niveau');
    return { mode: 'local', reponse: r.etablissements.map((e) => tr(L, 'q_reseau_ligne', { nom: e.nom, niveau: niv[e.niveau], p: e.pression, libres: e.libres })
      + (e.urgence ? tr(L, 'q_reseau_urgence', { taux: e.urgence.taux }) : '')).join('\n')
      + (r.delestages.length ? `\n${tr(L, 'q_delestages')}\n${r.delestages.map((d) => `• ${d.de} → ${d.vers} (${d.type})`).join('\n')}` : '') };
  }
  if (/(quoi faire|priorit|recommand|briefing|resume|situation|what should|first|summary)/.test(qn)) {
    const b = await briefing(pool, utilisateur, etabId);
    return { mode: 'local', reponse: `${b.resume}\n${b.recommandations.slice(0, 5).map((r, i) => `${i + 1}. ${r.titre}`).join('\n')}` };
  }
  return { mode: 'local', reponse: await s.assistant(pool, utilisateur, etabId, q) };
}

module.exports = { briefing, briefingReseau, question, sansPatients, questionIa };
