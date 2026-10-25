// Contrat transactionnel sans PostgreSQL : ces tests ne remplacent pas la recette SQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const { recevoirEvenement } = require('../src/connecteurs');

function baseSimulee({ journal = null, panneJournal = false, litAbsent = false, simule = false } = {}) {
  const appels = [];
  let enTransaction = false;
  let sauvegarde;
  const query = async (sql, params, externe = false) => {
    appels.push({ sql, params, externe });
    if (sql === 'BEGIN') { enTransaction = true; sauvegarde = journal; }
    else if (sql === 'COMMIT') enTransaction = false;
    else if (sql === 'ROLLBACK') { journal = sauvegarde; enTransaction = false; }
    else if (sql.startsWith('SELECT connecteur_id FROM connecteurs_simulation_config')) return { rows: simule ? [{ connecteur_id: 3 }] : [] };
    else if (sql.startsWith('SELECT statut')) {
      assert.ok(enTransaction);
      assert.ok(appels.some((x) => x.sql.includes('pg_advisory_xact_lock')));
      return { rows: journal ? [journal] : [] };
    } else if (sql.startsWith('SELECT id, code, etat')) {
      return { rows: litAbsent ? [] : [{ id: 12, code: 'MED-1', etat: 'libre' }] };
    } else if (sql.includes('INSERT INTO messages_connecteur')) {
      if (!externe && panneJournal) throw new Error('Panne du journal');
      if (!journal || (!externe && journal.statut === 'rejete')) journal = { statut: params[3], detail: params[4] };
    }
    return { rows: [] };
  };
  return {
    appels,
    get journal() { return journal; },
    query: (sql, params) => query(sql, params, true),
    connect: async () => ({ query, release() { appels.push({ sql: 'RELEASE' }); } }),
  };
}
const connecteur = { id: 3, etablissement_id: 7, nom: 'ADT fictif' };
const evenement = { identifiant: 'MSG-1', evenement: 'conge', lit: 'MED-1' };

test('événement ignoré : accusé écrit avant COMMIT, dans la même transaction', async () => {
  const pool = baseSimulee();
  assert.equal((await recevoirEvenement(pool, connecteur, evenement)).statut, 'ignore');
  assert.equal(pool.journal.statut, 'ignore');
  const ecriture = pool.appels.findIndex((x) => x.sql.includes('INSERT INTO messages_connecteur'));
  assert.ok(ecriture < pool.appels.findIndex((x) => x.sql === 'COMMIT'));
  assert.equal(pool.appels[ecriture].externe, false);
});

test('redélivraison acceptée : aucune lecture ni modification du lit', async () => {
  for (const statut of ['applique', 'ignore']) {
    const pool = baseSimulee({ journal: { statut, detail: 'déjà traité' } });
    assert.deepEqual(await recevoirEvenement(pool, connecteur, evenement), { statut: 'deja_recu', detail: 'déjà traité' });
    assert.ok(!pool.appels.some((x) => x.sql.includes('FROM lits')));
  }
});

test('rejet antérieur : nouvelle tentative autorisée et accusé remplacé', async () => {
  const pool = baseSimulee({ journal: { statut: 'rejete', detail: 'ancienne erreur' } });
  assert.equal((await recevoirEvenement(pool, connecteur, evenement)).statut, 'ignore');
  assert.equal(pool.journal.statut, 'ignore');
});

test('panne d’accusé : ROLLBACK avant journalisation du rejet', async () => {
  const pool = baseSimulee({ panneJournal: true });
  await assert.rejects(recevoirEvenement(pool, connecteur, evenement), /Panne du journal/);
  assert.ok(!pool.appels.some((x) => x.sql === 'COMMIT'));
  const rollback = pool.appels.findIndex((x) => x.sql === 'ROLLBACK');
  const rejet = pool.appels.findIndex((x) => x.externe);
  assert.ok(rollback >= 0 && rejet > rollback);
  assert.equal(pool.journal.statut, 'rejete');
});

test('lit inconnu : transaction annulée et rejet conservé', async () => {
  const pool = baseSimulee({ litAbsent: true });
  await assert.rejects(recevoirEvenement(pool, connecteur, evenement), { statut: 404 });
  assert.equal(pool.journal.statut, 'rejete');
});

test('connecteur réseau : écriture refusée avant toute transaction', async () => {
  const pool = baseSimulee();
  await assert.rejects(recevoirEvenement(pool, { ...connecteur, etablissement_id: null }, evenement), { statut: 403 });
  assert.equal(pool.appels.length, 0);
});
test('clé de simulation : l’ancien point d’entrée ne contourne pas la session humaine', async () => {
  const pool = baseSimulee({ simule: true });
  await assert.rejects(recevoirEvenement(pool, connecteur, evenement), { statut: 403 });
  assert.ok(!pool.appels.some((x) => x.sql.includes('FROM lits')));
});
