'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {guider}=require('../src/og-guide');
test('guide OG : étapes et écran à ouvrir, FR/EN, modules désactivés respectés, références laissées au suivi',()=>{
  const t=guider('Comment créer une demande de transfert ?','fr',{});assert.equal(t.ouvrir,'transferts');assert.match(t.reponse,/^1\. /);
  assert.equal(guider('How do I update a bed status?','en',{}).ouvrir,'lits');
  assert.equal(guider('Où trouver les lits bloqués ?','fr',{}).ouvrir,'lits');
  const off=guider('Explique-moi le processus de nettoyage','fr',{nettoyage:false});assert.equal(off.ouvrir,undefined);assert.match(off.reponse,/pas activé/);
  assert.equal(guider('Où est le transfert TR-00067 ?','fr',{}),null);
  assert.equal(guider('Combien de lits libres ?','fr',{}),null);
});
