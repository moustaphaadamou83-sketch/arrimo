/**
 * Arrimo Sillage (« Continuité » dans la demande de Moustafa du 16 nov. 2026 ; nom choisi le même jour) : le parcours complet d'un résident entre le CHSLD, l'ambulance et l'hôpital,
 * sans rupture. Lecture seule : chaque étape garde sa propre action dans son module (Liaison CHSLD, Liaison Secours, transports).
 *
 * Six étapes : 1. demande du CHSLD · 2. prise en charge ambulancière · 3. préparation hospitalière · 4. arrivée et admission ·
 * 5. préparation du retour · 6. transport retour et clôture. Pour chacune : responsable (organisation), heure, confirmation de réception,
 * et alerte si elle attend plus longtemps que le délai prévu. Chronologie commune des événements.
 * Visibilité : le CHSLD d'origine et l'hôpital concerné seulement ; noms jamais montrés hors du CHSLD (référence seulement).
 * Aucune donnée clinique ; OG signale les étapes en attente, sans rien décider.
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');

// Délais d'attente avant alerte (minutes) : une étape qui attend plus longtemps est signalée « bloquée »
const DELAIS = { reception: 15, transport_accepte: 20, transport_en_route: 30, preparation: 15, arrivee: 90, admission: 120, retour_accepte: 120, retour_depart: 120, reintegration: 60 };
const min = (d) => (d ? (Date.now() - new Date(d).getTime()) / 60000 : 0);

async function chargerParcours(db, filtreSql, args) {
  const cos = (await db.query(`SELECT c.*, o.nom AS origine, d.nom AS destination,
      (SELECT max(e.date) FROM coordination_etapes e WHERE e.coordination_id = c.id AND e.statut = 'en_cours') AS depart_le
    FROM coordinations c JOIN etablissements o ON o.id = c.origine_id JOIN etablissements d ON d.id = c.destination_id
    WHERE c.type = 'hospitalisation' AND ${filtreSql} ORDER BY c.cree_le DESC LIMIT 60`, args)).rows;
  if (!cos.length) return [];
  const ids = cos.map((c) => c.id);
  const retours = (await db.query(`SELECT c.*, (SELECT max(e.date) FROM coordination_etapes e WHERE e.coordination_id = c.id AND e.statut = 'en_cours') AS depart_le
    FROM coordinations c WHERE c.type = 'retour' AND c.liee_id = ANY($1) ORDER BY c.id`, [ids])).rows;
  const tous = [...ids, ...retours.map((r) => r.id)];
  const transports = (await db.query(`SELECT t.*, o.nom AS organisation, u.numero AS unite FROM demandes_transport t JOIN organisations_secours o ON o.id = t.organisation_id
    LEFT JOIN unites_secours u ON u.id = t.unite_id WHERE t.coordination_id = ANY($1) ORDER BY t.id`, [tous])).rows;
  const prealertes = transports.length ? (await db.query(`SELECT p.*, e.nom AS destination, u.numero AS unite FROM prealertes p JOIN etablissements e ON e.id = p.destination_id
    JOIN unites_secours u ON u.id = p.unite_id WHERE p.demande_transport_id = ANY($1) ORDER BY p.id`, [transports.map((t) => t.id)])).rows : [];
  const etapesCo = (await db.query(`SELECT e.coordination_id, e.statut, e.detail, e.date, et.nom AS etablissement FROM coordination_etapes e
    LEFT JOIN etablissements et ON et.id = e.etablissement_id WHERE e.coordination_id = ANY($1) ORDER BY e.date, e.id`, [tous])).rows;
  const evTr = transports.length ? (await db.query(`SELECT demande_id, type, cree_le FROM demande_transport_evenements WHERE demande_id = ANY($1) ORDER BY id`, [transports.map((t) => t.id)])).rows : [];
  const evPa = prealertes.length ? (await db.query(`SELECT prealerte_id, type, cree_le FROM prealerte_evenements WHERE prealerte_id = ANY($1) ORDER BY id`, [prealertes.map((p) => p.id)])).rows : [];
  // Chrono (19 nov. 2026) : heures H11 à H15 du passage de l'ambulance à l'urgence, depuis l'Horloge (mêmes heures que l'écran Chrono)
  const evCh = prealertes.length ? (await db.query(`SELECT p.prealerte_id, h.etape, h.heure FROM passages_chrono p
    JOIN v_horodatages_courants h ON h.objet = 'passage_chrono' AND h.objet_id = p.id WHERE p.prealerte_id = ANY($1)`, [prealertes.map((p) => p.id)])).rows : [];
  return cos.map((co) => construire(co, {
    retour: retours.filter((r) => r.liee_id === co.id).at(-1) || null,
    transports, prealertes, etapesCo, evTr, evPa, evCh,
  }));
}

function etape(code, { fait = null, debut = null, responsable, delai = null, attente = null, detail = null, confirme = null, sansObjet = false }) {
  let etat = fait ? 'fait' : debut ? 'en_cours' : 'a_venir';
  if (sansObjet) etat = 'sans_objet';
  const bloquee = etat === 'en_cours' && delai != null && min(debut) > delai;
  return { code, etat, fait_le: fait || null, depuis: etat === 'en_cours' ? debut : null, responsable, attente, detail, confirme_le: confirme || null,
    bloquee, attente_min: etat === 'en_cours' ? Math.round(min(debut)) : null };
}

function construire(co, x) {
  const aller = x.transports.filter((t) => t.coordination_id === co.id).at(-1) || null;
  const pa = aller ? x.prealertes.filter((p) => p.demande_transport_id === aller.id && p.statut !== 'remplacee').at(-1) || null : null;
  const r = x.retour;
  const retourTr = r ? x.transports.filter((t) => t.coordination_id === r.id).at(-1) || null : null;
  const hopital = pa?.destination || co.destination;
  const ferme = !!co.cloturee_le || ['annulee', 'refusee', 'expiree'].includes(co.statut);
  const e = [];
  // 1. Demande du CHSLD : transmise, reçue (accusé) et acceptée par l'hôpital
  e.push(etape('demande', { fait: co.acceptee_le || (co.recue_hopital_le && co.arrivee_le) || null, debut: co.cree_le, responsable: co.origine, confirme: co.recue_hopital_le,
    attente: co.recue_hopital_le ? hopital : hopital, delai: co.recue_hopital_le ? null : DELAIS.reception, detail: co.statut }));
  // 2. Prise en charge ambulancière (si un transport par ambulance a été demandé)
  const tFait = aller && (aller.pris_en_charge_le || aller.arrivee_le);
  e.push(etape('ambulance', aller ? { fait: tFait, debut: aller.cree_le, responsable: aller.organisation, confirme: aller.acceptee_le,
    attente: aller.unite ? `${aller.organisation} · ${aller.unite}` : aller.organisation, detail: aller.statut,
    delai: !aller.acceptee_le ? DELAIS.transport_accepte : !aller.en_route_le ? DELAIS.transport_en_route : null }
    : { responsable: co.origine, sansObjet: !!co.arrivee_le || ferme, detail: 'aucune_demande' }));
  // 3. Préparation hospitalière : préalerte prise en compte et préparation confirmée (ou demande acceptée, sans préalerte)
  e.push(etape('preparation', pa ? { fait: pa.preparation_le || pa.arrivee_confirmee_le || null, debut: pa.cree_le, responsable: hopital, confirme: pa.prise_en_compte_le,
    attente: hopital, detail: pa.statut, delai: DELAIS.preparation }
    : { fait: co.acceptee_le, debut: co.acceptee_le ? null : co.recue_hopital_le, responsable: hopital, detail: co.statut }));
  // 4. Arrivée et admission : arrivée confirmée, remise, orientation (admission ou urgence)
  e.push(etape('admission', { fait: co.orientation_le || null, debut: co.arrivee_le || pa?.arrivee_confirmee_le || (co.depart_le && !co.arrivee_le ? co.depart_le : null),
    responsable: hopital, confirme: pa?.remise_le || co.arrivee_le, attente: hopital, detail: co.orientation || null,
    delai: co.arrivee_le ? DELAIS.admission : DELAIS.arrivee }));
  // 5. Préparation du retour : retour proposé par l'hôpital, capacité confirmée par le CHSLD (acceptation, chambre prête)
  e.push(etape('retour', r ? { fait: r.chambre_verifiee_le || r.arrivee_le || null, debut: r.cree_le, responsable: co.origine, confirme: r.acceptee_le || (['acceptee', 'en_cours', 'recue'].includes(r.statut) ? r.modifie_le : null),
    attente: co.origine, detail: r.statut, delai: ['envoyee'].includes(r.statut) ? DELAIS.retour_accepte : DELAIS.retour_accepte * 2 }
    : { responsable: hopital, sansObjet: ferme && !r, detail: null }));
  // 6. Transport retour et clôture : départ, arrivée, réintégration confirmée par le CHSLD
  e.push(etape('cloture', r ? { fait: r.reintegree_le || (r.cloturee_le && ['recue'].includes(r.statut) ? r.cloturee_le : null), debut: r.depart_le || (r.chambre_verifiee_le ? r.chambre_verifiee_le : null),
    responsable: co.origine, confirme: r.arrivee_le, attente: r.arrivee_le ? co.origine : retourTr?.organisation || hopital, detail: retourTr ? retourTr.statut : r.statut,
    delai: r.arrivee_le ? DELAIS.reintegration : DELAIS.retour_depart }
    : { responsable: co.origine, sansObjet: ferme, detail: null }));
  // Cohérence : une étape suivie d'une étape faite est considérée faite (jamais « en cours » derrière une étape terminée)
  for (let i = e.length - 2; i >= 0; i--) {
    const apres = e.slice(i + 1).find((s) => s.etat === 'fait');
    if (apres && ['en_cours', 'a_venir'].includes(e[i].etat)) {
      if (e[i].code === 'ambulance' && !aller) Object.assign(e[i], { etat: 'sans_objet', depuis: null, bloquee: false, attente_min: null });
      else Object.assign(e[i], { etat: 'fait', fait_le: e[i].fait_le || apres.fait_le, depuis: null, bloquee: false, attente_min: null });
    }
  }
  // Étape courante : la première non faite (hors sans objet)
  const courante = e.find((s) => !['fait', 'sans_objet'].includes(s.etat)) || null;
  // Chronologie commune (événements de chaque organisation, sans identité)
  const chrono = [
    ...x.etapesCo.filter((s) => s.coordination_id === co.id || s.coordination_id === r?.id).map((s) => ({ date: s.date, source: s.coordination_id === co.id ? 'aller' : 'retour', code: s.statut, par: s.etablissement })),
    ...x.evTr.filter((v) => v.demande_id === aller?.id || v.demande_id === retourTr?.id).map((v) => ({ date: v.cree_le, source: 'transport', code: v.type, par: aller?.organisation })),
    ...x.evPa.filter((v) => v.prealerte_id === pa?.id).map((v) => ({ date: v.cree_le, source: 'prealerte', code: v.type, par: null })),
    ...(x.evCh || []).filter((v) => v.prealerte_id === pa?.id).map((v) => ({ date: v.heure, source: 'chrono', code: v.etape, par: null })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));
  return {
    id: co.id, numero: co.numero, resident_id: co.resident_id, resident_ref: co.resident_ref, origine_id: co.origine_id, origine: co.origine, hopital_id: pa?.destination_id || co.destination_id, hopital,
    unite: pa?.unite || aller?.unite || null, prealerte: pa?.numero || null, transport: aller?.numero || null, retour: r?.numero || null,
    clos: !!(r?.reintegree_le) || ferme, etapes: e, etape_courante: courante?.code || null, bloquee: e.some((s) => s.bloquee), chronologie: chrono,
  };
}

/** Parcours visibles par l'établissement : le CHSLD d'origine (ses résidents) et l'hôpital concerné. */
async function liste(pool, u, etabId, q = {}) {
  exigerEtablissement(u, etabId);
  if (u.role === 'entretien') throw new ErreurHttp(403, 'role_insuffisant');
  const e = (await pool.query('SELECT type_etablissement FROM etablissements WHERE id = $1', [etabId])).rows[0];
  if (!e) throw new ErreurHttp(404, 'etab_introuvable');
  const recents = q.tous ? '' : "AND (c.cloturee_le IS NULL OR c.cloturee_le > now() - interval '48 hours')";
  const p = await chargerParcours(pool, `(c.origine_id = $1 OR c.destination_id = $1 OR EXISTS (SELECT 1 FROM demandes_transport t JOIN prealertes pa ON pa.demande_transport_id = t.id
      WHERE t.coordination_id = c.id AND pa.destination_id = $1)) ${recents}`, [etabId]);
  // Noms : seulement pour le CHSLD d'origine (ses propres résidents, données fictives)
  if (e.type_etablissement !== 'hopital' && p.length) {
    const noms = new Map((await pool.query('SELECT id, prenom, nom FROM residents WHERE id = ANY($1) AND etablissement_id = $2', [p.map((x) => x.resident_id), etabId])).rows.map((r) => [r.id, r]));
    for (const x of p) { const r = noms.get(x.resident_id); if (r) { x.prenom = r.prenom; x.nom = r.nom; } }
  }
  for (const x of p) delete x.resident_id;
  const ouverts = p.filter((x) => !x.clos);
  return { parcours: p, resume: { ouverts: ouverts.length, bloques: ouverts.filter((x) => x.bloquee).length }, delais: DELAIS };
}

/** Synthèse pour OG et Arrimo Famille : étapes en attente, sans aucune décision. */
async function enAttente(pool, u, etabId) {
  const l = await liste(pool, u, etabId);
  return l.parcours.filter((x) => !x.clos && x.bloquee).map((x) => {
    const s = x.etapes.find((y) => y.bloquee);
    return { numero: x.numero, resident_ref: x.resident_ref, etape: s.code, attente: s.attente, minutes: s.attente_min };
  });
}

module.exports = { liste, enAttente, chargerParcours, DELAIS };
