'use strict';
/**
 * Arrimo Connect — messagerie professionnelle interne (addendum du 21 nov. 2026). Distinct d'Arrimo Connect v1 (API signée des
 * partenaires, src/connect.js). Limité à l'établissement ; droits vérifiés ici, côté serveur :
 * - « Contacter l'administration » : boîte partagée lue par l'administration de l'établissement (admin_etab) ; demande suivie
 *   (ouverte → en cours → résolue). - Messages directs : lisibles par l'expéditeur et le destinataire SEULEMENT (jamais par un
 *   administrateur du seul fait de son rôle). - Annuaire : nom et rôle des membres de l'établissement (aucun courriel ni téléphone).
 * - Annonces : publiées par l'administration, ciblées par rôle. Ne remplace ni un système clinique ni les appels d'urgence officiels.
 */
const { ErreurHttp, transaction } = require('./db');
const { exigerEtablissement } = require('./auth');

const CATEGORIES = ['message', 'materiel', 'technique', 'administratif', 'planning', 'soutien', 'signalement', 'autre'];
const ADMIN = ['admin_etab'];
const entier = (v, nom) => { const n = Number(v); if (!Number.isSafeInteger(n) || n < 1) throw new ErreurHttp(400, 'parametre_invalide', { nom }); return n; };
const texte = (v, max, nom, min = 1) => { const t = String(v ?? '').trim(); if (t.length < min || t.length > max) throw new ErreurHttp(400, 'parametre_invalide', { nom }); return t; };
const estAdmin = (u) => ADMIN.includes(u.role);
function etab(u, id) { const e = entier(id, 'etablissement_id'); exigerEtablissement(u, e); if (u.gestionnaire && !(u.etabs || []).map(Number).includes(e)) throw new ErreurHttp(403, 'etab_interdit'); return e; }

/** Fil lisible : participant (expéditeur ou destinataire d'un message du fil), ou administration de l'établissement pour la boîte partagée. */
async function filLisible(db, u, filId) {
  const r = (await db.query('SELECT * FROM connect_messages WHERE id = $1 AND fil_id IS NULL', [entier(filId, 'id')])).rows[0];
  if (!r || !(u.etabs || []).map(Number).includes(r.etablissement_id)) throw new ErreurHttp(404, 'objet_introuvable');
  const participant = (await db.query('SELECT 1 FROM connect_messages WHERE (id = $1 OR fil_id = $1) AND (expediteur_id = $2 OR destinataire_id = $2) LIMIT 1', [r.id, u.id])).rowCount;
  if (participant || (r.boite === 'administration' && estAdmin(u))) return r;
  throw new ErreurHttp(404, 'objet_introuvable');
}

async function envoyer(pool, u, b = {}) {
  const e = etab(u, b.etablissement_id);
  const corps = texte(b.corps, 4000, 'corps');
  return transaction(pool, async (c) => {
    if (b.fil_id) {
      // Réponse dans un fil existant : mêmes droits que la lecture
      const f = await filLisible(c, u, b.fil_id);
      const autre = f.boite === 'administration' ? (f.expediteur_id === u.id ? null : f.expediteur_id) : (f.expediteur_id === u.id ? f.destinataire_id : f.expediteur_id);
      const m = (await c.query('INSERT INTO connect_messages (etablissement_id, fil_id, expediteur_id, destinataire_id, corps) VALUES ($1, $2, $3, $4, $5) RETURNING *', [f.etablissement_id, f.id, u.id, autre, corps])).rows[0];
      if (f.boite === 'administration' && estAdmin(u) && f.statut === 'ouverte') await c.query("UPDATE connect_messages SET statut = 'en_cours', traite_par = $2 WHERE id = $1", [f.id, u.id]);
      await c.query('INSERT INTO connect_lectures (message_id, utilisateur_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [m.id, u.id]);
      return m;
    }
    const categorie = CATEGORIES.includes(b.categorie) ? b.categorie : 'message';
    const priorite = b.priorite === 'haute' ? 'haute' : 'normale';
    const sujet = texte(b.sujet, 120, 'sujet', 2);
    let dest = null; let boite = null;
    if (b.boite === 'administration') boite = 'administration';
    else {
      dest = entier(b.destinataire_id, 'destinataire_id');
      if (dest === u.id || !(await c.query('SELECT 1 FROM utilisateur_etablissements ue JOIN utilisateurs x ON x.id = ue.utilisateur_id WHERE ue.utilisateur_id = $1 AND ue.etablissement_id = $2 AND x.actif', [dest, e])).rowCount) throw new ErreurHttp(404, 'objet_introuvable');
    }
    const m = (await c.query(`INSERT INTO connect_messages (etablissement_id, expediteur_id, destinataire_id, boite, categorie, sujet, corps, priorite, statut) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [e, u.id, dest, boite, categorie, sujet, corps, priorite, boite ? 'ouverte' : null])).rows[0];
    await c.query('INSERT INTO connect_lectures (message_id, utilisateur_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [m.id, u.id]);
    // Journal : opération administrative (sans contenu du message)
    if (boite) await c.query("INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Connect : demande à l’administration', $3)", [e, u.id, `${categorie} · priorité ${priorite}`]);
    return m;
  }).finally(() => require('./flux').signaler());
}

const NON_LU = `NOT EXISTS (SELECT 1 FROM connect_lectures cl WHERE cl.message_id = m.id AND cl.utilisateur_id = $2)`;
/** Fils de la personne (participant) et, pour l'administration, la boîte partagée ; avec non-lus. */
async function fils(pool, u, q = {}) {
  const e = etab(u, q.etablissement_id);
  const rows = (await pool.query(`SELECT f.id, f.sujet, f.categorie, f.priorite, f.statut, f.boite, f.cree_le, f.expediteur_id, ex.nom AS expediteur, de.nom AS destinataire,
      (SELECT max(m.cree_le) FROM connect_messages m WHERE m.id = f.id OR m.fil_id = f.id) AS dernier_le,
      (SELECT count(*)::int FROM connect_messages m WHERE (m.id = f.id OR m.fil_id = f.id) AND m.expediteur_id <> $2 AND ${NON_LU}) AS non_lus
    FROM connect_messages f JOIN utilisateurs ex ON ex.id = f.expediteur_id LEFT JOIN utilisateurs de ON de.id = f.destinataire_id
    WHERE f.fil_id IS NULL AND f.etablissement_id = $1 AND (
      EXISTS (SELECT 1 FROM connect_messages m WHERE (m.id = f.id OR m.fil_id = f.id) AND (m.expediteur_id = $2 OR m.destinataire_id = $2))
      OR (f.boite = 'administration' AND $3))
    ORDER BY dernier_le DESC LIMIT 100`, [e, u.id, estAdmin(u)])).rows;
  return { fils: rows, non_lus: rows.reduce((s, r) => s + r.non_lus, 0), administration: estAdmin(u) };
}
async function fil(pool, u, id) {
  const f = await filLisible(pool, u, id);
  const ms = (await pool.query('SELECT m.id, m.corps, m.cree_le, m.expediteur_id, x.nom AS expediteur, x.role FROM connect_messages m JOIN utilisateurs x ON x.id = m.expediteur_id WHERE m.id = $1 OR m.fil_id = $1 ORDER BY m.cree_le, m.id', [f.id])).rows;
  for (const m of ms) await pool.query('INSERT INTO connect_lectures (message_id, utilisateur_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [m.id, u.id]);
  return { fil: { id: f.id, sujet: f.sujet, categorie: f.categorie, priorite: f.priorite, statut: f.statut, boite: f.boite }, messages: ms, peut_traiter: f.boite === 'administration' && estAdmin(u) };
}
async function statut(pool, u, id, b = {}) {
  const f = await filLisible(pool, u, id);
  if (!(f.boite === 'administration' && estAdmin(u))) throw new ErreurHttp(403, 'role_insuffisant');
  if (!['ouverte', 'en_cours', 'resolue'].includes(b.statut)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'statut' });
  await pool.query('UPDATE connect_messages SET statut = $2, traite_par = $3 WHERE id = $1', [f.id, b.statut, u.id]);
  await pool.query("INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Connect : demande traitée', $3)", [f.etablissement_id, u.id, `demande ${f.id} → ${b.statut}`]);
  return { id: f.id, statut: b.statut };
}
async function annuaire(pool, u, q = {}) {
  const e = etab(u, q.etablissement_id);
  return (await pool.query(`SELECT x.id, x.nom, x.role FROM utilisateurs x JOIN utilisateur_etablissements ue ON ue.utilisateur_id = x.id WHERE ue.etablissement_id = $1 AND x.actif AND x.id <> $2 ORDER BY x.nom`, [e, u.id])).rows;
}
async function annonces(pool, u, q = {}) {
  const e = etab(u, q.etablissement_id);
  return (await pool.query(`SELECT a.id, a.titre, a.corps, a.roles, a.cree_le, x.nom AS auteur FROM connect_annonces a JOIN utilisateurs x ON x.id = a.auteur_id
    WHERE a.etablissement_id = $1 AND (cardinality(a.roles) = 0 OR $2 = ANY(a.roles) OR $3) ORDER BY a.cree_le DESC LIMIT 30`, [e, u.role, estAdmin(u)])).rows;
}
async function publier(pool, u, b = {}) {
  const e = etab(u, b.etablissement_id);
  if (!estAdmin(u)) throw new ErreurHttp(403, 'role_insuffisant');
  const roles = Array.isArray(b.roles) ? b.roles.filter((r) => /^[a-z_]{3,30}$/.test(r)).slice(0, 10) : [];
  const a = (await pool.query('INSERT INTO connect_annonces (etablissement_id, auteur_id, titre, corps, roles) VALUES ($1, $2, $3, $4, $5) RETURNING *', [e, u.id, texte(b.titre, 120, 'titre', 2), texte(b.corps, 4000, 'corps'), roles])).rows[0];
  await pool.query("INSERT INTO journal (etablissement_id, utilisateur_id, action, detail) VALUES ($1, $2, 'Connect : annonce publiée', $3)", [e, u.id, a.titre]);
  require('./flux').signaler();
  return a;
}

module.exports = { envoyer, fils, fil, statut, annuaire, annonces, publier, CATEGORIES };
