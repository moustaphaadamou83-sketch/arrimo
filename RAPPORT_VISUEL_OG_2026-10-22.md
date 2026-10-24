# Arrimo — finition visuelle et intégration d’OG

22 octobre 2026. Nouvelle copie locale ; aucun déploiement public.

## Résultat

OG est visible localement : petit robot vectoriel bleu et blanc dans l’accueil, la navigation et le bouton permanent. Le bouton ouvre un panneau accessible depuis les écrans principaux et Mon compte. Le nom officiel affiché est **OG**.

L’accueil comprend un en-tête bleu nuit, des indicateurs prioritaires distincts, une alerte basée sur le niveau réel, des recommandations hiérarchisées, des prévisions mieux séparées et un graphique de répartition des lits. Aucun chiffre ou historique décoratif n’a été inventé. Le graphique utilise les nombres du briefing : dotés, occupés, libres, nettoyage et réservés déduits du solde. Ce n’est pas une nouvelle prévision ni une validation clinique.

## Pourquoi OG n’apparaissait pas sur le public

Les fichiers HTML, JavaScript et dictionnaire français lus sur https://arrimo.senseafri.com/ ne contiennent ni le nom intégré, ni la mascotte, ni le panneau. Le nom avait été ajouté aux copies locales précédentes, sans déploiement. La mascotte et le panneau permanent n’existaient pas encore dans ces copies ; ils sont créés dans cette mission. Les empreintes des fichiers publics et les résultats sont conservés dans `integration-publique-lecture-seule.json`. Aucun problème de cache n’est supposé.

**Visibilité : locale oui ; publique non.** Aucun changement public n’a été effectué. L’utilisateur doit ouvrir la nouvelle adresse locale pour voir cette finition.

## Panneau OG et confidentialité

- Accueil personnalisé avec le nom du compte, l’établissement courant et son rôle.
- Chat français/anglais réutilisant `/api/copilote/question`, la session et les autorisations existantes ; aucune nouvelle API ou permission.
- Raccourcis pour consulter les priorités, OG, l’urgence, les lits et les transferts. Ils n’exécutent aucune action métier automatiquement.
- Pour l’entretien : résumé local de la seule API `/api/nettoyage`, limitée au contexte autorisé, et raccourci Nettoyage. Aucun appel aux API du copilote, des capacités ou des transferts.
- Les questions de traitement ou de diagnostic reconnues par l’interface reçoivent une orientation vers l’équipe habilitée, sans appel au copilote. Ce garde-fou d’interface n’est pas une validation clinique. Les mécanismes serveur et la validation humaine des actions restent inchangés.
- Les échanges du panneau restent en mémoire, sont bornés et sont effacés au changement d’établissement, de langue ou à la déconnexion. Une réponse arrivée tardivement ne réapparaît pas dans un autre contexte.
- Le lanceur local maintient SMTP et IA externe désactivés. Les protections antérieures par liste de champs et questions prédéfinies sont préservées.
- Dialogue natif, ouverture/fermeture clavier, retour du focus, boucle Tab/Maj+Tab, boutons tactiles d’au moins 44 px dans le panneau et vérification des contrastes.

## Validation

- **58 tests API réussis** : lits, civières, transferts, isolation, MFA, indicateurs et autres fonctions existantes.
- **1 test courriel réussi**, sans envoi réel.
- **9 parcours d’interface existants réussis** : FR/EN, ordinateur/tablette/téléphone, création initiale et console SH locale.
- **6 scénarios OG réussis** : comparaisons aux trois formats, accès depuis les pages principales et Mon compte, chat, clavier, entretien, changement de contexte, déconnexion et anglais.
- Vérification complémentaire ciblée du refus d’une demande de diagnostic en anglais.
- Captures avant/après sur le même scénario fictif et la même base de test dédiée, servie par la référence et le nouveau code sur deux ports locaux. Les données métier ne sont pas manipulées dans ces comparaisons.

Le premier passage a révélé un contraste insuffisant du badge réseau ; il a été corrigé. Le test clavier a ensuite révélé une sortie de focus en fin de dialogue ; une boucle explicite l’a corrigée. Les essais initiaux sont conservés séparément et ne sont pas présentés comme réussis.

Safari réel n’a pas été automatisé : l’option d’automatisation reste désactivée sur ce Mac. Les captures sont des recettes Chromium à des largeurs simulées ; elles ne remplacent pas une répétition humaine sur le matériel du jour J, ni une validation métier pédiatrique.

## Préservation et lancement

La copie initiale et les copies de préparation précédentes sont conservées. Les 28 empreintes de l’ancien projet sont inchangées ; les sources serveur, le schéma et la console SH sont identiques à la référence de livraison. Aucune dépendance supplémentaire. Les 33 tests historiques restent associés à leur code inchangé et aux preuves précédentes.

Nouvelle copie : `/Users/moustaphaadamou/arrimo/.local/finition-visuelle-og-20261022`.

Lancement : `npm run presentation:locale` dans ce dossier. Adresse : **http://127.0.0.1:3014**. PostgreSQL local d’audit requis, sur le port 55439. Le lanceur a créé une base fictive distincte puis la réutilise sans remise à zéro. Les accès figurent dans `.local/acces-presentation.txt` (privé, mode 600). La précédente démo sur 3013 reste séparée.

Pour rejouer : `npm run presentation:valider`. La copie de référence pour les captures est le dossier frère `preparation-livraison-20261022`, ou `ARRIMO_REFERENCE_AVANT` explicitement renseigné. Les bases et preuves de validation sont nouvelles et locales.

## Livrables et suite

- `comparaison.html` : galerie avant/après et panneau OG aux trois formats.
- `captures/` : images entières et vues d’accueil.
- `preuves/` : tests, lecture publique, préservation et patch limité à la mission visuelle.

La finition est locale. Une mise en ligne éventuelle reste soumise à autorisation et à la préparation du runtime serveur décrite dans le plan précédent. La validation métier pédiatrique et la répétition humaine restent à effectuer avec les personnes concernées.
