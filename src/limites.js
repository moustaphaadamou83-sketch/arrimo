/**
 * Limite la fréquence des requêtes API, en plus de Nginx :
 * par session (jeton) une fois connecté, sinon par adresse IP. Fenêtre glissante d'une minute.
 *   API_LIMITE_SESSION (défaut 600 / min) · API_LIMITE_ANONYME (défaut 120 / min) · API_LIMITE_SH (console SH, défaut 1200 / min)
 * /api/sante n'est pas limitée (surveillance).
 */
const crypto = require('crypto');
const { ErreurHttp } = require('./db');

function cleShValide(fournie) {
  const cle = process.env.SH_API_KEY;
  if (!fournie || !cle || fournie.length !== cle.length) return false;
  return crypto.timingSafeEqual(Buffer.from(fournie), Buffer.from(cle));
}

function limiteur({ parSession = Number(process.env.API_LIMITE_SESSION || 600), anonyme = Number(process.env.API_LIMITE_ANONYME || 120) } = {}) {
  const compteurs = new Map();   // clé → horodatages des requêtes de la dernière minute
  const jetonsParIp = new Map(); // adresse → jetons vus dans la dernière minute
  const jetonsMax = Number(process.env.API_JETONS_PAR_IP || 300);
  const nettoyage = setInterval(() => {
    const limite = Date.now() - 60000;
    for (const [k, v] of compteurs) { if (!v.length || v[v.length - 1] < limite) compteurs.delete(k); }
    for (const [ip, m] of jetonsParIp) { for (const [k, t] of m) if (t < limite) m.delete(k); if (!m.size) jetonsParIp.delete(ip); }
  }, 60000);
  nettoyage.unref();
  return (req, res, next) => {
    if (req.path === '/sante') return next();
    const entete = req.get('authorization') || '';
    // Console SH (clé de service exacte) : son propre compteur, plus large ; une clé inexacte reste limitée comme un appel anonyme
    const sh = cleShValide(req.get('x-sh-key'));
    // Les routes sans session (connexion, mot de passe, invitation) sont toujours comptées par adresse IP :
    // un en-tête Authorization inventé ne doit pas ouvrir un nouveau compteur.
    const anonymeForce = /^\/(connexion|mot-de-passe|invitations|proches\/(connexion|invitation))(\/|$)/.test(req.path);
    let cle = sh ? 'sh' : entete.startsWith('Bearer ') && !anonymeForce ? `s:${crypto.createHash('sha256').update(entete.slice(7, 200)).digest('hex').slice(0, 32)}` : `ip:${req.ip}`;
    if (cle.startsWith('s:')) {
      // Au plus JETONS_PAR_IP jetons distincts par adresse et par minute : au-delà, les requêtes reviennent au compteur de l'adresse
      const ips = jetonsParIp.get(req.ip) || new Map();
      ips.set(cle, Date.now()); jetonsParIp.set(req.ip, ips);
      for (const [k, t] of ips) if (t < Date.now() - 60000) ips.delete(k);
      if (ips.size > jetonsMax) cle = `ip:${req.ip}`;
    }
    const max = sh ? Number(process.env.API_LIMITE_SH || 1200) : cle.startsWith('s:') ? parSession : anonyme;
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
