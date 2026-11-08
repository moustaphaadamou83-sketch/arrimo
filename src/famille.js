'use strict';
/**
 * Coordination Famille : demandes pratiques transformées en tâches, confirmations, visites par créneaux, journal de vie,
 * réglages par établissement, tableau de bord et relances. Données fictives (le portail reste limité à la démo et à la recette).
 * Aucune donnée clinique : une demande médicale urgente relève des circuits d'urgence, jamais de ce flux administratif.
 */
const { ErreurHttp, transaction } = require('./db');
const ch = require('./chsld');
const notifs = require('./portail-notifications');

const CATEGORIES_DEMANDE = ['vetements', 'lunettes', 'effets_personnels', 'objet_oublie', 'rencontre', 'administratif', 'autre'];
const STATUTS_DEMANDE = ['nouvelle', 'recue', 'attribuee', 'en_cours', 'attente_information', 'attente_proche', 'resolue', 'refusee', 'annulee', 'cloturee'];
const FINAUX = ['resolue', 'refusee', 'annulee', 'cloturee'];
const GESTION = ['coordonnateur', 'admin_etab', 'gestionnaire', 'equipe_soins'];
const DEFAUT = { delai_heures: 48, relances_max: 2, journal_vie: false, visites_creneaux: false };
const texte = (v, max, requis = false) => { if (v !== undefined && v !== null && typeof v !== 'string') throw new ErreurHttp(400, 'demande_invalide'); const s = String(v ?? '').trim(); if ((requis && !s) || s.length > max) throw new ErreurHttp(400, 'demande_invalide'); return s || null; };
const exigerCategorie = (p, cat) => { if (!p.autorisations.includes(cat)) throw new ErreurHttp(403, 'proche_non_autorise', { categorie: cat }); };

async function reglages(db, etabId) {
  const r = (await db.query('SELECT famille_config FROM etablissements WHERE id = $1', [etabId])).rows[0];
  return { ...DEFAUT, ...(r?.famille_config || {}) };
}
async function historiser(c, demandeId, statut, par, note) {
  await c.query('INSERT INTO demandes_famille_historique (demande_id, statut, par_utilisateur, note) VALUES ($1, $2, $3, $4)', [demandeId, statut, par || null, note || null]);
}

/* ---------------------------------------------------------------- côté proche */
async function creerDemande(pool, p, b) {
  exigerCategorie(p, 'administratif');
  if (!CATEGORIES_DEMANDE.includes(b?.categorie)) throw new ErreurHttp(400, 'demande_invalide');
  const t = texte(b.texte, 1000, true);
  const cfg = await reglages(pool, p.etablissement_id);
  return transaction(pool, async (c) => {
    const d = (await c.query(`INSERT INTO demandes_famille (etablissement_id, resident_id, contact_id, categorie, texte, statut, echeance)
      VALUES ($1, $2, $3, $4, $5, 'nouvelle', now() + make_interval(hours => $6)) RETURNING *`, [p.etablissement_id, p.resident_id, p.contact_id, b.categorie, t, cfg.delai_heures])).rows[0];
    // Tâche créée d'office pour la coordination : la demande ne se perd jamais dans une boîte de messages
    const tache = (await c.query(`INSERT INTO taches_etab (etablissement_id, type, titre, resident_id, assigne_role, echeance) VALUES ($1, 'demande_famille', $2, $3, 'coordonnateur', $4) RETURNING id`,
      [p.etablissement_id, `Demande de famille n° ${d.id} (${b.categorie})`, p.resident_id, d.echeance])).rows[0];
    await c.query('UPDATE demandes_famille SET tache_id = $2 WHERE id = $1', [d.id, tache.id]);
    await historiser(c, d.id, 'nouvelle', null, 'Créée par le proche');
    return { id: d.id, categorie: d.categorie, statut: d.statut, cree_le: d.cree_le, echeance: d.echeance };
  });
}
async function demandesProche(pool, p) {
  return (await pool.query(`SELECT d.id, d.categorie, d.texte, d.statut, d.reponse, d.cree_le, d.modifie_le FROM demandes_famille d
    WHERE d.resident_id = $1 AND d.contact_id = $2 ORDER BY d.cree_le DESC LIMIT 50`, [p.resident_id, p.contact_id])).rows;
}
async function annulerDemande(pool, p, id) {
  return transaction(pool, async (c) => {
    const d = (await c.query('SELECT * FROM demandes_famille WHERE id = $1 AND resident_id = $2 AND contact_id = $3 FOR UPDATE', [id, p.resident_id, p.contact_id])).rows[0];
    if (!d) throw new ErreurHttp(404, 'demande_introuvable');
    if (FINAUX.includes(d.statut)) throw new ErreurHttp(409, 'demande_close');
    await c.query(`UPDATE demandes_famille SET statut = 'annulee', modifie_le = now() WHERE id = $1`, [id]);
    if (d.tache_id) await c.query(`UPDATE taches_etab SET statut = 'annulee', version = version + 1 WHERE id = $1 AND statut IN ('a_faire', 'en_cours')`, [d.tache_id]);
    await historiser(c, id, 'annulee', null, 'Annulée par le proche');
    return { id, statut: 'annulee' };
  });
}
async function confirmationsProche(pool, p) {
  const { rows } = await pool.query(`SELECT id, sujet, explication, echeance, statut, reponse, repondu_le, cree_le FROM confirmations_famille
    WHERE resident_id = $1 AND contact_id = $2 ORDER BY cree_le DESC LIMIT 30`, [p.resident_id, p.contact_id]);
  await pool.query(`UPDATE confirmations_famille SET vue_le = now() WHERE resident_id = $1 AND contact_id = $2 AND vue_le IS NULL`, [p.resident_id, p.contact_id]);
  return rows;
}
async function repondreConfirmation(pool, p, id, b) {
  if (!['confirmee', 'indisponible', 'precisions'].includes(b?.reponse)) throw new ErreurHttp(400, 'confirmation_invalide');
  const precision = texte(b.precision, 500);
  const n = (await pool.query(`UPDATE confirmations_famille SET statut = $4, reponse = $5, repondu_le = now(), vue_le = COALESCE(vue_le, now())
    WHERE id = $1 AND resident_id = $2 AND contact_id = $3 AND statut = 'en_attente' AND (echeance IS NULL OR echeance > now()) RETURNING id, statut, repondu_le, etablissement_id`, [id, p.resident_id, p.contact_id, b.reponse, precision])).rows[0];
  if (!n) throw new ErreurHttp(409, 'confirmation_close');
  await require('./services').notifier(pool, n.etablissement_id, null, 'famille_confirmation', { n: id });
  return { id: n.id, statut: n.statut, repondu_le: n.repondu_le };
}
async function creneauxProche(pool, p) {
  return (await pool.query(`SELECT c.id, c.debut, c.fin, c.capacite, c.capacite - (SELECT count(*)::int FROM demandes_visite v WHERE v.creneau_id = c.id AND v.statut IN ('demandee', 'acceptee')) AS places
    FROM visites_creneaux c WHERE c.etablissement_id = $1 AND c.actif AND c.debut > now() ORDER BY c.debut LIMIT 50`, [p.etablissement_id])).rows;
}
/** Visite sur un créneau : capacité revérifiée sous verrou, jamais de double réservation au-delà de la capacité. */
async function reserverCreneau(pool, p, b) {
  exigerCategorie(p, 'rendez_vous');
  const participants = Number(b?.participants ?? 1);
  if (!Number.isInteger(participants) || participants < 1 || participants > 6) throw new ErreurHttp(400, 'visite_invalide');
  return transaction(pool, async (c) => {
    const cr = (await c.query('SELECT * FROM visites_creneaux WHERE id = $1 AND etablissement_id = $2 AND actif AND debut > now() FOR UPDATE', [Number(b.creneau_id), p.etablissement_id])).rows[0];
    if (!cr) throw new ErreurHttp(404, 'creneau_introuvable');
    const pris = (await c.query(`SELECT count(*)::int n FROM demandes_visite WHERE creneau_id = $1 AND statut IN ('demandee', 'acceptee')`, [cr.id])).rows[0].n;
    if (pris >= cr.capacite) throw new ErreurHttp(409, 'creneau_complet');
    if ((await c.query(`SELECT 1 FROM demandes_visite WHERE creneau_id = $1 AND contact_id = $2 AND statut IN ('demandee', 'acceptee')`, [cr.id, p.contact_id])).rowCount) throw new ErreurHttp(409, 'visite_deja_demandee');
    return (await c.query(`INSERT INTO demandes_visite (etablissement_id, resident_id, contact_id, souhaitee_le, creneau_id, participants) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, souhaitee_le, statut`,
      [p.etablissement_id, p.resident_id, p.contact_id, cr.debut, cr.id, participants])).rows[0];
  });
}
async function annulerVisite(pool, p, id) {
  const n = (await pool.query(`UPDATE demandes_visite SET statut = 'annulee', traite_le = now() WHERE id = $1 AND resident_id = $2 AND contact_id = $3 AND statut IN ('demandee', 'acceptee') AND souhaitee_le > now() RETURNING id, statut`, [id, p.resident_id, p.contact_id])).rows[0];
  if (!n) throw new ErreurHttp(409, 'visite_deja_traitee');
  return n;
}
async function journalVieProche(pool, p) {
  if (!(await reglages(pool, p.etablissement_id)).journal_vie || !p.autorisations.includes('hebergement')) return { actif: false, publications: [] };
  return { actif: true, publications: (await pool.query(`SELECT id, titre, texte, publie_le FROM journal_vie WHERE etablissement_id = $1 AND statut = 'publie' AND (resident_id IS NULL OR resident_id = $2) ORDER BY publie_le DESC LIMIT 30`, [p.etablissement_id, p.resident_id])).rows };
}
/** OG Famille : règles locales sur les seules données du proche. Aucune donnée inventée, aucune action sans confirmation. */
async function og(pool, p, b) {
  const q = String(b?.question || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().slice(0, 500);
  const en = b?.langue === 'en'; const T = (fr, an) => (en ? an : fr);
  if (!q.trim()) throw new ErreurHttp(400, 'question_invalide');
  if (/(diagnostic|maladie|medicament|traitement|symptome|douleur|sante|health|medic|diagnos|symptom|pain)/.test(q)) {
    return { reponse: T('Je ne donne aucune information de santé. Pour l’état de santé, adressez-vous à l’équipe de soins. En cas d’urgence, appelez le 911.', 'I give no health information. For health status, contact the care team. In an emergency, call 911.') };
  }
  if (/(demande|request|vetement|clothes|besoin|need)/.test(q)) {
    const d = await demandesProche(pool, p);
    if (!d.length) return { reponse: T('Vous n’avez aucune demande en cours. Pour en créer une : onglet « Demandes ».', 'You have no request. To create one: the “Requests” tab.') };
    return { reponse: d.slice(0, 5).map((x) => `n° ${x.id} · ${x.categorie} · ${x.statut}${x.reponse ? ` · ${x.reponse}` : ''}`).join('\n'), source: 'demandes' };
  }
  if (/(visite|visit)/.test(q)) {
    const v = (await pool.query(`SELECT souhaitee_le, statut FROM demandes_visite WHERE resident_id = $1 AND contact_id = $2 AND statut IN ('demandee', 'acceptee') AND souhaitee_le > now() ORDER BY souhaitee_le LIMIT 1`, [p.resident_id, p.contact_id])).rows[0];
    return { reponse: v ? T(`Prochaine visite : ${v.souhaitee_le.toISOString()} (${v.statut === 'acceptee' ? 'confirmée' : 'en attente de confirmation'}).`, `Next visit: ${v.souhaitee_le.toISOString()} (${v.statut === 'acceptee' ? 'confirmed' : 'awaiting confirmation'}).`) : T('Aucune visite prévue. Onglet « Visites » pour en demander une.', 'No visit planned. Use the “Visits” tab to request one.'), source: 'visites' };
  }
  return { reponse: T('Je peux vous dire où en sont vos demandes et votre prochaine visite. Pour le reste, écrivez à l’établissement dans « Messages ».', 'I can tell you the status of your requests and your next visit. For anything else, write to the facility in “Messages”.') };
}

/* ---------------------------------------------------------------- côté personnel */
async function garde(pool, u, etabId) { await ch.etabChsld(pool, u, etabId, { roles: GESTION }); }
async function tableau(pool, u, etabId) {
  await garde(pool, u, etabId);
  const q = (sql) => pool.query(sql, [etabId]).then((r) => r.rows[0]);
  const [demandes, messages, reponse, confirmations, visites, retours] = await Promise.all([
    q(`SELECT count(*) FILTER (WHERE statut NOT IN ('resolue', 'refusee', 'annulee', 'cloturee'))::int ouvertes, count(*) FILTER (WHERE statut NOT IN ('resolue', 'refusee', 'annulee', 'cloturee') AND echeance < now())::int en_retard,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (resolue_le - cree_le)) / 60) FILTER (WHERE resolue_le IS NOT NULL) AS resolution_mediane_min FROM demandes_famille WHERE etablissement_id = $1`),
    q(`SELECT count(*)::int non_traites FROM messages_proches m JOIN residents r ON r.id = m.resident_id WHERE r.etablissement_id = $1 AND m.sens = 'proche' AND m.lu_le IS NULL`),
    q(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (rep.cree_le - m.cree_le)) / 60) AS mediane_min FROM messages_proches m JOIN residents r ON r.id = m.resident_id
       JOIN LATERAL (SELECT min(x.cree_le) cree_le FROM messages_proches x WHERE x.resident_id = m.resident_id AND x.contact_id = m.contact_id AND x.sens = 'etablissement' AND x.cree_le > m.cree_le) rep ON rep.cree_le IS NOT NULL
       WHERE r.etablissement_id = $1 AND m.sens = 'proche' AND m.cree_le > now() - interval '30 days'`),
    q(`SELECT count(*) FILTER (WHERE statut = 'en_attente')::int en_attente FROM confirmations_famille WHERE etablissement_id = $1`),
    q(`SELECT count(*) FILTER (WHERE statut = 'acceptee' AND souhaitee_le::date = now()::date)::int du_jour, count(*) FILTER (WHERE statut = 'demandee')::int a_traiter FROM demandes_visite WHERE etablissement_id = $1`),
    q(`SELECT count(*)::int planifies FROM coordinations WHERE destination_id = $1 AND type = 'retour' AND statut IN ('envoyee', 'acceptee', 'en_cours')`)]);
  const echecs = (await pool.query(`SELECT count(*)::int n FROM proches_notifications_journal j JOIN proches_acces a ON a.id = j.acces_id WHERE a.etablissement_id = $1 AND j.statut = 'echec' AND j.le > now() - interval '7 days'`, [etabId])).rows[0].n;
  return { demandes, messages: { ...messages, premiere_reponse_mediane_min: reponse.mediane_min }, confirmations, visites, retours, notifications_echouees: echecs,
    mesure: 'Chiffres calculés sur les données enregistrées dans Arrimo. Aucun nombre d’appels évités n’est estimé.' };
}
async function demandesEtab(pool, u, etabId) {
  await garde(pool, u, etabId);
  return (await pool.query(`SELECT d.id, d.categorie, d.texte, d.statut, d.reponse, d.note_interne, d.echeance, d.cree_le, d.tache_id, r.reference AS resident_ref, k.prenom, k.nom, (d.echeance < now() AND d.statut NOT IN ('resolue', 'refusee', 'annulee', 'cloturee')) AS en_retard
    FROM demandes_famille d JOIN residents r ON r.id = d.resident_id JOIN resident_contacts k ON k.id = d.contact_id WHERE d.etablissement_id = $1 ORDER BY (d.statut IN ('resolue', 'refusee', 'annulee', 'cloturee')), d.echeance LIMIT 300`, [etabId])).rows;
}
async function majDemande(pool, u, id, b) {
  if (!STATUTS_DEMANDE.includes(b?.statut) || b.statut === 'nouvelle') throw new ErreurHttp(400, 'demande_invalide');
  if (b.statut === 'refusee' && !texte(b.reponse, 500)) throw new ErreurHttp(400, 'motif_refus_requis');
  return transaction(pool, async (c) => {
    const d = (await c.query('SELECT * FROM demandes_famille WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!d) throw new ErreurHttp(404, 'demande_introuvable');
    await garde(c, u, d.etablissement_id);
    if (FINAUX.includes(d.statut) && b.statut !== 'cloturee') throw new ErreurHttp(409, 'demande_close');
    const reponse = b.reponse === undefined ? d.reponse : texte(b.reponse, 500);
    const note = b.note_interne === undefined ? d.note_interne : texte(b.note_interne, 1000);
    const n = (await c.query(`UPDATE demandes_famille SET statut = $2, reponse = $3, note_interne = $4, resolue_le = CASE WHEN $2 IN ('resolue', 'refusee') THEN COALESCE(resolue_le, now()) ELSE resolue_le END,
      modifie_le = now(), version = version + 1 WHERE id = $1 RETURNING *`, [id, b.statut, reponse, note])).rows[0];
    if (FINAUX.includes(b.statut) && d.tache_id) await c.query(`UPDATE taches_etab SET statut = 'faite', fait_par = $2, fait_le = now(), version = version + 1 WHERE id = $1 AND statut IN ('a_faire', 'en_cours')`, [d.tache_id, u.id]);
    await historiser(c, id, b.statut, u.id, null);
    if (reponse !== d.reponse || ['resolue', 'refusee', 'attente_proche'].includes(b.statut)) await notifs.signaler(c, d.resident_id, 'administratif', d.contact_id);
    return n;
  });
}
/** Une tâche de demande terminée dans l'écran des tâches résout la demande : une seule source de vérité, aucune double saisie. */
async function tacheTerminee(c, tache, u) {
  if (tache.type !== 'demande_famille') return;
  const d = (await c.query(`UPDATE demandes_famille SET statut = 'resolue', resolue_le = now(), modifie_le = now(), version = version + 1 WHERE tache_id = $1 AND statut NOT IN ('resolue', 'refusee', 'annulee', 'cloturee') RETURNING id, resident_id, contact_id`, [tache.id])).rows[0];
  if (d) { await historiser(c, d.id, 'resolue', u.id, 'Tâche terminée'); await notifs.signaler(c, d.resident_id, 'administratif', d.contact_id); }
}
async function creerConfirmation(pool, u, b) {
  const r = (await pool.query('SELECT id, etablissement_id FROM residents WHERE id = $1', [Number(b?.resident_id)])).rows[0];
  if (!r) throw new ErreurHttp(404, 'resident_introuvable');
  await garde(pool, u, r.etablissement_id);
  const k = (await pool.query('SELECT id FROM resident_contacts WHERE id = $1 AND resident_id = $2 AND actif', [Number(b.contact_id), r.id])).rows[0];
  if (!k) throw new ErreurHttp(404, 'contact_introuvable');
  const sujet = texte(b.sujet, 160, true); const explication = texte(b.explication, 1000);
  const echeance = b.echeance ? new Date(b.echeance) : null;
  if (echeance && (Number.isNaN(echeance.getTime()) || echeance < new Date())) throw new ErreurHttp(400, 'date_invalide');
  const n = (await pool.query(`INSERT INTO confirmations_famille (etablissement_id, resident_id, contact_id, sujet, explication, echeance, cree_par) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [r.etablissement_id, r.id, k.id, sujet, explication, echeance, u.id])).rows[0];
  await notifs.signaler(pool, r.id, 'administratif', k.id);
  return n;
}
/** Relances bornées : un rappel au dépassement de l'échéance, puis une escalade ; jamais plus que le réglage. */
async function relancer(pool) {
  const { rows } = await pool.query(`UPDATE demandes_famille d SET relances = relances + 1, derniere_relance_le = now()
    FROM etablissements e WHERE e.id = d.etablissement_id AND d.statut NOT IN ('resolue', 'refusee', 'annulee', 'cloturee') AND d.echeance < now()
      AND d.relances < COALESCE((e.famille_config->>'relances_max')::int, 2) AND (d.derniere_relance_le IS NULL OR d.derniere_relance_le < now() - interval '12 hours')
    RETURNING d.id, d.etablissement_id, d.relances`);
  for (const d of rows) await require('./services').notifier(pool, d.etablissement_id, null, d.relances > 1 ? 'famille_escalade' : 'famille_relance', { n: d.id });
  return rows.length;
}

function brancherProche(api, pool, route, s) {
  api.get('/proches/demandes', s, route((req) => demandesProche(pool, req.proche)));
  api.post('/proches/demandes', s, route((req) => creerDemande(pool, req.proche, req.body)));
  api.post('/proches/demandes/:id/annuler', s, route((req) => annulerDemande(pool, req.proche, Number(req.params.id))));
  api.get('/proches/confirmations', s, route((req) => confirmationsProche(pool, req.proche)));
  api.post('/proches/confirmations/:id/repondre', s, route((req) => repondreConfirmation(pool, req.proche, Number(req.params.id), req.body)));
  api.get('/proches/creneaux', s, route((req) => creneauxProche(pool, req.proche)));
  api.post('/proches/visites/creneau', s, route((req) => reserverCreneau(pool, req.proche, req.body)));
  api.post('/proches/visites/:id/annuler', s, route((req) => annulerVisite(pool, req.proche, Number(req.params.id))));
  api.get('/proches/journal-vie', s, route((req) => journalVieProche(pool, req.proche)));
  api.post('/proches/og', s, route((req) => og(pool, req.proche, req.body)));
}
function brancherPersonnel(api, pool, route, entier) {
  api.get('/famille/tableau', route((req) => tableau(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.get('/famille/demandes', route((req) => demandesEtab(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.post('/famille/demandes/:id', route((req) => majDemande(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.post('/famille/confirmations', route((req) => creerConfirmation(pool, req.utilisateur, req.body)));
  api.get('/famille/confirmations', route(async (req) => { const e = entier(req.query.etablissement_id, 'etablissement_id'); await garde(pool, req.utilisateur, e);
    return (await pool.query(`SELECT c.*, r.reference AS resident_ref, k.prenom, k.nom FROM confirmations_famille c JOIN residents r ON r.id = c.resident_id JOIN resident_contacts k ON k.id = c.contact_id WHERE c.etablissement_id = $1 ORDER BY c.cree_le DESC LIMIT 200`, [e])).rows; }));
  api.post('/famille/creneaux', route(async (req) => { const b = req.body || {}; const e = entier(b.etablissement_id, 'etablissement_id'); await garde(pool, req.utilisateur, e);
    const debut = new Date(b.debut); const fin = new Date(b.fin); const cap = Number(b.capacite);
    if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime()) || fin <= debut || debut < new Date() || !Number.isInteger(cap) || cap < 1 || cap > 50) throw new ErreurHttp(400, 'creneau_invalide');
    return (await pool.query('INSERT INTO visites_creneaux (etablissement_id, debut, fin, capacite, cree_par) VALUES ($1, $2, $3, $4, $5) RETURNING *', [e, debut, fin, cap, req.utilisateur.id])).rows[0]; }));
  api.put('/famille/reglages', route(async (req) => { const b = req.body || {}; const e = entier(b.etablissement_id, 'etablissement_id');
    await ch.etabChsld(pool, req.utilisateur, e, { roles: ['coordonnateur', 'admin_etab', 'gestionnaire'] });
    const v = await reglages(pool, e);
    if (b.delai_heures !== undefined) { if (!Number.isInteger(b.delai_heures) || b.delai_heures < 1 || b.delai_heures > 720) throw new ErreurHttp(400, 'reglage_invalide'); v.delai_heures = b.delai_heures; }
    if (b.relances_max !== undefined) { if (!Number.isInteger(b.relances_max) || b.relances_max < 0 || b.relances_max > 5) throw new ErreurHttp(400, 'reglage_invalide'); v.relances_max = b.relances_max; }
    if (b.journal_vie !== undefined) { if (typeof b.journal_vie !== 'boolean') throw new ErreurHttp(400, 'reglage_invalide'); v.journal_vie = b.journal_vie; }
    await pool.query('UPDATE etablissements SET famille_config = $2 WHERE id = $1', [e, v]); return v; }));
  api.get('/famille/reglages', route(async (req) => { const e = entier(req.query.etablissement_id, 'etablissement_id'); await garde(pool, req.utilisateur, e); return reglages(pool, e); }));
  // Journal de vie : brouillon, publication par un responsable, retrait. Aucune photo : l'autorisation des personnes reconnaissables n'est pas encore gérée.
  api.post('/famille/journal-vie', route(async (req) => { const b = req.body || {}; const e = entier(b.etablissement_id, 'etablissement_id'); await garde(pool, req.utilisateur, e);
    const titre = texte(b.titre, 120, true); const t = texte(b.texte, 2000, true);
    const rid = b.resident_id ? Number(b.resident_id) : null;
    if (rid && !(await pool.query('SELECT 1 FROM residents WHERE id = $1 AND etablissement_id = $2', [rid, e])).rowCount) throw new ErreurHttp(404, 'resident_introuvable');
    return (await pool.query(`INSERT INTO journal_vie (etablissement_id, resident_id, titre, texte, auteur) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [e, rid, titre, t, req.utilisateur.id])).rows[0]; }));
  api.post('/famille/journal-vie/:id/:action', route(async (req) => { const id = entier(req.params.id, 'id'); const a = req.params.action;
    if (!['publier', 'retirer'].includes(a)) throw new ErreurHttp(404, 'action_inconnue');
    const j = (await pool.query('SELECT * FROM journal_vie WHERE id = $1', [id])).rows[0]; if (!j) throw new ErreurHttp(404, 'publication_introuvable');
    await ch.etabChsld(pool, req.utilisateur, j.etablissement_id, { roles: ['coordonnateur', 'admin_etab', 'gestionnaire'] });
    if (a === 'publier' && j.auteur === req.utilisateur.id && !req.utilisateur.gestionnaire && req.utilisateur.role !== 'admin_etab') throw new ErreurHttp(409, 'publication_autre_validateur');
    const n = (await pool.query(`UPDATE journal_vie SET statut = $2, valide_par = CASE WHEN $2 = 'publie' THEN $3::int ELSE valide_par END, publie_le = CASE WHEN $2 = 'publie' THEN now() ELSE publie_le END WHERE id = $1 RETURNING *`, [id, a === 'publier' ? 'publie' : 'retire', req.utilisateur.id])).rows[0];
    if (a === 'publier') { const dests = n.resident_id ? [n.resident_id] : (await pool.query(`SELECT id FROM residents WHERE etablissement_id = $1 AND statut NOT IN ('sorti', 'transfere')`, [n.etablissement_id])).rows.map((x) => x.id); for (const r of dests) await notifs.signaler(pool, r, 'hebergement'); }
    return n; }));
  api.get('/famille/journal-vie', route(async (req) => { const e = entier(req.query.etablissement_id, 'etablissement_id'); await garde(pool, req.utilisateur, e);
    return (await pool.query('SELECT j.*, a.nom AS auteur_nom FROM journal_vie j LEFT JOIN utilisateurs a ON a.id = j.auteur WHERE j.etablissement_id = $1 ORDER BY j.cree_le DESC LIMIT 100', [e])).rows; }));
}
module.exports = { brancherProche, brancherPersonnel, tacheTerminee, relancer, reglages, CATEGORIES_DEMANDE };
