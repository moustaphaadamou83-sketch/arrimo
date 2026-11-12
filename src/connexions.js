'use strict';
/**
 * Connexions des logiciels externes, client par client (exigence permanente de Moustafa, 12 nov. 2026), pilotées depuis SH :
 * - établissement : connecteur à portées activées une par une — « adt » (événements JSON), « hl7v2 » (messages HL7 v2 bruts
 *   sur HTTPS), « fhir » (lecture FHIR R4 de ses propres données) — et webhooks signés ;
 * - organisation de secours : client API Arrimo Connect v1 (requêtes signées) et webhooks signés.
 * Droits limités aux données du client ; désactivable à tout moment ; chaque action journalisée (journal d'administration) ;
 * clés et secrets générés sur le serveur, jamais affichés : remis une seule fois au contact technique (src/remises.js).
 * Aucun port réseau ouvert : HTTPS seulement. L'import CSV passe par SH ; SFTP n'est pas proposé (port à ouvrir : accord requis).
 */
const crypto = require('crypto');
const { ErreurHttp, transaction } = require('./db');
const { journalAdmin } = require('./admin');
const { chiffrerSecretMfa } = require('./auth');
const remises = require('./remises');
const wh = require('./webhooks');

const GENRES = { etablissement: ['adt', 'hl7v2', 'fhir', 'webhook'], organisation: ['connect', 'webhook'] };
const systeme = { id: null };

async function client(db, code) {
  const c = String(code || '').trim().toUpperCase();
  const e = (await db.query('SELECT id, code, nom FROM etablissements WHERE code = $1', [c])).rows[0];
  if (e) return { genre: 'etablissement', ...e };
  const o = (await db.query('SELECT id, code, nom, profils FROM organisations_secours WHERE code = $1', [c])).rows[0];
  if (o) return { genre: 'organisation', ...o };
  throw new ErreurHttp(404, 'client_introuvable');
}
/** Connexions du client (aucune clé, aucun secret) avec leur état et leur dernière activité. */
async function lister(pool, code) {
  const cl = await client(pool, code);
  const out = [];
  if (cl.genre === 'etablissement') {
    for (const r of (await pool.query(`SELECT id, nom, portees, actif, cree_le, (SELECT max(recu_le) FROM messages_connecteur m WHERE m.connecteur_id = c.id) AS derniere_activite
      FROM connecteurs c WHERE etablissement_id = $1 ORDER BY id`, [cl.id])).rows) out.push({ genre: 'connecteur', ...r });
  } else {
    for (const r of (await pool.query('SELECT id, nom, actif, cree_le, derniere_utilisation AS derniere_activite FROM connecteurs_secours WHERE organisation_id = $1 ORDER BY id', [cl.id])).rows) out.push({ genre: 'connect', ...r });
  }
  for (const r of (await pool.query(`SELECT w.id, w.nom, w.url, w.evenements, w.actif, w.cree_le,
      (SELECT count(*)::int FROM webhook_livraisons l WHERE l.webhook_id = w.id AND l.statut = 'a_envoyer') AS en_attente,
      (SELECT count(*)::int FROM webhook_livraisons l WHERE l.webhook_id = w.id AND l.statut = 'abandonnee') AS abandonnees,
      (SELECT max(envoyee_le) FROM webhook_livraisons l WHERE l.webhook_id = w.id) AS derniere_activite
    FROM webhooks w WHERE ${cl.genre === 'etablissement' ? 'etablissement_id' : 'organisation_id'} = $1 ORDER BY w.id`, [cl.id])).rows) out.push({ genre: 'webhook', ...r });
  return { client: { code: cl.code, nom: cl.nom, genre: cl.genre }, connexions: out };
}
/** Active une connexion pour ce client seulement ; le secret part au contact technique (lien unique, 24 h). */
async function creer(pool, code, b, par) {
  const cl = await client(pool, code);
  const genre = String(b.genre || '');
  if (!GENRES[cl.genre].includes(genre)) throw new ErreurHttp(400, 'connexion_genre_invalide');
  const destinataire = remises.exigerCourriel(b.courriel_technique);
  const nom = String(b.nom || '').trim().slice(0, 100) || `Connexion ${genre}`;
  let r;
  if (['adt', 'hl7v2', 'fhir'].includes(genre)) {
    // Un connecteur par portée activée (désactivable séparément) ; même clé dédiée, données de l'établissement seulement
    const cle = `arr_${crypto.randomBytes(24).toString('hex')}`;
    const con = (await pool.query('INSERT INTO connecteurs (nom, cle_hash, etablissement_id, portees) VALUES ($1, $2, $3, $4) RETURNING id, nom',
      [nom, crypto.createHash('sha256').update(cle).digest('hex'), cl.id, [genre]])).rows[0];
    r = { genre: 'connecteur', id: con.id, nom: con.nom, portees: [genre], remise: await remises.creer(pool, { genre: 'adt', refId: con.id, contenu: { cle }, destinataire, nom }) };
  } else if (genre === 'connect') {
    if (!cl.profils.length) throw new ErreurHttp(409, 'organisation_interdite');
    const s = await require('./connect').creerConnecteurSecours(pool, cl.id, nom);
    r = { genre: 'connect', id: s.id, nom: s.nom, remise: await remises.creer(pool, { genre: 'connect', refId: s.id, contenu: { cle: s.cle, secret: s.secret }, destinataire, nom }) };
  } else {
    const url = wh.verifierUrl(b.url);
    const evenements = Array.isArray(b.evenements) && b.evenements.length ? [...new Set(b.evenements)] : wh.EVENEMENTS;
    if (evenements.some((x) => !wh.EVENEMENTS.includes(x))) throw new ErreurHttp(400, 'connexion_genre_invalide');
    const secret = crypto.randomBytes(32).toString('base64url');
    const w = (await pool.query(`INSERT INTO webhooks (${cl.genre === 'etablissement' ? 'etablissement_id' : 'organisation_id'}, nom, url, secret, evenements) VALUES ($1, $2, $3, $4, $5) RETURNING id, nom, url, evenements`,
      [cl.id, nom, url, chiffrerSecretMfa(secret), evenements])).rows[0];
    r = { genre: 'webhook', ...w, remise: await remises.creer(pool, { genre: 'webhook', refId: w.id, contenu: { secret }, destinataire, nom }) };
  }
  await journalAdmin(pool, systeme, 'Connexion activée', `${cl.code} · ${nom}`, `${genre} · remise à ${r.remise.destinataire} · ${par}`, cl.genre === 'etablissement' ? cl.id : null);
  return r;
}
/** Désactive une connexion du client (effet immédiat : la clé ou l'adresse n'est plus utilisée). */
async function revoquer(pool, code, genre, id, par) {
  const cl = await client(pool, code);
  const table = { connecteur: ['connecteurs', 'etablissement_id', 'etablissement'], connect: ['connecteurs_secours', 'organisation_id', 'organisation'],
    webhook: ['webhooks', cl.genre === 'etablissement' ? 'etablissement_id' : 'organisation_id', cl.genre] }[genre];
  if (!table || table[2] !== cl.genre) throw new ErreurHttp(400, 'connexion_genre_invalide');
  return transaction(pool, async (c) => {
    const r = (await c.query(`UPDATE ${table[0]} SET actif = false WHERE id = $1 AND ${table[1]} = $2 RETURNING id, nom`, [id, cl.id])).rows[0];
    if (!r) throw new ErreurHttp(404, 'connecteur_introuvable');
    if (genre === 'webhook') await c.query("UPDATE webhook_livraisons SET statut = 'abandonnee', derniere_erreur = 'webhook désactivé' WHERE webhook_id = $1 AND statut = 'a_envoyer'", [id]);
    await journalAdmin(c, systeme, 'Connexion désactivée', `${cl.code} · ${r.nom}`, `${genre} · ${par}`, cl.genre === 'etablissement' ? cl.id : null);
    return { ...r, actif: false };
  });
}
module.exports = { lister, creer, revoquer, GENRES };
