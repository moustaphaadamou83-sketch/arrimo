'use strict';
const crypto = require('node:crypto');
const { transaction, ErreurHttp } = require('../db');
const { hacher, verifierRobustesse } = require('../auth');
const courriel = require('../courriel');
const { empreinte } = require('./security');

const ROLES = ['administration', 'commercial', 'implantation', 'formation', 'support'];
const URL_INVITATION = (env) => {
  const base = String(env.SH_PUBLIC_URL || '').replace(/\/$/, '');
  if (!base) throw new ErreurHttp(503, 'url_console_sh_non_configuree');
  const u = new URL(base);
  if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) throw new ErreurHttp(503, 'https_console_sh_requis');
  return `${base}/#invitation=`;
};

async function creer(pool, { email, nom, role, utilisateurId = null, creePar = null }, env = process.env) {
  const adresse = String(email || '').trim().toLowerCase();
  const nomPropre = String(nom || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adresse) || !nomPropre) throw new ErreurHttp(400, 'invitation_destinataire_invalide');
  if (!ROLES.includes(role)) throw new ErreurHttp(400, 'role_sh_invalide');
  if (!courriel.actif()) throw new ErreurHttp(503, 'courriel_sh_non_configure');
  const lienBase = URL_INVITATION(env);
  const jeton = crypto.randomBytes(32).toString('hex');
  const hash = empreinte(jeton);
  const invitation = await transaction(pool, async (c) => {
    const existant = (await c.query('SELECT id FROM sh_utilisateurs WHERE lower(email) = $1', [adresse])).rows[0];
    if (utilisateurId && (!existant || existant.id !== Number(utilisateurId))) throw new ErreurHttp(404, 'membre_sh_introuvable');
    if (!utilisateurId && existant) throw new ErreurHttp(409, 'membre_sh_existant');
    if (!utilisateurId && (await c.query(`SELECT 1 FROM sh_invitations WHERE lower(email)=$1 AND utilise_le IS NULL
      AND revoquee_le IS NULL AND expire_le>now()`, [adresse])).rowCount) throw new ErreurHttp(409, 'membre_sh_existant');
    await c.query('UPDATE sh_invitations SET revoquee_le = now() WHERE lower(email) = $1 AND utilise_le IS NULL AND revoquee_le IS NULL', [adresse]);
    const r = await c.query(`INSERT INTO sh_invitations (jeton_hache, email, nom, role, utilisateur_id, cree_par, expire_le)
      VALUES ($1,$2,$3,$4,$5,$6,now() + interval '24 hours') RETURNING id, expire_le`,
    [hash, adresse, nomPropre, role, utilisateurId, creePar]);
    return r.rows[0];
  });
  const lien = `${lienBase}${encodeURIComponent(jeton)}`;
  try {
    await courriel.envoyer({
      a: adresse,
      sujet: 'Invitation à Arrimo.SH',
      texte: `Bonjour ${nomPropre},\n\nVous êtes invité(e) à accéder à la console Arrimo.SH. Ce lien est individuel, à usage unique et expire dans 24 heures :\n${lien}\n\nChoisissez votre mot de passe, puis activez la double authentification. Si vous n’attendiez pas cette invitation, ignorez ce message.`,
    });
  } catch {
    await pool.query('UPDATE sh_invitations SET revoquee_le = now() WHERE id = $1', [invitation.id]);
    throw new ErreurHttp(502, 'invitation_envoi_echec');
  }
  if (utilisateurId) await transaction(pool, async (c) => {
    const encoreValide = (await c.query('SELECT 1 FROM sh_invitations WHERE id=$1 AND utilise_le IS NULL AND revoquee_le IS NULL FOR UPDATE', [invitation.id])).rowCount;
    if (!encoreValide) return; // le destinataire a pu accepter le lien dès sa réception
    await c.query('UPDATE sh_utilisateurs SET actif=false,totp_secret=NULL,totp_actif=false WHERE id=$1', [utilisateurId]);
    await c.query('DELETE FROM sh_sessions WHERE utilisateur_id=$1', [utilisateurId]);
    await c.query('DELETE FROM sh_connexions_2fa WHERE utilisateur_id=$1', [utilisateurId]);
  });
  return { id: invitation.id, email: adresse, expire_le: invitation.expire_le };
}

async function consommer(pool, { jeton, nouveau }, env = process.env) {
  verifierRobustesse(nouveau);
  const hash = empreinte(jeton);
  return transaction(pool, async (c) => {
    const i = (await c.query(`SELECT * FROM sh_invitations WHERE jeton_hache = $1 AND utilise_le IS NULL
      AND revoquee_le IS NULL AND expire_le > now() FOR UPDATE`, [hash])).rows[0];
    if (!i) throw new ErreurHttp(400, 'invitation_invalide');
    let u;
    if (i.utilisateur_id) {
      u = (await c.query(`UPDATE sh_utilisateurs SET nom=$2, role=$3, mot_de_passe_hash=$4, mdp_temporaire=false,
        actif=true, totp_secret=NULL, totp_actif=false, totp_dernier_pas=0 WHERE id=$1 RETURNING id,email`,
      [i.utilisateur_id, i.nom, i.role, hacher(nouveau)])).rows[0];
    } else {
      const conflict = (await c.query('SELECT 1 FROM sh_utilisateurs WHERE lower(email)=$1', [i.email.toLowerCase()])).rowCount;
      if (conflict) throw new ErreurHttp(409, 'membre_sh_existant');
      u = (await c.query(`INSERT INTO sh_utilisateurs (email,nom,role,mot_de_passe_hash,mdp_temporaire,actif)
        VALUES ($1,$2,$3,$4,false,true) RETURNING id,email`, [i.email, i.nom, i.role, hacher(nouveau)])).rows[0];
    }
    await c.query('UPDATE sh_invitations SET utilise_le=now() WHERE id=$1', [i.id]);
    await c.query('UPDATE sh_invitations SET revoquee_le=now() WHERE lower(email)=$1 AND id<>$2 AND utilise_le IS NULL AND revoquee_le IS NULL', [i.email.toLowerCase(), i.id]);
    await c.query(`INSERT INTO sh_journal (utilisateur_id,action,cible,detail) VALUES ($1,'Invitation acceptée',$2,'mot de passe choisi; MFA à activer')`, [u.id, u.email]);
    return { ok: true };
  });
}

module.exports = { creer, consommer, ROLES };
