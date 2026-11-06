/** Démarrage de la console SH (sh.<domaine>). Variables : SH_DATABASE_URL (ou DATABASE_URL), PORT (3012), HOST, SH_ENV_* (voir cibles.js). */
// Les colonnes « date » deviennent minuit dans le fuseau du processus : en UTC, le JSON garde le bon jour.
// Les dates métier (aujourd'hui, échéances) sont calculées explicitement dans SH_FUSEAU.
process.env.TZ = 'UTC';
const fs = require('fs');
const path = require('path');
const { creerPool } = require('../db');
const { creerAppSh } = require('./app');
const { cibles } = require('./cibles');
const { migrerSh } = require('./migrations');
const { verifierEnvironnements } = require('./supervision');

const url = process.env.SH_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('SH_DATABASE_URL manquant.'); process.exit(1); }
const pool = creerPool(url);
const port = Number(process.env.PORT || 3012);
const hote = process.env.HOST || '127.0.0.1';

pool.query(fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'sh-schema.sql'), 'utf8'))
  .then(() => migrerSh(pool, process.env))
  .then(() => creerAppSh(pool).listen(port, hote, () => {
    console.log(`Console SH sur ${hote}:${port} · environnements reliés : ${cibles().map((c) => c.code).join(', ') || 'aucun'}`);
    const slaMinutes=Number(process.env.SH_SLA_MINUTES??1);
    if(Number.isFinite(slaMinutes)&&slaMinutes>0){
      const verifierSla=()=>require('./support-sla').executerEscalades(pool).catch(e=>console.error('SLA :',e.code||e.name));
      verifierSla();setInterval(verifierSla,Math.max(1,slaMinutes)*60000).unref();
    }
    const demandes=()=>require('./demandes-site').entretien(pool,process.env).catch(e=>console.error('Demandes du site :',e.code||e.name));
    demandes();setInterval(demandes,300000).unref();
    const courrielsMinutes=Number(process.env.SH_SUPPORT_COURRIELS_MINUTES??1);
    if(Number.isFinite(courrielsMinutes)&&courrielsMinutes>0){
      const envoyerCourriels=()=>require('./support-courriels').executer(pool,{env:process.env}).catch(e=>console.error('Courriels support :',e.code||e.name));
      envoyerCourriels();setInterval(envoyerCourriels,Math.max(1,courrielsMinutes)*60000).unref();
    }
    // Taux de change officiels (SH_CHANGE_MINUTES, 720 par défaut ; 0 désactive). Les quinze derniers jours sont réimportés sans écraser.
    const changeMinutes=Number(process.env.SH_CHANGE_MINUTES??720);
    if(Number.isFinite(changeMinutes)&&changeMinutes>0){
      const importer=()=>{const debut=new Date(Date.now()-15*86400000).toISOString().slice(0,10);
        return require('../db').transaction(pool,c=>require('./change').importerBanqueCanada(c,{debut})).catch(e=>console.error('Change :',e.code||e.name));};
      setTimeout(importer,30000).unref();setInterval(importer,Math.max(60,changeMinutes)*60000).unref();
    }
    // Supervision des environnements reliés (SH_SUPERVISION_MINUTES, 5 par défaut ; 0 la désactive)
    const minutes = Number(process.env.SH_SUPERVISION_MINUTES ?? 5);
    if (minutes > 0) {
      const releve = () => verifierEnvironnements(pool, cibles()).catch((e) => console.error('Supervision :', e.message));
      setTimeout(releve, 10000).unref();
      setInterval(releve, minutes * 60000).unref();
    }
  }))
  .catch((e) => { console.error('Console SH :', e.message); process.exit(1); });
