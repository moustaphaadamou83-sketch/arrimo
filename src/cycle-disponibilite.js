'use strict';
/**
 * Cycle de disponibilité commun en 10 états (cahier final « coordination anticipative », nº 15, 26 nov. 2026).
 * VUE DÉRIVÉE, en lecture seule : l'état réel d'un lit reste celui de `src/regles.js` (libre, réservé, occupé, nettoyage, indisponible),
 * seul endroit qui le change. Le cycle l'enrichit avec des faits déjà enregistrés :
 *   occupee → liberation_previsionnelle (congé prévu ou confirmé) → liberee (en nettoyage, intervention non commencée)
 *   → nettoyage (intervention en cours ou contrôle requis) → preparation (tâche « préparation de chambre » ouverte)
 *   → prete (libre, disponibilité non confirmée récemment) → confirmee (libre, confirmée dans le délai configuré)
 *   → attribuee (réservée) → occupee ; indisponible à part.
 * « prête » ne veut pas dire « disponible confirmée » : seule une confirmation récente, datée et attribuée, donne « confirmée ».
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');

const ETATS = ['occupee', 'liberation_previsionnelle', 'liberee', 'nettoyage', 'preparation', 'prete', 'confirmee', 'attribuee', 'indisponible'];
// Le cahier compte 10 étapes en bouclant sur « occupée » ; 9 états distincts (occupée apparaît au début et à la fin du cycle).

/** État du cycle d'un lit à partir de son état réel et des faits liés. */
function etatCycle(l, validiteMin) {
  if (l.etat === 'indispo') return 'indisponible';
  if (l.etat === 'reserve') return 'attribuee';
  if (l.etat === 'occupe') return l.conge_ouvert ? 'liberation_previsionnelle' : 'occupee';
  if (l.etat === 'nettoyage') return l.intervention_ouverte ? 'nettoyage' : 'liberee';
  if (l.etat === 'libre') {
    if (l.preparation_ouverte) return 'preparation';
    return l.confirmation_min != null && Number(l.confirmation_min) <= validiteMin ? 'confirmee' : 'prete';
  }
  return 'indisponible';
}

async function cycle(pool, u, q = {}) {
  const etabId = Number(q.etablissement_id); if (!Number.isSafeInteger(etabId) || etabId < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, etabId);
  const cfg = (await pool.query(`SELECT COALESCE(c.confirmation_lit_validite_min, 60) AS v FROM etablissements e JOIN config_pays c ON c.id = e.config_id WHERE e.id = $1`, [etabId])).rows[0];
  if (!cfg) throw new ErreurHttp(404, 'etab_introuvable');
  const lits = (await pool.query(`SELECT l.id, l.code, l.etat, un.nom AS unite, ch.numero AS chambre, l.disponibilite_confirmee_le,
      EXTRACT(EPOCH FROM (now() - l.disponibilite_confirmee_le)) / 60 AS confirmation_min,
      (SELECT c.sortie_prevue FROM conges c WHERE c.lit_id = l.id AND c.statut IN ('prevu', 'confirme', 'attente_transport') ORDER BY c.id DESC LIMIT 1) AS sortie_prevue,
      EXISTS (SELECT 1 FROM conges c WHERE c.lit_id = l.id AND c.statut IN ('prevu', 'confirme', 'attente_transport')) AS conge_ouvert,
      EXISTS (SELECT 1 FROM nettoyage_interventions n WHERE n.lit_id = l.id AND n.statut IN ('en_cours', 'controle_requis')) AS intervention_ouverte,
      EXISTS (SELECT 1 FROM taches_etab t WHERE t.lit_id = l.id AND t.type = 'preparation_chambre' AND t.statut IN ('a_faire', 'en_cours')) AS preparation_ouverte
    FROM lits l JOIN unites un ON un.id = l.unite_id JOIN chambres ch ON ch.id = l.chambre_id
    WHERE l.etablissement_id = $1 AND l.actif ORDER BY un.nom, l.code`, [etabId])).rows;
  const sortie = lits.map((l) => ({ id: l.id, code: l.code, unite: l.unite, chambre: l.chambre, etat_reel: l.etat, cycle: etatCycle(l, Number(cfg.v)),
    sortie_prevue: l.sortie_prevue, confirme_le: l.disponibilite_confirmee_le }));
  const compte = Object.fromEntries(ETATS.map((e) => [e, sortie.filter((l) => l.cycle === e).length]));
  return { etablissement_id: etabId, etats: ETATS, compte, lits: sortie, validite_confirmation_min: Number(cfg.v),
    regle: u.langue === 'en'
      ? 'Derived view: the real bed state is unchanged. “Ready” is not “confirmed”: only a recent, dated confirmation counts.'
      : 'Vue dérivée : l’état réel du lit est inchangé. « Prête » n’est pas « confirmée » : seule une confirmation récente et datée compte.' };
}

module.exports = { cycle, etatCycle, ETATS };
