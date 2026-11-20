'use strict';
/**
 * Urgences en direct (cahier v2, C.2 ; décision 4 de Moustafa, 19 nov. 2026).
 * A) Secours : état « fermée temporairement » avec heure de réouverture ; fermetures PLANIFIÉES (début, fin prévue, services touchés en
 *    liste fermée) ; avis automatiques au CCS et aux entreprises ambulancières de la région et aux N urgences voisines, rappel 1 h avant,
 *    début et fin appliqués à l'heure prévue (réouverture à confirmer par l'hôpital) ; une urgence fermée est écartée du classement.
 * B) Page publique et API ouverte : seulement les urgences qui ont accepté d'être publiées (module « urgences_direct » activé dans SH),
 *    état, services et heures, jamais de donnée interne ni de patient ; déclaration trop ancienne marquée « non à jour » ;
 *    911 toujours affiché. DÉMONSTRATION SEULEMENT tant que l'avis juridique et l'accord des urgences ne sont pas obtenus.
 */
const { ErreurHttp, transaction } = require('./db');
const TE = require('./types-etablissement');
const { environnement } = require('./environnement');

const SERVICES = ['toute_urgence', 'pediatrie', 'obstetrique', 'imagerie', 'sante_mentale', 'traumatologie'];
// Catégorie de préalerte → service touché qui écarte l'urgence pour cette catégorie
const SERVICE_DE_CATEGORIE = { pediatrique: 'pediatrie', obstetrique: 'obstetrique', sante_mentale: 'sante_mentale', traumatologie: 'traumatologie' };
const ROLES_HOPITAL = ['coordonnateur', 'gestionnaire', 'admin_etab'];
const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const kmEntre = (a, b) => { const r = (x) => (x * Math.PI) / 180; const h = Math.sin(r(b.latitude - a.latitude) / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2; return 6371 * 2 * Math.asin(Math.sqrt(h)); };

async function hopital(db, u, etabId, { ecrire = false } = {}) {
  const id = entier(etabId);
  if (!id || !(u.gestionnaire || (u.etabs || []).map(Number).includes(id))) throw new ErreurHttp(403, 'etab_interdit');
  if (ecrire && !ROLES_HOPITAL.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const e = (await db.query('SELECT id, nom, latitude, longitude, config_id, modules, type_etablissement, region_id FROM etablissements WHERE id = $1 AND actif', [id])).rows[0];
  if (!e || (e.type_etablissement || 'hopital') !== 'hopital') throw new ErreurHttp(404, 'etab_introuvable');
  if (!TE.moduleActif(e, 'liaison_secours') && !TE.moduleActif(e, 'urgences_direct')) throw new ErreurHttp(403, 'module_desactive', { module: 'urgences_direct' });
  return e;
}

/** Destinataires des avis : CCS et entreprises ambulancières de la région (même région, sinon même profil de pays), N urgences voisines. */
async function destinataires(c, e) {
  const n = (await c.query('SELECT voisins_avises FROM config_pays WHERE id = $1', [e.config_id])).rows[0]?.voisins_avises ?? 3;
  const orgs = (await c.query(`SELECT id FROM organisations_secours WHERE actif AND ((region_id IS NOT NULL AND region_id = $1) OR (region_id IS NULL AND config_id = $2))`,
    [e.region_id, e.config_id])).rows.map((r) => r.id);
  const voisins = (await c.query(`SELECT id, latitude, longitude FROM etablissements WHERE actif AND id <> $1 AND COALESCE(type_etablissement, 'hopital') = 'hopital'
    AND config_id = $2 AND latitude IS NOT NULL`, [e.id, e.config_id])).rows
    .sort((a, b) => kmEntre(e, a) - kmEntre(e, b)).slice(0, n).map((x) => x.id);
  return { orgs, voisins };
}
async function aviser(c, f, e, type) {
  const { orgs, voisins } = await destinataires(c, e);
  const vars = { hopital: e.nom, debut: f.debut_le, fin: f.fin_prevue_le, services: f.services.join(', ') };
  for (const v of voisins) {
    await require('./services').notifier(c, v, null, `urgence_fermeture_${type}`, vars);
    await c.query("INSERT INTO fermeture_avis (fermeture_id, type, destinataire_type, destinataire_id) VALUES ($1, $2, 'etablissement', $3)", [f.id, type, v]);
  }
  for (const o of orgs) await c.query("INSERT INTO fermeture_avis (fermeture_id, type, destinataire_type, destinataire_id) VALUES ($1, $2, 'organisation', $3)", [f.id, type, o]);
  // L'hôpital lui-même est informé des étapes automatiques
  if (['debut', 'fin', 'rappel'].includes(type)) await require('./services').notifier(c, e.id, null, `urgence_fermeture_${type}_moi`, vars);
  await require('./webhooks').emettre(c, { etablissements: voisins, organisations: orgs, evenement: `urgence.fermeture_${type}`,
    charge: { hopital_id: e.id, debut: f.debut_le, fin_prevue: f.fin_prevue_le, services: f.services, statut: f.statut } });
  return { etablissements: voisins.length, organisations: orgs.length };
}

function lireFermeture(b) {
  const debut = new Date(b.debut_le); const fin = new Date(b.fin_prevue_le);
  if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime()) || fin <= debut) throw new ErreurHttp(400, 'fermeture_invalide');
  if (debut < Date.now() - 5 * 60000) throw new ErreurHttp(400, 'fermeture_invalide');
  if (fin - debut > 14 * 24 * 3600000) throw new ErreurHttp(400, 'fermeture_invalide');
  const services = [...new Set(Array.isArray(b.services) ? b.services.map(String) : [])];
  if (!services.length || services.some((s) => !SERVICES.includes(s))) throw new ErreurHttp(400, 'fermeture_invalide');
  return { debut, fin, services };
}

/** Planifier une fermeture : avis immédiat (annonce) aux bons destinataires seulement ; journalisé. */
async function planifier(pool, u, b) {
  const e = await hopital(pool, u, b.etablissement_id, { ecrire: true });
  const { debut, fin, services } = lireFermeture(b);
  const r = await transaction(pool, async (c) => {
    if ((await c.query(`SELECT 1 FROM fermetures_urgence WHERE etablissement_id = $1 AND statut IN ('planifiee', 'en_cours') AND tstzrange(debut_le, fin_prevue_le) && tstzrange($2, $3)`,
      [e.id, debut, fin])).rowCount) throw new ErreurHttp(409, 'fermeture_chevauchement');
    const f = (await c.query(`INSERT INTO fermetures_urgence (etablissement_id, debut_le, fin_prevue_le, services, cree_par) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [e.id, debut, fin, services, u.id])).rows[0];
    const avis = await aviser(c, f, e, 'annonce');
    await c.query(`INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Fermeture de l’urgence planifiée', $3)`,
      [e.id, u.id, `${services.join(', ')} · ${debut.toISOString()} → ${fin.toISOString()}`]);
    return { ...f, avis };
  });
  if (debut <= new Date()) await echeances(pool);
  require('./flux').signaler();
  return r;
}

/** Annuler (planifiée) ou terminer (en cours) une fermeture : avis envoyés, état de l'urgence remis à « ouvert » si elle était fermée. */
async function changer(pool, u, id, b) {
  const action = String(b.action || '');
  if (!['annuler', 'terminer'].includes(action)) throw new ErreurHttp(400, 'action_inconnue');
  const f0 = (await pool.query('SELECT * FROM fermetures_urgence WHERE id = $1', [entier(id)])).rows[0];
  if (!f0) throw new ErreurHttp(404, 'fermeture_introuvable');
  const e = await hopital(pool, u, f0.etablissement_id, { ecrire: true });
  const r = await transaction(pool, async (c) => {
    const f = (await c.query('SELECT * FROM fermetures_urgence WHERE id = $1 FOR UPDATE', [f0.id])).rows[0];
    if (b.version != null && Number(b.version) !== f.version) throw new ErreurHttp(409, 'version_perimee');
    if ((action === 'annuler' && f.statut !== 'planifiee') || (action === 'terminer' && f.statut !== 'en_cours')) throw new ErreurHttp(409, 'fermeture_statut_incompatible');
    const n = (await c.query(`UPDATE fermetures_urgence SET statut = $2, version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`,
      [f.id, action === 'annuler' ? 'annulee' : 'terminee'])).rows[0];
    if (action === 'terminer') await rouvrir(c, e.id, u.id);
    await aviser(c, n, e, action === 'annuler' ? 'annulation' : 'fin');
    await c.query(`INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, $3, $4)`,
      [e.id, u.id, action === 'annuler' ? 'Fermeture de l’urgence annulée' : 'Urgence rouverte', n.services.join(', ')]);
    return n;
  });
  require('./flux').signaler();
  return r;
}
async function rouvrir(c, etabId, auteurId) {
  await c.query(`UPDATE etablissements SET urgence_statut_declare = 'ouvert', urgence_statut_le = now(), urgence_statut_par = $2, reouverture_prevue_le = NULL
    WHERE id = $1 AND urgence_statut_declare = 'fermee_temporairement'`, [etabId, auteurId]);
}

/**
 * Tâche périodique (chaque minute) : rappel 1 h avant, début et fin à l'heure prévue. Toute l'urgence fermée → état
 * « fermée temporairement » avec l'heure de réouverture ; à la fin, l'urgence est rouverte et l'hôpital est invité à confirmer.
 */
async function echeances(pool) {
  const dues = (await pool.query(`SELECT id FROM fermetures_urgence WHERE (statut = 'planifiee' AND (debut_le <= now() OR (rappel_le IS NULL AND debut_le <= now() + interval '1 hour')))
    OR (statut = 'en_cours' AND fin_prevue_le <= now())`)).rows;
  let n = 0;
  for (const { id } of dues) {
    await transaction(pool, async (c) => {
      const f = (await c.query('SELECT * FROM fermetures_urgence WHERE id = $1 FOR UPDATE SKIP LOCKED', [id])).rows[0];
      if (!f) return;
      const e = (await c.query('SELECT id, nom, latitude, longitude, config_id, region_id FROM etablissements WHERE id = $1', [f.etablissement_id])).rows[0];
      if (f.statut === 'planifiee' && new Date(f.debut_le) <= new Date()) {
        const g = (await c.query("UPDATE fermetures_urgence SET statut = 'en_cours', version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *", [f.id])).rows[0];
        if (f.services.includes('toute_urgence')) {
          await c.query(`UPDATE etablissements SET urgence_statut_declare = 'fermee_temporairement', urgence_statut_le = now(), urgence_statut_par = NULL, reouverture_prevue_le = $2 WHERE id = $1`,
            [e.id, f.fin_prevue_le]);
        }
        await aviser(c, g, e, 'debut');
        await c.query(`INSERT INTO journal (etablissement_id, action, detail) VALUES ($1, 'Fermeture de l’urgence commencée (heure prévue)', $2)`, [e.id, f.services.join(', ')]);
      } else if (f.statut === 'planifiee') {
        await c.query('UPDATE fermetures_urgence SET rappel_le = now() WHERE id = $1', [f.id]);
        await aviser(c, f, e, 'rappel');
      } else if (f.statut === 'en_cours') {
        const g = (await c.query("UPDATE fermetures_urgence SET statut = 'terminee', version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *", [f.id])).rows[0];
        await rouvrir(c, e.id, null);
        await aviser(c, g, e, 'fin');
        await c.query(`INSERT INTO journal (etablissement_id, action, detail) VALUES ($1, 'Urgence rouverte à l’heure prévue (à confirmer)', $2)`, [e.id, f.services.join(', ')]);
      }
      n += 1;
    });
  }
  if (n) require('./flux').signaler();
  return n;
}

/** Fermetures en cours et à venir (7 jours) : d'un hôpital (urgence) ou de la région (secours, voisins). */
async function fermetures(pool, ids) {
  return (await pool.query(`SELECT f.id, f.etablissement_id, e.nom AS hopital, f.debut_le, f.fin_prevue_le, f.services, f.statut, f.version
    FROM fermetures_urgence f JOIN etablissements e ON e.id = f.etablissement_id
    WHERE f.etablissement_id = ANY($1) AND f.statut IN ('planifiee', 'en_cours') AND f.debut_le < now() + interval '7 days' ORDER BY f.debut_le`, [ids])).rows;
}
async function vueHopital(pool, u, etabId) {
  const e = await hopital(pool, u, etabId);
  const { voisins } = await destinataires(pool, e);
  return { publie: TE.moduleActif(e, 'urgences_direct'), services: SERVICES, fermetures: await fermetures(pool, [e.id]),
    voisins: await fermetures(pool, voisins), demo_seulement: environnement() !== 'demo' ? false : true };
}
/** Secours (ambulance, CCS) : fermetures en cours et à venir des urgences de la région (profil de pays des organisations). */
async function vueSecours(pool, u) {
  const orgs = (await pool.query(`SELECT o.config_id, o.region_id FROM utilisateur_organisations uo JOIN organisations_secours o ON o.id = uo.organisation_id
    WHERE uo.utilisateur_id = $1 AND o.actif`, [u.id])).rows;
  if (!orgs.length) throw new ErreurHttp(403, 'organisation_interdite');
  const ids = (await pool.query(`SELECT id FROM etablissements WHERE actif AND COALESCE(type_etablissement, 'hopital') = 'hopital' AND config_id = ANY($1)`,
    [[...new Set(orgs.map((o) => o.config_id))]])).rows.map((r) => r.id);
  return { fermetures: await fermetures(pool, ids) };
}
/** Pour le classement des secours : fermeture en cours par hôpital (toute l'urgence ou services touchés). */
async function fermeturesEnCours(db, ids) {
  const rows = (await db.query("SELECT etablissement_id, services, fin_prevue_le FROM fermetures_urgence WHERE statut = 'en_cours' AND etablissement_id = ANY($1)", [ids])).rows;
  return new Map(rows.map((r) => [r.etablissement_id, r]));
}
/** Une urgence est-elle écartée (fermée, ou service touché pour la catégorie) ? Rend la raison ou null. */
function ecartee(h, fermeture, categorie) {
  if (h.statut_declare?.statut === 'fermee_temporairement' || fermeture?.services.includes('toute_urgence')) {
    return { raison: 'fermee_temporairement', reouverture: h.statut_declare?.reouverture_prevue_le || fermeture?.fin_prevue_le || null };
  }
  const s = SERVICE_DE_CATEGORIE[categorie];
  if (s && fermeture?.services.includes(s)) return { raison: 'service_ferme', service: s, reouverture: fermeture.fin_prevue_le };
  return null;
}

/* ------------------------------------------------------------------ page publique et API ouverte (démonstration seulement) */
let cache = { le: 0, donnees: null };
const CACHE_MS = 60000;
const limites = new Map();
function limiter(ip) {
  const maintenant = Date.now(); const x = limites.get(ip) || { n: 0, debut: maintenant };
  if (maintenant - x.debut > 60000) { x.n = 0; x.debut = maintenant; }
  x.n += 1; limites.set(ip, x);
  if (limites.size > 5000) limites.clear();
  if (x.n > 60) throw new ErreurHttp(429, 'trop_de_requetes');
}
function publicActif() { return environnement() === 'demo'; }
const STATUT_PUBLIC = { ouvert: 'ouverte', capacite_limitee: 'capacite_reduite', saturation: 'capacite_reduite', delestage: 'capacite_reduite', fermee_temporairement: 'fermee_temporairement' };
async function donneesPubliques(pool) {
  if (cache.donnees && Date.now() - cache.le < CACHE_MS) return cache.donnees;
  const rows = (await pool.query(`SELECT e.id, e.nom, e.ville, e.latitude, e.longitude, e.modules, e.type_etablissement, e.urgence_statut_declare, e.urgence_statut_le, e.reouverture_prevue_le,
      c.disponibilite_fraicheur_min, c.numero_urgence, c.options_publiques FROM etablissements e JOIN config_pays c ON c.id = e.config_id
    WHERE e.actif AND COALESCE(e.type_etablissement, 'hopital') = 'hopital'`)).rows.filter((e) => TE.moduleActif(e, 'urgences_direct'));
  const ferm = await fermetures(pool, rows.map((r) => r.id));
  const urgences = rows.map((e) => {
    const age = e.urgence_statut_le ? Math.round((Date.now() - new Date(e.urgence_statut_le).getTime()) / 60000) : null;
    const fermee = e.urgence_statut_declare === 'fermee_temporairement';
    // Une déclaration trop ancienne n'est jamais présentée comme actuelle ; une fermeture reste affichée jusqu'à sa réouverture
    const aJour = e.urgence_statut_declare != null && (fermee || age <= (e.disponibilite_fraicheur_min || 15));
    const enCours = ferm.find((f) => f.etablissement_id === e.id && f.statut === 'en_cours');
    return { id: e.id, nom: e.nom, ville: e.ville, latitude: e.latitude, longitude: e.longitude,
      etat: e.urgence_statut_declare ? STATUT_PUBLIC[e.urgence_statut_declare] : 'inconnu', a_jour: aJour, mis_a_jour_le: e.urgence_statut_le,
      reouverture_prevue_le: fermee ? (e.reouverture_prevue_le || enCours?.fin_prevue_le || null) : null,
      services_touches: enCours ? enCours.services.filter((s) => s !== 'toute_urgence') : [],
      fermetures_planifiees: ferm.filter((f) => f.etablissement_id === e.id && f.statut === 'planifiee').map((f) => ({ debut_le: f.debut_le, fin_prevue_le: f.fin_prevue_le, services: f.services })) };
  });
  // Urgence ouverte la plus proche (vol d'oiseau, information seulement) pour chaque urgence qui ne l'est pas
  for (const u of urgences) {
    if (u.etat === 'ouverte' && u.a_jour) continue;
    const proche = urgences.filter((x) => x.id !== u.id && x.etat === 'ouverte' && x.a_jour && x.latitude != null)
      .map((x) => ({ id: x.id, nom: x.nom, km: Math.round(kmEntre(u, x) * 10) / 10 })).sort((a, b) => a.km - b.km)[0];
    u.ouverte_la_plus_proche = proche || null;
  }
  const cfg = rows[0] || (await pool.query('SELECT numero_urgence, options_publiques FROM config_pays ORDER BY id LIMIT 1')).rows[0] || {};
  // Autres urgences (fichier horaire du MSSS, Données Québec) : occupation seulement, source citée, jamais un état « fermé »
  const msss = require('./msss-urgences');
  const autres = msss.actif() ? await msss.autresUrgences(pool) : [];
  cache = { le: Date.now(), donnees: { version: 'v1', genere_le: new Date().toISOString(), numero_urgence: cfg.numero_urgence || '911', options: cfg.options_publiques || [],
    licence: 'CC-BY 4.0', attribution: 'Arrimo — données déclarées par les établissements participants (démonstration, données fictives)', urgences,
    autres_urgences: autres.length ? { source: msss.ATTRIBUTION, occupation_seulement: true, urgences: autres } : null } };
  return cache.donnees;
}
async function apiPublique(pool, ip) {
  if (!publicActif()) throw new ErreurHttp(404, 'introuvable');
  limiter(ip || 'inconnue');
  return donneesPubliques(pool);
}
const viderCache = () => { cache = { le: 0, donnees: null }; limites.clear(); };

module.exports = { planifier, changer, echeances, vueHopital, vueSecours, fermetures, fermeturesEnCours, ecartee, apiPublique, donneesPubliques, publicActif, viderCache, SERVICES, SERVICE_DE_CATEGORIE };
