'use strict';
/**
 * Types d'établissement et modules par type : source unique côté Arrimo (environnements) et côté SH (catalogue).
 * - Un type n'est « operationnel » qu'une fois ses parcours développés et testés : Hôpital et CHSLD pour cette phase.
 *   Maison des aînés, RPA et Ressource intermédiaire sont prévus dans l'architecture, mais refusés à la création.
 * - Un module n'est proposé à l'activation que s'il est réellement implémenté (statut « disponible »).
 *   Les modules communs sont inclus pour tous les types et ne se désactivent pas.
 * - `drapeau` : clé du module dans etablissements.modules (absent = activé, false = désactivé), lue par l'interface et l'API.
 */
const TYPES = {
  hopital: { nom: 'Hôpital', nom_en: 'Hospital', statut: 'operationnel' },
  chsld: { nom: 'CHSLD', nom_en: 'Long-term care centre (CHSLD)', statut: 'operationnel' },
  maison_aines: { nom: 'Maison des aînés', nom_en: 'Seniors’ home (maison des aînés)', statut: 'a_venir' },
  rpa: { nom: 'Résidence privée pour aînés (RPA)', nom_en: 'Private seniors’ residence (RPA)', statut: 'a_venir' },
  ressource_intermediaire: { nom: 'Ressource intermédiaire', nom_en: 'Intermediate resource', statut: 'a_venir' },
};
const TYPES_OPERATIONNELS = Object.keys(TYPES).filter((t) => TYPES[t].statut === 'operationnel');

// categorie : commun (inclus), hopital, chsld, optionnel. statut : inclus, disponible, a_venir, etude.
const MODULES = [
  // Communs : le socle, pour tous les types
  { code: 'comptes', categorie: 'commun', types: ['hopital', 'chsld'], statut: 'inclus', nom: 'Comptes et permissions', nom_en: 'Accounts and permissions' },
  { code: 'notifications', categorie: 'commun', types: ['hopital', 'chsld'], statut: 'inclus', nom: 'Notifications', nom_en: 'Notifications' },
  { code: 'og', categorie: 'commun', types: ['hopital', 'chsld'], statut: 'inclus', nom: 'OG, assistant', nom_en: 'OG assistant', note: 'Fonctions selon la licence OG' },
  { code: 'documents', categorie: 'commun', types: ['hopital', 'chsld'], statut: 'inclus', nom: 'Documents', nom_en: 'Documents' },
  { code: 'support', categorie: 'commun', types: ['hopital', 'chsld'], statut: 'inclus', nom: 'Assistance clientèle', nom_en: 'Client support' },
  { code: 'journal', categorie: 'commun', types: ['hopital', 'chsld'], statut: 'inclus', nom: 'Journal', nom_en: 'Activity log' },
  { code: 'parametres', categorie: 'commun', types: ['hopital', 'chsld'], statut: 'inclus', nom: 'Paramètres', nom_en: 'Settings' },
  { code: 'rapports', categorie: 'commun', types: ['hopital', 'chsld'], statut: 'inclus', nom: 'Indicateurs et rapports', nom_en: 'Indicators and reports' },
  // Hôpital
  { code: 'lits', categorie: 'hopital', types: ['hopital'], statut: 'inclus', nom: 'Lits et capacités', nom_en: 'Beds and capacity' },
  { code: 'admissions_hopital', categorie: 'hopital', types: ['hopital'], statut: 'inclus', nom: 'Admissions hospitalières', nom_en: 'Hospital admissions' },
  { code: 'transferts', categorie: 'hopital', types: ['hopital'], statut: 'inclus', nom: 'Transferts interhospitaliers', nom_en: 'Inter-hospital transfers' },
  { code: 'urgence', categorie: 'hopital', types: ['hopital'], statut: 'disponible', drapeau: 'urgence', nom: 'Urgence et civières', nom_en: 'Emergency and stretchers' },
  { code: 'nsa', categorie: 'hopital', types: ['hopital'], statut: 'disponible', drapeau: 'nsa', nom: 'Niveaux de soins alternatifs (NSA)', nom_en: 'Alternate level of care (ALC)' },
  { code: 'nettoyage', categorie: 'hopital', types: ['hopital'], statut: 'disponible', drapeau: 'nettoyage', nom: 'Nettoyage', nom_en: 'Cleaning' },
  { code: 'national', categorie: 'hopital', types: ['hopital'], statut: 'disponible', drapeau: 'national', nom: 'Tableau national', nom_en: 'National dashboard' },
  // Un seul module commun à tous les hôpitaux : arrivées depuis les CHSLD, accueil, hospitalisations et retours (moteur de coordination commun)
  { code: 'liaison_chsld', categorie: 'hopital', types: ['hopital'], statut: 'disponible', drapeau: 'liaison_chsld', nom: 'Liaison CHSLD', nom_en: 'CHSLD liaison',
    note: 'Arrivées depuis les CHSLD, accueil, hospitalisations et retours', dependances: ['admissions_hopital', 'transferts'] },
  // CHSLD
  { code: 'residents', categorie: 'chsld', types: ['chsld'], statut: 'inclus', nom: 'Résidents et accueil', nom_en: 'Residents and admission', note: 'Dossier, contacts, autorisations, mouvements' },
  { code: 'chambres', categorie: 'chsld', types: ['chsld'], statut: 'inclus', nom: 'Chambres et lits', nom_en: 'Rooms and beds' },
  { code: 'demandes_hebergement', categorie: 'chsld', types: ['chsld'], statut: 'disponible', drapeau: 'demandes_hebergement', nom: 'Demandes d’hébergement', nom_en: 'Placement requests', dependances: ['residents'] },
  { code: 'entretien_chsld', categorie: 'chsld', types: ['chsld'], statut: 'disponible', drapeau: 'nettoyage', nom: 'Entretien et nettoyage', nom_en: 'Housekeeping and cleaning' },
  { code: 'taches', categorie: 'chsld', types: ['chsld'], statut: 'disponible', drapeau: 'taches', nom: 'Personnel et tâches', nom_en: 'Staff and tasks' },
  { code: 'proches', categorie: 'chsld', types: ['chsld'], statut: 'disponible', drapeau: 'proches', nom: 'Proches et communication', nom_en: 'Families and communication', dependances: ['residents'] },
  { code: 'hospitalisations', categorie: 'chsld', types: ['chsld'], statut: 'disponible', drapeau: 'hospitalisations', nom: 'Hospitalisations et retours', nom_en: 'Hospital stays and returns', dependances: ['residents'] },
  { code: 'reseau_chsld', categorie: 'chsld', types: ['chsld'], statut: 'disponible', drapeau: 'reseau_chsld', nom: 'Réseau inter-CHSLD', nom_en: 'Inter-CHSLD network', dependances: ['residents'] },
  // Optionnels, non implémentés : affichés, jamais activables
  // Optionnels : désactivés par défaut, activés seulement sur choix explicite (licence) ; démonstration et recette seulement
  { code: 'portail_proches', categorie: 'optionnel', types: ['chsld'], statut: 'disponible', drapeau: 'portail_proches', nom: 'Portail des proches (pilote)', nom_en: 'Family portal (pilot)', note: 'Invitation individuelle, révocable ; démonstration et recette', dependances: ['proches'] },
  { code: 'messagerie_securisee', categorie: 'optionnel', types: ['chsld'], statut: 'disponible', drapeau: 'portail_proches', nom: 'Messagerie sécurisée', nom_en: 'Secure messaging', note: 'Dans le portail des proches', dependances: ['portail_proches'] },
  { code: 'appels_video', categorie: 'optionnel', types: ['chsld'], statut: 'etude', nom: 'Appels audio et vidéo', nom_en: 'Audio and video calls', note: 'Étude seulement' },
];
const MODULE = new Map(MODULES.map((m) => [m.code, m]));
/** Drapeaux opérationnels modifiables (etablissements.modules) pour un type. */
const drapeaux = (type) => [...new Set(MODULES.filter((m) => m.types.includes(type) && m.statut === 'disponible' && m.drapeau).map((m) => m.drapeau))];

function catalogue(type) {
  return MODULES.filter((m) => !type || m.types.includes(type));
}
function exigerTypeOperationnel(type) {
  const { ErreurHttp } = require('./db');
  if (!Object.hasOwn(TYPES, type)) throw new ErreurHttp(400, 'type_etablissement_invalide');
  if (TYPES[type].statut !== 'operationnel') throw new ErreurHttp(409, 'type_etablissement_non_disponible');
}
/**
 * Choix de modules (codes → booléen) en drapeaux etablissements.modules : seuls les modules disponibles du type sont acceptés ;
 * un module à venir, à l'étude ou d'un autre type est refusé ; les dépendances doivent être satisfaites.
 */
function drapeauxDepuisChoix(type, choix = {}) {
  const { ErreurHttp } = require('./db');
  const resultat = {};
  for (const [code, actif] of Object.entries(choix || {})) {
    const m = MODULE.get(code);
    if (!m || !m.types.includes(type) || typeof actif !== 'boolean') throw new ErreurHttp(400, 'module_invalide', { module: code });
    if (['a_venir', 'etude'].includes(m.statut) && actif) throw new ErreurHttp(409, 'module_non_disponible', { module: code });
    if (m.statut === 'inclus' && !actif) throw new ErreurHttp(409, 'module_inclus', { module: code });
    if (m.statut === 'disponible' && m.drapeau && m.categorie === 'optionnel') { if (actif) resultat[m.drapeau] = true; }
    else if (m.statut === 'disponible' && m.drapeau && !actif) resultat[m.drapeau] = false;
    for (const d of (actif ? m.dependances || [] : [])) if (choix[d] === false) throw new ErreurHttp(409, 'module_dependance', { module: code, dependance: d });
  }
  return resultat;
}
/** Le module est-il actif pour cet établissement ? (inclus : toujours ; disponible : sauf drapeau à false) */
function moduleActif(etab, code) {
  const m = MODULE.get(code);
  if (!m || !m.types.includes(etab.type_etablissement || 'hopital')) return false;
  if (m.statut === 'inclus') return true;
  if (m.statut !== 'disponible') return false;
  // Optionnel : actif seulement s'il a été choisi ; sinon : actif sauf désactivation explicite
  return m.categorie === 'optionnel' ? (etab.modules || {})[m.drapeau] === true : (etab.modules || {})[m.drapeau] !== false;
}

/* Configuration propre aux CHSLD, dérivée du profil pays : unités d'hébergement et références de résidents R-00000. */
const UNITES_CHSLD = [['HLD', 'Hébergement de longue durée', 'Long-term care'], ['PROT', 'Unité prothétique', 'Secure memory care unit'],
  ['TEMP', 'Hébergement temporaire', 'Respite and temporary care']];
async function configChsld(c, profilId) {
  const base = (await c.query('SELECT * FROM config_pays WHERE id = $1', [profilId])).rows[0];
  const code = `${base.code}-CHSLD`;
  const existe = (await c.query('SELECT id FROM config_pays WHERE code = $1', [code])).rows[0];
  if (existe) return existe.id;
  const id = (await c.query(`INSERT INTO config_pays (code, nom, rayon_km, horizon_h, nettoyage_cible_min, reservation_max_min, marge_conge_min, hors_service_max_h,
      confirmation_lit_validite_min, reference_regex, reference_exemple, transport_libelle, fuseau)
    SELECT $2, nom || ' · CHSLD', rayon_km, 24, nettoyage_cible_min, 7 * 24 * 60, marge_conge_min, hors_service_max_h, 24 * 60, '^R-[0-9]{5}$', 'R-00000', transport_libelle, fuseau
      FROM config_pays WHERE id = $1 RETURNING id`, [profilId, code])).rows[0].id;
  for (const [i, [cu, nom, nomEn]] of UNITES_CHSLD.entries()) {
    await c.query('INSERT INTO types_unite (config_id, code, nom, ordre, nom_en) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING', [id, cu, nom, i + 1, nomEn]);
  }
  return id;
}
/** Nom local d'un type (affichage seulement) : vide ou absent = aucun nom local. */
function libelleType(valeur) {
  const { ErreurHttp } = require('./db');
  if (valeur === undefined || valeur === null || valeur === '') return null;
  const s = String(valeur).trim();
  if (s.length < 2 || s.length > 80 || /[\u0000-\u001f\u007f]/.test(s)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'type_libelle' });
  return s;
}
/** Drapeaux des modules optionnels (désactivés par défaut). */
const drapeauxOptionnels = (type) => [...new Set(MODULES.filter((m) => m.types.includes(type) && m.categorie === 'optionnel' && m.statut === 'disponible' && m.drapeau).map((m) => m.drapeau))];
module.exports = { libelleType, drapeauxOptionnels, TYPES, TYPES_OPERATIONNELS, MODULES, catalogue, drapeaux, exigerTypeOperationnel, drapeauxDepuisChoix, moduleActif, configChsld, UNITES_CHSLD };
