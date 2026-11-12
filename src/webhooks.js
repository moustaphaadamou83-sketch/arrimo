'use strict';
/**
 * Webhooks sortants signés (cahier 2, section 11.4 ; exigence permanente de Moustafa) : un client (établissement ou organisation
 * de secours) reçoit les événements qui le concernent, et seulement ceux-là, à l'adresse HTTPS de son système.
 * - Charge minimale : type, numéro, statut, horodatage, priorité et catégorie (listes fermées). Jamais d'identité ni de nom.
 * - Signature : X-Arrimo-Signature = HMAC-SHA256(secret, `${horodatage}.${corps}`), X-Arrimo-Horodatage, X-Arrimo-Evenement.
 * - File d'envoi : écrite dans la même transaction que l'événement ; envoi en arrière-plan, nouvelles tentatives espacées
 *   (1, 2, 4… min), abandon visible en supervision après 8 essais (file d'échec) ; un webhook désactivé n'envoie plus rien.
 * - Adresse : HTTPS seulement, jamais une adresse interne (localhost, réseau privé) — sauf 127.0.0.1 avec ARRIMO_WEBHOOKS_LOCAL=1 (tests).
 */
const crypto = require('crypto');
const { ErreurHttp } = require('./db');
const { lireSecretMfa } = require('./auth');

const EVENEMENTS = ['prealerte', 'transport'];
const MAX_TENTATIVES = 8;

function verifierUrl(u) {
  let url;
  try { url = new URL(String(u || '')); } catch { throw new ErreurHttp(400, 'webhook_url_invalide'); }
  const local = process.env.ARRIMO_WEBHOOKS_LOCAL === '1';
  const h = url.hostname;
  const interne = h === 'localhost' || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '[::1]' || /^\[?f[cd]/i.test(h) || h.endsWith('.local') || h.endsWith('.internal');
  // Tests seulement : le serveur local (127.0.0.1) est permis, en HTTP ; les réseaux privés restent toujours refusés
  const boucleTest = local && (h === '127.0.0.1' || h === 'localhost');
  if (url.username || url.password || (url.protocol !== 'https:' && !boucleTest) || (interne && !boucleTest)) throw new ErreurHttp(400, 'webhook_url_invalide');
  return url.href;
}
/** Ajoute à la file les événements des clients concernés (même transaction que l'étape). */
async function emettre(c, { etablissements = [], organisations = [], evenement, charge }) {
  const famille = evenement.split('.')[0];
  const ws = (await c.query(`SELECT id FROM webhooks WHERE actif AND $3 = ANY(evenements)
    AND (etablissement_id = ANY($1::int[]) OR organisation_id = ANY($2::int[]))`, [etablissements.filter(Boolean), organisations.filter(Boolean), famille])).rows;
  for (const w of ws) await c.query('INSERT INTO webhook_livraisons (webhook_id, evenement, charge) VALUES ($1, $2, $3)', [w.id, evenement, JSON.stringify({ evenement, ...charge, horodatage: new Date().toISOString() })]);
  return ws.length;
}
const signer = (secret, horodatage, corps) => crypto.createHmac('sha256', secret).update(`${horodatage}.${corps}`).digest('hex');
let fetcher = (...a) => fetch(...a);
function definirFetchTest(f) { fetcher = f || ((...a) => fetch(...a)); }
/** Envoie les livraisons dues (appelé toutes les 30 s par src/server.js, et par les tests). */
async function envoyer(pool, { limite = 50 } = {}) {
  const dues = (await pool.query(`UPDATE webhook_livraisons l SET prochain_essai = now() + interval '5 minutes'
    WHERE l.id IN (SELECT id FROM webhook_livraisons WHERE statut = 'a_envoyer' AND prochain_essai <= now() ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
    RETURNING l.id, l.webhook_id, l.evenement, l.charge, l.tentatives`, [limite])).rows;
  let ok = 0;
  for (const l of dues) {
    const w = (await pool.query('SELECT url, secret, actif FROM webhooks WHERE id = $1', [l.webhook_id])).rows[0];
    if (!w || !w.actif) { await pool.query("UPDATE webhook_livraisons SET statut = 'abandonnee', derniere_erreur = 'webhook désactivé' WHERE id = $1", [l.id]); continue; }
    const corps = JSON.stringify(l.charge); const h = Date.now();
    let erreur = null;
    try {
      const r = await fetcher(w.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json', 'X-Arrimo-Evenement': l.evenement, 'X-Arrimo-Horodatage': String(h), 'X-Arrimo-Signature': signer(lireSecretMfa(w.secret), h, corps) }, body: corps });
      if (!r.ok) erreur = `HTTP ${r.status}`;
    } catch (e) { erreur = e.name === 'TimeoutError' ? 'délai dépassé' : 'connexion impossible'; }
    if (!erreur) { ok += 1; await pool.query("UPDATE webhook_livraisons SET statut = 'envoyee', envoyee_le = now(), tentatives = tentatives + 1, derniere_erreur = NULL WHERE id = $1", [l.id]); continue; }
    const n = l.tentatives + 1;
    await pool.query(`UPDATE webhook_livraisons SET tentatives = $2::int, derniere_erreur = $3, statut = CASE WHEN $2::int >= $4::int THEN 'abandonnee' ELSE 'a_envoyer' END,
      prochain_essai = now() + make_interval(mins => (2 ^ ($2::int - 1))::int) WHERE id = $1`, [l.id, n, erreur, MAX_TENTATIVES]);
  }
  return { envoyees: ok, traitees: dues.length };
}
module.exports = { EVENEMENTS, verifierUrl, emettre, envoyer, signer, definirFetchTest, MAX_TENTATIVES };
