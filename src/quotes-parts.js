'use strict';
/**
 * Quotes-parts hospitalières (chantier coordination, lot 5, 26 nov. 2026 ; cahier « optimisation transversale » §3).
 * - Saisies par un rôle autorisé (répartition du CCS de la région, gestion du réseau) ; chaque modification est une nouvelle ligne
 *   immuable : l'historique est complet, avec autorité, période, validité, exception, source et fiabilité.
 * - Reçues, attendues et en route sont lues dans Liaison Secours et Chrono ; la marge restante n'est PAS calculée tant que
 *   sa formule n'est pas définie officiellement (« Non renseignée »). En l'absence de quote-part : « non renseignée », jamais 0.
 * - Une quote-part ne classe ni ne redirige aucune ambulance et ne remplace ni un critère clinique ni la décision du répartiteur.
 * - Activée en démonstration et en recette seulement, tant que les règles réelles ne sont pas confirmées par les autorités.
 */
const { ErreurHttp } = require('./db');
const { environnement } = require('./environnement');

const EXCEPTIONS = ['aucune', 'delestage_autorise', 'suspension_temporaire', 'protocole_regional'];
const FIABILITES = ['confirmee_autorite', 'declaree', 'a_verifier'];
const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n >= 0 ? n : null; };

function exigerEnvironnement() {
  if (['pilote', 'production'].includes(environnement())) throw new ErreurHttp(403, 'module_desactive', { module: 'quotes_parts' });
}
const actif = () => !['pilote', 'production'].includes(environnement());

/** Droit de saisie : répartiteur d'un CCS dont la région (profil) est celle de l'hôpital, ou gestionnaire réseau. */
async function exigerSaisie(db, u, etabId) {
  const e = (await db.query('SELECT id, config_id FROM etablissements WHERE id = $1 AND actif', [etabId])).rows[0];
  if (!e) throw new ErreurHttp(404, 'etab_introuvable');
  if (u.gestionnaire || u.role === 'gestionnaire') return e;
  if (u.role !== 'repartiteur') throw new ErreurHttp(403, 'role_insuffisant');
  const ok = (await db.query(`SELECT 1 FROM utilisateur_organisations uo JOIN organisations_secours o ON o.id = uo.organisation_id
    WHERE uo.utilisateur_id = $1 AND 'ccs' = ANY(o.profils) AND o.config_id = $2`, [u.id, e.config_id])).rowCount;
  if (!ok) throw new ErreurHttp(403, 'etab_interdit');
  return e;
}

async function enregistrer(pool, u, b = {}) {
  exigerEnvironnement();
  const etabId = entier(b.etablissement_id); if (!etabId) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  await exigerSaisie(pool, u, etabId);
  const valeur = entier(b.valeur); const periode = entier(b.periode_min);
  if (valeur == null || valeur > 500) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'valeur' });
  if (!periode || periode < 15 || periode > 10080) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'periode_min' });
  const autorite = String(b.autorite || '').trim();
  if (autorite.length < 2 || autorite.length > 120) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'autorite' });
  const exception = b.exception == null ? 'aucune' : String(b.exception);
  if (!EXCEPTIONS.includes(exception)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'exception' });
  const fiabilite = String(b.fiabilite || 'a_verifier');
  if (!FIABILITES.includes(fiabilite)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'fiabilite' });
  const du = b.valide_du ? new Date(b.valide_du) : new Date(); const au = b.valide_au ? new Date(b.valide_au) : null;
  if (Number.isNaN(du.getTime()) || (au && (Number.isNaN(au.getTime()) || au <= du))) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'valide_au' });
  const ccsId = b.ccs_id != null ? entier(b.ccs_id) : null;
  const { rows: [q] } = await pool.query(`INSERT INTO quotes_parts (etablissement_id, ccs_id, autorite, valeur, periode_min, valide_du, valide_au, exception, source, fiabilite, saisi_par)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'saisie_manuelle', $9, $10) RETURNING *`, [etabId, ccsId, autorite, valeur, periode, du, au, exception, fiabilite, u.id]);
  await pool.query(`INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Quote-part', $3)`,
    [etabId, u.id, `Quote-part : ${valeur} par ${periode} min · ${autorite} · ${fiabilite}`]);
  require('./flux').signaler();
  return q;
}

/**
 * Quote-part applicable et compteurs, par hôpital. `null` = non renseignée. La marge n'est jamais calculée (formule non définie).
 * Reçues : arrivées enregistrées (H11 de Chrono ou arrivée signalée d'une préalerte) dans la période glissante de la quote-part.
 */
async function etat(db, etabIds) {
  const res = new Map(etabIds.map((id) => [id, null]));
  if (!actif() || !etabIds.length) return res;
  const qp = (await db.query(`SELECT DISTINCT ON (etablissement_id) * FROM quotes_parts
    WHERE etablissement_id = ANY($1) AND valide_du <= now() AND (valide_au IS NULL OR valide_au > now()) ORDER BY etablissement_id, saisi_le DESC, id DESC`, [etabIds])).rows;
  for (const q of qp) {
    const { rows: [c] } = await db.query(`SELECT
        (SELECT count(*)::int FROM prealertes p WHERE p.destination_id = $1 AND p.arrivee_signalee_le >= now() - make_interval(mins => $2))
        + (SELECT count(*)::int FROM passages_chrono pc JOIN v_horodatages_courants h ON h.objet = 'passage_chrono' AND h.objet_id = pc.id AND h.etape = 'H11'
             WHERE pc.etablissement_id = $1 AND pc.prealerte_id IS NULL AND h.heure >= now() - make_interval(mins => $2)) AS recues,
        (SELECT count(*)::int FROM prealertes p WHERE p.destination_id = $1 AND p.statut IN ('envoyee', 'recue', 'consultee', 'prise_en_compte', 'preparation', 'preparation_terminee')
             AND p.arrivee_signalee_le IS NULL) AS attendues,
        (SELECT count(*)::int FROM prealertes p JOIN etats_vehicules ev ON ev.unite_id = p.unite_id AND ev.etat = 'transport_hopital'
             WHERE p.destination_id = $1 AND p.statut NOT IN ('arrivee', 'cloturee', 'annulee', 'remplacee') AND p.arrivee_signalee_le IS NULL) AS en_route`, [q.etablissement_id, q.periode_min]);
    res.set(q.etablissement_id, { id: Number(q.id), valeur: q.valeur, periode_min: q.periode_min, autorite: q.autorite, valide_du: q.valide_du, valide_au: q.valide_au,
      exception: q.exception, source: q.source, fiabilite: q.fiabilite, actualise_le: q.saisi_le,
      recues: c.recues, attendues: c.attendues, en_route: c.en_route, marge: null, marge_regle: 'non_definie' });
  }
  return res;
}

async function historique(pool, u, q = {}) {
  exigerEnvironnement();
  const etabId = entier(q.etablissement_id); if (!etabId) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  if (u.role === 'repartiteur' || u.role === 'gestionnaire' || u.gestionnaire) await exigerSaisie(pool, u, etabId);
  else require('./auth').exigerEtablissement(u, etabId);
  const lignes = (await pool.query(`SELECT q.*, x.nom AS saisi_par_nom FROM quotes_parts q LEFT JOIN utilisateurs x ON x.id = q.saisi_par
    WHERE q.etablissement_id = $1 ORDER BY q.saisi_le DESC, q.id DESC LIMIT 100`, [etabId])).rows;
  return { applicable: (await etat(pool, [etabId])).get(etabId), historique: lignes,
    regle: 'Quote-part saisie par une autorité ; marge non calculée tant que sa formule n’est pas définie officiellement ; ne décide d’aucune destination.' };
}

module.exports = { enregistrer, etat, historique, actif, EXCEPTIONS, FIABILITES };
