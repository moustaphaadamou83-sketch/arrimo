const { Pool } = require('pg');
const { MESSAGES, formater } = require('./erreurs');

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

/** Erreur destinée à l'utilisateur : statut HTTP, code stable (voir erreurs.js) et variables du message. */
class ErreurHttp extends Error {
  constructor(statut, code, vars = {}) {
    const connu = Object.prototype.hasOwnProperty.call(MESSAGES, code);
    super(connu ? formater(MESSAGES[code], vars) : code);
    this.statut = statut;
    this.code = connu ? code : null;
    this.vars = vars;
  }
}

module.exports = { creerPool, transaction, ErreurHttp };
