'use strict';
/**
 * Paramètres modifiables de la console SH. Valeur effective : celle enregistrée en base par l'administration,
 * sinon celle de la configuration du déploiement (variable d'environnement), sinon la valeur par défaut.
 * Aucun secret n'est modifiable ici (clés, SMTP, base) : ils restent dans la configuration serveur.
 */
const COURRIEL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,}$/i;
const entier = (min, max) => (v) => { const n = Number(v); if (!/^\d{1,5}$/.test(String(v).trim()) || n < min || n > max) throw new Error(`Valeur entière de ${min} à ${max} attendue.`); return String(n); };
const texte = (min, max) => (v) => { const s = String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim(); if (s.length < min || s.length > max) throw new Error(`Texte de ${min} à ${max} caractères attendu.`); return s; };
const DEFINITIONS = {
  emetteur_nom: { env: 'SH_EMETTEUR_NOM', defaut: 'Arrimo · SH', valider: texte(2, 160), section: 'general' },
  emetteur_adresse: { env: 'SH_EMETTEUR_ADRESSE', defaut: null, valider: texte(0, 300), section: 'general' },
  emetteur_courriel: { env: 'SH_EMETTEUR_COURRIEL', defaut: null, valider: (v) => { const s = String(v ?? '').trim().toLowerCase(); if (s && !COURRIEL.test(s)) throw new Error('Adresse courriel invalide.'); return s; }, section: 'general' },
  emetteur_taxes: { env: 'SH_EMETTEUR_TAXES', defaut: null, valider: texte(0, 200), section: 'general' },
  session_heures: { env: 'SH_SESSION_HEURES', defaut: '8', valider: entier(1, 12), section: 'securite' },
  employes_conservation_jours: { env: 'SH_EMPLOYES_CONSERVATION_JOURS', defaut: null, valider: entier(0, 3650), section: 'donnees' },
};
async function lire(db, env = process.env) {
  const base = new Map((await db.query('SELECT cle, valeur, modifie_le FROM sh_parametres')).rows.map((r) => [r.cle, r]));
  return Object.fromEntries(Object.entries(DEFINITIONS).map(([cle, d]) => {
    const b = base.get(cle);
    if (b) return [cle, { valeur: b.valeur, source: 'base', modifie_le: b.modifie_le, section: d.section }];
    if (env[d.env] != null && env[d.env] !== '') return [cle, { valeur: String(env[d.env]), source: 'configuration', section: d.section }];
    return [cle, { valeur: d.defaut, source: 'defaut', section: d.section }];
  }));
}
/** Environnement effectif : les valeurs enregistrées remplacent les variables correspondantes. */
async function envEffectif(db, env = process.env) {
  const p = await lire(db, env);
  const r = { ...env };
  for (const [cle, d] of Object.entries(DEFINITIONS)) if (p[cle].source === 'base') r[d.env] = p[cle].valeur;
  return r;
}
function valider(cle, valeur) {
  const d = DEFINITIONS[cle];
  if (!d) throw Object.assign(new Error('Paramètre inconnu ou non modifiable.'), { statut: 404 });
  try { return d.valider(valeur); } catch (e) { throw Object.assign(new Error(e.message), { statut: 400 }); }
}
module.exports = { DEFINITIONS, lire, envEffectif, valider };
