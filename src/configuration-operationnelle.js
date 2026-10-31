const crypto = require('node:crypto');
const { ErreurHttp } = require('./db');
const MODULES = ['urgence', 'nsa', 'nettoyage', 'national'];
/** Drapeaux modifiables selon le type : les quatre modules hospitaliers, ou ceux du type (CHSLD, etc.). */
const modulesDuType = (type = 'hopital') => (type === 'hopital' ? MODULES : require('./types-etablissement').drapeaux(type));
function normaliser(b, type = 'hopital') {
  const MOD = modulesDuType(type);
  if (!b || typeof b !== 'object' || Array.isArray(b)
    || !b.modules || typeof b.modules !== 'object' || Array.isArray(b.modules)
    || Object.keys(b.modules).some((k) => !MOD.includes(k))
    || MOD.some((k) => typeof b.modules[k] !== 'boolean')
    || !['general', 'pediatrique', 'specialise'].includes(b.vocation)) {
    throw new ErreurHttp(400, 'configuration_operationnelle_invalide');
  }
  // Les champs opérationnels (lits, patients, admissions, etc.) sont interdits,
  // y compris si le client essaie de les joindre à une synchronisation SH.
  if (Object.keys(b).some((k) => !['modules', 'vocation', 'version', 'par'].includes(k))) throw new ErreurHttp(400, 'configuration_operationnelle_invalide');
  return { modules: Object.fromEntries(MOD.map((k) => [k, b.modules[k]])), vocation: b.vocation };
}
function empreinte(e) {
  return crypto.createHash('sha256').update(JSON.stringify({ vocation: e.vocation || 'general',
    modules: Object.entries(e.modules || {}).sort(([a], [b]) => a.localeCompare(b)) })).digest('hex');
}
function fusionner(modules, modifications, type = 'hopital') {
  const resultat = { ...modules };
  for (const k of modulesDuType(type)) {
    if (modifications[k] === false) resultat[k] = false;
    else delete resultat[k]; // absent signifie activé dans Arrimo ; conserver les autres paramètres.
  }
  return resultat;
}
module.exports = { MODULES, modulesDuType, normaliser, empreinte, fusionner };
