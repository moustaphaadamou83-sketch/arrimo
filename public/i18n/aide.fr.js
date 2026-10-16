/* Arrimo — aide intégrée en français : rôle, écrans, premiers pas. */
window.ARRIMO_I18N = window.ARRIMO_I18N || {};
window.ARRIMO_I18N.fr = window.ARRIMO_I18N.fr || {};
window.ARRIMO_I18N.fr.aide = {
  titre: 'Aide', bouton: 'Aide', fermer: 'Fermer', votre_role: 'Votre rôle', cet_ecran: 'Cet écran : {ecran}', a_quoi: 'À quoi il sert',
  gestes: 'Gestes principaux', erreurs: 'Messages fréquents et quoi faire', autres: 'Autres écrans', revoir: 'Revoir les premiers pas',
  contact: 'Une question ? Contactez la coordination des lits de votre établissement ou le gestionnaire réseau.',
  roles: {
    coordonnateur: {
      titre: 'Coordination des lits et urgence',
      texte: 'Vous suivez la capacité de votre établissement, attribuez les lits aux patients qui attendent et organisez les transferts. '
        + 'À l’urgence, vous ajoutez les patients à la file d’admission (onglet Admissions) et suivez l’attribution de leur lit.',
    },
    entretien: {
      titre: 'Entretien',
      texte: 'Vous voyez seulement l’écran Nettoyage : la liste des lits à nettoyer dans l’ordre recommandé. Commencez par le haut de la liste, '
        + 'appuyez sur « Commencer » en arrivant dans la chambre, puis sur « Terminé ».',
    },
    admin_etab: {
      titre: 'Administration d’établissement',
      texte: 'En plus des écrans de coordination, vous gérez les comptes, les unités, les chambres, les lits et les connecteurs de vos établissements. '
        + 'La double authentification est obligatoire pour entrer dans l’Administration.',
    },
    gestionnaire: {
      titre: 'Gestionnaire réseau',
      texte: 'Vous voyez tout le réseau. Vous gérez la configuration du pays (seuils, rayon, protocoles), l’activation des établissements, '
        + 'les comptes et les connecteurs réseau. La double authentification est obligatoire pour entrer dans l’Administration.',
    },
  },
  ecrans: {
    copilote: {
      nom: 'Copilote',
      but: 'Le résumé de la situation pour la réunion de gestion des lits : niveau d’alerte, recommandations classées et réponses à vos questions. Le Copilote propose ; vous décidez.',
      gestes: [
        'Lisez le bandeau de niveau : la pression compte les patients qui attendent un lit.',
        'Traitez les recommandations « Urgent » d’abord ; chacune explique pourquoi.',
        'Cliquez sur le bouton d’une recommandation pour l’appliquer : rien ne se fait sans votre clic.',
        'Posez une question ou choisissez un exemple (« Que faire en priorité ? »).',
      ],
      erreurs: [
        ['« Le lit … vient d’être modifié par quelqu’un d’autre »', 'Un collègue a agi avant vous. La page se met à jour : choisissez la recommandation suivante.'],
        ['« Le Copilote est disponible une fois le module activé »', 'Votre établissement n’est pas encore activé. Contactez le gestionnaire réseau.'],
      ],
    },
    reseau: {
      nom: 'Réseau',
      but: 'La capacité des établissements voisins et la recherche d’un lit ailleurs, du plus proche au plus loin, en évitant les hôpitaux débordés.',
      gestes: [
        'Choisissez le type d’unité, entrez la référence patient et cochez les besoins (isolement, ventilation…).',
        'Cliquez sur « Rechercher » : l’établissement recommandé est en tête, avec la raison.',
        'Cliquez sur « Proposer », vérifiez le résumé, puis « Valider et réserver ».',
        'Surveillez les « Blocages détectés » : lits qui ne tournent pas alors qu’ils le devraient.',
      ],
      erreurs: [
        ['« Référence patient invalide »', 'Utilisez le format affiché (ex. P-00000). N’inscrivez jamais de nom ni de diagnostic.'],
        ['« Plus aucun lit libre à … »', 'Le dernier lit vient d’être pris. Relancez la recherche.'],
      ],
    },
    lits: {
      nom: 'Lits',
      but: 'Tous les lits de l’établissement par état : libre, réservé, occupé, nettoyage, indisponible. Chaque changement est journalisé.',
      gestes: [
        'Filtrez par unité avec les pastilles du haut.',
        'Réservez un lit libre avec la référence du patient, puis « Admettre » à son arrivée.',
        'Au départ du patient, « Libérer » : le lit passe en nettoyage.',
        'Inscrivez un congé prévu ou désignez un patient NSA depuis un lit occupé.',
        'Mettez un lit hors service avec son motif (manque de personnel, équipement…).',
      ],
      erreurs: [
        ['« Transition interdite »', 'Le cycle est fixe : libre → réservé → occupé → nettoyage → libre. Suivez l’ordre.'],
        ['« Ce lit est lié au transfert … en cours »', 'Refusez le transfert dans l’onglet Transferts pour libérer le lit.'],
      ],
    },
    admissions: {
      nom: 'Admissions',
      but: 'La file des patients qui attendent un lit, souvent sur civière à l’urgence, avec le meilleur lit libre adapté à leurs besoins.',
      gestes: [
        'Ajoutez une demande : type d’unité, référence patient, priorité, provenance et besoins.',
        'Cliquez sur « Assigner » pour réserver le lit proposé.',
        'Sans lit adapté ici, « Chercher ailleurs » propose l’établissement le plus proche qui en a un.',
        'À l’arrivée du patient dans l’unité, cliquez sur « Admettre ».',
      ],
      erreurs: [
        ['« Cette demande n’est plus en attente »', 'Un collègue l’a déjà traitée. La file se met à jour.'],
        ['« Ce lit ne correspond pas … aux besoins du patient »', 'Choisissez un lit qui a l’équipement demandé, ou cherchez ailleurs.'],
      ],
    },
    transferts: {
      nom: 'Transferts',
      but: 'Les transferts entrants et sortants, étape par étape. Chaque étape revient à l’établissement concerné.',
      gestes: [
        'Receveur : « Accepter » ou « Refuser » une demande (le lit est déjà bloqué pour le patient).',
        'Demandeur : « Organiser le transport », puis « Confirmer le départ ».',
        'Receveur : « Confirmer la réception » ; le lit devient occupé.',
      ],
      erreurs: [
        ['« Cette action revient à … »', 'C’est à l’autre établissement d’agir. La carte indique qui est attendu.'],
        ['« Le transfert … n’est plus au statut attendu »', 'Quelqu’un a déjà fait l’étape. La page se met à jour.'],
      ],
    },
    nettoyage: {
      nom: 'Nettoyage',
      but: 'Les lits à nettoyer, dans l’ordre recommandé : les unités où des patients attendent un lit passent en premier.',
      gestes: [
        'Prenez le lit en haut de la liste.',
        'Appuyez sur « Commencer » en entrant dans la chambre.',
        'Appuyez sur « Terminé » quand la chambre est prête : le lit redevient libre partout.',
      ],
      erreurs: [
        ['« Ce lit n’est pas en attente de nettoyage »', 'Le nettoyage a déjà été commencé ou confirmé par un collègue.'],
        ['« Votre rôle donne accès à l’écran Nettoyage seulement »', 'C’est normal : les autres écrans sont réservés à la coordination.'],
      ],
    },
    nsa: {
      nom: 'NSA',
      but: 'Les patients qui n’ont plus besoin de soins aigus et attendent une autre ressource (CHSLD, ressource intermédiaire…), comparés à la cible.',
      gestes: [
        'Suivez le taux NSA par rapport à la cible.',
        'Mettez à jour l’orientation attendue de chaque patient.',
        'Retirez le statut NSA quand le patient a de nouveau besoin de soins aigus.',
      ],
      erreurs: [
        ['« Le lit … n’est pas occupé »', 'Le statut NSA ne s’applique qu’à un lit occupé.'],
      ],
    },
    indicateurs: {
      nom: 'Indicateurs',
      but: 'Les chiffres pour suivre les progrès et alimenter les rapports : occupation, attente avant lit, délais de transfert, refus, nettoyage.',
      gestes: [
        'Choisissez la période (7, 30 ou 90 jours).',
        'Comparez la durée de nettoyage à la cible.',
        'Exportez en CSV pour vos rapports.',
      ],
      erreurs: [
        ['« Export impossible »', 'Votre session a peut-être expiré. Reconnectez-vous et réessayez.'],
      ],
    },
    journal: {
      nom: 'Journal',
      but: 'Qui a changé quoi, et quand, y compris les tentatives refusées. Le journal ne peut être ni modifié ni supprimé.',
      gestes: [
        'Repérez une action par son lit ou son numéro de transfert.',
        'Les actions refusées apparaissent en rouge, avec leur motif.',
      ],
      erreurs: [],
    },
    params: {
      nom: 'Paramètres',
      but: 'La configuration en vigueur (rayon, horizon de prévision, cibles) et l’activation des établissements.',
      gestes: [
        'Vérifiez les valeurs utilisées par Arrimo.',
        'Gestionnaire réseau : activez un établissement ou changez son niveau de partage.',
      ],
      erreurs: [
        ['« Réservé au gestionnaire réseau »', 'Seul le gestionnaire réseau modifie l’activation et le partage.'],
      ],
    },
    admin: {
      nom: 'Administration',
      but: 'Les comptes, les unités, chambres et lits, la configuration du pays, les connecteurs et le journal d’administration.',
      gestes: [
        'Activez d’abord la double authentification dans Mon compte.',
        'Créez un compte : un mot de passe temporaire s’affiche une seule fois ; transmettez-le par un moyen sûr.',
        'Réinitialisez le mot de passe d’une personne qui l’a oublié.',
        'Ajoutez unités, chambres et lits, et cochez leur équipement.',
        'Créez un connecteur pour le système de l’hôpital ; la clé ne s’affiche qu’une fois.',
      ],
      erreurs: [
        ['« Activez la double authentification »', 'Allez dans Mon compte, scannez le code QR, entrez le code à 6 chiffres.'],
        ['« Un compte existe déjà avec cette adresse »', 'Cherchez la personne dans la liste ; réactivez ou réinitialisez son compte.'],
      ],
    },
    compte: {
      nom: 'Mon compte',
      but: 'Votre mot de passe, la double authentification et la langue de l’interface.',
      gestes: [
        'Changez votre mot de passe : au moins 12 caractères, avec des lettres et des chiffres.',
        'Activez la double authentification avec une application (Microsoft Authenticator, Google Authenticator…).',
        'Choisissez la langue de l’interface.',
      ],
      erreurs: [
        ['« Code incorrect. Vérifiez l’heure de votre téléphone »', 'L’heure du téléphone doit être automatique. Réessayez avec le code suivant.'],
        ['« Mot de passe actuel incorrect »', 'Vérifiez la saisie. En cas d’oubli, demandez une réinitialisation à votre administrateur.'],
      ],
    },
  },
  premiers_pas: {
    titre: 'Premiers pas dans Arrimo',
    intro: 'Arrimo aide à trouver le bon lit, au bon endroit, plus vite. Voici l’essentiel pour commencer.',
    commun: [
      'Aucune donnée médicale : seulement une référence patient (ex. P-00000). Jamais de nom ni de diagnostic.',
      'Chaque action est journalisée. Un lit ne peut être pris qu’une fois.',
      'Le bouton « Aide », en haut, explique l’écran où vous êtes.',
    ],
    roles: {
      coordonnateur: ['Commencez par l’onglet Copilote : niveau d’alerte et recommandations.', 'À l’urgence, ajoutez les patients dans l’onglet Admissions.'],
      entretien: ['Votre écran est Nettoyage : prenez le lit en haut de la liste.', 'Appuyez sur « Commencer », puis sur « Terminé ».'],
      admin_etab: ['Activez la double authentification dans Mon compte avant d’entrer dans l’Administration.', 'Créez les comptes de votre équipe et vérifiez vos unités et lits.'],
      gestionnaire: ['Activez la double authentification dans Mon compte avant d’entrer dans l’Administration.', 'Le Copilote montre le niveau de chaque hôpital et les délestages possibles.'],
    },
    ok: 'J’ai compris',
  },
};
