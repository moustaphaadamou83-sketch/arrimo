/**
 * Copilote Arrimo.
 * - Briefing et recommandations : calculés localement, explicables, chacun avec une action proposée.
 * - Questions : réponses locales ; mode IA facultatif (COPILOTE_IA_CLE) qui ne reçoit jamais de référence patient.
 * Le Copilote ne fait rien seul : chaque action passe par un humain et par les mêmes règles que l'interface.
 */
const s = require('./services');
const t = require('./terrain');
const { exigerEtablissement } = require('./auth');

const NIVEAUX = { vert: 'Vert', jaune: 'Jaune', orange: 'Orange', rouge: 'Rouge' };

async function briefing(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const etab = await s.etablissement(pool, etabId);
  s.exigerActif(etab);
  const [alerte, reseau, file, nettoyage, nsa, transferts, lits] = await Promise.all([
    t.niveauAlerte(pool, etabId),
    s.capaciteReseau(pool, utilisateur, etabId),
    t.fileAdmission(pool, utilisateur, etabId),
    t.fileNettoyage(pool, utilisateur, etabId),
    t.listeNsa(pool, utilisateur, etabId),
    s.listeTransferts(pool, utilisateur, etabId),
    s.litsEtablissement(pool, utilisateur, etabId),
  ]);
  const cfg = etab.config;
  const moi = reseau.etablissements.find((e) => e.moi);
  const recos = [];
  const ajouter = (priorite, titre, raison, action = null) => recos.push({ priorite, titre, raison, action });

  // 1. Patients qui attendent un lit (chaque lit proposé ne l'est qu'à un seul patient)
  const litsProposes = new Set();
  for (const d of file.filter((x) => x.statut === 'attente')) {
    const urgent = d.priorite === 'p1' || d.depasse;
    if (d.lit_suggere && !litsProposes.has(d.lit_suggere.id)) {
      litsProposes.add(d.lit_suggere.id);
      ajouter(urgent ? 1 : 2, `Assigner le lit ${d.lit_suggere.code} à ${d.patient_ref}`,
        `Attend un lit en ${d.type_nom.toLowerCase()} depuis ${d.attente_min} min (${d.priorite.toUpperCase()}, ${d.provenance}). Ce lit libre respecte ses besoins.`,
        { type: 'assigner', demande_id: d.id, lit_id: d.lit_suggere.id, version: d.lit_suggere.version, libelle: 'Assigner ce lit' });
    } else {
      const rec = await s.recommander(pool, utilisateur, etabId, d.type_id, t.besoinsDemande(d));
      const sug = rec.suggestions.find((x) => x.libres);
      const netType = nettoyage.find((n) => n.type_nom === d.type_nom && !litsProposes.has(n.id));
      if (netType) litsProposes.add(netType.id);
      if (netType) {
        ajouter(1, `Prioriser le nettoyage du lit ${netType.code}`,
          `${d.patient_ref} attend un lit en ${d.type_nom.toLowerCase()} depuis ${d.attente_min} min et aucun lit adapté n’est libre. Ce lit sera le premier disponible.`,
          netType.nettoyage_debut ? null : { type: 'debut_nettoyage', lit_id: netType.id, libelle: 'Lancer le nettoyage' });
      }
      if (sug && (urgent || !netType)) {
        ajouter(urgent ? 1 : 2, `Transférer ${d.patient_ref} vers ${sug.nom}`,
          `Aucun lit adapté ici. ${sug.nom} : ${sug.raison}.${sug.pourquoi ? ` ${sug.pourquoi}.` : ''}`,
          { type: 'transferer', demande_id: d.id, destination_id: sug.etablissement_id, lit_id: sug.lit?.id, version: sug.lit?.version,
            libelle: `Demander le transfert à ${sug.nom}` });
      } else if (!sug && !netType) {
        ajouter(1, `Aucun lit pour ${d.patient_ref}`, `Aucun lit adapté ici ni dans le rayon de ${cfg.rayon_km} km. Escaladez à la coordination régionale.`);
      }
    }
  }

  // 2. Transferts qui attendent une réponse de notre part
  for (const tr of transferts) {
    if (tr.statut === 'demande' && tr.destination_id === etabId) {
      ajouter(tr.urgent ? 1 : 2, `Répondre à la demande ${tr.numero}`,
        `${tr.origine_nom} attend votre réponse depuis ${Math.round((Date.now() - new Date(tr.date_demande)) / 60000)} min${tr.urgent ? ' (urgent)' : ''}. Lit ${tr.lit_code} déjà bloqué pour ce patient.`,
        { type: 'transfert', transfert_id: tr.id, etape: 'accepter', libelle: 'Accepter' });
    }
    if (tr.statut === 'validee' && tr.origine_id === etabId) {
      ajouter(2, `Organiser le transport de ${tr.numero}`, `${tr.destination_nom} a accepté. Le lit est réservé.`,
        { type: 'transfert', transfert_id: tr.id, etape: 'transport', libelle: 'Organiser le transport' });
    }
  }

  // 3. Lits immobilisés sans raison
  for (const l of lits.filter((x) => x.blocage_niveau === 'eleve' && x.etat === 'reserve' && !x.transfert_numero)) {
    ajouter(2, `Libérer la réservation du lit ${l.code}`, l.blocage_motif,
      { type: 'lit', lit_id: l.id, action: 'annuler', version: l.version, libelle: 'Annuler la réservation' });
  }
  for (const n of nettoyage.filter((x) => x.priorite !== 'haute' && Number(x.age_min) > 2 * x.nettoyage_cible_min)) {
    ajouter(2, `Nettoyage en retard : ${n.code}`, `En attente depuis ${Math.round(Number(n.age_min))} min (cible ${n.nettoyage_cible_min} min).`,
      { type: 'lit', lit_id: n.id, action: 'nettoyage_ok', version: n.version, libelle: 'Confirmer le nettoyage' });
  }

  // 4. Congés des 12 prochaines heures : les confirmer tôt permet de planifier nettoyage et admissions
  const finJour = new Date(Date.now() + 12 * 3600000);
  const congesJour = lits.filter((l) => l.etat === 'occupe' && l.sortie_prevue && new Date(l.sortie_prevue) <= finJour
    && new Date(l.sortie_prevue) >= Date.now() - 3600000 && l.conge_statut !== 'confirme' && !l.nsa_depuis);
  for (const l of congesJour.slice(0, 6)) {
    ajouter(3, `Confirmer le congé du lit ${l.code}`, `Congé prévu à ${new Date(l.sortie_prevue).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', timeZone: cfg.fuseau })}. Le confirmer permet de planifier le nettoyage et l’admission suivante.`,
      { type: 'conge', lit_id: l.id, statut: 'confirme', libelle: 'Confirmer le congé' });
  }
  const depasses = lits.filter((l) => l.etat === 'occupe' && l.blocage_motif && l.blocage_motif.startsWith('Congé prévu dépassé'));
  if (depasses.length) {
    ajouter(2, `${depasses.length} congé(s) prévu(s) dépassé(s)`,
      `Lits ${depasses.map((l) => l.code).join(', ')}. Vérifiez ce qui bloque la sortie (transport, hébergement, résultats) ou mettez à jour la date.`);
  }

  // 5. NSA
  if (nsa.total && nsa.taux > nsa.cible) {
    const longs = nsa.lits.filter((l) => l.jours >= 30);
    ajouter(2, `NSA : ${nsa.taux} % des lits occupés (cible ${nsa.cible} %)`,
      `${nsa.total} patient(s) n’ont plus besoin de soins aigus${longs.length ? `, dont ${longs.length} depuis plus de 30 jours` : ''}. `
      + `Orientations : ${Object.entries(nsa.par_orientation).map(([k, v]) => `${k} ${v}`).join(', ')}. Relancez le mécanisme d’accès à l’hébergement.`);
  }

  // 6. Prévision de saturation et capacité perdue
  for (const u of moi.unites.filter((x) => x.risque === 'eleve')) {
    const rec = await s.recommander(pool, utilisateur, etabId, u.type_id);
    const sug = rec.suggestions.find((x) => x.libres);
    ajouter(2, `${u.type_nom} : saturé, aucun lit prévu d’ici ${cfg.horizon_h} h`,
      sug ? `Préparez des transferts sortants. Meilleure option : ${sug.nom} (${sug.raison}).` : 'Aucune place dans le rayon. Escaladez à la coordination régionale.');
  }
  if (alerte.fermes_personnel) {
    ajouter(3, `${alerte.fermes_personnel} lit(s) fermé(s) faute de personnel`,
      'Capacité perdue. À signaler à la direction des soins infirmiers si du personnel peut être redéployé.');
  }

  recos.sort((a, b) => a.priorite - b.priorite);
  const prevus = moi.unites.reduce((a, u) => a + (u.prevus || 0), 0);
  const libres = moi.unites.reduce((a, u) => a + u.libres, 0);
  const enAttente = file.filter((d) => d.statut === 'attente').length;
  const resume = `Niveau ${NIVEAUX[alerte.niveau].toLowerCase()} (pression ${alerte.pression} %). `
    + `${libres} lit(s) libre(s), ${prevus} prévu(s) d’ici ${cfg.horizon_h} h, ${enAttente} patient(s) en attente d’un lit`
    + `${alerte.attente_longue ? `, dont ${alerte.attente_longue} depuis plus de ${Math.round(cfg.attente_admission_max_min / 60)} h` : ''}. `
    + `${nettoyage.length} lit(s) à nettoyer, ${nsa.total} patient(s) NSA (${nsa.taux} %).`;
  return { etablissement: etab.nom, genere_le: new Date().toISOString(), alerte, resume, recommandations: recos };
}

/** Vue réseau : où ça déborde, où il reste de la place, et quels délestages proposer. */
async function briefingReseau(pool, utilisateur, depuisId) {
  const reseau = await s.capaciteReseau(pool, utilisateur, depuisId);
  const etabs = [];
  for (const e of reseau.etablissements) {
    etabs.push({ ...e, alerte: await t.niveauAlerte(pool, e.id) });
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
        delestages.push({ de: e.nom, vers: cible.x.nom, type: u.type_nom, libres_cible: cible.u2.libres,
          raison: `${e.nom} est au niveau ${e.alerte.niveau} ; ${cible.x.nom}, le plus proche avec de la place, a ${cible.u2.libres} lit(s) libre(s) en ${u.type_nom.toLowerCase()}.` });
      }
    }
  }
  return {
    etablissements: etabs.map((e) => ({ id: e.id, nom: e.nom, ville: e.ville, moi: e.moi, partage: e.partage, distance_km: e.distance_km,
      niveau: e.alerte.niveau, pression: e.alerte.pression, libres: e.unites.reduce((a, u) => a + u.libres, 0),
      en_attente: e.moi || e.partage === 'complet' ? e.alerte.en_attente : null })),
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

async function questionIa(contexte, question, fetchImpl = fetch) {
  const cle = process.env.COPILOTE_IA_CLE;
  const r = await fetchImpl(process.env.COPILOTE_IA_URL || 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cle, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.COPILOTE_IA_MODELE || 'claude-sonnet-5-5',
      max_tokens: 700,
      system: 'Tu es le Copilote d’Arrimo, outil de gestion des lits et des transferts entre hôpitaux. Réponds en français, '
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
  const qn = String(q).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (process.env.COPILOTE_IA_CLE) {
    try {
      const [b, r] = await Promise.all([briefing(pool, utilisateur, etabId), briefingReseau(pool, utilisateur, etabId)]);
      const texte = await questionIa(sansPatients({ briefing: b, reseau: r }), q, fetchImpl);
      if (texte) return { reponse: texte, mode: 'ia' };
    } catch (e) {
      console.error('Copilote IA :', e.message);   // repli sur le mode local
    }
  }
  if (/(nsa|hebergement|chsld)/.test(qn)) {
    const n = await t.listeNsa(pool, utilisateur, etabId);
    return { mode: 'local', reponse: `${n.total} patient(s) NSA, soit ${n.taux} % des lits occupés (cible ${n.cible} %), pour ${n.jours_lits} jours-lits.\n`
      + Object.entries(n.par_orientation).map(([k, v]) => `• ${k} : ${v}`).join('\n') };
  }
  if (/(attente|admission|urgence|civiere)/.test(qn)) {
    const f = (await t.fileAdmission(pool, utilisateur, etabId)).filter((d) => d.statut === 'attente');
    return { mode: 'local', reponse: f.length ? `${f.length} patient(s) attendent un lit :\n${f.map((d) => `• ${d.patient_ref} · ${d.type_nom} · ${d.priorite.toUpperCase()} · ${d.attente_min} min${d.lit_suggere ? ` · lit ${d.lit_suggere.code} disponible` : ' · aucun lit adapté ici'}`).join('\n')}` : 'Aucun patient en attente d’un lit.' };
  }
  if (/(nettoy|menage|entretien)/.test(qn)) {
    const n = await t.fileNettoyage(pool, utilisateur, etabId);
    return { mode: 'local', reponse: n.length ? `Ordre de nettoyage recommandé :\n${n.map((x, i) => `${i + 1}. ${x.code} · ${x.raison}`).join('\n')}` : 'Aucun lit à nettoyer.' };
  }
  if (/(alerte|niveau|deborde|saturation|surcapacite|reseau)/.test(qn)) {
    const r = await briefingReseau(pool, utilisateur, etabId);
    return { mode: 'local', reponse: r.etablissements.map((e) => `• ${e.nom} : niveau ${e.niveau} (pression ${e.pression} %), ${e.libres} lit(s) libre(s)`).join('\n')
      + (r.delestages.length ? `\nDélestages possibles :\n${r.delestages.map((d) => `• ${d.de} → ${d.vers} (${d.type})`).join('\n')}` : '') };
  }
  if (/(quoi faire|priorit|recommand|briefing|resume|situation)/.test(qn)) {
    const b = await briefing(pool, utilisateur, etabId);
    return { mode: 'local', reponse: `${b.resume}\n${b.recommandations.slice(0, 5).map((r, i) => `${i + 1}. ${r.titre}`).join('\n')}` };
  }
  return { mode: 'local', reponse: await s.assistant(pool, utilisateur, etabId, q) };
}

module.exports = { briefing, briefingReseau, question, sansPatients, questionIa };
