'use strict';
/**
 * Portail des proches (phase pilote) — démonstration et recette seulement, module optionnel « portail_proches ».
 * - Invitation individuelle par une personne habilitée du CHSLD, pour un contact actif qui a un courriel et au moins
 *   une autorisation ; jeton aléatoire à usage unique, conservé seulement sous forme d'empreinte, valable 72 h.
 * - Sessions du portail distinctes de celles du personnel (préfixe « P. », 8 h), jamais acceptées par l'API du personnel.
 * - À chaque requête, l'accès est revérifié : accès actif, non révoqué, non expiré ; contact actif ; module actif.
 *   Une révocation ou un retrait d'autorisation prend effet immédiatement.
 * - Le proche ne voit que : son profil, le prénom et l'initiale du résident, l'établissement, et les messages des
 *   catégories qui lui sont autorisées. Jamais la chambre, la localisation, les mouvements détaillés ni une donnée clinique.
 * - Échecs de connexion comptés par accès : 5 échecs bloquent 15 minutes.
 */
const crypto = require('node:crypto');
const { transaction, ErreurHttp } = require('./db');
const { hacherAsync, verifierAsync, verifierRobustesse } = require('./auth');
const { journaliser } = require('./regles');
const TE = require('./types-etablissement');
const ch = require('./chsld');

const empreinte = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
const DUREE_SESSION_H = 8, DUREE_INVITATION_H = 72, ECHECS_MAX = 5, BLOCAGE_MIN = 15;

/* ------------------------------------------------------------------ côté personnel */
async function inviter(pool, u, contactId, b = {}) {
  ch.exigerFictifs();
  const k = (await pool.query('SELECT k.*, r.etablissement_id, r.reference FROM resident_contacts k JOIN residents r ON r.id = k.resident_id WHERE k.id = $1', [contactId])).rows[0];
  if (!k || !k.actif) throw new ErreurHttp(404, 'contact_introuvable');
  const e = await ch.etabChsld(pool, u, k.etablissement_id, { roles: ['coordonnateur', 'admin_etab', 'gestionnaire'] });
  if (!TE.moduleActif(e, 'portail_proches')) throw new ErreurHttp(403, 'module_desactive', { module: 'portail_proches' });
  if (!k.courriel) throw new ErreurHttp(409, 'proche_courriel_requis');
  if (!k.autorisations.length) throw new ErreurHttp(409, 'proche_sans_autorisation');
  const expire = b.expire_le ? new Date(b.expire_le) : null;
  if (expire && (Number.isNaN(expire.getTime()) || expire <= new Date())) throw new ErreurHttp(400, 'date_invalide');
  const jeton = crypto.randomBytes(32).toString('hex');
  return transaction(pool, async (c) => {
    // Une nouvelle invitation remplace l'accès précédent du même contact (révoqué)
    await c.query(`UPDATE proches_acces SET revoque_le = now(), revoque_par = $2 WHERE contact_id = $1 AND revoque_le IS NULL`, [k.id, u.id]);
    await c.query('DELETE FROM proches_sessions WHERE acces_id IN (SELECT id FROM proches_acces WHERE contact_id = $1)', [k.id]);
    await c.query('DELETE FROM proches_notifications_attente WHERE acces_id IN (SELECT id FROM proches_acces WHERE contact_id = $1)', [k.id]);
    const a = (await c.query(`INSERT INTO proches_acces (contact_id, resident_id, etablissement_id, courriel, invitation_hash, invitation_expire_le, expire_le, cree_par)
      VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6), $7, $8) RETURNING id, courriel, invitation_expire_le, expire_le`,
    [k.id, k.resident_id, k.etablissement_id, k.courriel, empreinte(jeton), DUREE_INVITATION_H, expire, u.id]).catch((err) => {
      if (err.code === '23505') throw new ErreurHttp(409, 'proche_courriel_deja_invite'); throw err;
    })).rows[0];
    await journaliser(c, { etablissementId: k.etablissement_id, utilisateurId: u.id, action: 'Portail des proches', detail: `${k.reference} · invitation (${k.relation})` });
    // Le lien est remis une seule fois à la personne habilitée ; seul son empreinte est conservée.
    return { ...a, lien: `/proches#invitation=${jeton}` };
  });
}
async function revoquer(pool, u, accesId) {
  const a = (await pool.query('SELECT a.*, r.reference FROM proches_acces a JOIN residents r ON r.id = a.resident_id WHERE a.id = $1', [accesId])).rows[0];
  if (!a) throw new ErreurHttp(404, 'acces_introuvable');
  await ch.etabChsld(pool, u, a.etablissement_id, { roles: ['coordonnateur', 'admin_etab', 'gestionnaire'] });
  return transaction(pool, async (c) => {
    await c.query('UPDATE proches_acces SET revoque_le = COALESCE(revoque_le, now()), revoque_par = COALESCE(revoque_par, $2), actif = false WHERE id = $1', [accesId, u.id]);
    await c.query('DELETE FROM proches_sessions WHERE acces_id = $1', [accesId]);
    // Plus aucune notification : file d'attente et adresses de poussée retirées
    await c.query('DELETE FROM proches_notifications_attente WHERE acces_id = $1', [accesId]);
    await c.query('DELETE FROM proches_abonnements_push WHERE acces_id = $1', [accesId]);
    await journaliser(c, { etablissementId: a.etablissement_id, utilisateurId: u.id, action: 'Portail des proches', detail: `${a.reference} · accès révoqué` });
    return { revoque: true };
  });
}
async function accesResident(pool, u, residentId) {
  const { e } = await (async () => { const r = (await pool.query('SELECT etablissement_id FROM residents WHERE id = $1', [residentId])).rows[0]; if (!r) throw new ErreurHttp(404, 'resident_introuvable'); return { e: await ch.etabChsld(pool, u, r.etablissement_id) }; })();
  const acces = (await pool.query(`SELECT a.id, a.contact_id, a.courriel, a.actif, a.expire_le, a.revoque_le, a.derniere_connexion, a.invitation_expire_le, a.cree_le
    FROM proches_acces a WHERE a.resident_id = $1 ORDER BY a.cree_le DESC`, [residentId])).rows;
  const messages = (await pool.query(`SELECT m.id, m.contact_id, m.sens, m.categorie, m.texte, m.cree_le, m.lu_le, u.nom AS par FROM messages_proches m LEFT JOIN utilisateurs u ON u.id = m.par
    WHERE m.resident_id = $1 ORDER BY m.cree_le`, [residentId])).rows;
  return { module_actif: TE.moduleActif(e, 'portail_proches'), acces, messages };
}
async function messagePersonnel(pool, u, residentId, b) {
  const r = (await pool.query('SELECT * FROM residents WHERE id = $1', [residentId])).rows[0];
  if (!r) throw new ErreurHttp(404, 'resident_introuvable');
  await ch.etabChsld(pool, u, r.etablissement_id, { roles: ['coordonnateur', 'admin_etab', 'gestionnaire', 'equipe_soins'], module: 'proches' });
  const k = (await pool.query('SELECT * FROM resident_contacts WHERE id = $1 AND resident_id = $2 AND actif', [Number(b.contact_id), r.id])).rows[0];
  if (!k) throw new ErreurHttp(404, 'contact_introuvable');
  if (!k.autorisations.includes(b.categorie)) throw new ErreurHttp(403, 'proche_non_autorise', { categorie: b.categorie });
  const texte = String(b.texte || '').trim().slice(0, 2000);
  if (!texte) throw new ErreurHttp(400, 'communication_invalide');
  return transaction(pool, async (c) => {
    const m = (await c.query(`INSERT INTO messages_proches (resident_id, contact_id, sens, categorie, texte, par) VALUES ($1, $2, 'etablissement', $3, $4, $5) RETURNING *`, [r.id, k.id, b.categorie, texte, u.id])).rows[0];
    await c.query(`UPDATE messages_proches SET lu_le = now() WHERE resident_id = $1 AND contact_id = $2 AND sens = 'proche' AND lu_le IS NULL`, [r.id, k.id]);
    await journaliser(c, { etablissementId: r.etablissement_id, utilisateurId: u.id, action: 'Portail des proches', detail: `${r.reference} · message (${b.categorie})` });
    await require('./portail-notifications').signaler(c, r.id, b.categorie, k.id);
    return m;
  });
}

/* ------------------------------------------------------------------ côté portail (sans session du personnel) */
async function accesValide(db, accesId) {
  const a = (await db.query(`SELECT a.*, k.prenom, k.nom AS contact_nom, k.relation, k.autorisations, k.actif AS contact_actif, k.langue,
      r.prenom AS r_prenom, r.nom AS r_nom, r.statut AS r_statut, e.nom AS etab_nom, e.modules, e.type_etablissement, e.module_actif
    FROM proches_acces a JOIN resident_contacts k ON k.id = a.contact_id JOIN residents r ON r.id = a.resident_id JOIN etablissements e ON e.id = a.etablissement_id WHERE a.id = $1`, [accesId])).rows[0];
  if (!a || !a.actif || a.revoque_le || (a.expire_le && a.expire_le < new Date()) || !a.contact_actif || !a.autorisations.length || !a.module_actif
    || !TE.moduleActif({ type_etablissement: a.type_etablissement, modules: a.modules }, 'portail_proches') || ['sorti', 'transfere'].includes(a.r_statut)) {
    throw new ErreurHttp(401, 'acces_proche_revoque');
  }
  return a;
}
function sessionPortail(pool) {
  return async (req, res, next) => {
    try {
      ch.exigerFictifs();
      const entete = req.get('authorization') || '';
      const jeton = entete.startsWith('Bearer P.') ? entete.slice(9) : null;
      if (!jeton) throw new ErreurHttp(401, 'connexion_requise');
      const s = (await pool.query('SELECT acces_id FROM proches_sessions WHERE jeton_hash = $1 AND expire_le > now()', [empreinte(jeton)])).rows[0];
      if (!s) throw new ErreurHttp(401, 'session_expiree');
      req.proche = await accesValide(pool, s.acces_id);
      req.proche.jeton_hash = empreinte(jeton);
      next();
    } catch (err) { next(err); }
  };
}
async function accepterInvitation(pool, b) {
  ch.exigerFictifs();
  verifierRobustesse(b.mot_de_passe);
  const hash = await hacherAsync(String(b.mot_de_passe));
  return transaction(pool, async (c) => {
    const a = (await c.query(`SELECT * FROM proches_acces WHERE invitation_hash = $1 AND revoque_le IS NULL AND invitation_expire_le > now() FOR UPDATE`, [empreinte(b.jeton || '')])).rows[0];
    if (!a) throw new ErreurHttp(400, 'invitation_invalide');
    await c.query('UPDATE proches_acces SET mot_de_passe_hash = $2, actif = true, invitation_hash = NULL, invitation_expire_le = NULL WHERE id = $1', [a.id, hash]);
    await journaliser(c, { etablissementId: a.etablissement_id, action: 'Portail des proches', detail: 'invitation acceptée' });
    return { courriel: a.courriel };
  });
}
async function connexion(pool, b) {
  ch.exigerFictifs();
  const courriel = String(b.courriel || '').trim().toLowerCase();
  // Un même courriel peut être lié à plusieurs résidents, chacun avec son accès et ses droits : une session étanche par accès valide
  const tous = (await pool.query('SELECT * FROM proches_acces WHERE lower(courriel) = $1 AND revoque_le IS NULL AND actif AND mot_de_passe_hash IS NOT NULL ORDER BY id', [courriel])).rows;
  const ok = [];
  for (const a of tous.length ? tous : [null]) {
    // Même message et même coût pour un courriel inconnu, un mot de passe faux ou un accès bloqué
    const bon = await verifierAsync(String(b.mot_de_passe || ''), a?.mot_de_passe_hash || 'x:00');
    if (a && bon && !(a.bloque_jusqu_au && a.bloque_jusqu_au > new Date())) { try { await accesValide(pool, a.id); ok.push(a); } catch { /* accès devenu invalide : ignoré */ } }
    else if (a && !bon) await pool.query(`UPDATE proches_acces SET echecs = echecs + 1,
      bloque_jusqu_au = CASE WHEN echecs + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE bloque_jusqu_au END WHERE id = $1`, [a.id, ECHECS_MAX, BLOCAGE_MIN]);
  }
  if (!ok.length) throw new ErreurHttp(401, 'identifiants_incorrects');
  const profils = [];
  for (const a of ok) {
    const jeton = crypto.randomBytes(32).toString('hex');
    await pool.query(`INSERT INTO proches_sessions (jeton_hash, acces_id, expire_le) VALUES ($1, $2, now() + make_interval(hours => $3))`, [empreinte(jeton), a.id, DUREE_SESSION_H]);
    await pool.query('UPDATE proches_acces SET echecs = 0, bloque_jusqu_au = NULL, derniere_connexion = now() WHERE id = $1', [a.id]);
    const v = await accesValide(pool, a.id);
    profils.push({ token: `P.${jeton}`, resident: `${v.r_prenom} ${String(v.r_nom).slice(0, 1)}.`, etablissement: v.etab_nom });
  }
  return { token: profils[0].token, profils };
}
/**
 * Situation du résident, seulement dans les catégories autorisées, à partir des faits enregistrés :
 * - « hebergement » : présent, absence temporaire (jamais la chambre) ;
 * - « mouvements » : hospitalisation (hôpital nommé avec la date de confirmation de réception, ou départ confirmé
 *   avec « arrivée non encore confirmée »), retour prévu. Jamais de position en temps réel.
 */
/**
 * Étape confirmée du parcours, lue dans les mêmes événements que les modules CHSLD et Hôpital. Jamais déduite, jamais de donnée clinique.
 * Une date vient toujours de l'étape confirmée correspondante. `parcours` : les étapes du parcours en cours, avec leur date.
 */
const REINTEGRE_JOURS = 7;
async function situation(pool, p) {
  const voitHebergement = p.autorisations.includes('hebergement'), voitMouvements = p.autorisations.includes('mouvements');
  if (!voitHebergement && !voitMouvements) return null;
  const r = (await pool.query('SELECT statut FROM residents WHERE id = $1', [p.resident_id])).rows[0];
  const maj = (await pool.query(`SELECT max(date) d FROM resident_mouvements WHERE resident_id = $1 AND type <> 'modification'`, [p.resident_id])).rows[0].d;
  const s = { mis_a_jour_le: maj };
  const parcoursDe = async () => {
    const cos = (await pool.query(`SELECT c.id, c.liee_id, c.type, c.statut, c.cree_le, c.arrivee_le, c.retour_prevu_le, c.reintegree_le, c.cloturee_le, d.nom AS destination,
        (SELECT max(x.date) FROM coordination_etapes x WHERE x.coordination_id = c.id AND x.statut = 'en_cours') AS depart_le
      FROM coordinations c JOIN etablissements d ON d.id = c.destination_id WHERE c.resident_id = $1 AND c.type IN ('hospitalisation', 'transfert_hopital', 'retour') ORDER BY c.cree_le DESC, c.id DESC LIMIT 12`, [p.resident_id])).rows;
    const hosp = cos.find((c) => c.type === 'hospitalisation') || null;
    // Séjour arrivé par transfert d'un autre hôpital : le parcours commence à la première hospitalisation de la chaîne
    let debut = hosp;
    for (let i = 0; debut?.liee_id && i < 5; i++) { const t = cos.find((c) => c.id === debut.liee_id && c.type === 'transfert_hopital'); const h = t && cos.find((c) => c.id === t.liee_id); if (!h) break; debut = h; }
    return { hosp, debut, transfert: cos.find((c) => c.type === 'transfert_hopital') || null, retour: cos.find((c) => c.type === 'retour') || null };
  };
  const { hosp, debut, transfert, retour } = voitMouvements ? await parcoursDe() : {};
  const ouvert = (c) => c && ['envoyee', 'acceptee', 'en_cours'].includes(c.statut);
  const etapes = (h0, ret) => {
    const h = h0 && debut && h0.id === hosp?.id ? debut : h0;
    const pas = (code, date) => ({ code, date: date || null, fait: !!date });
    const accepte = ret && ['acceptee', 'en_cours', 'recue'].includes(ret.statut);
    return [pas('transfert_preparation', h?.cree_le), pas('depart_confirme', h?.depart_le), pas('hospitalisation_en_cours', h?.arrivee_le),
      pas('retour_prevu', accepte ? ret.retour_prevu_le : null), pas('arrivee_confirmee', ret?.arrivee_le), pas('reintegre', ret?.reintegree_le)];
  };
  if (r.statut === 'hospitalise') {
    if (!voitMouvements) return { ...s, statut: 'absent_etablissement' };
    const retourActif = ouvert(retour) && ['acceptee', 'en_cours'].includes(retour.statut) ? retour : null;
    const base = { ...s, hopital: hosp?.destination || null, retour_prevu_le: retourActif?.retour_prevu_le || null, parcours: etapes(hosp, retourActif) };
    if (retourActif?.statut === 'en_cours') return { ...base, statut: 'retour_en_route', depuis: retourActif.depart_le };
    if (transfert?.statut === 'en_cours') return { ...base, statut: 'transfert_entre_hopitaux', hopital: transfert.destination, depuis: transfert.depart_le };
    if (hosp?.statut === 'recue') return { ...base, statut: 'hospitalise_confirme', depuis: hosp.arrivee_le };
    return { ...base, statut: 'hospitalise_depart_confirme', depuis: hosp?.depart_le || null };
  }
  if (voitMouvements) {
    if (r.statut === 'retour_a_reintegrer') return { ...s, statut: 'arrivee_confirmee', depuis: retour?.arrivee_le || null, parcours: etapes(hosp, retour) };
    if (r.statut === 'present' && ouvert(hosp)) return { ...s, statut: 'transfert_preparation', hopital: hosp.destination, depuis: hosp.cree_le, parcours: etapes(hosp, null) };
    if (r.statut === 'present' && retour?.reintegree_le && Date.now() - new Date(retour.reintegree_le).getTime() < REINTEGRE_JOURS * 86400000) return { ...s, statut: 'reintegre', depuis: retour.reintegree_le, parcours: etapes(hosp, retour) };
  }
  if (!voitHebergement) return null;
  return { ...s, statut: r.statut === 'absent' ? 'absence_temporaire' : ['present', 'retour_a_reintegrer'].includes(r.statut) ? 'present' : 'autre' };
}
/** Pour l'actualisation automatique : ne marque rien comme lu, ne renvoie qu'une empreinte et le nombre de messages non lus. */
async function etat(pool, p) {
  const sit = await situation(pool, p);
  const m = (await pool.query(`SELECT count(*)::int n, max(cree_le) d, count(*) FILTER (WHERE sens = 'etablissement' AND lu_le IS NULL)::int non_lus FROM messages_proches WHERE resident_id = $1 AND contact_id = $2 AND categorie = ANY($3)`, [p.resident_id, p.contact_id, p.autorisations])).rows[0];
  const v = (await pool.query('SELECT count(*)::int n, max(COALESCE(traite_le, cree_le)) d FROM demandes_visite WHERE resident_id = $1 AND contact_id = $2', [p.resident_id, p.contact_id])).rows[0];
  const a = (await pool.query('SELECT count(*)::int n, max(cree_le) d FROM activites_etab WHERE etablissement_id = $1 AND actif', [p.etablissement_id])).rows[0];
  return { empreinte: require('node:crypto').createHash('sha256').update(JSON.stringify([sit, m.n, m.d, v, a])).digest('hex').slice(0, 24), non_lus: m.non_lus };
}
async function moi(pool, p) {
  const nouveaux = (await pool.query(`SELECT count(*)::int n FROM messages_proches WHERE resident_id = $1 AND contact_id = $2 AND sens = 'etablissement' AND lu_le IS NULL AND categorie = ANY($3)`,
    [p.resident_id, p.contact_id, p.autorisations])).rows[0].n;
  const etatResident = await situation(pool, p);
  const messages = (await pool.query(`SELECT id, sens, categorie, texte, cree_le, lu_le FROM messages_proches WHERE resident_id = $1 AND contact_id = $2 AND categorie = ANY($3) ORDER BY cree_le`,
    [p.resident_id, p.contact_id, p.autorisations])).rows;
  await pool.query(`UPDATE messages_proches SET lu_le = now() WHERE resident_id = $1 AND contact_id = $2 AND sens = 'etablissement' AND lu_le IS NULL AND categorie = ANY($3)`, [p.resident_id, p.contact_id, p.autorisations]);
  const visites = p.autorisations.includes('rendez_vous') ? (await pool.query(`SELECT id, souhaitee_le, statut FROM demandes_visite WHERE resident_id = $1 AND contact_id = $2 ORDER BY souhaitee_le DESC LIMIT 20`, [p.resident_id, p.contact_id])).rows : null;
  const activites = (await pool.query(`SELECT id, titre, description, debut_le FROM activites_etab WHERE etablissement_id = $1 AND actif AND debut_le >= now() - interval '1 day' ORDER BY debut_le LIMIT 20`, [p.etablissement_id])).rows;
  return { proche: { prenom: p.prenom, nom: p.contact_nom, relation: p.relation, langue: p.langue }, resident: { prenom: p.r_prenom, initiale: `${String(p.r_nom).slice(0, 1)}.` },
    etablissement: { nom: p.etab_nom }, autorisations: p.autorisations, expire_le: p.expire_le, messages, nouveaux_messages: nouveaux, situation: etatResident, visites, activites };
}
async function messageProche(pool, p, b) {
  if (!p.autorisations.includes(b.categorie)) throw new ErreurHttp(403, 'proche_non_autorise', { categorie: b.categorie });
  const texte = String(b.texte || '').trim().slice(0, 2000);
  if (!texte) throw new ErreurHttp(400, 'communication_invalide');
  const rappel = b.rappel === true;
  return transaction(pool, async (c) => {
    const m = (await c.query(`INSERT INTO messages_proches (resident_id, contact_id, sens, categorie, texte) VALUES ($1, $2, 'proche', $3, $4) RETURNING id, sens, categorie, texte, cree_le`, [p.resident_id, p.contact_id, b.categorie, texte])).rows[0];
    if (rappel) await c.query(`INSERT INTO communications_proches (resident_id, contact_id, type, sens, categorie, sujet) VALUES ($1, $2, 'rappel_demande', 'entrant', $3, $4)`,
      [p.resident_id, p.contact_id, b.categorie, `Rappel demandé par le proche (portail)`]);
    await journaliser(c, { etablissementId: p.etablissement_id, action: 'Portail des proches', detail: `${rappel ? 'demande de rappel' : 'message'} (${b.categorie})` });
    return m;
  });
}
async function demanderVisite(pool, p, b) {
  if (!p.autorisations.includes('rendez_vous')) throw new ErreurHttp(403, 'proche_non_autorise', { categorie: 'rendez_vous' });
  const le = new Date(b?.souhaitee_le);
  if (Number.isNaN(le.getTime()) || le <= new Date()) throw new ErreurHttp(400, 'date_invalide');
  return transaction(pool, async (c) => {
    const v = (await c.query('INSERT INTO demandes_visite (etablissement_id, resident_id, contact_id, souhaitee_le) VALUES ($1, $2, $3, $4) RETURNING id, souhaitee_le, statut', [p.etablissement_id, p.resident_id, p.contact_id, le])).rows[0];
    await journaliser(c, { etablissementId: p.etablissement_id, action: 'Portail des proches', detail: 'demande de visite' });
    return v;
  });
}
async function deconnexion(pool, p) { await pool.query('DELETE FROM proches_sessions WHERE jeton_hash = $1', [p.jeton_hash]); return { ok: true }; }

/** Routes publiques du portail : à brancher AVANT la session du personnel. */
function brancherPublic(api, pool, route) {
  api.post('/proches/invitation', route((req) => accepterInvitation(pool, req.body)));
  api.post('/proches/connexion', route((req) => connexion(pool, req.body)));
  const s = sessionPortail(pool);
  api.get('/proches/moi', s, route((req) => moi(pool, req.proche)));
  api.post('/proches/messages', s, route((req) => messageProche(pool, req.proche, req.body)));
  api.get('/proches/etat', s, route((req) => etat(pool, req.proche)));
  require('./famille').brancherProche(api, pool, route, s);
  require('./portail-notifications').brancherProche(api, pool, route, s);
  api.post('/proches/visites', s, route((req) => demanderVisite(pool, req.proche, req.body)));
  api.post('/proches/deconnexion', s, route((req) => deconnexion(pool, req.proche)));
}
/** Routes du personnel (avec session). */
function brancherPersonnel(api, pool, route, entier) {
  require('./famille').brancherPersonnel(api, pool, route, entier);
  const GESTION = ['coordonnateur', 'admin_etab', 'gestionnaire', 'equipe_soins'];
  const garde = async (u, id) => { await ch.etabChsld(pool, u, id, { roles: GESTION }); };
  api.get('/chsld/visites', route(async (req) => { const e = entier(req.query.etablissement_id, 'etablissement_id'); await garde(req.utilisateur, e);
    return (await pool.query(`SELECT v.id, v.souhaitee_le, v.statut, r.reference AS resident_ref, k.prenom, k.nom FROM demandes_visite v JOIN residents r ON r.id = v.resident_id JOIN resident_contacts k ON k.id = v.contact_id WHERE v.etablissement_id = $1 ORDER BY v.souhaitee_le DESC LIMIT 100`, [e])).rows; }));
  api.post('/chsld/visites/:id/reponse', route(async (req) => { const id = entier(req.params.id, 'id');
    if (!['acceptee', 'refusee', 'annulee'].includes(req.body?.statut)) throw new ErreurHttp(400, 'visite_invalide');
    const v = (await pool.query('SELECT etablissement_id FROM demandes_visite WHERE id = $1', [id])).rows[0]; if (!v) throw new ErreurHttp(404, 'visite_introuvable');
    await garde(req.utilisateur, v.etablissement_id);
    const n = (await pool.query(`UPDATE demandes_visite SET statut = $2, traite_par = $3, traite_le = now() WHERE id = $1 AND statut = 'demandee' RETURNING id, statut, resident_id, contact_id`, [id, req.body.statut, req.utilisateur.id])).rows[0];
    if (!n) throw new ErreurHttp(409, 'visite_deja_traitee');
    await require('./portail-notifications').signaler(pool, n.resident_id, 'rendez_vous', n.contact_id);
    return { id: n.id, statut: n.statut }; }));
  api.get('/chsld/activites', route(async (req) => { const e = entier(req.query.etablissement_id, 'etablissement_id'); await garde(req.utilisateur, e);
    return (await pool.query('SELECT id, titre, description, debut_le FROM activites_etab WHERE etablissement_id = $1 AND actif ORDER BY debut_le DESC LIMIT 100', [e])).rows; }));
  api.post('/chsld/activites', route(async (req) => { const b = req.body || {}; const e = entier(b.etablissement_id, 'etablissement_id'); await garde(req.utilisateur, e);
    const titre = String(b.titre ?? '').trim(); const le = new Date(b.debut_le);
    if (!titre || titre.length > 120 || Number.isNaN(le.getTime())) throw new ErreurHttp(400, 'activite_invalide');
    return (await pool.query('INSERT INTO activites_etab (etablissement_id, titre, description, debut_le, publie_par) VALUES ($1, $2, $3, $4, $5) RETURNING id, titre, description, debut_le', [e, titre, String(b.description ?? '').trim().slice(0, 1000) || null, le, req.utilisateur.id])).rows[0]; }));
  api.delete('/chsld/activites/:id', route(async (req) => { const id = entier(req.params.id, 'id'); const v = (await pool.query('SELECT etablissement_id FROM activites_etab WHERE id = $1', [id])).rows[0]; if (!v) throw new ErreurHttp(404, 'activite_invalide');
    await garde(req.utilisateur, v.etablissement_id); await pool.query('UPDATE activites_etab SET actif = false WHERE id = $1', [id]); return { ok: true }; }));
  api.post('/chsld/contacts/:id/acces-portail', route((req) => inviter(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.post('/chsld/acces-portail/:id/revoquer', route((req) => revoquer(pool, req.utilisateur, entier(req.params.id, 'id'))));
  api.get('/chsld/residents/:id/portail', route((req) => accesResident(pool, req.utilisateur, entier(req.params.id, 'id'))));
  api.post('/chsld/residents/:id/messages', route((req) => messagePersonnel(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
}
module.exports = { brancherPublic, brancherPersonnel, inviter, revoquer, connexion, accepterInvitation };
