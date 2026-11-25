# ARRIMO — CAHIER DES CHARGES FINAL
## Coordination opérationnelle intelligente du réseau de santé

**SenseAfriGroup — 24 novembre 2026**  
**Destinataire : Claude Code**  
**Session de développement : jeudi 26 novembre 2026**

## 1. Mission générale

Renforcer Arrimo en s'inspirant des pratiques internationales étudiées en Australie et en Angleterre, tout en répondant aux problématiques québécoises et canadiennes.

Ne pas reconstruire intégralement Arrimo. Auditer, consolider et améliorer les modules existants.

Ne pas modifier SH, qui demeure l'environnement interne de travail de l'équipe.

## 2. Inspirations internationales

| Référence | Enseignement | Application |
|---|---|---|
| NHS Release to Rescue | Réduction des immobilisations ambulancières | Chrono, Vigilance |
| Queensland PACH | Coordination territoriale des ressources | Liaison Secours, Capacités, OG |
| Patient Flow Portal | Anticipation des flux | Bourse, Capacités, Transferts, Transport |
| Care Transfer Hubs | Anticipation des sorties hospitalières | Liaison CHSLD, Bourse, Chrono |

## 3. Architecture opérationnelle

Relier les hôpitaux, CCS, ambulanciers, CHSLD, RPA, cliniques, transporteurs et équipes d'entretien.

Chaque événement doit actualiser les modules concernés sans double saisie.

Le moteur commun doit distinguer les événements prévisionnels des événements effectivement confirmés.

## 4. Refonte de Chrono

### Interface attendue

Chaque ambulance doit disposer d'une fiche opérationnelle affichant :

- Identifiant du véhicule.
- Établissement de destination.
- Heure d'arrivée physique.
- Temps d'immobilisation.
- Étape actuelle.
- Motif du blocage.
- Responsable de la prochaine action.
- Dernière mise à jour.
- Historique des alertes.
- Action recommandée par OG.

### Couleurs et escalades proposées

| Durée | Couleur | Statut | Action |
|---|---|---|---|
| 0–14 min | Vert | Normal | Surveillance |
| 15–29 min | Orange | Vigilance | Informer le responsable opérationnel de l'urgence |
| 30–44 min | Rouge | Escalade | Mobiliser la coordination hospitalière et informer le CCS |
| 45 min et plus | Rouge foncé | Critique | Mobiliser les responsables de garde et la coordination ambulancière |

Les seuils sont configurables et doivent être validés localement. Ils ne constituent pas des normes cliniques.

Une urgence clinique déclenche les protocoles médicaux appropriés immédiatement, indépendamment du chronomètre.

### Chaîne de responsabilité

**Niveau 1 — Normal**

L'équipe ambulancière et le personnel d'accueil suivent le parcours.

**Niveau 2 — Vigilance**

Le responsable désigné de l'urgence reçoit une notification. Il identifie le blocage, accuse réception et renseigne la prochaine action.

**Niveau 3 — Escalade**

Le coordonnateur hospitalier ou gestionnaire de garde prend en charge la résolution opérationnelle. Le CCS est informé de l'immobilisation.

**Niveau 4 — Critique**

Le gestionnaire hospitalier de garde et le superviseur ambulancier coordonnent les mesures autorisées. La coordination territoriale compétente est sollicitée si nécessaire.

Les destinataires exacts doivent être configurés selon les établissements, les horaires et les protocoles officiels.

### Gestion des alertes

Chaque alerte doit comporter :

- Responsable principal et remplaçant.
- Heure de notification.
- Échéance de prise en charge.
- Accusé de réception.
- Action engagée.
- Résultat attendu.
- Escalade en cas de non-réponse.
- Confirmation de résolution.

Un accusé de réception ne signifie pas que le problème est résolu.

## 5. Mesure complète de l'immobilisation

Chrono démarre dès l'arrivée physique de l'ambulance.

Horodater séparément :

1. Arrivée.
2. Triage.
3. Transfert de responsabilité.
4. Libération de la civière.
5. Nettoyage et réapprovisionnement.
6. Remise en disponibilité effective.

Ne jamais arrêter le chronomètre d'immobilisation simplement parce que le patient a été accepté.

## 6. Capacités — disponibilité réelle

Distinguer :

- Occupé.
- Sortie prévue.
- Vide non opérationnel.
- Nettoyage en cours.
- Opérationnel.
- Réservé.
- Indisponible.
- Non confirmé.

Un lit ne peut être proposé immédiatement que si sa disponibilité, sa préparation, ses ressources et sa compatibilité sont confirmées.

Exemple : 20 lits vides, mais seulement 8 opérationnels. Afficher les deux valeurs séparément.

## 7. Bourse — rapprochement intelligent

Rechercher les places compatibles selon :

- Besoins validés du patient.
- Type d'établissement.
- Ressources disponibles.
- Spécialité.
- Localisation.
- Conditions d'accueil.
- Règles de placement.

Prévenir les doubles réservations.

Ne jamais contourner les règles officielles de priorité ou d'admission.

## 8. Liaison Secours

Renforcer la coordination CCS–ambulance–hôpital.

Afficher :

- Ambulances disponibles.
- Ambulances en intervention.
- Ambulances immobilisées.
- Arrivées prévisionnelles.
- Civières opérationnelles.
- Restrictions hospitalières.
- Temps de trajet estimés et provenance des estimations.

Les quotes-parts et règles de répartition doivent être configurables.

Arrimo ne remplace pas les logiciels officiels de répartition et ne redirige pas automatiquement une ambulance.

## 9. Sorties anticipées et NSA

Dès qu'une sortie prévisionnelle est renseignée :

- Capacités anticipe la libération du lit.
- Bourse recherche les places compatibles.
- Liaison CHSLD coordonne les demandes.
- Transferts prépare le parcours.
- Transport recherche un créneau.
- Nettoyage anticipe les tâches.
- Vigilance détecte les retards.
- Chrono mesure les délais.
- OG recommande les actions.

Distinguer la sortie prévisionnelle, l'autorisation médicale de sortie et le statut NSA officiellement établi.

## 10. Transferts et Transport

États du parcours :

Demande → Acceptation → Préparation → Transport confirmé → Départ autorisé → En route → Arrivée → Réception → Clôture.

Gérer les refus, annulations, reports et changements de destination.

Une acceptation de placement ne signifie pas que le transport ou la chambre sont prêts.

## 11. Nettoyage

Après la libération effective d'un lit :

- Créer ou actualiser la tâche d'entretien.
- Affecter un responsable.
- Horodater la prise en charge.
- Signaler les obstacles.
- Confirmer la fin de préparation.
- Valider la disponibilité opérationnelle.

La fin du nettoyage ne suffit pas si le personnel ou les équipements nécessaires sont indisponibles.

## 12. Vigilance

Vigilance doit surveiller :

- Immobilisations ambulancières.
- Saturations prévisionnelles.
- Sorties bloquées.
- Transports manquants.
- Placements non confirmés.
- Chambres non préparées.
- Données périmées.
- Alertes sans responsable.

Chaque alerte doit être actionnable et reliée à sa fiche opérationnelle.

## 13. OG — copilote opérationnel

OG doit analyser les données autorisées et proposer des plans d'action.

Exemple :

« Risque de saturation à partir de 18 h. Trois placements acceptés restent bloqués par le transport. Deux lits pourraient devenir opérationnels après nettoyage et validation. »

OG doit préciser :

- Données utilisées.
- Heure de dernière actualisation.
- Niveau d'incertitude.
- Cause du problème.
- Action proposée.
- Responsable concerné.
- Impact potentiel.
- Solutions alternatives.

OG ne prend aucune décision clinique autonome.

## 14. Tableau régional opérationnel

Intégrer une vue dans les espaces opérationnels existants, accessible uniquement aux acteurs autorisés.

Exemple de données fictives :

| Indicateur | Valeur |
|---|---:|
| Ambulances disponibles | 24 |
| Ambulances immobilisées | 8 |
| Civières opérationnelles | 17 |
| Sorties hospitalières bloquées | 12 |
| Places d'hébergement compatibles | 9 |
| Transports disponibles | 5 |

Afficher les alertes, les prévisions, les plans d'action et leur progression.

Ne pas intégrer ce tableau dans SH.

## 15. Résolution des blocages

Chaque problème suit un cycle :

Détection → Qualification → Affectation → Action → Vérification → Résolution → Mesure.

Si le responsable ne répond pas, appliquer la chaîne d'escalade configurée.

Si aucune ressource n'existe, documenter la pénurie et transmettre le problème au niveau compétent.

Ne jamais présenter une recommandation comme une action exécutée.

## 16. Sillage et traçabilité

Conserver :

- Événements.
- Horodatages.
- Responsables.
- Confirmations.
- Modifications.
- Alertes.
- Escalades.
- Résolutions.

Toute correction doit conserver la provenance et l'historique.

## 17. Interopérabilité DSN et Arrimo Connect

Au Québec, le DSN demeure la source de référence clinique.

Arrimo doit exploiter les événements autorisés nécessaires à la coordination, selon les interfaces disponibles et les ententes approuvées.

Prévoir HL7/FHIR lorsque pertinent, sans supposer qu'une intégration Epic est déjà accessible.

Prévenir les doublons, gérer les erreurs de synchronisation et afficher la fraîcheur des données.

## 18. Expansion canadienne

Prévoir une architecture configurable pour toutes les provinces et tous les territoires.

Adapter :

- Langues française et anglaise.
- Terminologie locale.
- Règles de répartition.
- Organisation territoriale.
- Protocoles d'escalade.
- Systèmes cliniques.
- Exigences de confidentialité et d'hébergement.

Le Québec demeure le premier terrain de validation.

## 19. Sécurité et fiabilité

- Contrôle d'accès par rôle et établissement.
- Isolation des organisations.
- Chiffrement.
- Journal d'audit.
- Minimisation des données.
- Gestion des pannes.
- Prévention des doubles actions.
- Aucune donnée patient réelle dans les tests.
- Aucun déploiement réel sans autorisation.

## 20. Plus-value opérationnelle et économique

Mesurer avant et après le pilote :

- Heures ambulancières récupérées.
- Délais de remise des patients.
- Journées NSA potentiellement évitées.
- Temps de remise en disponibilité des lits.
- Délais de placement.
- Délais de transport.
- Temps de résolution des alertes.
- Pourcentage de sorties réalisées comme prévu.

Exemple purement illustratif : 100 immobilisations par jour réduites de 15 minutes représentent 25 heures ambulancières potentiellement récupérées par jour.

Les économies financières doivent être calculées avec les coûts réels des établissements. Les gains de capacité ne correspondent pas automatiquement à des économies budgétaires.

## 21. Plan de développement

### Priorité P0

- Audit de l'existant.
- Cohérence des statuts.
- Horodatage Chrono.
- Capacités réellement opérationnelles.
- Permissions et sécurité.

### Priorité P1

- Escalades Vigilance.
- Responsabilités opérationnelles.
- Synchronisation Bourse, Transferts, Transport et Nettoyage.
- Sorties anticipées.

### Priorité P2

- Prévisions OG.
- Tableau régional.
- Analyse des performances.
- Configuration provinciale.

## 22. Tests obligatoires

Tester notamment :

- Ambulance immobilisée sans civière disponible.
- Passage du vert à l'orange, au rouge puis au critique.
- Responsable absent ou non réactif.
- Lit vide mais non opérationnel.
- Double réservation.
- Sortie reportée.
- Transport annulé.
- Chambre non préparée.
- Panne de synchronisation.
- Données périmées.
- Accès non autorisé.
- Résolution effective et clôture.

## 23. Documentation internationale

Conserver les documents officiels du NHS, du Queensland, de la Nouvelle-Galles du Sud, du Québec et des autres provinces dans un dossier documentaire interne.

Pour chaque référence : titre, organisme, date, URL officielle, document original, enseignements et limites.

Ne pas présenter les résultats internationaux comme des performances déjà obtenues par Arrimo.

## 24. Livrables attendus de Claude Code

- Rapport d'audit initial.
- Cartographie des fonctionnalités existantes.
- Liste des améliorations nécessaires.
- Architecture et flux d'événements.
- Matrice des responsabilités et escalades.
- Interfaces améliorées.
- Tests exécutés et résultats vérifiables.
- Captures avant/après.
- Documentation technique.
- Liste des limites restantes.

**Instruction finale : Arrimo doit devenir un outil qui aide à résoudre les blocages, et pas uniquement un outil qui les affiche.**

Les améliorations doivent être démontrées par des scénarios reproductibles avant toute utilisation réelle.
