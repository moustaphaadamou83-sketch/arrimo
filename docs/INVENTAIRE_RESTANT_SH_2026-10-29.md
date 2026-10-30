# Inventaire vérifié du travail restant — 29 octobre 2026 (fin de soirée)

Chaque ligne a été vérifiée dans le code (`src/sh`, `public-sh`, `public`, migrations), pas seulement dans les notes. « Absent » signifie qu'aucune table, route ni interface n'existe.

## Déjà fait et publié (ne pas refaire)

| Élément | Preuve |
|---|---|
| Fuseau individuel (migration 25) | `preferences-fuseau-20261029t2136` |
| Support : portail, SLA versionnés, escalades, pièces jointes, courriels, recherche OG des tickets, Kanban des tickets, calendriers ouvrés, rapports SLA | publications du 29 octobre, lot 6 |
| Suppression et restauration de projet avec demande motivée (EX-274/275) | `cycle-projets`, suite cycle 6/6 |
| 249 pays ISO et devise par défaut (EX-378/379) | recette ERP PostgreSQL |
| Fiscalité datée et sourcée, Canada (migration 26) | `fiscalite-20261029t2225` |
| Taux de change Banque du Canada datés (migration 27) | `change-20261029t2240` |
| Kanban du pipeline commercial | `public-sh/erp.js` |
| Unités monétaires mineures par devise | `public-sh/devises-unites.js` |

## Absent ou partiel — à coder

| Lot | Élément | État réel |
|---|---|---|
| 1 | ~~Apparence~~ | **Fait et publié** le 30 oct. (`apparence-20261030t0046`) |
| 1 | Paramètres éditables | **Publié le 30 oct.** (émetteur, session, conservation) ; autres sections : écrans propres |
| 1 | Suppression définitive d'un employé (EX-426) | **Publié le 30 oct.** |
| 1 / transversal | Recherche globale, filtres enregistrables | **Publié le 30 oct.** |
| 4 | Budgets, coûts, marges (EX-078, EX-398) | **Publié le 30 oct.** |
| 4 | Profils fiscaux hors Canada | Absent (exige des sources officielles par pays) |
| 7 (projets) | Kanban 14 étapes, Liste, Calendrier, Chronologie | **Publié le 30 oct.** |
| 7 (projets) | Risques et décisions (EX-080) | **Publié le 30 oct.** |
| 8 (RH) | Compétences, zones, charge (EX-085) | **Publié le 30 oct.** |
| 9 (tâches) | Temps, checklist, états « en validation » et « annulée » (EX-098/099) | **Publié le 30 oct.** (collaborateurs multiples non faits) |
| 5 | Cycle de déploiement détaillé (étapes du cahier), preuves UAT | Absent (7 étapes actuelles) |

## Bloqué hors code

| Élément | Ce qu'il faut |
|---|---|
| OG : microphone et voix physiques | un appareil réel |
| Pilote réel | un établissement réel, hébergement au Canada, Loi 25 |
| Pauses et pénalités SLA | les règles contractuelles |
| BC, MB, SK ; lieu de fourniture ; qualification service ou licence | un avis fiscal |
| Séparation physique des bases entre clients ou pays | une décision d'infrastructure |
| Vérification authentifiée de SH en production | le compte administrateur réel, MFA activé par son titulaire |
