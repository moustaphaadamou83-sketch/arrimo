'use strict';
/**
 * Mode crise (cahier v2, C.7 ; 20 nov. 2026) : évacuation d'un établissement d'hébergement.
 * - Déclenchée par l'établissement (administration, coordination), la direction régionale de sa région ou la coordination réseau.
 * - Toutes les places libres de la région en un écran ; un lieu PROPOSÉ par résident (classement de la bourse), confirmé par une personne.
 * - La place est réservée par les règles des lits (verrou, version, journal : jamais deux résidents sur un lit) ; suivi du départ,
 *   de l'arrivée et du retour planifié ; familles avisées par Arrimo Famille (catégorie « mouvements », sans détail) ; levée journalisée.
 * Arrimo propose, un humain décide : rien n'est confirmé ni réservé automatiquement.
 */
const { ErreurHttp, transaction } = require('./db');
const { changerEtat } = require('./regles');
const TE = require('./types-etablissement');

const MOTIFS = ['incendie', 'inondation', 'panne_electrique', 'panne_chauffage', 'contamination', 'autre'];
const MODES = ['ambulance', 'transport_adapte', 'famille', 'autre'];
const ROLES_ETAB = ['admin_etab', 'coordonnateur'];
const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

/** Droit sur l'établissement évacué : son personnel habilité, la direction de sa région, la coordination réseau. */
async function droit(db, u, etabId) {
  const e = (await db.query('SELECT id, nom, type_etablissement, region_id, latitude, longitude, modules FROM etablissements WHERE id = $1 AND actif', [etabId])).rows[0];
  if (!e) throw new ErreurHttp(404, 'etab_introuvable');
  if (u.gestionnaire) return e;
  if (u.role === 'direction_regionale') {
    const ok = (await db.query(`SELECT 1 FROM utilisateur_directions ud JOIN directions_regionales d ON d.id = ud.direction_id AND d.actif WHERE ud.utilisateur_id = $1 AND d.region_id = $2`, [u.id, e.region_id])).rowCount;
    if (!ok) throw new ErreurHttp(403, 'etab_interdit');
    return e;
  }
  if (!(u.etabs || []).map(Number).includes(e.id)) throw new ErreurHttp(403, 'etab_interdit');
  if (!ROLES_ETAB.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  if (!TE.moduleActif(e, 'mode_crise')) throw new ErreurHttp(403, 'module_desactive', { module: 'mode_crise' });
  return e;
}

async function declencher(pool, u, b = {}) {
  const e = await droit(pool, u, entier(b.etablissement_id));
  if (e.type_etablissement !== 'chsld') throw new ErreurHttp(409, 'evacuation_hebergement_seulement');
  if (!MOTIFS.includes(b.motif)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'motif' });
  return transaction(pool, async (c) => {
    if ((await c.query("SELECT 1 FROM evacuations WHERE etablissement_id = $1 AND statut = 'active'", [e.id])).rowCount) throw new ErreurHttp(409, 'evacuation_deja_active');
    const n = (await c.query("SELECT nextval('evacuation_seq') AS n")).rows[0].n;
    const ev = (await c.query(`INSERT INTO evacuations (numero, etablissement_id, motif, declenchee_par, declencheur_role) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [`EV-${String(n).padStart(6, '0')}`, e.id, b.motif, u.id, u.role])).rows[0];
    // Tous les résidents présents sont à placer (référence seulement hors de l'établissement)
    await c.query(`INSERT INTO evacuation_residents (evacuation_id, resident_id, resident_ref) SELECT $1, id, reference FROM residents WHERE etablissement_id = $2 AND statut = 'present'`, [ev.id, e.id]);
    await c.query(`INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Évacuation déclenchée', $3)`, [e.id, u.id, `${ev.numero} · ${b.motif}`]);
    await require('./services').notifier(c, e.id, null, 'crise_declenchee', { numero: ev.numero });
    return ev;
  }).finally(() => require('./flux').signaler());
}

/** Places libres de la région (hébergement), proposées par résident selon le classement de la bourse (proximité d'abord). */
async function vue(pool, u, id) {
  const ev = (await pool.query('SELECT * FROM evacuations WHERE id = $1', [entier(id)])).rows[0];
  if (!ev) throw new ErreurHttp(404, 'evacuation_introuvable');
  const e = await droit(pool, u, ev.etablissement_id);
  const interne = (u.etabs || []).map(Number).includes(e.id);
  const places = (await require('./bourse').classer(pool, e, {})).places.filter((p) => p.libres > 0);
  const residents = (await pool.query(`SELECT er.*, d.nom AS destination, l.code AS lit ${interne ? ', r.prenom, r.nom' : ''}
    FROM evacuation_residents er LEFT JOIN etablissements d ON d.id = er.destination_id LEFT JOIN lits l ON l.id = er.lit_id
    ${interne ? 'JOIN residents r ON r.id = er.resident_id' : ''} WHERE er.evacuation_id = $1 ORDER BY er.resident_ref`, [ev.id])).rows;
  // Proposition : la plus haute au classement qui a encore une place, en tenant compte des places déjà confirmées
  const restantes = new Map(places.map((p) => [p.id, p.libres]));
  for (const r of residents.filter((x) => x.destination_id)) if (restantes.has(r.destination_id)) restantes.set(r.destination_id, restantes.get(r.destination_id) - 1);
  for (const r of residents) {
    if (r.statut !== 'a_placer') continue;
    const p = places.find((x) => restantes.get(x.id) > 0);
    r.proposition = p ? { id: p.id, nom: p.nom, distance_km: p.distance_km, score: p.score } : null;
    if (p) restantes.set(p.id, restantes.get(p.id) - 1);
  }
  const compte = (s) => residents.filter((r) => r.statut === s).length;
  return { evacuation: { ...ev, etablissement: e.nom }, places, residents,
    resume: { total: residents.length, a_placer: compte('a_placer'), confirmes: compte('confirme'), partis: compte('parti'), arrives: compte('arrive'), retour: compte('retour_planifie'), revenus: compte('revenu'),
      familles_avisees: residents.filter((r) => r.famille_avisee_le).length } };
}

async function ligne(c, u, evId, rid) {
  const ev = (await c.query('SELECT * FROM evacuations WHERE id = $1 FOR UPDATE', [entier(evId)])).rows[0];
  if (!ev) throw new ErreurHttp(404, 'evacuation_introuvable');
  await droit(c, u, ev.etablissement_id);
  if (ev.statut !== 'active') throw new ErreurHttp(409, 'evacuation_levee');
  const r = (await c.query('SELECT * FROM evacuation_residents WHERE evacuation_id = $1 AND id = $2 FOR UPDATE', [ev.id, entier(rid)])).rows[0];
  if (!r) throw new ErreurHttp(404, 'resident_introuvable');
  return { ev, r };
}
/** Étapes d'un résident : confirmer le lieu (réserve un lit), départ (famille avisée), arrivée, retour planifié, retour. */
async function agir(pool, u, evId, rid, b = {}) {
  const a = String(b.action || '');
  return transaction(pool, async (c) => {
    const { ev, r } = await ligne(c, u, evId, rid);
    const maj = async (sql, vals = []) => (await c.query(`UPDATE evacuation_residents SET ${sql}, version = version + 1 WHERE id = $1 RETURNING *`, [r.id, ...vals])).rows[0];
    let n;
    if (a === 'confirmer') {
      if (r.statut !== 'a_placer') throw new ErreurHttp(409, 'evacuation_statut');
      const dest = (await c.query("SELECT id, nom FROM etablissements WHERE id = $1 AND actif AND type_etablissement = 'chsld' AND id <> $2", [entier(b.destination_id), ev.etablissement_id])).rows[0];
      if (!dest) throw new ErreurHttp(404, 'etab_introuvable');
      // Un lit libre de la destination, verrouillé : jamais deux résidents sur le même lit
      const lit = (await c.query(`SELECT id FROM lits WHERE etablissement_id = $1 AND etat = 'libre' AND actif ORDER BY code LIMIT 1 FOR NO KEY UPDATE SKIP LOCKED`, [dest.id])).rows[0];
      if (!lit) throw new ErreurHttp(409, 'evacuation_plus_de_place');
      await changerEtat(c, pool, u.id, lit.id, 'reserve', { patientRef: r.resident_ref, detail: `Évacuation ${ev.numero}` });
      n = await maj("statut = 'confirme', destination_id = $2, lit_id = $3, confirme_le = now()", [dest.id, lit.id]);
    } else if (a === 'depart') {
      if (r.statut !== 'confirme') throw new ErreurHttp(409, 'evacuation_statut');
      if (!MODES.includes(b.transport_mode)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'transport_mode' });
      n = await maj("statut = 'parti', transport_mode = $2, depart_le = now(), famille_avisee_le = now()", [b.transport_mode]);
      await require('./portail-notifications').signaler(c, r.resident_id, 'mouvements');   // Arrimo Famille : avis sans détail
    } else if (a === 'arrivee') {
      if (r.statut !== 'parti') throw new ErreurHttp(409, 'evacuation_statut');
      await changerEtat(c, pool, u.id, r.lit_id, 'occupe', { patientRef: r.resident_ref, detail: `Évacuation ${ev.numero} : arrivée` });
      n = await maj("statut = 'arrive', arrivee_le = now()");
      await require('./portail-notifications').signaler(c, r.resident_id, 'mouvements');
    } else if (a === 'planifier_retour') {
      if (!['arrive', 'retour_planifie'].includes(r.statut)) throw new ErreurHttp(409, 'evacuation_statut');
      const d = new Date(b.retour_prevu_le);
      if (Number.isNaN(d.getTime()) || d < Date.now()) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'retour_prevu_le' });
      n = await maj("statut = 'retour_planifie', retour_prevu_le = $2", [d]);
    } else if (a === 'revenu') {
      if (r.statut !== 'retour_planifie') throw new ErreurHttp(409, 'evacuation_statut');
      const l = (await c.query('SELECT etat FROM lits WHERE id = $1', [r.lit_id])).rows[0];
      if (l?.etat === 'occupe') await changerEtat(c, pool, u.id, r.lit_id, 'nettoyage', { detail: `Évacuation ${ev.numero} : retour du résident` });
      n = await maj("statut = 'revenu', revenu_le = now()");
      await require('./portail-notifications').signaler(c, r.resident_id, 'mouvements');
    } else throw new ErreurHttp(400, 'action_inconnue');
    await c.query(`INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Évacuation : étape', $3)`, [ev.etablissement_id, u.id, `${ev.numero} · ${r.resident_ref} · ${a}`]);
    return n;
  }).finally(() => require('./flux').signaler());
}

async function lever(pool, u, evId) {
  return transaction(pool, async (c) => {
    const ev = (await c.query('SELECT * FROM evacuations WHERE id = $1 FOR UPDATE', [entier(evId)])).rows[0];
    if (!ev) throw new ErreurHttp(404, 'evacuation_introuvable');
    await droit(c, u, ev.etablissement_id);
    if (ev.statut !== 'active') throw new ErreurHttp(409, 'evacuation_levee');
    const n = (await c.query("UPDATE evacuations SET statut = 'levee', levee_le = now(), levee_par = $2, version = version + 1 WHERE id = $1 RETURNING *", [ev.id, u.id])).rows[0];
    await c.query(`INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Évacuation levée', $3)`, [ev.etablissement_id, u.id, ev.numero]);
    await require('./services').notifier(c, ev.etablissement_id, null, 'crise_levee', { numero: ev.numero });
    return n;
  }).finally(() => require('./flux').signaler());
}
/** Évacuations visibles : de l'établissement, de la région (direction), de tout le réseau (coordination). */
async function liste(pool, u, q = {}) {
  if (u.role === 'direction_regionale') {
    return (await pool.query(`SELECT ev.*, e.nom AS etablissement FROM evacuations ev JOIN etablissements e ON e.id = ev.etablissement_id
      WHERE e.region_id IN (SELECT d.region_id FROM utilisateur_directions ud JOIN directions_regionales d ON d.id = ud.direction_id WHERE ud.utilisateur_id = $1) ORDER BY ev.debut_le DESC LIMIT 50`, [u.id])).rows;
  }
  if (u.gestionnaire && !q.etablissement_id) return (await pool.query('SELECT ev.*, e.nom AS etablissement FROM evacuations ev JOIN etablissements e ON e.id = ev.etablissement_id ORDER BY ev.debut_le DESC LIMIT 50')).rows;
  const e = await droit(pool, u, entier(q.etablissement_id));
  return (await pool.query('SELECT ev.*, $2::text AS etablissement FROM evacuations ev WHERE ev.etablissement_id = $1 ORDER BY ev.debut_le DESC LIMIT 50', [e.id, e.nom])).rows;
}

module.exports = { declencher, vue, agir, lever, liste, MOTIFS, MODES };
