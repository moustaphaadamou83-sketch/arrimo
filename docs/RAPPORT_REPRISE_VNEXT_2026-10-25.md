# Arrimo VNext — reprise du 25 octobre 2026

## Verdict

Le chantier a été poursuivi après `afe49f6`. Le moteur de priorités professionnelles, ses interfaces et la configuration opérationnelle SH sont développés et couverts par des tests locaux. **La livraison intégrée, la publication et la préparation définitive de Sainte-Justine ne sont pas validées.** Les restrictions de cette session empêchent PostgreSQL, Chromium et les contrôles publics. Aucun site, compte réel ou jeu A/B/C n'a été modifié.

Le commit de développement principal de cette reprise est `9dea89958c0a43bea3a5a0467816f35084fd36f1`. Le commit de livraison suivant ajoute notamment le contrôle de migration sur copie restaurée, les preuves et ce rapport. Le `manifest.json` du candidat contient le commit exact emballé. Le numéro npm historique `1.0.0` ne suffit pas à identifier une release.

## Diagnostic établi

Les refus ne démontrent pas une panne PostgreSQL ni une panne des sites : ils surviennent dans l'environnement Codex avant contact avec le serveur.

| Diagnostic non destructif exécuté | Observation | Conclusion et accès nécessaire |
|---|---|---|
| Lecture de `/proc/self/status` | `CapEff=0`, `NoNewPrivs=1`, `Seccomp=2` | Processus restreint malgré UID 0 ; aucune protection du serveur à désactiver |
| Création Python de sockets AF_INET, TCP et UDP | `EPERM` dès `socket()` | TCP et DNS impossibles depuis ce runtime |
| Connexion AF_UNIX vers `/root/arrimo-diagnostic-inexistant.sock` | `EPERM`, même pour un chemin inexistant | Refus de connexion avant recherche d'un service ; modifier `pg_hba.conf` ne résoudrait pas cette restriction |
| `psql -d postgres -Atc 'select datname from pg_database'` | `Operation not permitted` sur le socket local | Tests SQL impossibles ici ; il faut un runtime autorisé à joindre une base isolée |
| `curl -I --max-time 15 https://demo.arrimo.senseafri.com/api/sante` et ouvertures web des trois routes santé | DNS refusé / sites inaccessibles via l'outil | HTTPS et disponibilité publique non établis ; pas de conclusion de panne |
| Lancement Chromium par Playwright installé | Arrêt avant création d'une page, `sandbox_host_linux.cc`, `shutdown: Operation not permitted` | Besoin d'un runtime navigateur avec IPC autorisé ; aucune capture actuelle |
| `pg_restore --list /var/backups/arrimo-finalisation-arrimo-20261024T220510Z.dump` | `Permission denied` | Sauvegarde recensée, mais ni lisibilité ni restauration vérifiées ici |
| Sous-processus Node de contrôle | `spawnSync … EPERM`, parfois statut zéro sans sortie | Un statut zéro de fichier n'est pas une preuve d'exécution des tests |

Les tests locaux utilisent maintenant le runner Node **sans sous-processus**, comptent ses événements réels et enregistrent l'empreinte des sources. Les suites intégrées utilisant l'isolation processus ont un précontrôle qui échoue explicitement dans ce runtime, afin d'éviter des résultats faussement verts.

Diagnostic de socket reproductible, sans modifier la configuration :

```sh
python3 - <<'PY'
import socket
for famille, genre in [(socket.AF_INET, socket.SOCK_STREAM), (socket.AF_INET, socket.SOCK_DGRAM)]:
    try:
        s = socket.socket(famille, genre)
        s.close()
        print('création autorisée')
    except OSError as e:
        print('création refusée', e.errno)
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
try:
    s.connect('/root/arrimo-diagnostic-inexistant.sock')
except OSError as e:
    print('connexion UNIX refusée', e.errno)
finally:
    s.close()
PY
```

L'accès manquant est un environnement d'exécution approuvé donnant accès à une base PostgreSQL locale dédiée, à une sauvegarde lisible/restaurable et aux fonctions IPC du navigateur. Pour une publication ultérieure seulement, il faudra aussi l'accès aux répertoires de releases et aux services identifiés. Aucune élévation, modification de pare-feu, modification PostgreSQL, modification de permissions de sauvegarde ou voie de contournement n'a été utilisée.

## Versions constatées dans les fichiers du serveur

L'inventaire initial a été corrigé après lecture des unités systemd : le principal utilise `/opt/arrimo/current`, pas les anciens fichiers encore présents à la racine `/opt/arrimo`.

| Cible | Unité / chemin actif configuré | Version comparée à Git | Retour applicatif recensé |
|---|---|---|---|
| Principal — https://arrimo.senseafri.com/ | `arrimo.service`, `/opt/arrimo/current` | `2ed912745f6338e185c8c31bd0cb97385a9fce1d` : **111 fichiers comparés, zéro écart** | `arrimo-audit-9a67e96…` |
| Démo A/B/C/Réseau — https://demo.arrimo.senseafri.com/ | `arrimo-public-demo.service`, `/opt/arrimo-demo/current` | même commit : **111 fichiers comparés, zéro écart** | `arrimo-audit-9a67e96…` |
| SH — https://sh.arrimo.senseafri.com/ | `arrimo-sh.service`, `/opt/arrimo-sh/current` | `9a67e96e2a3d0b537609435b17bc2833c8eb7417` : **107 fichiers comparés, zéro écart** | `arrimo-erp-25dd22d…` |

Périmètre comparé : `src`, `public`, `public-sh`, `db`, `scripts`, `package.json`, `package-lock.json`. Cela établit le contenu des releases pointées, **pas le processus actuellement chargé ni sa santé HTTPS**. Les anciens marqueurs `.arrimo-release` indiquent encore `74b35fb…` ; le générateur du nouveau candidat les remplace par son commit exact.

## Développements de cette reprise

### Priorités et attribution

- Référentiel de 2 à 12 catégories par établissement, avec codes, libellés et rangs explicites ; aucune catégorie clinique injectée automatiquement.
- Approbation du référentiel par un administrateur également habilité comme professionnel ; auteur, date, motif et révision enregistrés.
- Habilitation professionnelle distincte des rôles réseau et administrateur. Attribution/retrait explicite, protégé par la MFA administrative existante, versionné et journalisé. **Aucun compte réel habilité pendant ces travaux.**
- Validation d'une priorité de demande par le professionnel habilité : auteur issu de la session, date serveur, catégorie issue du référentiel, motif et version. Les champs d'auteur ou de rang envoyés par le client ne sont pas acceptés comme source de vérité.
- Verrou de demande, verrou de référentiel, version optimiste et contrôle d'habilitation sous verrou. Demandes clôturées non modifiables par cette opération.
- Classement : priorités validées dans le référentiel courant, rang croissant, puis ancienneté à rang égal et identifiant. Demandes sans validation dans une section logique à valider, ordonnées par ancienneté. La gravité n'est jamais calculée à partir de l'attente.
- Changer le référentiel exige de revalider les anciennes priorités avant de les classer. Leur validation historique reste enregistrée.
- Les anciennes valeurs P1/P2/P3 sont conservées et affichées comme indications non validées ; aucune conversion silencieuse en validation clinique.
- Admissions, Urgences et OG utilisent la même présentation de validation. L'attribution de lit reste une action humaine et utilise les contrôles existants de spécialité, âge et équipements.

### OG et pédiatrie

- Questions sur les demandes prioritaires et leur classement : priorités effectivement validées, auteur/date, règle de départage et numéro du lit compatible proposé.
- Les réponses distinguent données manquantes et demandes à revalider. OG n'a aucune fonction de validation de priorité.
- Confirmation humaine avant les propositions modificatrices d'OG, y compris assignation, nettoyage, congé et actions sur lits/civières.
- Groupe d'âge transmis à la recherche réseau d'OG et conservé lors du plan B après refus. Les besoins d'équipement sont conservés.
- Le transport urgent est un choix explicite de l'équipe ; il n'est plus déduit automatiquement d'une ancienne valeur P1.

### SH

- Fenêtre de configuration hospitalière distincte du catalogue ERP des licences : modules opérationnels et vocation.
- Catalogue des spécialités et lecture du référentiel de priorités déjà approuvé dans Arrimo. L'approbation professionnelle reste locale dans Arrimo.
- Écriture de configuration réservée au rôle SH administration ; lecture également autorisée à implantation ; autres rôles refusés.
- Empreinte de version sous verrou pour refuser une configuration périmée. Champs opérationnels, patients et habilitations interdits dans ce flux.
- Seuls modules/vocation sont mis à jour ; les paramètres personnalisés inconnus sont conservés. Les licences ERP, occupations, admissions et historiques ne sont pas synchronisés par ce flux.
- Un ancien serveur Arrimo sans ces nouvelles routes doit être mis à jour avant utilisation de cette fenêtre ; les modules ERP existants ne sont pas reconstruits.

### Migration et livraison

Migration additive `db/migrations/20261025-priorites.sql`, également intégrée à `db/schema.sql` : deux tables et colonnes de validation sur les demandes. Aucun `DELETE`, aucune réinitialisation et aucune validation rétroactive.

`scripts/verifier-migration-priorites.cjs` est préparé pour une copie locale **déjà restaurée**, nommée `arrimo_vnext_restore_*`. Il compare comptes, droits, ressources, demandes, transferts, journaux, patients, congés et notifications avant/après, sur leurs colonnes préexistantes, et répète la migration deux fois. Il n'effectue pas de restauration. **Son contrôle SQL n'a pas été exécuté.**

Le générateur du candidat exige un dépôt propre et un rapport local correspondant exactement aux sources. Il produit archive, SHA-256, preuves et manifeste portant `publication_admissible: false`. Il ne déploie rien.

## Résultats effectivement obtenus

| Vérification | Résultat final | Limite |
|---|---:|---|
| Priorités — logique, droits, versions, journalisation et intentions OG | **38/38** | Pools simulés pour les opérations SQL ; aucune preuve de verrouillage PostgreSQL réel |
| Contrats des callbacks d'interface | **11/11** | VM JavaScript ; ni DOM complet ni navigateur |
| Configuration opérationnelle SH et API service | **18/18** | Dépendances SQL simulées ; pas de serveur SH en ligne |
| Atomicité du connecteur de `afe49f6` | **6/6** | Contrat transactionnel simulé |
| Courriel MIME | **1/1** | Aucun envoi externe |
| Routage | **6/6** | Fournisseur simulé |
| Total local | **80 réussis, 0 échec, 0 ignoré, 0 annulé** | Ne remplace pas la recette intégrée |
| Dictionnaires complets FR/EN et catalogue d'erreurs | Réussi | Vérification statique locale |
| Syntaxe JS/CJS et Python, `git diff --check` | Réussi | Aucune preuve fonctionnelle SQL |
| `npm test` | **Bloqué, sortie 1** : précontrôle IPC `EPERM` | Suites intégrées non exécutées |
| Nouvelle recette PostgreSQL | **Ignorée** : variable de base isolée absente | Zéro scénario SQL nouveau exécuté |
| Nouvelle recette navigateur priorités | **Ignorée** : variable de base isolée absente | Zéro scénario navigateur nouveau exécuté |
| Chromium, tentative diagnostique | **Échec au démarrage** : `EPERM` | Aucune page ouverte |
| Migration sur copie restaurée | **Non exécutée** | Accès base/sauvegarde manquants |
| Déploiements et tests publics | **Aucun** | Conditions de publication non réunies |

Un test de callback a initialement échoué parce qu'il vérifiait l'état avant la fin de sa continuation asynchrone. L'attente du test a été corrigée ; la suite finale est à 11/11. Le lanceur local a également été corrigé pour ne jamais compter un sous-processus empêché comme un test réussi.

Les preuves locales sont dans `docs/preuves-vnext/tests-locaux.json`, avec l'empreinte des sources. Les résultats historiques API 81/81, scénarios A/B/C 7/7, navigateur 21/21 sur copie et 22 questions OG restent dans les rapports précédents ; **ils ne constituent pas des résultats de cette reprise**.

## Contrôle des exigences et limites restantes

| Périmètre du cahier | État vérifiable maintenant |
|---|---|
| Organisation multiétablissements, ressources, imports, civières | Code existant conservé ; nouvelle régression intégrée non exécutée. Sites/bâtiments opérationnels et exhaustivité XLSX restent à auditer ; ne pas confondre les sites ERP SH avec une hiérarchie opérationnelle complète |
| Urgences → Admissions → Lits → Nettoyage, admission depuis les deux écrans | Implémentation transactionnelle existante conservée ; nouveau test PostgreSQL préparé, pas exécuté |
| Priorisation configurable | Développée et testée localement ; migrations, concurrence réelle, validation clinique du référentiel et navigateur en attente |
| Compatibilité adulte/pédiatrique | Moteur existant conservé et corrections de transmission d'âge testées en callback ; parcours réel A/B/C et néonatal non rejoués |
| Congés, prévisions, blocages, NSA | Code existant conservé ; non revalidé en base/navigateur dans cette session |
| Notifications de nettoyage | Fonctionnement réel non démontré ; activation et réception à vérifier, aucune notification externe envoyée |
| Réseau, national et transferts A→B/A→C, refus/alternative | Existant conservé ; correction d'âge du plan B couverte localement ; réceptions réelles sur copie et droits des quatre dashboards à rejouer |
| OG transversal | Explications des priorités et confirmations améliorées ; réponses réelles sur le jeu courant et fraîcheur publiques non vérifiées |
| Interopérabilité | Connecteur JSON simulé existant et correctif atomique conservés ; ordre des événements, mappings, conflits, sources de référence et couverture de tous les flux **incomplets/non validés**. Aucune intégration HL7/FHIR hospitalière réelle établie |
| SH et ERP | Configuration opérationnelle ajoutée ; pas de régression ERP PostgreSQL ni navigateur exécutée |
| Sécurité et concurrence | Droits et versions testés localement ; isolation SQL réelle, réservations simultanées et audit indépendant en attente |
| Publication, sauvegardes, rollback | Procédure préparée ; aucune sauvegarde fraîche restaurée ni bascule testée dans cette reprise |

Les 21 captures de `arrimo-finalisation/captures-pub` sont historiques, réalisées sur copie selon leur rapport. Aucune nouvelle capture n'a été produite. Les captures futures du nouveau test seront dans `preuves/priorites-vnext/` après exécution réelle.

**Statuts : développé / testé localement : oui pour les changements ci-dessus ; testé sur copie PostgreSQL : non ; déployé publiquement : non pour ce lot ; testé dans le navigateur : non ; prêt pour démonstration : non confirmé ; validé pour usage clinique réel : non.**
