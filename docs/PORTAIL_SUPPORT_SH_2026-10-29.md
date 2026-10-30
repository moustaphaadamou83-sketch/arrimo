# Arrimo.SH — portail support client, 29 octobre 2026

> Suite ultérieure : [notifications financières et pagination](NOTIFICATIONS_PAGINATION_SH_2026-10-29.md). Les constats ci-dessous sur la limite à 200 tickets et la diffusion financière décrivent l’état précédent.

Cette tranche suit le [bilan précédent](NUIT_SH_2026-10-29.md). Elle ajoute le portail hospitalier et renforce les notifications du support. Aucun environnement réel n'a été configuré ou publié. La recette consolidée de cette candidate est valide ; les résultats et leurs limites figurent ci-dessous.

## Résultats consolidés

- **179 tests intégrés PostgreSQL/API/Chromium réussis**, répartis sur 13 suites, dont les 8 tests du portail ; aucun échec, annulation ou test ignoré.
- **212 tests locaux** et **75 tests Python de simulation** réussis.
- **185 fichiers JavaScript** vérifiés sans erreur de syntaxe ; `git diff --check` réussi.
- Les empreintes des sources des tests locaux et de la recette intégrée sont identiques : `81e64cff6fbf87bf1b28d109cadd6e8c50d376912b6afa6a4922a871ba5914df`.
- [Résumé machine](preuves-portail-support-sh-20261029/resume.json), [rapport intégré](preuves-portail-support-sh-20261029/rapport-integration.json), [captures FR/EN](preuves-portail-support-sh-20261029/captures/portail-en.png), [empreintes des preuves](preuves-portail-support-sh-20261029/empreintes.json).

Les compteurs intégrés incluent les tests parents Node. Le pilote fictif précédent, ses reprises, l'archivage, la restauration PostgreSQL, les scénarios ABC et les parcours OG ont été rejoués sur cette candidate. Les services HTTP de recette ont été fermés par les suites ; les bases fictives du cluster temporaire sont conservées. Les clés du portail n'ont été configurées que dans les processus de test et ont été restaurées à la fin de la suite.

## Parcours développé

Dans Arrimo, l'onglet **Support client** permet à un compte hospitalier autorisé de créer une demande, choisir sa catégorie et sa priorité, la relier à un projet de son établissement, consulter les réponses publiques et répondre au support. Les comptes hospitaliers, leurs mots de passe et leurs sessions existants sont réutilisés ; aucun compte employé SH n'est créé pour les clients.

Le serveur hospitalier vérifie l'établissement dans les affectations de la session avant tout appel à SH. L'environnement vient de la configuration du serveur, jamais du navigateur. L'auteur est imposé depuis le compte authentifié ; les champs d'auteur, d'hôpital SH et de visibilité transmis arbitrairement par le navigateur ne sont pas relayés.

SH expose une API de service limitée au support, avec une clé propre à l'environnement. Une clé trop courte, absente, erronée ou identique à une autre clé d'environnement configurée est refusée. Le code hospitalier est résolu dans le seul environnement autorisé et doit correspondre à une fiche reliée. Tous les accès aux tickets utilisent ensuite cet identifiant d'hôpital. L'API ne donne accès ni aux comptes employés, ni aux contrats, ni aux factures.

Un ancien ticket reste interne par défaut. Un ticket créé au portail est visible pour son établissement. L'équipe support peut publier ou masquer un ticket avec une commande explicite dans sa fiche. Le partage comprend alors sa description et sa résolution. Les notes internes restent exclues des réponses du portail ; les réponses publiques sont choisies explicitement par l'employé. Le client ne peut pas créer une note interne, changer le statut, attribuer un ticket ou publier celui d'un autre établissement. Un ticket fermé refuse les nouveaux messages.

Les demandes reçoivent une référence `TICK-année-numéro`, protégée par compteur transactionnel et contrainte d'unicité. Les anciens tickets reçoivent une référence conservant leur identifiant ; la séquence reprend au-dessus des références existantes. Les numéros ne sont pas tronqués au-delà de 9999.

## Confidentialité des notifications support

La création interne d'un ticket ne diffuse plus son titre indistinctement à tous les employés support. La fonction PostgreSQL de destinataires vérifie d'abord le périmètre hospitalier de l'appelant, puis les rôles, permissions personnalisées actives et affectations des destinataires. Un responsable ne peut pas être choisi s'il n'a pas accès au support de cet établissement. Les réponses à un responsable historique sont également filtrées.

Les nouvelles demandes et messages du portail avertissent les administrateurs SH actifs par notification interne, avec la seule référence du ticket. Les alertes par courriel et la notification directe du responsable lors d'une réponse client ne sont pas encore implémentées.

## Autres anomalies corrigées

- Les erreurs HTTP métier SH conservent leurs codes stables et leurs variables. Le relais hospitalier peut ainsi rendre un refus client réel en 400/404/409 plutôt qu'un 502 générique, sans relayer d'erreur technique brute.
- La vue réseau conserve désormais l'établissement courant lorsqu'il n'a encore ni unité ni lit. OG ne tombe plus en erreur lors du premier briefing d'un établissement vide. Aucune capacité fictive n'est ajoutée : sa liste d'unités est vide.
- Un projet lié à un ticket ne peut pas être supprimé par le cycle de suppression de recette ; le refus est explicite et précède toute suppression.

## Configuration à préparer avant livraison

Dans chaque serveur hospitalier :

- `ARRIMO_SUPPORT_SH_URL` : URL de SH. HTTPS est obligatoire hors boucle locale ; les identifiants intégrés à l'URL, paramètres et fragments sont refusés.
- `ARRIMO_SUPPORT_CLE` : secret d'au moins 32 caractères, réservé au serveur.

Dans SH : `SH_SUPPORT_DEMO_CLE`, `SH_SUPPORT_RECETTE_CLE`, `SH_SUPPORT_PILOTE_CLE` ou `SH_SUPPORT_PRODUCTION_CLE`, selon les sources autorisées. Les secrets doivent être distincts. Aucun secret n'est renvoyé par les routes de configuration ou dans l'interface. Sans configuration, le portail affiche son indisponibilité et ne tente aucun appel externe.

La migration **15** ajoute références, catégorie, lien au projet, visibilité client et auteur externe. La migration **16** ajoute la sélection contrôlée des destinataires support. Elles n'ont été appliquées qu'aux bases fictives de recette. Les nouvelles sources, les interfaces des deux applications et les migrations doivent être livrées ensemble ; aucun script historique de publication n'a été exécuté.

## Tests et limites

La suite dédiée utilise deux serveurs HTTP locaux, une base fictive neuve, deux établissements, deux comptes hospitaliers et des comptes SH. Elle exerce les appels réels du relais, les droits, les messages publics et internes, les changements de visibilité, la numérotation concurrente, le seuil 10000 et le parcours mobile en français puis en anglais. Elle contrôle aussi le refus d'un responsable hors périmètre et l'absence de notification confidentielle chez un employé voisin.

Restent à terminer :

- Pagination de la liste client, actuellement limitée aux 200 derniers tickets ; l'accès détaillé reste contrôlé par hôpital.
- Pièces jointes et captures d'écran, SLA contractuels, escalades, état Assigné et Kanban complet, recherche/résumé OG SH.
- Notifications par courriel et distribution des réponses clients au responsable autorisé.
- Revue des autres notifications ERP : le chemin de signature de contrat sélectionne encore tous les comptes finance sans filtre client dans `src/sh/commercial.js`. Il faut ajouter une régression négative et corriger ce chemin avant de déclarer la confidentialité globale terminée. Ce constat est une inspection de code, pas un test d'exploitation exécuté.
- Mise en service réelle du portail et vérification de sa configuration : aucun secret ni service réel n'a été modifié.

Les résultats du [bilan nocturne précédent](NUIT_SH_2026-10-29.md) restent ceux de sa candidate à la migration 14. Ils ne sont pas présentés comme une validation de ces nouveaux fichiers.
