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
    ['module_active', 'Module activé'],
    ['premier_jour', 'Premier jour accompagné'],
  ] },
  { code: 'production', nom: 'Production', elements: [
    ['suivi_30_jours', 'Suivi à 30 jours'],
    ['bilan', 'Bilan avec l’hôpital'],
  ] },
];
const RANG_GOLIVE = 6;
// Élément coché automatiquement par un import réussi
const ELEMENT_IMPORT = { unites: 'import_unites', chambres: 'import_chambres', lits: 'import_lits', civieres: 'import_civieres', utilisateurs: 'import_utilisateurs' };

/** Crée les 7 étapes et leurs éléments pour un nouvel hôpital. */
async function creerEtapes(c, hopitalId) {
  for (const [i, e] of ETAPES.entries()) {
    const id = (await c.query('INSERT INTO etapes (hopital_id, rang, code) VALUES ($1, $2, $3) RETURNING id', [hopitalId, i + 1, e.code])).rows[0].id;
    for (const [j, [code, libelle]] of e.elements.entries()) {
      await c.query('INSERT INTO verifications (etape_id, rang, code, libelle) VALUES ($1, $2, $3, $4)', [id, j + 1, code, libelle]);
    }
  }
}

module.exports = { ETAPES, RANG_GOLIVE, ELEMENT_IMPORT, creerEtapes };
