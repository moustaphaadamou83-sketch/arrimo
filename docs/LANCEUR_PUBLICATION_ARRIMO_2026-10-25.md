# Arrimo — lanceur unique de publication contrôlée

## Commande depuis la session SSH root Contabo

```bash
bash /root/arrimo-sh-erp/scripts/publier-arrimo.sh
```

Le lanceur publie exclusivement le commit applicatif **98712dfb9b20c2b5ae21903a3c154da52bff5aa6**, déjà validé par 153 tests intégrés. Le code applicatif n’est ni reconstruit ni modifié par ce chantier. Les 153 tests ne sont pas relancés. Le script, son worker et ses tests sont distincts de l’archive applicative épinglée.

Il faut rester dans une session SSH interactive pour fournir les accès manquants aux contrôles connectés. Les comptes A/B/C/Réseau existants utilisent le mot de passe conservé dans la configuration privée ou dans le fichier privé d’accès déjà présent, lorsqu’il est disponible. Pour le principal, le script demande un compte autorisé à lire les modules opérationnels ; pour SH, un compte Administration avec MFA. Les mots de passe et codes MFA sont masqués à la saisie. Aucun compte, mot de passe ou secret MFA n’est créé, changé ou extrait de la base pour contourner l’authentification. Les sessions obtenues par connexion normale sont fermées en fin d’exécution.

Facultativement, `ARRIMO_PUBLICATION_ACCES` peut désigner un fichier JSON privé de mode 0600 contenant les accès existants. Il ne doit jamais être commité :

```json
{
  "demo": [
    {"nom":"a","email":"hopital.a@demo.arrimo","password":"<secret existant>"},
    {"nom":"b","email":"hopital.b@demo.arrimo","password":"<secret existant>"},
    {"nom":"c","email":"hopital.c@demo.arrimo","password":"<secret existant>"},
    {"nom":"reseau","email":"reseau@demo.arrimo","password":"<secret existant>"}
  ],
  "principal": [{"nom":"principal","email":"<compte autorisé>","password":"<secret existant>"}],
  "sh": [{"nom":"sh","email":"<compte Administration>","password":"<secret existant>"}]
}
```

Le MFA reste demandé par la connexion normale quand il est actif. Sans accès valide, le lanceur s’arrête avant toute migration ou bascule publique ; il ne devine pas de mot de passe et ne crée aucune session directement en base.

## Ordre et garde-fous

1. Verrou de publication exclusif ; dossier de preuves root privé `/root/arrimo-publication-<date>_<identifiant>` ; rapport JSON écrit atomiquement.
2. Vérification des douze journaux de recette, de leurs SHA-256, du commit et des compteurs réels (153 réussites, aucun ignoré). Refus d’un dépôt non propre.
3. Identification des trois services, des versions par comparaison des fichiers aux objets Git (un ancien marqueur seul ne suffit pas), des liens `current`, utilisateurs, ports, fichiers d’environnement et hôtes Nginx. Refus d’un décalage de configuration ou de bases publiques partagées.
4. Vérification PostgreSQL local, systemd, HTTPS sans ignorer les certificats, santé JSON et refus des accès sans session. Contrôle du runtime Chromium. Aucun changement global de permissions, de pare-feu, d’authentification, de CSP ou de service tiers.
5. Connexions autorisées et contrôle des rôles A/B/C distincts, Réseau et SH, puis navigation de référence sur les versions existantes. Si les accès nécessaires sont absents ou un mot de passe temporaire impose une action du titulaire, arrêt avant publication.
6. Sauvegarde distincte de chaque environnement : dump custom, configuration privée, unité systemd effective, site Nginx et archive de la release précédente. Le dump et les empreintes source utilisent **le même snapshot PostgreSQL exporté**, même si des utilisateurs écrivent pendant la sauvegarde. Checksums de tous les fichiers ; `pg_restore --list`.
7. Création de trois bases neuves locales `arrimo_publication_restore_*`, appartenant aux rôles applicatifs existants. Pas de réutilisation, suppression, `--clean` ou restauration sur une base publique. Les droits CONNECT du PUBLIC sont retirés uniquement sur ces nouvelles copies.
8. Restauration réelle avec destination explicite. Comparaison des empreintes et nombres de toutes les tables avec le snapshot. Migration répétée deux fois sous le rôle applicatif ; contrôle de préservation des anciennes colonnes et séquences. Pour SH, seuls les enregistrements de versions `sh_migrations` peuvent être ajoutés ; les données ERP existantes sont comparées. Les modifications imprévues de données arrêtent la procédure sur copie.
9. Ancienne et nouvelle application démarrées en boucle locale sur la copie migrée, avec les sessions réellement obtenues avant la sauvegarde. Lecture des modules sans redémarrer les jobs de simulation, recalage ou supervision : aucun événement d’un vrai connecteur n’est émis. Compatibilité du rollback vérifiée sans effacer de données.
10. Exercice isolé du mécanisme existant de bascule et retour applicatif. Toutes les copies doivent être validées avant la première migration publique.
11. Release neuve sous chaque racine existante, dépendances réutilisées seulement si leur lockfile correspond ou installation locale du lockfile. Aucune purge. Le code est lisible mais non modifiable par le compte du service. Configuration et unités existantes préservées.
12. Démo en premier : bref arrêt de son seul service, migration transactionnelle avec délais et verrous, comparaison des données existantes dans la même transaction, bascule atomique par `deploy/releases.sh`, puis santé locale et HTTPS, SHA-256 de l’asset public et navigation connectée réelle A/B/C/Réseau. Admissions, Lits, Urgences, Congés, Nettoyage, NSA, Transferts et OG sont lus ; les accès croisés A/B/C doivent être refusés. Captures des quatre dashboards. Aucun scénario fictif n’est réinitialisé.
13. Principal seulement après succès public de la démo, puis SH si ses composants ont changé. Les opérations métier publiques restent en lecture seule pendant les smoke tests ; les créations de sessions et leurs journaux sont les seules écritures d’authentification ordinaires. Les parcours d’écriture complets sont ceux de la recette intégrée déjà validée. Pas de capture contenant des patients du principal ; captures uniquement sur la démo explicitement fictive.

## Échec et retour arrière

Un échec critique arrête le pipeline avant l’environnement suivant. Si la migration échoue, PostgreSQL annule sa transaction et l’ancienne application est redémarrée. Si un contrôle après bascule échoue, le pointeur revient exactement à la release saine conservée, puis sa santé est vérifiée. Si un tiers a changé le pointeur, le lanceur refuse un rollback aveugle. Les environnements déjà publiés et vérifiés restent sur leur version validée ; ils sont identifiés séparément dans le rapport.

Le rollback est **applicatif**. Aucune ancienne base n’est restaurée par-dessus la base active et les écritures récentes ne sont pas effacées. Les migrations sont additives et leur compatibilité avec l’ancien code doit être démontrée avant publication. Une incompatibilité entraîne un refus sur copie. Aucun rollback SQL destructif n’est tenté.

Les interruptions ordinaires SIGINT/SIGTERM/SIGHUP sont traitées. Une coupure machine ou SIGKILL ne peut pas être sécurisée par un gestionnaire Python : consulter le rapport privé durable, les pointeurs et l’état systemd avant toute reprise. Une nouvelle exécution ne réutilise ni les bases de restauration ni les releases partielles ; elle refait les prérequis de sauvegarde, sans réinitialiser l’application.

## Rapport et limites de validation du lanceur

Le chemin du rapport privé est affiché au démarrage. Le JSON final contient les versions avant/après par domaine, les contrôles, les sauvegardes, les bases de copie, les éventuelles migrations publiques, les rollbacks et `publication_verifiee`. Un statut de santé seul ne suffit jamais pour déclarer la publication réussie.

Vérifications non destructives exécutées ici : audit réel des versions locales, contrôle des preuves archivées, 21 tests Python de garde-fous et orchestration simulée, 4 tests JavaScript des restrictions PostgreSQL, exercice réel du script de releases dans un répertoire temporaire avec services/santé simulés, syntaxe Python/JavaScript/Bash et contrôle du diff. Les résultats sont conservés dans `preuves-lanceur-publication-20261025`.

Ces tests ne constituent pas une exécution PostgreSQL/systemd/navigateur de l’orchestrateur complet. Celle-ci sera effectuée par la commande SSH ci-dessus et n’est pas annoncée comme déjà réussie. Le mode `--audit` n’effectue aucune écriture ni déploiement.

Versions locales identifiées avant cette commande : démo et principal **2ed912745f6338e185c8c31bd0cb97385a9fce1d** ; SH **9a67e96e2a3d0b537609435b17bc2833c8eb7417**. Aucun site n’a été publié par la préparation du lanceur. La vérification HTTPS connectée de ces versions reste à exécuter par l’orchestrateur.
