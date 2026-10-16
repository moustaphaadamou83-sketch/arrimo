/**
 * Limite la fréquence des requêtes API, en plus de Nginx :
 * par session (jeton) une fois connecté, sinon par adresse IP. Fenêtre glissante d'une minute.
 *   API_LIMITE_SESSION (défaut 600 / min) · API_LIMITE_ANONYME (défaut 120 / min)
 * /api/sante n'est pas limitée (surveillance).
 */
const { ErreurHttp } = require('./db');

function limiteur({ parSession = Number(process.env.API_LIMITE_SESSION || 600), anonyme = Number(process.env.API_LIMITE_ANONYME || 120) } = {}) {
  const compteurs = new Map();   // clé → horodatages des requêtes de la dernière minute
  const nettoyage = setInterval(() => {
    const limite = Date.now() - 60000;
    for (const [k, v] of compteurs) { if (!v.length || v[v.length - 1] < limite) compteurs.delete(k); }
  }, 60000);
  nettoyage.unref();
  return (req, res, next) => {
    if (req.path === '/sante') return next();
    const entete = req.get('authorization') || '';
    const cle = entete.startsWith('Bearer ') ? `s:${entete.slice(7, 71)}` : `ip:${req.ip}`;
    const max = cle.startsWith('s:') ? parSession : anonyme;
    const maintenant = Date.now();
    const v = (compteurs.get(cle) || []).filter((t) => t > maintenant - 60000);
    if (v.length >= max) {
      res.set('Retry-After', String(Math.ceil((v[0] + 60000 - maintenant) / 1000)));
      return next(new ErreurHttp(429, 'trop_requetes'));
    }
    v.push(maintenant);
    compteurs.set(cle, v);
    return next();
  };
}

module.exports = { limiteur };
