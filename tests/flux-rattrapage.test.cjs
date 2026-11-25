'use strict';
/** Refonte unifiée (26 nov. 2026) : synchronisation avec rattrapage — numéro de séquence, Last-Event-ID, serveur redémarré, état du flux. */
const test = require('node:test');
const assert = require('node:assert');
const flux = require('../src/flux');

test('rattrapage : en retard si un signal a été manqué ou si l’instance a changé ; à jour sinon', async () => {
  const e0 = flux.etat();
  const recu = new Promise((ok) => flux.bus.once('secours', ok));
  flux.signaler(); flux.signaler();   // regroupés en un seul signal
  const s = await recu;
  assert.match(s.id, /^\d+-\d+$/); assert.ok(s.t <= Date.now());
  const e1 = flux.etat();
  assert.strictEqual(e1.sequence, e0.sequence + 1, 'deux signaux rapprochés : un seul envoi');
  assert.strictEqual(flux.enRetard(s.id), false, 'à jour');
  assert.strictEqual(flux.enRetard(`${e1.instance}-${e1.sequence - 1}`), true, 'un signal manqué');
  assert.strictEqual(flux.enRetard('123-999'), true, 'serveur redémarré : relecture');
  assert.strictEqual(flux.enRetard(null), false, 'première connexion : rien à rattraper');
  assert.ok(e1.regroupement_ms.p50 >= 250 && e1.regroupement_ms.p50 < 2000, 'délai de regroupement mesuré');
});

test('flux SSE : identifiant envoyé, rattrapage immédiat à la reconnexion', async () => {
  const sorties = []; const res = { writeHead() {}, write: (x) => sorties.push(x), on() {} };
  const e = flux.etat();
  const req = { utilisateur: { role: 'coordonnateur' }, get: (h) => (h === 'last-event-id' ? `${e.instance}-0` : undefined), on() {} };
  flux.brancher(req, res);
  assert.ok(sorties.some((x) => /^id: \d+-\d+\nevent: secours\ndata: \{"t":\d+,"rattrapage":true\}/.test(x)), sorties.join('|'));
  const recu = new Promise((ok) => flux.bus.once('secours', ok)); flux.signaler(); await recu; await new Promise((ok) => setImmediate(ok));
  assert.ok(sorties.some((x) => /^id: \d+-\d+\nevent: secours\ndata: \{"t":\d+\}\n\n$/.test(x)), 'signal suivant avec identifiant');
});
