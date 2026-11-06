'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {creerPool,transaction}=require('../src/db');
const {migrerSh}=require('../src/sh/migrations');
test('sauvegarde et restauration PostgreSQL de la candidate SH dans une base fictive neuve',{timeout:120000},async t=>{
  const url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/arrimo_sh_lot1_test_[a-z0-9_]+_restauration$/);
  const pool=creerPool(url.href);t.after(()=>pool.end());
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0,'Base NEUVE obligatoire avant toute restauration.');
  const dossier=fs.mkdtempSync(path.join(os.tmpdir(),'arrimo-sh-restauration-'));t.after(()=>fs.rmSync(dossier,{recursive:true,force:true}));
  const archive=path.join(dossier,'candidate.dump');
  await pool.query(fs.readFileSync(require.resolve('../db/sh-schema.sql'),'utf8'));
  const env={SH_MFA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};await migrerSh(pool,env);
  const uid=(await pool.query("INSERT INTO sh_utilisateurs(email,nom,role,mot_de_passe_hash,mdp_temporaire) VALUES('restauration@example.invalid','Employé fictif','support','sans-connexion',false) RETURNING id")).rows[0].id;
  const h=(await pool.query("INSERT INTO hopitaux(nom,environnement,code_etab) VALUES('Hôpital Test Restauration','pilote','TEST-REST') RETURNING id")).rows[0];
  const p=(await pool.query("INSERT INTO sh_projets(hopital_id,nom) VALUES($1,'Projet Test Restauration') RETURNING id",[h.id])).rows[0];
  await pool.query("INSERT INTO sh_affectations(utilisateur_id,type,projet_id) VALUES($1,'projet',$2)",[uid,p.id]);
  await pool.query("INSERT INTO sh_taches(projet_id,titre) VALUES($1,'Tâche à retrouver')",[p.id]);
  await pool.query("INSERT INTO sh_journal(utilisateur_id,hopital_id,action,cible) VALUES($1,$2,'Écriture de recette avant sauvegarde','Projet fictif')",[uid,h.id]);
  const avant={versions:(await pool.query('SELECT version FROM sh_migrations ORDER BY version')).rows,projets:(await pool.query('SELECT * FROM sh_projets ORDER BY id')).rows,taches:(await pool.query('SELECT * FROM sh_taches ORDER BY id')).rows,journal:(await pool.query('SELECT * FROM sh_journal ORDER BY id')).rows};
  function commande(executable,args){const r=spawnSync(executable,args,{encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});assert.equal(r.status,0,r.stderr);}
  commande('/usr/lib/postgresql/16/bin/pg_dump',['--dbname',url.href,'--format=custom','--file',archive]);
  assert.ok(fs.statSync(archive).size>0);
  await pool.query("UPDATE sh_projets SET nom='Modification après sauvegarde' WHERE id=$1",[p.id]);
  await pool.query("INSERT INTO sh_taches(projet_id,titre) VALUES($1,'Écriture postérieure au point de restauration')",[p.id]);
  // --clean porte exclusivement sur la base fictive neuve identifiée et vérifiée ci-dessus.
  commande('/usr/lib/postgresql/16/bin/pg_restore',['--dbname',url.href,'--clean','--if-exists','--exit-on-error','--single-transaction',archive]);
  assert.deepEqual({versions:(await pool.query('SELECT version FROM sh_migrations ORDER BY version')).rows,projets:(await pool.query('SELECT * FROM sh_projets ORDER BY id')).rows,taches:(await pool.query('SELECT * FROM sh_taches ORDER BY id')).rows,journal:(await pool.query('SELECT * FROM sh_journal ORDER BY id')).rows},avant);
  assert.deepEqual(await migrerSh(pool,env),{version:42,appliquee:false});
  await assert.rejects(pool.query("UPDATE sh_journal SET action='Modification interdite'"));
  await transaction(pool,async c=>{
    await c.query('SET LOCAL ROLE arrimo_sh_scope');
    await c.query("SELECT set_config('app.sh_uid',$1,true),set_config('app.sh_root','0',true),set_config('app.sh_write','0',true),set_config('app.sh_role','support',true)",[String(uid)]);
    assert.deepEqual((await c.query('SELECT id FROM sh_projets')).rows,[{id:p.id}]);
    assert.equal((await c.query('DELETE FROM sh_projets WHERE id=$1',[p.id])).rowCount,0,'Le mode lecture ne permet aucune suppression.');
    assert.equal((await c.query('SELECT count(*)::int n FROM sh_projets')).rows[0].n,1);
  });
});
