'use strict';
const crypto = require('node:crypto');
const { transaction } = require('../db');
const { hacherAsync, verifierRobustesse } = require('../auth');
const courriel = require('../courriel');
const { empreinte } = require('./security');

const erreur = (statut, message) => Object.assign(new Error(message), { statut });
const DUREE_MINUTES = 30;
function disponible(env) {
  try { return courriel.actif(env.SH_PUBLIC_URL) && new URL(env.SH_PUBLIC_URL).protocol === 'https:'; } catch { return false; }
}
async function demander(pool, email, env, acteur = null) {
  if (!disponible(env)) throw erreur(503, 'L’envoi des courriels de récupération SH n’est pas configuré.');
  const adresse = String(email || '').trim().toLowerCase();
  const envoi = await transaction(pool, async (c) => {
    const u = (await c.query(`SELECT id,email,nom FROM sh_utilisateurs
      WHERE lower(email)=$1 AND actif AND archive_le IS NULL FOR UPDATE`, [adresse])).rows[0];
    if (!u) return null;
    const n = (await c.query(`SELECT count(*)::int n FROM sh_recuperations
      WHERE utilisateur_id=$1 AND cree_le>now()-interval '1 hour'`, [u.id])).rows[0].n;
    if (n >= 3) return null;
    const jeton = crypto.randomBytes(32).toString('hex');
    await c.query(`UPDATE sh_recuperations SET revoque_le=now()
      WHERE utilisateur_id=$1 AND utilise_le IS NULL AND revoque_le IS NULL`, [u.id]);
    await c.query(`INSERT INTO sh_recuperations(jeton_hache,utilisateur_id,expire_le)
      VALUES($1,$2,now()+interval '30 minutes')`, [empreinte(jeton),u.id]);
    await c.query(`INSERT INTO sh_journal(utilisateur_id,action,cible,detail)
      VALUES($1,'Récupération SH demandée',$2,'lien individuel ; MFA conservée')`, [acteur?.id || null,u.email]);
    return { u, jeton };
  });
  // L'envoi n'allonge pas la réponse selon l'existence du compte. Aucun secret dans les journaux.
  if (envoi) {
    const { u, jeton } = envoi;
    const lien = `${env.SH_PUBLIC_URL.replace(/\/$/,'')}/#recuperation=${jeton}`;
    void Promise.resolve().then(() => courriel.envoyer({ a:u.email, sujet:'Arrimo SH · Récupérer votre compte',
      texte:`Bonjour ${u.nom},\n\nChoisissez un nouveau mot de passe avec ce lien individuel valable ${DUREE_MINUTES} minutes, à usage unique :\n${lien}\n\nVotre double authentification reste active. Si vous n’avez pas demandé ce lien, ignorez ce message.` }))
      .catch(async () => {
        await pool.query('UPDATE sh_recuperations SET revoque_le=now() WHERE jeton_hache=$1', [empreinte(jeton)]).catch(()=>{});
        await pool.query(`INSERT INTO sh_journal(action,cible,detail)
          VALUES('Échec envoi récupération SH',$1,'transport courriel indisponible')`, [u.email]).catch(()=>{});
      });
  }
  return { ok:true, message:'Si un compte actif correspond à cette adresse, un lien de récupération sera envoyé.' };
}
async function consommer(pool, jeton, nouveau) {
  if (!/^[a-f0-9]{64}$/.test(String(jeton || ''))) throw erreur(400,'Lien invalide ou expiré.');
  verifierRobustesse(nouveau);
  const hash = await hacherAsync(nouveau);
  return transaction(pool, async (c) => {
    // Toujours verrouiller le compte avant ses jetons, comme demander(), pour éviter les interblocages.
    const u = (await c.query(`SELECT u.id,u.email FROM sh_utilisateurs u JOIN sh_recuperations r ON r.utilisateur_id=u.id
      WHERE r.jeton_hache=$1 AND u.actif AND u.archive_le IS NULL FOR UPDATE OF u`, [empreinte(jeton)])).rows[0];
    if (!u) throw erreur(400,'Lien invalide ou expiré.');
    const r = await c.query(`UPDATE sh_recuperations SET utilise_le=now() WHERE jeton_hache=$1
      AND utilise_le IS NULL AND revoque_le IS NULL AND expire_le>now() RETURNING utilisateur_id`, [empreinte(jeton)]);
    if (!r.rowCount) throw erreur(400,'Lien invalide ou expiré.');
    await c.query('UPDATE sh_utilisateurs SET mot_de_passe_hash=$2,mdp_temporaire=false WHERE id=$1', [u.id,hash]);
    await c.query('DELETE FROM sh_sessions WHERE utilisateur_id=$1', [u.id]);
    await c.query('DELETE FROM sh_connexions_2fa WHERE utilisateur_id=$1', [u.id]);
    await c.query(`UPDATE sh_recuperations SET revoque_le=now() WHERE utilisateur_id=$1
      AND utilise_le IS NULL AND revoque_le IS NULL`, [u.id]);
    await c.query(`INSERT INTO sh_journal(utilisateur_id,action,cible,detail)
      VALUES($1,'Mot de passe SH récupéré',$2,'sessions révoquées ; MFA conservée')`, [u.id,u.email]);
    return { ok:true };
  });
}
module.exports = { disponible, demander, consommer, DUREE_MINUTES };
