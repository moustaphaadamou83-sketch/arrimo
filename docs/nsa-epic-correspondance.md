# Parcours NSA : correspondance future avec Epic (lot D, note seulement)

17 nov. 2026. **Aucun code écrit pour Epic.** Pendant le pilote, le statut NSA et les admissions restent saisis dans Arrimo. Cette note prépare la discussion avec l'équipe informatique d'un hôpital. Chaque correspondance ci-dessous est une **hypothèse à valider** : la façon de représenter le statut NSA varie d'un établissement à l'autre, et rien n'est supposé sur leur configuration.

## Ce qu'Arrimo reçoit déjà

`src/hl7v2.js` et `src/connecteurs.js` traduisent les messages HL7 v2 ADT en événements Arrimo :

| Message | Événement Arrimo |
|---|---|
| A01 | admission |
| A02 | transfert interne |
| A03 | congé |
| A04 | arrivée à l'urgence |
| A16 | congé prévu |

Ce que le traducteur reçoit :
- **Données conservées :** l'identifiant du patient au format du pays, le lit et l'unité.
- **Données jamais conservées :** le nom et le diagnostic.

Un connecteur est propre à un établissement : jeton remis une seule fois et révocable, journal des messages, rejet journalisé.

## Ce qui manque pour le parcours NSA

| Information Arrimo | Source possible dans Epic (à confirmer) | Remarques |
|---|---|---|
| Début du statut NSA (`nsa_episodes.debut_le`) | Message de mise à jour du séjour (souvent ADT A08), avec le champ ou le code local qui porte la désignation NSA | L'établissement doit dire où se trouve la désignation : type de patient, code de niveau de soins ou champ local. Arrimo garde seulement la date et l'indication « NSA ». |
| Fin du statut NSA | Même message, désignation retirée | L'épisode passe « retiré », comme dans l'interface. |
| Orientation choisie | Rarement structurée dans l'ADT | Elle reste saisie dans Arrimo par l'équipe. |
| Départ de l'hôpital | A03 (congé) | Arrimo le relie à la demande d'hébergement ouverte (lit et référence) : même effet que « Confirmer le départ ». |
| Congé prévu (lit « à libérer ») | A16 | Déjà reçu. |
| Admission à la ressource | Système de la ressource, souvent différent d'Epic | La confirmation de l'arrivée reste dans Arrimo. |

## Règles à garder

- **Aucun diagnostic ni texte clinique** n'est accepté. Les besoins en catégories restent saisis par l'équipe dans Arrimo, jamais déduits d'Epic.
- **Même chemin que l'interface.** Un message ne peut pas faire ce qu'une personne ne pourrait pas faire : règles de `regles.js`, verrou, journal.
- **Doublons et ordre des messages.** Les doublons sont ignorés grâce à l'identifiant de contrôle. Un message arrivé dans le désordre est rejeté et journalisé, jamais appliqué à moitié.
- **Saisie manuelle prioritaire en cas de conflit.** Un écart entre Epic et une saisie manuelle récente est signalé à la coordination, jamais tranché automatiquement.

## Étapes proposées pendant le pilote

1. L'équipe informatique indique comment le statut NSA est représenté, avec un exemple de message anonymisé.
2. Arrimo ajoute la traduction correspondante dans `src/hl7v2.js`, avec ses tests, d'abord en recette.
3. Les deux sources fonctionnent en parallèle pendant deux semaines (Epic en lecture, saisie manuelle maintenue), puis on compare les écarts.
4. La saisie manuelle n'est retirée qu'avec l'accord de l'établissement.
