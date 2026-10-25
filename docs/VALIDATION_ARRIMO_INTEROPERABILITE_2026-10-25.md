# Arrimo — validation réelle, interopérabilité et blocages

Le produit reste **Arrimo** et **Arrimo.SH**. Aucune nouvelle application ni marque n'a été créée. Les noms techniques historiques de commits, scripts, bases d'essai et archives sont conservés pour la traçabilité.

## Résultat de cette reprise

Les connecteurs fictifs sont étendus dans Arrimo, en réutilisant les opérations des modules existants. Le code métier est dans le commit `ab8015b6d983ac0349395203e17d6a32f536879d`. Les preuves et ajustements de livraison sont consignés dans le commit suivant.

**127 tests locaux JavaScript réussis, 11 tests locaux Python réussis. Aucun test PostgreSQL réel ni parcours navigateur nouveau réussi. Aucun déploiement, aucune migration publique, aucune réinitialisation A/B/C. Démonstration non déclarée prête.**

## Environnement identifié et diagnostic

Cette session voit les fichiers du serveur mais s'exécute dans un contexte Codex restreint : PID 1 = `codex`, processus visibles limités à Codex et ses commandes, namespace PID `4026532546`, noyau Linux `6.8.0-147-generic`, UID 0 avec capacités effectives nulles, `NoNewPrivs=1`, `Seccomp=2`. Ce contexte n'est pas une session d'administration complète du serveur Contabo. Son nom de répertoire `/root` ne lui donne pas les pouvoirs du root du serveur.

| Contrôle exécuté | Résultat observé | Interprétation |
|---|---|---|
| Fichiers des unités PostgreSQL | `postgresql.service`, modèle `postgresql@.service`, configuration du cluster `16/main` présents | Présence constatée ; état du processus hôte non accessible depuis ce namespace |
| Paramètres lisibles de `postgresql.conf` | port 5432, socket `/var/run/postgresql`, répertoire `/var/lib/postgresql/16/main`, SSL activé dans le fichier | Aucune modification ; l'authentification effective et la santé ne sont pas vérifiées |
| `socket(AF_INET, SOCK_STREAM)` et `socket(AF_INET, SOCK_DGRAM)` | `EPERM` à la création | Refus avant PostgreSQL ou DNS ; pas la preuve d'un serveur arrêté |
| Connexion UNIX vers un chemin volontairement inexistant | `EPERM` au lieu d'une erreur de fichier absent | Refus de connexion par le runtime avant contact avec un service |
| `psql -d postgres -Atc 'SELECT current_database()'` | `Operation not permitted` | Aucune session SQL ouverte |
| `pg_hba.conf` | Lecture refusée ; mode observé 0640, UID/GID mappés 65534 | Ne pas changer ses droits ni supposer que les identités mappées sont les vrais propriétaires hôte |
| Sauvegarde `/var/backups/arrimo-finalisation-arrimo-20261024T220510Z.dump` | `pg_restore --list` refusé ; mode observé 0600, UID/GID mappés 65534 | UID 0 sans capacité DAC ne suffit pas ; sauvegarde ni lue ni restaurée ici |
| Chromium via Playwright installé | Arrêt `sandbox_host_linux.cc`, `shutdown: Operation not permitted` | Échec IPC avant ouverture d'une page, sans changement des options de sécurité du serveur |
| Ouvertures web des trois `/api/sante` | Inaccessibles via l'outil | HTTPS public non vérifié ; aucune conclusion de panne des trois sites |

Les diagnostics de sockets et les commandes reproductibles figurent aussi dans `RAPPORT_REPRISE_VNEXT_2026-10-25.md`. Aucun changement de `pg_hba.conf`, de firewall, de droits de fichiers, de compte, de service ou de sandbox n'a été tenté.

## Exécuteur serveur réellement tenté

`scripts/recette-serveur-arrimo.py` a été lancé depuis cette session après commit du code. Il a :

1. Copié le commit dans `/root/arrimo-recette-controlee-20261025/application`, sans `.env` et sans modifier les applications actives.
2. Vérifié Node : réussi.
3. Vérifié les sous-processus/IPC Node : **échec EPERM, sortie 1**.
4. Arrêté la recette **avant toute création de base**.

Rapport effectif : `/root/arrimo-recette-controlee-20261025/rapport.json`. Il indique `bases_creees: []`, `sauvegarde_fictive_restauree: false`, `copie_isolee_validee: false`, `publication_effectuee: false` et `migration_publique_effectuee: false`.

Les 127 tests JavaScript et les 11 tests Python ont ensuite également été exécutés avec succès dans cette copie de l'application. Ils restent des tests locaux : aucune connexion SQL ni session navigateur ne peut être déduite de leur réussite.

## Connecteurs fictifs développés

Les nouvelles routes exigent **une session humaine authentifiée et une clé de connecteur**, ainsi que l'activation explicite du mode simulation. Elles sont refusées en production. Aucun compte réel n'a été habilité et aucun connecteur existant n'a été activé pendant cette session.

| Événement | Opération Arrimo réutilisée |
|---|---|
| `arrivee_urgence` | Placement sur civière avec référence pseudonymisée et version |
| `demande_lit` | Création de demande avec âge, unité, équipements et civière ; correspondance persistée |
| `priorite_validee` | Validation par le compte de la session, explicitement habilité, selon le référentiel approuvé ; aucun auteur ni rang accepté depuis une revendication externe |
| `attribution` | Recherche/validation de compatibilité et réservation transactionnelle existantes |
| `admission` | Même admission métier qu'Admissions ; contrôle du lit effectivement assigné et de sa version ; clôture de demande et libération de civière |
| `etat_lit` | Hors service/réactivation avec version et motif ; ne permet pas de sauter le parcours d'occupation |
| `conge_prevu`, `conge_confirme` | Prévision et confirmation, sans libération automatique ; contrôle patient/version |
| `conge` | Départ effectif vers nettoyage |
| `nettoyage` | Confirmation uniquement si la ressource est réellement en nettoyage ; ne peut annuler une réservation |
| `transfert` | Création par le parcours de demande, avec compatibilité pédiatrique et capacité confirmée |
| `transfert_etape`, `reception` | Acceptation/refus, chambre prête, transport, départ et réception selon le rôle du côté concerné ; réception prématurée refusée |

Chaque opération peut participer à une transaction appelante : événement, opération métier, correspondances créées, journal et accusé sont validés ensemble. Les appels existants sans transaction explicite conservent leur fonctionnement.

### Correspondances, ordre et conflits

- Références externes contrôlées ; correspondances par connecteur pour patient, type d'unité, lit, civière, demande, transfert et établissement partagé.
- Propriété et périmètre revérifiés à chaque résolution. Une correspondance existante n'est jamais remplacée silencieusement.
- Identifiant d'événement associé à une empreinte canonique. Même identifiant/même contenu : accusé sans nouvel effet ; contenu différent : conflit conservant l'original.
- Séquence par flux et date source UTC. Un événement futur est conservé en attente, sans effet ; un événement périmé est signalé en conflit. Aucun réordonnancement clinique automatique.
- Rejeu explicite par le compte qui a confirmé l'événement, après résolution du prédécesseur ou de la correspondance manquante. Une nouvelle priorité passe toujours par l'habilitation et les versions actuelles.
- Les conflits de version ou d'occupation annulent les effets de l'événement au savepoint. Une erreur technique inattendue annule la transaction complète et ne produit aucun faux accusé appliqué.
- Les connecteurs fictifs sont aussi bloqués sur l'ancien point d'entrée à clé seule ; désactiver leur simulation ne rétablit pas ce chemin de contournement.
- Les événements fictifs ne fusionnent jamais automatiquement les données concurrentes : l'état Arrimo courant et ses versions servent de référence. Le choix clinique reste celui du professionnel.

### OG et supervision

OG comprend les questions de synchronisation/connecteurs et lit une supervision limitée à l'établissement autorisé : événements appliqués, en attente, conflits/rejets, dernière date source et dernier traitement Arrimo. La réponse distingue l'heure de lecture de la fraîcheur de la source. Les questions sur admissions, lits, priorités et transferts continuent de lire les modules alimentés par les mêmes opérations métier.

La supervision et le journal ne prétendent à aucune intégration hospitalière réelle. Les connecteurs HL7/FHIR réels, leurs spécifications partenaires et leurs autorisations restent hors de cette simulation.

## Tests : distinguer chaque niveau

| Niveau | Résultat effectif |
|---|---|
| Tests locaux JavaScript | **127 réussis, 0 échec, 0 ignoré** : 80 tests précédents, un garde-fou supplémentaire sur l'ancien point d'entrée et 46 contrats de simulation |
| Garde-fous Python du lanceur | **11 réussis** : refus des bases applicatives, hôtes distants, remplacements de connexion et divulgation de secret |
| Syntaxe | **115 fichiers JS/CJS**, zéro erreur ; analyse Python et `git diff --check` réussis |
| Tests PostgreSQL réels | **0 scénario exécuté** ; les suites priorités et simulation ont été signalées ignorées, pas réussies |
| Tests navigateur | **0 nouveau parcours exécuté** ; suite priorités ignorée, Chromium diagnostique refusé au démarrage |
| Sauvegarde et restauration | Sauvegarde serveur illisible ici ; restauration réelle non effectuée |
| Publication | **Aucune** ; aucune donnée A/B/C modifiée |

Un test local de collision d'identifiant a été adapté après l'ajout obligatoire du lit et de sa version à l'admission. La suite finale des 46 contrats est entièrement réussie. Cela n'est pas une preuve d'exécution SQL.

La nouvelle suite `tests/simulation-postgres.test.cjs`, préparée mais non exécutée, vérifie sur une base neuve : événement 2 avant 1 puis rejeu, arrivée simultanée en double, priorité validée, admission pédiatrique, congés, nettoyage, réservation d'un lit par deux connecteurs, transfert et réception avec refus de réception prématurée, sécurité HTTP avec session/clé, isolation et réponses d'OG sur données synchronisées.

## Opération à exécuter depuis une session serveur autorisée

La recette réelle ne peut pas être débloquée depuis ce runtime sans changer ses autorisations externes. L'opération suivante doit être lancée dans une session serveur autorisée, ou dans un nouveau runtime disposant déjà des sockets PostgreSQL, TCP et IPC Chromium nécessaires :

```sh
cd /root/arrimo-sh-erp
NODE_PATH=/root/arrimo-dev/node_modules python3 scripts/recette-serveur-arrimo.py --sortie /root/arrimo-recette-serveur-autorisee-20261025
```

Le chemin Playwright ci-dessus a été découvert dans l'environnement. Le lanceur journalise la version effectivement utilisée. Ne pas remplacer une version incompatible par un succès supposé : les suites doivent réussir.

Par défaut, le lanceur utilise l'authentification PostgreSQL locale existante sur le socket constaté, vers la base de maintenance `postgres`. Il n'invente et ne crée aucun rôle. Si ce compte n'est pas autorisé à créer des bases d'essai, une session déjà autorisée doit définir `ARRIMO_RECETTE_ADMIN_URL` depuis une configuration protégée, avec un rôle existant approprié. Aucun secret ne doit être collé dans la conversation et aucun `GRANT` ne fait partie du lanceur.

Le lanceur refuse les serveurs distants, les URL de bases applicatives et un dossier de sortie préexistant. Il nettoie les variables d'environnement des tests pour ne pas transmettre les connecteurs, SMTP et configurations hospitalières réels. Il exécute ensuite :

1. Copie isolée du commit propre et contrôle Node/IPC/Chromium.
2. Création de bases nouvelles aux noms réservés, entièrement distinctes des bases publiques.
3. Préparation de données fictives avec le schéma de référence `2ed9127`, sauvegarde, SHA-256, restauration sur une autre base nouvelle, comparaison des contenus.
4. Répétition des migrations priorités et simulation sur la copie restaurée, sans changement des données préexistantes.
5. Suites API, priorités SQL, simulation SQL, sécurité multiétablissements, scénarios A/B/C, quatre dashboards, parcours navigateur, structure, SH ERP, SH navigateur et XSS, chacune avec sa base dédiée.
6. Rapport par étape ; échec, tests absents ou tests ignorés interdisent de déclarer la copie validée. Les bases et captures sont conservées pour inspection ; aucune base n'est supprimée.

Le lanceur **ne publie rien**, même si tous les tests réussissent. Une sauvegarde fictive restaurée ne vérifie pas la sauvegarde fraîche de la démo publique. Celle-ci, le rollback et les contrôles publics restent obligatoires avant la publication autorisée.

## État de préparation

| Critère | État |
|---|---|
| Intégration dans Arrimo/Arrimo.SH existants | Respectée dans le code ; aucune application concurrente créée |
| Priorités, pédiatrie et OG | Existant conservé, adaptation aux événements fictifs couverte localement ; validation SQL et navigateur restante |
| SH ERP et configuration | Existant conservé ; nouvelle régression réelle à exécuter avec le lanceur |
| Interopérabilité fictive | Événements demandés implémentés et testés localement ; non validés de bout en bout sur PostgreSQL |
| Démo A/B/C/Réseau publique | Préservée, non modifiée ni revalidée dans cette session |
| Arrimo principal et SH publics | Préservés ; aucune nouvelle publication |
| Sainte-Justine | **Préparation non confirmée**, tant que les parcours essentiels sur copie puis démo publique ne sont pas validés |
| Usage clinique réel | **Non validé** |
