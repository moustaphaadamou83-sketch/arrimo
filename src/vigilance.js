/**
 * Vigilance opérationnelle : congés et disponibilités prévues par lit, blocages explicables, fraîcheur des données.
 * - Un congé prévu n'est jamais un lit libre : il reste « occupé » jusqu'au départ réel enregistré.
 * - Une heure de départ dépassée sans sortie enregistrée devient « vérification nécessaire » ; rien n'est libéré automatiquement.
 * - Chaque alerte dit sur quoi elle repose (événement, seuil configuré), distingue fait et hypothèse, et propose une action
 *   qu'un humain habilité décide. Aucune alerte n'annule une réservation ni un transfert.
 */
const { exigerEtablissement } = require('./auth');
const { ErreurHttp } = require('./db');

const STATUTS_OUVERTS = ['prevu', 'confirme', 'attente_transport', 'reporte'];
const RESPONSABLES = {
  reservation_prolongee: 'Coordination des lits de l’établissement',
  conge_retarde: 'Équipe de soins de l’unité, avec la coordination',
  nettoyage_en_attente: 'Équipe d’entretien',
  disponibilite_perimee: 'Coordination des lits de l’établissement',
  hors_service_prolonge: 'Gestion de l’unité',
  attente_admission: 'Coordination des lits de l’établissement',
  civiere_nettoyage: 'Équipe d’entretien de l’urgence',
  civiere_sans_demande: 'Équipe médicale de l’urgence',
  // Vigilance transversale (lot 1 du chantier coordination, 26 nov. 2026) : responsables initiaux proposés par le cahier nº 2 (§5),
  // à configurer et valider avec chaque établissement.
  ambulance_immobilisee: 'Responsable opérationnel de l’urgence',
  ambulances_attendues: 'Responsable opérationnel de l’urgence, avec la coordination des lits',
  transport_en_retard: 'Responsable du transport',
  transport_non_confirme: 'Responsable du transport',
  placement_non_realise: 'Coordination des sorties et placements',
  transfert_sans_reponse: 'Établissement d’accueil',
  connecteur_silencieux: 'Responsable des intégrations de l’établissement',
  quote_part_contradiction: 'Responsable opérationnel de l’urgence, avec le CCS',
  incoherence: 'Coordination des lits de l’établissement',
  reaffectation_exceptionnelle: 'Coordination des lits de l’établissement',
};
const PALIERS = {
  vigilance: { niveau: 'modere', texte: 'vigilance' },
  escalade: { niveau: 'eleve', texte: 'escalade' },
  critique: { niveau: 'eleve', texte: 'critique' },
};
const ACTIONS_PALIER = {
  vigilance: 'Identifier le blocage, accuser réception et consigner le motif dans Chrono.',
  escalade: 'Mobiliser la coordination hospitalière et informer le CCS ; consigner le motif dans Chrono.',
  critique: 'Mobiliser les responsables de garde et la coordination ambulancière selon le protocole local.',
};
const MOTIFS_FR = { civiere: 'civière indisponible', personnel: 'personnel indisponible', chambre: 'chambre en préparation',
  dossier: 'attente de transmission du dossier', saturation: 'saturation du service', nettoyage: 'nettoyage', technique: 'incident technique',
  triage: 'triage saturé', clinique: 'contraintes cliniques', inconnue: 'cause inconnue', autre: 'autre motif' };
const MOTIFS_EN = { civiere: 'stretcher unavailable', personnel: 'staff unavailable', chambre: 'room being prepared',
  dossier: 'waiting for record transfer', saturation: 'department at capacity', nettoyage: 'cleaning', technique: 'technical incident',
  triage: 'triage at capacity', clinique: 'clinical constraints', inconnue: 'unknown cause', autre: 'other reason' };
// Préalerte ouverte dont le véhicule n'est pas encore arrivé
const PREALERTE_ATTENDUE = `statut IN ('envoyee', 'recue', 'consultee', 'prise_en_compte', 'preparation', 'preparation_terminee') AND arrivee_signalee_le IS NULL`;

/** Début et fin du jour local (aujourd'hui, demain) dans le fuseau de la configuration. */
async function bornesJour(db, fuseau, decalage) {
  const r = await db.query(
    `SELECT (date_trunc('day', now() AT TIME ZONE $1) + make_interval(days => $2)) AT TIME ZONE $1 AS debut,
            (date_trunc('day', now() AT TIME ZONE $1) + make_interval(days => $2 + 1)) AT TIME ZONE $1 AS fin`, [fuseau, decalage]);
  return r.rows[0];
}

async function configEtab(db, etabId) {
  const r = await db.query(
    `SELECT c.*, e.id AS etab_id, e.nom AS nom FROM etablissements e JOIN config_pays c ON c.id = e.config_id WHERE e.id = $1`, [etabId]);
  if (!r.rows[0]) throw new ErreurHttp(404, 'etab_introuvable');
  return r.rows[0];
}

/** Heure réelle du dernier contrôle périodique et de la lecture des données. */
async function fraicheur(db) {
  const r = await db.query(`SELECT execute_le, duree_ms, resultat FROM controles WHERE nom = 'blocages'`);
  const periodeMin = Number(process.env.BLOCAGES_MINUTES || 15);
  const dernier = r.rows[0]?.execute_le || null;
  const retard = !dernier || Date.now() - new Date(dernier).getTime() > 2 * periodeMin * 60000;
  return {
    donnees_lues_le: new Date().toISOString(),
    mode: 'lecture_directe',
    controle_periodique: { dernier_le: dernier, periode_min: periodeMin, en_retard: retard, resultat: r.rows[0]?.resultat || null },
  };
}

/**
 * Congés et disponibilités prévues, lit par lit.
 * Filtres : horizon (heures : 4, 12, 24), jour (aujourdhui, demain), unite (id), statut.
 */
async function conges(pool, utilisateur, etabId, f = {}) {
  exigerEtablissement(utilisateur, etabId);
  const cfg = await configEtab(pool, etabId);
  let debut = null; let fin = null;
  if (f.jour === 'aujourdhui' || f.jour === 'demain') ({ debut, fin } = await bornesJour(pool, cfg.fuseau, f.jour === 'demain' ? 1 : 0));
  const horizon = [4, 12, 24, 48].includes(Number(f.horizon)) ? Number(f.horizon) : null;
  const { rows } = await pool.query(
    `SELECT l.id AS lit_id, l.code AS lit, l.etat, l.patient_ref, l.sortie_prevue, l.conge_statut, l.etat_depuis,
            ch.numero AS chambre, u.id AS unite_id, u.nom AS unite, sv.nom AS service, t.nom AS type_nom, t.code AS type_code,
            e.nom AS etablissement, g.source, g.maj_le, mp.nom AS maj_par, g.cree_le
       FROM lits l
       JOIN chambres ch ON ch.id = l.chambre_id JOIN unites u ON u.id = l.unite_id
       LEFT JOIN services sv ON sv.id = u.service_id
       JOIN types_unite t ON t.id = l.type_id JOIN etablissements e ON e.id = l.etablissement_id
       LEFT JOIN conges g ON g.lit_id = l.id AND g.statut = ANY($2::text[])
       LEFT JOIN utilisateurs mp ON mp.id = g.maj_par
      WHERE l.etablissement_id = $1 AND l.etat = 'occupe' AND (l.sortie_prevue IS NOT NULL OR l.conge_statut IS NOT NULL)
      ORDER BY l.sortie_prevue NULLS LAST, l.code`, [etabId, STATUTS_OUVERTS]);
  // Départs réels et congés annulés des dernières 24 h : historique visible dans la même vue
  const hist = await pool.query(
    `SELECT g.lit_id, l.code AS lit, l.etat, g.patient_ref, g.sortie_prevue, g.statut AS conge_statut, g.depart_reel_le, g.source, g.maj_le,
            mp.nom AS maj_par, ch.numero AS chambre, u.id AS unite_id, u.nom AS unite, sv.nom AS service, t.nom AS type_nom, t.code AS type_code,
            e.nom AS etablissement
       FROM conges g JOIN lits l ON l.id = g.lit_id
       JOIN chambres ch ON ch.id = l.chambre_id JOIN unites u ON u.id = l.unite_id LEFT JOIN services sv ON sv.id = u.service_id
       JOIN types_unite t ON t.id = l.type_id JOIN etablissements e ON e.id = l.etablissement_id
       LEFT JOIN utilisateurs mp ON mp.id = g.maj_par
      WHERE g.etablissement_id = $1 AND g.statut IN ('realise', 'annule') AND g.maj_le > now() - interval '24 hours'
      ORDER BY g.maj_le DESC`, [etabId]);
  const maintenant = Date.now();
  const lignes = [];
  for (const r of rows) {
    const prevu = r.sortie_prevue ? new Date(r.sortie_prevue).getTime() : null;
    const retardMin = prevu && prevu < maintenant ? Math.round((maintenant - prevu) / 60000) : 0;
    const statut = r.conge_statut || 'prevu';
    // Disponibilité estimée : seulement pour un congé confirmé avec une heure, + durée cible de nettoyage configurée
    const estimable = statut === 'confirme' && prevu && !retardMin;
    lignes.push({
      ...r, statut, nettoyage_requis: true,
      verification: retardMin > 0 ? 'verification_necessaire' : null,
      retard_min: retardMin,
      disponibilite_estimee: estimable ? new Date(prevu + cfg.nettoyage_cible_min * 60000).toISOString() : null,
      disponibilite_estimee_regle: estimable ? `heure de congé confirmée + durée cible de nettoyage (${cfg.nettoyage_cible_min} min, configuration)` : null,
      source: r.source || 'manuel', derniere_maj: r.maj_le || r.etat_depuis,
      depart_reel_le: null, occupe_actuellement: true,
    });
  }
  for (const r of hist.rows) {
    lignes.push({ ...r, statut: r.conge_statut, nettoyage_requis: r.conge_statut === 'realise', verification: null, retard_min: 0,
      disponibilite_estimee: null, disponibilite_estimee_regle: null, derniere_maj: r.maj_le, occupe_actuellement: r.etat === 'occupe' });
  }
  const dansFenetre = (x) => {
    const d = x.depart_reel_le || x.sortie_prevue;
    if (debut && (!d || new Date(d) < new Date(debut) || new Date(d) >= new Date(fin))) return false;
    if (horizon && x.statut !== 'realise' && x.statut !== 'annule') {
      if (!x.sortie_prevue) return false;
      const t = new Date(x.sortie_prevue).getTime();
      if (t > maintenant + horizon * 3600000) return false;
    }
    return true;
  };
  const filtrees = lignes.filter((x) => dansFenetre(x)
    && (!f.unite || Number(f.unite) === x.unite_id)
    && (!f.statut || f.statut === x.statut || (f.statut === 'retard' && x.verification)));
  // Résumé déterministe : uniquement des événements enregistrés (aucune estimation statistique ici)
  const resume = {};
  for (const h of [4, 12, 24]) {
    const dans = lignes.filter((x) => STATUTS_OUVERTS.includes(x.statut) && x.sortie_prevue
      && new Date(x.sortie_prevue).getTime() <= maintenant + h * 3600000);
    resume[h] = { confirmes: dans.filter((x) => x.statut === 'confirme').length, prevus: dans.filter((x) => x.statut !== 'confirme').length,
      lits: dans.map((x) => x.lit) };
  }
  return require('./vigilance-en').traduire({
    etablissement: cfg.nom, filtres: { horizon, jour: f.jour || null, unite: f.unite ? Number(f.unite) : null, statut: f.statut || null },
    lignes: filtrees,
    resume, retards: lignes.filter((x) => x.verification).length,
    regles: {
      deterministe: 'Les congés listés sont des événements enregistrés (saisie ou interface autorisée). Un congé prévu n’est pas un lit libre.',
      retard: 'Heure prévue dépassée sans départ enregistré : vérification nécessaire. Le lit n’est jamais libéré automatiquement.',
      estimation: 'Les prévisions statistiques (OG, Prévisions) sont séparées : elles s’appuient sur l’historique et donnent une marge.',
    },
    ...(await fraicheur(pool)),
  }, utilisateur.langue);
}

/** Durée lisible pour les textes d'alerte. */
function dureeTexte(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60); const r = m % 60;
  if (h < 48) return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
}

/**
 * Vigilance transversale (lot 1 « Détecter », chantier coordination du 26 nov. 2026) : les blocages des autres modules
 * (Chrono, Liaison Secours, Transport, Transferts, Liaison CHSLD, Connect) lus dans leurs propres tables, sans copie.
 * Chaque alerte reste un constat : rien n'est annulé, redirigé ni libéré ; aucune cause n'est attribuée sans donnée.
 */
async function transversales(pool, utilisateur, etabId, cfg, ajouter) {
  const en = utilisateur.langue === 'en';
  // 1. Ambulances immobilisées à la porte (Chrono) : paliers configurables du profil de pays
  const passages = (await pool.query(
    `SELECT p.id, p.numero, un.numero AS unite, o.nom AS organisation, h.heure AS arrivee,
            EXTRACT(EPOCH FROM (now() - h.heure)) / 60 AS attente_min,
            (SELECT m.motif FROM passages_chrono_motifs m WHERE m.passage_id = p.id ORDER BY m.id DESC LIMIT 1) AS motif
       FROM passages_chrono p JOIN unites_secours un ON un.id = p.unite_id JOIN organisations_secours o ON o.id = p.organisation_id
       JOIN v_horodatages_courants h ON h.objet = 'passage_chrono' AND h.objet_id = p.id AND h.etape = 'H11'
      WHERE p.etablissement_id = $1 AND p.statut = 'a_la_porte'
        AND NOT EXISTS (SELECT 1 FROM v_horodatages_courants r WHERE r.objet = 'passage_chrono' AND r.objet_id = p.id AND r.etape = 'H14')`,
    [etabId])).rows;
  const cibles = { orange: cfg.chrono_orange_min ?? 15, porte: cfg.chrono_cible_porte_min ?? 20, total: cfg.chrono_cible_total_min ?? 45 };
  for (const p of passages) {
    const attente = Math.max(0, Math.round(Number(p.attente_min)));
    const palier = require('./chrono').palier(attente, cibles);
    if (!PALIERS[palier]) continue;
    const motif = p.motif ? (en ? MOTIFS_EN : MOTIFS_FR)[p.motif] || p.motif : null;
    ajouter({ genre: 'ambulance', ressource_id: p.id, ressource: p.unite, unite: 'Urgence', chambre: null, depuis: p.arrivee, duree_min: attente,
      type: 'ambulance_immobilisee', niveau: PALIERS[palier].niveau, palier, objet: { type: 'passage_chrono', id: p.id, numero: p.numero },
      titre: `Ambulance ${p.unite} (${p.organisation}) à la porte depuis ${dureeTexte(attente)}, responsabilité non transférée — palier ${PALIERS[palier].texte}.`,
      evenement: 'Arrivée de l’ambulance à l’urgence (H11)',
      seuil: { valeur_min: cibles[palier === 'vigilance' ? 'orange' : palier === 'escalade' ? 'porte' : 'total'],
        regle: `Paliers indicatifs du profil de pays : vigilance ${cibles.orange} min, escalade ${cibles.porte} min, critique ${cibles.total} min (non cliniques, à valider localement).` },
      cause: motif ? { nature: 'fait', texte: `Motif consigné dans Chrono : ${motif}.` }
        : { nature: 'hypothese', texte: 'Aucun motif consigné : la cause reste inconnue tant que l’équipe ne l’a pas documentée.' },
      action: ACTIONS_PALIER[palier] });
  }

  // 2. Ambulances attendues au-delà des civières libres (Liaison Secours + civières de l'urgence)
  const { rows: [att] } = await pool.query(
    `SELECT (SELECT count(*)::int FROM prealertes WHERE destination_id = $1 AND ${PREALERTE_ATTENDUE}) AS attendues,
            (SELECT count(*)::int FROM civieres WHERE etablissement_id = $1 AND actif AND etat = 'libre') AS libres,
            (SELECT min(cree_le) FROM prealertes WHERE destination_id = $1 AND ${PREALERTE_ATTENDUE}) AS depuis`, [etabId]);
  if (att.attendues > 0 && att.attendues > att.libres) {
    ajouter({ genre: 'urgence', ressource_id: etabId, ressource: 'Urgence', unite: 'Urgence', chambre: null, depuis: att.depuis,
      duree_min: Math.round((Date.now() - new Date(att.depuis).getTime()) / 60000), type: 'ambulances_attendues', niveau: att.libres === 0 ? 'eleve' : 'modere',
      titre: `Ambulances annoncées : ${att.attendues} · civières libres à l’urgence : ${att.libres}.`,
      evenement: 'Préalertes reçues de Liaison Secours',
      seuil: { valeur_min: 0, regle: 'Ambulances annoncées non encore arrivées supérieures aux civières libres enregistrées.' },
      cause: { nature: 'fait', texte: 'Comptes lus dans les préalertes ouvertes et l’état des civières ; une civière libre non confirmée peut ne pas être prête.' },
      action: 'Préparer l’accueil (civières, nettoyage, congés) ; informer le CCS si la réception est contrainte. La destination reste décidée par le CCS.' });
  }

  // 2 bis. Quote-part non atteinte alors qu'aucune civière n'est libre (scénario B) : deux informations distinctes, aucune destination décidée
  const qp = (await require('./quotes-parts').etat(pool, [etabId])).get(etabId);
  if (qp && qp.recues + qp.attendues < qp.valeur && att.libres === 0) {
    ajouter({ genre: 'urgence', ressource_id: etabId, ressource: 'Quote-part', unite: 'Urgence', chambre: null, depuis: qp.actualise_le, duree_min: 0,
      type: 'quote_part_contradiction', niveau: 'modere',
      titre: `Quote-part non atteinte (reçues : ${qp.recues}, attendues : ${qp.attendues}, quote-part : ${qp.valeur} par ${qp.periode_min} min) alors qu’aucune civière n’est libre.`,
      evenement: 'Quote-part saisie par l’autorité',
      seuil: { valeur_min: 0, regle: 'Comparaison de deux informations distinctes ; aucune marge n’est calculée (formule non définie officiellement).' },
      cause: { nature: 'fait', texte: `Quote-part fixée par ${qp.autorite} ; civières libres enregistrées : 0.` },
      action: 'Informer le CCS de la contrainte de réception ; la destination reste décidée par le répartiteur.' });
  }

  // 3. Transports : heure souhaitée dépassée sans prise en charge, ou transport imminent non accepté
  const transports = (await pool.query(
    `SELECT d.id, d.numero, d.statut, d.heure_souhaitee, d.origine_id, eo.nom AS origine, COALESCE(ed.nom, d.destination_libelle, '—') AS destination,
            o.nom AS transporteur, EXTRACT(EPOCH FROM (now() - d.heure_souhaitee)) / 60 AS retard_min
       FROM demandes_transport d JOIN etablissements eo ON eo.id = d.origine_id LEFT JOIN etablissements ed ON ed.id = d.destination_id
       JOIN organisations_secours o ON o.id = d.organisation_id
      WHERE (d.origine_id = $1 OR d.destination_id = $1) AND d.statut IN ('demandee', 'acceptee', 'en_route') AND d.heure_souhaitee IS NOT NULL
        AND d.heure_souhaitee < now() + interval '2 hours'`, [etabId])).rows;
  for (const d of transports) {
    const retard = Number(d.retard_min);
    const base = { genre: 'transport', ressource_id: d.id, ressource: d.numero, unite: `${d.origine} → ${d.destination}`, chambre: null,
      depuis: d.heure_souhaitee, objet: { type: 'demande_transport', id: d.id, numero: d.numero } };
    if (retard > cfg.transport_retard_marge_min) {
      ajouter({ ...base, type: 'transport_en_retard', niveau: d.statut === 'demandee' ? 'eleve' : 'modere', duree_min: Math.round(retard),
        titre: `Transport ${d.numero} (${d.transporteur}) : heure souhaitée dépassée de ${dureeTexte(retard)}, résident non pris en charge.`,
        evenement: 'Heure souhaitée du transport',
        seuil: { valeur_min: cfg.transport_retard_marge_min, regle: `Marge de retard configurée (${cfg.transport_retard_marge_min} min, transport_retard_marge_min).` },
        cause: { nature: 'fait', texte: d.statut === 'demandee' ? 'La demande n’a pas été acceptée par le transporteur.' : 'Transport accepté, prise en charge non enregistrée.' },
        action: 'Joindre le transporteur ; si le transport n’est plus possible, reprogrammer ou chercher une autre solution autorisée (décision humaine).' });
    } else if (d.statut === 'demandee' && retard < 0) {
      ajouter({ ...base, type: 'transport_non_confirme', niveau: 'faible', duree_min: 0,
        titre: `Transport ${d.numero} (${d.transporteur}) prévu dans ${dureeTexte(-retard)}, pas encore accepté.`,
        evenement: 'Demande de transport transmise',
        seuil: { valeur_min: 120, regle: 'Transport prévu dans les 2 h sans acceptation du transporteur.' },
        cause: { nature: 'fait', texte: 'Aucune acceptation enregistrée.' },
        action: 'Vérifier la disponibilité du transporteur avant l’heure prévue.' });
    }
  }

  // 4. Placements acceptés non réalisés (Liaison CHSLD) : départ prévu dépassé, ou acceptation ancienne sans départ prévu
  const placements = (await pool.query(
    `SELECT d.id, d.numero, d.depart_prevu_le, COALESCE(d.acceptation_equipe_le, d.modifie_le) AS acceptee_le, e.nom AS hebergement,
            EXTRACT(EPOCH FROM (now() - COALESCE(d.depart_prevu_le, COALESCE(d.acceptation_equipe_le, d.modifie_le)))) / 60 AS age_min
       FROM demandes_hebergement d JOIN etablissements e ON e.id = d.etablissement_id
      WHERE (d.hopital_id = $1 OR d.etablissement_id = $1) AND d.statut = 'acceptee' AND d.depart_hopital_le IS NULL
        AND ((d.depart_prevu_le IS NOT NULL AND d.depart_prevu_le < now())
          OR (d.depart_prevu_le IS NULL AND COALESCE(d.acceptation_equipe_le, d.modifie_le) < now() - make_interval(hours => $2)))`,
    [etabId, cfg.placement_accepte_max_h])).rows;
  for (const d of placements) {
    const prevu = d.depart_prevu_le != null;
    ajouter({ genre: 'placement', ressource_id: d.id, ressource: d.numero, unite: d.hebergement, chambre: null, depuis: prevu ? d.depart_prevu_le : d.acceptee_le,
      duree_min: Math.round(Number(d.age_min)), type: 'placement_non_realise', niveau: prevu ? 'modere' : 'faible',
      objet: { type: 'demande_hebergement', id: d.id, numero: d.numero },
      titre: prevu ? `Placement ${d.numero} accepté : départ prévu dépassé de ${dureeTexte(Number(d.age_min))}, départ de l’hôpital non enregistré.`
        : `Placement ${d.numero} accepté depuis ${dureeTexte(Number(d.age_min))} sans départ planifié.`,
      evenement: prevu ? 'Départ prévu du placement' : 'Acceptation du placement',
      seuil: { valeur_min: prevu ? 0 : cfg.placement_accepte_max_h * 60,
        regle: prevu ? 'Heure de départ prévue dépassée.' : `Acceptation plus ancienne que la durée configurée (${cfg.placement_accepte_max_h} h, placement_accepte_max_h).` },
      cause: { nature: 'hypothese', texte: 'Obstacle possible : transport, chambre, documents ou famille ; à vérifier dans Liaison CHSLD.' },
      action: 'Identifier l’obstacle et le responsable dans Liaison CHSLD ; planifier le transport et confirmer la date de départ.' });
  }

  // 5. Transferts sans réponse de l'établissement d'accueil
  const transferts = (await pool.query(
    `SELECT t.id, t.numero, t.origine_id, t.date_demande, ed.nom AS destination, eo.nom AS origine,
            EXTRACT(EPOCH FROM (now() - t.date_demande)) / 60 AS attente_min
       FROM transferts t JOIN etablissements ed ON ed.id = t.destination_id JOIN etablissements eo ON eo.id = t.origine_id
      WHERE (t.origine_id = $1 OR t.destination_id = $1) AND t.statut = 'demande' AND t.date_demande < now() - make_interval(mins => $2)`,
    [etabId, cfg.transfert_reponse_max_min])).rows;
  for (const t of transferts) {
    ajouter({ genre: 'transfert', ressource_id: t.id, ressource: t.numero, unite: `${t.origine} → ${t.destination}`, chambre: null, depuis: t.date_demande,
      duree_min: Math.round(Number(t.attente_min)), type: 'transfert_sans_reponse', niveau: 'modere', objet: { type: 'transfert', id: t.id, numero: t.numero },
      titre: `Transfert ${t.numero} vers ${t.destination} sans réponse depuis ${dureeTexte(Number(t.attente_min))}.`,
      evenement: 'Demande de transfert',
      seuil: { valeur_min: cfg.transfert_reponse_max_min, regle: `Délai de réponse configuré (${cfg.transfert_reponse_max_min} min, transfert_reponse_max_min).` },
      cause: { nature: 'fait', texte: 'Ni acceptation ni refus enregistré par l’établissement d’accueil.' },
      action: 'Relancer l’établissement d’accueil depuis Transferts, ou consulter les solutions de rechange (décision humaine).' });
  }

  // 5 bis. Incohérences entre modules (gouvernance des données) : deux faits enregistrés qui se contredisent ; rien n'est corrigé automatiquement
  const incoherences = (await pool.query(`
      SELECT 'lit_reserve_transfert_clos' AS code, l.id AS rid, l.code AS ressource, t.numero AS ref, t.statut AS detail, l.etat_depuis AS depuis
        FROM lits l JOIN transferts t ON t.id = l.transfert_id WHERE l.etablissement_id = $1 AND l.etat = 'reserve' AND t.statut IN ('refuse', 'recu')
      UNION ALL
      SELECT 'placement_admis_sans_depart', d.id, d.numero, d.numero, d.statut, d.modifie_le
        FROM demandes_hebergement d WHERE d.hopital_id = $1 AND d.statut = 'admise' AND d.depart_hopital_le IS NULL AND d.hopital_lit_id IS NOT NULL
      UNION ALL
      SELECT 'arrivee_sans_chrono', p.id, p.numero, p.numero, p.statut, p.arrivee_confirmee_le
        FROM prealertes p JOIN etablissements e ON e.id = p.destination_id
       WHERE p.destination_id = $1 AND e.modules->>'chrono' = 'true' AND p.arrivee_confirmee_le < now() - interval '30 minutes'
         AND p.arrivee_confirmee_le > now() - interval '24 hours' AND NOT EXISTS (SELECT 1 FROM passages_chrono pc WHERE pc.prealerte_id = p.id)`, [etabId])).rows;
  const TEXTES_INC = {
    lit_reserve_transfert_clos: (x) => [`Lit ${x.ressource} encore réservé pour le transfert ${x.ref}, déjà clos (${x.detail}).`, 'Vérifier le lit dans Lits et Transferts ; annuler la réservation ou admettre (correction tracée).'],
    placement_admis_sans_depart: (x) => [`Placement ${x.ref} admis à l’hébergement, mais aucun départ de l’hôpital enregistré.`, 'Enregistrer le départ réel dans Liaison CHSLD, ou corriger le statut (correction tracée).'],
    arrivee_sans_chrono: (x) => [`Préalerte ${x.ref} : arrivée confirmée sans passage Chrono correspondant.`, 'Vérifier l’arrivée dans Chrono ; corriger l’heure H11 si elle manque (correction tracée).'],
  };
  for (const x of incoherences) {
    const [titre, action] = TEXTES_INC[x.code](x);
    ajouter({ genre: 'incoherence', ressource_id: `${x.code}:${x.rid}`, ressource: x.ressource, unite: 'Données', chambre: null, depuis: x.depuis,
      duree_min: x.depuis ? Math.round((Date.now() - new Date(x.depuis).getTime()) / 60000) : 0, type: 'incoherence', niveau: 'faible',
      titre, evenement: 'Comparaison de deux modules', seuil: { valeur_min: 0, regle: 'Deux faits enregistrés se contredisent.' },
      cause: { nature: 'fait', texte: 'Les deux enregistrements existent ; l’un des deux est probablement à corriger.' }, action });
  }

  // 5 ter. Réaffectations exceptionnelles des dernières 24 h (règle de compatibilité, cahier nº 19) : à revoir par l'équipe
  for (const x of (await pool.query(`SELECT re.id, re.ressource_type, re.motif, re.cree_le, x.nom AS par, COALESCE(l.code, cv.code) AS code
      FROM reaffectations_exceptionnelles re JOIN utilisateurs x ON x.id = re.autorise_par LEFT JOIN lits l ON re.ressource_type = 'lit' AND l.id = re.ressource_id
      LEFT JOIN civieres cv ON re.ressource_type = 'civiere' AND cv.id = re.ressource_id
     WHERE re.etablissement_id = $1 AND re.cree_le > now() - interval '24 hours'`, [etabId])).rows) {
    ajouter({ genre: 'reaffectation', ressource_id: Number(x.id), ressource: x.code || '—', unite: 'Capacités', chambre: null, depuis: x.cree_le,
      duree_min: Math.round((Date.now() - new Date(x.cree_le).getTime()) / 60000), type: 'reaffectation_exceptionnelle', niveau: 'faible',
      titre: `Réaffectation exceptionnelle de ${x.code || '—'} autorisée par ${x.par} (${x.motif}).`,
      evenement: 'Réaffectation exceptionnelle autorisée', seuil: { valeur_min: 0, regle: 'Toute attribution incompatible est signalée pendant 24 h.' },
      cause: { nature: 'fait', texte: 'Ressource attribuée hors compatibilité, avec motif et justification enregistrés.' },
      action: 'Vérifier que la situation est temporaire et proposer une ressource compatible dès qu’elle se libère.' });
  }

  // 6. Connecteur de l'établissement silencieux : données possiblement obsolètes (scénario G)
  const connecteurs = (await pool.query(
    `SELECT c.id, c.nom, c.cree_le, c.suspendu_le, (SELECT max(recu_le) FROM messages_connecteur m WHERE m.connecteur_id = c.id) AS dernier
       FROM connecteurs c WHERE c.etablissement_id = $1 AND c.actif`, [etabId])).rows;
  for (const c of connecteurs) {
    if (c.suspendu_le) {
      ajouter({ genre: 'connecteur', ressource_id: c.id, ressource: c.nom, unite: 'Arrimo Connect', chambre: null, depuis: c.suspendu_le,
        duree_min: Math.round((Date.now() - new Date(c.suspendu_le).getTime()) / 60000), type: 'connecteur_silencieux', niveau: 'modere',
        titre: `Connecteur ${c.nom} suspendu : les données qu’il alimente ne sont plus actualisées.`,
        evenement: 'Suspension du connecteur',
        seuil: { valeur_min: 0, regle: 'Suspension décidée par l’administration de l’établissement.' },
        cause: { nature: 'fait', texte: 'Connecteur suspendu ; le partenaire conserve ses messages jusqu’à la reprise.' },
        action: 'Vérifier la liaison avec l’équipe informatique ; confirmer les disponibilités manuellement en attendant.' });
      continue;
    }
    const ref = c.dernier || c.cree_le;
    const age = (Date.now() - new Date(ref).getTime()) / 60000;
    if (age <= cfg.connecteur_silence_max_min) continue;
    ajouter({ genre: 'connecteur', ressource_id: c.id, ressource: c.nom, unite: 'Arrimo Connect', chambre: null, depuis: ref, duree_min: Math.round(age),
      type: 'connecteur_silencieux', niveau: 'modere',
      titre: c.dernier ? `Connecteur ${c.nom} : aucun message reçu depuis ${dureeTexte(age)} ; les données qu’il alimente peuvent être périmées.`
        : `Connecteur ${c.nom} : aucun message reçu depuis sa création.`,
      evenement: c.dernier ? 'Dernier message reçu du connecteur' : 'Création du connecteur',
      seuil: { valeur_min: cfg.connecteur_silence_max_min, regle: `Silence maximal configuré (${cfg.connecteur_silence_max_min} min, connecteur_silence_max_min).` },
      cause: { nature: 'hypothese', texte: 'Interruption possible de la synchronisation ; les disponibilités non confirmées ne doivent pas être tenues pour certaines.' },
      action: 'Vérifier la liaison avec l’équipe informatique ; confirmer les disponibilités manuellement en attendant.' });
  }
  return { attendues: att.attendues };
}

/**
 * Capacité réelle (cahier final §6) : chaque catégorie est comptée à part ; un lit vide n'est opérationnel que si sa disponibilité
 * est confirmée et récente ; une sortie prévue reste un lit occupé ; rien n'est estimé ici.
 */
function capaciteReelle(lits, civieres, attendues, cfg) {
  const n = (f) => lits.filter(f).length;
  const confirme = (l) => l.disponibilite_confirmee_le && Number(l.confirmation_min) <= cfg.confirmation_lit_validite_min;
  const dans24h = (l) => l.sortie_prevue && new Date(l.sortie_prevue).getTime() <= Date.now() + 24 * 3600000;
  const c = (etat) => civieres.filter((x) => x.etat === etat).length;
  return {
    lits: { total: lits.length, vides: n((l) => l.etat === 'libre'), operationnels: n((l) => l.etat === 'libre' && confirme(l)),
      non_confirmes: n((l) => l.etat === 'libre' && !confirme(l)), reserves: n((l) => l.etat === 'reserve'), occupes: n((l) => l.etat === 'occupe'),
      sorties_prevues_24h: n((l) => l.etat === 'occupe' && dans24h(l)), nettoyage: n((l) => l.etat === 'nettoyage'), indisponibles: n((l) => l.etat === 'indispo') },
    civieres: { total: civieres.length, libres: c('libre'), occupees: c('occupee'), nettoyage: c('nettoyage'), indisponibles: c('indispo') },
    ambulances_attendues: attendues,
    validite_confirmation_min: cfg.confirmation_lit_validite_min,
  };
}

/** Blocages et alertes explicables de l'établissement (calculés en direct à partir des données enregistrées). */
async function blocages(pool, utilisateur, etabId, { interne = false } = {}) {
  // `interne` : lecture par le suivi périodique des alertes (aucune session ; jamais exposé par une route)
  if (!interne) exigerEtablissement(utilisateur, etabId);
  const cfg = await configEtab(pool, etabId);
  const lits = (await pool.query(
    `SELECT l.id, l.code, l.etat, l.etat_depuis, l.sortie_prevue, l.nettoyage_debut, l.motif_indispo, l.patient_ref,
            l.disponibilite_confirmee_le, u.nom AS unite, ch.numero AS chambre,
            EXTRACT(EPOCH FROM (now() - l.etat_depuis)) / 60 AS age_min,
            EXTRACT(EPOCH FROM (now() - l.sortie_prevue)) / 60 AS retard_min,
            EXTRACT(EPOCH FROM (now() - l.disponibilite_confirmee_le)) / 60 AS confirmation_min,
            tr.numero AS transfert_numero, tr.statut AS transfert_statut,
            d.id AS demande_id, d.provenance AS demande_provenance
       FROM lits l JOIN unites u ON u.id = l.unite_id JOIN chambres ch ON ch.id = l.chambre_id
       LEFT JOIN transferts tr ON tr.id = l.transfert_id
       LEFT JOIN demandes_admission d ON d.lit_id = l.id AND d.statut = 'assignee'
      WHERE l.etablissement_id = $1 AND l.actif`, [etabId])).rows;
  const alertes = [];
  const ajouter = (a) => alertes.push({ etablissement: cfg.nom, actualise_le: new Date().toISOString(), responsable: RESPONSABLES[a.type], ...a });
  for (const l of lits) {
    const age = Number(l.age_min);
    const base = { genre: 'lit', ressource_id: l.id, ressource: l.code, unite: l.unite, chambre: l.chambre, depuis: l.etat_depuis, duree_min: Math.round(age) };
    if (l.etat === 'reserve' && age > cfg.reservation_max_min) {
      const enTransfert = l.transfert_numero && !['recu', 'refuse'].includes(l.transfert_statut);
      ajouter({ ...base, type: 'reservation_prolongee', niveau: enTransfert ? 'faible' : 'eleve',
        titre: `${l.code} — Réservé depuis ${dureeTexte(age)} sans admission enregistrée.`,
        evenement: 'Passage à l’état « réservé »',
        seuil: { valeur_min: cfg.reservation_max_min, regle: 'Réservation plus longue que la durée maximale configurée (config. pays : reservation_max_min).' },
        cause: enTransfert
          ? { nature: 'fait', texte: `Lit réservé pour le transfert ${l.transfert_numero} (statut : ${l.transfert_statut}).` }
          : l.demande_id
            ? { nature: 'fait', texte: `Lit assigné à la demande d’admission n° ${l.demande_id} (${l.demande_provenance}), admission non enregistrée.` }
            : { nature: 'hypothese', texte: 'Réservation locale sans demande liée : le patient est peut-être déjà arrivé sans que l’admission soit saisie, ou la réservation n’est plus utile.' },
        action: enTransfert ? `Suivre le transfert ${l.transfert_numero} dans Transferts.`
          : 'Vérifier auprès de l’équipe responsable si la réservation doit être maintenue ; sinon admettre ou annuler (décision humaine).' });
    } else if (l.etat === 'occupe' && l.sortie_prevue && Number(l.retard_min) > 0) {
      const r = Number(l.retard_min);
      ajouter({ ...base, type: 'conge_retarde', niveau: r > cfg.marge_conge_min ? 'modere' : 'faible', duree_min: Math.round(r), depuis: l.sortie_prevue,
        titre: `${l.code} — Congé prévu dépassé de ${dureeTexte(r)}, départ non enregistré.`,
        evenement: `Congé prévu le ${new Intl.DateTimeFormat(utilisateur.langue === 'en' ? 'en-CA' : 'fr-CA', { timeZone: cfg.fuseau, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(l.sortie_prevue))}`,
        seuil: { valeur_min: 0, marge_min: cfg.marge_conge_min, regle: `Alerte dès l’heure dépassée ; niveau relevé après la marge configurée (${cfg.marge_conge_min} min).` },
        cause: { nature: 'hypothese', texte: 'Départ peut-être fait sans être saisi, ou congé reporté (transport, attente d’un résultat).' },
        action: 'Vérifier avec l’unité : enregistrer le départ, ou mettre à jour le congé (reporté, nouvelle heure). Le lit n’est pas libéré automatiquement.' });
    } else if (l.etat === 'nettoyage' && age > cfg.nettoyage_cible_min) {
      ajouter({ ...base, type: 'nettoyage_en_attente', niveau: age > 2 * cfg.nettoyage_cible_min ? 'modere' : 'faible',
        titre: `${l.code} — En nettoyage depuis ${dureeTexte(age)}${l.nettoyage_debut ? '' : ', nettoyage non commencé'}.`,
        evenement: 'Départ du patient (lit passé au nettoyage)',
        seuil: { valeur_min: cfg.nettoyage_cible_min, regle: 'Durée cible de nettoyage configurée (nettoyage_cible_min).' },
        cause: l.nettoyage_debut ? { nature: 'fait', texte: 'Nettoyage commencé, fin non confirmée.' }
          : { nature: 'fait', texte: 'Aucun début de nettoyage enregistré.' },
        action: 'Confirmer la fin du nettoyage dans l’écran Nettoyage, ou signaler l’empêchement.' });
    } else if (l.etat === 'indispo' && age > cfg.hors_service_max_h * 60) {
      ajouter({ ...base, type: 'hors_service_prolonge', niveau: 'faible',
        titre: `${l.code} — Hors service depuis ${dureeTexte(age)} (motif : ${l.motif_indispo || 'non précisé'}).`,
        evenement: 'Mise hors service',
        seuil: { valeur_min: cfg.hors_service_max_h * 60, regle: `Hors service plus long que ${cfg.hors_service_max_h} h (hors_service_max_h).` },
        cause: { nature: 'fait', texte: `Motif enregistré : ${l.motif_indispo || 'non précisé'}.` },
        action: 'Vérifier si le lit peut être remis en service.' });
    } else if (l.etat === 'libre') {
      const conf = l.disponibilite_confirmee_le ? Number(l.confirmation_min) : null;
      if (conf == null || conf > cfg.confirmation_lit_validite_min) {
        ajouter({ ...base, type: 'disponibilite_perimee', niveau: 'faible', duree_min: conf == null ? Math.round(age) : Math.round(conf),
          depuis: l.disponibilite_confirmee_le || l.etat_depuis,
          titre: conf == null ? `${l.code} — Libre, disponibilité jamais confirmée : invisible pour le réseau.`
            : `${l.code} — Confirmation de disponibilité périmée (${dureeTexte(conf)}).`,
          evenement: conf == null ? 'Lit devenu libre' : 'Dernière confirmation humaine',
          seuil: { valeur_min: cfg.confirmation_lit_validite_min, regle: `Une confirmation reste valable ${cfg.confirmation_lit_validite_min} min (confirmation_lit_validite_min).` },
          cause: { nature: 'fait', texte: 'Le réseau ne propose un lit que si sa disponibilité est confirmée et récente.' },
          action: 'Vérifier physiquement le lit puis « Confirmer la disponibilité ».' });
      }
    }
  }
  const dem = (await pool.query(
    `SELECT d.id, d.patient_ref, d.priorite, d.provenance, d.cree_le, CASE WHEN $3 = 'en' THEN COALESCE(t.nom_en, t.nom) ELSE t.nom END AS type_nom, cv.code AS civiere,
            (SELECT count(*)::int FROM lits l WHERE l.etablissement_id = d.etablissement_id AND l.type_id = d.type_id AND l.actif AND l.etat = 'libre') AS compatibles_ici,
            (SELECT count(*)::int FROM lits l JOIN etablissements e2 ON e2.id = l.etablissement_id JOIN types_unite t2 ON t2.id = l.type_id
              WHERE e2.id <> d.etablissement_id AND e2.actif AND e2.module_actif AND e2.partage <> 'aucun' AND t2.code = t.code AND l.actif AND l.etat = 'libre') AS compatibles_reseau,
            EXTRACT(EPOCH FROM (now() - d.cree_le)) / 60 AS attente_min
       FROM demandes_admission d JOIN types_unite t ON t.id = d.type_id LEFT JOIN civieres cv ON cv.id = d.civiere_id
      WHERE d.etablissement_id = $1 AND d.statut = 'attente' AND d.cree_le < now() - make_interval(mins => $2)`, [etabId, cfg.attente_admission_max_min, utilisateur.langue === 'en' ? 'en' : 'fr'])).rows;
  for (const d of dem) {
    ajouter({ genre: 'demande', ressource_id: d.id, ressource: `Demande n° ${d.id} (${d.patient_ref})`, unite: d.type_nom, chambre: null,
      depuis: d.cree_le, duree_min: Math.round(Number(d.attente_min)), type: 'attente_admission', niveau: 'modere',
      titre: `${d.patient_ref} attend un lit de ${d.type_nom.toLowerCase()} depuis ${dureeTexte(Number(d.attente_min))}${d.civiere ? ` (civière ${d.civiere})` : ''}.`,
      evenement: 'Création de la demande de lit',
      seuil: { valeur_min: cfg.attente_admission_max_min, regle: `Attente maximale configurée (${cfg.attente_admission_max_min} min).` },
      // Règle de compatibilité (cahier nº 19) : distinguer pénurie réelle et problème d'affectation, de préparation ou de répartition
      diagnostic: d.compatibles_ici > 0 ? 'affectation' : d.compatibles_reseau > 0 ? 'repartition' : 'penurie',
      cause: { nature: 'fait', texte: d.compatibles_ici > 0 ? `Aucun lit assigné alors que des lits du même type sont libres ici (${d.compatibles_ici}) : problème d’affectation ou de préparation.`
        : d.compatibles_reseau > 0 ? `Aucun lit du même type libre ici ; lits libres ailleurs dans le réseau : ${d.compatibles_reseau} : problème de répartition.`
          : 'Aucun lit du même type libre ici ni dans le réseau partagé : pénurie réelle.' },
      action: 'Assigner un lit compatible, ou chercher ailleurs (Réseau) ; la décision reste humaine.' });
  }
  const civ = (await pool.query(
    `SELECT cv.id, cv.code, cv.etat, cv.etat_depuis, cv.patient_ref, cv.arrivee_le, cv.categorie,
            EXTRACT(EPOCH FROM (now() - cv.etat_depuis)) / 60 AS age_min,
            EXTRACT(EPOCH FROM (now() - cv.arrivee_le)) / 60 AS presence_min,
            EXISTS (SELECT 1 FROM demandes_admission d WHERE d.civiere_id = cv.id AND d.statut IN ('attente', 'assignee')) AS a_demande
       FROM civieres cv WHERE cv.etablissement_id = $1 AND cv.actif`, [etabId])).rows;
  for (const c of civ) {
    const base = { genre: 'civiere', ressource_id: c.id, ressource: c.code, unite: 'Urgence', chambre: null };
    if (c.etat === 'nettoyage' && Number(c.age_min) > cfg.nettoyage_civiere_cible_min) {
      ajouter({ ...base, type: 'civiere_nettoyage', niveau: 'faible', depuis: c.etat_depuis, duree_min: Math.round(Number(c.age_min)),
        titre: `Civière ${c.code} — en nettoyage depuis ${dureeTexte(Number(c.age_min))}.`, evenement: 'Départ du patient de la civière',
        seuil: { valeur_min: cfg.nettoyage_civiere_cible_min, regle: 'Durée cible de nettoyage d’une civière (nettoyage_civiere_cible_min).' },
        cause: { nature: 'fait', texte: 'Fin du nettoyage non confirmée.' }, action: 'Confirmer le nettoyage de la civière.' });
    } else if (c.etat === 'occupee' && !c.a_demande && Number(c.presence_min) > 24 * 60) {
      ajouter({ ...base, type: 'civiere_sans_demande', niveau: 'faible', depuis: c.arrivee_le, duree_min: Math.round(Number(c.presence_min)),
        titre: `Civière ${c.code} — ${c.patient_ref} présent depuis ${dureeTexte(Number(c.presence_min))}, sans demande de lit.`,
        evenement: 'Arrivée sur civière',
        seuil: { valeur_min: 24 * 60, regle: 'Présence de plus de 24 h sans demande de lit enregistrée.' },
        cause: { nature: 'hypothese', texte: 'Une longue présence n’indique pas à elle seule une hospitalisation : à interpréter par l’équipe de l’urgence.' },
        action: 'Faire valider par l’équipe compétente si une demande de lit est nécessaire.' });
    }
  }
  const { attendues } = await transversales(pool, utilisateur, etabId, cfg, ajouter);
  // Dernier événement enregistré pour chaque ressource signalée
  const litsIds = alertes.filter((a) => a.genre === 'lit').map((a) => a.ressource_id);
  const civIds = alertes.filter((a) => a.genre === 'civiere').map((a) => a.ressource_id);
  const ev = (await pool.query(
    `SELECT DISTINCT ON (COALESCE(lit_id, -civiere_id)) lit_id, civiere_id, date, action, detail, ancien_etat, nouvel_etat
       FROM journal WHERE (lit_id = ANY($1::int[]) OR civiere_id = ANY($2::int[])) AND NOT refuse
      ORDER BY COALESCE(lit_id, -civiere_id), date DESC`, [litsIds, civIds])).rows;
  for (const a of alertes) {
    const e = ev.find((x) => (a.genre === 'lit' ? x.lit_id === a.ressource_id : a.genre === 'civiere' && x.civiere_id === a.ressource_id));
    a.dernier_evenement = e ? { date: e.date, action: e.action, detail: e.detail } : null;
  }
  if (!interne) await require('./suivi-alertes').pourAlertes(pool, etabId, alertes);
  const rang = { eleve: 0, modere: 1, faible: 2 };
  alertes.sort((a, b) => rang[a.niveau] - rang[b.niveau] || b.duree_min - a.duree_min);
  return require('./vigilance-en').traduire({
    etablissement: cfg.nom, alertes, capacite: capaciteReelle(lits, civ, attendues, cfg),
    par_type: alertes.reduce((m, a) => ({ ...m, [a.type]: (m[a.type] || 0) + 1 }), {}),
    regles_couleurs: {
      eleve: 'Rouge : bloque une admission ou un transfert (réservation sans suite, demande prioritaire en attente au-delà du seuil).',
      modere: 'Orange : retard au-delà de la marge configurée (congé, nettoyage deux fois plus long que la cible, attente).',
      faible: 'Jaune : à vérifier (seuil atteint, sans effet bloquant établi).',
    },
    ...(await fraicheur(pool)),
  }, utilisateur.langue);
}

/** Enregistre l'exécution du contrôle périodique (heure réelle, durée, nombre de changements). */
async function noterControle(pool, nom, debut, resultat) {
  await pool.query(`INSERT INTO controles (nom, execute_le, duree_ms, resultat) VALUES ($1, now(), $2, $3)
    ON CONFLICT (nom) DO UPDATE SET execute_le = now(), duree_ms = EXCLUDED.duree_ms, resultat = EXCLUDED.resultat`,
  [nom, Date.now() - debut, resultat]);
}

module.exports = { conges, blocages, fraicheur, noterControle, STATUTS_OUVERTS, dureeTexte };
