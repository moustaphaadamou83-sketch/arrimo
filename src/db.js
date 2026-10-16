const { Pool } = require('pg');

function creerPool(url) {
  return new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX || 20) });
}

/** Exécute fn dans une transaction. Annule tout si une erreur survient. */
async function transaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultat = await fn(client);
    await client.query('COMMIT');
    return resultat;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

class ErreurHttp extends Error {
  constructor(statut, message) {
    super(message);
    this.statut = statut;
  }
}

module.exports = { creerPool, transaction, ErreurHttp };
