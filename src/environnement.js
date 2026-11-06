/**
 * Environnement d'exécution : démo, recette ou production. Le même code partout ; seul le fichier .env change.
 *   ARRIMO_ENV       demo | recette | production
 *   ARRIMO_DOMAINE   domaine d'Arrimo, le seul réglage à changer pour passer à un autre domaine (ex. arrimo.ca).
 *                    Adresses qui en découlent : démo et production sur le domaine lui-même, recette sur recette.<domaine>
 *                    (et plus tard sh.<domaine>, <hôpital>.<domaine>).
 *   ARRIMO_URL       facultatif : adresse publique imposée (sinon calculée à partir du domaine).
 * Compatibilité : sans ARRIMO_ENV, ARRIMO_DEMO=1 vaut « demo » ; sinon, en NODE_ENV=production, « production ».
 */
const ENVIRONNEMENTS = ['demo', 'recette', 'pilote', 'production'];

function environnement() {
  const e = String(process.env.ARRIMO_ENV || '').trim().toLowerCase();
  if (ENVIRONNEMENTS.includes(e)) return e;
  if (process.env.ARRIMO_DEMO === '1') return 'demo';
  return process.env.NODE_ENV === 'production' ? 'production' : 'developpement';
}
/** Démonstration : remise à zéro, recalage des horloges, simulation, données fictives. */
const estDemo = () => environnement() === 'demo';
const estProduction = () => environnement() === 'production';
/** Administration : double authentification exigée partout, sauf sur les démos (décision de Moustafa, 6 nov. 2026) et ARRIMO_2FA_ADMIN=0 (tests). */
const exige2faAdmin = () => !estDemo() && process.env.ARRIMO_2FA_ADMIN !== '0';
/** Essais vocaux : uniquement sur une cible déclarée fictive, jamais en production. */
const vocalFictifAutorise=()=>estDemo()||(['recette','pilote'].includes(environnement())&&process.env.ARRIMO_OG_VOCAL_FICTIF==='1'&&process.env.ARRIMO_PATIENTS_FICTIFS==='1');

/** Hôte public de cet environnement (ex. recette.arrimo.senseafri.com). */
function hote() {
  const d = String(process.env.ARRIMO_DOMAINE || '').trim().toLowerCase();
  if (!d) return null;
  const e=environnement();
  return ['recette','pilote'].includes(e) ? `${e}.${d}` : d;
}
/** Adresse publique (liens des courriels) : ARRIMO_URL si elle est imposée, sinon https://<hôte>. */
function urlPublique() {
  if (process.env.ARRIMO_URL) return process.env.ARRIMO_URL.replace(/\/$/, '');
  const h = hote();
  return h ? `https://${h}` : '';
}

/**
 * Garde-fous au démarrage d'un serveur de production : sans eux, il refuse de démarrer plutôt que de tourner sans protection.
 * Secrets de double authentification chiffrés, aucune identité fictive, aucune clé de service trop courte.
 */
function problemesProduction(env = process.env) {
  const p = [];
  if (!/^[A-Za-z0-9+/]{43}=$/.test(String(env.ARRIMO_MFA_ENCRYPTION_KEY || ''))) p.push('ARRIMO_MFA_ENCRYPTION_KEY absente ou invalide (32 octets en base64)');
  if (env.ARRIMO_PATIENTS_FICTIFS === '1') p.push('ARRIMO_PATIENTS_FICTIFS interdit en production');
  if (env.DEMO_MOT_DE_PASSE) p.push('DEMO_MOT_DE_PASSE interdit en production');
  if (env.SH_API_KEY && String(env.SH_API_KEY).length < 32) p.push('SH_API_KEY trop courte (32 caractères au moins)');
  return p;
}
module.exports = { problemesProduction, ENVIRONNEMENTS, environnement, estDemo, estProduction, exige2faAdmin, vocalFictifAutorise, hote, urlPublique };
