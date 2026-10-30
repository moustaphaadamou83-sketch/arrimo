'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const recherche=require('../src/og-recherche-patients');
const copilote=require('../src/copilote');
const suivi=require('../src/og-suivi');

test('détection d’intention : variations vocales FR/EN et exclusion des lits/transferts',()=>{
  const cas=[
    ['OG, peux-tu me retrouver Jean Dupont ?','jean dupont'],
    ['Je cherche le patient Jean Dupont','jean dupont'],
    ['Pourriez-vous ouvrir le dossier de Jean Dupont ?','jean dupont'],
    ["Could you pull up the record for John Smith's file?",'john smith'],
    ['Get me the patient called John Smith','john smith'],
    ['Donne-moi le dossier de Jean Dupont','jean dupont'],
    ['Could you look for Jean Dupont?','jean dupont'],
    ['Search by name John Smith','john smith'],
    ['Identify John Smith','john smith'],
    ['Find patient with ID P-10021','p-10021'],
    ['Montre-moi Jean Dupont','jean dupont'],
  ];
  for(const [question,attendu] of cas)assert.equal(recherche.extraireRecherche(question),attendu,question);
  for(const question of ['Find a bed in intensive care','Find transfer TR-00067','Open admissions','Find room 204','Affiche son dossier','Open the file'])
    assert.equal(recherche.extraireRecherche(question),null,question);
});

test('moteur OG : recherche patient par conversation, cartes de correspondance et langues FR/EN',async()=>{
  const precedent=recherche.rechercher,appels=[];
  recherche.rechercher=async(_db,u,id,q)=>{appels.push({langue:u.langue,id,q});return {resultats:[{id:21,reference:'P-10021',prenom:'Jean',nom:'Dupont'}],limite:false};};
  // Démo sans licence SH transmise : la fonction « patients » est ouverte par défaut (aucune ligne og_configurations).
  const envAvant=process.env.ARRIMO_ENV;process.env.ARRIMO_ENV='demo';const pool={query:async()=>({rows:[]})};
  try{
    const fr=await copilote.question(pool, {id:1,etabs:[7],langue:'fr'},7,'OG, cherche Jean Dupont');
    assert.equal(fr.patients[0].id,21);assert.match(fr.reponse,/Correspondance proposée/);
    const en=await copilote.question(pool, {id:1,etabs:[7],langue:'en'},7,'OG, find Jean Dupont');
    assert.equal(en.patients[0].reference,'P-10021');assert.match(en.reponse,/Possible match/);
    assert.deepEqual(appels.map(x=>x.langue),['fr','en']);
    assert.ok(appels.every(x=>x.id===7&&/jean dupont/i.test(x.q)));
  }finally{recherche.rechercher=precedent;if(envAvant===undefined)delete process.env.ARRIMO_ENV;else process.env.ARRIMO_ENV=envAvant;}
});

test('contexte patient : chaque question de suivi redevient un identifiant interne vérifié côté OG',async()=>{
  const precedent=suivi.repondreSuivi,appels=[];
  suivi.repondreSuivi=async(_db,u,id,q)=>{appels.push({id,u:u.etabs,question:q});return {mode:'local',reponse:'Verified status.'};};
  try{
    const r=await copilote.question({}, {id:9,etabs:[7],langue:'en'},7,'Where is he now?',undefined,21);
    assert.match(r.reponse,/Verified status/);assert.equal(appels[0].id,7);assert.deepEqual(appels[0].u,[7]);
    assert.match(appels[0].question,/patient interne 21/i);
    assert.equal(recherche.estQuestionSuivi('show me his file'),true);
    assert.equal(recherche.estQuestionSuivi('Depuis quand est-il admis ?'),true);
    assert.equal(recherche.estQuestionSuivi('Since when was she admitted?'),true);
    assert.equal(recherche.estQuestionSuivi('what beds are free?'),false);
    const clarification=await copilote.question({}, {id:9,etabs:[7],langue:'en'},7,'Where is he now?');
    assert.match(clarification.reponse,/Select a patient record first/);
    assert.equal(recherche.estQuestionSuivi('What is the current hospital status?'),false);
  }finally{suivi.repondreSuivi=precedent;}
});
