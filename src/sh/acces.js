'use strict';
const crypto = require('node:crypto');
const { transaction } = require('../db');
const { empreinte } = require('./security');
const recuperation = require('./recuperation');
const courriel = require('../courriel');
const erreur = (statut, message) => Object.assign(new Error(message), { statut });
function entier(v) { if (!/^[1-9]\d*$/.test(String(v)) || !Number.isSafeInteger(Number(v))) throw erreur(400,'Identifiant invalide.'); return Number(v); }

async function revoquer(c, id) {
  const r = await c.query('DELETE FROM sh_sessions WHERE utilisateur_id=$1', [id]);
  await c.query('DELETE FROM sh_connexions_2fa WHERE utilisateur_id=$1', [id]);
  return r.rowCount;
}
function brancher(api, pool, route, journal, env) {
  async function sessions(id, token) {
    return (await pool.query(`SELECT id,cree_le,expire_le,(token=$2) courante FROM sh_sessions
      WHERE utilisateur_id=$1 AND expire_le>now() ORDER BY cree_le DESC,id DESC`, [id,empreinte(token)])).rows;
  }
  api.get('/moi/sessions', route(req => sessions(req.u.id,req.u.token)));
  api.get('/equipe/:id/sessions', route(async req => {
    return sessions(entier(req.params.id),req.u.token);
  }));
  async function revoquerUne(req, id, sessionId) {
    return transaction(pool,async c => {
      const r = await c.query('DELETE FROM sh_sessions WHERE utilisateur_id=$1 AND id=$2 RETURNING id', [id,entier(sessionId)]);
      if (!r.rowCount) throw erreur(404,'Session introuvable.');
      await journal(c,req.u,'Session SH révoquée',`membre ${id}`,`session ${sessionId}`);
      return { ok:true };
    });
  }
  api.post('/moi/sessions/:sessionId/revoquer', route(req => revoquerUne(req,req.u.id,req.params.sessionId)));
  api.post('/equipe/:id/sessions/:sessionId/revoquer', route(req => revoquerUne(req,entier(req.params.id),req.params.sessionId)));
  api.post('/equipe/:id/sessions/fermer', route(req => transaction(pool,async c => {
    const id=entier(req.params.id);
    if (!(await c.query('SELECT id FROM sh_utilisateurs WHERE id=$1 FOR UPDATE',[id])).rowCount) throw erreur(404,'Compte introuvable.');
    const fermees=await revoquer(c,id);
    await journal(c,req.u,'Toutes les sessions SH révoquées',`membre ${id}`,String(fermees));
    return { fermees };
  })));
  api.post('/equipe/:id/recuperer', route(async req => {
    const u=(await pool.query('SELECT email FROM sh_utilisateurs WHERE id=$1',[entier(req.params.id)])).rows[0];
    if(!u) throw erreur(404,'Compte introuvable.');
    return recuperation.demander(pool,u.email,env,req.u);
  }));
  api.put('/equipe/:id/profil', route(req => transaction(pool, async c => {
    const id=entier(req.params.id), b=req.body;
    const u=(await c.query('SELECT * FROM sh_utilisateurs WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!u) throw erreur(404,'Compte introuvable.');
    const nom=String(b.nom??u.nom).trim(),email=String(b.email??u.email).trim().toLowerCase();
    const fonction=String(b.fonction??u.fonction??'').trim();
    if(!nom||nom.length>120||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||fonction.length>160) throw erreur(400,'Nom, courriel ou fonction invalide.');
    const r=await c.query('UPDATE sh_utilisateurs SET nom=$2,email=$3,fonction=$4 WHERE id=$1 RETURNING id,nom,email,fonction',[id,nom,email,fonction||null])
      .catch(e=>{if(e.code==='23505') throw erreur(409,'Cette adresse est déjà utilisée.');throw e;});
    if(email!==u.email){
      await revoquer(c,id);
      await c.query('UPDATE sh_recuperations SET revoque_le=now() WHERE utilisateur_id=$1 AND utilise_le IS NULL',[id]);
      await c.query('UPDATE sh_invitations SET revoquee_le=now() WHERE lower(email)=$1 AND utilise_le IS NULL',[u.email.toLowerCase()]);
    }
    await journal(c,req.u,'Profil SH modifié',`membre ${id}`,'identité professionnelle');
    return r.rows[0];
  })));
  for(const action of ['archiver','restaurer']) api.post(`/equipe/:id/${action}`,route(req=>transaction(pool,async c=>{
    const id=entier(req.params.id);
    if(id===req.u.id) throw erreur(409,'Vous ne pouvez pas archiver votre propre compte.');
    const u=(await c.query('SELECT id,supprime_le FROM sh_utilisateurs WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!u) throw erreur(404,'Compte introuvable.');
    if(u.supprime_le) throw erreur(409,'Ce compte est supprimé : il ne peut être ni archivé ni restauré.');
    await c.query(action==='archiver'?'UPDATE sh_utilisateurs SET archive_le=now(),actif=false WHERE id=$1':'UPDATE sh_utilisateurs SET archive_le=NULL,actif=false WHERE id=$1',[id]);
    await revoquer(c,id);
    await c.query('UPDATE sh_recuperations SET revoque_le=now() WHERE utilisateur_id=$1 AND utilise_le IS NULL',[id]);
    await c.query('UPDATE sh_invitations SET revoquee_le=now() WHERE utilisateur_id=$1 AND utilise_le IS NULL',[id]);
    await journal(c,req.u,action==='archiver'?'Compte SH archivé':'Compte SH restauré',`membre ${id}`,'historique conservé ; compte désactivé');
    return {ok:true};
  })));
  // Demande puis suppression d'un employé archivé : données personnelles retirées, identifiant et journaux conservés.
  api.post('/equipe/:id/demander-suppression',route(req=>transaction(pool,async c=>{
    const id=entier(req.params.id),motif=String(req.body.motif||'').trim().slice(0,500);
    if(motif.length<10)throw erreur(400,'Motif de suppression requis (10 caractères au moins).');
    const u=(await c.query('SELECT id,archive_le,supprime_le FROM sh_utilisateurs WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!u)throw erreur(404,'Compte introuvable.');
    if(u.supprime_le)throw erreur(409,'Ce compte est déjà supprimé.');
    if(!u.archive_le)throw erreur(409,'Archivez le compte avant de demander sa suppression.');
    await c.query('UPDATE sh_utilisateurs SET suppression_demandee_le=now(),suppression_demandee_par=$2,suppression_motif=$3 WHERE id=$1',[id,req.u.id,motif]);
    await journal(c,req.u,'Suppression de compte SH demandée',`membre ${id}`,motif);
    return {ok:true};
  })));
  api.post('/equipe/:id/supprimer',route(req=>transaction(pool,async c=>{
    const id=entier(req.params.id);
    const u=(await c.query('SELECT * FROM sh_utilisateurs WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!u)throw erreur(404,'Compte introuvable.');
    if(u.supprime_le)throw erreur(409,'Ce compte est déjà supprimé.');
    if(!u.archive_le||!u.suppression_demandee_le)throw erreur(409,'Une demande de suppression d’un compte archivé est requise.');
    if(req.body.confirmation!==`SUPPRIMER ${u.email}`)throw erreur(400,'Confirmation de suppression invalide.');
    const jours=(await require('./parametres').lire(c,env)).employes_conservation_jours.valeur;
    if(jours==null)throw erreur(409,'La politique de conservation des comptes doit être configurée avant suppression.');
    if(Date.now()<new Date(u.archive_le).getTime()+Number(jours)*86400000)throw erreur(409,'Le délai de conservation du compte n’est pas écoulé.');
    // Données personnelles retirées ; l'identifiant reste pour que tâches, tickets et journaux demeurent traçables.
    await c.query(`UPDATE sh_utilisateurs SET nom=$2,email=$3,fonction=NULL,mot_de_passe_hash=$4,totp_secret=NULL,totp_actif=false,
      actif=false,supprime_le=now() WHERE id=$1`,[id,`Ancien membre n° ${id}`,`supprime-${id}@supprime.invalid`,'supprime:'+crypto.randomBytes(24).toString('hex')]);
    await revoquer(c,id);
    await c.query('UPDATE sh_recuperations SET revoque_le=now() WHERE utilisateur_id=$1 AND utilise_le IS NULL',[id]);
    await c.query('UPDATE sh_invitations SET revoquee_le=now() WHERE utilisateur_id=$1 AND utilise_le IS NULL',[id]);
    await journal(c,req.u,'Compte SH supprimé',`membre ${id}`,'données personnelles retirées; historique conservé');
    return {ok:true};
  })));
  api.put('/parametres/:cle',route(async req=>{
    const parametres=require('./parametres'),cle=String(req.params.cle),valeur=parametres.valider(cle,req.body.valeur);
    await pool.query(`INSERT INTO sh_parametres(cle,valeur,modifie_par) VALUES($1,$2,$3)
      ON CONFLICT(cle) DO UPDATE SET valeur=EXCLUDED.valeur,modifie_par=EXCLUDED.modifie_par,modifie_le=now()`,[cle,valeur,req.u.id]);
    await journal(pool,req.u,'Paramètre SH modifié',cle,valeur.slice(0,200));
    return (await parametres.lire(pool,env))[cle];
  }));
  api.get('/parametres',route(async()=>{const p=await require('./parametres').lire(pool,env);return {
    modifiables:p,
    general:{nom:p.emetteur_nom.valeur,adresse:p.emetteur_adresse.valeur||null,courriel:p.emetteur_courriel.valeur||null,fuseau:env.SH_FUSEAU||'America/Toronto'},
    langues:['fr','en'],
    securite:{mfa_obligatoire:true,session_heures:Number(p.session_heures.valeur),recuperation_minutes:recuperation.DUREE_MINUTES},
    courriels:{transport_configure:courriel.actif(env.SH_PUBLIC_URL),recuperation_disponible:recuperation.disponible(env)},
    documents:{stockage_configure:!!env.SH_DOCUMENTS_DIR},
    og:{sh_disponible:false,vocal_disponible:false},
    gestion:'Les secrets (clés, base, SMTP) restent dans la configuration du déploiement et ne sont jamais affichés.'
  };}));
}
module.exports={brancher,revoquer};
