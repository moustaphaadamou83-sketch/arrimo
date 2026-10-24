# Arrimo — audit de sécurité, fiabilité et multi-établissements (24 octobre 2026)

**Verdict : PRÊT POUR DÉMONSTRATION.** Pilote **sous conditions** : déployer les corrections de la branche `audit-securite`, appliquer le durcissement d'infrastructure, puis les conditions de la section 13. Aucune correction n'a été déployée.

## 1. Versions auditées

| Système | Version | Exécution |
|---|---|---|
| Arrimo principal (arrimo.senseafri.com) | release `f6db0e021698` | Node 24.22.1, compte `arrimo`, base `arrimo` |
| Démo A/B/C (demo.arrimo.senseafri.com) | release `74b35fb` | Node 24.22.1, compte `arrimo`, base démo dédiée |
| Arrimo.SH (sh.arrimo.senseafri.com) | release `arrimo-erp-25dd22d` | Node 24.22.1, compte `arrimo-sh`, base `arrimo_sh` |
| Recette (recette.arrimo.senseafri.com) | code du 17 octobre 2026 | **Node 18.19.1 (fin de vie)**, compte `arrimo-recette` |
| Code audité et corrigé | branche `audit-securite`, commit `f839ba5` | dépôt `/root/arrimo-sh-erp` |
| Infrastructure | Ubuntu 24.04, PostgreSQL 16.15, Nginx 1.24.0 | 6 cœurs, 11 Go de mémoire |

Dépendances de la version candidate (express 4.22.3, pg 8.13.1, pdfkit 0.15.0, nodemailer 10.2.1, qrcode 1.5.4) : `npm audit` sans aucune vulnérabilité connue.

## 2. Périmètre et méthode

Lecture du code (authentification, autorisations, administration, imports, transferts, OG, console SH, API SH). Les tests dynamiques ont tous été faits sur des bases jetables `arrimo_audit_*`, avec des données fictives, des instances isolées et un routeur OSRM simulé. L'infrastructure a été contrôlée en lecture seule : Nginx, TLS, systemd, permissions, rôles PostgreSQL, secrets, journaux et sauvegardes. Les essais de charge ont tourné sur une instance plafonnée par systemd (2 cœurs, 1 Go), avec une sonde continue sur les sites publics. Aucun site public n'a été visé par ces essais ni modifié.

## 3. Contrôles de sécurité

| Contrôle | Résultat |
|---|---|
| Connexion, déconnexion, expiration (12 h Arrimo, 8 h SH) | conforme |
| Révocation : compte désactivé, mot de passe changé ou réinitialisé | sessions coupées immédiatement (testé) |
| Réinitialisation par lien | jeton haché, à usage unique, 30 min, 3 par heure, réponse identique si l'adresse est inconnue |
| Invitations SH et hospitalières | individuelles, hachées, à usage unique, expirantes |
| MFA | obligatoire pour l'administration et SH ; **ajoutée pour le gestionnaire réseau** ; secrets SH chiffrés ; **secrets Arrimo chiffrables** |
| Stockage des mots de passe | scrypt + sel ; **jetons de session Arrimo désormais hachés** |
| Tentatives répétées | 8 échecs par adresse ; Nginx 10/min par IP ; **limiteur rendu non contournable** |
| Permissions serveur | plus de 200 accès croisés par identifiant refusés (403/404) ; 20 routes d'administration croisées refusées |
| CSRF | sans objet : jeton Bearer, aucun cookie d'authentification |
| XSS | 15 champs empoisonnés, 3 profils, tous les écrans : aucune exécution ; échappement systématique |
| Injection SQL | requêtes paramétrées ; fragments dynamiques construits sur des listes blanches |
| Formules Excel/CSV | formules refusées à l'import ; **exports neutralisés** (SH et indicateurs) |
| Secrets | `.env` en 600/640 ; clés de service de 64 caractères, distinctes par environnement ; aucun secret valide trouvé dans git ni dans les journaux |

## 4. Vulnérabilités et défauts, classés

| # | Gravité | Problème | Systèmes | Statut |
|---|---|---|---|---|
| 1 | **Élevé** | Un administrateur d'établissement peut promouvoir par import CSV un compte partagé avec un autre établissement, et obtenir ainsi des droits d'administration sur cet autre établissement | Arrimo, API SH | **corrigé** `61319a8` + test |
| 2 | **Élevé** | Gestionnaire réseau (tout le réseau) sans double authentification | Arrimo | **corrigé** `f839ba5` + test (hors serveur de démonstration) |
| 3 | **Élevé** | Hachage scrypt synchrone : 500 connexions simultanées figent tout le serveur (connexion p50 12 s) ; vecteur de déni de service | Arrimo, SH | **corrigé** `8ef96c2` (scrypt asynchrone) + mesures |
| 4 | **Élevé** | Recette publique sur Node 18 (fin de vie) avec 4 vulnérabilités hautes (express, body-parser, path-to-regexp, nodemailer) | Recette | à corriger : mettre la recette à jour (non déployé) |
| 5 | **Élevé** | Démo publique (identifiants publiés) et Arrimo principal sous le même compte système `arrimo` : une compromission de la démo donne accès au `.env` principal | Infra | préparé : `deploy/durcissement` (non appliqué) |
| 6 | Moyen | Limiteur contournable : un jeton Bearer inventé par requête ouvrait un nouveau compteur, et la mémoire n'était pas bornée | Arrimo, SH | **corrigé** `945a46d` + test |
| 7 | Moyen | Jetons de session et d'étape 2FA stockés en clair (Arrimo) | Arrimo | **corrigé** `945a46d` (transition sans déconnexion) |
| 8 | Moyen | Secrets TOTP d'Arrimo en clair | Arrimo | **corrigé** si `ARRIMO_MFA_ENCRYPTION_KEY` est définie (à générer au déploiement) |
| 9 | Moyen | Démo A/B/C sans sauvegarde planifiée ni surveillance | Infra | préparé (unités systemd) |
| 10 | Moyen | La surveillance ne prévient personne (journal système seulement) | Infra | à décider : courriel ou console SH |
| 11 | Moyen | Export CSV des indicateurs : cellules `=`, `+`, `@` non neutralisées | Arrimo | **corrigé** `24b43a5` |
| 12 | Faible | Énumération des comptes par le temps de réponse à la connexion | Arrimo, SH | **corrigé** `945a46d` |
| 13 | Faible | Pas d'action « fermer mes autres sessions » | Arrimo, SH | **ajoutée** `945a46d` |
| 14 | Faible | `CONNECT` laissé à `PUBLIC` sur les bases (aucune lecture de table possible, vérifié) | PostgreSQL | préparé (REVOKE) |
| 15 | Faible | Version de Nginx exposée ; deux en-têtes `X-Frame-Options` contradictoires sur la démo | Nginx | préparé |
| 16 | Faible | Ancien mot de passe de base dans l'historique git (différent de l'actuel, vérifié sans affichage) | Dépôt GitHub | nettoyer l'historique |
| 17 | Faible | Le lien `.env` de la release de secours de la démo pointe vers le `.env` principal (non lu : systemd charge celui de la démo) | Infra | préparé |

## 5. Multi-établissements (20 établissements, 60 comptes simultanés)

- 60 connexions simultanées : toutes réussies, 60 jetons distincts, chaque compte limité à son établissement.
- Accès par identifiant modifié : plus de 200 requêtes de 6 paires d'hôpitaux sur toutes les routes (lits, structure, admissions, civières, NSA, congé, nettoyage, journal, notifications, OG, transferts, recherche, réseau, itinéraire). Toutes refusées, et rien n'a changé chez la cible.
- Déconnexion d'une session : les autres sessions restent ; reconnexion possible ; compte désactivé coupé immédiatement.
- Un coordonnateur n'atteint aucune route d'administration ; un administrateur d'établissement n'agit sur aucune ressource d'un autre (20 routes testées), et sa liste de comptes comme son journal restent limités à son périmètre.

## 6. Performance (instance isolée : 2 cœurs, pool PostgreSQL de 20)

| Utilisateurs | p50 | p95 | p99 | Débit | CPU (quota 200 %) | Mémoire | Connexions PG | Erreurs serveur |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20 | 14 ms | 30 ms | 46 ms | 10 req/s | 6 % | 267 Mo | 15 | 0 |
| 100 | 16 ms | 78 ms | 215 ms | 49 req/s | 30 % | 267 Mo | 15 | 0 |
| 500 | 32 ms | 308 ms | 2,3 s | 233 req/s | 82 % | 235 Mo | 20 | 0 |
| 1 000 | 1,2 s | 3,8 s | 5,3 s | 264 req/s | 107 % | 269 Mo | 20 | 0 |

Ces mesures sont prises en régime établi, une fois tout le monde connecté, avec un temps de réflexion de 1 à 3 s par utilisateur. Seuls des refus métier ont été observés : 403 « ne partage pas » et 409 « lit pris ». Les connexions plafonnent à environ 30 par seconde avec 2 cœurs.

**Capacité observée : environ 500 utilisateurs actifs avec une instance.** Le palier de 1 000 sature un seul processus Node. Il faut plusieurs processus (cluster) et un pool PostgreSQL plus grand. Avant correction, une rafale de 500 connexions gelait toutes les requêtes (p99 19 s).

**Reprise après panne :** processus tué en pleine charge, service rétabli en 3,7 s, sessions conservées. Invariants d'intégrité à zéro : pas de lit réservé sans référence, pas de double transfert actif sur un lit, pas de transfert actif sur un lit libre. Les sites publics sont restés à environ 60 ms pendant tous les essais.

## 7. Transactions et réservations

- **Test critique** : 19 établissements demandent le même lit par transfert, au même moment que l'hôpital propriétaire le réserve localement. **Un seul gagnant**, tous les autres reçoivent 409 ; le lit est réservé une fois ; au plus un transfert actif ; le rejeu est refusé (version périmée). Mécanismes : `FOR NO KEY UPDATE NOWAIT` avec numéro de version, et `SKIP LOCKED` en partage agrégé.
- Acceptation et refus concurrents par deux comptes du receveur : sérialisés par `FOR UPDATE` sur le transfert. L'état final est toujours cohérent : refusé avec le lit libéré, ou accepté avec le lit réservé.
- Imports : 5 envois simultanés du même fichier, aucun doublon ; un fichier avec une ligne invalide est refusé en entier ; capacité déclarée des chambres respectée.
- Go Live SH : pannes injectées successivement à la création de l'établissement, aux civières et aux comptes. Chaque reprise ne produit aucun doublon, une seule opération reste suivie, la fiche reste en recette jusqu'au succès final, et un second Go Live est refusé.

## 8. Confidentialité

- Capacité partagée : les établissements « aucun partage » sont absents ; en partage agrégé, ni répartition ni détail d'urgence.
- Aucune référence patient d'un autre établissement dans les réponses de réseau, recherche, national, carte, OG, notifications, transferts et journal (6 établissements contrôlés, toutes les références fictives comparées).
- Transferts visibles et actionnables seulement par leurs participants (7 actions refusées au tiers).
- Notifications : le tiers ne reçoit que l'alerte agrégée « lits libres à proximité », sans numéro de transfert ni référence patient.
- OG : mêmes contrôles que l'utilisateur (briefing, prévisions, réseau et questions refusés hors périmètre). Le mode IA n'envoie aucun texte libre ni aucune référence (tests existants).
- SH : séparation des rôles vérifiée (un commercial ne peut ni souscrire, ni approuver, ni activer, ni lire la facturation) ; documents chiffrés et filtrés par catégorie ; documents confidentiels réservés à l'administration.

## 9. Sauvegardes et restaurations

Sauvegardes de nuit vérifiées (empreinte et `pg_restore --list`), conservées 14 jours. La copie B2 est présente sur 48 h pour principal, recette, SH et documents SH. Restauration indépendante d'Arrimo principal réussie, avec des compteurs identiques. La restauration de SH et la répétition de sa migration ont été faites plus tôt dans la journée. La démo A/B/C n'est pas sauvegardée (point 9). Le retour arrière ne touche que le code, jamais la base.

## 10. Corrections réalisées (branche `audit-securite`, non déployée)

`61319a8` import et compte partagé · `945a46d` jetons hachés, MFA chiffrable, limiteur, anti-énumération, fermeture des autres sessions · `24b43a5` export CSV, tests XSS et imports concurrents · `a6871b4` tests de reprise du Go Live · `8ef96c2` scrypt asynchrone, outils de charge, durcissement préparé · `f839ba5` 2FA du gestionnaire réseau.

## 11. Tests

| Suite | Résultat |
|---|---|
| API existante | 72/72 |
| ERP SH (parcours complet + reprise du Go Live) | 19/19 |
| Interface ERP SH (3 largeurs) | 1/1 |
| Audit multi-établissements | 13/13 |
| Sonde XSS dans le navigateur | 1/1 |
| Fuzz XLSX/CSV | 3 505 + 7 fichiers malformés, tous refusés proprement (6 ms au pire) |
| Charge | 4 paliers + reprise après panne |

Les échecs de la suite d'interface existante (7/9), de `demo-trio` (2/4) et de `structure-ui` (0/1) sont identiques sur la version d'origine. Ils viennent de l'environnement : Playwright 1.49, alors que le projet attend ^1.64. `og.interface` n'a pas été exécutée (base TCP avec mot de passe et copie de référence requises).

## 12. Risques résiduels

Un seul processus Node par environnement : la capacité s'arrête autour de 500 utilisateurs actifs. Les points 4, 5, 9, 10, 14 à 17 ne sont pas appliqués. Démo et production partagent le même serveur et le même PostgreSQL. Aucun test d'intrusion externe n'a eu lieu, et le chiffrement des secrets TOTP d'Arrimo dépend d'une clé à créer. Une partie de l'interface anglaise reste à traduire. Les tests ne prouvent pas l'absence de faille.

## 13. Avant un pilote

1. Déployer `audit-securite` (avec une sauvegarde et un retour arrière prêts) et générer `ARRIMO_MFA_ENCRYPTION_KEY`.
2. Appliquer `deploy/durcissement` : compte système dédié à la démo, REVOKE CONNECT, Nginx, sauvegarde et surveillance de la démo, alertes.
3. Mettre la recette sur Node 24 et la version courante.
4. Production au Canada, sur un serveur distinct de la démo, avec évaluation Loi 25 et test d'intrusion par un tiers.
5. Plusieurs processus Node (au moins 2 par cœur alloué) et un pool PostgreSQL dimensionné, si plus de 300 utilisateurs actifs sont prévus.
6. Nettoyer l'historique git du dépôt GitHub.
