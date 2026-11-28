'use strict';
/**
 * OG proactif (cahier « Standardisation universelle d'OG », 28 nov. 2026) : ce qu'OG signale sans attendre une question, sur
 * l'Accueil de chaque profil. Une seule source : les services existants (Entretien, Mes tâches, Lits) ; mêmes droits que l'écran.
 * Chaque point est typé : « fait » (donnée enregistrée), « prevision » (donnée planifiée, jamais présentée comme certaine)
 * ou « inconnu » (donnée manquante, jamais inventée). OG propose ; une personne décide. Aucune référence patient pour l'entretien.
 */
const { exigerEtablissement } = require('./auth');
const T = (L, fr, en) => (L === 'en' ? en : fr);
const RESPONSABLES = ['coordonnateur', 'admin_etab', 'gestionnaire'];

async function proactif(pool, u, etabId) {
  exigerEtablissement(u, etabId);
  const L = u.langue === 'en' ? 'en' : 'fr';
  const points = [];
  const ajouter = (type, niveau, texte, aller = null) => points.push({ type, niveau, texte, aller });
  const entretien = u.role === 'entretien'; const resp = RESPONSABLES.includes(u.role);
  const cfg = (await pool.query('SELECT c.nettoyage_cible_min FROM etablissements e JOIN config_pays c ON c.id = e.config_id WHERE e.id = $1', [etabId])).rows[0] || {};
  const cible = Number(cfg.nettoyage_cible_min) > 0 ? Number(cfg.nettoyage_cible_min) : 30;
  // Ressources libérées (Entretien) : attentes longues, vérifications, libérations sans heure
  if (entretien || resp) {
    const r = await require('./entretien').ressources(pool, u, etabId, { jour: false });
    const longues = r.en_cours.filter((x) => x.phase === 'attente' && x.attente_min != null && x.attente_min >= cible).sort((a, b) => b.attente_min - a.attente_min);
    if (longues.length) ajouter('fait', 'orange', T(L, `${longues.length} ressource${longues.length > 1 ? 's' : ''} libérée${longues.length > 1 ? 's' : ''} attend${longues.length > 1 ? 'ent' : ''} le nettoyage depuis plus de ${cible} min (la plus ancienne : ${longues[0].code}, ${longues[0].attente_min} min).`,
      `${longues.length} released resource${longues.length > 1 ? 's' : ''} waiting for cleaning for more than ${cible} min (oldest: ${longues[0].code}, ${longues[0].attente_min} min).`), 'nettoyage');
    const verif = r.en_cours.filter((x) => x.phase === 'verification');
    if (verif.length) ajouter('fait', 'orange', T(L, `${verif.length} nettoyage${verif.length > 1 ? 's' : ''} terminé${verif.length > 1 ? 's' : ''} attend${verif.length > 1 ? 'ent' : ''} la vérification : ${verif.map((x) => x.code).join(', ')} (pas encore disponible${verif.length > 1 ? 's' : ''}).`,
      `${verif.length} finished cleaning${verif.length > 1 ? 's' : ''} awaiting check: ${verif.map((x) => x.code).join(', ')} (not available yet).`), 'nettoyage');
    const sansHeure = r.en_cours.filter((x) => !x.liberation_le);
    if (sansHeure.length) ajouter('inconnu', 'gris', T(L, `Heure de libération inconnue pour ${sansHeure.map((x) => x.code).join(', ')} : aucune durée n’est estimée.`, `Release time unknown for ${sansHeure.map((x) => x.code).join(', ')}: no duration is estimated.`));
    if (!r.en_cours.length) ajouter('fait', 'vert', T(L, 'Aucune ressource n’attend de nettoyage.', 'No resource is waiting for cleaning.'));
  }
  // Mes tâches (moteur unique) : retards et accumulation
  const m = await require('./taches').miennes(pool, u, { etablissement_id: etabId }).catch(() => null);
  if (m) {
    const t = m.taches.filter((x) => x.source === 'tache');
    const retard = t.filter((x) => x.en_retard);
    if (retard.length) ajouter('fait', 'rouge', T(L, `${retard.length} tâche${retard.length > 1 ? 's' : ''} en retard.`, `${retard.length} overdue task${retard.length > 1 ? 's' : ''}.`), 'mes-taches');
    if (resp && m.non_attribuees) ajouter('fait', 'orange', T(L, `${m.non_attribuees} tâche${m.non_attribuees > 1 ? 's' : ''} sans personne attribuée : à attribuer ou à laisser dans la file du rôle.`, `${m.non_attribuees} unassigned task${m.non_attribuees > 1 ? 's' : ''}: assign them or leave them in the role queue.`), 'mes-taches');
    if (t.length >= 8) ajouter('fait', 'orange', T(L, `Accumulation : ${t.length} tâches ouvertes.`, `Backlog: ${t.length} open tasks.`), 'mes-taches');
  }
  // Prévision : départs planifiés aujourd'hui (lits à libérer bientôt) — prévision, jamais une libération
  const conges = (await pool.query(`SELECT count(*)::int n FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' AND conge_statut IN ('prevu', 'confirme', 'attente_transport')`, [etabId])).rows[0].n;
  if (conges) ajouter('prevision', 'bleu', T(L, `${conges} lit${conges > 1 ? 's' : ''} devrai${conges > 1 ? 'ent' : 't'} se libérer (départ planifié) : nettoyage à prévoir. Prévision seulement : un lit n’est libéré qu’au départ réel.`,
    `${conges} bed${conges > 1 ? 's' : ''} should be released (planned discharge): plan cleaning. Forecast only: a bed is released only at actual departure.`), entretien ? null : 'conges');
  const ordre = { rouge: 0, orange: 1, bleu: 2, gris: 3, vert: 4 };
  return { genere_le: new Date().toISOString(), points: points.sort((a, b) => ordre[a.niveau] - ordre[b.niveau]).slice(0, 6) };
}
module.exports = { proactif };
