'use strict';
/**
 * Nettoyage selon les précautions de la chambre (avenant du 6 nov. 2026).
 * - Les précautions sont décidées par le personnel habilité, jamais déduites par OG ni par un diagnostic.
 * - Une chambre sans précaution suit exactement le parcours habituel : aucune intervention n'est créée.
 * - La confirmation de l'agent ne lève aucune précaution et ne rend jamais la chambre attribuable.
 * - L'agent voit la chambre, le protocole et les équipements : ni patient, ni résident, ni diagnostic.
 */
const { ErreurHttp, transaction } = require('./db');
const { exigerEtablissement } = require('./auth');

const PRECAUTIONS = ['contact', 'gouttelettes', 'aerien', 'acces_interdit', 'attente_validation'];
const RESTREINTES = ['acces_interdit', 'attente_validation'];
const FORMATIONS = ['precautions_contact', 'precautions_gouttelettes', 'precautions_aeriennes', 'nettoyage_terminal'];
const EPI = ['gants', 'blouse', 'masque_chirurgical', 'n95', 'protection_oculaire'];
const INTERVENTIONS = ['courant', 'terminal'];
const SUPERVISION = ['coordonnateur', 'admin_etab', 'gestionnaire'];
const CLINIQUE = [...SUPERVISION, 'equipe_soins'];
const OUVERTES = ['en_cours', 'controle_requis'];

const exigerRole = (u, roles) => { if (!roles.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant'); };
function liste(v, permis, code) {
  if (!Array.isArray(v) || v.some((x) => !permis.includes(x))) throw new ErreurHttp(400, code);
  return [...new Set(v)];
}
const texte = (v, max) => { const s = String(v ?? '').trim(); if (s.length > max) throw new ErreurHttp(400, 'texte_trop_long'); return s || null; };

async function lire(db, litId, verrou = false) {
  const r = (await db.query(`SELECT l.id AS lit_id, l.code, l.etat, l.etablissement_id, ch.id AS chambre_id, ch.numero AS chambre, ch.precautions, ch.precautions_version
    FROM lits l JOIN chambres ch ON ch.id = l.chambre_id WHERE l.id = $1${verrou ? ' FOR UPDATE OF ch' : ''}`, [litId])).rows[0];
  if (!r) throw new ErreurHttp(404, 'lit_introuvable');
  return r;
}
const interventionOuverte = async (db, litId, verrou = false) => (await db.query(`SELECT * FROM nettoyage_interventions WHERE lit_id = $1 AND statut = ANY($2) ORDER BY id DESC LIMIT 1${verrou ? ' FOR UPDATE' : ''}`, [litId, OUVERTES])).rows[0] || null;

/** Conditions d'intervention pour cet agent. Chaque manque est un code, sans aucune information sur le patient. */
async function conditions(db, ch, agentId) {
  const precautions = ch.precautions || [];
  if (!precautions.length) return { precautions, autorisee: true, blocages: [], protocole: null };
  if (precautions.some((p) => RESTREINTES.includes(p))) return { precautions, autorisee: false, blocages: ['acces_restreint'], protocole: null };
  const protocole = (await db.query(`SELECT id, nom, type_intervention, formations, epi, instructions, controle_requis, delai_min FROM nettoyage_protocoles
    WHERE etablissement_id = $1 AND actif AND valide_le IS NOT NULL AND precautions @> $2 ORDER BY cardinality(precautions), id LIMIT 1`, [ch.etablissement_id, precautions])).rows[0] || null;
  if (!protocole) return { precautions, autorisee: false, blocages: ['protocole_absent'], protocole: null };
  const blocages = [];
  const acquises = (await db.query('SELECT formation, expire_le FROM agent_formations WHERE etablissement_id = $1 AND utilisateur_id = $2', [ch.etablissement_id, agentId])).rows;
  for (const f of protocole.formations) {
    const x = acquises.find((a) => a.formation === f);
    if (!x) blocages.push(`formation_manquante:${f}`);
    else if (new Date(x.expire_le) <= new Date()) blocages.push(`habilitation_expiree:${f}`);
  }
  if (protocole.epi.length) {
    const dispo = (await db.query('SELECT epi FROM etablissement_epi WHERE etablissement_id = $1 AND disponible', [ch.etablissement_id])).rows.map((x) => x.epi);
    for (const e of protocole.epi) if (!dispo.includes(e)) blocages.push(`epi_indisponible:${e}`);
  }
  return { precautions, autorisee: !blocages.length, blocages, protocole };
}
/** Ce que l'agent a besoin de voir pour un lit : jamais le patient, le résident ni un diagnostic. */
async function consignes(db, litId, agentId) {
  const ch = await lire(db, litId);
  if (!(ch.precautions || []).length && !(await interventionOuverte(db, litId))) return { precautions: [], autorisee: true, blocages: [], protocole: null, intervention: null };
  const x = await conditions(db, ch, agentId);
  const i = await interventionOuverte(db, litId);
  const p = x.protocole;
  return { precautions: x.precautions, autorisee: x.autorisee, blocages: x.blocages,
    protocole: p && { nom: p.nom, type_intervention: p.type_intervention, epi: p.epi, instructions: p.instructions, controle_requis: p.controle_requis },
    intervention: i && { id: i.id, statut: i.statut, debut_le: i.debut_le, fin_le: i.fin_le, version_changee: i.precautions_version !== ch.precautions_version } };
}
/** Début d'intervention, dans la transaction de l'appelant. Sans précaution : rien (parcours habituel). */
async function ouvrir(c, u, litId) {
  const ch = await lire(c, litId, true);
  if (!(ch.precautions || []).length) return null;
  const x = await conditions(c, ch, u.id);
  if (!x.autorisee) throw new ErreurHttp(409, 'nettoyage_bloque', { raisons: x.blocages.join(', '), chambre: ch.chambre, etablissement_id: ch.etablissement_id, lit_id: litId });
  const deja = await interventionOuverte(c, litId, true);
  if (deja) throw new ErreurHttp(409, 'nettoyage_impossible');
  return (await c.query(`INSERT INTO nettoyage_interventions (etablissement_id, lit_id, chambre_id, protocole_id, precautions, precautions_version, statut, agent_id)
    VALUES ($1, $2, $3, $4, $5, $6, 'en_cours', $7) RETURNING *`, [ch.etablissement_id, litId, ch.chambre_id, x.protocole.id, ch.precautions, ch.precautions_version, u.id])).rows[0];
}
/** Un blocage est signalé au superviseur, hors de la transaction annulée. */
async function signalerBlocage(pool, e, u) {
  if (e?.code !== 'nettoyage_bloque') return;
  const { notifier } = require('./services');
  await notifier(pool, e.vars.etablissement_id, null, 'nettoyage_bloque', { chambre: e.vars.chambre, raisons: e.vars.raisons });
  await require('./regles').journaliser(pool, { litId: e.vars.lit_id, utilisateurId: u.id, action: 'Nettoyage bloqué', detail: e.vars.raisons, refuse: true });
}
/** Garde de src/regles.js : seul un contrôle validé remet en service, et une chambre restreinte n'est jamais attribuée. */
async function garde(c, lit, nouveau, opts = {}) {
  if (lit.etat === 'nettoyage' && nouveau === 'libre' && !opts.nettoyageValide) {
    const ch = await lire(c, lit.id);
    if ((ch.precautions || []).length || await interventionOuverte(c, lit.id)) throw new ErreurHttp(409, 'controle_nettoyage_requis', { code: lit.code });
  }
  if (['reserve', 'occupe'].includes(nouveau)) {
    const ch = await lire(c, lit.id);
    if ((ch.precautions || []).some((p) => RESTREINTES.includes(p))) throw new ErreurHttp(409, 'chambre_acces_restreint', { code: lit.code });
  }
}
async function cloturer(c, pool, u, i, litId) {
  const n = (await c.query(`UPDATE nettoyage_interventions SET statut = 'validee', controle_par = $2, controle_le = now(), version = version + 1 WHERE id = $1 RETURNING *`, [i.id, u.id])).rows[0];
  const lit = (await c.query('SELECT etat FROM lits WHERE id = $1', [litId])).rows[0];
  if (lit.etat === 'nettoyage') await require('./regles').changerEtat(c, pool, u.id, litId, 'libre', { detail: 'Chambre propre et validée', nettoyageValide: true });
  const taches = (await c.query(`SELECT count(*)::int n FROM taches_etab WHERE lit_id = $1 AND type IN ('entretien', 'preparation_chambre') AND statut IN ('a_faire', 'en_cours')`, [litId])).rows[0].n;
  if (lit.etat !== 'nettoyage' && !taches) await c.query(`UPDATE lits SET entretien_statut = 'propre', entretien_le = now(), entretien_par = $2 WHERE id = $1`, [litId, u.id]);
  return n;
}
/** Fin par l'agent : contrôle requis, ou validation immédiate si le protocole n'en exige pas et que les précautions n'ont pas changé. */
async function fin(c, pool, u, litId) {
  const i = await interventionOuverte(c, litId, true);
  if (!i || i.statut !== 'en_cours') throw new ErreurHttp(409, 'intervention_non_commencee');
  if (i.agent_id !== u.id && !SUPERVISION.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const n = (await c.query(`UPDATE nettoyage_interventions SET statut = 'controle_requis', fin_le = now(), version = version + 1 WHERE id = $1 RETURNING *`, [i.id])).rows[0];
  const p = (await c.query('SELECT controle_requis, delai_min FROM nettoyage_protocoles WHERE id = $1', [i.protocole_id])).rows[0];
  const ch = await lire(c, litId);
  if (!p.controle_requis && !p.delai_min && ch.precautions_version === i.precautions_version) return cloturer(c, pool, u, n, litId);
  const { notifier } = require('./services');
  await notifier(c, i.etablissement_id, null, 'nettoyage_controle', { chambre: ch.chambre });
  return n;
}
/** Tâche d'entretien d'une place (CHSLD). Rend vrai si la place ne peut pas encore être dite propre. */
async function pourTache(c, pool, u, tache, statut) {
  if (!tache.lit_id || !['entretien', 'preparation_chambre'].includes(tache.type)) return false;
  const ch = await lire(c, tache.lit_id);
  const i = await interventionOuverte(c, tache.lit_id);
  if (!(ch.precautions || []).length && !i) return false;
  if (statut === 'en_cours') { if (!i) await ouvrir(c, u, tache.lit_id); return true; }
  if (statut === 'faite') {
    if (!i || i.statut !== 'en_cours') throw new ErreurHttp(409, 'intervention_non_commencee');
    const n = await fin(c, pool, u, tache.lit_id);
    return n.statut !== 'validee';
  }
  return true;
}
const avecBlocage = async (pool, u, fn) => { try { return await fn(); } catch (e) { await signalerBlocage(pool, e, u); throw e; } };

function brancher(api, pool, route, entier) {
  const { journaliser } = require('./regles');
  const etabDe = async (u, id, roles) => { exigerEtablissement(u, id); exigerRole(u, roles); return id; };
  // Précautions de la chambre : personnel habilité seulement. Aucun motif clinique n'est demandé ni conservé.
  api.get('/chambres/precautions', route(async (req) => {
    const e = await etabDe(req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'), CLINIQUE);
    return (await pool.query(`SELECT ch.id, ch.numero, ch.precautions, ch.precautions_version AS version, u.nom AS unite FROM chambres ch JOIN unites u ON u.id = ch.unite_id
      WHERE u.etablissement_id = $1 AND ch.actif ORDER BY u.nom, ch.numero LIMIT 1000`, [e])).rows;
  }));
  api.put('/chambres/:id/precautions', route(async (req) => {
    const id = entier(req.params.id, 'id'); const u = req.utilisateur;
    const valeurs = liste(req.body?.precautions, PRECAUTIONS, 'precautions_invalides');
    return transaction(pool, async (c) => {
      const ch = (await c.query('SELECT ch.*, un.etablissement_id FROM chambres ch JOIN unites un ON un.id = ch.unite_id WHERE ch.id = $1 FOR UPDATE OF ch', [id])).rows[0];
      if (!ch) throw new ErreurHttp(404, 'chambre_introuvable');
      await etabDe(u, ch.etablissement_id, CLINIQUE);
      if (Number(req.body?.version) !== ch.precautions_version) throw new ErreurHttp(409, 'version_perimee');
      const n = (await c.query('UPDATE chambres SET precautions = $2, precautions_version = precautions_version + 1 WHERE id = $1 RETURNING id, numero, precautions, precautions_version AS version', [id, valeurs])).rows[0];
      await c.query('INSERT INTO chambre_precautions_historique (chambre_id, etablissement_id, precautions, par) VALUES ($1, $2, $3, $4)', [id, ch.etablissement_id, valeurs, u.id]);
      const lits = (await c.query('SELECT id FROM lits WHERE chambre_id = $1', [id])).rows;
      for (const l of lits) await journaliser(c, { litId: l.id, utilisateurId: u.id, action: 'Précautions de la chambre modifiées', detail: valeurs.join(', ') || 'pratiques de base' });
      const enCours = (await c.query(`SELECT count(*)::int n FROM nettoyage_interventions WHERE chambre_id = $1 AND statut = ANY($2)`, [id, OUVERTES])).rows[0].n;
      if (enCours) await require('./services').notifier(c, ch.etablissement_id, null, 'nettoyage_precautions_modifiees', { chambre: ch.numero });
      return n;
    });
  }));
  api.get('/chambres/:id/precautions/historique', route(async (req) => {
    const id = entier(req.params.id, 'id');
    const ch = (await pool.query('SELECT un.etablissement_id FROM chambres ch JOIN unites un ON un.id = ch.unite_id WHERE ch.id = $1', [id])).rows[0];
    if (!ch) throw new ErreurHttp(404, 'chambre_introuvable');
    await etabDe(req.utilisateur, ch.etablissement_id, CLINIQUE);
    return (await pool.query(`SELECT h.precautions, h.le, u.nom AS par FROM chambre_precautions_historique h LEFT JOIN utilisateurs u ON u.id = h.par WHERE h.chambre_id = $1 ORDER BY h.id DESC LIMIT 100`, [id])).rows;
  }));
  // Protocoles, équipements, habilitations : supervision seulement
  api.get('/nettoyage/configuration', route(async (req) => {
    const e = await etabDe(req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'), SUPERVISION);
    const [protocoles, epi, formations, agents] = await Promise.all([
      pool.query('SELECT * FROM nettoyage_protocoles WHERE etablissement_id = $1 ORDER BY actif DESC, nom', [e]),
      pool.query('SELECT epi, disponible FROM etablissement_epi WHERE etablissement_id = $1', [e]),
      pool.query('SELECT utilisateur_id, formation, expire_le FROM agent_formations WHERE etablissement_id = $1', [e]),
      pool.query(`SELECT u.id, u.nom FROM utilisateurs u JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id WHERE ue.etablissement_id = $1 AND u.role = 'entretien' AND u.actif ORDER BY u.nom`, [e])]);
    return { protocoles: protocoles.rows, epi: epi.rows, formations: formations.rows, agents: agents.rows, catalogue: { precautions: PRECAUTIONS.filter((p) => !RESTREINTES.includes(p)), formations: FORMATIONS, epi: EPI, interventions: INTERVENTIONS } };
  }));
  api.post('/nettoyage/protocoles', route(async (req) => {
    const b = req.body || {}; const e = await etabDe(req.utilisateur, entier(b.etablissement_id, 'etablissement_id'), SUPERVISION);
    const nom = texte(b.nom, 120); if (!nom) throw new ErreurHttp(400, 'protocole_invalide');
    if (!INTERVENTIONS.includes(b.type_intervention)) throw new ErreurHttp(400, 'protocole_invalide');
    const delai = Number(b.delai_min ?? 0); if (!Number.isInteger(delai) || delai < 0 || delai > 1440) throw new ErreurHttp(400, 'protocole_invalide');
    return (await pool.query(`INSERT INTO nettoyage_protocoles (etablissement_id, nom, type_intervention, precautions, formations, epi, instructions, controle_requis, delai_min, valide_par, valide_le)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now()) RETURNING *`, [e, nom, b.type_intervention,
      liste(b.precautions, PRECAUTIONS.filter((p) => !RESTREINTES.includes(p)), 'protocole_invalide'), liste(b.formations ?? [], FORMATIONS, 'protocole_invalide'), liste(b.epi ?? [], EPI, 'protocole_invalide'),
      texte(b.instructions, 2000), b.controle_requis !== false, delai, req.utilisateur.id])).rows[0];
  }));
  api.put('/nettoyage/protocoles/:id', route(async (req) => {
    const id = entier(req.params.id, 'id');
    const p = (await pool.query('SELECT etablissement_id FROM nettoyage_protocoles WHERE id = $1', [id])).rows[0];
    if (!p) throw new ErreurHttp(404, 'protocole_introuvable');
    await etabDe(req.utilisateur, p.etablissement_id, SUPERVISION);
    if (typeof req.body?.actif !== 'boolean') throw new ErreurHttp(400, 'protocole_invalide');
    return (await pool.query('UPDATE nettoyage_protocoles SET actif = $2 WHERE id = $1 RETURNING *', [id, req.body.actif])).rows[0];
  }));
  api.put('/nettoyage/epi', route(async (req) => {
    const b = req.body || {}; const e = await etabDe(req.utilisateur, entier(b.etablissement_id, 'etablissement_id'), SUPERVISION);
    if (!EPI.includes(b.epi) || typeof b.disponible !== 'boolean') throw new ErreurHttp(400, 'epi_invalide');
    await pool.query(`INSERT INTO etablissement_epi (etablissement_id, epi, disponible, modifie_par) VALUES ($1, $2, $3, $4)
      ON CONFLICT (etablissement_id, epi) DO UPDATE SET disponible = $3, modifie_par = $4, modifie_le = now()`, [e, b.epi, b.disponible, req.utilisateur.id]);
    return { epi: b.epi, disponible: b.disponible };
  }));
  api.put('/nettoyage/formations', route(async (req) => {
    const b = req.body || {}; const e = await etabDe(req.utilisateur, entier(b.etablissement_id, 'etablissement_id'), SUPERVISION);
    const agent = entier(b.utilisateur_id, 'utilisateur_id');
    if (!FORMATIONS.includes(b.formation)) throw new ErreurHttp(400, 'formation_invalide');
    if (!(await pool.query('SELECT 1 FROM utilisateur_etablissements WHERE utilisateur_id = $1 AND etablissement_id = $2', [agent, e])).rowCount) throw new ErreurHttp(404, 'utilisateur_introuvable');
    if (b.expire_le === null) { await pool.query('DELETE FROM agent_formations WHERE etablissement_id = $1 AND utilisateur_id = $2 AND formation = $3', [e, agent, b.formation]); return { retiree: true }; }
    const fin_ = new Date(b.expire_le); if (Number.isNaN(fin_.getTime())) throw new ErreurHttp(400, 'date_invalide');
    await pool.query(`INSERT INTO agent_formations (etablissement_id, utilisateur_id, formation, expire_le, accordee_par) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (etablissement_id, utilisateur_id, formation) DO UPDATE SET expire_le = $4, accordee_par = $5, accordee_le = now()`, [e, agent, b.formation, fin_, req.utilisateur.id]);
    return { formation: b.formation, expire_le: fin_ };
  }));
  api.get('/nettoyage/controles', route(async (req) => {
    const e = await etabDe(req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'), SUPERVISION);
    return (await pool.query(`SELECT i.id, i.lit_id, i.statut, i.fin_le, i.precautions, l.code AS lit, ch.numero AS chambre, u.nom AS agent, (ch.precautions_version <> i.precautions_version) AS version_changee
      FROM nettoyage_interventions i JOIN lits l ON l.id = i.lit_id JOIN chambres ch ON ch.id = i.chambre_id JOIN utilisateurs u ON u.id = i.agent_id
      WHERE i.etablissement_id = $1 AND i.statut = 'controle_requis' ORDER BY i.fin_le`, [e])).rows;
  }));
  // Fin, contrôle et reprise d'une intervention
  const litDe = async (req) => { const id = entier(req.params.id, 'id'); const ch = await lire(pool, id); exigerEtablissement(req.utilisateur, ch.etablissement_id); return id; };
  api.post('/nettoyage/:id/terminer', route(async (req) => { const id = await litDe(req); return transaction(pool, async (c) => {
    const n = await fin(c, pool, req.utilisateur, id);
    await journaliser(c, { litId: id, utilisateurId: req.utilisateur.id, action: 'Nettoyage terminé', detail: n.statut });
    return n; }); }));
  api.post('/nettoyage/:id/valider', route(async (req) => { const id = await litDe(req); exigerRole(req.utilisateur, SUPERVISION); return transaction(pool, async (c) => {
    const i = await interventionOuverte(c, id, true);
    if (!i || i.statut !== 'controle_requis') throw new ErreurHttp(409, 'controle_impossible');
    const ch = await lire(c, id, true);
    if (ch.precautions_version !== i.precautions_version) throw new ErreurHttp(409, 'precautions_modifiees');
    if ((ch.precautions || []).some((p) => RESTREINTES.includes(p))) throw new ErreurHttp(409, 'chambre_acces_restreint', { code: ch.code });
    const p = (await c.query('SELECT delai_min FROM nettoyage_protocoles WHERE id = $1', [i.protocole_id])).rows[0];
    if (new Date(i.fin_le).getTime() + p.delai_min * 60000 > Date.now()) throw new ErreurHttp(409, 'delai_non_ecoule', { minutes: p.delai_min });
    const n = await cloturer(c, pool, req.utilisateur, i, id);
    await journaliser(c, { litId: id, utilisateurId: req.utilisateur.id, action: 'Nettoyage validé', detail: `Agent n° ${i.agent_id}` });
    return n; }); }));
  api.post('/nettoyage/:id/reprendre', route(async (req) => { const id = await litDe(req); exigerRole(req.utilisateur, SUPERVISION); return transaction(pool, async (c) => {
    const i = await interventionOuverte(c, id, true);
    if (!i) throw new ErreurHttp(409, 'controle_impossible');
    const n = (await c.query(`UPDATE nettoyage_interventions SET statut = 'annulee', controle_par = $2, controle_le = now(), version = version + 1 WHERE id = $1 RETURNING *`, [i.id, req.utilisateur.id])).rows[0];
    await c.query('UPDATE lits SET nettoyage_debut = NULL WHERE id = $1', [id]);
    await journaliser(c, { litId: id, utilisateurId: req.utilisateur.id, action: 'Nettoyage à reprendre', detail: null });
    return n; }); }));
}
module.exports = { brancher, consignes, conditions, ouvrir, fin, garde, pourTache, signalerBlocage, avecBlocage, PRECAUTIONS, RESTREINTES, FORMATIONS, EPI };
