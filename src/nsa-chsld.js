/**
 * Sortie d'un patient NSA de l'hôpital vers un CHSLD (décision de Moustafa, 16 nov. 2026, parcours de la rencontre CIUSSS).
 *
 * 1. L'hôpital (coordination) transmet, depuis l'onglet NSA, une demande d'hébergement au CHSLD choisi (le plus proche d'abord).
 * 2. Le CHSLD la traite avec ses étapes habituelles (documents, vérification, place proposée et réservée, acceptation).
 * 3. L'hôpital confirme le départ : son lit part au nettoyage (regles.js, journalisé) et le tableau des lits suit.
 * 4. Le CHSLD confirme l'arrivée du résident (refusée tant que l'hôpital n'a pas confirmé le départ).
 *
 * Fiche d'identification fictive seulement (démo et recette) ; aucune donnée clinique ; aucune identité dans le journal
 * ni dans les notifications (numéro de demande et noms d'établissements seulement). Le Copilote ne décide rien.
 */
const { transaction, ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const { changerEtat, journaliser } = require('./regles');
const { notifier, distanceKm } = require('./services');
const TE = require('./types-etablissement');
const ch = require('./chsld');

const GERER = ['coordonnateur', 'admin_etab', 'gestionnaire'];
const CLOS = ['admise', 'refusee', 'annulee'];
const texte = (v, max = 80) => { const t = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max); return t || null; };
const dateIso = (v) => { const d = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T12:00:00Z`).getTime()) ? d : null; };

/** Hôpital de l'utilisateur, actif, avec Liaison CHSLD. */
async function hopital(db, u, etabId, { gerer = false } = {}) {
  exigerEtablissement(u, etabId);
  if (gerer && !GERER.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const h = (await db.query(`SELECT id, nom, latitude, longitude, modules, type_etablissement, actif, module_actif FROM etablissements WHERE id = $1`, [etabId])).rows[0];
  if (!h || h.type_etablissement !== 'hopital' || !h.actif) throw new ErreurHttp(404, 'hopital_introuvable');
  if (!h.module_actif) throw new ErreurHttp(403, 'module_inactif_etab');
  if (!TE.moduleActif(h, 'liaison_chsld')) throw new ErreurHttp(403, 'module_inactif');
  return h;
}

/** CHSLD qui reçoivent des demandes d'hébergement, du plus proche au plus loin ; places libres en nombre seulement. */
async function destinations(pool, u, etabId) {
  const h = await hopital(pool, u, etabId);
  const rows = (await pool.query(`SELECT e.id, e.nom, e.ville, e.latitude, e.longitude, e.modules, e.type_etablissement,
      (SELECT count(*)::int FROM lits l WHERE l.etablissement_id = e.id AND l.etat = 'libre' AND l.actif) AS places_libres
    FROM etablissements e WHERE e.type_etablissement = 'chsld' AND e.actif AND e.module_actif`)).rows;
  return rows.filter((e) => TE.moduleActif(e, 'demandes_hebergement'))
    .map((e) => ({ id: e.id, nom: e.nom, ville: e.ville, places_libres: e.places_libres, distance_km: distanceKm(h, e) }))
    .sort((a, b) => a.distance_km - b.distance_km || a.nom.localeCompare(b.nom));
}

/** Identité fictive du patient : fiche de l'hôpital (démo, recette) ; sinon saisie par la coordination. */
async function identite(c, hopitalId, ref, b) {
  const p = (await c.query(`SELECT prenom, nom, date_naissance FROM patients WHERE etablissement_id = $1 AND reference = $2 ORDER BY id DESC LIMIT 1`, [hopitalId, ref])).rows[0];
  if (p) return { prenom: p.prenom, nom: p.nom, date_naissance: String(p.date_naissance.toISOString?.() || p.date_naissance).slice(0, 10) };
  const x = { prenom: texte(b.prenom), nom: texte(b.nom), date_naissance: dateIso(b.date_naissance) };
  if (!x.prenom || !x.nom || !x.date_naissance) throw new ErreurHttp(400, 'resident_identite_requise');
  return x;
}

/** « Orienter vers un CHSLD » : transmet une demande d'hébergement pour le patient NSA de ce lit. */
async function orienter(pool, u, litId, b = {}) {
  ch.exigerFictifs();
  const l0 = (await pool.query('SELECT etablissement_id FROM lits WHERE id = $1', [litId])).rows[0];
  if (!l0) throw new ErreurHttp(404, 'lit_introuvable');
  const h = await hopital(pool, u, l0.etablissement_id, { gerer: true });
  const chsldId = Number(b.chsld_id);
  const dest = (await destinations(pool, u, h.id)).find((x) => x.id === chsldId);
  if (!dest) throw new ErreurHttp(404, 'chsld_introuvable');
  const recus = new Set(Array.isArray(b.documents) ? b.documents : []);
  if ([...recus].some((x) => !ch.DOCUMENTS.includes(x))) throw new ErreurHttp(400, 'document_invalide');
  const documents = ch.DOCUMENTS.map((code) => ({ code, recu: recus.has(code) }));
  return transaction(pool, async (c) => {
    const lit = (await c.query('SELECT * FROM lits WHERE id = $1 FOR NO KEY UPDATE', [litId])).rows[0];
    if (b.version != null && Number(b.version) !== lit.version) throw new ErreurHttp(409, 'version_perimee');
    if (lit.etat !== 'occupe' || !lit.patient_ref) throw new ErreurHttp(409, 'lit_non_occupe', { code: lit.code });
    if (!lit.nsa_depuis) throw new ErreurHttp(409, 'patient_non_nsa', { code: lit.code });
    const ouverte = (await c.query(`SELECT d.numero, e.nom FROM demandes_hebergement d JOIN etablissements e ON e.id = d.etablissement_id
      WHERE d.hopital_lit_id = $1 AND d.reference_externe = $2 AND d.statut <> ALL($3)`, [lit.id, lit.patient_ref, CLOS])).rows[0];
    if (ouverte) throw new ErreurHttp(409, 'orientation_chsld_deja_faite', { numero: ouverte.numero, chsld: ouverte.nom });
    const id = await identite(c, h.id, lit.patient_ref, b);
    const d = (await c.query(`INSERT INTO demandes_hebergement (etablissement_id, numero, provenance, reference_externe, prenom, nom, date_naissance,
        arrivee_souhaitee, statut, documents, cree_par, hopital_id, hopital_lit_id)
      VALUES ($1, 'DH-' || lpad(nextval('demande_hebergement_seq')::text, 5, '0'), 'hopital', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [dest.id, lit.patient_ref, id.prenom, id.nom, id.date_naissance, dateIso(b.arrivee_souhaitee), documents.every((x) => x.recu) ? 'recue' : 'documents_manquants',
      JSON.stringify(documents), u.id, h.id, lit.id])).rows[0];
    await c.query('INSERT INTO demande_hebergement_etapes (demande_id, statut, detail, par) VALUES ($1, $2, $3, $4)', [d.id, d.statut, `Reçue de ${h.nom} (patient NSA)`, u.id]);
    // Orientation de la famille CHSLD conservée (public, privé conventionné, privé) ; sinon CHSLD public, historisé
    if (!['chsld', 'chsld_prive_conventionne', 'chsld_prive'].includes(lit.nsa_orientation)) {
      await c.query(`UPDATE lits SET nsa_orientation = 'chsld' WHERE id = $1`, [lit.id]);
      await require('./terrain').historiserOrientation(c, lit.id, u.id);
    }
    await journaliser(c, { litId: lit.id, utilisateurId: u.id, action: 'Orientation NSA vers un CHSLD', detail: `${d.numero} · ${dest.nom}` });
    await journaliser(c, { etablissementId: dest.id, utilisateurId: u.id, action: 'Demande d’hébergement reçue d’un hôpital', detail: `${d.numero} · ${h.nom}` });
    await notifier(c, dest.id, null, 'nsa_demande', { numero: d.numero, origine: h.nom });
    return { id: d.id, numero: d.numero, statut: d.statut, chsld: dest.nom, version: d.version };
  });
}

/** Orientations de l'hôpital vers les CHSLD : en cours, et closes depuis moins de 7 jours. Aucune identité renvoyée. */
async function liste(pool, u, etabId) {
  const h = await hopital(pool, u, etabId);
  return (await pool.query(`SELECT d.id, d.numero, d.statut, d.version, d.reference_externe AS patient_ref, d.arrivee_souhaitee, d.cree_le, d.modifie_le,
      d.depart_hopital_le, d.lit_propose_id IS NOT NULL AS place_reservee, e.nom AS chsld, l.code AS lit, r.admis_le AS arrivee_le,
      (l.etat = 'occupe' AND l.patient_ref = d.reference_externe) AS patient_present
    FROM demandes_hebergement d JOIN etablissements e ON e.id = d.etablissement_id LEFT JOIN lits l ON l.id = d.hopital_lit_id
    LEFT JOIN residents r ON r.id = d.resident_id AND r.statut NOT IN ('preadmission', 'sorti')
    WHERE d.hopital_id = $1 AND (d.statut <> ALL($2) OR d.modifie_le > now() - interval '7 days')
    ORDER BY (d.statut = ANY($2)), d.cree_le DESC`, [h.id, CLOS])).rows;
}

/** L'hôpital confirme le départ vers le CHSLD (place acceptée) : son lit part au nettoyage, le CHSLD est averti. */
async function confirmerDepart(pool, u, demandeId, b = {}) {
  const d0 = (await pool.query('SELECT hopital_id FROM demandes_hebergement WHERE id = $1', [demandeId])).rows[0];
  if (!d0 || !d0.hopital_id) throw new ErreurHttp(404, 'demande_introuvable');
  const h = await hopital(pool, u, d0.hopital_id, { gerer: true });
  return transaction(pool, async (c) => {
    const d = (await c.query('SELECT * FROM demandes_hebergement WHERE id = $1 FOR UPDATE', [demandeId])).rows[0];
    if (d.depart_hopital_le) return { ...d, deja_confirme: true };
    if (b.version != null && Number(b.version) !== d.version) throw new ErreurHttp(409, 'version_perimee');
    if (d.statut !== 'acceptee') throw new ErreurHttp(409, 'place_non_acceptee');
    const dest = (await c.query('SELECT nom FROM etablissements WHERE id = $1', [d.etablissement_id])).rows[0].nom;
    const lit = (await c.query('SELECT id, etat, patient_ref FROM lits WHERE id = $1', [d.hopital_lit_id])).rows[0];
    if (lit && lit.etat === 'occupe' && lit.patient_ref === d.reference_externe) {
      await changerEtat(c, pool, u.id, lit.id, 'nettoyage', { detail: `Départ vers ${dest} (${d.numero})` });
    }
    const n = (await c.query(`UPDATE demandes_hebergement SET depart_hopital_le = now(), version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`, [d.id])).rows[0];
    await c.query('INSERT INTO demande_hebergement_etapes (demande_id, statut, detail, par) VALUES ($1, $2, $3, $4)', [d.id, d.statut, `Départ confirmé par ${h.nom}`, u.id]);
    await journaliser(c, { etablissementId: d.etablissement_id, utilisateurId: u.id, action: 'Départ de l’hôpital confirmé', detail: `${d.numero} · ${h.nom}` });
    await notifier(c, d.etablissement_id, null, 'nsa_depart', { numero: d.numero, origine: h.nom });
    return n;
  });
}

/** Avis à l'hôpital d'origine quand le CHSLD fait avancer la demande (appelé dans la transaction du CHSLD). */
async function avertirHopital(c, d, statut) {
  if (!d.hopital_id || !['place_proposee', 'acceptee', 'refusee', 'annulee', 'admise'].includes(statut)) return;
  const dest = (await c.query('SELECT nom FROM etablissements WHERE id = $1', [d.etablissement_id])).rows[0]?.nom;
  await notifier(c, d.hopital_id, null, `nsa_${statut}`, { numero: d.numero, dest });
}

module.exports = { destinations, orienter, liste, confirmerDepart, avertirHopital };
