const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ecouterServeur } = require('./serveur-test.cjs');

class ServeurDiffere extends EventEmitter {
  constructor(demarrage) { super(); this.demarrage = demarrage; this.adresse = null; this.ferme = false; }
  address() { return this.adresse; }
  listen(port, host) { this.argumentsEcoute = { port, host }; this.demarrage(this); }
  close(cb) { this.ferme = true; if (cb) cb(); }
}
test('serveur : adresse initialement nulle, résolution après listening seulement', async () => {
  const serveur = new ServeurDiffere((s) => setTimeout(() => { s.adresse = { address: '127.0.0.1', port: 43210 }; s.emit('listening'); }, 5));
  let pret = false;
  const attente = ecouterServeur(serveur).then((s) => { pret = true; return s; });
  assert.equal(serveur.address(), null); assert.equal(pret, false);
  assert.equal(await attente, serveur); assert.equal(serveur.address().port, 43210);
  assert.deepEqual(serveur.argumentsEcoute, { port: 0, host: '127.0.0.1' });
  assert.equal(serveur.listenerCount('listening'), 0); assert.equal(serveur.listenerCount('error'), 0);
});
test('serveur : erreur de port propagée intacte, sans lecture du port nul', async () => {
  const cause = Object.assign(new Error('listen EADDRINUSE 127.0.0.1:43210'), { code: 'EADDRINUSE' });
  const s = new ServeurDiffere((x) => queueMicrotask(() => x.emit('error', cause)));
  await assert.rejects(ecouterServeur(s), (e) => e === cause);
  assert.equal(s.address(), null);
});
test('serveur : exception synchrone conservée', async () => {
  const cause = Object.assign(new Error('listen EACCES'), { code: 'EACCES' });
  await assert.rejects(ecouterServeur(new ServeurDiffere(() => { throw cause; })), (e) => e === cause);
});
test('serveur : listening sans adresse fait échouer explicitement le test', async () => {
  const s = new ServeurDiffere((x) => queueMicrotask(() => x.emit('listening')));
  await assert.rejects(ecouterServeur(s), { code: 'ERR_SERVEUR_TEST_ADRESSE' }); assert.equal(s.ferme, true);
});
test('serveur : démarrage qui ne termine pas échoue et ferme son serveur', async () => {
  const s = new ServeurDiffere(() => {});
  await assert.rejects(ecouterServeur(s, { delaiMs: 5 }), { code: 'ETIMEDOUT' }); assert.equal(s.ferme, true);
});
test('serveur : aucune écoute sur une interface publique', async () => {
  const s = new ServeurDiffere(() => assert.fail('listen ne doit pas être appelé'));
  await assert.rejects(ecouterServeur(s, { host: '0.0.0.0' }), /loopback/);
});
