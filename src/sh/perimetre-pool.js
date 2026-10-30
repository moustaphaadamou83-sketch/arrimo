'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
function creerPoolPerimetre(original){
  const contexte=new AsyncLocalStorage();
  const owner=original.options?.user||new URL(original.options.connectionString).username;
  if(!/^[a-z][a-z0-9_]{0,40}$/.test(owner))throw new Error('Rôle PostgreSQL SH invalide');
  const role=owner+'_scope';
  async function preparer(c,u){
    await c.query(`SET LOCAL ROLE "${role}"`);
    await c.query("SELECT set_config('app.sh_uid',$1,true),set_config('app.sh_root',$2,true),set_config('app.sh_role',$3,true),set_config('app.sh_role_personnalise',$4,true)",[String(u.id),u.role==='administration'&&!u.role_personnalise_id?'1':'0',u.role,String(u.role_personnalise_id||'')]);
    await c.query("SELECT set_config('app.sh_write',$1,true)",[u.methode&&u.methode!=='GET'&&u.methode!=='HEAD'?'1':'0']);
  }
  const pool={
    options:original.options,
    async query(sql,args){
      const u=contexte.getStore();if(!u)return original.query(sql,args);
      const c=await original.connect();
      try{await c.query('BEGIN');await preparer(c,u);const r=await c.query(sql,args);await c.query('COMMIT');return r;}
      catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
    },
    async connect(){
      const u=contexte.getStore();if(!u)return original.connect();
      const c=await original.connect();let transaction=false;
      return {
        async query(sql,args){
          const commande=typeof sql==='string'?sql.trim().toUpperCase():'';
          if(commande==='BEGIN'){const r=await c.query(sql,args);transaction=true;await preparer(c,u);return r;}
          if(commande==='COMMIT'||commande==='ROLLBACK'){const r=await c.query(sql,args);transaction=false;return r;}
          if(!transaction)throw new Error('Transaction SH requise pour une connexion restreinte.');
          return c.query(sql,args);
        },
        release(){if(transaction){c.query('ROLLBACK').finally(()=>c.release());}else c.release();}
      };
    },
    executer(u,fn){return contexte.run(u,fn);}
  };
  return pool;
}
module.exports={creerPoolPerimetre};
