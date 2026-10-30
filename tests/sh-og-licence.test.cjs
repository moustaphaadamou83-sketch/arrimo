'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {licenceOg,transmettre}=require('../src/sh/og-licence');

test('licence OG : rien sans souscription, texte et vocal inclus dès la souscription, autres fonctions explicites',()=>{
  const tout=(l)=>Object.entries(l).filter(([,v])=>v).map(([k])=>k).sort();
  assert.deepEqual(tout(licenceOg([])),[]);
  assert.deepEqual(tout(licenceOg([{module_code:'og',licence:'propose',parametres:{vocal:true}}])),[],'une proposition n’ouvre rien');
  assert.deepEqual(tout(licenceOg([{module_code:'og',licence:'souscrit',parametres:{}}])),['conversation','dictee','texte','vocal']);
  assert.deepEqual(tout(licenceOg([{module_code:'og',licence:'souscrit',parametres:{vocal:false,patients:'oui',documents:true,inconnue:true}}])),['conversation','dictee','documents','texte'],'booléens explicites seulement ; vocal exclu explicitement');
  assert.deepEqual(tout(licenceOg([{module_code:'og',licence:'souscrit',parametres:{texte:false,vocal:false,dictee:false,conversation:false}}])),[]);
});
test('transmission : un environnement injoignable est signalé sans faire échouer l’enregistrement SH',async()=>{
  const db={query:async()=>({rows:[{module_code:'og',licence:'souscrit',parametres:{vocal:true}}]})};
  const ok=await transmettre(db,async(c,m,chemin,corps)=>{assert.equal(m,'PUT');assert.match(chemin,/\/sh\/etablissements\/HOP-A\/og-licence$/);assert.equal(corps.licence.vocal,true);return {};},{},{id:1,code_etab:'HOP-A'},'admin@sh');
  assert.equal(ok.transmise,true);
  const rien=await transmettre({query:async()=>({rows:[{module_code:'lits',licence:'souscrit',parametres:{}}]})},async()=>{throw new Error('ne doit pas appeler');},{},{id:1,code_etab:'HOP-A'},'admin@sh');
  assert.deepEqual([rien.transmise,rien.ignoree],[false,true],'aucune décision OG : rien n’est transmis');
  const ko=await transmettre(db,async()=>{throw new Error('Environnement injoignable');},{},{id:1,code_etab:'HOP-A'},'admin@sh');
  assert.deepEqual([ko.transmise,ko.raison],[false,'Environnement injoignable']);
});
