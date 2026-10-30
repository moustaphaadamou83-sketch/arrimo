// Recette réelle exclusivement sur une base NEUVE dédiée ; jamais une copie métier.
const test = require('node:test');
const assert = require('node:assert/strict');
const { creerPool } = require('../src/db');
const { demarrerServeur } = require('./serveur-test.cjs');
test('OG : sept scénarios contrôlés avec PostgreSQL réel et comptes A/B/C et coordination régionale', {timeout:180000}, async t => {
  const url = new URL(process.env.OG_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
  assert.match(url.pathname, /^\/arrimo_og_test_[a-f0-9]+$/);
  const pool = creerPool(url.href); t.after(() => pool.end());
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
  process.env.ARRIMO_ENV='demo'; process.env.ARRIMO_DEMO='1'; process.env.DEMO_MOT_DE_PASSE='Fixture-OG-2026';
  delete process.env.COPILOTE_IA_CLE;
  const restaurer = require('./routeur-fictif.cjs').activer(); t.after(restaurer);
  await require('../db/demo-trio').preparerDemoTrio(pool, {silencieux:true});
  // Mise en situation fictive maîtrisée, uniquement sur la base neuve vérifiée ci-dessus.
  const lit = (await pool.query("SELECT l.id,l.etablissement_id FROM lits l JOIN etablissements e ON e.id=l.etablissement_id WHERE e.code='HC' AND l.code='MED-204B'")).rows[0];
  assert.ok(lit, 'Fixture MED-204B attendue');
  await pool.query("UPDATE lits SET patient_ref='P-01004',etat='occupe' WHERE id=$1", [lit.id]);
  const serveur = await demarrerServeur(require('../src/app').creerApp(pool)); t.after(() => new Promise(r => serveur.close(r)));
  const base = 'http://127.0.0.1:'+serveur.address().port;
  const comptes = [];
  for (const [nom,code] of [['a','HX'],['b','HY'],['c','HC'],['reseau','HX']]) {
    const r = await fetch(base+'/api/connexion', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:nom==='reseau'?'reseau@demo.arrimo':`hopital.${nom}@demo.arrimo`,mot_de_passe:process.env.DEMO_MOT_DE_PASSE})});
    assert.equal(r.status,200); const j=await r.json(); assert.ok(j.token);
    comptes.push({nom,code,token:j.token});
  }
  for (const c of comptes) {
    const id=(await pool.query('SELECT id FROM etablissements WHERE code=$1',[c.code])).rows[0].id;
    const q=async question=>{const r=await fetch(base+'/api/copilote/question',{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify({etablissement_id:id,question})});assert.equal(r.status,200);return r.json();};
    const r = await q('Combien de lits de médecine sont occupés ?'); assert.ok(r.intentions.includes('lits_occupes'));
    assert.equal((await q('Quelle est la prochaine étape après l’organisation d’un transport ?')).intentions[0],'procedure');
    assert.equal((await q('Quels transferts sont actuellement en cours ?')).intentions[0],'transferts');
    if (c.nom==='c') {
      const p=await q('Quel est le statut actuel du patient P-01004 ?'); assert.match(p.reponse,/admis ; lit MED-204B/); assert.match(p.reponse,/Hôpital C/);
      assert.equal((await q('Pourquoi MED-204B a-t-il été proposé ?')).intentions[0],'attribution_locale');
      assert.match((await q('Quelles civières sont occupées depuis plus de quatre heures ?')).reponse,/ne mesure pas la gravité/);
    } else {
      const r=await fetch(base+'/api/copilote/question',{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify({etablissement_id:lit.etablissement_id,question:'Quel est le statut du patient P-01004 ?'})}); assert.equal(r.status,c.nom==='reseau'?200:403);
    }
  }
  await require('../scripts/og-publication/verifier.cjs').verifier({
    code: require('node:path').resolve(__dirname, '..'), url: url.href,
    nom: url.pathname.slice(1), copie: true, comptes
  });
  // Une Démo valide peut ne plus avoir de patient admis dans C.
  // Ce changement concerne exclusivement cette fixture neuve.
  await pool.query("UPDATE lits SET etat='libre',patient_ref=NULL WHERE etablissement_id=$1", [lit.etablissement_id]);
  await require('../scripts/og-publication/verifier.cjs').verifier({
    code: require('node:path').resolve(__dirname, '..'), url: url.href,
    nom: url.pathname.slice(1), copie: true, comptes
  });
});
