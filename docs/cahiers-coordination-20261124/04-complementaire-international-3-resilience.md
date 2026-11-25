# ARRIMO — CAHIER COMPLÉMENTAIRE INTERNATIONAL Nº 3
## Renforcement des autres modules et de la résilience opérationnelle

**Entreprise :** SenseAfriGroup  
**Destinataire :** Claude Code  
**Date :** 24 novembre 2026  
**Session de développement :** jeudi 26 novembre 2026  
**Classification :** Interne — Confidentiel

---

## 1. Mission

Ce cahier complète les trois documents précédents sans les remplacer.

Il concerne principalement les modules et fonctionnalités qui n'ont pas encore bénéficié d'un approfondissement suffisant.

L'objectif est de renforcer la valeur opérationnelle d'Arrimo au Québec, au Canada et à l'international, notamment en Afrique.

Ne pas reprendre les travaux déjà documentés concernant Chrono, les quotes-parts, les immobilisations ambulancières, les NSA, les prévisions capacitaires et la coordination des transferts.

Réutiliser les fonctionnalités existantes et ne développer que les améliorations manquantes.

## 2. Inspirations internationales

| Pays | Pratique de référence à approfondir | Application proposée |
|---|---|---|
| Angleterre | Continuité des services et évacuation hospitalière | Mode crise |
| Australie | Coordination des incidents et rétablissement des services | Mode crise, Réseau |
| France | Référentiels de ressources sanitaires et orientation | Urgences proches |
| Estonie | Traçabilité des accès aux informations de santé | Données, Arrimo Connect |
| Danemark | Communication numérique avec les patients | Famille |
| États-Unis | Exercices de préparation aux situations exceptionnelles | Formation |
| Rwanda | Santé numérique adaptée aux contraintes territoriales | Accessibilité, continuité |
| Singapour | Coordination numérique des opérations hospitalières | Admissions, Mes tâches |

Ces références constituent des pistes d'inspiration. Leurs modalités exactes doivent être documentées et vérifiées avant toute présentation commerciale.

## 3. Mode crise — Gestion des situations exceptionnelles

### 3.1. Situations à prendre en charge

- Incendie dans un CHSLD ou un hôpital.
- Inondation.
- Panne électrique prolongée.
- Interruption informatique.
- Fermeture temporaire d'un établissement.
- Évacuation partielle ou totale.
- Afflux exceptionnel de patients.
- Épidémie.
- Indisponibilité importante de personnel ou de ressources.

### 3.2. Poste de coordination de crise

Renforcer l'interface existante afin de centraliser :

- Nature et périmètre de l'incident.
- Établissements concernés.
- Autorité responsable.
- Patients et résidents concernés.
- Ressources disponibles et mobilisables.
- Capacités de réserve.
- Besoins non satisfaits.
- Actions prioritaires.
- Progression de la résolution.
- Décisions et communications officielles.

L'activation et la clôture du Mode crise doivent relever d'un responsable autorisé.

### 3.3. Évacuation et suivi individuel

Chaque résident ou patient concerné doit pouvoir être suivi durant l'intégralité de son déplacement.

Prévoir :

- Identifiant unique.
- Localisation confirmée.
- Besoins particuliers renseignés par les professionnels.
- Destination validée.
- Moyen de transport attribué.
- Confirmation du départ.
- Confirmation de l'arrivée.
- Confirmation de la prise en charge.
- Information autorisée des proches.

Empêcher qu'une personne soit comptabilisée deux fois ou disparaisse du suivi lors d'un changement de destination.

### 3.4. Continuité des activités

Permettre aux gestionnaires de visualiser les conséquences d'un incident sur les autres établissements.

OG doit pouvoir proposer des scénarios opérationnels alternatifs en tenant compte des ressources confirmées, des contraintes territoriales et des services devant rester accessibles.

Ne pas mobiliser automatiquement les ambulances ni remplacer les autorités responsables de la sécurité civile.

### 3.5. Fonctionnement dégradé

Prévoir, selon les possibilités techniques :

- Consultation limitée des dernières informations autorisées.
- Affichage explicite de leur ancienneté.
- Enregistrement sécurisé des événements hors connexion.
- Synchronisation après rétablissement.
- Gestion des conflits de données.
- Procédure de secours indépendante d'Arrimo.

### 3.6. Retour à la normale

Ne pas limiter le Mode crise à la gestion immédiate de l'incident.

Suivre également :

- Réouverture progressive des services.
- Retour des résidents.
- Rétablissement des capacités.
- Ressources restant indisponibles.
- Actions correctives.
- Rapport post-incident.
- Enseignements pour les futurs exercices.

**Plus-value :** faciliter la continuité des opérations et éviter la perte de visibilité sur les patients et les ressources pendant une crise.

## 4. Visites — Coordination intelligente des visites

Faire évoluer Visites au-delà de la simple gestion des rendez-vous.

### Améliorations

- Gestion des créneaux selon les contraintes des unités.
- Configuration des règles propres aux établissements.
- Gestion des accompagnateurs autorisés.
- Adaptation des visites lors d'un transfert ou d'un changement de chambre.
- Communication des restrictions temporaires.
- Gestion des exceptions validées.
- Suspension ciblée des visites pendant une crise.
- Notification des visiteurs concernés.
- Possibilité de reprogrammer une visite.
- Accessibilité pour les personnes peu familiarisées avec les outils numériques.

Prévoir une solution alternative pour les personnes ne disposant pas de téléphone intelligent.

**Plus-value :** diminuer les appels administratifs, les déplacements inutiles et les perturbations des équipes hospitalières.

## 5. Arrimo Famille — Continuité de l'information

Transformer Famille en véritable espace de coordination non clinique entre les établissements et les proches autorisés.

### Améliorations

- Désignation des proches autorisés.
- Gestion du consentement et des droits d'accès.
- Notification des changements de lieu de prise en charge.
- Suivi des étapes logistiques d'un transfert.
- Confirmation de l'arrivée dans l'établissement d'accueil.
- Communication des démarches attendues de la famille.
- Transmission de demandes administratives.
- Gestion des notifications selon les préférences.
- Révocation immédiate des accès.
- Communication adaptée aux situations de crise.

### Liaison avec les autres modules

Connecter Famille avec Visites, Admissions, Transferts, Liaison CHSLD, Transport et Mode crise.

Ne jamais transmettre automatiquement un diagnostic, un pronostic ou une information clinique sensible sans autorisation appropriée.

**Plus-value :** réduire les appels répétitifs, améliorer la continuité de l'information et rassurer les proches sans augmenter inutilement la charge des professionnels.

## 6. Mes tâches — Organisation opérationnelle intelligente

Faire évoluer Mes tâches vers une gestion des dépendances opérationnelles.

### Améliorations

- Identification des tâches dont dépendent plusieurs services.
- Gestion des tâches bloquantes.
- Transmission structurée entre équipes de jour, de soir et de nuit.
- Désignation d'un remplaçant autorisé.
- Réaffectation en cas d'absence.
- Regroupement des notifications redondantes.
- Visualisation de la charge opérationnelle.
- Identification des tâches pouvant être réalisées simultanément.
- Confirmation du résultat obtenu.

OG doit pouvoir expliquer pourquoi une tâche est importante et quelles autres opérations en dépendent.

Ne pas utiliser les indicateurs pour sanctionner automatiquement les employés.

**Plus-value :** éviter les oublis lors des changements d'équipe et réduire les retards causés par une mauvaise coordination interne.

## 7. Admissions — Préparation opérationnelle de l'accueil

Renforcer les admissions en travaillant sur la préparation avant l'arrivée du patient.

### Améliorations

- Liste de préparation configurable selon le type d'admission.
- Vérification des documents administratifs nécessaires.
- Identification des ressources et équipements requis.
- Préparation des besoins d'accessibilité.
- Identification des informations manquantes.
- Confirmation de la préparation par les services concernés.
- Gestion des admissions reportées ou annulées.
- Synchronisation avec les événements autorisés du DSN.
- Détection des doublons d'identité nécessitant une vérification humaine.

Arrimo doit distinguer la préparation opérationnelle de l'autorisation clinique d'admission.

**Plus-value :** réduire les délais administratifs et les difficultés d'accueil évitables.

## 8. Urgences proches — Orientation fiable des citoyens

Renforcer ce module afin de fournir une information utile sans transformer Arrimo en outil de diagnostic médical.

### Informations proposées

- Établissements proches.
- Services effectivement offerts.
- Horaires confirmés.
- Restrictions temporaires.
- Accessibilité.
- Coordonnées officielles.
- Distance et temps de déplacement estimés.
- Date et heure de dernière actualisation.
- Ressources alternatives officiellement reconnues.

Au Québec, intégrer les liens vers les ressources officielles pertinentes, notamment Info-Santé 811 et les services d'urgence.

Ne pas recommander à une personne présentant une urgence médicale de choisir un établissement uniquement selon son temps d'attente.

Les capacités opérationnelles internes ne doivent pas être rendues publiques sans autorisation.

**Plus-value :** améliorer l'accès à une information fiable et limiter les déplacements vers des services indisponibles ou inadaptés.

## 9. Formation — Environnement de simulation

Transformer Formation en espace d'entraînement opérationnel multi-acteurs.

### Exercices proposés

- Évacuation d'un CHSLD.
- Fermeture temporaire d'une urgence.
- Panne du système informatique.
- Interruption des communications.
- Transfert vers un établissement d'accueil.
- Incident touchant plusieurs organisations.
- Changement d'équipe pendant une situation critique.
- Rétablissement progressif des activités.

### Fonctionnalités

- Scénarios configurables.
- Patients et ressources fictifs.
- Attribution des rôles.
- Injection d'événements simulés.
- Suivi des décisions.
- Évaluation des délais.
- Rapport de fin d'exercice.
- Identification des erreurs de coordination.
- Recommandations pédagogiques.

Isoler totalement les simulations des opérations réelles.

**Plus-value :** permettre aux établissements de tester leurs procédures et leurs capacités de coordination avant une situation réelle.

## 10. Données — Gouvernance et fiabilité

Renforcer la qualité des informations utilisées par Arrimo.

### Améliorations

- Identification de la source de chaque donnée.
- Historique des corrections.
- Détection des incohérences.
- Contrôle des données manquantes.
- Identification des informations périmées.
- Suivi de la qualité par établissement.
- Traçabilité des consultations sensibles.
- Gestion des règles de conservation.
- Anonymisation des données utilisées pour les analyses autorisées.

OG doit pouvoir indiquer lorsqu'une recommandation ne peut pas être produite faute de données fiables.

**Plus-value :** renforcer la confiance des établissements dans les informations et recommandations d'Arrimo.

## 11. Indicateurs — Analyse des causes et amélioration continue

Les indicateurs opérationnels et économiques figurent déjà dans les précédents cahiers.

Le présent complément doit approfondir leur exploitation.

### Améliorations

- Comparaison entre périodes comparables.
- Analyse des problèmes récurrents.
- Distinction entre pénurie structurelle et problème de coordination.
- Mesure des effets des actions correctives.
- Comparaison des résultats avant et après une modification organisationnelle.
- Analyse des écarts entre prévisions et résultats.
- Identification des différences territoriales.
- Mesure de la qualité et de la complétude des données.

Ne pas comparer directement des établissements dont les missions, les populations ou les ressources diffèrent fortement.

Ne pas attribuer automatiquement une amélioration à Arrimo sans méthode d'évaluation appropriée.

**Plus-value :** aider les directions à comprendre quelles mesures fonctionnent réellement et où concentrer leurs investissements.

## 12. Arrimo Connect — Résilience des intégrations

Les connexions HL7, FHIR et DSN sont déjà traitées dans les précédents documents.

Ce complément concerne principalement la fiabilité des échanges.

### Améliorations

- Tableau de santé des connexions.
- Identification des événements non transmis.
- File d'attente sécurisée des échanges.
- Reprise contrôlée après interruption.
- Réconciliation des événements contradictoires.
- Gestion des versions des interfaces.
- Environnement de test des intégrations.
- Contrôle des autorisations de partage.
- Suivi des erreurs par partenaire.
- Possibilité de suspendre une connexion défaillante sans interrompre tout Arrimo.

Ne pas considérer une connexion comme fonctionnelle avant validation avec le partenaire concerné.

**Plus-value :** éviter qu'une panne d'un système partenaire compromette l'ensemble de la coordination opérationnelle.

## 13. Réseau et National — Coopération entre territoires

Compléter les tableaux régionaux déjà prévus par des mécanismes de coopération.

### Améliorations

- Demandes de soutien entre territoires.
- Identification des ressources mutualisables.
- Suivi des engagements entre organisations.
- Coordination des capacités de réserve.
- Gestion des demandes exceptionnelles.
- Suivi des ressources temporairement prêtées.
- Confirmation de restitution.
- Simulation des conséquences d'une mobilisation de ressources sur le territoire d'origine.

Les décisions restent sous la responsabilité des autorités compétentes.

Ne pas modifier SH.

**Plus-value :** permettre une meilleure coopération territoriale lorsque les ressources locales deviennent insuffisantes.

## 14. OG — Simulation et apprentissage opérationnel

Compléter les recommandations déjà prévues dans les autres cahiers.

OG doit pouvoir :

- Comparer plusieurs scénarios opérationnels.
- Expliquer leurs avantages et leurs contraintes.
- Identifier les conséquences possibles sur les autres services.
- Détecter les dépendances entre actions.
- Signaler les informations nécessaires mais indisponibles.
- Comparer les résultats attendus aux résultats réellement observés.
- Exploiter les enseignements des exercices et incidents antérieurs, selon les autorisations.

Séparer strictement les simulations des décisions réelles.

OG ne doit pas apprendre automatiquement de données sensibles ni modifier seul les règles métier.

## 15. Adaptation internationale

Arrimo doit conserver un moteur commun tout en permettant une configuration propre à chaque pays.

| Domaine | Adaptation nécessaire |
|---|---|
| Organisation sanitaire | Structures et autorités locales |
| Langues | Traductions et terminologie |
| Connectivité | Fonctionnement adapté aux réseaux instables |
| Interopérabilité | Systèmes nationaux et locaux |
| Confidentialité | Législation applicable |
| Urgences | Numéros et protocoles officiels |
| Mode crise | Organisation locale de la sécurité civile |
| Accessibilité | Équipements et usages numériques |
| Hébergement | Exigences territoriales applicables |

Ne pas imposer les règles québécoises aux établissements africains ou européens.

## 16. Scénario transversal obligatoire

### Évacuation fictive d'un CHSLD de 49 résidents

1. Activation du Mode crise par un responsable autorisé.
2. Identification des 49 résidents concernés.
3. Recherche des capacités d'accueil compatibles.
4. Validation des destinations.
5. Organisation des moyens de transport autorisés.
6. Attribution des tâches aux responsables.
7. Suivi individuel des départs et des arrivées.
8. Information des familles autorisées.
9. Simulation d'une interruption de connexion.
10. Rétablissement et réconciliation des données.
11. Vérification de la prise en charge des 49 résidents.
12. Organisation du retour à la normale.
13. Production du rapport post-incident.

Tester les changements de destination, les transports annulés, les capacités devenues indisponibles et les confirmations manquantes.

Aucun résident ne doit être considéré comme arrivé sans confirmation appropriée.

## 17. Nouveaux indicateurs à préparer

| Indicateur | Objectif |
|---|---|
| Résidents localisés pendant une évacuation | Maximiser |
| Réceptions confirmées | Maximiser |
| Temps de coordination d'une crise | Réduire |
| Temps de rétablissement des opérations | Réduire |
| Appels administratifs répétitifs | Réduire |
| Visites inutilement déplacées | Réduire |
| Tâches perdues lors des changements d'équipe | Réduire |
| Événements d'intégration non réconciliés | Réduire |
| Qualité des données | Améliorer |
| Réussite des exercices de simulation | Améliorer |

## 18. Priorités proposées pour Claude Code

**P0 — Fiabilité et sécurité**

- Gouvernance des données.
- Résilience des intégrations.
- Permissions Famille.
- Isolation des simulations.
- Traçabilité des patients en Mode crise.

**P1 — Valeur opérationnelle**

- Mode crise et continuité des activités.
- Mes tâches et changements d'équipe.
- Préparation des admissions.
- Coordination Famille et Visites.

**P2 — Différenciation et expansion**

- Formation multi-acteurs.
- Simulation OG.
- Coopération territoriale.
- Analyse avancée des indicateurs.
- Adaptation internationale.

Ces priorités sont proposées et devront être ajustées selon l'état réel des fonctionnalités existantes.

## 19. Instructions finales

- Conserver intégralement les trois cahiers précédents.
- Ne pas répéter les développements déjà prévus.
- Vérifier chaque amélioration par rapport à l'existant.
- Ne pas créer de nouveau module indépendant.
- Ne pas modifier SH.
- Préserver les fonctionnalités opérationnelles.
- Utiliser des données fictives pour les tests.
- Ne pas publier en production.
- Documenter uniquement les améliorations réellement apportées.
- Identifier les dépendances externes et les validations nécessaires.

Les propositions de ce complément ne constituent pas des fonctionnalités manquantes confirmées dans le code. Les références internationales doivent être vérifiées et les bénéfices mesurés lors des futurs pilotes.

## 20. Vision finale

Arrimo doit être capable d'accompagner un réseau de santé dans son fonctionnement quotidien, mais également lorsqu'il subit une crise, une panne, une pénurie ou une désorganisation exceptionnelle.

La plus-value recherchée repose sur quatre dimensions complémentaires :

**Coordination opérationnelle, continuité des services, résilience territoriale et amélioration continue.**

Ce quatrième document de travail complète les trois cahiers précédents. Il ne les remplace pas.
