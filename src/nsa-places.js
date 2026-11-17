/**
 * Parcours NSA vers l'hébergement, lot B (17 nov. 2026 ; cahier docs/cahier-nsa-hebergement.md).
 *
 * - Côté ressource (CHSLD, RPA, RI, RTF, maison des aînés) : profil d'hébergement (capacités, sexes, langues, délai d'admission,
 *   place transitoire) et places à venir (date prévue de libération). Aucune donnée de patient.
 * - Côté hôpital : places compatibles avec l'orientation choisie par l'équipe et les besoins en catégories, libres maintenant
 *   ou à venir, classées sur 100 points avec une phrase d'explication. Poids réglables par établissement (total 100).
 * Arrimo ne décide jamais : il propose et explique ; l'envoi d'une demande reste un geste humain (mêmes règles que l'interface).
 * Les besoins ne sortent jamais de l'hôpital ici : la réponse dit seulement « besoins couverts », sans les nommer aux ressources.
 */
const { transaction, ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const { journaliser } = require('./regles');
const { distanceKm } = require('./services');
const TE = require('./types-etablissement');
const besoinsNsa = require('./nsa-besoins');

const CAPACITES = besoinsNsa.CODES;
const GERER = ['coordonnateur', 'admin_etab', 'gestionnaire'];
const POIDS_DEFAUT = { preference: 30, proximite: 25, delai: 25, langue: 10, reactivite: 10, penalite_refus: 10, horizon_jours: 14 };
const CRITERES = ['preference', 'proximite', 'delai', 'langue', 'reactivite'];
const RAYON_PROXIMITE_KM = 100;
/** Orientation choisie par l'équipe → genre de ressource (et statut pour un CHSLD). */
const ORIENTATION_RESSOURCE = {
  chsld: { genre: 'chsld', statut: 'public' }, chsld_prive_conventionne: { genre: 'chsld', statut: 'conventionne' }, chsld_prive: { genre: 'chsld', statut: 'prive' },
  ri: { genre: 'ri' }, rtf: { genre: 'rtf' }, rpa: { genre: 'rpa' }, maison_aines: { genre: 'maison_aines' },
};
const genre = (e) => (['rpa', 'ri', 'rtf', 'maison_aines'].includes(e.type_local_code) ? e.type_local_code : 'chsld');
const statutDefaut = (e) => (['chsld_prive', 'rpa'].includes(e.type_local_code) ? 'prive' : 'public');
const normaliser = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const entier = (v, min, max, code) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new ErreurHttp(400, code); return n; };
const jourIso = (d) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : null);

/* ------------------------------------------------------------------ côté ressource */
async function ressource(db, u, etabId, { gerer = false } = {}) {
  exigerEtablissement(u, etabId);
  if (u.role === 'entretien' || (gerer && !GERER.includes(u.role))) throw new ErreurHttp(403, 'role_insuffisant');
  const e = (await db.query('SELECT id, nom, type_etablissement, type_local_code, actif, module_actif, modules FROM etablissements WHERE id = $1', [etabId])).rows[0];
  if (!e || e.type_etablissement !== 'chsld' || !e.actif) throw new ErreurHttp(404, 'ressource_introuvable');
  return e;
}
function profilParDefaut(e) {
  return { etablissement_id: e.id, statut_ressource: statutDefaut(e), circuit: genre(e) === 'rpa' ? 'direct' : 'mecanisme_acces', capacites: [], sexes: 'mixte',
    langues: ['fr'], delai_admission_jours: 0, accepte_transitoire: false, version: 0, modifie_le: null, declare: false };
}
async function lireProfil(pool, u, etabId) {
  const e = await ressource(pool, u, etabId);
  const p = (await pool.query('SELECT * FROM ressource_profils WHERE etablissement_id = $1', [e.id])).rows[0];
  return { ...(p ? { ...p, declare: true } : profilParDefaut(e)), genre: genre(e), type: TE.nomCourt(e), capacites_possibles: CAPACITES };
}
async function majProfil(pool, u, etabId, b = {}) {
  const e = await ressource(pool, u, etabId, { gerer: true });
  const capacites = Array.isArray(b.capacites) ? [...new Set(b.capacites)] : [];
  if (!Array.isArray(b.capacites ?? []) || capacites.some((x) => !CAPACITES.includes(x))) throw new ErreurHttp(400, 'profil_hebergement_invalide');
  const langues = Array.isArray(b.langues) ? [...new Set(b.langues)] : ['fr'];
  if (!langues.length || langues.some((x) => !['fr', 'en', 'autre'].includes(x))) throw new ErreurHttp(400, 'profil_hebergement_invalide');
  const statut = b.statut_ressource ?? statutDefaut(e);
  if (!['public', 'conventionne', 'prive'].includes(statut)) throw new ErreurHttp(400, 'profil_hebergement_invalide');
  const circuit = b.circuit ?? 'mecanisme_acces';
  if (!['mecanisme_acces', 'direct'].includes(circuit)) throw new ErreurHttp(400, 'profil_hebergement_invalide');
  const sexes = b.sexes ?? 'mixte';
  if (!['mixte', 'F', 'M'].includes(sexes)) throw new ErreurHttp(400, 'profil_hebergement_invalide');
  const delai = entier(b.delai_admission_jours ?? 0, 0, 90, 'profil_hebergement_invalide');
  return transaction(pool, async (c) => {
    const actuel = (await c.query('SELECT version FROM ressource_profils WHERE etablissement_id = $1 FOR UPDATE', [e.id])).rows[0];
    if (b.version != null && Number(b.version) !== (actuel?.version ?? 0)) throw new ErreurHttp(409, 'version_perimee');
    const p = (await c.query(`INSERT INTO ressource_profils (etablissement_id, statut_ressource, circuit, capacites, sexes, langues, delai_admission_jours, accepte_transitoire, modifie_par)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (etablissement_id) DO UPDATE SET statut_ressource = EXCLUDED.statut_ressource, circuit = EXCLUDED.circuit, capacites = EXCLUDED.capacites, sexes = EXCLUDED.sexes,
        langues = EXCLUDED.langues, delai_admission_jours = EXCLUDED.delai_admission_jours, accepte_transitoire = EXCLUDED.accepte_transitoire, modifie_par = EXCLUDED.modifie_par,
        version = ressource_profils.version + 1, modifie_le = now() RETURNING *`,
    [e.id, statut, circuit, capacites, sexes, langues, delai, b.accepte_transitoire === true, u.id])).rows[0];
    await journaliser(c, { etablissementId: e.id, utilisateurId: u.id, action: 'Profil d’hébergement mis à jour', detail: capacites.join(', ') || 'aucune capacité particulière' });
    return { ...p, declare: true, genre: genre(e), type: TE.nomCourt(e) };
  });
}

async function listePlacesAVenir(pool, u, etabId) {
  const e = await ressource(pool, u, etabId);
  return (await pool.query(`SELECT p.id, p.lit_id, l.code AS lit, p.date_prevue::text AS date_prevue, p.certitude, p.statut, p.version, p.date_prevue < current_date AS expiree
    FROM places_a_venir p LEFT JOIN lits l ON l.id = p.lit_id WHERE p.etablissement_id = $1 AND p.statut = 'ouverte' ORDER BY p.date_prevue, p.id`, [e.id])).rows;
}
function lireDatePrevue(v) {
  const s = String(v || '').slice(0, 10);
  const d = new Date(`${s}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new ErreurHttp(400, 'date_prevue_invalide');
  const auj = new Date().toISOString().slice(0, 10);
  if (s < new Date(Date.now() - 86400000).toISOString().slice(0, 10) || d - new Date(`${auj}T12:00:00Z`) > 90 * 86400000) throw new ErreurHttp(400, 'date_prevue_invalide');
  return s;
}
async function creerPlaceAVenir(pool, u, b = {}) {
  const e = await ressource(pool, u, Number(b.etablissement_id), { gerer: true });
  const date = lireDatePrevue(b.date_prevue);
  const certitude = b.certitude ?? 'probable';
  if (!['confirmee', 'probable'].includes(certitude)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'certitude' });
  const litId = b.lit_id ? Number(b.lit_id) : null;
  return transaction(pool, async (c) => {
    if (litId && !(await c.query('SELECT 1 FROM lits WHERE id = $1 AND etablissement_id = $2 AND actif', [litId, e.id])).rowCount) throw new ErreurHttp(404, 'lit_introuvable');
    const p = (await c.query(`INSERT INTO places_a_venir (etablissement_id, lit_id, date_prevue, certitude, cree_par) VALUES ($1, $2, $3, $4, $5)
      RETURNING id, lit_id, date_prevue::text AS date_prevue, certitude, statut, version`, [e.id, litId, date, certitude, u.id])).rows[0];
    await journaliser(c, { etablissementId: e.id, utilisateurId: u.id, action: 'Place à venir déclarée', detail: `${date} · ${certitude}` });
    return p;
  });
}
async function majPlaceAVenir(pool, u, id, b = {}) {
  const p0 = (await pool.query('SELECT etablissement_id FROM places_a_venir WHERE id = $1', [id])).rows[0];
  if (!p0) throw new ErreurHttp(404, 'place_introuvable');
  const e = await ressource(pool, u, p0.etablissement_id, { gerer: true });
  return transaction(pool, async (c) => {
    const p = (await c.query('SELECT * FROM places_a_venir WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (b.version != null && Number(b.version) !== p.version) throw new ErreurHttp(409, 'version_perimee');
    if (p.statut !== 'ouverte') throw new ErreurHttp(409, 'place_close');
    const statut = b.statut ?? p.statut;
    if (!['ouverte', 'liberee', 'annulee'].includes(statut)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'statut' });
    const date = b.date_prevue !== undefined ? lireDatePrevue(b.date_prevue) : jourIso(p.date_prevue);
    const certitude = b.certitude ?? p.certitude;
    if (!['confirmee', 'probable'].includes(certitude)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'certitude' });
    const n = (await c.query(`UPDATE places_a_venir SET statut = $2, date_prevue = $3, certitude = $4, version = version + 1, modifie_le = now() WHERE id = $1
      RETURNING id, lit_id, date_prevue::text AS date_prevue, certitude, statut, version`, [id, statut, date, certitude])).rows[0];
    await journaliser(c, { etablissementId: e.id, utilisateurId: u.id, action: 'Place à venir mise à jour', detail: `${n.date_prevue} · ${n.certitude} · ${n.statut}` });
    return n;
  });
}

/* ------------------------------------------------------------------ poids du classement (établissement demandeur) */
async function lirePoids(pool, u, etabId) {
  exigerEtablissement(u, etabId);
  const p = (await pool.query('SELECT * FROM nsa_poids WHERE etablissement_id = $1', [etabId])).rows[0];
  return p ? { ...p, par_defaut: false } : { etablissement_id: etabId, ...POIDS_DEFAUT, version: 0, par_defaut: true };
}
async function majPoids(pool, u, etabId, b = {}) {
  exigerEtablissement(u, etabId);
  if (!['admin_etab', 'gestionnaire'].includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const v = Object.fromEntries(CRITERES.map((k) => [k, entier(b[k], 0, 100, 'poids_invalides')]));
  if (CRITERES.reduce((s, k) => s + v[k], 0) !== 100) throw new ErreurHttp(400, 'poids_total_100');
  const penalite = entier(b.penalite_refus ?? POIDS_DEFAUT.penalite_refus, 0, 50, 'poids_invalides');
  const horizon = entier(b.horizon_jours ?? POIDS_DEFAUT.horizon_jours, 1, 60, 'poids_invalides');
  return transaction(pool, async (c) => {
    const actuel = (await c.query('SELECT version FROM nsa_poids WHERE etablissement_id = $1 FOR UPDATE', [etabId])).rows[0];
    if (b.version != null && Number(b.version) !== (actuel?.version ?? 0)) throw new ErreurHttp(409, 'version_perimee');
    const p = (await c.query(`INSERT INTO nsa_poids (etablissement_id, preference, proximite, delai, langue, reactivite, penalite_refus, horizon_jours, modifie_par)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (etablissement_id) DO UPDATE SET preference = EXCLUDED.preference, proximite = EXCLUDED.proximite, delai = EXCLUDED.delai, langue = EXCLUDED.langue,
        reactivite = EXCLUDED.reactivite, penalite_refus = EXCLUDED.penalite_refus, horizon_jours = EXCLUDED.horizon_jours, modifie_par = EXCLUDED.modifie_par,
        version = nsa_poids.version + 1, modifie_le = now() RETURNING *`,
    [etabId, v.preference, v.proximite, v.delai, v.langue, v.reactivite, penalite, horizon, u.id])).rows[0];
    await journaliser(c, { etablissementId: etabId, utilisateurId: u.id, action: 'Poids du classement NSA modifiés',
      detail: `préférence ${p.preference}, proximité ${p.proximite}, délai ${p.delai}, langue ${p.langue}, réactivité ${p.reactivite} ; pénalité ${p.penalite_refus} ; horizon ${p.horizon_jours} j` });
    return { ...p, par_defaut: false };
  });
}

/* ------------------------------------------------------------------ phrase d'explication */
const MOTS = {
  fr: {
    preference: (r) => `${r.rang === 1 ? '1er' : `${r.rang}e`} choix de la famille`,
    distance: (r) => (r.depuis === 'famille' ? `${r.km} km de ${r.municipalite}` : `${r.km} km de l’hôpital`),
    libre_maintenant: (r) => (r.n > 1 ? `${r.n} places libres aujourd’hui` : 'place libre aujourd’hui'),
    a_venir: (r) => `place prévue le ${dateLisible(r.date, 'fr')}${r.certitude === 'confirmee' ? ' (confirmée)' : ' (probable)'}`,
    delai_admission: (r) => `admission sous ${r.jours} j`,
    besoins_couverts: () => 'besoins couverts',
    langue: (r) => ({ fr: 'services en français', en: 'services en anglais', autre: 'langue de l’usager offerte' })[r.langue],
    reactive: (r) => (r.heures <= 24 ? 'répond en général en moins de 24 h' : `répond en général en ${Math.round(r.heures / 24)} j`),
    reactivite_inconnue: () => 'pas encore d’historique de réponse',
    transitoire: () => 'place transitoire',
    refus_precedent: () => 'a déjà refusé pour ce patient',
  },
  en: {
    preference: (r) => `family’s ${['1st', '2nd', '3rd'][r.rang - 1]} choice`,
    distance: (r) => (r.depuis === 'famille' ? `${r.km} km from ${r.municipalite}` : `${r.km} km from the hospital`),
    libre_maintenant: (r) => (r.n > 1 ? `${r.n} places free today` : 'place free today'),
    a_venir: (r) => `place expected on ${dateLisible(r.date, 'en')}${r.certitude === 'confirmee' ? ' (confirmed)' : ' (likely)'}`,
    delai_admission: (r) => `admission within ${r.jours} days`,
    besoins_couverts: () => 'needs covered',
    langue: (r) => ({ fr: 'services in French', en: 'services in English', autre: 'patient’s language offered' })[r.langue],
    reactive: (r) => (r.heures <= 24 ? 'usually answers within 24 h' : `usually answers within ${Math.round(r.heures / 24)} days`),
    reactivite_inconnue: () => 'no response history yet',
    transitoire: () => 'interim placement',
    refus_precedent: () => 'already declined for this patient',
  },
};
const DATE_FMT = { fr: new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'long', timeZone: 'UTC' }), en: new Intl.DateTimeFormat('en-CA', { month: 'long', day: 'numeric', timeZone: 'UTC' }) };
const dateLisible = (iso, langue) => (DATE_FMT[langue] || DATE_FMT.fr).format(new Date(`${iso}T12:00:00Z`));
function phrase(raisons, langue = 'fr') {
  const m = MOTS[langue] || MOTS.fr;
  const t = raisons.map((r) => m[r.code]?.(r)).filter(Boolean).join(', ');
  return t ? `${t[0].toUpperCase()}${t.slice(1)}.` : '';
}

/* ------------------------------------------------------------------ recherche des places compatibles */
/** Coordonnées d'une municipalité, d'après les établissements connus qui s'y trouvent ; null si elle n'est pas localisée. */
async function localiser(db, municipalite) {
  if (!municipalite) return null;
  const cible = normaliser(municipalite);
  const villes = (await db.query(`SELECT ville, avg(latitude)::float AS latitude, avg(longitude)::float AS longitude FROM etablissements
    WHERE ville IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL GROUP BY ville`)).rows;
  return villes.find((v) => normaliser(v.ville) === cible) || null;
}
/** Délai médian (heures) entre la réception d'une demande et la première réponse de la ressource, sur 90 jours. */
async function reactivites(db) {
  return new Map((await db.query(`SELECT d.etablissement_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r.date - d.cree_le)) / 3600)::float AS heures
    FROM demandes_hebergement d JOIN LATERAL (SELECT min(x.date) AS date FROM demande_hebergement_etapes x WHERE x.demande_id = d.id AND x.date > d.cree_le
      AND x.statut IN ('en_verification', 'place_proposee', 'acceptee', 'refusee')) r ON r.date IS NOT NULL
    WHERE d.cree_le > now() - interval '90 days' GROUP BY d.etablissement_id`)).rows.map((x) => [x.etablissement_id, x.heures]));
}

async function placesCompatibles(pool, u, litId, { langue = 'fr' } = {}) {
  const { lit, ep } = await besoinsNsa.episode(pool, u, litId);
  const l = (await pool.query(`SELECT l.patient_ref, e.id AS hopital_id, e.latitude, e.longitude, e.modules, e.type_etablissement, cp.rayon_km
    FROM lits l JOIN etablissements e ON e.id = l.etablissement_id LEFT JOIN config_pays cp ON cp.id = e.config_id WHERE l.id = $1`, [lit.id])).rows[0];
  const episode = (await pool.query('SELECT orientation, transitoire FROM nsa_episodes WHERE id = $1', [ep.id])).rows[0];
  const b = (await pool.query('SELECT codes, chambre_sexe, langue, municipalite_famille, preferences FROM nsa_besoins WHERE episode_id = $1', [ep.id])).rows[0]
    || { codes: [], chambre_sexe: 'indifferent', langue: null, municipalite_famille: null, preferences: [] };
  const poids = await lirePoids(pool, u, l.hopital_id);
  const H = poids.horizon_jours;
  const cible = ORIENTATION_RESSOURCE[episode.orientation];
  const base = { lit_id: lit.id, code: lit.code, orientation: episode.orientation, transitoire: episode.transitoire, poids, horizon_jours: H,
    besoins_renseignes: !!(b.codes.length || b.municipalite_famille || b.preferences.length || b.langue || b.chambre_sexe !== 'indifferent') };
  if (!cible) return { ...base, sans_ressource: true, propositions: [], exclues: [] };
  const famille = await localiser(pool, b.municipalite_famille);
  const origine = famille ? { latitude: famille.latitude, longitude: famille.longitude } : { latitude: l.latitude, longitude: l.longitude };
  const rayon = Math.min(Number(l.rayon_km) || RAYON_PROXIMITE_KM, RAYON_PROXIMITE_KM);
  const reac = await reactivites(pool);
  const peutEnvoyerHopital = TE.moduleActif({ type_etablissement: 'hopital', modules: l.modules }, 'liaison_chsld');
  const rows = (await pool.query(`SELECT e.id, e.nom, e.ville, e.latitude, e.longitude, e.type_local_code, e.modules, e.type_etablissement, p.etablissement_id IS NOT NULL AS declare,
      p.statut_ressource, p.capacites, p.sexes, p.langues, p.delai_admission_jours, p.accepte_transitoire,
      (SELECT count(*)::int FROM lits x WHERE x.etablissement_id = e.id AND x.etat = 'libre' AND x.actif) AS libres,
      (SELECT json_build_object('date', a.date_prevue::text, 'certitude', a.certitude) FROM places_a_venir a WHERE a.etablissement_id = e.id AND a.statut = 'ouverte'
         AND a.date_prevue >= current_date ORDER BY a.date_prevue, (a.certitude = 'confirmee') DESC LIMIT 1) AS prochaine,
      EXISTS (SELECT 1 FROM demandes_hebergement d WHERE d.etablissement_id = e.id AND d.hopital_lit_id = $1 AND d.reference_externe = $2 AND d.statut = 'refusee') AS a_refuse
    FROM etablissements e LEFT JOIN ressource_profils p ON p.etablissement_id = e.id
    WHERE e.type_etablissement = 'chsld' AND e.actif AND e.module_actif`, [lit.id, l.patient_ref])).rows;
  const auj = new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`);
  const propositions = []; const exclues = [];
  for (const r of rows) {
    const pr = r.declare ? r : { ...profilParDefaut(r), ...{ libres: r.libres, prochaine: r.prochaine } };
    const g = genre(r); const statut = r.declare ? r.statut_ressource : statutDefaut(r);
    const memeGenre = g === cible.genre && (!cible.statut || cible.statut === statut);
    const transitoire = !memeGenre && episode.transitoire && pr.accepte_transitoire;
    if (!memeGenre && !transitoire) continue;   // autre type de ressource : hors de l'orientation choisie par l'équipe
    const fiche = { id: r.id, nom: r.nom, ville: r.ville, type: TE.nomCourt(r), genre: g, statut_ressource: statut, profil_declare: r.declare };
    const manque = b.codes.filter((x) => !(pr.capacites || []).includes(x));
    if (manque.length) { exclues.push({ ...fiche, raison: 'capacite', codes: manque }); continue; }
    if (b.chambre_sexe !== 'indifferent' && pr.sexes !== 'mixte' && pr.sexes !== b.chambre_sexe) { exclues.push({ ...fiche, raison: 'sexe' }); continue; }
    if (!TE.moduleActif(r, 'demandes_hebergement')) { exclues.push({ ...fiche, raison: 'ne_recoit_pas' }); continue; }
    const delaiAdm = pr.delai_admission_jours || 0;
    let joursPlace = null;
    if (r.libres > 0) joursPlace = 0;
    else if (r.prochaine) joursPlace = Math.max(0, Math.round((new Date(`${r.prochaine.date}T12:00:00Z`) - auj) / 86400000));
    if (joursPlace === null || joursPlace > H) { exclues.push({ ...fiche, raison: 'aucune_place', horizon_jours: H }); continue; }
    const eff = joursPlace + delaiAdm;
    const fDelai = r.libres > 0 ? Math.max(0, 1 - eff / H) : Math.min(0.8, Math.max(0.2, 1 - eff / H));
    const rang = (b.preferences || []).indexOf(r.id);
    const fPref = rang < 0 ? 0 : [1, 2 / 3, 1 / 3][rang];
    const km = (origine.latitude != null && r.latitude != null) ? distanceKm(origine, r) : null;
    const fProx = km == null ? 0 : Math.max(0, 1 - km / rayon);
    const fLangue = !b.langue || (pr.langues || ['fr']).includes(b.langue) ? 1 : 0;
    const h = reac.get(r.id);
    const fReac = h == null ? 0.5 : h <= 24 ? 1 : h >= 168 ? 0 : 1 - (h - 24) / 144;
    const f = { preference: fPref, proximite: fProx, delai: fDelai, langue: fLangue, reactivite: fReac };
    const points = Object.fromEntries(CRITERES.map((k) => [k, Math.round(poids[k] * f[k] * 10) / 10]));
    const score = Math.max(0, Math.round(CRITERES.reduce((s, k) => s + poids[k] * f[k], 0) - (r.a_refuse ? poids.penalite_refus : 0)));
    const raisons = [];
    if (rang >= 0) raisons.push({ code: 'preference', rang: rang + 1 });
    if (km != null) raisons.push({ code: 'distance', km, depuis: famille ? 'famille' : 'hopital', municipalite: famille ? famille.ville : null });
    raisons.push(r.libres > 0 ? { code: 'libre_maintenant', n: r.libres } : { code: 'a_venir', date: r.prochaine.date, certitude: r.prochaine.certitude });
    if (delaiAdm > 0) raisons.push({ code: 'delai_admission', jours: delaiAdm });
    if (b.codes.length) raisons.push({ code: 'besoins_couverts' });
    if (b.langue && fLangue) raisons.push({ code: 'langue', langue: b.langue });
    raisons.push(h == null ? { code: 'reactivite_inconnue' } : { code: 'reactive', heures: Math.round(h) });
    if (transitoire) raisons.push({ code: 'transitoire' });
    if (r.a_refuse) raisons.push({ code: 'refus_precedent' });
    propositions.push({ ...fiche, score, points, penalite: r.a_refuse ? poids.penalite_refus : 0, distance_km: km, places_libres: r.libres, prochaine_place: r.prochaine,
      transitoire, raisons, phrase: phrase(raisons, langue), peut_envoyer: peutEnvoyerHopital });
  }
  propositions.sort((a, c) => c.score - a.score || (a.distance_km ?? 1e9) - (c.distance_km ?? 1e9) || a.nom.localeCompare(c.nom));
  propositions.forEach((p, i) => { p.rang = i + 1; });
  exclues.sort((a, c) => a.nom.localeCompare(c.nom));
  return { ...base, municipalite: b.municipalite_famille ? { nom: b.municipalite_famille, localisee: !!famille } : null, propositions, exclues };
}

module.exports = { lireProfil, majProfil, listePlacesAVenir, creerPlaceAVenir, majPlaceAVenir, lirePoids, majPoids, placesCompatibles, phrase, POIDS_DEFAUT, ORIENTATION_RESSOURCE };
