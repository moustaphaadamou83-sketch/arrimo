/**
 * Prévisions à 4 h, 12 h et 24 h, simples et explicables (pas d'apprentissage automatique).
 *
 * Pour chaque type d'unité :
 *   libérations = lits en nettoyage + congés prévus dans la fenêtre, pondérés par leur statut
 *                 (prévu 70 %, en attente de transport 85 %, confirmé 95 %) ; si l'historique annonce davantage de départs
 *                 pour ces heures et ce jour de la semaine, l'écart s'ajoute (départs non planifiés).
 *   arrivées    = patients déjà en attente + moyenne historique des admissions pour ces heures et ce jour de la semaine.
 *   besoin      = lits occupés ou réservés − libérations + arrivées ; « saturée » si le besoin dépasse les lits avec personnel.
 * Civières de l'urgence : occupées + arrivées historiques − départs historiques (et patients dont le lit est déjà assigné).
 * Historique : journal des 8 dernières semaines, moyenne par heure et par jour de la semaine (fuseau de la configuration).
 * Marge : intervalle d'environ 90 % (± 1,64 écart-type) ; variance p(1−p) pour chaque congé, et égale à la moyenne
 * pour les comptes historiques (loi de Poisson).
 */
const { exigerEtablissement } = require('./auth');
const s = require('./services');
const cv = require('./civieres');

const HORIZONS = [4, 12, 24];
const SEMAINES = 8;
const POIDS_CONGE = { prevu: 0.7, attente_transport: 0.85, confirme: 0.95 };
const marge = (variance) => (variance > 0 ? Math.max(1, Math.round(1.64 * Math.sqrt(variance))) : 0);

/**
 * Moyenne historique des événements par heure de la semaine, pour une fenêtre de H heures à partir de maintenant.
 * `filtre` : condition SQL sur journal (alias j) ; retourne { cle -> moyenne attendue dans la fenêtre } pour chaque horizon.
 */
async function historique(pool, etabId, fuseau, filtre, cle) {
  const { rows } = await pool.query(
    `WITH ev AS (
       SELECT ${cle} AS cle, EXTRACT(ISODOW FROM j.date AT TIME ZONE $2)::int AS jour, EXTRACT(HOUR FROM j.date AT TIME ZONE $2)::int AS heure
         FROM journal j ${filtre.joint || ''}
        WHERE j.etablissement_id = $1 AND NOT j.refuse AND j.date > now() - make_interval(weeks => $3) AND ${filtre.condition})
     SELECT cle, jour, heure, count(*)::int AS n FROM ev GROUP BY 1, 2, 3`, [etabId, fuseau, SEMAINES]);
  const premier = (await pool.query(
    `SELECT min(date) AS d FROM journal j WHERE j.etablissement_id = $1 AND j.date > now() - make_interval(weeks => $2)`, [etabId, SEMAINES])).rows[0].d;
  const semaines = premier ? Math.min(SEMAINES, Math.max(1, Math.ceil((Date.now() - new Date(premier)) / (7 * 86400000)))) : 1;
  const parCle = new Map();
  for (const r of rows) {
    if (!parCle.has(r.cle)) parCle.set(r.cle, new Map());
    parCle.get(r.cle).set(`${r.jour}-${r.heure}`, r.n / semaines);
  }
  // Heures à venir (jour de semaine et heure locaux)
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
  const JOURS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const heures = Array.from({ length: Math.max(...HORIZONS) }, (_, i) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(Date.now() + i * 3600000)).map((x) => [x.type, x.value]));
    return `${JOURS[p.weekday]}-${Number(p.hour)}`;
  });
  const res = new Map();
  for (const [k, m] of parCle) {
    res.set(k, Object.fromEntries(HORIZONS.map((h) => [h, heures.slice(0, h).reduce((a, x) => a + (m.get(x) || 0), 0)])));
  }
  return { parCle: res, semaines };
}

/** Prévisions de l'établissement : par type d'unité et pour les civières de l'urgence, à 4 h, 12 h et 24 h. */
async function previsions(pool, utilisateur, etabId) {
  exigerEtablissement(utilisateur, etabId);
  const etab = await s.etablissement(pool, etabId);
  const fuseau = etab.config.fuseau;
  const { rows: unites } = await pool.query(
    `SELECT t.id AS type_id, t.nom AS type_nom, t.ordre,
            count(*) FILTER (WHERE l.etat <> 'indispo')::int AS dotes,
            count(*) FILTER (WHERE l.etat IN ('occupe', 'reserve'))::int AS occupes,
            count(*) FILTER (WHERE l.etat = 'libre')::int AS libres,
            count(*) FILTER (WHERE l.etat = 'nettoyage')::int AS nettoyage
       FROM lits l JOIN types_unite t ON t.id = l.type_id WHERE l.etablissement_id = $1 GROUP BY t.id ORDER BY t.ordre`, [etabId]);
  const conges = (await pool.query(
    `SELECT type_id, conge_statut, EXTRACT(EPOCH FROM (sortie_prevue - now())) / 3600 AS dans_h
       FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' AND nsa_depuis IS NULL AND sortie_prevue IS NOT NULL
        AND sortie_prevue < now() + make_interval(hours => $2)`, [etabId, Math.max(...HORIZONS)])).rows;
  const attente = new Map((await pool.query(
    `SELECT type_id, count(*)::int AS n FROM demandes_admission WHERE etablissement_id = $1 AND statut = 'attente' GROUP BY type_id`, [etabId])).rows
    .map((r) => [r.type_id, r.n]));
  // Historique : départs (occupé → nettoyage) et admissions (→ occupé) par type d'unité
  const joint = { joint: 'JOIN lits l ON l.id = j.lit_id' };
  const departs = await historique(pool, etabId, fuseau, { ...joint, condition: `j.ancien_etat = 'occupe' AND j.nouvel_etat = 'nettoyage'` }, 'l.type_id');
  const admissions = await historique(pool, etabId, fuseau, { ...joint, condition: `j.nouvel_etat = 'occupe' AND j.ancien_etat IS DISTINCT FROM 'occupe'` }, 'l.type_id');

  const resUnites = unites.map((u) => {
    const parH = {};
    for (const h of HORIZONS) {
      const cs = conges.filter((c) => c.type_id === u.type_id && Number(c.dans_h) <= h);
      const planifies = cs.reduce((a, c) => a + (POIDS_CONGE[c.conge_statut] ?? POIDS_CONGE.prevu), 0);
      const varPlan = cs.reduce((a, c) => { const p = POIDS_CONGE[c.conge_statut] ?? POIDS_CONGE.prevu; return a + p * (1 - p); }, 0);
      const hist = departs.parCle.get(u.type_id)?.[h] || 0;
      const nonPlanifies = Math.max(0, hist - planifies);
      const liberations = u.nettoyage + planifies + nonPlanifies;
      const arriveesHist = admissions.parCle.get(u.type_id)?.[h] || 0;
      const enAttente = attente.get(u.type_id) || 0;
      const besoin = u.occupes - liberations + enAttente + arriveesHist;
      const m = marge(varPlan + nonPlanifies + arriveesHist);
      const libresPrevus = Math.round(u.dotes - besoin);
      parH[h] = {
        liberations: Math.round(liberations), arrivees: Math.round(enAttente + arriveesHist), libres_prevus: libresPrevus, marge: m,
        occupation: u.dotes ? Math.round((besoin / u.dotes) * 100) : 0, sature: libresPrevus <= 0, risque: libresPrevus - m <= 0,
      };
    }
    return { type_id: u.type_id, type_nom: u.type_nom, dotes: u.dotes, occupes: u.occupes, libres: u.libres, en_attente: attente.get(u.type_id) || 0, horizons: parH };
  });

  // Civières : arrivées (→ occupée) et départs (occupée → nettoyage) historiques
  const urg = (await cv.statsUrgence(pool, [etabId])).get(etabId);
  let civieres = null;
  if (urg) {
    const jc = { condition: `j.civiere_id IS NOT NULL AND j.nouvel_etat = 'occupee'` };
    const arrivees = await historique(pool, etabId, fuseau, jc, '0');
    const sorties = await historique(pool, etabId, fuseau, { condition: `j.civiere_id IS NOT NULL AND j.ancien_etat = 'occupee' AND j.nouvel_etat = 'nettoyage'` }, '0');
    const assignes = (await pool.query(`SELECT count(*)::int AS n FROM demandes_admission WHERE etablissement_id = $1 AND statut = 'assignee' AND civiere_id IS NOT NULL`, [etabId])).rows[0].n;
    const parH = {};
    for (const h of HORIZONS) {
      const a = arrivees.parCle.get(0)?.[h] || 0;
      const d = Math.max(sorties.parCle.get(0)?.[h] || 0, assignes);
      const occ = Math.max(0, urg.occupees + a - d);
      parH[h] = { occupees: Math.round(occ), marge: marge(a + d), taux: urg.fonctionnelles ? Math.round((occ / urg.fonctionnelles) * 100) : 0 };
    }
    civieres = { fonctionnelles: urg.fonctionnelles, occupees: urg.occupees, taux: urg.taux, horizons: parH };
  }
  return { horizons: HORIZONS, semaines: Math.max(departs.semaines, admissions.semaines), unites: resUnites, civieres, genere_le: new Date().toISOString() };
}

module.exports = { previsions, HORIZONS, POIDS_CONGE };
