const routage = require('../src/routage');

function metres(a, b) {
  const rad = (x) => x * Math.PI / 180;
  const dl = rad(b[1] - a[1]); const dn = rad(b[0] - a[0]);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dn / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 1200);
}
function reponse(url) {
  const p = new URL(url).pathname;
  const table = p.match(/^\/table\/v1\/[^/]+\/(.+)$/);
  const route = p.match(/^\/route\/v1\/[^/]+\/(.+)$/);
  if (table) {
    const pts = table[1].split(';').map((x) => x.split(',').map(Number));
    const ds = pts.slice(1).map((x) => metres(pts[0], x));
    return { ok: true, json: async () => ({ code: 'Ok', distances: [ds], durations: [ds.map((d) => Math.max(60, d / 1000 * 60))] }) };
  }
  if (route) {
    const pts = route[1].split(';').map((x) => x.split(',').map(Number)); const d = metres(pts[0], pts[1]);
    return { ok: true, json: async () => ({ code: 'Ok', routes: [{ distance: d, duration: Math.max(60, d / 1000 * 60),
      geometry: { type: 'LineString', coordinates: pts } }] }) };
  }
  return { ok: false, json: async () => ({ code: 'NotFound' }) };
}

function activer() {
  const before = { url: process.env.ARRIMO_ROUTEUR_URL, name: process.env.ARRIMO_ROUTEUR_NOM };
  process.env.ARRIMO_ROUTEUR_URL = 'http://routeur-fictif.test';
  process.env.ARRIMO_ROUTEUR_NOM = 'routeur de test fictif';
  routage.definirFetchTest(async (url) => reponse(url));
  return () => {
    routage.definirFetchTest(null);
    if (before.url === undefined) delete process.env.ARRIMO_ROUTEUR_URL; else process.env.ARRIMO_ROUTEUR_URL = before.url;
    if (before.name === undefined) delete process.env.ARRIMO_ROUTEUR_NOM; else process.env.ARRIMO_ROUTEUR_NOM = before.name;
  };
}

module.exports = { activer };
