# ARRIMO — CAHIER FINAL DE REFONTE SECOURS, CCS, AMBULANCES ET TRANSPORTS

## 1. Objectif général

Transformer Arrimo Secours en une plateforme professionnelle de coordination des interventions, des transports sanitaires et des mouvements de patients entre les établissements.

Arrimo doit connecter :

- Les centres de communication santé (CCS).
- Les entreprises ambulancières.
- Les ambulanciers et paramédics.
- Les hôpitaux.
- Les cliniques.
- Les CHSLD.
- Les RPA.
- Les autres établissements d'hébergement.
- Les organisations de transport sanitaire.
- Les autorités régionales et nationales autorisées.

Chaque acteur dispose d'un espace de travail adapté à son rôle, mais tous utilisent les mêmes données opérationnelles partagées selon leurs permissions.

L'ensemble doit fonctionner comme un ERP institutionnel, et non comme une collection de formulaires indépendants.

## 2. Règles fondamentales

- Conserver les fonctionnalités existantes.
- Ne supprimer aucun parcours opérationnel fonctionnel.
- Réutiliser les moteurs, API et modèles de données existants.
- Éliminer les doubles saisies.
- Synchroniser les informations entre les acteurs.
- Utiliser une référence unique pour chaque intervention, mission, transport et préalerte, avec des relations explicites entre ces objets.
- Assurer une traçabilité complète.
- Adapter les interfaces aux responsabilités de chaque utilisateur.
- OG recommande et explique ; les professionnels autorisés décident.
- Respecter les protocoles cliniques et préhospitaliers applicables.

Avant toute modification, réaliser un inventaire du code, des routes, des composants, des permissions et des workflows existants.

# PARTIE I — IDENTITÉ VISUELLE ET ERGONOMIE

## 3. Design institutionnel commun

Appliquer la même identité visuelle à l'ensemble d'Arrimo :

- Hôpitaux.
- CHSLD.
- RPA.
- CCS.
- Ambulances.
- Entreprises de transport.
- Console SH.

Exigences :

- Supprimer tous les émojis.
- Utiliser une bibliothèque d'icônes professionnelles uniforme.
- Harmoniser les boutons, tableaux, cartes, formulaires et badges.
- Utiliser des KPI compacts et lisibles.
- Éliminer les espaces vides excessifs.
- Éviter les cartes inutilement grandes.
- Uniformiser les couleurs et les statuts.
- Assurer une excellente lisibilité en mode clair et sombre.
- Adapter les interfaces aux ordinateurs, tablettes, téléphones et grands écrans.
- Corriger la navigation horizontale qui masque certains sous-modules.
- Conserver l'accessibilité de toutes les fonctionnalités dans les deux modes de navigation.

Les couleurs doivent avoir une signification opérationnelle et toujours être accompagnées d'un libellé.

Vert : disponible ou fonctionnement normal.

Orange : attention, attente ou retard.

Rouge : situation critique, incident ou blocage.

Bleu : opération en cours.

Gris : indisponible, terminé ou inactif selon le contexte.

# PARTIE II — ESPACE AMBULANCE

## 4. Navigation ambulancière

Créer une navigation claire :

**Accueil**
- Vue opérationnelle personnalisée.

**Missions**
- Nouvelles missions.
- Missions acceptées.
- Missions en cours.
- Missions terminées.

**Transports**
- Transports urgents.
- Transports non urgents.
- Transports interétablissements.
- Historique des transports.

**Réseau**
- Urgences classées.
- Bourse des places.
- Carte des établissements.

**Coordination**
- Préalertes.
- Chrono.
- Sillage.

**Paramètres**
- Profil.
- Notifications.
- Véhicule autorisé.
- Préférences.

OG doit rester accessible depuis toutes les pages.

Adapter les sous-modules aux licences et permissions réellement disponibles.

## 5. Accueil ambulancier

L'Accueil doit être un terminal opérationnel permettant de comprendre immédiatement la situation du véhicule et la prochaine action à effectuer.

### En-tête

Afficher :

- Nom de l'organisation ambulancière.
- Identifiant du véhicule.
- Équipe connectée.
- État opérationnel.
- État de connexion.
- Heure locale.
- Dernière synchronisation.
- Notifications.
- Accès à OG.

### KPI principaux

| KPI | Définition |
|---|---|
| Missions à accepter | Missions affectées sans réponse |
| Missions acceptées | Missions confirmées, non commencées |
| Missions en cours | Interventions commencées et non clôturées |
| Missions terminées aujourd'hui | Missions effectivement clôturées |
| Missions en retard | Missions dépassant leur échéance applicable |
| Incidents actifs | Incidents non résolus |

Les KPI doivent être cliquables et ouvrir les listes correspondantes.

## 6. État du véhicule

Afficher clairement l'état actuel du véhicule :

- Disponible.
- Mission affectée.
- En route vers la prise en charge.
- Sur place.
- Patient pris en charge.
- En transport.
- À destination.
- En attente de remise du patient.
- Remise effectuée.
- Nettoyage ou remise en condition.
- Hors service.

Les transitions doivent être contrôlées.

Ne pas permettre à un véhicule de devenir disponible alors qu'une mission incompatible est encore active.

Prévoir les exceptions autorisées, avec justification et traçabilité.

## 7. Réception d'une nouvelle mission

Lorsqu'une mission est affectée par le CCS ou par un acteur autorisé, afficher une notification immédiatement identifiable.

La carte de mission doit contenir :

- Référence de mission.
- Type d'intervention.
- Niveau de priorité.
- Lieu de prise en charge.
- Destination, si connue et validée.
- Distance estimée.
- Temps de trajet estimé.
- Heure d'affectation.
- Informations opérationnelles nécessaires.
- Instructions particulières.
- Organisation demandeuse.

Actions principales :

- Accepter.
- Refuser.

Le refus doit être accompagné d'un motif et transmis immédiatement au CCS.

La mission refusée retourne dans le circuit de répartition.

Prévoir également les missions annulées, expirées et réaffectées.

## 8. Parcours opérationnel ambulancier

Après acceptation, présenter une action principale adaptée à l'étape actuelle.

| Étape | Action principale |
|---|---|
| Mission reçue | Accepter ou refuser |
| Mission acceptée | Partir vers la prise en charge |
| En route | Confirmer l'arrivée sur place |
| Sur place | Confirmer la prise en charge |
| Patient pris en charge | Confirmer la destination et préparer la préalerte |
| En transport | Suivre le trajet et signaler les changements |
| À destination | Signaler l'arrivée |
| Remise du patient | Confirmer la remise |
| Remise effectuée | Terminer la mission |
| Remise en condition | Confirmer la disponibilité du véhicule |

Ne pas afficher simultanément toutes les actions possibles.

Chaque action doit actualiser les autres espaces autorisés.

Prévoir les incidents, annulations, changements de destination et retards.

Aucune manipulation complexe ne doit être nécessaire pendant la conduite.

## 9. Mission active

La mission active doit être au centre du dashboard.

Afficher :

- Identifiant de mission.
- Priorité.
- Patient ou référence autorisée.
- Origine.
- Destination.
- Véhicule.
- Heure de départ.
- Heure d'arrivée estimée.
- Temps écoulé.
- État de la préalerte.
- État de préparation de la destination.
- Prochaine action.
- Historique chronologique.

Actions secondaires :

- Signaler un retard.
- Signaler un incident.
- Contacter le CCS par les moyens autorisés.
- Demander une modification de destination.
- Consulter la Bourse des places.
- Consulter Sillage.
- Ouvrir la navigation routière.

## 10. Bourse des places ambulancière

L'ambulancier doit pouvoir consulter les disponibilités pertinentes du réseau :

- Hôpitaux accessibles.
- Civières disponibles.
- Capacités hospitalières autorisées.
- Niveau de saturation.
- Délais ambulanciers.
- Services et spécialités accessibles.
- Restrictions d'accueil.
- Fermetures temporaires.
- Distance.
- Temps de trajet.
- Dernière actualisation.

Les établissements doivent pouvoir être classés selon des critères expliqués.

Ne jamais assimiler automatiquement un lit libre à une capacité d'accueil aux urgences.

La destination doit respecter les besoins cliniques, les protocoles et les décisions des professionnels compétents.

## 11. Préalertes ambulancières

Permettre la création et le suivi d'une préalerte liée à la mission.

Informations :

- Véhicule.
- Référence du patient autorisée.
- Établissement destinataire.
- Priorité.
- Nature de l'intervention.
- Besoins de préparation.
- Heure estimée d'arrivée.
- Informations strictement nécessaires à la coordination.

Afficher une chronologie :

1. Préalerte transmise.
2. Reçue techniquement par l'établissement.
3. Consultée par un professionnel.
4. Prise en compte.
5. Préparation en cours.
6. Ressources déclarées prêtes.
7. Arrivée confirmée.
8. Patient remis.

Distinguer la réception technique d'une confirmation humaine.

Toute modification de destination, priorité ou ETA doit actualiser les acteurs concernés.

# PARTIE III — CENTRE DE COMMUNICATION SANTÉ (CCS)

## 12. Positionnement du CCS

Le CCS doit devenir un centre de commandement opérationnel.

Il doit pouvoir superviser les interventions, affecter les véhicules, consulter les disponibilités des établissements et suivre les missions jusqu'à leur clôture.

## 13. Navigation CCS

**Accueil**
- Centre de commandement.
- Supervision régionale.

**Appels**
- Interventions reçues.
- Interventions à traiter.
- Interventions qualifiées.
- Historique.

**Missions**
- À affecter.
- Affectées.
- Acceptées.
- En cours.
- Terminées.
- Incidents.

**Ambulances**
- Flotte.
- Disponibilités.
- Équipes.
- Carte opérationnelle.

**Capacités**
- Bourse des places.
- Urgences classées.
- Disponibilités des établissements.

**Coordination**
- Préalertes.
- Transports interétablissements.
- Chrono.
- Sillage.
- Gestion de crise.

**Pilotage**
- Indicateurs.
- Historique.
- Données régionales.

**Administration**
- Personnel.
- Permissions.
- Paramètres.
- Intégrations.

OG reste accessible partout.

## 14. Dashboard CCS — Centre de commandement

L'Accueil CCS doit présenter une vue régionale en temps réel.

### KPI principaux

| KPI | Définition |
|---|---|
| Interventions en attente | Interventions non encore prises en charge |
| Missions à affecter | Missions sans véhicule affecté |
| Ambulances disponibles | Véhicules réellement opérationnels |
| Ambulances engagées | Véhicules affectés à une intervention |
| Missions en cours | Missions commencées non clôturées |
| Ambulances à destination | Véhicules présents dans les établissements |
| Attentes au-delà du seuil | Remises dépassant le seuil applicable |
| Préalertes actives | Préalertes non clôturées |
| Établissements sous pression | Établissements dépassant leurs seuils |
| Incidents actifs | Incidents nécessitant un suivi |

Afficher les KPI prioritaires dans la première ligne et les indicateurs secondaires dans les espaces correspondants.

### Organisation du dashboard

Première zone : KPI et niveau opérationnel régional.

Deuxième zone : interventions prioritaires et missions à affecter.

Troisième zone : carte des véhicules et établissements.

Quatrième zone : Bourse des places et disponibilités hospitalières.

Cinquième zone : préalertes et délais Chrono.

Sixième zone : incidents, alertes et recommandations OG.

Chaque bloc doit ouvrir son module complet.

## 15. Gestion des appels et interventions

Prévoir la réception des interventions provenant des systèmes d'urgence autorisés.

Pour la démonstration, utiliser un simulateur d'appels clairement identifié.

Une intervention doit contenir :

- Référence unique.
- Heure de réception.
- Origine de l'intervention.
- Localisation.
- Motif opérationnel.
- Priorité validée selon les protocoles.
- Informations nécessaires.
- État de traitement.
- Répartiteur responsable.
- Véhicule affecté.
- Historique.

Actions :

- Prendre en charge l'intervention.
- Compléter les informations.
- Affecter une ambulance.
- Réaffecter.
- Suivre.
- Annuler avec justification.
- Clôturer selon les règles applicables.

Ne pas présenter une connexion réelle au 911 comme existante sans intégration officielle, autorisation et validation technique.

Arrimo ne doit pas remplacer sans autorisation les systèmes de répartition et de qualification médicale existants.

## 16. Affectation des ambulances

Lorsqu'une intervention doit être affectée, le CCS doit voir les véhicules compatibles.

Afficher :

- Identifiant.
- Équipe.
- Position disponible.
- Distance jusqu'au lieu de prise en charge.
- Temps estimé.
- Type de véhicule.
- Capacités opérationnelles.
- État.
- Mission actuelle.
- Dernière synchronisation.

OG peut proposer un classement expliqué.

Le répartiteur valide l'affectation.

L'ambulance reçoit immédiatement la mission.

Le CCS voit ensuite :

- Mission envoyée.
- Mission reçue.
- Mission acceptée.
- Mission refusée.
- Mission en attente de réponse.
- Mission réaffectée.

## 17. Gestion de la flotte

Créer un tableau professionnel de tous les véhicules autorisés.

Colonnes :

- Véhicule.
- Organisation.
- Équipe.
- État opérationnel.
- Mission active.
- Position.
- Destination.
- ETA.
- Durée d'engagement.
- Dernière actualisation.
- Actions autorisées.

Filtres :

- Disponibles.
- En intervention.
- En transport.
- À l'hôpital.
- En attente.
- En remise en condition.
- Hors service.
- Par organisation.
- Par secteur.

Chaque véhicule doit être cliquable.

## 18. Fiche détaillée d'un véhicule

Lorsqu'un utilisateur autorisé clique sur une ambulance, ouvrir une fiche opérationnelle complète.

### Identification

- Véhicule.
- Organisation.
- Équipe affectée.
- État actuel.
- Dernière connexion.

### Mission active

- Référence.
- Type d'intervention.
- Priorité.
- Origine.
- Destination.
- Heure d'affectation.
- Heure d'acceptation.
- Heure de départ.
- Heure d'arrivée estimée.
- Temps écoulé.

### Logistique

- Position sur la carte.
- Itinéraire disponible.
- Distance restante.
- Temps restant.
- Retards.
- Incidents.
- Dernière position connue.

### Coordination

- Préalerte associée.
- Établissement destinataire.
- Confirmation de réception.
- État de préparation.
- Arrivée.
- Remise du patient.
- Événements Chrono.
- Parcours Sillage.

### Historique

- Missions précédentes.
- Changements d'état.
- Incidents.
- Confirmations.
- Utilisateurs responsables des actions.

La fiche doit être accessible depuis la carte, la flotte, les missions, les transports, les préalertes et les vues autorisées des établissements.

## 19. Carte opérationnelle régionale

Afficher :

- Ambulances disponibles.
- Ambulances engagées.
- Véhicules en transport.
- Établissements.
- Urgences.
- Missions géolocalisées autorisées.
- Incidents.
- Évacuations actives.

Un clic sur un véhicule ouvre sa fiche.

Un clic sur un établissement ouvre ses capacités et restrictions d'accueil.

Un clic sur une mission ouvre son parcours opérationnel.

Afficher l'âge de chaque position et distinguer une position actuelle d'une position ancienne.

Ne jamais inventer une position ou un temps de trajet lorsque les données sont indisponibles.

# PARTIE IV — BOURSE DES PLACES ET DISPONIBILITÉS

## 20. Bourse des places universelle

La Bourse des places doit utiliser une source de données commune.

Elle doit être accessible, selon les permissions, aux :

- Hôpitaux.
- CHSLD.
- RPA.
- CCS.
- Ambulances.
- Cliniques.
- Autres établissements concernés.

Chaque acteur voit les informations nécessaires à sa mission.

Ne pas créer plusieurs moteurs de disponibilité indépendants.

## 21. Disponibilités hospitalières côté CCS

Créer un tableau comparatif :

| Information | Utilité |
|---|---|
| Établissement | Identifier la destination |
| Distance | Comparer les trajets |
| Temps de trajet | Estimer l'arrivée |
| Civières disponibles | Évaluer les capacités des urgences |
| Lits disponibles | Évaluer les capacités hospitalières |
| Occupation | Identifier la pression opérationnelle |
| Ambulances à la porte | Anticiper les délais |
| Attente moyenne | Évaluer les délais de remise |
| Services accessibles | Vérifier la compatibilité |
| Restrictions | Identifier les limitations |
| Dernière actualisation | Évaluer la fraîcheur des données |

Prévoir les spécialités et services pertinents : urgence générale, pédiatrie, cardiologie, AVC, traumatologie et autres services configurés.

Le classement doit tenir compte des règles d'orientation applicables.

## 22. Fiabilité des capacités

Une place ne doit jamais être présentée comme disponible si elle est :

- Occupée.
- Réservée.
- En nettoyage.
- En préparation.
- Bloquée.
- Hors service.
- Incompatible avec le besoin concerné.
- Fermée faute de ressources nécessaires.

Distinguer :

- Disponible maintenant.
- Disponible prochainement.
- Disponibilité prévisionnelle.
- Disponibilité inconnue.

Afficher les sources, heures d'actualisation et éventuelles incertitudes.

# PARTIE V — GESTION ET GÉNÉRATION DES TRANSPORTS

## 23. Moteur universel des transports

Créer une gestion cohérente des transports entre tous les acteurs.

Types :

- Transport ambulancier urgent.
- Transport ambulancier non urgent.
- Transfert interhospitalier.
- Transfert vers un CHSLD.
- Transfert vers une RPA.
- Retour vers un établissement d'origine.
- Retour à domicile.
- Transport adapté.
- Rapatriement.
- Transport lié à une évacuation.

Respecter les différences de qualification, d'autorisation et de traitement entre ces catégories.

## 24. Génération d'une demande de transport

Depuis un établissement autorisé, permettre la création d'une demande avec :

- Patient ou résident concerné.
- Établissement d'origine.
- Unité et lieu de prise en charge.
- Destination.
- Motif du transport.
- Type de transport.
- Priorité validée.
- Date et heure souhaitées.
- Plage horaire.
- Besoins d'accompagnement.
- Contraintes opérationnelles.
- État de préparation du patient.
- Confirmation de la destination lorsque nécessaire.
- Organisation de transport autorisée.

Lorsque le transport est lié à un congé, un transfert ou un dossier NSA, conserver le lien avec le dossier d'origine.

Ne pas recréer les informations déjà présentes dans Arrimo.

## 25. Cycle de vie du transport

Les statuts doivent être cohérents entre les interfaces :

1. Brouillon.
2. Demandé.
3. En attente de validation.
4. Validé.
5. En attente d'affectation.
6. Affecté.
7. Accepté.
8. Planifié.
9. En route vers le départ.
10. Sur place.
11. Patient pris en charge.
12. En transport.
13. Arrivé à destination.
14. Patient remis.
15. Terminé.

Statuts exceptionnels :

- Refusé.
- Annulé.
- Réaffecté.
- Suspendu.
- Incident.

Un retard doit être un indicateur complémentaire et non un remplacement du statut opérationnel.

Adapter les étapes au type de transport sans imposer des étapes inutiles.

## 26. KPI de gestion des transports

| KPI | Calcul attendu |
|---|---|
| Demandes reçues | Demandes créées sur la période |
| Demandes à traiter | Demandes nécessitant une action |
| Transports à affecter | Transports validés sans véhicule |
| Transports acceptés | Transports confirmés |
| Transports planifiés | Transports programmés non commencés |
| Transports en cours | Transports commencés non clôturés |
| Transports terminés | Transports effectivement clôturés |
| Transports en retard | Échéances applicables dépassées |
| Transports annulés | Annulations enregistrées |
| Taux d'acceptation | Acceptations / décisions d'acceptation ou de refus |
| Délai moyen d'affectation | Affectation moins validation de la demande |
| Délai moyen d'acceptation | Acceptation moins affectation |
| Ponctualité | Transports éligibles réalisés dans leur plage confirmée |
| Durée moyenne de transport | Arrivée moins départ effectif |
| Incidents | Incidents enregistrés sur la période |

Tous les KPI doivent disposer de définitions explicites, filtres temporels et périmètres organisationnels.

Les données manquantes doivent être signalées et non remplacées par des valeurs inventées.

# PARTIE VI — VUE UNIVERSELLE DES TRANSFERTS

## 27. Une présentation commune à tous les acteurs

Reprendre le principe de la vue des transferts hospitaliers existante.

Créer un composant commun réutilisable dans :

- Les hôpitaux.
- Les CHSLD.
- Les RPA.
- Les ambulances.
- Les CCS.
- Les organisations de transport.

Conserver la même logique visuelle, les mêmes références et les mêmes événements.

Adapter les colonnes, informations et actions aux permissions.

## 28. Tableau des transferts

Colonnes principales :

- Référence.
- Patient ou résident autorisé.
- Type de transfert.
- Origine.
- Destination.
- Véhicule.
- Priorité.
- Heure prévue.
- ETA.
- Statut.
- Préalerte.
- Retard ou incident.
- Prochaine action.

Prévoir :

- Recherche.
- Filtres.
- Tri.
- Pagination.
- Actualisation automatique.
- Vue tableau.
- Vue chronologique.
- Vue carte lorsque pertinente.

Séparer les transferts actifs des transferts terminés.

## 29. Fiche détaillée du transfert

Un clic sur un transfert doit ouvrir une vue complète contenant :

- Origine et destination.
- Informations autorisées du patient.
- Demande initiale.
- Acceptation de la destination.
- Préparation du patient.
- Véhicule affecté.
- Acceptation du transport.
- Départ.
- Position et ETA.
- Préalerte.
- Préparation de la destination.
- Arrivée.
- Remise du patient.
- Clôture.
- Historique.
- Incidents.

Les informations doivent provenir des modules existants et non d'un deuxième workflow indépendant.

## 30. Chronologie commune

Afficher une chronologie visuelle :

Demande → Validation → Acceptation → Préparation → Affectation → Prise en charge → Départ → Transport → Arrivée → Remise → Clôture.

Chaque étape doit afficher :

- Statut.
- Heure.
- Acteur responsable.
- Confirmation.
- Éventuel retard.
- Éventuel blocage.

Un clic sur le véhicule associé ouvre sa fiche opérationnelle.

Un clic sur l'établissement ouvre sa fiche autorisée.

Un clic sur Sillage ouvre le parcours complet.

# PARTIE VII — CHRONO, SILLAGE ET PRÉALERTES

## 31. Chrono universel

Conserver un moteur Chrono unique, partagé entre les établissements, le CCS et les ambulances.

Étapes existantes à préserver et à valider avec les protocoles applicables :

- H11 : arrivée.
- H12 : début du triage.
- H13 : fin du triage.
- H14 : libération de la civière.
- H15 : départ.

Afficher les durées entre les étapes pertinentes.

KPI :

- Ambulances à la porte.
- Attente la plus longue.
- Attente moyenne.
- Attente médiane.
- Nombre au-delà du seuil.
- Nombre annoncé en route.
- Passages terminés.
- Durée moyenne H11–H14.
- Durée moyenne H11–H15.

Ne pas compter plusieurs fois le même passage.

Les seuils doivent être configurables par les responsables autorisés.

## 32. Sillage

Sillage doit suivre le parcours complet du patient entre les acteurs.

Il doit recevoir les événements des modules :

- Admissions.
- Urgences.
- Transferts.
- Liaison CHSLD.
- Liaison Secours.
- Transports.
- Chrono.
- Congés.
- Capacités.

Sillage doit montrer les confirmations, les responsabilités et les étapes manquantes.

Il ne doit pas devenir un moteur de saisie parallèle.

## 33. Coordination des préalertes

Lorsqu'une préalerte est envoyée :

- L'établissement destinataire reçoit une notification.
- Le CCS voit la préalerte active.
- L'ambulance suit les confirmations.
- Arrimo Flux affiche l'arrivée prévue.
- Sillage enregistre les événements pertinents.
- OG peut expliquer l'état du parcours.

Une modification de destination doit mettre à jour les acteurs concernés et annuler proprement la préalerte précédente si nécessaire.

# PARTIE VIII — GESTION DE CRISE

## 34. Coordination des évacuations

Conserver les fonctionnalités existantes de gestion de crise et d'évacuation.

Cas concernés :

- Incendie.
- Inondation.
- Panne majeure.
- Évacuation préventive.
- Établissement temporairement inutilisable.
- Autre événement configuré.

Le CCS doit pouvoir consulter :

- Établissement concerné.
- Nombre de personnes à évacuer.
- Nombre de personnes placées.
- Nombre restant à placer.
- Véhicules engagés.
- Destinations confirmées.
- Capacités disponibles.
- Incidents.
- Progression globale.

L'ambulancier ne doit voir que les informations nécessaires à ses missions autorisées.

Le bandeau de crise doit rester visible et prioritaire, mais être compact.

Arrimo ne remplace pas les services d'urgence ni les procédures officielles de sécurité.

# PARTIE IX — OG

## 35. OG Ambulance

OG doit pouvoir répondre aux questions opérationnelles autorisées :

- Quelle est ma prochaine mission ?
- Quelle est ma destination ?
- L'hôpital a-t-il confirmé la réception ?
- La destination est-elle prête ?
- Quel est mon retard ?
- Quels établissements disposent des capacités pertinentes ?
- Quelle étape manque dans ma mission ?
- Quelles sont mes missions terminées ?

## 36. OG CCS

OG doit pouvoir analyser :

- Les interventions en attente.
- Les véhicules disponibles.
- Les missions non affectées.
- Les établissements sous pression.
- Les capacités du réseau.
- Les retards.
- Les préalertes non confirmées.
- Les incidents.
- Les évacuations.
- Les incohérences opérationnelles.

OG doit expliquer ses recommandations, leurs sources et leurs limites.

Aucune décision clinique, affectation ou modification critique ne doit être effectuée sans validation humaine autorisée.

# PARTIE X — SYNCHRONISATION ET SÉCURITÉ

## 37. Synchronisation intermodules

Les événements doivent être propagés automatiquement aux espaces concernés.

Exemple :

Une ambulance accepte une mission.

- Le CCS voit l'acceptation.
- La mission passe au statut approprié.
- La flotte est actualisée.
- Les établissements concernés voient les informations autorisées.
- Les KPI sont recalculés.
- Sillage reçoit l'événement pertinent.
- OG peut consulter le nouvel état.

Appliquer ce principe à chaque transition.

## 38. Architecture des données

Garantir :

- Identifiants uniques.
- Relations explicites entre interventions, missions, transports, préalertes et passages Chrono.
- Historique horodaté.
- Protection contre les doubles clics.
- Opérations idempotentes.
- Transactions cohérentes.
- Gestion des modifications concurrentes.
- Reconnexion et resynchronisation.
- Prévention des doublons.
- Détection des états contradictoires.

En cas de perte de connexion, afficher clairement les données anciennes et les actions non synchronisées.

Ne jamais afficher une action comme confirmée si le serveur ne l'a pas validée.

## 39. Permissions et confidentialité

Un ambulancier ne doit pas pouvoir modifier les missions d'un autre véhicule sans autorisation explicite.

Un CCS doit disposer d'un périmètre de supervision défini.

Un établissement ne doit accéder qu'aux informations nécessaires à ses opérations.

Appliquer les permissions côté serveur, et non uniquement dans l'interface.

Prévoir :

- Isolation des organisations.
- Contrôle des accès par rôle.
- Journalisation.
- Chiffrement.
- Gestion des sessions.
- Accès minimal aux données personnelles.
- Politique de conservation des données.
- Contrôle de la géolocalisation.
- Traçabilité des modifications.

Préparer les validations de sécurité et de conformité applicables avant tout déploiement avec des données réelles.

# PARTIE XI — CORRECTIONS DES ANOMALIES ACTUELLES

## 40. Anomalies à examiner

Les captures de démonstration montrent plusieurs problèmes potentiels :

1. Répétition de passages Chrono DM-101 affichant tous 38 minutes.
2. Destination CHSLD affichée pour DM-103 alors qu'une préalerte indique Hôpital A.
3. Missions DM-102 accessibles depuis une session DM-103 avec des boutons d'action.
4. Historique indiquant aucune préalerte malgré une préalerte active visible.
5. Géolocalisation indisponible sans solution opérationnelle clairement présentée.
6. Urgences classées insuffisamment renseignées.
7. Bandeau d'évacuation trop volumineux.
8. Horaires potentiellement incohérents ou incomplets.
9. Transports multiples associés au même patient, à vérifier selon leurs identifiants et leur cycle de vie.
10. Navigation horizontale masquant des sous-modules.
11. KPI hospitaliers dont le périmètre et les variations doivent être vérifiés.

Examiner les causes dans le code et les données avant de modifier.

Ne pas supprimer arbitrairement des historiques ou des missions légitimes.

# PARTIE XII — PARAMÉTRAGE ET CONSOLE SH

## 41. Paramètres par module

Chaque module doit disposer de paramètres accessibles aux responsables autorisés.

Paramètres concernés :

- Seuils Chrono.
- Notifications.
- Priorités configurables dans les limites autorisées.
- Types de transport.
- Motifs d'annulation.
- Motifs de refus.
- Règles d'affectation.
- Périmètres géographiques.
- Organisations partenaires.
- Capacités.
- Permissions.
- Langues.
- Préférences d'affichage.
- Intégrations.
- Conservation des données.

Les paramètres critiques doivent être historisés.

## 42. Console SH

Harmoniser également la console SH.

Elle doit permettre aux administrateurs autorisés de gérer :

- Organisations CCS.
- Entreprises ambulancières.
- Véhicules.
- Profils.
- Établissements.
- Licences.
- Permissions.
- Modules.
- Paramètres régionaux.
- Intégrations.
- État des services.
- Journaux techniques.
- Incidents de synchronisation.

Ne pas accorder automatiquement un accès aux données cliniques à un administrateur technique.

# PARTIE XIII — TESTS ET VALIDATION

## 43. Scénarios obligatoires

Tester au minimum :

- Réception d'une intervention simulée.
- Affectation d'une ambulance.
- Acceptation d'une mission.
- Refus et réaffectation.
- Arrivée sur place.
- Prise en charge du patient.
- Consultation de la Bourse des places.
- Validation de la destination.
- Envoi d'une préalerte.
- Confirmation hospitalière.
- Préparation d'une civière.
- Arrivée de l'ambulance.
- Enregistrement Chrono.
- Remise du patient.
- Admission hospitalière.
- Clôture de la mission.
- Remise en condition du véhicule.
- Retour à la disponibilité.
- Transfert interhospitalier.
- Transport hôpital vers CHSLD.
- Transport CHSLD vers hôpital.
- Retour vers une RPA.
- Retour à domicile.
- Transport non urgent.
- Changement de destination.
- Retard.
- Incident.
- Annulation.
- Évacuation simulée.
- Perte de connexion.
- Double clic.
- Affectation concurrente.
- Tentative d'accès non autorisé.

## 44. Validation inter-acteurs

Effectuer les tests avec plusieurs sessions simultanées :

- Hôpital A.
- Hôpital B.
- CHSLD.
- CCS.
- Ambulance DM-101.
- Ambulance DM-102.
- Ambulance DM-103.

À chaque action, vérifier la propagation dans les autres interfaces concernées.

Contrôler les KPI, les statuts, les notifications, Chrono, Sillage, Arrimo Flux et OG.

## 45. Critères d'acceptation

La refonte sera considérée comme terminée lorsque :

- Toutes les fonctionnalités existantes sont préservées.
- Les interfaces sont professionnelles et cohérentes.
- Les missions sont faciles à accepter, refuser et suivre.
- Les transitions opérationnelles sont contrôlées.
- Les véhicules disposent d'une fiche détaillée.
- Les transferts utilisent une présentation commune.
- Les disponibilités sont synchronisées.
- Les préalertes sont correctement transmises et confirmées.
- Les KPI sont calculés sans doublons.
- Les permissions sont vérifiées côté serveur.
- Les anomalies identifiées sont corrigées ou documentées.
- Les scénarios de test sont exécutés avec résultats vérifiables.
- Les interfaces sont utilisables sur ordinateur, tablette et téléphone.
- Aucune régression majeure n'est introduite.

## 46. Livrables obligatoires

À la fin du travail, fournir :

- Inventaire des fonctionnalités conservées.
- Liste des composants modifiés.
- Architecture des modules.
- Cartographie des workflows.
- Dictionnaire des KPI.
- Matrice des permissions.
- Liste des anomalies corrigées.
- Résultats des tests automatisés.
- Résultats des tests inter-acteurs.
- Captures des nouvelles interfaces.
- Liste des limitations restantes.
- Procédure de démonstration complète.
- Conditions nécessaires avant un pilote réel.

## 47. Directive finale

Ne pas simplement embellir les pages.

Construire une expérience opérationnelle complète, cohérente et professionnelle.

L'ambulancier doit savoir immédiatement quelle mission traiter et quelle action effectuer.

Le CCS doit pouvoir superviser les interventions, la flotte, les établissements, les capacités et les délais.

Les établissements doivent pouvoir anticiper les arrivées, préparer les ressources et confirmer les remises.

Chaque véhicule, chaque transport et chaque transfert doit être consultable à travers une fiche détaillée présentant toute sa coordination logistique.

Arrimo doit fonctionner comme un seul système intégré, avec plusieurs acteurs, plusieurs établissements et plusieurs responsabilités.

Ne déclarer aucune fonctionnalité opérationnelle sans l'avoir effectivement testée.

La démonstration doit rester distincte de la production et utiliser exclusivement des données fictives tant que les autorisations et validations nécessaires ne sont pas obtenues.
