'use strict';
/**
 * Liaison Établissements (cahier 3, 12 nov. 2026) : demandes de transport vers une entreprise ambulancière.
 * Parcours distinct des préalertes : un établissement (CHSLD, RPA, RI, RTF) ou un hôpital demande le transport d'un résident
 * pour une coordination existante (hospitalisation vers l'hôpital, retour vers l'établissement).
 * Règles :
 * - La destination, l'orientation et l'acceptation du résident restent des décisions de la coordination (src/chsld.js) ;
 *   le transport ne confirme ni le départ ni l'arrivée de la coordination : chaque établissement les confirme lui-même.
 * - L'ambulance ne voit que la référence du résident, les lieux, l'heure souhaitée et les informations de transport en listes
 *   fermées (accessibilité, accompagnateur, langue) : jamais le nom, le dossier ni une donnée clinique.
 * - Chaque étape est horodatée, versionnée et inscrite dans un historique immuable ; isolation par organisation et établissement.
 */
const { transaction, ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const { journaliser } = require('./regles');
const pa = require('./prealertes');
const accesVehicules = require('./acces-vehicules-secours');

// Un départ NSA confirmé peut appartenir au transport lié seulement si les lieux
// concordent et si son heure est compatible avec cette mission.
const DEPART_NSA_SQL = `CASE WHEN d.origine_id = dh.hopital_id AND d.destination_id = dh.etablissement_id
  AND d.resident_ref = COALESCE(NULLIF(dh.reference_externe, ''), dh.numero)
  AND d.statut IN ('acceptee', 'en_route', 'pris_en_charge', 'arrivee')
  AND dh.depart_hopital_le >= d.cree_le
  AND (d.arrivee_le IS NULL OR dh.depart_hopital_le <= d.arrivee_le)
  THEN dh.depart_hopital_le END`;

const OUVERTES = ['demandee', 'acceptee', 'en_route', 'pris_en_charge'];
const BROUILLON_PRIVE_SQL = `(d.statut = 'a_valider' OR EXISTS (
  SELECT 1 FROM demande_transport_evenements ev_brouillon WHERE ev_brouillon.demande_id = d.id AND ev_brouillon.type = 'retirer_brouillon'))`;
const ARCHIVE_SQL = `EXISTS (SELECT 1 FROM demande_transport_evenements ev_archive WHERE ev_archive.demande_id = d.id AND ev_archive.type = 'archiver')`;
const ROLES_ETAB = ['coordonnateur', 'admin_etab', 'gestionnaire', 'equipe_soins'];
const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const evenement = (c, d, type, u, detail = {}) => c.query('INSERT INTO demande_transport_evenements (demande_id, type, detail, utilisateur_id) VALUES ($1, $2, $3, $4)',
  [d.id, type, JSON.stringify(detail), u ? u.id : null]);

/** Entreprises ambulancières de la région d'un établissement (un CHSLD utilise le profil dérivé « <profil>-CHSLD »). */
async function organisationsRegion(db, etabId) {
  return (await db.query(`SELECT o.id, o.nom FROM organisations_secours o JOIN config_pays c ON c.id = o.config_id
    WHERE 'ambulance' = ANY(o.profils) AND o.actif AND (o.config_id = (SELECT config_id FROM etablissements WHERE id = $1)
      OR c.code = regexp_replace((SELECT c2.code FROM config_pays c2 JOIN etablissements e ON e.config_id = c2.id WHERE e.id = $1), '-CHSLD$', ''))
    ORDER BY o.nom`, [etabId])).rows;
}
/** Destinations proposées au formulaire : les établissements partenaires connectés (même configuration ou même région). */
async function destinations(pool, u, etabId) {
  const id = entier(etabId); if (!id) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, id);
  if (!ROLES_ETAB.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  return (await pool.query(`SELECT e.id, e.nom, e.ville, e.type_etablissement, e.type_local_code FROM etablissements e, etablissements moi
    WHERE moi.id = $1 AND e.id <> moi.id AND e.actif AND e.module_actif
      AND (e.region_id = moi.region_id OR e.config_id = moi.config_id OR e.profil_config_id = moi.config_id OR moi.profil_config_id = e.config_id)
    ORDER BY e.nom LIMIT 300`, [id])).rows;
}
/**
 * COR-001 (audit du 20 nov. 2026) : départ programmé d'un patient NSA vers une ressource → UNE demande de transport partagée, préremplie
 * (patient, origine, destination, horaire, véhicule, lit), au statut « à valider » : rien n'est transmis au transporteur avant qu'une personne
 * de l'hôpital la vérifie et la transmette. Aucune affectation d'ambulance n'est faite ici. Sans transporteur connecté : rien n'est créé,
 * l'étape le dit (cas négatif). Appelé dans la transaction de la confirmation de place.
 */
async function preparerDepuisHebergement(c, d, u) {
  if (!['ambulance', 'transport_adapte'].includes(d.transport_mode) || !d.depart_prevu_le || !d.hopital_id) return { statut: 'sans_objet' };
  const existe = (await c.query(`SELECT id, numero FROM demandes_transport WHERE demande_hebergement_id = $1 AND statut IN ('a_valider', 'demandee', 'acceptee', 'en_route', 'pris_en_charge')`, [d.id])).rows[0];
  if (existe) return { statut: 'existant', ...existe };
  const orgs = await organisationsRegion(c, d.hopital_id);
  if (!orgs.length) return { statut: 'aucun_transporteur' };
  const depart = new Date(d.depart_prevu_le);
  const lit = d.hopital_lit_id ? (await c.query("SELECT id FROM lits WHERE id = $1 AND etat = 'occupe'", [d.hopital_lit_id])).rows[0] : null;
  const ouvertLit = lit ? (await c.query(`SELECT 1 FROM demandes_transport WHERE lit_id = $1 AND statut IN ('a_valider', 'demandee', 'acceptee', 'en_route', 'pris_en_charge')`, [lit.id])).rowCount : 0;
  const r = (await c.query(`INSERT INTO demandes_transport (numero, organisation_id, origine_id, destination_id, resident_ref, heure_souhaitee, infos, motif_transport, type_vehicule,
      plage_debut, plage_fin, lit_id, statut, demande_hebergement_id, cree_par) VALUES ($1, $2, $3, $4, $5, $6, '{}', 'depart_nsa', $7, $8, $9, $10, 'a_valider', $11, $12) RETURNING *`,
  [await numero(c), orgs[0].id, d.hopital_id, d.etablissement_id, d.reference_externe || d.numero, depart, d.transport_mode, new Date(depart.getTime() - 30 * 60000), new Date(depart.getTime() + 30 * 60000),
    lit && !ouvertLit ? lit.id : null, d.id, u.id])).rows[0];
  await evenement(c, r, 'preparee', u, { demande_hebergement: d.numero });
  return { statut: 'prepare', id: r.id, numero: r.numero };
}

async function organisations(pool, u, etabId) {
  const id = entier(etabId); if (!id) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, id);
  if (!ROLES_ETAB.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  return organisationsRegion(pool, id);
}
/** Webhooks des clients concernés (établissements d'origine et de destination, entreprise) : référence du résident seulement. */
const emettre = (c, d, evenement, detail = {}) => require('./webhooks').emettre(c, { etablissements: [d.origine_id, d.destination_id], organisations: [d.organisation_id], evenement,
  charge: { numero: d.numero, statut: d.statut, resident_ref: d.resident_ref, heure_souhaitee: d.heure_souhaitee, ...detail } });
const numero = async (c) => `DT-${String((await c.query("SELECT nextval('transport_demande_seq') AS n")).rows[0].n).padStart(6, '0')}`;

/** L'établissement d'origine de la coordination demande le transport (avant le départ confirmé). */
async function demander(pool, u, coordinationId, b) {
  const co0 = (await pool.query('SELECT * FROM coordinations WHERE id = $1', [entier(coordinationId)])).rows[0];
  if (!co0 || !['hospitalisation', 'retour'].includes(co0.type)) throw new ErreurHttp(404, 'coordination_introuvable');
  exigerEtablissement(u, co0.origine_id);
  if (!ROLES_ETAB.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  // Module « Liaison Établissements » activé pour cet établissement (depuis SH)
  const origine = (await pool.query('SELECT type_etablissement, modules FROM etablissements WHERE id = $1', [co0.origine_id])).rows[0];
  if (!require('./types-etablissement').moduleActif(origine, 'transport_ambulancier')) throw new ErreurHttp(403, 'module_desactive', { module: 'transport_ambulancier' });
  const orgs = await organisationsRegion(pool, co0.origine_id);
  const org = orgs.find((o) => o.id === entier(b.organisation_id));
  if (!org) throw new ErreurHttp(404, 'organisation_introuvable');
  const cle = b.cle == null || b.cle === '' ? null : String(b.cle);
  if (cle && !/^[A-Za-z0-9_-]{8,64}$/.test(cle)) throw new ErreurHttp(400, 'cle_idempotence_invalide');
  const heure = b.heure_souhaitee ? new Date(b.heure_souhaitee) : null;
  if (heure && Number.isNaN(heure.getTime())) throw new ErreurHttp(400, 'date_invalide');
  // Type d'urgence et hôpital souhaité : information seulement (la destination reste décidée par l'équipage et les protocoles)
  const categorie = b.categorie == null || b.categorie === '' ? null : String(b.categorie);
  if (categorie && !pa.CATEGORIES.includes(categorie)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'categorie' });
  const prefere = b.hopital_prefere_id == null || b.hopital_prefere_id === '' ? null : entier(b.hopital_prefere_id);
  if (b.hopital_prefere_id != null && b.hopital_prefere_id !== '' && !prefere) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'hopital_prefere_id' });
  if (prefere && !(await require('./vehicules').urgencesProches(pool, u, co0.origine_id)).some((h) => h.id === prefere)) throw new ErreurHttp(404, 'hopital_introuvable');
  return transaction(pool, async (c) => {
    const co = (await c.query('SELECT * FROM coordinations WHERE id = $1 FOR UPDATE', [co0.id])).rows[0];
    if (cle) {
      const deja = (await c.query('SELECT * FROM demandes_transport WHERE origine_id = $1 AND cle_idempotence = $2', [co.origine_id, cle])).rows[0];
      if (deja) return { ...deja, rejoue: true };
    }
    // Avant le départ : la coordination est transmise ou acceptée (le transport ne remplace pas ces étapes).
    // Parcours planifiés (inter-CHSLD, vers l'hôpital, retour) : acceptation du receveur obligatoire avant tout transport
    // (refonte unifiée, §6.1 / §4.7) ; l'hospitalisation urgente n'est jamais retardée par cette règle.
    const ACCEPTATION_REQUISE = ['transfert_chsld', 'transfert_hopital', 'retour'];
    if (!(ACCEPTATION_REQUISE.includes(co.type) ? ['acceptee'] : ['envoyee', 'acceptee']).includes(co.statut)) {
      throw new ErreurHttp(409, ACCEPTATION_REQUISE.includes(co.type) && co.statut === 'envoyee' ? 'acceptation_requise' : 'coordination_statut_incompatible');
    }
    const ouverte = (await c.query('SELECT numero FROM demandes_transport WHERE coordination_id = $1 AND statut = ANY($2)', [co.id, OUVERTES])).rows[0];
    if (ouverte) throw new ErreurHttp(409, 'transport_deja_demande', { numero: ouverte.numero });
    const i = co.infos_operationnelles || {};
    const infos = { ...(i.accessibilite ? { accessibilite: i.accessibilite } : {}), ...(i.accompagnateur != null ? { accompagnateur: i.accompagnateur } : {}), ...(i.langue ? { langue: i.langue } : {}) };
    const d = (await c.query(`INSERT INTO demandes_transport (numero, coordination_id, organisation_id, origine_id, destination_id, resident_ref, heure_souhaitee, infos, cle_idempotence, cree_par)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [await numero(c), co.id, org.id, co.origine_id, co.destination_id, co.resident_ref, heure || co.retour_prevu_le || null, JSON.stringify(infos), cle, u.id])).rows[0];
    if (categorie || prefere) await c.query('INSERT INTO demande_transport_preferences (demande_id, categorie, hopital_prefere_id) VALUES ($1, $2, $3)', [d.id, categorie, prefere]);
    await evenement(c, d, 'demandee', u, { organisation: org.nom, ...(categorie ? { categorie } : {}), ...(prefere ? { hopital_prefere: prefere } : {}) });
    await journaliser(c, { etablissementId: co.origine_id, utilisateurId: u.id, action: 'Transport demandé', detail: `${d.numero} · ${co.numero} · ${org.nom}` });
    // L'établissement de destination est averti qu'un transport est demandé pour cette coordination
    await require('./services').notifier(c, co.destination_id, null, 'transport_demande', { numero: d.numero, coordination: co.numero, ref: co.resident_ref, org: org.nom });
    await emettre(c, d, 'transport.demandee');
    require('./flux').signaler();
    return d;
  });
}

/** Durées entre faits constatés. Un intervalle incomplet ou inversé reste inconnu. */
function dureesPlanifiees(d) {
  const minutes = (debut, fin) => {
    if (!debut || !fin) return null;
    const delai = new Date(fin).getTime() - new Date(debut).getTime();
    return Number.isFinite(delai) && delai >= 0 ? Math.round(delai / 6000) / 10 : null;
  };
  return {
    reponse: minutes(d.demande_transmise_le, d.acceptee_le),
    mobilisation: minutes(d.acceptee_le, d.en_route_le),
    vers_prise_en_charge: minutes(d.en_route_le, d.sur_place_le),
    attente_prise_en_charge: minutes(d.sur_place_le, d.pris_en_charge_le),
    trajet_patient: minutes(d.depart_reel, d.arrivee_le),
    attente_remise: minutes(d.arrivee_le, d.remis_le),
    remise_en_condition: minutes(d.remis_le, d.terminee_le),
    engagement: minutes(d.en_route_le, d.terminee_le),
  };
}

const CHAMPS = `d.*, COALESCE(h_depart.heure, ${DEPART_NSA_SQL}) AS depart_reel, h_demande.heure AS demande_transmise_le, o.nom AS organisation, un.numero AS unite, un.plaque, eo.nom AS origine, eo.adresse AS origine_adresse, eo.ville AS origine_ville,
  COALESCE(ed.nom, d.destination_libelle) AS destination, ed.ville AS destination_ville, ed.type_etablissement AS destination_type, l.code AS lit_code, co.numero AS coordination, co.type AS coordination_type, co.statut AS coordination_statut,
  pref.categorie AS categorie_urgence, pref.hopital_prefere_id, hp.nom AS hopital_prefere, ev.etat AS etat_vehicule, ev.modifie_le AS etat_vehicule_le,
  (SELECT json_build_object('numero', p.numero, 'statut', p.statut, 'destination_id', p.destination_id, 'destination', e2.nom, 'heure_prevue', p.heure_prevue,
     'arrivee_confirmee_le', p.arrivee_confirmee_le, 'eta_minutes', (SELECT ea.minutes FROM eta_prealertes ea WHERE ea.prealerte_id = p.id),
     'eta_km', (SELECT ea.distance_km::float FROM eta_prealertes ea WHERE ea.prealerte_id = p.id)) FROM prealertes p JOIN etablissements e2 ON e2.id = p.destination_id
   WHERE p.demande_transport_id = d.id AND p.statut <> 'remplacee' ORDER BY p.id DESC LIMIT 1) AS prealerte`;
const FROM = `FROM demandes_transport d JOIN organisations_secours o ON o.id = d.organisation_id LEFT JOIN unites_secours un ON un.id = d.unite_id
  JOIN etablissements eo ON eo.id = d.origine_id LEFT JOIN etablissements ed ON ed.id = d.destination_id LEFT JOIN coordinations co ON co.id = d.coordination_id
  LEFT JOIN lits l ON l.id = d.lit_id
  LEFT JOIN demande_transport_preferences pref ON pref.demande_id = d.id LEFT JOIN etablissements hp ON hp.id = pref.hopital_prefere_id
  LEFT JOIN etats_vehicules ev ON ev.unite_id = d.unite_id
  LEFT JOIN demandes_hebergement dh ON dh.id = d.demande_hebergement_id
  LEFT JOIN v_horodatages_courants h_depart ON h_depart.objet = 'demande_transport' AND h_depart.objet_id = d.id AND h_depart.etape = 'depart'
  LEFT JOIN v_horodatages_courants h_demande ON h_demande.objet = 'demande_transport' AND h_demande.objet_id = d.id AND h_demande.etape = 'demande'`;

/**
 * Transport non urgent (cahier v2, C.4 ; 20 nov. 2026) : un hôpital ou une résidence réserve un transport SANS coordination CHSLD
 * (retour à domicile, transfert stable, départ NSA, retour CHSLD) : date et plage, type de véhicule, accessibilité, accompagnateur ;
 * lit « à libérer » lié. Réservation la veille recommandée (avertissement). Le transporteur ne voit que la référence et les lieux.
 */
const MOTIFS_TRANSPORT = ['retour_domicile', 'transfert_stable', 'depart_nsa', 'retour_chsld'];
const TYPES_VEHICULE = ['ambulance', 'transport_adapte', 'autre'];
// Mêmes listes fermées que les demandes de transport d'une coordination (lues par l'écran de l'ambulance)
const ACCESSIBILITE = ['fauteuil', 'deambulateur', 'leve_personne', 'lit_electrique', 'malentendant', 'malvoyant'];
async function planifier(pool, u, b) {
  const origine = entier(b.etablissement_id); if (!origine) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
  exigerEtablissement(u, origine);
  if (!ROLES_ETAB.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const e = (await pool.query('SELECT id, modules, type_etablissement FROM etablissements WHERE id = $1 AND actif', [origine])).rows[0];
  if (!e || !require('./types-etablissement').moduleActif(e, 'transport_planifie')) throw new ErreurHttp(403, 'module_desactive', { module: 'transport_planifie' });
  if (!MOTIFS_TRANSPORT.includes(b.motif_transport)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'motif_transport' });
  if (!TYPES_VEHICULE.includes(b.type_vehicule)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'type_vehicule' });
  const debut = new Date(b.plage_debut); const fin = new Date(b.plage_fin);
  if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime()) || fin <= debut || debut < Date.now() - 5 * 60000 || fin - debut > 12 * 3600000) throw new ErreurHttp(400, 'plage_invalide');
  const acc = Array.isArray(b.infos?.accessibilite) ? [...new Set(b.infos.accessibilite)] : [];
  if (acc.some((x) => !ACCESSIBILITE.includes(x))) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'accessibilite' });
  const infos = { ...(acc.length ? { accessibilite: acc } : {}), ...(b.infos?.accompagnateur != null ? { accompagnateur: b.infos.accompagnateur === true } : {}) };
  const orgs = await organisationsRegion(pool, origine);
  if (!orgs.some((o) => o.id === entier(b.organisation_id))) throw new ErreurHttp(404, 'organisation_introuvable');
  const destId = b.destination_id ? entier(b.destination_id) : null;
  const libelle = destId ? null : String(b.destination_libelle || '').trim();
  if (!destId && (libelle.length < 2 || libelle.length > 120)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'destination' });
  if (destId && !(await pool.query('SELECT 1 FROM etablissements WHERE id = $1 AND actif', [destId])).rowCount) throw new ErreurHttp(404, 'etab_introuvable');
  let litId = null; let ref = null;
  if (b.lit_id != null) {
    const l = (await pool.query("SELECT id, patient_ref, etat FROM lits WHERE id = $1 AND etablissement_id = $2", [entier(b.lit_id), origine])).rows[0];
    if (!l || l.etat !== 'occupe') throw new ErreurHttp(409, 'lit_non_occupe', { code: '' });
    litId = l.id; ref = l.patient_ref;
    const ouvert = (await pool.query(`SELECT numero FROM demandes_transport WHERE lit_id = $1 AND statut = ANY($2)`, [litId, ['a_valider', ...OUVERTES]])).rows[0];
    if (ouvert) throw new ErreurHttp(409, 'transport_deja_demande', { numero: ouvert.numero });
  } else {
    ref = String(b.reference || '').trim();
    if (!/^[A-Z]{1,3}-\d{4,6}$/.test(ref)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'reference' });
  }
  const d = await transaction(pool, async (c) => {
    const r = (await c.query(`INSERT INTO demandes_transport (numero, organisation_id, origine_id, destination_id, destination_libelle, resident_ref, heure_souhaitee, infos,
        motif_transport, type_vehicule, plage_debut, plage_fin, lit_id, cree_par, statut) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $7, $11, $12, $13, $14) RETURNING *`,
    [await numero(c), entier(b.organisation_id), origine, destId, libelle, ref, debut, JSON.stringify(infos), b.motif_transport, b.type_vehicule, fin, litId, u.id,
      b.brouillon === true ? 'a_valider' : 'demandee'])).rows[0];
    await evenement(c, r, r.statut === 'a_valider' ? 'preparee' : 'demandee', u, { motif_transport: r.motif_transport, type_vehicule: r.type_vehicule });
    if (r.statut === 'a_valider') return r;
    await require('./horloge').marquer(c, { objet: 'demande_transport', objetId: r.id, etape: 'demande', source: 'clic', auteurId: u.id });
    await emettre(c, r, 'transport.demandee');
    await journaliser(c, { etablissementId: origine, utilisateurId: u.id, action: 'Transport réservé', detail: `${r.numero} · ${r.motif_transport}` });
    return r;
  }).catch((e) => {
    if (e.code === '23505' && e.constraint === 'demandes_transport_lit_ouvert') throw new ErreurHttp(409, 'transport_deja_demande', { numero: '' });
    throw e;
  });
  require('./flux').signaler();
  // Réservation la veille recommandée : simple avertissement, jamais un refus
  return { ...d, avertissement: debut - Date.now() < 18 * 3600000 ? 'reservation_tardive' : null };
}

/** Demandes de transport visibles : ambulance (son organisation), établissement (origine ou destination), CCS (sa région, lecture). */
async function liste(pool, u, q = {}, ficheId = null) {
  let filtre; let args;
  if (pa.ROLES_AMBULANCE.includes(u.role) || pa.ROLES_CCS.includes(u.role)) {
    const orgs = (await pool.query(`SELECT o.id, o.profils, o.config_id FROM utilisateur_organisations uo JOIN organisations_secours o ON o.id = uo.organisation_id
      WHERE uo.utilisateur_id = $1 AND o.actif`, [u.id])).rows;
    if (pa.ROLES_AMBULANCE.includes(u.role)) { const ids = orgs.filter((o) => o.profils.includes('ambulance')).map((o) => o.id); if (!ids.length) throw new ErreurHttp(403, 'organisation_interdite'); filtre = 'd.organisation_id = ANY($1)'; args = [ids]; }
    else { const cfg = orgs.filter((o) => o.profils.includes('ccs')).map((o) => o.config_id); if (!cfg.length) throw new ErreurHttp(403, 'organisation_interdite'); filtre = 'o.config_id = ANY($1)'; args = [cfg]; }
  } else {
    const id = entier(q.etablissement_id); if (!id) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etablissement_id' });
    exigerEtablissement(u, id);
    if (!ROLES_ETAB.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
    filtre = '(d.origine_id = $1 OR d.destination_id = $1)'; args = [id];
  }
  const attendCloture = `(d.statut = 'arrivee' AND d.motif_transport IS NOT NULL AND d.terminee_le IS NULL
    AND ev.etat = 'a_l_hopital' AND ev.source = 'transport' AND ev.modifie_le = d.arrivee_le)`;
  const cote = pa.ROLES_AMBULANCE.includes(u.role) ? 'ambulance' : pa.ROLES_CCS.includes(u.role) ? 'ccs' : 'etablissement';
  const droitsBrouillon = cote === 'etablissement' ? `(NOT ${BROUILLON_PRIVE_SQL} OR d.origine_id = $1)` : `NOT ${BROUILLON_PRIVE_SQL}`;
  const historique = q.historique === '1';
  const parametres = [...args, ['a_valider', ...OUVERTES], ficheId, historique];
  const droitsVehicule = accesVehicules.concerne(u)
    ? ` AND ${accesVehicules.condition('o', 'd.unite_id', parametres.push(u.id))}` : '';
  const rows = (await pool.query(`SELECT ${CHAMPS}, COALESCE(${attendCloture}, false) AS attend_cloture, ${ARCHIVE_SQL} AS archivee,
      EXISTS (SELECT 1 FROM demande_transport_evenements ev WHERE ev.demande_id = d.id AND ev.type = 'retirer_brouillon') AS brouillon_retire
    ${FROM} WHERE ${filtre} AND ${droitsBrouillon}${droitsVehicule}
      AND ($3::int IS NULL OR d.id = $3)
      AND ($3::int IS NOT NULL OR ($4 AND d.statut IN ('arrivee', 'refusee', 'annulee'))
        OR (NOT $4 AND NOT ${ARCHIVE_SQL} AND (d.statut = ANY($2) OR d.modifie_le > now() - interval '24 hours' OR ${attendCloture})))
    ORDER BY (d.statut = ANY($2)) DESC, CASE WHEN $4 THEN d.modifie_le END DESC, d.heure_souhaitee NULLS LAST, d.id
    LIMIT CASE WHEN $4 AND $3 IS NULL THEN 100 END`, parametres)).rows
    .filter((d) => !d.brouillon_retire || ficheId != null);
  // L'état du véhicule n'est montré que pendant ce transport (ou la préalerte qui le prolonge) : jamais une autre mission
  const enCours = (d) => OUVERTES.includes(d.statut) || d.attend_cloture || (d.prealerte && pa.OUVERTES.includes(d.prealerte.statut));
  return rows.map((d) => ({ ...d, ...(enCours(d) ? {} : { etat_vehicule: null, etat_vehicule_le: null }),
    ...(d.motif_transport ? { durees_planifiees: dureesPlanifiees(d) } : {}), actions: actions(d, u, cote, q.etablissement_id) }));
}
/**
 * Préalerte d'arrivée → préparation de la chambre attribuée (si une place est réservée pour ce résident à la destination) :
 * crée la tâche de préparation pour l'entretien, une seule fois (jamais de doublon), avec l'échéance de l'arrivée prévue.
 */
async function preparerChambre(c, d, u, eta) {
  const dh = d.demande_hebergement_id ? (await c.query('SELECT resident_id, lit_propose_id FROM demandes_hebergement WHERE id = $1', [d.demande_hebergement_id])).rows[0] : null;
  const r = dh?.resident_id ? (await c.query('SELECT id, reference, lit_id FROM residents WHERE id = $1', [dh.resident_id])).rows[0]
    : (await c.query('SELECT id, reference, lit_id FROM residents WHERE etablissement_id = $1 AND reference = $2', [d.destination_id, d.resident_ref])).rows[0];
  const litId = r?.lit_id || dh?.lit_propose_id; if (!litId) return null;
  const ouverte = (await c.query(`SELECT id FROM taches_etab WHERE lit_id = $1 AND type IN ('preparation_chambre', 'entretien') AND statut IN ('a_faire', 'en_cours')`, [litId])).rows[0];
  if (ouverte) return ouverte;   // déjà prévue : pas de doublon
  const l = (await c.query('SELECT code, entretien_statut FROM lits WHERE id = $1', [litId])).rows[0];
  if (l.entretien_statut === 'propre') return null;   // chambre déjà déclarée prête par l'entretien
  const echeance = new Date(Date.now() + (eta == null ? 60 : eta) * 60000);
  return require('./chsld').tache(c, d.destination_id, u, { type: 'preparation_chambre', titre: `Préparer ${l.code} pour l’arrivée de ${r?.reference || d.resident_ref} (préalerte ${d.numero})`, lit_id: litId, resident_id: r?.id || null, assigne_role: 'entretien', echeance });
}
function transportClos(d) {
  return ['refusee', 'annulee'].includes(d.statut) || (d.statut === 'arrivee' && (!d.motif_transport || !!d.terminee_le));
}

function actions(d, u, cote, etabId) {
  if (d.statut === 'a_valider') return cote === 'etablissement' && Number(etabId) === d.origine_id ? ['transmettre', 'annuler'] : [];
  if (d.archivee || d.brouillon_retire) return [];
  if (cote === 'etablissement' && Number(etabId) === d.origine_id && transportClos(d)) return ['archiver'];
  if (!OUVERTES.includes(d.statut) && !(cote === 'ambulance' && d.statut === 'arrivee')) return [];
  if (cote === 'ambulance') {
    if (d.statut === 'arrivee') return [...(!d.remis_le ? ['remis'] : []), ...(d.remis_le && !d.terminee_le ? ['terminer'] : []), ...(!d.terminee_le ? ['incident'] : [])];
    const base = d.statut === 'demandee' ? ['accepter', 'refuser'] : d.statut === 'acceptee' ? ['en_route', 'incident'] : d.statut === 'en_route' ? [...(!d.sur_place_le ? ['sur_place'] : []), 'pris_en_charge', 'incident'] : ['arrivee', 'incident'];
    if (d.statut === 'acceptee' && d.motif_transport && u.role === 'superviseur_secours') base.push('affecter', 'replanifier');
    if (d.statut === 'pris_en_charge' && d.motif_transport && !d.depart_reel) base.unshift('partir_destination');
    return ['en_route', 'pris_en_charge'].includes(d.statut) && d.destination_id && d.destination_type && d.destination_type !== 'hopital' ? [...base, 'prealerter'] : base;
  }
  if (cote === 'etablissement' && Number(etabId) === d.destination_id && d.prealerte_le && !d.prealerte_recue_le) return ['accuser_prealerte'];
  if (cote === 'etablissement' && Number(etabId) === d.origine_id && ['demandee', 'acceptee', 'en_route'].includes(d.statut)) return ['annuler'];
  return [];
}
const MOTIFS = ['aucune_unite', 'hors_territoire', 'autre'];
// Libellés du journal (traduits par l'interface : journal_actions)
const ACTIONS_JOURNAL = { transmettre: 'Transport transmis au transporteur', accepter: 'Transport accepté', refuser: 'Transport refusé', en_route: 'Ambulance en route', pris_en_charge: 'Résident pris en charge', arrivee: 'Transport arrivé', annuler: 'Transport annulé' };
/** Sérialise les affectations d'un même véhicule et vérifie la plage avant de l'enregistrer. */
async function verifierAffectation(c, d, uniteId, debut, fin, { depart = false } = {}) {
  const unite = (await c.query(`SELECT id, numero, type_vehicule FROM unites_secours
    WHERE id = $1 AND organisation_id = $2 AND actif FOR NO KEY UPDATE`, [entier(uniteId), d.organisation_id])).rows[0];
  if (!unite) throw new ErreurHttp(404, 'unite_introuvable');
  if (!d.motif_transport) return unite;
  if (d.type_vehicule && d.type_vehicule !== unite.type_vehicule) throw new ErreurHttp(409, 'transport_vehicule_incompatible');
  if ((await c.query("SELECT 1 FROM etats_vehicules WHERE unite_id = $1 AND etat = 'hors_service'", [unite.id])).rowCount) {
    throw new ErreurHttp(409, 'transport_vehicule_incompatible');
  }
  if (depart && await require('./vehicules').missionActive(c, unite.id)) throw new ErreurHttp(409, 'transport_vehicule_reserve');
  const conflit = await c.query(`SELECT 1 FROM demandes_transport t
    WHERE t.unite_id = $1 AND t.id <> $2 AND t.statut IN ('acceptee', 'en_route', 'pris_en_charge')
      AND COALESCE(t.plage_confirmee_debut, t.plage_debut) < $4::timestamptz
      AND COALESCE(t.plage_confirmee_fin, t.plage_fin) > $3::timestamptz
    LIMIT 1`, [unite.id, d.id, debut || null, fin || null]);
  if (conflit.rowCount) throw new ErreurHttp(409, 'transport_vehicule_reserve');
  return unite;
}

/** Étapes du transport : l'ambulance accepte (unité), part, prend en charge, arrive ; l'établissement d'origine peut annuler avant la prise en charge. */
async function agir(pool, u, id, b) {
  const d0 = (await pool.query(`SELECT d.*, ${BROUILLON_PRIVE_SQL} AS brouillon_prive FROM demandes_transport d WHERE d.id = $1`, [entier(id)])).rows[0];
  if (!d0) throw new ErreurHttp(404, 'transport_introuvable');
  let cote;
  if (pa.ROLES_AMBULANCE.includes(u.role)) {
    if (d0.brouillon_prive) throw new ErreurHttp(404, 'transport_introuvable');
    const ok = (await pool.query(`SELECT 1 FROM utilisateur_organisations uo JOIN organisations_secours o ON o.id = uo.organisation_id WHERE uo.utilisateur_id = $1 AND o.id = $2 AND o.actif AND 'ambulance' = ANY(o.profils)`, [u.id, d0.organisation_id])).rowCount;
    if (!ok) throw new ErreurHttp(404, 'transport_introuvable');
    cote = 'ambulance';
  } else if (ROLES_ETAB.includes(u.role) && Number(b.etablissement_id) === d0.origine_id) { exigerEtablissement(u, d0.origine_id); cote = 'etablissement'; }
  else if (ROLES_ETAB.includes(u.role) && b.action === 'accuser_prealerte' && !d0.brouillon_prive && Number(b.etablissement_id) === d0.destination_id) { exigerEtablissement(u, d0.destination_id); cote = 'destination'; }
  else throw new ErreurHttp(403, 'role_insuffisant');
  const a = String(b.action || '');
  return transaction(pool, async (c) => {
    const d = (await c.query('SELECT * FROM demandes_transport WHERE id = $1 FOR UPDATE', [d0.id])).rows[0];
    if (cote === 'ambulance') {
      if (!d || d.organisation_id !== d0.organisation_id || !(await accesVehicules.autorise(c, u, d.organisation_id, d.unite_id))) {
        throw new ErreurHttp(404, 'transport_introuvable');
      }
      if (d.unite_id == null && ['accepter', 'en_route'].includes(a) && b.unite_id != null
        && !(await accesVehicules.autorise(c, u, d.organisation_id, entier(b.unite_id)))) throw new ErreurHttp(404, 'unite_introuvable');
    }
    if (cote === 'etablissement' && ['archiver', 'retirer_brouillon', 'annuler'].includes(a)) {
      const retirer = d.statut === 'a_valider' && ['retirer_brouillon', 'annuler'].includes(a);
      if (retirer || a === 'archiver') {
        if (b.version != null && Number(b.version) !== d.version) throw new ErreurHttp(409, 'version_perimee');
        if (!retirer && !transportClos(d)) throw new ErreurHttp(409, 'transport_statut_incompatible');
        const precedent = (await c.query(`SELECT type FROM demande_transport_evenements
          WHERE demande_id = $1 AND type IN ('archiver', 'retirer_brouillon') LIMIT 1`, [d.id])).rows[0];
        if (precedent) return { ...d, deja: true };
        const n = (await c.query(`UPDATE demandes_transport SET statut = $2, version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`,
          [d.id, retirer ? 'annulee' : d.statut])).rows[0];
        await evenement(c, n, retirer ? 'retirer_brouillon' : 'archiver', u);
        require('./flux').signaler();
        return n;
      }
    }
    if (transportClos(d) && (await c.query(`SELECT 1 FROM demande_transport_evenements
      WHERE demande_id = $1 AND type = 'archiver'`, [d.id])).rowCount) throw new ErreurHttp(409, 'transport_clos');
    const apresArrivee = cote === 'ambulance' && d.statut === 'arrivee' && ['remis', 'terminer', 'incident'].includes(a);
    if (!OUVERTES.includes(d.statut) && !(d.statut === 'a_valider' && cote === 'etablissement') && !apresArrivee) throw new ErreurHttp(409, 'transport_clos');
    if (b.version != null && Number(b.version) !== d.version) throw new ErreurHttp(409, 'version_perimee');
    const maj = async (sql, vals = []) => (await c.query(`UPDATE demandes_transport SET ${sql}, version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`, [d.id, ...vals])).rows[0];
    const attendu = { accepter: 'demandee', refuser: 'demandee', en_route: 'acceptee', pris_en_charge: 'en_route', arrivee: 'pris_en_charge' };
    let n; let detail = {};
    if (cote === 'destination') {
      // Préalerte d'arrivée acquittée par la destination (accusé de réception humain, historisé)
      if (!d.prealerte_le) throw new ErreurHttp(409, 'transport_statut_incompatible');
      if (d.prealerte_recue_le) return { ...d, deja: true };
      n = await maj('prealerte_recue_le = now(), prealerte_recue_par = $2', [u.id]);
      await evenement(c, n, 'prealerte_recue', u, {});
      return n;
    }
    if (cote === 'ambulance' && a === 'prealerter') {
      // Préalerte d'arrivée vers un milieu d'hébergement (CHSLD, RPA…) : information de l'équipage, PAS une preuve de prise en charge ;
      // l'état du véhicule et celui du transport ne changent pas ; la chambre n'est jamais déclarée prête ici.
      if (!['en_route', 'pris_en_charge'].includes(d.statut) || !d.destination_id) throw new ErreurHttp(409, 'transport_statut_incompatible');
      const eta = b.eta_min == null || b.eta_min === '' ? null : Number(b.eta_min);
      if (eta != null && !(Number.isInteger(eta) && eta >= 0 && eta <= 600)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'eta_min' });
      const premiere = !d.prealerte_le;
      n = await maj('prealerte_le = COALESCE(prealerte_le, now()), prealerte_eta_min = $2, prealerte_eta_le = now()', [eta]);
      await evenement(c, n, premiere ? 'prealerte' : 'prealerte_maj', u, { eta_min: eta });
      if (premiere) {
        const orig = (await c.query('SELECT nom FROM etablissements WHERE id = $1', [d.origine_id])).rows[0]?.nom || '';
        await require('./services').notifier(c, d.destination_id, null, 'transport_prealerte', { numero: d.numero, origine: orig, eta: eta == null ? '—' : String(eta) });
        await preparerChambre(c, n, u, eta);
      }
      return n;
    }
    if (cote === 'ambulance' && a === 'partir_destination') {
      if (d.statut !== 'pris_en_charge' || !d.motif_transport) throw new ErreurHttp(409, 'transport_statut_incompatible');
      const deja = (await c.query(`SELECT ${DEPART_NSA_SQL} AS depart FROM demandes_transport d
        LEFT JOIN demandes_hebergement dh ON dh.id = d.demande_hebergement_id WHERE d.id = $1`, [d.id])).rows[0]?.depart;
      if (deja) return { ...d, depart_reel: deja, deja: true };
      const h = await require('./horloge').marquer(c, { objet: 'demande_transport', objetId: d.id, etape: 'depart', auteurId: u.id || null });
      if (h.deja) return { ...d, depart_reel: h.heure, deja: true };
      n = await maj('statut = statut');
      await evenement(c, n, a, u);
      await emettre(c, n, 'transport.depart', { depart_reel: h.heure });
      require('./flux').signaler();
      return { ...n, depart_reel: h.heure };
    }
    if (cote === 'ambulance' && a === 'replanifier') {
      if (u.role !== 'superviseur_secours') throw new ErreurHttp(403, 'role_insuffisant');
      if (d.statut !== 'acceptee' || !d.motif_transport) throw new ErreurHttp(409, 'transport_statut_incompatible');
      const debut = new Date(String(b.plage_confirmee_debut || ''));
      const fin = new Date(String(b.plage_confirmee_fin || ''));
      if (!Number.isFinite(debut.getTime()) || !Number.isFinite(fin.getTime()) || fin <= debut) {
        throw new ErreurHttp(400, 'plage_invalide');
      }
      if (debut.getTime() === d.plage_confirmee_debut?.getTime() && fin.getTime() === d.plage_confirmee_fin?.getTime()) return d;
      if (d.unite_id) await verifierAffectation(c, d, d.unite_id, debut, fin);
      n = await maj('plage_confirmee_debut = $2, plage_confirmee_fin = $3', [debut, fin]);
      if (n.lit_id) await require('./terrain').majConge(pool, u, n.lit_id, 'attente_transport', debut, c);
      await evenement(c, n, a, u, { debut, fin, debut_avant: d.plage_confirmee_debut, fin_avant: d.plage_confirmee_fin });
      await emettre(c, n, 'transport.replanifier', { plage_confirmee_debut: debut, plage_confirmee_fin: fin });
      require('./flux').signaler();
      return n;
    }
    if (cote === 'ambulance' && a === 'affecter') {
      if (u.role !== 'superviseur_secours') throw new ErreurHttp(403, 'role_insuffisant');
      if (d.statut !== 'acceptee' || !d.motif_transport) throw new ErreurHttp(409, 'transport_statut_incompatible');
      const unite = await verifierAffectation(c, d, b.unite_id, d.plage_confirmee_debut || d.plage_debut, d.plage_confirmee_fin || d.plage_fin);
      if (unite.id === d.unite_id) return d;
      n = await maj('unite_id = $2', [unite.id]);
      await evenement(c, n, 'affecter', u, { unite: unite.numero, unite_id_avant: d.unite_id });
      await emettre(c, n, 'transport.affecter');
      require('./flux').signaler();
      return n;
    }
    if (cote === 'ambulance' && ['sur_place', 'remis', 'terminer', 'incident'].includes(a)) {
      // Étapes physiques déclarées par l'équipage (cahier ultime, 11.3 et 11.5) : chacune horodatée, sans changer le statut principal
      if (a === 'sur_place') {
        if (d.statut !== 'en_route' || d.sur_place_le) throw new ErreurHttp(409, 'transport_statut_incompatible');
        n = await maj('sur_place_le = now()');
        if (n.unite_id) await require('./vehicules').fixer(c, n.unite_id, 'sur_place', { source: 'transport', utilisateurId: u.id || null });
      } else if (a === 'remis') {
        if (d.statut !== 'arrivee' || d.remis_le) throw new ErreurHttp(409, 'transport_statut_incompatible');
        n = await maj('remis_le = now()');
      } else if (a === 'terminer') {
        if (d.statut !== 'arrivee' || !d.remis_le || d.terminee_le) throw new ErreurHttp(409, 'transport_statut_incompatible');
        n = await maj('terminee_le = now()');
        if (n.motif_transport && n.unite_id) {
          const courant = (await c.query('SELECT etat, source, modifie_le FROM etats_vehicules WHERE unite_id = $1 FOR UPDATE', [n.unite_id])).rows[0];
          const autreMission = await c.query(`SELECT 1 FROM prealertes WHERE unite_id = $1 AND statut NOT IN ('cloturee', 'annulee', 'remplacee')
            UNION ALL SELECT 1 FROM demandes_transport WHERE unite_id = $1 AND id <> $2 AND statut IN ('en_route', 'pris_en_charge')
            UNION ALL SELECT 1 FROM missions_ccs WHERE unite_id = $1 AND statut IN ('acceptee', 'sur_place')`, [n.unite_id, n.id]);
          if (courant?.etat === 'a_l_hopital' && courant.source === 'transport'
            && new Date(courant.modifie_le).getTime() === new Date(n.arrivee_le).getTime() && !autreMission.rowCount) {
            await require('./vehicules').fixer(c, n.unite_id, 'disponible', { source: 'transport_termine', utilisateurId: u.id || null });
          }
        }
      } else {
        const motif = String(b.motif || '').trim(); if (motif.length < 3 || motif.length > 300) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'motif' });
        n = await maj('incident_le = now(), incident_motif = $2', [motif]);
        for (const e of [d.origine_id, d.destination_id].filter(Boolean)) await require('./services').notifier(c, e, null, 'transport_incident', { numero: d.numero });
      }
      await evenement(c, n, a, u, a === 'incident' ? { motif: n.incident_motif } : {});
      await emettre(c, n, `transport.${a}`);
      return n;
    }
    if (cote === 'ambulance') {
      if (!attendu[a]) throw new ErreurHttp(400, 'action_inconnue');
      if (d.statut !== attendu[a]) throw new ErreurHttp(409, 'transport_statut_incompatible');
      if (a === 'accepter') {
        // Transport planifié (20 nov. 2026) : plage confirmée par le transporteur (la plage demandée par défaut)
        const pd = b.plage_confirmee_debut ? new Date(b.plage_confirmee_debut) : d.plage_debut; const pf = b.plage_confirmee_fin ? new Date(b.plage_confirmee_fin) : d.plage_fin;
        if ((pd && Number.isNaN(new Date(pd).getTime())) || (pf && Number.isNaN(new Date(pf).getTime())) || (pd && pf && new Date(pf) <= new Date(pd))) throw new ErreurHttp(400, 'plage_invalide');
        const un = b.unite_id == null && !d.coordination_id ? null : await verifierAffectation(c, d, b.unite_id, pd, pf);
        n = await maj("statut = 'acceptee', unite_id = COALESCE($2, unite_id), acceptee_le = now(), plage_confirmee_debut = $3, plage_confirmee_fin = $4", [un?.id || null, pd || null, pf || null]);
        detail = { unite: un?.numero || null, plage_debut: pd, plage_fin: pf };
        // Lit « à libérer » : congé en attente de transport, à l'heure confirmée (mêmes règles que l'écran Lits)
        if (n.lit_id) await require('./terrain').majConge(pool, { id: u.id || null }, n.lit_id, 'attente_transport', pd || undefined, c);
      } else if (a === 'refuser') {
        const motif = MOTIFS.includes(b.motif) ? b.motif : 'autre';
        n = await maj("statut = 'refusee', motif_refus = $2", [motif]); detail = { motif };
      } else {
        if (a === 'en_route' && (d.motif_transport || !d.unite_id)) {
          const un = await verifierAffectation(c, d, d.unite_id || b.unite_id,
            d.plage_confirmee_debut || d.plage_debut, d.plage_confirmee_fin || d.plage_fin, { depart: true });
          if (!d.unite_id) await c.query('UPDATE demandes_transport SET unite_id = $2 WHERE id = $1', [d.id, un.id]);
        }
        n = await maj(`statut = '${a}', ${a}_le = now()`);
        // Prise en charge d'un patient hospitalisé : le patient quitte son lit, qui part au nettoyage (règles des lits)
        if (a === 'pris_en_charge' && n.lit_id) {
          const lit = (await c.query('SELECT etat FROM lits WHERE id = $1', [n.lit_id])).rows[0];
          if (lit?.etat === 'occupe') await require('./regles').changerEtat(c, pool, u.id || null, n.lit_id, 'nettoyage', { detail: `Départ en transport ${n.numero}` });
        }
      }
      const etapeH = { accepter: 'decision', refuser: 'decision', pris_en_charge: 'prise_en_charge', arrivee: 'arrivee' }[a];
      if (etapeH) await require('./horloge').marquer(c, { objet: 'demande_transport', objetId: n.id, etape: etapeH, source: u.connecteur ? 'connecteur' : 'clic', auteurId: u.id || null });
      // État du véhicule suivi automatiquement à chaque étape (16 nov. 2026) : le CCS, l'hôpital et l'établissement voient le même statut
      const fixer = require('./vehicules').fixer;
      if (a === 'en_route' && n.unite_id) await fixer(c, n.unite_id, 'en_route', { source: 'transport', utilisateurId: u.id || null });
      if (a === 'pris_en_charge' && n.unite_id) await fixer(c, n.unite_id, 'transport_hopital', { destinationId: n.destination_id, source: 'transport', utilisateurId: u.id || null });
      if (a === 'arrivee' && n.unite_id && !(await c.query(`SELECT 1 FROM prealertes WHERE unite_id = $1 AND statut NOT IN ('cloturee', 'annulee', 'remplacee')`, [n.unite_id])).rowCount) {
        if (n.motif_transport) {
          await fixer(c, n.unite_id, 'a_l_hopital', { destinationId: n.destination_id, source: 'transport', utilisateurId: u.id || null });
        } else {
          await fixer(c, n.unite_id, 'disponible', { source: 'transport_termine', utilisateurId: u.id || null });
        }
      }
    } else {
      if (a === 'transmettre') {
        // COR-001 : validation humaine avant transmission ; l'établissement peut ajuster la plage, le véhicule et le transporteur autorisé
        if (d.statut !== 'a_valider') throw new ErreurHttp(409, 'transport_statut_incompatible');
        const pd = b.plage_debut ? new Date(b.plage_debut) : d.plage_debut; const pf = b.plage_fin ? new Date(b.plage_fin) : d.plage_fin;
        if (Number.isNaN(new Date(pd).getTime()) || Number.isNaN(new Date(pf).getTime()) || new Date(pf) <= new Date(pd)) throw new ErreurHttp(400, 'plage_invalide');
        const veh = b.type_vehicule ? String(b.type_vehicule) : d.type_vehicule; if (!TYPES_VEHICULE.includes(veh)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'type_vehicule' });
        if (d.lit_id) {
          const lit = (await c.query('SELECT etat, patient_ref FROM lits WHERE id = $1 FOR NO KEY UPDATE', [d.lit_id])).rows[0];
          if (lit?.etat !== 'occupe' || lit.patient_ref !== d.resident_ref) throw new ErreurHttp(409, 'lit_non_occupe', { code: '' });
          const ouvert = (await c.query('SELECT numero FROM demandes_transport WHERE lit_id = $1 AND id <> $2 AND statut = ANY($3)', [d.lit_id, d.id, OUVERTES])).rows[0];
          if (ouvert) throw new ErreurHttp(409, 'transport_deja_demande', { numero: ouvert.numero });
        }
        const orgId = b.organisation_id ? entier(b.organisation_id) : d.organisation_id;
        if (!(await organisationsRegion(c, d.origine_id)).some((o) => o.id === orgId)) throw new ErreurHttp(404, 'organisation_introuvable');
        n = await maj("statut = 'demandee', plage_debut = $2, plage_fin = $3, heure_souhaitee = $2, type_vehicule = $4, organisation_id = $5", [pd, pf, veh, orgId]);
        await require('./horloge').marquer(c, { objet: 'demande_transport', objetId: n.id, etape: 'demande', source: 'clic', auteurId: u.id });
        detail = { transmis: true };
      } else {
        if (a !== 'annuler') throw new ErreurHttp(400, 'action_inconnue');
        if (d.statut === 'pris_en_charge') throw new ErreurHttp(409, 'transport_statut_incompatible');
        n = await maj("statut = 'annulee'");
      }
    }
    // Liens automatiques (faits constatés, jamais une décision) : la prise en charge d'un départ NSA par le transporteur vaut départ de
    // l'hôpital, vu par l'hôpital et la ressource ; l'arrivée est signalée à la ressource qui confirme l'admission elle-même.
    if (n.demande_hebergement_id && cote === 'ambulance' && ['pris_en_charge', 'arrivee'].includes(a)) {
      const dh = (await c.query('SELECT * FROM demandes_hebergement WHERE id = $1 FOR UPDATE', [n.demande_hebergement_id])).rows[0];
      if (dh && a === 'pris_en_charge' && !dh.depart_hopital_le) {
        await c.query('UPDATE demandes_hebergement SET depart_hopital_le = now(), version = version + 1, modifie_le = now() WHERE id = $1', [dh.id]);
        await c.query('INSERT INTO demande_hebergement_etapes (demande_id, statut, detail, par) VALUES ($1, $2, $3, NULL)', [dh.id, dh.statut, `Départ de l’hôpital : pris en charge par le transport ${n.numero}`]);
        await require('./services').notifier(c, dh.etablissement_id, null, 'nsa_depart', { numero: dh.numero, origine: (await c.query('SELECT nom FROM etablissements WHERE id = $1', [dh.hopital_id])).rows[0]?.nom || '' });
      }
      if (dh && a === 'arrivee') await c.query('INSERT INTO demande_hebergement_etapes (demande_id, statut, detail, par) VALUES ($1, $2, $3, NULL)', [dh.id, dh.statut, `Arrivée signalée par le transport ${n.numero} : admission à confirmer par la ressource`]);
    }
    // DSN natif : la prise en charge vaut départ de la transition liée ; chaque étape est historisée dans le dossier
    if (cote === 'ambulance' && ['accepter', 'en_route', 'pris_en_charge', 'arrivee', 'refuser'].includes(a)) await require('./dsn').apresTransport(c, pool, n, a);
    await evenement(c, n, a, u, detail);
    await emettre(c, n, `transport.${a}`);
    require('./flux').signaler();
    const co = n.coordination_id ? (await c.query('SELECT numero, resident_id FROM coordinations WHERE id = $1', [n.coordination_id])).rows[0] : null;
    // Arrimo Famille : le proche autorisé (mouvements) est avisé quand le résident est pris en charge et quand il arrive (sans détail)
    if (co && cote === 'ambulance' && ['pris_en_charge', 'arrivee'].includes(a)) await require('./portail-notifications').signaler(c, co.resident_id, 'mouvements');
    for (const etab of [n.origine_id, n.destination_id].filter(Boolean)) {
      await journaliser(c, { etablissementId: etab, utilisateurId: u.id || null, action: ACTIONS_JOURNAL[a], detail: co ? `${n.numero} · ${co.numero}` : n.numero });
    }
    // L'établissement d'origine suit son transport (cahier 3, étape 6) ; la destination est avertie de l'approche
    const vars = { numero: n.numero, coordination: co?.numero || '', ref: n.resident_ref };
    if (cote === 'ambulance') await require('./services').notifier(c, n.origine_id, null, `transport_${a}`, vars);
    if (n.destination_id && ['pris_en_charge', 'annuler'].includes(a)) await require('./services').notifier(c, n.destination_id, null, `transport_${a}`, vars);
    return n;
  });
}
/** Historique d'une demande autorisée, y compris après archivage. */
async function fiche(pool, u, id, q = {}) {
  const visibles = await liste(pool, u, q, entier(id));
  const d = visibles.find((x) => x.id === entier(id));
  if (!d) throw new ErreurHttp(404, 'transport_introuvable');
  const evenements = (await pool.query(`SELECT ev.type, ev.detail, ev.cree_le, us.nom AS par FROM demande_transport_evenements ev LEFT JOIN utilisateurs us ON us.id = ev.utilisateur_id
    WHERE ev.demande_id = $1 ORDER BY ev.id`, [d.id])).rows;
  return { ...d, evenements };
}
module.exports = { DEPART_NSA_SQL, dureesPlanifiees, BROUILLON_PRIVE_SQL, destinations, preparerDepuisHebergement, organisations, demander, planifier, liste, agir, fiche, OUVERTES, MOTIFS_TRANSPORT, TYPES_VEHICULE };
