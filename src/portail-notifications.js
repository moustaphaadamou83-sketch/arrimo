'use strict';
/**
 * Notifications du portail des proches : poussée Web sans contenu. Le service de Google, d'Apple ou de Mozilla apprend seulement
 * qu'un téléphone a une notification. Le téléphone affiche un texte fixe : ni nom, ni statut, ni établissement.
 * Sur demande du proche seulement. Sans clés VAPID configurées, tout le reste du portail fonctionne ; aucune poussée ne part.
 */
const crypto = require('node:crypto');
const { ErreurHttp } = require('./db');

const HOTES = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'api.push.apple.com'];
const hotesPermis = (env) => (env.ARRIMO_PUSH_HOTES ? String(env.ARRIMO_PUSH_HOTES).split(',') : HOTES);
const actif = (env = process.env) => !!(env.ARRIMO_VAPID_PUBLIQUE && env.ARRIMO_VAPID_PRIVEE && env.ARRIMO_VAPID_SUJET);
const b64 = (x) => Buffer.from(x).toString('base64url');

function validerAdresse(endpoint, env = process.env) {
  let u; try { u = new URL(String(endpoint)); } catch { throw new ErreurHttp(400, 'abonnement_invalide'); }
  const local = u.protocol === 'http:' && u.hostname === '127.0.0.1' && env.ARRIMO_PUSH_HOTES;
  if ((u.protocol !== 'https:' && !local) || u.username || u.password || String(endpoint).length > 1000) throw new ErreurHttp(400, 'abonnement_invalide');
  if (!hotesPermis(env).some((h) => u.hostname === h || u.hostname.endsWith('.notify.windows.com'))) throw new ErreurHttp(400, 'abonnement_invalide');
  return u;
}
/** Jeton VAPID signé (RFC 8292), sans dépendance. */
function jetonVapid(aud, env = process.env) {
  const tete = b64(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corps = b64(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 3600, sub: env.ARRIMO_VAPID_SUJET }));
  const pub = Buffer.from(env.ARRIMO_VAPID_PUBLIQUE, 'base64url');
  const cle = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: env.ARRIMO_VAPID_PRIVEE, x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33, 65)) } });
  const sig = crypto.sign('sha256', Buffer.from(`${tete}.${corps}`), { key: cle, dsaEncoding: 'ieee-p1363' });
  return `${tete}.${corps}.${b64(sig)}`;
}
/** Marque les accès à prévenir, selon leur catégorie autorisée. Ne contient rien sur le parcours. */
async function signaler(db, residentId, categorie, contactId = null) {
  await db.query(`INSERT INTO proches_notifications_attente (acces_id) SELECT a.id FROM proches_acces a JOIN resident_contacts k ON k.id = a.contact_id
    WHERE a.resident_id = $1 AND a.actif AND a.revoque_le IS NULL AND ($3::int IS NULL OR a.contact_id = $3) AND $2 = ANY(k.autorisations) AND COALESCE((a.notif_preferences->>$2)::boolean, true)
    ON CONFLICT (acces_id) DO NOTHING`, [residentId, categorie, contactId]);
}
/** Envoi groupé. Une adresse refusée (404, 410) est retirée. Un accès révoqué entre-temps ne reçoit rien. */
async function envoyer(pool, env = process.env, envoi = fetch) {
  if (!actif(env)) return { envoyees: 0, inactif: true };
  const { rows } = await pool.query(`DELETE FROM proches_notifications_attente n USING proches_acces a WHERE a.id = n.acces_id RETURNING n.acces_id, a.actif, a.revoque_le, a.expire_le`);
  let envoyees = 0;
  for (const x of rows) {
    if (!x.actif || x.revoque_le || (x.expire_le && new Date(x.expire_le) < new Date())) continue;
    for (const ab of (await pool.query('SELECT id, endpoint FROM proches_abonnements_push WHERE acces_id = $1', [x.acces_id])).rows) {
      try {
        const u = validerAdresse(ab.endpoint, env);
        const r = await envoi(ab.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { TTL: '86400', Urgency: 'normal', 'Content-Length': '0', Authorization: `vapid t=${jetonVapid(u.origin, env)}, k=${env.ARRIMO_VAPID_PUBLIQUE}` } });
        if ([404, 410].includes(r.status)) await pool.query('DELETE FROM proches_abonnements_push WHERE id = $1', [ab.id]);
        else if (r.ok) envoyees++;
        await pool.query('INSERT INTO proches_notifications_journal (acces_id, statut, code) VALUES ($1, $2, $3)', [x.acces_id, [404, 410].includes(r.status) ? 'adresse_retiree' : r.ok ? 'envoyee' : 'echec', r.status]);
      } catch (e) { console.error('Poussée portail :', e.code || e.name); await pool.query(`INSERT INTO proches_notifications_journal (acces_id, statut) VALUES ($1, 'echec')`, [x.acces_id]).catch(() => {}); }
    }
  }
  return { envoyees };
}
function brancherProche(api, pool, route, session) {
  api.get('/proches/notifications', session, route((req) => pool.query('SELECT count(*)::int n FROM proches_abonnements_push WHERE acces_id = $1', [req.proche.id]).then((r) => ({ disponible: actif(), cle: actif() ? process.env.ARRIMO_VAPID_PUBLIQUE : null, abonne: r.rows[0].n > 0, preferences: req.proche.notif_preferences || {} }))));
  api.post('/proches/notifications', session, route(async (req) => {
    if (!actif()) throw new ErreurHttp(409, 'notifications_indisponibles');
    const u = validerAdresse(req.body?.endpoint);
    // Une adresse déjà liée à un autre accès n'est jamais réattribuée (pas de détournement des notifications d'un autre proche)
    const r = await pool.query(`INSERT INTO proches_abonnements_push (acces_id, endpoint) VALUES ($1, $2) ON CONFLICT (endpoint) DO UPDATE SET acces_id = EXCLUDED.acces_id
      WHERE proches_abonnements_push.acces_id = EXCLUDED.acces_id RETURNING id`, [req.proche.id, u.href]);
    if (!r.rowCount) throw new ErreurHttp(409, 'abonnement_invalide');
    return { abonne: true };
  }));
  api.put('/proches/notifications/preferences', session, route(async (req) => {
    const v = {}; for (const k of ['administratif', 'hebergement', 'rendez_vous', 'mouvements']) if (req.body?.[k] !== undefined) { if (typeof req.body[k] !== 'boolean') throw new ErreurHttp(400, 'preference_invalide'); v[k] = req.body[k]; }
    return (await pool.query('UPDATE proches_acces SET notif_preferences = notif_preferences || $2::jsonb WHERE id = $1 RETURNING notif_preferences', [req.proche.id, v])).rows[0].notif_preferences;
  }));
  api.delete('/proches/notifications', session, route(async (req) => { await pool.query('DELETE FROM proches_abonnements_push WHERE acces_id = $1', [req.proche.id]); return { abonne: false }; }));
}
module.exports = { brancherProche, signaler, envoyer, actif, jetonVapid, validerAdresse };
