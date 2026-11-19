/**
 * Démonstration seulement (20 nov. 2026) : module « Urgences en direct » activé sur les hôpitaux A, B et C (HX, HY, HC), consentement
 * de publication fictif ; une fermeture planifiée d'exemple (imagerie de l'Hôpital C, demain de 1 h à 5 h), avis envoyés par les mêmes règles.
 * La page publique /urgences n'est servie qu'en démonstration (décision 4 de Moustafa, 19 nov. 2026). Rejouable.
 */
const { creerPool, transaction } = require('../src/db');
const { environnement } = require('../src/environnement');
const ud = require('../src/urgences-direct');

async function preparer(pool, { silencieux = false } = {}) {
  if (environnement() !== 'demo') throw new Error('Démonstration seulement (ARRIMO_ENV=demo).');
  const log = (m) => { if (!silencieux) console.log(m); };
  const hop = (await pool.query("SELECT id, code, nom, modules FROM etablissements WHERE code IN ('HX', 'HY', 'HC') AND actif ORDER BY code")).rows;
  for (const h of hop) {
    if ((h.modules || {}).urgences_direct === true) { log(`Urgences en direct déjà actif : ${h.code}`); continue; }
    await transaction(pool, async (c) => {
      await c.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"urgences_direct": true}' WHERE id = $1`, [h.id]);
      await c.query(`INSERT INTO journal_admin (utilisateur_id, etablissement_id, action, cible, detail) VALUES (NULL, $1, 'Établissement modifié', $2, 'modules : urgences_direct activé · préparation de la démonstration (db/demo-urgences-direct.js)')`, [h.id, h.nom]);
    });
    log(`Urgences en direct activé : ${h.code}`);
  }
  const hc = hop.find((h) => h.code === 'HC');
  if (!hc) return;
  if ((await pool.query("SELECT 1 FROM fermetures_urgence WHERE etablissement_id = $1 AND statut IN ('planifiee', 'en_cours')", [hc.id])).rowCount) { log('Fermeture d’exemple déjà planifiée'); return; }
  const u = (await pool.query(`SELECT u.id, u.role FROM utilisateurs u JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id
    WHERE ue.etablissement_id = $1 AND u.actif AND u.role IN ('coordonnateur', 'admin_etab') ORDER BY u.id LIMIT 1`, [hc.id])).rows[0];
  if (!u) { log('Aucun compte de coordination à l’Hôpital C : fermeture d’exemple non créée'); return; }
  const demain = new Date(); demain.setDate(demain.getDate() + 1); demain.setHours(1, 0, 0, 0);
  await ud.planifier(pool, { ...u, etabs: [hc.id], gestionnaire: false, langue: 'fr' }, { etablissement_id: hc.id, debut_le: demain.toISOString(),
    fin_prevue_le: new Date(demain.getTime() + 4 * 3600000).toISOString(), services: ['imagerie'] });
  log('Fermeture d’exemple planifiée : imagerie de l’Hôpital C, demain 1 h-5 h');
}
if (require.main === module) {
  const pool = creerPool(process.env.DATABASE_URL);
  preparer(pool).then(() => pool.end()).catch((e) => { console.error(e.message); pool.end(); process.exit(1); });
}
module.exports = { preparer };
