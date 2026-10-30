'use strict';
// Rôles PostgreSQL sans connexion, distincts pour SH et sa validation. Aucune donnée modifiée.
const {spawnSync}=require('node:child_process');
for(const owner of ['arrimo_sh','arrimo_sh_validation']){
  const role=owner+'_scope';
  const sql=`DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${owner}') THEN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF;
    GRANT ${role} TO ${owner}; END IF; END $$;`;
  const r=spawnSync('runuser',['-u','postgres','--','psql','-X','-q','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
  if(r.status!==0)throw new Error(r.stderr);console.log('Rôle restreint préparé : '+role);
}
