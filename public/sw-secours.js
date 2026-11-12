/* Arrimo Secours : seule l'enveloppe de la page est gardée pour démarrer sans réseau. Jamais les réponses de l'API. */
const CACHE = 'arrimo-secours-1';
const COQUILLE = ['/secours', '/secours.js', '/style.css', '/apparence.js', '/logo.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(COQUILLE))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x.startsWith('arrimo-secours') && x !== CACHE).map((x) => caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !COQUILLE.includes(u.pathname)) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(u.pathname)));
});
