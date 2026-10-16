/* Arrimo — pages légales en français. PROJET DE TEXTE à faire valider par un avocat. Les champs [entre crochets] sont à remplir. */
window.ARRIMO_LEGAL = window.ARRIMO_LEGAL || {};
window.ARRIMO_LEGAL.fr = {
  avertissement: 'Projet de texte à faire valider par un avocat. Ce document n’a pas encore de valeur juridique.',
  mise_a_jour: 'Dernière mise à jour : {date}',
  retour: 'Retour à Arrimo',
  autre_page: { confidentialite: 'Conditions d’utilisation', conditions: 'Politique de confidentialité' },
  a_remplir: '[à remplir]',
  confidentialite: {
    titre: 'Politique de confidentialité',
    sections: [
      ['Qui sommes-nous', [
        'Arrimo est un outil de coordination des lits hospitaliers et des transferts entre établissements de santé.',
        'Entité responsable : {entite}. Adresse : {adresse}.',
      ]],
      ['Responsable de la protection des renseignements personnels', [
        'Conformément à la Loi sur la protection des renseignements personnels dans le secteur privé (Loi 25), la personne responsable est : {responsable}.',
        'Pour toute question ou demande : {contact}.',
      ]],
      ['Renseignements que nous recueillons', [
        'Comptes d’utilisateurs : nom, adresse courriel professionnelle, rôle, établissements rattachés, date de dernière connexion. Le mot de passe est conservé sous forme chiffrée (empreinte irréversible) ; le secret de double authentification est conservé pour vérifier les codes.',
        'Journaux : chaque action sur un lit, un transfert ou un compte est inscrite avec sa date, son auteur et son résultat, y compris les tentatives refusées.',
        'Références patient pseudonymisées : une référence de format convenu (ex. P-00000), attribuée par l’établissement, sans nom, date de naissance ni numéro d’assurance maladie.',
        'Aucune donnée clinique : Arrimo ne recueille aucun diagnostic, résultat, traitement ni note clinique. Les besoins de lit (isolement, ventilation…) décrivent l’équipement du lit, pas l’état de santé.',
        'Données techniques : adresse IP et date des requêtes dans les journaux du serveur, pour la sécurité. Le navigateur conserve localement le jeton de session, la langue et l’établissement choisis ; Arrimo n’utilise aucun témoin publicitaire ni outil de suivi.',
      ]],
      ['Pourquoi nous les utilisons', [
        'Permettre aux équipes autorisées de voir la capacité, d’attribuer les lits et d’organiser les transferts.',
        'Assurer la sécurité : authentification, double authentification, détection des accès anormaux.',
        'Garder une trace vérifiable des décisions (qui a fait quoi, et quand).',
        'Produire des indicateurs agrégés pour mesurer la fluidité (délais, taux de refus, durée de nettoyage).',
      ]],
      ['Durée de conservation', [
        'Comptes : pendant la durée du service, puis {duree_comptes} après la fermeture du compte.',
        'Journaux : {duree_journaux}. Les journaux ne peuvent être ni modifiés ni supprimés pendant cette durée.',
        'Sessions : 12 heures au plus. Sauvegardes : 14 jours.',
        'Références patient : {duree_references}.',
      ]],
      ['Sécurité', [
        'Connexion chiffrée (HTTPS), mots de passe chiffrés, double authentification obligatoire pour l’administration.',
        'Accès limité par rôle et par établissement ; chaque établissement choisit ce qu’il partage avec le réseau.',
        'Journaux immuables, sauvegardes quotidiennes vérifiées.',
        'Mode IA du Copilote : désactivé par défaut. S’il est activé, seules des données agrégées, sans référence patient, sont transmises au fournisseur retenu, après évaluation.',
      ]],
      ['Hébergement', [
        'Serveur de démonstration : hébergé hors du Canada, avec des données entièrement fictives.',
        'Projet pilote : hébergement au Canada, après évaluation des facteurs relatifs à la vie privée. Fournisseur : {hebergeur}.',
      ]],
      ['Communication à des tiers', [
        'Les renseignements ne sont ni vendus ni loués. Ils sont communiqués seulement aux établissements autorisés du réseau, selon le partage choisi, et aux fournisseurs qui hébergent ou maintiennent le service, liés par contrat.',
      ]],
      ['Vos droits', [
        'Vous pouvez demander l’accès aux renseignements qui vous concernent, leur rectification ou, lorsque la loi le permet, leur suppression.',
        'Les entrées des journaux ne sont pas modifiées : une correction est ajoutée comme nouvelle entrée.',
        'Vous pouvez porter plainte auprès de la Commission d’accès à l’information du Québec.',
        'Pour exercer vos droits : {contact}. Nous répondons dans un délai de 30 jours.',
      ]],
      ['Incidents de confidentialité', [
        'Tout incident est consigné au registre des incidents. S’il présente un risque de préjudice sérieux, nous avisons la Commission d’accès à l’information et les personnes concernées.',
      ]],
      ['Modifications', [
        'Toute modification de cette politique est publiée sur cette page avec sa date.',
      ]],
    ],
  },
  conditions: {
    titre: 'Conditions d’utilisation',
    sections: [
      ['Objet', [
        'Ces conditions encadrent l’utilisation d’Arrimo par les personnes autorisées des établissements participants.',
      ]],
      ['Accès', [
        'Un compte est personnel et ne doit pas être partagé. Vous gardez votre mot de passe confidentiel et activez la double authentification lorsqu’elle est demandée.',
        'Signalez sans délai toute perte d’appareil ou tout accès suspect à votre administrateur.',
      ]],
      ['Données saisies', [
        'N’inscrivez jamais de nom de patient, de diagnostic ni d’autre information clinique. Utilisez seulement la référence patient prévue.',
        'Sur le serveur de démonstration, n’utilisez que des données fictives.',
      ]],
      ['Décisions', [
        'Arrimo, y compris son Copilote, propose : la décision revient toujours à une personne autorisée. Aucune action n’est faite automatiquement.',
        'Arrimo ne remplace ni le jugement clinique, ni les procédures de l’établissement, ni les systèmes d’information cliniques.',
      ]],
      ['Disponibilité', [
        'Nous faisons des efforts raisonnables pour assurer la disponibilité du service. En cas d’indisponibilité, suivez les procédures habituelles de l’établissement (téléphone, tableaux).',
        'Le serveur de démonstration peut être remis à zéro à tout moment.',
      ]],
      ['Responsabilité', [
        'Dans les limites permises par la loi, la responsabilité est encadrée par l’entente signée avec chaque établissement : {entente}.',
      ]],
      ['Propriété intellectuelle', [
        'Arrimo et ses contenus appartiennent à {entite}. Les données saisies appartiennent aux établissements qui les fournissent.',
      ]],
      ['Droit applicable', [
        'Ces conditions sont régies par les lois du Québec et les lois du Canada qui s’y appliquent.',
      ]],
      ['Contact', [
        '{contact}',
      ]],
    ],
  },
};
