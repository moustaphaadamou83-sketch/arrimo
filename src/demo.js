/**
 * Démonstration toujours prête (serveur de démonstration seulement, ARRIMO_DEMO=1).
 * - reinitialiser : efface la base et recrée la démo Hôpital X / Hôpital Y (bouton du gestionnaire réseau, commande, timer de nuit).
 * - recaler : quand personne n'utilise la démo, avance toutes ses horloges du temps écoulé, pour que les attentes,
 *   congés et nettoyages restent ceux de la situation de départ, quelle que soit l'heure. Aucun état de lit ne change
 *   et le journal (immuable) n'est pas touché.
 */
const { transaction } = require('./db');
const { viderBase } = require('../db/vider');
const { viderCacheTypes } = require('./langue');

const estDemo = () => process.env.ARRIMO_DEMO === '1';

async function reinitialiser(pool) {
  const { demoDeux } = require('../db/demo-deux');
  await viderBase(pool);
  await demoDeux(pool, { silencieux: true });
  viderCacheTypes();
}

// Colonnes d'horloge de la démo (le journal n'en fait pas partie : il est immuable)
const HORLOGES = {
  lits: ['etat_depuis', 'sortie_prevue', 'nsa_depuis', 'nettoyage_debut'],
  civieres: ['etat_depuis', 'arrivee_le'],
  demandes_admission: ['cree_le', 'assignee_le', 'terminee_le'],
  transferts: ['date_demande', 'date_validation', 'date_depart', 'date_reception'],
  notifications: ['date'],
};

/** Recale la démo si elle est inactive depuis `calmeMin` minutes. Retourne le décalage appliqué, en minutes (0 sinon). */
async function recaler(pool, { calmeMin = 30, maintenant = null } = {}) {
  if (!estDemo()) return 0;
  return transaction(pool, async (c) => {
    const ref = (await c.query('SELECT reference FROM demo_etat WHERE id = 1 FOR UPDATE')).rows[0];
    if (!ref) return 0;
    const n = (await c.query(
      `SELECT EXTRACT(EPOCH FROM (COALESCE($1::timestamptz, now()) - $2::timestamptz)) / 60 AS ecart,
              (SELECT max(date) FROM journal WHERE utilisateur_id IS NOT NULL) AS derniere_action,
              (SELECT max(derniere_connexion) FROM utilisateurs) AS derniere_connexion`, [maintenant, ref.reference])).rows[0];
    const ecart = Math.floor(Number(n.ecart));
    const derniere = Math.max(new Date(n.derniere_action || 0).getTime(), new Date(n.derniere_connexion || 0).getTime());
    const actif = Date.now() - derniere < calmeMin * 60000 && !maintenant;
    if (ecart < 10 || actif) return 0;
    for (const [table, cols] of Object.entries(HORLOGES)) {
      await c.query(`UPDATE ${table} SET ${cols.map((k) => `${k} = ${k} + make_interval(mins => $1)`).join(', ')}`, [ecart]);
    }
    await c.query('UPDATE demo_etat SET reference = reference + make_interval(mins => $1) WHERE id = 1', [ecart]);
    return ecart;
  });
}

module.exports = { estDemo, reinitialiser, recaler };
