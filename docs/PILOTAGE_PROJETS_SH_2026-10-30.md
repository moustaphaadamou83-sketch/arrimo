# Pilotage des projets, finances, tâches, compétences et recherche — console SH, migrations 30 à 34 — 30 octobre 2026

Exigences visées : EX-078 (budget et coûts), EX-398 (coûts, marges, bénéfices), EX-098 et EX-099 (temps, checklist), EX-080 (risques, décisions), EX-085 (compétences), cahier §7 (Kanban à 14 étapes, vues), recherche globale et filtres enregistrables.

## Tranche 3 — budgets, coûts et marges (migration 30)
- Lignes financières par projet : budget, coût prévu, coût réel ; catégorie, libellé, montant, devise, date. Montant contrôlé selon la précision de la devise.
- Synthèse **par devise, sans conversion** : budget, coûts, revenus facturés hors taxes (factures émises du contrat du projet), marge, taux de marge, écart et consommation du budget.
- Portefeuille « Marges par projet » dans Facturation.
- Droits : lecture pour l'administration, la finance et l'implantation ; écriture pour l'administration et la finance. Sécurité par périmètre ; lignes figées si le projet est archivé ; journal.

## Tranche 4 — tâches (migration 31)
- États « en validation » et « annulée ».
  - Annulation réservée à l'implantation et à l'administration, avec motif.
  - Une tâche annulée n'est ni ouverte ni en retard, et sort du calcul d'avancement.
  - **Exception voulue** : une tâche critique pour le Go Live reste bloquante même annulée.
- Checklist ; clôture refusée tant qu'un élément reste ouvert.
- Critères d'acceptation : le responsable passe la tâche en validation ; l'implantation valide (validateur et date tracés).
- Temps estimé (implantation) et temps réalisé par saisies datées (1 à 1 440 min, pas de date future). Seuls l'auteur et l'administration retirent une saisie. Écart calculé.

## Tranche 5 — pilotage de projet (migration 32)
- Étape Kanban parmi les 14 étapes du cahier. Les projets existants restent « à classer » : aucune étape n'est inventée.
- États « en attente » et « suspendu ».
- Vues Liste, Kanban (changement d'étape), Calendrier (débuts et échéances par mois) et Chronologie (barres début → échéance, avec l'avancement réel).
- Registre des **risques** (gravité, probabilité, responsable, échéance, état) et des **décisions** (auteur, date, justification). Lecture pour l'équipe du projet ; écriture pour l'implantation et l'administration ; journal ; figé si le projet est archivé.

## Tranche 6 — compétences et charge (migration 33)
- Compétences avec niveau (notions, autonome, expert) et zones d'intervention, saisies par l'administration ; doublons refusés.
- **Charge réelle** calculée depuis les tâches ouvertes (hors terminées et annulées) : nombre, retards, projets, minutes restantes estimées ; les tâches sans estimation sont signalées.
- Recherche par compétence ou par zone.

## Tranche 7 — recherche globale et filtres (migration 34)
- Bouton « Rechercher » dans l'en-tête : hôpitaux, organisations, projets, tâches, tickets, contrats, factures.
  - Seulement les types que le rôle peut consulter, et seulement les lignes de son périmètre.
  - Les rôles hors implantation ne voient que leurs propres tâches.
  - Les jokers SQL saisis sont neutralisés.
- Filtres enregistrables propres à chaque utilisateur (Facturation, Projets). Un même nom met le filtre à jour ; 50 filtres au plus ; jamais partagés.

## Collaborateurs multiples (migration 36)
- En plus du responsable, l'implantation associe jusqu'à 20 collaborateurs (périmètre vérifié, chacun notifié, journal).
- Un collaborateur voit la tâche dans « mes tâches » et la fait avancer comme le responsable (statut, checklist, temps). Retiré, il perd ce droit.

## Limites
- Le Gantt est une chronologie de projets, sans dépendances entre tâches dessinées.
- Le calendrier montre les débuts et échéances de projets, pas encore les jalons ni les tâches.
- Les compétences ne servent pas encore à proposer automatiquement un responsable.

## Publication

Release `og-sh-20261030t0656`, publiée le 30 octobre 2026 sur principal, démo A/B/C, recette, validation, SH et SH-validation. Recette `.local/preuves-sh-lot1/20261030062935_535ed2/` : 16 suites, 218 tests, aucun échec. Santé `ok`, ressources vérifiées, configurations préservées, scénario A/B/C intact.

Mise à jour publiée : release `collaborateurs-20261030t1204` (relance OG, collaborateurs), recette `20261030114008_b6deb9` : 16 suites, 220 tests, aucun échec.
