# Arrimo.SH — Rapport de réalisation des lots 3 à 7

Date : 23 octobre 2026  
Branche : `codex/arrimo-sh-lots3-7`  
Base : lot 2, `dae0be70eba50f11649400efdecc6c29f2ac5b36`

## Résultat

Les lots 3 et 4 ont reçu une première tranche fonctionnelle isolée : import CSV/XLSX et services hospitaliers, parcours commercial CRM → devis → contrat → projet, et gestion de base des projets et tâches. Les acquis des lots 1 et 2 restent dans l’historique. Cette branche **n’est pas une V1 ERP complète ni prête à être déployée**. Aucun site, service ou base publique n’a été modifié.

## Changements réalisés

- Ajout d’un parseur et générateur `.xlsx` local, de modèles CSV/XLSX et d’une interface d’aperçu avec association de colonnes. Le contenu XLSX est converti vers le validateur/importeur CSV existant; limite actuelle de téléversement : 1 Mo.
- Ajout du référentiel des services et de la relation facultative unité → service par migration additive. L’import des services et unités est rejouable et journalisé.
- Ajout de vues CRM/Kanban, organisations, contacts, activités, opportunités, devis versionnés, contrats, projets et tâches. Les prévisions commerciales ne reposent que sur les montants et probabilités enregistrés.
- L’approbation d’un devis et l’enregistrement explicite d’un contrat signé peuvent créer un projet et ses tâches par défaut de façon idempotente. Aucun fournisseur de signature électronique n’est simulé.
- Les tâches permettent les statuts et priorités de base; l’avancement est calculé à partir de leur état. Les commentaires disposent d’une API.
- Le reset de démonstration attend la fin des requêtes API déjà engagées avant de réinitialiser, ce qui évite la course observée entre remise à zéro et requêtes en vol.
- Les permissions SH ont été étendues aux nouvelles routes; les routes de lecture/écriture sont protégées par les rôles du lot 1.

## Validations

- `npm test` sur PostgreSQL isolé : **71 réussis, 0 échec** (API, migrations, courriel et routage).
- `npm run test:interface` : **9 réussis, 0 échec**. La suite a parcouru le guide sur ordinateur/tablette/téléphone, contrôlé les textes anglais et le bandeau d’environnement, créé un premier compte en environnement neuf, puis vérifié le parcours SH existant jusqu’à Go Live sur les trois largeurs. Les écrans SH couverts comprennent Accueil, CRM, Devis/contrats, Projets, Tâches et Support. Captures locales : `captures/ordinateur/sh-12-accueil.png` à `sh-17-support.png` (et captures de page correspondantes), plus répertoires tablette et téléphone.
- Le parcours API de recette couvre organisation/prospect, activité et opportunité, devis versionné et approbation, contrat, liaison à un établissement existant, création idempotente du projet et de six tâches, mise à jour de tâche et calcul de progression.
- Les tests vérifient le rejet des routes non permises aux rôles concernés, la migration additive, le réimport idempotent des services et l’association unité-service.
- `git diff --check` et les vérifications de syntaxe Node ont réussi avant la finalisation.

## État par lot

| Lot | État dans cette candidate | Limites principales |
|---|---|---|
| 3 — imports et commercial | Partiel, testé | Import XLSX natif via parseur local, mais pas de catalogue universel pour tous les objets administratifs; pas d’export XLSX général, de PDF de devis ni de workflow complet d’avenants et renouvellements. |
| 4 — projets, tâches, équipe | Partiel, testé | Kanban/projets/tâches de base et calcul d’avancement. Calendrier/chronologie, gestion complète des dépendances, charge et disponibilité, rappels persistants et pièces jointes restent à construire. |
| 5 — formation, documents, facturation | Partiel ou absent | La formation existante est conservée. Schéma de métadonnées documentaires seulement; aucun stockage/versionnement/téléchargement protégé complet. Factures, paiements et abonnements ne sont pas livrés par cette tranche. |
| 6 — support, hébergement, rapports | Partiel ou absent | Tickets de base et vues. SLA/escalades/base de connaissances, état d’hébergement vérifié et rapports transversaux restent absents. Aucun statut technique n’est inventé. |
| 7 — connecteur et validation intégrée | Partiel, recette seulement | Réutilise le connecteur, le préflight Go Live et l’activation des lots précédents. L’activation individuelle des modules dans Arrimo n’est pas disponible; aucune intégration à la production n’a été faite. |

## Migration, données et risques

La migration `20261023_services_hospitaliers.sql` ajoute le référentiel des services et la colonne de liaison aux unités. Elle ne remplace pas les tables existantes. La mise à jour de schéma prévue par l’installateur s’applique seulement lorsqu’on exécute cet installateur; aucun installateur ni migration publique n’a été exécuté.

Risque restant : l’interface d’import accepte actuellement des fichiers de taille limitée et s’appuie sur les modèles CSV existants pour les règles métier. Les fonctions de documents, de facturation et d’intégration complète doivent être terminées et contrôlées avant d’annoncer une V1 ERP complète.

## Préparation au déploiement

**Non prête au déploiement public.** Cette livraison est une candidate de développement/recette. Il reste notamment à achever les fonctionnalités manquantes ci-dessus, réaliser une recette complète du parcours D sur l’interface, vérifier les procédures de sauvegarde/restauration propres à SH et faire une revue de sécurité des imports et documents. Aucun déploiement n’est autorisé ou effectué dans ce travail.

## Compléments en cours sur la branche isolée

Le propriétaire a confirmé que le développement peut inclure le bilinguisme et Firebase. Les travaux ci-dessous sont donc autorisés sur cette branche; rien n'a été déployé publiquement.

### A. Référentiel hospitalier détaillé

Avant tout ajout, auditer les tables, API, imports et écrans Arrimo/SH déjà livrés. La base Arrimo possède déjà des unités, chambres, lits et civières; le référentiel de services et le rattachement facultatif service → unité sont ajoutés dans cette candidate. La gestion SH comprend des établissements/sites et l’import administratif existant. Il reste à mesurer précisément les champs/écrans de départements, étages/ailes, caractéristiques de chambre/lit, historiques et administration de structure avant d’étendre le modèle.

La branche contient maintenant une migration additive `20261023_structure_hospitaliere_detaillee.sql`, les routes d'administration et d'import pour départements, services, unités, étages/ailes, chambres, lits et civières, ainsi que les attributs configurables non médicaux et des liens composites d'isolation. Les totaux affichés sont calculés depuis les enregistrements; les API refusent qu'une chambre dépasse sa capacité déclarée, y compris lors d'ajouts simultanés ou d'un import. Les états opérationnels existants demeurent la source de vérité et la confirmation reste distincte de l'état physique. Limites : le CRUD détaillé n'est pas encore exposé intégralement dans toutes les interfaces (les API de modification existent, plusieurs listes SH/Arrimo restent en lecture ou création), et les ressources n'ont pas encore de rattachement explicite à un `site_id` dans Arrimo. Ces points restent à terminer avant de considérer l'exigence complète.

SH préparera/importera la structure initiale. Après activation, Arrimo sera la source de vérité opérationnelle pour chambres, lits, civières et leur état. Les changements d’implantation dans SH devront passer par une demande de mise à jour synchronisée, idempotente et auditée, et non par un second référentiel silencieusement divergent. Le protocole devra vérifier l’établissement cible, les droits, les dépendances et la compatibilité avant application.

Critères de recette isolée : créer un département, service, unité, chambre et deux lits avec propriétés distinctes; contrôler les totaux calculés, la modification et l’historique; rejeter les codes en double et les rattachements invalides; vérifier l’isolation A/B/C; tester import CSV et XLSX ainsi que l’impact autorisé sur OG/transferts. Les comptes et jeux fictifs existants seront réutilisés sur une copie isolée.

### B. Audit de l’internationalisation

Arrimo dispose déjà de dictionnaires FR/EN, d'un choix de langue côté interface et de traductions serveur pour OG, erreurs, notifications et aide. En revanche, `public-sh/index.html` et `public-sh/sh.js` étaient essentiellement codés en français. Cette tranche ajoute un premier dictionnaire anglais SH, un sélecteur de langue, les formats de date/nombre selon le choix, une préférence `langue` enregistrée sur le compte et une migration additive SH version 5. La couverture des textes SH reste partielle : messages d'erreur, aides, interactions et certains libellés de formulaires demandent encore une traduction contrôlée avant de parler d'une console complètement bilingue. Les traductions Arrimo publiques existantes sont conservées.

### C. Audit Firebase et notifications mobiles

La recherche du code, dépendances, configuration et fichiers de plateforme n'a trouvé aucune intégration Firebase/FCM; les notifications actuelles sont persistées dans PostgreSQL et rendues par l'application web. FCM peut servir de transport optionnel pour des notifications génériques, PostgreSQL restant la source de vérité, sans contenu patient ou clinique. Il n'y a pas de projet Firebase ni de paramètres VAPID/service fournis dans cette candidate, donc aucun envoi réel n'est activé ni vérifiable ici. L'intégration FCM est un écart restant, pas une fonction livrée. La documentation Firebase indique que le Web FCM nécessite HTTPS, Push API, service worker, VAPID et consentement du navigateur; la matrice officielle ne marque pas Cloud Messaging comme supporté dans Safari/iOS Safari. Les services FCM font partie des services Firebase globaux, et les messages standards ne sont pas chiffrés de bout en bout. Safari doit donc garder les notifications in-app comme parcours fiable; tout FCM éventuel doit être volontaire, révocable, sans contenu sensible, et validé sur un projet et des appareils de recette avant l'usage. Aucun SDK ni secret n'a été ajouté.

Références officielles consultées le 23 octobre 2026 : [démarrage FCM Web](https://firebase.google.com/docs/cloud-messaging/web/get-started), [environnements pris en charge](https://firebase.google.com/docs/web/environments-js-sdk), [confidentialité Firebase](https://firebase.google.com/support/privacy), [chiffrement FCM](https://firebase.google.com/docs/cloud-messaging/encryption).

### Ordre de travail révisé

1. Terminer les tests et la revue de sécurité de la migration et des interfaces de structure; définir la source de vérité et le contrat de synchronisation.
2. Compléter l'interface de gestion de la hiérarchie et vérifier les imports/idempotence sur des données isolées.
3. Ajouter l'internationalisation SH en réutilisant le modèle de dictionnaires FR/EN d'Arrimo, avec préférence enregistrée par utilisateur et couverture vérifiée.
4. Si un projet FCM de recette est provisionné, développer et tester le transport optionnel sur messages non sensibles; sinon garder les notifications PostgreSQL et documenter l'intégration différée.
5. Poursuivre les fonctions commerciales, projets, documents, facturation, support et reporting restant des lots 3 à 6.
6. Exécuter le parcours D complet en recette, régression des lots 1/2, sauvegarde/restauration et revue de sécurité avant toute demande d'autorisation de déploiement.
