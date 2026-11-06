# Arrimo — audit de sécurité, phase 1 (5-6 novembre 2026)

Périmètre : les 13 domaines fixés par Moustafa le 2 novembre. Cette phase couvre les domaines 1 à 12 sur le serveur de démonstration et le code. Le domaine 13 et la préparation de la production restent à faire (§ 5).

**Limite importante :** cet audit interne ne remplace pas le test d'intrusion indépendant. Aucune donnée réelle n'est en jeu : tout est fictif.

Méthode : inspection du serveur sans modification et sans afficher aucun secret ; relecture ciblée du code ; batterie d'attaques automatique sur base neuve (`tests/chsld.test.cjs`, « audit de sécurité »). La revue du code n'est pas exhaustive.

## 1. Résumé
| Gravité | À corriger sur le serveur ou dans vos comptes | Corrigé dans le code |
|---|---:|---:|
| Élevé | 2 | 1 |
| Moyen | 6 | 4 |
| Faible | 5 | 1 |

## 2. Corrigé dans le code, prouvé par des tests (publié le 6 novembre, voir § 6 bis)
| Gravité | Domaine | Problème | Correction |
|---|---|---|---|
| Élevé | 3, 4 | Le rôle `gestionnaire` franchissait le contrôle d'établissement : le code lui ouvrait l'identité des résidents et les dossiers de tous les CHSLD | Accès réservé aux membres du CHSLD ; refus testé, y compris par OG |
| Moyen | 7 | `script-src 'unsafe-inline'` dans la CSP d'Arrimo : une faille XSS aurait pu lire le jeton de session | Retiré ; script de la page légale déplacé dans un fichier ; `base-uri`, `form-action`, `object-src` ajoutés |
| Moyen | 4 | Réponses de l'API sans `Cache-Control: no-store` | Ajouté, ainsi qu'une `Permissions-Policy` |
| Moyen | 1, 13 | Un serveur de production pouvait démarrer avec les secrets 2FA en clair | Démarrage refusé en production si la clé manque, si des identités fictives ou un mot de passe de démo sont actifs, ou si la clé SH est trop courte |
| Moyen | 8 | Remise à zéro de la démo : détection des blocages et simulation continuaient pendant le remplacement de la base ; attente de vidage sans limite, une requête bloquée pouvant figer l'application en maintenance | Tâches de fond exclues pendant la remise, avec un test ; attente limitée à 20 s (ce délai n'est pas testé directement sur une requête bloquée) |
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

**Connexions SSH, vérifiées le 6 novembre (lecture seule) :**
- Une seule clé autorisée pour root (`mac-moustapha`, `SHA256:EbqFnkp4…oW00`). Le fichier du compte `ubuntu` est vide et ce compte est verrouillé. Aucune option de clé cachée, aucune autorité de certificats.
- Toutes les connexions par clé utilisent cette clé : `70.27.239.207`, `67.69.76.183` (4 nov.), `67.69.76.110` (2 nov.).
- Connexions par mot de passe : aucune depuis le durcissement du 16 octobre. Avant, elles venaient de `70.27.239.207`, `67.69.76.11` et du serveur lui-même.
- Moustafa a confirmé `70.27.239.207` et son partage de connexion en `67.69.76.x`. Le rapport initial affichait `67.69.76.1` par erreur : l'adresse était tronquée.
- Le compte root garde un mot de passe, inutilisable par SSH. À envisager : le changer, car il a servi avant le durcissement.

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
- **Console SH** : balayage ajouté le 6 novembre : 199 routes sans session, 130 routes interdites au rôle support, toutes refusées. Les autres rôles et le contrôle fin des périmètres restent couverts par les suites SH existantes.
- **Non couvert par la nouvelle batterie** : l'envoi de pièces jointes ; le vocal ; une revue ligne à ligne.
- **Domaine 9, liaison site ↔ SH** : revue du plan quand il sera présenté. Elle n'est pas construite.
- **Préparation de la production** (Canada et Afrique) : voir § 7. Plusieurs jours de travail.

## 6. Première recette des corrections
Empreinte des sources `532aaa1fcf9f`, commit `de24161`, 250 tests, 0 échec au dernier passage de chaque suite :
- SH : 10 suites, 110 tests (`20261105232331_1dc6c9`) ;
- scénarios A, B, C et OG de base : 9 tests (`20261105232333_594da5`) ;
- CHSLD : 23 tests, dont les 600 cas d'OG (rapport `20261105232335_97ef89`, marqué en échec à cause de la suite suivante) ;
- API : 71 tests, lancée seule (`20261105235217_2ce39d`) ;
- interface hospitalière 16 tests et OG suivi 21 tests, lancés seuls (`20261105235534_897b0e`).

**Échec intermittent observé :** lors du premier passage, avec plusieurs recettes en parallèle, le « guide de démonstration » a échoué sur ordinateur et téléphone à l'attente de 30 s de l'écran de connexion après une remise à zéro de la démo. La suite complète passe seule, sans changement de code. La cause exacte n'est pas établie ; la charge de la machine est l'explication la plus probable. Un message `relation "lits" does not exist` apparaît dans ce journal pendant la remise à zéro : à examiner, car une tâche de fond peut lire la base pendant son remplacement.

## 6 bis. Recette finale et publication (6 novembre 2026, 1 h 39 UTC)
Autorisée par Moustafa, sous condition d'une recette entièrement verte.

**Recette :** empreinte `66c996e6f0c6`, 250 tests, 0 échec, 0 ignoré (`20261106011140_897700`, `20261106011142_06fef0`, `20261106011144_ffb0d4`, `20261106013613_e9a294`). OG : 600 cas sur 600.

L'échec intermittent du § 6 a été traité : les tâches de fond sont exclues pendant la remise à zéro de la démo et l'attente de vidage est bornée. La recette repasse sous la même charge. Le message `relation "lits" does not exist` apparaît encore une fois dans le journal de la suite hospitalière : **sa source n'est pas établie**.

**Publication :** release `audit-20261106t0139` sur la démo et SH, avec sauvegarde préalable. Retour arrière prêt vers `parcours-20261105t2253`. Rapport : `.local/audit-release-20261106t0139/rapport.json`. Site public et DNS non touchés ; recette, validation et principal non mis à jour.

**Vérifié après publication :**
- Démo en ligne : santé, en-têtes, connexions A, B, C et réseau sans double authentification, deux CHSLD, Liaison, OG, refus au gestionnaire ; navigateur sans erreur ni refus CSP.
- Parcours CHSLD ↔ hôpital : 17 contrôles sur 17, avec le code publié, sur une copie de la démo (`arrimo_publication_restore_demo_c636523c56`). La démo en ligne n'a reçu aucune donnée de ce test.
- SH en ligne : page, santé, refus sans session (401), refus d'un code avec un jeton inventé (401). Le seul compte actif a la double authentification active.

**Non vérifié en ligne :**
- Connexion SH complète avec mot de passe et bon code : aucun accès SH n'est conservé pour ces contrôles. Moustafa doit la faire. La suite `acces` le prouve seulement sur une base de test.
- Les boutons de l'entretien dans le parcours joué à l'écran ; la tablette.

## 6 ter. Compléments
- **Double authentification et démos :** décision de Moustafa, jamais sur les démos. S4 ne vise donc que la recette, la validation et la production. Reste à bloquer l'activation volontaire sur la démo (`src/admin.js`).
- **S1, clé Backblaze : non résolu.** Le 6 novembre, la clé en service voyait encore 4 buckets et `rclone.conf` datait du 17 octobre : la nouvelle clé n'est pas enregistrée. Ne pas révoquer l'ancienne. Sauvegarde et restauration de test à faire après sa saisie.
- **SSH :** mot de passe refusé lors d'essais réels, une seule clé (`mac-moustapha`). Un fichier résiduel contient `PermitRootLogin yes`, mais `00-durcissement.conf` l'emporte. À nettoyer avec son accord.
- **Hors Arrimo, à signaler :** les dumps PharmaQuick du bucket `medlink-backups-togo` s'arrêtent au 26 septembre alors que `pharmaquick-api` tourne toujours.

## 6 quater. Publication du 6 novembre, 8 h 13 UTC
Release `audit-20261106t0813` sur la démo et SH, commit `41bc4d1`, autorisée par Moustafa. Recette : 252 tests, 0 échec, 0 ignoré (`20261106021034_90f36e`, `20261106021036_acfcad`, `20261106021038_47db2d`, `20261106022814_ec2d6f`), OG 600 sur 600. Retour arrière : `audit-20261106t0139`. Rapport : `.local/audit-release-20261106t0813/rapport.json`.

Vérifié en ligne : connexions sans code, administration ouverte sans code dans un navigateur, activation refusée (403), aucun secret de double authentification dans la base de la démo. Parcours CHSLD ↔ hôpital : 17 sur 17 sur une copie à jour. La connexion complète à SH avec mot de passe et code reste à faire par Moustafa.

## 6 quinquies. Préparation multi-pays, étapes 1 à 4 (6 novembre, NON publié)
Ordre validé par Moustafa. Commit `53e9d04` : recette 253 tests, 0 échec, 0 ignoré (`20261106135008_3d5be6`, `20261106135010_693237`, `20261106135012_ed2da3`, `20261106141547_a8a569`), OG 600 sur 600, `npm test` 209 sur 209.

1. **Une production par pays** : `SH_PRODUCTIONS`, adresse et clé propres, choix explicite au go-live, migration SH 39.
2. **Installation par pays** : `deploy/hebergement.sh`, un pays ne vaut jamais pour un autre.
3. **Alertes, contrôle automatique, plan d'incident** : alertes inactives tant que `ALERTE_WEBHOOK_URL` n'est pas réglée. Contrôle GitHub dans `.github/workflows/controle.yml`, dont le résultat n'a pas pu être lu d'ici. `docs/PLAN_INCIDENT_ET_REPRISE.md` reste à valider.
4. **Documents** : `docs/LOI25_REGISTRE_ET_EFVP.md`, `docs/DOSSIER_TEST_INTRUSION.md`, projets à faire relire.

**Défaut trouvé par `npm test`, présent sur la release `audit-20261106t0813` :** une question d'hôpital sur les demandes de transfert recevait une réponse de la Liaison CHSLD. Corrigé dans `53e9d04`. La recette ne lance pas `tests/finalisation.test.cjs` : `npm test` s'ajoute désormais à la recette avant chaque publication.

## 7. Domaine 13 : préparation multi-pays, état des lieux (lecture seule, 6 novembre)
**Conclusion : Arrimo est conçu pour plusieurs pays, mais il n'est pas prêt à ouvrir un serveur par pays sans écrire de code.** Aucune correction n'est faite dans cette partie.

| Sujet | Ce qui existe | Ce qui manque |
|---|---|---|
| Profil pays | Table `config_pays` : rayon, délais, format de référence, nom du transport, fuseau. Choix du profil contrôlé par SH | Seul le profil Québec est créé. Les formats réels des autres pays restent à obtenir |
| Serveur par pays | SH pilote des environnements séparés, avec une clé par environnement, conservée dans son `.env` | Liste fixe d'environnements dans `src/sh/cibles.js`, avec une seule entrée « production » : ajouter un pays demande du code |
| Sécurité du lien SH ↔ pays | Clé de service comparée en temps constant. **Corrigé le 6 nov. (non publié) :** HTTPS obligatoire hors de la machine et clé jamais suivie sur une redirection, prouvés par test | — |
| Installation | Script d'installation avec garde-fous, retour arrière applicatif | La production exige `CONFIRMER_HEBERGEMENT_CANADA` : le script bloque tout pays hors Canada |
| Types d'établissements | Hôpital et CHSLD opérationnels ; autres types prévus mais refusés | Liste fixe dans le code et dans une contrainte de base : CHU, CSRéf ou clinique demandent du code |
| Langues | Français et anglais | Toute autre langue |
| Fuseau | Fuseau par profil | Fuseau `America/Toronto` encore écrit dans le code, à plusieurs endroits, à passer en revue |
| Connexion difficile | — | Aucun mode hors ligne, aucun SMS ni WhatsApp |
| Contrôle avant mise en ligne | Recette complète et publication avec sauvegarde, lancées à la main | Aucune chaîne automatique (pas de `.github/workflows`) |
| Alertes et plans | Surveillance dans le journal système | Aucune alerte envoyée ; aucun plan d'incident ou de reprise écrit |
| Documents | Pages légales à faire relire | Aucun registre, modèle d'évaluation Loi 25 ni dossier de test d'intrusion ; aucune analyse des lois africaines (à faire vérifier sur place) |

**Ordre proposé, à valider :**
1. Liste d'environnements configurable (HTTPS obligatoire : fait).
2. Script d'installation par pays, avec confirmation du pays d'hébergement.
3. Plans d'incident et de reprise, alertes, chaîne de contrôle automatique.
4. Documents Loi 25 et dossier du test d'intrusion.
5. Types d'établissements configurables depuis SH.
6. Mode hors ligne, SMS et WhatsApp : développements importants, à décider selon le premier pays visé.
