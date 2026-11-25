'use strict';
/**
 * Blocages en cascade (cahier final §17 ; cahier « optimisation transversale » §12), chantier B, 26 nov. 2026.
 * Chaîne remontée à partir de faits enregistrés : ambulance à la porte → civières occupées par des patients qui attendent un lit →
 * lits du même type occupés par des patients NSA → état de leur placement (aucune demande, en attente, accepté sans départ).
 * Chaque lien porte sa nature : « fait » (lien direct enregistré : la demande de lit référence la civière, le placement référence le lit)
 * ou « hypothese » (même type d'unité, sans lien direct). Aucune corrélation n'est présentée comme une cause démontrée ; rien n'est modifié.
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');

async function analyser(pool, u, q = {}) {
  const etabId = Number(q.etablissement_id); if (!Number.isSafeInteger(etabId) || etabId < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, etabId);
  if (u.role === 'entretien') throw new ErreurHttp(403, 'role_insuffisant');
  const en = u.langue === 'en'; const L = (fr, eng) => (en ? eng : fr);
  const noeuds = []; const liens = [];
  const ajouter = (n) => { if (!noeuds.some((x) => x.id === n.id)) noeuds.push(n); return n.id; };
  // 1. Ambulances à la porte (Chrono) sans remise
  const porte = (await pool.query(`SELECT p.id, un.numero, EXTRACT(EPOCH FROM (now() - h.heure)) / 60 AS min FROM passages_chrono p JOIN unites_secours un ON un.id = p.unite_id
      JOIN v_horodatages_courants h ON h.objet = 'passage_chrono' AND h.objet_id = p.id AND h.etape = 'H11'
     WHERE p.etablissement_id = $1 AND p.statut = 'a_la_porte' AND NOT EXISTS (SELECT 1 FROM v_horodatages_courants r WHERE r.objet = 'passage_chrono' AND r.objet_id = p.id AND r.etape = 'H14')`, [etabId])).rows;
  const { rows: [civ] } = await pool.query(`SELECT count(*) FILTER (WHERE etat = 'libre')::int AS libres, count(*) FILTER (WHERE etat = 'occupee')::int AS occupees FROM civieres WHERE etablissement_id = $1 AND actif`, [etabId]);
  // 2. Patients sur civière qui attendent un lit (lien direct demande → civière)
  const attentes = (await pool.query(`SELECT d.id, d.patient_ref, d.type_id, t.nom AS type_nom, cv.code AS civiere, EXTRACT(EPOCH FROM (now() - d.cree_le)) / 60 AS min,
      (SELECT count(*)::int FROM lits l WHERE l.etablissement_id = d.etablissement_id AND l.type_id = d.type_id AND l.actif AND l.etat = 'libre') AS libres_type
    FROM demandes_admission d JOIN types_unite t ON t.id = d.type_id LEFT JOIN civieres cv ON cv.id = d.civiere_id
   WHERE d.etablissement_id = $1 AND d.statut = 'attente' ORDER BY d.cree_le LIMIT 20`, [etabId])).rows;
  for (const p of porte) {
    const a = ajouter({ id: `passage:${p.id}`, genre: 'ambulance', libelle: L(`Ambulance ${p.numero} à la porte depuis ${Math.round(p.min)} min`, `Ambulance ${p.numero} at the door for ${Math.round(p.min)} min`) });
    if (civ.libres === 0) {
      const c = ajouter({ id: 'civieres', genre: 'civieres', libelle: L(`Aucune civière libre (${civ.occupees} occupées)`, `No free stretcher (${civ.occupees} occupied)`) });
      liens.push({ de: a, vers: c, nature: 'hypothese', explication: L('La remise attend une civière ; aucune n’est libre (lien non enregistré pour ce passage).', 'Handover waits for a stretcher; none is free (link not recorded for this visit).') });
    }
  }
  for (const d of attentes.filter((x) => x.civiere)) {
    const n = ajouter({ id: `demande:${d.id}`, genre: 'attente_lit', libelle: L(`${d.patient_ref} sur la civière ${d.civiere} attend un lit de ${d.type_nom.toLowerCase()} (${Math.round(d.min)} min)`, `${d.patient_ref} on stretcher ${d.civiere} waits for a ${d.type_nom.toLowerCase()} bed (${Math.round(d.min)} min)`) });
    if (noeuds.some((x) => x.id === 'civieres')) liens.push({ de: 'civieres', vers: n, nature: 'fait', explication: L('La demande de lit référence cette civière.', 'The bed request references this stretcher.') });
    if (d.libres_type > 0) { liens.push({ de: n, vers: ajouter({ id: `affectation:${d.type_id}`, genre: 'racine', racine: 'affectation', libelle: L(`${d.libres_type} lit(s) du même type libre(s) : problème d’affectation ou de préparation`, `${d.libres_type} free bed(s) of the same type: assignment or preparation issue`) }), nature: 'fait', explication: L('Comptage des lits libres du même type.', 'Count of free beds of the same type.') }); continue; }
    // 3. Lits du même type occupés par des patients NSA, et leur placement (lien direct placement → lit)
    const nsa = (await pool.query(`SELECT ep.id, ep.lit_id, l.code, ep.patient_ref, floor(EXTRACT(EPOCH FROM (now() - ep.debut_le)) / 86400)::int AS jours,
        (SELECT dh.statut FROM demandes_hebergement dh WHERE dh.hopital_lit_id = ep.lit_id AND dh.hopital_id = ep.etablissement_id AND dh.statut NOT IN ('refusee', 'annulee') ORDER BY dh.id DESC LIMIT 1) AS placement,
        (SELECT dh.numero FROM demandes_hebergement dh WHERE dh.hopital_lit_id = ep.lit_id AND dh.hopital_id = ep.etablissement_id AND dh.statut NOT IN ('refusee', 'annulee') ORDER BY dh.id DESC LIMIT 1) AS numero
      FROM nsa_episodes ep JOIN lits l ON l.id = ep.lit_id WHERE ep.etablissement_id = $1 AND ep.statut = 'actif' AND l.type_id = $2 ORDER BY ep.debut_le LIMIT 5`, [etabId, d.type_id])).rows;
    if (!nsa.length) { liens.push({ de: n, vers: ajouter({ id: `penurie:${d.type_id}`, genre: 'racine', racine: 'penurie_locale', libelle: L('Aucun lit du même type libre ni occupé par un patient NSA : capacité locale insuffisante (à confirmer)', 'No free bed of the same type and none held by an ALC patient: insufficient local capacity (to confirm)') }), nature: 'hypothese', explication: L('Constat local ; voir le réseau.', 'Local finding; check the network.') }); continue; }
    for (const e of nsa) {
      const ln = ajouter({ id: `nsa:${e.id}`, genre: 'lit_nsa', libelle: L(`Lit ${e.code} occupé par un patient NSA depuis ${e.jours} j`, `Bed ${e.code} held by an ALC patient for ${e.jours} d`) });
      liens.push({ de: n, vers: ln, nature: 'hypothese', explication: L('Même type d’unité : ce lit pourrait accueillir la demande s’il était libéré.', 'Same unit type: this bed could take the request if freed.') });
      const racine = !e.placement ? ['sans_demande', L('Aucune demande de placement', 'No placement request')]
        : e.placement === 'acceptee' ? ['depart_a_organiser', L(`Placement ${e.numero} accepté, départ à organiser`, `Placement ${e.numero} accepted, departure to arrange`)]
          : ['attente_reponse', L(`Placement ${e.numero} en attente (${e.placement})`, `Placement ${e.numero} pending (${e.placement})`)];
      liens.push({ de: ln, vers: ajouter({ id: `placement:${e.id}`, genre: 'racine', racine: racine[0], libelle: racine[1] }), nature: 'fait', explication: L('État du placement lié à ce lit.', 'State of the placement linked to this bed.') });
    }
  }
  const racines = noeuds.filter((x) => x.genre === 'racine');
  return { etablissement_id: etabId, noeuds, liens, racines,
    regle: L('Lien « fait » : relation enregistrée. Lien « hypothèse » : même type d’unité, à vérifier. Aucune corrélation n’est présentée comme une cause démontrée.',
      '“Fact” link: recorded relation. “Hypothesis” link: same unit type, to check. No correlation is presented as a proven cause.') };
}

module.exports = { analyser };
