/**
 * Démonstration et recette seulement (19 nov. 2026) : prépare le moteur commun et le Chrono dans la démo.
 * - Région CA-QC-06 (Montréal, ville de la météo de la démo) pour les établissements et organisations de secours de la démo.
 * - Module Chrono activé sur les hôpitaux A, B et C (HX, HY, HC) s'ils ont Liaison Secours (cahier v2, C.12), journalisé.
 * - Rapport mensuel non vide : quelques passages fictifs TERMINÉS plus tôt dans le mois, heures dans l'Horloge (source « systeme »).
 *   Aucun passage « à la porte » n'est créé : en démonstration, l'équipage signale son arrivée (H11) en direct.
 * Rejouable : rien n'est refait si c'est déjà en place. Aucune donnée réelle.
 */
const { creerPool, transaction } = require('../src/db');
const { environnement } = require('../src/environnement');
const horloge = require('../src/horloge');

const HOPITAUX = ['HX', 'HY', 'HC'];
// Minutes après H11 : H12, H13, H14, H15 — durées plausibles, une au-delà de la cible pour que le rapport soit parlant
const PROFILS = [[3, 9, 16, 31], [5, 12, 24, 41], [2, 7, 14, 26], [6, 15, 28, 52], [4, 10, 18, 33]];

async function preparer(pool, { silencieux = false } = {}) {
  if (!['demo', 'recette'].includes(environnement())) throw new Error('Démonstration et recette seulement (ARRIMO_ENV).');
  const log = (m) => { if (!silencieux) console.log(m); };
  const region = (await pool.query("SELECT id FROM regions WHERE code = 'CA-QC-06'")).rows[0];
  if (!region) throw new Error('Table regions absente : appliquer d’abord la migration du moteur commun.');
  const r1 = await pool.query('UPDATE etablissements SET region_id = $1 WHERE region_id IS NULL', [region.id]);
  const r2 = await pool.query('UPDATE organisations_secours SET region_id = $1 WHERE region_id IS NULL', [region.id]);
  log(`Région CA-QC-06 : ${r1.rowCount} établissements, ${r2.rowCount} organisations`);
  const hop = (await pool.query("SELECT id, code, nom, modules FROM etablissements WHERE code = ANY($1) AND (modules->>'liaison_secours') = 'true'", [HOPITAUX])).rows;
  for (const h of hop) {
    if ((h.modules || {}).chrono === true) { log(`Chrono déjà actif : ${h.code}`); continue; }
    await transaction(pool, async (c) => {
      await c.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || '{"chrono": true}' WHERE id = $1`, [h.id]);
      await c.query(`INSERT INTO journal_admin (utilisateur_id, etablissement_id, action, cible, detail) VALUES (NULL, $1, 'Établissement modifié', $2, 'modules : chrono activé · préparation de la démonstration (db/demo-chrono.js)')`, [h.id, h.nom]);
    });
    log(`Chrono activé : ${h.code}`);
  }
  if ((await pool.query("SELECT 1 FROM passages_chrono WHERE numero LIKE 'CH-DEMO-%' LIMIT 1")).rowCount) { log('Passages de démonstration déjà présents'); return; }
  const unites = (await pool.query("SELECT u.id, u.organisation_id FROM unites_secours u JOIN organisations_secours o ON o.id = u.organisation_id WHERE 'ambulance' = ANY(o.profils) AND u.actif ORDER BY u.id")).rows;
  if (!unites.length || !hop.length) { log('Aucune unité ou aucun hôpital avec Liaison Secours : passages non créés'); return; }
  let n = 0;
  for (let jour = 1; jour <= 5; jour += 1) {
    const h = hop[jour % hop.length]; const u = unites[jour % unites.length]; const prof = PROFILS[jour - 1];
    const h11 = new Date(Date.now() - (jour * 24 + 3) * 3600000);
    await transaction(pool, async (c) => {
      const p = (await c.query(`INSERT INTO passages_chrono (numero, etablissement_id, unite_id, organisation_id, statut, source, cree_le, modifie_le)
        VALUES ($1, $2, $3, $4, 'termine', 'position', $5, $5) RETURNING id`, [`CH-DEMO-${jour}`, h.id, u.id, u.organisation_id, h11])).rows[0];
      await horloge.marquer(c, { objet: 'passage_chrono', objetId: p.id, etape: 'H11', heure: h11, source: 'systeme' });
      for (const [i, e] of ['H12', 'H13', 'H14', 'H15'].entries()) {
        await horloge.marquer(c, { objet: 'passage_chrono', objetId: p.id, etape: e, heure: new Date(h11.getTime() + prof[i] * 60000), source: 'systeme' });
      }
    });
    n += 1;
  }
  log(`${n} passages de démonstration terminés (rapport mensuel)`);
}

if (require.main === module) {
  const pool = creerPool(process.env.DATABASE_URL);
  preparer(pool).then(() => pool.end()).catch((e) => { console.error(e.message); pool.end(); process.exit(1); });
}
module.exports = { preparer };
