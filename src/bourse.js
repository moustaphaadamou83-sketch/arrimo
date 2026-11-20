'use strict';
/**
 * Bourse des places (cahier v2, C.5 ; 20 nov. 2026) : places libres et à venir de toutes les ressources d'hébergement (CHSLD, privés,
 * RPA, RI, RTF, maisons des aînés, soins palliatifs, HAD, santé mentale), filtres par type, besoins et distance, classement
 * EXPLIQUÉ : besoins couverts (60) + proximité (40). Neutralité : aucun abonnement, licence ni paiement n'entre dans le calcul
 * (aucune colonne de module ni de licence n'est lue pour classer) ; un invité voit exactement le même ordre.
 * Fiche de transfert d'une page (sans diagnostic), vue de groupe, lien invité nominatif (7 jours, révocable, journalisé).
 */
const crypto = require('crypto');
const { ErreurHttp, transaction } = require('./db');
const TE = require('./types-etablissement');
const besoinsNsa = require('./nsa-besoins');

const GENRES = ['chsld', 'chsld_prive', 'rpa', 'ri', 'rtf', 'maison_aines', 'soins_palliatifs', 'hospitalisation_domicile', 'sante_mentale'];
const POIDS = { besoins: 60, proximite: 40 };
const RAYON_KM = 100;
const genreDe = (e) => (GENRES.includes(e.type_local_code) ? e.type_local_code : 'chsld');
const kmEntre = (a, b) => { if (a?.latitude == null || b?.latitude == null) return null; const r = (x) => (x * Math.PI) / 180; const h = Math.sin(r(b.latitude - a.latitude) / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2; return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 10) / 10; };
const empreinte = (j) => crypto.createHash('sha256').update(String(j)).digest('hex');
const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

/** Établissement demandeur (module Bourse actif) : point de départ des distances. */
async function demandeur(db, u, etabId) {
  const id = entier(etabId);
  if (!id || !(u.gestionnaire || (u.etabs || []).map(Number).includes(id))) throw new ErreurHttp(403, 'etab_interdit');
  if (u.role === 'entretien') throw new ErreurHttp(403, 'role_entretien');
  const e = (await db.query('SELECT id, nom, latitude, longitude, modules, type_etablissement FROM etablissements WHERE id = $1 AND actif', [id])).rows[0];
  if (!e) throw new ErreurHttp(404, 'etab_introuvable');
  if (!TE.moduleActif(e, 'bourse_places')) throw new ErreurHttp(403, 'module_desactive', { module: 'bourse_places' });
  return e;
}

/**
 * Classement : la même fonction pour un utilisateur et pour un invité. Les colonnes lues sont listées ici ; aucune ne parle de
 * licence, de module ni de paiement (test de neutralité).
 */
async function classer(db, depart, q = {}) {
  const besoins = String(q.besoins || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (besoins.some((x) => !besoinsNsa.CODES.includes(x))) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'besoins' });
  const genre = q.genre ? String(q.genre) : null;
  if (genre && !GENRES.includes(genre)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'genre' });
  const max = q.distance_max != null && q.distance_max !== '' ? Number(q.distance_max) : null;
  if (max != null && !(max > 0 && max <= 2000)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'distance_max' });
  const rows = (await db.query(`SELECT e.id, e.nom, e.ville, e.latitude, e.longitude, e.type_local_code, e.groupe_id, g.nom AS groupe,
      COALESCE(p.capacites, '{}') AS capacites, COALESCE(p.sexes, 'mixte') AS sexes, COALESCE(p.langues, '{fr}') AS langues, COALESCE(p.delai_admission_jours, 0) AS delai,
      p.places_libres_declarees,
      (SELECT count(*)::int FROM lits l WHERE l.etablissement_id = e.id AND l.etat = 'libre' AND l.actif) AS lits_libres,
      (SELECT count(*)::int FROM places_a_venir a WHERE a.etablissement_id = e.id AND a.statut = 'ouverte' AND a.date_prevue BETWEEN current_date AND current_date + 14) AS a_venir,
      (SELECT min(a.date_prevue)::text FROM places_a_venir a WHERE a.etablissement_id = e.id AND a.statut = 'ouverte' AND a.date_prevue >= current_date) AS prochaine
    FROM etablissements e LEFT JOIN ressource_profils p ON p.etablissement_id = e.id LEFT JOIN groupes_ressources g ON g.id = e.groupe_id
    WHERE e.type_etablissement = 'chsld' AND e.actif AND e.module_actif AND e.id <> $1`, [depart.id || 0])).rows;
  const lignes = [];
  for (const r of rows) {
    const g = genreDe(r);
    if (genre && g !== genre) continue;
    const libres = r.places_libres_declarees != null ? r.places_libres_declarees : r.lits_libres;
    if (!libres && !r.a_venir) continue;
    const km = kmEntre(depart, r);
    if (max != null && (km == null || km > max)) continue;
    const couverts = besoins.filter((b) => r.capacites.includes(b));
    const pBesoins = besoins.length ? Math.round((POIDS.besoins * couverts.length) / besoins.length) : POIDS.besoins;
    const pProx = km == null ? 0 : Math.round(POIDS.proximite * Math.max(0, 1 - km / RAYON_KM));
    lignes.push({ id: r.id, nom: r.nom, ville: r.ville, genre: g, type: TE.nomCourt(r), groupe: r.groupe, groupe_id: r.groupe_id, libres, a_venir: r.a_venir, prochaine: r.prochaine,
      distance_km: km, delai_admission_jours: r.delai, langues: r.langues,
      score: pBesoins + pProx, raison: { besoins_couverts: couverts.length, besoins_demandes: besoins.length, manquants: besoins.filter((b) => !r.capacites.includes(b)), km, points_besoins: pBesoins, points_proximite: pProx } });
  }
  lignes.sort((a, b) => b.score - a.score || (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9) || a.nom.localeCompare(b.nom));
  return { formule: POIDS, rayon_km: RAYON_KM, places: lignes };
}
async function places(pool, u, q = {}) {
  const e = await demandeur(pool, u, q.etablissement_id);
  return { ...(await classer(pool, e, q)), genres: GENRES };
}

/** Fiche de transfert d'une page, imprimable, SANS diagnostic : tranche d'âge, besoins en catégories, orientation, date souhaitée. */
async function fiche(pool, u, litId) {
  const l = (await pool.query(`SELECT l.id, l.code, l.patient_ref, l.etablissement_id, l.nsa_orientation, l.nsa_depuis, e.nom AS hopital, e.ville,
      ep.id AS episode_id, nb.codes, nb.chambre_sexe, nb.langue,
      (SELECT pa.date_naissance FROM patients pa WHERE pa.etablissement_id = l.etablissement_id AND pa.reference = l.patient_ref LIMIT 1) AS naissance
    FROM lits l JOIN etablissements e ON e.id = l.etablissement_id LEFT JOIN nsa_episodes ep ON ep.lit_id = l.id AND ep.statut = 'actif'
    LEFT JOIN nsa_besoins nb ON nb.episode_id = ep.id WHERE l.id = $1`, [entier(litId)])).rows[0];
  if (!l) throw new ErreurHttp(404, 'lit_introuvable');
  await demandeur(pool, u, l.etablissement_id);
  if (!l.nsa_depuis) throw new ErreurHttp(409, 'lit_non_nsa');
  let tranche = null;
  if (l.naissance) {
    const age = Math.floor((Date.now() - new Date(l.naissance).getTime()) / (365.25 * 24 * 3600000));
    tranche = age < 65 ? 'moins_65' : age < 75 ? '65_74' : age < 85 ? '75_84' : '85_plus';
  }
  return { reference: l.patient_ref, hopital: l.hopital, ville: l.ville, lit: l.code, orientation: l.nsa_orientation, nsa_depuis: l.nsa_depuis,
    jours_nsa: Math.floor((Date.now() - new Date(l.nsa_depuis).getTime()) / 86400000), tranche_age: tranche, besoins: l.codes || [], chambre_sexe: l.chambre_sexe || 'indifferent',
    langue: l.langue || null, date_souhaitee: new Date().toISOString().slice(0, 10), mention: 'sans_diagnostic' };
}

/** Vue de groupe : places des résidences d'un même groupe (le groupe de l'établissement demandeur, ou celui demandé). */
async function groupe(pool, u, q = {}) {
  const e = await demandeur(pool, u, q.etablissement_id);
  const gid = entier(q.groupe_id) || (await pool.query('SELECT groupe_id FROM etablissements WHERE id = $1', [e.id])).rows[0]?.groupe_id;
  if (!gid) return { groupe: null, places: [] };
  const g = (await pool.query('SELECT id, code, nom FROM groupes_ressources WHERE id = $1', [gid])).rows[0];
  if (!g) throw new ErreurHttp(404, 'groupe_introuvable');
  const c = await classer(pool, e, q);
  return { groupe: g, places: c.places.filter((p) => p.groupe_id === gid) };
}
/**
 * Demande refusée par une résidence : une autre résidence du même groupe peut être PROPOSÉE à l'hôpital, qui est averti et garde la main
 * (aucune demande n'est créée ni transférée sans son geste).
 */
async function proposerDansGroupe(pool, u, demandeId, b = {}) {
  const d = (await pool.query(`SELECT d.*, e.groupe_id, e.nom AS ressource FROM demandes_hebergement d JOIN etablissements e ON e.id = d.etablissement_id WHERE d.id = $1`, [entier(demandeId)])).rows[0];
  if (!d) throw new ErreurHttp(404, 'demande_introuvable');
  if (!(u.gestionnaire || (u.etabs || []).map(Number).includes(d.etablissement_id))) throw new ErreurHttp(404, 'demande_introuvable');
  if (d.statut !== 'refusee' || !d.hopital_id) throw new ErreurHttp(409, 'demande_statut_incompatible');
  const cible = (await pool.query('SELECT id, nom, groupe_id FROM etablissements WHERE id = $1 AND actif AND type_etablissement = $2', [entier(b.etablissement_id), 'chsld'])).rows[0];
  if (!cible || !d.groupe_id || cible.groupe_id !== d.groupe_id || cible.id === d.etablissement_id) throw new ErreurHttp(409, 'hors_groupe');
  return transaction(pool, async (c) => {
    await require('./services').notifier(c, d.hopital_id, null, 'bourse_groupe_propose', { numero: d.numero, ressource: d.ressource, autre: cible.nom });
    await c.query(`INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Autre résidence du groupe proposée', $3)`, [d.etablissement_id, u.id, `${d.numero} → ${cible.nom}`]);
    return { propose: cible.nom, hopital_averti: true };
  });
}

/* ------------------------------------------------------------------ lien invité */
async function inviter(pool, u, b = {}) {
  const e = await demandeur(pool, u, b.etablissement_id);
  if (!['coordonnateur', 'admin_etab', 'gestionnaire'].includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const courriel = String(b.courriel || '').trim().toLowerCase(); const nom = String(b.nom || '').trim(); const org = String(b.organisation || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(courriel) || /@(gmail|hotmail|outlook|yahoo|live|icloud)\./.test(courriel)) throw new ErreurHttp(400, 'courriel_professionnel_requis');
  if (nom.length < 2 || org.length < 2) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'nom' });
  const jeton = crypto.randomBytes(24).toString('base64url');
  const r = await transaction(pool, async (c) => {
    const i = (await c.query(`INSERT INTO bourse_invitations (jeton_empreinte, courriel, nom, organisation, etablissement_id, expire_le, cree_par)
      VALUES ($1, $2, $3, $4, $5, now() + interval '7 days', $6) RETURNING id, courriel, nom, organisation, expire_le`, [empreinte(jeton), courriel, nom, org, e.id, u.id])).rows[0];
    await require('./admin').journalAdmin(c, u, 'Lien invité de la bourse créé', courriel, `${nom} · ${org} · expire ${i.expire_le.toISOString()}`, e.id);
    return i;
  });
  // Le jeton n'est rendu qu'une fois (lien à transmettre) ; seule son empreinte est gardée
  return { ...r, lien: `/bourse-invite#${jeton}` };
}
async function revoquer(pool, u, id) {
  const i = (await pool.query('SELECT * FROM bourse_invitations WHERE id = $1', [entier(id)])).rows[0];
  if (!i) throw new ErreurHttp(404, 'invitation_introuvable');
  await demandeur(pool, u, i.etablissement_id);
  await pool.query('UPDATE bourse_invitations SET revoque_le = now() WHERE id = $1 AND revoque_le IS NULL', [i.id]);
  await require('./admin').journalAdmin(pool, u, 'Lien invité de la bourse révoqué', i.courriel, '', i.etablissement_id);
  return { revoque: true };
}
async function invitations(pool, u, etabId) {
  const e = await demandeur(pool, u, etabId);
  return (await pool.query(`SELECT id, courriel, nom, organisation, expire_le, revoque_le, derniere_utilisation_le, cree_le,
    (revoque_le IS NULL AND expire_le > now()) AS active FROM bourse_invitations WHERE etablissement_id = $1 ORDER BY cree_le DESC LIMIT 100`, [e.id])).rows;
}
/** Invité : jeton valide, non expiré, non révoqué ; chaque usage journalisé. */
async function invite(db, jeton) {
  const i = (await db.query(`SELECT i.*, e.latitude, e.longitude FROM bourse_invitations i JOIN etablissements e ON e.id = i.etablissement_id WHERE jeton_empreinte = $1`, [empreinte(jeton || '')])).rows[0];
  if (!i || i.revoque_le || new Date(i.expire_le) <= new Date()) throw new ErreurHttp(401, 'invitation_invalide');
  await db.query('UPDATE bourse_invitations SET derniere_utilisation_le = now() WHERE id = $1', [i.id]);
  return i;
}
async function placesInvite(pool, jeton, q = {}) {
  const i = await invite(pool, jeton);
  await pool.query(`INSERT INTO journal_admin (utilisateur_id, etablissement_id, action, cible, detail) VALUES (NULL, $1, 'Bourse consultée par un invité', $2, $3)`, [i.etablissement_id, i.courriel, i.organisation]);
  const c = await classer(pool, { id: i.etablissement_id, latitude: i.latitude, longitude: i.longitude }, q);
  return { ...c, invite: { nom: i.nom, organisation: i.organisation, expire_le: i.expire_le } };
}
/** Invité : envoi d'une demande d'hébergement (référence externe, besoins en catégories ; aucune identité, aucun diagnostic). */
async function demandeInvite(pool, jeton, b = {}) {
  const i = await invite(pool, jeton);
  const r = (await pool.query("SELECT id, nom, modules, type_etablissement FROM etablissements WHERE id = $1 AND actif AND type_etablissement = 'chsld'", [entier(b.etablissement_id)])).rows[0];
  if (!r || !TE.moduleActif(r, 'demandes_hebergement')) throw new ErreurHttp(404, 'ressource_introuvable');
  const ref = String(b.reference || '').trim();
  if (!/^[A-Za-z0-9-]{3,20}$/.test(ref)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'reference' });
  return transaction(pool, async (c) => {
    const n = (await c.query("SELECT nextval('demande_hebergement_seq') AS n")).rows[0].n;
    const d = (await c.query(`INSERT INTO demandes_hebergement (etablissement_id, numero, provenance, reference_externe, invitation_id) VALUES ($1, $2, 'invite', $3, $4)
      RETURNING id, numero, statut`, [r.id, `DH-${String(n).padStart(5, '0')}`, ref, i.id])).rows[0];
    await c.query('INSERT INTO demande_hebergement_etapes (demande_id, statut, detail) VALUES ($1, $2, $3)', [d.id, 'recue', `Invité : ${i.nom} (${i.organisation})`]);
    await require('./services').notifier(c, r.id, null, 'bourse_demande_invite', { numero: d.numero, organisation: i.organisation });
    await c.query(`INSERT INTO journal_admin (utilisateur_id, etablissement_id, action, cible, detail) VALUES (NULL, $1, 'Demande envoyée par un invité de la bourse', $2, $3)`, [r.id, i.courriel, d.numero]);
    return d;
  });
}

module.exports = { places, classer, fiche, groupe, proposerDansGroupe, inviter, revoquer, invitations, placesInvite, demandeInvite, GENRES, POIDS };
