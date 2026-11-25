'use strict';
/**
 * Contrôle des rattachements (cahier nº 19, chantier B, 26 nov. 2026) : chaque lit doit être rattaché à une unité, un type d'unité
 * (spécialité), un service et un département ; chaque civière à l'urgence de son établissement. Lecture seule : une ressource mal
 * rattachée ne peut pas être vérifiée pour sa compatibilité ; elle est listée pour être complétée par l'administration.
 * Salles et équipements : non modélisés à ce jour (équipements portés par les lits) — décision de modèle à prendre.
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');

async function controler(pool, u, q = {}) {
  const etabId = Number(q.etablissement_id); if (!Number.isSafeInteger(etabId) || etabId < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, etabId);
  if (!['admin_etab', 'gestionnaire', 'coordonnateur'].includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const lits = (await pool.query(`SELECT l.id, l.code, un.nom AS unite, (un.service_id IS NULL) AS sans_service, (un.departement_id IS NULL) AS sans_departement,
      (t.specialite IS NULL) AS sans_specialite
    FROM lits l JOIN unites un ON un.id = l.unite_id JOIN types_unite t ON t.id = l.type_id WHERE l.etablissement_id = $1 AND l.actif`, [etabId])).rows;
  const incomplets = lits.filter((l) => l.sans_service || l.sans_departement || l.sans_specialite)
    .map((l) => ({ id: l.id, code: l.code, unite: l.unite, manque: [l.sans_specialite && 'specialite', l.sans_service && 'service', l.sans_departement && 'departement'].filter(Boolean) }));
  const { rows: [cv] } = await pool.query('SELECT count(*)::int AS n FROM civieres WHERE etablissement_id = $1 AND actif', [etabId]);
  return { etablissement_id: etabId,
    lits: { total: lits.length, complets: lits.length - incomplets.length, taux_complet_pct: lits.length ? Math.round(((lits.length - incomplets.length) / lits.length) * 1000) / 10 : null, incomplets: incomplets.slice(0, 200) },
    civieres: { total: cv.n, rattachement: 'urgence de l’établissement' },
    non_modelises: ['salles', 'equipements_autonomes'],
    regle: u.langue === 'en' ? 'A resource without full attachment cannot be checked for compatibility.' : 'Une ressource sans rattachement complet ne peut pas être vérifiée pour sa compatibilité.' };
}

module.exports = { controler };
