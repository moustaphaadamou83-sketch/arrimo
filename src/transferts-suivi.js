'use strict';
/**
 * Transferts (cahier v2, C.3 ; 20 nov. 2026) : une fiche de transfert UNIQUE, la même pour l'hôpital demandeur, l'hôpital receveur,
 * la coordination (gestionnaire réseau, direction régionale) et le transporteur (préalerte ou demande de transport liée) ;
 * délais décision → départ → arrivée depuis l'Horloge ; alertes de blocage ; centrale régionale des transferts urgents ;
 * rapatriement PROPOSÉ (jamais déclenché) quand l'équipe receveuse marque le patient « stable pour retour ».
 * Le transporteur et la coordination ne voient jamais la référence du patient : numéro, lieux, étapes et heures seulement.
 */
const { ErreurHttp, transaction } = require('./db');
const horloge = require('./horloge');

const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const MOTIFS_RAPATRIEMENT = ['pas_stable', 'famille_refuse', 'pas_de_lit', 'autre'];
const ATTENTE_TRANSPORT_MIN = 30;     // transfert accepté sans transport organisé : alerte après 30 min
const kmEntre = (a, b) => { const r = (x) => (x * Math.PI) / 180; const h = Math.sin(r(b.latitude - a.latitude) / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2; return 6371 * 2 * Math.asin(Math.sqrt(h)); };

const SELECT = `SELECT t.id, t.numero, t.patient_ref, t.origine_id, o.nom AS origine, t.destination_id, d.nom AS destination, t.type_id, ty.nom AS type_nom,
    t.urgent, t.statut, t.motif_refus_code, t.lit_id, l.code AS lit_code, l.etat AS lit_etat, t.date_demande, t.date_validation, t.date_depart, t.date_reception,
    t.arrivee_prevue, t.stable_retour_le, o.config_id, o.region_id AS origine_region_id, d.region_id AS destination_region_id
  FROM transferts t JOIN etablissements o ON o.id = t.origine_id JOIN etablissements d ON d.id = t.destination_id
  JOIN types_unite ty ON ty.id = t.type_id LEFT JOIN lits l ON l.id = t.lit_id`;

/** Côté du lecteur : origine, destination, coordination, transporteur ; rien sinon (404). */
async function cote(db, u, t) {
  const etabs = (u.etabs || []).map(Number);
  if (etabs.includes(t.origine_id)) return 'origine';
  if (etabs.includes(t.destination_id)) return 'destination';
  if (u.gestionnaire) return 'coordination';
  if (u.role === 'direction_regionale') {
    const regions = (await db.query('SELECT d.region_id FROM utilisateur_directions ud JOIN directions_regionales d ON d.id = ud.direction_id AND d.actif WHERE ud.utilisateur_id = $1', [u.id])).rows.map((r) => r.region_id);
    if (regions.includes(t.origine_region_id) || regions.includes(t.destination_region_id)) return 'coordination';
  }
  if (['paramedic', 'superviseur_secours', 'repartiteur'].includes(u.role)) {
    const orgs = (await db.query('SELECT organisation_id FROM utilisateur_organisations WHERE utilisateur_id = $1', [u.id])).rows.map((r) => r.organisation_id);
    const lie = (await db.query(`SELECT 1 FROM prealertes WHERE transfert_id = $1 AND organisation_id = ANY($2)`, [t.id, orgs])).rowCount;
    if (lie) return 'transporteur';
  }
  throw new ErreurHttp(404, 'transfert_introuvable');
}

/** Alertes de blocage, expliquées : aucune décision après l'échéance, transport non organisé, véhicule indisponible. */
function alertes(t, h, transport, delais) {
  const a = []; const age = (d) => Math.round((Date.now() - new Date(d).getTime()) / 60000);
  const echeance = t.urgent ? delais.transfert_urgent : delais.transfert;
  if (t.statut === 'demande' && age(t.date_demande) > echeance) a.push({ code: 'sans_decision', minutes: age(t.date_demande), seuil: echeance });
  if (t.statut === 'validee' && t.date_validation && age(t.date_validation) > ATTENTE_TRANSPORT_MIN && !transport) a.push({ code: 'transport_non_organise', minutes: age(t.date_validation), seuil: ATTENTE_TRANSPORT_MIN });
  if (transport && ['hors_service', 'desinfection'].includes(transport.etat_vehicule) && !['recu', 'refuse'].includes(t.statut)) a.push({ code: 'vehicule_indisponible', etat: transport.etat_vehicule });
  if (t.lit_id && t.lit_etat && !['reserve', 'occupe'].includes(t.lit_etat) && ['validee', 'transport', 'en_route'].includes(t.statut)) a.push({ code: 'lit_non_reserve', etat: t.lit_etat });
  return a;
}
async function delaisReponse(db) {
  return Object.fromEntries((await db.query('SELECT circuit, minutes FROM delais_reponse')).rows.map((r) => [r.circuit, r.minutes]));
}
async function transportDe(db, t) {
  return (await db.query(`SELECT pa.numero AS prealerte, pa.statut, un.numero AS unite, o.nom AS organisation, ev.etat AS etat_vehicule, eta.minutes AS eta_min
    FROM prealertes pa JOIN unites_secours un ON un.id = pa.unite_id JOIN organisations_secours o ON o.id = pa.organisation_id
    LEFT JOIN etats_vehicules ev ON ev.unite_id = pa.unite_id LEFT JOIN eta_prealertes eta ON eta.prealerte_id = pa.id
    WHERE pa.transfert_id = $1 AND pa.statut <> 'remplacee' ORDER BY pa.id DESC LIMIT 1`, [t.id])).rows[0] || null;
}

/** Fiche unique : mêmes étapes, mêmes heures pour tous ; référence du patient seulement pour les deux hôpitaux. */
async function fiche(pool, u, id) {
  const t = (await pool.query(`${SELECT} WHERE t.id = $1`, [entier(id)])).rows[0];
  if (!t) throw new ErreurHttp(404, 'transfert_introuvable');
  const c = await cote(pool, u, t);
  const h = await horloge.lire(pool, 'transfert', t.id);
  const min = (a, b) => (h[a] && h[b] ? Math.round((new Date(h[b].heure) - new Date(h[a].heure)) / 60000) : null);
  const transport = await transportDe(pool, t);
  const rap = (await pool.query(`SELECT r.id, r.statut, r.motif_refus, e.nom AS vers, r.propose_vers_id, r.retour_transfert_id, r.cree_le FROM rapatriements r
    JOIN etablissements e ON e.id = r.propose_vers_id WHERE r.transfert_id = $1 ORDER BY r.id DESC LIMIT 1`, [t.id])).rows[0] || null;
  const hopital = ['origine', 'destination'].includes(c);
  return { id: t.id, numero: t.numero, cote: c, ...(hopital ? { patient_ref: t.patient_ref } : {}), origine: t.origine, destination: t.destination,
    type_nom: t.type_nom, urgent: t.urgent, statut: t.statut, motif_refus: t.motif_refus_code,
    lit: t.lit_code ? { code: t.lit_code, etat: t.lit_etat } : null, arrivee_prevue: t.arrivee_prevue,
    heures: Object.fromEntries(['demande', 'decision', 'depart', 'arrivee'].map((e) => [e, h[e] ? h[e].heure : null])),
    delais: { decision_min: min('demande', 'decision'), depart_min: min('decision', 'depart'), route_min: min('depart', 'arrivee'), total_min: min('demande', 'arrivee') },
    transport, alertes: alertes(t, h, transport, await delaisReponse(pool)),
    stable_retour_le: t.stable_retour_le, rapatriement: rap };
}

/** Centrale : transferts urgents en cours de la région (gestionnaire réseau, direction régionale, CCS de la région). */
async function centrale(pool, u) {
  let filtre = ''; let vals = [];
  if (u.role === 'direction_regionale') {
    const regions = (await pool.query('SELECT d.region_id FROM utilisateur_directions ud JOIN directions_regionales d ON d.id = ud.direction_id AND d.actif WHERE ud.utilisateur_id = $1', [u.id])).rows.map((r) => r.region_id);
    filtre = 'AND (o.region_id = ANY($1) OR d.region_id = ANY($1))'; vals = [regions];
  } else if (u.role === 'repartiteur') {
    const cfg = (await pool.query(`SELECT o.config_id FROM utilisateur_organisations uo JOIN organisations_secours o ON o.id = uo.organisation_id WHERE uo.utilisateur_id = $1 AND 'ccs' = ANY(o.profils)`, [u.id])).rows.map((r) => r.config_id);
    if (!cfg.length) throw new ErreurHttp(403, 'organisation_interdite');
    filtre = 'AND o.config_id = ANY($1)'; vals = [cfg];
  } else if (!u.gestionnaire) throw new ErreurHttp(403, 'role_insuffisant');
  const rows = (await pool.query(`${SELECT} WHERE t.urgent AND t.statut NOT IN ('recu', 'refuse') ${filtre} ORDER BY t.date_demande`, vals)).rows;
  const delais = await delaisReponse(pool);
  const out = [];
  for (const t of rows) {
    const h = await horloge.lire(pool, 'transfert', t.id); const transport = await transportDe(pool, t);
    out.push({ id: t.id, numero: t.numero, origine: t.origine, destination: t.destination, type_nom: t.type_nom, statut: t.statut, date_demande: t.date_demande,
      attente_min: Math.round((Date.now() - new Date(t.date_demande).getTime()) / 60000), transport, alertes: alertes(t, h, transport, delais) });
  }
  return { transferts: out };
}

/**
 * « Stable pour retour » (équipe receveuse, après la réception) : Arrimo PROPOSE un rapatriement vers l'hôpital d'origine s'il a un lit
 * compatible libre et confirmé, sinon le plus proche de l'origine dans le même profil ; une personne accepte ou refuse.
 */
async function stablePourRetour(pool, u, id) {
  return transaction(pool, async (c) => {
    const t = (await c.query(`${SELECT} WHERE t.id = $1 FOR UPDATE OF t`, [entier(id)])).rows[0];
    if (!t) throw new ErreurHttp(404, 'transfert_introuvable');
    if ((await cote(c, u, t)) !== 'destination') throw new ErreurHttp(403, 'action_revient_a', { etab: t.destination });
    if (t.statut !== 'recu') throw new ErreurHttp(409, 'transfert_statut', { numero: t.numero });
    const dest = (await c.query('SELECT modules, type_etablissement FROM etablissements WHERE id = $1', [t.destination_id])).rows[0];
    if (!require('./types-etablissement').moduleActif(dest, 'transferts_suivi')) throw new ErreurHttp(403, 'module_desactive', { module: 'transferts_suivi' });
    if ((await c.query("SELECT 1 FROM rapatriements WHERE transfert_id = $1 AND statut = 'propose'", [t.id])).rowCount) throw new ErreurHttp(409, 'rapatriement_deja_propose');
    const cands = (await c.query(`SELECT e.id, e.nom, e.latitude, e.longitude, count(l.id)::int AS libres FROM etablissements e JOIN config_pays cfg ON cfg.id = e.config_id
      JOIN lits l ON l.etablissement_id = e.id AND l.type_id = $2 AND l.etat = 'libre' AND l.disponibilite_confirmee_le >= now() - make_interval(mins => cfg.confirmation_lit_validite_min)
      WHERE e.actif AND e.config_id = $1 AND e.id <> $3 AND e.partage <> 'aucun' AND COALESCE(e.type_etablissement, 'hopital') = 'hopital' GROUP BY e.id`, [t.config_id, t.type_id, t.destination_id])).rows;
    if (!cands.length) throw new ErreurHttp(409, 'rapatriement_aucune_place');
    const origine = (await c.query('SELECT latitude, longitude FROM etablissements WHERE id = $1', [t.origine_id])).rows[0];
    const choix = cands.find((x) => x.id === t.origine_id) || cands.sort((a, b) => kmEntre(origine, a) - kmEntre(origine, b))[0];
    await c.query('UPDATE transferts SET stable_retour_le = now(), stable_retour_par = $2 WHERE id = $1', [t.id, u.id]);
    const r = (await c.query('INSERT INTO rapatriements (transfert_id, propose_vers_id) VALUES ($1, $2) RETURNING *', [t.id, choix.id])).rows[0];
    await c.query(`INSERT INTO journal (etablissement_id, utilisateur_id, action, detail, transfert_id) VALUES ($1, $2, 'Rapatriement proposé', $3, $4)`,
      [t.destination_id, u.id, `${t.numero} → ${choix.nom}`, t.id]);
    await require('./services').notifier(c, t.origine_id, t.id, 'rapatriement_propose', { numero: t.numero, vers: choix.nom });
    return { ...r, vers: choix.nom, raison: choix.id === t.origine_id ? 'hopital_origine' : 'plus_proche_origine' };
  });
}
/** Décision humaine sur un rapatriement proposé : accepter (demande de transfert de retour, règles habituelles) ou refuser (motif fermé). */
async function deciderRapatriement(pool, u, id, b = {}) {
  const r0 = (await pool.query('SELECT * FROM rapatriements WHERE id = $1', [entier(id)])).rows[0];
  if (!r0) throw new ErreurHttp(404, 'rapatriement_introuvable');
  const t = (await pool.query(`${SELECT} WHERE t.id = $1`, [r0.transfert_id])).rows[0];
  if ((await cote(pool, u, t)) !== 'destination') throw new ErreurHttp(403, 'action_revient_a', { etab: t.destination });
  if (r0.statut !== 'propose') throw new ErreurHttp(409, 'rapatriement_statut');
  if (b.decision === 'refuser') {
    if (!MOTIFS_RAPATRIEMENT.includes(b.motif)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'motif' });
    return (await pool.query("UPDATE rapatriements SET statut = 'refuse', motif_refus = $2, decide_par = $3, decide_le = now() WHERE id = $1 AND statut = 'propose' RETURNING *", [r0.id, b.motif, u.id])).rows[0];
  }
  if (b.decision !== 'accepter') throw new ErreurHttp(400, 'action_inconnue');
  return transaction(pool, async (c) => {
    const verrou = (await c.query("SELECT * FROM rapatriements WHERE id = $1 AND statut = 'propose' FOR UPDATE", [r0.id])).rows[0];
    if (!verrou) throw new ErreurHttp(409, 'rapatriement_statut');
    const retour = await require('./services').creerTransfert(pool, u, { origine_id: t.destination_id, destination_id: r0.propose_vers_id, type_id: t.type_id,
      patient_ref: t.patient_ref, urgent: false, hors_rayon: true }, c);
    return (await c.query("UPDATE rapatriements SET statut = 'accepte', retour_transfert_id = $2, decide_par = $3, decide_le = now() WHERE id = $1 RETURNING *", [r0.id, retour.id, u.id])).rows[0];
  });
}

module.exports = { fiche, centrale, stablePourRetour, deciderRapatriement, MOTIFS_RAPATRIEMENT };
