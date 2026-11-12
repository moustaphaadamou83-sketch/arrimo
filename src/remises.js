'use strict';
/**
 * Remise des secrets de connexion (exigence permanente de Moustafa) : générés sur le serveur, jamais affichés dans
 * l'administration, SH, le journal ni les réponses ; remis UNE fois au contact technique du client par un lien à usage unique
 * (24 h). Seule l'empreinte du jeton est stockée ; le contenu est chiffré au repos et effacé à la récupération ou à l'expiration.
 */
const crypto = require('crypto');
const { ErreurHttp } = require('./db');
const { chiffrerSecretMfa, lireSecretMfa } = require('./auth');
const courriel = require('./courriel');
const env = require('./environnement');

const DUREE_H = 24;
const empreinte = (j) => crypto.createHash('sha256').update(String(j)).digest('hex');
const masquer = (a) => String(a).replace(/^(.).*(@.*)$/, '$1•••$2');
const COURRIEL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function exigerCourriel(a) {
  const c = String(a || '').trim().toLowerCase();
  if (!COURRIEL.test(c)) throw new ErreurHttp(400, 'courriel_technique_requis');
  return c;
}
/** Prépare la remise et envoie le lien si le courriel est configuré ; rend un résumé sans aucun secret. */
async function creer(db, { genre, refId, contenu, destinataire, utilisateurId = null, nom }) {
  const jeton = crypto.randomBytes(32).toString('base64url');
  const r = (await db.query(`INSERT INTO remises_secrets (genre, ref_id, jeton_hash, contenu, destinataire, expire_le, cree_par)
    VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6), $7) RETURNING id, expire_le`,
  [genre, refId, empreinte(jeton), chiffrerSecretMfa(JSON.stringify(contenu)), destinataire, DUREE_H, utilisateurId])).rows[0];
  let envoyee = false;
  if (courriel.actif()) {
    const lien = `${process.env.ARRIMO_URL || env.urlPublique() || ''}/remise#${jeton}`;
    try {
      await courriel.envoyer({ a: destinataire, sujet: 'Arrimo : accès de connexion à récupérer',
        texte: `Un accès de connexion Arrimo a été préparé pour « ${nom} ».\n\nRécupérez-le une seule fois avec ce lien, valable ${DUREE_H} heures :\n${lien}\n\nLe lien ne fonctionne qu'une fois. Si vous n'attendiez pas ce message, ignorez-le et prévenez votre contact Arrimo.\n\n---\nAn Arrimo connection access was prepared for “${nom}”. Retrieve it once with the link above, valid for ${DUREE_H} hours.` });
      envoyee = true;
      await db.query('UPDATE remises_secrets SET envoyee = true WHERE id = $1', [r.id]);
    } catch { /* l'administrateur voit « non envoyée » ; aucun secret n'est exposé */ }
  }
  return { remise_id: r.id, destinataire: masquer(destinataire), envoyee, expire_le: r.expire_le };
}
/** Récupération unique par le contact technique (page /remise). */
async function recuperer(pool, jeton) {
  const j = String(jeton || '');
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(j)) throw new ErreurHttp(404, 'remise_introuvable');
  // Lecture et effacement atomiques : deux ouvertures simultanées du lien ne rendent le contenu qu'une fois
  const r = (await pool.query(`WITH v AS (SELECT id, genre, contenu FROM remises_secrets
      WHERE jeton_hash = $1 AND recupere_le IS NULL AND expire_le > now() AND contenu IS NOT NULL FOR UPDATE)
    UPDATE remises_secrets r SET recupere_le = now(), contenu = NULL FROM v WHERE r.id = v.id RETURNING v.genre, v.contenu`, [empreinte(j)])).rows[0];
  if (!r || !r.contenu) throw new ErreurHttp(404, 'remise_introuvable');
  return { genre: r.genre, ...JSON.parse(lireSecretMfa(r.contenu)) };
}
/** Contenus expirés effacés (le lien ne sert plus à rien). */
async function purger(pool) {
  return (await pool.query('UPDATE remises_secrets SET contenu = NULL WHERE contenu IS NOT NULL AND expire_le < now()')).rowCount;
}
module.exports = { creer, recuperer, purger, exigerCourriel };
