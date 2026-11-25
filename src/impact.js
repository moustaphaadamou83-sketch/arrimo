'use strict';
/**
 * Pilotage « Impact et rentabilité » (refonte unifiée, 26 nov. 2026) : les cinq piliers commerciaux d'Arrimo — temps, argent,
 * coordination, gestion, information — sur une période et une période de référence de même durée.
 * Chaque valeur porte sa NATURE : « mesure » (heures enregistrées), « estimation » (mesure × paramètre économique configuré par
 * l'établissement), « constate » (économie saisie avec justificatif). Une estimation n'est jamais présentée comme une économie réelle ;
 * sans paramètre, la valeur financière est « non calculée ». Les gains observés ne sont pas attribués automatiquement à Arrimo.
 * Universel : devise libre (CAD, XOF, EUR…) ; un module absent (Chrono, NSA…) donne « non mesurable », jamais 0.
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const ind = require('./coordination-indicateurs');

const LECTURE = ['coordonnateur', 'gestionnaire', 'admin_etab'];
const ECRITURE = ['gestionnaire', 'admin_etab'];
const CLES = ['cout_heure_ambulance', 'cout_journee_hospitalisation', 'cout_heure_administrative', 'minutes_par_suivi_automatise'];
const CATEGORIES = ['heures_ambulancieres', 'journees_nsa', 'capacite', 'administratif', 'autre'];
const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const r1 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10);
const val = (valeur, unite, nature, source, extra = {}) => ({ valeur: valeur == null ? null : r1(valeur), unite, nature, source, ...extra });

async function parametres(db, etabId) {
  const rows = (await db.query('SELECT cle, valeur::float AS valeur, devise, source, modifie_le FROM parametres_economiques WHERE etablissement_id = $1', [etabId])).rows;
  return Object.fromEntries(rows.map((r) => [r.cle, r]));
}

async function periodeMesures(db, etabId, { debut, fin }) {
  const p = [etabId, debut, fin];
  const { rows: [c] } = await db.query(`WITH h AS (
      SELECT pc.id, max(v.heure) FILTER (WHERE v.etape = 'H11') AS h11, max(v.heure) FILTER (WHERE v.etape = 'H15') AS h15
        FROM passages_chrono pc JOIN v_horodatages_courants v ON v.objet = 'passage_chrono' AND v.objet_id = pc.id WHERE pc.etablissement_id = $1 GROUP BY pc.id)
    SELECT count(*)::int AS n, sum(GREATEST(0, EXTRACT(EPOCH FROM (h15 - h11)) / 60 - COALESCE(cfg.objectif_liberation_min, 30)))::float / 60 AS heures_au_dela
      FROM h, etablissements e LEFT JOIN config_pays cfg ON cfg.id = e.config_id WHERE e.id = $1 AND h11 >= $2 AND h11 < $3 AND h15 >= h11 GROUP BY cfg.objectif_liberation_min`, p);
  const { rows: [nsa] } = await db.query(`SELECT count(*)::int AS sorties, avg(EXTRACT(EPOCH FROM (fin_le - debut_le)) / 86400)::float AS duree_moyenne_j
    FROM nsa_episodes WHERE etablissement_id = $1 AND statut = 'parti' AND fin_le >= $2 AND fin_le < $3`, p);
  const { rows: [lib] } = await db.query(`SELECT count(*)::int AS n FROM demandes_hebergement WHERE hopital_id = $1 AND depart_hopital_le >= $2 AND depart_hopital_le < $3`, p);
  const { rows: [auto] } = await db.query(`SELECT count(*)::int AS n FROM suivis_alertes WHERE etablissement_id = $1 AND cree_le >= $2 AND cree_le < $3`, p);
  const { rows: [pa] } = await db.query(`SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (recue_le - cree_le)) / 60))::numeric, 1)::float AS mediane
    FROM prealertes WHERE destination_id = $1 AND recue_le IS NOT NULL AND cree_le >= $2 AND cree_le < $3`, p);
  return { chrono: c || { n: 0, heures_au_dela: null }, nsa, lits_liberes: lib.n, suivis_automatises: auto.n, prealerte_reception_mediane_min: pa.mediane };
}

async function tableau(pool, u, q = {}) {
  const etabId = entier(q.etablissement_id); if (!etabId) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, etabId);
  if (!LECTURE.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const per = ind.periodes(q);
  const [coord, mC, mR, prm] = await Promise.all([ind.indicateurs(pool, u, { ...q, etablissement_id: etabId }),
    periodeMesures(pool, etabId, per.courante), periodeMesures(pool, etabId, per.reference), parametres(pool, etabId)]);
  const coordC = coord.courante; const coordR = coord.reference;
  const diff = (ref, cur) => (ref == null || cur == null ? null : ref - cur);   // positif = amélioration observée
  // Temps
  const heuresRecuperees = mC.chrono.n && mR.chrono.n ? Math.max(0, diff(mR.chrono.heures_au_dela, mC.chrono.heures_au_dela)) : null;
  const joursNsaEvites = mC.nsa.sorties && mR.nsa.duree_moyenne_j != null && mC.nsa.duree_moyenne_j != null
    ? Math.max(0, (mR.nsa.duree_moyenne_j - mC.nsa.duree_moyenne_j) * mC.nsa.sorties) : null;
  const tempsAdminH = prm.minutes_par_suivi_automatise ? (mC.suivis_automatises * prm.minutes_par_suivi_automatise.valeur) / 60 : null;
  // Argent : estimation = mesure × paramètre ; constaté = saisi avec justificatif
  const estim = (qte, cle) => (qte == null || !prm[cle] ? null : qte * prm[cle].valeur);
  const devise = prm.cout_heure_ambulance?.devise || prm.cout_journee_hospitalisation?.devise || prm.cout_heure_administrative?.devise || null;
  const constatees = (await pool.query(`SELECT categorie, devise, sum(montant)::float AS montant FROM economies_constatees WHERE etablissement_id = $1
      AND periode_debut < $3::date AND periode_fin >= $2::date GROUP BY categorie, devise`, [etabId, per.courante.debut, per.courante.fin])).rows;
  const en = u.langue === 'en'; const L = (fr, eng) => (en ? eng : fr);
  const sources = { chrono: L('Chrono (H11 → H15) au-delà de l’objectif de libération', 'Chrono (H11 → H15) beyond the release target'), nsa: L('Épisodes NSA terminés', 'Completed ALC episodes'),
    transferts: L('Transferts (demande → réponse)', 'Transfers (request → response)'), suivis: L('Suivis d’alertes ouverts automatiquement', 'Alert follow-ups opened automatically'),
    lits: L('Départs après placement', 'Departures after placement'), prealertes: L('Préalertes (envoi → réception)', 'Pre-alerts (sent → received)'), alertes: L('Suivis d’alertes', 'Alert follow-ups') };
  const U = { jours: L('jours', 'days'), lits: L('lits', 'beds'), alertes: L('alertes', 'alerts') };
  const piliers = {
    temps: {
      heures_ambulancieres_recuperees: val(heuresRecuperees, 'h', 'mesure', sources.chrono, { reference: r1(mR.chrono.heures_au_dela), courante: r1(mC.chrono.heures_au_dela) }),
      journees_nsa_evitees: val(joursNsaEvites, U.jours, 'estimation', sources.nsa, { regle: L('écart de durée moyenne NSA × sorties de la période', 'difference in mean ALC length × discharges in the period') }),
      delai_reponse_transfert_reduit_min: val(diff(coordR.transferts.reponse_mediane_min, coordC.transferts.reponse_mediane_min), 'min', 'mesure', sources.transferts),
    },
    argent: {
      valeur_heures_ambulancieres: val(estim(heuresRecuperees, 'cout_heure_ambulance'), devise, 'estimation', L('heures récupérées × coût horaire configuré', 'hours recovered × configured hourly cost'), { parametre: prm.cout_heure_ambulance || null }),
      valeur_journees_nsa: val(estim(joursNsaEvites, 'cout_journee_hospitalisation'), devise, 'estimation', L('journées évitées × coût journalier configuré', 'days avoided × configured daily cost'), { parametre: prm.cout_journee_hospitalisation || null }),
      valeur_temps_administratif: val(estim(tempsAdminH, 'cout_heure_administrative'), devise, 'estimation', L('temps administratif × coût horaire configuré', 'administrative time × configured hourly cost'), { parametre: prm.cout_heure_administrative || null }),
      economies_constatees: { nature: 'constate', lignes: constatees, regle: L('Seules ces économies, saisies avec justificatif, sont des économies réelles.', 'Only these savings, entered with supporting evidence, are real savings.') },
    },
    coordination: {
      transferts_realises_pct: val(coordC.transferts.taux_realises_pct, '%', 'mesure', sources.transferts),
      alertes_resolues: val(coordC.alertes.resolues_confirmees, U.alertes, 'mesure', sources.alertes),
      delai_resolution_alertes_min: val(coordC.alertes.resolution_mediane_min, 'min', 'mesure', sources.alertes),
    },
    gestion: {
      capacites_recuperees_lits: val(mC.lits_liberes, U.lits, 'mesure', sources.lits, { reference: mR.lits_liberes }),
      temps_administratif_economise_h: val(tempsAdminH, 'h', 'estimation', sources.suivis, { parametre: prm.minutes_par_suivi_automatise || null }),
    },
    information: {
      reception_prealerte_mediane_min: val(mC.prealerte_reception_mediane_min, 'min', 'mesure', sources.prealertes, { reference: mR.prealerte_reception_mediane_min }),
      delai_accuse_alertes_min: val(coordC.alertes.accuse_mediane_min, 'min', 'mesure', sources.alertes),
    },
  };
  return { etablissement_id: etabId, periode: per.courante, periode_reference: per.reference, piliers, devise,
    avertissement: u.langue === 'en' ? 'Measured, estimated and confirmed values are shown separately. Estimates are not savings. Observed improvements are not attributed to Arrimo without an evaluation method.'
      : 'Valeurs mesurées, estimées et constatées affichées séparément. Une estimation n’est pas une économie. Les améliorations observées ne sont pas attribuées à Arrimo sans méthode d’évaluation.' };
}

async function lireParametres(pool, u, q = {}) {
  const etabId = entier(q.etablissement_id); if (!etabId) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, etabId); if (!LECTURE.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  return { cles: CLES, valeurs: await parametres(pool, etabId) };
}
async function enregistrerParametre(pool, u, b = {}) {
  const etabId = entier(b.etablissement_id); if (!etabId) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, etabId); if (!ECRITURE.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  if (!CLES.includes(b.cle)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'cle' });
  const v = Number(b.valeur); if (!(v >= 0 && v < 1e9)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'valeur' });
  const devise = String(b.devise || 'CAD').toUpperCase(); if (!/^[A-Z]{3}$/.test(devise)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'devise' });
  const source = String(b.source || '').trim(); if (source.length < 2 || source.length > 200) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'source' });
  await pool.query(`INSERT INTO parametres_economiques (etablissement_id, cle, valeur, devise, source, modifie_par) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (etablissement_id, cle) DO UPDATE SET valeur = EXCLUDED.valeur, devise = EXCLUDED.devise, source = EXCLUDED.source, modifie_par = EXCLUDED.modifie_par, modifie_le = now()`,
  [etabId, b.cle, v, devise, source, u.id]);
  await pool.query(`INSERT INTO journal_admin (utilisateur_id, etablissement_id, action, cible, detail) VALUES ($1, $2, 'Paramètre économique', $3, $4)`, [u.id, etabId, b.cle, `${v} ${devise} · ${source}`]);
  return lireParametres(pool, u, { etablissement_id: etabId });
}
async function constater(pool, u, b = {}) {
  const etabId = entier(b.etablissement_id); if (!etabId) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, etabId); if (!ECRITURE.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  if (!CATEGORIES.includes(b.categorie)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'categorie' });
  const m = Number(b.montant); if (!(m >= 0 && m < 1e12)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'montant' });
  const devise = String(b.devise || '').toUpperCase(); if (!/^[A-Z]{3}$/.test(devise)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'devise' });
  const j = String(b.justificatif || '').trim(); if (j.length < 5 || j.length > 300) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'justificatif' });
  const d = new Date(b.periode_debut); const f = new Date(b.periode_fin);
  if (Number.isNaN(d.getTime()) || Number.isNaN(f.getTime()) || f < d) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'periode_fin' });
  const { rows: [x] } = await pool.query(`INSERT INTO economies_constatees (etablissement_id, periode_debut, periode_fin, categorie, montant, devise, justificatif, saisi_par)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`, [etabId, d, f, b.categorie, m, devise, j, u.id]);
  await pool.query(`INSERT INTO journal_admin (utilisateur_id, etablissement_id, action, cible, detail) VALUES ($1, $2, 'Économie constatée', $3, $4)`, [u.id, etabId, b.categorie, `${m} ${devise} · ${j}`]);
  return { ...x, id: Number(x.id) };
}

async function csv(pool, u, q = {}) {
  const t = await tableau(pool, u, q);
  const champ = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lignes = [];
  for (const [pilier, x] of Object.entries(t.piliers)) for (const [k, v] of Object.entries(x)) if (v && v.nature !== 'constate') lignes.push([pilier, k, v.valeur, v.unite, v.nature, v.source].map(champ).join(';'));
  for (const l of t.piliers.argent.economies_constatees.lignes) lignes.push(['argent', `economie_constatee_${l.categorie}`, l.montant, l.devise, 'constate', 'saisie avec justificatif'].map(champ).join(';'));
  await pool.query(`INSERT INTO journal_admin (utilisateur_id, etablissement_id, action, cible) VALUES ($1, $2, 'Export Impact et rentabilité', $3)`, [u.id, t.etablissement_id, `${lignes.length} lignes`]);
  return `﻿${['pilier;indicateur;valeur;unite;nature;source', ...lignes].join('\r\n')}\r\n`;
}

module.exports = { tableau, lireParametres, enregistrerParametre, constater, csv, CLES, CATEGORIES };
