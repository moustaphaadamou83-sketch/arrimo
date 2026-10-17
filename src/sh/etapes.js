/**
 * Projet d'implantation d'un hôpital : 7 étapes, chacune avec sa liste de vérification.
 * L'activation du module n'est possible que si toutes les étapes avant le go-live sont cochées (rangs 1 à 5).
 * Certains éléments se cochent seuls : un import réussi coche l'élément correspondant, l'activation coche « Module activé ».
 */
const ETAPES = [
  { code: 'contrat', nom: 'Contrat', elements: [
    ['contrat_signe', 'Contrat signé'],
    ['entente_confidentialite', 'Entente de confidentialité (Loi 25) signée'],
    ['responsable_hopital', 'Responsable désigné à l’hôpital'],
  ] },
  { code: 'configuration', nom: 'Configuration', elements: [
    ['etablissement_cree', 'Établissement créé dans l’environnement'],
    ['position_verifiee', 'Position et rayon des alertes vérifiés'],
    ['lien_defini', 'Lien propre de l’hôpital défini'],
  ] },
  { code: 'import', nom: 'Import des données', elements: [
    ['import_unites', 'Unités importées'],
    ['import_chambres', 'Chambres importées'],
    ['import_lits', 'Lits importés'],
    ['import_civieres', 'Civières importées'],
    ['import_utilisateurs', 'Comptes importés et transmis'],
  ] },
  { code: 'tests', nom: 'Tests', elements: [
    ['scenarios_realises', 'Scénarios de test réalisés en recette'],
    ['anomalies_corrigees', 'Anomalies corrigées'],
    ['validation_hopital', 'Validation par l’hôpital'],
  ] },
  { code: 'formation', nom: 'Formation', elements: [
    ['formation_coordination', 'Coordination et urgence formées'],
    ['formation_entretien', 'Équipe d’entretien formée'],
    ['formation_admin', 'Administrateurs formés'],
  ] },
  { code: 'golive', nom: 'Go-live', elements: [
    ['production_importee', 'Structure et comptes importés en production'],
    ['module_active', 'Module activé'],
    ['premier_jour', 'Premier jour accompagné'],
  ] },
  { code: 'production', nom: 'Production', elements: [
    ['suivi_30_jours', 'Suivi à 30 jours'],
    ['bilan', 'Bilan avec l’hôpital'],
  ] },
];
const RANG_GOLIVE = 6;

/**
 * Parcours de formation : une liste de vérification par rôle, cochée au fil des séances.
 * Quand un rôle est entièrement coché, l'élément correspondant de l'étape Formation se coche seul.
 */
const FORMATION = [
  { role: 'coordination', nom: 'Coordination des lits', element: 'formation_coordination', elements: [
    ['copilote', 'Lire le Copilote et décider de ses recommandations'],
    ['lits', 'Réserver, admettre et libérer un lit'],
    ['admissions', 'Gérer la file d’admission et attribuer un lit'],
    ['conges', 'Indiquer un congé prévu et un patient NSA'],
    ['transferts', 'Demander, accepter et suivre un transfert'],
  ] },
  { role: 'urgence', nom: 'Urgence', element: 'formation_coordination', elements: [
    ['civiere', 'Placer un patient sur une civière'],
    ['changer', 'Changer un patient de civière'],
    ['demande', 'Demander un lit pour un patient sur civière'],
    ['durees', 'Lire les durées de séjour (plus de 24 h, plus de 48 h)'],
  ] },
  { role: 'entretien', nom: 'Entretien', element: 'formation_entretien', elements: [
    ['ecran', 'Ouvrir l’écran Nettoyage sur la tablette'],
    ['nettoyage', 'Commencer et terminer un nettoyage'],
    ['priorites', 'Comprendre l’ordre des priorités'],
  ] },
  { role: 'administration', nom: 'Administration', element: 'formation_admin', elements: [
    ['comptes', 'Créer un compte et réinitialiser un mot de passe'],
    ['double', 'Activer la double authentification'],
    ['structure', 'Modifier la structure (unités, chambres, lits)'],
    ['journal', 'Lire le journal d’administration'],
  ] },
];
// Éléments cochés seulement par la console (activation, parcours de formation)
const ELEMENTS_AUTOMATIQUES = ['module_active', ...new Set(FORMATION.map((f) => f.element))];
// Élément coché automatiquement par un import réussi
const ELEMENT_IMPORT = { unites: 'import_unites', chambres: 'import_chambres', lits: 'import_lits', civieres: 'import_civieres', utilisateurs: 'import_utilisateurs' };

/** Crée les 7 étapes, leurs éléments et le parcours de formation (ce qui manque seulement : rejouable sur un hôpital existant). */
async function creerEtapes(c, hopitalId) {
  for (const [i, e] of ETAPES.entries()) {
    await c.query('INSERT INTO etapes (hopital_id, rang, code) VALUES ($1, $2, $3) ON CONFLICT (hopital_id, rang) DO NOTHING', [hopitalId, i + 1, e.code]);
    const id = (await c.query('SELECT id FROM etapes WHERE hopital_id = $1 AND rang = $2', [hopitalId, i + 1])).rows[0].id;
    for (const [j, [code, libelle]] of e.elements.entries()) {
      await c.query('INSERT INTO verifications (etape_id, rang, code, libelle) VALUES ($1, $2, $3, $4) ON CONFLICT (etape_id, code) DO UPDATE SET rang = EXCLUDED.rang', [id, j + 1, code, libelle]);
    }
  }
  for (const f of FORMATION) {
    await c.query('INSERT INTO formation_roles (hopital_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING', [hopitalId, f.role]);
    for (const [j, [code, libelle]] of f.elements.entries()) {
      await c.query('INSERT INTO formation_elements (hopital_id, role, rang, code, libelle) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING', [hopitalId, f.role, j + 1, code, libelle]);
    }
  }
}

module.exports = { ETAPES, RANG_GOLIVE, ELEMENT_IMPORT, FORMATION, ELEMENTS_AUTOMATIQUES, creerEtapes };
