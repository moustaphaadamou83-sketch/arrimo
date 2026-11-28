'use strict';
/**
 * Personnel & Tâches — « Mes tâches » (cahier du 22 nov. 2026). Moteur UNIQUE : les tâches de taches_etab (préparation, entretien,
 * administratif, transmission, relance) et, pour l'entretien, les lits et civières à l'état « nettoyage » (source unique des
 * nettoyages, tenue par src/regles.js). Aucune copie : la vue lit ces sources ; les actions passent par leurs routes existantes.
 * Attribution : à une personne (assigne_a) ou au rôle (file) ; réattribution par un responsable ; jamais à une personne d'un autre
 * établissement ni inactive. Aucune donnée patient dans les tâches de l'entretien.
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const RESPONSABLES = ['coordonnateur', 'admin_etab', 'gestionnaire'];
/* Paramètres propres aux modules (section 19) : valeurs par défaut, bornes vérifiées ; chaque réglage a un effet réel. */
const TYPES_INTERVENTION = ['courant', 'apres_depart', 'desinfection', 'preparation_chambre', 'preparation_materielle', 'verification'];
const DEFAUTS = {
  taches: { echeance_defaut_min: 120, prioritaire_avant_min: 60, notifier_attribution: true, attribution_auto: 'aucune' },
  nettoyage: { delai_nettoyage_min: 60, types_intervention: TYPES_INTERVENTION },
};
async function lireParametres(db, etabId, module) {
  const r = (await db.query('SELECT valeurs FROM parametres_modules WHERE etablissement_id = $1 AND module = $2', [etabId, module]).catch(() => ({ rows: [] }))).rows[0];
  return { ...DEFAUTS[module], ...(r?.valeurs || {}) };
}
async function parametres(pool, u, module, q = {}) {
  if (!DEFAUTS[module]) throw new ErreurHttp(404, 'objet_introuvable');
  const id = Number(q.etablissement_id); if (!Number.isSafeInteger(id) || id < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, id);
  if (!RESPONSABLES.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  return { module, valeurs: await lireParametres(pool, id, module), types_possibles: module === 'nettoyage' ? TYPES_INTERVENTION : undefined };
}
async function enregistrerParametres(pool, u, module, b = {}) {
  if (!DEFAUTS[module]) throw new ErreurHttp(404, 'objet_introuvable');
  const id = Number(b.etablissement_id); if (!Number.isSafeInteger(id) || id < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, id);
  if (!['admin_etab', 'coordonnateur'].includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const entier = (v, min, max, nom) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new ErreurHttp(400, 'parametre_invalide', { nom }); return n; };
  const v = b.valeurs || {}; let val;
  if (module === 'taches') val = { echeance_defaut_min: entier(v.echeance_defaut_min, 0, 2880, 'echeance_defaut_min'), prioritaire_avant_min: entier(v.prioritaire_avant_min, 0, 1440, 'prioritaire_avant_min'), notifier_attribution: v.notifier_attribution !== false, attribution_auto: v.attribution_auto === 'seul_agent' ? 'seul_agent' : 'aucune' };
  else {
    const types = Array.isArray(v.types_intervention) ? [...new Set(v.types_intervention.filter((x) => TYPES_INTERVENTION.includes(x)))] : [];
    if (!types.length) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'types_intervention' });
    val = { delai_nettoyage_min: entier(v.delai_nettoyage_min, 5, 1440, 'delai_nettoyage_min'), types_intervention: types };
  }
  await pool.query(`INSERT INTO parametres_modules (etablissement_id, module, valeurs, maj_par) VALUES ($1, $2, $3, $4)
    ON CONFLICT (etablissement_id, module) DO UPDATE SET valeurs = EXCLUDED.valeurs, maj_par = EXCLUDED.maj_par, maj_le = now()`, [id, module, val, u.id]);
  await pool.query("INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Paramètres du module', $3)", [id, u.id, `${module} : ${JSON.stringify(val)}`]);
  return { module, valeurs: val };
}

async function miennes(pool, u, q = {}) {
  const id = Number(q.etablissement_id); if (!Number.isSafeInteger(id) || id < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, id);
  const e = (await pool.query('SELECT type_etablissement FROM etablissements WHERE id = $1', [id])).rows[0];
  const resp = RESPONSABLES.includes(u.role);
  const t = (await pool.query(`SELECT t.id, t.type, t.titre, t.detail AS instructions, t.statut, t.echeance, t.assigne_role, t.assigne_a, t.version, t.cree_le, COALESCE(t.statut_depuis, t.cree_le) AS statut_depuis, t.assigne_le, l.code AS lieu, x.nom AS assigne_nom
      FROM taches_etab t LEFT JOIN lits l ON l.id = t.lit_id LEFT JOIN utilisateurs x ON x.id = t.assigne_a
     WHERE t.etablissement_id = $1 AND t.statut IN ('a_faire', 'en_cours')
       AND (t.assigne_a = $2 OR (t.assigne_a IS NULL AND (t.assigne_role = $3 OR ($4 AND t.assigne_role IS NULL))))
     ORDER BY t.echeance NULLS LAST, t.id`, [id, u.id, u.role, resp])).rows
    .map((x) => ({ ...x, source: 'tache', titre: u.role === 'entretien' ? String(x.titre).replace(/\s*(de|of)?\s*[RP]-\d{4,6}/g, '').trim() : x.titre }));
  // Nettoyages (lits et civières) : pour l'entretien et les responsables
  let nett = [];
  if (u.role === 'entretien' || resp) {
    // Lits ET civières à nettoyer (28 nov. 2026) ; création = libération, statut actuel = début du nettoyage s'il a commencé
    nett = (await pool.query(`SELECT 'lit:' || l.id AS id, 'nettoyage' AS type, l.code AS lieu, CASE WHEN l.nettoyage_debut IS NULL THEN 'a_faire' ELSE 'en_cours' END AS statut, l.etat_depuis AS depuis,
        l.etat_depuis AS cree_le, COALESCE(l.nettoyage_debut, l.etat_depuis) AS statut_depuis
      FROM lits l WHERE l.etablissement_id = $1 AND l.etat = 'nettoyage' AND l.actif
      UNION ALL SELECT 'civiere:' || c.id, 'nettoyage', c.code, CASE WHEN c.nettoyage_debut IS NULL THEN 'a_faire' ELSE 'en_cours' END, c.etat_depuis, c.etat_depuis, COALESCE(c.nettoyage_debut, c.etat_depuis)
      FROM civieres c WHERE c.etablissement_id = $1 AND c.etat = 'nettoyage' AND c.actif ORDER BY 5`, [id])).rows
      .map((x) => ({ ...x, source: 'nettoyage', titre: (u.langue === 'en' ? 'Clean ' : 'Nettoyer ') + x.lieu, echeance: null }));
  }
  const [pt, pn] = await Promise.all([lireParametres(pool, id, 'taches'), lireParametres(pool, id, 'nettoyage')]);
  const now = Date.now();
  for (const x of t) { const ech = x.echeance ? new Date(x.echeance).getTime() : null; x.en_retard = !!(ech && ech < now); x.prioritaire = x.en_retard || !!(ech && ech - now <= pt.prioritaire_avant_min * 60000); }
  for (const x of nett) { x.en_retard = !!(x.depuis && now - new Date(x.depuis).getTime() > pn.delai_nettoyage_min * 60000); x.prioritaire = x.en_retard; x.echeance = x.depuis ? new Date(new Date(x.depuis).getTime() + pn.delai_nettoyage_min * 60000).toISOString() : null; }
  const terminees = (await pool.query(`SELECT t.id, t.type, t.titre, 'faite' AS statut, t.fait_le, l.code AS lieu, x.nom AS fait_par_nom FROM taches_etab t LEFT JOIN lits l ON l.id = t.lit_id LEFT JOIN utilisateurs x ON x.id = t.fait_par
      WHERE t.etablissement_id = $1 AND t.statut = 'faite' AND t.fait_le >= current_date AND ($3 OR t.fait_par = $2) ORDER BY t.fait_le DESC LIMIT 50`, [id, u.id, resp])).rows
    .map((x) => ({ ...x, source: 'tache', titre: u.role === 'entretien' ? String(x.titre).replace(/\s*(de|of)?\s*[RP]-\d{4,6}/g, '').trim() : x.titre }));
  const toutes = [...t, ...nett];
  // Responsable : personnes actives de l'établissement (attribution, réattribution) — nom et rôle seulement
  const personnel = resp ? (await pool.query(`SELECT x.id, x.nom, x.role FROM utilisateurs x JOIN utilisateur_etablissements ue ON ue.utilisateur_id = x.id
      WHERE ue.etablissement_id = $1 AND x.actif ORDER BY x.role, x.nom`, [id])).rows : undefined;
  return { maintenant: new Date().toISOString(), taches: toutes, terminees, parametres: { taches: pt, nettoyage: { delai_nettoyage_min: pn.delai_nettoyage_min, types_intervention: pn.types_intervention } }, chsld: e?.type_etablissement === 'chsld', personnel, non_attribuees: resp ? t.filter((x) => !x.assigne_a).length : undefined, ecran: e?.type_etablissement === 'chsld' ? 'c-taches' : 'nettoyage' };
}

/**
 * Relève entre équipes (complémentaire nº 3, §6 ; 26 nov. 2026) : l'équipe sortante transmet ce qui reste ouvert (tâches non faites,
 * en retard, nettoyages, alertes suivies sans résolution), l'équipe entrante accuse la relève. Numéros et compteurs seulement :
 * aucun titre libre, aucune donnée clinique. Les indicateurs ne servent jamais à sanctionner une personne.
 */
async function preparerReleve(db, etabId) {
  const taches = (await db.query(`SELECT t.id, t.type, t.statut, t.echeance, t.assigne_role, (t.echeance < now()) AS en_retard, l.code AS lieu
      FROM taches_etab t LEFT JOIN lits l ON l.id = t.lit_id WHERE t.etablissement_id = $1 AND t.statut IN ('a_faire', 'en_cours') ORDER BY t.echeance NULLS LAST, t.id`, [etabId])).rows;
  const nettoyages = (await db.query(`SELECT code FROM lits WHERE etablissement_id = $1 AND etat = 'nettoyage' AND actif ORDER BY etat_depuis`, [etabId])).rows.map((x) => x.code);
  const alertes = (await db.query(`SELECT id, type, niveau, statut, responsable_role, echeance FROM suivis_alertes WHERE etablissement_id = $1 AND statut IN ('ouverte', 'accusee', 'en_action', 'levee')
      ORDER BY (niveau = 'eleve') DESC, cree_le`, [etabId])).rows.map((x) => ({ ...x, id: Number(x.id) }));
  return { taches: taches.map(({ id, type, statut, echeance, assigne_role, en_retard, lieu }) => ({ id, type, statut, echeance, assigne_role, en_retard: !!en_retard, lieu })),
    nettoyages, alertes,
    compteurs: { taches: taches.length, en_retard: taches.filter((x) => x.en_retard).length, nettoyages: nettoyages.length, alertes: alertes.length,
      alertes_elevees: alertes.filter((x) => x.niveau === 'eleve').length, resolutions_a_confirmer: alertes.filter((x) => x.statut === 'levee').length } };
}
async function releve(pool, u, q = {}) {
  const id = Number(q.etablissement_id); if (!Number.isSafeInteger(id) || id < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, id);
  const derniere = (await pool.query(`SELECT r.*, a.nom AS transmis_par_nom, b.nom AS accuse_par_nom FROM releves_equipe r JOIN utilisateurs a ON a.id = r.transmis_par
      LEFT JOIN utilisateurs b ON b.id = r.accuse_par WHERE r.etablissement_id = $1 ORDER BY r.transmis_le DESC LIMIT 1`, [id])).rows[0] || null;
  return { maintenant: await preparerReleve(pool, id), derniere: derniere && { ...derniere, id: Number(derniere.id) } };
}
async function transmettreReleve(pool, u, b = {}) {
  const id = Number(b.etablissement_id); if (!Number.isSafeInteger(id) || id < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, id);
  if (![...RESPONSABLES, 'equipe_soins', 'entretien'].includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  if (!['jour', 'soir', 'nuit'].includes(b.quart)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'quart' });
  const contenu = await preparerReleve(pool, id);
  const r = (await pool.query('INSERT INTO releves_equipe (etablissement_id, quart, transmis_par, contenu) VALUES ($1, $2, $3, $4) RETURNING *', [id, b.quart, u.id, contenu])).rows[0];
  await pool.query("INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Relève transmise', $3)",
    [id, u.id, `${b.quart} · tâches ouvertes : ${contenu.compteurs.taches}, en retard : ${contenu.compteurs.en_retard}, alertes : ${contenu.compteurs.alertes}`]);
  require('./flux').signaler();
  return { ...r, id: Number(r.id) };
}
async function accuserReleve(pool, u, releveId) {
  const r = (await pool.query('SELECT * FROM releves_equipe WHERE id = $1', [Number(releveId)])).rows[0];
  if (!r) throw new ErreurHttp(404, 'objet_introuvable');
  exigerEtablissement(u, r.etablissement_id);
  if (r.transmis_par === u.id) throw new ErreurHttp(409, 'releve_meme_personne');
  if (r.accuse_le) return { ...r, id: Number(r.id), deja: true };
  const n = (await pool.query('UPDATE releves_equipe SET accuse_par = $2, accuse_le = now() WHERE id = $1 AND accuse_le IS NULL RETURNING *', [r.id, u.id])).rows[0];
  await pool.query("INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Relève accusée', $3)", [r.etablissement_id, u.id, `${r.quart}`]);
  require('./flux').signaler();
  return { ...(n || r), id: Number(r.id) };
}

/** Attribution (responsable) : à une personne active de l'établissement, ou retour à la file (utilisateur_id null). Journalisée. */
async function attribuer(pool, u, tacheId, b = {}) {
  if (!RESPONSABLES.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const t = (await pool.query('SELECT * FROM taches_etab WHERE id = $1', [Number(tacheId)])).rows[0];
  if (!t) throw new ErreurHttp(404, 'objet_introuvable');
  exigerEtablissement(u, t.etablissement_id);
  if (!['a_faire', 'en_cours'].includes(t.statut)) throw new ErreurHttp(409, 'tache_close');
  let cible = null; let nom = null;
  if (b.utilisateur_id != null) {
    const x = (await pool.query(`SELECT x.id, x.nom, x.role FROM utilisateurs x JOIN utilisateur_etablissements ue ON ue.utilisateur_id = x.id AND ue.etablissement_id = $2 WHERE x.id = $1 AND x.actif`, [Number(b.utilisateur_id), t.etablissement_id])).rows[0];
    if (!x) throw new ErreurHttp(404, 'objet_introuvable');
    if (t.assigne_role && x.role !== t.assigne_role && !RESPONSABLES.includes(x.role)) throw new ErreurHttp(409, 'tache_role_incompatible');
    cible = x.id; nom = x.nom;
  }
  const r = (await pool.query('UPDATE taches_etab SET assigne_a = $2, version = version + 1 WHERE id = $1 RETURNING *', [t.id, cible])).rows[0];
  await pool.query("INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Tâche attribuée', $3)", [t.etablissement_id, u.id, `tâche ${t.id} → ${nom || 'file du rôle'}`]);
  if (cible && (await lireParametres(pool, t.etablissement_id, 'taches')).notifier_attribution) await require('./services').notifier(pool, t.etablissement_id, null, 'tache_attribuee', { titre: t.titre.replace(/\s*[RP]-\d{4,6}/g, '') }).catch(() => {});
  require('./flux').signaler();
  return r;
}

/** Retards (toutes les 15 min) : une notification par tâche en retard, une seule fois ; aucune donnée patient (titre nettoyé). Idempotent. */
async function notifierRetards(pool) {
  const r = (await pool.query(`UPDATE taches_etab SET retard_notifie_le = now() WHERE statut IN ('a_faire', 'en_cours') AND echeance < now() AND retard_notifie_le IS NULL
    RETURNING id, etablissement_id, titre`)).rows;
  for (const t of r) await require('./services').notifier(pool, t.etablissement_id, null, 'tache_en_retard', { titre: String(t.titre).replace(/\s*[RP]-\d{4,6}/g, '') }).catch(() => {});
  return r.length;
}
module.exports = { releve, transmettreReleve, accuserReleve, notifierRetards, miennes, attribuer, parametres, enregistrerParametres, lireParametres };
