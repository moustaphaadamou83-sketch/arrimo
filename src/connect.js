'use strict';
/**
 * Arrimo Connect, secours (cahier 2, section 11) : API versionnée pour les systèmes des organisations de secours
 * (système de répartition d'un CCS, système ambulancier). Arrimo ne remplace pas ces systèmes : il reçoit et rend
 * les mêmes informations que l'écran, avec les mêmes règles (src/prealertes.js) ; il ne commande jamais une ambulance.
 *
 * Sécurité (section 11.4) :
 * - clé par système, montrée une seule fois (empreinte stockée) ; secret de signature chiffré au repos ;
 * - chaque requête est signée : X-Arrimo-Signature = HMAC-SHA256(secret, `${horodatage}.${METHODE}.${chemin}.${corps}`),
 *   horodatage (X-Arrimo-Horodatage, millisecondes) valable 5 minutes ; comparaison à temps constant ;
 * - créations idempotentes (clé d'envoi du partenaire) ; limitation des requêtes par l'API ; refus journalisés sans contenu.
 */
const crypto = require('crypto');
const { ErreurHttp } = require('./db');
const { chiffrerSecretMfa, lireSecretMfa } = require('./auth');
const pa = require('./prealertes');

const FENETRE_MS = 5 * 60 * 1000;
const empreinte = (cle) => crypto.createHash('sha256').update(String(cle)).digest('hex');

/** Nouveau système relié (clé et secret montrés une seule fois). */
async function creerConnecteurSecours(db, organisationId, nom) {
  const cle = `acx_${crypto.randomBytes(18).toString('hex')}`;
  const secret = crypto.randomBytes(32).toString('base64url');
  const r = (await db.query('INSERT INTO connecteurs_secours (organisation_id, nom, cle_hash, secret) VALUES ($1, $2, $3, $4) RETURNING id, organisation_id, nom',
    [organisationId, String(nom || 'Système partenaire').slice(0, 100), empreinte(cle), chiffrerSecretMfa(secret)])).rows[0];
  return { ...r, cle, secret };
}
/** Signature attendue d'une requête (documentée pour les partenaires et utilisée par les simulateurs). */
function signer(secret, horodatage, methode, chemin, corps) {
  return crypto.createHmac('sha256', secret).update(`${horodatage}.${String(methode).toUpperCase()}.${chemin}.${corps || ''}`).digest('hex');
}
/** Identifie le système et vérifie la signature ; rend un « utilisateur technique » aux droits de son organisation. */
async function authentifier(pool, req) {
  const cle = req.get('x-arrimo-cle'); const h = Number(req.get('x-arrimo-horodatage')); const sig = String(req.get('x-arrimo-signature') || '');
  if (!cle || !h || !sig) throw new ErreurHttp(401, 'connect_signature_invalide');
  if (Math.abs(Date.now() - h) > FENETRE_MS) throw new ErreurHttp(401, 'connect_horodatage_expire');
  const c = (await pool.query(`SELECT cs.*, o.type, o.profils, o.config_id, o.actif AS org_active FROM connecteurs_secours cs JOIN organisations_secours o ON o.id = cs.organisation_id
    WHERE cs.cle_hash = $1 AND cs.actif`, [empreinte(cle)])).rows[0];
  if (!c || !c.org_active) throw new ErreurHttp(401, 'connect_signature_invalide');
  const attendue = signer(lireSecretMfa(c.secret), h, req.method, req.originalUrl.split('?')[0], req.rawBody || '');
  if (sig.length !== attendue.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(attendue))) throw new ErreurHttp(401, 'connect_signature_invalide');
  await pool.query('UPDATE connecteurs_secours SET derniere_utilisation = now() WHERE id = $1', [c.id]);
  // Rôle technique selon les profils activés : Ambulance = agit pour ses unités ; CCS seul = consultation régionale
  if (!c.profils.length) throw new ErreurHttp(403, 'organisation_interdite');
  return { id: null, role: c.profils.includes('ambulance') ? 'paramedic' : 'repartiteur', etabs: [], gestionnaire: false,
    connecteur: { id: c.id, nom: c.nom, organisation_id: c.organisation_id, type: c.type, profils: c.profils, config_id: c.config_id } };
}
async function uniteParNumero(pool, u, numero) {
  const un = (await pool.query('SELECT id FROM unites_secours WHERE organisation_id = $1 AND numero = $2 AND actif', [u.connecteur.organisation_id, String(numero || '')])).rows[0];
  if (!un) throw new ErreurHttp(404, 'unite_introuvable');
  return un.id;
}
async function prealerteParNumero(pool, u, numero) {
  const p = (await pool.query('SELECT id FROM prealertes WHERE numero = $1', [String(numero || '')])).rows[0];
  if (!p) throw new ErreurHttp(404, 'prealerte_introuvable');
  return p.id;
}

/** Routes /api/connect/v1 : branchées avant la session du personnel (authentification propre, signée). */
function brancher(api, pool, route) {
  const avec = (fn) => route(async (req, res) => fn(await authentifier(pool, req), req, res));
  api.get('/connect/v1/statut', avec(async (u) => ({ version: 'v1', organisation_id: u.connecteur.organisation_id, type: u.connecteur.type, profils: u.connecteur.profils, systeme: u.connecteur.nom, heure: new Date().toISOString() })));
  api.get('/connect/v1/urgences', avec((u) => pa.destinations(pool, u, {})));
  api.get('/connect/v1/prealertes', avec(async (u) => (await pa.liste(pool, u, {})).prealertes.map(({ actions, ...p }) => p)));
  api.get('/connect/v1/prealertes/:numero', avec(async (u, req) => { const { actions, ...p } = await pa.fiche(pool, u, await prealerteParNumero(pool, u, req.params.numero), {}); return p; }));
  api.post('/connect/v1/prealertes', avec(async (u, req) => {
    if (!u.connecteur.profils.includes('ambulance')) throw new ErreurHttp(403, 'role_insuffisant');
    const b = req.body || {};
    return pa.creer(pool, u, { ...b, unite_id: await uniteParNumero(pool, u, b.unite_numero), cle: b.cle_envoi });
  }));
  api.post('/connect/v1/prealertes/:numero/evenements', avec(async (u, req) => {
    if (!u.connecteur.profils.includes('ambulance')) throw new ErreurHttp(403, 'role_insuffisant');
    const b = req.body || {};
    if (!['mettre_a_jour', 'signaler_arrivee', 'annuler', 'changer_destination'].includes(b.action)) throw new ErreurHttp(400, 'action_inconnue');
    return pa.agir(pool, u, await prealerteParNumero(pool, u, req.params.numero), b);
  }));
  // Parcours final (13 nov. 2026) : état des véhicules reçu des logiciels ambulanciers, disponibilité renvoyée (urgences classées),
  // confirmations de l'hôpital lues ici et poussées par webhooks signés (prealerte.acceptee, .reorientee, .sans_reponse, .civiere_reservee)
  const vh = require('./vehicules');
  api.post('/connect/v1/unites/:numero/etat', avec(async (u, req) => {
    if (!u.connecteur.profils.includes('ambulance')) throw new ErreurHttp(403, 'role_insuffisant');
    return vh.definir(pool, u, await uniteParNumero(pool, u, req.params.numero), req.body || {});
  }));
  api.get('/connect/v1/vehicules', avec((u) => vh.liste(pool, u)));
  api.get('/connect/v1/disponibilite', avec(async (u, req) => {
    const q = req.query || {};
    return vh.urgencesClassees(pool, u, q.unite_numero ? { unite_id: await uniteParNumero(pool, u, q.unite_numero) } : { latitude: q.latitude, longitude: q.longitude });
  }));
  api.get('/connect/v1/prealertes/:numero/confirmation', avec(async (u, req) => {
    const id = await prealerteParNumero(pool, u, req.params.numero);
    const { confirmation, reservation, statut, numero } = await pa.fiche(pool, u, id, {});
    return { numero, statut, confirmation, reservation: reservation ? { statut: reservation.statut, civiere: reservation.civiere } : null };
  }));
  api.post('/connect/v1/unites/:numero/position', avec(async (u, req) => {
    if (!u.connecteur.profils.includes('ambulance')) throw new ErreurHttp(403, 'role_insuffisant');
    return pa.position(pool, u, await uniteParNumero(pool, u, req.params.numero), req.body || {});
  }));
}
module.exports = { brancher, creerConnecteurSecours, signer, authentifier };
