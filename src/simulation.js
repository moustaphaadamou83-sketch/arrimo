/**
 * Simulation douce du réseau de démonstration (serveur de démonstration seulement, ARRIMO_DEMO=1).
 * Toutes les quelques minutes, chaque hôpital sans compte vit un peu : nettoyages terminés, congés, admissions,
 * patients qui arrivent sur civière ou qui la quittent. Les hôpitaux qui ont un compte (X, Y) ne sont jamais touchés.
 * Chaque changement passe par les mêmes règles que l'interface (src/regles.js : verrou, version, journal).
 * La charge de chaque hôpital reste proche de sa charge de départ (demo_etat.simulation).
 */
const { transaction } = require('./db');
const { changerEtat, changerEtatCiviere } = require('./regles');
const { estDemo } = require('./demo');

const DETAIL = 'Simulation de démonstration';
const hasard = (n) => Math.floor(Math.random() * n);
const reference = () => `P-${String(10000 + hasard(89999))}`;

async function tenter(pool, fn) {
  try { return await transaction(pool, fn); } catch { return null; }   // lit pris entre-temps, référence déjà utilisée : on passe
}

/** Un tour de simulation. Retourne le nombre de changements faits. */
async function simuler(pool) {
  if (!estDemo()) return 0;
  const etat = (await pool.query('SELECT simulation FROM demo_etat WHERE id = 1')).rows[0];
  if (!etat || !Object.keys(etat.simulation || {}).length) return 0;
  const cibles = etat.simulation;
  const { rows: etabs } = await pool.query(
    `SELECT e.id, e.code,
            count(l.*) FILTER (WHERE l.etat <> 'indispo')::int AS dotes, count(l.*) FILTER (WHERE l.etat = 'libre')::int AS libres
       FROM etablissements e LEFT JOIN lits l ON l.etablissement_id = e.id
      WHERE e.actif AND e.module_actif AND e.code = ANY($1::text[])
        AND NOT EXISTS (SELECT 1 FROM utilisateur_etablissements ue WHERE ue.etablissement_id = e.id)
      GROUP BY e.id`, [Object.keys(cibles)]);
  let changements = 0;
  for (const e of etabs) {
    const cible = typeof cibles[e.code] === 'object' ? cibles[e.code] : { lits: cibles[e.code] };
    const occ = e.dotes ? (e.dotes - e.libres) / e.dotes : 0;
    // 1. Un nettoyage se termine (lit ou civière en nettoyage depuis plus de 20 min)
    const net = (await pool.query(`SELECT id FROM lits WHERE etablissement_id = $1 AND etat = 'nettoyage' AND etat_depuis < now() - interval '20 minutes'
      ORDER BY etat_depuis LIMIT 1`, [e.id])).rows[0];
    if (net && Math.random() < 0.7 && await tenter(pool, (c) => changerEtat(c, pool, null, net.id, 'libre', { detail: DETAIL }))) changements += 1;
    // 2. Congé si l'hôpital est plus chargé que sa cible, admission s'il l'est moins (avec un peu de hasard)
    const ecart = occ - cible.lits + (Math.random() - 0.5) * 0.06;
    if (ecart > 0) {
      const lit = (await pool.query(`SELECT id FROM lits WHERE etablissement_id = $1 AND etat = 'occupe' AND nsa_depuis IS NULL
        ORDER BY sortie_prevue NULLS LAST, etat_depuis LIMIT 1 OFFSET $2`, [e.id, hasard(3)])).rows[0];
      if (lit && await tenter(pool, (c) => changerEtat(c, pool, null, lit.id, 'nettoyage', { detail: DETAIL }))) changements += 1;
    } else {
      const lit = (await pool.query(`SELECT id FROM lits WHERE etablissement_id = $1 AND etat = 'libre' ORDER BY random() LIMIT 1`, [e.id])).rows[0];
      if (lit && await tenter(pool, async (c) => {
        await changerEtat(c, pool, null, lit.id, 'reserve', { patientRef: reference(), detail: DETAIL });
        return changerEtat(c, pool, null, lit.id, 'occupe', { detail: DETAIL, sortiePrevue: new Date(Date.now() + (24 + hasard(120)) * 3600000) });
      })) changements += 1;
    }
    // 3. Urgence : un patient arrive sur civière, ou en part (sans demande de lit en cours) ; civières nettoyées
    const civ = (await pool.query(`SELECT count(*) FILTER (WHERE etat = 'occupee')::int AS occ FROM civieres WHERE etablissement_id = $1`, [e.id])).rows[0];
    const civNet = (await pool.query(`SELECT id FROM civieres WHERE etablissement_id = $1 AND etat = 'nettoyage' AND etat_depuis < now() - interval '10 minutes' LIMIT 1`, [e.id])).rows[0];
    if (civNet && await tenter(pool, (c) => changerEtatCiviere(c, pool, null, civNet.id, 'libre', { detail: DETAIL }))) changements += 1;
    const civCible = cible.civ ?? civ.occ;
    if (civ.occ < civCible || (civ.occ === civCible && Math.random() < 0.5)) {
      const libre = (await pool.query(`SELECT id FROM civieres WHERE etablissement_id = $1 AND etat = 'libre' ORDER BY categorie DESC, code LIMIT 1`, [e.id])).rows[0];
      if (libre && await tenter(pool, (c) => changerEtatCiviere(c, pool, null, libre.id, 'occupee', { patientRef: reference(), detail: DETAIL }))) changements += 1;
    } else {
      const part = (await pool.query(`SELECT cv.id FROM civieres cv WHERE cv.etablissement_id = $1 AND cv.etat = 'occupee'
        AND NOT EXISTS (SELECT 1 FROM demandes_admission d WHERE d.civiere_id = cv.id AND d.statut IN ('attente', 'assignee'))
        ORDER BY cv.arrivee_le LIMIT 1`, [e.id])).rows[0];
      if (part && await tenter(pool, (c) => changerEtatCiviere(c, pool, null, part.id, 'nettoyage', { detail: DETAIL }))) changements += 1;
    }
  }
  // 4. Les équipes des hôpitaux sans compte répondent aux transferts qu'on leur demande : acceptation après une minute,
  //    chambre prête peu après, réception à l'heure d'arrivée prévue
  const { avancerTransfert } = require('./services');
  const { rows: trs } = await pool.query(
    `SELECT t.id, t.statut, t.destination_id, t.date_chambre_prete,
            (t.date_demande < now() - interval '1 minute') AS mur, (t.arrivee_prevue IS NOT NULL AND t.arrivee_prevue <= now()) AS arrive
       FROM transferts t JOIN etablissements e ON e.id = t.destination_id
      WHERE e.id = ANY($1::int[]) AND t.statut IN ('demande', 'validee', 'transport', 'en_route')`, [etabs.map((e) => e.id)]);
  for (const t of trs) {
    const equipe = { id: null, role: 'coordonnateur', etabs: [t.destination_id], gestionnaire: false, langue: 'fr' };
    const etape = t.statut === 'demande' && t.mur ? 'accepter'
      : !t.date_chambre_prete && t.statut !== 'demande' ? 'chambre_prete'
        : t.statut === 'en_route' && t.arrive ? 'reception' : null;
    if (etape && await avancerTransfert(pool, equipe, t.id, etape).then(() => true, () => false)) changements += 1;
  }
  return changements;
}

module.exports = { simuler, DETAIL };
