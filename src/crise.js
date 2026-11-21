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

const GRAVITES = ['moderee', 'elevee', 'critique'];
/** Contrôle commun à l'aperçu et au déclenchement (rien n'est écrit ici). */
async function lireDeclaration(db, u, b) {
  const e = await droit(db, u, entier(b.etablissement_id));
  if (e.type_etablissement !== 'chsld') throw new ErreurHttp(409, 'evacuation_hebergement_seulement');
  if (!MOTIFS.includes(b.motif)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'motif' });
  const gravite = b.gravite === undefined ? 'elevee' : b.gravite;
  if (!GRAVITES.includes(gravite)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'gravite' });
  const unites = String(b.unites_touchees || '').trim().slice(0, 300) || null;
  const point = String(b.point_rassemblement || '').trim().slice(0, 200) || null;
  const choix = Array.isArray(b.residents) && b.residents.length ? b.residents.map(Number) : null;   // résidents concernés (tous par défaut)
  const residents = (await db.query(`SELECT r.id, r.reference FROM residents r WHERE r.etablissement_id = $1 AND r.statut = 'present' AND ($2::int[] IS NULL OR r.id = ANY($2)) ORDER BY r.reference`, [e.id, choix])).rows;
  if (!residents.length) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'residents' });
  return { e, unites, point, residents, gravite, simulation: b.simulation === true };
}
/** COR-003 : APERÇU avant toute activation — lieux d'accueil proposés (capacité, besoins, proximité) et acteurs qui seraient alertés. Rien n'est créé. */
async function apercu(pool, u, b = {}) {
  const d = await lireDeclaration(pool, u, b);
  const places = (await require('./bourse').classer(pool, d.e, {})).places.filter((p) => p.libres > 0);
  const restantes = new Map(places.map((p) => [p.id, p.libres]));
  const propositions = d.residents.map((r) => { const p = places.find((x) => restantes.get(x.id) > 0); if (p) restantes.set(p.id, restantes.get(p.id) - 1); return { resident_ref: r.reference, lieu: p ? { id: p.id, nom: p.nom, distance_km: p.distance_km } : null }; });
  const alertes = (await destinatairesAlerte(pool, d.e.id)).map((o) => ({ organisation: o.nom, role: o.role }));
  return { residents: d.residents.length, places_libres: places.reduce((s, p) => s + p.libres, 0), sans_lieu: propositions.filter((x) => !x.lieu).length, propositions, alertes, simulation: d.simulation };
}
/** Acteurs à alerter selon le protocole : la coordination compétente de la région (CCS) et les transporteurs partenaires autorisés. */
async function destinatairesAlerte(db, etabId) {
  return (await db.query(`SELECT o.id, o.nom, CASE WHEN 'ccs' = ANY(o.profils) THEN 'coordination' ELSE 'transport' END AS role FROM organisations_secours o, etablissements e
    WHERE e.id = $1 AND o.actif AND ('ccs' = ANY(o.profils) OR 'ambulance' = ANY(o.profils))
      AND (o.config_id = e.config_id OR o.config_id = e.profil_config_id OR (o.region_id IS NOT NULL AND o.region_id = e.region_id)) ORDER BY 3, o.nom`, [etabId])).rows;
}
async function declencher(pool, u, b = {}) {
  const d = await lireDeclaration(pool, u, b); const { e } = d;
  return transaction(pool, async (c) => {
    if ((await c.query("SELECT 1 FROM evacuations WHERE etablissement_id = $1 AND statut = 'active' AND simulation = $2", [e.id, d.simulation])).rowCount) throw new ErreurHttp(409, 'evacuation_deja_active');
    const n = (await c.query("SELECT nextval('evacuation_seq') AS n")).rows[0].n;
    const ev = (await c.query(`INSERT INTO evacuations (numero, etablissement_id, motif, declenchee_par, declencheur_role, simulation, gravite, unites_touchees, point_rassemblement)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`, [`${d.simulation ? 'SIM' : 'EV'}-${String(n).padStart(6, '0')}`, e.id, b.motif, u.id, u.role, d.simulation, d.gravite, d.unites, d.point])).rows[0];
    for (const r of d.residents) await c.query('INSERT INTO evacuation_residents (evacuation_id, resident_id, resident_ref) VALUES ($1, $2, $3)', [ev.id, r.id, r.reference]);
    // Alertes : coordination compétente et transporteurs partenaires ; en simulation, aucune notification ni affectation réelle
    for (const o of await destinatairesAlerte(c, e.id)) await c.query('INSERT INTO crise_alertes (evacuation_id, organisation_id, role, simulation) VALUES ($1, $2, $3, $4)', [ev.id, o.id, o.role, d.simulation]);
    await c.query(`INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, $3, $4)`, [e.id, u.id, d.simulation ? 'Évacuation simulée déclenchée' : 'Évacuation déclenchée', `${ev.numero} · ${b.motif} · ${d.gravite} · ${d.residents.length} résidents`]);
    if (!d.simulation) await require('./services').notifier(c, e.id, null, 'crise_declenchee', { numero: ev.numero });
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
      familles_avisees: residents.filter((r) => r.famille_avisee_le).length, accueillis: compte('accueilli') },
    alertes: (await pool.query(`SELECT a.id, a.role, a.statut, a.simulation, a.eta_min, a.envoyee_le, a.recue_le, a.acceptee_le, a.affectee_le, a.escaladee_le, o.nom AS organisation, un.numero AS unite
      FROM crise_alertes a JOIN organisations_secours o ON o.id = a.organisation_id LEFT JOIN unites_secours un ON un.id = a.unite_id WHERE a.evacuation_id = $1 ORDER BY a.role, o.nom`, [ev.id])).rows };
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
      // Simulation : la place est seulement notée, jamais réservée ; en réel : réservée par les règles des lits et l'accueil est avisé
      if (!ev.simulation) await changerEtat(c, pool, u.id, lit.id, 'reserve', { patientRef: r.resident_ref, detail: `Évacuation ${ev.numero}` });
      n = await maj("statut = 'confirme', destination_id = $2, lit_id = $3, confirme_le = now()", [dest.id, ev.simulation ? null : lit.id]);
      if (!ev.simulation) await require('./services').notifier(c, dest.id, null, 'crise_place_demandee', { numero: ev.numero });
    } else if (a === 'depart') {
      if (r.statut !== 'confirme') throw new ErreurHttp(409, 'evacuation_statut');
      if (!MODES.includes(b.transport_mode)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'transport_mode' });
      n = await maj(`statut = 'parti', transport_mode = $2, depart_le = now()${ev.simulation ? '' : ', famille_avisee_le = now()'}`, [b.transport_mode]);
      if (!ev.simulation) await require('./portail-notifications').signaler(c, r.resident_id, 'mouvements');   // Arrimo Famille : avis sans détail
    } else if (a === 'arrivee') {
      if (r.statut !== 'parti') throw new ErreurHttp(409, 'evacuation_statut');
      if (!ev.simulation) await changerEtat(c, pool, u.id, r.lit_id, 'occupe', { patientRef: r.resident_ref, detail: `Évacuation ${ev.numero} : arrivée` });
      n = await maj("statut = 'arrive', arrivee_le = now()");
      if (!ev.simulation) await require('./portail-notifications').signaler(c, r.resident_id, 'mouvements');
    } else if (a === 'accueilli') {
      // L'établissement d'accueil (ou l'équipe évacuée) confirme l'accueil du résident
      if (r.statut !== 'arrive') throw new ErreurHttp(409, 'evacuation_statut');
      n = await maj("statut = 'accueilli', accueilli_le = now()");
    } else if (a === 'planifier_retour') {
      if (!['arrive', 'accueilli', 'retour_planifie'].includes(r.statut)) throw new ErreurHttp(409, 'evacuation_statut');
      const d = new Date(b.retour_prevu_le);
      if (Number.isNaN(d.getTime()) || d < Date.now()) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'retour_prevu_le' });
      n = await maj("statut = 'retour_planifie', retour_prevu_le = $2", [d]);
    } else if (a === 'revenu') {
      if (r.statut !== 'retour_planifie') throw new ErreurHttp(409, 'evacuation_statut');
      const l = (await c.query('SELECT etat FROM lits WHERE id = $1', [r.lit_id])).rows[0];
      if (!ev.simulation && l?.etat === 'occupe') await changerEtat(c, pool, u.id, r.lit_id, 'nettoyage', { detail: `Évacuation ${ev.numero} : retour du résident` });
      n = await maj("statut = 'revenu', revenu_le = now()");
      if (!ev.simulation) await require('./portail-notifications').signaler(c, r.resident_id, 'mouvements');
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
    if (!ev.simulation) await require('./services').notifier(c, ev.etablissement_id, null, 'crise_levee', { numero: ev.numero });
    await c.query("UPDATE crise_alertes SET statut = 'cloturee', version = version + 1 WHERE evacuation_id = $1 AND statut <> 'cloturee'", [ev.id]);
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

/**
 * Côté secours (COR-003) : alertes reçues par l'organisation de la personne. Lieu, motif, gravité, nombre de résidents, besoins de mobilité
 * (en nombres), point de rassemblement ; jamais un nom. Accusé de réception, acceptation, affectation d'un véhicule PAR LE RÉPARTITEUR
 * (jamais automatique) ; « alerte envoyée / reçue / mission acceptée / véhicule affecté » distincts. Simulation : marquée, rien de réel.
 */
async function orgsDe(db, u) { return (await db.query('SELECT organisation_id FROM utilisateur_organisations WHERE utilisateur_id = $1', [u.id])).rows.map((r) => r.organisation_id); }
async function alertesSecours(pool, u) {
  const orgs = await orgsDe(pool, u); if (!orgs.length) throw new ErreurHttp(403, 'organisation_interdite');
  const rows = (await pool.query(`SELECT a.id, a.role, a.statut, a.simulation, a.eta_min, a.envoyee_le, a.recue_le, a.acceptee_le, a.affectee_le, a.version, un.numero AS unite,
      ev.numero, ev.motif, ev.gravite, ev.point_rassemblement, ev.statut AS statut_evacuation, e.nom AS lieu, e.latitude, e.longitude,
      (SELECT count(*)::int FROM evacuation_residents x WHERE x.evacuation_id = ev.id) AS residents,
      (SELECT count(*)::int FROM evacuation_residents x WHERE x.evacuation_id = ev.id AND x.statut = 'a_placer') AS a_placer
    FROM crise_alertes a JOIN evacuations ev ON ev.id = a.evacuation_id JOIN etablissements e ON e.id = ev.etablissement_id LEFT JOIN unites_secours un ON un.id = a.unite_id
    WHERE a.organisation_id = ANY($1) AND a.statut <> 'cloturee' ORDER BY a.envoyee_le DESC LIMIT 20`, [orgs])).rows;
  // Besoins de mobilité, en nombres seulement (capacités déclarées des résidents)
  return rows;
}
async function agirAlerte(pool, u, id, b = {}) {
  const orgs = await orgsDe(pool, u);
  return transaction(pool, async (c) => {
    const a = (await c.query('SELECT * FROM crise_alertes WHERE id = $1 AND organisation_id = ANY($2) FOR UPDATE', [entier(id), orgs])).rows[0];
    if (!a) throw new ErreurHttp(404, 'objet_introuvable');
    const act = String(b.action || '');
    const ok = { accuser: ['envoyee', 'escaladee'], accepter: ['recue'], refuser: ['recue', 'envoyee'], affecter: ['acceptee'] }[act];
    if (!ok) throw new ErreurHttp(400, 'action_inconnue');
    if (!ok.includes(a.statut)) throw new ErreurHttp(409, 'evacuation_statut');
    if (act === 'affecter' && !['superviseur_secours', 'repartiteur'].includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');   // affectation : répartiteur compétent
    let n;
    if (act === 'accuser') n = (await c.query("UPDATE crise_alertes SET statut = 'recue', recue_le = now(), par = $2, version = version + 1 WHERE id = $1 RETURNING *", [a.id, u.id])).rows[0];
    else if (act === 'accepter') n = (await c.query("UPDATE crise_alertes SET statut = 'acceptee', acceptee_le = now(), par = $2, version = version + 1 WHERE id = $1 RETURNING *", [a.id, u.id])).rows[0];
    else if (act === 'refuser') n = (await c.query("UPDATE crise_alertes SET statut = 'refusee', par = $2, version = version + 1 WHERE id = $1 RETURNING *", [a.id, u.id])).rows[0];
    else {
      const un = (await c.query('SELECT id, numero FROM unites_secours WHERE id = $1 AND organisation_id = $2 AND actif', [entier(b.unite_id), a.organisation_id])).rows[0];
      if (!un) throw new ErreurHttp(404, 'unite_introuvable');
      const eta = b.eta_min == null ? null : Number(b.eta_min); if (eta != null && !(eta >= 0 && eta <= 600)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'eta_min' });
      n = (await c.query("UPDATE crise_alertes SET statut = 'vehicule_affecte', unite_id = $2, eta_min = $3, affectee_le = now(), par = $4, version = version + 1 WHERE id = $1 RETURNING *", [a.id, un.id, eta, u.id])).rows[0];
    }
    const ev = (await c.query('SELECT etablissement_id, numero FROM evacuations WHERE id = $1', [a.evacuation_id])).rows[0];
    await c.query(`INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Évacuation : alerte', $3)`, [ev.etablissement_id, u.id, `${ev.numero} · ${act}${a.simulation ? ' (simulation)' : ''}`]);
    return n;
  }).finally(() => require('./flux').signaler());
}
/** Escalade : une alerte réelle sans accusé de réception après 5 min est escaladée (signalée à l'établissement) ; jamais en simulation. */
async function echeances(pool) {
  const r = await pool.query(`UPDATE crise_alertes a SET statut = 'escaladee', escaladee_le = now(), version = a.version + 1 FROM evacuations ev
    WHERE ev.id = a.evacuation_id AND a.statut = 'envoyee' AND NOT a.simulation AND a.envoyee_le < now() - interval '5 minutes' RETURNING ev.etablissement_id, ev.numero`);
  for (const x of r.rows) await require('./services').notifier(pool, x.etablissement_id, null, 'crise_alerte_sans_reponse', { numero: x.numero }).catch(() => {});
  return r.rowCount;
}

module.exports = { declencher, apercu, vue, agir, lever, liste, alertesSecours, agirAlerte, echeances, MOTIFS, MODES, GRAVITES };
