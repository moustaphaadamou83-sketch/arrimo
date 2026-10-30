(function(root){
  const d=typeof module!=='undefined'&&module.exports?{...require('./en').en,...require('./en-lot1')}:root.ARRIMO_SH_I18N.en;
  const echapper=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const modeles=Object.entries(d).filter(([k])=>/\{\w+\}/.test(k)).map(([fr,en])=>{
    const noms=[...fr.matchAll(/\{(\w+)\}/g)].map(x=>x[1]);
    return {regex:new RegExp('^'+fr.split(/\{\w+\}/).map(echapper).join('([\\s\\S]*?)')+'$'),noms,en};
  });
  function traduire(texte,langue){
    const brut=String(texte??'');if(langue!=='en')return brut;
    const s=brut.trim();let r=d[s];
    if(!r)for(const m of modeles){const x=m.regex.exec(s);if(x){r=m.en.replace(/\{(\w+)\}/g,(_,k)=>x[m.noms.indexOf(k)+1]);break;}}
    return r?brut.slice(0,brut.indexOf(s))+r+brut.slice(brut.indexOf(s)+s.length):brut;
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={traduire,dictionnaire:d};
  else root.ArrimoShLocalisation={traduire};
})(typeof window==='undefined'?globalThis:window);
