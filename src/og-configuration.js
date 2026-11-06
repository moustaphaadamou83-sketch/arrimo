'use strict';
/**
 * Configuration d'OG par établissement (cahier OG §2, §3, §19).
 * - Licence : fonctions autorisées par SH. Sans licence transmise, seul l'assistant texte est actif (fonctionnement historique).
 * - Réglages : choix de l'administrateur hospitalier, toujours bornés par la licence.
 * - Personnalisation : nom affiché, avatar, voix, langue, accueil. Le moteur, les permissions et les API ne changent jamais.
 */
const { ErreurHttp } = require('./db');
const FONCTIONS = ['texte', 'vocal', 'dictee', 'conversation', 'personnalisation', 'actions', 'patients', 'documents', 'rapports'];
// Décision de Moustafa (30 oct. 2026) : le vocal est disponible dans tous les environnements et établissements.
const LICENCE_HISTORIQUE = { texte: true, vocal: true, dictee: true, conversation: true };
// Démo et recette (données fictives) : sans licence SH, toutes les fonctions sont ouvertes (lecture locale de documents fictifs comprise).
const LICENCE_DEMONSTRATION = { texte: true, vocal: true, dictee: true, conversation: true, personnalisation: true, actions: true, patients: true, documents: true, rapports: true };
const licenceParDefaut = () => {
  const env = require('./environnement');
  if (['demo', 'recette'].includes(env.environnement())) return LICENCE_DEMONSTRATION;
  return LICENCE_HISTORIQUE;
};
const AVATARS = {
  modele: ['robot', 'symbole', 'humain'], style: ['professionnel', 'moderne', 'amical'],
  couleur: ['#0E5E6F', '#159895', '#1E3A5F', '#3B4A6B', '#2F6F5E'],
  peau: ['#F5D6BE', '#E0AC86', '#C68642', '#8D5524', '#5C3A21'],
  tenue: ['blouse', 'veste', 'polo'], accessoire: ['aucun', 'lunettes', 'casque'],
};
const PERSONNALISATION_DEFAUT = { nom: 'OG', voix: 'feminine', langue: 'fr', accueil: '',
  avatar: { modele: 'robot', style: 'professionnel', couleur: '#0E5E6F', peau: '#C68642', tenue: 'blouse', accessoire: 'aucun' } };

function licenceDe(ligne) { return ligne ? Object.fromEntries(FONCTIONS.map((f) => [f, ligne.licence?.[f] === true])) : { ...Object.fromEntries(FONCTIONS.map((f) => [f, false])), ...licenceParDefaut() }; }
function effectif(licence, reglages = {}) {
  const e = Object.fromEntries(FONCTIONS.map((f) => [f, licence[f] === true && reglages.fonctions?.[f] !== false]));
  // Dictée et conversation dépendent du vocal ; tout dépend de l'assistant texte.
  if (!e.vocal) { e.dictee = false; e.conversation = false; }
  if (!e.texte) for (const f of FONCTIONS) e[f] = false;
  return e;
}
function personnalisation(reglages = {}) {
  const p = reglages.personnalisation || {};
  return { ...PERSONNALISATION_DEFAUT, ...p, avatar: { ...PERSONNALISATION_DEFAUT.avatar, ...(p.avatar || {}) } };
}
async function lire(db, etabId) {
  const ligne = (await db.query('SELECT * FROM og_configurations WHERE etablissement_id=$1', [etabId])).rows[0];
  const licence = licenceDe(ligne?.licence_le ? ligne : null), reglages = ligne?.reglages || {};
  return { licence, licence_le: ligne?.licence_le || null, fonctions: reglages.fonctions || {}, effectif: effectif(licence, reglages), personnalisation: personnalisation(reglages) };
}
/** Valide les réglages proposés ; refuse toute fonction absente de la licence et toute valeur hors liste. */
function validerReglages(licence, b) {
  const fonctions = {};
  for (const [f, v] of Object.entries(b.fonctions || {})) {
    if (!FONCTIONS.includes(f) || typeof v !== 'boolean') throw new ErreurHttp(400, 'og_reglage_invalide');
    if (v && licence[f] !== true) throw new ErreurHttp(409, 'og_hors_licence');
    fonctions[f] = v;
  }
  const p = b.personnalisation || {}, a = p.avatar || {};
  const nom = String(p.nom ?? 'OG').replace(/[\u0000-\u001f<>]/g, '').trim();
  if (nom.length < 2 || nom.length > 30) throw new ErreurHttp(400, 'og_reglage_invalide');
  const dans = (cle, v, defaut) => { const x = v ?? defaut; if (!AVATARS[cle].includes(x)) throw new ErreurHttp(400, 'og_reglage_invalide'); return x; };
  const d = PERSONNALISATION_DEFAUT;
  const perso = {
    nom, voix: ['feminine', 'masculine'].includes(p.voix ?? d.voix) ? (p.voix ?? d.voix) : (() => { throw new ErreurHttp(400, 'og_reglage_invalide'); })(),
    langue: ['fr', 'en'].includes(p.langue ?? d.langue) ? (p.langue ?? d.langue) : (() => { throw new ErreurHttp(400, 'og_reglage_invalide'); })(),
    accueil: String(p.accueil ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 200),
    avatar: { modele: dans('modele', a.modele, d.avatar.modele), style: dans('style', a.style, d.avatar.style), couleur: dans('couleur', a.couleur, d.avatar.couleur),
      peau: dans('peau', a.peau, d.avatar.peau), tenue: dans('tenue', a.tenue, d.avatar.tenue), accessoire: dans('accessoire', a.accessoire, d.avatar.accessoire) },
  };
  return { fonctions, personnalisation: perso };
}
/** Licence transmise par SH : seules les fonctions connues, en booléens. */
function validerLicence(l) {
  if (!l || typeof l !== 'object' || Array.isArray(l)) throw new ErreurHttp(400, 'og_reglage_invalide');
  return Object.fromEntries(FONCTIONS.map((f) => [f, l[f] === true]));
}
const { exigerEtablissement } = require('./auth');
const { transaction } = require('./db');
const { journaliser } = require('./regles');
/**
 * Qui règle OG : l'administrateur de l'établissement. En démonstration (données fictives), le coordonnateur
 * de chaque hôpital fictif l'est aussi, pour que chaque démo A, B, C règle son propre assistant.
 */
const peutConfigurer = (u) => (u.admin && ['gestionnaire', 'admin_etab'].includes(u.role)) || (require('./environnement').estDemo() && u.role === 'coordonnateur');
async function configuration(pool, u, etab) { exigerEtablissement(u, etab); return { ...(await lire(pool, etab)), modifiable: peutConfigurer(u) }; }
/** Réglages de l'administrateur hospitalier (double authentification exigée, comme les autres réglages sensibles). */
async function configurer(pool, u, etab, b) {
  exigerEtablissement(u, etab);
  if (!peutConfigurer(u)) throw new ErreurHttp(403, 'reserve_admin');
  if (require('./environnement').exige2faAdmin() && !u.totp_actif) throw new ErreurHttp(403, 'admin_exige_2fa');
  return transaction(pool, async (c) => {
    await c.query('INSERT INTO og_configurations (etablissement_id) VALUES ($1) ON CONFLICT DO NOTHING', [etab]);
    const ligne = (await c.query('SELECT * FROM og_configurations WHERE etablissement_id=$1 FOR UPDATE', [etab])).rows[0];
    // Une ligne créée ici sans licence SH garde la licence historique (assistant texte).
    const licence = ligne.licence_le ? licenceDe(ligne) : licenceDe(null);
    const reglages = validerReglages(licence, b);
    await c.query('UPDATE og_configurations SET reglages=$2, modifie_par=$3, modifie_le=now() WHERE etablissement_id=$1', [etab, JSON.stringify(reglages), u.id]);
    await journaliser(c, { etablissementId: etab, utilisateurId: u.id, action: 'Configuration OG modifiée', detail: JSON.stringify({ nom: reglages.personnalisation.nom, fonctions: reglages.fonctions }) });
    return { ...(await lire(c, etab)), modifiable: true };
  });
}
/** Licence transmise par SH (clé SH) ; les réglages existants de l'établissement sont conservés. */
async function definirLicence(db, etab, licence) {
  const l = validerLicence(licence);
  await db.query(`INSERT INTO og_configurations (etablissement_id, licence, licence_le) VALUES ($1,$2,now())
    ON CONFLICT (etablissement_id) DO UPDATE SET licence=EXCLUDED.licence, licence_le=now()`, [etab, JSON.stringify(l)]);
  return lire(db, etab);
}
/** Refuse une fonction OG non effective pour l'établissement (contrôle serveur, indépendant de l'interface). */
async function exigerFonction(db, etab, fonction) {
  const e = (await lire(db, etab)).effectif;
  if (!e.texte) throw new ErreurHttp(403, 'og_desactive');
  if (!e[fonction]) throw new ErreurHttp(403, 'og_fonction_desactivee');
}
module.exports = { configuration, configurer, definirLicence, exigerFonction, LICENCE_DEMONSTRATION, FONCTIONS, AVATARS, PERSONNALISATION_DEFAUT, LICENCE_HISTORIQUE, lire, effectif, validerReglages, validerLicence, licenceDe };
