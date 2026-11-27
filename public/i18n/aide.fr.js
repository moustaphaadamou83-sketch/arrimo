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
      texte: 'Vous voyez seulement l’écran Nettoyage : la liste des lits à nettoyer dans l’ordre recommandé. Commencez par le haut de la liste (lits et civières de l’urgence), '
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
    'mes-taches': {
      nom: 'Mes tâches',
      but: 'Retrouver en un seul endroit toutes vos tâches : préparation de chambre, nettoyage, administratif, transmissions et relances.',
      gestes: [
        'Choisissez une catégorie : à faire, en cours, en retard, prioritaires ou terminées aujourd’hui.',
        'Chaque carte indique quoi faire, où, quand et la priorité ; « Commencer » puis « Terminer ».',
        'Responsable : attribuez une tâche à une personne ou remettez-la dans la file du rôle.',
        'Responsable : les paramètres du module (échéance par défaut, priorité, délai de nettoyage, types d’intervention) sont en bas de l’écran.',
      ],
      erreurs: [['Chambre propre confirmée par l’entretien', 'Quand un compte d’entretien est actif, seule l’équipe d’entretien confirme qu’une chambre est propre.']],
    },
    flux: {
      nom: 'Arrimo Flux',
      but: 'Voir d’un coup d’œil qui arrive et qui part : transports, transferts, départs vers l’hébergement et ambulances, avec l’heure prévue, l’heure réelle et l’arrivée estimée quand elle est connue.',
      gestes: [
        'Filtrez par arrivées, départs, aujourd’hui ou demain.',
        'Une préalerte d’arrivée à acquitter apparaît en tête : cliquez sur « Accuser réception ».',
        'La colonne Préparation indique si la chambre est prête, en préparation ou à vérifier.',
        'Ouvrez la fiche d’un mouvement pour voir sa chronologie complète, avec l’auteur de chaque étape.',
      ],
      erreurs: [['ETA indisponible', 'Aucune préalerte ni position ne permet d’estimer l’arrivée : rien n’est inventé.']],
    },
    dsn: {
      nom: 'Dossier santé (démo)',
      but: 'Dossier clinique de démonstration (patients entièrement fictifs) : allergies, antécédents, consultations, séjours sur de vrais lits, prescriptions simulées et paquets de transition.',
      gestes: [
        'Ouvrez un patient, puis le sous-onglet voulu (Hospitalisations, Prescriptions…).',
        'Une admission se fait sur un lit libre réel : il est réservé puis occupé dans Lits.',
        'Préparez une transition : choisissez les éléments à partager, validez-la, puis envoyez-la.',
      ],
      erreurs: [['Lit non disponible', 'Choisissez un lit libre ; le lit d’un séjour se change dans Lits.']],
    },
    patients: {
      nom: 'Patients',
      but: 'Retrouver un patient fictif (démonstration et recette), vérifier son identité et consulter ses passages : arrivées, demandes de lit, transferts et mouvements. Historique administratif seulement, sans donnée clinique.',
      gestes: [
        'Cherchez par nom, prénom ou référence (P-…).',
        'Cliquez sur « Historique », comparez l’identité avec la personne, puis confirmez : la consultation est journalisée.',
        'Ouvrez un nouveau passage (consultation ou admission) ; pour une arrivée à l’urgence, indiquez la référence existante dans « Arrivée à l’urgence » pour éviter un doublon.',
        'Clôturez le passage avec son résultat (sorti, hospitalisé, transféré, annulé).',
      ],
      erreurs: [
        ['« Vérifiez l’identité du patient… »', 'L’historique ne s’ouvre qu’après la confirmation de l’identité.'],
        ['« Un passage plus récent est déjà ouvert »', 'La date d’arrivée saisie précède le passage en cours : corrigez-la ou laissez-la vide.'],
      ],
    },
    support:{"nom": "Support client", "but": "Créer et suivre les demandes de votre établissement.", "gestes": ["Décrire le problème sans données médicales.", "Choisir un projet et envoyer la demande.", "Ouvrir le ticket pour consulter les réponses publiques."], "erreurs": []},
    copilote: {
      nom: 'Copilote',
      but: 'Le résumé de la situation pour la réunion de gestion des lits : niveau d’alerte, recommandations classées et réponses à vos questions. Le Copilote propose ; vous décidez.',
      gestes: [
        'Lisez la vue d’ensemble et les prévisions à 4 h, 12 h et 24 h (avec leur marge) ; demandez « Est-ce qu’on sera saturés ce soir ? ».',
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
    national: {
      nom: 'National',
      but: 'Tous les établissements qui partagent leur capacité, du plus proche au plus loin, sans limite de distance : lits libres et prévus par type d’unité, civières, niveau d’alerte.',
      gestes: [
        'Choisissez le type d’unité et les besoins du patient, puis cochez « Avec lit libre seulement ».',
        'Limitez au besoin le temps de route (30 min, 1 h, 2 h, 4 h).',
        'Ouvrez la carte pour voir le niveau d’alerte de chaque établissement.',
        'Cliquez sur « Transférer ici », entrez la référence patient et confirmez : le lit est réservé et le receveur est avisé.',
      ],
      erreurs: [
        ['« Plus aucun lit libre à … »', 'Le dernier lit vient d’être pris. Choisissez l’établissement suivant dans la liste.'],
        ['« Cet établissement ne partage pas sa capacité »', 'Il n’apparaît pas au tableau national ; appelez-le directement.'],
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
    urgence: {
      nom: 'Urgence',
      but: 'Les civières de l’urgence : qui est sur civière, depuis combien de temps, en corridor ou non, et qui attend encore un lit. Le taux d’occupation peut dépasser 100 %.',
      gestes: [
        'Libre : « Placer un patient » avec sa référence (ex. P-00000).',
        'Occupée : « Demander un lit » ajoute le patient à la file d’admission, liée à sa civière.',
        'Quand une civière régulière se libère, « Changer de civière » sort un patient du corridor.',
        'À l’admission dans un lit, la civière part au nettoyage d’elle-même ; « Nettoyage terminé » la rend libre.',
        'Surveillez les durées en orange (plus de 24 h) et en rouge (plus de 48 h).',
      ],
      erreurs: [
        ['« … a une demande de lit en cours »', 'Le patient attend un lit : admettez-le depuis Admissions, ou annulez sa demande avant le départ.'],
        ['« Le patient … est déjà sur la civière … »', 'Un patient n’est que sur une civière à la fois. Utilisez « Changer de civière ».'],
      ],
    },
    admissions: {
      nom: 'Admissions',
      but: 'La file des patients qui attendent un lit, souvent sur civière à l’urgence, avec le meilleur lit libre adapté à leurs besoins.',
      gestes: [
        'Ajoutez une demande : type d’unité, référence patient, priorité, provenance et besoins.',
        'Cliquez sur « Assigner » pour réserver le lit proposé.',
        'Sans lit adapté ici, les alternatives du réseau s’affichent d’elles-mêmes sous la demande (« Capacité insuffisante ») ; « Voir toutes les destinations » ouvre la liste complète. Rien n’est réservé sans validation.',
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
        'Receveur : « Chambre prête » dès que la chambre est préparée ; le demandeur est avisé. Aucun dossier à créer : la référence, les besoins et l’heure d’arrivée suffisent.',
        'Receveur : « Accepter » ou « Refuser » une demande (le lit est déjà bloqué pour le patient).',
        'Demandeur : « Organiser le transport », puis « Confirmer le départ ».',
        'Receveur : « Confirmer la réception » ; le lit devient occupé.',
      ],
      erreurs: [
        ['« Cette action revient à … »', 'C’est à l’autre établissement d’agir. La carte indique qui est attendu.'],
        ['« Le transfert … n’est plus au statut attendu »', 'Quelqu’un a déjà fait l’étape. La page se met à jour.'],
      ],
    },
    secours: {
      nom: 'Secours 911',
      but: 'Les ambulances annoncées par préalerte, avant leur arrivée : entreprise, unité, plaque, équipage, priorité déclarée, catégorie, heure prévue et position. Aucune identité n’est transmise. OG propose le service selon vos règles ; votre équipe décide.',
      gestes: [
        '« Accuser la préalerte » : confirme qu’une personne en a pris connaissance (l’ambulance le voit).',
        'Service proposé par OG : « Confirmer le service », « Indiquer un autre service » ou « Refuser la proposition ». Rien n’est affecté automatiquement.',
        '« Préparation en cours », puis « Préparation terminée » : l’ambulance suit votre préparation.',
        'À l’arrivée : « Confirmer le véhicule arrivé » avec le numéro de l’unité. Un autre véhicule est enregistré sans fermer la préalerte. Puis « Confirmer la remise ».',
        'Statut de votre urgence : déclarez « Ouverte », « Capacité limitée », « Saturation » ou « Délestage » ; au-delà du seuil, la déclaration est signalée comme ancienne.',
      ],
      erreurs: [
        ['« Cette étape n’est pas possible à ce stade de la préalerte »', 'Une autre étape doit d’abord être confirmée, ou la préalerte a changé de destination. Ouvrez l’historique.'],
        ['« La version a changé »', 'Quelqu’un a déjà agi sur cette préalerte : l’écran se met à jour, recommencez si nécessaire.'],
      ],
    },
    liaison: {
      nom: 'Liaison CHSLD',
      but: 'Les demandes et mouvements des résidents de CHSLD vers votre hôpital, séparés des transferts interhospitaliers : arrivées, accueil, hospitalisations, retours et historique. Seule la référence du résident (R-00000) est visible.',
      gestes: [
        'Arrivées CHSLD : « Confirmer la réception » de la demande, puis « Accepter » ou « Refuser » selon vos règles.',
        'À accueillir : après le départ confirmé par le CHSLD, « Confirmer l’arrivée » quand le résident est physiquement là.',
        '« Orienter / admettre le patient » : décision du personnel habilité. Choisissez un lit libre et compatible, une civière libre ou la file d’admission. Aucune priorité clinique n’est attribuée.',
        'Hospitalisations : « Préparer le retour au CHSLD ». Retours en cours : le CHSLD accepte et vérifie la chambre, vous confirmez le départ, il confirme l’arrivée puis réintègre le résident.',
      ],
      erreurs: [
        ['« Cette étape n’est pas possible à ce stade de la coordination »', 'Une autre étape doit d’abord être confirmée (par exemple le départ par le CHSLD). La fiche indique la dernière confirmation.'],
        ['« Un retour vers le CHSLD est déjà en préparation »', 'Le retour existe déjà : suivez-le dans « Hospitalisations et retours ».'],
      ],
    },
    continuite: {
      nom: 'Sillage',
      but: 'Suivre le parcours complet de chaque résident entre le CHSLD, l’ambulance et l’hôpital : six étapes, un responsable par étape, les mêmes heures des deux côtés.',
      gestes: [
        'Ouvrez un parcours en cours pour voir l’étape actuelle, qui doit agir et depuis quand.',
        'Une étape en attente trop longtemps est signalée : relancez la personne responsable nommée.',
        'Cochez « Afficher aussi les plus anciens » pour retrouver les parcours terminés.',
      ],
      erreurs: [
        ['Aucun parcours en cours', 'Aucun résident n’est actuellement entre deux établissements.'],
      ],
    },
    chrono: {
      nom: 'Chrono',
      but: 'Voir les ambulances en route et à la porte, avec le temps écoulé depuis l’arrivée, et noter le début du triage, la fin du triage et la civière libérée. Les mêmes heures sont lues par l’ambulance et le CCS.',
      gestes: [
        'Le chrono passe à l’orange à 15 min et au rouge à 20 min : les minutes et le mot sont toujours écrits.',
        'Cliquez « Début triage », « Fin triage », puis « Civière libérée » au moment où cela se produit.',
        'Une étape oubliée ou une heure fausse se corrige avec « Corriger l’heure » et un motif ; rien n’est effacé.',
        'Le rapport mensuel donne moyennes, médianes et parts hors cible ; exportez-le en CSV.',
      ],
      erreurs: [
        ['L’étape H12 manque', 'Ajoutez d’abord l’heure manquante avec « Corriger l’heure ».'],
      ],
    },
    'transports-planifies': {
      nom: 'Transports non urgents',
      but: 'Réserver un transport non urgent et suivre sa confirmation, sa prise en charge et son arrivée.',
      gestes: [
        'Cliquez « Réserver un transport », choisissez le lit à libérer (ou saisissez la référence), le motif, la destination, la plage et le véhicule.',
        'Quand le transporteur confirme, le lit passe « en attente de transport » à l’heure confirmée ; à la prise en charge, il part au nettoyage.',
        'Réservez de préférence la veille ; vous pouvez annuler tant que le patient n’est pas pris en charge.',
      ],
      erreurs: [['Plage invalide', 'La fin doit suivre le début, sans dépasser 12 h.']],
    },
    bourse: {
      nom: 'Bourse des places',
      but: 'Voir les places libres et à venir des ressources d’hébergement, classées par besoins couverts et proximité, avec la raison du classement.',
      gestes: ['Filtrez par type de ressource, besoins et distance.', 'Imprimez la fiche d’une page (sans diagnostic) d’un patient NSA.', 'Invitez un professionnel sans compte avec un lien nominatif de 7 jours, révocable.'],
      erreurs: [['Courriel professionnel requis', 'Les adresses personnelles ne sont pas acceptées pour un lien invité.']],
    },
    donnees: {
      nom: 'Données',
      but: 'Suivre les indicateurs de la région et de l’établissement : temps à la porte, transferts, NSA, places libres, listes d’attente par type de ressource, refus par motif.',
      gestes: ['Choisissez la période.', 'Les cellules de 1 à 4 sont masquées (« < 5 ») pour protéger les personnes.', 'Exportez le tableau en CSV : aucune référence patient.'],
      erreurs: [['Module désactivé', 'Le module Données doit être activé par l’administration.']],
    },
    crise: {
      nom: 'Mode crise',
      but: 'Évacuer l’établissement en sécurité : un lieu proposé par résident, confirmé par l’équipe ; suivi du départ, de l’arrivée et du retour ; familles avisées.',
      gestes: ['Déclenchez l’évacuation avec son motif.', 'Confirmez le lieu proposé pour chaque résident : la place est réservée.', 'Notez le départ (mode de transport), l’arrivée, puis planifiez le retour ; levez l’évacuation à la fin.'],
      erreurs: [['Plus aucun lit libre', 'Choisissez une autre destination dans la liste des places de la région.']],
    },
    visites: {
      nom: 'Visites confirmées',
      but: 'Planifier les visites du CLSC ou du prestataire et voir si elles ont eu lieu ; noter les soins donnés par la résidence quand une visite est manquée.',
      gestes: ['Planifiez une visite (ou une série) : résident, type, prestataire, plage.', 'Une visite sans arrivée pendant sa plage devient « manquée » et vous êtes avisé.', 'Choisissez le soin donné à la place, puis consultez le rapport mensuel.'],
      erreurs: [['Plage invalide', 'La fin doit suivre le début, 8 h au plus.']],
    },
    eviter: {
      nom: 'Secours 911 · préparer l’intervention',
      but: 'Avant d’appeler l’ambulance, relire la liste de votre établissement et ses alternatives ; noter la décision de l’équipe.',
      gestes: ['Relisez la liste de vérification de votre protocole.', 'Si une alternative suffit, cliquez « Transfert évité grâce à elle » ; sinon « Transfert fait ».', 'L’administration écrit la liste et les coordonnées.'],
      erreurs: [['Version périmée', 'Quelqu’un a modifié la liste : rechargez l’écran.']],
    },
    conges: {
      nom: 'Congés',
      but: 'Préparer les sorties : congés d’aujourd’hui, de demain et à venir, destination, transport, obstacles au départ et disponibilités prévisionnelles. Un congé prévu n’est jamais un lit libre.',
      gestes: ['Cliquez une tuile (aujourd’hui, retardés, transport nécessaire…) pour filtrer la liste.', 'Levez les obstacles affichés (transport à confirmer, destination à préciser), puis enregistrez le départ dans Lits.', 'Le compteur Chrono indique le retard ou la durée de préparation, la même durée que dans Chrono.'],
      erreurs: [['Disponibilité non calculable', 'Une heure de congé confirmée est nécessaire ; le lit ne devient disponible qu’après le départ et le nettoyage.']],
    },
    'c-departs': {
      nom: 'Départs',
      but: 'Suivre les sorties et fins d’hébergement. Les hospitalisations temporaires et les absences gardent leur place : ce ne sont pas des départs.',
      gestes: ['Ouvrez le dossier d’un résident pour enregistrer une fin d’hébergement.', 'Suivez une hospitalisation dans Transferts → Hôpital et hébergement.'],
      erreurs: [['Place conservée', 'Une place conservée n’est jamais comptée comme disponible.']],
    },
    'c-alertes': {
      nom: 'Alertes',
      but: 'Toutes les alertes de l’établissement : actives, vigilance, escalades, prises en charge, résolues et historique. La même source que Chrono et la cloche.',
      gestes: ['Choisissez un onglet, puis accusez réception, engagez une action ou confirmez la résolution.', 'Ouvrez l’historique d’une alerte pour voir qui a fait quoi et quand.'],
      erreurs: [['Version périmée', 'Quelqu’un a déjà traité l’alerte : l’écran se recharge.']],
    },
    vigilance: {
      nom: 'Alertes',
      but: 'Alertes actives, vigilance, escalades, prises en charge, résolues et historique, expliquées : origine, seuil, fait ou hypothèse, action proposée et responsable. Les congés ont leur propre module.',
      gestes: [
        'Choisissez un onglet (Actives, Vigilance, Escalades, Prises en charge, Résolues, Historique).',
        'Accusez réception, engagez une action de la liste ou confirmez la résolution ; l’historique garde chaque geste.',
        'Pour chaque alerte, lisez l’origine et le seuil, puis décidez de l’action proposée : rien n’est annulé automatiquement.',
      ],
      erreurs: [
        ['Contrôle périodique en retard', 'Les chiffres restent lus en direct ; prévenez le soutien technique si le retard persiste.'],
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
        'Créez un compte, ou réinitialisez le mot de passe d’une personne qui l’a oublié : le mot de passe temporaire s’affiche une seule fois.',
        'Ajoutez unités, chambres et lits, et cochez leur équipement.',
        'Créez un connecteur pour le système de l’hôpital ; la clé ne s’affiche qu’une fois.',
        'Import CSV : téléchargez un modèle, remplissez-le, « Vérifier » montre chaque erreur par ligne, puis « Importer » (tout ou rien).',
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
      coordonnateur: ['Commencez par l’onglet Copilote : niveau d’alerte et recommandations.', 'À l’urgence, l’onglet Urgence montre les civières ; « Demander un lit » ajoute le patient à la file d’admission.'],
      entretien: ['Votre écran est Nettoyage : prenez le lit en haut de la liste.', 'Appuyez sur « Commencer », puis sur « Terminé ».'],
      admin_etab: ['Activez la double authentification dans Mon compte avant d’entrer dans l’Administration.', 'Créez les comptes de votre équipe et vérifiez vos unités et lits.'],
      gestionnaire: ['Activez la double authentification dans Mon compte avant d’entrer dans l’Administration.', 'Le Copilote montre le niveau de chaque hôpital et les délestages possibles.'],
    },
    ok: 'J’ai compris',
  },
};
