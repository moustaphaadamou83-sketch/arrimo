'use strict';
// Service séparé : uniquement données fictives, aucun SMTP ni cible hospitalière réelle.
const fs=require('node:fs'),crypto=require('node:crypto');
const {creerPool}=require('../src/db');
const {migrerSh}=require('../src/sh/migrations');
const {hacherAsync}=require('../src/auth');
const {chiffrerSecret}=require('../src/sh/security');
const totp=require('../src/totp');
const courriel=require('../src/courriel');
async function main(){
  if(process.env.SH_VALIDATION_FICTIVE!=='1')throw new Error('Service réservé à la validation fictive.');
  const u=new URL(process.env.DATABASE_URL);
  if(u.hostname!=='127.0.0.1'||!/^\/arrimo_sh_validation_lot1_[a-z0-9_]+$/.test(u.pathname))throw new Error('Base de validation dédiée obligatoire.');
  if(Object.keys(process.env).some(k=>/^SH_ENV_.*_(URL|CLE)$/.test(k)&&process.env[k])||process.env.SMTP_URL)throw new Error('Aucune connexion externe autorisée pour cette validation.');
  courriel.definirTransport(async m=>fs.promises.appendFile(process.env.SH_VALIDATION_COURRIELS,JSON.stringify({date:new Date().toISOString(),simulation:true,...m})+'\n',{mode:0o600}));
  const pool=creerPool(u.href);
  await pool.query(fs.readFileSync(require.resolve('../db/sh-schema.sql'),'utf8'));await migrerSh(pool);
  if(!(await pool.query('SELECT 1 FROM sh_utilisateurs LIMIT 1')).rowCount){
    const secret=totp.nouveauSecret(),password='Validation-'+crypto.randomBytes(18).toString('base64url')+'9';
    const admin=(await pool.query(`INSERT INTO sh_utilisateurs(email,nom,role,mot_de_passe_hash,mdp_temporaire,totp_secret,totp_actif)
      VALUES('admin.validation@example.invalid','Administration fictive','administration',$1,false,$2,true) RETURNING id`,[await hacherAsync(password),chiffrerSecret(secret)])).rows[0];
    const membre=(await pool.query(`INSERT INTO sh_utilisateurs(email,nom,role,mot_de_passe_hash,fonction)
      VALUES('consultant.validation@example.invalid','Consultant fictif','implantation',$1,'Consultant implantation') RETURNING id`,[await hacherAsync(crypto.randomBytes(32).toString('hex'))])).rows[0];
    const hop=(await pool.query(`INSERT INTO hopitaux(nom,environnement,code_etab,pays_code,ville)
      VALUES('Pilote Hôpital Test','recette','PTEST','TG','Ville fictive') RETURNING id`)).rows[0];
    await require('../src/sh/etapes').creerEtapes(pool,hop.id);
    const projet=(await pool.query(`INSERT INTO sh_projets(hopital_id,nom,type_projet,responsable_id,cree_par)
      VALUES($1,'Pilote Hôpital Test','pilote',$2,$2) RETURNING id`,[hop.id,admin.id])).rows[0];
    for(const id of [admin.id,membre.id])await pool.query('INSERT INTO sh_projet_membres(projet_id,utilisateur_id) VALUES($1,$2)',[projet.id,id]);
    await pool.query(`INSERT INTO sh_taches(projet_id,titre,responsable_id,critique_golive,criteres_acceptation,cree_par)
      VALUES($1,'Valider la sécurité du pilote fictif',$2,true,'Recette approuvée sur données fictives',$2)`,[projet.id,admin.id]);
    fs.writeFileSync(process.env.SH_VALIDATION_ACCES,JSON.stringify({validation_fictive:true,url:process.env.SH_PUBLIC_URL,email:'admin.validation@example.invalid',password,totp_secret:secret},null,2)+'\n',{mode:0o600,flag:'wx'});
  }
  const port=Number(process.env.PORT);
  if(!Number.isInteger(port)||port<1024)throw new Error('Port de validation invalide.');
  require('../src/sh/app').creerAppSh(pool).listen(port,'127.0.0.1',()=>console.log('SH validation fictive prête sur boucle locale. Aucun courriel réel.'));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
