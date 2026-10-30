(function(root){
  'use strict';
  const unites=typeof module!=='undefined'&&module.exports?require('./devises-unites'):root.ArrimoShUnitesDevises||{};
  function formatterMontant(n,devise='CAD',locale='fr-CA'){
    const monnaie=devise||'CAD',unite=unites[monnaie];
    const precision=unite?{minimumFractionDigits:unite.exposant,maximumFractionDigits:unite.exposant}:{};
    return new Intl.NumberFormat(locale,{style:'currency',currency:monnaie,...precision}).format(Number(n||0));
  }
  // Les montants de deux devises ne sont jamais additionnés ni comparés sur une même échelle.
  function pipelineParDevise(lignes,statuts){
    const groupes=new Map();
    for(const ligne of lignes){
      if(!/^[A-Z]{3}$/.test(ligne.devise||''))throw new Error('Devise du pipeline invalide.');
      if(!groupes.has(ligne.devise))groupes.set(ligne.devise,[]);
      groupes.get(ligne.devise).push(ligne);
    }
    return [...groupes].sort(([a],[b])=>a.localeCompare(b)).map(([devise,rows])=>({devise,lignes:statuts.map(statut=>rows.find(r=>r.statut===statut)||{statut,devise,n:0,valeur:0,ponderee:0})}));
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={pipelineParDevise,formatterMontant};
  else root.ArrimoShFinances={pipelineParDevise,formatterMontant};
})(typeof window==='undefined'?globalThis:window);
