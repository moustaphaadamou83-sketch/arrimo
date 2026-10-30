'use strict';
// Diagnostic métier en lecture seule ; aucune session fabriquée, aucun serveur exposé.
const assert = require('node:assert/strict');
const path = require('node:path');
const code = process.argv[2];
const {Pool} = require(path.join(code, 'node_modules/pg'));
const db = new Pool({connectionString:'postgresql://postgres@127.0.0.1/arrimo_publication_restore_og_demo_5ce372fe?host=/var/run/postgresql', options:'-c default_transaction_read_only=on'});
(async () => {
  assert.equal((await db.query('SELECT current_database() AS nom')).rows[0].nom,'arrimo_publication_restore_og_demo_5ce372fe');
  const og = require(path.join(code,'src/og-outils'));
  const resultats=[];
  for (const [nom,codeE] of [['a','HX'],['b','HY'],['c','HC'],['d','HPED']]) {
    const u=(await db.query("SELECT u.id,u.role,array_agg(ue.etablissement_id) AS etabs FROM utilisateurs u JOIN utilisateur_etablissements ue ON ue.utilisateur_id=u.id WHERE u.actif AND u.email=$1 GROUP BY u.id",[`hopital.${nom}@demo.arrimo`])).rows[0];
    assert.ok(u); assert.equal(u.etabs.length,1); assert.notEqual(u.role,'gestionnaire');
    const e=(await db.query('SELECT id FROM etablissements WHERE code=$1',[codeE])).rows[0];
    assert.deepEqual(u.etabs,[e.id]);
    const temoin=(await db.query("SELECT patient_ref,code FROM lits WHERE etablissement_id=$1 AND etat='occupe' AND patient_ref IS NOT NULL ORDER BY (patient_ref='P-01004') DESC,id LIMIT 1",[e.id])).rows[0];
    const r=await og.repondre(db,u,e.id,`Quel est le statut actuel du patient ${temoin?.patient_ref || 'P-01004'} ?`);
    if (temoin) {assert.ok(r.reponse.includes(temoin.code));assert.match(r.reponse,/admis/);}
    else assert.match(r.reponse,/Aucune situation active accessible|Aucun lit occupé ou réservé enregistré ici|lit réservé, admission à confirmer/);
    const n=(await db.query("SELECT count(*)::int AS n FROM lits WHERE etablissement_id=$1 AND etat='occupe'",[e.id])).rows[0].n;
    const occupation=await og.repondre(db,u,e.id,'Combien de lits sont occupés ?');
    assert.ok(occupation.reponse.includes(`: ${n}.`));
    const autre=(await db.query('SELECT id FROM etablissements WHERE id<>$1 AND actif LIMIT 1',[e.id])).rows[0];
    await assert.rejects(og.repondre(db,u,autre.id,'Quel est le statut actuel du patient P-01004 ?'),{statut:403});
    resultats.push({compte:nom,etablissement:codeE,patient_compare_sql:true,occupation_comparee_sql:true,isolation:true,ancienne_precondition_patient_occupe:Boolean(temoin)});
  }
  console.log(JSON.stringify({lecture_seule:true,diagnostic_copie:resultats},null,2));
})().catch(e=>{console.error('DIAGNOSTIC_ECHEC '+(e.code||e.name));process.exitCode=1;}).finally(()=>db.end());
