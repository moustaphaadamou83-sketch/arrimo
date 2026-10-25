const crypto = require('node:crypto');
const { ErreurHttp } = require('./db');
const MODULES = ['urgence', 'nsa', 'nettoyage', 'national'];
function normaliser(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)
    || !b.modules || typeof b.modules !== 'object' || Array.isArray(b.modules)
    || Object.keys(b.modules).some((k) => !MODULES.includes(k))
    || MODULES.some((k) => typeof b.modules[k] !== 'boolean')
    || !['general', 'pediatrique', 'specialise'].includes(b.vocation)) {
    throw new ErreurHttp(400, 'configuration_operationnelle_invalide');
  }
  // Les champs opérationnels (lits, patients, admissions, etc.) sont interdits,
  // y compris si le client essaie de les joindre à une synchronisation SH.
  if (Object.keys(b).some((k) => !['modules', 'vocation', 'version', 'par'].includes(k))) throw new ErreurHttp(400, 'configuration_operationnelle_invalide');
  return { modules: Object.fromEntries(MODULES.map((k) => [k, b.modules[k]])), vocation: b.vocation };
}
function empreinte(e) {
  return crypto.createHash('sha256').update(JSON.stringify({ vocation: e.vocation || 'general',
    modules: Object.entries(e.modules || {}).sort(([a], [b]) => a.localeCompare(b)) })).digest('hex');
}
function fusionner(modules, modifications) {
  const resultat = { ...modules };
  for (const k of MODULES) {
    if (modifications[k] === false) resultat[k] = false;
    else delete resultat[k]; // absent signifie activé dans Arrimo ; conserver les autres paramètres.
  }
  return resultat;
}
module.exports = { MODULES, normaliser, empreinte, fusionner };
