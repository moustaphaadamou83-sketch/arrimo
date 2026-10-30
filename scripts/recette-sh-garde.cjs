'use strict';
const PREFIXES_BASE={TEST_DATABASE_URL:'arrimo_sh_lot1_test_',INTERFACE_DATABASE_URL:'arrimo_sh_lot1_test_',SH_ACCES_TEST_DATABASE_URL:'arrimo_sh_lot1_test_',OG_SUIVI_TEST_DATABASE_URL:'arrimo_og_suivi_test_',OG_TEST_DATABASE_URL:'arrimo_og_test_',TRIO_TEST_DATABASE_URL:'arrimo_demo_trio_test_',STRUCTURE_DATABASE_URL:'arrimo_demo_trio_test_',PRIORITES_TEST_DATABASE_URL:'arrimo_vnext_test_',SIMULATION_TEST_DATABASE_URL:'arrimo_simulation_test_'};
const VARIABLES_BASE=['DATABASE_URL',...Object.keys(PREFIXES_BASE)];
function environnementTest(env,variable,url){
  if(!VARIABLES_BASE.includes(variable)||variable==='DATABASE_URL')throw new Error('Variable de recette inconnue.');
  const u=new URL(url);
  if(u.hostname!=='127.0.0.1'||!new RegExp('^/'+PREFIXES_BASE[variable]+'[a-z0-9_]+$').test(u.pathname)||u.search||u.hash)throw new Error('Base fictive de recette requise.');
  const resultat=Object.fromEntries(Object.entries(env).filter(([cle])=>!/^PG/i.test(cle)));
  for(const cle of VARIABLES_BASE)delete resultat[cle];
  resultat[variable]=url;
  return resultat;
}
function masquer(texte,urls){
  const secrets=new Set();
  for(const valeur of urls){
    secrets.add(valeur);
    const u=new URL(valeur);
    for(const s of [u.password,decodeURIComponent(u.password)])if(s)secrets.add(s);
  }
  for(const secret of [...secrets].sort((a,b)=>b.length-a.length))texte=texte.split(secret).join('[connexion ou secret masqué]');
  return texte;
}
function environnementAdministration(env,port='5432'){
  if(!/^\d+$/.test(String(port))||Number(port)<1||Number(port)>65535)throw new Error('Port PostgreSQL invalide.');
  const propre=Object.fromEntries(Object.entries(env).filter(([cle])=>!/^PG/i.test(cle)));
  return {...propre,PGHOST:'/var/run/postgresql',PGPORT:String(port),PGUSER:'postgres'};
}
module.exports={environnementTest,environnementAdministration,masquer,PREFIXES_BASE};
