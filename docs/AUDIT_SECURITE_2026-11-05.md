# Arrimo — audit de sécurité, phase 1 (5-6 novembre 2026)

Périmètre : les 13 domaines fixés par Moustafa le 2 novembre. Cette phase couvre les domaines 1 à 12 sur le serveur de démonstration et le code. Le domaine 13 et la préparation de la production restent à faire (§ 5).

**Limite importante :** cet audit interne ne remplace pas le test d'intrusion indépendant. Aucune donnée réelle n'est en jeu : tout est fictif.

Méthode : inspection du serveur sans modification et sans afficher aucun secret ; relecture ciblée du code ; batterie d'attaques automatique sur base neuve (`tests/chsld.test.cjs`, « audit de sécurité »). La revue du code n'est pas exhaustive.

## 1. Résumé
| Gravité | À corriger sur le serveur ou dans vos comptes | Corrigé dans le code |
|---|---:|---:|
| Élevé | 2 | 1 |
| Moyen | 6 | 3 |
| Faible | 5 | 1 |

## 2. Corrigé dans le code, prouvé par des tests, NON publié
| Gravité | Domaine | Problème | Correction |
|---|---|---|---|
| Élevé | 3, 4 | Le rôle `gestionnaire` franchissait le contrôle d'établissement : le code lui ouvrait l'identité des résidents et les dossiers de tous les CHSLD | Accès réservé aux membres du CHSLD ; refus testé, y compris par OG |
| Moyen | 7 | `script-src 'unsafe-inline'` dans la CSP d'Arrimo : une faille XSS aurait pu lire le jeton de session | Retiré ; script de la page légale déplacé dans un fichier ; `base-uri`, `form-action`, `object-src` ajoutés |
| Moyen | 4 | Réponses de l'API sans `Cache-Control: no-store` | Ajouté, ainsi qu'une `Permissions-Policy` |
| Moyen | 1, 13 | Un serveur de production pouvait démarrer avec les secrets 2FA en clair | Démarrage refusé en production si la clé manque, si des identités fictives ou un mot de passe de démo sont actifs, ou si la clé SH est trop courte |
| Faible | 6, 8 | OG (ajouté le 1er nov.) : fuseau partagé entre requêtes simultanées, mémoire de conversation non bornée | Fuseau propre à chaque requête ; mémoire limitée à 30 min et 2000 conversations |

Corrigé et déjà publié le 5 novembre (release `parcours-20261105t2253`) : le rôle entretien pouvait lire le tableau de bord général `/chsld/accueil` et voyait les références des résidents.

## 3. À corriger sur le serveur ou dans vos comptes (rien n'a été modifié)
| # | Gravité | Domaine | Constat | Action |
|---|---|---|---|---|
| S1 | **Élevé** | 12, 9 | La clé Backblaze n'est pas limitée, contrairement à ce qu'indiquait `CLAUDE.md` : elle voit le bucket `medlink-backups-togo` d'un autre projet (57 objets comptés, aucun ouvert). Un pirate sur ce serveur pourrait lire ces sauvegardes, et peut-être les effacer selon les droits de la clé, non testés | **Vous** : créer dans Backblaze une clé limitée au seul bucket `arrimo-sauvegardes`, la saisir avec `arrimo-b2-configurer`, puis révoquer l'ancienne |
| S2 | **Élevé** | 11 | La démo publique (identifiants publiés) et Arrimo principal tournent sous le même compte `arrimo`. Une compromission de la démo donne le `.env` principal. Point n° 5 du 24 octobre, toujours ouvert | Compte système dédié à la démo (`deploy/durcissement`), avec votre accord |
| S3 | Moyen | 12 | Sauvegardes non chiffrées avant envoi (fichiers `PGDMP` lisibles, aucun chiffrement côté rclone). Acceptable avec des données fictives, **interdit avec de vraies données** | Chiffrer avant envoi ; à faire au plus tard avec la production |
| S4 | Moyen | 1 | `ARRIMO_MFA_ENCRYPTION_KEY` absente des 4 environnements Arrimo : secrets 2FA en clair en base. Point n° 8 du 24 octobre | Générer la clé sur le serveur |
| S5 | Moyen | 11 | La surveillance écrit dans le journal système et ne prévient personne. Point n° 10 du 24 octobre | Alerte par courriel, à décider avec le courriel professionnel |
| S6 | Moyen | 11 | Principal, recette, validation et SH-validation restent sur la release du 31 octobre, sans les corrections depuis | Publier après votre accord |
| S7 | Moyen | 9 | DNS : l'enregistrement `*` de senseafri.com envoie toute adresse inconnue vers 169.58.192.161 | **Vous** : vérifier s'il sert à LafyaLink, avant toute suppression |
| S8 | Moyen | 11, 12 | Résidus de publications : 150 copies de `configuration.env` et 283 sauvegardes dans `.local`, et 23 dossiers `/root/arrimo-og-publication-*`. Accès root seulement, mais ce sont des secrets conservés sans durée limite | Politique de rétention, puis nettoyage avec votre accord |
| S9 | Faible | 11 | 675 bases de test sur 747 ; `CONNECT` laissé à `PUBLIC` ; rôles d'autres applications sur le même PostgreSQL. Point n° 14 du 24 octobre | Nettoyage et `REVOKE CONNECT` |
| S10 | Faible | 10 | Ancien mot de passe de base dans l'historique git (n° 16 du 24 octobre) ; mot de passe de démonstration en clair dans `scripts/presentation-locale.cjs`, différent de ceux en service (vérifié sans affichage) | Retirer du script ; historique à nettoyer avant tout partage du dépôt |
| S11 | Faible | 11 | SSH : `X11Forwarding yes` ; 15 paquets à mettre à jour, aucun signalé comme correctif de sécurité par ma recherche | Durcissement et mises à jour |
| S12 | Faible | 1 | Le blocage après 8 échecs dépend de la seule adresse courriel : un tiers peut bloquer un compte pendant 15 minutes | À arbitrer : le compteur protège aussi contre les essais distribués |
| S13 | Faible | 7 | Jeton de session dans `localStorage`, atténué par la nouvelle CSP | À réévaluer avant le pilote |

**À confirmer par vous :** des sessions root sont venues de `67.69.76.1` le 4 novembre, et de `70.27.239.x` le 5 novembre. Si l'une n'est pas de vous, dites-le tout de suite : ce serait prioritaire sur tout le reste.

## 4. Ce qui a été vérifié et tient
- **Serveur** : pare-feu limité à 22, 80 et 443 ; applications et PostgreSQL en local ; SSH par clé seulement ; fail2ban actif (194 bannissements) ; TLS 1.2 et plus ; services non root avec `NoNewPrivileges`.
- **Exposition** : `.env`, `.git`, schéma et `package.json` en 404 sur les 4 sites ; API SH refusée sans clé ; aucun fichier `.env` ou clé privée suivi par git, hors `.env.example`.
- **Dépendances** : `npm audit`, 0 vulnérabilité connue.
- **Sauvegardes** : planifiées chaque nuit, copie externe du 5 novembre présente ; restauration réellement vérifiée sur copie à chaque publication de la démo et de SH.
- **Batterie d'attaques (23 tests sur 23 dans la suite)** :
  - 120 routes d'Arrimo sans session : seule la liste fermée répond ; aucune erreur 500 ;
  - mêmes routes avec le rôle entretien : tout est refusé hors de sa liste ;
  - isolation : 20 attaques sur des ressources réelles des Érables, depuis un autre CHSLD et depuis un hôpital ;
  - injections SQL dans la recherche, OG et les identifiants ;
  - affectation massive ;
  - erreurs sans détail technique ;
  - secrets jamais renvoyés, jetons non stockés en clair ;
  - portail des proches étanche ;
  - journaux refusant modification et suppression ;
  - XSS stockée sur 5 écrans, **CSP désactivée** pour prouver l'échappement lui-même.
- **Limite de débit** : le limiteur a coupé la batterie à 120 requêtes anonymes par minute. Elle est relevée pour ce seul test.

## 5. Reste à faire
- **Non couvert par la nouvelle batterie** : les routes de la console SH, couvertes seulement par les suites SH existantes ; l'envoi de pièces jointes ; le vocal ; une revue ligne à ligne.
- **Domaine 9, liaison site ↔ SH** : revue du plan quand il sera présenté. Elle n'est pas construite.
- **Domaine 13 et préparation de la production** (Canada et Afrique) : modèle de serveur par pays, contrôles avant mise en ligne, surveillance, plans d'incident et de reprise, documents Loi 25, dossier du test d'intrusion, points à relire par vos développeurs. Plusieurs jours de travail.
