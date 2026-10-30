'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {lignesPropres,totaux,verifierMontantDevise}=require('../src/sh/montants');
test('CAD : calcul en cents conservé, taxes de fixture arrondies séparément',()=>{
  const lignes=lignesPropres([{description:'Prestation fictive',prix_unitaire:19.99,quantite:3}],new Map(),'CAD');
  const r=totaux(lignes,[{code:'TEST-A',nom:'Taxe fictive A',taux:5},{code:'TEST-B',nom:'Taxe fictive B',taux:9.975}],'CAD');
  assert.equal(r.sous_total,59.97);assert.deepEqual(r.taxes.map(t=>t.montant),[3,5.98]);assert.equal(r.total,68.95);
});
test('XOF et GNF : arrondi dans l’unité de la monnaie, sans cents inventés',()=>{
  for(const devise of ['XOF','GNF']){
    const lignes=lignesPropres([{description:'Prestation fictive',prix_unitaire:101,quantite:0.5}],new Map(),devise);
    assert.equal(lignes[0].montant,51);
    const r=totaux(lignes,[{code:'TEST',nom:'Taxe fictive',taux:5}],devise);
    assert.equal(r.sous_total,51);assert.equal(r.taxes[0].montant,3);assert.equal(r.total,54);
    assert.throws(()=>verifierMontantDevise(10.5,devise),{statut:400});
  }
});
test('paiements et prix : refuser une précision perdue ou un dépassement numérique',()=>{
  assert.equal(verifierMontantDevise(12.34,'CAD'),1234);
  assert.throws(()=>verifierMontantDevise(12.345,'CAD'),{statut:400});
  for(const montant of [0.0000001,1.000000001])assert.throws(()=>verifierMontantDevise(montant,'XOF'),{statut:400});
  assert.throws(()=>verifierMontantDevise(1.23000001,'CAD'),{statut:400});
  assert.throws(()=>verifierMontantDevise(1e12,'CAD'),{statut:400});
  assert.throws(()=>verifierMontantDevise(1e12,'XOF'),{statut:400});
  assert.throws(()=>lignesPropres([{description:'Prix incorrect',prix_unitaire:12.3}],new Map(),'XOF'),{statut:400});
  assert.throws(()=>lignesPropres([{description:'Dépassement',prix_unitaire:1e9,quantite:1e5}],new Map(),'CAD'),{statut:400});
});
test('devises à trois décimales : refus explicite tant que le stockage reste à deux décimales',()=>{
  assert.throws(()=>lignesPropres([{description:'Prestation',prix_unitaire:1}],new Map(),'KWD'),{statut:400});
  assert.throws(()=>lignesPropres([{description:'Prestation',prix_unitaire:1}],new Map(),'MGA'),{statut:400});
  assert.equal(verifierMontantDevise(1.25,'COP'),125);
});
test('devis existant : le PDF réutilise les lignes et totaux stockés sans recalculer les arrondis',async()=>{
  const d={lignes:[{description:'Historique',montant:51}],sous_total:'51',taxes:[],total:'51',devise:'XOF'};
  const r=await require('../src/sh/commercial').montantsDevis({query:()=>{throw new Error('Aucune relecture fiscale attendue');}},d);
  assert.deepEqual(r,{lignes:d.lignes,sous_total:51,taxes:[],total:51});
});
