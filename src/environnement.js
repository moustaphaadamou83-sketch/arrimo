/**
 * Environnement d'exécution : démo, recette ou production. Le même code partout ; seul le fichier .env change.
 *   ARRIMO_ENV       demo | recette | production
 *   ARRIMO_DOMAINE   domaine d'Arrimo, le seul réglage à changer pour passer à un autre domaine (ex. arrimo.ca).
 *                    Adresses qui en découlent : démo et production sur le domaine lui-même, recette sur recette.<domaine>
 *                    (et plus tard sh.<domaine>, <hôpital>.<domaine>).
 *   ARRIMO_URL       facultatif : adresse publique imposée (sinon calculée à partir du domaine).
 * Compatibilité : sans ARRIMO_ENV, ARRIMO_DEMO=1 vaut « demo » ; sinon, en NODE_ENV=production, « production ».
 */
const ENVIRONNEMENTS = ['demo', 'recette', 'production'];

function environnement() {
  const e = String(process.env.ARRIMO_ENV || '').trim().toLowerCase();
  if (ENVIRONNEMENTS.includes(e)) return e;
  if (process.env.ARRIMO_DEMO === '1') return 'demo';
  return process.env.NODE_ENV === 'production' ? 'production' : 'developpement';
}
/** Démonstration : remise à zéro, recalage des horloges, simulation, données fictives. */
const estDemo = () => environnement() === 'demo';
const estProduction = () => environnement() === 'production';

/** Hôte public de cet environnement (ex. recette.arrimo.senseafri.com). */
function hote() {
  const d = String(process.env.ARRIMO_DOMAINE || '').trim().toLowerCase();
  if (!d) return null;
  return environnement() === 'recette' ? `recette.${d}` : d;
}
/** Adresse publique (liens des courriels) : ARRIMO_URL si elle est imposée, sinon https://<hôte>. */
function urlPublique() {
  if (process.env.ARRIMO_URL) return process.env.ARRIMO_URL.replace(/\/$/, '');
  const h = hote();
  return h ? `https://${h}` : '';
}

module.exports = { ENVIRONNEMENTS, environnement, estDemo, estProduction, hote, urlPublique };
