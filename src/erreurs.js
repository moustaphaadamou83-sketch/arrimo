/**
 * Messages d'erreur du serveur, par code stable.
 * La réponse est { erreur, code, vars } : l'interface traduit à partir du code (public/i18n/*.js)
 * et garde le texte français `erreur` en repli. Variables : {nom}. Une variable dont le nom finit par
 * « _etat » est un état de lit (libre, reserve…) affiché avec son libellé.
 */
const ETATS = { libre: 'Libre', reserve: 'Réservé', occupe: 'Occupé', occupee: 'Occupée', nettoyage: 'Nettoyage', indispo: 'Indisponible' };

const MESSAGES = {
  // connexion et compte
  identifiants_incorrects: 'Adresse courriel ou mot de passe incorrect.',
  trop_tentatives: 'Trop de tentatives. Réessayez dans quelques minutes.',
  etape_expiree: 'Étape expirée. Reprenez la connexion.',
  trop_essais: 'Trop d’essais. Reprenez la connexion.',
  code_incorrect_heure: 'Code incorrect. Vérifiez l’heure de votre téléphone et réessayez.',
  code_incorrect: 'Code incorrect.',
  mdp_faible: 'Le mot de passe doit contenir au moins 12 caractères, dont des lettres et des chiffres.',
  mdp_actuel_incorrect: 'Mot de passe actuel incorrect.',
  mdp_identique: 'Choisissez un mot de passe différent de l’actuel.',
  mdp_temporaire_dabord: 'Choisissez d’abord votre propre mot de passe.',
  connexion_requise: 'Connexion requise.',
  session_expiree: 'Session expirée. Reconnectez-vous.',
  deja_2fa: 'La double authentification est déjà active.',
  pas_2fa: 'La double authentification n’est pas active.',
  qr_dabord: 'Commencez par afficher le code QR.',
  jeton_invalide: 'Ce lien n’est plus valable. Demandez-en un nouveau.',
  courriel_non_configure: 'L’envoi de courriels n’est pas encore configuré. Demandez une réinitialisation à votre administrateur.',
  trop_requetes: 'Trop de requêtes. Patientez quelques secondes et réessayez.',
  // accès
  etab_interdit: "Vous n'avez pas accès à cet établissement.",
  role_entretien: 'Votre rôle donne accès à l’écran Nettoyage seulement.',
  reserve_admin: 'Réservé aux administrateurs.',
  admin_exige_2fa: 'Activez la double authentification (Mon compte) pour accéder à l’administration.',
  reserve_gestionnaire: 'Réservé au gestionnaire réseau.',
  module_inactif: "Le module n'est pas activé pour {etab}. L'activation se fait depuis SH.",
  module_inactif_etab: "Le module n'est pas activé pour cet établissement.",
  demo_desactivee: 'La remise à zéro n’est possible que sur un serveur de démonstration.',
  // requêtes
  parametre_invalide: 'Paramètre {nom} invalide.',
  action_inconnue: 'Action inconnue.',
  date_invalide: 'Date invalide.',
  rien_a_modifier: 'Rien à modifier.',
  requete_mal_formee: 'Requête mal formée.',
  requete_trop_grosse: 'Requête trop volumineuse.',
  erreur_interne: 'Erreur interne. Réessayez ; si le problème persiste, contactez le support.',
  // lits
  lit_introuvable: 'Lit introuvable.',
  etat_inconnu: 'État inconnu.',
  lit_verrouille: 'Ce lit est en cours de modification par quelqu’un d’autre. Réessayez.',
  lit_deja_modifie: 'Le lit {code} vient d’être modifié par quelqu’un d’autre. Rafraîchissez et choisissez un autre lit.',
  transition_interdite: 'Transition interdite pour {code} : {de_etat} → {vers_etat}.',
  lit_transfert_en_cours: 'Ce lit est lié au transfert {numero} en cours. Refusez le transfert pour le libérer.',
  motif_requis: 'Indiquez le motif : personnel, équipement, travaux, infection ou autre.',
  reference_invalide: "Référence patient invalide. Format attendu : {exemple}. N'inscrivez aucune information médicale.",
  lit_non_occupe: "Le lit {code} n'est pas occupé.",
  conge_lit_occupe: 'Le congé prévu ne se règle que sur un lit occupé.',
  orientation_inconnue: 'Orientation NSA inconnue.',
  conge_statut_inconnu: 'Statut de congé inconnu.',
  nettoyage_impossible: 'Ce lit n’est pas en attente de nettoyage, ou le nettoyage a déjà commencé.',
  // civières de l'urgence
  civiere_introuvable: 'Civière introuvable.',
  civiere_verrouillee: 'Cette civière est en cours de modification par quelqu’un d’autre. Réessayez.',
  civiere_deja_modifiee: 'La civière {code} vient d’être modifiée par quelqu’un d’autre. Rafraîchissez la page.',
  civiere_demande_active: 'Le patient de la civière {code} a une demande de lit en cours. Admettez-le, ou annulez la demande d’abord.',
  patient_deja_sur_civiere: 'Le patient {ref} est déjà sur la civière {code}.',
  civiere_cible_invalide: 'Choisissez une autre civière libre de la même urgence.',
  civiere_non_occupee: 'Aucun patient sur la civière {code}.',
  civiere_invalide: 'Cette civière n’a pas de patient dans votre urgence.',
  civiere_deja_demande: 'Le patient de la civière {code} a déjà une demande de lit en cours.',
  civiere_patient_different: 'La civière {code} est occupée par {ref} : vérifiez la référence.',
  code_civiere_invalide: 'Code de civière invalide (lettres, chiffres, tirets).',
  code_civiere_existe: 'Ce code de civière existe déjà dans l’établissement.',
  categorie_invalide: 'Catégorie de civière invalide : régulière ou débordement.',
  // admissions
  type_unite_inconnu: "Type d'unité inconnu.",
  demande_introuvable: 'Demande introuvable.',
  demande_plus_en_attente: 'Cette demande n’est plus en attente. Rafraîchissez la page.',
  demande_terminee: 'Cette demande est déjà terminée.',
  lit_inadapte: 'Ce lit ne correspond pas au type d’unité ou aux besoins du patient.',
  assigner_dabord: 'Assignez d’abord un lit.',
  // transferts
  etab_introuvable: 'Établissement introuvable.',
  autre_etab: 'Choisissez un autre établissement que le vôtre.',
  etab_ne_partage_pas: 'Cet établissement ne partage pas sa capacité.',
  hors_rayon: 'Établissement hors du rayon de suggestion.',
  lit_propose_invalide: 'Lit proposé invalide ou ne répondant pas aux besoins du patient.',
  plus_de_lit: 'Plus aucun lit libre à {etab}. Relancez la recherche.',
  transfert_introuvable: 'Transfert introuvable.',
  action_revient_a: 'Cette action revient à {etab}.',
  transfert_statut: 'Le transfert {numero} n’est plus au statut attendu. Rafraîchissez la page.',
  // administration
  etab_non_administre: "Vous n'administrez pas cet établissement.",
  etabs_non_administres: "Vous n'administrez pas tous ces établissements.",
  role_inconnu: 'Rôle inconnu.',
  role_gestionnaire_interdit: 'Seul le gestionnaire réseau peut créer ce rôle.',
  compte_sans_etab: 'Rattachez le compte à au moins un établissement.',
  compte_autre_admin: "Ce compte dépend d'un autre administrateur.",
  compte_introuvable: 'Compte introuvable.',
  courriel_invalide: 'Adresse courriel invalide.',
  nom_requis: 'Nom requis.',
  compte_existe: 'Un compte existe déjà avec cette adresse.',
  desactiver_soi: 'Vous ne pouvez pas désactiver votre propre compte.',
  nom_unite_requis: 'Nom de l’unité requis.',
  type_unite_pays: "Type d'unité inconnu pour ce pays.",
  unite_introuvable: 'Unité introuvable.',
  numero_chambre_requis: 'Numéro de chambre requis.',
  chambre_existe: 'Cette chambre existe déjà dans l’unité.',
  chambre_introuvable: 'Chambre introuvable.',
  code_lit_invalide: 'Code de lit invalide (lettres, chiffres, tirets).',
  code_lit_existe: 'Ce code de lit existe déjà dans l’établissement.',
  valeur_invalide: 'Valeur invalide pour {champ}.',
  facteur_route: 'Le facteur de route doit être entre 1 et 3.',
  protocoles_incomplets: 'Protocoles incomplets.',
  config_introuvable: 'Configuration introuvable.',
  seuils_croissants: 'Les seuils doivent être croissants : jaune < orange ≤ rouge.',
  partage_invalide: 'Partage invalide.',
  sh_non_configure: 'Activation SH non configurée sur ce serveur.',
  cle_sh_invalide: 'Clé SH invalide.',
  // connecteurs
  connecteur_reseau_gestionnaire: 'Seul le gestionnaire réseau crée un connecteur réseau.',
  connecteur_introuvable: 'Connecteur introuvable.',
  connecteur_cle_manquante: 'Clé de connecteur manquante.',
  connecteur_cle_invalide: 'Clé de connecteur invalide.',
  connecteur_lecture: 'Ce connecteur est en lecture seulement.',
  identifiant_requis: 'identifiant requis (ex. MSH-10 du message HL7).',
  evenement_invalide: 'evenement doit être : {liste}.',
  lit_inconnu: 'Lit {code} inconnu dans cet établissement.',
  admission_impossible: 'Lit {code} à l’état {lit_etat} : impossible d’y admettre {ref}.',
};

function formater(modele, vars = {}) {
  return modele.replace(/\{(\w+)\}/g, (m, k) => {
    if (vars[k] === undefined) return m;
    return k.endsWith('_etat') ? (ETATS[vars[k]] || vars[k]) : String(vars[k]);
  });
}

module.exports = { MESSAGES, formater, ETATS };
