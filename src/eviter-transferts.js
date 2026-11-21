'use strict';
/**
 * Éviter les transferts inutiles (cahier v2, A.4 ; 21 nov. 2026). Avant d'appeler l'ambulance, la résidence voit SA liste de
 * vérification et SES alternatives (médecin de garde, infirmière praticienne, Info-Santé, soutien à domicile, télésoins), saisies par
 * elle-même selon son protocole : Arrimo n'écrit aucune recommandation clinique, ne bloque jamais l'appel et ne décide de rien.
 * L'équipe note ce qu'elle a décidé (transfert évité grâce à une alternative, ou transfert fait) ; Arrimo compte les deux.
 * Aucune donnée clinique : la référence du résident au plus, jamais de motif ni de symptôme.
 */
const { ErreurHttp } = require('./db');
const TE = require('./types-etablissement');

const ALTERNATIVES = ['medecin_garde', 'infirmiere_praticienne', 'info_sante', 'soutien_domicile', 'telesoins', 'autre'];
const GERER = ['admin_etab', 'coordonnateur'];
const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

async function etab(db, u, etabId) {
  const id = entier(etabId);
  if (!id || !(u.gestionnaire || (u.etabs || []).map(Number).includes(id))) throw new ErreurHttp(403, 'etab_interdit');
  if (u.role === 'entretien') throw new ErreurHttp(403, 'role_entretien');
  const e = (await db.query('SELECT id, nom, type_etablissement, modules FROM etablissements WHERE id = $1 AND actif', [id])).rows[0];
  if (!e || e.type_etablissement !== 'chsld') throw new ErreurHttp(404, 'etab_introuvable');
  if (!TE.moduleActif(e, 'eviter_transferts')) throw new ErreurHttp(403, 'module_desactive', { module: 'eviter_transferts' });
  return e;
}
/** Liste, alternatives et chiffres du mois (évités, faits) ; la liste est vide tant que l'établissement ne l'a pas écrite. */
async function lire(pool, u, etabId) {
  const e = await etab(pool, u, etabId);
  const l = (await pool.query('SELECT verifications, alternatives, version, modifie_le FROM eviter_listes WHERE etablissement_id = $1', [e.id])).rows[0]
    || { verifications: [], alternatives: [], version: 0, modifie_le: null };
  const c = (await pool.query(`SELECT decision, alternative, count(*)::int n FROM eviter_decisions WHERE etablissement_id = $1 AND cree_le >= date_trunc('month', now())
    GROUP BY decision, alternative`, [e.id])).rows;
  const evites = c.filter((x) => x.decision === 'transfert_evite').reduce((s, x) => s + x.n, 0);
  const faits = c.filter((x) => x.decision === 'transfert_fait').reduce((s, x) => s + x.n, 0);
  // COR-002 : la décision de l'équipe n'est PAS une demande d'ambulance. Pour chaque décision « transfert », on montre séparément :
  // demande de transport transmise ? accusé (acceptée) ? véhicule affecté ? — d'après la demande réelle du même résident (6 h suivantes).
  const decisions = (await pool.query(`SELECT d.id, d.decision, d.alternative, d.resident_ref, d.cree_le,
      t.numero AS transport, t.statut AS transport_statut, t.acceptee_le IS NOT NULL AS accuse, t.unite_id IS NOT NULL AS vehicule_affecte
    FROM eviter_decisions d LEFT JOIN LATERAL (SELECT x.* FROM demandes_transport x WHERE d.decision = 'transfert_fait' AND d.resident_ref IS NOT NULL AND x.origine_id = d.etablissement_id
      AND x.resident_ref = d.resident_ref AND x.cree_le BETWEEN d.cree_le - interval '30 minutes' AND d.cree_le + interval '6 hours' AND x.statut NOT IN ('a_valider', 'annulee') ORDER BY x.cree_le LIMIT 1) t ON true
    WHERE d.etablissement_id = $1 AND d.cree_le > now() - interval '7 days' ORDER BY d.cree_le DESC LIMIT 20`, [e.id])).rows;
  return { ...l, decisions, alternatives_possibles: ALTERNATIVES, mois: { evites, faits, par_alternative: Object.fromEntries(c.filter((x) => x.alternative).map((x) => [x.alternative, x.n])) }, peut_regler: GERER.includes(u.role) || u.gestionnaire };
}
/** L'établissement écrit sa liste (texte de son protocole, 12 points au plus) et ses alternatives (code fermé + coordonnées). */
async function regler(pool, u, b = {}) {
  const e = await etab(pool, u, b.etablissement_id);
  if (!GERER.includes(u.role) && !u.gestionnaire) throw new ErreurHttp(403, 'role_insuffisant');
  const verifs = Array.isArray(b.verifications) ? b.verifications.map((x) => String(x).trim()).filter(Boolean) : [];
  if (verifs.length > 12 || verifs.some((x) => x.length > 200)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'verifications' });
  const alts = Array.isArray(b.alternatives) ? b.alternatives : [];
  if (alts.length > 8 || alts.some((a) => !ALTERNATIVES.includes(a?.code) || String(a.contact || '').length > 120)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'alternatives' });
  const propres = alts.map((a) => ({ code: a.code, contact: String(a.contact || '').trim() }));
  const r = (await pool.query(`INSERT INTO eviter_listes (etablissement_id, verifications, alternatives, modifie_par) VALUES ($1, $2, $3, $4)
    ON CONFLICT (etablissement_id) DO UPDATE SET verifications = EXCLUDED.verifications, alternatives = EXCLUDED.alternatives, version = eviter_listes.version + 1,
      modifie_par = EXCLUDED.modifie_par, modifie_le = now()
    WHERE eviter_listes.version = $5 RETURNING *`, [e.id, JSON.stringify(verifs), JSON.stringify(propres), u.id, Number(b.version) || 0])).rows[0];
  if (!r) throw new ErreurHttp(409, 'version_perimee');
  await pool.query(`INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Liste « avant l’appel » mise à jour', $3)`, [e.id, u.id, `${verifs.length} vérifications · ${propres.length} alternatives`]);
  return r;
}
/** Décision de l'équipe : transfert évité (alternative utilisée) ou transfert fait. Jamais bloquant, jamais un motif clinique. */
async function decider(pool, u, b = {}) {
  const e = await etab(pool, u, b.etablissement_id);
  if (!['transfert_evite', 'transfert_fait'].includes(b.decision)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'decision' });
  const alt = b.decision === 'transfert_evite' ? b.alternative : null;
  if (b.decision === 'transfert_evite' && !ALTERNATIVES.includes(alt)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'alternative' });
  const ref = b.resident_ref ? String(b.resident_ref).trim() : null;
  if (ref && !/^[A-Z]{1,3}-\d{4,6}$/.test(ref)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'resident_ref' });
  const d = (await pool.query('INSERT INTO eviter_decisions (etablissement_id, resident_ref, decision, alternative, cree_par) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [e.id, ref, b.decision, alt, u.id])).rows[0];
  // COR-002 : enregistrer la décision ne sollicite aucune ambulance ; l'interface propose ensuite de faire la demande de transport
  return { ...d, ambulance_demandee: false, prochaine_etape: b.decision === 'transfert_fait' ? 'demander_transport' : null };
}
module.exports = { lire, regler, decider, ALTERNATIVES };
