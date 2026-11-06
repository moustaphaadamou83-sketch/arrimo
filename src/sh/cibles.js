/**
 * Environnements pilotés par la console SH. Chacun : adresse de son API, clé de service (SH_API_KEY de cet environnement),
 * adresse publique (liens d'accès). Les clés restent dans le .env de la console, jamais dans la base.
 *   SH_ENV_DEMO_URL=http://127.0.0.1:3010        SH_ENV_DEMO_CLE=...        SH_ENV_DEMO_PUBLIC=https://arrimo.senseafri.com
 *   SH_ENV_RECETTE_URL=http://127.0.0.1:3011     SH_ENV_RECETTE_CLE=...     SH_ENV_RECETTE_PUBLIC=https://recette.arrimo.senseafri.com
 *   SH_ENV_PRODUCTION_URL=https://...             SH_ENV_PRODUCTION_CLE=...  SH_ENV_PRODUCTION_PUBLIC=https://arrimo.ca
 */
const NOMS = { demo: 'Démonstration', demo_abc:'Démonstration ABC', recette: 'Recette', pilote:'Pilote', production: 'Production' };

class ErreurCible extends Error {
  constructor(statut, message, code) { super(message); this.statut = statut; this.code = code; }
}

/** La clé de service ne circule qu'en HTTPS ; HTTP est toléré uniquement vers la machine elle-même. */
function exigerAdresseSure(code, adresse) {
  let u = null;
  try { u = new URL(adresse); } catch { /* adresse illisible : refusée ci-dessous */ }
  const locale = u && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (!u || !(u.protocol === 'https:' || (u.protocol === 'http:' && locale))) {
    throw new ErreurCible(503, `L’adresse de l’environnement ${NOMS[code]} doit être en HTTPS.`, 'cible_non_https');
  }
}

function cibles(env = process.env) {
  const configurees=Object.keys(NOMS).map((code) => {
    const p = `SH_ENV_${code.toUpperCase()}_`;
    return { code, nom: NOMS[code], url: (env[`${p}URL`] || '').replace(/\/$/, ''), cle: env[`${p}CLE`] || '', public: (env[`${p}PUBLIC`] || '').replace(/\/$/, '') };
  }).filter((c) => c.url && c.cle);
  configurees.forEach((c) => exigerAdresseSure(c.code, c.url));
  const abc=configurees.find(c=>c.code==='demo_abc');
  if(abc&&configurees.some(c=>c.code==='demo'&&c.url===abc.url))throw new ErreurCible(503,'La Démo ABC doit utiliser une API distincte de la démonstration principale.','demo_abc_non_isolee');
  const pilote=configurees.find(c=>c.code==='pilote');
  if(pilote&&configurees.some(c=>c.code!=='pilote'&&c.url===pilote.url))throw new ErreurCible(503,'Le pilote doit utiliser une API distincte des autres environnements.','pilote_non_isole');
  return configurees;
}

/** Appel à l'API d'un environnement. Rend le JSON (ou le texte si brut), ou lève une erreur avec le message de l'environnement. */
async function appeler(cible, methode, chemin, corps, { brut = false, delaiMs = null } = {}) {
  let r;
  try {
    r = await fetch(`${cible.url}/api${chemin}`, {
      method: methode,
      headers: { 'Content-Type': 'application/json', 'X-SH-Key': cible.cle },
      body: corps ? JSON.stringify(corps) : undefined,
      redirect: 'error', // une redirection emporterait la clé de service vers une autre adresse
      signal: AbortSignal.timeout(delaiMs || Number(process.env.SH_DELAI_MS || 15000)),
    });
  } catch {
    throw new ErreurCible(502, `L’environnement ${cible.nom} ne répond pas.`, 'injoignable');
  }
  if (brut && r.ok) return r.text();
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new ErreurCible(r.status >= 500 ? 502 : r.status, (data && data.erreur) || `L’environnement ${cible.nom} a refusé la demande (${r.status}).`, data && data.code);
  return data;
}

/** Lien d'accès d'un hôpital : https://<sous-domaine>.<hôte public de l'environnement>, sinon l'adresse publique. */
function lienAcces(cible, sousDomaine) {
  if (!cible || !cible.public) return null;
  if (!sousDomaine) return cible.public;
  const u = new URL(cible.public);
  return `${u.protocol}//${sousDomaine}.${u.host}`;
}

module.exports = { NOMS, cibles, appeler, lienAcces, ErreurCible };
