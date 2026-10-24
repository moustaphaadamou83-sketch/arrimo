# Arrimo — durcissement de la candidate et rapport de déploiement

**Décision au 22 octobre 2026 : candidate préparée et vérifiée en environnement isolé; déploiement public maintenu à l’arrêt.** Aucun compte, aucune donnée et aucun fichier du site public n’a été modifié pendant cette mission.

## État des cinq blocages

| Blocage | État | Preuve / reste à faire |
|---|---|---|
| Runtime Node | **Local clos; public à valider** | Node 24.22.1 LTS téléchargé dans `.local/runtime-node/`, SHA-256 vérifié contre le fichier officiel Node.js, `npm ci` propre dans `.local/runtime-app-check`. L’installateur candidat utilise un runtime Node par application sous `.runtime`, vérifie le hash et ne change plus `/usr/bin/node`. Le script doit être exécuté en recette Ubuntu avant toute production. Le service public reste sous Node 18.19.1, EOL. |
| Copie représentative / migration | **Validé en PostgreSQL local** | Restauration réelle de l’archive publique dans une base locale isolée, anonymisation immédiate, puis migration `db/migrations/20261022_capacites_og.sql` exécutée deux fois. Comptes (3), historique (13 435 lignes), transferts (60) et volumes métier conservés. Sessions et défis 2FA ont été vidés durant l’anonymisation. La compatibilité ancienne application a passé le test santé/auth/session HTTP 200. Répéter le processus en recette Ubuntu reste requis. |
| Sauvegarde / restauration | **Restauration réelle locale réussie** | Archive `/var/backups/arrimo/arrimo-20261022T010009Z.dump` (~285,6 Ko), checksum vérifié et restauration complète depuis son flux, sans enregistrer l’archive brute sur le poste. Comptes et historique conservés après anonymisation. La restauration ne doit jamais remplacer directement une base active. |
| Retour arrière | **Partiellement clos** | `deploy/restaurer.sh` est maintenant fail-closed et n’écrase plus le schéma. L’ancienne version a fonctionné contre le schéma migré sur une copie jetable. Le serveur actuel remplace encore les fichiers en place : il faut concevoir et éprouver des releases immuables et une bascule atomique en recette avant un déploiement public. |
| Routage | **Fallback validé; fournisseur réel absent** | Aucun fournisseur approuvé n’est configuré. Le code renvoie « trajet indisponible » sans inventer de distance; un transfert dont l’itinéraire est requis est refusé. Ne pas configurer le serveur public de démonstration OSRM. |

## Candidate et version

Branche : `codex/og-rescuematch-road-routing`. Candidate : `a778a9952769c60a3c86c91bb3d5e374988be80f` (correctif de sécurité d’affichage, basé sur `f50dc3649c5550de33b9479a546c5d186672f476`). Aucun push ni déploiement n’est effectué. Le code antérieur comportait déjà des changements non commités : ils ont été conservés dans la candidate. Les copies de base, outils locaux et preuves d’exécution restent sous `.local/`, ignorés par Git.

Les hachages du domaine observés lors de l’audit précédent confirment un déploiement partiel : le HTML, `og.js` et le robot SVG correspondaient aux fichiers candidats, tandis que `app.js` et `i18n/fr.js` étaient anciens. `/api/sante` répondait `etat=ok`, `base=ok` en HTTPS. Cela n’est pas une vérification visuelle complète de la candidate. Aucune capture candidate publique n’existe.

## Restauration et migration de la copie

La base restaurée est un clone local privé (`arrimo_rest_85b7fb014f98`, PostgreSQL sur `127.0.0.1:55439`). Courriels et noms de comptes, secrets d'authentification, références patient, sessions, défis 2FA, notifications et textes libres d'historique ont été anonymisés/vidés avant toute vérification affichée. L'archive brute n'a pas été conservée localement. Aucun fichier ne s'est retrouvé dans la candidate Git.

Le SQL de migration est additif et transactionnel : responsable/horodatage de confirmation, validité configurable, état de relance, service responsable et métadonnées de trajet. La conversion des distances existantes d’entier vers `numeric(8,1)` conserve les valeurs. La migration n’attribue aucune confirmation historique; les capacités existantes restent à confirmer par un rôle autorisé. Les comptes et l’historique ont gardé leurs nombres de lignes. L’ancienne application issue de `HEAD` a ensuite répondu 200 à la santé, à la connexion d’un compte fictif anonymisé et à la lecture de sa session, sur une copie jetable de la base migrée.

Le seul moyen de restaurer une sauvegarde en cas de problème de données doit être une restauration parallèle dans une nouvelle base, suivie de contrôles et d’une bascule coordonnée. Une sauvegarde ancienne ne doit pas remplacer une base qui a reçu de nouvelles écritures.

## Tests candidats

Suites exécutées avec Node 24.22.1 et dépendances fraîchement installées depuis le lockfile dans la copie autonome `.local/runtime-app-check` :

- API : 62 réussis, 0 échec;
- interface : 9 réussis, 0 échec;
- OG : 6 réussis, 0 échec;
- routage : 6 réussis, 0 échec;
- courriel : 1 réussi, 0 échec.

**Validation de base : 84 tests réussis, 0 échec** (API 62, interface 9, OG 6, routage 6, courriel 1; `.local/preuves-23b6d8a9b7bc69/` et preuves de routage). Après le dernier correctif, les **62 tests API et le test courriel ont été relancés et réussis**; la vidéo a été réenregistrée dans Chromium depuis l’application actualisée, sans erreur navigateur. Les 9 tests formels d’interface, les 6 tests OG et les 6 tests routage n’ont pas été relancés après ce dernier correctif limité aux distances de la vue réseau; la capture réelle valide l’écran actualisé. Les tests OSRM utilisent un routeur fictif et ne valident pas un fournisseur réel. Le test courriel ne contacte aucun serveur SMTP. `npm ci` a signalé deux dépendances transitives dépréciées dans `pdfkit` (`crypto-js`, `jpeg-exif`); elles ne sont pas utilisées dans le nouveau flux de routage et n’ont pas été modifiées dans cette mission.

## Démonstration vidéo locale

Une capture continue de 120 secondes depuis l’application candidate locale est fournie dans [`docs/video-demo/ARRIMO_DEMONSTRATION_2MIN.mp4`](docs/video-demo/ARRIMO_DEMONSTRATION_2MIN.mp4). Le MP4 H.264 (1920 × 1080, 30 i/s) a été décodé sans erreur et inspecté sur plusieurs images. Les données sont fictives. Le script de narration, le minutage et les limites sont décrits dans le même dossier. Aucun audio n’est intégré.

La vidéo respecte le garde-fou de routage : la demande fictive est acceptée et préparée, mais le départ est empêché faute de fournisseur approuvé. La scène de réception concerne un autre transfert préchargé dans le scénario fictif; elle n’est pas présentée comme la suite du transfert bloqué. La démonstration ne valide ni un transfert public réel, ni une procédure clinique ou pédiatrique.

## Procédure proposée avant toute bascule publique

1. Construire un artefact immuable depuis le commit identifié; ne pas empaqueter `.local`, `node_modules`, captures, sauvegardes ou données fictives.
2. En recette Ubuntu, installer le runtime Node 24.22.1 dédié à l’application et valider le hash, `npm ci`, les permissions et le démarrage. Aucun Node système ni service voisin ne doit être remplacé.
3. Faire un dump chiffré/contrôlé, en vérifier la somme, restaurer dans une nouvelle base isolée puis comparer comptes, relations, tables et historique avant migration.
4. Exécuter la migration idempotente et les tests de compatibilité ancienne/nouvelle version. Confirmer que les anciennes disponibilités restent non confirmées.
5. Préparer des releases parallèles, garder `.env` et la base hors des dossiers de code, puis tester la bascule/reprise systemd et le retour applicatif à la release précédente en conservant le schéma additif et les écritures nouvelles.
6. Sans fournisseur de routage approuvé, garder le calcul désactivé et afficher « trajet indisponible ». Ne pas montrer de distance à vol d’oiseau comme distance routière.
7. Après feu vert recette, faire une fenêtre de déploiement, une vérification de santé et les tests de fumée des rôles et fonctions sur dossiers fictifs, puis comparer les empreintes d’actifs réellement servis. Capturer Safari/Chrome en ordinateur, tablette et mobile.

## Statut public final

- Version de cette candidate déployée : **aucune**; heure de déploiement : **sans objet**.
- URL : https://arrimo.senseafri.com/ — HTTPS et endpoint de santé répondent au contrôle antérieur en lecture seule.
- Lits, civières, transferts, connexions des trois comptes et OG complet sur le domaine : **non testés**, pour éviter une action métier sur les données publiques alors que la candidate n’a pas été déployée.
- Retour arrière public éprouvé : **non**. Compatibilité ancienne application / schéma migré : **oui, copie isolée seulement**.
- Risques restants : installer et répéter les contrôles sur recette Ubuntu; passage à un mécanisme de release atomique; fournisseur routier réel à approuver et valider; répétition humaine Safari; validations de règles pédiatriques avec les équipes hospitalières.

Captures locales seulement : [accueil ordinateur](preuves/og/ordinateur-accueil.png), [accueil tablette](preuves/og/tablette-accueil.png), [accueil téléphone](preuves/og/mobile-accueil.png), [OG ordinateur](preuves/og/ordinateur-og-accueil.png).

Référence runtime : [état des versions Node.js](https://nodejs.org/en/about/previous-releases) et [publication Node.js 24.22.1 LTS](https://nodejs.org/en/blog/release/v24.22.1/).
