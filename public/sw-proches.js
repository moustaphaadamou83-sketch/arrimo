/* Portail des proches : seule l'enveloppe de la page est gardée pour un affichage hors ligne. Jamais les réponses de l'API. */
const CACHE = 'arrimo-famille-1';
const COQUILLE = ['/proches', '/proches.js', '/style.css', '/apparence.js', '/logo.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(COQUILLE))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !COQUILLE.includes(u.pathname)) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(u.pathname)));
});
