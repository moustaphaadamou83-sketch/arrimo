'use strict';
/**
 * Produit CHSLD : résidents, contacts et autorisations, places, demandes d'hébergement, coordination avec les hôpitaux
 * et entre CHSLD, tâches et transmissions, communications avec les proches, tableau de bord et indicateurs.
 * Règles :
 * - Tout passe par le serveur : établissement de type CHSLD, module actif, rôle, module CHSLD activé.
 * - Identités (résidents, proches) : fictives, en démonstration et en recette seulement (même règle que les patients).
 * - Aucune donnée clinique, aucun classement clinique, aucune décision d'admissibilité : suivi administratif seulement.
 * - Les places changent d'état uniquement par regles.changerEtat (verrou de ligne, version, journal) : jamais deux résidents.
 * - Les autres établissements ne voient que la référence du résident (R-00000), jamais son nom.
 * - Chaque étape est journalisée (journal immuable, sans nom de personne).
 */
const { transaction, ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const { changerEtat, journaliser } = require('./regles');
const { environnement } = require('./environnement');
const TE = require('./types-etablissement');
const crypto = require('node:crypto');

const GERER = ['coordonnateur', 'admin_etab', 'gestionnaire'];
const CONSULTER = [...GERER, 'equipe_soins'];
const RELATIONS = ['fille', 'fils', 'conjoint', 'soeur', 'frere', 'parent', 'petit_enfant', 'ami', 'voisin', 'tuteur', 'autre'];
const CATEGORIES = ['administratif', 'hebergement', 'rendez_vous', 'mouvements'];
const ACCESSIBILITE = ['fauteuil', 'deambulateur', 'leve_personne', 'lit_electrique', 'malentendant', 'malvoyant'];
const DOCUMENTS = ['formulaire_mecanisme', 'identite', 'carte_assurance_maladie', 'mandat_representant', 'consentement_hebergement'];

function exigerFictifs() {
  if (!['demo', 'recette'].includes(environnement()) && process.env.ARRIMO_PATIENTS_FICTIFS !== '1') throw new ErreurHttp(403, 'residents_reserve_demo');
}
const texte = (v, max = 120) => { const t = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max); return t || null; };
const dateIso = (v) => { const d = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T12:00:00Z`).getTime()) ? d : null; };

/** Établissement CHSLD accessible à l'utilisateur, avec le rôle voulu et le module demandé. */
async function etabChsld(db, u, etabId, { roles = CONSULTER, module = null } = {}) {
  exigerEtablissement(u, etabId);
  const e = (await db.query('SELECT id, nom, code, type_etablissement, module_actif, modules, config_id, conservation_place_jours, partage FROM etablissements WHERE id = $1', [etabId])).rows[0];
  if (!e) throw new ErreurHttp(404, 'etab_introuvable');
  if (e.type_etablissement !== 'chsld') throw new ErreurHttp(409, 'etab_non_chsld');
  if (!e.module_actif) throw new ErreurHttp(403, 'module_inactif', { etab: e.nom });
  if (!roles.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  if (module && !TE.moduleActif(e, module)) throw new ErreurHttp(403, 'module_desactive', { module });
  return e;
}
async function lireResident(db, u, id, opts = {}) {
  const r = (await db.query('SELECT * FROM residents WHERE id = $1', [id])).rows[0];
  if (!r) throw new ErreurHttp(404, 'resident_introuvable');
  const e = await etabChsld(db, u, r.etablissement_id, opts);
  return { r, e };
}
async function verrouResident(c, id) {
  const r = (await c.query('SELECT * FROM residents WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!r) throw new ErreurHttp(404, 'resident_introuvable');
  return r;
}
const versionAttendue = (obj, v) => { if (v != null && Number(v) !== obj.version) throw new ErreurHttp(409, 'version_perimee'); };
async function mouvement(c, r, type, u, extra = {}) {
  await c.query(`INSERT INTO resident_mouvements (resident_id, etablissement_id, type, de_lit_id, vers_lit_id, autre_etablissement_id, coordination_id, detail, par)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [r.id, extra.etablissementId || r.etablissement_id, type, extra.de || null, extra.vers || null, extra.autre || null, extra.coordination || null, extra.detail || null, u?.id || null]);
}
const journalChsld = (c, etabId, u, action, detail) => journaliser(c, { etablissementId: etabId, utilisateurId: u?.id, action, detail });
async function tache(c, etabId, u, t) {
  return (await c.query(`INSERT INTO taches_etab (etablissement_id, type, titre, detail, lit_id, resident_id, assigne_role, echeance, cree_par)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`, [etabId, t.type, t.titre, t.detail || null, t.lit_id || null, t.resident_id || null, t.assigne_role || null, t.echeance || null, u?.id || null])).rows[0];
}
const codeLit = async (c, litId) => (await c.query('SELECT code FROM lits WHERE id = $1', [litId])).rows[0]?.code;

/* ------------------------------------------------------------------ tableau de bord */
async function accueil(pool, u, etabId) {
  const e = await etabChsld(pool, u, etabId, { roles: [...CONSULTER, 'entretien'] });
  const places = (await pool.query(`SELECT count(*) FILTER (WHERE l.etat <> 'indispo')::int AS dotees,
      count(*) FILTER (WHERE l.etat = 'libre')::int AS libres, count(*) FILTER (WHERE l.etat = 'reserve')::int AS reservees,
      count(*) FILTER (WHERE l.etat = 'occupe' AND r.statut = 'present')::int AS occupees,
      count(*) FILTER (WHERE l.etat = 'occupe' AND r.statut IN ('hospitalise', 'absent'))::int AS conservees,
      count(*) FILTER (WHERE l.etat = 'nettoyage')::int AS preparation, count(*) FILTER (WHERE l.etat = 'indispo')::int AS bloquees
    FROM lits l LEFT JOIN residents r ON r.lit_id = l.id AND r.statut NOT IN ('sorti', 'transfere') WHERE l.etablissement_id = $1 AND l.actif`, [e.id])).rows[0];
  const residents = Object.fromEntries((await pool.query(`SELECT statut, count(*)::int n FROM residents WHERE etablissement_id = $1 AND statut NOT IN ('sorti', 'transfere') GROUP BY statut`, [e.id])).rows.map((x) => [x.statut, x.n]));
  // Résidents distincts par type de mouvement (une préadmission puis une réservation de place comptent une fois)
  const aujourdhui = (await pool.query(`SELECT type, count(DISTINCT resident_id)::int n FROM resident_mouvements WHERE etablissement_id = $1 AND date >= date_trunc('day', now())
    AND type <> 'modification' GROUP BY type ORDER BY type`, [e.id])).rows;
  const demandes = Object.fromEntries((await pool.query(`SELECT statut, count(*)::int n FROM demandes_hebergement WHERE etablissement_id = $1 AND statut NOT IN ('admise', 'refusee', 'annulee') GROUP BY statut`, [e.id])).rows.map((x) => [x.statut, x.n]));
  await expirerCoordinations(pool);
  const coordinations = (await pool.query(`SELECT type, statut, (destination_id = $1) AS entrante, count(*)::int n FROM coordinations
    WHERE (origine_id = $1 OR destination_id = $1) AND statut IN ('preparee', 'envoyee', 'acceptee', 'en_cours') GROUP BY 1, 2, 3`, [e.id])).rows;
  const retours = (await pool.query(`SELECT c.numero, c.resident_ref, c.retour_prevu_le, c.statut, o.nom AS hopital FROM coordinations c JOIN etablissements o ON o.id = c.origine_id
    WHERE c.destination_id = $1 AND c.type = 'retour' AND c.statut IN ('envoyee', 'acceptee', 'en_cours') ORDER BY c.retour_prevu_le NULLS LAST LIMIT 10`, [e.id])).rows;
  const taches = (await pool.query(`SELECT count(*) FILTER (WHERE statut IN ('a_faire', 'en_cours'))::int AS ouvertes,
      count(*) FILTER (WHERE statut IN ('a_faire', 'en_cours') AND echeance < now())::int AS en_retard FROM taches_etab WHERE etablissement_id = $1`, [e.id])).rows[0];
  const alertes = [];
  if (demandes.documents_manquants) alertes.push({ code: 'documents_manquants', n: demandes.documents_manquants });
  if (taches.en_retard) alertes.push({ code: 'taches_en_retard', n: taches.en_retard });
  const expirees = (await pool.query(`SELECT count(*)::int n FROM coordinations WHERE destination_id = $1 AND statut = 'expiree' AND modifie_le > now() - interval '2 days'`, [e.id])).rows[0].n;
  if (expirees) alertes.push({ code: 'confirmations_expirees', n: expirees });
  return { etablissement: { id: e.id, nom: e.nom }, places, residents, aujourdhui, demandes, coordinations, retours, taches, alertes };
}

/* ------------------------------------------------------------------ résidents */
async function listeResidents(pool, u, etabId, q = {}) {
  const e = await etabChsld(pool, u, etabId);
  const cond = ['r.etablissement_id = $1']; const p = [e.id];
  if (q.statut === 'actifs' || !q.statut) cond.push(`r.statut NOT IN ('sorti', 'transfere')`);
  else if (q.statut !== 'tous') { p.push(String(q.statut)); cond.push(`r.statut = $${p.length}`); }
  if (q.q) { p.push(`%${String(q.q).trim().toLowerCase()}%`); cond.push(`(lower(r.nom) LIKE $${p.length} OR lower(r.prenom) LIKE $${p.length} OR lower(r.reference) LIKE $${p.length} OR lower(coalesce(r.nom_usage,'')) LIKE $${p.length})`); }
  return (await pool.query(`SELECT r.id, r.reference, r.prenom, r.nom, r.nom_usage, r.date_naissance, r.statut, r.langue, r.admis_le, r.arrivee_prevue, r.version,
      l.code AS lit, ch.numero AS chambre, un.nom AS unite,
      (SELECT count(*)::int FROM resident_contacts k WHERE k.resident_id = r.id AND k.actif) AS contacts
    FROM residents r LEFT JOIN lits l ON l.id = r.lit_id LEFT JOIN chambres ch ON ch.id = l.chambre_id LEFT JOIN unites un ON un.id = l.unite_id
    WHERE ${cond.join(' AND ')} ORDER BY r.nom, r.prenom LIMIT 300`, p)).rows;
}
async function ficheResident(pool, u, id) {
  const { r, e } = await lireResident(pool, u, id);
  const lit = r.lit_id ? (await pool.query(`SELECT l.id, l.code, l.etat, l.version, ch.numero AS chambre, ch.type_chambre, un.nom AS unite FROM lits l
    JOIN chambres ch ON ch.id = l.chambre_id JOIN unites un ON un.id = l.unite_id WHERE l.id = $1`, [r.lit_id])).rows[0] : null;
  const contacts = (await pool.query('SELECT * FROM resident_contacts WHERE resident_id = $1 AND actif ORDER BY principal DESC, rang, id', [r.id])).rows;
  const mouvements = (await pool.query(`SELECT m.type, m.date, m.detail, de.code AS de_lit, vers.code AS vers_lit, a.nom AS autre_etablissement, u.nom AS par
    FROM resident_mouvements m LEFT JOIN lits de ON de.id = m.de_lit_id LEFT JOIN lits vers ON vers.id = m.vers_lit_id
    LEFT JOIN etablissements a ON a.id = m.autre_etablissement_id LEFT JOIN utilisateurs u ON u.id = m.par WHERE m.resident_id = $1 ORDER BY m.date DESC, m.id DESC LIMIT 100`, [r.id])).rows;
  const coordinations = (await pool.query(`SELECT c.id, c.numero, c.type, c.statut, c.retour_prevu_le, c.incident, c.version, c.cree_le, c.modifie_le, o.nom AS origine, d.nom AS destination,
      c.origine_id, c.destination_id FROM coordinations c JOIN etablissements o ON o.id = c.origine_id JOIN etablissements d ON d.id = c.destination_id
    WHERE c.resident_id = $1 OR (c.resident_ref = $2 AND (c.origine_id = $3 OR c.destination_id = $3)) ORDER BY c.cree_le DESC LIMIT 30`, [r.id, r.reference, e.id])).rows;
  const taches = (await pool.query(`SELECT id, type, titre, statut, echeance, cree_le FROM taches_etab WHERE resident_id = $1 ORDER BY cree_le DESC LIMIT 30`, [r.id])).rows;
  const communications = GERER.includes(u.role) || u.role === 'equipe_soins' ? (await pool.query(`SELECT cp.id, cp.type, cp.sens, cp.categorie, cp.sujet, cp.statut, cp.prevu_le, cp.fait_le, cp.cree_le,
      k.prenom || ' ' || k.nom AS contact, k.relation FROM communications_proches cp JOIN resident_contacts k ON k.id = cp.contact_id WHERE cp.resident_id = $1 ORDER BY cp.cree_le DESC LIMIT 50`, [r.id])).rows : [];
  // Localisation hospitalière : seulement d'après la dernière hospitalisation confirmée (jamais supposée)
  const hosp = coordinations.find((c) => c.type === 'hospitalisation' && ['en_cours', 'recue'].includes(c.statut));
  const localisation = r.statut === 'hospitalise' && hosp ? { hopital: hosp.destination, confirmee: hosp.statut === 'recue', numero: hosp.numero } : null;
  return { resident: r, lit, contacts, mouvements, coordinations, taches, communications, localisation };
}
function lireIdentite(b) {
  const prenom = texte(b.prenom, 80), nom = texte(b.nom, 80), dn = dateIso(b.date_naissance);
  if (!prenom || !nom || !dn || new Date(dn) > new Date() || Number(dn.slice(0, 4)) < 1900) throw new ErreurHttp(400, 'resident_identite_requise');
  const langue = ['fr', 'en', 'autre'].includes(b.langue) ? b.langue : 'fr';
  const accessibilite = Array.isArray(b.accessibilite) ? b.accessibilite.filter((x) => ACCESSIBILITE.includes(x)) : [];
  return { prenom, nom, date_naissance: dn, nom_usage: texte(b.nom_usage, 80), dossier_officiel: texte(b.dossier_officiel, 40), langue,
    telephone: texte(b.telephone, 30), courriel: texte(b.courriel, 120), adresse_precedente: texte(b.adresse_precedente, 200),
    arrivee_prevue: dateIso(b.arrivee_prevue), accessibilite };
}
function lireContact(b) {
  const prenom = texte(b.prenom, 80), nom = texte(b.nom, 80);
  if (!prenom || !nom || !RELATIONS.includes(b.relation)) throw new ErreurHttp(400, 'contact_invalide');
  const telephone = texte(b.telephone, 30), courriel = texte(b.courriel, 120);
  if (!telephone && !courriel) throw new ErreurHttp(400, 'contact_coordonnees_requises');
  if (courriel && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(courriel)) throw new ErreurHttp(400, 'contact_invalide');
  const rang = Number(b.rang ?? 1); if (!Number.isInteger(rang) || rang < 1 || rang > 20) throw new ErreurHttp(400, 'contact_invalide');
  const autorisations = Array.isArray(b.autorisations) ? [...new Set(b.autorisations)].filter((x) => CATEGORIES.includes(x)) : [];
  return { prenom, nom, relation: b.relation, telephone, courriel, adresse: texte(b.adresse, 200), rang, principal: b.principal === true,
    contact_urgence: b.contact_urgence !== false, proche_aidant: b.proche_aidant === true, representant_legal: b.representant_legal === true,
    autorisations, disponibilites: texte(b.disponibilites, 200), langue: ['fr', 'en', 'autre'].includes(b.langue) ? b.langue : 'fr' };
}
async function semblables(db, etabId, id) {
  return (await db.query(`SELECT id, reference, prenom, nom, date_naissance, statut FROM residents WHERE etablissement_id = $1
    AND ((lower(nom) = lower($2) AND date_naissance = $3) OR (lower(nom) = lower($2) AND lower(prenom) = lower($4)) OR ($5::text IS NOT NULL AND dossier_officiel = $5))
    AND statut NOT IN ('sorti', 'transfere') ORDER BY id LIMIT 5`, [etabId, id.nom, id.date_naissance, id.prenom, id.dossier_officiel])).rows;
}
async function insererContact(c, residentId, k) {
  if (k.principal) await c.query('UPDATE resident_contacts SET principal = false, version = version + 1 WHERE resident_id = $1 AND principal', [residentId]);
  return (await c.query(`INSERT INTO resident_contacts (resident_id, prenom, nom, relation, telephone, courriel, adresse, rang, principal, contact_urgence, proche_aidant,
      representant_legal, autorisations, disponibilites, langue) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
  [residentId, k.prenom, k.nom, k.relation, k.telephone, k.courriel, k.adresse, k.rang, k.principal, k.contact_urgence, k.proche_aidant, k.representant_legal, k.autorisations, k.disponibilites, k.langue])).rows[0];
}
/** Nouveau résident (préadmission), contacts compris ; doublons signalés, création d'un second dossier seulement sur confirmation. */
async function creerResident(pool, u, b, client = null) {
  exigerFictifs();
  const etabId = Number(b.etablissement_id);
  const e = await etabChsld(client || pool, u, etabId, { roles: GERER });
  const id = lireIdentite(b);
  const contacts = (Array.isArray(b.contacts) ? b.contacts : []).slice(0, 20).map(lireContact);
  const faire = async (c) => {
    const empreinte = crypto.createHash('sha256').update(`${e.id}\u001f${id.nom.toLowerCase()}\u001f${id.prenom.toLowerCase()}\u001f${id.date_naissance}`).digest('hex');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`arrimo-resident:${empreinte}`]);
    const doublons = await semblables(c, e.id, id);
    if (doublons.length && b.confirmer_doublon !== true) throw new ErreurHttp(409, 'resident_doublon_possible', { ref: doublons.map((x) => x.reference).join(', ') });
    const r = (await c.query(`INSERT INTO residents (etablissement_id, reference, prenom, nom, nom_usage, date_naissance, dossier_officiel, langue, telephone, courriel,
        adresse_precedente, arrivee_prevue, accessibilite, responsable_accueil, cree_par)
      VALUES ($1, 'R-' || lpad(nextval('resident_seq')::text, 5, '0'), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [e.id, id.prenom, id.nom, id.nom_usage, id.date_naissance, id.dossier_officiel, id.langue, id.telephone, id.courriel, id.adresse_precedente, id.arrivee_prevue,
      id.accessibilite, Number(b.responsable_accueil) || null, u.id])).rows[0];
    for (const k of contacts) await insererContact(c, r.id, k);
    await mouvement(c, r, 'preadmission', u, { detail: doublons.length ? 'Dossier distinct confirmé malgré une ressemblance' : null });
    await journalChsld(c, e.id, u, 'Résident enregistré', `${r.reference}${contacts.length ? ` · ${contacts.length} contact(s)` : ''}`);
    return { ...r, doublons_possibles: doublons.map((x) => x.reference) };
  };
  return client ? faire(client) : transaction(pool, faire);
}
const CHAMPS_MODIFIABLES = ['prenom', 'nom', 'nom_usage', 'date_naissance', 'dossier_officiel', 'langue', 'telephone', 'courriel', 'adresse_precedente', 'arrivee_prevue', 'accessibilite'];
async function modifierResident(pool, u, id, b) {
  exigerFictifs();
  const { e } = await lireResident(pool, u, id, { roles: GERER });
  return transaction(pool, async (c) => {
    const r = await verrouResident(c, id); versionAttendue(r, b.version);
    const v = lireIdentite({ ...r, date_naissance: String(r.date_naissance?.toISOString?.() || r.date_naissance).slice(0, 10), arrivee_prevue: r.arrivee_prevue && String(r.arrivee_prevue?.toISOString?.() || r.arrivee_prevue).slice(0, 10), ...b });
    const changes = CHAMPS_MODIFIABLES.filter((k) => JSON.stringify(v[k] ?? null) !== JSON.stringify(k === 'date_naissance' || k === 'arrivee_prevue' ? (r[k] ? String(r[k].toISOString?.() || r[k]).slice(0, 10) : null) : r[k] ?? null));
    const etapes = b.etapes_accueil && typeof b.etapes_accueil === 'object' && !Array.isArray(b.etapes_accueil)
      ? Object.fromEntries(Object.entries(b.etapes_accueil).filter(([k, x]) => /^[a-z_]{2,40}$/.test(k) && typeof x === 'boolean')) : null;
    const n = (await c.query(`UPDATE residents SET prenom=$2, nom=$3, nom_usage=$4, date_naissance=$5, dossier_officiel=$6, langue=$7, telephone=$8, courriel=$9,
        adresse_precedente=$10, arrivee_prevue=$11, accessibilite=$12, etapes_accueil = etapes_accueil || COALESCE($13::jsonb, '{}'::jsonb), version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`,
    [id, v.prenom, v.nom, v.nom_usage, v.date_naissance, v.dossier_officiel, v.langue, v.telephone, v.courriel, v.adresse_precedente, v.arrivee_prevue, v.accessibilite, etapes ? JSON.stringify(etapes) : null])).rows[0];
    if (changes.length || etapes) {
      await mouvement(c, n, 'modification', u, { detail: `Champs modifiés : ${[...changes, ...(etapes ? ['étapes d’accueil'] : [])].join(', ')}` });
      await journalChsld(c, e.id, u, 'Dossier résident modifié', `${n.reference} · ${changes.length} champ(s)`);
    }
    return n;
  });
}

/* ---------- contacts et autorisations ---------- */
async function ajouterContact(pool, u, residentId, b) {
  exigerFictifs();
  const { e } = await lireResident(pool, u, residentId, { roles: GERER });
  const k = lireContact(b);
  return transaction(pool, async (c) => {
    const r = await verrouResident(c, residentId);
    const n = await insererContact(c, r.id, k);
    await mouvement(c, r, 'modification', u, { detail: `Contact ajouté (${k.relation})` });
    await journalChsld(c, e.id, u, 'Contact ajouté', `${r.reference} · ${k.relation}`);
    return n;
  });
}
async function modifierContact(pool, u, contactId, b) {
  exigerFictifs();
  const k0 = (await pool.query('SELECT * FROM resident_contacts WHERE id = $1', [contactId])).rows[0];
  if (!k0) throw new ErreurHttp(404, 'contact_introuvable');
  const { e } = await lireResident(pool, u, k0.resident_id, { roles: GERER });
  return transaction(pool, async (c) => {
    const k = (await c.query('SELECT * FROM resident_contacts WHERE id = $1 FOR UPDATE', [contactId])).rows[0]; versionAttendue(k, b.version);
    const r = await verrouResident(c, k.resident_id);
    if (b.actif === false) { // révocation : le contact n'est plus utilisé, l'historique reste
      const n = (await c.query('UPDATE resident_contacts SET actif = false, principal = false, autorisations = $2, version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *', [contactId, []])).rows[0];
      await mouvement(c, r, 'modification', u, { detail: `Contact retiré (${k.relation}) ; autorisations révoquées` });
      await journalChsld(c, e.id, u, 'Contact retiré', `${r.reference} · ${k.relation}`);
      return n;
    }
    const v = lireContact({ ...k, ...b });
    if (v.principal && !k.principal) await c.query('UPDATE resident_contacts SET principal = false, version = version + 1 WHERE resident_id = $1 AND principal AND id <> $2', [k.resident_id, contactId]);
    // Changer le statut de représentant légal annule la vérification documentaire précédente.
    const verifie = v.representant_legal === k.representant_legal ? k.representant_verifie_le : null;
    const n = (await c.query(`UPDATE resident_contacts SET prenom=$2, nom=$3, relation=$4, telephone=$5, courriel=$6, adresse=$7, rang=$8, principal=$9, contact_urgence=$10, proche_aidant=$11,
        representant_legal=$12, representant_verifie_le=$13, representant_verifie_par = CASE WHEN $13::timestamptz IS NULL THEN NULL ELSE representant_verifie_par END,
        autorisations=$14, disponibilites=$15, langue=$16, version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`,
    [contactId, v.prenom, v.nom, v.relation, v.telephone, v.courriel, v.adresse, v.rang, v.principal, v.contact_urgence, v.proche_aidant, v.representant_legal, verifie, v.autorisations, v.disponibilites, v.langue])).rows[0];
    const ajoutees = v.autorisations.filter((x) => !k.autorisations.includes(x)), retirees = k.autorisations.filter((x) => !v.autorisations.includes(x));
    await mouvement(c, r, 'modification', u, { detail: `Contact modifié (${k.relation})${ajoutees.length ? ` ; autorisations accordées : ${ajoutees.join(', ')}` : ''}${retirees.length ? ` ; retirées : ${retirees.join(', ')}` : ''}` });
    await journalChsld(c, e.id, u, 'Contact modifié', `${r.reference} · ${k.relation}`);
    return n;
  });
}
/** Vérification documentaire d'un représentant légal : administration ou coordination seulement. */
async function verifierRepresentant(pool, u, contactId) {
  const k0 = (await pool.query('SELECT * FROM resident_contacts WHERE id = $1', [contactId])).rows[0];
  if (!k0) throw new ErreurHttp(404, 'contact_introuvable');
  const { e } = await lireResident(pool, u, k0.resident_id, { roles: GERER });
  if (!k0.representant_legal) throw new ErreurHttp(409, 'contact_pas_representant');
  return transaction(pool, async (c) => {
    const n = (await c.query('UPDATE resident_contacts SET representant_verifie_le = now(), representant_verifie_par = $2, version = version + 1 WHERE id = $1 RETURNING *', [contactId, u.id])).rows[0];
    const r = await verrouResident(c, k0.resident_id);
    await mouvement(c, r, 'modification', u, { detail: 'Mandat de représentation vérifié' });
    await journalChsld(c, e.id, u, 'Représentant légal vérifié', r.reference);
    return n;
  });
}

/* ---------- places : réservation, arrivée, changement de chambre, absence, sortie ---------- */
async function reserverPlace(pool, u, residentId, b) {
  const { e } = await lireResident(pool, u, residentId, { roles: GERER });
  return transaction(pool, async (c) => {
    const r = await verrouResident(c, residentId); versionAttendue(r, b.version_resident);
    if (r.statut !== 'preadmission') throw new ErreurHttp(409, 'resident_statut_incompatible');
    if (r.lit_id) throw new ErreurHttp(409, 'resident_place_deja_reservee');
    const lit = (await c.query('SELECT etablissement_id FROM lits WHERE id = $1', [Number(b.lit_id)])).rows[0];
    if (!lit || lit.etablissement_id !== e.id) throw new ErreurHttp(404, 'lit_introuvable');
    const l = await changerEtat(c, pool, u.id, Number(b.lit_id), 'reserve', { versionAttendue: b.version, patientRef: r.reference, detail: `Place réservée pour ${r.reference}` });
    const n = (await c.query('UPDATE residents SET lit_id = $2, version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *', [r.id, l.id])).rows[0];
    await mouvement(c, n, 'preadmission', u, { vers: l.id, detail: 'Place réservée' });
    await tache(c, e.id, u, { type: 'preparation_chambre', titre: `Préparer ${l.code} pour l’accueil de ${r.reference}`, lit_id: l.id, resident_id: r.id, assigne_role: 'entretien',
      echeance: r.arrivee_prevue ? new Date(`${String(r.arrivee_prevue.toISOString?.() || r.arrivee_prevue).slice(0, 10)}T08:00:00`) : null });
    return n;
  });
}
async function confirmerArrivee(pool, u, residentId, b) {
  const { e } = await lireResident(pool, u, residentId, { roles: GERER });
  return transaction(pool, async (c) => {
    const r = await verrouResident(c, residentId); versionAttendue(r, b.version);
    if (r.statut !== 'preadmission' || !r.lit_id) throw new ErreurHttp(409, 'resident_statut_incompatible');
    const l = await changerEtat(c, pool, u.id, r.lit_id, 'occupe', { detail: `Arrivée de ${r.reference}` });
    const n = (await c.query(`UPDATE residents SET statut = 'present', admis_le = now(), version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`, [r.id])).rows[0];
    await mouvement(c, n, 'admission', u, { vers: l.id, detail: `Arrivée confirmée · ${l.code}` });
    await c.query(`UPDATE demandes_hebergement SET statut = 'admise', version = version + 1, modifie_le = now() WHERE resident_id = $1 AND statut IN ('place_proposee', 'acceptee')`, [r.id]);
    await journalChsld(c, e.id, u, 'Admission', `${r.reference} · ${l.code}`);
    return n;
  });
}
async function changerChambre(pool, u, residentId, b) {
  const { e } = await lireResident(pool, u, residentId, { roles: GERER });
  return transaction(pool, async (c) => {
    const r = await verrouResident(c, residentId); versionAttendue(r, b.version_resident);
    if (r.statut !== 'present' || !r.lit_id) throw new ErreurHttp(409, 'resident_statut_incompatible');
    const cible = (await c.query('SELECT etablissement_id FROM lits WHERE id = $1', [Number(b.lit_id)])).rows[0];
    if (!cible || cible.etablissement_id !== e.id || Number(b.lit_id) === r.lit_id) throw new ErreurHttp(404, 'lit_introuvable');
    await changerEtat(c, pool, u.id, Number(b.lit_id), 'reserve', { versionAttendue: b.version, patientRef: r.reference, detail: `Changement de chambre de ${r.reference}` });
    const nouveau = await changerEtat(c, pool, u.id, Number(b.lit_id), 'occupe', { detail: `Changement de chambre de ${r.reference}` });
    const ancien = await changerEtat(c, pool, u.id, r.lit_id, 'nettoyage', { detail: `Départ de ${r.reference} (changement de chambre)` });
    const n = (await c.query('UPDATE residents SET lit_id = $2, version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *', [r.id, nouveau.id])).rows[0];
    await mouvement(c, n, 'changement_chambre', u, { de: ancien.id, vers: nouveau.id, detail: `${ancien.code} → ${nouveau.code}` });
    await tache(c, e.id, u, { type: 'entretien', titre: `Nettoyer ${ancien.code} après changement de chambre`, lit_id: ancien.id, assigne_role: 'entretien' });
    return n;
  });
}
const MOTIFS_SORTIE = ['domicile', 'autre_milieu', 'deces', 'autre'];
async function sortie(pool, u, residentId, b) {
  const { e } = await lireResident(pool, u, residentId, { roles: GERER });
  if (!MOTIFS_SORTIE.includes(b.motif)) throw new ErreurHttp(400, 'motif_sortie_requis');
  return transaction(pool, async (c) => {
    const r = await verrouResident(c, residentId); versionAttendue(r, b.version);
    if (!['present', 'absent', 'hospitalise', 'preadmission'].includes(r.statut)) throw new ErreurHttp(409, 'resident_statut_incompatible');
    let lit = null;
    if (r.lit_id) {
      const etat = (await c.query('SELECT etat FROM lits WHERE id = $1', [r.lit_id])).rows[0].etat;
      lit = await changerEtat(c, pool, u.id, r.lit_id, etat === 'reserve' ? 'libre' : 'nettoyage', { detail: `Fin d’hébergement de ${r.reference}` });
      if (lit.etat === 'nettoyage') await tache(c, e.id, u, { type: 'entretien', titre: `Nettoyer ${lit.code} après la fin d’hébergement`, lit_id: lit.id, assigne_role: 'entretien' });
    }
    await c.query(`UPDATE coordinations SET statut = 'annulee', version = version + 1, modifie_le = now() WHERE resident_id = $1 AND statut IN ('preparee', 'envoyee', 'acceptee')`, [r.id]);
    const n = (await c.query(`UPDATE residents SET statut = 'sorti', lit_id = NULL, version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`, [r.id])).rows[0];
    await mouvement(c, n, r.statut === 'preadmission' ? 'annulation' : 'sortie', u, { de: lit?.id, detail: `Motif : ${b.motif}` });
    await journalChsld(c, e.id, u, 'Fin d’hébergement', `${r.reference} · ${b.motif}`);
    return n;
  });
}
async function absence(pool, u, residentId, b) {
  const { e } = await lireResident(pool, u, residentId, { roles: [...GERER, 'equipe_soins'] });
  return transaction(pool, async (c) => {
    const r = await verrouResident(c, residentId); versionAttendue(r, b.version);
    const debut = b.fin !== true;
    if (debut ? r.statut !== 'present' : r.statut !== 'absent') throw new ErreurHttp(409, 'resident_statut_incompatible');
    const n = (await c.query(`UPDATE residents SET statut = $2, version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`, [r.id, debut ? 'absent' : 'present'])).rows[0];
    await mouvement(c, n, debut ? 'absence' : 'fin_absence', u, { detail: debut ? `Absence temporaire${b.retour_prevu ? ` · retour prévu ${dateIso(b.retour_prevu)}` : ''} ; place conservée` : 'Retour d’absence' });
    await journalChsld(c, e.id, u, debut ? 'Absence temporaire' : 'Retour d’absence', r.reference);
    return n;
  });
}

/* ------------------------------------------------------------------ demandes d'hébergement */
async function listeDemandes(pool, u, etabId, q = {}) {
  const e = await etabChsld(pool, u, etabId, { module: 'demandes_hebergement' });
  return (await pool.query(`SELECT d.*, t.nom AS type_nom, r.reference AS resident_ref, l.code AS lit_propose
    FROM demandes_hebergement d LEFT JOIN types_unite t ON t.id = d.type_id LEFT JOIN residents r ON r.id = d.resident_id LEFT JOIN lits l ON l.id = d.lit_propose_id
    WHERE d.etablissement_id = $1 ${q.toutes ? '' : "AND d.statut NOT IN ('admise', 'refusee', 'annulee')"} ORDER BY d.cree_le`, [e.id])).rows;
}
async function creerDemande(pool, u, b) {
  exigerFictifs();
  const e = await etabChsld(pool, u, Number(b.etablissement_id), { roles: GERER, module: 'demandes_hebergement' });
  if (!['mecanisme_acces', 'hopital', 'autre_chsld', 'domicile'].includes(b.provenance)) throw new ErreurHttp(400, 'provenance_invalide');
  const prenom = texte(b.prenom, 80), nom = texte(b.nom, 80), dn = dateIso(b.date_naissance);
  if (!prenom || !nom || !dn) throw new ErreurHttp(400, 'resident_identite_requise');
  const typeId = b.type_id ? Number(b.type_id) : null;
  if (typeId && !(await pool.query('SELECT 1 FROM types_unite WHERE id = $1 AND config_id = $2', [typeId, e.config_id])).rowCount) throw new ErreurHttp(400, 'type_invalide');
  const recus = new Set(Array.isArray(b.documents_recus) ? b.documents_recus : []);
  const documents = DOCUMENTS.map((code) => ({ code, recu: recus.has(code) }));
  return transaction(pool, async (c) => {
    const d = (await c.query(`INSERT INTO demandes_hebergement (etablissement_id, numero, provenance, reference_externe, prenom, nom, date_naissance, type_id, arrivee_souhaitee, statut, documents, cree_par)
      VALUES ($1, 'DH-' || lpad(nextval('demande_hebergement_seq')::text, 5, '0'), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [e.id, b.provenance, texte(b.reference_externe, 40), prenom, nom, dn, typeId, dateIso(b.arrivee_souhaitee), documents.every((x) => x.recu) ? 'recue' : 'documents_manquants', JSON.stringify(documents), u.id])).rows[0];
    await c.query('INSERT INTO demande_hebergement_etapes (demande_id, statut, detail, par) VALUES ($1, $2, $3, $4)', [d.id, d.statut, `Reçue (${b.provenance})`, u.id]);
    await journalChsld(c, e.id, u, 'Demande d’hébergement reçue', d.numero);
    return d;
  });
}
/** Étapes administratives : documents, vérification, place proposée (réservée), acceptation, refus, annulation. Aucune priorisation. */
async function actionDemande(pool, u, id, b) {
  const d0 = (await pool.query('SELECT * FROM demandes_hebergement WHERE id = $1', [id])).rows[0];
  if (!d0) throw new ErreurHttp(404, 'demande_introuvable');
  const e = await etabChsld(pool, u, d0.etablissement_id, { roles: GERER, module: 'demandes_hebergement' });
  const a = String(b.action || '');
  return transaction(pool, async (c) => {
    const d = (await c.query('SELECT * FROM demandes_hebergement WHERE id = $1 FOR UPDATE', [id])).rows[0]; versionAttendue(d, b.version);
    if (['admise', 'refusee', 'annulee'].includes(d.statut)) throw new ErreurHttp(409, 'demande_close');
    let statut = d.statut, documents = d.documents, residentId = d.resident_id, litId = d.lit_propose_id, detail = null;
    if (a === 'document') {
      if (!DOCUMENTS.includes(b.code) || typeof b.recu !== 'boolean') throw new ErreurHttp(400, 'document_invalide');
      documents = documents.map((x) => (x.code === b.code ? { ...x, recu: b.recu } : x));
      if (['recue', 'documents_manquants'].includes(statut)) statut = documents.every((x) => x.recu) ? 'recue' : 'documents_manquants';
      detail = `Document ${b.code} : ${b.recu ? 'reçu' : 'manquant'}`;
    } else if (a === 'verifier') {
      if (!documents.every((x) => x.recu)) throw new ErreurHttp(409, 'documents_manquants');
      statut = 'en_verification'; detail = 'Vérification administrative';
    } else if (a === 'proposer_place') {
      if (statut !== 'en_verification') throw new ErreurHttp(409, 'demande_statut_incompatible');
      exigerFictifs();
      const r = await creerResident(pool, u, { etablissement_id: e.id, prenom: d.prenom, nom: d.nom, date_naissance: String(d.date_naissance.toISOString?.() || d.date_naissance).slice(0, 10),
        dossier_officiel: d.reference_externe, arrivee_prevue: d.arrivee_souhaitee && String(d.arrivee_souhaitee.toISOString?.() || d.arrivee_souhaitee).slice(0, 10), confirmer_doublon: b.confirmer_doublon === true }, c);
      const lit = (await c.query('SELECT etablissement_id FROM lits WHERE id = $1', [Number(b.lit_id)])).rows[0];
      if (!lit || lit.etablissement_id !== e.id) throw new ErreurHttp(404, 'lit_introuvable');
      const l = await changerEtat(c, pool, u.id, Number(b.lit_id), 'reserve', { versionAttendue: b.version_lit, patientRef: r.reference, detail: `Place proposée (${d.numero})` });
      await c.query('UPDATE residents SET lit_id = $2, version = version + 1 WHERE id = $1', [r.id, l.id]);
      residentId = r.id; litId = l.id; statut = 'place_proposee'; detail = `Place ${l.code} proposée ; résident ${r.reference}`;
    } else if (a === 'accepter') {
      if (statut !== 'place_proposee') throw new ErreurHttp(409, 'demande_statut_incompatible');
      statut = 'acceptee'; detail = 'Proposition acceptée';
    } else if (a === 'refuser' || a === 'annuler') {
      if (litId) {
        const etat = (await c.query('SELECT etat FROM lits WHERE id = $1', [litId])).rows[0]?.etat;
        if (etat === 'reserve') await changerEtat(c, pool, u.id, litId, 'libre', { detail: `${d.numero} ${a === 'refuser' ? 'refusée' : 'annulée'}` });
      }
      if (residentId) {
        const r = (await c.query(`UPDATE residents SET statut = 'sorti', lit_id = NULL, version = version + 1 WHERE id = $1 AND statut = 'preadmission' RETURNING *`, [residentId])).rows[0];
        if (r) await mouvement(c, r, 'annulation', u, { detail: `${d.numero} ${a === 'refuser' ? 'refusée' : 'annulée'}` });
      }
      statut = a === 'refuser' ? 'refusee' : 'annulee'; detail = texte(b.motif, 200) || (a === 'refuser' ? 'Refusée' : 'Annulée');
    } else throw new ErreurHttp(400, 'action_inconnue');
    const n = (await c.query(`UPDATE demandes_hebergement SET statut = $2, documents = $3, resident_id = $4, lit_propose_id = $5, version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`,
      [id, statut, JSON.stringify(documents), residentId, litId])).rows[0];
    await c.query('INSERT INTO demande_hebergement_etapes (demande_id, statut, detail, par) VALUES ($1, $2, $3, $4)', [id, statut, detail, u.id]);
    await journalChsld(c, e.id, u, 'Demande d’hébergement', `${d.numero} · ${statut}`);
    return n;
  });
}

/* ------------------------------------------------------------------ coordination entre établissements */
async function expirerCoordinations(db) {
  await db.query(`UPDATE coordinations SET statut = 'expiree', version = version + 1, modifie_le = now() WHERE statut IN ('envoyee', 'acceptee') AND expire_le < now()`);
}
const numeroCoordination = async (c) => (await c.query(`SELECT 'CO-' || lpad(nextval('coordination_seq')::text, 5, '0') AS n`)).rows[0].n;
async function etape(c, co, statut, etabId, u, detail) {
  await c.query('INSERT INTO coordination_etapes (coordination_id, statut, etablissement_id, par, detail) VALUES ($1, $2, $3, $4, $5)', [co.id, statut, etabId, u?.id || null, detail || null]);
}
/** Départ d'un résident vers un hôpital : préparé et envoyé par le CHSLD après vérification d'identité. */
async function preparerHospitalisation(pool, u, residentId, b) {
  const { e } = await lireResident(pool, u, residentId, { roles: [...GERER, 'equipe_soins'], module: 'hospitalisations' });
  if (b.identite_verifiee !== true) throw new ErreurHttp(400, 'identite_a_verifier');
  const h = (await pool.query(`SELECT id, nom FROM etablissements WHERE id = $1 AND type_etablissement = 'hopital' AND actif`, [Number(b.hopital_id)])).rows[0];
  if (!h) throw new ErreurHttp(404, 'hopital_introuvable');
  return transaction(pool, async (c) => {
    const r = await verrouResident(c, residentId); versionAttendue(r, b.version);
    if (!['present', 'absent'].includes(r.statut)) throw new ErreurHttp(409, 'resident_statut_incompatible');
    const co = (await c.query(`INSERT INTO coordinations (numero, type, resident_id, resident_ref, origine_id, destination_id, statut, motif_admin, lit_id, cree_par)
      VALUES ($1, 'hospitalisation', $2, $3, $4, $5, 'envoyee', $6, $7, $8) RETURNING *`, [await numeroCoordination(c), r.id, r.reference, e.id, h.id, texte(b.motif_admin, 200), r.lit_id, u.id])).rows[0];
    await etape(c, co, 'envoyee', e.id, u, `Départ préparé vers ${h.nom} ; identité vérifiée`);
    await mouvement(c, r, 'depart_hopital', u, { autre: h.id, coordination: co.id, detail: `Départ préparé (${co.numero})` });
    await journalChsld(c, e.id, u, 'Hospitalisation préparée', `${r.reference} · ${co.numero}`);
    return co;
  });
}
/** Actions sur une coordination, selon l'établissement de l'utilisateur (origine ou destination). */
async function actionCoordination(pool, u, id, b) {
  const co0 = (await pool.query('SELECT * FROM coordinations WHERE id = $1', [id])).rows[0];
  if (!co0) throw new ErreurHttp(404, 'coordination_introuvable');
  const etabId = Number(b.etablissement_id);
  if (![co0.origine_id, co0.destination_id].includes(etabId)) throw new ErreurHttp(403, 'etab_interdit');
  exigerEtablissement(u, etabId);
  if (!['coordonnateur', 'admin_etab', 'gestionnaire', ...(co0.type === 'hospitalisation' ? ['equipe_soins'] : [])].includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const cote = etabId === co0.origine_id ? 'origine' : 'destination';
  const a = String(b.action || '');
  return transaction(pool, async (c) => {
    await expirerCoordinations(c);
    const co = (await c.query('SELECT * FROM coordinations WHERE id = $1 FOR UPDATE', [id])).rows[0]; versionAttendue(co, b.version);
    const r = await verrouResident(c, co.resident_id);
    const maj = async (statut, champs = {}) => (await c.query(`UPDATE coordinations SET statut = $2, incident = COALESCE($3, incident), retour_prevu_le = COALESCE($4, retour_prevu_le),
        lit_id = COALESCE($5, lit_id), destination_id = COALESCE($6, destination_id), version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`,
      [co.id, statut, champs.incident || null, champs.retour || null, champs.lit || null, champs.destination || null])).rows[0];
    const ouvert = ['preparee', 'envoyee', 'acceptee', 'en_cours'].includes(co.statut);
    if (!ouvert && !['incident'].includes(a)) throw new ErreurHttp(409, 'coordination_close');
    const t = co.type;
    let n;
    // -------- hospitalisation (CHSLD → hôpital)
    if (t === 'hospitalisation' && cote === 'origine' && a === 'confirmer_depart') {
      if (co.statut !== 'envoyee') throw new ErreurHttp(409, 'coordination_statut_incompatible');
      n = await maj('en_cours');
      await c.query(`UPDATE residents SET statut = 'hospitalise', version = version + 1, modifie_le = now() WHERE id = $1`, [r.id]);
      await mouvement(c, r, 'depart_hopital', u, { autre: co.destination_id, coordination: co.id, detail: 'Départ confirmé ; hospitalisation en cours ; place conservée' });
    } else if (t === 'hospitalisation' && cote === 'destination' && a === 'confirmer_reception') {
      if (co.statut !== 'en_cours') throw new ErreurHttp(409, 'coordination_statut_incompatible');
      n = await maj('recue');
      await mouvement(c, r, 'hospitalisation_confirmee', u, { etablissementId: r.etablissement_id, autre: co.destination_id, coordination: co.id, detail: 'Réception confirmée par l’hôpital' });
    } else if (t === 'hospitalisation' && cote === 'origine' && a === 'changer_hopital') {
      if (!['envoyee', 'en_cours'].includes(co.statut)) throw new ErreurHttp(409, 'coordination_statut_incompatible');
      const h = (await c.query(`SELECT id, nom FROM etablissements WHERE id = $1 AND type_etablissement = 'hopital' AND actif`, [Number(b.hopital_id)])).rows[0];
      if (!h || h.id === co.destination_id) throw new ErreurHttp(404, 'hopital_introuvable');
      n = await maj(co.statut, { incident: 'changement_hopital', destination: h.id });
    } else if (t === 'hospitalisation' && cote === 'origine' && a === 'annuler') {
      if (co.statut !== 'envoyee') throw new ErreurHttp(409, 'coordination_statut_incompatible');
      n = await maj('annulee');
      await mouvement(c, r, 'annulation', u, { coordination: co.id, detail: 'Départ vers l’hôpital annulé' });
    // -------- retour (hôpital → CHSLD), préparé par l'hôpital qui a reçu le résident
    } else if (t === 'retour' && cote === 'destination' && a === 'accepter') {
      if (co.statut !== 'envoyee') throw new ErreurHttp(409, 'coordination_statut_incompatible');
      // La place conservée doit être encore celle du résident ; sinon une autre place libre est réservée.
      let lit = r.lit_id;
      if (!lit) {
        const l = await changerEtat(c, pool, u.id, Number(b.lit_id), 'reserve', { versionAttendue: b.version_lit, patientRef: r.reference, detail: `Retour de ${r.reference}` });
        if (l.etablissement_id !== r.etablissement_id) throw new ErreurHttp(404, 'lit_introuvable');
        lit = l.id; await c.query('UPDATE residents SET lit_id = $2 WHERE id = $1', [r.id, lit]);
      }
      n = await maj('acceptee', { lit });
      await tache(c, r.etablissement_id, u, { type: 'preparation_chambre', titre: `Préparer la chambre pour le retour de ${r.reference}`, lit_id: lit, resident_id: r.id, assigne_role: 'entretien', echeance: co.retour_prevu_le });
      await mouvement(c, r, 'retour_prevu', u, { autre: co.origine_id, coordination: co.id, detail: `Retour accepté${co.retour_prevu_le ? ` pour le ${new Date(co.retour_prevu_le).toISOString().slice(0, 10)}` : ''}` });
    } else if (t === 'retour' && cote === 'destination' && a === 'refuser') {
      if (!['envoyee', 'acceptee'].includes(co.statut)) throw new ErreurHttp(409, 'coordination_statut_incompatible');
      n = await maj('refusee', { incident: ['chambre_indisponible', 'informations_manquantes'].includes(b.incident) ? b.incident : null });
    } else if (t === 'retour' && cote === 'origine' && a === 'confirmer_depart') {
      if (co.statut !== 'acceptee') throw new ErreurHttp(409, 'coordination_statut_incompatible');
      n = await maj('en_cours');
    } else if (t === 'retour' && cote === 'destination' && a === 'confirmer_arrivee') {
      if (co.statut !== 'en_cours') throw new ErreurHttp(409, 'coordination_statut_incompatible');
      const etat = (await c.query('SELECT etat FROM lits WHERE id = $1', [r.lit_id])).rows[0]?.etat;
      if (etat === 'reserve') await changerEtat(c, pool, u.id, r.lit_id, 'occupe', { detail: `Retour de ${r.reference}` });
      n = await maj('recue');
      await c.query(`UPDATE residents SET statut = 'present', version = version + 1, modifie_le = now() WHERE id = $1`, [r.id]);
      if (co.liee_id) await c.query(`UPDATE coordinations SET statut = 'recue', version = version + 1, modifie_le = now() WHERE id = $1 AND statut IN ('en_cours')`, [co.liee_id]);
      await mouvement(c, r, 'retour', u, { autre: co.origine_id, coordination: co.id, detail: 'Retour confirmé ; résident présent' });
    // -------- transfert inter-CHSLD (origine → destination)
    } else if (t === 'transfert_chsld' && cote === 'destination' && a === 'accepter') {
      if (co.statut !== 'envoyee') throw new ErreurHttp(409, 'coordination_statut_incompatible');
      const lit = (await c.query('SELECT etablissement_id FROM lits WHERE id = $1', [Number(b.lit_id)])).rows[0];
      if (!lit || lit.etablissement_id !== co.destination_id) throw new ErreurHttp(404, 'lit_introuvable');
      const l = await changerEtat(c, pool, u.id, Number(b.lit_id), 'reserve', { versionAttendue: b.version_lit, patientRef: co.resident_ref, detail: `Accueil prévu de ${co.resident_ref} (${co.numero})` });
      n = await maj('acceptee', { lit: l.id });
      await tache(c, co.destination_id, u, { type: 'preparation_chambre', titre: `Préparer ${l.code} pour l’accueil de ${co.resident_ref}`, lit_id: l.id, assigne_role: 'entretien' });
    } else if (t === 'transfert_chsld' && cote === 'destination' && a === 'refuser') {
      if (co.statut !== 'envoyee') throw new ErreurHttp(409, 'coordination_statut_incompatible');
      n = await maj('refusee');
      await c.query(`UPDATE residents SET statut = 'present', version = version + 1 WHERE id = $1 AND statut = 'transfert_en_cours'`, [r.id]);
    } else if (t === 'transfert_chsld' && cote === 'origine' && a === 'confirmer_depart') {
      if (co.statut !== 'acceptee') throw new ErreurHttp(409, 'coordination_statut_incompatible');
      n = await maj('en_cours');
      const ancien = r.lit_id ? await changerEtat(c, pool, u.id, r.lit_id, 'nettoyage', { detail: `Départ de ${r.reference} vers un autre CHSLD (${co.numero})` }) : null;
      if (ancien) await tache(c, r.etablissement_id, u, { type: 'entretien', titre: `Nettoyer ${ancien.code} après le départ de ${r.reference}`, lit_id: ancien.id, assigne_role: 'entretien' });
      await c.query(`UPDATE residents SET statut = 'transfert_en_cours', lit_id = NULL, version = version + 1, modifie_le = now() WHERE id = $1`, [r.id]);
      await mouvement(c, r, 'transfert_sortant', u, { de: ancien?.id, autre: co.destination_id, coordination: co.id, detail: 'Départ confirmé' });
    } else if (t === 'transfert_chsld' && cote === 'destination' && a === 'confirmer_arrivee') {
      if (co.statut !== 'en_cours') throw new ErreurHttp(409, 'coordination_statut_incompatible');
      exigerFictifs();
      const l = await changerEtat(c, pool, u.id, co.lit_id, 'occupe', { detail: `Arrivée de ${co.resident_ref} (${co.numero})` });
      // Le dossier suit le résident : identité, langue, accessibilité et contacts actifs ; la vérification de représentation est à refaire.
      const nouveau = (await c.query(`INSERT INTO residents (etablissement_id, reference, prenom, nom, nom_usage, date_naissance, dossier_officiel, langue, telephone, courriel,
          accessibilite, statut, lit_id, admis_le, cree_par)
        SELECT $2, reference, prenom, nom, nom_usage, date_naissance, dossier_officiel, langue, telephone, courriel, accessibilite, 'present', $3, now(), $4 FROM residents WHERE id = $1 RETURNING *`,
      [r.id, co.destination_id, l.id, u.id])).rows[0];
      await c.query(`INSERT INTO resident_contacts (resident_id, prenom, nom, relation, telephone, courriel, adresse, rang, principal, contact_urgence, proche_aidant, representant_legal, autorisations, disponibilites, langue)
        SELECT $2, prenom, nom, relation, telephone, courriel, adresse, rang, principal, contact_urgence, proche_aidant, representant_legal, autorisations, disponibilites, langue
          FROM resident_contacts WHERE resident_id = $1 AND actif`, [r.id, nouveau.id]);
      await c.query(`UPDATE residents SET statut = 'transfere', version = version + 1, modifie_le = now() WHERE id = $1`, [r.id]);
      n = await maj('recue');
      await mouvement(c, nouveau, 'transfert_entrant', u, { vers: l.id, autre: co.origine_id, coordination: co.id, detail: `Arrivée confirmée (${co.numero})` });
      await mouvement(c, r, 'transfert_sortant', u, { autre: co.destination_id, coordination: co.id, detail: 'Réception confirmée par le CHSLD d’accueil' });
    } else if (t === 'transfert_chsld' && cote === 'origine' && a === 'annuler') {
      if (!['envoyee', 'acceptee'].includes(co.statut)) throw new ErreurHttp(409, 'coordination_statut_incompatible');
      if (co.lit_id && co.statut === 'acceptee') await changerEtat(c, pool, u.id, co.lit_id, 'libre', { detail: `${co.numero} annulé` });
      n = await maj('annulee');
      await c.query(`UPDATE residents SET statut = 'present', version = version + 1 WHERE id = $1 AND statut = 'transfert_en_cours'`, [r.id]);
    // -------- incidents (retard, prolongation, informations manquantes), signalés par l'un ou l'autre
    } else if (a === 'incident') {
      const inc = String(b.incident || '');
      if (!['retour_retarde', 'chambre_indisponible', 'informations_manquantes', 'hospitalisation_prolongee'].includes(inc)) throw new ErreurHttp(400, 'incident_invalide');
      const retour = b.retour_prevu_le ? new Date(b.retour_prevu_le) : null;
      if (retour && Number.isNaN(retour.getTime())) throw new ErreurHttp(400, 'date_invalide');
      n = await maj(co.statut, { incident: inc, retour });
    } else throw new ErreurHttp(409, 'action_coordination_interdite');
    await etape(c, n, a === 'incident' ? `incident:${b.incident}` : n.statut, etabId, u, texte(b.detail, 200));
    await journalChsld(c, etabId, u, 'Coordination', `${co.numero} · ${a} · ${co.resident_ref}`);
    return n;
  });
}
/** L'hôpital prépare le retour d'un résident qu'il a reçu (hospitalisation confirmée ou en cours chez lui). */
async function preparerRetour(pool, u, hospitalisationId, b) {
  const h0 = (await pool.query('SELECT * FROM coordinations WHERE id = $1', [hospitalisationId])).rows[0];
  if (!h0 || h0.type !== 'hospitalisation') throw new ErreurHttp(404, 'coordination_introuvable');
  exigerEtablissement(u, h0.destination_id);
  if (!GERER.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const retour = b.retour_prevu_le ? new Date(b.retour_prevu_le) : null;
  if (!retour || Number.isNaN(retour.getTime())) throw new ErreurHttp(400, 'date_invalide');
  return transaction(pool, async (c) => {
    const h = (await c.query('SELECT * FROM coordinations WHERE id = $1 FOR UPDATE', [hospitalisationId])).rows[0];
    if (!['en_cours', 'recue'].includes(h.statut)) throw new ErreurHttp(409, 'coordination_statut_incompatible');
    const co = (await c.query(`INSERT INTO coordinations (numero, type, resident_id, resident_ref, origine_id, destination_id, statut, retour_prevu_le, liee_id, expire_le, cree_par, motif_admin)
      VALUES ($1, 'retour', $2, $3, $4, $5, 'envoyee', $6, $7, $6::timestamptz + interval '2 days', $8, $9) RETURNING *`,
    [await numeroCoordination(c), h.resident_id, h.resident_ref, h.destination_id, h.origine_id, retour, h.id, u.id, texte(b.motif_admin, 200)])).rows[0];
    await etape(c, co, 'envoyee', h.destination_id, u, 'Retour préparé par l’hôpital');
    const r = (await c.query('SELECT * FROM residents WHERE id = $1', [h.resident_id])).rows[0];
    await mouvement(c, r, 'retour_prevu', u, { autre: h.destination_id, coordination: co.id, detail: `Retour proposé par l’hôpital pour le ${retour.toISOString().slice(0, 10)}` });
    await journalChsld(c, h.destination_id, u, 'Retour vers CHSLD préparé', `${h.resident_ref} · ${co.numero}`);
    return co;
  });
}
/** Demande de transfert vers un autre CHSLD du réseau : préparée par l'origine ; une place disponible n'est jamais une garantie. */
async function preparerTransfertChsld(pool, u, residentId, b) {
  const { e } = await lireResident(pool, u, residentId, { roles: GERER, module: 'reseau_chsld' });
  const d = (await pool.query(`SELECT id, nom, partage FROM etablissements WHERE id = $1 AND type_etablissement = 'chsld' AND actif AND module_actif`, [Number(b.destination_id)])).rows[0];
  if (!d || d.id === e.id || d.partage === 'aucun') throw new ErreurHttp(404, 'chsld_introuvable');
  return transaction(pool, async (c) => {
    const r = await verrouResident(c, residentId); versionAttendue(r, b.version);
    if (r.statut !== 'present') throw new ErreurHttp(409, 'resident_statut_incompatible');
    const co = (await c.query(`INSERT INTO coordinations (numero, type, resident_id, resident_ref, origine_id, destination_id, statut, motif_admin, expire_le, cree_par)
      VALUES ($1, 'transfert_chsld', $2, $3, $4, $5, 'envoyee', $6, now() + interval '7 days', $7) RETURNING *`, [await numeroCoordination(c), r.id, r.reference, e.id, d.id, texte(b.motif_admin, 200), u.id])).rows[0];
    await etape(c, co, 'envoyee', e.id, u, `Demande transmise à ${d.nom}`);
    await mouvement(c, r, 'transfert_prepare', u, { autre: d.id, coordination: co.id, detail: `Demande transmise (${co.numero}) ; en attente de la confirmation des responsables` });
    await journalChsld(c, e.id, u, 'Transfert inter-CHSLD demandé', `${r.reference} · ${co.numero}`);
    return co;
  });
}
/** Coordinations visibles pour un établissement (hôpital ou CHSLD) : références seulement, jamais les noms des résidents. */
async function listeCoordinations(pool, u, etabId, q = {}) {
  exigerEtablissement(u, etabId);
  await expirerCoordinations(pool);
  return (await pool.query(`SELECT c.id, c.numero, c.type, c.statut, c.resident_ref, c.retour_prevu_le, c.incident, c.version, c.cree_le, c.modifie_le, c.liee_id,
      c.origine_id, o.nom AS origine, c.destination_id, d.nom AS destination, (c.destination_id = $1) AS entrante, l.code AS lit,
      (SELECT json_agg(json_build_object('statut', x.statut, 'date', x.date, 'detail', x.detail) ORDER BY x.date) FROM coordination_etapes x WHERE x.coordination_id = c.id) AS etapes
    FROM coordinations c JOIN etablissements o ON o.id = c.origine_id JOIN etablissements d ON d.id = c.destination_id LEFT JOIN lits l ON l.id = c.lit_id AND l.etablissement_id = $1
    WHERE (c.origine_id = $1 OR c.destination_id = $1) ${q.toutes ? '' : "AND (c.statut IN ('preparee', 'envoyee', 'acceptee', 'en_cours') OR c.modifie_le > now() - interval '3 days')"}
    ORDER BY c.modifie_le DESC LIMIT 200`, [etabId])).rows;
}
/** Capacités partagées des autres CHSLD (nombre de places par type d'unité) ; aucune garantie d'admission. */
async function reseau(pool, u, etabId) {
  const e = await etabChsld(pool, u, etabId, { module: 'reseau_chsld' });
  const rows = (await pool.query(`SELECT x.id, x.nom, x.ville, x.partage, t.nom AS unite, count(*) FILTER (WHERE l.etat = 'libre')::int AS libres,
      count(*) FILTER (WHERE l.etat = 'libre' AND l.disponibilite_confirmee_le >= now() - interval '24 hours')::int AS confirmees, max(l.disponibilite_confirmee_le) AS confirme_le
    FROM etablissements x JOIN lits l ON l.etablissement_id = x.id JOIN types_unite t ON t.id = l.type_id
    WHERE x.type_etablissement = 'chsld' AND x.actif AND x.module_actif AND x.id <> $1 AND x.partage <> 'aucun' GROUP BY x.id, t.id ORDER BY x.nom, t.ordre`, [e.id])).rows;
  const hopitaux = (await pool.query(`SELECT id, nom, ville FROM etablissements WHERE type_etablissement = 'hopital' AND actif ORDER BY nom`)).rows;
  return { chsld: rows, hopitaux, avertissement: 'disponibilite_non_garantie' };
}

/* ------------------------------------------------------------------ tâches et transmissions */
async function listeTaches(pool, u, etabId, q = {}) {
  const e = await etabChsld(pool, u, etabId, { roles: [...CONSULTER, 'entretien'] });
  const p = [e.id]; let cond = '';
  if (u.role === 'entretien') cond = ` AND t.type IN ('entretien', 'preparation_chambre')`;
  if (!q.toutes) cond += ` AND t.statut IN ('a_faire', 'en_cours')`;
  return (await pool.query(`SELECT t.*, l.code AS lit, r.reference AS resident_ref, cu.nom AS cree_par_nom FROM taches_etab t LEFT JOIN lits l ON l.id = t.lit_id
    LEFT JOIN residents r ON r.id = t.resident_id LEFT JOIN utilisateurs cu ON cu.id = t.cree_par WHERE t.etablissement_id = $1${cond} ORDER BY t.echeance NULLS LAST, t.cree_le LIMIT 300`, p)).rows;
}
async function creerTache(pool, u, b) {
  const e = await etabChsld(pool, u, Number(b.etablissement_id), { roles: CONSULTER, module: 'taches' });
  if (!['entretien', 'preparation_chambre', 'administratif', 'transmission', 'relance'].includes(b.type)) throw new ErreurHttp(400, 'tache_invalide');
  const titre = texte(b.titre, 160); if (!titre) throw new ErreurHttp(400, 'tache_invalide');
  if (b.lit_id && !(await pool.query('SELECT 1 FROM lits WHERE id = $1 AND etablissement_id = $2', [Number(b.lit_id), e.id])).rowCount) throw new ErreurHttp(404, 'lit_introuvable');
  if (b.resident_id && !(await pool.query('SELECT 1 FROM residents WHERE id = $1 AND etablissement_id = $2', [Number(b.resident_id), e.id])).rowCount) throw new ErreurHttp(404, 'resident_introuvable');
  const assigne = ['coordonnateur', 'entretien', 'admin_etab', 'equipe_soins'].includes(b.assigne_role) ? b.assigne_role : null;
  const echeance = b.echeance ? new Date(b.echeance) : null;
  if (echeance && Number.isNaN(echeance.getTime())) throw new ErreurHttp(400, 'date_invalide');
  return transaction(pool, async (c) => {
    const t = await tache(c, e.id, u, { type: b.type, titre, detail: texte(b.detail, 1000), lit_id: Number(b.lit_id) || null, resident_id: Number(b.resident_id) || null, assigne_role: assigne, echeance });
    // Le titre est un texte libre (il peut contenir un nom) : le journal immuable ne garde que le type et le numéro.
    await journalChsld(c, e.id, u, 'Tâche créée', `${b.type} · n° ${t.id}`);
    return t;
  });
}
async function statutTache(pool, u, id, b) {
  const t0 = (await pool.query('SELECT * FROM taches_etab WHERE id = $1', [id])).rows[0];
  if (!t0) throw new ErreurHttp(404, 'tache_introuvable');
  const e = await etabChsld(pool, u, t0.etablissement_id, { roles: [...CONSULTER, 'entretien'] });
  if (u.role === 'entretien' && !['entretien', 'preparation_chambre'].includes(t0.type)) throw new ErreurHttp(403, 'role_insuffisant');
  if (!['a_faire', 'en_cours', 'faite', 'annulee'].includes(b.statut)) throw new ErreurHttp(400, 'tache_invalide');
  return transaction(pool, async (c) => {
    const t = (await c.query('SELECT * FROM taches_etab WHERE id = $1 FOR UPDATE', [id])).rows[0]; versionAttendue(t, b.version);
    if (['faite', 'annulee'].includes(t.statut)) throw new ErreurHttp(409, 'tache_close');
    const n = (await c.query(`UPDATE taches_etab SET statut = $2, fait_par = CASE WHEN $2 = 'faite' THEN $3::int ELSE fait_par END, fait_le = CASE WHEN $2 = 'faite' THEN now() ELSE fait_le END,
      version = version + 1 WHERE id = $1 RETURNING *`, [id, b.statut, u.id])).rows[0];
    await journalChsld(c, e.id, u, 'Tâche', `${t.type} · n° ${t.id} · ${b.statut}`);
    return n;
  });
}

/* ------------------------------------------------------------------ communications avec les proches */
/** Le proche doit être autorisé pour la catégorie de l'échange : sinon refus (aucune divulgation à un proche non habilité). */
async function creerCommunication(pool, u, residentId, b) {
  const { r, e } = await lireResident(pool, u, residentId, { roles: CONSULTER, module: 'proches' });
  const k = (await pool.query('SELECT * FROM resident_contacts WHERE id = $1 AND resident_id = $2 AND actif', [Number(b.contact_id), r.id])).rows[0];
  if (!k) throw new ErreurHttp(404, 'contact_introuvable');
  if (!['appel', 'message', 'rappel_demande', 'rendez_vous'].includes(b.type) || !CATEGORIES.includes(b.categorie)) throw new ErreurHttp(400, 'communication_invalide');
  if (!k.autorisations.includes(b.categorie)) throw new ErreurHttp(403, 'proche_non_autorise', { categorie: b.categorie });
  const sujet = texte(b.sujet, 200); if (!sujet) throw new ErreurHttp(400, 'communication_invalide');
  const prevu = b.prevu_le ? new Date(b.prevu_le) : null;
  if (prevu && Number.isNaN(prevu.getTime())) throw new ErreurHttp(400, 'date_invalide');
  const fait = b.fait === true;
  return transaction(pool, async (c) => {
    const n = (await c.query(`INSERT INTO communications_proches (resident_id, contact_id, type, sens, categorie, sujet, statut, prevu_le, fait_le, par)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`, [r.id, k.id, b.type, b.sens === 'entrant' ? 'entrant' : 'sortant', b.categorie, sujet, fait ? 'fait' : 'a_faire', prevu, fait ? new Date() : null, u.id])).rows[0];
    await journalChsld(c, e.id, u, 'Communication avec un proche', `${r.reference} · ${b.type} · ${b.categorie}`);
    return n;
  });
}
async function statutCommunication(pool, u, id, b) {
  const x = (await pool.query('SELECT * FROM communications_proches WHERE id = $1', [id])).rows[0];
  if (!x) throw new ErreurHttp(404, 'communication_introuvable');
  const { e } = await lireResident(pool, u, x.resident_id, { roles: CONSULTER, module: 'proches' });
  if (!['fait', 'annule'].includes(b.statut) || x.statut !== 'a_faire') throw new ErreurHttp(409, 'communication_close');
  return transaction(pool, async (c) => {
    const n = (await c.query(`UPDATE communications_proches SET statut = $2, fait_le = CASE WHEN $2 = 'fait' THEN now() ELSE NULL END WHERE id = $1 RETURNING *`, [id, b.statut])).rows[0];
    await journalChsld(c, e.id, u, 'Communication avec un proche', `${b.statut}`);
    return n;
  });
}

/* ------------------------------------------------------------------ places et indicateurs */
async function places(pool, u, etabId) {
  const e = await etabChsld(pool, u, etabId, { roles: [...CONSULTER, 'entretien'] });
  return (await pool.query(`SELECT l.id, l.code, l.etat, l.version, l.etat_depuis, l.disponibilite_confirmee_le, ch.numero AS chambre, ch.type_chambre, un.nom AS unite, t.nom AS type_unite,
      r.id AS resident_id, r.reference AS resident_ref, CASE WHEN $2 THEN r.prenom || ' ' || r.nom END AS resident_nom, r.statut AS resident_statut
    FROM lits l JOIN chambres ch ON ch.id = l.chambre_id JOIN unites un ON un.id = l.unite_id JOIN types_unite t ON t.id = l.type_id
    LEFT JOIN residents r ON r.lit_id = l.id AND r.statut NOT IN ('sorti', 'transfere') WHERE l.etablissement_id = $1 AND l.actif ORDER BY un.nom, ch.numero, l.code`,
  [e.id, u.role !== 'entretien'])).rows;
}
async function indicateurs(pool, u, etabId, jours = 30) {
  const e = await etabChsld(pool, u, etabId);
  const j = Math.min(365, Math.max(1, Number(jours) || 30));
  const p = (await accueil(pool, u, etabId)).places;
  const mvts = Object.fromEntries((await pool.query(`SELECT type, count(*)::int n FROM resident_mouvements WHERE etablissement_id = $1 AND date > now() - make_interval(days => $2) GROUP BY type`, [e.id, j])).rows.map((x) => [x.type, x.n]));
  const delaiDemande = (await pool.query(`SELECT avg(EXTRACT(EPOCH FROM (x.date - d.cree_le)) / 86400)::float AS jours FROM demandes_hebergement d
    JOIN demande_hebergement_etapes x ON x.demande_id = d.id AND x.statut = 'admise' WHERE d.etablissement_id = $1 AND x.date > now() - make_interval(days => $2)`, [e.id, j])).rows[0].jours;
  const preparation = (await pool.query(`SELECT avg(EXTRACT(EPOCH FROM (fin.date - debut.date)) / 60)::float AS minutes FROM journal debut
    JOIN LATERAL (SELECT date FROM journal f WHERE f.lit_id = debut.lit_id AND f.nouvel_etat = 'libre' AND f.date > debut.date ORDER BY f.date LIMIT 1) fin ON true
    WHERE debut.etablissement_id = $1 AND debut.nouvel_etat = 'nettoyage' AND debut.date > now() - make_interval(days => $2)`, [e.id, j])).rows[0].minutes;
  const taches = (await pool.query(`SELECT count(*) FILTER (WHERE statut = 'faite')::int AS faites, count(*) FILTER (WHERE statut IN ('a_faire', 'en_cours'))::int AS ouvertes,
      count(*) FILTER (WHERE statut IN ('a_faire', 'en_cours') AND echeance < now())::int AS en_retard FROM taches_etab WHERE etablissement_id = $1 AND cree_le > now() - make_interval(days => $2)`, [e.id, j])).rows[0];
  const occupation = p.dotees ? Math.round(((p.occupees + p.conservees + p.reservees) / p.dotees) * 1000) / 10 : null;
  return { jours: j, places: p, occupation, mouvements: mvts, delai_demande_jours: delaiDemande == null ? null : Math.round(delaiDemande * 10) / 10,
    preparation_minutes: preparation == null ? null : Math.round(preparation), taches };
}

module.exports = { accueil, listeResidents, ficheResident, creerResident, modifierResident, ajouterContact, modifierContact, verifierRepresentant,
  reserverPlace, confirmerArrivee, changerChambre, sortie, absence, listeDemandes, creerDemande, actionDemande, preparerHospitalisation, actionCoordination,
  preparerRetour, preparerTransfertChsld, listeCoordinations, reseau, listeTaches, creerTache, statutTache, creerCommunication, statutCommunication,
  places, indicateurs, etabChsld, CATEGORIES, RELATIONS, DOCUMENTS, ACCESSIBILITE, exigerFictifs };
