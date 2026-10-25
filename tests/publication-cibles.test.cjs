const test=require('node:test');
const assert=require('node:assert/strict');
const { verifierCible,copie }=require('../scripts/publication/controle.cjs');
test('worker accepte uniquement le nom PostgreSQL exact et local',()=>{
  verifierCible('postgresql://app@localhost/arrimo?host=/var/run/postgresql','arrimo');
  assert.throws(()=>verifierCible('postgresql://app@localhost/arrimo','autre'));
});
test('worker refuse un hôte distant dans URL ou paramètres',()=>{
  for(const u of ['postgresql://db.example/arrimo','postgresql:///arrimo?host=db.example'])assert.throws(()=>verifierCible(u,'arrimo'));
});
test('worker refuse les options et paramètres PostgreSQL dupliqués',()=>{
  for(const q of ['host=localhost&host=db.example','sslmode=require&sslmode=disable','options=-csearch_path%3Dautre','dbname=autre'])assert.throws(()=>verifierCible('postgresql:///arrimo?'+q,'arrimo'));
});
test('worker refuse les noms publics comme copies de restauration',()=>{
  assert.equal(copie('arrimo_publication_restore_demo_abc'),true);
  for(const nom of ['arrimo','arrimo_demo_trio','arrimo_publication_restore_../arrimo','arrimo_publication_restore_'])assert.equal(copie(nom),false);
});
