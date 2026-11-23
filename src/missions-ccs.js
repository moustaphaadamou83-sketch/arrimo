/**
 * Mission proposée par le CCS à une ambulance (décision de Moustafa, 16 nov. 2026) : « Arrimo transmet, le CCS décide ».
 * Le répartiteur choisit une unité « Disponible » de sa région et lui transmet une mission (lieu, priorité, catégorie) ;
 * l'équipage accepte ou refuse sur son téléphone. Arrimo ne choisit jamais l'unité. Aucune identité ni donnée clinique :
 * le lieu est une adresse ou un repère (jamais un nom), la catégorie et la priorité viennent de listes fermées.
 * Acceptée : l'unité passe « En route » ; « Sur place » puis, soit une préalerte (transport vers l'hôpital), soit « Terminée sans transport ».
 */
const { transaction, ErreurHttp } = require('./db');
const { PRIORITES, CATEGORIES, ROLES_AMBULANCE, ROLES_CCS } = require('./prealertes');
const vehicules = require('./vehicules');
const accesVehicules = require('./acces-vehicules-secours');

const OUVERTES = ['proposee', 'acceptee', 'sur_place'];
const MOTIFS_REFUS = ['deja_en_mission', 'hors_secteur', 'equipage_indisponible', 'autre'];
const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

async function orgs(db, u) {
  return (await db.query(`SELECT o.id, o.profils, o.config_id FROM utilisateur_organisations uo JOIN organisations_secours o ON o.id = uo.organisation_id
    WHERE uo.utilisateur_id = $1 AND o.actif`, [u.id])).rows;
}
/** Filtre SQL des unités visibles : le CCS voit les ambulances de sa région, l'équipage celles de son organisation. */
async function perimetre(db, u) {
  const o = await orgs(db, u);
  if (ROLES_CCS.includes(u.role)) {
    const appartenances = o.filter((x) => x.profils.includes('ccs'));
    if (!appartenances.length) throw new ErreurHttp(403, 'organisation_interdite');
    const cfg = appartenances.map((x) => x.config_id);
    return { cote: 'ccs', sql: "o.config_id = ANY($1) AND 'ambulance' = ANY(o.profils)", args: [cfg],
      ccsOrg: appartenances[0].id, ccsOrgs: appartenances.map((x) => x.id) };
  }
  if (ROLES_AMBULANCE.includes(u.role)) {
    const ids = o.filter((x) => x.profils.includes('ambulance')).map((x) => x.id);
    if (!ids.length) throw new ErreurHttp(403, 'organisation_interdite');
    return { cote: 'ambulance', sql: 'o.id = ANY($1)', args: [ids] };
  }
  throw new ErreurHttp(403, 'role_insuffisant');
}

async function liste(pool, u) {
  const p = await perimetre(pool, u);
  const parametres = [...p.args, OUVERTES, p.ccsOrgs || []];
  const droits = accesVehicules.concerne(u) ? ` AND ${accesVehicules.condition('o', 'un.id', parametres.push(u.id))}` : '';
  return (await pool.query(`SELECT m.id, m.numero, m.statut, m.lieu, m.priorite, m.categorie, m.motif_refus, m.version, m.cree_le, m.modifie_le,
      m.unite_id, un.numero AS unite, uc.nom AS propose_par, m.organisation_ccs_id = ANY($3::int[]) AS peut_annuler
    FROM missions_ccs m JOIN unites_secours un ON un.id = m.unite_id JOIN organisations_secours o ON o.id = un.organisation_id LEFT JOIN utilisateurs uc ON uc.id = m.cree_par
    WHERE ${p.sql}${droits} AND (m.statut = ANY($2) OR m.modifie_le > now() - interval '24 hours') ORDER BY (m.statut = ANY($2)) DESC, m.cree_le DESC`, parametres)).rows;
}

/** Le CCS propose une mission à une unité disponible de sa région. */
async function proposer(pool, u, b = {}) {
  const p = await perimetre(pool, u);
  if (p.cote !== 'ccs') throw new ErreurHttp(403, 'role_insuffisant');
  const lieu = String(b.lieu || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!lieu) throw new ErreurHttp(400, 'mission_lieu_requis');
  if (!PRIORITES.includes(b.priorite) || !CATEGORIES.includes(b.categorie)) throw new ErreurHttp(400, 'mission_invalide');
  return transaction(pool, (c) => proposerAvecClient(c, u, p, { ...b, lieu }));
}

async function proposerAvecClient(c, u, p, b, interventionId = null) {
  const un = (await c.query(`SELECT un.id, un.numero, COALESCE(ev.etat, 'disponible') AS etat FROM unites_secours un JOIN organisations_secours o ON o.id = un.organisation_id
    LEFT JOIN etats_vehicules ev ON ev.unite_id = un.id WHERE un.id = $2 AND un.actif AND o.actif AND ${p.sql} FOR UPDATE OF un`, [...p.args, entier(b.unite_id)])).rows[0];
  if (!un) throw new ErreurHttp(404, 'unite_introuvable');
  if (un.etat !== 'disponible') throw new ErreurHttp(409, 'unite_non_disponible', { unite: un.numero });
  if ((await c.query('SELECT 1 FROM missions_ccs WHERE unite_id = $1 AND statut = ANY($2)', [un.id, OUVERTES])).rowCount) throw new ErreurHttp(409, 'unite_deja_sollicitee', { unite: un.numero });
  if (await vehicules.missionActive(c, un.id)) throw new ErreurHttp(409, 'unite_non_disponible', { unite: un.numero });
  const m = (await c.query(`INSERT INTO missions_ccs (numero, unite_id, organisation_ccs_id, lieu, priorite, categorie, cree_par, intervention_demo_id)
    VALUES ('MI-' || lpad(nextval('mission_ccs_seq')::text, 6, '0'), $1, $2, $3, $4, $5, $6, $7) RETURNING *`, [un.id, p.ccsOrg, b.lieu, b.priorite, b.categorie, u.id, interventionId])).rows[0];
  await c.query('INSERT INTO mission_ccs_evenements (mission_id, statut, utilisateur_id) VALUES ($1, $2, $3)', [m.id, 'proposee', u.id]);
  require('./flux').signaler();
  return { ...m, unite: un.numero };
}

const SCENARIOS_DEMO = Object.freeze({
  malaise: { lieu: 'Point fictif A', priorite: 'urgente', categorie: 'medicale' },
  chute: { lieu: 'Point fictif B', priorite: 'non_urgente', categorie: 'traumatologie' },
});

async function perimetreDemo(db, u) {
  if (!require('./environnement').estDemo()) throw new ErreurHttp(404, 'module_desactive', { module: 'simulation_ccs' });
  const p = await perimetre(db, u);
  if (p.cote !== 'ccs') throw new ErreurHttp(403, 'role_insuffisant');
  return p;
}

async function interventionsDemo(pool, u) {
  const p = await perimetreDemo(pool, u);
  return (await pool.query(`SELECT i.id, i.scenario, i.recue_le, m.numero AS mission, m.statut, un.numero AS unite
    FROM interventions_ccs_demo i
    LEFT JOIN LATERAL (SELECT numero, statut, unite_id FROM missions_ccs WHERE intervention_demo_id = i.id ORDER BY id DESC LIMIT 1) m ON true
    LEFT JOIN unites_secours un ON un.id = m.unite_id
    WHERE i.organisation_ccs_id = $1 ORDER BY i.id DESC LIMIT 100`, [p.ccsOrg])).rows;
}

async function recevoirDemo(pool, u, b = {}) {
  const p = await perimetreDemo(pool, u);
  if (!Object.hasOwn(SCENARIOS_DEMO, b.scenario)) throw new ErreurHttp(400, 'mission_invalide');
  const { rows: [i] } = await pool.query(`INSERT INTO interventions_ccs_demo (organisation_ccs_id, scenario, recue_par)
    VALUES ($1, $2, $3) RETURNING id, scenario, recue_le`, [p.ccsOrg, b.scenario, u.id]);
  require('./flux').signaler();
  return i;
}

async function affecterDemo(pool, u, id, b = {}) {
  const p = await perimetreDemo(pool, u);
  return transaction(pool, async (c) => {
    const { rows: [i] } = await c.query(`SELECT id, scenario FROM interventions_ccs_demo
      WHERE id = $1 AND organisation_ccs_id = $2 FOR UPDATE`, [id, p.ccsOrg]);
    if (!i) throw new ErreurHttp(404, 'mission_introuvable');
    const { rows: [m] } = await c.query('SELECT statut FROM missions_ccs WHERE intervention_demo_id = $1 ORDER BY id DESC LIMIT 1', [i.id]);
    if (m && !['refusee', 'annulee'].includes(m.statut)) throw new ErreurHttp(409, 'mission_statut_incompatible');
    return proposerAvecClient(c, u, p, { ...SCENARIOS_DEMO[i.scenario], unite_id: b.unite_id }, i.id);
  });
}

/** Réponse de l'équipage (accepter, refuser, sur place, terminer sans transport) ou annulation par le CCS. */
async function agir(pool, u, id, b = {}) {
  const p = await perimetre(pool, u);
  const a = String(b.action || '');
  const permis = p.cote === 'ccs' ? { annuler: ['proposee', 'acceptee', 'sur_place'] }
    : { accepter: ['proposee'], refuser: ['proposee'], sur_place: ['acceptee'], terminer: ['acceptee', 'sur_place'] };
  if (!permis[a]) throw new ErreurHttp(400, 'action_inconnue');
  return transaction(pool, async (c) => {
    const m = (await c.query(`SELECT m.*, un.organisation_id AS organisation_ambulance_id FROM missions_ccs m JOIN unites_secours un ON un.id = m.unite_id JOIN organisations_secours o ON o.id = un.organisation_id
      WHERE m.id = $2 AND ${p.sql}${p.cote === 'ccs' ? ' AND m.organisation_ccs_id = ANY($3::int[])' : ''}
      FOR UPDATE OF m`, [...p.args, entier(id), ...(p.cote === 'ccs' ? [p.ccsOrgs] : [])])).rows[0];
    if (!m || (accesVehicules.concerne(u) && !(await accesVehicules.autorise(c, u, m.organisation_ambulance_id, m.unite_id)))) {
      throw new ErreurHttp(404, 'mission_introuvable');
    }
    if (b.version != null && Number(b.version) !== m.version) throw new ErreurHttp(409, 'version_perimee');
    if (!permis[a].includes(m.statut)) throw new ErreurHttp(409, 'mission_statut_incompatible');
    const statut = { accepter: 'acceptee', refuser: 'refusee', sur_place: 'sur_place', terminer: 'terminee', annuler: 'annulee' }[a];
    const motif = a === 'refuser' ? (MOTIFS_REFUS.includes(b.motif) ? b.motif : 'autre') : null;
    const n = (await c.query(`UPDATE missions_ccs SET statut = $2, motif_refus = COALESCE($3, motif_refus), version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`, [m.id, statut, motif])).rows[0];
    await c.query('INSERT INTO mission_ccs_evenements (mission_id, statut, utilisateur_id, detail) VALUES ($1, $2, $3, $4)', [m.id, statut, u.id, motif]);
    // L'état du véhicule suit la mission : le CCS, l'ambulance et les hôpitaux voient le même statut
    const src = { source: 'mission_ccs', utilisateurId: u.id };
    if (a === 'accepter') await vehicules.fixer(c, m.unite_id, 'en_route', src);
    if (a === 'sur_place') await vehicules.fixer(c, m.unite_id, 'sur_place', src);
    if (a === 'terminer' || (a === 'annuler' && m.statut !== 'proposee')) {
      const pa = (await c.query(`SELECT 1 FROM prealertes WHERE unite_id = $1 AND statut NOT IN ('cloturee', 'annulee', 'remplacee')`, [m.unite_id])).rowCount;
      if (!pa) await vehicules.fixer(c, m.unite_id, 'disponible', src);
    }
    require('./flux').signaler();
    return n;
  });
}

module.exports = { liste, proposer, agir, interventionsDemo, recevoirDemo, affecterDemo, OUVERTES, MOTIFS_REFUS };
