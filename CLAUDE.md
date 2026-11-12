# Arrimo — contexte pour Claude Code

Arrimo coordonne les lits hospitaliers et les transferts entre hôpitaux (cible : réseau de santé du Québec).
Propriétaire : Moustafa Adamou. Langue de travail et de l’interface : **français** (anglais à ajouter).

## Règles permanentes (à respecter dans tout le travail)
- **Aucune donnée médicale** : une référence patient (format par pays, ex. `P-00000`), jamais de diagnostic. Exception demandée par Moustafa (cahier de finalisation, 24 oct. 2026) : fiche d’identification **fictive** (prénom, nom, date de naissance) en démo et recette seulement (`src/patients.js`) ; jamais dans les vues réseau, notifications ni journal. Décision de Moustafa (30 oct. 2026) : OG peut rechercher, afficher et créer ces fiches **fictives** en démo et recette seulement ; refus prouvé par test en production et validation, et aucune identité dans le journal ni les notifications. Décision de Moustafa (30 oct. 2026, cahier « historique longitudinal ») : **phase A seulement** — passages et historique administratif des patients fictifs (`src/patients-historique.js`, table `patient_passages`), démo et recette seulement ; **pas de constantes vitales ni d'autre donnée clinique** (phase B non autorisée tant que la validation réglementaire n'est pas faite).
- **Décision de Moustafa (6 nov. 2026) :** pathologies et symptômes **fictifs, en démo seulement**, pour l'admission, les chambres compatibles et les transferts ; refus prouvé par test ailleurs ; jamais de vraie donnée médicale en production ; jamais de diagnostic montré aux nettoyeurs. OG ne pose aucun diagnostic et ne décide d'aucune orientation clinique.
- **Données fictives seulement** sur le serveur de démonstration. Aucune vraie donnée de patient ou d’hôpital avant l’hébergement au Canada et l’évaluation Loi 25.
- **Aucune dépendance à Odoo**. Module autonome : Node.js + PostgreSQL + interface web sans framework.
- **Dans tout ce qui est destiné au Québec** (interface, documents, présentations) : ne pas mentionner l’Afrique de l’Ouest ni Odoo.
- **Charte visuelle** (`public/style.css`, identique pour tous les établissements et rôles) : principal `#0E5E6F`, secondaire `#159895`, accent `#57C5B6`, fond `#F5F8FA`, texte `#1F2937` / `#64748B`, bordures `#E2E8F0`. Rouge `#DC2626`, orange `#F59E0B`, vert `#16A34A`, bleu `#2563EB`, gris `#94A3B8` : **statuts seulement**, jamais comme couleur d’identité. Décision de Moustafa (1er nov. 2026, cahier « refonte visuelle CHSLD ») : les CHSLD ont un thème propre (`public/chsld.css`, appliqué par le type d’établissement : sauge `#3E8B77`, forêt `#18594D`, pétrole `#164B61`, turquoise `#DDF4EF`, fond `#F6FAF8`, ambre `#E6A23C`, indicateurs teintés) ; les hôpitaux gardent la charte ci-dessus.
- **Le Copilote propose, un humain décide** : aucune action automatique ; chaque action passe par les mêmes règles que l’interface.
- **Proximité d’abord** : l’hôpital le plus proche qui a un lit adapté, sauf s’il est lui-même débordé.
- **Jamais de double authentification sur les démos** (décision de Moustafa, 6 nov. 2026) : comptes partagés ; administration sans code et activation refusée en environnement démo. Elle reste exigée en recette, validation et production.
- Ne jamais afficher de mot de passe, de clé ou de secret dans les réponses.
- Demander l’accord de Moustafa avant toute action sur le serveur ou sur la base de production.

## Architecture
- `src/server.js` démarrage, détection des blocages toutes les 15 min · `src/app.js` routes API
- `src/regles.js` **seul endroit qui change l’état d’un lit ou d’une civière** (verrou `FOR NO KEY UPDATE NOWAIT` + numéro de version, journal, refus journalisés)
- `src/civieres.js` civières de l’urgence : liste, actions, changement de civière, statistiques (taux, > 24 h, > 48 h)
- `src/services.js` capacité réseau, recommandation (proximité), transferts, journal, assistant
- `src/terrain.js` file d’admission, NSA, congés, nettoyage, niveaux d’alerte, indicateurs
- `src/copilote.js` briefing, recommandations, vue réseau, questions (mode local ; mode IA facultatif sans référence patient)
- `src/liaison-chsld.js` module hospitalier Liaison CHSLD (arrivées, accueil, retours ; moteur de coordination de `src/chsld.js`) · `src/og-liaison.js` OG pour ce module
- `src/connecteurs.js` réception d’événements HL7 ADT traduits en JSON, capacité réseau en lecture
- Préhospitalier (cahiers du 12 nov. 2026, `docs/cahiers-prehospitalier-20261112/`, décisions : `docs/AUDIT_PREHOSPITALIER_2026-11-12.md`, section 14) : `src/prealertes.js` préalertes ambulance → hôpital (module optionnel `liaison_secours`, organisations de secours à part des établissements, rôles `paramedic`, `superviseur_secours`, `repartiteur` limités à `/api/secours/*`) · `src/transports.js` demandes de transport d'un établissement (CHSLD, RPA, RI, RTF) ou d'un hôpital vers une ambulance (Liaison Établissements) · `src/og-secours.js` OG pour l'hôpital, l'ambulance et le CCS · `src/connect.js` Arrimo Connect v1 (`/api/connect/v1`, requêtes signées HMAC) · `src/admin-secours.js` administration (gestionnaire réseau) · écrans `public/secours.html` (Ambulance, CCS), `public/liaison-secours.js` (onglet hospitalier), `public/transports.js`
- `src/admin.js` mon compte, double authentification, administration · `src/totp.js` codes à 6 chiffres (RFC 6238)
- `db/schema.sql` schéma (idempotent, rejouable) · `db/seed.js` ancienne démo à 6 établissements (tests) · `db/demo-reseau.js` démo : réseau de 20 hôpitaux (comptes hopital.x, hopital.y, reseau)
- `src/environnement.js` ARRIMO_ENV (demo, recette, production) et ARRIMO_DOMAINE (seul réglage de domaine) · `deploy/noms.sh` noms par environnement · `db/premier-compte.js` premier compte d'un environnement vide
- `src/sh/` console SH (siège, sh.<domaine>, base arrimo_sh, `db/sh-schema.sql`) · `src/sh-api.js` API des environnements pour la console (clé `SH_API_KEY`) · `src/import.js` import CSV
- `src/simulation.js` démo vivante : les hôpitaux sans compte évoluent toutes les 3 min (même règles, journalisé) · `src/national.js` tableau national par proximité
- `public/` interface (`index.html`, `app.js`, `style.css`, `logo.svg`)
- `deploy/installer.sh` installation serveur · `deploy/sauvegarde.sh`, `deploy/restaurer.sh`
- Journaux `journal` et `journal_admin` **immuables** (déclencheurs PostgreSQL) : ne jamais contourner.

## Travailler en local (Mac)
```
brew install postgresql@16 && brew services start postgresql@16
createdb arrimo && createdb arrimo_test
npm install
DATABASE_URL=postgres:///arrimo npm run demo:reset
DATABASE_URL=postgres:///arrimo HOST=127.0.0.1 npm start        # http://localhost:3010
TEST_DATABASE_URL=postgres:///arrimo_test npm test               # 10 fichiers (≈ 220 tests) ; les 2 tests SH exigent le rôle PostgreSQL restreint (recette)
TEST_DATABASE_URL=postgres:///arrimo_test npm run test:interface   # 9 tests dans Chromium (captures dans captures/)
```
Tout changement : ajouter ou adapter un test dans `tests/api.test.js`, puis `npm test` vert avant de déployer.

## Serveur de démonstration
- `root@37.60.243.149` (Ubuntu 24.04, Contabo) · site : https://arrimo.senseafri.com · d’autres sites tournent derrière le même Nginx : ne pas y toucher.
- Application : `/opt/arrimo` (utilisateur système `arrimo`), service systemd `arrimo`, configuration `/opt/arrimo/.env` (droits 600).
- Sauvegardes : `/var/backups/arrimo`, chaque nuit à 3 h (timer `arrimo-sauvegarde`) ; restauration : `arrimo-restaurer <fichier.dump>`.
- État : `curl -s https://arrimo.senseafri.com/api/sante` · journaux : `journalctl -u arrimo -f`
- **Déployer une nouvelle version** (la base est conservée) :
  `git archive` ou zip du dépôt → `scp arrimo.zip deploy/installer.sh root@37.60.243.149:/root/` → `ssh root@37.60.243.149 "cd /root && bash installer.sh arrimo.senseafri.com"`
  Le script rejoue `db/schema.sql` (sans effacer les données) et redémarre le service.
- **Recette** (même serveur, données de test) : `/opt/arrimo-recette`, service `arrimo-recette`, base `arrimo_recette`, https://recette.arrimo.senseafri.com · installer avec `ARRIMO_ENV=recette bash installer.sh arrimo.senseafri.com`.
- **Console SH** : `/opt/arrimo-sh`, service `arrimo-sh`, base `arrimo_sh`, https://sh.arrimo.senseafri.com · installer avec `ARRIMO_ENV=sh bash installer.sh arrimo.senseafri.com`.
- **Production** : jamais sur ce serveur ; hébergement au Canada (l'installateur exige `CONFIRMER_HEBERGEMENT_CANADA=oui`). Hors Canada : `PAYS_HEBERGEMENT=XX CONFIRMER_HEBERGEMENT=oui CONFIRMER_CADRE_LEGAL=oui` (`deploy/hebergement.sh`). Une production par pays se relie à SH avec `SH_PRODUCTIONS`.
- **Remettre la démo à zéro** : `sudo -u arrimo bash -c 'set -a; . /opt/arrimo/.env; set +a; cd /opt/arrimo && npm run -s demo:reset' > /opt/arrimo/acces-demo.txt`

## Tâches, par ordre de priorité
### A. Sécuriser le serveur (avant tout le reste)
1. Clé SSH (ed25519 avec phrase de passe) installée et **testée dans une nouvelle session** ; ensuite seulement `PasswordAuthentication no`, `PermitRootLogin prohibit-password`, `sshd -t`, rechargement, nouveau test.
2. Pare-feu UFW : 22, 80, 443 (vérifier d’abord les ports utilisés par les autres sites).
3. fail2ban pour SSH. 4. `apt upgrade`, unattended-upgrades, redémarrage, vérification d’Arrimo et des autres sites.
5. Changer le mot de passe de démonstration (`DEMO_MOT_DE_PASSE` dans `.env`) puis remettre la démo à zéro ; récupérer `/opt/arrimo/acces-demo.txt` dans `~/Documents/arrimo-acces-demo.txt` (600) puis le supprimer du serveur.
6. Sauvegardes externes : FAIT le 2026-10-17. Bucket privé B2 `arrimo-sauvegardes` (us-east-005, chiffré), clé dans `/root/.config/rclone/rclone.conf` (600) — **audit du 5 nov. 2026 : elle n'est PAS limitée à ce bucket, elle voit aussi `medlink-backups-togo` ; à remplacer**, distant rclone `b2-arrimo`, dossiers demo/ recette/ sh/. Reconfigurer : `arrimo-b2-configurer` (saisie masquée). Restauration testée. Production : bucket au Canada à prévoir (Loi 25).
7. Dépôt GitHub privé `arrimo` (sans `node_modules` ni `.env`) : FAIT le 2026-10-17, github.com/moustaphaadamou83-sketch/arrimo, clé de déploiement `/root/.ssh/arrimo_github` (hôte SSH `github-arrimo`), `git push` depuis /root/arrimo-dev.

### B. Finir le produit avant toute prise de contact
État 2026-10-16 : B1 à B8 faits dans /root/arrimo-dev (non déployés). Restent : remarques de Moustafa sur l'interface, relecture des pages légales par un avocat, courriel professionnel pour activer B8.
1. **Vérifier l’interface dans un vrai navigateur** (ordinateur, téléphone, tablette) en suivant `GUIDE-DEMO.md` ; corriger tout défaut d’affichage, surtout l’écran Nettoyage sur tablette.
2. **Version anglaise** complète de l’interface avec choix de langue mémorisé (garder le français par défaut).
3. **Aide intégrée** : une page d’aide par rôle (coordination, urgence, entretien, administration).
4. **Politique de confidentialité et conditions d’utilisation** (pages accessibles depuis l’écran de connexion), à faire relire par un avocat.
5. **Mot de passe oublié** : aujourd’hui, réinitialisation par un administrateur seulement ; ajouter l’envoi par courriel quand un courriel professionnel Arrimo existera.
6. **Présentation** de 10 diapositives pour accompagner la démo.
7. Plus tard (pilote) : hébergement au Canada (environnements **et console SH**, décision de Moustafa du 11 nov. 2026 : SH contient les contacts et la facturation des clients), évaluation Loi 25, test d’intrusion, connexion HL7/FHIR réelle avec l’équipe informatique d’un hôpital, calcul d’itinéraire réel, prévisions entraînées sur l’historique.

## Documents liés
- `README.md` fonctionnement et API · `GUIDE-DEMO.md` démonstration de 10 minutes
- Proposition de projet pilote : document Claude « Arrimo · Proposition de projet pilote » (questions ouvertes : prix, entité signataire au Canada, hébergement, courriel, marque).
