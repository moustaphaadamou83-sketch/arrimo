'use strict';
const fs=require('node:fs');const {Client}=require('pg');
(async()=>{
  const s=fs.readFileSync(process.env.ARRIMO_ETAT_CONFIGURATION,'utf8');
  const u=new URL(s.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^['"]|['"]$/g,''));
  if(u.hostname!=='127.0.0.1')throw new Error('Base locale attendue');
  if(process.env.ARRIMO_ETAT_COPIE){if(!/^arrimo_lot1_restore_demo_[a-z0-9_]+$/.test(process.env.ARRIMO_ETAT_COPIE))throw new Error('Nom de copie refusé');u.pathname='/'+process.env.ARRIMO_ETAT_COPIE;}
  const c=new Client({connectionString:u.href});await c.connect();
  try{
    await c.query('BEGIN READ ONLY');
    const q=async sql=>(await c.query(sql)).rows;
    const transfert=await q(`SELECT t.numero,t.patient_ref,t.statut,o.nom origine,d.nom destination,t.date_depart,t.date_reception
      FROM transferts t JOIN etablissements o ON o.id=t.origine_id JOIN etablissements d ON d.id=t.destination_id WHERE t.numero='TR-00067'`);
    const lit=await q(`SELECT l.code,l.etat,l.patient_ref,ch.numero chambre,e.nom etablissement FROM lits l
      JOIN chambres ch ON ch.id=l.chambre_id JOIN etablissements e ON e.id=l.etablissement_id WHERE l.code='SI-108' AND l.patient_ref='P-43267'`);
    const comptes=await q(`SELECT count(*)::int n,md5(string_agg(to_jsonb(x)::text,E'\n' ORDER BY id)) empreinte FROM
      (SELECT id,email,nom,role,mot_de_passe_hash,actif,totp_actif FROM utilisateurs ORDER BY id)x`);
    const etablissements=await q('SELECT id,code,nom FROM etablissements ORDER BY id');
    await c.query('ROLLBACK');console.log(JSON.stringify({transfert,lit,comptes,etablissements}));
  }finally{await c.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
