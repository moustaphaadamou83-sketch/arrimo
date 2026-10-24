/**
 * Configuration de base d'un environnement (données de référence, pas de données de démonstration) :
 * le pays (Québec) et ses types d'unité. Créée seulement si elle manque ; les seuils et protocoles prennent
 * les valeurs par défaut du schéma et se règlent ensuite dans l'administration.
 */
const TYPES = [['SI', 'Soins intensifs', 'Intensive care'], ['MED', 'Médecine', 'Medicine'], ['CHIR', 'Chirurgie', 'Surgery'], ['MAT', 'Maternité', 'Maternity']];

async function configurationBase(c) {
  let cfg = (await c.query(`SELECT id FROM config_pays WHERE code = 'QC'`)).rows[0];
  if (!cfg) cfg = (await c.query(`INSERT INTO config_pays (code, nom) VALUES ('QC', 'Québec (Canada)') RETURNING id`)).rows[0];
  for (const [i, [code, nom, nomEn]] of TYPES.entries()) {
    await c.query(`INSERT INTO types_unite (config_id, code, nom, ordre, nom_en) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (config_id, code) DO NOTHING`,
      [cfg.id, code, nom, i + 1, nomEn]);
  }
  return cfg.id;
}
module.exports = { configurationBase, TYPES };
