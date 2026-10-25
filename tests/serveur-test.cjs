const http = require('node:http');

/** Ne rendre le serveur qu'après écoute effective ; propager la vraie erreur de bind. */
function ecouterServeur(serveur, { port = 0, host = '127.0.0.1', delaiMs = 10000 } = {}) {
  if (host !== '127.0.0.1') return Promise.reject(new Error('Les serveurs de recette doivent écouter sur le loopback.'));
  return new Promise((resolve, reject) => {
    const nettoyer = () => {
      clearTimeout(delai);
      serveur.removeListener('error', erreur);
      serveur.removeListener('listening', pret);
    };
    const erreur = (e) => { nettoyer(); reject(e); };
    const pret = () => {
      const adresse = serveur.address();
      if (!adresse || typeof adresse === 'string' || !Number.isInteger(adresse.port) || adresse.port < 1) {
        const e = new Error('Événement listening sans adresse HTTP utilisable.'); e.code = 'ERR_SERVEUR_TEST_ADRESSE';
        serveur.close(() => {}); erreur(e); return;
      }
      nettoyer(); resolve(serveur);
    };
    const delai = setTimeout(() => {
      const e = new Error(`Le serveur de recette n’écoute pas après ${delaiMs} ms.`); e.code = 'ETIMEDOUT';
      serveur.close(() => {}); erreur(e);
    }, delaiMs);
    serveur.once('error', erreur);
    serveur.once('listening', pret);
    try { serveur.listen(port, host); } catch (e) { erreur(e); }
  });
}

function demarrerServeur(application, options) {
  return ecouterServeur(http.createServer(application), options);
}
module.exports = { demarrerServeur, ecouterServeur };
