/**
 * Besoins d'un patient NSA en catégories fermées (lot A, 17 nov. 2026 ; cahier docs/cahier-nsa-hebergement.md).
 *
 * Loi 25 : aucun diagnostic, aucun texte libre clinique. Ces catégories restent des renseignements de santé :
 * - lues et modifiées par l'équipe et la coordination de l'hôpital seulement (jamais l'entretien) ;
 * - jamais écrites dans le journal (on y note « Besoins NSA mis à jour », sans contenu) ni dans une notification ;
 * - inscrites à l'EFVP (docs/LOI25_REGISTRE_ET_EFVP.md).
 * La famille est située par sa municipalité (décision de Moustafa, 17 nov. 2026) ; sexe de la chambre facultatif, « indifférent » par défaut.
 * Arrimo ne décide rien : ces besoins serviront à proposer des places compatibles (lot B), l'équipe choisit.
 */
const { transaction, ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const { journaliser } = require('./regles');
const TE = require('./types-etablissement');
const s = require('./services');
const { ROLES_NSA } = require('./terrain');

const CODES = ['marchette', 'fauteuil', 'leve_personne', 'unite_securisee', 'oxygene', 'soins_particuliers'];
const SEXES = ['indifferent', 'F', 'M'];
const LANGUES = ['fr', 'en', 'autre'];
const MUNICIPALITE = /^[\p{L}][\p{L} .'’-]{1,79}$/u;

/** Épisode NSA actif du lit, avec contrôle d'accès (établissement, rôle, module NSA). */
async function episode(db, u, litId, { verrou = false } = {}) {
  if (!ROLES_NSA.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const l = (await db.query('SELECT id, code, etablissement_id, nsa_depuis FROM lits WHERE id = $1', [litId])).rows[0];
  if (!l) throw new ErreurHttp(404, 'lit_introuvable');
  exigerEtablissement(u, l.etablissement_id);
  await s.exigerModule(db, l.etablissement_id, 'nsa');
  const ep = (await db.query(`SELECT id, etablissement_id, version FROM nsa_episodes WHERE lit_id = $1 AND statut = 'actif'${verrou ? ' FOR UPDATE' : ''}`, [litId])).rows[0];
  if (!l.nsa_depuis || !ep) throw new ErreurHttp(409, 'patient_non_nsa', { code: l.code });
  return { lit: l, ep };
}

/** Milieux d'hébergement actifs, proposés comme préférences (jusqu'à 3) : nom, ville et type court seulement. */
async function milieux(db) {
  return (await db.query(`SELECT id, nom, ville, type_local_code FROM etablissements WHERE type_etablissement = 'chsld' AND actif ORDER BY nom`)).rows
    .map((e) => ({ id: e.id, nom: e.nom, ville: e.ville, type: TE.nomCourt(e) }));
}

async function lire(pool, u, litId) {
  const { lit, ep } = await episode(pool, u, litId);
  const b = (await pool.query('SELECT codes, chambre_sexe, langue, municipalite_famille, preferences, version, modifie_le FROM nsa_besoins WHERE episode_id = $1', [ep.id])).rows[0];
  return {
    lit_id: lit.id, code: lit.code, episode_id: ep.id,
    besoins: b || { codes: [], chambre_sexe: 'indifferent', langue: null, municipalite_famille: null, preferences: [], version: 0, modifie_le: null },
    milieux: await milieux(pool), codes_possibles: CODES,
  };
}

function valider(b) {
  const codes = Array.isArray(b.codes) ? [...new Set(b.codes)] : [];
  if (!Array.isArray(b.codes ?? []) || codes.some((x) => !CODES.includes(x))) throw new ErreurHttp(400, 'besoin_invalide');
  const sexe = b.chambre_sexe ?? 'indifferent';
  if (!SEXES.includes(sexe)) throw new ErreurHttp(400, 'besoin_invalide');
  const langue = b.langue === '' || b.langue == null ? null : b.langue;
  if (langue !== null && !LANGUES.includes(langue)) throw new ErreurHttp(400, 'besoin_invalide');
  const muni = String(b.municipalite_famille ?? '').trim().replace(/\s+/g, ' ') || null;
  if (muni !== null && !MUNICIPALITE.test(muni)) throw new ErreurHttp(400, 'municipalite_invalide');
  const prefs = Array.isArray(b.preferences) ? b.preferences.map(Number) : [];
  if (!Array.isArray(b.preferences ?? []) || prefs.length > 3 || prefs.some((x) => !Number.isInteger(x) || x <= 0) || new Set(prefs).size !== prefs.length) {
    throw new ErreurHttp(400, 'preferences_milieux_invalides');
  }
  return { codes, sexe, langue, muni, prefs };
}

async function modifier(pool, u, litId, b = {}) {
  const v = valider(b);
  return transaction(pool, async (c) => {
    const { lit, ep } = await episode(c, u, litId, { verrou: true });
    if (v.prefs.length) {
      const ok = (await c.query(`SELECT count(*)::int n FROM etablissements WHERE id = ANY($1) AND type_etablissement = 'chsld' AND actif`, [v.prefs])).rows[0].n;
      if (ok !== v.prefs.length) throw new ErreurHttp(400, 'preferences_milieux_invalides');
    }
    const actuel = (await c.query('SELECT version FROM nsa_besoins WHERE episode_id = $1 FOR UPDATE', [ep.id])).rows[0];
    if (b.version != null && Number(b.version) !== (actuel?.version ?? 0)) throw new ErreurHttp(409, 'version_perimee');
    const n = (await c.query(`INSERT INTO nsa_besoins (episode_id, codes, chambre_sexe, langue, municipalite_famille, preferences, modifie_par)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (episode_id) DO UPDATE SET codes = EXCLUDED.codes, chambre_sexe = EXCLUDED.chambre_sexe, langue = EXCLUDED.langue,
        municipalite_famille = EXCLUDED.municipalite_famille, preferences = EXCLUDED.preferences, modifie_par = EXCLUDED.modifie_par,
        version = nsa_besoins.version + 1, modifie_le = now()
      RETURNING codes, chambre_sexe, langue, municipalite_famille, preferences, version, modifie_le`,
    [ep.id, v.codes, v.sexe, v.langue, v.muni, v.prefs, u.id])).rows[0];
    // Journal : le fait seulement, jamais le contenu (Loi 25)
    await journaliser(c, { litId: lit.id, utilisateurId: u.id, action: 'Besoins NSA mis à jour', detail: null });
    return { lit_id: lit.id, episode_id: ep.id, besoins: n };
  });
}

module.exports = { lire, modifier, milieux, episode, CODES };
