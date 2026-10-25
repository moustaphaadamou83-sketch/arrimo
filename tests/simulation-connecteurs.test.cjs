/** Contrats locaux, sans PostgreSQL : la recette SQL réelle est séparée. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');
const simulation = require('../src/simulation-connecteurs');
const { ErreurHttp } = require('../src/db');
const u = { id: 8, role: 'coordonnateur', etabs: [4] };
const con = { id: 3, etablissement_id: 4 };
const date = '2026-10-25T09:00:00.000Z';
const event = (sequence = 1, id = `MSG-${sequence}`) => ({ identifiant: id, flux: 'EPISODE-1', sequence, date_source: date,
  evenement: 'admission', confirmation: true, donnees: { demande: 'DEM-1', lit: 'LIT-1', version: 2 } });

function fixture(options = {}) {
  const requetes = []; const appels = []; const journal = [];
  let etat = { ledger: {}, flux: {}, metier: 0 }; let avant; let save;
  const correspondances = new Map([['demande:DEM-1', '44'], ['demande:DEM-2', '45'], ['lit:LIT-1', '13'], ['patient:PAT-1', 'P-80001'], ['civiere:CIV-1', '14'], ['type_unite:MED', '7'], ['etablissement:B', '9'], ['transfert:TR-1', '55']]);
  const query = async (sql, args = []) => {
    requetes.push({ sql, args });
    if (sql === 'BEGIN') avant = structuredClone(etat);
    if (sql === 'ROLLBACK') etat = avant;
    if (sql === 'SAVEPOINT simulation_metier') save = structuredClone(etat);
    if (sql === 'ROLLBACK TO SAVEPOINT simulation_metier') etat = save;
    if (sql.includes('SELECT s.connecteur_id')) return { rows: options.inactif ? [] : [{ connecteur_id: 3 }] };
    if (sql.startsWith('SELECT * FROM connecteurs_simulation_evenements')) return { rows: etat.ledger[args[1]] ? [structuredClone(etat.ledger[args[1]])] : [] };
    if (sql.startsWith('INSERT INTO connecteurs_simulation_evenements')) etat.ledger[args[1]] = { identifiant: args[1], empreinte: args[4], acteur_id: args[7], statut: 'en_attente', donnees: args[6] };
    if (sql.startsWith('INSERT INTO connecteurs_simulation_flux')) etat.flux[args[1]] ||= { derniere_sequence: 0, derniere_date_source: null };
    if (sql.startsWith('SELECT derniere_sequence')) return { rows: [etat.flux[args[1]]] };
    if (sql.startsWith('UPDATE connecteurs_simulation_flux')) etat.flux[args[1]] = { derniere_sequence: args[2], derniere_date_source: args[3] };
    if (sql.startsWith('UPDATE connecteurs_simulation_evenements SET statut')) Object.assign(etat.ledger[args[1]], { statut: args[2], detail: args[3], resultat: args[4] });
    if (sql.startsWith('SELECT valeur_locale')) return { rows: correspondances.has(`${args[1]}:${args[2]}`) ? [{ valeur_locale: correspondances.get(`${args[1]}:${args[2]}`) }] : [] };
    if (sql.startsWith('INSERT INTO connecteurs_correspondances')) {
      const k = `${args[1]}:${args[2]}`;
      if (correspondances.has(k)) return { rows: [] };
      correspondances.set(k, args[3]); return { rows: [{ valeur_locale: args[3] }] };
    }
    if (sql.startsWith('SELECT cfg.reference_regex')) return { rows: [{ reference_regex: '^P-[0-9]{5}$' }] };
    if (sql.startsWith('SELECT * FROM lits')) return { rows: [{ id: 13, etat: 'occupe', patient_ref: options.autrePatient ? 'P-99999' : 'P-80001', version: 2 }] };
    if (sql.startsWith('SELECT lit_id,statut')) return { rows: [{ lit_id: options.autreLit ? 99 : 13, statut: 'assignee' }] };
    if (sql.startsWith('SELECT version FROM lits')) return { rows: [{ version: options.versionLit || 2 }] };
    if (sql.startsWith('SELECT etat FROM')) return { rows: [{ etat: options.etat || 'nettoyage' }] };
    if (sql.startsWith('UPDATE lits SET version')) return { rows: [{ version: 3 }] };
    if (sql.startsWith('SELECT id FROM') || sql.startsWith('SELECT t.id') || sql.startsWith('SELECT d.id')) return { rows: options.horsPerimetre ? [] : [{ id: Number(args[0]) }] };
    return { rows: [] };
  };
  const client = { query, release() { requetes.push({ sql: 'RELEASE' }); } };
  const pool = { query, connect: async () => client };
  const appel = (nom) => async (...args) => {
    appels.push({ nom, args }); etat.metier += 1;
    if (options.erreur) throw options.erreur;
    return { id: nom === 'creerDemande' ? 44 : 55, statut: 'attente', version: 3 };
  };
  const terrain = Object.fromEntries(['creerDemande', 'assignerLit', 'admettreDemande', 'majConge', 'transfererDemande'].map((n) => [n, appel(n)]));
  const regles = { ACTIONS_LIT: { hors_service: 'indispo', remettre: 'libre' }, changerEtat: appel('changerEtat'), changerEtatCiviere: appel('changerEtatCiviere'),
    journaliser: async (c, ev) => { assert.equal(c, client); journal.push(ev); } };
  const fichier = path.resolve(__dirname, '../src/simulation-connecteurs.js'); const normalRequire = createRequire(fichier);
  const bac = { module: { exports: {} }, require: (nom) => ({ './terrain': terrain, './regles': regles,
    './priorites': { valider: appel('valider') }, './services': { avancerTransfert: appel('avancerTransfert') },
    './environnement': { environnement: () => options.environnement || 'recette' } }[nom] || normalRequire(nom)) };
  vm.runInNewContext(fs.readFileSync(fichier, 'utf8'), bac, { filename: fichier });
  return { api: bac.module.exports, pool, client, requetes, appels, journal, correspondances, get etat() { return etat; } };
}

test('enveloppe : sérialisation canonique, pas de décision clinique calculée', () => {
  const a = simulation.normaliser(event());
  assert.equal(simulation.empreinte(a), simulation.empreinte({ ...a, donnees: { version: 2, lit: 'LIT-1', demande: 'DEM-1' } }));
  assert.equal(a.sequence, 1);
});
for (const [nom, ev] of Object.entries({
  tableau: [], sansConfirmation: { ...event(), confirmation: false }, sequenceNegative: { ...event(), sequence: -1 },
  sequenceFraction: { ...event(), sequence: 1.2 }, sequenceTexte: { ...event(), sequence: '1' },
  sequenceTropGrande: { ...event(), sequence: Number.MAX_SAFE_INTEGER + 1 },
  nomPatient: { ...event(), donnees: { demande: 'DEM-1', nom: 'Identité interdite' } },
  auteurForge: { ...event(), donnees: { demande: 'DEM-1', acteur_id: 99 } },
  sql: { ...event(), flux: "';DROP TABLE" }, dateInexistante: { ...event(), date_source: '2026-02-30T09:00:00Z' },
  dateSansFuseau: { ...event(), date_source: '2026-10-25T09:00:00' },
  typeInconnu: { ...event(), evenement: 'sql' },
  besoinsIdentifiants: { ...event(), evenement: 'demande_lit', donnees: { groupe_age: 'adulte', besoins: { diagnostic: 'interdit' } } },
  ageAbsent: { ...event(), evenement: 'demande_lit', donnees: {} },
  versionAbsente: { ...event(), evenement: 'attribution', donnees: { demande: 'DEM-1', lit: 'LIT-1' } },
})) test(`enveloppe refusée : ${nom}`, () => assert.throws(() => simulation.normaliser(ev), { statut: 400 }));

test('production : simulation refusée avant toute requête', async () => {
  const f = fixture({ environnement: 'production' }); await assert.rejects(f.api.recevoir(f.pool, u, con, event()), { statut: 403 }); assert.equal(f.requetes.length, 0);
});
test('isolation : utilisateur d’un autre établissement refusé avant toute requête', async () => {
  const f = fixture(); await assert.rejects(f.api.recevoir(f.pool, { ...u, etabs: [9] }, con, event()), { statut: 403 }); assert.equal(f.requetes.length, 0);
});
test('entretien et connecteur réseau : aucune mutation autorisée', async () => {
  for (const [acteur, connecteur] of [[{ ...u, role: 'entretien' }, con], [u, { ...con, etablissement_id: null }]]) {
    const f = fixture(); await assert.rejects(f.api.recevoir(f.pool, acteur, connecteur, event()), { statut: 403 }); assert.equal(f.appels.length, 0);
  }
});
test('connecteur non activé : aucune opération métier', async () => {
  const f = fixture({ inactif: true }); await assert.rejects(f.api.recevoir(f.pool, u, con, event()), { statut: 403 }); assert.equal(f.appels.length, 0);
});
test('événement et accusé appliqués dans la transaction appelante ; doublon sans nouvel effet', async () => {
  const f = fixture(); const r = await f.api.recevoir(f.pool, u, con, event());
  assert.equal(r.statut, 'applique'); assert.equal(f.appels[0].nom, 'admettreDemande'); assert.equal(f.appels[0].args.at(-1), f.client);
  assert.equal((await f.api.recevoir(f.pool, u, con, event())).statut, 'deja_recu'); assert.equal(f.appels.length, 1);
  assert.equal(f.etat.flux['EPISODE-1'].derniere_sequence, 1);
});
test('même identifiant avec contenu différent : conflit, accusé original conservé', async () => {
  const f = fixture(); await f.api.recevoir(f.pool, u, con, event());
  const r = await f.api.recevoir(f.pool, u, con, { ...event(), donnees: { ...event().donnees, demande: 'DEM-2' } });
  assert.equal(r.code, 'simulation_identifiant_conflit'); assert.equal(f.appels.length, 1); assert.equal(f.etat.ledger['MSG-1'].statut, 'applique');
});
test('désordre 2,1,2 : événement futur conservé, puis rejoué explicitement une seule fois', async () => {
  const f = fixture(); assert.equal((await f.api.recevoir(f.pool, u, con, event(2))).statut, 'en_attente'); assert.equal(f.appels.length, 0);
  assert.equal((await f.api.recevoir(f.pool, u, con, event(1))).statut, 'applique');
  assert.equal((await f.api.recevoir(f.pool, u, con, event(2))).statut, 'applique');
  assert.equal((await f.api.recevoir(f.pool, u, con, event(2))).statut, 'deja_recu'); assert.equal(f.appels.length, 2);
});
test('séquence déjà dépassée avec nouvel identifiant : aucun écrasement', async () => {
  const f = fixture(); await f.api.recevoir(f.pool, u, con, event());
  const r = await f.api.recevoir(f.pool, u, con, event(1, 'AUTRE')); assert.equal(r.code, 'simulation_sequence_perimee'); assert.equal(f.appels.length, 1);
});
test('date source périmée : conflit avant exécution du workflow', async () => {
  const f = fixture(); await f.api.recevoir(f.pool, u, con, event());
  const r = await f.api.recevoir(f.pool, u, con, { ...event(2), date_source: '2026-10-24T09:00:00.000Z' });
  assert.equal(r.code, 'simulation_source_perimee'); assert.equal(f.appels.length, 1);
});
test('correspondance absente : mise en attente puis reprise sans perte d’événement', async () => {
  const f = fixture(); f.correspondances.delete('demande:DEM-1');
  assert.equal((await f.api.recevoir(f.pool, u, con, event())).statut, 'en_attente');
  f.correspondances.set('demande:DEM-1', '44'); assert.equal((await f.api.recevoir(f.pool, u, con, event())).statut, 'applique');
});
test('rejeu par un autre compte : refus même dans le même établissement', async () => {
  const f = fixture(); await f.api.recevoir(f.pool, u, con, event(2));
  await assert.rejects(f.api.recevoir(f.pool, { ...u, id: 9 }, con, event(2)), { statut: 403 });
});
test('correspondance hors établissement : refus, aucune opération métier', async () => {
  const f = fixture({ horsPerimetre: true }); const r = await f.api.recevoir(f.pool, u, con, event());
  assert.equal(r.statut, 'rejete'); assert.equal(r.http_status, 403); assert.equal(f.appels.length, 0);
});
test('conflit métier : rollback au savepoint, aucun avancement de séquence', async () => {
  const f = fixture({ erreur: new ErreurHttp(409, 'simulation_version_conflit') });
  const r = await f.api.recevoir(f.pool, u, con, event()); assert.equal(r.statut, 'conflit'); assert.equal(f.etat.metier, 0);
  assert.equal(f.etat.flux['EPISODE-1'].derniere_sequence, 0); assert.equal(f.etat.ledger['MSG-1'].statut, 'conflit');
});
test('erreur technique inattendue : rollback complet, aucun faux accusé appliqué', async () => {
  const f = fixture({ erreur: new Error('panne technique') }); await assert.rejects(f.api.recevoir(f.pool, u, con, event()), /panne technique/);
  assert.equal(Object.keys(f.etat.ledger).length, 0); assert.equal(f.etat.metier, 0);
});

const operations = {
  arrivee_urgence: [{ patient: 'PAT-1', civiere: 'CIV-1', version: 1 }, 'changerEtatCiviere'],
  demande_lit: [{ patient: 'PAT-1', type_unite: 'MED', demande: 'DEM-NOUVELLE', groupe_age: 'pediatrique' }, 'creerDemande'],
  priorite_validee: [{ demande: 'DEM-1', code: 'rapide', revision: 1, version: 0, motif: 'Validation fictive' }, 'valider'],
  attribution: [{ demande: 'DEM-1', lit: 'LIT-1', version: 2 }, 'assignerLit'],
  admission: [{ demande: 'DEM-1', lit: 'LIT-1', version: 2 }, 'admettreDemande'],
  etat_lit: [{ lit: 'LIT-1', action: 'hors_service', version: 2, motif: 'equipement' }, 'changerEtat'],
  conge_prevu: [{ lit: 'LIT-1', patient: 'PAT-1', version: 2, date: '2026-10-26T10:00:00Z' }, 'majConge'],
  conge_confirme: [{ lit: 'LIT-1', patient: 'PAT-1', version: 2, date: '2026-10-26T10:00:00Z' }, 'majConge'],
  conge: [{ lit: 'LIT-1', patient: 'PAT-1', version: 2 }, 'changerEtat'],
  nettoyage: [{ genre: 'lit', ressource: 'LIT-1', version: 2 }, 'changerEtat'],
  transfert: [{ demande: 'DEM-1', destination: 'B', transfert: 'TR-NOUVEAU', urgent: false }, 'transfererDemande'],
  transfert_etape: [{ transfert: 'TR-1', etape: 'accepter' }, 'avancerTransfert'],
  reception: [{ transfert: 'TR-1' }, 'avancerTransfert'],
};
for (const [evenement, [donnees, methode]] of Object.entries(operations)) test(`workflow partagé : ${evenement}`, async () => {
  const f = fixture(); const r = await f.api.recevoir(f.pool, u, con, { ...event(), evenement, donnees });
  assert.equal(r.statut, 'applique', JSON.stringify(r)); assert.equal(f.appels[0].nom, methode);
  if (evenement === 'priorite_validee') { assert.equal(f.appels[0].args[1].id, u.id); assert.equal(f.appels[0].args[3].confirmation, true); assert.equal(f.appels[0].args.at(-1), f.client); }
});
test('nettoyage : ne peut pas annuler une réservation ou remettre un lit hors service', async () => {
  for (const etat of ['reserve', 'occupe', 'indispo', 'libre']) {
    const f = fixture({ etat }); const r = await f.api.recevoir(f.pool, u, con, { ...event(), evenement: 'nettoyage', donnees: operations.nettoyage[0] });
    assert.equal(r.statut, 'conflit'); assert.equal(f.appels.length, 0);
  }
});
test('congé : mauvais patient refusé avant de libérer le lit', async () => {
  const f = fixture({ autrePatient: true }); const r = await f.api.recevoir(f.pool, u, con, { ...event(), evenement: 'conge', donnees: operations.conge[0] });
  assert.equal(r.code, 'simulation_patient_conflit'); assert.equal(f.appels.length, 0);
});
test('admission préparée sur un autre lit ou une ancienne version : aucun effet', async () => {
  for (const options of [{ autreLit: true }, { versionLit: 3 }]) {
    const f = fixture(options); const r = await f.api.recevoir(f.pool, u, con, event());
    assert.equal(r.code, 'simulation_version_conflit'); assert.equal(f.appels.length, 0);
  }
});
