'use strict';
/**
 * Arrimo Flux (cahier ultime du 21 nov. 2026, section 5) : arrivées et départs de l'établissement, comme un tableau d'aéroport.
 * Une ligne par mouvement réel, sans doublon : transport (prioritaire), sinon transfert entre hôpitaux, sinon départ ou arrivée
 * d'hébergement sans transport, et préalertes d'urgence des ambulances. Les heures sont distinctes : créneau demandé, départ
 * prévu, départ réel, arrivée estimée (seulement si une donnée existe : sinon « ETA indisponible », jamais inventée), arrivée réelle.
 * Préparation de la chambre d'arrivée : tâche ouverte, chambre déclarée prête par l'entretien, ou non requise. Aucune donnée clinique.
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');

const { DEPART_NSA_SQL, BROUILLON_PRIVE_SQL } = require('./transports');
const ETAPES_TR = { a_valider: 'a_valider', demandee: 'demande', acceptee: 'accepte', en_route: 'en_route_depart', pris_en_charge: 'en_transport', arrivee: 'arrive', refusee: 'refuse', annulee: 'annule' };

async function preparation(db, litId) {
  if (!litId) return null;
  const t = (await db.query(`SELECT statut, echeance FROM taches_etab WHERE lit_id = $1 AND type IN ('preparation_chambre', 'entretien') AND statut IN ('a_faire', 'en_cours') ORDER BY id DESC LIMIT 1`, [litId])).rows[0];
  const l = (await db.query('SELECT code, entretien_statut, etat FROM lits WHERE id = $1', [litId])).rows[0];
  if (t) return { etat: t.statut === 'en_cours' ? 'en_cours' : 'a_faire', chambre: l?.code, echeance: t.echeance };
  return { etat: l?.entretien_statut === 'propre' || l?.etat === 'libre' ? 'prete' : 'a_verifier', chambre: l?.code };
}

async function mouvements(pool, u, q = {}) {
  const id = Number(q.etablissement_id); if (!Number.isSafeInteger(id) || id < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, id);
  if (['entretien'].includes(u.role) && q.complet === '1') throw new ErreurHttp(403, 'role_insuffisant');
  const jour = q.jour === 'demain' ? 1 : 0;
  const lignes = [];
  // 1. Transports (source principale : ils portent véhicule, statut et préalerte)
  const tr = (await pool.query(`SELECT d.*, eo.nom AS origine, COALESCE(ed.nom, d.destination_libelle) AS destination, un.numero AS unite, ed.type_etablissement AS destination_type,
      dh.resident_id, dh.lit_propose_id, r.lit_id AS resident_lit,
      COALESCE(hd.heure, ${DEPART_NSA_SQL},
        CASE WHEN d.motif_transport IS NULL THEN d.pris_en_charge_le END) AS depart_reel
    FROM demandes_transport d JOIN etablissements eo ON eo.id = d.origine_id LEFT JOIN etablissements ed ON ed.id = d.destination_id LEFT JOIN unites_secours un ON un.id = d.unite_id
      LEFT JOIN demandes_hebergement dh ON dh.id = d.demande_hebergement_id LEFT JOIN residents r ON r.id = dh.resident_id
      LEFT JOIN v_horodatages_courants hd ON hd.objet = 'demande_transport' AND hd.objet_id = d.id AND hd.etape = 'depart'
    WHERE (d.origine_id = $1 OR (d.destination_id = $1 AND NOT ${BROUILLON_PRIVE_SQL})) AND d.statut <> 'annulee'
      AND (d.statut IN ('a_valider', 'demandee', 'acceptee', 'en_route', 'pris_en_charge') OR d.modifie_le > now() - interval '18 hours')
      AND COALESCE(d.plage_confirmee_debut, d.plage_debut, d.heure_souhaitee, d.cree_le)::date BETWEEN current_date - 1 AND current_date + 1 + $2::int`, [id, jour])).rows;
  const dhAvecTransport = new Set(tr.filter((d) => d.demande_hebergement_id).map((d) => d.demande_hebergement_id));
  for (const d of tr) {
    const arrivee = d.destination_id === id;
    const eta = arrivee && d.prealerte_eta_min != null && d.prealerte_eta_le ? new Date(new Date(d.prealerte_eta_le).getTime() + d.prealerte_eta_min * 60000) : null;   // ETA = arrivée chez nous seulement
    lignes.push({ cle: `transport:${d.id}`, mouvement: arrivee ? 'arrivee' : 'depart', type: 'transport', reference: d.numero, personne: d.resident_ref, origine: d.origine, destination: d.destination,
      creneau: d.plage_confirmee_debut || d.plage_debut ? { debut: d.plage_confirmee_debut || d.plage_debut, fin: d.plage_confirmee_fin || d.plage_fin, confirme: !!d.plage_confirmee_debut } : null,
      prevue: d.plage_confirmee_debut || d.plage_debut || d.heure_souhaitee, depart_reel: d.depart_reel, eta, eta_source: eta ? 'prealerte' : null, arrivee_reelle: d.arrivee_le,
      vehicule: d.unite, statut: d.terminee_le ? 'termine' : ETAPES_TR[d.statut] || d.statut, statut_brut: d.statut,
      statut_detail: d.remis_le && !d.terminee_le ? 'remis' : null, incident: !!d.incident_le && !d.terminee_le,
      prealerte: d.prealerte_le ? { le: d.prealerte_le, recue_le: d.prealerte_recue_le, eta_min: d.prealerte_eta_min } : null,
      preparation: arrivee && d.destination_type !== 'hopital' ? await preparation(pool, d.resident_lit || d.lit_propose_id) : null,
      ecran: 'transports-planifies', fiche: { type: 'transport', id: d.id }, actions: arrivee && d.prealerte_le && !d.prealerte_recue_le ? ['accuser_prealerte'] : [], transport_id: d.id });
  }
  // 2. Transferts entre hôpitaux (sans transport planifié lié)
  for (const t of (await pool.query(`SELECT t.*, eo.nom AS origine, ed.nom AS destination FROM transferts t JOIN etablissements eo ON eo.id = t.origine_id JOIN etablissements ed ON ed.id = t.destination_id
      WHERE (t.origine_id = $1 OR t.destination_id = $1) AND (t.statut IN ('demande', 'validee', 'transport', 'en_route') OR t.date_reception > now() - interval '18 hours')`, [id])).rows) {
    const arrivee = t.destination_id === id;
    const eta = t.date_depart && t.minutes_route ? new Date(new Date(t.date_depart).getTime() + t.minutes_route * 60000) : null;
    lignes.push({ cle: `transfert:${t.id}`, mouvement: arrivee ? 'arrivee' : 'depart', type: 'transfert', reference: t.numero, personne: t.patient_ref, origine: t.origine, destination: t.destination,
      creneau: null, prevue: t.date_validation || t.date_demande, depart_reel: t.date_depart, eta, eta_source: eta ? 'itineraire' : null, arrivee_reelle: t.date_reception,
      vehicule: null, priorite: t.urgent ? 'urgente' : 'non_urgente', statut: { demande: 'demande', validee: 'accepte', transport: 'en_route_depart', en_route: 'en_transport', recu: 'arrive', refuse: 'refuse' }[t.statut] || t.statut, statut_brut: t.statut,
      preparation: arrivee && t.lit_id ? { etat: t.date_chambre_prete ? 'prete' : 'a_verifier' } : null, ecran: 'transferts',
      fiche: { type: 'transfert', id: t.id }, actions: [],
      transfert: u.role === 'entretien' ? null : { id: t.id, numero: t.numero, statut: t.statut,
        origine_id: t.origine_id, destination_id: t.destination_id, date_chambre_prete: t.date_chambre_prete } });
  }
  // 3. Hébergement : départs/arrivées programmés sans transport lié
  for (const h of (await pool.query(`SELECT dh.*, eo.nom AS origine, ed.nom AS destination, r.lit_id AS resident_lit FROM demandes_hebergement dh JOIN etablissements ed ON ed.id = dh.etablissement_id
      LEFT JOIN etablissements eo ON eo.id = dh.hopital_id LEFT JOIN residents r ON r.id = dh.resident_id
      WHERE (dh.etablissement_id = $1 OR dh.hopital_id = $1) AND dh.depart_prevu_le IS NOT NULL AND dh.statut NOT IN ('refusee', 'annulee', 'admise', 'transferee')
        AND dh.depart_prevu_le::date BETWEEN current_date - 1 AND current_date + 1 + $2::int`, [id, jour]).catch(() => ({ rows: [] }))).rows) {
    if (dhAvecTransport.has(h.id)) continue;
    const arrivee = h.etablissement_id === id;
    lignes.push({ cle: `hebergement:${h.id}`, mouvement: arrivee ? 'arrivee' : 'depart', type: 'hebergement', reference: h.numero, personne: h.reference_externe, origine: h.origine || '—', destination: h.destination,
      creneau: null, prevue: h.depart_prevu_le, depart_reel: h.depart_hopital_le, eta: null, eta_source: null, arrivee_reelle: null, vehicule: null,
      statut: h.depart_hopital_le ? 'en_transport' : 'prevu', statut_brut: h.statut, preparation: arrivee ? await preparation(pool, h.resident_lit || h.lit_propose_id) : null, ecran: arrivee ? 'c-admissions' : 'nsa', actions: [] });
  }
  // 4. Préalertes d'urgence des ambulances (hôpital)
  for (const p of (await pool.query(`SELECT p.*, un.numero AS unite, (SELECT ea.minutes FROM eta_prealertes ea WHERE ea.prealerte_id = p.id) AS eta_min, (SELECT ea.calcule_le FROM eta_prealertes ea WHERE ea.prealerte_id = p.id) AS eta_le
      FROM prealertes p JOIN unites_secours un ON un.id = p.unite_id WHERE p.destination_id = $1 AND p.demande_transport_id IS NULL
        AND (p.statut IN ('envoyee', 'recue', 'consultee', 'prise_en_compte', 'preparation', 'preparation_terminee', 'arrivee') OR p.cloturee_le > now() - interval '6 hours')`, [id]).catch(() => ({ rows: [] }))).rows) {
    const eta = p.eta_min != null && p.eta_le ? new Date(new Date(p.eta_le).getTime() + p.eta_min * 60000) : null;
    lignes.push({ cle: `prealerte:${p.id}`, mouvement: 'arrivee', type: 'prealerte', reference: p.numero, personne: null, origine: 'Ambulance', destination: null, creneau: null,
      prevue: p.heure_prevue, depart_reel: null, eta, eta_source: eta ? 'position' : null, arrivee_reelle: p.arrivee_confirmee_le, vehicule: p.unite,
      statut: p.statut === 'arrivee' ? 'arrive' : p.cloturee_le ? 'termine' : 'en_transport', statut_brut: p.statut, priorite: p.priorite, preparation: null, ecran: 'secours', actions: [] });
  }
  const sens = q.sens === 'arrivees' ? 'arrivee' : q.sens === 'departs' ? 'depart' : null;
  const rang = (l) => new Date(l.arrivee_reelle || l.eta || l.prevue || 0).getTime();
  const res = lignes.filter((l) => !sens || l.mouvement === sens).sort((a, b) => rang(a) - rang(b));
  // Retard : heure prévue (ou estimée) dépassée de 15 min sans arrivée/départ réel
  const now = Date.now();
  for (const l of res) {
    const repere = l.mouvement === 'arrivee' ? (l.eta || l.prevue) : l.prevue; const fait = l.mouvement === 'arrivee' ? l.arrivee_reelle : l.depart_reel;
    l.retard = !!(repere && !fait && !['refuse', 'annule', 'termine', 'arrive'].includes(l.statut) && now - new Date(repere).getTime() > 15 * 60000);
    // Préparation en retard (cahier Personnel & Tâches, 15) : chambre pas prête à moins de 30 min de l'arrivée prévue ou estimée
    if (l.preparation && ['a_faire', 'en_cours'].includes(l.preparation.etat) && l.mouvement === 'arrivee' && !l.arrivee_reelle && repere && new Date(repere).getTime() - now < 30 * 60000) l.preparation.retard = true;
  }
  return { genere_le: new Date().toISOString(), mouvements: res,
    resume: { arrivees: res.filter((l) => l.mouvement === 'arrivee').length, departs: res.filter((l) => l.mouvement === 'depart').length, retards: res.filter((l) => l.retard).length,
      prealertes_a_acquitter: res.filter((l) => l.actions.includes('accuser_prealerte')).length, preparations: res.filter((l) => l.preparation && ['a_faire', 'en_cours'].includes(l.preparation.etat)).length } };
}

/** Historique des disponibilités (cahier directeur, 9) : par jour, d'après le journal immuable des lits (source unique) ; état actuel. */
async function historiqueCapacites(pool, u, q = {}) {
  const id = Number(q.etablissement_id); if (!Number.isSafeInteger(id) || id < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, id);
  if (u.role === 'entretien') throw new ErreurHttp(403, 'role_insuffisant');
  const jours = Math.min(Math.max(Number(q.jours) || 14, 1), 90);
  const fz = (await pool.query('SELECT c.fuseau FROM etablissements e JOIN config_pays c ON c.id = e.config_id WHERE e.id = $1', [id])).rows[0]?.fuseau || 'America/Toronto';
  const parJour = (await pool.query(`SELECT to_char(j.date AT TIME ZONE $3, 'YYYY-MM-DD') AS jour,
      count(*) FILTER (WHERE j.nouvel_etat = 'libre')::int AS liberes, count(*) FILTER (WHERE j.nouvel_etat = 'occupe')::int AS occupes,
      count(*) FILTER (WHERE j.nouvel_etat = 'nettoyage')::int AS a_nettoyer, count(*) FILTER (WHERE j.nouvel_etat = 'reserve')::int AS reserves,
      count(*) FILTER (WHERE j.nouvel_etat = 'indispo')::int AS bloques
    FROM journal j WHERE j.etablissement_id = $1 AND j.lit_id IS NOT NULL AND NOT j.refuse AND j.date > now() - make_interval(days => $2)
    GROUP BY 1 ORDER BY 1 DESC`, [id, jours, fz])).rows;
  const actuel = (await pool.query(`SELECT etat, count(*)::int n FROM lits WHERE etablissement_id = $1 AND actif GROUP BY etat`, [id])).rows;
  return { jours, par_jour: parJour, actuel: Object.fromEntries(actuel.map((x) => [x.etat, x.n])) };
}

/**
 * Historique des transferts (cahier directeur, 8.6) : mouvements clos (arrivés, terminés, refusés, annulés) des N derniers jours, pour
 * l'établissement seulement (origine ou destination). Références seulement, aucune identité, aucune donnée clinique.
 */
async function historique(pool, u, q = {}) {
  const id = Number(q.etablissement_id); if (!Number.isSafeInteger(id) || id < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, id);
  if (u.role === 'entretien') throw new ErreurHttp(403, 'role_insuffisant');
  const jours = Math.min(Math.max(Number(q.jours) || 30, 1), 365);
  const tr = (await pool.query(`SELECT 'transport' AS type, d.id, d.numero AS reference, d.resident_ref AS personne, eo.nom AS origine, COALESCE(ed.nom, d.destination_libelle) AS destination,
      CASE WHEN d.destination_id = $1 THEN 'arrivee' ELSE 'depart' END AS mouvement, CASE WHEN d.statut = 'annulee' THEN 'annule' WHEN d.statut = 'refusee' THEN 'refuse' WHEN d.remis_le IS NOT NULL THEN 'termine' ELSE 'arrive' END AS statut,
      d.cree_le AS debut, COALESCE(d.remis_le, d.arrivee_le, d.modifie_le) AS fin, un.numero AS vehicule
    FROM demandes_transport d JOIN etablissements eo ON eo.id = d.origine_id LEFT JOIN etablissements ed ON ed.id = d.destination_id LEFT JOIN unites_secours un ON un.id = d.unite_id
    WHERE (d.origine_id = $1 OR d.destination_id = $1) AND NOT ${BROUILLON_PRIVE_SQL} AND d.statut IN ('annulee', 'refusee', 'arrivee') AND d.modifie_le > now() - make_interval(days => $2)`, [id, jours]).catch(() => ({ rows: [] }))).rows;
  const tf = (await pool.query(`SELECT 'transfert' AS type, t.id, t.numero AS reference, t.patient_ref AS personne, eo.nom AS origine, ed.nom AS destination,
      CASE WHEN t.destination_id = $1 THEN 'arrivee' ELSE 'depart' END AS mouvement, CASE t.statut WHEN 'recu' THEN 'arrive' WHEN 'refuse' THEN 'refuse' ELSE 'annule' END AS statut,
      t.date_demande AS debut, COALESCE(t.date_reception, t.date_demande) AS fin, NULL AS vehicule
    FROM transferts t JOIN etablissements eo ON eo.id = t.origine_id JOIN etablissements ed ON ed.id = t.destination_id
    WHERE (t.origine_id = $1 OR t.destination_id = $1) AND t.statut IN ('recu', 'refuse', 'annule') AND COALESCE(t.date_reception, t.date_demande) > now() - make_interval(days => $2)`, [id, jours]).catch(() => ({ rows: [] }))).rows;
  const l = [...tr, ...tf].sort((a, b) => new Date(b.fin) - new Date(a.fin)).slice(0, 300);
  return { jours, mouvements: l };
}

/**
 * Fiche opérationnelle interactive (cahier ultime, section 13) : transport ou transfert, origine/destination autorisées seulement.
 * Chronologie : demande → acceptation → préparation → départ → transport → arrivée → réception → clôture, avec acteur et heure.
 */
async function fiche(pool, u, q = {}) {
  const id = Number(q.id); if (!Number.isSafeInteger(id) || id < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'id' });
  const etabs = (u.etabs || []).map(Number);
  if (q.type === 'transfert') {
    const t = (await pool.query(`SELECT t.*, eo.nom AS origine, ed.nom AS destination, l.code AS lit FROM transferts t JOIN etablissements eo ON eo.id = t.origine_id JOIN etablissements ed ON ed.id = t.destination_id LEFT JOIN lits l ON l.id = t.lit_id WHERE t.id = $1`, [id])).rows[0];
    if (!t || !(u.gestionnaire || etabs.includes(t.origine_id) || etabs.includes(t.destination_id))) throw new ErreurHttp(404, 'objet_introuvable');
    const etapes = [['demande', t.date_demande], ['acceptation', t.date_validation], ['preparation', t.date_chambre_prete], ['depart', t.date_depart], ['reception', t.date_reception], ['refus', t.date_refus]];
    return { type: 'transfert', reference: t.numero, personne: t.patient_ref, origine: t.origine, destination: t.destination, statut: t.statut, lit: t.lit, vehicule: null,
      chronologie: etapes.filter(([, d]) => d).map(([etape, quand]) => ({ etape, quand, acteur: null })).sort((a, b) => new Date(a.quand) - new Date(b.quand)), incident: null };
  }
  const d = (await pool.query(`SELECT d.*, ${BROUILLON_PRIVE_SQL} AS brouillon_prive, eo.nom AS origine, COALESCE(ed.nom, d.destination_libelle) AS destination, un.numero AS unite FROM demandes_transport d JOIN etablissements eo ON eo.id = d.origine_id
    LEFT JOIN etablissements ed ON ed.id = d.destination_id LEFT JOIN unites_secours un ON un.id = d.unite_id WHERE d.id = $1`, [id])).rows[0];
  if (!d || !(u.gestionnaire || etabs.includes(d.origine_id) || (!d.brouillon_prive && etabs.includes(d.destination_id)))) throw new ErreurHttp(404, 'objet_introuvable');
  const ev = (await pool.query(`SELECT e.type, e.cree_le, x.nom AS acteur FROM demande_transport_evenements e LEFT JOIN utilisateurs x ON x.id = e.utilisateur_id WHERE e.demande_id = $1 ORDER BY e.cree_le, e.id`, [d.id])).rows;
  const NOM = { preparee: 'demande', demandee: 'demande', transmettre: 'demande_transmise', accepter: 'acceptation', refuser: 'refus', en_route: 'en_route', sur_place: 'sur_place', pris_en_charge: 'depart', partir_destination: 'depart_confirme', prealerte: 'prealerte',
    prealerte_maj: 'prealerte', prealerte_recue: 'prealerte_recue', arrivee: 'arrivee', remis: 'reception', terminer: 'cloture', incident: 'incident', annuler: 'annulation' };
  return { type: 'transport', reference: d.numero, personne: d.resident_ref, origine: d.origine, destination: d.destination, statut: d.statut, vehicule: d.unite,
    creneau: d.plage_debut ? { debut: d.plage_confirmee_debut || d.plage_debut, fin: d.plage_confirmee_fin || d.plage_fin, confirme: !!d.plage_confirmee_debut } : null,
    chronologie: ev.map((x) => ({ etape: NOM[x.type] || x.type, quand: x.cree_le, acteur: x.acteur || null })), incident: d.incident_le ? { le: d.incident_le, motif: d.incident_motif } : null };
}

module.exports = { historiqueCapacites, historique, mouvements, fiche };
