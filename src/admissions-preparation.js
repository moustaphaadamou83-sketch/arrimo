'use strict';
/**
 * Liste de préparation des admissions (limite du chantier coordination, cahier nº 2 « Admissions » ; 26 nov. 2026).
 * Pour chaque demande d'admission en attente ou assignée : ce qui est fait, ce qui reste, dans l'ordre réel du parcours.
 * Lecture seule ; chaque condition est un fait enregistré (`null` = inconnu, jamais « fait »). Aucune assignation automatique.
 *   1. priorité validée · 2. lit compatible libre (même type, âge et besoins) · 3. lit assigné · 4. chambre prête (lit réservé, aucune
 *   préparation ni nettoyage ouvert) · 5. plan B si aucun lit compatible ici (transfert demandé).
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const { sqlBesoins, sqlAge } = require('./services');

function etapes(d) {
  const e = [
    { code: 'priorite_validee', ok: !!d.priorite_validee_le },
    { code: 'lit_compatible', ok: d.lit_id ? true : d.compatibles > 0, n: d.compatibles },
    { code: 'lit_assigne', ok: !!d.lit_id },
    { code: 'chambre_prete', ok: d.lit_id ? (d.lit_etat === 'reserve' && !d.preparation_ouverte && !d.nettoyage_ouvert) : null },
  ];
  if (!d.lit_id && d.compatibles === 0) e.push({ code: 'plan_b', ok: !!d.transfert_id });
  const restantes = e.filter((x) => x.ok !== true).map((x) => x.code);
  return { etapes: e, restantes, prochaine: restantes[0] || null, prete: restantes.length === 0 };
}

async function liste(pool, u, q = {}) {
  const etabId = Number(q.etablissement_id); if (!Number.isSafeInteger(etabId) || etabId < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, etabId);
  const ds = (await pool.query(`SELECT d.id, d.patient_ref, d.priorite_affichage, d.statut, d.type_id, d.groupe_age, d.lit_id, d.transfert_id, d.cree_le, d.priorite_validee_le,
      d.besoin_isolement AS isolement, d.besoin_pression_negative AS pression_negative, d.besoin_ventilation AS ventilation, d.besoin_telemetrie AS telemetrie,
      l.etat AS lit_etat, l.code AS lit_code,
      EXISTS (SELECT 1 FROM taches_etab t WHERE t.lit_id = d.lit_id AND t.type = 'preparation_chambre' AND t.statut IN ('a_faire', 'en_cours')) AS preparation_ouverte,
      EXISTS (SELECT 1 FROM nettoyage_interventions n WHERE n.lit_id = d.lit_id AND n.statut IN ('en_cours', 'controle_requis')) AS nettoyage_ouvert
    FROM (SELECT x.*, COALESCE(x.priorite_libelle, upper(x.priorite)) AS priorite_affichage FROM demandes_admission x) d LEFT JOIN lits l ON l.id = d.lit_id
    WHERE d.etablissement_id = $1 AND d.statut IN ('attente', 'assignee') ORDER BY COALESCE(d.priorite_rang, 99), d.cree_le`, [etabId])).rows;
  for (const d of ds) {
    if (d.lit_id) { d.compatibles = null; continue; }
    const filtre = sqlBesoins({ isolement: d.isolement, pression_negative: d.pression_negative, ventilation: d.ventilation, telemetrie: d.telemetrie }) + sqlAge('l', d.groupe_age);
    d.compatibles = (await pool.query(`SELECT count(*)::int AS n FROM lits l WHERE l.etablissement_id = $1 AND l.type_id = $2 AND l.actif AND l.etat = 'libre'${filtre}`,
      [etabId, d.type_id])).rows[0].n;
  }
  const lignes = ds.map((d) => ({ id: d.id, patient_ref: d.patient_ref, priorite: d.priorite_affichage, statut: d.statut, lit: d.lit_code || null, cree_le: d.cree_le, ...etapes(d) }));
  return { etablissement_id: etabId, demandes: lignes, pretes: lignes.filter((l) => l.prete).length,
    regle: u.langue === 'en' ? 'Each step is a recorded fact; unknown is never counted as done. Nothing is assigned automatically.'
      : 'Chaque étape est un fait enregistré ; l’inconnu n’est jamais compté comme fait. Rien n’est assigné automatiquement.' };
}

module.exports = { liste, etapes };
