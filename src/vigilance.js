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
};

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
  return {
    etablissement: cfg.nom, filtres: { horizon, jour: f.jour || null, unite: f.unite ? Number(f.unite) : null, statut: f.statut || null },
    lignes: filtrees,
    resume, retards: lignes.filter((x) => x.verification).length,
    regles: {
      deterministe: 'Les congés listés sont des événements enregistrés (saisie ou interface autorisée). Un congé prévu n’est pas un lit libre.',
      retard: 'Heure prévue dépassée sans départ enregistré : vérification nécessaire. Le lit n’est jamais libéré automatiquement.',
      estimation: 'Les prévisions statistiques (OG, Prévisions) sont séparées : elles s’appuient sur l’historique et donnent une marge.',
    },
    ...(await fraicheur(pool)),
  };
}

/** Durée lisible pour les textes d'alerte. */
function dureeTexte(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60); const r = m % 60;
  if (h < 48) return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
}

/** Blocages et alertes explicables de l'établissement (calculés en direct à partir des données enregistrées). */
async function blocages(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
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
        evenement: `Congé prévu le ${new Intl.DateTimeFormat('fr-CA', { timeZone: cfg.fuseau, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(l.sortie_prevue))}`,
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
    `SELECT d.id, d.patient_ref, d.priorite, d.provenance, d.cree_le, t.nom AS type_nom, cv.code AS civiere,
            EXTRACT(EPOCH FROM (now() - d.cree_le)) / 60 AS attente_min
       FROM demandes_admission d JOIN types_unite t ON t.id = d.type_id LEFT JOIN civieres cv ON cv.id = d.civiere_id
      WHERE d.etablissement_id = $1 AND d.statut = 'attente' AND d.cree_le < now() - make_interval(mins => $2)`, [etabId, cfg.attente_admission_max_min])).rows;
  for (const d of dem) {
    ajouter({ genre: 'demande', ressource_id: d.id, ressource: `Demande n° ${d.id} (${d.patient_ref})`, unite: d.type_nom, chambre: null,
      depuis: d.cree_le, duree_min: Math.round(Number(d.attente_min)), type: 'attente_admission', niveau: d.priorite === 'p1' ? 'eleve' : 'modere',
      titre: `${d.patient_ref} attend un lit de ${d.type_nom.toLowerCase()} depuis ${dureeTexte(Number(d.attente_min))}${d.civiere ? ` (civière ${d.civiere})` : ''}.`,
      evenement: 'Création de la demande de lit',
      seuil: { valeur_min: cfg.attente_admission_max_min, regle: `Attente maximale configurée (${cfg.attente_admission_max_min} min).` },
      cause: { nature: 'fait', texte: 'Aucun lit compatible assigné à cette demande.' },
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
  const rang = { eleve: 0, modere: 1, faible: 2 };
  alertes.sort((a, b) => rang[a.niveau] - rang[b.niveau] || b.duree_min - a.duree_min);
  return {
    etablissement: cfg.nom, alertes,
    par_type: alertes.reduce((m, a) => ({ ...m, [a.type]: (m[a.type] || 0) + 1 }), {}),
    regles_couleurs: {
      eleve: 'Rouge : bloque une admission ou un transfert (réservation sans suite, demande prioritaire en attente au-delà du seuil).',
      modere: 'Orange : retard au-delà de la marge configurée (congé, nettoyage deux fois plus long que la cible, attente).',
      faible: 'Jaune : à vérifier (seuil atteint, sans effet bloquant établi).',
    },
    ...(await fraicheur(pool)),
  };
}

/** Enregistre l'exécution du contrôle périodique (heure réelle, durée, nombre de changements). */
async function noterControle(pool, nom, debut, resultat) {
  await pool.query(`INSERT INTO controles (nom, execute_le, duree_ms, resultat) VALUES ($1, now(), $2, $3)
    ON CONFLICT (nom) DO UPDATE SET execute_le = now(), duree_ms = EXCLUDED.duree_ms, resultat = EXCLUDED.resultat`,
  [nom, Date.now() - debut, resultat]);
}

module.exports = { conges, blocages, fraicheur, noterControle, STATUTS_OUVERTS, dureeTexte };
