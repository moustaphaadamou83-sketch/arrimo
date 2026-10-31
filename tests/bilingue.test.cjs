'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {langueDemandee}=require('../src/og-localisation');
const {traduire}=require('../public-sh/i18n/localisation');
test('Arrimo : chaque clé française dispose d’une traduction anglaise avec les mêmes variables',()=>{
  const c={window:{}};vm.createContext(c);for(const l of ['fr','en'])vm.runInContext(fs.readFileSync(require.resolve('../public/i18n/'+l+'.js'),'utf8'),c);
  function flat(d,p='',o={}){for(const[k,v]of Object.entries(d)){const x=p?p+'.'+k:k;if(typeof v==='string')o[x]=v;else if(v&&typeof v==='object')flat(v,x,o)}return o;}
  const fr=flat(c.window.ARRIMO_I18N.fr),en=flat(c.window.ARRIMO_I18N.en);
  const vars=s=>[...new Set([...s.matchAll(/\{(\w+)(?=[}|])/g)].map(m=>m[1]))].sort();
  assert.ok(Object.keys(fr).length>1000);
  for(const k of Object.keys(fr)){assert.ok(k in en,'Traduction absente : '+k);assert.deepEqual(vars(fr[k]),vars(en[k]),'Variables différentes : '+k);}
});
test('OG : réponse dans la langue de la question (cahier 31 oct.), demande explicite prioritaire, préférence si ambiguë',()=>{
  assert.equal(langueDemandee('Where is P-43267?','fr'),'en');assert.equal(langueDemandee('Où est P-43267 ?','en'),'fr');
  assert.equal(langueDemandee('P-43267','fr'),'fr');assert.equal(langueDemandee('P-43267','en'),'en');
  assert.equal(langueDemandee('Réponds en anglais : où se trouve P-43267 ?','fr'),'en');
  assert.equal(langueDemandee('Answer in French: where is P-43267?','en'),'fr');
});
test('SH : messages statiques, notifications et valeurs utilisateurs conservées',()=>{
  assert.equal(traduire('Session expirée. Reconnectez-vous.','en'),'Session expired. Sign in again.');
  assert.equal(traduire('Tâche attribuée : Projet Québec P-43267','en'),'Task assigned: Projet Québec P-43267');
  assert.equal(traduire('2 tâches en retard','en'),'2 overdue tasks');
  assert.equal(traduire('  Paramètres  ','en'),'  Settings  ');
  assert.equal(traduire('Texte libre non traduit','en'),'Texte libre non traduit');
});
test('SH : rôles et périmètres traduits sans modifier les noms des membres',()=>{
  assert.equal(traduire('Périmètres · Équipe Québec','en'),'Scopes · Équipe Québec');
  assert.equal(traduire('Périmètres · Équipe Québec','fr'),'Périmètres · Équipe Québec');
  assert.equal(traduire('Global explicite','en'),'Explicit global access');
  assert.equal(traduire('Code pays ISO','en'),'ISO country code');
  for(const texte of [
    'Les permissions sont vérifiées par les API ; les périmètres sont appliqués dans PostgreSQL. Les comptes internes restent administrés uniquement par l’administration.',
    'Sans affectation, les données métier ne sont pas accessibles. Une affectation à un projet ne donne pas accès aux autres projets du même hôpital.',
    'Autorise tous les périmètres métier dans les limites des permissions du rôle. Cette autorisation est journalisée.',
    'Rôle enregistré. Les sessions des personnes concernées sont révoquées.',
    'Rôle attribué ; sessions révoquées.'
  ])assert.notEqual(traduire(texte,'en'),texte,texte);
});
test('PDF commercial : véritable génération avec libellés anglais et contenu client préservé',async()=>{
  const PDFDocument=require('pdfkit'),original=PDFDocument.prototype.text,textes=[];
  PDFDocument.prototype.text=function(texte,...args){textes.push(String(texte));return original.call(this,texte,...args);};
  try{
    const pdf=await require('../src/sh/pdf-erp').documentCommercial({titre:'Facture',reference:'TEST-EN',client:{nom:'Client Québec'},devise:'CAD',champs:[['Échéance','October 28, 2026']],lignes:[{description:'Texte contractuel original',periodicite:'mensuel',quantite:1,prix_unitaire:10,montant:10}],totaux:{sous_total:10,taxes:[],total:10},mentions:['Aucune donnée de patient.']},{SH_DOCUMENT_LANGUE:'en'});
    assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(textes.includes('Invoice'));assert.ok(textes.includes('ISSUER'));assert.ok(textes.includes('Subtotal'));assert.ok(textes.includes('Client Québec'));assert.ok(textes.includes('Texte contractuel original'));assert.ok(textes.includes('per month'));assert.ok(!textes.includes('ÉMETTEUR'));
  }finally{PDFDocument.prototype.text=original;}
});
