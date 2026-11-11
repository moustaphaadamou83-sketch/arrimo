'use strict';
/**
 * Arrimo Famille : comptes créés par les proches et demandes de rattachement (10 nov. 2026, démo et recette seulement).
 * - Le compte (courriel confirmé + mot de passe) ne donne accès à AUCUNE information.
 * - Chaque lien avec un résident (proches_acces) est créé par une personne habilitée de l'établissement, après
 *   vérification de l'identité et enregistrement du consentement du résident ou de son représentant.
 * - La demande reçoit toujours la même réponse : rien ne permet de savoir si le résident existe ni où il habite.
 *   Aucune recherche de résident côté proche ; aucun rapprochement automatique sans code remis par l'établissement.
 * - Jetons (confirmation, réinitialisation, sessions, codes) conservés seulement sous forme d'empreinte.
 * - Limites : par adresse IP (inscription, liens), par compte (courriels, connexions, codes, demandes).
 * - Tout est inscrit au journal immuable, sans nom de résident ni de proche.
 */
const crypto = require('node:crypto');
const { transaction, ErreurHttp } = require('./db');
const { hacherAsync, verifierAsync, verifierRobustesse } = require('./auth');
const { journaliser } = require('./regles');
const TE = require('./types-etablissement');
const ch = require('./chsld');
const courriel = require('./courriel');

const empreinte = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
const jetonAleatoire = () => crypto.randomBytes(32).toString('hex');
const SESSION_H = 8, CONFIRMATION_H = 24, REINIT_MIN = 60, ENVOIS_MAX = 3, ECHECS_MAX = 5, BLOCAGE_MIN = 15;
const CODE_JOURS = 14, CODE_ESSAIS_MAX = 5, DEMANDES_ATTENTE_MAX = 5, DEMANDES_JOUR_MAX = 10;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GERER = ['coordonnateur', 'admin_etab', 'gestionnaire'];   // les rôles qui invitent déjà les proches
const VERIFICATIONS = ['rappel_telephonique', 'piece_identite', 'code_remis', 'autre'];
const CONSENTEMENTS = ['resident', 'representant_legal', 'mandataire', 'tuteur', 'curateur'];

const texte = (v, max) => { const t = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max); return t || null; };
function lireCourriel(v) {
  const c = String(v || '').trim().toLowerCase();
  if (!c || c.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) throw new ErreurHttp(400, 'courriel_invalide');
  return c;
}
const normCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Fait propre au compte (sans établissement) : journal d'administration, immuable lui aussi. Jamais de courriel ni de nom. */
const journalCompte = (db, detail) => db.query(`INSERT INTO journal_admin (action, cible, detail) VALUES ('Arrimo Famille', 'compte d’un proche', $1)`, [detail]);

/* ---------------------------------------------------------------- limites par adresse IP (mémoire du processus) */
const parIp = new Map();
function limiteIp(ip) {
  const max = Number(process.env.PROCHES_LIMITE_IP || 20), fenetre = 15 * 60000, now = Date.now();
  const t = (parIp.get(ip) || []).filter((x) => now - x < fenetre);
  if (t.length >= max) throw new ErreurHttp(429, 'trop_de_tentatives');
  t.push(now); parIp.set(ip, t);
  if (parIp.size > 10000) for (const [k, v] of parIp) if (!v.some((x) => now - x < fenetre)) parIp.delete(k);
}

/* ---------------------------------------------------------------- courriels */
const lien = (ancre) => `${require('./environnement').urlPublique()}/proches#${ancre}`;
const MODELES = {
  confirmer: (j) => ({ sujet: 'Arrimo Famille : confirmez votre courriel / Confirm your email',
    texte: `Bonjour,\n\nPour confirmer votre compte Arrimo Famille, ouvrez ce lien (valable 24 heures) :\n${lien(`confirmer=${j}`)}\n\nSi vous n'avez pas créé de compte, ignorez ce message.\n\n---\nTo confirm your Arrimo Family account, open this link (valid 24 hours):\n${lien(`confirmer=${j}`)}\n` }),
  deja: () => ({ sujet: 'Arrimo Famille : vous avez déjà un compte / You already have an account',
    texte: `Bonjour,\n\nQuelqu'un a voulu créer un compte Arrimo Famille avec votre courriel, qui en a déjà un. Connectez-vous, ou utilisez « Mot de passe oublié » :\n${lien('connexion')}\n\nSi ce n'était pas vous, ignorez ce message.\n\n---\nSomeone tried to create an Arrimo Family account with your email, which already has one. Sign in or use “Forgot password”.\n` }),
  reinit: (j) => ({ sujet: 'Arrimo Famille : nouveau mot de passe / New password',
    texte: `Bonjour,\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n${lien(`reinitialiser=${j}`)}\n\nSi vous n'avez rien demandé, ignorez ce message : votre mot de passe reste le même.\n\n---\nTo choose a new password, open this link (valid 1 hour):\n${lien(`reinitialiser=${j}`)}\n` }),
};
/** Compte un envoi pour ce compte (au plus ENVOIS_MAX par heure) ; vrai si l'envoi est permis. */
async function envoiPermis(c, compteId) {
  const r = (await c.query(`UPDATE proches_comptes SET envois = CASE WHEN envois_depuis IS NULL OR envois_depuis < now() - interval '1 hour' THEN 1 ELSE envois + 1 END,
      envois_depuis = CASE WHEN envois_depuis IS NULL OR envois_depuis < now() - interval '1 hour' THEN now() ELSE envois_depuis END WHERE id = $1 RETURNING envois`, [compteId])).rows[0];
  return r && r.envois <= ENVOIS_MAX;
}
async function expedier(a, modele, j) {
  const m = MODELES[modele](j);
  try { await courriel.envoyer({ a, sujet: m.sujet, texte: m.texte }); } catch (e) { console.error('Courriel Arrimo Famille :', e.code || e.name); }
}
function exigerCourriel() { if (!courriel.actif()) throw new ErreurHttp(503, 'courriel_indisponible'); }

/* ---------------------------------------------------------------- création, confirmation, mot de passe */
async function inscription(pool, b, ip) {
  ch.exigerFictifs(); limiteIp(ip); exigerCourriel();
  const adr = lireCourriel(b?.courriel);
  verifierRobustesse(b?.mot_de_passe);
  if (b?.avis !== true) throw new ErreurHttp(400, 'avis_requis');
  const hash = await hacherAsync(String(b.mot_de_passe));
  const j = jetonAleatoire();
  const envoi = await transaction(pool, async (c) => {
    const k = (await c.query('SELECT * FROM proches_comptes WHERE lower(courriel) = $1 AND supprime_le IS NULL FOR UPDATE', [adr])).rows[0];
    if (!k) {
      const n = (await c.query(`INSERT INTO proches_comptes (courriel, mot_de_passe_hash, confirmation_hash, confirmation_expire_le, avis_accepte_le, envois, envois_depuis)
        VALUES ($1, $2, $3, now() + make_interval(hours => $4), now(), 1, now()) RETURNING id`, [adr, hash, empreinte(j), CONFIRMATION_H])).rows[0];
      await journalCompte(c, `compte n° ${n.id} créé (courriel à confirmer)`);
      return 'confirmer';
    }
    if (!(await envoiPermis(c, k.id))) return null;
    if (k.confirme_le) return 'deja';
    // Compte jamais confirmé : il ne donne accès à rien ; la nouvelle inscription remplace le mot de passe et le lien
    await c.query(`UPDATE proches_comptes SET mot_de_passe_hash = $2, confirmation_hash = $3, confirmation_expire_le = now() + make_interval(hours => $4), avis_accepte_le = now() WHERE id = $1`,
      [k.id, hash, empreinte(j), CONFIRMATION_H]);
    return 'confirmer';
  }).catch((e) => { if (e.code === '23505') return null; throw e; });
  if (envoi) await expedier(adr, envoi, j);
  return { ok: true };
}
async function confirmer(pool, b, ip) {
  ch.exigerFictifs(); limiteIp(ip);
  const k = (await pool.query(`UPDATE proches_comptes SET confirme_le = now(), confirmation_hash = NULL, confirmation_expire_le = NULL
    WHERE confirmation_hash = $1 AND confirmation_expire_le > now() AND supprime_le IS NULL RETURNING id`, [empreinte(b?.jeton || '')])).rows[0];
  if (!k) throw new ErreurHttp(400, 'lien_invalide');
  await journalCompte(pool, `compte n° ${k.id} : courriel confirmé`);
  return { ok: true };
}
async function renvoyer(pool, b, ip) {
  ch.exigerFictifs(); limiteIp(ip); exigerCourriel();
  const adr = lireCourriel(b?.courriel), j = jetonAleatoire();
  const ok = await transaction(pool, async (c) => {
    const k = (await c.query('SELECT * FROM proches_comptes WHERE lower(courriel) = $1 AND supprime_le IS NULL AND confirme_le IS NULL FOR UPDATE', [adr])).rows[0];
    if (!k || !(await envoiPermis(c, k.id))) return false;
    await c.query('UPDATE proches_comptes SET confirmation_hash = $2, confirmation_expire_le = now() + make_interval(hours => $3) WHERE id = $1', [k.id, empreinte(j), CONFIRMATION_H]);
    return true;
  });
  if (ok) await expedier(adr, 'confirmer', j);
  return { ok: true };
}
async function oubli(pool, b, ip) {
  ch.exigerFictifs(); limiteIp(ip); exigerCourriel();
  const adr = lireCourriel(b?.courriel), j = jetonAleatoire();
  const ok = await transaction(pool, async (c) => {
    let k = (await c.query('SELECT * FROM proches_comptes WHERE lower(courriel) = $1 AND supprime_le IS NULL FOR UPDATE', [adr])).rows[0];
    if (!k) {
      // Proche invité avant les comptes : son invitation a prouvé son courriel ; le compte est créé au moment du lien
      const a = (await c.query('SELECT id FROM proches_acces WHERE lower(courriel) = $1 AND revoque_le IS NULL AND actif LIMIT 1', [adr])).rows[0];
      if (!a) return false;
      k = (await c.query('INSERT INTO proches_comptes (courriel, confirme_le) VALUES ($1, now()) RETURNING *', [adr])).rows[0];
      await c.query('UPDATE proches_acces SET compte_id = $2 WHERE lower(courriel) = $1 AND revoque_le IS NULL AND compte_id IS NULL', [adr, k.id]);
    }
    if (!(await envoiPermis(c, k.id))) return false;
    await c.query('UPDATE proches_comptes SET reinit_hash = $2, reinit_expire_le = now() + make_interval(mins => $3) WHERE id = $1', [k.id, empreinte(j), REINIT_MIN]);
    return true;
  }).catch((e) => { if (e.code === '23505') return false; throw e; });
  if (ok) await expedier(adr, 'reinit', j);
  return { ok: true };
}
async function fermerSessions(c, compteId) {
  await c.query('DELETE FROM proches_comptes_sessions WHERE compte_id = $1', [compteId]);
  await c.query('DELETE FROM proches_sessions WHERE acces_id IN (SELECT id FROM proches_acces WHERE compte_id = $1)', [compteId]);
}
async function reinitialiser(pool, b, ip) {
  ch.exigerFictifs(); limiteIp(ip);
  verifierRobustesse(b?.mot_de_passe);
  const hash = await hacherAsync(String(b.mot_de_passe));
  return transaction(pool, async (c) => {
    const k = (await c.query('SELECT id FROM proches_comptes WHERE reinit_hash = $1 AND reinit_expire_le > now() AND supprime_le IS NULL FOR UPDATE', [empreinte(b?.jeton || '')])).rows[0];
    if (!k) throw new ErreurHttp(400, 'lien_invalide');
    // Le lien reçu par courriel prouve aussi le courriel
    await c.query(`UPDATE proches_comptes SET mot_de_passe_hash = $2, reinit_hash = NULL, reinit_expire_le = NULL, echecs = 0, bloque_jusqu_au = NULL,
      confirme_le = COALESCE(confirme_le, now()), confirmation_hash = NULL WHERE id = $1`, [k.id, hash]);
    await fermerSessions(c, k.id);
    await journalCompte(c, `compte n° ${k.id} : mot de passe réinitialisé, sessions fermées`);
    return { ok: true };
  });
}

/* ---------------------------------------------------------------- connexion (compte + profils étanches) */
async function ouvrirProfils(pool, compteId, accesValide) {
  const acces = (await pool.query('SELECT id FROM proches_acces WHERE compte_id = $1 AND revoque_le IS NULL AND actif ORDER BY id', [compteId])).rows;
  const profils = [];
  for (const a of acces) {
    let v; try { v = await accesValide(pool, a.id); } catch { continue; }
    const j = jetonAleatoire();
    await pool.query('INSERT INTO proches_sessions (jeton_hash, acces_id, expire_le) VALUES ($1, $2, now() + make_interval(hours => $3))', [empreinte(j), a.id, SESSION_H]);
    profils.push({ token: `P.${j}`, acces_id: a.id, resident: `${v.r_prenom} ${String(v.r_nom).slice(0, 1)}.`, etablissement: v.etab_nom, type: v.type_etablissement });
  }
  return profils;
}
async function sessionCompteNouvelle(pool, compteId) {
  const j = jetonAleatoire();
  await pool.query('INSERT INTO proches_comptes_sessions (jeton_hash, compte_id, expire_le) VALUES ($1, $2, now() + make_interval(hours => $3))', [empreinte(j), compteId, SESSION_H]);
  await pool.query('UPDATE proches_comptes SET echecs = 0, bloque_jusqu_au = NULL, derniere_connexion = now() WHERE id = $1', [compteId]);
  return `C.${j}`;
}
/**
 * Connexion par compte. Un proche invité avant les comptes (mot de passe par accès) passe par `ancienne` :
 * à sa première connexion réussie, son compte est créé (courriel déjà prouvé par l'invitation) et ses accès y sont rattachés.
 */
async function connexion(pool, b, { accesValide, ancienne }) {
  const adr = String(b?.courriel || '').trim().toLowerCase(), mdp = String(b?.mot_de_passe || '');
  const k = (await pool.query('SELECT * FROM proches_comptes WHERE lower(courriel) = $1 AND supprime_le IS NULL', [adr])).rows[0];
  if (!k) {
    const ok = await ancienne(adr, mdp);   // lève identifiants_incorrects si rien ne correspond
    const n = await transaction(pool, async (c) => {
      const x = (await c.query('INSERT INTO proches_comptes (courriel, mot_de_passe_hash, confirme_le) VALUES ($1, $2, now()) RETURNING id', [adr, ok[0].mot_de_passe_hash])).rows[0];
      await c.query('UPDATE proches_acces SET compte_id = $2 WHERE id = ANY($1)', [ok.map((a) => a.id), x.id]);
      await journalCompte(c, `compte n° ${x.id} créé à partir d'une invitation`);
      return x;
    }).catch((e) => { if (e.code === '23505') throw new ErreurHttp(401, 'identifiants_incorrects'); throw e; });
    return finir(await ouvrirProfils(pool, n.id, accesValide), await sessionCompteNouvelle(pool, n.id));
  }
  if (!k.confirme_le) {
    // Compte jamais confirmé (peut-être créé par un tiers avec ce courriel) : un proche invité qui se connecte avec
    // le mot de passe de son invitation en prend possession ; l'invitation a prouvé son courriel.
    const ok = await ancienne(adr, mdp).catch(() => null);
    if (ok) {
      await transaction(pool, async (c) => {
        await c.query('UPDATE proches_comptes SET mot_de_passe_hash = $2, confirme_le = now(), confirmation_hash = NULL, echecs = 0, bloque_jusqu_au = NULL WHERE id = $1', [k.id, ok[0].mot_de_passe_hash]);
        await c.query('UPDATE proches_acces SET compte_id = $2 WHERE id = ANY($1)', [ok.map((a) => a.id), k.id]);
      });
      return finir(await ouvrirProfils(pool, k.id, accesValide), await sessionCompteNouvelle(pool, k.id));
    }
  }
  const bloque = k.bloque_jusqu_au && k.bloque_jusqu_au > new Date();
  // Même coût que la connexion par invitation (4 vérifications en parallèle) : la durée ne dit rien du compte (audit)
  const [bon] = await Promise.all([verifierAsync(mdp, k.mot_de_passe_hash || 'x:00'), ...[1, 2, 3].map(() => verifierAsync(mdp, 'x:00'))]);
  if (!bon || bloque) {
    if (!bon) await pool.query(`UPDATE proches_comptes SET echecs = echecs + 1,
      bloque_jusqu_au = CASE WHEN echecs + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE bloque_jusqu_au END WHERE id = $1`, [k.id, ECHECS_MAX, BLOCAGE_MIN]);
    throw new ErreurHttp(401, 'identifiants_incorrects');
  }
  if (!k.confirme_le) throw new ErreurHttp(403, 'courriel_non_confirme');
  // Accès d'invitations acceptées avec le même courriel et le même mot de passe, pas encore rattachés au compte
  const orphelins = (await pool.query('SELECT id, mot_de_passe_hash FROM proches_acces WHERE lower(courriel) = $1 AND compte_id IS NULL AND revoque_le IS NULL AND actif AND mot_de_passe_hash IS NOT NULL', [adr])).rows;
  for (const a of orphelins) if (await verifierAsync(mdp, a.mot_de_passe_hash)) await pool.query('UPDATE proches_acces SET compte_id = $2 WHERE id = $1 AND compte_id IS NULL', [a.id, k.id]);
  return finir(await ouvrirProfils(pool, k.id, accesValide), await sessionCompteNouvelle(pool, k.id));
}
const finir = (profils, compte) => ({ token: profils[0]?.token || null, profils, compte });

/** Invitation acceptée : rattachée au compte du même courriel (mot de passe du compte exigé), sinon un compte est créé. */
async function rattacherInvitation(c, acces, hash, mdp) {
  const k = (await c.query('SELECT * FROM proches_comptes WHERE lower(courriel) = lower($1) AND supprime_le IS NULL FOR UPDATE', [acces.courriel])).rows[0];
  if (!k) {
    const n = (await c.query('INSERT INTO proches_comptes (courriel, mot_de_passe_hash, confirme_le) VALUES (lower($1), $2, now()) RETURNING id', [acces.courriel, hash])).rows[0];
    await c.query('UPDATE proches_acces SET compte_id = $2 WHERE id = $1', [acces.id, n.id]);
    return;
  }
  if (k.confirme_le && !(await verifierAsync(mdp, k.mot_de_passe_hash || 'x:00'))) throw new ErreurHttp(409, 'compte_existant_mdp');
  // Compte jamais confirmé : l'invitation prouve le courriel ; le mot de passe choisi devient celui du compte
  if (!k.confirme_le) await c.query('UPDATE proches_comptes SET mot_de_passe_hash = $2, confirme_le = now(), confirmation_hash = NULL WHERE id = $1', [k.id, hash]);
  await c.query('UPDATE proches_acces SET compte_id = $2 WHERE id = $1', [acces.id, k.id]);
}

/* ---------------------------------------------------------------- session du compte (préfixe « C. ») */
function sessionCompte(pool) {
  return async (req, res, next) => {
    try {
      ch.exigerFictifs();
      const e = req.get('authorization') || '';
      const j = e.startsWith('Bearer C.') ? e.slice(9) : null;
      if (!j) throw new ErreurHttp(401, 'connexion_requise');
      const k = (await pool.query(`SELECT k.id, k.courriel FROM proches_comptes_sessions s JOIN proches_comptes k ON k.id = s.compte_id
        WHERE s.jeton_hash = $1 AND s.expire_le > now() AND k.supprime_le IS NULL AND k.confirme_le IS NOT NULL`, [empreinte(j)])).rows[0];
      if (!k) throw new ErreurHttp(401, 'session_expiree');
      req.compte = { ...k, jeton_hash: empreinte(j) };
      next();
    } catch (err) { next(err); }
  };
}
const etabsOuverts = async (db) => (await db.query(`SELECT id, nom, type_etablissement, type_local_code, modules, module_actif FROM etablissements
  WHERE type_etablissement <> 'hopital' AND module_actif ORDER BY nom`)).rows.filter((e) => TE.moduleActif(e, 'portail_proches'));

async function monCompte(pool, k, accesValide) {
  const acces = (await pool.query('SELECT id FROM proches_acces WHERE compte_id = $1 AND revoque_le IS NULL AND actif ORDER BY id', [k.id])).rows;
  const proches = [];
  for (const a of acces) { try { const v = await accesValide(pool, a.id); proches.push({ acces_id: a.id, resident: `${v.r_prenom} ${String(v.r_nom).slice(0, 1)}.`, etablissement: v.etab_nom, type: v.type_etablissement }); } catch { /* accès devenu invalide */ } }
  const demandes = (await pool.query(`SELECT d.id, d.statut, d.cree_le, d.traite_le, d.resident_prenom, d.resident_nom, d.lien, e.nom AS etablissement
    FROM proches_demandes_rattachement d JOIN etablissements e ON e.id = d.etablissement_id WHERE d.compte_id = $1 ORDER BY d.cree_le DESC LIMIT 30`, [k.id])).rows;
  return { courriel: k.courriel, proches, demandes };
}
async function etablissements(pool) {
  // Une RPA, une RI, une RTF ou une maison des aînés (modèle CHSLD) est rangée sous son vrai type dans la liste du proche
  const PORTAIL = { rpa: 'rpa', ri: 'ressource_intermediaire', rtf: 'rtf', maison_aines: 'maison_aines' };
  return (await etabsOuverts(pool)).map((e) => {
    const type = PORTAIL[e.type_local_code] || e.type_etablissement;
    return { id: e.id, nom: e.nom, type, type_nom: TE.TYPES?.[type]?.nom || (type === 'rtf' ? 'Ressource de type familial (RTF)' : type) };
  });
}

/* ---------------------------------------------------------------- demande de rattachement (réponse toujours identique) */
async function demander(pool, k, b) {
  const etabId = Number(b?.etablissement_id);
  const e = Number.isInteger(etabId) ? (await etabsOuverts(pool)).find((x) => x.id === etabId) : null;
  if (!e) throw new ErreurHttp(400, 'etablissement_invalide');
  const v = { pp: texte(b.proche_prenom, 80), pn: texte(b.proche_nom, 80), tel: texte(b.proche_telephone, 30), rp: texte(b.resident_prenom, 80), rn: texte(b.resident_nom, 80) };
  if (!v.pp || !v.pn || !v.rp || !v.rn || !ch.RELATIONS.includes(b.lien) || (v.tel && !/^[0-9 +().-]{7,30}$/.test(v.tel))) throw new ErreurHttp(400, 'rattachement_invalide');
  if (b.consentement !== true) throw new ErreurHttp(400, 'consentement_requis');
  const code = normCode(b.code);
  return transaction(pool, async (c) => {
    const cpt = (await c.query('SELECT * FROM proches_comptes WHERE id = $1 FOR UPDATE', [k.id])).rows[0];
    const n = (await c.query(`SELECT count(*) FILTER (WHERE statut = 'en_attente')::int attente, count(*) FILTER (WHERE cree_le > now() - interval '1 day')::int jour
      FROM proches_demandes_rattachement WHERE compte_id = $1`, [k.id])).rows[0];
    if (n.attente >= DEMANDES_ATTENTE_MAX || n.jour >= DEMANDES_JOUR_MAX) throw new ErreurHttp(429, 'trop_de_demandes');
    // Code facultatif : vérifié de la même façon qu'il soit bon, faux ou absent ; essais erronés limités, sans le dire
    let codeId = null;
    const fenetreOuverte = !cpt.essais_code_depuis || cpt.essais_code_depuis < new Date(Date.now() - 86400000);
    const essais = fenetreOuverte ? 0 : cpt.essais_code;
    const x = (await c.query('SELECT id FROM proches_codes_rattachement WHERE etablissement_id = $1 AND code_hash = $2 AND utilise_le IS NULL AND expire_le > now()', [e.id, empreinte(code || '-')])).rows[0];
    if (code && essais < CODE_ESSAIS_MAX) {
      if (x) codeId = x.id;
      else await c.query('UPDATE proches_comptes SET essais_code = $2, essais_code_depuis = CASE WHEN $3 THEN now() ELSE essais_code_depuis END WHERE id = $1', [k.id, essais + 1, fenetreOuverte]);
    }
    const d = (await c.query(`INSERT INTO proches_demandes_rattachement (compte_id, etablissement_id, proche_prenom, proche_nom, proche_telephone, resident_prenom, resident_nom, lien, representant_legal, code_id, consentement_declare_le)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now()) RETURNING id`, [k.id, e.id, v.pp, v.pn, v.tel, v.rp, v.rn, b.lien, b.representant_legal === true, codeId])).rows[0];
    await journaliser(c, { etablissementId: e.id, action: 'Arrimo Famille', detail: `demande de rattachement n° ${d.id} reçue (compte n° ${k.id}) : identité à vérifier` });
    await require('./services').notifier(c, e.id, null, 'famille_rattachement', { n: d.id });
    return { ok: true, id: d.id, statut: 'en_attente' };
  });
}
async function retirerDemande(pool, k, id) {
  const d = (await pool.query(`UPDATE proches_demandes_rattachement SET statut = 'retiree', traite_le = now() WHERE id = $1 AND compte_id = $2 AND statut = 'en_attente' RETURNING id, etablissement_id`, [id, k.id])).rows[0];
  if (!d) throw new ErreurHttp(404, 'demande_rattachement_introuvable');
  await journaliser(pool, { etablissementId: d.etablissement_id, action: 'Arrimo Famille', detail: `demande de rattachement n° ${d.id} retirée par le proche` });
  return { ok: true };
}
async function couperAcces(c, accesId) {
  await c.query('UPDATE proches_acces SET revoque_le = COALESCE(revoque_le, now()), actif = false WHERE id = $1', [accesId]);
  await c.query('DELETE FROM proches_sessions WHERE acces_id = $1', [accesId]);
  await c.query('DELETE FROM proches_notifications_attente WHERE acces_id = $1', [accesId]);
  await c.query('DELETE FROM proches_abonnements_push WHERE acces_id = $1', [accesId]);
}
async function quitter(pool, k, accesId) {
  return transaction(pool, async (c) => {
    const a = (await c.query('SELECT a.id, a.etablissement_id, r.reference FROM proches_acces a JOIN residents r ON r.id = a.resident_id WHERE a.id = $1 AND a.compte_id = $2 AND a.revoque_le IS NULL FOR UPDATE OF a', [accesId, k.id])).rows[0];
    if (!a) throw new ErreurHttp(404, 'acces_introuvable');
    await couperAcces(c, a.id);
    await journaliser(c, { etablissementId: a.etablissement_id, action: 'Portail des proches', detail: `${a.reference} · accès retiré par le proche` });
    return { ok: true };
  });
}
async function changerMotDePasse(pool, k, b) {
  const x = (await pool.query('SELECT mot_de_passe_hash FROM proches_comptes WHERE id = $1', [k.id])).rows[0];
  if (!(await verifierAsync(String(b?.actuel || ''), x?.mot_de_passe_hash || 'x:00'))) throw new ErreurHttp(401, 'identifiants_incorrects');
  verifierRobustesse(b?.nouveau);
  const hash = await hacherAsync(String(b.nouveau));
  return transaction(pool, async (c) => {
    await c.query('UPDATE proches_comptes SET mot_de_passe_hash = $2 WHERE id = $1', [k.id, hash]);
    // Les autres appareils sont déconnectés ; la session en cours reste ouverte
    await c.query('DELETE FROM proches_comptes_sessions WHERE compte_id = $1 AND jeton_hash <> $2', [k.id, k.jeton_hash]);
    await journalCompte(c, `compte n° ${k.id} : mot de passe changé`);
    return { ok: true };
  });
}
/** Suppression du compte par le proche (Loi 25) : accès coupés, demandes retirées, courriel effacé. Le journal garde les faits sans identité. */
async function supprimer(pool, k, b) {
  const x = (await pool.query('SELECT mot_de_passe_hash FROM proches_comptes WHERE id = $1', [k.id])).rows[0];
  if (!(await verifierAsync(String(b?.mot_de_passe || ''), x?.mot_de_passe_hash || 'x:00'))) throw new ErreurHttp(401, 'identifiants_incorrects');
  return transaction(pool, async (c) => {
    const acces = (await c.query('SELECT a.id, a.etablissement_id, r.reference FROM proches_acces a JOIN residents r ON r.id = a.resident_id WHERE a.compte_id = $1 AND a.revoque_le IS NULL', [k.id])).rows;
    for (const a of acces) {
      await couperAcces(c, a.id);
      await journaliser(c, { etablissementId: a.etablissement_id, action: 'Portail des proches', detail: `${a.reference} · accès retiré (compte supprimé par le proche)` });
    }
    await c.query(`UPDATE proches_demandes_rattachement SET statut = 'retiree', traite_le = now() WHERE compte_id = $1 AND statut = 'en_attente'`, [k.id]);
    await c.query('DELETE FROM proches_comptes_sessions WHERE compte_id = $1', [k.id]);
    await c.query(`UPDATE proches_comptes SET courriel = 'supprime-' || id || '@supprime.invalid', mot_de_passe_hash = NULL, confirmation_hash = NULL, reinit_hash = NULL, supprime_le = now() WHERE id = $1`, [k.id]);
    await journalCompte(c, `compte n° ${k.id} supprimé par le proche`);
    return { ok: true };
  });
}

/* ---------------------------------------------------------------- côté établissement */
async function garde(pool, u, etabId) {
  const e = await ch.etabChsld(pool, u, etabId, { roles: GERER });
  if (!TE.moduleActif(e, 'portail_proches')) throw new ErreurHttp(403, 'module_desactive', { module: 'portail_proches' });
  return e;
}
async function file(pool, u, etabId) {
  await garde(pool, u, etabId);
  return (await pool.query(`SELECT d.id, d.statut, d.cree_le, d.traite_le, d.proche_prenom, d.proche_nom, d.proche_telephone, k.courriel, d.resident_prenom, d.resident_nom,
      d.lien, d.representant_legal, d.code_id IS NOT NULL AS code_valide, r.id AS code_resident_id, r.reference AS code_resident_ref, r.prenom AS code_resident_prenom, r.nom AS code_resident_nom,
      t.nom AS traite_par
    FROM proches_demandes_rattachement d JOIN proches_comptes k ON k.id = d.compte_id
    LEFT JOIN proches_codes_rattachement c ON c.id = d.code_id LEFT JOIN residents r ON r.id = c.resident_id LEFT JOIN utilisateurs t ON t.id = d.traite_par
    WHERE d.etablissement_id = $1 AND (d.statut = 'en_attente' OR d.traite_le > now() - interval '60 days')
    ORDER BY (d.statut = 'en_attente') DESC, d.cree_le LIMIT 200`, [etabId])).rows;
}
async function decider(pool, u, id, b) {
  const d0 = (await pool.query('SELECT etablissement_id FROM proches_demandes_rattachement WHERE id = $1', [id])).rows[0];
  if (!d0) throw new ErreurHttp(404, 'demande_rattachement_introuvable');
  await garde(pool, u, d0.etablissement_id);
  if (!['acceptee', 'refusee'].includes(b?.decision)) throw new ErreurHttp(400, 'rattachement_invalide');
  if (b.decision === 'refusee') {
    const d = (await pool.query(`UPDATE proches_demandes_rattachement SET statut = 'refusee', traite_par = $2, traite_le = now() WHERE id = $1 AND statut = 'en_attente' RETURNING id`, [id, u.id])).rows[0];
    if (!d) throw new ErreurHttp(409, 'demande_deja_traitee');
    await journaliser(pool, { etablissementId: d0.etablissement_id, utilisateurId: u.id, action: 'Arrimo Famille', detail: `demande de rattachement n° ${id} refusée` });
    return { id, statut: 'refusee' };
  }
  // Acceptation : résident choisi par le personnel, identité vérifiée, consentement enregistré, autorisations choisies
  const residentId = Number(b.resident_id);
  if (!Number.isInteger(residentId)) throw new ErreurHttp(400, 'rattachement_invalide');
  if (!VERIFICATIONS.includes(b.verification) || (b.verification === 'autre' && !texte(b.verification_precision, 200))) throw new ErreurHttp(400, 'verification_requise');
  const consPar = texte(b.consentement_par, 120), consLe = String(b.consentement_le || '').slice(0, 10);
  if (!CONSENTEMENTS.includes(b.consentement_type) || !consPar || !/^\d{4}-\d{2}-\d{2}$/.test(consLe) || Number.isNaN(new Date(consLe).getTime()) || new Date(`${consLe}T00:00:00Z`) > new Date()) throw new ErreurHttp(400, 'consentement_invalide');
  const autorisations = Array.isArray(b.autorisations) ? [...new Set(b.autorisations)].filter((x) => ch.CATEGORIES.includes(x)) : [];
  if (!autorisations.length) throw new ErreurHttp(409, 'proche_sans_autorisation');
  const expire = b.expire_le ? new Date(b.expire_le) : null;
  if (expire && (Number.isNaN(expire.getTime()) || expire <= new Date())) throw new ErreurHttp(400, 'date_invalide');
  return transaction(pool, async (c) => {
    const d = (await c.query('SELECT * FROM proches_demandes_rattachement WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (d.statut !== 'en_attente') throw new ErreurHttp(409, 'demande_deja_traitee');
    const r = await ch.verrouResident(c, residentId);
    if (r.etablissement_id !== d.etablissement_id || ['sorti', 'transfere'].includes(r.statut)) throw new ErreurHttp(404, 'resident_introuvable');
    if (d.code_id) { const cr = (await c.query('SELECT resident_id FROM proches_codes_rattachement WHERE id = $1', [d.code_id])).rows[0]; if (cr.resident_id !== r.id) throw new ErreurHttp(409, 'code_autre_resident'); }
    const cpt = (await c.query('SELECT * FROM proches_comptes WHERE id = $1 AND supprime_le IS NULL AND confirme_le IS NOT NULL', [d.compte_id])).rows[0];
    if (!cpt) throw new ErreurHttp(409, 'demande_deja_traitee');
    if ((await c.query('SELECT 1 FROM proches_acces WHERE lower(courriel) = lower($1) AND resident_id = $2 AND revoque_le IS NULL', [cpt.courriel, r.id])).rows.length) throw new ErreurHttp(409, 'proche_deja_rattache');
    let contactId;
    if (b.contact_id) {
      const k = (await c.query('SELECT * FROM resident_contacts WHERE id = $1 AND resident_id = $2 AND actif FOR UPDATE', [Number(b.contact_id), r.id])).rows[0];
      if (!k) throw new ErreurHttp(404, 'contact_introuvable');
      await c.query('UPDATE resident_contacts SET autorisations = $2, courriel = $3, version = version + 1, modifie_le = now() WHERE id = $1', [k.id, autorisations, cpt.courriel]);
      contactId = k.id;
    } else {
      contactId = (await ch.insererContact(c, r.id, ch.lireContact({ prenom: d.proche_prenom, nom: d.proche_nom, relation: d.lien, telephone: d.proche_telephone, courriel: cpt.courriel,
        representant_legal: d.representant_legal, contact_urgence: false, autorisations }))).id;
    }
    // Un seul accès ouvert par contact : l'accès précédent de ce contact est fermé
    for (const a of (await c.query('SELECT id FROM proches_acces WHERE contact_id = $1 AND revoque_le IS NULL', [contactId])).rows) {
      await couperAcces(c, a.id); await c.query('UPDATE proches_acces SET revoque_par = $2 WHERE id = $1', [a.id, u.id]);
    }
    const a = (await c.query(`INSERT INTO proches_acces (contact_id, resident_id, etablissement_id, courriel, compte_id, actif, expire_le, cree_par)
      VALUES ($1, $2, $3, $4, $5, true, $6, $7) RETURNING id`, [contactId, r.id, r.etablissement_id, cpt.courriel, cpt.id, expire, u.id])).rows[0];
    await c.query(`INSERT INTO proches_consentements (acces_id, demande_id, resident_id, etablissement_id, type, donne_par, donne_le, verification, verification_precision, enregistre_par)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [a.id, d.id, r.id, r.etablissement_id, b.consentement_type, consPar, consLe, b.verification, texte(b.verification_precision, 200), u.id]);
    await c.query(`UPDATE proches_demandes_rattachement SET statut = 'acceptee', traite_par = $2, traite_le = now(), acces_id = $3 WHERE id = $1`, [d.id, u.id, a.id]);
    if (d.code_id) await c.query('UPDATE proches_codes_rattachement SET utilise_le = now() WHERE id = $1', [d.code_id]);
    await ch.mouvement(c, r, 'modification', u, { detail: `Accès Arrimo Famille accordé après vérification (${b.verification}) ; consentement : ${b.consentement_type}` });
    await journaliser(c, { etablissementId: r.etablissement_id, utilisateurId: u.id, action: 'Arrimo Famille',
      detail: `${r.reference} · demande n° ${d.id} acceptée ; vérification : ${b.verification} ; consentement : ${b.consentement_type} ; autorisations : ${autorisations.join(', ')}` });
    return { id: d.id, statut: 'acceptee', acces_id: a.id, contact_id: contactId };
  });
}
async function creerCode(pool, u, residentId) {
  ch.exigerFictifs();
  const r = (await pool.query('SELECT id, etablissement_id, reference, statut FROM residents WHERE id = $1', [residentId])).rows[0];
  if (!r) throw new ErreurHttp(404, 'resident_introuvable');
  await garde(pool, u, r.etablissement_id);
  if (['sorti', 'transfere'].includes(r.statut)) throw new ErreurHttp(404, 'resident_introuvable');
  for (let i = 0; i < 5; i++) {
    const code = Array.from(crypto.randomBytes(8), (x) => ALPHABET[x % ALPHABET.length]).join('');
    try {
      return await transaction(pool, async (c) => {
        const n = (await c.query(`INSERT INTO proches_codes_rattachement (resident_id, etablissement_id, code_hash, expire_le, cree_par) VALUES ($1, $2, $3, now() + make_interval(days => $4), $5) RETURNING expire_le`,
          [r.id, r.etablissement_id, empreinte(code), CODE_JOURS, u.id])).rows[0];
        await journaliser(c, { etablissementId: r.etablissement_id, utilisateurId: u.id, action: 'Arrimo Famille', detail: `${r.reference} · code de rattachement créé (valable ${CODE_JOURS} jours)` });
        // Le code est montré une seule fois ; seule son empreinte est conservée
        return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expire_le: n.expire_le };
      });
    } catch (e) { if (e.code !== '23505') throw e; }
  }
  throw new ErreurHttp(409, 'trop_de_tentatives');
}

/* ---------------------------------------------------------------- entretien périodique (minimisation, Loi 25) */
async function entretien(pool) {
  await pool.query(`UPDATE proches_demandes_rattachement SET statut = 'expiree', traite_le = now() WHERE statut = 'en_attente' AND cree_le < now() - interval '30 days'`);
  await pool.query(`DELETE FROM proches_demandes_rattachement WHERE statut IN ('refusee', 'retiree', 'expiree') AND acces_id IS NULL AND traite_le < now() - interval '90 days'
    AND id NOT IN (SELECT demande_id FROM proches_consentements WHERE demande_id IS NOT NULL)`);
  await pool.query('DELETE FROM proches_comptes_sessions WHERE expire_le < now()');
  await pool.query(`DELETE FROM proches_comptes k WHERE k.confirme_le IS NULL AND k.cree_le < now() - interval '7 days'
    AND NOT EXISTS (SELECT 1 FROM proches_acces a WHERE a.compte_id = k.id) AND NOT EXISTS (SELECT 1 FROM proches_demandes_rattachement d WHERE d.compte_id = k.id)
    AND NOT EXISTS (SELECT 1 FROM proches_comptes_sessions s WHERE s.compte_id = k.id)`);
}

/* ---------------------------------------------------------------- routes */
function brancherPublic(api, pool, route, { accesValide }) {
  api.post('/proches/compte/inscription', route((req) => inscription(pool, req.body, req.ip)));
  api.post('/proches/compte/confirmer', route((req) => confirmer(pool, req.body, req.ip)));
  api.post('/proches/compte/renvoyer', route((req) => renvoyer(pool, req.body, req.ip)));
  api.post('/proches/compte/oubli', route((req) => oubli(pool, req.body, req.ip)));
  api.post('/proches/compte/reinitialiser', route((req) => reinitialiser(pool, req.body, req.ip)));
  const s = sessionCompte(pool);
  api.get('/proches/compte', s, route((req) => monCompte(pool, req.compte, accesValide)));
  api.post('/proches/compte/profils', s, route(async (req) => ({ profils: await ouvrirProfils(pool, req.compte.id, accesValide) })));
  api.get('/proches/compte/etablissements', s, route(() => etablissements(pool)));
  api.post('/proches/compte/rattachements', s, route((req) => demander(pool, req.compte, req.body)));
  api.post('/proches/compte/rattachements/:id/retirer', s, route((req) => retirerDemande(pool, req.compte, Number(req.params.id) || 0)));
  api.post('/proches/compte/acces/:id/quitter', s, route((req) => quitter(pool, req.compte, Number(req.params.id) || 0)));
  api.post('/proches/compte/mot-de-passe', s, route((req) => changerMotDePasse(pool, req.compte, req.body)));
  api.post('/proches/compte/supprimer', s, route((req) => supprimer(pool, req.compte, req.body)));
  api.post('/proches/compte/deconnexion', s, route(async (req) => { await pool.query('DELETE FROM proches_comptes_sessions WHERE jeton_hash = $1', [req.compte.jeton_hash]); return { ok: true }; }));
}
function brancherPersonnel(api, pool, route, entier) {
  api.get('/chsld/rattachements', route((req) => file(pool, req.utilisateur, entier(req.query.etablissement_id, 'etablissement_id'))));
  api.post('/chsld/rattachements/:id/decision', route((req) => decider(pool, req.utilisateur, entier(req.params.id, 'id'), req.body)));
  api.post('/chsld/residents/:id/code-rattachement', route((req) => creerCode(pool, req.utilisateur, entier(req.params.id, 'id'))));
}
module.exports = { etablissements, brancherPublic, brancherPersonnel, connexion, rattacherInvitation, entretien, GERER };
