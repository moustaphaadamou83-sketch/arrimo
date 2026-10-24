# Suite de préparation — 22 octobre 2026

## Safari réel

Safari 26.6.2 est installé. Le pilote Safari a été lancé puis une session WebDriver a été demandée. Safari l'a refusée avec le message : « You must enable 'Allow remote automation' in the Developer section of Safari Settings to control Safari via WebDriver. »

Aucun réglage de Safari n'a été modifié, aucun script n'a contrôlé la session publique de l'utilisateur et aucun mot de passe n'a été saisi dans Safari par ce test. Le pilote lancé pour l'essai a été arrêté. Cette tentative ne valide pas une recette de Safari réel. Les précédentes recettes Chromium et WebKit restent valides dans leur périmètre.

Le serveur local répond à `/api/sante` : service et base `ok`. La répétition humaine sur Safari, avec les accès privés, reste une action du présentateur. L'autre possibilité est d'activer soi-même l'automatisation à distance dans les réglages de Safari puis de demander une nouvelle recette ; ce réglage n'est pas requis pour utiliser Arrimo normalement.

## Travail supplémentaire livré

- Support de huit diapositives autonome en HTML et PDF, avec captures fictives déjà validées.
- Notes du présentateur et proposition de pilote, sans promesse de gain ou de validation clinique.
- Nouvelle copie de livraison avec garde Node 20 corrigée dans l'installateur et son test ; aucune installation exécutée.
- 58 tests API et un test courriel réussis dans cette nouvelle copie. Les neuf tests d'interface proviennent de la copie précédente ; le code applicatif et l'interface sont comparés à l'identique, aucune nouvelle recette complète de navigateur n'est revendiquée ici.
- Archive source et patch pour revue, sans données ni configuration privée.
- Plan de mise en ligne et de retour arrière préparé, non exécuté.

La validation métier pédiatrique et une éventuelle mise en ligne restent séparées de la préparation locale. Le site public conserve sa version actuelle.
