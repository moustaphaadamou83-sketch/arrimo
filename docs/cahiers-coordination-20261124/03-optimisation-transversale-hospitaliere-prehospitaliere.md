# CAHIER DES CHARGES — ARRIMO
## Optimisation transversale de la coordination hospitalière et préhospitalière

**Entreprise :** SenseAfriGroup  
**Produit :** Arrimo  
**Date de réalisation prévue :** 26 novembre 2026  
**Classification :** Interne — Confidentiel

> Note de Moustafa jointe à ce cahier (« 5. Notre priorité jeudi avec Claude Code ») : concentrer le travail sur quatre capacités — détecter les blocages, identifier les solutions opérationnelles possibles, coordonner les acteurs responsables, mesurer les résultats obtenus — en utilisant les modules existants.

---

## 1. Contexte et objectifs

À la suite des rencontres avec les professionnels du secteur préhospitalier, notamment les ambulanciers rencontrés au CHUM, et des recherches sur les difficultés du réseau de santé québécois, Arrimo doit renforcer ses capacités de coordination opérationnelle.

Les problématiques identifiées concernent notamment :

- L'immobilisation prolongée des ambulances aux urgences.
- L'indisponibilité des civières.
- La saturation des établissements hospitaliers.
- Les difficultés de répartition ambulancière.
- La gestion des quotes-parts hospitalières.
- Les patients en attente de placement en CHSLD.
- Les retards de transferts et de transports.
- Les ruptures de couverture ambulancière.
- Le manque de visibilité transversale entre les organisations.
- L'anticipation insuffisante de certains blocages opérationnels.

L'objectif est de faire évoluer Arrimo vers une coordination proactive, interconnectée et mesurable.

## 2. Instructions fondamentales pour Claude Code

Avant toute modification :

- Examiner intégralement l'architecture actuelle d'Arrimo.
- Examiner les bases de données, API, moteurs métier, interfaces et permissions.
- Identifier les fonctionnalités déjà opérationnelles.
- Identifier les fonctionnalités partielles ou incomplètes.
- Vérifier les interconnexions entre les modules.
- Réutiliser systématiquement les composants et moteurs existants.
- Éviter toute duplication de données, de règles métier ou de fonctionnalités.
- Préserver les fonctionnalités déjà validées.
- Ne pas créer de nouveau module indépendant.
- Ne pas ajouter de nouveau type d'établissement.

Produire une matrice indiquant, pour chaque exigence du présent cahier :

1. Fonctionnalité existante.
2. Fonctionnalité partiellement existante.
3. Fonctionnalité manquante.
4. Modification nécessaire.
5. Modules et composants concernés.
6. Tests nécessaires.

Ne pas considérer une fonctionnalité comme opérationnelle sans vérification de son fonctionnement réel.

---

## 3. Gestion transversale des quotes-parts hospitalières

### 3.1. Architecture

Intégrer la gestion des quotes-parts dans le moteur métier existant d'Arrimo, avec Liaison Secours comme interface opérationnelle principale.

Cette fonctionnalité doit être accessible aux différents modules concernés selon leurs permissions.

Prévoir :

- Quote-part attribuée à chaque établissement.
- Autorité responsable de son attribution.
- Période de validité.
- Date et heure de dernière actualisation.
- Ambulances reçues.
- Ambulances attendues.
- Ambulances en route.
- Marge restante, lorsque son calcul est officiellement défini.
- Exceptions autorisées.
- Historique des modifications.
- Source et fiabilité des données.

### 3.2. Configuration territoriale

Les règles doivent être configurables selon :

- Le pays.
- La province.
- La région.
- Le CCS.
- L'établissement.
- Les protocoles applicables.

Ne pas imposer une période fixe de deux heures.

Ne pas inventer de formule de calcul des quotes-parts.

Les règles opérationnelles réelles devront être confirmées auprès des autorités compétentes avant activation.

En l'absence de données officielles, afficher « Non renseigné » ou « Non disponible », et non zéro.

### 3.3. Interconnexion

Connecter cette fonctionnalité avec :

- Liaison Secours.
- Chrono.
- Bourse.
- Capacités.
- Transferts.
- Transport.
- Liaison CHSLD.
- OG.
- Vigilance.
- Sillage.
- Console SH.
- Réseau et National.

Chaque acteur doit uniquement accéder aux informations nécessaires à ses responsabilités.

Les quotes-parts ne doivent jamais remplacer les critères cliniques, les protocoles médicaux ou les décisions des répartiteurs autorisés.

---

## 4. Renforcement de Liaison Secours — CCS

Enrichir le tableau de bord existant du CCS.

### Informations opérationnelles

- Ambulances disponibles.
- Ambulances engagées.
- Ambulances immobilisées.
- Ambulances en déplacement.
- Ambulances en attente de transfert de responsabilité.
- Ambulances indisponibles et motifs associés.
- Préalertes hospitalières.
- Interventions en attente, si les données sont accessibles.
- Capacités hospitalières actualisées.
- Quotes-parts applicables.
- Contraintes de réception.
- Services et spécialités disponibles.
- Temps de déplacement estimé.
- Délais de prise en charge observés.

### Répartition hospitalière

Permettre au répartiteur de comparer les destinations autorisées selon :

- La condition clinique renseignée par les professionnels.
- Les protocoles applicables.
- La proximité.
- Les capacités de réception.
- Les quotes-parts.
- Les ambulances déjà attendues.
- Les délais d'immobilisation observés.
- Les restrictions hospitalières.
- La fraîcheur des informations.

OG peut fournir une recommandation explicable, mais la décision finale appartient au professionnel autorisé.

Ne pas remplacer les systèmes officiels de répartition ou de gestion des appels d'urgence.

---

## 5. Renforcement de l'interface ambulancière

Réutiliser l'interface ambulancière existante.

Permettre aux équipages de consulter :

- Leur intervention attribuée.
- Leur destination validée.
- Les informations opérationnelles pertinentes sur l'établissement.
- Les instructions transmises par le CCS.
- Le statut de la préalerte.
- La confirmation de réception.
- Le statut de prise en charge.
- Les éventuels changements de destination autorisés.
- Les délais associés à leur intervention.

Vérifier le parcours complet :

Intervention → Affectation → Acceptation → Déplacement → Prise en charge → Transport → Arrivée → Transfert de responsabilité → Remise en disponibilité.

Assurer une synchronisation cohérente entre l'ambulance, le CCS et l'hôpital.

Aucune ambulance ne doit être déclarée disponible automatiquement sans respecter les conditions métier et les confirmations nécessaires.

---

## 6. Renforcement de Chrono

### 6.1. Mesure des délais

Exploiter les événements Chrono existants, notamment les étapes H11 à H15, après vérification de leur définition exacte dans le système.

Mesurer distinctement :

- Le délai d'accès au triage.
- Le délai de prise en charge.
- Le délai de transfert de responsabilité.
- Le délai de libération de la civière ambulancière.
- Le délai de remise en disponibilité du véhicule.
- La durée totale d'immobilisation hospitalière.

### 6.2. Causes d'immobilisation

Prévoir une classification configurable des causes :

- Civière hospitalière indisponible.
- Triage saturé.
- Attente de prise en charge.
- Attente de transfert de responsabilité.
- Manque de personnel.
- Nettoyage ou remise en état.
- Contraintes cliniques.
- Incident technique.
- Autre cause documentée.
- Cause inconnue.

Ne jamais attribuer automatiquement une cause sans données suffisantes.

### 6.3. Indicateurs

Produire des indicateurs par établissement, région, période et organisation :

- Durée moyenne et médiane d'immobilisation.
- Percentile 90 des délais.
- Nombre de dépassements des seuils configurés.
- Heures cumulées d'immobilisation.
- Répartition des causes.
- Nombre d'ambulances simultanément immobilisées.
- Évolution des délais dans le temps.

Distinguer les délais observés des délais potentiellement évitables.

---

## 7. Renforcement des capacités hospitalières et de Bourse

Connecter les informations existantes relatives aux :

- Lits disponibles.
- Lits occupés.
- Lits réservés.
- Lits en nettoyage.
- Lits indisponibles.
- Civières disponibles.
- Civières occupées.
- Civières en préparation.
- Admissions attendues.
- Ambulances en route.
- Sorties prévues.
- Transferts programmés.

### Anticipation des capacités

Lorsque les données sont suffisantes, permettre une estimation des capacités susceptibles de se libérer.

Distinguer clairement :

- Disponibilité confirmée.
- Disponibilité prévisionnelle.
- Disponibilité réservée.
- Disponibilité inconnue.

Une prévision ne doit jamais être présentée comme une capacité réelle.

Empêcher les doubles réservations et les incohérences entre Bourse, Capacités, Admissions et Liaison Secours.

---

## 8. Renforcement de Liaison CHSLD et des hébergements

Identifier les patients dont la sortie hospitalière est autorisée, mais retardée pour une raison opérationnelle.

Prévoir le suivi des obstacles suivants :

- Absence de place compatible.
- Demande de placement sans réponse.
- Acceptation en attente.
- Transport indisponible.
- Préparation de la chambre.
- Documents manquants.
- Coordination avec la famille.
- Autres contraintes autorisées.

Exploiter les fonctionnalités existantes de recherche et de rapprochement des capacités d'hébergement.

Connecter chaque placement validé avec :

- Transferts.
- Transport.
- Capacités.
- Bourse.
- Nettoyage.
- Sillage.
- Vigilance.
- Famille.
- OG.

L'objectif est de réduire les délais opérationnels entre l'autorisation de sortie et le départ effectif du patient.

Ne pas automatiser les décisions cliniques ou administratives de placement.

---

## 9. Renforcement du module Transport

Intégrer les transporteurs à l'ensemble de la chaîne de coordination.

### Transports concernés

- Hôpital vers CHSLD.
- CHSLD vers hôpital.
- Hôpital vers RPA.
- Retour vers un hébergement.
- Transfert interhospitalier.
- Transport non urgent autorisé.

### Fonctionnalités

- Anticipation des besoins de transport.
- Disponibilité des véhicules.
- Compatibilité avec les besoins du patient.
- Affectation des demandes.
- Confirmation de prise en charge.
- Planification des horaires.
- Estimation des heures d'arrivée.
- Coordination avec les établissements de départ et de réception.
- Gestion des retards.
- Gestion des annulations.
- Recherche d'alternatives autorisées.
- Historique des mouvements.

Les transporteurs non urgents ne doivent pas être soumis automatiquement aux quotes-parts ambulancières.

Ils doivent recevoir uniquement les contraintes de réception et de planification applicables à leurs missions.

---

## 10. Gestion des ruptures de couverture et de la contingence

Renforcer les fonctionnalités existantes de Liaison Secours, Vigilance, Sillage et Console SH.

Lorsque les données officielles sont disponibles, permettre le suivi des situations suivantes :

- Absence d'ambulance disponible dans une zone.
- Nombre important de véhicules immobilisés.
- Interventions prioritaires en attente.
- Saturation simultanée de plusieurs urgences.
- Indisponibilité d'un établissement.
- Mesures de contingence activées par une autorité compétente.
- Déséquilibres territoriaux.
- Retards importants de transferts.

Pour chaque événement, conserver :

- Date et heure de début.
- Organisation concernée.
- Région concernée.
- Cause connue ou inconnue.
- Niveau de gravité configuré.
- Mesures prises.
- Responsable de la décision.
- Date et heure de résolution.
- Durée totale.

Ne pas inventer de seuils officiels ou déclencher automatiquement des mesures réglementaires.

---

## 11. Renforcement de Vigilance

Vigilance doit exploiter les données transversales existantes afin de détecter les risques opérationnels.

Exemples d'alertes :

- Saturation hospitalière imminente.
- Ambulances attendues supérieures aux capacités confirmées.
- Quote-part proche d'un seuil configuré.
- Immobilisation ambulancière prolongée.
- Transfert sans réponse.
- Transport en retard.
- Placement accepté mais non réalisé.
- Capacité réservée depuis trop longtemps.
- Risque de rupture de couverture.
- Données critiques obsolètes.
- Incohérence entre plusieurs modules.

Chaque alerte doit être explicable, horodatée, attribuable et orientée vers le professionnel compétent.

Prévoir des mécanismes de déduplication, d'acquittement et de résolution des alertes.

---

## 12. Renforcement de Sillage

Sillage doit permettre de comprendre l'origine et les conséquences des blocages opérationnels.

Exemple de chaîne :

Patient autorisé à sortir → Placement en attente → Lit hospitalier occupé → Admission retardée → Civière d'urgence occupée → Ambulance immobilisée.

Cette chaîne doit être établie à partir d'événements réellement reliés entre eux.

Ne pas présenter une corrélation comme une causalité démontrée.

Préserver :

- La chronologie.
- Les identifiants des événements.
- Les organisations concernées.
- Les actions réalisées.
- Les responsables autorisés.
- Les modifications.
- Les confirmations.
- Les motifs de blocage.
- Les décisions et leurs justifications.

---

## 13. Renforcement d'OG

OG doit devenir davantage un copilote de coordination transversale.

Il doit pouvoir répondre, selon les permissions et les données disponibles, à des questions telles que :

- Pourquoi cette urgence est-elle saturée ?
- Quelles ambulances sont actuellement immobilisées ?
- Quelles sont les causes documentées de leur immobilisation ?
- Quels patients attendent un placement ?
- Quels transferts sont bloqués ?
- Quels transports sont en attente ?
- Quelles capacités pourraient se libérer prochainement ?
- Quels établissements disposent de capacités confirmées ?
- Quelles quotes-parts sont applicables ?
- Quels risques opérationnels nécessitent une intervention ?
- Quelles actions de coordination pourraient réduire les délais ?

Pour chaque recommandation, OG doit présenter :

1. La situation observée.
2. Les données utilisées.
3. Les contraintes applicables.
4. Les actions possibles.
5. Les acteurs concernés.
6. Les incertitudes.
7. Les validations humaines nécessaires.

OG ne doit jamais inventer une disponibilité, un quota, une cause de retard ou une règle clinique.

---

## 14. Console SH, Réseau et National

Renforcer les interfaces de supervision existantes.

Permettre une vision consolidée des :

- Capacités hospitalières.
- Capacités d'hébergement.
- Flux de patients.
- Ambulances disponibles et immobilisées.
- Quotes-parts renseignées.
- Transferts en attente.
- Transports en cours.
- Délais de placement.
- Situations de saturation.
- Ruptures de couverture documentées.
- Mesures de contingence.
- Alertes régionales.
- Indicateurs de performance.

Prévoir des filtres territoriaux, organisationnels et temporels.

Les données agrégées doivent respecter les permissions, la confidentialité et les règles de partage applicables.

---

## 15. Interopérabilité et sécurité

Réutiliser Arrimo Connect et les mécanismes d'intégration existants.

Prévoir, selon les possibilités réelles des partenaires :

- API sécurisées.
- Échanges HL7 et FHIR lorsque pertinents.
- Connexion avec les systèmes hospitaliers.
- Connexion avec les systèmes de répartition ambulancière.
- Échanges avec les systèmes de transport.
- Imports structurés.
- Synchronisation des événements.
- Identification de la source des données.
- Gestion des données obsolètes.
- Gestion des interruptions de connexion.

Le DSN demeure la source officielle du dossier clinique lorsque cette architecture est applicable.

Arrimo ne doit pas créer de double saisie inutile ni écrire dans les dossiers cliniques sans autorisation.

Vérifier l'isolation des organisations, les permissions côté serveur, les journaux d'audit, la confidentialité et la minimisation des données.

Aucune connexion externe ne doit être présentée comme opérationnelle sans intégration et validation effectives.

---

## 16. Scénarios de démonstration obligatoires

Utiliser exclusivement des données fictives dans l'environnement de démonstration.

### Scénario A — Saturation hospitalière

Un établissement ne dispose plus de civière confirmée et plusieurs ambulances sont attendues.

Vérifier la cohérence entre CCS, Liaison Secours, Chrono, Capacités, Vigilance et OG.

### Scénario B — Quote-part et capacité contradictoires

Un établissement dispose d'une marge théorique de quote-part, mais aucune civière disponible.

Arrimo doit distinguer ces deux informations et signaler la contradiction sans décider automatiquement d'une destination.

### Scénario C — Blocage de sortie vers un CHSLD

Un patient autorisé à sortir attend un placement compatible.

Vérifier la coordination entre Liaison CHSLD, Bourse, Transferts, Transport, Capacités et Nettoyage.

### Scénario D — Transport retardé

Un placement est accepté, mais le transporteur est indisponible.

Vérifier les alertes, la recherche d'alternatives autorisées et la mise à jour des prévisions.

### Scénario E — Rupture de couverture

Plusieurs ambulances sont immobilisées et les ressources disponibles deviennent insuffisantes selon des seuils de simulation.

Vérifier la supervision du CCS, de Vigilance et de la Console SH.

### Scénario F — Libération complète d'une capacité

Un patient quitte l'hôpital, son lit est nettoyé, une admission est validée et une civière d'urgence est ensuite libérée.

Vérifier la propagation correcte des événements entre les modules.

### Scénario G — Données indisponibles

Simuler une interruption de synchronisation avec un établissement.

Vérifier qu'Arrimo signale les données obsolètes et ne présente aucune disponibilité non confirmée comme certaine.

---

## 17. Indicateurs à préparer pour le futur pilote

Arrimo doit permettre de mesurer :

- Les délais d'immobilisation ambulancière.
- Les heures cumulées d'immobilisation.
- Les délais de transfert de responsabilité.
- Les délais de libération des civières.
- Les délais entre autorisation de sortie et départ effectif.
- Les délais de placement en CHSLD.
- Les délais d'organisation des transports.
- Les délais de réponse aux demandes.
- Le taux de transferts réalisés.
- Le nombre de blocages résolus.
- Le nombre d'alertes pertinentes.
- La fraîcheur des données.
- La satisfaction des professionnels.

Prévoir une comparaison avant et après implantation.

Les résultats simulés ne doivent jamais être présentés comme des résultats cliniques ou commerciaux réels.

---

## 18. Exigences techniques et recette

- Préserver les moteurs métier existants.
- Réutiliser les identifiants et événements existants.
- Éviter les calculs redondants.
- Garantir l'intégrité des données.
- Vérifier les opérations concurrentes.
- Empêcher les doubles réservations.
- Garantir l'idempotence des opérations sensibles.
- Vérifier les permissions pour chaque rôle.
- Vérifier les fuseaux horaires.
- Préserver les historiques.
- Tester les migrations et leur réversibilité.
- Exécuter les suites de tests existantes.
- Ajouter les tests unitaires, API, intégration et interface nécessaires.
- Effectuer une recette complète multi-acteurs.
- Préserver l'interface professionnelle et bilingue d'Arrimo.

Ne pas publier en production.

Préparer une version candidate dans un environnement isolé.

Toute publication en démonstration nécessite une validation explicite du responsable du projet.

---

## 19. Ordre d'exécution

**Phase 1 :** Audit complet de l'existant.

**Phase 2 :** Identification des écarts et validation du plan technique.

**Phase 3 :** Renforcement des interconnexions et des moteurs existants.

**Phase 4 :** Préparation configurable des quotes-parts, sans activation de règles non validées.

**Phase 5 :** Renforcement d'OG, Vigilance, Sillage et du pilotage.

**Phase 6 :** Tests transversaux et simulations multi-acteurs.

**Phase 7 :** Rapport final et préparation de la version candidate.

---

## 20. Livrables attendus

Claude Code devra fournir :

- Le rapport d'audit initial.
- La matrice de couverture fonctionnelle.
- Le plan des modifications.
- La liste des fichiers et composants modifiés.
- La documentation des règles métier.
- La documentation des interconnexions.
- Les résultats détaillés des tests.
- Les anomalies restantes.
- Les dépendances externes.
- Les règles nécessitant une validation terrain.
- Les risques techniques et opérationnels.
- La procédure de publication et de retour arrière.
- La version candidate prête pour validation.

## Conclusion

Arrimo doit renforcer sa capacité à coordonner l'ensemble du parcours opérationnel, depuis la répartition ambulancière jusqu'au placement, au transport et à la libération des capacités hospitalières.

Il ne s'agit pas de multiplier les modules, mais de rendre les modules existants plus cohérents, plus intelligents, plus fiables et plus utiles aux professionnels.

Toute évolution doit servir un objectif mesurable de coordination, de réduction des délais évitables et d'amélioration de la visibilité opérationnelle.

---

> Note de Moustafa jointe (texte tel que reçu) : « Oui, j'ai compris. Je ne reprends pas les autres cahiers, je travaille uniquement sur les améliorations restantes. Le Mode crise : on s'inspire de l'Angleterre et du Queensland pour suivre chaque patient évacué, réserver des places confirmées, coordonner les transports, prévoir les plans B et le retour progressif à la normale. Visites : indiquer les contraintes de visite en situation de crise ou de transfert. Famille : confirmations de réception, informations manquantes, responsable identifié. Formation : exercices de simulation pour tester les transferts, les escalades et les fermetures temporaires. Mes tâches et Nettoyage : priorisation selon l'impact potentiel sur la saturation. Admissions : intégration des pré-alertes et de l'état de préparation. Données »
