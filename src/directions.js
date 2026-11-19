'use strict';
/**
 * Directions régionales (moteur commun, lot 0 ; décision du 19 nov. : table à part). Organisation sans lits, limitée à sa région :
 * lecture seulement (établissements, organisations, demandes). Le déclenchement d'une crise viendra avec le module Mode crise.
 */
const { ErreurHttp } = require('./db');

async function directionsDe(pool, u) {
  return (await pool.query(`SELECT d.id, d.code, d.nom, r.code AS region_code, r.nom AS region_nom, r.nom_en AS region_nom_en, d.region_id
    FROM utilisateur_directions ud JOIN directions_regionales d ON d.id = ud.direction_id AND d.actif JOIN regions r ON r.id = d.region_id
    WHERE ud.utilisateur_id = $1 ORDER BY d.nom`, [u.id])).rows;
}
async function region(pool, u) {
  const dirs = await directionsDe(pool, u);
  if (!dirs.length) throw new ErreurHttp(403, 'direction_sans_region');
  const regions = [...new Set(dirs.map((d) => d.region_id))];
  const etablissements = (await pool.query(`SELECT e.id, e.code, e.nom, e.type_etablissement, e.type_local_code, e.ville, e.region_id
    FROM etablissements e WHERE e.actif AND e.region_id = ANY($1) ORDER BY e.nom`, [regions])).rows;
  const organisations = (await pool.query(`SELECT id, code, nom, type, region_id FROM organisations_secours WHERE actif AND region_id = ANY($1) ORDER BY nom`, [regions])).rows;
  return { directions: dirs, etablissements, organisations, demandes: await require('./demandes').synthese(pool, u) };
}
/** Création (SH ou gestionnaire réseau) : code, nom, code de région ; journalisée par l'appelant. */
async function creer(pool, b) {
  const code = String(b.code || '').trim().toUpperCase(); const nom = String(b.nom || '').trim();
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'code' });
  if (nom.length < 2 || nom.length > 120) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'nom' });
  const r = (await pool.query('SELECT id FROM regions WHERE code = $1', [String(b.region_code || '')])).rows[0];
  if (!r) throw new ErreurHttp(400, 'region_inconnue');
  return (await pool.query(`INSERT INTO directions_regionales (code, nom, region_id) VALUES ($1, $2, $3)
    ON CONFLICT (code) DO UPDATE SET nom = EXCLUDED.nom RETURNING *`, [code, nom, r.id])).rows[0];
}
const regions = async (pool, pays) => (await pool.query('SELECT code, nom, nom_en, pays FROM regions WHERE ($1::text IS NULL OR pays = $1) ORDER BY code', [pays || null])).rows;
module.exports = { directionsDe, region, creer, regions };
