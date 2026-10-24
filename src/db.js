const { Pool } = require('pg');
const { MESSAGES, formater } = require('./erreurs');

function creerPool(url) {
  // Une connexion attendue plus de 10 s : erreur plutôt qu'attente sans fin
  return new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX || 20), connectionTimeoutMillis: Number(process.env.PG_POOL_ATTENTE_MS || 10000) });
}

/** Exécute fn dans une transaction. Annule tout si une erreur survient. */
async function transaction(pool, fn) {
  const client = await pool.connect();
  let erreur = null;
  try {
    await client.query('BEGIN');
    const resultat = await fn(client);
    await client.query('COMMIT');
    return resultat;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    erreur = err;
    throw err;
  } finally {
    client.release();
    // Ce qui doit survivre à l'annulation (ex. le refus d'un changement de lit) s'écrit APRÈS avoir rendu la connexion :
    // sinon, sous forte concurrence, chaque transaction attendrait une connexion tenue par une autre (blocage).
    if (erreur && typeof erreur.apresAnnulation === 'function') await erreur.apresAnnulation(pool);
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
