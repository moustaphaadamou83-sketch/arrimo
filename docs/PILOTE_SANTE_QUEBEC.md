# Arrimo — dossier de discussion pour un pilote avec Santé Québec

**Document préparatoire, 22 octobre 2026.** Proposition à discuter, sans engagement de Santé Québec, du CHU Sainte-Justine ou d'Arrimo. Tous les parcours montrés dans la copie locale utilisent des données fictives. Aucun gain clinique ou opérationnel n'est encore établi. La version publique est actuellement partielle et la candidate n'a pas été déployée; voir [l'audit de déploiement](../RAPPORT_DEPLOIEMENT_PUBLIC_2026-10-22.md). Ce document ne doit pas être utilisé pour présenter la candidate comme une version publique validée.

## 1. Présentation et objectif

Arrimo est une plateforme de coordination interhospitalière conçue pour rendre visibles les capacités déclarées, les lits et civières, les demandes en attente et les étapes d'un transfert. Son objectif de pilote serait de réduire les délais et les efforts de coordination évitables en donnant aux équipes autorisées une situation partagée, traçable et à jour.

OG est l'unique copilote. Son identité d'interface est un petit robot bleu et blanc. OG explique les données et propose des pistes opérationnelles; les professionnels vérifient, contactent les services et décident. OG ne détermine pas l'orientation clinique et ne prend aucune décision de transfert à leur place.

## 2. Problèmes à évaluer

Le pilote pourrait examiner la visibilité fragmentée des capacités, les appels et relances nécessaires pour obtenir une confirmation, les retards liés à la préparation, les refus tardifs et la difficulté à trouver une solution de rechange. Ces problèmes et leur ampleur doivent être confirmés par les établissements participants; ils ne sont pas quantifiés ici.

## 3. Fonctions réellement présentes dans la candidate locale

Les tests locaux couvrent les lits/civières et leurs transitions, la recherche et réservation avec protection contre la concurrence, le parcours de transfert, la confirmation de disponibilité avec responsable/horodatage et fraîcheur, les refus, alternatives, blocages, relances journalisées et limitées, les notifications, OG avec filtrage par rôle, ainsi que des indicateurs. Les distances et durées ne sont disponibles que si un fournisseur de routage réel est configuré. Aucun fournisseur approuvé n'est actuellement configuré sur le serveur public. Les fonctionnalités ont réussi des tests automatisés locaux; l'état public complet n'est pas validé.

## 4. OG dans le pilote

OG rend visibles les capacités déclarées et leurs limites, identifie une confirmation absente ou périmée, explique pourquoi une proposition est classée et peut présenter d'autres établissements après un refus. Les données affichées doivent préciser source et heure d'actualisation. Si une donnée manque, OG doit le dire. L'accès suit le rôle et l'établissement. Les actions sensibles, la confirmation de capacité, la réservation et la décision d'orientation restent sous contrôle humain habilité.

## 5. Démonstration interhospitalière de 10 minutes

Scénario fictif, à jouer dans une copie locale sûre :

| Temps | Déroulé |
|---|---|
| 0–1 min | Présenter l'accueil OG, l'état d'un établissement saturé et le caractère fictif des données. |
| 1–3 min | Demander une destination pour un besoin opérationnel; montrer les capacités compatibles, l'heure de confirmation et les limites de données. |
| 3–5 min | Un responsable confirme une capacité fictive; envoyer la demande et montrer l'acceptation, la réservation et la préparation. |
| 5–7 min | Simuler un refus de la première destination; OG expose le blocage et présente les alternatives compatibles. |
| 7–8 min | Rendre une confirmation périmée; montrer que l'équipe doit la renouveler avant réservation. |
| 8–9 min | Parcourir départ, transport, réception et clôture, sans distance réelle si le fournisseur validé manque. |
| 9–10 min | Montrer les indicateurs de délais et de refus, puis rappeler que les scénarios ne sont pas des résultats cliniques. |

Ne pas jouer ce scénario sur la production ni utiliser de données patient. Pour une répétition, suivre [le guide de présentation local](PRESENTATION_SANTE_QUEBEC.md).

## 6. Architecture technique proposée

La candidate est une application web Node.js avec API serveur, base PostgreSQL, interface navigateur, rôles et journal d'audit. OG s'appuie sur les données et règles du produit. Un routage externe est optionnel et doit être contracté/configuré, sécurisé, surveillé et approuvé; si indisponible, aucune distance ou durée n'est inventée. Les tests présents utilisent un routeur fictif déterministe et ne valident pas un fournisseur réel. Les versions, schéma, hébergement et exigences de continuité doivent être confirmés avant le pilote.

## 7. Sécurité, confidentialité et gouvernance

Avant toute donnée réelle, les partenaires doivent approuver l'analyse de confidentialité, les finalités, les catégories de données strictement nécessaires, le contrôle d'accès par établissement, l'authentification/MFA, les journaux, la durée de conservation, le processus de droits et incidents, le chiffrement, la sauvegarde restaurable, l'hébergement et les sous-traitants. Les environnements de développement, recette et pilote doivent être séparés. Aucun renseignement patient identifiable ne doit être transmis à un service IA externe non autorisé. L'accès aux données cliniques, si nécessaire, doit être minimisé et validé formellement.

## 8. Interopérabilité à cadrer

Commencer par cartographier les systèmes et événements pertinents : ADT (admission, transfert, congé), référentiels d'établissements/unités, capacité, nettoyage et transport. Définir un moteur d'interface, des identifiants, la gestion d'erreur, la reprise/idempotence et une source de vérité par champ. Un connecteur local testé ne constitue pas une connexion à un système hospitalier. HL7/FHIR, modalités d'accès et approbations doivent être convenus avec les équipes d'architecture et de sécurité participantes.

## 9. Méthodologie de pilote

1. **Cadrage (2–4 semaines à discuter)** : choisir 2–3 sites/unités, cas d'usage, responsables, règles, données et seuils; établir les validations de sécurité et cliniques.
2. **Référence (4–6 semaines à discuter)** : mesurer les définitions retenues avec les processus actuels, vérifier la qualité et les biais de données.
3. **Configuration et recette (4–8 semaines à discuter)** : intégrations minimales, profils, formation, essais fictifs et test de continuité/rollback.
4. **Pilote contrôlé (8–12 semaines à discuter)** : activation graduelle, supervision quotidienne, mécanisme d'arrêt et soutien conjoint.
5. **Évaluation (2–4 semaines à discuter)** : comparer les mesures, documenter limites et incidents, décider ensemble de poursuivre, corriger ou arrêter.

Ces durées sont une hypothèse de planification à confirmer, pas un calendrier engagé.

## 10. Indicateurs à convenir

Mesurer : temps demande→première destination compatible; demande→acceptation; attente d'une confirmation; délai de préparation du lit; taux et motifs de refus; nombre de relances; demandes réorientées; transferts annulés pour capacité; complétude et fraîcheur des confirmations; délais de réception; disponibilité et incidents techniques. Définir numérateur, dénominateur, exclusions, horodatages, stratification par unité et qualité des données avant de collecter. Le « temps économisé » ne doit être publié que si une méthode de comparaison fiable et approuvée le mesure. Aucun de ces résultats n'est encore observé dans un pilote réel.

## 11. Responsabilités à attribuer

Chaque site désigne un sponsor exécutif, responsable clinique, coordonnateur de transfert, responsable de capacité, sécurité/confidentialité, architecture/intégration, soutien et formation. Arrimo fournit un responsable produit/technique, configuration, documentation, support et suivi des incidents. Santé Québec et les établissements déterminent la gouvernance, les règles, l'approbation des usages et l'évaluation. Les responsabilités contractuelles, horaires de soutien et niveaux de service restent à négocier.

## 12. Limites et validations nécessaires

- Déploiement public actuellement incohérent; candidate non déployée, runtime public trop ancien, migration non éprouvée, sauvegarde non restaurée à blanc et rollback non validé.
- Routage réel non configuré; ne pas montrer de kilomètre ou durée comme vérifiés tant qu'un fournisseur approuvé et des trajets de référence ne sont pas validés.
- Lits actuellement connus du système devront être confirmés par les rôles autorisés après migration; aucune confirmation historique ne sera inventée.
- Les critères pédiatriques (âge, poids, niveau de soins, équipement, spécialité, capacité d'isolement et acceptation) nécessitent une validation par Sainte-Justine et les équipes concernées. Le scénario pédiatrique peut être simulé, pas certifié.
- Aucun gain mesuré, intégration hospitalière réelle ou résultat clinique n'est revendiqué.

## 13. Calendrier et budget

Le calendrier ci-dessus est une base de discussion à ajuster après découverte technique et disponibilité des équipes. Aucun budget, financement ou engagement n'est présumé. Construire un budget conjoint après définition du périmètre, des interfaces, de l'hébergement, du soutien, de la sécurité, de l'évaluation et des responsabilités; présenter ensuite des scénarios de coûts avec hypothèses explicites.

## 14. Réunion Teams de 30 minutes

| Temps | Sujet |
|---|---|
| 0–2 min | Participants, objectif et décisions attendues |
| 2–7 min | Problème de coordination à valider et processus actuel |
| 7–17 min | Démonstration locale de 10 minutes avec données fictives |
| 17–22 min | Architecture, confidentialité, sécurité et intégration envisagée |
| 22–25 min | Méthode de pilote, indicateurs et responsabilités proposées |
| 25–30 min | Questions, risques, validations et prochaines étapes |

### Décisions proposées à la réunion

Valider les sites/unités candidats et leurs responsables; sélectionner un cas d'usage initial; nommer les responsables sécurité, clinique et intégration; convenir des mesures de référence; autoriser une phase de cadrage sans données réelles; définir les critères de passage à une recette puis à un pilote contrôlé.
