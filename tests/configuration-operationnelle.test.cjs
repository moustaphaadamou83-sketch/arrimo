const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/configuration-operationnelle');
const { autoriser, ROLES_SH } = require('../src/sh/permissions');
const modules = { urgence: true, nsa: false, nettoyage: true, national: false };
const valide = { modules, vocation: 'pediatrique' };

test('configuration : conserver les données inconnues et ne changer que les quatre modules', () => {
  const avant = { nsa: false, national: false, personnalise: { parametre: 5 } };
  assert.deepEqual(c.fusionner(avant, { ...modules, nsa: true }), { national: false, personnalise: { parametre: 5 } });
  assert.equal(avant.nsa, false);
});
test('version de configuration indépendante de l’ordre des propriétés', () => {
  assert.equal(c.empreinte({ modules: { nsa: false, urgence: false }, vocation: 'general' }), c.empreinte({ vocation: 'general', modules: { urgence: false, nsa: false } }));
  assert.notEqual(c.empreinte({ modules: {}, vocation: 'general' }), c.empreinte({ modules: {}, vocation: 'pediatrique' }));
});
test('configuration valide : aucune interprétation clinique', () => assert.deepEqual(c.normaliser(valide), valide));
for (const [nom, b] of Object.entries({
  nul: null, incomplet: { modules: { nsa: false }, vocation: 'general' }, tableau: { ...valide, modules: [] },
  texte: { ...valide, modules: { ...modules, nsa: 'false' } }, inconnu: { ...valide, modules: { ...modules, nouveau: true } },
  vocation: { ...valide, vocation: 'inconnue' }, occupations: { ...valide, lits: [] }, patient: { ...valide, patient_ref: 'P-00001' },
  habilitations: { ...valide, priorites: [] },
})) test(`synchronisation interdite : ${nom}`, () => assert.throws(() => c.normaliser(b), { statut: 400 }));

test('SH : seuls les administrateurs publient ; implantation en lecture ; autres rôles refusés', () => {
  for (const role of ROLES_SH) {
    assert.equal(autoriser({ role }, { method: 'GET', path: '/hopitaux/4/configuration-operationnelle' }), ['administration', 'implantation'].includes(role));
    assert.equal(autoriser({ role }, { method: 'PUT', path: '/hopitaux/4/configuration-operationnelle' }), role === 'administration');
    assert.equal(autoriser({ role }, { method: 'POST', path: '/hopitaux/4/specialites' }), role === 'administration');
  }
});

function apiSimulee({ manqueCle = false, panneJournal = false } = {}) {
  const routes = new Map(); const requetes = [];
  const api = Object.fromEntries(['get', 'put', 'post'].map((m) => [m, (chemin, fn) => routes.set(`${m} ${chemin}`, fn)]));
  const etat = { modules: { national: false, personnalise: false }, vocation: 'general', config_id: 1 };
  const query = async (sql, args) => {
    requetes.push({ sql, args });
    if (sql.startsWith('SELECT id, code, nom, partage')) return { rows: [{ id: 4, code: 'A', nom: 'Hôpital A fictif' }] };
    if (sql.startsWith('SELECT modules')) return { rows: [etat] };
    if (sql.includes('FROM specialites_catalogue')) return { rows: [{ code: 'PED', nom: 'Pédiatrie fictive', groupe_age: 'pediatrique' }] };
    if (sql.includes('FROM types_unite')) return { rows: [] };
    if (sql.startsWith('UPDATE etablissements')) return { rows: [{ modules: args[1], vocation: args[2] }] };
    if (sql.startsWith('INSERT INTO journal_admin') && panneJournal) throw new Error('Journal indisponible');
    return { rows: [] };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  require('../src/sh-api').brancherSh(api, pool, (fn) => fn);
  const req = { params: { code: 'A' }, get: () => manqueCle ? 'incorrecte' : process.env.SH_API_KEY };
  return { routes, requetes, req, etat };
}
test('API SH : clé de service exigée avant lecture de configuration', async () => {
  const avant = process.env.SH_API_KEY; process.env.SH_API_KEY = 'cle-fictive-de-test';
  try {
    const b = apiSimulee({ manqueCle: true });
    await assert.rejects(b.routes.get('get /sh/etablissements/:code/configuration-operationnelle')(b.req), { statut: 401 });
    assert.equal(b.requetes.length, 0);
  } finally { if (avant === undefined) delete process.env.SH_API_KEY; else process.env.SH_API_KEY = avant; }
});
test('API SH : aucune donnée de parcours dans la lecture du référentiel', async () => {
  const avant = process.env.SH_API_KEY; process.env.SH_API_KEY = 'cle-fictive-de-test';
  try {
    const b = apiSimulee(); const r = await b.routes.get('get /sh/etablissements/:code/configuration-operationnelle')(b.req);
    assert.deepEqual(Object.keys(r).sort(), ['catalogue', 'modules', 'modules_modifiables', 'referentiel_priorites', 'specialites', 'type_etablissement', 'version', 'vocation']);
    assert.equal(r.catalogue[0].code, 'PED'); assert.ok(!JSON.stringify(r).includes('patient'));
  } finally { if (avant === undefined) delete process.env.SH_API_KEY; else process.env.SH_API_KEY = avant; }
});
test('API SH : version périmée refusée sous verrou sans écrire', async () => {
  const avant = process.env.SH_API_KEY; process.env.SH_API_KEY = 'cle-fictive-de-test';
  try {
    const b = apiSimulee(); b.req.body = { ...valide, version: 'perimee' };
    await assert.rejects(b.routes.get('put /sh/etablissements/:code/configuration-operationnelle')(b.req), { statut: 409 });
    assert.ok(b.requetes.some((q) => q.sql.includes('FOR UPDATE')));
    assert.ok(!b.requetes.some((q) => q.sql.startsWith('UPDATE')));
    assert.ok(b.requetes.some((q) => q.sql === 'ROLLBACK'));
  } finally { if (avant === undefined) delete process.env.SH_API_KEY; else process.env.SH_API_KEY = avant; }
});
test('API SH : publication limitée aux paramètres et journal dans la même transaction', async () => {
  const avant = process.env.SH_API_KEY; process.env.SH_API_KEY = 'cle-fictive-de-test';
  try {
    const b = apiSimulee(); b.req.body = { ...valide, version: c.empreinte(b.etat), par: 'administration-fictive' };
    const r = await b.routes.get('put /sh/etablissements/:code/configuration-operationnelle')(b.req);
    assert.equal(r.vocation, 'pediatrique'); assert.equal(r.modules.personnalise, false);
    assert.deepEqual(b.requetes.filter((q) => q.sql.startsWith('UPDATE')).map((q) => q.sql.split(' ')[1]), ['etablissements']);
    const journal = b.requetes.findIndex((q) => q.sql.startsWith('INSERT INTO journal_admin'));
    assert.ok(journal < b.requetes.findIndex((q) => q.sql === 'COMMIT'));
  } finally { if (avant === undefined) delete process.env.SH_API_KEY; else process.env.SH_API_KEY = avant; }
});
test('API SH : panne du journal annule la configuration', async () => {
  const avant = process.env.SH_API_KEY; process.env.SH_API_KEY = 'cle-fictive-de-test';
  try {
    const b = apiSimulee({ panneJournal: true }); b.req.body = { ...valide, version: c.empreinte(b.etat) };
    await assert.rejects(b.routes.get('put /sh/etablissements/:code/configuration-operationnelle')(b.req), /Journal indisponible/);
    assert.ok(b.requetes.some((q) => q.sql === 'ROLLBACK')); assert.ok(!b.requetes.some((q) => q.sql === 'COMMIT'));
  } finally { if (avant === undefined) delete process.env.SH_API_KEY; else process.env.SH_API_KEY = avant; }
});
