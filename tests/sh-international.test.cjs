'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const international=require('../src/sh/international');
const fs=require('node:fs'),vm=require('node:vm');
const {autoriser,ROLES_SH}=require('../src/sh/permissions');
test('pays et monnaies : références vérifiées du cahier, normalisation et choix international explicite',()=>{
  for(const [pays,devise]of Object.entries({CA:'CAD',TG:'XOF',NE:'XOF',ML:'XOF',GN:'GNF',FR:'EUR',US:'USD',BG:'EUR'}))assert.equal(international.choisirDevise(pays),devise);
  assert.equal(international.choisirDevise(' tg ',' eur '),'EUR');
  for(const pays of ['ZZ','QC','__proto__','',null])assert.throws(()=>international.normaliserPays(pays),{statut:400});
  for(const devise of ['XYZ','__proto__','',null])assert.throws(()=>international.normaliserDevise(devise),{statut:400});
});
test('plusieurs monnaies ou absence de monnaie de référence : aucune sélection arbitraire',()=>{
  assert.throws(()=>international.choisirDevise('PS'),{statut:400});
  assert.throws(()=>international.choisirDevise('AQ'),{statut:400});
  assert.equal(international.choisirDevise('PS','USD'),'USD');
});
test('référentiel : 249 pays, libellés localisés, précision et provenance sans inventer change ou taxes',()=>{
  const fr=international.references('fr'),en=international.references('en');
  assert.equal(fr.pays.length,249);assert.equal(new Set(fr.pays.map(p=>p.code)).size,249);
  assert.equal(en.pays.find(p=>p.code==='US').nom,'United States');
  assert.notEqual(en.pays.find(p=>p.code==='US').nom,fr.pays.find(p=>p.code==='US').nom);
  assert.equal(fr.pays.find(p=>p.code==='PS').devise_defaut,null);
  assert.equal(international.decimalesDevise('XOF'),0);assert.equal(international.decimalesDevise('CAD'),2);assert.equal(international.decimalesDevise('KWD'),3);
  assert.equal(international.decimalesDevise('COP'),2);assert.equal(international.decimalesDevise('HUF'),2);assert.equal(international.decimalesDevise('MGA'),null);
  assert.equal(fr.source.version,'49');assert.equal(fr.change_disponible,false);assert.equal(fr.taxes_validees,false);
  assert.ok(fr.devises.every(d=>d.nom&&d.symbole&&(Number.isInteger(d.decimales)||d.base!==10&&d.decimales===null)));
});
test('références : accès authentifié par les rôles de base, sans accorder de nouvelles permissions aux rôles personnalisés',()=>{
  for(const role of ROLES_SH)assert.equal(autoriser({role},{method:'GET',path:'/references/internationales'}),true);
  assert.equal(autoriser({role:'support',role_personnalise_id:1,droits_personnalises:[]},{method:'GET',path:'/references/internationales'}),false);
});
test('création d’opportunité : la devise est celle du pays du client, une autre devise reste un choix explicite',async()=>{
  for(const [pays_code,choix,attendue]of [['TG',undefined,'XOF'],['CA',undefined,'CAD'],['TG','USD','USD']]){
    const routes=new Map(),api=Object.fromEntries(['get','post','put'].map(m=>[m,(p,fn)=>routes.set(`${m} ${p}`,fn)]));
    const query=async(sql,args)=>{
      if(sql.startsWith('SELECT pays_code'))return {rows:[{pays_code}]};
      if(sql.startsWith('INSERT INTO sh_opportunites'))return {rows:[{id:1,devise:args[3]}]};
      return {rows:[]};
    };
    require('../src/sh/commercial').brancher(api,{query,connect:async()=>({query,release(){}})},fn=>fn,async()=>{});
    const r=await routes.get('post /crm/opportunites')({u:{id:1},body:{organisation_id:2,titre:'Pilote international',devise:choix}});
    assert.equal(r.devise,attendue);
  }
});
test('formulaires CRM réels : pays proposés, devise automatique et choix international conservé à l’envoi',async()=>{
  const orgs=[{id:1,nom:'Client Canada',pays_code:'CA'},{id:2,nom:'Client Togo',pays_code:'TG'}];
  const elements=new Map(),boutons=new Map(),envois=[],modales=[],erreurs=[];
  const element=s=>{if(!elements.has(s))elements.set(s,{value:''});return elements.get(s);};
  for(const nom of ['org-nouvelle','opp-nouvelle'])boutons.set(`[data-action="${nom}"]`,{dataset:{}});
  element('#p-org').value='2';
  const contexte={Intl,L:'en-CA',window:{},document:{documentElement:{lang:'en-CA'},querySelector:element},$:element,
    etat:{moi:{utilisateur:{id:1,role:'administration'}}},esc:x=>String(x??''),traduireTexte:x=>x,setInterval:()=>{},pl:(s,v)=>String(v.n),champ:()=>'',
    toast:(s,e)=>{if(e)erreurs.push(s);},afficher:async()=>{},modale:(titre,html,actions)=>modales.push({titre,html,actions}),
    api:async(m,p,b)=>{
      if(m==='POST'){envois.push({p,b});return {id:3};}
      if(p==='/crm/organisations')return orgs;if(p==='/references/internationales')return international.references('en');return [];
    }};
  vm.createContext(contexte);vm.runInContext(fs.readFileSync(require.resolve('../public-sh/erp.js'),'utf8'),contexte);
  await contexte.vueCRM({innerHTML:'',querySelectorAll:s=>boutons.has(s)?[boutons.get(s)]:[]});
  await boutons.get('[data-action="org-nouvelle"]').onclick();
  assert.match(modales.at(-1).html,/<option value="TG">Togo \(TG\)<\/option>/);
  await boutons.get('[data-action="opp-nouvelle"]').onclick();
  assert.equal(element('#p-devise').value,'XOF');
  element('#p-org').value='1';element('#p-org').onchange();assert.equal(element('#p-devise').value,'CAD');
  element('#p-devise').value='EUR';await modales.at(-1).actions.find(a=>a.pri).run();
  assert.equal(envois.at(-1).b.devise,'EUR');assert.deepEqual(erreurs,[]);
});
