'use strict';
/**
 * Licence OG d'un hôpital : module « og » souscrit dans SH, fonctions détaillées dans ses paramètres JSON
 * (personnalisation, actions, patients, documents, rapports). L'assistant texte et le vocal sont inclus dès la
 * souscription, sauf exclusion explicite (false). Sans souscription, aucune fonction.
 */
const FONCTIONS = ['texte', 'vocal', 'dictee', 'conversation', 'personnalisation', 'actions', 'patients', 'documents', 'rapports'];
function licenceOg(modules) {
  const og = modules.find((m) => (m.module_code || m.code) === 'og');
  if (!og || og.licence !== 'souscrit') return Object.fromEntries(FONCTIONS.map((f) => [f, false]));
  const p = og.parametres || {};
  // Texte et vocal (dictée, conversation) inclus dès la souscription, sauf exclusion explicite (false).
  const inclus = ['texte', 'vocal', 'dictee', 'conversation'];
  return Object.fromEntries(FONCTIONS.map((f) => [f, inclus.includes(f) ? p[f] !== false : p[f] === true]));
}
/** Transmet la licence à l'établissement relié ; un échec n'annule pas l'enregistrement SH et il est signalé. */
async function transmettre(db, appeler, cible, h, par) {
  const modules = (await db.query('SELECT module_code, licence, parametres FROM sh_hopital_modules WHERE hopital_id=$1', [h.id])).rows;
  // Aucune décision OG dans SH : rien n'est transmis, l'établissement garde son fonctionnement par défaut.
  if (!modules.some((m) => m.module_code === 'og')) return { transmise: false, ignoree: true, raison: 'aucune décision OG dans SH' };
  const licence = licenceOg(modules);
  try {
    await appeler(cible, 'PUT', `/sh/etablissements/${encodeURIComponent(h.code_etab)}/og-licence`, { licence, par });
    return { transmise: true, licence };
  } catch (e) { return { transmise: false, licence, raison: String(e.message || e).slice(0, 200) }; }
}
module.exports = { FONCTIONS, licenceOg, transmettre };
