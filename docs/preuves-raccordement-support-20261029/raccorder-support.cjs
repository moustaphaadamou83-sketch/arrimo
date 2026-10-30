'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {creerPool,transaction}=require('../src/db');
const {creerEtapes}=require('../src/sh/etapes');
async function main(){
 const p=process.argv[2];const sources=JSON.parse(fs.readFileSync(p,'utf8'));
 const url=new URL(process.env.SH_DATABASE_URL||process.env.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/arrimo_sh');assert.equal(url.username,'arrimo_sh');
 assert.deepEqual(sources.map(s=>s.cible),['demo','demo_abc','recette']);const pool=creerPool(url.href);
 try{
  const result=await transaction(pool,async c=>{
   await c.query("SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='60s'");await c.query("SELECT pg_advisory_xact_lock(hashtext('arrimo-sh-raccordement-support'))");
   assert.ok((await c.query('SELECT 1 FROM sh_migrations WHERE version=20')).rowCount);
   let crees=0,raccordes=0;const liens=[];
   for(const source of sources)for(const e of source.etablissements){
    assert.match(e.code,/^[A-Z0-9-]{2,12}$/);assert.equal(typeof e.nom,'string');assert.match(e.pays_code,/^[A-Z]{2}$/);
    let h=(await c.query('SELECT id,nom,pays_code,relie FROM hopitaux WHERE environnement=$1 AND code_etab=$2 FOR UPDATE',[source.cible,e.code])).rows[0];
    if(h){assert.equal(h.nom,e.nom,'Fiche SH existante contradictoire');assert.equal(h.pays_code,e.pays_code,'Pays SH contradictoire');}
    else{
     h=(await c.query(`INSERT INTO hopitaux(nom,environnement,code_etab,pays_code,ville,adresse,latitude,longitude,statut,relie,fuseau_horaire)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10) RETURNING id,relie`,[e.nom,source.cible,e.code,e.pays_code,e.ville,e.adresse,e.latitude,e.longitude,e.module_actif?'actif':'implantation',e.fuseau])).rows[0];
     await creerEtapes(c,h.id);crees++;
    }
    if(!h.relie){await c.query('UPDATE hopitaux SET relie=true WHERE id=$1',[h.id]);raccordes++;}
    await c.query(`UPDATE verifications v SET faite=true,par='raccordement support vérifié',quand=now() FROM etapes x
      WHERE x.id=v.etape_id AND x.hopital_id=$1 AND v.code='etablissement_cree' AND NOT v.faite`,[h.id]);
    const cle='Support raccordé · '+source.cible+' · '+e.code;
    if(!(await c.query("SELECT 1 FROM sh_journal WHERE hopital_id=$1 AND action='Établissement relié' AND detail=$2",[h.id,cle])).rowCount)
     await c.query("INSERT INTO sh_journal(hopital_id,action,cible,detail) VALUES($1,'Établissement relié',$2,$3)",[h.id,e.nom,cle]);
    liens.push({cible:source.cible,code:e.code,hopital_id:h.id});
   }
   return {crees,raccordes,liens,aucune_ecriture_hospitaliere:true};
  });
  console.log(JSON.stringify(result));
 }finally{await pool.end();}
}
main().catch(e=>{console.error('RACCORDEMENT_REFUSE '+(e.code||e.name));process.exitCode=1;});
