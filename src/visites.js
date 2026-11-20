'use strict';
/**
 * Visites confirmées (cahier v2, A.3 ; 21 nov. 2026). La résidence (RPA, CHSLD…) voit l'horaire des visites prévues du CLSC ou du
 * prestataire pour ses résidents ; l'intervenant confirme son arrivée et son départ, au clic ou par la position autour de la résidence
 * (seulement pendant la plage, avec son consentement explicite, position jamais conservée) ; une visite dont la plage est dépassée
 * sans arrivée est « manquée » et signalée à la résidence ; la résidence note les soins qu'elle a donnés à la place (catégorie fermée).
 * Rapport mensuel par résidence et par prestataire, CSV. Type de visite = catégorie de service, jamais un diagnostic.
 * Arrimo mesure : aucune retenue de paiement n'est calculée. Le prestataire ne voit que la référence du résident, jamais son nom.
 */
const { ErreurHttp, transaction } = require('./db');
const TE = require('./types-etablissement');
const horloge = require('./horloge');

const TYPES = ['aide_hygiene', 'soins_infirmiers', 'medication', 'readaptation', 'autre'];
const ROLES_RESIDENCE = ['coordonnateur', 'admin_etab', 'equipe_soins'];
const entier = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const metres = (a, b) => { const r = (x) => (x * Math.PI) / 180; const h = Math.sin(r(b.latitude - a.latitude) / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2; return 6371000 * 2 * Math.asin(Math.sqrt(h)); };

async function residence(db, u, etabId, { ecrire = false } = {}) {
  const id = entier(etabId);
  if (!id || !(u.gestionnaire || (u.etabs || []).map(Number).includes(id))) throw new ErreurHttp(403, 'etab_interdit');
  if (ecrire && !ROLES_RESIDENCE.includes(u.role) && !u.gestionnaire) throw new ErreurHttp(403, 'role_insuffisant');
  const e = (await db.query('SELECT id, nom, latitude, longitude, visites_rayon_m, type_etablissement, modules FROM etablissements WHERE id = $1 AND actif', [id])).rows[0];
  if (!e || e.type_etablissement !== 'chsld') throw new ErreurHttp(404, 'etab_introuvable');
  if (!TE.moduleActif(e, 'visites_confirmees')) throw new ErreurHttp(403, 'module_desactive', { module: 'visites_confirmees' });
  return e;
}
async function prestatairesDe(db, u) {
  if (u.role !== 'intervenant') throw new ErreurHttp(403, 'role_insuffisant');
  const ids = (await db.query(`SELECT o.id FROM utilisateur_organisations uo JOIN organisations_secours o ON o.id = uo.organisation_id
    WHERE uo.utilisateur_id = $1 AND o.actif AND 'visites' = ANY(o.profils)`, [u.id])).rows.map((r) => r.id);
  if (!ids.length) throw new ErreurHttp(403, 'organisation_interdite');
  return ids;
}

/** Planifier une visite (ou une série hebdomadaire/quotidienne, 8 semaines au plus) ; la résidence choisit le prestataire. */
async function planifier(pool, u, b = {}) {
  const e = await residence(pool, u, b.etablissement_id, { ecrire: true });
  if (!TYPES.includes(b.type_visite)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'type_visite' });
  const debut = new Date(b.debut_prevu); const fin = new Date(b.fin_prevue);
  if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime()) || fin <= debut || fin - debut > 8 * 3600000) throw new ErreurHttp(400, 'plage_invalide');
  const rec = b.recurrence || 'aucune';
  if (!['aucune', 'quotidienne', 'hebdomadaire'].includes(rec)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'recurrence' });
  const n = rec === 'aucune' ? 1 : Math.min(Number(b.occurrences) || 1, rec === 'quotidienne' ? 56 : 8);
  const r = (await pool.query("SELECT id, reference FROM residents WHERE id = $1 AND etablissement_id = $2 AND statut IN ('present', 'absent', 'hospitalise')", [entier(b.resident_id), e.id])).rows[0];
  if (!r) throw new ErreurHttp(404, 'resident_introuvable');
  const p = (await pool.query("SELECT id FROM organisations_secours WHERE id = $1 AND actif AND 'visites' = ANY(profils)", [entier(b.prestataire_id)])).rows[0];
  if (!p) throw new ErreurHttp(404, 'organisation_introuvable');
  const pas = rec === 'quotidienne' ? 86400000 : 7 * 86400000; const serie = n > 1 ? `S-${Date.now().toString(36)}` : null;
  return transaction(pool, async (c) => {
    const crees = [];
    for (let i = 0; i < n; i += 1) {
      const num = (await c.query("SELECT nextval('visite_seq') AS n")).rows[0].n;
      crees.push((await c.query(`INSERT INTO visites (numero, etablissement_id, resident_id, resident_ref, prestataire_id, type_visite, debut_prevu, fin_prevue, serie, cree_par)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`, [`VI-${String(num).padStart(6, '0')}`, e.id, r.id, r.reference, p.id, b.type_visite,
        new Date(debut.getTime() + i * pas), new Date(fin.getTime() + i * pas), serie, u.id])).rows[0]);
    }
    await c.query(`INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Visites planifiées', $3)`, [e.id, u.id, `${r.reference} · ${b.type_visite} · ${n}`]);
    return crees;
  });
}

const CHAMPS = `v.id, v.numero, v.etablissement_id, e.nom AS residence, v.resident_ref, v.prestataire_id, o.nom AS prestataire, v.type_visite, v.debut_prevu, v.fin_prevue,
  v.statut, v.soin_rpa, v.version, ui.nom AS intervenant,
  (SELECT h.heure FROM v_horodatages_courants h WHERE h.objet = 'visite' AND h.objet_id = v.id AND h.etape = 'arrivee') AS arrivee_le,
  (SELECT h.source FROM v_horodatages_courants h WHERE h.objet = 'visite' AND h.objet_id = v.id AND h.etape = 'arrivee') AS arrivee_source,
  (SELECT h.heure FROM v_horodatages_courants h WHERE h.objet = 'visite' AND h.objet_id = v.id AND h.etape = 'depart') AS depart_le`;
const FROM = 'FROM visites v JOIN etablissements e ON e.id = v.etablissement_id JOIN organisations_secours o ON o.id = v.prestataire_id LEFT JOIN utilisateurs ui ON ui.id = v.intervenant_id';

/** Horaire : la résidence voit ses visites (nom du résident chez elle seulement) ; l'intervenant, celles de son organisation. */
async function horaire(pool, u, q = {}) {
  const jour = q.jour ? new Date(`${q.jour}T00:00:00`) : new Date(new Date().toDateString());
  if (Number.isNaN(jour.getTime())) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'jour' });
  const jours = Math.min(Math.max(Number(q.jours) || 7, 1), 31);
  const fin = new Date(jour.getTime() + jours * 86400000);
  if (u.role === 'intervenant') {
    const ids = await prestatairesDe(pool, u);
    return (await pool.query(`SELECT ${CHAMPS}, e.latitude, e.longitude ${FROM} WHERE v.prestataire_id = ANY($1) AND v.debut_prevu < $3 AND v.fin_prevue >= $2 AND v.statut <> 'annulee' ORDER BY v.debut_prevu`, [ids, jour, fin])).rows;
  }
  const e = await residence(pool, u, q.etablissement_id);
  return (await pool.query(`SELECT ${CHAMPS}, r.prenom, r.nom ${FROM} JOIN residents r ON r.id = v.resident_id WHERE v.etablissement_id = $1 AND v.debut_prevu < $3 AND v.fin_prevue >= $2 ORDER BY v.debut_prevu`, [e.id, jour, fin])).rows;
}

/**
 * Arrivée ou départ de l'intervenant : au clic, ou par la position (consentement explicite, pendant la plage élargie de 30 min,
 * à moins du rayon de la résidence ; la position n'est jamais conservée). L'heure de la position est retenue.
 */
async function pointer(pool, u, id, b = {}) {
  const ids = await prestatairesDe(pool, u);
  const etape = b.etape === 'depart' ? 'depart' : b.etape === 'arrivee' ? 'arrivee' : null;
  if (!etape) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'etape' });
  return transaction(pool, async (c) => {
    const v = (await c.query(`SELECT v.*, e.latitude, e.longitude, e.visites_rayon_m FROM visites v JOIN etablissements e ON e.id = v.etablissement_id WHERE v.id = $1 FOR UPDATE OF v`, [entier(id)])).rows[0];
    if (!v || !ids.includes(v.prestataire_id)) throw new ErreurHttp(404, 'visite_introuvable');
    if (etape === 'arrivee' && !['prevue', 'manquee'].includes(v.statut)) throw new ErreurHttp(409, 'visite_statut');
    if (etape === 'depart' && v.statut !== 'en_cours') throw new ErreurHttp(409, 'visite_statut');
    let source = 'clic'; let heure = new Date();
    if (b.latitude != null && b.longitude != null) {
      if (b.consentement !== true) throw new ErreurHttp(400, 'consentement_position_requis');
      const marge = 30 * 60000;
      if (heure < new Date(v.debut_prevu).getTime() - marge || heure > new Date(v.fin_prevue).getTime() + marge) throw new ErreurHttp(409, 'position_hors_plage');
      const d = metres({ latitude: Number(b.latitude), longitude: Number(b.longitude) }, v);
      if (!(d <= v.visites_rayon_m)) throw new ErreurHttp(409, 'position_hors_zone');
      source = 'position';
      if (b.horodatage) { const h = new Date(b.horodatage); if (!Number.isNaN(h.getTime()) && h <= heure && heure - h < 3600000) heure = h; }
    }
    await horloge.marquer(c, { objet: 'visite', objetId: v.id, etape, heure, source, auteurId: u.id });
    const statut = etape === 'arrivee' ? 'en_cours' : 'terminee';
    const n = (await c.query('UPDATE visites SET statut = $2, intervenant_id = $3, version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *', [v.id, statut, u.id])).rows[0];
    await c.query(`INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, $3, $4)`, [v.etablissement_id, u.id, etape === 'arrivee' ? 'Visite : arrivée' : 'Visite : départ', `${v.numero} · ${source}`]);
    return { ...n, source };
  });
}

/** Tâche périodique : plage dépassée sans arrivée → « manquée », alerte à la résidence (le prestataire la voit dans son horaire). */
async function manquees(pool) {
  const r = await pool.query(`UPDATE visites SET statut = 'manquee', version = version + 1, modifie_le = now() WHERE statut = 'prevue' AND fin_prevue < now() RETURNING id, numero, etablissement_id, resident_ref, type_visite`);
  for (const v of r.rows) await require('./services').notifier(pool, v.etablissement_id, null, 'visite_manquee', { numero: v.numero, ref: v.resident_ref });
  return r.rowCount;
}

/** La résidence : annuler une visite prévue, ou noter les soins donnés à la place d'une visite manquée (catégorie fermée). */
async function agirResidence(pool, u, id, b = {}) {
  const v0 = (await pool.query('SELECT * FROM visites WHERE id = $1', [entier(id)])).rows[0];
  if (!v0) throw new ErreurHttp(404, 'visite_introuvable');
  await residence(pool, u, v0.etablissement_id, { ecrire: true });
  if (b.action === 'annuler') {
    if (v0.statut !== 'prevue') throw new ErreurHttp(409, 'visite_statut');
    return (await pool.query("UPDATE visites SET statut = 'annulee', version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *", [v0.id])).rows[0];
  }
  if (b.action === 'soin_rpa') {
    if (v0.statut !== 'manquee') throw new ErreurHttp(409, 'visite_statut');
    if (!TYPES.includes(b.soin)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'soin' });
    return (await pool.query('UPDATE visites SET soin_rpa = $2, soin_rpa_par = $3, version = version + 1, modifie_le = now() WHERE id = $1 RETURNING *', [v0.id, b.soin, u.id])).rows[0];
  }
  throw new ErreurHttp(400, 'action_inconnue');
}

/** Rapport mensuel (résidence ou prestataire) : prévues, faites, manquées, soins donnés par la résidence à la place ; par type. */
async function rapport(pool, u, q = {}) {
  const m = String(q.mois || new Date().toISOString().slice(0, 7));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'mois' });
  let filtre; let vals;
  if (u.role === 'intervenant') { filtre = 'v.prestataire_id = ANY($1)'; vals = [await prestatairesDe(pool, u)]; }
  else { const e = await residence(pool, u, q.etablissement_id); filtre = 'v.etablissement_id = $1'; vals = [e.id]; }
  const rows = (await pool.query(`SELECT v.type_visite, v.statut, v.soin_rpa, o.nom AS prestataire, e.nom AS residence FROM visites v
    JOIN organisations_secours o ON o.id = v.prestataire_id JOIN etablissements e ON e.id = v.etablissement_id
    WHERE ${filtre} AND v.statut <> 'annulee' AND to_char(v.debut_prevu AT TIME ZONE 'America/Toronto', 'YYYY-MM') = $2`, [...vals, m])).rows;
  const groupes = {};
  for (const r of rows) {
    const k = `${r.residence}|${r.prestataire}|${r.type_visite}`;
    const g = groupes[k] || (groupes[k] = { residence: r.residence, prestataire: r.prestataire, type_visite: r.type_visite, prevues: 0, faites: 0, manquees: 0, soins_rpa: 0 });
    g.prevues += 1; if (r.statut === 'terminee' || r.statut === 'en_cours') g.faites += 1; if (r.statut === 'manquee') g.manquees += 1; if (r.soin_rpa) g.soins_rpa += 1;
  }
  const lignes = Object.values(groupes);
  const total = lignes.reduce((t, g) => ({ prevues: t.prevues + g.prevues, faites: t.faites + g.faites, manquees: t.manquees + g.manquees, soins_rpa: t.soins_rpa + g.soins_rpa }), { prevues: 0, faites: 0, manquees: 0, soins_rpa: 0 });
  return { mois: m, total, lignes };
}
function csv(r, langue = 'fr') {
  const en = langue === 'en';
  const tete = en ? ['Residence', 'Provider', 'Visit type', 'Planned', 'Done', 'Missed', 'Care given by the residence'] : ['Résidence', 'Prestataire', 'Type de visite', 'Prévues', 'Faites', 'Manquées', 'Soins donnés par la résidence'];
  const champ = (s) => { const x = String(s ?? ''); return /[;"\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  return `﻿${[tete.join(';'), ...r.lignes.map((l) => [l.residence, l.prestataire, l.type_visite, l.prevues, l.faites, l.manquees, l.soins_rpa].map(champ).join(';'))].join('\r\n')}\r\n`;
}
async function prestataires(pool, u, etabId) {
  await residence(pool, u, etabId);
  return (await pool.query("SELECT id, nom FROM organisations_secours WHERE actif AND 'visites' = ANY(profils) ORDER BY nom")).rows;
}

module.exports = { planifier, horaire, pointer, manquees, agirResidence, rapport, csv, prestataires, TYPES };
