# ARRIMO — Cahier des charges de reprise, correction et déploiement autonome

**Date : 22 novembre 2026**

## 1. Mission générale

Tu reprends le développement d'Arrimo à la suite de Claude Code, dont le travail a été interrompu par l'épuisement de ses tokens.

Travaille de manière autonome, de l'audit initial jusqu'aux tests et au déploiement de la version de démonstration, sans demander de validations intermédiaires inutiles.

Ne reconstruis pas les fonctionnalités qui fonctionnent déjà. Préserve l'architecture, les données, les permissions et les fonctionnalités existantes.

## 2. Reprise du travail de Claude Code

Avant toute modification :

- Analyser intégralement le dépôt Arrimo.
- Examiner les branches, les commits récents et les modifications non commitées.
- Retrouver le dernier cahier des charges transmis à Claude Code.
- Identifier les développements terminés, incomplets et non commencés.
- Vérifier les migrations, les API, le frontend et le backend.
- Reprendre les travaux interrompus.
- Créer un point de restauration avant les modifications.

Si le dernier cahier des charges est introuvable, le signaler dans le rapport et poursuivre les corrections indépendantes.

## 3. Résultats des tests manuels du 22 novembre

Le scénario suivant a été testé avec des données fictives :

**Patient P-90802 : Hôpital A — Val-des-Pins → Ambulance DM-103 → CHSLD des Érables.**

Fonctionnalités validées dans ce scénario :

- Admission depuis les urgences.
- Attribution du lit MED-204B.
- Libération et nettoyage de la civière URG-12.
- Désignation du patient en NSA.
- Demande de place au CHSLD.
- Proposition et confirmation de la chambre ERA-311.
- Demande de transport.
- Acceptation par l'ambulance DM-103.
- Prise en charge du patient.
- Confirmation du départ hospitalier.
- Nettoyage et préparation de la chambre du CHSLD.
- Arrivée et installation du patient.
- Occupation automatique de la chambre ERA-311.
- Mise à jour du statut dans Flux et NSA.
- Nettoyage et remise à disposition du lit MED-204B.

Ces fonctionnalités doivent être protégées contre toute régression.

## 4. Refonte du module Transport

Revoir entièrement le tableau de bord Transport côté établissements, entreprises ambulancières et paramédics.

### Gestion des missions

Créer des catégories clairement identifiables :

- Nouvelles demandes.
- Missions à accepter.
- Missions acceptées.
- Missions programmées.
- Missions en cours.
- Missions en retard.
- Missions terminées.
- Missions refusées.
- Missions annulées.
- Missions avec incident.

### Actions disponibles

Permettre, selon les permissions :

- Accepter une mission.
- Refuser avec justification.
- Attribuer ou réattribuer un véhicule.
- Modifier les horaires.
- Annuler une mission.
- Signaler un incident.
- Confirmer chaque étape.
- Clôturer une mission.
- Archiver une mission.

Autoriser la suppression des brouillons non transmis. Préserver l'historique des missions transmises ou exécutées.

### Gestion des véhicules

Le responsable de l'entreprise ambulancière doit pouvoir consulter toutes les missions de son organisation, indépendamment du véhicule sélectionné.

Chaque paramédic doit retrouver facilement les missions attribuées à son véhicule.

Afficher clairement :

- Disponible.
- Réservé.
- En route vers le départ.
- Sur place.
- Patient à bord.
- En route vers la destination.
- Arrivé.
- En attente de remise du patient.
- Indisponible.
- Hors service.

Empêcher les affectations incompatibles et les doubles réservations.

## 5. Correction du parcours DT-000010

Une anomalie a été observée pendant le test.

Dans Sillage, le transport DT-000010 affiche :

- Demande : 16 h 46.
- Décision : 16 h 52.
- Prise en charge : 16 h 57.
- Arrivée : 16 h 59.
- Étape non confirmée : Départ.

Pourtant, le départ avait été confirmé dans NSA et le lit hospitalier avait été libéré.

### Corrections demandées

- Identifier la cause exacte de l'événement de départ manquant.
- Vérifier la transmission des événements entre NSA, Transport, Flux, Sillage et Chrono.
- Vérifier la cohérence des identifiants de mission et de patient.
- Synchroniser les confirmations sans imposer une double saisie inutile.
- Distinguer les heures programmées des heures réelles.
- Vérifier les écarts d'horodatage entre Flux et Sillage.
- Empêcher les transitions incohérentes.
- Conserver la traçabilité des corrections.

Ne pas inventer d'horodatage historique manquant.

## 6. ARRIMO CHRONO — Refonte stratégique

**Priorité élevée.**

Chrono doit devenir un véritable outil de gestion de la disponibilité ambulancière et de réduction des délais d'immobilisation.

Il ne doit pas être une simple liste de chronomètres.

### Anomalies observées

- DM-103 apparaît encore en route vers l'Hôpital A après le transport vers le CHSLD.
- Plusieurs passages de DM-101 affichent exactement 38 minutes.
- La clôture de Chrono après réception du patient reste à vérifier.

Déterminer si ces éléments correspondent à des missions distinctes, à des données fictives, à des doublons ou à des erreurs de synchronisation.

### 6.1. Horodatage automatique

Enregistrer les événements réels suivants :

1. Création de la demande.
2. Acceptation.
3. Attribution du véhicule.
4. Départ vers le lieu de prise en charge.
5. Arrivée au lieu de prise en charge.
6. Patient pris en charge.
7. Départ vers la destination.
8. Arrivée à destination.
9. Remise du patient à l'établissement.
10. Fin des opérations nécessaires.
11. Ambulance à nouveau disponible.

Chaque événement doit être horodaté, attribuable et consultable.

### 6.2. Mesure des délais

Calculer automatiquement :

- Délai de réponse à la demande.
- Délai de mobilisation.
- Temps de déplacement.
- Temps d'attente au départ.
- Temps de transport du patient.
- Temps d'attente à destination.
- Temps de remise du patient.
- Temps de remise en disponibilité.
- Durée totale de la mission.
- Durée totale d'immobilisation du véhicule.

Distinguer les temps de transport planifié des passages ambulanciers aux urgences.

### 6.3. Tableau de bord en temps réel

Afficher :

- Ambulances disponibles.
- Ambulances en mission.
- Ambulances en attente dans les établissements.
- Durée d'attente de chaque ambulance.
- Établissement et service concernés.
- Nombre de dépassements de seuil.
- Temps d'attente moyen et médian.
- Temps d'immobilisation cumulé.
- Historique des passages terminés.
- Dernière actualisation des données.

Ajouter des filtres par établissement, région, entreprise, véhicule, type de mission et période.

### 6.4. Alertes intelligentes

Mettre en place des seuils configurables selon les organisations et les types de mission.

Exemples de seuils de démonstration :

- 15 minutes : surveillance.
- 20 minutes : avertissement.
- 30 minutes : alerte.
- 45 minutes : alerte renforcée.
- 60 minutes : escalade prioritaire.

Ces valeurs sont configurables et ne doivent pas être présentées comme des normes officielles du Québec.

Notifier les responsables autorisés et éviter les alertes répétitives inutiles.

### 6.5. Coordination avec les établissements

Permettre aux établissements de :

- Visualiser les ambulances attendues.
- Consulter leur heure estimée d'arrivée.
- Préparer les ressources nécessaires.
- Confirmer la prise en charge du patient.
- Signaler un retard et sa cause.
- Confirmer la fin de la remise du patient.

Permettre à l'équipe ambulancière de confirmer sa remise en disponibilité après les opérations nécessaires.

### 6.6. Analyse des causes de retard

Prévoir des catégories configurables :

- Absence de civière disponible.
- Manque de personnel.
- Chambre non préparée.
- Attente de transmission du dossier.
- Saturation du service.
- Nettoyage.
- Incident technique.
- Autre motif.

Ne pas attribuer automatiquement une responsabilité sans données suffisantes.

### 6.7. Intégration avec OG

OG doit pouvoir :

- Identifier les délais anormaux.
- Résumer les immobilisations.
- Détecter les établissements sous pression.
- Proposer des actions opérationnelles.
- Anticiper les risques de saturation à partir des données disponibles.
- Générer des rapports de performance.

Les recommandations d'OG doivent rester explicables et soumises aux décisions des professionnels autorisés.

### 6.8. Indicateurs commerciaux

Chrono doit permettre de mesurer pendant un pilote :

- L'évolution du temps moyen d'immobilisation.
- La réduction des dépassements de seuil.
- Les heures ambulancières récupérées.
- L'évolution de la disponibilité des véhicules.
- L'évolution des délais de remise des patients.

Ne jamais afficher de gains fictifs comme des résultats réels.

## 7. Refonte de Sillage

Sillage doit représenter fidèlement le parcours réel du patient.

Afficher une chronologie complète et cohérente des événements :

- Demande.
- Décision.
- Préparation.
- Transport.
- Départ.
- Arrivée.
- Réception.
- Installation.
- Clôture.

Relier les événements aux modules concernés, avec l'identifiant du parcours, l'auteur, l'établissement et l'heure réelle.

Les événements manquants doivent être clairement signalés et investigables.

## 8. Module Réseau

Sortir Réseau du module Administration.

Créer un accès principal indépendant dans la navigation.

Préserver ses fonctionnalités existantes et améliorer, si nécessaire, la visibilité sur :

- Les établissements connectés.
- Les hôpitaux.
- Les CHSLD.
- Les RPA.
- Les cliniques.
- Les CCS.
- Les entreprises ambulancières.
- Les capacités disponibles.
- Les demandes interétablissements.
- Les transports en cours.
- Les alertes du réseau.

Respecter les périmètres organisationnels et les autorisations de consultation.

## 9. Module National

Sortir également National du module Administration.

Créer un accès principal indépendant, destiné au pilotage stratégique par les utilisateurs autorisés.

Prévoir une visibilité sur :

- Les régions et territoires.
- Les établissements connectés.
- Les capacités hospitalières.
- Les capacités d'hébergement.
- Les taux d'occupation.
- Les niveaux de saturation.
- Les patients NSA.
- La disponibilité ambulancière.
- Les délais Chrono.
- Les transferts interrégionaux.
- Les alertes majeures.

Utiliser des données agrégées lorsque les données nominatives ne sont pas nécessaires.

## 10. Refonte de l'accueil

Ajouter deux blocs de synthèse indépendants.

### Bloc Réseau

- Établissements connectés.
- Capacités disponibles.
- Demandes en attente.
- Transports en cours.
- Alertes du réseau.

### Bloc National

- Régions couvertes.
- Occupation globale.
- Saturation régionale.
- Disponibilité ambulancière.
- Alertes majeures.

Chaque bloc doit être cliquable, actualisé automatiquement et adapté aux permissions.

Ajouter une synthèse OG des événements importants, sans exposer de données non autorisées.

## 11. Navigation et ergonomie

Vérifier intégralement les deux modes de navigation :

- Navigation verticale.
- Navigation horizontale.

Les modules et sous-modules autorisés doivent être accessibles dans les deux modes.

Corriger les sous-menus manquants, les problèmes de responsive design et les incohérences de navigation.

Administration doit rester dédiée à la configuration, aux utilisateurs, aux permissions et à la sécurité.

Respecter l'identité visuelle actuelle d'Arrimo.

## 12. Sécurité et intégrité

Vérifier systématiquement :

- Isolation des organisations.
- Contrôle des permissions côté serveur.
- Protection des données patients.
- Traçabilité des actions.
- Validation des transitions de statut.
- Gestion des accès régionaux et nationaux.
- Protection contre les doublons.
- Intégrité des données.
- Compatibilité avec l'architecture DSN existante.

Ne pas modifier les règles de sécurité pour contourner un problème fonctionnel.

Ne pas exposer de secrets ou de données personnelles dans les journaux.

## 13. Tests obligatoires

Exécuter les tests existants et ajouter des tests de régression.

Tester notamment :

- Urgences → admission → nettoyage.
- Hôpital → NSA → CHSLD.
- Demande → acceptation → transport → arrivée.
- Préparation et occupation de la chambre.
- Libération et nettoyage du lit hospitalier.
- Clôture du transport.
- Remise en disponibilité de l'ambulance.
- Synchronisation Chrono, Sillage, Flux et NSA.
- Départ anticipé par rapport à l'heure programmée.
- Refus et annulation d'une mission.
- Affectation de plusieurs véhicules.
- Alertes Chrono.
- Permissions Réseau et National.
- Affichage de l'accueil.
- Navigation verticale et horizontale.

Tester les API, les interfaces, les migrations et les parcours de bout en bout.

Corriger les régressions avant publication.

## 14. Déploiement autonome

Lorsque tous les contrôles bloquants sont réussis :

1. Vérifier le build.
2. Vérifier les migrations.
3. Créer une sauvegarde et un point de restauration.
4. Enregistrer les modifications Git.
5. Déployer sur l'environnement de démonstration existant d'Arrimo.
6. Vérifier le fonctionnement après déploiement.
7. Exécuter les tests de contrôle sur la version déployée.
8. Restaurer la version précédente si un problème critique survient.

Ne pas déployer sur un environnement contenant de vraies données patients sans autorisation spécifique.

Si un accès, une permission ou un secret indispensable manque, signaler précisément le blocage.

## 15. Rapport final obligatoire

À la fin, fournir :

- État du travail laissé par Claude Code.
- Travaux repris et terminés.
- Liste des anomalies identifiées.
- Causes techniques confirmées.
- Corrections réalisées.
- Fonctionnalités ajoutées.
- Fichiers modifiés.
- Résultats des tests.
- Nombre de tests réussis et échoués.
- État du déploiement.
- URL de démonstration vérifiée.
- Identifiant du commit final.
- Risques résiduels et travaux restants.

Ne pas déclarer une fonctionnalité opérationnelle sans preuve de test.

**Consigne finale : commence immédiatement par l'audit du dépôt, puis poursuis de manière autonome jusqu'à la correction, aux tests et au déploiement sécurisé de la démonstration.**
