/**
 * Démonstration et recette seulement : active un module livré sur des établissements de la démo (cahier v2, C.12), journalisé.
 * Usage : node db/demo-activer-module.js <code du module> <CODE_ETAB>...   (ex. transferts_suivi HX HY HC)
 * Refusé pour un module non livré (« Bientôt ») ou un type d'établissement auquel il ne s'applique pas. Rejouable.
 */
const { creerPool, transaction } = require('../src/db');
const { environnement } = require('../src/environnement');
const TE = require('../src/types-etablissement');

async function activer(pool, code, etabs, { silencieux = false } = {}) {
  if (!['demo', 'recette'].includes(environnement())) throw new Error('Démonstration et recette seulement (ARRIMO_ENV).');
  const m = TE.MODULES.find((x) => x.code === code);
  if (!m || m.statut !== 'disponible' || !m.drapeau) throw new Error(`Module non activable : ${code}`);
  const log = (x) => { if (!silencieux) console.log(x); };
  for (const e of (await pool.query('SELECT id, code, nom, type_etablissement, modules FROM etablissements WHERE code = ANY($1) AND actif', [etabs])).rows) {
    if (!m.types.includes(e.type_etablissement || 'hopital')) { log(`${e.code} : type non concerné`); continue; }
    if ((e.modules || {})[m.drapeau] === true) { log(`${e.code} : ${code} déjà actif`); continue; }
    await transaction(pool, async (c) => {
      await c.query(`UPDATE etablissements SET modules = COALESCE(modules, '{}'::jsonb) || jsonb_build_object($2::text, true) WHERE id = $1`, [e.id, m.drapeau]);
      await c.query(`INSERT INTO journal_admin (utilisateur_id, etablissement_id, action, cible, detail) VALUES (NULL, $1, 'Établissement modifié', $2, $3)`,
        [e.id, e.nom, `modules : ${code} activé · préparation de la démonstration (db/demo-activer-module.js)`]);
    });
    log(`${e.code} : ${code} activé`);
  }
}
if (require.main === module) {
  const [code, ...etabs] = process.argv.slice(2);
  const pool = creerPool(process.env.DATABASE_URL);
  activer(pool, code, etabs).then(() => pool.end()).catch((e) => { console.error(e.message); pool.end(); process.exit(1); });
}
module.exports = { activer };
