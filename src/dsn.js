'use strict';
/**
 * DSN international — dossier clinique (22 nov. 2026 ; cahier « DSN international » v1.0 ; docs/dsn/AUDIT-ET-ARCHITECTURE.md).
 * DÉMONSTRATION ET RECETTE SEULEMENT, patients synthétiques (décision de Moustafa, 22 nov. 2026) : refusé ailleurs (testé).
 * - Accès : personne HABILITÉE (admission, infirmier, médecin, sortie, auditeur) de l'établissement du dossier ; sinon accès
 *   d'urgence justifié (4 h, journalisé). Une autre organisation ne voit QUE les paquets de transition qui lui sont adressés.
 * - Aucun élément signé n'est supprimé : amendement (nouvelle version) ou annulation, tracés. Prescriptions SIMULÉES : jamais envoyées.
 * - Chaque lecture, écriture, signature, export, partage et accès d'urgence est inscrit dans dsn_acces (immuable, sans contenu).
 * - OG résume avec ses sources, sans diagnostiquer, prescrire ni écrire (src/og-modules.js).
 */
const crypto = require('crypto');
const { ErreurHttp, transaction } = require('./db');
const TE = require('./types-etablissement');
const env = require('./environnement');
const horloge = require('./horloge');
const sync = require('./dsn-sync');
const { changerEtat } = require('./regles');

const FONCTIONS = ['admission', 'infirmier', 'medecin', 'sortie', 'auditeur'];
const CLINIQUES = ['infirmier', 'medecin'];
// Schéma de chaque genre d'élément : champs, listes fermées, statut initial, fonctions autorisées à créer
const GENRES = {
  allergie: { champs: { substance: 120, reaction: 200 }, listes: { gravite: ['legere', 'moderee', 'severe'], verification: ['suspectee', 'confirmee'] }, requis: ['substance'], statut: 'actif', creer: CLINIQUES },
  antecedent: { champs: { libelle: 200 }, listes: { type: ['medical', 'chirurgical', 'familial'] }, requis: ['libelle', 'type'], statut: 'actif', creer: CLINIQUES },
  rencontre: { champs: { motif: 200, equipe: 120 }, listes: { type: ['ambulatoire', 'urgence', 'hospitalisation', 'suivi'] }, requis: ['type'], statut: 'ouverte', creer: [...CLINIQUES, 'admission'] },
  note: { champs: { titre: 120, texte: 5000 }, listes: {}, requis: ['texte'], statut: 'brouillon', creer: CLINIQUES, rencontre: true },
  observation: { champs: { valeur: 40, unite: 20 }, listes: { type: ['ta', 'fc', 'temperature', 'spo2', 'poids', 'glycemie', 'douleur', 'autre'] }, requis: ['type', 'valeur'], statut: 'finale', creer: CLINIQUES },
  diagnostic: { champs: { libelle: 200, code: 20 }, listes: { certitude: ['provisoire', 'confirme'] }, requis: ['libelle'], statut: 'actif', creer: ['medecin'] },
  prescription: { champs: { substance: 120, dose: 60, voie: 40, frequence: 60, duree: 60, indication: 200 }, listes: {}, requis: ['substance', 'dose', 'voie', 'frequence'], statut: 'brouillon', creer: CLINIQUES },
  examen: { champs: { type_examen: 120, prestataire: 120, resultat: 2000 }, listes: { priorite: ['routine', 'urgente'] }, requis: ['type_examen'], statut: 'demande', creer: ['medecin'] },
  sejour: { champs: { service: 80, lit: 30, destination: 160, synthese: 4000, consignes: 2000 }, listes: {}, requis: ['service', 'lit'], statut: 'en_cours', creer: ['admission', 'medecin'] },
};
// Ce qu'un paquet de transition peut contenir : résumé minimal choisi (jamais les notes ni le dossier complet)
const PARTAGEABLES = ['allergie', 'antecedent', 'diagnostic', 'prescription', 'observation', 'sejour'];

function exigerEnvironnement() {
  if (!['demo', 'recette'].includes(env.environnement())) throw new ErreurHttp(403, 'dsn_reserve_demo');   // aucune exception, aucune variable de contournement
}
const entier = (v, nom) => { const n = Number(v); if (!Number.isSafeInteger(n) || n < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom }); return n; };
async function numero(c, p) { return `${p}-${String((await c.query("SELECT nextval('dsn_numero_seq') AS n")).rows[0].n).padStart(6, '0')}`; }
async function tracer(c, u, { patient = null, etab = null, action, objet = null, justification = null }) {
  await c.query('INSERT INTO dsn_acces (utilisateur_id, patient_id, etablissement_id, action, objet, justification) VALUES ($1, $2, $3, $4, $5, $6)', [u.id, patient, etab, action, objet, justification]);
}

/** Établissement avec le module DSN actif ; habilitations de la personne dans cet établissement. */
async function contexte(db, u, etabId) {
  exigerEnvironnement();
  const id = entier(etabId, 'etablissement_id');
  if (!u.gestionnaire && !(u.etabs || []).map(Number).includes(id)) throw new ErreurHttp(403, 'etab_interdit');
  const e = (await db.query('SELECT id, nom, type_etablissement, modules FROM etablissements WHERE id = $1 AND actif', [id])).rows[0];
  if (!e || !TE.moduleActif(e, 'dsn')) throw new ErreurHttp(403, 'module_desactive', { module: 'dsn' });
  const fonctions = (await db.query('SELECT fonction FROM dsn_habilitations WHERE etablissement_id = $1 AND utilisateur_id = $2', [id, u.id])).rows.map((r) => r.fonction);
  return { e, fonctions };
}
const exigerFonction = (ctx, liste) => { if (!ctx.fonctions.some((f) => liste.includes(f))) throw new ErreurHttp(403, 'dsn_habilitation_requise', { fonctions: liste.join(', ') }); };

/** Patient lisible : même établissement + habilitation, ou accès d'urgence en cours. 404 sinon (identifiant deviné). */
async function patientLisible(db, u, patientId) {
  exigerEnvironnement();
  const p = (await db.query('SELECT *, date_naissance::text AS date_naissance FROM patients WHERE id = $1', [entier(patientId, 'id')])).rows[0];
  if (!p) throw new ErreurHttp(404, 'objet_introuvable');
  const membre = u.gestionnaire ? false : (u.etabs || []).map(Number).includes(p.etablissement_id);
  if (membre) {
    const e = (await db.query('SELECT id, nom, type_etablissement, modules FROM etablissements WHERE id = $1', [p.etablissement_id])).rows[0];
    if (!TE.moduleActif(e, 'dsn')) throw new ErreurHttp(403, 'module_desactive', { module: 'dsn' });
    const fonctions = (await db.query('SELECT fonction FROM dsn_habilitations WHERE etablissement_id = $1 AND utilisateur_id = $2', [p.etablissement_id, u.id])).rows.map((r) => r.fonction);
    if (fonctions.length) return { p, ctx: { e, fonctions } };
    const urg = (await db.query('SELECT 1 FROM dsn_acces_urgence WHERE utilisateur_id = $1 AND patient_id = $2 AND expire_le > now()', [u.id, p.id])).rowCount;
    if (urg) return { p, ctx: { e, fonctions: ['urgence'] } };
    throw new ErreurHttp(403, 'dsn_habilitation_requise', { fonctions: FONCTIONS.join(', ') });
  }
  throw new ErreurHttp(404, 'objet_introuvable');
}

// ---------------------------------------------------------------- patients
async function creerPatient(pool, u, b = {}) {
  const ctx = await contexte(pool, u, b.etablissement_id); exigerFonction(ctx, ['admission']);
  const p = await require('./patients').creerPatient(pool, u, ctx.e.id, b);
  await pool.query("UPDATE patients SET parcours = 'enregistre' WHERE id = $1", [p.id]);
  await tracer(pool, u, { patient: p.id, etab: ctx.e.id, action: 'ecriture', objet: 'identite' });
  return p;
}
async function rechercher(pool, u, q = {}) {
  const ctx = await contexte(pool, u, q.etablissement_id);
  if (!ctx.fonctions.length) throw new ErreurHttp(403, 'dsn_habilitation_requise', { fonctions: FONCTIONS.join(', ') });
  const t = String(q.q || '').trim().toLowerCase();
  const rows = (await pool.query(`SELECT p.id, p.reference, p.prenom, p.nom, p.date_naissance::text AS date_naissance, p.parcours,
      (SELECT count(*)::int FROM dsn_elements x WHERE x.patient_id = p.id AND x.genre = 'allergie' AND x.statut = 'actif' AND x.remplace_par IS NULL) AS allergies
    FROM patients p WHERE p.etablissement_id = $1 AND ($2 = '' OR lower(p.nom) LIKE $2 || '%' OR lower(p.prenom) LIKE $2 || '%' OR lower(p.reference) = $2 OR p.date_naissance::text = $2)
    ORDER BY p.nom, p.prenom LIMIT 50`, [ctx.e.id, t])).rows;
  return { patients: rows, fonctions: ctx.fonctions };
}
async function corrigerIdentite(pool, u, patientId, b = {}) {
  const { p, ctx } = await patientLisible(pool, u, patientId); exigerFonction(ctx, ['admission']);
  if (String(b.motif || '').trim().length < 5) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'motif' });
  const r = await require('./patients').modifierPatient(pool, u, p.id, b);
  await tracer(pool, u, { patient: p.id, etab: p.etablissement_id, action: 'ecriture', objet: 'identite', justification: String(b.motif).slice(0, 300) });
  return r;
}

/** Dossier complet (lecture tracée) : identité, éléments en vigueur et versions, documents (sans contenu), transitions, chronologie. */
async function dossier(pool, u, patientId) {
  const { p, ctx } = await patientLisible(pool, u, patientId);
  const el = (await pool.query(`SELECT x.*, a.nom AS auteur, s.nom AS signataire FROM dsn_elements x JOIN utilisateurs a ON a.id = x.auteur_id LEFT JOIN utilisateurs s ON s.id = x.signe_par
    WHERE x.patient_id = $1 ORDER BY x.cree_le DESC`, [p.id])).rows;
  const docs = (await pool.query(`SELECT d.id, d.numero, d.type_doc, d.titre, d.mime, d.taille, d.version, d.statut, d.cree_le, a.nom AS auteur FROM dsn_documents d JOIN utilisateurs a ON a.id = d.auteur_id
    WHERE d.patient_id = $1 ORDER BY d.cree_le DESC`, [p.id])).rows;
  const tr = (await pool.query(`SELECT t.id, t.numero, t.statut, t.destination_id, e.nom AS destination, t.cree_le, t.envoye_le, t.decision_le, t.depart_le, t.recu_le, t.motif_refus,
      dt.numero AS transport, dt.statut AS transport_statut, un.numero AS transport_unite, dh.numero AS demande_hebergement, dh.statut AS demande_hebergement_statut, tf.numero AS transfert, tf.statut AS transfert_statut
    FROM dsn_transitions t JOIN etablissements e ON e.id = t.destination_id LEFT JOIN demandes_transport dt ON dt.id = t.demande_transport_id LEFT JOIN unites_secours un ON un.id = dt.unite_id
      LEFT JOIN demandes_hebergement dh ON dh.id = t.demande_hebergement_id LEFT JOIN transferts tf ON tf.id = t.transfert_id
    WHERE t.patient_id = $1 ORDER BY t.cree_le DESC`, [p.id])).rows;
  const evts = (await pool.query(`SELECT v.type, v.source, v.objet, v.statut, v.cree_le, a.nom AS auteur FROM dsn_evenements v LEFT JOIN utilisateurs a ON a.id = v.auteur_id
    WHERE v.patient_id = $1 ORDER BY v.cree_le DESC LIMIT 200`, [p.id])).rows;
  const passages = (await pool.query('SELECT reference, type, arrivee_le, sortie_le, resultat FROM patient_passages WHERE patient_id = $1 ORDER BY arrivee_le DESC', [p.id])).rows;
  await tracer(pool, u, { patient: p.id, etab: p.etablissement_id, action: 'lecture', objet: 'dossier' });
  const enVigueur = el.filter((x) => !x.remplace_par);
  const par = (g) => enVigueur.filter((x) => x.genre === g);
  const chronologie = [
    ...el.map((x) => ({ quand: x.cree_le, genre: x.genre, numero: x.numero, statut: x.statut, auteur: x.auteur, version: x.version })),
    ...docs.map((d) => ({ quand: d.cree_le, genre: 'document', numero: d.numero, statut: d.statut, auteur: d.auteur, version: d.version })),
    ...tr.map((t) => ({ quand: t.cree_le, genre: 'transition', numero: t.numero, statut: t.statut })),
    ...passages.map((x) => ({ quand: x.arrivee_le, genre: 'passage', numero: x.reference, statut: x.resultat })),
    ...evts.map((v) => ({ quand: v.cree_le, genre: 'evenement', numero: v.objet, statut: `${v.type} · ${v.statut}`, source: v.source, auteur: v.auteur || 'système' })),
  ].sort((a, b) => new Date(b.quand) - new Date(a.quand));
  return { patient: p, fonctions: ctx.fonctions, allergies: par('allergie'), antecedents: par('antecedent'), rencontres: par('rencontre'), notes: par('note'),
    observations: par('observation'), diagnostics: par('diagnostic'), prescriptions: par('prescription'), examens: par('examen'), sejours: par('sejour'),
    versions: el.filter((x) => x.remplace_par), documents: docs, transitions: tr, evenements: evts, chronologie, demo: true };
}

// ---------------------------------------------------------------- éléments cliniques
function valider(genre, d = {}) {
  const g = GENRES[genre]; if (!g) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'genre' });
  const out = {};
  for (const [k, max] of Object.entries(g.champs)) { if (d[k] != null && String(d[k]).trim()) { const v = String(d[k]).trim(); if (v.length > max) throw new ErreurHttp(400, 'parametre_invalide', { nom: k }); out[k] = v; } }
  for (const [k, liste] of Object.entries(g.listes)) { if (d[k] != null && d[k] !== '') { if (!liste.includes(d[k])) throw new ErreurHttp(400, 'parametre_invalide', { nom: k }); out[k] = d[k]; } }
  for (const k of g.requis) if (out[k] == null) throw new ErreurHttp(400, 'parametre_invalide', { nom: k });
  return out;
}
async function ajouter(pool, u, patientId, b = {}) {
  const { p, ctx } = await patientLisible(pool, u, patientId);
  const g = GENRES[b.genre]; if (!g) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'genre' });
  exigerFonction(ctx, g.creer);
  const donnees = valider(b.genre, b.donnees);
  let rencontre = null;
  if (b.rencontre_id) {
    rencontre = (await pool.query("SELECT id FROM dsn_elements WHERE id = $1 AND patient_id = $2 AND genre = 'rencontre'", [entier(b.rencontre_id, 'rencontre_id'), p.id])).rows[0];
    if (!rencontre) throw new ErreurHttp(404, 'objet_introuvable');
  } else if (g.rencontre) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'rencontre_id' });
  return transaction(pool, async (c) => {
    let lit = null;
    if (b.genre === 'sejour') {
      // Admission initiée dans le DSN : un vrai lit libre de l'établissement, réservé puis occupé par les règles des lits (verrou, version, journal)
      await sync.verrouPatient(c, p.id);
      if (await sync.sejourActif(c, p.id)) throw new ErreurHttp(409, 'dsn_sejour_deja_actif');
      lit = (await c.query('SELECT id, code, etat, unite_id FROM lits WHERE etablissement_id = $1 AND upper(code) = upper($2) AND actif', [p.etablissement_id, donnees.lit])).rows[0];
      if (!lit) throw new ErreurHttp(404, 'lit_introuvable');
      if (lit.etat !== 'libre') throw new ErreurHttp(409, 'dsn_lit_non_disponible', { code: lit.code, etat: lit.etat });
      donnees.lit = lit.code; donnees.lit_id = lit.id;
    }
    const x = (await c.query(`INSERT INTO dsn_elements (numero, patient_id, etablissement_id, genre, rencontre_id, donnees, statut, auteur_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [await numero(c, 'DSN'), p.id, p.etablissement_id, b.genre, rencontre?.id || null, JSON.stringify(donnees), g.statut, u.id])).rows[0];
    if (lit) {
      await changerEtat(c, pool, u.id, lit.id, 'reserve', { patientRef: p.reference, detail: `Admission DSN ${x.numero}` });
      await changerEtat(c, pool, u.id, lit.id, 'occupe', { patientRef: p.reference, detail: `Admission DSN ${x.numero}` });
      await sync.recalculerParcours(c, p.id);
      await sync.evenement(c, { patientId: p.id, etabId: p.etablissement_id, type: 'admission', source: 'dsn', objet: `lit ${lit.code}`, statut: 'lit_occupe', auteurId: u.id });
    }
    await tracer(c, u, { patient: p.id, etab: p.etablissement_id, action: 'ecriture', objet: `${b.genre} ${x.numero}` });
    return x;
  });
}
/** Élément modifiable par une action : verrou et contrôle du patient. */
async function element(c, u, id) {
  const x = (await c.query('SELECT * FROM dsn_elements WHERE id = $1 FOR UPDATE', [entier(id, 'id')])).rows[0];
  if (!x) throw new ErreurHttp(404, 'objet_introuvable');
  const { ctx } = await patientLisible(c, u, x.patient_id);
  if (x.remplace_par) throw new ErreurHttp(409, 'dsn_version_remplacee');
  return { x, ctx };
}
/** Actions : signer (note, rencontre), valider (prescription, médecin), resultat (examen), sortie (séjour), fermer (rencontre),
    amender (nouvelle version), annuler (motif). Jamais de suppression. */
async function agir(pool, u, id, b = {}) {
  return transaction(pool, async (c) => {
    const { x, ctx } = await element(c, u, id); const a = String(b.action || '');
    const maj = async (champs, vals) => (await c.query(`UPDATE dsn_elements SET ${champs}, modifie_le = now() WHERE id = $1 RETURNING *`, [x.id, ...vals])).rows[0];
    if (a === 'signer') {
      if (!['note', 'rencontre'].includes(x.genre) || x.statut === 'signee') throw new ErreurHttp(409, 'dsn_action_impossible');
      exigerFonction(ctx, CLINIQUES);
      const r = await maj("statut = 'signee', signe_par = $2, signe_le = now()", [u.id]); await tracer(c, u, { patient: x.patient_id, etab: x.etablissement_id, action: 'signature', objet: x.numero }); return r;
    }
    if (a === 'valider') {
      if (x.genre !== 'prescription' || x.statut !== 'brouillon') throw new ErreurHttp(409, 'dsn_action_impossible');
      exigerFonction(ctx, ['medecin']);
      const r = await maj("statut = 'validee', signe_par = $2, signe_le = now()", [u.id]); await tracer(c, u, { patient: x.patient_id, etab: x.etablissement_id, action: 'signature', objet: x.numero }); return { ...r, simulee: true, envoyee: false };
    }
    if (a === 'resultat') {
      if (x.genre !== 'examen' || x.statut !== 'demande') throw new ErreurHttp(409, 'dsn_action_impossible');
      exigerFonction(ctx, CLINIQUES);
      const res = String(b.resultat || '').trim(); if (res.length < 2 || res.length > 2000) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'resultat' });
      const r = await maj("statut = 'resultat', donnees = donnees || $2::jsonb", [JSON.stringify({ resultat: res, resultat_le: new Date().toISOString() })]); await tracer(c, u, { patient: x.patient_id, etab: x.etablissement_id, action: 'ecriture', objet: x.numero }); return r;
    }
    if (a === 'sortie') {
      if (x.genre !== 'sejour' || x.statut !== 'en_cours') throw new ErreurHttp(409, 'dsn_action_impossible');
      exigerFonction(ctx, ['medecin', 'sortie']);
      const d = valider('sejour', { ...x.donnees, ...b.donnees });
      const r = await maj("statut = 'sortie_preparee', donnees = $2::jsonb", [JSON.stringify(d)]); await tracer(c, u, { patient: x.patient_id, etab: x.etablissement_id, action: 'ecriture', objet: x.numero }); return r;
    }
    if (a === 'fermer') {
      if (x.genre !== 'rencontre' || x.statut === 'fermee') throw new ErreurHttp(409, 'dsn_action_impossible');
      exigerFonction(ctx, CLINIQUES); return maj("statut = 'fermee'", []);
    }
    if (a === 'amender') {
      exigerFonction(ctx, GENRES[x.genre].creer);
      const motif = String(b.motif || '').trim(); if (motif.length < 5) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'motif' });
      if (x.genre === 'sejour' && b.donnees?.lit && String(b.donnees.lit).toUpperCase() !== String(x.donnees.lit || '').toUpperCase()) throw new ErreurHttp(409, 'dsn_lit_par_lits');
      const d = { ...valider(x.genre, { ...x.donnees, ...b.donnees }), ...(x.donnees.lit_id ? { lit: x.donnees.lit, lit_id: x.donnees.lit_id } : {}) };
      const n = (await c.query(`INSERT INTO dsn_elements (numero, patient_id, etablissement_id, genre, rencontre_id, donnees, statut, version, remplace_id, auteur_id, motif)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`, [x.numero.replace(/(-v\d+)?$/, `-v${x.version + 1}`), x.patient_id, x.etablissement_id, x.genre, x.rencontre_id, JSON.stringify(d),
        x.genre === 'note' ? 'brouillon' : x.statut, x.version + 1, x.id, u.id, motif])).rows[0];
      await c.query('UPDATE dsn_elements SET remplace_par = $2 WHERE id = $1', [x.id, n.id]);
      await tracer(c, u, { patient: x.patient_id, etab: x.etablissement_id, action: 'ecriture', objet: `amendement ${x.numero}`, justification: motif });
      return n;
    }
    if (a === 'annuler') {
      exigerFonction(ctx, GENRES[x.genre].creer);
      const motif = String(b.motif || '').trim(); if (motif.length < 5) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'motif' });
      const r = await maj("statut = 'annule', motif = $2", [motif.slice(0, 300)]); await tracer(c, u, { patient: x.patient_id, etab: x.etablissement_id, action: 'ecriture', objet: `annulation ${x.numero}`, justification: motif });
      if (x.genre === 'sejour' && sync.ACTIFS.includes(x.statut)) {
        const lit = x.donnees.lit_id ? (await c.query('SELECT id, etat, patient_ref FROM lits WHERE id = $1', [x.donnees.lit_id])).rows[0] : null;
        const ref = (await c.query('SELECT reference FROM patients WHERE id = $1', [x.patient_id])).rows[0].reference;
        if (lit && lit.etat === 'occupe' && lit.patient_ref === ref) await changerEtat(c, pool, u.id, lit.id, 'nettoyage', { detail: `Séjour DSN annulé (${x.numero})` });
        await sync.recalculerParcours(c, x.patient_id);
        await sync.evenement(c, { patientId: x.patient_id, etabId: x.etablissement_id, type: 'admission_annulee', source: 'dsn', objet: x.numero, statut: 'sejour_annule', auteurId: u.id });
      }
      return r;
    }
    throw new ErreurHttp(400, 'parametre_invalide', { nom: 'action' });
  });
}

// ---------------------------------------------------------------- documents
const TYPES_DOC = ['rapport', 'resultat', 'imagerie', 'lettre', 'consentement', 'autre'];
const SIGNATURES = { 'application/pdf': '%PDF', 'image/png': '\x89PNG', 'image/jpeg': '\xff\xd8\xff' };
async function deposer(pool, u, patientId, b = {}) {
  const { p, ctx } = await patientLisible(pool, u, patientId); exigerFonction(ctx, [...CLINIQUES, 'admission', 'sortie']);
  if (!SIGNATURES[b.mime]) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'mime' });
  if (!TYPES_DOC.includes(b.type_doc)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'type_doc' });
  const contenu = Buffer.from(String(b.contenu_base64 || ''), 'base64');
  if (!contenu.length || contenu.length > 5242880) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'taille' });
  // Contrôle du type réel (signature du fichier), pas seulement de l'extension
  if (!contenu.subarray(0, SIGNATURES[b.mime].length).equals(Buffer.from(SIGNATURES[b.mime], 'latin1'))) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'type_reel' });
  const titre = String(b.titre || '').trim();
  return transaction(pool, async (c) => {
    const d = (await c.query(`INSERT INTO dsn_documents (numero, patient_id, etablissement_id, type_doc, titre, mime, taille, sha256, contenu, auteur_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, numero, type_doc, titre, mime, taille, sha256, version, statut, cree_le`, [await numero(c, 'DOC'), p.id, p.etablissement_id, b.type_doc, titre, b.mime, contenu.length,
      crypto.createHash('sha256').update(contenu).digest('hex'), contenu, u.id])).rows[0];
    await tracer(c, u, { patient: p.id, etab: p.etablissement_id, action: 'ecriture', objet: d.numero });
    return d;
  });
}
async function telecharger(pool, u, docId) {
  const d = (await pool.query('SELECT * FROM dsn_documents WHERE id = $1', [entier(docId, 'id')])).rows[0];
  if (!d) throw new ErreurHttp(404, 'objet_introuvable');
  await patientLisible(pool, u, d.patient_id);
  await tracer(pool, u, { patient: d.patient_id, etab: d.etablissement_id, action: 'export', objet: d.numero });
  return d;
}

// ---------------------------------------------------------------- accès d'urgence
async function accesUrgence(pool, u, patientId, b = {}) {
  exigerEnvironnement();
  const p = (await pool.query('SELECT id, etablissement_id FROM patients WHERE id = $1', [entier(patientId, 'id')])).rows[0];
  if (!p || !(u.etabs || []).map(Number).includes(p.etablissement_id)) throw new ErreurHttp(404, 'objet_introuvable');
  const j = String(b.justification || '').trim(); if (j.length < 10 || j.length > 300) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'justification' });
  await pool.query("INSERT INTO dsn_acces_urgence (utilisateur_id, patient_id, justification, expire_le) VALUES ($1, $2, $3, now() + interval '4 hours')", [u.id, p.id, j]);
  await tracer(pool, u, { patient: p.id, etab: p.etablissement_id, action: 'urgence', objet: 'dossier', justification: j });
  await pool.query("INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'DSN : accès d’urgence', $3)", [p.etablissement_id, u.id, `Dossier ${p.id} · 4 h`]);
  return { expire_dans_h: 4 };
}

// ---------------------------------------------------------------- transitions (Hôpital B → Maison de retraite B)
async function creerTransition(pool, u, patientId, b = {}) {
  const { p, ctx } = await patientLisible(pool, u, patientId); exigerFonction(ctx, ['medecin', 'sortie']);
  const dest = (await pool.query('SELECT id, nom FROM etablissements WHERE id = $1 AND actif', [entier(b.destination_id, 'destination_id')])).rows[0];
  if (!dest || dest.id === p.etablissement_id) throw new ErreurHttp(404, 'etab_introuvable');
  const ids = Array.isArray(b.elements) ? [...new Set(b.elements.map(Number))] : [];
  const el = ids.length ? (await pool.query('SELECT id, genre FROM dsn_elements WHERE id = ANY($1) AND patient_id = $2 AND remplace_par IS NULL', [ids, p.id])).rows : [];
  if (el.length !== ids.length || el.some((x) => !PARTAGEABLES.includes(x.genre))) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'elements' });
  const sejour = b.sejour_id ? (await pool.query("SELECT id FROM dsn_elements WHERE id = $1 AND patient_id = $2 AND genre = 'sejour'", [entier(b.sejour_id, 'sejour_id'), p.id])).rows[0] : null;
  return transaction(pool, async (c) => {
    const t = (await c.query(`INSERT INTO dsn_transitions (numero, patient_id, etablissement_id, destination_id, sejour_id, elements, contenu, cree_par) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [await numero(c, 'TRX'), p.id, p.etablissement_id, dest.id, sejour?.id || null, ids, JSON.stringify({ note_transition: String(b.note_transition || '').slice(0, 2000) }), u.id])).rows[0];
    await tracer(c, u, { patient: p.id, etab: p.etablissement_id, action: 'ecriture', objet: t.numero });
    return t;
  });
}
/** Validation par un professionnel : le contenu choisi est figé (instantané) ; seule cette copie sera visible à la destination. */
async function validerTransition(pool, u, id) {
  return transaction(pool, async (c) => {
    const t = (await c.query('SELECT * FROM dsn_transitions WHERE id = $1 FOR UPDATE', [entier(id, 'id')])).rows[0];
    if (!t) throw new ErreurHttp(404, 'objet_introuvable');
    const { p, ctx } = await patientLisible(c, u, t.patient_id); exigerFonction(ctx, ['medecin', 'sortie']);
    if (t.statut !== 'brouillon') throw new ErreurHttp(409, 'dsn_action_impossible');
    const el = (await c.query('SELECT genre, numero, donnees, statut, cree_le FROM dsn_elements WHERE id = ANY($1)', [t.elements])).rows;
    const contenu = { ...t.contenu, patient: { reference: p.reference, prenom: p.prenom, nom: p.nom, date_naissance: p.date_naissance }, elements: el, fige_le: new Date().toISOString() };
    const r = (await c.query("UPDATE dsn_transitions SET statut = 'valide', contenu = $2, valide_par = $3, valide_le = now(), version = version + 1 WHERE id = $1 RETURNING *", [t.id, JSON.stringify(contenu), u.id])).rows[0];
    await tracer(c, u, { patient: p.id, etab: p.etablissement_id, action: 'signature', objet: t.numero });
    return r;
  });
}
/**
 * Envoi (DSN natif, 23 nov. 2026) : la transition est d'abord RÉSERVÉE de façon atomique (valide → envoye) : deux envois simultanés
 * ou un renvoi n'en font qu'un. Ensuite, dans la même transaction : demande d'hébergement (destination = ressource d'hébergement)
 * ou demande de transfert (destination = hôpital, lit RÉSERVÉ et non occupé : jamais de séjour actif), avis à la destination sans
 * contenu clinique, Horloge, historique. Le transport non urgent éventuel est créé après ; s'il échoue, tout est remis à « valide ».
 */
async function envoyerTransition(pool, u, id, b = {}) {
  const t0 = (await pool.query('SELECT * FROM dsn_transitions WHERE id = $1', [entier(id, 'id')])).rows[0];
  if (!t0) throw new ErreurHttp(404, 'objet_introuvable');
  const { p, ctx } = await patientLisible(pool, u, t0.patient_id); exigerFonction(ctx, ['medecin', 'sortie']);
  const t = await transaction(pool, async (c) => {
    const r = (await c.query("UPDATE dsn_transitions SET statut = 'envoye', envoye_le = now(), version = version + 1 WHERE id = $1 AND statut = 'valide' RETURNING *", [t0.id])).rows[0];
    if (!r) throw new ErreurHttp(409, 'dsn_action_impossible');
    const dest = (await c.query('SELECT id, nom, type_etablissement, config_id FROM etablissements WHERE id = $1', [r.destination_id])).rows[0];
    const origine = (await c.query('SELECT nom FROM etablissements WHERE id = $1', [r.etablissement_id])).rows[0].nom;
    const sejour = await sync.sejourActif(c, p.id);
    const litId = sejour?.donnees?.lit_id ? Number(sejour.donnees.lit_id) : null;
    if (dest.type_etablissement === 'chsld') {
      // Hébergement : demande d'hébergement liée, sans ressaisie (identité du dossier, lit d'hôpital, documents à compléter par la ressource)
      const dh = (await c.query(`INSERT INTO demandes_hebergement (etablissement_id, numero, provenance, reference_externe, prenom, nom, date_naissance, statut, documents, cree_par, hopital_id, hopital_lit_id)
        VALUES ($1, 'DH-' || lpad(nextval('demande_hebergement_seq')::text, 5, '0'), 'hopital', $2, $3, $4, $5, 'recue', '[]', $6, $7, $8) RETURNING id, numero`,
      [dest.id, p.reference, p.prenom, p.nom, p.date_naissance, u.id, r.etablissement_id, litId])).rows[0];
      await c.query('INSERT INTO demande_hebergement_etapes (demande_id, statut, detail, par) VALUES ($1, $2, $3, $4)', [dh.id, 'recue', `Reçue de ${origine} (transition ${r.numero})`, u.id]);
      await c.query('UPDATE dsn_transitions SET demande_hebergement_id = $2 WHERE id = $1', [r.id, dh.id]);
      await sync.evenement(c, { patientId: p.id, etabId: r.etablissement_id, type: 'demande_hebergement', source: 'hebergement', objet: `${dh.numero} · ${r.numero}`, statut: 'creee', auteurId: u.id });
    } else if (dest.type_etablissement === 'hopital' && litId) {
      // Hôpital : demande de transfert (lit RÉSERVÉ chez la destination) ; si aucun lit n'est disponible, la transition part quand même et l'écart est historisé
      const typeId = (await c.query('SELECT type_id FROM lits WHERE id = $1', [litId])).rows[0].type_id;
      await c.query('SAVEPOINT dsn_transfert');
      try {
        const tr = await require('./services').creerTransfert(pool, u, { origine_id: r.etablissement_id, destination_id: dest.id, type_id: typeId, patient_ref: p.reference, hors_rayon: true }, c);
        await c.query('RELEASE SAVEPOINT dsn_transfert');
        await c.query('UPDATE dsn_transitions SET transfert_id = $2 WHERE id = $1', [r.id, tr.id]);
        await sync.evenement(c, { patientId: p.id, etabId: r.etablissement_id, type: 'demande_transfert', source: 'transferts', objet: `${tr.numero} · ${r.numero}`, statut: 'creee', auteurId: u.id });
      } catch (err) {
        await c.query('ROLLBACK TO SAVEPOINT dsn_transfert');
        await sync.evenement(c, { patientId: p.id, etabId: r.etablissement_id, type: 'demande_transfert', source: 'transferts', objet: r.numero, statut: `non_creee:${err.code || 'erreur'}`.slice(0, 40), auteurId: u.id });
      }
    }
    await horloge.marquer(c, { objet: 'dsn_transition', objetId: r.id, etape: 'demande', source: 'clic', auteurId: u.id });
    await tracer(c, u, { patient: p.id, etab: p.etablissement_id, action: 'partage', objet: r.numero });
    await sync.evenement(c, { patientId: p.id, etabId: r.etablissement_id, type: 'transition', source: 'dsn', objet: r.numero, statut: 'envoyee', auteurId: u.id });
    // Avis à la destination : numéro et provenance seulement, jamais de contenu clinique
    await require('./services').notifier(c, r.destination_id, null, 'dsn_transition', { numero: r.numero, origine });
    return r;
  });
  let transportId = null;
  if (b.transport) {
    try {
      const r = await require('./transports').planifier(pool, u, { ...b.transport, etablissement_id: t.etablissement_id, destination_id: t.destination_id, motif_transport: b.transport.motif_transport || 'transfert_stable', reference: p.reference });
      transportId = r.id;
      await transaction(pool, async (c) => {
        await c.query('UPDATE dsn_transitions SET demande_transport_id = $2 WHERE id = $1', [t.id, transportId]);
        await sync.evenement(c, { patientId: p.id, etabId: t.etablissement_id, type: 'transport', source: 'transport', objet: `${r.numero} · ${t.numero}`, statut: 'demande', auteurId: u.id });
      });
    } catch (err) {
      // Compensation : rien d'orphelin ; la transition redevient « valide » (demandes d'hébergement/transfert liées annulées)
      await transaction(pool, async (c) => {
        const x = (await c.query('SELECT * FROM dsn_transitions WHERE id = $1 FOR UPDATE', [t.id])).rows[0];
        if (x.demande_hebergement_id) await c.query("UPDATE demandes_hebergement SET statut = 'annulee', modifie_le = now() WHERE id = $1", [x.demande_hebergement_id]).catch(() => {});
        if (x.transfert_id) {
          const tf = (await c.query("UPDATE transferts SET statut = 'refuse', motif_refus = 'Transition DSN non envoyée (transport impossible)', date_refus = now() WHERE id = $1 AND statut = 'demande' RETURNING lit_id", [x.transfert_id])).rows[0];
          const l = tf?.lit_id ? (await c.query('SELECT etat FROM lits WHERE id = $1', [tf.lit_id])).rows[0] : null;
          if (l?.etat === 'reserve') await changerEtat(c, pool, u.id, tf.lit_id, 'libre', { detail: `Transition ${t.numero} non envoyée` });
        }
        await c.query("UPDATE dsn_transitions SET statut = 'valide', envoye_le = NULL, demande_hebergement_id = NULL, transfert_id = NULL, version = version + 1 WHERE id = $1", [t.id]);
        await sync.evenement(c, { patientId: p.id, etabId: t.etablissement_id, type: 'transition', source: 'dsn', objet: t.numero, statut: 'envoi_annule', auteurId: u.id });
      });
      throw err;
    }
  }
  return { ...(await pool.query('SELECT * FROM dsn_transitions WHERE id = $1', [t.id])).rows[0], demande_transport_id: transportId };
}
/** Départ du patient (origine, ou fait constaté par la prise en charge du transport) : Horloge « départ », séjour terminé, lit au nettoyage. */
async function departTransition(c, pool, t, auteur, source) {
  if (t.depart_le || !['accepte', 'envoye'].includes(t.statut)) return false;
  await c.query('UPDATE dsn_transitions SET depart_le = now(), version = version + 1 WHERE id = $1', [t.id]);
  await horloge.marquer(c, { objet: 'dsn_transition', objetId: t.id, etape: 'depart', source: source === 'transport' ? 'connecteur' : 'clic', auteurId: auteur?.id || null });
  const s = await sync.sejourActif(c, t.patient_id);
  if (s?.donnees?.lit_id) {
    const lit = (await c.query('SELECT id, etat FROM lits WHERE id = $1', [s.donnees.lit_id])).rows[0];
    if (lit?.etat === 'occupe') await changerEtat(c, pool, auteur?.id || null, lit.id, 'nettoyage', { detail: `Départ (transition ${t.numero})` });   // le séjour se termine par la synchronisation des lits
  }
  await sync.evenement(c, { patientId: t.patient_id, etabId: t.etablissement_id, type: 'depart', source, objet: t.numero, statut: 'parti', auteurId: auteur?.id || null });
  return true;
}
async function depart(pool, u, id) {
  return transaction(pool, async (c) => {
    const t = (await c.query('SELECT * FROM dsn_transitions WHERE id = $1 FOR UPDATE', [entier(id, 'id')])).rows[0];
    if (!t) throw new ErreurHttp(404, 'objet_introuvable');
    const { ctx } = await patientLisible(c, u, t.patient_id); exigerFonction(ctx, ['medecin', 'sortie', 'infirmier']);
    if (!(await departTransition(c, pool, t, u, 'dsn'))) throw new ErreurHttp(409, 'dsn_action_impossible');
    await tracer(c, u, { patient: t.patient_id, etab: t.etablissement_id, action: 'ecriture', objet: `départ ${t.numero}` });
    return (await c.query('SELECT id, numero, statut, depart_le FROM dsn_transitions WHERE id = $1', [t.id])).rows[0];
  });
}
/** Appelé par src/transports.js : la prise en charge par le transporteur vaut départ ; l'arrivée est historisée (la réception reste confirmée par la destination). */
async function apresTransport(c, pool, d, action) {
  const t = (await c.query('SELECT * FROM dsn_transitions WHERE demande_transport_id = $1 FOR UPDATE', [d.id])).rows[0];
  if (!t) return;
  if (action === 'pris_en_charge') await departTransition(c, pool, t, null, 'transport');
  await sync.evenement(c, { patientId: t.patient_id, etabId: t.etablissement_id, type: 'transport', source: 'transport', objet: `${d.numero} · ${t.numero}`, statut: action, auteurId: null });
}
/** Côté destination (avec ou sans DSN) : SEULEMENT le paquet de transition, jamais le dossier source. */
async function transitionsRecues(pool, u, etabId) {
  exigerEnvironnement();
  const id = entier(etabId, 'etablissement_id');
  if (!u.gestionnaire && !(u.etabs || []).map(Number).includes(id)) throw new ErreurHttp(403, 'etab_interdit');
  if (['entretien'].includes(u.role)) throw new ErreurHttp(403, 'role_entretien');
  const rows = (await pool.query(`SELECT t.id, t.numero, t.statut, t.contenu, t.envoye_le, t.decision_le, t.recu_le, t.arrivee_prevue_le, t.motif_refus, e.nom AS source
    FROM dsn_transitions t JOIN etablissements e ON e.id = t.etablissement_id WHERE t.destination_id = $1 AND t.statut IN ('envoye', 'accepte', 'refuse', 'recu') ORDER BY t.envoye_le DESC LIMIT 50`, [id])).rows;
  for (const r of rows) await tracer(pool, u, { etab: id, action: 'lecture', objet: `paquet ${r.numero}` });
  return rows;
}
async function deciderTransition(pool, u, id, b = {}) {
  exigerEnvironnement();
  return transaction(pool, async (c) => {
    const t = (await c.query('SELECT * FROM dsn_transitions WHERE id = $1 FOR UPDATE', [entier(id, 'id')])).rows[0];
    if (!t || !(u.etabs || []).map(Number).includes(t.destination_id)) throw new ErreurHttp(404, 'objet_introuvable');
    if (!['coordonnateur', 'admin_etab', 'equipe_soins'].includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
    if (b.decision === 'accepter' && t.statut === 'envoye') {
      const arrivee = b.arrivee_prevue_le ? new Date(b.arrivee_prevue_le) : null;
      if (arrivee && Number.isNaN(arrivee.getTime())) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'arrivee_prevue_le' });
      await c.query("UPDATE dsn_transitions SET statut = 'accepte', decision_par = $2, decision_le = now(), arrivee_prevue_le = $3, version = version + 1 WHERE id = $1", [t.id, u.id, arrivee]);
      await horloge.marquer(c, { objet: 'dsn_transition', objetId: t.id, etape: 'decision', source: 'clic', auteurId: u.id });
    } else if (b.decision === 'refuser' && t.statut === 'envoye') {
      const motif = String(b.motif || '').trim(); if (motif.length < 3) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'motif' });
      await c.query("UPDATE dsn_transitions SET statut = 'refuse', decision_par = $2, decision_le = now(), motif_refus = $3, version = version + 1 WHERE id = $1", [t.id, u.id, motif.slice(0, 300)]);
      await horloge.marquer(c, { objet: 'dsn_transition', objetId: t.id, etape: 'decision', source: 'clic', auteurId: u.id });
    } else if (b.decision === 'reception' && t.statut === 'accepte') {
      await c.query("UPDATE dsn_transitions SET statut = 'recu', recu_par = $2, recu_le = now(), version = version + 1 WHERE id = $1", [t.id, u.id]);
      await horloge.marquer(c, { objet: 'dsn_transition', objetId: t.id, etape: 'arrivee', source: 'clic', auteurId: u.id });
      await c.query("UPDATE patients SET parcours = 'transfere', modifie_le = now() WHERE id = $1", [t.patient_id]);
    } else throw new ErreurHttp(409, 'dsn_action_impossible');
    await tracer(c, u, { etab: t.destination_id, action: b.decision === 'refuser' ? 'refus' : 'reception', objet: t.numero });
    // L'origine est avisée de la décision (sans contenu clinique) ; chaque décision est historisée
    const dest = (await c.query('SELECT nom FROM etablissements WHERE id = $1', [t.destination_id])).rows[0].nom;
    if (b.decision !== 'reception') await require('./services').notifier(c, t.etablissement_id, null, b.decision === 'accepter' ? 'dsn_transition_acceptee' : 'dsn_transition_refusee', { numero: t.numero, destination: dest });
    await sync.evenement(c, { patientId: t.patient_id, etabId: t.etablissement_id, type: 'transition', source: 'dsn', objet: t.numero, statut: { accepter: 'acceptee', refuser: 'refusee', reception: 'recue' }[b.decision], auteurId: u.id });
    return (await c.query('SELECT id, numero, statut, decision_le, recu_le, arrivee_prevue_le FROM dsn_transitions WHERE id = $1', [t.id])).rows[0];
  });
}
/** La destination qui a le DSN peut ouvrir son propre dossier à partir du paquet reçu (identité + éléments, source « transition »). */
async function ouvrirDossierDepuisTransition(pool, u, id) {
  const t0 = (await pool.query("SELECT destination_id FROM dsn_transitions WHERE id = $1 AND statut = 'recu'", [entier(id, 'id')])).rows[0];
  if (!t0) throw new ErreurHttp(404, 'objet_introuvable');
  const ctx = await contexte(pool, u, t0.destination_id); exigerFonction(ctx, ['admission', 'infirmier', 'medecin']);
  return transaction(pool, async (c) => {
    const t = (await c.query('SELECT * FROM dsn_transitions WHERE id = $1 FOR UPDATE', [entier(id, 'id')])).rows[0];
    // Idempotent : un deuxième appel (double clic, reprise réseau) rend le MÊME dossier
    if (t.dossier_patient_id) return { ...(await c.query('SELECT * FROM patients WHERE id = $1', [t.dossier_patient_id])).rows[0], deja_ouvert: true };
    const id0 = t.contenu.patient;
    const p = await require('./patients').creerPatient(c, u, t.destination_id, { prenom: id0.prenom, nom: id0.nom, date_naissance: String(id0.date_naissance).slice(0, 10), confirmer_doublon: true });
    for (const x of t.contenu.elements || []) {
      await c.query(`INSERT INTO dsn_elements (numero, patient_id, etablissement_id, genre, donnees, statut, auteur_id, source) VALUES ($1, $2, $3, $4, $5, $6, $7, 'transition')`,
        [await numero(c, 'DSN'), p.id, t.destination_id, x.genre, JSON.stringify({ ...x.donnees, origine: x.numero }), x.statut, u.id]);
    }
    await c.query('UPDATE dsn_transitions SET dossier_patient_id = $2 WHERE id = $1', [t.id, p.id]);
    await tracer(c, u, { patient: p.id, etab: t.destination_id, action: 'ecriture', objet: `dossier depuis ${t.numero}` });
    await sync.evenement(c, { patientId: p.id, etabId: t.destination_id, type: 'dossier_ouvert', source: 'dsn', objet: t.numero, statut: 'cree', auteurId: u.id });
    return p;
  });
}

// ---------------------------------------------------------------- habilitations et journal d'accès
async function habilitations(pool, u, etabId) {
  exigerEnvironnement();
  const id = entier(etabId, 'etablissement_id');
  if (!u.gestionnaire && !(u.role === 'admin_etab' && (u.etabs || []).map(Number).includes(id))) throw new ErreurHttp(403, 'role_insuffisant');
  return (await pool.query(`SELECT u.id, u.nom, u.role, COALESCE(array_agg(h.fonction ORDER BY h.fonction) FILTER (WHERE h.fonction IS NOT NULL), '{}') AS fonctions
    FROM utilisateurs u JOIN utilisateur_etablissements ue ON ue.utilisateur_id = u.id AND ue.etablissement_id = $1
    LEFT JOIN dsn_habilitations h ON h.utilisateur_id = u.id AND h.etablissement_id = $1 WHERE u.actif GROUP BY u.id ORDER BY u.nom`, [id])).rows;
}
async function habiliter(pool, u, b = {}) {
  exigerEnvironnement();
  const id = entier(b.etablissement_id, 'etablissement_id');
  if (!u.gestionnaire && !(u.role === 'admin_etab' && (u.etabs || []).map(Number).includes(id))) throw new ErreurHttp(403, 'role_insuffisant');
  if (!FONCTIONS.includes(b.fonction)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'fonction' });
  const cible = entier(b.utilisateur_id, 'utilisateur_id');
  if (cible === u.id && b.actif) throw new ErreurHttp(403, 'dsn_auto_habilitation');   // un administrateur ne s'ouvre pas les dossiers lui-même
  if (!(await pool.query('SELECT 1 FROM utilisateur_etablissements WHERE utilisateur_id = $1 AND etablissement_id = $2', [cible, id])).rowCount) throw new ErreurHttp(404, 'objet_introuvable');
  if (b.actif) await pool.query('INSERT INTO dsn_habilitations (etablissement_id, utilisateur_id, fonction, accorde_par) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [id, cible, b.fonction, u.id]);
  else await pool.query('DELETE FROM dsn_habilitations WHERE etablissement_id = $1 AND utilisateur_id = $2 AND fonction = $3', [id, cible, b.fonction]);
  await pool.query("INSERT INTO journal_admin (utilisateur_id, etablissement_id, action, cible, detail) VALUES ($1, $2, 'DSN : habilitation', $3, $4)", [u.id, id, String(cible), `${b.fonction} ${b.actif ? 'accordée' : 'retirée'}`]);
  return { ok: true };
}
async function journalAcces(pool, u, q = {}) {
  const ctx = await contexte(pool, u, q.etablissement_id); exigerFonction(ctx, ['auditeur']);
  return (await pool.query(`SELECT a.cree_le, a.action, a.objet, a.justification, x.nom AS utilisateur, p.reference FROM dsn_acces a JOIN utilisateurs x ON x.id = a.utilisateur_id
    LEFT JOIN patients p ON p.id = a.patient_id WHERE a.etablissement_id = $1 AND ($2::int IS NULL OR a.patient_id = $2) ORDER BY a.cree_le DESC LIMIT 300`,
  [ctx.e.id, q.patient_id ? entier(q.patient_id, 'patient_id') : null])).rows;
}

module.exports = { FONCTIONS, GENRES, PARTAGEABLES, exigerEnvironnement, contexte, patientLisible, creerPatient, rechercher, corrigerIdentite, dossier, ajouter, agir, deposer, telecharger,
  accesUrgence, creerTransition, validerTransition, envoyerTransition, depart, apresTransport, transitionsRecues, deciderTransition, ouvrirDossierDepuisTransition, habilitations, habiliter, journalAcces };
