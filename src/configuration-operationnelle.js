const crypto = require('node:crypto');
const { ErreurHttp } = require('./db');
const MODULES = ['urgence', 'nsa', 'nettoyage', 'national', 'liaison_chsld'];
// Drapeaux connus de toutes les versions publiées : obligatoires dans une configuration. Les plus récents (Liaison CHSLD)
// peuvent manquer quand une console ou un environnement plus ancien publie : ils restent alors inchangés.
const MODULES_SOCLE = ['urgence', 'nsa', 'nettoyage', 'national'];
/** Drapeaux modifiables selon le type : les modules hospitaliers, ou ceux du type (CHSLD, etc.). */
const modulesDuType = (type = 'hopital') => (type === 'hopital' ? MODULES : require('./types-etablissement').drapeaux(type));
function normaliser(b, type = 'hopital') {
  const MOD = modulesDuType(type);
  const requis = type === 'hopital' ? MODULES_SOCLE : MOD;
  if (!b || typeof b !== 'object' || Array.isArray(b)
    || !b.modules || typeof b.modules !== 'object' || Array.isArray(b.modules)
    || Object.keys(b.modules).some((k) => !MOD.includes(k))
    || requis.some((k) => typeof b.modules[k] !== 'boolean')
    || Object.values(b.modules).some((v) => typeof v !== 'boolean')
    || !['general', 'pediatrique', 'specialise'].includes(b.vocation)) {
    throw new ErreurHttp(400, 'configuration_operationnelle_invalide');
  }
  // Les champs opérationnels (lits, patients, admissions, etc.) sont interdits,
  // y compris si le client essaie de les joindre à une synchronisation SH.
  if (Object.keys(b).some((k) => !['modules', 'vocation', 'version', 'par'].includes(k))) throw new ErreurHttp(400, 'configuration_operationnelle_invalide');
  return { modules: Object.fromEntries(MOD.filter((k) => Object.hasOwn(b.modules, k)).map((k) => [k, b.modules[k]])), vocation: b.vocation };
}
function empreinte(e) {
  return crypto.createHash('sha256').update(JSON.stringify({ vocation: e.vocation || 'general',
    modules: Object.entries(e.modules || {}).sort(([a], [b]) => a.localeCompare(b)) })).digest('hex');
}
function fusionner(modules, modifications, type = 'hopital') {
  const resultat = { ...modules };
  const optionnels = type === 'hopital' ? [] : require('./types-etablissement').drapeauxOptionnels(type);
  for (const k of modulesDuType(type)) {
    if (!Object.hasOwn(modifications, k)) continue; // drapeau non transmis (console plus ancienne) : inchangé
    // Optionnel : vrai seulement sur choix explicite ; sinon : absent signifie activé dans Arrimo.
    if (optionnels.includes(k)) { if (modifications[k] === true) resultat[k] = true; else delete resultat[k]; }
    else if (modifications[k] === false) resultat[k] = false;
    else delete resultat[k];
  }
  return resultat;
}
module.exports = { MODULES, modulesDuType, normaliser, empreinte, fusionner };
