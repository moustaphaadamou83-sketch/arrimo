'use strict';
/**
 * Arrimo Préhospitalier, phase 1 : préalertes entre les ambulances et les hôpitaux (module hospitalier « Liaison Secours »).
 * Règles (cahier de construction du 12 nov. 2026 et décisions de Moustafa) :
 * - L'ambulance informe, l'hôpital se prépare, les professionnels décident : aucune destination, aucun service, aucun lit n'est choisi ici.
 * - Aucune identité ni motif libre : numéro temporaire PA-000000, priorité déclarée et catégorie en liste fermée.
 * - Confirmation technique (l'écran de l'hôpital a reçu la préalerte) et confirmation humaine (prise en compte) sont distinctes.
 * - L'arrivée est confirmée par l'hôpital pour le bon véhicule ; l'arrivée d'un autre véhicule est enregistrée et ne ferme rien.
 * - Un changement de destination conserve l'ancienne préalerte (remplacée) et en crée une nouvelle.
 * - Isolation : une ambulance ne voit que les préalertes de son organisation, un hôpital celles qui lui sont destinées,
 *   un CCS celles de sa région (lecture seule). Chaque étape est horodatée, versionnée et inscrite dans un historique immuable.
 */
const { transaction, ErreurHttp } = require('./db');
const { peutAgirPour } = require('./auth');
const { journaliser } = require('./regles');
const TE = require('./types-etablissement');

const PRIORITES = ['immediate', 'urgente', 'non_urgente'];
const CATEGORIES = ['medicale', 'traumatologie', 'cardiaque', 'neurologique', 'respiratoire', 'pediatrique', 'obstetrique', 'sante_mentale', 'autre'];
const OUVERTES = ['envoyee', 'recue', 'consultee', 'prise_en_compte', 'preparation', 'preparation_terminee', 'arrivee'];
const ROLES_AMBULANCE = ['paramedic', 'superviseur_secours'];
const ROLES_CCS = ['repartiteur'];
const ROLES_SECOURS = [...ROLES_AMBULANCE, ...ROLES_CCS];
const ROLES_HOPITAL = ['coordonnateur', 'gestionnaire', 'admin_etab', 'equipe_soins'];
// Ordre d'avancement côté hôpital : un statut ne recule jamais
const RANG = { envoyee: 0, recue: 1, consultee: 2, prise_en_compte: 3, preparation: 4, preparation_terminee: 5, arrivee: 6, cloturee: 7 };

const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
async function organisationsDe(db, u) {
  return (await db.query(`SELECT o.id, o.type, o.config_id FROM utilisateur_organisations uo JOIN organisations_secours o ON o.id = uo.organisation_id
    WHERE uo.utilisateur_id = $1 AND o.actif`, [u.id])).rows;
}
async function exigerAmbulance(db, u) {
  if (!ROLES_AMBULANCE.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const orgs = (await organisationsDe(db, u)).filter((o) => o.type === 'ambulancier');
  if (!orgs.length) throw new ErreurHttp(403, 'organisation_interdite');
  return orgs;
}
/** Hôpital accessible avec le module Liaison Secours actif ; sinon le module n'existe pas pour cet utilisateur. */
async function exigerHopital(db, u, etabId) {
  if (!ROLES_HOPITAL.includes(u.role)) throw new ErreurHttp(403, 'role_insuffisant');
  const id = entier(etabId);
  if (!id || !peutAgirPour(u, id)) throw new ErreurHttp(403, 'etab_interdit');
  const e = (await db.query('SELECT id, nom, type_etablissement, modules, actif FROM etablissements WHERE id = $1', [id])).rows[0];
  if (!e || !e.actif) throw new ErreurHttp(404, 'etab_introuvable');
  if (!TE.moduleActif(e, 'liaison_secours')) throw new ErreurHttp(403, 'module_desactive', { module: 'liaison_secours' });
  return e;
}
const evenement = (c, pa, type, u, detail = {}) => c.query('INSERT INTO prealerte_evenements (prealerte_id, type, detail, utilisateur_id) VALUES ($1, $2, $3, $4)',
  [pa.id, type, JSON.stringify(detail), u ? u.id : null]);
async function notifier(c, etabId, code, pa, extra = {}) {
  const org = (await c.query('SELECT nom FROM organisations_secours WHERE id = $1', [pa.organisation_id])).rows[0]?.nom;
  const unite = (await c.query('SELECT numero FROM unites_secours WHERE id = $1', [pa.unite_id])).rows[0]?.numero;
  await require('./services').notifier(c, etabId, null, code, { numero: pa.numero, org, unite, ...extra });
}
function lireHeure(b) {
  if (b.delai_min != null && b.delai_min !== '') {
    const m = Number(b.delai_min);
    if (!Number.isInteger(m) || m < 0 || m > 720) throw new ErreurHttp(400, 'prealerte_invalide');
    return new Date(Date.now() + m * 60000);
  }
  if (b.heure_prevue) { const d = new Date(b.heure_prevue); if (Number.isNaN(d.getTime())) throw new ErreurHttp(400, 'prealerte_invalide'); return d; }
  return null;
}
async function exigerDestination(c, id) {
  const e = (await c.query(`SELECT id, nom, type_etablissement, modules, actif FROM etablissements WHERE id = $1`, [entier(id)])).rows[0];
  if (!e || !e.actif || (e.type_etablissement || 'hopital') !== 'hopital') throw new ErreurHttp(404, 'hopital_introuvable');
  if (!TE.moduleActif(e, 'liaison_secours')) throw new ErreurHttp(409, 'liaison_secours_inactive');
  return e;
}
async function numero(c) { return `PA-${String((await c.query("SELECT nextval('prealerte_seq') AS n")).rows[0].n).padStart(6, '0')}`; }

/** Préalerte transmise par une équipe ambulancière. `cle` : identifiant d'envoi du poste (renvoi après coupure = même préalerte). */
async function creer(pool, u, b) {
  const orgs = await exigerAmbulance(pool, u);
  const priorite = String(b.priorite || ''); const categorie = String(b.categorie || '');
  if (!PRIORITES.includes(priorite) || !CATEGORIES.includes(categorie)) throw new ErreurHttp(400, 'prealerte_invalide');
  const cle = b.cle == null || b.cle === '' ? null : String(b.cle);
  if (cle && !/^[A-Za-z0-9_-]{8,64}$/.test(cle)) throw new ErreurHttp(400, 'cle_idempotence_invalide');
  const heure = lireHeure(b);
  return transaction(pool, async (c) => {
    const unite = (await c.query('SELECT * FROM unites_secours WHERE id = $1 AND actif FOR UPDATE', [entier(b.unite_id)])).rows[0];
    if (!unite || !orgs.some((o) => o.id === unite.organisation_id)) throw new ErreurHttp(404, 'unite_introuvable');
    if (cle) {
      const deja = (await c.query('SELECT * FROM prealertes WHERE organisation_id = $1 AND cle_idempotence = $2', [unite.organisation_id, cle])).rows[0];
      if (deja) return { ...deja, rejoue: true };
    }
    const dest = await exigerDestination(c, b.destination_id);
    const ouverte = (await c.query(`SELECT numero FROM prealertes WHERE unite_id = $1 AND statut = ANY($2)`, [unite.id, OUVERTES])).rows[0];
    if (ouverte) throw new ErreurHttp(409, 'prealerte_deja_ouverte', { numero: ouverte.numero });
    const equipage = await lireEquipage(c, b.equipage, unite.organisation_id, u);
    const pa = (await c.query(`INSERT INTO prealertes (numero, organisation_id, unite_id, destination_id, priorite, categorie, equipage, heure_prevue, cle_idempotence, cree_par)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [await numero(c), unite.organisation_id, unite.id, dest.id, priorite, categorie, equipage, heure, cle, u.id])).rows[0];
    await evenement(c, pa, 'envoyee', u, { destination: dest.id, priorite, categorie, heure_prevue: heure });
    await journaliser(c, { etablissementId: dest.id, utilisateurId: u.id, action: 'Préalerte reçue', detail: `${pa.numero} · ${priorite}` });
    await notifier(c, dest.id, 'secours_prealerte', pa, { priorite });
    return pa;
  });
}
async function lireEquipage(c, liste, orgId, u) {
  const ids = [...new Set((Array.isArray(liste) ? liste : [u.id]).map(entier))];
  if (ids.includes(null) || ids.length > 6) throw new ErreurHttp(400, 'prealerte_invalide');
  const ok = (await c.query(`SELECT count(*)::int AS n FROM utilisateur_organisations uo JOIN utilisateurs us ON us.id = uo.utilisateur_id
    WHERE uo.organisation_id = $1 AND us.actif AND us.role = ANY($2) AND us.id = ANY($3)`, [orgId, ROLES_AMBULANCE, ids])).rows[0].n;
  if (ok !== ids.length) throw new ErreurHttp(400, 'prealerte_invalide');
  return ids;
}

const CHAMPS = (k) => `p.*, o.nom AS organisation, un.numero AS unite, un.plaque, e.nom AS destination,
  (SELECT COALESCE(json_agg(us.nom ORDER BY us.nom), '[]') FROM utilisateurs us WHERE us.id = ANY(p.equipage)) AS equipage_noms,
  (SELECT json_build_object('latitude', pu.latitude, 'longitude', pu.longitude, 'precision_m', pu.precision_m, 'le', pu.enregistree_le)
     FROM positions_unites pu WHERE pu.unite_id = p.unite_id AND p.statut = ANY($${k}) ORDER BY pu.enregistree_le DESC LIMIT 1) AS position`;
const FROM = 'FROM prealertes p JOIN organisations_secours o ON o.id = p.organisation_id JOIN unites_secours un ON un.id = p.unite_id JOIN etablissements e ON e.id = p.destination_id';
/** Préalertes visibles : ouvertes et celles des dernières 24 h. Pour l'hôpital, la première lecture vaut confirmation technique. */
async function liste(pool, u, q = {}) {
  let filtre; let args;
  if (ROLES_HOPITAL.includes(u.role)) {
    const e = await exigerHopital(pool, u, q.etablissement_id);
    filtre = 'p.destination_id = $1'; args = [e.id];
    await transaction(pool, async (c) => {
      const nouvelles = (await c.query(`UPDATE prealertes SET recue_le = now(), statut = CASE WHEN statut = 'envoyee' THEN 'recue' ELSE statut END,
        version = version + 1, modifie_le = now() WHERE destination_id = $1 AND recue_le IS NULL AND statut = ANY($2) RETURNING *`, [e.id, OUVERTES])).rows;
      for (const pa of nouvelles) await evenement(c, pa, 'recue', null, { etablissement: e.id });
    });
  } else if (ROLES_AMBULANCE.includes(u.role)) {
    const orgs = await exigerAmbulance(pool, u);
    filtre = 'p.organisation_id = ANY($1)'; args = [orgs.map((o) => o.id)];
  } else if (ROLES_CCS.includes(u.role)) {
    const orgs = (await organisationsDe(pool, u)).filter((o) => o.type === 'ccs');
    if (!orgs.length) throw new ErreurHttp(403, 'organisation_interdite');
    filtre = 'o.config_id = ANY($1)'; args = [orgs.map((o) => o.config_id)];
  } else throw new ErreurHttp(403, 'role_insuffisant');
  const rows = (await pool.query(`SELECT ${CHAMPS(2)} ${FROM} WHERE ${filtre} AND (p.statut = ANY($2) OR p.modifie_le > now() - interval '24 hours')
    ORDER BY (p.statut = ANY($2)) DESC, CASE p.priorite WHEN 'immediate' THEN 0 WHEN 'urgente' THEN 1 ELSE 2 END, p.heure_prevue NULLS LAST, p.id`,
  [...args, OUVERTES])).rows;
  return { prealertes: rows.map((p) => ({ ...p, actions: actions(p, u) })), priorites: PRIORITES, categories: CATEGORIES };
}
/** Fiche détaillée avec l'historique ; ouverte par une personne de l'hôpital, elle passe à « consultée ». */
async function fiche(pool, u, id, q = {}) {
  const pa0 = (await pool.query('SELECT * FROM prealertes WHERE id = $1', [entier(id)])).rows[0];
  if (!pa0) throw new ErreurHttp(404, 'prealerte_introuvable');
  await exigerVisibilite(pool, u, pa0, q.etablissement_id);
  if (ROLES_HOPITAL.includes(u.role) && !pa0.consultee_le && OUVERTES.includes(pa0.statut)) {
    await transaction(pool, async (c) => {
      const pa = (await c.query(`UPDATE prealertes SET consultee_le = now(), recue_le = COALESCE(recue_le, now()),
        statut = CASE WHEN statut IN ('envoyee', 'recue') THEN 'consultee' ELSE statut END, version = version + 1, modifie_le = now()
        WHERE id = $1 AND consultee_le IS NULL RETURNING *`, [pa0.id])).rows[0];
      if (pa) await evenement(c, pa, 'consultee', u);
    });
  }
  const p = (await pool.query(`SELECT ${CHAMPS(2)} ${FROM} WHERE p.id = $1`, [pa0.id, OUVERTES])).rows[0];
  const evenements = (await pool.query(`SELECT ev.type, ev.detail, ev.cree_le, us.nom AS par FROM prealerte_evenements ev LEFT JOIN utilisateurs us ON us.id = ev.utilisateur_id
    WHERE ev.prealerte_id = $1 ORDER BY ev.id`, [pa0.id])).rows;
  return { ...p, actions: actions(p, u), evenements };
}
async function exigerVisibilite(db, u, pa, etabId) {
  if (ROLES_HOPITAL.includes(u.role)) {
    const e = await exigerHopital(db, u, etabId);
    if (pa.destination_id !== e.id) throw new ErreurHttp(404, 'prealerte_introuvable');
    return 'hopital';
  }
  if (ROLES_AMBULANCE.includes(u.role)) {
    if (!(await exigerAmbulance(db, u)).some((o) => o.id === pa.organisation_id)) throw new ErreurHttp(404, 'prealerte_introuvable');
    return 'ambulance';
  }
  if (ROLES_CCS.includes(u.role)) {
    const cfg = (await db.query('SELECT config_id FROM organisations_secours WHERE id = $1', [pa.organisation_id])).rows[0].config_id;
    if (!(await organisationsDe(db, u)).some((o) => o.type === 'ccs' && o.config_id === cfg)) throw new ErreurHttp(404, 'prealerte_introuvable');
    return 'ccs';
  }
  throw new ErreurHttp(403, 'role_insuffisant');
}
/** Actions proposées selon le rôle et l'étape (le serveur revérifie chacune). Le CCS ne fait que consulter. */
function actions(p, u) {
  if (!OUVERTES.includes(p.statut)) return [];
  if (ROLES_AMBULANCE.includes(u.role)) {
    if (p.statut === 'arrivee') return [];
    return ['mettre_a_jour', 'changer_destination', 'annuler', ...(p.arrivee_signalee_le ? [] : ['signaler_arrivee'])];
  }
  if (!ROLES_HOPITAL.includes(u.role)) return [];
  const a = [];
  if (!p.prise_en_compte_le) a.push('prendre_en_compte');
  if (RANG[p.statut] < RANG.preparation) a.push('preparation');
  if (RANG[p.statut] < RANG.preparation_terminee) a.push('preparation_terminee');
  if (p.statut !== 'arrivee') a.push('confirmer_vehicule');
  if (p.statut === 'arrivee') a.push('confirmer_remise');
  a.push('signaler_probleme');
  return a;
}

const PROBLEMES = ['information_manquante', 'capacite_limitee', 'autre'];
/** Une action sur une préalerte : même verrou, même version, même historique pour tous les rôles. */
async function agir(pool, u, id, b) {
  const pa0 = (await pool.query('SELECT * FROM prealertes WHERE id = $1', [entier(id)])).rows[0];
  if (!pa0) throw new ErreurHttp(404, 'prealerte_introuvable');
  const cote = await exigerVisibilite(pool, u, pa0, b.etablissement_id);
  const a = String(b.action || '');
  if (cote === 'ccs') throw new ErreurHttp(403, 'role_insuffisant');
  return transaction(pool, async (c) => {
    const pa = (await c.query('SELECT * FROM prealertes WHERE id = $1 FOR UPDATE', [pa0.id])).rows[0];
    if (!OUVERTES.includes(pa.statut)) throw new ErreurHttp(409, 'prealerte_close');
    if (b.version != null && Number(b.version) !== pa.version) throw new ErreurHttp(409, 'version_perimee');
    const maj = async (sql, vals = []) => (await c.query(`UPDATE prealertes SET ${sql}, version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`, [pa.id, ...vals])).rows[0];
    const avancer = (statut) => (RANG[statut] > RANG[pa.statut] ? statut : pa.statut);
    let n; let detail = {};
    if (cote === 'ambulance') {
      if (pa.statut === 'arrivee') throw new ErreurHttp(409, 'prealerte_statut_incompatible');
      if (a === 'mettre_a_jour') {
        const heure = lireHeure(b); const priorite = b.priorite == null || b.priorite === '' ? null : String(b.priorite);
        if (priorite && !PRIORITES.includes(priorite)) throw new ErreurHttp(400, 'prealerte_invalide');
        if (!heure && !priorite) throw new ErreurHttp(400, 'prealerte_invalide');
        n = await maj('heure_prevue = COALESCE($2, heure_prevue), priorite = COALESCE($3, priorite)', [heure, priorite]);
        detail = { heure_prevue: heure, priorite };
        await notifier(c, pa.destination_id, 'secours_mise_a_jour', n, { priorite: n.priorite });
      } else if (a === 'signaler_arrivee') {
        if (pa.arrivee_signalee_le) throw new ErreurHttp(409, 'prealerte_statut_incompatible');
        n = await maj('arrivee_signalee_le = now()');
        await notifier(c, pa.destination_id, 'secours_arrivee', n);
      } else if (a === 'annuler') {
        n = await maj("statut = 'annulee'");
        await notifier(c, pa.destination_id, 'secours_annulee', n);
      } else if (a === 'changer_destination') {
        return changerDestination(c, u, pa, b);
      } else throw new ErreurHttp(400, 'action_inconnue');
    } else {
      if (a === 'prendre_en_compte') {
        if (pa.prise_en_compte_le) throw new ErreurHttp(409, 'prealerte_statut_incompatible');
        n = await maj(`prise_en_compte_le = now(), prise_en_compte_par = $2, consultee_le = COALESCE(consultee_le, now()), recue_le = COALESCE(recue_le, now()), statut = $3`,
          [u.id, avancer('prise_en_compte')]);
      } else if (a === 'preparation' || a === 'preparation_terminee') {
        if (RANG[pa.statut] >= RANG[a]) throw new ErreurHttp(409, 'prealerte_statut_incompatible');
        n = await maj(`${a === 'preparation' ? 'preparation_le' : 'preparation_terminee_le'} = now(), prise_en_compte_le = COALESCE(prise_en_compte_le, now()),
          prise_en_compte_par = COALESCE(prise_en_compte_par, $2), statut = $3`, [u.id, a]);
      } else if (a === 'confirmer_vehicule') {
        // L'hôpital indique l'unité réellement arrivée : seule la bonne unité confirme l'arrivée ; une autre est enregistrée sans rien fermer.
        if (pa.statut === 'arrivee') throw new ErreurHttp(409, 'prealerte_statut_incompatible');
        const vue = String(b.unite_numero || '').trim();
        if (!vue) throw new ErreurHttp(400, 'prealerte_invalide');
        const attendue = (await c.query('SELECT numero FROM unites_secours WHERE id = $1', [pa.unite_id])).rows[0].numero;
        if (vue.toUpperCase() !== attendue.toUpperCase()) {
          await evenement(c, pa, 'vehicule_different', u, { unite_attendue: attendue, unite_vue: vue.slice(0, 40) });
          return { ...pa, correspond: false, unite_attendue: attendue };
        }
        n = await maj("arrivee_confirmee_le = now(), statut = 'arrivee'");
        detail = { unite: attendue };
      } else if (a === 'confirmer_remise') {
        if (pa.statut !== 'arrivee') throw new ErreurHttp(409, 'prealerte_statut_incompatible');
        n = await maj("remise_le = now(), cloturee_le = now(), statut = 'cloturee'");
      } else if (a === 'signaler_probleme') {
        const motif = String(b.probleme || '');
        if (!PROBLEMES.includes(motif)) throw new ErreurHttp(400, 'prealerte_invalide');
        await evenement(c, pa, 'probleme', u, { probleme: motif });
        return { ...pa, probleme: motif };
      } else throw new ErreurHttp(400, 'action_inconnue');
    }
    await evenement(c, n, a, u, detail);
    await journaliser(c, { etablissementId: n.destination_id, utilisateurId: u.id, action: `Préalerte : ${a.replace(/_/g, ' ')}`, detail: n.numero });
    return { ...n, correspond: a === 'confirmer_vehicule' ? true : undefined };
  });
}
/** Changement de destination décidé par les professionnels : l'ancienne est conservée (remplacée), la nouvelle est transmise. */
async function changerDestination(c, u, pa, b) {
  const dest = await exigerDestination(c, b.destination_id);
  if (dest.id === pa.destination_id) throw new ErreurHttp(409, 'prealerte_statut_incompatible');
  const ancienne = (await c.query(`UPDATE prealertes SET statut = 'remplacee', version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *`, [pa.id])).rows[0];
  const heure = lireHeure(b) || pa.heure_prevue;
  const nv = (await c.query(`INSERT INTO prealertes (numero, organisation_id, unite_id, destination_id, priorite, categorie, equipage, heure_prevue, remplace_id, cree_par)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
  [await numero(c), pa.organisation_id, pa.unite_id, dest.id, pa.priorite, pa.categorie, pa.equipage, heure, pa.id, u.id])).rows[0];
  await evenement(c, ancienne, 'destination_modifiee', u, { nouvelle: nv.numero, destination: dest.id });
  await evenement(c, nv, 'envoyee', u, { remplace: pa.numero, destination: dest.id, priorite: nv.priorite, categorie: nv.categorie, heure_prevue: heure });
  await journaliser(c, { etablissementId: pa.destination_id, utilisateurId: u.id, action: 'Préalerte : destination modifiée', detail: `${pa.numero} → ${nv.numero}` });
  await journaliser(c, { etablissementId: dest.id, utilisateurId: u.id, action: 'Préalerte reçue', detail: `${nv.numero} · ${nv.priorite}` });
  await notifier(c, pa.destination_id, 'secours_destination_modifiee', ancienne);
  await notifier(c, dest.id, 'secours_prealerte', nv, { priorite: nv.priorite });
  return { ...nv, remplace: ancienne.numero };
}

/**
 * Hôpitaux qui reçoivent les préalertes (Liaison Secours actif) dans la région de l'organisation, avec l'état déclaré de l'urgence.
 * Distance à vol d'oiseau depuis la position fournie (facultative) : une aide à la lecture, jamais un choix de destination.
 */
async function destinations(pool, u, q = {}) {
  const orgs = ROLES_SECOURS.includes(u.role) ? await organisationsDe(pool, u) : [];
  if (!orgs.length) throw new ErreurHttp(403, 'organisation_interdite');
  const cfgs = [...new Set(orgs.map((o) => o.config_id))];
  const hop = (await pool.query(`SELECT e.id, e.nom, e.ville, e.latitude, e.longitude, e.modules, e.type_etablissement, e.config_id, e.module_actif,
      c.seuil_civieres_jaune, c.seuil_civieres_orange, c.seuil_civieres_rouge
    FROM etablissements e JOIN config_pays c ON c.id = e.config_id WHERE e.actif AND e.config_id = ANY($1) ORDER BY e.nom`, [cfgs])).rows
    .filter((e) => (e.type_etablissement || 'hopital') === 'hopital' && TE.moduleActif(e, 'liaison_secours'));
  const cv = require('./civieres');
  const stats = await cv.statsUrgence(pool, hop.map((e) => e.id));
  const lat = Number(q.latitude); const lon = Number(q.longitude);
  const ici = q.latitude != null && q.longitude != null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? [lat, lon] : null;
  const km = (e) => {
    if (!ici || e.latitude == null) return null;
    const r = (x) => x * Math.PI / 180; const dLat = r(e.latitude - ici[0]); const dLon = r(e.longitude - ici[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(ici[0])) * Math.cos(r(e.latitude)) * Math.sin(dLon / 2) ** 2;
    return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
  };
  return hop.map((e) => {
    const st = stats.get(e.id);
    return { id: e.id, nom: e.nom, ville: e.ville, latitude: e.latitude, longitude: e.longitude, distance_km: km(e),
      urgence: st ? { niveau: cv.niveauCivieres(st, e), civieres_libres: st.libres, taux: st.taux } : null };
  }).sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9) || a.nom.localeCompare(b.nom));
}
/** Unités de l'organisation de l'ambulancier, avec leur dernière position. */
async function unites(pool, u) {
  const orgs = await exigerAmbulance(pool, u);
  return (await pool.query(`SELECT un.id, un.numero, un.plaque, o.nom AS organisation,
      (SELECT json_build_object('latitude', pu.latitude, 'longitude', pu.longitude, 'le', pu.enregistree_le) FROM positions_unites pu
        WHERE pu.unite_id = un.id ORDER BY pu.enregistree_le DESC LIMIT 1) AS position
    FROM unites_secours un JOIN organisations_secours o ON o.id = un.organisation_id WHERE un.organisation_id = ANY($1) AND un.actif ORDER BY un.numero`,
  [orgs.map((o) => o.id)])).rows;
}
/** Position transmise par l'équipe (facultative : la préalerte fonctionne sans). */
async function position(pool, u, uniteId, b) {
  const orgs = await exigerAmbulance(pool, u);
  const un = (await pool.query('SELECT id, organisation_id FROM unites_secours WHERE id = $1 AND actif', [entier(uniteId)])).rows[0];
  if (!un || !orgs.some((o) => o.id === un.organisation_id)) throw new ErreurHttp(404, 'unite_introuvable');
  const lat = Number(b.latitude); const lon = Number(b.longitude);
  if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180) || b.latitude == null || b.longitude == null) throw new ErreurHttp(400, 'position_invalide');
  const precision = b.precision_m == null ? null : Math.max(0, Math.round(Number(b.precision_m)) || 0);
  await pool.query('INSERT INTO positions_unites (unite_id, latitude, longitude, precision_m) VALUES ($1, $2, $3, $4)', [un.id, lat, lon, precision]);
  return { enregistree: true };
}
/** Positions conservées 24 h au plus. */
async function purgerPositions(pool) {
  return (await pool.query("DELETE FROM positions_unites WHERE enregistree_le < now() - interval '24 hours'")).rowCount;
}

module.exports = { creer, liste, fiche, agir, unites, destinations, position, purgerPositions, PRIORITES, CATEGORIES, OUVERTES, ROLES_SECOURS, ROLES_AMBULANCE, ROLES_CCS };
