'use strict';
/**
 * Suivi des alertes (chantier coordination, lot 2 « Coordonner », 26 nov. 2026 ; cahier final §4 et §15, cahier nº 2 §5).
 * Chaque alerte détectée par Vigilance reçoit un suivi unique (un seul ouvert par fait) :
 *   responsable (rôle) et remplaçant, échéance, accusé de réception, action engagée (liste fermée), escalade si personne ne répond,
 *   résolution confirmée par une personne. Quand le fait n'est plus détecté, le suivi passe à « levée » : ce n'est pas une
 *   résolution confirmée. Un accusé de réception ne résout rien. Aucune action n'est exécutée automatiquement.
 * Les destinataires et délais par défaut viennent du cahier nº 2 (§5) ; chaque établissement peut les modifier (escalades_regles).
 */
const { ErreurHttp, transaction } = require('./db');
const { exigerEtablissement } = require('./auth');

const ACTIONS = ['contact_responsable', 'relance_partenaire', 'ressource_mobilisee', 'reaffectation', 'escalade_demandee', 'attente_externe'];
const ROLES = ['coordonnateur', 'gestionnaire', 'entretien', 'admin_etab', 'equipe_soins'];
const ROLES_PILOTAGE = ['coordonnateur', 'gestionnaire', 'admin_etab'];
const OUVERTS = ['ouverte', 'accusee', 'en_action'];

/** Grille par défaut : [rôle, délai de réponse en minutes] par niveau (0 = responsable initial). Proposée, à valider localement. */
const GRILLE_DEFAUT = {
  ambulance_immobilisee: [['coordonnateur', 10], ['gestionnaire', 15], ['admin_etab', 15]],
  ambulances_attendues: [['coordonnateur', 15], ['gestionnaire', 15]],
  transport_en_retard: [['coordonnateur', 20], ['gestionnaire', 30]],
  transport_non_confirme: [['coordonnateur', 30], ['gestionnaire', 30]],
  placement_non_realise: [['coordonnateur', 60], ['gestionnaire', 120]],
  transfert_sans_reponse: [['coordonnateur', 30], ['gestionnaire', 60]],
  connecteur_silencieux: [['admin_etab', 30], ['gestionnaire', 60]],
  nettoyage_en_attente: [['entretien', 30], ['coordonnateur', 30], ['gestionnaire', 60]],
  civiere_nettoyage: [['entretien', 15], ['coordonnateur', 15], ['gestionnaire', 30]],
  attente_admission: [['coordonnateur', 30], ['gestionnaire', 60]],
  reservation_prolongee: [['coordonnateur', 30], ['gestionnaire', 60]],
  quote_part_contradiction: [['coordonnateur', 15], ['gestionnaire', 30]],
  _defaut: [['coordonnateur', 60], ['gestionnaire', 120]],
};

const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const cleDe = (a) => `${a.type}:${a.genre}:${a.ressource_id}`;

/** Grille effective d'un établissement pour un type : règles enregistrées, sinon défaut. */
async function grille(db, etabId, type) {
  const r = (await db.query('SELECT niveau, role, delai_min FROM escalades_regles WHERE etablissement_id = $1 AND type = $2 ORDER BY niveau', [etabId, type])).rows;
  if (r.length) return r.map((x) => [x.role, x.delai_min]);
  return GRILLE_DEFAUT[type] || GRILLE_DEFAUT._defaut;
}
async function roleActif(db, etabId, role) {
  return (await db.query(`SELECT 1 FROM utilisateurs u JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id
    WHERE ue.etablissement_id = $1 AND u.role = $2 AND u.actif LIMIT 1`, [etabId, role])).rowCount > 0;
}
async function journaliser(c, suiviId, action, auteurId, detail = {}) {
  await c.query('INSERT INTO suivis_alertes_journal (suivi_id, action, auteur_id, detail) VALUES ($1, $2, $3, $4)', [suiviId, action, auteurId, detail]);
}

/**
 * Niveau effectif à l'ouverture ou à l'escalade : si personne n'occupe le rôle prévu dans l'établissement (responsable absent),
 * on passe au niveau suivant et on le trace.
 */
async function niveauEffectif(c, etabId, g, depart, suivi, ressource, absents = []) {
  let n = depart;
  while (n < g.length - 1 && !(await roleActif(c, etabId, g[n][0]))) {
    if (suivi) await journaliser(c, suivi, 'responsable_absent', null, { role: g[n][0], niveau: n });
    else absents.push({ role: g[n][0], niveau: n });
    await require('./services').notifier(c, etabId, null, 'alerte_responsable_absent', { ressource, absent: g[n][0], role: g[n + 1][0] });
    n += 1;
  }
  return n;
}

/** Ouvre, met à jour ou lève les suivis d'un établissement à partir des alertes détectées. */
async function synchroniserEtab(pool, etabId) {
  const v = await require('./vigilance').blocages(pool, { langue: 'fr' }, etabId, { interne: true });
  const vues = new Set();
  let ouverts = 0;
  for (const a of v.alertes) {
    const cle = cleDe(a); vues.add(cle);
    await transaction(pool, async (c) => {
      const exist = (await c.query(`SELECT id FROM suivis_alertes WHERE etablissement_id = $1 AND cle = $2 AND statut = ANY($3) FOR UPDATE`, [etabId, cle, OUVERTS])).rows[0];
      if (exist) {
        await c.query('UPDATE suivis_alertes SET niveau = $2, titre = $3 WHERE id = $1 AND (niveau <> $2 OR titre <> $3)', [exist.id, a.niveau, a.titre]);
        return;
      }
      const g = await grille(c, etabId, a.type);
      const absents = [];
      const n = await niveauEffectif(c, etabId, g, 0, null, a.ressource, absents);
      const { rows: [s] } = await c.query(`INSERT INTO suivis_alertes (etablissement_id, cle, type, niveau, titre, objet, escalade_niveau, responsable_role, remplacant_role, echeance)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + make_interval(mins => $10))
        ON CONFLICT (etablissement_id, cle) WHERE statut IN ('ouverte', 'accusee', 'en_action') DO NOTHING RETURNING id`,
      [etabId, cle, a.type, a.niveau, a.titre, a.objet || { genre: a.genre, id: a.ressource_id, ressource: a.ressource }, n, g[n][0], g[n + 1]?.[0] || null, g[n][1]]);
      if (s) {
        for (const x of absents) await journaliser(c, s.id, 'responsable_absent', null, x);
        await journaliser(c, s.id, 'ouverture', null, { niveau: n, role: g[n][0] }); ouverts += 1;
      }
    });
  }
  // Faits disparus : « levée », jamais « résolue » sans confirmation humaine
  const { rowCount: levees } = await pool.query(`WITH l AS (UPDATE suivis_alertes SET statut = 'levee', levee_le = now(), version = version + 1
      WHERE etablissement_id = $1 AND statut = ANY($2) AND NOT (cle = ANY($3)) RETURNING id)
    INSERT INTO suivis_alertes_journal (suivi_id, action) SELECT id, 'levee' FROM l`, [etabId, OUVERTS, [...vues]]);
  return { ouverts, levees };
}

/** Escalade des suivis sans réponse (ouverts ou seulement accusés) dont l'échéance est dépassée. */
async function escalader(pool) {
  let n = 0;
  const dus = (await pool.query(`SELECT id FROM suivis_alertes WHERE statut IN ('ouverte', 'accusee') AND echeance < now() ORDER BY echeance LIMIT 200`)).rows;
  for (const { id } of dus) {
    await transaction(pool, async (c) => {
      const s = (await c.query(`SELECT * FROM suivis_alertes WHERE id = $1 AND statut IN ('ouverte', 'accusee') AND echeance < now() FOR UPDATE SKIP LOCKED`, [id])).rows[0];
      if (!s) return;
      const g = await grille(c, s.etablissement_id, s.type);
      const ressource = s.objet?.numero || s.objet?.ressource || s.cle;
      if (s.escalade_niveau >= g.length - 1) {
        // Dernier niveau atteint : on ne réenvoie pas en boucle ; l'échéance est repoussée et le fait reste visible
        await c.query('UPDATE suivis_alertes SET echeance = now() + make_interval(mins => $2), version = version + 1 WHERE id = $1', [s.id, g[g.length - 1][1]]);
        await journaliser(c, s.id, 'dernier_niveau', null, { niveau: s.escalade_niveau });
        return;
      }
      const suivant = await niveauEffectif(c, s.etablissement_id, g, s.escalade_niveau + 1, s.id, ressource);
      await c.query(`UPDATE suivis_alertes SET escalade_niveau = $2, responsable_role = $3, remplacant_role = $4, statut = 'ouverte',
          echeance = now() + make_interval(mins => $5), version = version + 1 WHERE id = $1`,
      [s.id, suivant, g[suivant][0], g[suivant + 1]?.[0] || null, g[suivant][1]]);
      await journaliser(c, s.id, 'escalade', null, { de: s.escalade_niveau, vers: suivant, role: g[suivant][0] });
      await require('./services').notifier(c, s.etablissement_id, null, 'alerte_escalade', { ressource, niveau: suivant, role: g[suivant][0] });
      n += 1;
    });
  }
  return n;
}

/** Tâche périodique : synchronise tous les établissements actifs puis escalade. */
async function tourner(pool) {
  const etabs = (await pool.query('SELECT id FROM etablissements WHERE actif AND module_actif ORDER BY id')).rows;
  let ouverts = 0; let levees = 0;
  for (const e of etabs) {
    try { const r = await synchroniserEtab(pool, e.id); ouverts += r.ouverts; levees += r.levees; }
    catch (err) { console.error(`Suivi des alertes, établissement ${e.id} :`, err.code || err.message); }
  }
  const escalades = await escalader(pool);
  try { await require('./couverture').controler(pool); } catch (err) { console.error('Couverture :', err.code || err.message); }
  if (ouverts || levees || escalades) require('./flux').signaler();
  return { ouverts, levees, escalades };
}

/* ------------------------------------------------------------------ API */
function exigerPersonnel(u, etabId) {
  exigerEtablissement(u, etabId);
  if (!ROLES.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
}
async function liste(pool, u, q = {}) {
  const etabId = entier(q.etablissement_id); if (!etabId) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerPersonnel(u, etabId);
  const rows = (await pool.query(`SELECT s.*, ua.nom AS assigne_nom, uc.nom AS accuse_nom, ur.nom AS resolue_nom
      FROM suivis_alertes s LEFT JOIN utilisateurs ua ON ua.id = s.assigne_a LEFT JOIN utilisateurs uc ON uc.id = s.accuse_par
      LEFT JOIN utilisateurs ur ON ur.id = s.resolue_par
     WHERE s.etablissement_id = $1 AND (s.statut = ANY($2) OR COALESCE(s.resolue_le, s.levee_le) > now() - interval '24 hours')
     ORDER BY (s.statut = ANY($2)) DESC, s.cree_le DESC LIMIT 300`, [etabId, OUVERTS])).rows;
  return rows.map(vue);
}
const vue = (s) => ({ id: Number(s.id), cle: s.cle, type: s.type, niveau: s.niveau, titre: s.titre, objet: s.objet, statut: s.statut,
  escalade_niveau: s.escalade_niveau, responsable_role: s.responsable_role, remplacant_role: s.remplacant_role,
  assigne_a: s.assigne_a, assigne_nom: s.assigne_nom ?? null, echeance: s.echeance, echeance_depassee: OUVERTS.includes(s.statut) && new Date(s.echeance) < new Date(),
  accuse_le: s.accuse_le, accuse_nom: s.accuse_nom ?? null, action_code: s.action_code, action_le: s.action_le,
  levee_le: s.levee_le, resolue_le: s.resolue_le, resolue_nom: s.resolue_nom ?? null, cree_le: s.cree_le, version: s.version });

async function charger(c, u, id, b) {
  const s = (await c.query('SELECT * FROM suivis_alertes WHERE id = $1 FOR UPDATE', [entier(id)])).rows[0];
  if (!s) throw new ErreurHttp(404, 'introuvable');
  exigerPersonnel(u, s.etablissement_id);
  if (b.version != null && Number(b.version) !== s.version) throw new ErreurHttp(409, 'version_perimee');
  return s;
}
/** Peut agir : le rôle responsable du niveau courant, son remplaçant, ou le pilotage de l'établissement. */
const peutAgir = (u, s) => [s.responsable_role, s.remplacant_role, ...ROLES_PILOTAGE].includes(u.role);

async function agir(pool, u, id, operation, b = {}) {
  const r = await transaction(pool, async (c) => {
    const s = await charger(c, u, id, b);
    if (!peutAgir(u, s)) throw new ErreurHttp(403, 'role_insuffisant');
    if (operation === 'resoudre') {
      if (!['ouverte', 'accusee', 'en_action', 'levee'].includes(s.statut)) throw new ErreurHttp(409, 'statut_incompatible');
      if (!ROLES_PILOTAGE.includes(u.role) && u.role !== s.responsable_role) throw new ErreurHttp(403, 'role_insuffisant');
      await c.query(`UPDATE suivis_alertes SET statut = 'resolue', resolue_le = now(), resolue_par = $2, version = version + 1 WHERE id = $1`, [s.id, u.id]);
      await journaliser(c, s.id, 'resolution_confirmee', u.id, { etait: s.statut });
    } else {
      if (!OUVERTS.includes(s.statut)) throw new ErreurHttp(409, 'statut_incompatible');
      if (operation === 'accuser') {
        if (s.accuse_le) return { deja: true, ...vue(s) };
        await c.query(`UPDATE suivis_alertes SET statut = 'accusee', accuse_le = now(), accuse_par = $2, version = version + 1 WHERE id = $1`, [s.id, u.id]);
        await journaliser(c, s.id, 'accuse', u.id);
      } else if (operation === 'action') {
        if (!ACTIONS.includes(b.action)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'action' });
        await c.query(`UPDATE suivis_alertes SET statut = 'en_action', action_code = $3, action_le = now(), action_par = $2,
            accuse_le = COALESCE(accuse_le, now()), accuse_par = COALESCE(accuse_par, $2), version = version + 1 WHERE id = $1`, [s.id, u.id, b.action]);
        await journaliser(c, s.id, 'action', u.id, { action: b.action });
      } else if (operation === 'attribuer') {
        const cible = entier(b.utilisateur_id);
        const ok = cible && (await c.query(`SELECT 1 FROM utilisateurs x JOIN utilisateur_etablissements ue ON ue.utilisateur_id = x.id
          WHERE x.id = $1 AND ue.etablissement_id = $2 AND x.actif AND x.role = ANY($3)`, [cible, s.etablissement_id, ROLES])).rowCount;
        if (!ok) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'utilisateur_id' });
        await c.query('UPDATE suivis_alertes SET assigne_a = $2, version = version + 1 WHERE id = $1', [s.id, cible]);
        await journaliser(c, s.id, 'attribution', u.id, { utilisateur_id: cible });
      } else throw new ErreurHttp(400, 'action_inconnue');
    }
    return vue((await c.query(`SELECT s.*, ua.nom AS assigne_nom, uc.nom AS accuse_nom, ur.nom AS resolue_nom FROM suivis_alertes s
      LEFT JOIN utilisateurs ua ON ua.id = s.assigne_a LEFT JOIN utilisateurs uc ON uc.id = s.accuse_par LEFT JOIN utilisateurs ur ON ur.id = s.resolue_par
      WHERE s.id = $1`, [s.id])).rows[0]);
  });
  require('./flux').signaler();
  return r;
}

async function journal(pool, u, id) {
  const s = (await pool.query('SELECT etablissement_id FROM suivis_alertes WHERE id = $1', [entier(id)])).rows[0];
  if (!s) throw new ErreurHttp(404, 'introuvable');
  exigerPersonnel(u, s.etablissement_id);
  return (await pool.query(`SELECT j.action, j.detail, j.cree_le, x.nom AS auteur FROM suivis_alertes_journal j LEFT JOIN utilisateurs x ON x.id = j.auteur_id
    WHERE j.suivi_id = $1 ORDER BY j.id`, [entier(id)])).rows;
}

/** Grille d'escalade : lecture par le personnel, modification par l'administration de l'établissement ou la gestion. */
async function lireGrille(pool, u, q = {}) {
  const etabId = entier(q.etablissement_id); if (!etabId) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerPersonnel(u, etabId);
  const types = [...new Set([...Object.keys(GRILLE_DEFAUT).filter((t) => t !== '_defaut'),
    ...(await pool.query('SELECT DISTINCT type FROM escalades_regles WHERE etablissement_id = $1', [etabId])).rows.map((r) => r.type)])];
  const res = {};
  for (const t of types) {
    const perso = (await pool.query('SELECT 1 FROM escalades_regles WHERE etablissement_id = $1 AND type = $2 LIMIT 1', [etabId, t])).rowCount > 0;
    res[t] = { niveaux: (await grille(pool, etabId, t)).map(([role, delai_min], niveau) => ({ niveau, role, delai_min })), configuree: perso };
  }
  return { etablissement_id: etabId, grille: res, note: 'Grille proposée par défaut (cahier nº 2, §5) : responsables et délais à valider avec l’établissement.' };
}
async function enregistrerGrille(pool, u, b = {}) {
  const etabId = entier(b.etablissement_id); if (!etabId) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, etabId);
  if (!['admin_etab', 'gestionnaire'].includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const type = String(b.type || '');
  if (!/^[a-z_]{3,40}$/.test(type)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'type' });
  const niveaux = Array.isArray(b.niveaux) ? b.niveaux : null;
  if (!niveaux || !niveaux.length || niveaux.length > 6) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'niveaux' });
  for (const n of niveaux) {
    if (!ROLES.includes(n.role)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'role' });
    if (!(Number.isInteger(n.delai_min) && n.delai_min >= 1 && n.delai_min <= 1440)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'delai_min' });
  }
  await transaction(pool, async (c) => {
    await c.query('DELETE FROM escalades_regles WHERE etablissement_id = $1 AND type = $2', [etabId, type]);
    for (const [i, n] of niveaux.entries()) {
      await c.query('INSERT INTO escalades_regles (etablissement_id, type, niveau, role, delai_min, modifie_par) VALUES ($1, $2, $3, $4, $5, $6)', [etabId, type, i, n.role, n.delai_min, u.id]);
    }
    await c.query(`INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Grille d’escalade', $3)`,
      [etabId, u.id, `${type} : ${niveaux.map((n) => `${n.role} ${n.delai_min} min`).join(' → ')}`]);
  });
  return lireGrille(pool, u, { etablissement_id: etabId });
}

/** Suivi ouvert correspondant à chaque alerte de Vigilance (même clé), pour l'afficher sur la fiche. */
async function pourAlertes(db, etabId, alertes) {
  if (!alertes.length) return;
  const rows = (await db.query(`SELECT s.*, ua.nom AS assigne_nom, uc.nom AS accuse_nom FROM suivis_alertes s
      LEFT JOIN utilisateurs ua ON ua.id = s.assigne_a LEFT JOIN utilisateurs uc ON uc.id = s.accuse_par
     WHERE s.etablissement_id = $1 AND s.statut = ANY($2)`, [etabId, OUVERTS])).rows;
  const parCle = new Map(rows.map((r) => [r.cle, r]));
  for (const a of alertes) { const s = parCle.get(cleDe(a)); a.suivi = s ? vue(s) : null; }
}

module.exports = { tourner, synchroniserEtab, escalader, liste, agir, journal, lireGrille, enregistrerGrille, pourAlertes, GRILLE_DEFAUT, ACTIONS, cleDe };
